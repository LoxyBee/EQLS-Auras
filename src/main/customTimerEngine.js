const { EventEmitter } = require('events');
const { stripTimestamp } = require('./buffParser');

const TICK_INTERVAL_MS = 1000;

// Much simpler sibling to BuffEngine, for user-defined timers keyed off
// arbitrary log text rather than mined spell data - no ambiguity tiers, no
// spellbook/burst/others-tracking, since the user already picked text they
// know is unique to what they're timing. Landing/renewal/expiry mechanics
// mirror BuffEngine's activeBuffs handling on purpose (same proven
// behavior), just without everything specific to buffs.
//
// Definitions are NOT a shared pool - each is private to whichever widget
// created it (widgetStore.js's per-widget customTimers array), so this
// engine reads directly from live widget configs via getWidgetsFn rather
// than owning its own store. Injected (not required('./widgetManager')
// directly) for the same reason BuffEngine injects setSpellbookCheckFn -
// widgetManager pulls in Electron's screen/BrowserWindow, which would
// break instantiating this engine in a plain Node test script.
class CustomTimerEngine extends EventEmitter {
  constructor() {
    super();
    this.activeTimers = new Map(); // lowercased name -> { name, durationSec, expiresAt, endedText }
    this.getWidgetsFn = () => [];
    this.iconUrlFn = () => null;
    this.tickTimer = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  setGetWidgetsFn(fn) {
    this.getWidgetsFn = fn;
  }

  // Same DI reasoning as BuffEngine.setIconUrlFn - lets iconService control
  // which icon set URLs point at without this engine needing to know
  // anything about icon sets itself.
  setIconUrlFn(fn) {
    this.iconUrlFn = fn;
  }

  stop() {
    clearInterval(this.tickTimer);
  }

  // Rebuilt fresh on every line rather than cached - trivially cheap given
  // realistic widget/timer counts, and avoids needing to invalidate a
  // cache on every possible widget CRUD path.
  //
  // Returns every definition whose trigger text matches, not just the
  // first - two definitions (even with the same display name, e.g. the
  // same trigger text given two different icons) both count as
  // independently activated. Returning only the first match here used to
  // mean the second one was never even considered.
  _findTriggerMatches(strippedLine) {
    // Case-insensitive - unlike every other exact-text match in this app
    // (landing text, ended text, etc.), a custom timer's trigger text is
    // very often literally something the user typed in-game (a chat
    // message), and there's no reason "Hi" typed into the widget's setup
    // form shouldn't match "hi" actually typed in the game client at the
    // time, or vice versa. Game-generated text (spell effects, NPC lines)
    // is always consistently cased anyway, so this can't introduce any
    // ambiguity there - it only ever helps the user-typed-chat case.
    const lowerLine = strippedLine.toLowerCase();
    const matches = [];
    for (const widget of this.getWidgetsFn()) {
      for (const timer of widget.customTimers || []) {
        if (!timer.triggerText) continue;
        const trigger = timer.triggerText.toLowerCase();
        // Exact by default, and that default is why this stayed exact for so long: a trigger of
        // "hi" matching every line with "hi" anywhere in it is a timer that fires constantly.
        //
        // "contains" exists for the lines the game writes with a name in the middle of them -
        // "Orc centurion resisted your Mesmerize!" is never going to match a fixed string, because
        // the mob's name is part of it. Opt-in per timer, so nothing already set up changes.
        const hit = timer.triggerMatch === 'contains' ? lowerLine.includes(trigger) : trigger === lowerLine;
        if (hit) matches.push(timer);
      }
    }
    return matches;
  }

  handleLine(line) {
    const stripped = stripTimestamp(line);
    const lowerLine = line.toLowerCase();

    // Ends every currently-active timer whose endedText matches this line,
    // not just the first one found (the old behavior - it deleted one match
    // then returned immediately, so two timers sharing the same "ends on"
    // phrase, e.g. both listening for "bye", needed it said once per timer
    // instead of once total). Active timers all live in one shared Map
    // regardless of which widget defined them, so this already naturally
    // covers "across widgets" too - nothing widget-scoped to fix there.
    let endedAny = false;
    for (const [key, timer] of this.activeTimers) {
      if (timer.endedText && lowerLine.includes(timer.endedText.toLowerCase())) {
        this.activeTimers.delete(key);
        endedAny = true;
      }
    }
    if (endedAny) this.emit('activeChanged', this.getActive());

    // Checked unconditionally, not "else" - a line ending one timer
    // shouldn't stop it from also starting a different one (or restarting
    // the same one) if it happens to match a trigger too.
    const matches = this._findTriggerMatches(stripped);
    if (matches.length === 0) return;
    // Keyed by the definition's own id, not its name - two definitions are
    // allowed to share a display name (e.g. same trigger text, different
    // icons, meant to both show at once), and keying by name would let the
    // second activation silently overwrite the first in the Map.
    for (const match of matches) {
      this.activeTimers.set(match.id, {
        id: match.id,
        name: match.name,
        durationSec: match.durationSec,
        expiresAt: Date.now() + match.durationSec * 1000,
        endedText: match.endedText || null,
      });
    }
    this.emit('activeChanged', this.getActive());
  }

  // See buffEngine.getSnapshotState - raw storage shape, not the display view
  // getActive() returns.
  getSnapshotState() {
    return [...this.activeTimers.values()];
  }

  // Keyed by the definition's own id, same as handleLine - two definitions can
  // legitimately share a name (see the duplicate-timer gotcha in CLAUDE.md),
  // so restoring by name would silently merge them back into one.
  restoreSnapshot(timers = []) {
    for (const timer of timers) {
      if (!timer.id) continue;
      this.activeTimers.set(timer.id, timer);
    }
    if (timers.length) this.emit('activeChanged', this.getActive());
    return timers.length;
  }

  removeActive(id) {
    this.activeTimers.delete(id);
    this.emit('activeChanged', this.getActive());
  }

  _tick() {
    const now = Date.now();
    for (const [key, timer] of this.activeTimers) {
      if (timer.expiresAt <= now) this.activeTimers.delete(key);
    }
    // Unconditional every tick, matching BuffEngine's self-buffs tick - the
    // overlay's countdown text needs a fresh broadcast every second to
    // visibly tick down, not just when a timer actually expires.
    this.emit('activeChanged', this.getActive());
  }

  // Icon looked up live from the current definition (not snapshotted at
  // landing time) - same reasoning as BuffEngine.getActiveBuffs(), so
  // picking a new icon takes effect immediately even on an already-active
  // timer instead of waiting for it to re-land. Looked up by id, not name -
  // two definitions can share a display name but still have their own
  // distinct icon (that's the whole point of allowing duplicate names), so
  // a name-based lookup would show the wrong one (whichever definition
  // happened to be found first) for every instance but the first.
  _findDefinitionById(id) {
    for (const widget of this.getWidgetsFn()) {
      for (const timer of widget.customTimers || []) {
        if (timer.id === id) return timer;
      }
    }
    return null;
  }

  getActive() {
    const now = Date.now();
    return [...this.activeTimers.values()]
      .map((t) => {
        const def = this._findDefinitionById(t.id);
        return {
          id: t.id,
          name: t.name,
          durationSec: t.durationSec,
          remainingSec: Math.max(0, Math.round((t.expiresAt - now) / 1000)),
          showOnOverlay: true,
          // != null, not a truthy check - icon id 0 is a real, pickable icon.
          iconUrl: def?.iconId != null ? this.iconUrlFn(def.iconId) : null,
          isBardSong: false,
        };
      })
      .sort((a, b) => a.remainingSec - b.remainingSec);
  }
}

module.exports = { CustomTimerEngine };
