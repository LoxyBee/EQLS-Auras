'use strict';

// Raid lockouts — the host side of Session D's parsing module.
//
// `lockoutCore.js` beside this file is THEIRS, vendored verbatim and not edited. It has zero
// requires, reads no clock and owns no file. Everything in this file is the part a host has to
// supply: which files to read, which character a line belongs to, when to read them, and what a
// real `now` is. That split is the engine contract, and keeping it visible is the point — if this
// file and theirs ever disagree, theirs is right.
//
// THE FIRST RULE HERE IS DO NOT BREAK THE APP.
//
// This service hangs off the same `'line'` event as buff detection, damage and everything else.
// Six listeners already share that bus. A throw in any of them would take the others down with it,
// so every entry point below is wrapped and failures are counted rather than raised. A lockout
// grid that stops updating is a disappointment; a buff overlay that stops updating because the
// lockout parser hit an unexpected line is a betrayal of the thing she already shipped.
//
// ONLY THE LIVE LOG, AND ONLY THIS WEEK OF IT
//
// The grid answers "what have I completed THIS lockout week". `backfill()` seeks to the current
// reset boundary (findWeekStartOffset, a ~one-week backward scan) and reads only from there - so
// it works the same whether the weekly archive is on or off, and a months-old log doesn't drag
// every startup and rescan. `handleLine()` (live) is fed by the tailer, which already only sees
// new lines. This replaces the earlier design, which relied on the weekly archive emptying the
// live log at the reset; that archive is now an opt-in tidiness feature, not a dependency.
//
// NOT `Logs/Split/` - an optional per-day-file feature of this app (logSplitter.js), unrelated to
// lockouts, holding older weeks. NOT `Logs/Archive/` - the weekly archive's store, same reason. An
// earlier version scanned the whole folder; that was for measuring the reset BOUNDARY across two
// files (project()/projectReset()), which the grid does not use. ("Add log files" is the one
// deliberate exception - a manual gap-fill, uncapped, see addLogs().)
//
// ONE STATE PER CHARACTER
//
// Also measured rather than chosen. Run with one shared state and two characters' grants four
// seconds apart — because they were grouped — read as one task granted twice, and the module
// reported a four-second reset bracket. `createState(character)` refuses to be shared.

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const core = require('./lockoutCore');
const { easternResetBefore, easternResetAfter } = require('../shared/easternReset');
const { findWeekStartOffset } = require('./logRotation');

// Same shape logWatcher accepts, so a file this service reads is a file that service would watch.
const LOG_FILE_PATTERN = /^eqlog_.+\.txt$/i;

// backfill() reads only from here down when the live log is bigger than this - see _weekStartOffset.
// 20 MB is ~150k lines, well under a second to parse whole; past it the backward seek to this
// week's boundary is the clear win. A weekly-archived log rarely reaches this at all.
const SEEK_WHEN_LARGER_THAN = 20 * 1024 * 1024;

/**
 * The only place a real clock is read, and it is deliberately at the edge.
 *
 * The core works in CIVIL time and refuses to produce an instant, because a log stamp carries no
 * timezone — it is the client's local wall clock and nothing more. Reading local components here
 * is therefore the correct conversion, and going via UTC or an offset would not be.
 */
function civilNow(date = new Date()) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

class LockoutService extends EventEmitter {
  constructor() {
    super();
    // character -> core state. Bounded by the number of characters whose logs are in the folder,
    // which is an entity count and not a function of how long the log is - clause 7.
    this.states = new Map();
    // Injected rather than required, for the same reason every other engine here injects: it keeps
    // this instantiable in a plain Node test with no Electron anywhere.
    this.logsFolderFn = () => null;
    this.currentFileFn = () => null;
    // A file the user pointed the grid at from "Change log file"; null = the tailed live log.
    this.logTarget = null;
    // Extra per-day/archive files the user fed in via "Add split files". Tracked so the UI can tell
    // it is looking at a stitched-together multi-file view - where "Trim the live log" makes no
    // sense, because the extra coverage is not coming from the live log. Cleared on a full rebuild.
    this.addedLogPaths = new Set();
    // The reset day/hour the grid's period is measured from. The SAME value logRotation uses -
    // main.js loads one store key and pushes it to both. null hour = lockoutCore's own default.
    this.resetRule = { weekday: 2, hour: 11 };
    this.backfillState = 'idle'; // idle | running | done | failed
    this.lastBackfill = null;
    // Counted, never thrown. See the note at the top about the shared line bus.
    this.errors = 0;
    this.lastError = null;
  }

