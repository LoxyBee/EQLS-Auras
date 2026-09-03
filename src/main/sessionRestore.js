'use strict';
/**
 * One place for "put back what was live when the app last closed."
 *
 * The app never replays log history, so any restart wipes every running engine's in-memory state
 * and leaves the overlay blank until the game happens to re-emit each fact. That was patched one
 * engine at a time - buff/song/timer state (sessionSnapshot.js), then the group roster, then the
 * active ability groups - each with its own private persist/restore pair and its own gap rule.
 *
 * This unifies them. Every engine that holds live session state registers a { capture, restore }
 * pair and its own staleness limit; this module owns the single snapshot file, the debounced
 * save, the quit-time flush, and the one startup pass that hands each engine its slice back.
 *
 * WHY A PER-PART STALENESS LIMIT rather than one global window: a stale buff timer and a stale
 * damage total carry different risk.
 *   - A buff that "hasn't expired" may still be long gone (death, camp, zone, relog) and a wrong
 *     countdown reads as authoritative where an empty list obviously doesn't - 5 minutes.
 *   - A damage total or a "who pulled" line goes misleading much faster and is only ever wanted
 *     back across a crash or a quick restart mid-fight - 2 minutes.
 *   - A character state like your active stance never goes stale: it stays whatever you last set
 *     it to until you change it in game - no limit.
 * The app cannot see what happened in-game while it was closed, so the limit is about trust, not
 * arithmetic. Every entry stores absolute timestamps, so the restore itself needs no clock math.
 *
 * CONTRACT:
 *   capture()            -> a JSON-cloneable value, or null/undefined for "nothing to save".
 *   restore(data, gapMs) -> called only when the snapshot is within this part's maxGapMs AND the
 *                           clock has not gone backwards. Returns a small integer (how many things
 *                           it put back) purely for the debug line. One part throwing or being
 *                           too stale never blocks the others.
 */

const SNAPSHOT_KEY = 'sessionRestore';
const SAVE_DEBOUNCE_MS = 2000;
const NO_LIMIT = Infinity;

class SessionRestore {
  constructor() {
    this._parts = new Map(); // id -> { capture, restore, maxGapMs }
    this._store = null;
    this._debugLog = () => {};
    this._timer = null;
  }

  setStore(store) {
    this._store = store;
  }

  setDebugLogFn(fn) {
    this._debugLog = typeof fn === 'function' ? fn : () => {};
  }

  register(id, { capture, restore, maxGapMs } = {}) {
    if (!id || typeof capture !== 'function' || typeof restore !== 'function') {
      throw new Error('sessionRestore.register(id, { capture, restore, maxGapMs }) - id and both functions are required');
    }
    this._parts.set(id, {
      capture,
      restore,
      maxGapMs: typeof maxGapMs === 'number' && maxGapMs > 0 ? maxGapMs : NO_LIMIT,
    });
  }

  // Debounced - engine change events fire once a second per active thing and this writes to disk.
  // 2s is far below every part's gap limit, so a death between the last event and the write loses
  // nothing meaningful.
  scheduleSave() {
    if (this._timer || !this._store) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // Call directly on before-quit: the debounced save may still be pending and that is exactly the
  // moment the snapshot matters most.
  saveNow() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._store) return;
    const parts = {};
    for (const [id, p] of this._parts) {
      try {
        const data = p.capture();
        if (data != null) parts[id] = data;
      } catch (e) {
        this._debugLog(`sessionRestore: capture "${id}" threw: ${(e && e.message) || e}`);
      }
    }
    this._store.saveJson(SNAPSHOT_KEY, { savedAt: Date.now(), parts });
  }

  // One startup pass. Each part restores independently.
  restoreAll(now = Date.now()) {
    if (!this._store) return;
    const snap = this._store.loadJson(SNAPSHOT_KEY, null);
    if (!snap || typeof snap.savedAt !== 'number' || !snap.parts || typeof snap.parts !== 'object') {
      this._debugLog('sessionRestore: no snapshot to restore');
      return;
    }
    const gap = now - snap.savedAt;
    // A negative gap means the system clock moved backwards since the snapshot (timezone change,
    // NTP correction). Every absolute timestamp in it is then meaningless relative to now.
    if (gap < 0) {
      this._debugLog('sessionRestore: clock moved backwards since the snapshot - nothing restored');
      return;
    }
    const secs = Math.round(gap / 1000);
    for (const [id, p] of this._parts) {
      const data = snap.parts[id];
      if (data == null) continue;
      if (gap > p.maxGapMs) {
        this._debugLog(`sessionRestore: "${id}" skipped - closed for ${secs}s, over its ${Math.round(p.maxGapMs / 1000)}s limit`);
        continue;
      }
      try {
        const n = p.restore(data, gap) || 0;
        this._debugLog(`sessionRestore: "${id}" restored${n ? ` (${n})` : ''} after ${secs}s`);
      } catch (e) {
        this._debugLog(`sessionRestore: restore "${id}" threw: ${(e && e.message) || e}`);
      }
    }
  }

  clear() {
    if (this._store) this._store.saveJson(SNAPSHOT_KEY, null);
  }
}

module.exports = { SessionRestore, SNAPSHOT_KEY, SAVE_DEBOUNCE_MS };
