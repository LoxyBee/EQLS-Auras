'use strict';

const { EventEmitter } = require('events');
const { matchZoneChange, matchSlain, matchOwnVoidlingDanger } = require('./buffParser');
const { RAID_ZONE_NAMEDS } = require('../shared/data/raidZoneNameds');

// Backlog #33 - a named-kill board. Enter a tracked zone, every named in that zone's list shows as
// "up"; a "<name> has been slain by ..." line greys it out. For a zone flagged `respawns`, a greyed
// named with a `respawnMinutes` shows a countdown and comes back when it elapses.
//
// TWO kinds of tracked zone (see raidZoneNameds.js):
//   - a DUNGEON entry (no `raid` flag) lights up on a plain "You have entered X." line.
//   - a RAID entry (`raid: true` - the Planes, the classic raid-boss lists) lights up ONLY after
//     the player's own "You say, 'danger'" to the Voidling armed this zone change. A raid instance
//     and a group instance of the same zone share the zone string AND the "- Group"/difficulty
//     suffix (measured), so the dialogue is the only thing that tells them apart - the same signal
//     lockoutCore keys its weekly-attempt event on.
//
// Its own small engine rather than a mode on customTimerEngine or a hook in damageEngine: the
// state is per-zone and resets wholesale on a zone line, which is nothing like a trigger timer or
// a damage row. Same DI shape as the other engines (no Electron import, so it runs in a plain
// Node test) - the only inputs are log lines and Date.now().

// Instance-difficulty suffixes seen in the owner's real logs: " - Group", " - Group 3 (Fused)",
// " 1 (Awakened)", " - Group 4 (Refined)".
const INSTANCE_SUFFIX = / (?:- Group(?: \d+ \([^)]+\))?|\d+ \([^)]+\))\s*$/;

/** "The Plane of Hate - Group 3 (Fused)" / "Nagafen's Lair 1 (Awakened)" -> the base zone name. */
function stripInstanceSuffix(zone) {
  return String(zone || '').replace(INSTANCE_SUFFIX, '').trim();
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
    // The player's own "You say, 'danger'" to the Voidling arms a raid entry; the next zone change
    // consumes it (the raid instance you land in). Same signal lockoutCore keys its weekly-attempt
    // event on. Cleared on any zone change, raid or not.
    this._raidEntryArmed = false;
    this.tickTimer = setInterval(() => this._tick(), 1000);
  }

  setDebugLogFn(fn) {
    this.debugLogFn = fn;
  }

  _debugLog(msg) {
    if (this.debugLogFn) this.debugLogFn(msg);
  }

  stop() {
    clearInterval(this.tickTimer);
  }

  handleLine(line) {
    const zone = matchZoneChange(line);
    if (zone) {
      const viaVoidling = this._raidEntryArmed;
      this._raidEntryArmed = false; // a zone change consumes the pending raid entry either way
      this._enterZone(zone, viaVoidling);
      return;
    }
    if (matchOwnVoidlingDanger(line)) {
      this._raidEntryArmed = true;
      return;
    }
    const slain = matchSlain(line);
    if (slain) this._recordKill(slain);
  }

  // Startup zone recovery (see logZonePeek.js). The player entered this zone before the app was
  // watching, so the board is rebuilt full - nothing has been killed as far as the app can know.
  // `viaVoidling` comes from the same log tail scan: the hail/danger dialogue found just before the
  // recovered zone line. Without that confirmation the board stays dark - a normal instanced
  // dungeon shares the zone name and suffix.
  setZone(zone, viaVoidling = false) {
    if (zone) this._enterZone(zone, viaVoidling);
  }

  // `rawZone` is the zone name exactly as the log gave it, difficulty suffix and all. `viaVoidling`
  // is true only when the raid-entry dialogue (hail the Voidling, say "danger") immediately
  // preceded this zone change.
  _enterZone(rawZone, viaVoidling) {
    const isInstance = INSTANCE_SUFFIX.test(rawZone);
    const baseZone = stripInstanceSuffix(rawZone);
    const entry = RAID_ZONE_NAMEDS[baseZone];

    // A `raid: true` entry (the Planes, and the classic raid-boss lists) is a private Voidling
    // instance - it shows ONLY when the player's own "You say, 'danger'" armed this zone change.
    // The "- Group"/suffix grammar does NOT tell a raid apart from a group instance (measured: the
    // owner's real Plane of Fear raid entered as "... - Group 4 (Refined)"), so the dialogue is the
    // only gate. Every other entry (the dungeons, the open-world zones) shows on plain entry -
    // that's backlog #33's "every tracked zone, not just raids".
    const gated = entry && entry.raid === true;

    // For a gated raid that's already up: another instance-tagged line for the same base zone with
    // no fresh Voidling entry is a zone-line echo (reconnect, client reload) - keep the board and
    // its kills. A bare same-name line is dropping to the open version and falls through to clear.
    if (gated && this.currentZone === baseZone && isInstance && !viaVoidling) return;

    const data = entry && (!gated || viaVoidling) ? entry : null;
    if (!data) {
      if (this.currentZone !== null) {
        this.currentZone = null;
        this.board = new Map();
        this._debugLog(`RAID BOARD - left tracked zone, board cleared`);
        this.emit('changed', this.getActive());
      }
      return;
    }
    this.currentZone = baseZone;
    this.board = new Map(
      data.nameds.map((n) => [bareName(n.name), { name: n.name, tier: n.tier || 'mini', killedAt: null, respawnAt: null }])
    );
    this._debugLog(`RAID BOARD - entered "${baseZone}", ${this.board.size} named up`);
    this.emit('changed', this.getActive());
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

module.exports = { RaidNamedTracker, stripInstanceSuffix, bareName };