  setLogsFolderFn(fn) {
    if (typeof fn === 'function') this.logsFolderFn = fn;
  }

  // Which file the live tailer is currently reading. The `'line'` event does not carry it — it
  // emits the bare string — so the character has to be resolved from the watcher's own state at
  // the moment the line arrives.
  setCurrentFileFn(fn) {
    if (typeof fn === 'function') this.currentFileFn = fn;
  }

  // Set from main.js whenever the user changes the reset time (Lockouts page or Setup). Emits
  // `changed` so the grid re-broadcasts under the new boundary.
  setResetRule(rule) {
    const weekday = Number.isInteger(rule && rule.weekday) ? ((rule.weekday % 7) + 7) % 7 : this.resetRule.weekday;
    const hour = Number.isInteger(rule && rule.hour) ? Math.min(23, Math.max(0, rule.hour)) : this.resetRule.hour;
    this.resetRule = { weekday, hour };
    this.emit('changed');
    return this.resetRule;
  }

  /**
   * A cheap fingerprint of everything the projections actually read.
   *
   * NOT `state.events.length`, which is the obvious choice and is WRONG. `events` is capped at
   * 5,000 and trimmed with push-then-shift, so once it is full the length never changes again -
   * and it IS full after a backfill of the owner's corpus, measured. Change detection built on it
   * goes permanently silent at exactly the moment the app has finished loading, which is to say
   * the live grid would never update again. (A separate adapter module built alongside this one
   * had the same shape and the same latent bug; its owner was told.)
   *
   * These five are the collections `project` and `projectGrid` read. seenCount can go DOWN when
   * the dedupe index is pruned, which is still a change and still wants a redraw.
   */
  _signature(state) {
    return (
      state.kills.length + ':' + state.requests.length + ':' + state.grants.length + ':' +
      Object.keys(state.tasks).length + ':' + Object.keys(state.instances).length + ':' +
      state.seenCount
    );
  }

  _stateFor(character) {
    if (!this.states.has(character)) this.states.set(character, core.createState(character));
    return this.states.get(character);
  }

  /**
   * One live line.
   *
   * Silently ignores anything it cannot attribute to a character. That is deliberate: the
   * alternative is guessing which character a line belongs to, and a lockout credited to the wrong
   * character is the same class of error as the four-second bracket that made per-character state
   * necessary in the first place.
   */
  handleLine(line) {
    try {
      const file = this.currentFileFn();
      if (!file) return;
      const character = core.characterFromLogFilename(path.basename(file));
      if (!character) return;
      const state = this._stateFor(character);
      const before = this._signature(state);
      core.applyLine(state, line);
      if (this._signature(state) !== before) this.emit('changed');
    } catch (err) {
      this._note(err);
    }
  }

  _note(err) {
    this.errors += 1;
    this.lastError = err && err.message ? err.message : String(err);
  }

  // The current lockout week's reset boundary, as an absolute instant. Same computation
  // getProjection() uses for `boundaryCivil` - kept in sync via this.resetRule.
  _weekCutMs(now = Date.now()) {
    return easternResetBefore(now, this.resetRule.weekday, this.resetRule.hour);
  }

