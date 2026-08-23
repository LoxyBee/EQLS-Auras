const { EventEmitter } = require('events');
const {
  stripTimestamp,
  matchCastBegin,
  matchSingingBegin,
  matchOwnInterrupt,
  stripRankSuffix,
} = require('./buffParser');

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
// Note 9. Whether this definition is governed by an all-of list. An empty array is deliberately
// NOT an all-of: a timer whose conditions have all been deleted should fall back to its plain
// trigger text rather than become a timer that can never fire and gives no sign why.
function hasAllOf(timer) {
  return Array.isArray(timer.allOf) && timer.allOf.length > 0;
}

// How long a line part counts as satisfied once seen. Per part, never shared - see the comment on
// _isPartSatisfied for why there is no global window. Thirty seconds is only the default for a
// part created without one; clamped because a share code can carry a number this app never wrote.
const DEFAULT_PART_HOLD_SEC = 30;
const MAX_PART_HOLD_SEC = 3600;

function partHoldSec(part) {
  const raw = part.holdSec;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return DEFAULT_PART_HOLD_SEC;
  return Math.min(MAX_PART_HOLD_SEC, Math.round(raw));
}

// The same three match modes an ordinary trigger has, so a part is not a second, subtly different
// kind of trigger that people have to learn separately.
function lineMatchesPart(part, lowerLine, castSpell) {
  const trigger = String(part.triggerText || '').toLowerCase();
  if (!trigger) return false;
  if (part.triggerMatch === 'castOf') return castSpell !== null && castSpell.toLowerCase() === trigger;
  if (part.triggerMatch === 'contains') return lowerLine.includes(trigger);
  return trigger === lowerLine;
}

