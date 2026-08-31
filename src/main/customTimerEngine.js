const { EventEmitter } = require('events');
const {
  stripTimestamp,
  matchCastBegin,
  matchSingingBegin,
  matchOwnInterrupt,
  matchZoneChange,
  matchOwnDeath,
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
// How long a trigger counts as "seen" for AND-combine purposes once it matches a line, if a
// widget doesn't carry its own andWindowSec (a share code from before this setting existed, or a
// stray call from a test that builds a widget object by hand). Reported live 25 Aug: "the window
// fo rboth triggers is 30 seconds?" - confirmed yes, and it was this fixed constant with no way to
// change it. Now a real per-widget field (see widgetStore.js's andWindowSec) - this is only the
// fallback for a widget that predates the field, not the number itself any more.
const DEFAULT_AND_WINDOW_MS = 30 * 1000;

// Reverse detection (widget.reverseDetection - CLAUDE.md's "negative/reverse triggers"). Every
// ordinary trigger is OFF until it fires, then ON for durationSec. Reverse is the mirror image: ON
// by default, with nothing in the log required to put it there, then OFF for durationSec the
// moment it DOES fire, then back ON automatically.
//
// WHOLE-AURA, not per-trigger - it's a setting on the widget (widgetStore.js's own comment has the
// reasoning: the user's ask was one checkbox next to the AND/OR combine-mode control, not a flag
// set on each individual trigger separately). Concretely this means it rides on whatever
// triggerCombineMode already decides "fires" for that widget:
//   - independent (default): each trigger is its own instance, same as ordinarily - reverse just
//     flips each one's own default state and its own hide-on-fire behaviour.
//   - and: the combo tile stays ON until every trigger in the set has been seen, same as the
//     combo's ordinary "fires once all are seen" rule - then goes OFF for durationSec. This is the
//     motivating case: a "ready" tile that only goes away once two separate things have both
//     happened, without touching either trigger's own definition.
//   - or: the combo tile goes OFF the moment any one of its triggers fires, same as the combo's
//     ordinary "any one fires it" rule.
//
// "OFF until triggered, deleted from activeTimers when it ends" already fits an ordinary trigger's
// whole lifecycle - there's no state to hold for "not yet triggered" because absence from the map
// already means that. Reverse's DEFAULT state is the one every ordinary trigger treats as
// nothing-to-track, so it needed a real design decision, not a flag reusing the existing shape:
//
//   - activeTimers only ever holds a reverse-mode key (a definition's own id in independent mode,
//     or the widget's `and:<widgetId>`/`or:<widgetId>` combo key) while it is HIDING -
//     phase:'hidden', keyed and shaped exactly like an ordinary phase:'duration' entry (see
//     handleLine), with the same expiresAt-driven _tick() cleanup. Nothing new to manage there.
//   - The default-visible state is never written anywhere. getActive() synthesizes it fresh on
//     every call: any reverse-mode widget's key(s) NOT currently in the 'hidden' set just ARE
//     visible, an infinite tile (remainingSec: null, same shape BuffEngine already uses for
//     infiniteDuration buffs) with no expiry of its own. Same reasoning as overlay.js's
//     alwaysOnEntry() and BuffEngine's live icon lookups - computing the answer beats persisting
//     and invalidating it, and it means restart/restoreSnapshot need nothing special either: a key
//     currently hiding has a real activeTimers entry that snapshots and restores like any other
//     timer, and one that isn't hiding has no entry to snapshot at all - it simply reappears
//     visible on the next getActive() call once the widget configs are available again.

class CustomTimerEngine extends EventEmitter {
  constructor() {
    super();
    this.activeTimers = new Map(); // lowercased name -> { name, durationSec, expiresAt, endedText }
    this.getWidgetsFn = () => [];
    this.iconUrlFn = () => null;
    // triggerCombineMode:'and' bookkeeping - timer id -> the moment it stops counting as "recently
    // seen". Not per-widget, because two widgets never share a timer definition (see the field's
    // own comment in widgetStore.js).
    this.timerSeenUntil = new Map();
    // Rebuilt fresh on every _findTriggerMatches call - see that method's own comment. Only ever
    // read immediately afterward within the same handleLine, but initialized here too so nothing
    // before the first real line ever reads a bare undefined.
    this.lastCapturedTextByTimerId = new Map();
    this.lastCapturedPrefixByTimerId = new Map();
    // Zone-trigger state. This engine keeps its own copy rather than reading widgetManager's
    // (which already tracks the same thing for zone-gating) for the same DI reasoning as
    // getWidgetsFn/setIconUrlFn - widgetManager pulls in Electron's screen/BrowserWindow, which
    // would break instantiating this engine in a plain Node test. Starts null and is never
    // backfilled from history (the app never replays the log, same as everywhere else in this
    // codebase), so the very first zone-change line seen after launch can only ever fire an
    // "entering" trigger, never a "leaving" one - there is nothing to have genuinely left yet.
    this.currentZone = null;
    this.debugLogFn = null; // (message) => void - see setDebugLogFn, mirrors BuffEngine's own
    this.tickTimer = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  setGetWidgetsFn(fn) {
    this.getWidgetsFn = fn;
  }

  // Startup zone recovery (see logZonePeek.js): establish the current zone WITHOUT firing any
  // zoneEnter trigger - the player entered it before the app was watching, so treating it as a
  // fresh entry now would be a false trigger. It only seeds currentZone so the first real zoneLeave
  // after a restart knows what was left. No-op once a zone line has already been seen.
  seedZone(zone) {
    if (zone && this.currentZone === null) this.currentZone = zone;
  }

  // Same DI shape as BuffEngine.setDebugLogFn - optional, so every existing test that never wires
  // one keeps working with _debugLog as a silent no-op. Reported live 25 Aug: "should there be a
  // debug log of every aura that is fired/loaded/ended... so that there actually exists a way for
  // you to tell the output from my inputs?" BuffEngine already had this (LANDED/IGNORED/etc.) for
  // self/ally buffs; custom triggers had none at all, which is exactly the blind spot the last two
  // live-reported bugs (OR-mode filtering, {mob} resolution) both came out of.
  setDebugLogFn(fn) {
    this.debugLogFn = fn;
  }

  _debugLog(message) {
    if (this.debugLogFn) this.debugLogFn(message);
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
  // The spell this line is the player starting to cast, or null.
  _castSpellFor(strippedLine) {
    const castName = matchCastBegin(strippedLine) || matchSingingBegin(strippedLine);
    return castName ? this._resolveCastName(castName) : null;
  }

  // Reported live 24 Aug: "resist text should say 'resisted your [skill name]'" - a "contains"
  // trigger like "resisted your " never carries the actual spell name anywhere, because the
  // match only proves the fixed substring is somewhere in the line, not what came after it. This
  // captures that remainder (the ORIGINAL-cased line, not the lowercased one used for matching, so
  // "Denon's Dissension" doesn't come out lowercased) into a side map keyed by timer id, rebuilt
  // fresh every call the same way the matches themselves are - handleLine reads it right after
  // calling this, before anything else could go stale. Only 'contains' mode produces one: 'exact'
  // has nothing left over by definition, and 'castOf' already has the real spell name as castSpell.
  // rawLine is needed alongside strippedLine purely for matchZoneChange, which is anchored on the
  // timestamp prefix by design (see its own comment in buffParser.js on why an unanchored match
  // let a stranger's chat message silently move the app to a zone the player was never in).
  _findTriggerMatches(rawLine, strippedLine) {
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
    // Zone transition, if this line reports one - parsed once, same reasoning as castSpell above.
    // matchZoneChange only ever names the NEW zone, so the zone being LEFT has to come from this
    // engine's own currentZone before it's overwritten. zoneLeft stays null on the very first zone
    // change this engine ever sees (nothing was tracked yet to have left).
    const zoneNow = matchZoneChange(rawLine);
    let zoneEntered = null;
    let zoneLeft = null;
    if (zoneNow && zoneNow !== this.currentZone) {
      zoneLeft = this.currentZone;
      zoneEntered = zoneNow;
      this.currentZone = zoneNow;
    }
    // { widgetId, timer }[] - widgetId travels alongside each match so handleLine can group by
    // widget without a second pass over getWidgetsFn(), and so it can look the owning widget's
    // triggerCombineMode up.
    const matches = [];
    this.lastCapturedTextByTimerId = new Map();
    // Reported live 25 Aug: "{mob} did not print mob name" on "Your {spell} was resisted by
    // {mob}". {mob}/{caster} in overlay.js read buff.allyName, which a customTimer buff never has
    // - there is no ally-landing infrastructure behind a plain trigger. "An imp protector resisted
    // your Denon's Dissension!" carries the mob's name BEFORE the matched text, not after it, so it
    // needs its own capture the same shape as capturedText's (the remainder AFTER the match) but
    // for the text before it instead.
    this.lastCapturedPrefixByTimerId = new Map();
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
        let hit;
        if (timer.triggerMatch === 'castOf') {
          // triggerText is a SPELL NAME here, not a line. Purpose-built for cooldowns, because
          // neither of the other two modes can do this job: exact never matches a ranked cast, and
          // contains on "You begin casting Fire" also matches Fire Bolt, Fire Flux and four more.
          // Thirteen spells in the roster are a prefix of another one.
          hit = castSpell !== null && castSpell.toLowerCase() === trigger;
        } else if (timer.triggerMatch === 'zoneEnter') {
          // triggerText is a ZONE NAME here, not a line - same shape as castOf just above, for the
          // same reason: no line-matching mode could do this job (the zone-change line's own
          // wording is "You have entered X.", not anything a timer's author would type or want to
          // match against, and it needs zoneEntered specifically, computed once above).
          hit = zoneEntered !== null && zoneEntered.toLowerCase() === trigger;
        } else if (timer.triggerMatch === 'zoneLeave') {
          hit = zoneLeft !== null && zoneLeft.toLowerCase() === trigger;
        } else if (timer.triggerMatch === 'contains') {
          const idx = lowerLine.indexOf(trigger);
          hit = idx !== -1;
          if (hit) {
            const remainder = strippedLine.slice(idx + trigger.length).trim().replace(/[.!]+$/, '');
            if (remainder) this.lastCapturedTextByTimerId.set(timer.id, remainder);
            const prefix = strippedLine.slice(0, idx).trim();
            if (prefix) this.lastCapturedPrefixByTimerId.set(timer.id, prefix);
          }
        } else {
          hit = trigger === lowerLine;
        }
        if (hit) matches.push({ widgetId: widget.id, timer });
      }
    }
    return matches;
  }

  // Groups a line's raw per-timer matches by the widget they belong to, and decides - per widget,
  // by its own triggerCombineMode - what actually gets (re)armed. Replaces the old per-timer
  // "Extra conditions" all-of list: that lived inside ONE trigger's own edit modal and could only
  // combine LINES within a single definition. This combines whole sibling definitions instead,
  // visibly, from the ordinary trigger list every widget already has.
  //
  // Returns [{ key, def, reverse }] - key is what activeTimers gets keyed by, def is the specific
  // definition whose name/icon/durationSec/etc. the resulting tile should use, reverse is the
  // OWNING WIDGET's reverseDetection flag (see this file's header comment) - carried per
  // activation, not looked up again in handleLine, since this is the one place that already knows
  // which widget an activation belongs to.
  _resolveActivations(rawMatches, now) {
    if (rawMatches.length === 0) return [];
    const byWidget = new Map(); // widgetId -> timer[]
    for (const { widgetId, timer } of rawMatches) {
      if (!byWidget.has(widgetId)) byWidget.set(widgetId, []);
      byWidget.get(widgetId).push(timer);
    }
    const widgetsById = new Map(this.getWidgetsFn().map((w) => [w.id, w]));
    const activations = [];
    for (const [widgetId, timers] of byWidget) {
      const widget = widgetsById.get(widgetId);
      const mode = widget?.triggerCombineMode || 'independent';
      const reverse = !!widget?.reverseDetection;
      if (mode === 'and') {
        const andWindowMs =
          typeof widget.andWindowSec === 'number' && Number.isFinite(widget.andWindowSec)
            ? Math.max(0, widget.andWindowSec) * 1000
            : DEFAULT_AND_WINDOW_MS;
        for (const t of timers) this.timerSeenUntil.set(t.id, now + andWindowMs);
        const all = widget.customTimers || [];
        // >1 required, not just "every entry seen" - a widget with a single trigger in AND mode
        // would otherwise fire on that one trigger alone, silently behaving like 'independent'
        // instead of visibly doing nothing until a second trigger is even added.
        const allSeen = all.length > 1 && all.every((t) => (this.timerSeenUntil.get(t.id) || 0) > now);
        if (!allSeen) {
          // Reported live 25 Aug: "the timer trigger uses hi but does not put anything into the
          // debug log" - a trigger that matches but doesn't complete the set used to leave zero
          // trace anywhere, which is exactly backwards for the one combine mode whose whole point
          // is state you can't otherwise see. Named SEEN rather than FIRED - nothing has actually
          // activated yet, only counted toward the set - and names what it's still waiting on so
          // a half-satisfied AND reads as "on its way" rather than "did nothing."
          const stillWaiting = all
            .filter((t) => (this.timerSeenUntil.get(t.id) || 0) <= now)
            .map((t) => t.name);
          for (const t of timers) {
            this._debugLog(
              `SEEN "${t.name}" - part of an AND combo, still waiting on: ${stillWaiting.join(', ') || '(nothing - should have fired)'}`
            );
          }
          continue;
        }
        // Fired - hand the hold state back empty so it takes every trigger firing again, not just
        // whichever one happened to complete the set, to re-arm. Same reasoning the old all-of's
        // _clearLineParts had for not letting one lingering part retrigger forever.
        for (const t of all) this.timerSeenUntil.delete(t.id);
        // The widget's first definition is the combo's stable identity - which particular trigger
        // happened to complete the set this time is incidental, not something the tile's name/icon
        // should flicker between.
        activations.push({ key: `and:${widgetId}`, def: all[0], reverse });
      } else if (mode === 'or') {
        // Whichever definition matched THIS line - unlike 'and' there is no set to complete, so
        // showing the one that actually just fired is the informative choice, not an arbitrary one.
        activations.push({ key: `or:${widgetId}`, def: timers[timers.length - 1], reverse });
      } else {
        for (const t of timers) activations.push({ key: t.id, def: t, reverse });
      }
    }
    return activations;
  }

  handleLine(line) {
    const stripped = stripTimestamp(line);
    const lowerLine = line.toLowerCase();

    // Backlog #12 - death clears the timers that stand for something currently on the player: an
    // active buff duration, a reverse "skill ready" hold, a half-satisfied AND combo. A recast
    // COOLDOWN keeps ticking - the ability is still on cooldown whether you are alive or not.
    if (matchOwnDeath(line)) {
      let cleared = 0;
      for (const [key, t] of this.activeTimers) {
        if (t.phase === 'cooldown') continue;
        this.activeTimers.delete(key);
        cleared += 1;
      }
      this.timerSeenUntil.clear();
      if (cleared) {
        this._debugLog(`DEATH - cleared ${cleared} custom timer(s)`);
        this.emit('activeChanged', this.getActive());
      }
      return;
    }

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
        this._debugLog(`ENDED "${timer.name}" - ended text matched: "${stripped}"`);
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
        this._debugLog(`CANCELLED "${timer.name}" - cast of "${interrupted}" was interrupted`);
      }
      if (cancelled) this.emit('activeChanged', this.getActive());
    }

    // Checked unconditionally, not "else" - a line ending one timer
    // shouldn't stop it from also starting a different one (or restarting
    // the same one) if it happens to match a trigger too.
    const now = Date.now();
    const activations = this._resolveActivations(this._findTriggerMatches(line, stripped), now);
    if (activations.length === 0) return;
    // Keyed by `key` above, not by name - two definitions are allowed to share a display name
    // (e.g. same trigger text, different icons, meant to both show at once), and keying by name
    // would let the second activation silently overwrite the first in the Map.
    for (const { key, def, reverse } of activations) {
      // Note 10's Risk, and it is real: this overwrites an active entry whenever the trigger text
      // is seen again. For a plain timer that is right - seeing the line again means it happened
      // again. For one in its COOLDOWN phase it is wrong twice over: the ability is not available,
      // so the line cannot mean it was used, and restarting would hide a cooldown the player is
      // waiting on behind a fresh duration.
      //
      // The line is far likelier to be an echo, a second target, or somebody else's. Ignored.
      const running = this.activeTimers.get(key);
      if (running && running.phase === 'cooldown') {
        this._debugLog(`IGNORED "${def.name}" - trigger seen again while on cooldown: "${stripped}"`);
        continue;
      }

      const durSec = def.durationSec;

      // Reverse detection. See the class's own header comment on the 'hidden' phase for the full
      // shape - this is the other half, seeing the trigger for the first time. `reverse` came from
      // the owning WIDGET (see _resolveActivations), so this applies uniformly whether `key` is a
      // single definition's own id (independent) or a whole-widget AND/OR combo key.
      if (reverse) {
        this._debugLog(`FIRED "${def.name}" - reverse trigger: "${stripped}" - hiding for ${durSec}s`);
        this.activeTimers.set(key, {
          id: key,
          defId: def.id,
          name: def.name,
          durationSec: durSec,
          expiresAt: now + durSec * 1000,
          endedText: def.endedText || null,
          triggerMatch: def.triggerMatch || undefined,
          triggerText: def.triggerText || undefined,
          phase: 'hidden',
          cooldownSec: 0,
          capturedText: this.lastCapturedTextByTimerId.get(def.id) || undefined,
          capturedPrefix: this.lastCapturedPrefixByTimerId.get(def.id) || undefined,
        });
        continue;
      }

      this._debugLog(`FIRED "${def.name}" - trigger: "${stripped}"`);

      this.activeTimers.set(key, {
        id: key,
        // Which definition this instance's icon should come from - see getActive()'s
        // _findDefinitionById call. Equal to `key` itself for an 'independent' trigger (where key
        // IS the definition's own id), but not for an 'and'/'or' combo, where key is a synthetic
        // per-widget string no definition owns.
        defId: def.id,
        name: def.name,
        durationSec: durSec,
        expiresAt: now + durSec * 1000,
        endedText: def.endedText || null,
        // Carried through so an interrupt can find and cancel this again. Without them the check
        // above has an id and a name and no way to tell what kind of timer it is looking at.
        triggerMatch: def.triggerMatch || undefined,
        triggerText: def.triggerText || undefined,
        // Note 10. 'duration' or 'cooldown'. Always starts as 'duration' - even a timer whose only
        // useful number is the cooldown runs its duration first, because that is what the trigger
        // line reported. cooldownSec rides along so _tick does not have to look the definition up
        // again, and so a restored snapshot can transition without one.
        phase: 'duration',
        cooldownSec: def.cooldownSec || 0,
        // Whatever a "contains" trigger's own text left over on this specific line - see
        // _findTriggerMatches. undefined for exact/castOf triggers, which have nothing left over
        // by definition.
        capturedText: this.lastCapturedTextByTimerId.get(def.id) || undefined,
        // The text BEFORE a "contains" trigger's match - "An imp protector" out of "An imp
        // protector resisted your Denon's Dissension!". overlay.js's {mob}/{caster} tokens read
        // this for a customTimer buff, since there is no allyName on one (see this field's own
        // comment on _findTriggerMatches for why it needed its own capture).
        capturedPrefix: this.lastCapturedPrefixByTimerId.get(def.id) || undefined,
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
      this._debugLog(`LOADED "${timer.name}" - restored from before restart`);
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

      // Reverse detection's hide window is over. Just delete - there is no phase after 'hidden',
      // and nothing needs writing to bring the tile back: getActive() synthesizes a visible
      // 'shown' tile for any inverse definition that ISN'T sitting in this map, so the tile
      // reappears the moment this entry stops existing, with no extra state to manage.
      if (timer.phase === 'hidden') {
        this.activeTimers.delete(key);
        this._debugLog(`ENDED "${timer.name}" - reverse trigger's hide window elapsed, visible again`);
        continue;
      }

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
      this._debugLog(
        timer.phase === 'cooldown'
          ? `ENDED "${timer.name}" - cooldown finished, ready again`
          : `ENDED "${timer.name}" - duration ran out`
      );
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
    // A reverse-detection key currently sitting in activeTimers with phase:'hidden' is one whose
    // trigger fired recently and is still hiding - see handleLine's 'hidden'-phase branch. Keyed by
    // t.id (== the map key: a definition's own id in independent mode, or the widget's
    // `and:<widgetId>`/`or:<widgetId>` combo key), which is exactly what the synthesis loop below
    // needs to check against for either shape.
    const hidingKeys = new Set(
      [...this.activeTimers.values()].filter((t) => t.phase === 'hidden').map((t) => t.id)
    );
    const results = [...this.activeTimers.values()]
      // 'hidden' means literally hidden - excluded here, not just styled differently, which is
      // the entire point of a reverse trigger.
      .filter((t) => t.phase !== 'hidden')
      .map((t) => {
        // defId if present (an 'and'/'or' combo instance, whose own `id` is a synthetic per-widget
        // string no definition owns), otherwise `id` itself (an 'independent' trigger, or a
        // snapshot restored from before defId existed - see restoreSnapshot).
        const def = this._findDefinitionById(t.defId || t.id);
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
          // Whatever a "contains" trigger's own text left over on the line that fired it - see
          // _findTriggerMatches. undefined for exact/castOf triggers.
          capturedText: t.capturedText || null,
          // The text before that same match - see the field's own comment in handleLine.
          capturedPrefix: t.capturedPrefix || null,
        };
      });

    // The other half of reverse detection: something ON by default has no event behind it to put
    // an entry in activeTimers in the first place, so - same reasoning as overlay.js's
    // alwaysOnEntry() and BuffEngine's icon-looked-up-live pattern - it is synthesized fresh every
    // call rather than pre-seeded anywhere. Whatever key ISN'T currently hiding just IS visible,
    // full stop, with no expiry of its own (infinite: true, remainingSec: null - the same shape
    // BuffEngine already uses for a buff with infiniteDuration, so every existing infinite-aware
    // render/sound-warning path already knows what to do with one of these).
    //
    // Mirrors _resolveActivations' own per-mode shape exactly, because the visible-by-default state
    // has to agree with whatever that method decides "fires" for the same widget:
    //   - independent: one synthesized tile per definition, keyed by the definition's own id.
    //   - and/or: ONE synthesized tile for the whole widget, keyed by the same
    //     `and:<widgetId>`/`or:<widgetId>` combo key handleLine writes a 'hidden' entry under,
    //     using the first definition for its name/icon (same "first is the combo's stable
    //     identity" choice _resolveActivations' own 'and' branch already makes).
    for (const widget of this.getWidgetsFn()) {
      if (!widget.reverseDetection) continue;
      const defs = widget.customTimers || [];
      if (defs.length === 0) continue;
      const mode = widget.triggerCombineMode || 'independent';
      if (mode === 'independent') {
        for (const def of defs) {
          if (hidingKeys.has(def.id)) continue;
          results.push({
            id: def.id,
            name: def.name,
            durationSec: null,
            remainingSec: null,
            phase: 'shown',
            showOnOverlay: true,
            iconUrl: def.iconId != null ? this.iconUrlFn(def.iconId) : null,
            isBardSong: false,
            infinite: true,
            capturedText: null,
            capturedPrefix: null,
          });
        }
      } else {
        const key = `${mode}:${widget.id}`;
        if (hidingKeys.has(key)) continue;
        const def = defs[0];
        results.push({
          id: key,
          name: def.name,
          durationSec: null,
          remainingSec: null,
          phase: 'shown',
          showOnOverlay: true,
          iconUrl: def.iconId != null ? this.iconUrlFn(def.iconId) : null,
          isBardSong: false,
          infinite: true,
          capturedText: null,
          capturedPrefix: null,
        });
      }
    }

    return results.sort((a, b) => {
      // Mirrors BuffEngine.getActiveBuffs's own infinite-sorts-last handling - plain subtraction
      // is NaN the moment either side is null, which Array.sort treats as "equal" rather than
      // consistently last, so a shown reverse tile could otherwise land anywhere in the list.
      const aNone = a.remainingSec == null;
      const bNone = b.remainingSec == null;
      if (aNone && bNone) return 0;
      if (aNone) return 1;
      if (bNone) return -1;
      return a.remainingSec - b.remainingSec;
    });
  }
}

module.exports = { CustomTimerEngine };
