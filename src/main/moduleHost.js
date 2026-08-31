'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { stripTimestamp } = require('./buffParser');

// Drop-in custom-aura modules.
//
// A module is a single `.js` file in `userData/modules/`. It exports one object describing a new
// aura type: an optional settings `page` (a declarative spec the app renders), an optional overlay
// aura (`hasAura`), and a pure `onLine(line, ctx, settings)` that turns log lines into overlay
// entries. The host scans that folder at startup AND watches it for changes, so dropping a file in
// makes the module appear with no restart. A malformed file is skipped with a reason written to
// the debug log - there is deliberately no user-facing module list, error panel or folder link.
// The only visible sign of a module is its own settings page and its aura.
//
// This is NOT how the built-in aura types work - they stay hardcoded. This path is additive: a
// module rides the SAME log-line stream every built-in engine gets (main.js fans
// `logService.watcher`'s 'line' event here too), as a pure observer - it can never consume a line
// away from the built-ins.
//
// Trust model: modules come from the owner or a known collaborator, so there is no sandbox - a
// module `require()`s into the main process with full Node access. The only guard is a per-call
// time budget: a module repeatedly slower than SLOW_CALL_MS is disabled for the session so it
// can't drag the whole log bus down. A genuinely hung (infinite-loop) module would still freeze
// the app - true isolation needs a Worker and is out of scope for v1.
//
// Same DI shape as the other engines - no `electron` import, so it runs under plain-node tests.
// The modules directory and a { loadJson, saveJson } store are passed in; `ctx` accessors are
// injected via setters.

const API_VERSION = 1;

const SLOW_CALL_MS = 50;
const SLOW_STRIKES = 20;

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

  return {
    ok: true,
    module: {
      id,
      name: raw.name.trim(),
      apiVersion: API_VERSION,
      description: typeof raw.description === 'string' ? raw.description : '',
      hasAura: raw.hasAura === undefined ? false : !!raw.hasAura,
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
    if (!dir) return this.getRegistered();

    let files = [];
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('.'));
    } catch (err) {
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
        this.emit('moduleError', { id: file, error: `failed to load: ${err.message}` });
        continue;
      }
      const result = validateModule(raw, { knownIds: new Set(this.registry.keys()) });
      if (!result.ok) {
        this.emit('moduleError', { id: file, error: result.error });
        continue;
      }
      this.registry.set(result.module.id, {
        module: result.module,
        entries: new Map(),
        slowStrikes: 0,
        disabled: false,
      });
    }
    this.emit('modulesChanged', this.getRegistered());
    return this.getRegistered();
  }

  /** Watch the folder so a dropped/removed file reloads everything, no restart. Debounced. */
  watchFolder() {
    if (this._watcher || !this.modulesDir) return;
    try {
      if (!fs.existsSync(this.modulesDir)) fs.mkdirSync(this.modulesDir, { recursive: true });
      this._watcher = fs.watch(this.modulesDir, { persistent: false }, () => {
        clearTimeout(this._reloadTimer);
        this._reloadTimer = setTimeout(() => this.loadModules(), 300);
      });
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
      if (rec.disabled) continue;
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

  /** One row per registered module - what the sidebar and the per-module pages build from. */
  getRegistered() {
    return [...this.registry.values()].map((rec) => ({
      id: rec.module.id,
      name: rec.module.name,
      description: rec.module.description,
      hasAura: rec.module.hasAura,
      page: rec.module.page,
      settings: this.getSettings(rec.module.id),
      disabled: rec.disabled,
    }));
  }

  getEntries(moduleId) {
    const rec = this.registry.get(moduleId);
    if (!rec) return [];
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

module.exports = { ModuleHost, validateModule, defaultFor, API_VERSION, SLOW_CALL_MS, SLOW_STRIKES };
