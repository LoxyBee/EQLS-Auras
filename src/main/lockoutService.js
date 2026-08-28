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
// WHY A FOLDER SCAN AND NOT THE WATCHER'S FILE
//
// `logWatcher` follows whichever `eqlog_*.txt` changed most recently, which is exactly right for
// buffs and wrong here. Session D measured the reason: the two halves of the only reset measurement
// they have live in DIFFERENT FILES — three task grants on 10 August in one, three more on the 11th
// in another. Read only the newest and you see three grants of three different tasks, no repeat,
// and the module correctly reports "not recorded" having been shown half the evidence.
//
// And it lands on this app twice over, which they could not have known: `logSplitter.js` writes
// per-day files BY DESIGN, continuously. She does not merely risk a log that rolls over — her own
// splitter manufactures the split every day.
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

// Same shape logWatcher accepts, so a file this service reads is a file that service would watch.
const LOG_FILE_PATTERN = /^eqlog_.+\.txt$/i;

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
      const before = state.events.length;
      core.applyLine(state, line);
      if (state.events.length !== before) this.emit('changed');
    } catch (err) {
      this._note(err);
    }
  }

  _note(err) {
    this.errors += 1;
    this.lastError = err && err.message ? err.message : String(err);
  }

  /**
   * Read the whole Logs folder once.
   *
   * STREAMED, not read whole. Session D measured 434 MB across 15 files in 7.0 seconds, and one of
   * those files is 112 MB — `readFileSync` on that would spike memory and block the main process
   * with the window open. `readline` over a stream yields between chunks and the UI stays alive.
   *
   * Idempotent by the module's own contract, so running it twice is safe and running it after the
   * live tailer has already seen some of the same lines is safe. That is clause 6 doing real work
   * rather than being a nice property: a backfill ALWAYS overlaps the live stream.
   */
  async backfill() {
    if (this.backfillState === 'running') return { ok: false, reason: 'already running' };
    const folder = this.logsFolderFn();
    if (!folder) {
      this.backfillState = 'failed';
      this.lastError = 'no logs folder configured';
      this.emit('backfillChanged', this.getStatus());
      return { ok: false, reason: 'no logs folder configured' };
    }

    this.backfillState = 'running';
    this.emit('backfillChanged', this.getStatus());
    const started = Date.now();
    let files = [];
    try {
      files = fs
        .readdirSync(folder)
        .filter((n) => LOG_FILE_PATTERN.test(n))
        .map((n) => path.join(folder, n));
    } catch (err) {
      this._note(err);
      this.backfillState = 'failed';
      this.emit('backfillChanged', this.getStatus());
      return { ok: false, reason: `cannot read ${folder}` };
    }

    let lines = 0;
    let read = 0;
    for (const file of files) {
      const character = core.characterFromLogFilename(path.basename(file));
      if (!character) continue;
      const state = this._stateFor(character);
      try {
        // crlfDelay: Infinity is not decoration. The corpus is MIXED - Session D measured 11 CRLF
        // files and 4 LF-only, having first got this wrong by generalising from an all-CRLF
        // sample. This handles both without the parser needing to care.
        const rl = readline.createInterface({
          input: fs.createReadStream(file),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          lines += 1;
          core.applyLine(state, line);
        }
        read += 1;
      } catch (err) {
        // One unreadable file must not abandon the rest. A locked or half-written log is ordinary.
        this._note(err);
      }
    }

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
    return { ok: true, ...this.lastBackfill };
  }

  getStatus() {
    return {
      backfill: this.backfillState,
      lastBackfill: this.lastBackfill,
      characters: [...this.states.keys()],
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
    const out = [];
    for (const [character, state] of this.states) {
      try {
        // BOTH projections. `project` is the task-level view; `projectGrid` is the per-boss,
        // per-tier grid with the cell states, and it is a separate call rather than part of
        // `project` - a UI that rendered only the former would silently lose every "not looked".
        out.push({
          character,
          projection: core.project(state, now),
          grid: core.projectGrid(state, now),
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
