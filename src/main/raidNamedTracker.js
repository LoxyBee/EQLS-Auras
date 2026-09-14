'use strict';

const { EventEmitter } = require('events');
const { matchZoneChange, matchSlain } = require('./buffParser');
const { RAID_ZONE_NAMEDS } = require('../shared/data/raidZoneNameds');

// Backlog #33 - a named-kill board. Enter a tracked zone, every named in that zone's list shows as
// "up"; a "<name> has been slain by ..." line greys it out. For a zone flagged `respawns`, a greyed
// named with a `respawnMinutes` shows a countdown and comes back when it elapses.
//
// EVERY tracked zone shows the board on a plain "You have entered X." line. Owner, 2 Sep:
// "anything that is a RAID is also a separate DUNGEON" - a Voidling raid instance and an ordinary
// group/dungeon run of the same zone show the same board. The `raid: true` flag in
// raidZoneNameds.js no longer gates visibility; `this.viaVoidling` (read off the zone string's own
// " - Group" marker - see GROUP_INSTANCE_RE) is kept only as metadata for whoever needs to tell a
// raid-lockout instance from a group run. lockoutCore's own weekly-attempt tracking is separate and
// correctly still keys on the player's own hail - an attempt is about who personally asked for it.
//
// Its own small engine rather than a mode on customTimerEngine or a hook in damageEngine: the
// state is per-zone and resets wholesale on a zone line, which is nothing like a trigger timer or
// a damage row. Same DI shape as the other engines (no Electron import, so it runs in a plain
// Node test) - the only inputs are log lines and Date.now().

// Instance-difficulty suffixes seen in the owner's real logs: " - Group", " - Group 3 (Fused)",
// " 1 (Awakened)", " - Group 4 (Refined)".
const INSTANCE_SUFFIX = / (?:- Group(?: \d+ \([^)]+\))?|\d+ \([^)]+\))\s*$/;

// The " - Group" marker IS the raid-lockout instance, confirmed by the owner (13 Sep) and checked
// against a full week of real logs: every "- Group" zone entry has a Voidling hail within seconds
// of it; every entry without "- Group" either has none nearby or one that is hours old and
// unrelated. It is a direct, always-present signal - unlike catching THIS player's own "danger"
// hail, which misses every time someone else forms the raid and just invites you in, or you
// reconnect into an already-running one without re-hailing yourself. See _enterZone.
const GROUP_INSTANCE_RE = / - Group(?:\s|$)/;

// Owner, 14 Sep: a real ~12-hour session showed the "reset or keep progress?" popup fire 3 times
// and go unanswered all 3 times (confirmed against her own log - no "reset"/"kept" debug line
// ever followed one before she eventually left the zone for something else), each time leaving
// the board silently stuck showing stale kills until she happened to leave. Her own call on the
// fix: auto-answer "reset" if she hasn't answered within this window - a real re-entry is far
// more often a fresh attempt than an echo, and an unattended board is worse than an occasional
// wrongly-reset one. Overridable via setOptions() for tests.
const RESET_PROMPT_AUTO_RESET_MS = 18000;

/** "The Plane of Hate - Group 3 (Fused)" / "Nagafen's Lair 1 (Awakened)" -> the base zone name. */
function stripInstanceSuffix(zone) {
  return String(zone || '').replace(INSTANCE_SUFFIX, '').trim();
}

/** Is this the raid-lockout instance, going purely off what the zone string itself says? */
function isGroupInstance(rawZone) {
  return GROUP_INSTANCE_RE.test(String(rawZone || ''));
}

/** Drop a leading article so "A dracoliche" and "dracoliche" compare equal. */
function bareName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^(?:a|an|the)\s+/, '')
    .trim();
}

class RaidNamedTracker extends EventEmitter {
  constructor() {
    super();
    // Base zone name, or null when not in a tracked raid zone.
    this.currentZone = null;
    // bareName(namedName) -> { name, tier, killedAt: ms|null, respawnAt: ms|null }
    this.board = new Map();
    this.debugLogFn = null;
    // Whether the entry line that built the CURRENT board carried any instance suffix at all
    // (tagged or not) - see _enterZone's "exiting a d4 into public" comment. Only meaningful
    // together with currentZone; reset alongside it.
    this._currentHasSuffix = false;
    // True when the current tracked zone IS the raid-lockout instance, not a plain group run -
    // read straight off the zone string's own " - Group" marker (see isGroupInstance). Metadata
    // only; the board shows either way now.
    this.viaVoidling = false;
    // Called on every board change so the session-restore registry can persist it - a raid runs
    // for well over an hour and the app gets restarted mid-raid (crash, or to pick up a fix), and
    // without this every restart rebuilt the board with all nameds "up" again, throwing away which
    // ones the group had already cleared (reported live: 7 Plane of Hate nameds down, restarted,
    // board showed all 14 up).
    this._persistFn = null;
    // A session-restore snapshot waiting for its zone's board to be built (startup ordering - see
    // restoreState). Consumed by _enterZone.
    this._pendingRestore = null;
    // A "same zone, ambiguous whether it's a fresh run" question waiting on the owner's own
    // answer - see _enterZone's comment on why this can't be decided automatically. Null when
    // nothing is being asked. { zone } - just enough to know what resolveResetPrompt is answering
    // FOR, and to check she hasn't already walked off before answering.
    this.pendingResetPrompt = null;
    // The live setTimeout backing the auto-reset above - cleared whenever the question is
    // answered (either way) or becomes moot (she left the zone) before it fires.
    this._resetPromptTimer = null;
    this._resetPromptAutoResetMs = RESET_PROMPT_AUTO_RESET_MS;
    this.tickTimer = setInterval(() => this._tick(), 1000);
  }