  // Seek to the byte offset where the current lockout week begins in `file`, so a months-old log
  // is not re-parsed on every backfill. Backward scan, touches ~one week of the file whatever its
  // total size. Returns 0 (read whole file - it is all this week, or the scan couldn't place the
  // boundary) on any error, so a scan failure just means "read it all", never "read nothing".
  //
  // Only bothered for a file large enough that reading it whole would actually cost something -
  // below the threshold the seek's own open+scan is more work than just streaming it, and a small
  // log is by definition already close to just this week. (This also keeps test fixtures, which
  // are a few hundred bytes of a fixed historical date, reading whole rather than being
  // date-scoped against the real clock.)
  _weekStartOffset(file) {
    let fd;
    try {
      const size = fs.statSync(file).size;
      if (size <= SEEK_WHEN_LARGER_THAN) return 0;
      fd = fs.openSync(file, 'r');
      const off = findWeekStartOffset(fd, size, this._weekCutMs());
      return typeof off === 'number' && off >= 0 && off <= size ? off : 0;
    } catch {
      return 0;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  /**
   * Read a log file into its character's lockout state.
   *
   * ONLY THE LIVE LOG (or a hand-picked "Change log file"). NOT a folder scan - the per-day
   * `Logs/Split/` files and the `Logs/Archive/` store hold older weeks the grid must not count.
   *
   * The grid answers "what have I completed THIS lockout week", so backfill only needs this week's
   * lines. `capToWeek` seeks to the current reset boundary (findWeekStartOffset, a ~one-week
   * backward scan) and streams from there - this is what lets the weekly archive be OFF by default
   * without a months-old log dragging every startup and rescan to a crawl. `lockoutCore` also
   * scopes kills to the period from `now` itself, so an over-read is corrected there anyway; the
   * cap is purely about not parsing bytes that can't matter.
   *
   * addLogs() ("Add log files" - the manual gap-fill) does NOT cap: those files are chosen
   * precisely to cover a stretch the live log is missing.
   *
   * STREAMED - `readline` yields between chunks so the UI stays alive. Idempotent by the core's
   * own contract (clause 6), so overlapping the live tailer or an earlier read is safe. Returns
   * the line count, or -1 if the filename carried no character.
   */
  async _readInto(file, { capToWeek = false } = {}) {
    const character = core.characterFromLogFilename(path.basename(file));
    if (!character) return -1;
    const state = this._stateFor(character);
    let lines = 0;
    try {
      const start = capToWeek ? this._weekStartOffset(file) : 0;
      // crlfDelay: Infinity - EverQuest logs are CRLF but a copy or an editor can leave LF.
      const rl = readline.createInterface({ input: fs.createReadStream(file, { start }), crlfDelay: Infinity });
      for await (const line of rl) { lines += 1; core.applyLine(state, line); }
    } catch (err) {
      this._note(err); // a locked or half-written log is ordinary
    }
    return lines;
  }

  // Set from the Lockouts page's "Change log file". When set, backfill reads THIS file instead of
  // the tailed one - for looking at another character, or a log kept elsewhere. main.js persists it.
  setLogTarget(filePath) {
    this.logTarget = filePath || null;
    return this.logTarget;
  }

  // "Add log files" from the Lockouts page: feed extra files (usually the Split/ files that cover a
  // gap) into the existing grid without changing the live log or re-running the whole backfill.
  async addLogs(paths) {
    if (this._rebuilding) await this._rebuilding; // do not write states mid-rebuild
    let lines = 0;
    let read = 0;
    for (const p of paths || []) {
      if (!p || !fs.existsSync(p)) continue;
      const n = await this._readInto(p);
      if (n >= 0) { lines += n; read += 1; this.addedLogPaths.add(path.resolve(p)); }
    }
    if (read) this.emit('changed');
    return { ok: true, files: read, lines };
  }

  // Clear state and read from scratch, under a lock so two rapid "Change log file" / "Refresh" /
  // page-open calls cannot interleave `states.clear()` with a running read. Handlers call this
  // instead of doing the clear + backfill themselves.
  async rebuild() {
    if (this._rebuilding) return this._rebuilding;
    this._rebuilding = (async () => {
      this.states.clear();
      this.addedLogPaths.clear();
      this.backfillState = 'idle';
      return this.backfill();
    })();
    try {
      return await this._rebuilding;
    } finally {
      this._rebuilding = null;
    }
  }

  async backfill() {
    if (this.backfillState === 'running') return { ok: false, reason: 'already running' };

    // A stored "Change log file" target that has since been deleted/moved must not wedge the grid.
    // Drop it and fall back to the live log; the host clears the persisted value.
    let targetCleared = false;
    if (this.logTarget && !fs.existsSync(this.logTarget)) {
      this.logTarget = null;
      targetCleared = true;
    }
    const file = this.logTarget || this.currentFileFn();
    if (!file) {
      this.backfillState = 'failed';
      this.lastError = 'no live log file';
      this.emit('backfillChanged', this.getStatus());
      return { ok: false, reason: 'no live log file', targetCleared };
    }

    this.backfillState = 'running';
    this.emit('backfillChanged', this.getStatus());
    const started = Date.now();

    const lines = Math.max(0, await this._readInto(file, { capToWeek: true }));
    const read = core.characterFromLogFilename(path.basename(file)) ? 1 : 0;

    this.backfillState = 'done';
    this.lastBackfill = {
      at: new Date().toISOString(),
      files: read,
      lines,
      ms: Date.now() - started,
      characters: [...this.states.keys()],
    };
    this.emit('backfillChanged', this.getStatus());
    this.emit('changed');
    return { ok: true, ...this.lastBackfill, targetCleared };
  }

  getStatus() {
    return {
      backfill: this.backfillState,
      lastBackfill: this.lastBackfill,
      characters: [...this.states.keys()],
      logTarget: this.logTarget || null,
      extraLogs: this.addedLogPaths.size,
      errors: this.errors,
      lastError: this.lastError,
    };
  }

  /**
   * What the UI renders, per character.
   *
   * `now` is supplied rather than read inside, so a test can drive it and so the projection is a
   * pure function of (state, now) exactly as the core promises.
   */
  getProjection(now = civilNow()) {
    // The reset is a US Eastern wall-clock time and moves itself across the daylight-saving change
    // (easternReset.js). Resolve this week's boundary here, as an absolute instant, then hand
    // lockoutCore its LOCAL civil components - the same frame the kill stamps are parsed in - so
    // the grid is right whatever zone this machine is on.
    const nowMs = new Date(now.year, now.month - 1, now.day, now.hour, now.minute, now.second).getTime();
    const toCivil = (ms) => {
      const d = new Date(ms);
      return {
        year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
        hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
      };
    };
    const boundaryMs = easternResetBefore(nowMs, this.resetRule.weekday, this.resetRule.hour);
    const boundaryCivil = toCivil(boundaryMs);
    const periodEndCivil = toCivil(easternResetAfter(nowMs, this.resetRule.weekday, this.resetRule.hour));
    // `firstSeen` is a civilOf() integer - local components run through Date.UTC. Compare like
    // for like: the boundary's local components through the same Date.UTC.
    const b = new Date(boundaryMs);
    const boundaryCivilOf = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate(), b.getHours(), b.getMinutes(), b.getSeconds());

    const out = [];
    for (const [character, state] of this.states) {
      try {
        // BOTH projections. `project` is the task-level view; `projectGrid` is the per-boss,
        // per-tier grid with the cell states, and it is a separate call rather than part of
        // `project` - a UI that rendered only the former would silently lose every "not looked".
        out.push({
          character,
          // The log's OWN COVERAGE reaches back before this week (any stamped line, kill or not) -
          // the "Trim to this week" tool applies. `spans` is fed by every stamped line, unlike
          // `firstSeen` which only moves on a modelled event.
          spansPriorWeek: Array.isArray(state.spans) && state.spans.length > 0
            && state.spans.reduce((m, sp) => (sp.from < m ? sp.from : m), Infinity) < boundaryCivilOf,
          projection: core.project(state, now),
          // ALWAYS pass boundaryCivil - it is the Eastern reset resolved to this machine's local
          // wall-clock frame, the same frame the kill stamps are parsed in. lockoutCore's
          // resetWeekday/resetHour math path (kept for its own tests) computes the boundary in the
          // `now` frame, which is only correct on a machine whose clock IS US Eastern. Production
          // must never rely on it - it is passed here for display, not for the boundary.
          grid: core.projectGrid(state, now, {
            resetWeekday: this.resetRule.weekday,
            resetHour: this.resetRule.hour,
            boundaryCivil,
            periodEndCivil,
          }),
        });
      } catch (err) {
        this._note(err);
        out.push({ character, projection: null, error: this.lastError });
      }
    }
    return { status: this.getStatus(), characters: out };
  }
}

module.exports = { LockoutService, civilNow, LOG_FILE_PATTERN };
