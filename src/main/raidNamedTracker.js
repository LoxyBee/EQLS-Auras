'use strict';

const { EventEmitter } = require('events');
const { matchZoneChange, matchSlain } = require('./buffParser');
const { RAID_ZONE_NAMEDS } = require('../shared/data/raidZoneNameds');

// Backlog #33 - a named-kill board. Enter a raid zone, every named in that zone's list shows as
// "up"; a "<name> has been slain by ..." line greys it out. For a zone flagged `respawns` (none of
// the raid zones - see the data file's own comment), a greyed named with a `respawnMinutes` shows
// a countdown and comes back when it elapses.
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
      this._enterZone(stripInstanceSuffix(zone));
      return;
    }
    const slain = matchSlain(line);
    if (slain) this._recordKill(slain);
  }

  _enterZone(baseZone) {
    // Re-entering the same base zone is a fresh instance - rebuild the board either way.
    const data = RAID_ZONE_NAMEDS[baseZone];
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
