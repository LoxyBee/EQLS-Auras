'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { stripTimestamp } = require('./buffParser');

// Drop-in custom-aura modules.
//
// A module is a single `.js` file in the install's `modules/` folder. It exports one object
// describing a new aura type: an optional settings `page`, an optional overlay aura (`hasAura`),
// and a pure `onLine(line, ctx, settings)` that turns log lines into overlay entries. The host
// scans that folder at startup and watches it for changes, so dropping a file in makes it show up
// with no restart.
//
// A DISCOVERED MODULE IS INERT UNTIL EXPLICITLY ENABLED. It appears on the Setup page's "Custom
// modules" list, with any load/validation error shown inline, but its `onLine` never runs, it
// never appears in Add Aura, and its aura draws nothing until the user ticks Enable - and the
// first time they do, the renderer shows a consent dialog ("this runs code with full access to
// your PC"). `enabledModuleIds` is the persisted allow-list; it defaults to the one bundled module
// (aggro-board) so that shipped feature keeps working, and nothing else.
//
// This is NOT how the built-in aura types work - they stay hardcoded. This path is additive: an
// enabled module rides the SAME log-line stream every built-in engine gets, as a pure observer -
// it can never consume a line away from the built-ins.
//
// Trust model: an enabled module `require()`s into the main process with full Node access - there
// is no sandbox (that needs a Worker/utilityProcess and is a later change). The guards are: the
// enable gate + consent above, a per-call time budget (SLOW_CALL_MS / SLOW_STRIKES disables a
// module that keeps blocking the log bus), and the fact that config bundles do NOT carry module
// files. A genuinely hung (infinite-loop) module would still freeze the app. Residual: the file's
// top-level code runs on the scan `require()` even before enable - closing that means not
// require()ing until enable, which loses the ability to show the module's real name pre-enable;
// deferred with the sandbox.
//
// Same DI shape as the other engines - no `electron` import, so it runs under plain-node tests.

const API_VERSION = 1;

const SLOW_CALL_MS = 50;
const SLOW_STRIKES = 20;

// Ships in the install's modules/ folder, written by this project - trusted, so enabled out of the
// box. A drop-in module the user added is NOT here and starts disabled.
const BUNDLED_MODULE_IDS = ['aggro-board'];

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const FIELD_TYPES = new Set(['slider', 'checkbox', 'select', 'text']);

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** A `page` entry is either a section heading or a control. */
function validatePageEntry(entry) {
  if (!isPlainObject(entry)) return 'every page entry must be an object';
  if ('section' in entry) {
    return typeof entry.section === 'string' && entry.section ? null : 'a section entry needs a non-empty string';
  }
  if (typeof entry.key !== 'string' || !entry.key) return 'a control has no key';
  if (!FIELD_TYPES.has(entry.type)) return `control "${entry.key}": type must be one of ${[...FIELD_TYPES].join('/')}`;
  if (entry.type === 'select' && !Array.isArray(entry.options)) return `control "${entry.key}": a select needs an options array`;
  if (entry.type === 'slider' && !(typeof entry.min === 'number' && typeof entry.max === 'number')) {
    return `control "${entry.key}": a slider needs numeric min and max`;
  }
  return null;
}

/** Default value for a control, from its own `default` or a type fallback. */
function defaultFor(field) {
  if ('default' in field) return field.default;
  switch (field.type) {
    case 'checkbox': return false;
    case 'slider': return field.min;
    case 'select': return field.options[0];
    default: return '';
  }
}

/**
 * Validate a raw module export against the v1 contract. Returns `{ ok: true, module }` (normalised)
 * or `{ ok: false, error }` with a one-line human reason.
 */
