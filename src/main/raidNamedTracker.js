'use strict';

const { EventEmitter } = require('events');
const { matchZoneChange, matchSlain, matchOwnVoidlingDanger } = require('./buffParser');
const { RAID_ZONE_NAMEDS } = require('../shared/data/raidZoneNameds');

// Backlog #33 - a named-kill board. Enter a tracked zone, every named in that zone's list shows as
// "up"; a "<name> has been slain by ..." line greys it out. For a zone flagged `respawns`, a greyed
// named with a `respawnMinutes` shows a countdown and comes back when it elapses.
//
// EVERY tracked zone shows the board on a plain "You have entered X." line. Owner, 2 Sep:
// "anything that is a RAID is also a separate DUNGEON" - a Voidling raid instance and an ordinary
// group/dungeon run of the same zone show the same board. The `raid: true` flag in
// raidZoneNameds.js no longer gates visibility; the Voidling "danger" hail (`viaVoidling` /
// `this.viaVoidling`) is kept only as metadata for whoever needs to tell a raid-lockout instance
// from a group run (lockoutCore keys its weekly-attempt event on the same signal).
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
    // True when the current tracked zone was entered right after the player's own Voidling
    // "danger" hail - i.e. it's the raid-lockout instance, not a plain group run. Metadata only;
    // the board shows either way now.
    this.viaVoidling = false;
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
    const baseZone = stripInstanceSuffix(rawZone);
    const entry = RAID_ZONE_NAMEDS[baseZone];

    // Owner, 2 Sep: "anything that is a RAID is also a separate DUNGEON." The board shows on ANY
    // entry to a tracked zone - a plain group/dungeon run, or a Voidling raid instance. The
    // `raid: true` flag no longer gates VISIBILITY; `viaVoidling` is kept only as metadata (it's
    // what tells a raid-lockout instance from a group run, the same signal lockoutCore keys on).
    if (!entry) {
      if (this.currentZone !== null) {
        this.currentZone = null;
        this.viaVoidling = false;
        this.board = new Map();
        this._debugLog(`RAID BOARD - left tracked zone, board cleared`);
        this.emit('changed', this.getActive());
      }
      return;
    }

    // Already in this base zone and got another line for it - the instance line right after the
    // entrance line ("The Ruins of Old Paineel" then "... 1 (Awakened)"), or a reconnect echo.
    // Keep the board and its kills. EXCEPT a fresh Voidling "danger" hail into the same zone: that
    // is a brand-new raid instance, so it resets (a fresh instance = a fresh board).
    if (this.currentZone === baseZone && !viaVoidling) return;

    this.currentZone = baseZone;
    this.viaVoidling = !!viaVoidling;
    this.board = new Map(
      entry.nameds.map((n) => [bareName(n.name), { name: n.name, tier: n.tier || 'mini', killedAt: null, respawnAt: null }])
    );
    this._debugLog(
      `RAID BOARD - entered "${baseZone}"${viaVoidling ? ' (via Voidling)' : ''}, ${this.board.size} named up`
    );
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
