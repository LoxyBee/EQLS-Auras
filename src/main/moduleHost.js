'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Drop-in custom-aura modules.
//
// A module is a single `.js` file in `userData/modules/`. It exports one object describing a new
// aura type and, optionally, a pure `onLine(line, ctx)` function that turns log lines into overlay
// entries. The host scans that folder at startup, validates each file against the contract, and
// registers the good ones; a malformed file is skipped with a recorded reason, never a crash.
//
// This is deliberately NOT how the built-in aura types work - they stay hardcoded. This path is
// additive and greenfield: a module rides the SAME log-line stream every built-in engine gets
// (main.js fans `logService.watcher`'s 'line' event to `handleLine` here too), as a pure observer.
// It can never consume a line away from the built-ins.
//
// Trust model: the modules come from the owner or a known collaborator, so there is no sandbox. A
// module `require()`s into the main process with full Node access. The only guard is a per-call
// time budget: a module that is repeatedly slow is disabled for the session so it cannot drag the
// whole log bus down. A genuinely hung (infinite-loop) module would still freeze the app - true
// isolation needs a Worker and is out of scope for v1; the recovery is "delete the file, restart".
//
// Same DI shape as the other engines - no `electron` import, so it runs under plain-node tests.
// The modules directory is passed in; `ctx` accessors are injected via setters.

const API_VERSION = 1;

// A slow onLine call. Measured after the fact (JS can't preempt sync code); a module that busts
// this SLOW_STRIKES times in a session is disabled.
const SLOW_CALL_MS = 50;
const SLOW_STRIKES = 20;

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SCHEMA_FIELD_TYPES = new Set(['slider', 'checkbox', 'select', 'text']);

/**
 * Validate a raw module export against the v1 contract. Returns `{ ok: true, module }` with a
 * normalised copy, or `{ ok: false, error }` with a one-line human reason.
 */
function validateModule(raw, { knownIds } = {}) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'module does not export an object' };

  const id = raw.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return { ok: false, error: `id "${id}" must be lowercase letters, digits and dashes` };
  }
  if (knownIds && knownIds.has(id)) return { ok: false, error: `id "${id}" is already used by another module` };

  if (raw.apiVersion !== API_VERSION) {
    return {
      ok: false,
      error: `apiVersion ${raw.apiVersion} - this app speaks module apiVersion ${API_VERSION}`,
    };
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) return { ok: false, error: 'name is required' };
  if (typeof raw.onLine !== 'function') return { ok: false, error: 'onLine(line, ctx) is required' };

  const hasAura = raw.hasAura === undefined ? false : !!raw.hasAura;
  const defaultConfig =
    raw.defaultConfig === undefined ? {} : raw.defaultConfig;
  if (defaultConfig === null || typeof defaultConfig !== 'object' || Array.isArray(defaultConfig)) {
    return { ok: false, error: 'defaultConfig must be an object' };
  }

  const schema = raw.settingsSchema === undefined ? [] : raw.settingsSchema;
  if (!Array.isArray(schema)) return { ok: false, error: 'settingsSchema must be an array' };
  for (const field of schema) {
    if (!field || typeof field !== 'object') return { ok: false, error: 'every settingsSchema entry must be an object' };
    if (typeof field.key !== 'string' || !field.key) return { ok: false, error: 'a settingsSchema entry has no key' };
    if (!SCHEMA_FIELD_TYPES.has(field.type)) {
      return { ok: false, error: `settingsSchema "${field.key}": type must be one of ${[...SCHEMA_FIELD_TYPES].join('/')}` };
    }
    if (field.type === 'select' && !Array.isArray(field.options)) {
      return { ok: false, error: `settingsSchema "${field.key}": a select needs an options array` };
    }
  }

  return {
    ok: true,
    module: {
      id,
      name: raw.name.trim(),
      apiVersion: API_VERSION,
      group: typeof raw.group === 'string' ? raw.group : 'standalone',
      description: typeof raw.description === 'string' ? raw.description : '',
      hasAura,
      defaultConfig,
      settingsSchema: schema,
      onLine: raw.onLine,
    },
  };
}