function validateModule(raw, { knownIds } = {}) {
  if (!isPlainObject(raw)) return { ok: false, error: 'module does not export an object' };

  const id = raw.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return { ok: false, error: `id "${id}" must be lowercase letters, digits and dashes` };
  }
  if (knownIds && knownIds.has(id)) return { ok: false, error: `id "${id}" is already used by another module` };
  if (raw.apiVersion !== API_VERSION) {
    return { ok: false, error: `apiVersion ${raw.apiVersion} - this app speaks module apiVersion ${API_VERSION}` };
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) return { ok: false, error: 'name is required' };
  if (typeof raw.onLine !== 'function') return { ok: false, error: 'onLine(line, ctx, settings) is required' };

  const page = raw.page === undefined ? [] : raw.page;
  if (!Array.isArray(page)) return { ok: false, error: 'page must be an array' };
  for (const entry of page) {
    const err = validatePageEntry(entry);
    if (err) return { ok: false, error: err };
  }

  const defaults = {};
  for (const entry of page) {
    if ('key' in entry) defaults[entry.key] = defaultFor(entry);
  }

  const hasAura = raw.hasAura === undefined ? false : !!raw.hasAura;
  // Where a module's `page` controls are shown. 'aura' (the default, and the recommended shape -
  // see docs/MODULE-AUTHORING.md) puts them on the module aura's own settings panel, no sidebar
  // entry. 'sidebar' gives the module a dedicated nav button + page, for the rare module with
  // enough GLOBAL options that an aura panel would be cramped. A module with no aura has nowhere
  // to put an aura panel, so it falls back to 'sidebar' regardless of what it asked for.
  let settingsUI = raw.settingsUI === 'sidebar' ? 'sidebar' : 'aura';
  if (settingsUI === 'aura' && !hasAura) settingsUI = 'sidebar';

  return {
    ok: true,
    module: {
      id,
      name: raw.name.trim(),
      apiVersion: API_VERSION,
      description: typeof raw.description === 'string' ? raw.description : '',
      hasAura,
      settingsUI,
      page,
      defaults,
      onLine: raw.onLine,
    },
  };
}

class ModuleHost extends EventEmitter {
  constructor(modulesDir, store) {
    super();
    this.modulesDir = modulesDir || null;
    this.store = store || { loadJson: (_k, f) => f, saveJson: () => {} };
    // id -> { module, entries: Map<key, entry>, slowStrikes, disabled }
    this.registry = new Map();
    // What the last scan found on disk, for the Setup page's Custom-modules list - INCLUDING files
    // that failed to load. [{ file, id?, name?, description?, hasAura?, error? }].
    this.discovered = [];
    // The explicit allow-list. A module not in here is inert (onLine never runs, no aura, absent
    // from Add Aura) even though it was found and validated. Defaults to the bundled module only.
    // The string 'all' enables everything - used by the test harness, and a deliberate opt-in a
    // power user can hand-write into the JSON.
    const enabled = this.store.loadJson('enabledModuleIds', [...BUNDLED_MODULE_IDS]);
    this._enableAll = enabled === 'all';
    this.enabledIds = new Set(Array.isArray(enabled) ? enabled : [...BUNDLED_MODULE_IDS]);
    // Per-module persisted settings, keyed by module id. Absent keys fall back to page defaults.
    this.settingsById = this.store.loadJson('moduleSettings', {}) || {};
    this._ctx = { now: () => Date.now(), iconUrlForSpell: () => null };
    this._watcher = null;
    this._reloadTimer = null;
    this.tickTimer = setInterval(() => this._tick(), 1000);
  }

  // --- ctx injection (same pattern as the other engines' setXxxFn) -----------------------------

  setCurrentZoneFn(fn) { this._zoneFn = fn; }
  setGroupMembersFn(fn) { this._groupFn = fn; }
  setIconUrlForSpellFn(fn) { this._ctx.iconUrlForSpell = typeof fn === 'function' ? fn : () => null; }

  _buildCtx() {
    return {
      currentZone: this._zoneFn ? this._zoneFn() : null,
      groupMembers: this._groupFn ? this._groupFn() : [],
      now: Date.now(),
      iconUrlForSpell: this._ctx.iconUrlForSpell,
      // `line` is the RAW log line, `[Www Mmm DD HH:MM:SS YYYY] ` prefix and all - same as every
      // built-in engine gets. This strips it, for a module that only wants the message.
      stripTimestamp,
    };
  }

  // --- loading --------------------------------------------------------------------------------