  setOptions(opts = {}) {
    if (typeof opts.resetPromptAutoResetMs === 'number') this._resetPromptAutoResetMs = opts.resetPromptAutoResetMs;
  }

  setDebugLogFn(fn) {
    this.debugLogFn = fn;
  }

  setPersistFn(fn) {
    this._persistFn = typeof fn === 'function' ? fn : null;
  }

  _persist() {
    if (this._persistFn) this._persistFn();
  }

  // For the session-restore registry. Null when there is nothing worth keeping (not in a tracked
  // zone, or in one with no kills recorded - a fresh board rebuilds itself from the zone line).
  captureState() {
    if (!this.currentZone) return null;
    const killed = [...this.board.values()].filter((e) => e.killedAt);
    if (!killed.length) return null;
    return {
      zone: this.currentZone,
      viaVoidling: this.viaVoidling,
      at: Date.now(),
      kills: killed.map((e) => ({ name: e.name, killedAt: e.killedAt, respawnAt: e.respawnAt || null })),
    };
  }

  // Restore the greyed-out kills onto the board for the same zone. The registry only calls this
  // within its grace window and with the clock sane. Startup ORDER matters: sessionRestore.restoreAll
  // runs before the log-tail zone recovery (setZone), so currentZone is usually still null here -
  // stash the snapshot and let _enterZone apply it once the board for the matching zone exists.
  // respawnAt is absolute, so a countdown that elapsed while closed is dropped by the next _tick.
  restoreState(snap) {
    if (!snap || typeof snap !== 'object' || !snap.zone) return 0;
    this._pendingRestore = snap;
    return this._applyPendingRestore();
  }

  _applyPendingRestore() {
    const snap = this._pendingRestore;
    if (!snap || snap.zone !== this.currentZone) return 0;
    this._pendingRestore = null;
    let n = 0;
    for (const k of Array.isArray(snap.kills) ? snap.kills : []) {
      const entry = this.board.get(bareName(k.name));
      if (!entry || entry.killedAt) continue;
      entry.killedAt = Number(k.killedAt) || Date.now();
      entry.respawnAt = k.respawnAt ? Number(k.respawnAt) : null;
      n += 1;
    }
    if (n) {
      this._debugLog(`RAID BOARD - restored ${n} kill${n === 1 ? '' : 's'} for "${this.currentZone}" after a restart`);
      this.emit('changed', this.getActive());
    }
    return n;
  }

  _debugLog(msg) {
    if (this.debugLogFn) this.debugLogFn(msg);
  }

  stop() {
    clearInterval(this.tickTimer);
    this._clearResetPromptTimer();
  }

  _clearResetPromptTimer() {
    if (this._resetPromptTimer) {
      clearTimeout(this._resetPromptTimer);
      this._resetPromptTimer = null;
    }
  }

  handleLine(line) {
    const zone = matchZoneChange(line);
    if (zone) {
      this._enterZone(zone);
      return;
    }
    const slain = matchSlain(line);
    if (slain) this._recordKill(slain);
  }

  // Startup zone recovery (see logZonePeek.js). The player entered this zone before the app was
  // watching, so the board is rebuilt full - nothing has been killed as far as the app can know.
  // The board shows for ANY tracked zone here, same as a live entry (c3479d4).
  setZone(zone) {
    if (!zone) return;
    this._seeding = true;
    try {
      this._enterZone(zone);
    } finally {
      this._seeding = false;
    }
  }

