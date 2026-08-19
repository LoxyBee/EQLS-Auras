// Keeps live timer state across an app restart.
//
// Everything the engines track (active self buffs, ally buffs, custom timers)
// used to be session-only, and the app never replays log history - so closing
// it, for any reason, wiped every running timer and left the overlay empty
// until each buff happened to be recast. That makes a restart genuinely
// disruptive mid-play, which is the opposite of what an overlay should be.
//
// The restore itself is almost free because active entries already store
// `expiresAt` as an ABSOLUTE timestamp rather than a remaining-seconds
// countdown: a 100-minute buff whose app was closed for 3 minutes simply
// comes back with 97 minutes left, and anything that expired while closed
// fails the `expiresAt > now` check and is dropped. No arithmetic, no clock
// bookkeeping.
//
// The grace window is the part that needs judgement, and it isn't about
// arithmetic - it's about trust. The app cannot see what happened in-game
// while it was closed (no history replay), so after a long gap a buff that
// "hasn't expired" may still be long gone: the player could have died,
// camped, zoned or relogged. Showing a stale buff as active is worse than
// showing nothing, because an empty list is obviously incomplete whereas a
// wrong timer looks authoritative. Five minutes covers the case this exists
// for - a crash, a restart, an accidental close - without pretending to know
// about a session gap.
const SNAPSHOT_KEY = 'sessionSnapshot';
const MAX_GAP_MS = 5 * 60 * 1000;

// Called on quit and whenever live state changes. Cheap: three small arrays.
function saveSnapshot(store, { selfBuffs, allyBuffs, customTimers }) {
  store.saveJson(SNAPSHOT_KEY, {
    savedAt: Date.now(),
    selfBuffs: selfBuffs || [],
    allyBuffs: allyBuffs || [],
    customTimers: customTimers || [],
  });
}

// Returns { selfBuffs, allyBuffs, customTimers } with anything already
// expired filtered out, or null when there's nothing usable to restore.
// `reason` on a null result is for the debug log, so a restart that DIDN'T
// restore says why rather than looking like a silent failure.
function loadSnapshot(store) {
  const snap = store.loadJson(SNAPSHOT_KEY, null);
  if (!snap || typeof snap.savedAt !== 'number') return { restored: null, reason: 'no snapshot' };

  const gap = Date.now() - snap.savedAt;
  // A negative gap means the system clock moved backwards since the snapshot
  // (timezone change, NTP correction). Every expiresAt in it is then
  // meaningless relative to now, so discard rather than guess.
  if (gap < 0) return { restored: null, reason: 'clock moved backwards' };
  if (gap > MAX_GAP_MS) {
    return { restored: null, reason: `closed for ${Math.round(gap / 1000)}s, over the ${MAX_GAP_MS / 1000}s limit` };
  }

  const now = Date.now();
  const alive = (entries) => (Array.isArray(entries) ? entries : []).filter((e) => e && e.expiresAt > now);
  return {
    restored: {
      selfBuffs: alive(snap.selfBuffs),
      allyBuffs: alive(snap.allyBuffs),
      customTimers: alive(snap.customTimers),
    },
    gapMs: gap,
    reason: null,
  };
}

function clearSnapshot(store) {
  store.saveJson(SNAPSHOT_KEY, null);
}

module.exports = { saveSnapshot, loadSnapshot, clearSnapshot, MAX_GAP_MS };