  /**
   * (Re)scan the modules folder - also serves as "reload". Never throws: a missing folder, an
   * unreadable file or a bad export all become a debug-log line via the 'moduleError' event.
   */
  loadModules(dir = this.modulesDir) {
    this.modulesDir = dir;
    this.registry.clear();
    this.discovered = [];
    if (!dir) return this.getRegistered();

    let files = [];
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('.'));
    } catch (err) {
      this.discovered.push({ file: '(folder)', error: `could not read the modules folder: ${err.message}` });
      this.emit('moduleError', { id: '(folder)', error: `could not read the modules folder: ${err.message}` });
      return this.getRegistered();
    }

    for (const file of files.sort()) {
      const full = path.join(dir, file);
      let raw;
      try {
        delete require.cache[require.resolve(full)];
        raw = require(full);
      } catch (err) {
        this.discovered.push({ file, error: `failed to load: ${err.message}` });
        this.emit('moduleError', { id: file, error: `failed to load: ${err.message}` });
        continue;
      }
      const result = validateModule(raw, { knownIds: new Set(this.registry.keys()) });
      if (!result.ok) {
        this.discovered.push({ file, error: result.error });
        this.emit('moduleError', { id: file, error: result.error });
        continue;
      }
      const m = result.module;
      this.discovered.push({ file, id: m.id, name: m.name, description: m.description, hasAura: m.hasAura, settingsUI: m.settingsUI });
      // Registered, but only ACTIVE (onLine runs, aura works, offered in Add Aura) when enabled.
      this.registry.set(m.id, { module: m, entries: new Map(), slowStrikes: 0, disabled: false });
    }
    this.emit('modulesChanged', this.getRegistered());
    return this.getRegistered();
  }

  _isEnabled(id) {
    return this._enableAll || this.enabledIds.has(id);
  }

  // Flip a discovered module on/off. The renderer gates the first "on" behind a consent dialog.
  setModuleEnabled(id, enabled) {
    if (enabled) this.enabledIds.add(id);
    else this.enabledIds.delete(id);
    if (!enabled) {
      const rec = this.registry.get(id);
      if (rec) rec.entries.clear();
    }
    this.store.saveJson('enabledModuleIds', this._enableAll ? 'all' : [...this.enabledIds]);
    this.emit('modulesChanged', this.getRegistered());
    this.emit('entriesChanged', this.getAllEntries());
    return this._isEnabled(id);
  }

  /** Watch the folder so a dropped/removed file reloads everything, no restart. Debounced. */
  watchFolder() {
    if (this._watcher || !this.modulesDir) return;
    try {
      if (!fs.existsSync(this.modulesDir)) fs.mkdirSync(this.modulesDir, { recursive: true });
      const w = fs.watch(this.modulesDir, { persistent: false }, () => {
        clearTimeout(this._reloadTimer);
        this._reloadTimer = setTimeout(() => this.loadModules(), 300);
      });
      // fs.watch on Windows raises 'error' ASYNCHRONOUSLY (EPERM) when the dir is replaced or locked
      // underneath it - e.g. a git branch switch moving modules/ while the app runs. An FSWatcher is
      // an EventEmitter, so an unhandled 'error' throws and, with no process-level handler, hard-
      // crashes the main process with a dialog. A dropped watch just means no hot-reload until the
      // next launch, which is fine - so close it, forget it, and let a later loadModules() call
      // re-arm it if something wants to.
      w.on('error', (err) => {
        try { w.close(); } catch { /* already gone */ }
        if (this._watcher === w) this._watcher = null;
        this.emit('moduleError', { id: '(folder)', error: `folder watch stopped: ${err && err.message}` });
      });
      this._watcher = w;
    } catch {
      // fs.watch is best-effort (some filesystems don't support it) - startup scan still works.
    }
  }

  // --- settings ------------------------------------------------------------------------------

  /** Current settings for a module: persisted values over page defaults. */
  getSettings(id) {
    const rec = this.registry.get(id);
    const defaults = rec ? rec.module.defaults : {};
    return { ...defaults, ...(this.settingsById[id] || {}) };
  }

  setSetting(id, key, value) {
    if (!this.registry.has(id)) return this.getSettings(id);
    this.settingsById[id] = { ...(this.settingsById[id] || {}), [key]: value };
    this.store.saveJson('moduleSettings', this.settingsById);
    this.emit('settingsChanged', { id, settings: this.getSettings(id) });
    return this.getSettings(id);
  }

  // --- the log bus --------------------------------------------------------------------------

  handleLine(line) {
    if (!this.registry.size) return;
    const ctx = this._buildCtx();
    let anyChanged = false;

    for (const rec of this.registry.values()) {
      if (rec.disabled || !this._isEnabled(rec.module.id)) continue;
      let out;
      const started = Date.now();
      try {
        out = rec.module.onLine(line, ctx, this.getSettings(rec.module.id));
      } catch (err) {
        this.emit('moduleError', { id: rec.module.id, error: err.message });
        continue;
      }
      const elapsed = Date.now() - started;
      if (elapsed > SLOW_CALL_MS && ++rec.slowStrikes >= SLOW_STRIKES) {
        rec.disabled = true;
        rec.entries.clear();
        anyChanged = true;
        this.emit('moduleError', { id: rec.module.id, error: `disabled - too slow (${SLOW_STRIKES}+ calls over ${SLOW_CALL_MS}ms)` });
        continue;
      }
      if (this._absorb(rec, out)) anyChanged = true;
    }

    if (anyChanged) this.emit('entriesChanged', this.getAllEntries());
  }

  /** Merge one onLine() return into a module's live entry set. Returns whether anything changed. */
  _absorb(rec, out) {
    if (out == null) return false;
    const list = Array.isArray(out) ? out : [out];
    let changed = false;
    const now = Date.now();
    for (const e of list) {
      if (!isPlainObject(e)) continue;
      const key = typeof e.key === 'string' && e.key ? e.key : String(e.name || '').toLowerCase();
      if (!key) continue;
      // `{ key, clear: true }` retracts an entry now, without waiting for its timer - e.g. the
      // thing it was tracking ended early.
      if (e.clear) {
        if (rec.entries.delete(key)) changed = true;
        continue;
      }
      const durationSec = typeof e.durationSec === 'number' && e.durationSec > 0 ? e.durationSec : null;
      const remainingSec = typeof e.remainingSec === 'number' ? Math.max(0, e.remainingSec) : durationSec;
      rec.entries.set(key, {
        key,
        name: String(e.name || key),
        durationSec,
        expiresAt: remainingSec != null ? now + remainingSec * 1000 : null,
        infinite: remainingSec == null,
        iconUrl: typeof e.iconUrl === 'string' ? e.iconUrl : null,
        moduleId: rec.module.id,
      });
      changed = true;
    }
    return changed;
  }

  _tick() {
    const now = Date.now();
    let changed = false;
    for (const rec of this.registry.values()) {
      for (const [key, entry] of rec.entries) {
        if (entry.expiresAt != null && entry.expiresAt <= now) {
          rec.entries.delete(key);
          changed = true;
        }
      }
    }
    if (changed) this.emit('entriesChanged', this.getAllEntries());
  }

  // --- reads for main.js / the renderers ---------------------------------------------------

  /**
   * One row per discovered module `.js` - what the Setup page's Custom-modules list and the
   * Add-Aura / settings-page consumers build from. A file that failed to load appears too, with
   * `error` set and no `id`. `enabled` is the explicit allow-list state; consumers that only care
   * about live modules (Add Aura, the aura panel) filter on it themselves.
   */
  getRegistered() {
    return this.discovered.map((d) => {
      if (!d.id) return { file: d.file, error: d.error, enabled: false };
      const rec = this.registry.get(d.id);
      return {
        id: d.id,
        file: d.file,
        name: d.name,
        description: d.description,
        hasAura: d.hasAura,
        settingsUI: d.settingsUI,
        page: rec ? rec.module.page : [],
        settings: this.getSettings(d.id),
        enabled: this._isEnabled(d.id),
        // `disabled` (kept for back-compat) is the SLOW-STRIKE kill, a different thing from not
        // being enabled.
        disabled: rec ? rec.disabled : false,
      };
    });
  }

  getEntries(moduleId) {
    const rec = this.registry.get(moduleId);
    if (!rec || !this._isEnabled(moduleId)) return [];
    const now = Date.now();
    return [...rec.entries.values()].map((e) => ({
      name: e.name,
      key: e.key,
      durationSec: e.durationSec,
      remainingSec: e.infinite ? null : Math.max(0, Math.round((e.expiresAt - now) / 1000)),
      infinite: e.infinite,
      iconUrl: e.iconUrl,
    }));
  }

  getAllEntries() {
    const out = {};
    for (const id of this.registry.keys()) out[id] = this.getEntries(id);
    return out;
  }

  stop() {
    clearInterval(this.tickTimer);
    clearTimeout(this._reloadTimer);
    if (this._watcher) this._watcher.close();
  }
}

module.exports = { ModuleHost, validateModule, defaultFor, API_VERSION, SLOW_CALL_MS, SLOW_STRIKES, BUNDLED_MODULE_IDS };