  // `rawZone` is the zone name exactly as the log gave it, difficulty suffix and all. Whether it is
  // the raid-lockout instance is read straight off its own " - Group" marker (see
  // GROUP_INSTANCE_RE), confirmed by the owner and by a full week of real logs checked line by
  // line, and authoritative in both directions - a "- Group" zone is the raid instance even with
  // no hail at all (someone else formed it and just invited this player in, or a reconnect landed
  // back in one), and a bare zone is NOT the raid instance even if a hail happened to occur nearby
  // (someone else's unrelated raid forming at the same time). An earlier version guessed instead
  // from whether THIS player's own "danger" line had just preceded the zone change, and got both
  // directions wrong.
  _enterZone(rawZone) {
    const viaVoidling = isGroupInstance(rawZone);
    const baseZone = stripInstanceSuffix(rawZone);
    const entry = RAID_ZONE_NAMEDS[baseZone];
    // A group/raid instance carries a difficulty suffix ("- Group", "N (Awakened)"). If one of
    // those has no named list, that is almost certainly a zone string EQL uses that
    // raidZoneNameds.js doesn't know yet (e.g. a new instance name) - make it loud in the debug
    // log rather than a silent empty board, so the gap is visible without the owner having to
    // report which zone it was.
    if (!entry && baseZone !== String(rawZone || '').trim()) {
      this._debugLog(
        `RAID BOARD - entered instanced zone "${rawZone}" (base "${baseZone}") with no named list - add it to raidZoneNameds.js`
      );
    }

    // Owner, 2 Sep: "anything that is a RAID is also a separate DUNGEON." The board shows on ANY
    // entry to a tracked zone - a plain group/dungeon run, or a Voidling raid instance. The
    // `raid: true` flag no longer gates VISIBILITY; `viaVoidling` is kept only as metadata (it's
    // what tells a raid-lockout instance from a group run, the same signal lockoutCore keys on).
    if (!entry) {
      this._clearResetPromptTimer();
      this.pendingResetPrompt = null; // the question about the OLD zone is moot now
      if (this.currentZone !== null) {
        this.currentZone = null;
        this.viaVoidling = false;
        this._currentHasSuffix = false;
        this.board = new Map();
        this._debugLog(`RAID BOARD - left tracked zone, board cleared`);
        this.emit('changed', this.getActive());
      }
      return;
    }

    // Already in this base zone and got another line for it - the instance line right after the
    // entrance line ("The Ruins of Old Paineel" then "... 1 (Awakened)"), or a reconnect echo. A
    // fresh Voidling "danger" hail into the same zone falls through below regardless (a brand-new
    // raid instance always resets, no need to ask - see the "authoritative in both directions"
    // comment above). Short of that hail, the zone string alone cannot tell an instance-line echo
    // (keep is right) from a second, later trip back into a genuinely new dungeon instance (reset
    // is right) - owner's own report, 13 Sep: the board wasn't resetting between real runs of the
    // same dungeon. So: if there is nothing lost either way (nothing killed yet), just keep
    // quietly, same as before. If there IS something that could be lost, ask rather than guess -
    // once per re-entry, not once per line (the entrance-then-instance-suffix pair would otherwise
    // ask twice for the one visit).
    const hasSuffix = baseZone !== String(rawZone || '').trim();
    if (this.currentZone === baseZone && !viaVoidling) {
      // Owner, 14 Sep: "raid got prompted exiting a d4 into public again" - stepping OUT of a
      // tagged instance back into the bare, suffix-less hub can never be a fresh attempt (you
      // cannot start a new pull by leaving), so that specific transition never asks. A bare-to-
      // bare repeat is left alone below and still asks when kills exist - for a dungeon with no
      // tiered form at all (Nagafen's Lair), a bare re-entry is the ONLY shape a genuine second
      // attempt can take, and that ambiguity is exactly what the ask exists for.
      const wasTagged = this._currentHasSuffix;
      this._currentHasSuffix = hasSuffix;
      if (wasTagged && !hasSuffix) {
        this._debugLog(`RAID BOARD - left the tagged instance for the bare hub of "${baseZone}" - keeping progress, not asking`);
        return;
      }
      const hasKills = [...this.board.values()].some((e) => e.killedAt);
      if (hasKills && !this._seeding && !this.pendingResetPrompt) {
        this.pendingResetPrompt = { zone: baseZone };
        this._debugLog(`RAID BOARD - re-entered "${baseZone}" with kills already tracked - asking whether to reset`);
        this.emit('resetPromptNeeded', { zone: baseZone });
        // Owner, 14 Sep: a real popup went unanswered 3 times in one session and the board just
        // sat stuck each time. If nothing has answered by the time this fires, answer "reset" on
        // her behalf - see the constant's own comment for why that default was chosen.
        this._resetPromptTimer = setTimeout(() => {
          this._resetPromptTimer = null;
          this._debugLog(`RAID BOARD - "${baseZone}"'s reset prompt went unanswered - auto-resetting`);
          this.resolveResetPrompt('reset');
        }, this._resetPromptAutoResetMs);
      }
      return;
    }

    // A real zone change is happening - any question about the zone being LEFT is moot.
    this._clearResetPromptTimer();
    this.pendingResetPrompt = null;

    this.currentZone = baseZone;
    this.viaVoidling = !!viaVoidling;
    this._currentHasSuffix = hasSuffix;
    this.board = RaidNamedTracker._freshBoard(entry);
    this._debugLog(
      `RAID BOARD - entered "${baseZone}"${viaVoidling ? ' (via Voidling)' : ''}, ${this.board.size} named up`
    );
    this.emit('changed', this.getActive());
    // A fresh board for the zone a pre-restart snapshot was taken in - grey its kills back in.
    // Only from the startup seed (_seeding): a LIVE re-entry is a genuinely fresh instance and the
    // board should be all-up.
    if (this._seeding) this._applyPendingRestore();
    else this._pendingRestore = null;
  }