class ModuleHost extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.modulesDir = modulesDir || null;
    // id -> { module, entries: Map<key, entry>, slowStrikes, disabled }
    this.registry = new Map();
    // Load-time problems, surfaced in the UI so a broken file is visible rather than silent.
    this.loadErrors = []; // { file, error }
    this._ctx = {
      currentZone: null,
      groupMembers: [],
      now: () => Date.now(),
      iconUrlForSpell: () => null,
    };
    this.tickTimer = setInterval(() => this._tick(), 1000);
  }

  // --- ctx injection (same pattern as the other engines' setXxxFn) -------------------------------

  setCurrentZoneFn(fn) { this._zoneFn = fn; }
  setGroupMembersFn(fn) { this._groupFn = fn; }
  setIconUrlForSpellFn(fn) { this._ctx.iconUrlForSpell = typeof fn === 'function' ? fn : () => null; }

  _buildCtx() {
    return {
      currentZone: this._zoneFn ? this._zoneFn() : this._ctx.currentZone,
      groupMembers: this._groupFn ? this._groupFn() : this._ctx.groupMembers,
      now: Date.now(),
      iconUrlForSpell: this._ctx.iconUrlForSpell,
    };
  }

  // --- loading ---------------------------------------------------------------------------------

  /**
   * (Re)scan the modules folder. Clears the registry first, so this doubles as "reload modules".
   * Never throws - a missing folder, an unreadable file or a bad export all become loadErrors.
   */
  loadModules(dir = this.modulesDir) {
    this.modulesDir = dir;
    this.registry.clear();
    this.loadErrors = [];
    if (!dir) return this.getRegistered();

    let files = [];
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('.'));
    } catch (err) {
      this.loadErrors.push({ file: dir, error: `could not read the modules folder: ${err.message}` });
      return this.getRegistered();
    }

    for (const file of files.sort()) {
      const full = path.join(dir, file);
      let raw;
      try {
        delete require.cache[require.resolve(full)];
        raw = require(full);
      } catch (err) {
        this.loadErrors.push({ file, error: `failed to load: ${err.message}` });
        continue;
      }
      const result = validateModule(raw, { knownIds: new Set(this.registry.keys()) });
      if (!result.ok) {
        this.loadErrors.push({ file, error: result.error });
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

  // --- the log bus ----------------------------------------------------------------------------

  handleLine(line) {
    if (!this.registry.size) return;
    const ctx = this._buildCtx();
    let anyChanged = false;

    for (const rec of this.registry.values()) {
      if (rec.disabled) continue;
      let out;
      const started = Date.now();
      try {
        out = rec.module.onLine(line, ctx);
      } catch (err) {
        this.emit('moduleError', { id: rec.module.id, error: err.message });
        continue;
      }
      const elapsed = Date.now() - started;
      if (elapsed > SLOW_CALL_MS && ++rec.slowStrikes >= SLOW_STRIKES) {
        rec.disabled = true;
        rec.entries.clear();
        anyChanged = true;
        this.emit('moduleError', {
          id: rec.module.id,
          error: `disabled - too slow (${SLOW_STRIKES}+ calls over ${SLOW_CALL_MS}ms)`,
        });
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
      if (!e || typeof e !== 'object') continue;
      const key = typeof e.key === 'string' && e.key ? e.key : String(e.name || '').toLowerCase();
      if (!key) continue;
      const durationSec = typeof e.durationSec === 'number' && e.durationSec > 0 ? e.durationSec : null;
      const remainingSec =
        typeof e.remainingSec === 'number' ? Math.max(0, e.remainingSec) : durationSec;
      const entry = {
        key,
        name: String(e.name || key),
        durationSec,
        // Absolute, like every built-in engine, so a restart/snapshot needs no arithmetic and the
        // 1s sweep below can expire it.
        expiresAt: remainingSec != null ? now + remainingSec * 1000 : null,
        infinite: remainingSec == null,
        iconUrl: typeof e.iconUrl === 'string' ? e.iconUrl : null,
        moduleId: rec.module.id,
      };
      rec.entries.set(key, entry);
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

  // --- reads for main.js / the renderers ------------------------------------------------------

  /** What the sidebar builds from: one row per registered module. */
  getRegistered() {
    return [...this.registry.values()].map((rec) => ({
      id: rec.module.id,
      name: rec.module.name,
      group: rec.module.group,
      description: rec.module.description,
      hasAura: rec.module.hasAura,
      defaultConfig: rec.module.defaultConfig,
      settingsSchema: rec.module.settingsSchema,
      disabled: rec.disabled,
    }));
  }

  getLoadErrors() {
    return this.loadErrors.slice();
  }

  /** Live entries for one module's aura, shaped like the built-in overlay feeds. */
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
  }
}

module.exports = { ModuleHost, validateModule, API_VERSION, SLOW_CALL_MS, SLOW_STRIKES };