class CustomTimerEngine extends EventEmitter {
  constructor() {
    super();
    this.activeTimers = new Map(); // lowercased name -> { name, durationSec, expiresAt, endedText }
    this.getWidgetsFn = () => [];
    this.iconUrlFn = () => null;
    // Note 9's all-of. "<timer id>#<part index>" -> the moment that part stops counting as
    // satisfied. Only LINE parts appear here; a zone part is asked about rather than remembered,
    // because where you are is already tracked elsewhere and a second copy of it could go stale.
    this.partSatisfiedUntil = new Map();
    this.getCurrentZoneFn = () => null;
    this.tickTimer = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  setGetWidgetsFn(fn) {
    this.getWidgetsFn = fn;
  }

  // Note 9. Where the player is, for an all-of part that asks about a zone. Injected for the same
  // reason as the two below it - widgetManager pulls in Electron, and this engine has to stay
  // instantiable in a plain Node test.
  setCurrentZoneFn(fn) {
    if (typeof fn === 'function') this.getCurrentZoneFn = fn;
  }

  // fn(castName) => the roster's name for that cast, or null.
  //
  // Needed only by the 'castOf' trigger mode below. Injected rather than requiring buffStore, so
  // this engine stays instantiable in a plain Node test - same reason as setGetWidgetsFn above.
  // Without it, 'castOf' falls back to stripping any trailing numeral as a rank.
  //
  // buffStore.getByName already does exactly the right thing and I wrote a worse copy of it first:
  // it tries the exact name, and only then falls back to the rank-stripped one. That ordering is
  // what tells "Promised Renewal VII" (a mote tier of Promised Renewal) apart from "Yaulp III" (a
  // different spell that happens to end in a numeral), and there are ten of the latter kind.
  setResolveSpellFn(fn) {
    this.resolveSpellFn = fn;
  }

  _resolveCastName(castName) {
    if (this.resolveSpellFn) return this.resolveSpellFn(castName) || castName;
    return stripRankSuffix(castName);
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
  // The spell this line is the player starting to cast, or null. Pulled out of
  // _findTriggerMatches so the all-of path uses the same answer rather than a second copy of the
  // question - the two must never disagree about what a castOf part means.
  _castSpellFor(strippedLine) {
    const castName = matchCastBegin(strippedLine) || matchSingingBegin(strippedLine);
    return castName ? this._resolveCastName(castName) : null;
  }

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
    // Parsed once, not per timer. Null for any line that is not the player starting a cast.
    const castSpell = this._castSpellFor(strippedLine);
    const matches = [];
    for (const widget of this.getWidgetsFn()) {
      for (const timer of widget.customTimers || []) {
        // Note 9. A timer with an all-of list is governed by that list and nothing else. Letting
        // its plain triggerText fire it too would mean the extra conditions could be skipped by
        // the very line they were added to qualify.
        if (hasAllOf(timer)) continue;
        if (!timer.triggerText) continue;
        const trigger = timer.triggerText.toLowerCase();
        // Exact by default, and that default is why this stayed exact for so long: a trigger of
        // "hi" matching every line with "hi" anywhere in it is a timer that fires constantly.
        //
        // "contains" exists for the lines the game writes with a name in the middle of them -
        // "Orc centurion resisted your Mesmerize!" is never going to match a fixed string, because
        // the mob's name is part of it. Opt-in per timer, so nothing already set up changes.
        let hit;
        if (timer.triggerMatch === 'castOf') {
          // triggerText is a SPELL NAME here, not a line. Purpose-built for cooldowns, because
          // neither of the other two modes can do this job: exact never matches a ranked cast, and
          // contains on "You begin casting Fire" also matches Fire Bolt, Fire Flux and four more.
          // Thirteen spells in the roster are a prefix of another one.
          hit = castSpell !== null && castSpell.toLowerCase() === trigger;
        } else if (timer.triggerMatch === 'contains') {
          hit = lowerLine.includes(trigger);
        } else {
          hit = trigger === lowerLine;
        }
        if (hit) matches.push(timer);
      }
    }
    return matches;
  }

  /**
   * Note 9's all-of, built to the shape Shara settled on 23 August.
   *
   * "the time window should be whatever each individual trigger has. this kind of functionality
   * will primarily be used for 'if in this zone (no duration check), and this thing happens', so
   * limiting it to checks happen within a set time frame is not something i want."
   *
   * So there is NO shared window. Each part carries its own, and the two kinds of part answer
   * "am I currently true?" differently:
   *
   *   line - true for holdSec after the line was last seen. Its own clock, nobody else's.
   *   zone - true while you are standing there. No clock at all; being somewhere does not expire.
   *
   * And nothing appears on screen until every part is true at once - her answer to the earlier
   * question was "nothing shown when half is done, only show when both are active. if one is
   * active, it should be invisible to the player until the other happens." A half-satisfied
   * all-of is therefore state and not a tile.
   */
  _isPartSatisfied(timerId, part, index, now) {
    if (part && part.kind === 'zone') {
      const here = this.getCurrentZoneFn();
      // No zone known yet is NOT the same as being in the wrong one. The app often cannot tell
      // where you are - it learns from a zone line, and one only arrives when you cross. Treating
      // unknown as false would make a zone-gated timer silently dead for a whole session started
      // in the wrong place; the same call the rest of the app makes on this question.
      if (!here) return true;
      return String(part.zone || '').toLowerCase() === here.toLowerCase();
    }
    const until = this.partSatisfiedUntil.get(`${timerId}#${index}`);
    return until !== undefined && until > now;
  }

  // Marks the LINE parts this log line satisfies. Separate from the check above so that seeing a
  // line and asking whether the whole condition holds stay two different questions - a part can be
  // re-satisfied by a line that does not complete the set, which is the ordinary case.
  _markSatisfiedParts(strippedLine, lowerLine, castSpell, now) {
    for (const widget of this.getWidgetsFn()) {
      for (const timer of widget.customTimers || []) {
        if (!hasAllOf(timer)) continue;
        timer.allOf.forEach((part, index) => {
          if (!part || part.kind === 'zone') return;
          if (!part.triggerText) return;
          if (!lineMatchesPart(part, lowerLine, castSpell)) return;
          const holdSec = partHoldSec(part);
          this.partSatisfiedUntil.set(`${timer.id}#${index}`, now + holdSec * 1000);
        });
      }
    }
  }

  // Every all-of timer whose parts are all true right now.
  _findSatisfiedAllOf(now) {
    const ready = [];
    for (const widget of this.getWidgetsFn()) {
      for (const timer of widget.customTimers || []) {
        if (!hasAllOf(timer)) continue;
        const all = timer.allOf.every((part, index) => this._isPartSatisfied(timer.id, part, index, now));
        if (all) ready.push(timer);
      }
    }
    return ready;
  }

  // Once it has fired, the line parts start again from nothing. Without this the timer would
  // re-fire on every subsequent line for as long as the parts happened to still hold - and a zone
  // part holds indefinitely, so "in this zone AND this happened" would retrigger forever.
  _clearLineParts(timer) {
    timer.allOf.forEach((part, index) => {
      if (part && part.kind === 'zone') return;
      this.partSatisfiedUntil.delete(`${timer.id}#${index}`);
    });
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

    // A cast that never finished starts no recast clock. Only 'castOf' timers are cancelled: they
    // are the ones started by a cast line, so they are the only ones that can be wrong about this.
    // A timer the user built by hand out of arbitrary text is left alone, because nothing here
    // knows what its trigger meant.
    //
    // 16% of the owner's casts are interrupted, so a cooldown that ignored this would regularly
    // sit on screen claiming a spell was unavailable when it was ready to cast - which is worse
    // than showing nothing, because it is the answer she would act on.
    const interrupted = matchOwnInterrupt(line);
    if (interrupted) {
      const spell = this._resolveCastName(interrupted).toLowerCase();
      let cancelled = false;
      for (const [key, timer] of this.activeTimers) {
        if (timer.triggerMatch !== 'castOf') continue;
        if (String(timer.triggerText || '').toLowerCase() !== spell) continue;
        this.activeTimers.delete(key);
        cancelled = true;
      }
      if (cancelled) this.emit('activeChanged', this.getActive());
    }

    // Checked unconditionally, not "else" - a line ending one timer
    // shouldn't stop it from also starting a different one (or restarting
    // the same one) if it happens to match a trigger too.
    // Note 9. Marked first, then evaluated, so a single line can satisfy the last outstanding part
    // and fire the timer in the same pass rather than waiting for the next line to notice.
    const now = Date.now();
    // The STRIPPED line, lowercased - the same text _findTriggerMatches compares against. The
    // timestamped one is right there in scope and would silently break every exact-match part,
    // since no trigger text anyone types begins with "[wed aug 19 ...]".
    this._markSatisfiedParts(stripped, stripped.toLowerCase(), this._castSpellFor(stripped), now);
    const ready = this._findSatisfiedAllOf(now);

    const matches = this._findTriggerMatches(stripped).concat(ready);
    if (matches.length === 0) return;
    const readySet = new Set(ready);
    // Keyed by the definition's own id, not its name - two definitions are
    // allowed to share a display name (e.g. same trigger text, different
    // icons, meant to both show at once), and keying by name would let the
    // second activation silently overwrite the first in the Map.
    for (const match of matches) {
      // Note 10's Risk, and it is real: this overwrites an active entry whenever the trigger text
      // is seen again. For a plain timer that is right - seeing the line again means it happened
      // again. For one in its COOLDOWN phase it is wrong twice over: the ability is not available,
      // so the line cannot mean it was used, and restarting would hide a cooldown the player is
      // waiting on behind a fresh duration.
      //
      // The line is far likelier to be an echo, a second target, or somebody else's. Ignored.
      const running = this.activeTimers.get(match.id);
      if (running && running.phase === 'cooldown') continue;
      // Note 9. An all-of that has fired hands its parts back empty, so the next firing needs the
      // whole condition to come true again rather than riding on a zone part that never lapses.
      if (readySet.has(match)) this._clearLineParts(match);

      this.activeTimers.set(match.id, {
        id: match.id,
        name: match.name,
        durationSec: match.durationSec,
        expiresAt: Date.now() + match.durationSec * 1000,
        endedText: match.endedText || null,
        // Carried through so an interrupt can find and cancel this again. Without them the check
        // above has an id and a name and no way to tell what kind of timer it is looking at.
        triggerMatch: match.triggerMatch || undefined,
        triggerText: match.triggerText || undefined,
        // Note 10. 'duration' or 'cooldown'. Always starts as 'duration' - even a timer whose only
        // useful number is the cooldown runs its duration first, because that is what the trigger
        // line reported. cooldownSec rides along so _tick does not have to look the definition up
        // again, and so a restored snapshot can transition without one.
        phase: 'duration',
        cooldownSec: match.cooldownSec || 0,
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
      if (timer.expiresAt > now) continue;

      // Note 10. A timer with a cooldown does not end when its duration does - it rolls straight
      // into counting down to when the ability is ready again. Two phases, one tile.
      //
      // Only from 'duration', never from 'cooldown', or a timer with a cooldown could never end.
      if (timer.phase === 'duration' && timer.cooldownSec > 0) {
        timer.phase = 'cooldown';
        timer.expiresAt = now + timer.cooldownSec * 1000;
        continue;
      }
      this.activeTimers.delete(key);
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
          // Note 10: "if the tile doesn't visibly say which phase it is in, the number on screen is
          // actively misleading". Sent so the overlay can show the difference; nothing here decides
          // what that looks like.
          phase: t.phase || 'duration',
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