  static _freshBoard(entry) {
    return new Map(
      entry.nameds.map((n) => [bareName(n.name), { name: n.name, tier: n.tier || 'mini', killedAt: null, respawnAt: null }])
    );
  }

  // The owner's own answer to the "reset or keep progress" question _enterZone raised. A no-op if
  // nothing is pending (the answer arrived after she'd already walked off, or twice for the same
  // question - the popup only ever offers one). 'reset' rebuilds only if she is STILL in that zone
  // (she may have already left before answering, in which case there is nothing left to reset).
  resolveResetPrompt(choice) {
    const pending = this.pendingResetPrompt;
    if (!pending) return false;
    this._clearResetPromptTimer(); // a no-op when this IS the timer's own callback - already null by then
    this.pendingResetPrompt = null;
    if (choice !== 'reset') {
      this._debugLog(`RAID BOARD - kept "${pending.zone}"'s progress (owner said keep)`);
      return true;
    }
    if (this.currentZone !== pending.zone) return true; // moot - she's not there any more
    const entry = RAID_ZONE_NAMEDS[pending.zone];
    this.board = RaidNamedTracker._freshBoard(entry);
    this._debugLog(`RAID BOARD - reset "${pending.zone}" (owner said reset)`);
    this.emit('changed', this.getActive());
    return true;
  }

  getPendingResetPrompt() {
    return this.pendingResetPrompt;
  }

  _recordKill(slainName) {
    if (!this.currentZone) return;
    const entry = this.board.get(bareName(slainName));
    if (!entry || entry.killedAt) return; // not a tracked named here, or already down
    const now = Date.now();
    entry.killedAt = now;
    const zoneData = RAID_ZONE_NAMEDS[this.currentZone];
    const named = zoneData.nameds.find((n) => bareName(n.name) === bareName(slainName));
    if (zoneData.respawns && named && typeof named.respawnMinutes === 'number') {
      entry.respawnAt = now + named.respawnMinutes * 60 * 1000;
    }
    this._debugLog(
      `RAID BOARD - "${entry.name}" killed` + (entry.respawnAt ? `, back in ${named.respawnMinutes}m` : '')
    );
    this._persist();
    this.emit('changed', this.getActive());
  }

  _tick() {
    if (!this.currentZone) return;
    let changed = false;
    const now = Date.now();
    for (const entry of this.board.values()) {
      if (entry.respawnAt && entry.respawnAt <= now) {
        entry.killedAt = null;
        entry.respawnAt = null;
        changed = true;
        this._debugLog(`RAID BOARD - "${entry.name}" respawned`);
      }
    }
    if (changed) this._persist();
    // A respawn countdown needs a per-second broadcast to visibly tick; a board with no live
    // countdown does not, so only emit when something actually moved or a countdown is running.
    if (changed || [...this.board.values()].some((e) => e.respawnAt)) {
      this.emit('changed', this.getActive());
    }
  }

  // The board for the current zone, or [] when not in a tracked zone. Bosses first, then minis,
  // each group in the data file's own order.
  getActive() {
    if (!this.currentZone) return [];
    const now = Date.now();
    const rows = [...this.board.values()].map((e) => ({
      name: e.name,
      tier: e.tier,
      killed: !!e.killedAt,
      respawnRemainingSec: e.respawnAt ? Math.max(0, Math.round((e.respawnAt - now) / 1000)) : null,
    }));
    const rank = (t) => (t === 'boss' ? 0 : t === 'mini' ? 1 : 2); // boss, then mini, then lesser trash
    return rows.sort((a, b) => rank(a.tier) - rank(b.tier));
  }

  getCurrentZone() {
    return this.currentZone;
  }
}

module.exports = { RaidNamedTracker, stripInstanceSuffix, bareName, isGroupInstance };
