const { EventEmitter } = require('events');
const {
  matchCastBegin,
  matchSingingBegin,
  matchActivate,
  matchOtherCastBegin,
  matchMemorizeFinished,
  matchForgetSpell,
  matchHealBySpell,
  matchOthersWornOff,
  matchSlain,
  matchAwakened,
  matchGroupMemberJoined,
  matchGroupMemberLeft,
  matchGroupJoinAccepted,
  isFailureLine,
  isPartyChangeLine,
  looksLikeLandingMessage,
  stripTimestamp,
  stripRankSuffix,
  rankValue,
  FALLBACK_CONFIRM_WINDOW_MS,
  BURST_WINDOW_MS,
} = require('./buffParser');
const { DEFAULT_PROFILE_ID } = require('./profileStore');

const TICK_INTERVAL_MS = 1000;

// How long an INSTANT is kept available - a spell the roster has no duration for and which is not
// marked as lasting forever, i.e. something that happened rather than something running.
//
// This is a RETENTION ceiling, not the display time. How long a text aura actually shows one is
// that aura's own setting (textAuraInstantSec, default 6), so the engine has to hold onto it for
// at least as long as the most patient aura might want - hence the cap, which matches the slider's
// maximum. Nothing draws a countdown from it either way: durationSec stays null.
const INSTANT_RETENTION_SEC = 60;

// Spell categories that are cast AT something rather than ON someone. Used to mark a landing as
// being on an enemy, so an aura can choose to show those separately from buffs on groupmates.
const ENEMY_SPELL_CATEGORIES = new Set(['debuff', 'charm', 'dot', 'nuke']);

// What a mob name is allowed to look like. Real examples from the owner's logs: "a greater kobold",
// "a Teir`Dal ranger", "an elite gnoll shaman", "Baron Telyx V`Zher", "the froglok shin lord".
//
// The word cap and the length cap are the point. Without them this is "any text at all", and the
// whole reason the strict single-word check existed was that something has to stop a sentence
// ending in the same words from being read as a landing.
const MOB_NAME_PATTERN = /^[A-Za-z][A-Za-z `'-]{0,38}$/;
const MOB_NAME_MAX_WORDS = 6;

// The one thing that identifies a mez, since the break line does not name the spell. Every roster
// entry in the mez family - Mesmerize, Mesmerization, Dazzle - shares this exact landing text.
const MEZ_LANDING_SUFFIX = ' has been mesmerized.';

// A character has fourteen spell gems, so at most fourteen spells can be memorized at once.
//
// currentlyMemorized can nevertheless drift above that, because it is built purely from
// "You forget X." / "You have finished memorizing X." lines and those are only seen while the app
// is running. Close the app, swap a gem, reopen: the forget line was never seen, so the old spell
// stays in the picture indefinitely and the count creeps up.
//
// That is not only a wrong number on screen. currentlyMemorized is real evidence in detection - a
// unique landing text is refused if the spell is knowably NOT in a gem right now - so every stale
// entry vouches for a spell that is not loaded. Capping at the real number of gems keeps the
// fourteen most recently seen, which are the ones most likely to reflect the bar as it really is.
const MAX_MEMORIZED_GEMS = 14;

// Consumes parsed log lines, decides when a cast has actually landed (see
// buffParser.js for why), and keeps live countdown state for everything
// currently active. Buffs not found in the buff database are surfaced as
// "unknown" instead of being silently dropped.
//
// Detection priority, most to least certain:
//   1. A pending "You begin casting X" tells us exactly what was cast, so
//      its landing text (even shared by other spells) safely confirms it.
//   2. Landing text unique to one buff in the whole database - safe with
//      zero context, covers instant AAs/clickies with no cast line at all.
//   3. Ambiguous landing text (shared by several buffs) narrowed down by
//      the player's own spellbook - if only one candidate is something
//      they've actually scribed, it's almost certainly their own cast...
//      UNLESS a recent third-person "<Name> begins casting/singing" line
//      named one of the candidates, which means a group-targeted spell
//      from someone else most likely landed on everyone (including the
//      player) and just happens to share text with something the player
//      also has scribed - see recentOtherCasts below.
//   4. Ambiguous text during an "activate" burst window (e.g. "Quick Buff"
//      granting a dozen+ buffs at once) - the player themselves triggered
//      the burst, so this is presumed to be their own regardless of
//      spellbook, but WHICH specific one it was is never guessed. Hard
//      rule: no auto-guessing anywhere in this file - genuinely ambiguous
//      always means a prompt (see the Ambiguous Casts panel/popup), never
//      a best-effort pick. A remembered resolution (see
//      resolveAmbiguousCast) is not a guess and still applies automatically.
//   5. Ambiguous text with none of the above - most likely someone else's
//      buff landing on the player. Ignored by default (self-buffs-only is
//      the default behavior); only surfaced for manual resolution if the
//      user has opted into tracking others' buffs.
//
// When endedText is known, any active buff is force-removed the moment
// that text shows up in the log - e.g. the player right-clicked it off
// early - rather than waiting for its timer to run out on its own.
//
// Ally-buff tracking (buffs the PLAYER casts on others) is a separate,
// much simpler path bolted onto the side of the above, not another tier in
// it: it only ever fires once a "You begin casting/singing X" line has
// named the exact spell with certainty (recentSelfCast), so there's no
// identity ambiguity to resolve - the only open question is WHO it landed
// on, answered by matching the game's own third-person text
// (othersLandingSuffix, mined the same way landingText was) against the
// current group roster. Scoped to confirmed group members only (see
// groupMembers) - not raid-wide, not pets (yet). See the "someone else
// beginning a cast" handling above for why recentSelfCast is tracked
// separately from pendingCast rather than reusing it: a single group buff
// can land on the caster AND groupmates from one cast, but pendingCast is
// already cleared the moment the caster's own landing confirms.
class BuffEngine extends EventEmitter {
  // store: a plain { loadJson, saveJson } object, same convention as
  // BuffStore's own constructor - kept injectable (not required('./store')
  // directly, which would pull in Electron's `app` and break every plain
  // Node test script that instantiates this class outside the real app,
  // e.g. mocking loadJson/saveJson to unit-test detection logic directly).
  constructor(buffStore, store) {
    super();
    this.buffStore = buffStore;
    this.store = store;
    this.pendingCast = null; // { name, timer, landingText }
    this.burstUntil = 0; // Date.now() timestamp - see matchActivate handling below
    this.activeBuffs = new Map(); // lowercased name -> { name, durationSec, expiresAt, endedText }
    this.unknownBuffs = new Map(); // lowercased name -> { name, lastSeenAt, dismissed }
    this.ambiguousCasts = new Map(); // landingText -> { text, candidateNames, lastSeenAt }
    // landingText -> buffName. Persisted (unlike recentOtherCasts, which is
    // live group-membership state and correctly resets every launch) since
    // these are the user's own deliberate answers to "which buff was this"
    // - losing them on every restart meant re-answering the same prompts
    // over and over. Still cleared on party change same as before; that
    // clear is itself saved too, so a restart after a party change doesn't
    // resurrect stale pre-change answers from disk.
    //
    // Split into two separate maps, not one: the same landing text can be
    // shared between a spell the player casts on themselves and a
    // different spell an ally casts (e.g. Quick Buff granting the
    // player's own "Dexterity" while a groupmate's own cast of "Deftness"
    // shares that exact text). Resolving one context must never answer
    // for the other - a self-cast resolution should not get silently
    // reapplied to an unconfirmed ally's cast later, or vice versa. Which
    // map a given resolve() call writes to is tagged on the queued
    // ambiguousCasts entry itself at queue time (see _queueAmbiguousCast).
    // profileId -> Map<landingText, buffName>. Loadout profiles (see
    // profileStore.js) let the user swap which of these buckets is
    // "active" - each holds a genuinely separate set of answers, since the
    // same ambiguous text can mean different real spells depending on the
    // player's current loadout. Migrates the old flat single-map format
    // (pre-profiles) into DEFAULT_PROFILE_ID's bucket exactly once, so
    // upgrading users don't lose every resolution they've already taught
    // the app. Written back to disk under the new key immediately (not
    // lazily on the next resolve) - otherwise a user who upgrades but
    // never resolves a NEW ambiguous cast would silently keep re-deriving
    // the same in-memory migration from the legacy key every single
    // launch, forever, instead of it actually completing once.
    const byProfile = store.loadJson('selfAmbiguousResolutionsByProfile', null);
    if (byProfile) {
      this.selfAmbiguousResolutionsByProfile = new Map(
        Object.entries(byProfile).map(([profileId, entries]) => [profileId, new Map(entries)])
      );
    } else {
      const legacy = store.loadJson('ambiguousResolutions', []);
      this.selfAmbiguousResolutionsByProfile = new Map([[DEFAULT_PROFILE_ID, new Map(legacy)]]);
      store.saveJson(
        'selfAmbiguousResolutionsByProfile',
        Object.fromEntries([...this.selfAmbiguousResolutionsByProfile].map(([profileId, map]) => [profileId, [...map.entries()]]))
      );
    }
    this.activeProfileId = DEFAULT_PROFILE_ID;
    // Convenience reference to the active profile's bucket - kept as a real
    // Map (not a getter) so every existing .get/.set/.delete/.clear call
    // site below didn't need to change, only setActiveProfileId() and the
    // handful of places that must reach a *different* profile's bucket than
    // whichever is currently active (see resolveAmbiguousCast). Since Maps
    // are reference types, mutating this map also mutates the entry inside
    // selfAmbiguousResolutionsByProfile - no separate sync step needed.
    this.selfAmbiguousResolutions = this._getOrCreateSelfResolutionsMap(this.activeProfileId);
    this.otherAmbiguousResolutions = new Map(store.loadJson('otherAmbiguousResolutions', []));
    // lowercased spell name -> the caster name as written, for spells last seen cast by
    // someone else. Cleared on party change.
    //
    // A Map rather than a Set purely so the debug log can say WHO. The KEY is unchanged and
    // must stay unchanged: six decisions gate on _hasRecentOtherCast(spellName), and widening
    // the key to caster+spell would quietly weaken all of them - the same spell cast by two
    // different people would stop matching itself. Map.has and Set.has behave identically on
    // the same key, so nothing downstream can tell the difference.
    //
    // Worth having: this veto is the app's most consequential decision, and until now it was
    // made on anonymous evidence. One day's log carries 3,934 third-person cast lines against
    // 15 party-change lines to clear them, so "why did my buff not appear" was unanswerable.
    this.recentOtherCasts = new Map();
    // lowercased spell name -> currently sitting in a gem slot (built from
    // "You forget X."/"You have finished memorizing X." lines - see
    // handleLine).
    //
    // PERSISTED, unlike most state here. It still can't be backfilled from
    // history (the app never replays the log), but starting empty every
    // launch was itself a bug source: an empty set means "we don't know",
    // and the detection tiers treat not-currently-memorized as evidence a
    // landing wasn't the player's own - so a fresh launch mid-session caused
    // real buffs to be silently ignored. Carrying the last known gem loadout
    // across restarts makes the common case ("app restarted, gems unchanged")
    // correct instead of blank.
    //
    // The tradeoff is that it can now be stale rather than merely empty - if
    // gems were swapped while the app was closed, it's remembering something
    // untrue. That's why the landing-page gem bar lets the user click a gem
    // to forget it (see removeMemorized), and why it's labelled a memory of
    // what was last seen rather than live truth.
    // Map rather than Set: keyed by lowercased name (every lookup in the
    // detection tiers is case-insensitive) but carrying the original casing
    // as the value, so a memorized spell that ISN'T in the buff roster - a
    // nuke, a heal - can still be displayed properly instead of rendering as
    // "rain of spikes". Roster spells get their casing from the roster; these
    // have no other source for it.
    this.currentlyMemorized = new Map(
      (store.loadJson('currentlyMemorized', []) || []).map((entry) =>
        // Tolerates the older flat array-of-names format as well as the
        // current [lower, original] pairs.
        Array.isArray(entry) ? [entry[0], entry[1]] : [String(entry).toLowerCase(), String(entry)]
      )
    );
    // Trim on load as well as on insert. A store saved before the cap existed can already hold
    // more than fourteen, and capping only new arrivals would leave that file permanently over
    // the limit - it would never come down on its own, because entries are only removed by a
    // "You forget X." line for a gem the app may never see again. Healing it here means one
    // launch fixes it, with no reset button to find.
    if (this._trimMemorized() > 0) this._saveCurrentlyMemorized();
    // Confirmed group members, lowercased name -> real-case name (from
    // "<Name> has joined the group." lines).
    //
    // NO LONGER GATES ALLY-BUFF DETECTION. It used to, and that was a real
    // bug: membership can only be learned from join/leave lines seen live, so
    // grouping up before launching the app - or any restart mid-session -
    // left it empty and silently disabled ally tracking completely (confirmed
    // from a real log: a Shield of Flame cast whose "Avenrae is enveloped by
    // flame." landed 3s later was ignored purely because the group had formed
    // hours before startup). Both ally paths in handleLine now take the
    // recipient's name from the landing line itself instead. Kept up to date
    // because it's genuine information worth having, but nothing depends on
    // it being complete.
    this.groupMembers = new Map();
    // Set by "You notify X that you agree to join the group." (see
    // buffParser.js) - the one line naming a pre-existing group's member
    // when you join THEM, one line ahead of the self-join clear in
    // handleLine(). Consumed and cleared there, never read anywhere else.
    this.pendingGroupInviter = null;
    // { name, expiresAt } | null - separate from pendingCast (see the class
    // doc comment above) so ally-landing detection keeps working for the
    // rest of the window even after the caster's own landing has already
    // confirmed and cleared pendingCast.
    this.recentSelfCast = null;
    // `${allyNameLower}::${buffNameLower}` -> { name, allyName, durationSec,
    // expiresAt } - parallel to activeBuffs but keyed by (ally, buff) since
    // the same buff can be on several allies, and the same ally can have
    // several buffs, at once. No endedText tracking - the game's string
    // data has no distinct "wears off of someone else" message (see
    // othersLandingSuffix mining notes in buffStore.js), so these only ever
    // expire via the tick() timer sweep, same fallback self-buffs already
    // use when endedText isn't known.
    this.allyBuffs = new Map();
    this.blockedNames = new Map(); // lowercased name -> original-case name, see blockBuff()
    this.spellbookCheckFn = null; // (name) => boolean
    this.trackOthersEnabled = false;
    this.durationMultiplierFn = () => 1;
    this.iconUrlFn = (iconId) => `eqicon://icon/Alternate%201/${iconId}`;
    this.debugLogFn = null; // (message) => void - see setDebugLogFn
    this.bardSongsVisibleFn = () => true; // see setBardSongsVisibleFn
    this.tickTimer = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  // Lets an external module (character trait bonuses) scale how long a
  // landed buff is tracked for, without buffEngine needing to know anything
  // about AAs/exaltation itself.
  setDurationMultiplierFn(fn) {
    this.durationMultiplierFn = fn;
  }

  // Lets iconService control which icon art set URLs point at, without
  // buffEngine needing to know anything about icon sets itself.
  setIconUrlFn(fn) {
    this.iconUrlFn = fn;
  }

  // fn(spellName) => boolean - whether the player has that spell scribed.
  setSpellbookCheckFn(fn) {
    this.spellbookCheckFn = fn;
  }

  // fn() => Set of lowercased spell names that some aura has asked to watch ON ENEMIES.
  //
  // This is what makes enemy-debuff tracking possible without drowning in it. A mob's name is not
  // one alphabetic word - "a greater kobold", "a Teir`Dal ranger" - so the recipient check below
  // rejects it, which is why mez and charm have never tracked. Simply relaxing that check would
  // let EVERY debuff on every mob through: measured against 1.6 million real lines, that is
  // 160,000 landings, over 100,000 of them from two bard songs pulsing on everything in range.
  //
  // So it is opt-in per spell. Only a spell an aura is actually watching gets the relaxed check,
  // which bounds the volume by what the user asked for rather than by how busy the fight is.
  //
  // Injected rather than reading widgetManager directly, for the same reason as the spellbook
  // check: widgetManager pulls in Electron, and this engine has to stay runnable in a plain Node
  // test and in tools/replay-log.js.
  setEnemyDebuffNamesFn(fn) {
    this.enemyDebuffNamesFn = fn;
  }

  // fn() => Set of lowercased spell names some TEXT aura has asked to be warned about when
  // somebody else casts them. Shara's design, and it is a better one than either option I put to
  // her: not a timer on somebody else's debuff, which could only ever be guessed, but a warning
  // that one has been cast - "be careful", not "here is a countdown".
  //
  // Same injection shape as the enemy list above, for the same reason: this engine has to stay
  // runnable in a plain Node test and in tools/replay-log.js, neither of which has Electron.
  setAllyDebuffAlertNamesFn(fn) {
    this.allyDebuffAlertNamesFn = fn;
  }

  // Whether a spell somebody else just started casting is one an aura asked to be warned about.
  //
  // Checks the rank-stripped name too. The owner's groupmates cast "Mesmerization VI" and
  // "Mesmerization VII"; the roster entry, and therefore what she picks in the buff list, is
  // "Mesmerization". Matching only the literal string would mean picking the spell and never
  // being warned about the two ranks anyone actually casts.
  _isAlertedAllyCast(spellName) {
    if (!this.allyDebuffAlertNamesFn) return null;
    const names = this.allyDebuffAlertNamesFn();
    if (!names || !names.size) return null;
    const raw = spellName.toLowerCase();
    if (names.has(raw)) return spellName;
    const base = stripRankSuffix(spellName);
    return names.has(base.toLowerCase()) ? spellName : null;
  }

  _isWatchedOnEnemies(name) {
    if (!this.enemyDebuffNamesFn) return false;
    const names = this.enemyDebuffNamesFn();
    return !!names && names.has(name.toLowerCase());
  }

  // Whether a landing of this spell is on an enemy rather than on a groupmate.
  //
  // Decided by the SPELL, not by the shape of the name: plenty of mobs have one-word names
  // ("Bonefire", "Marrowbane"), so the name cannot tell you, while a spell's category can. A mez
  // or a snare is something you cast at something you are fighting, whoever it happens to be.
  _isEnemySpell(known) {
    return ENEMY_SPELL_CATEGORIES.has(known && known.scaleCategory);
  }

  _getOrCreateSelfResolutionsMap(profileId) {
    let map = this.selfAmbiguousResolutionsByProfile.get(profileId);
    if (!map) {
      map = new Map();
      this.selfAmbiguousResolutionsByProfile.set(profileId, map);
    }
    return map;
  }

  // Called by main.js (from profileStore.js's active id, on startup and on
  // every user-driven profile switch) - repoints selfAmbiguousResolutions
  // at the new profile's own bucket. Nothing is cleared or guessed: a
  // profile the app hasn't seen before just starts with an empty bucket,
  // exactly like a brand new install would.
  setActiveProfileId(profileId) {
    if (profileId === this.activeProfileId) return;
    this.activeProfileId = profileId;
    this.selfAmbiguousResolutions = this._getOrCreateSelfResolutionsMap(profileId);
  }

  // Called by main.js when a profile is deleted (profileStore.js refuses to
  // delete the last remaining one, so there's always at least one bucket
  // left). Only ever drops that profile's OWN bucket - never touches
  // otherAmbiguousResolutions, which was never profile-scoped to begin
  // with. If this was the active profile, the caller calls
  // setActiveProfileId() with profileStore's new active id right after -
  // this method doesn't reach into profileStore itself to figure that out,
  // same reasoning as every other cross-module boundary in this file.
  removeProfile(profileId) {
    this.selfAmbiguousResolutionsByProfile.delete(profileId);
    if (profileId === this.activeProfileId) {
      // this.selfAmbiguousResolutions was a direct reference to the Map
      // object just detached above - deleting it from the outer map doesn't
      // clear that inner Map, so without this it would keep silently
      // serving stale answers until the caller calls setActiveProfileId()
      // with the real replacement. Doesn't rely on that call happening
      // immediately (main.js does, right after, but this stays correct on
      // its own either way).
      this.selfAmbiguousResolutions = new Map();
    }
    this._saveSelfAmbiguousResolutions();
  }

  // (message: string) => void - lets an external module decide where the
  // detection-decision log actually goes (a userData file, in the real
  // app) without buffEngine needing to know anything about paths/fs
  // itself, same DI reasoning as the other setXFn hooks. Unset in tests -
  // _debugLog becomes a no-op rather than requiring every test to wire one.
  setDebugLogFn(fn) {
    this.debugLogFn = fn;
  }

  _debugLog(message) {
    if (this.debugLogFn) this.debugLogFn(message);
  }

  setTrackOthersEnabled(enabled) {
    this.trackOthersEnabled = enabled;
    if (!enabled && this.ambiguousCasts.size > 0) {
      this.ambiguousCasts.clear();
      this.emit('ambiguousCastsChanged', this.getAmbiguousCasts());
    }
  }

  stop() {
    clearInterval(this.tickTimer);
    this._cancelPendingCast();
  }

  handleLine(line) {
    const stripped = stripTimestamp(line);

    // Not itself a party-change line (isPartyChangeLine below doesn't match
    // it) - stash the name and let the self-join handling just below pick
    // it back up the moment "You have joined the group." clears the roster.
    const joinAccepted = matchGroupJoinAccepted(line);
    if (joinAccepted) {
      this.pendingGroupInviter = joinAccepted;
      this._checkForEndedBuffs(line);
      return;
    }

    if (isPartyChangeLine(line)) {
      // Who's in the group changes what an ambiguous "You begin to
      // regenerate." even means when the source is someone else - so does
      // recentOtherCasts, for the same reason ("X is currently someone
      // else's spell" only holds while that someone is still around to
      // have cast it). selfAmbiguousResolutions is deliberately NOT
      // touched here - "which of MY OWN spells does this text mean" is a
      // property of the player's own spellbook/gear, not who's grouped
      // with them, so it stays valid across a party change.
      if (this.otherAmbiguousResolutions.size > 0) {
        this.otherAmbiguousResolutions.clear();
        this._saveOtherAmbiguousResolutions();
      }
      if (this.recentOtherCasts.size > 0) this.recentOtherCasts.clear();
      // The player's own join/leave lines ("You have joined the group."/
      // "You have been removed from the group.") don't name anyone, and
      // could mean an entirely different group than before - safest to
      // clear the roster and let it rebuild from whoever's join lines show
      // up next, rather than risk stale groupmates lingering. A specific
      // OTHER person joining/leaving only touches that one name.
      if (/^You have joined the group\.$|^You have been removed from the group\.$/.test(stripped)) {
        this.groupMembers.clear();
        // Only on the "joined" branch, not "removed" - an invite you
        // accepted is never the reason you'd be leaving a group.
        if (/^You have joined the group\.$/.test(stripped) && this.pendingGroupInviter) {
          this.groupMembers.set(this.pendingGroupInviter.toLowerCase(), this.pendingGroupInviter);
        }
        this.pendingGroupInviter = null;
      } else {
        const joined = matchGroupMemberJoined(line);
        if (joined) this.groupMembers.set(joined.toLowerCase(), joined);
        const left = matchGroupMemberLeft(line);
        if (left) this.groupMembers.delete(left.toLowerCase());
      }
      this._checkForEndedBuffs(line);
      return;
    }

    const activated = matchActivate(line);
    if (activated) {
      this.burstUntil = Date.now() + BURST_WINDOW_MS;
      this._checkForEndedBuffs(line);
      return;
    }

    // Someone else beginning a cast doesn't affect the player's own
    // pending-cast state at all, but is remembered (for the rest of this
    // group session - see isPartyChangeLine handling above) so a later
    // landing naming this same spell doesn't get misattributed to the
    // player just because they also happen to have it (or a same-text
    // spell) scribed. Not time-limited to whatever window the cast might
    // land in - some casts (e.g. an auto-renewing bard song) only show
    // this line once and then keep renewing via landing text alone for
    // much longer than any short "just cast" window would cover, so this
    // has to stay valid for as long as that person is plausibly still
    // maintaining it, which in practice means "still in the group."
    const otherCast = matchOtherCastBegin(line);
    if (otherCast) {
      this.recentOtherCasts.set(otherCast.spellName.toLowerCase(), otherCast.casterName);
      this._alertAllyCast(otherCast);
      this._checkForEndedBuffs(line);
      return;
    }

    // Gem swaps. A useful disambiguation signal, but NOT a trusted one, and the ambiguous-
    // candidates handling below now checks the spellbook first because of it: manually
    // un-memorising a spell prints "You forget X.", but a full EQ Legends loadout swap prints
    // nothing at all, so after one of those this list is silently wrong.
    const forgotten = matchForgetSpell(line);
    if (forgotten) {
      this.currentlyMemorized.delete(forgotten.toLowerCase());
      this._saveCurrentlyMemorized();
      this.emit('memorizedChanged', this.getCurrentlyMemorized());
      this._checkForEndedBuffs(line);
      return;
    }
    const memorized = matchMemorizeFinished(line);
    if (memorized) {
      this._rememberMemorized(memorized);
      this._saveCurrentlyMemorized();
      this.emit('memorizedChanged', this.getCurrentlyMemorized());
      this._checkForEndedBuffs(line);
      return;
    }

    // "You healed X for N hit points by <SpellName>." only ever fires for
    // the player's own outgoing heal, so it names a spell the player
    // themselves just cast with total certainty - if that spell is one of
    // the candidates for a still-queued ambiguous cast (see
    // _queueAmbiguousCast below), this resolves it directly instead of
    // leaving the user to answer a prompt this line already answered.
    // Real example that motivated this: "You feel tough." queued 3
    // candidates (Harnessing of Spirit, Talisman of Altuna, Talisman of
    // Tnarg); the very next line, "You healed Shara for 255 hit points by
    // Talisman of Altuna.", named the exact answer. Resolved the same way
    // a manual pick is (resolveAmbiguousCast persists it too) - reusing
    // that path rather than a one-off "land but don't remember" special
    // case, since this evidence is at least as strong as a user's own
    // manual answer. Restricted to isSelf entries - a heal proc can only
    // ever confirm the player's own cast, never someone else's ambiguous
    // buff landing on the player.
    const healedBySpell = matchHealBySpell(line);
    if (healedBySpell) {
      for (const [text, entry] of this.ambiguousCasts) {
        if (entry.isSelf && entry.candidateNames.includes(healedBySpell)) {
          this._debugLog(
            `LANDED "${healedBySpell}" - ambiguous text "${text}" auto-resolved by a heal-proc line naming the spell directly`
          );
          this.resolveAmbiguousCast(text, healedBySpell);
          break;
        }
      }
      this._checkForEndedBuffs(line);
      return;
    }

    // Ally-buff landing: only checked while recentSelfCast names an exact
    // spell we're certain the player just cast, so there's no identity
    // ambiguity here - just "which groupmate got it", answered by an exact
    // text match against the game's own third-person wording. A line that
    // matches this can never also be the player's own landing text (that
    // text never has a name prefix), so there's no risk of this stealing a
    // line the self-detection tiers below would otherwise have handled.
    if (this.recentSelfCast && Date.now() < this.recentSelfCast.expiresAt) {
      const known = this.buffStore.getByName(this.recentSelfCast.name);
      if (known && known.othersLandingSuffix && stripped.endsWith(known.othersLandingSuffix)) {
        // The recipient's name is taken from the line itself rather than
        // matched against the tracked group list. Requiring group membership
        // here was a real bug: membership is only learned from join/leave
        // lines seen live, so grouping up before launching the app (or any
        // restart mid-session) left it empty and silently disabled ally
        // detection entirely - confirmed from a real log, a Shield of Flame
        // cast whose "Avenrae is enveloped by flame." landed 3s later and was
        // ignored purely because the group had formed hours before startup.
        //
        // Dropping that requirement costs almost nothing in certainty: we
        // already know the player cast THIS EXACT spell within the last few
        // seconds, and the game printed its third-person landing text. The
        // name in front is whoever received it, group-tracked or not.
        const allyName = stripped.slice(0, -known.othersLandingSuffix.length);
        if (this._isValidRecipient(allyName, known)) {
          this._debugLog(`ALLY LANDED "${known.name}" on "${allyName}" - named cast, confirmed by third-person landing text`);
          this._landOnAlly(known, allyName);
          this._checkForEndedBuffs(line);
          return;
        }
      }
    }

    // Same thing, but for a burst the player triggered themselves ("You
    // activate Quick Buff.") rather than a named cast. This is the ONLY path
    // that can catch a group buff from an instant multi-target ability: those
    // produce no per-spell cast line at all, so recentSelfCast is null above
    // and the whole ally tier used to be skipped - which is why ally-buff
    // tracking had never once fired despite the roster carrying 9,219
    // third-person suffixes and the group being tracked correctly.
    //
    // Identified from the text alone (strip the groupmate's name, look the
    // remaining suffix up), so unlike the named-cast path there's no spell
    // identity known in advance. Requires an unambiguous suffix - 858 of the
    // 2,034 distinct suffixes are shared by several spells, and the "no
    // guessing" rule that governs self-buff ambiguity applies here too;
    // a shared one is left alone rather than resolved to whichever came
    // first. Attribution to the player rests on the burst window, the same
    // evidence the self-buff burst tier already relies on.
    if (Date.now() < this.burstUntil) {
      // Split the line into "<Name>" + "<everything after it>" and look the
      // remainder up as a third-person landing suffix. EQ character names are
      // a single alphabetic word, so this is unambiguous to parse, and it
      // means the recipient does NOT have to be a known groupmate - see the
      // groupMembers field comment for why depending on that was a bug.
      // A line that isn't a landing message simply finds no suffix match.
      const nameSplit = /^([A-Za-z]+)( .+)$/.exec(stripped);
      if (nameSplit) {
        const allyName = nameSplit[1];
        const suffix = nameSplit[2];
        const matches = this.buffStore.findAllByOthersLandingSuffix(suffix);
        if (matches.length > 1) {
          this._debugLog(
            `ALLY AMBIGUOUS "${suffix}" on "${allyName}" - burst context, ${matches.length} candidates: ${matches.map((c) => c.name).join(', ')}`
          );
        } else if (matches.length === 1) {
          // Keep the burst alive the same way the self tiers do - a long
          // multi-buff burst shouldn't time out partway through just because
          // several of its landings went to other people.
          this.burstUntil = Date.now() + BURST_WINDOW_MS;
          this._debugLog(`ALLY LANDED "${matches[0].name}" on "${allyName}" - burst context, unique third-person landing text`);
          this._landOnAlly(matches[0], allyName);
          this._checkForEndedBuffs(line);
          return;
        }
      }
    }

    // Highest confidence: a named cast is already pending, so its expected
    // text (even if ambiguous in general) safely confirms THIS cast.
    if (this.pendingCast) {
      if (isFailureLine(line)) {
        this._debugLog(`CANCELLED pending cast "${this.pendingCast.name}" - failure line: "${stripped}"`);
        this._cancelPendingCast();
        this.recentSelfCast = null;
        this._checkForEndedBuffs(line);
        return;
      }
      const confirms = this.pendingCast.landingText
        ? stripped === this.pendingCast.landingText
        : looksLikeLandingMessage(line);
      if (confirms) {
        const known = this.buffStore.getByName(this.pendingCast.name);
        this._debugLog(
          known
            ? `LANDED "${known.name}" - named cast, confirmed by its landing text`
            : `UNKNOWN "${this.pendingCast.name}" - named cast confirmed by landing text, but not in the buff database`
        );
        this._confirmPendingCast();
        this._checkForEndedBuffs(line);
        return;
      }
    }

    // Unique landing text - safe to confirm with zero context... UNLESS a
    // recent third-person cast-begin line named this exact spell, which
    // means it's someone else's cast landing on the player too (most
    // likely a group-target spell), not something the player did
    // themselves. Same reasoning as the ambiguous-candidates tier below,
    // just simpler here since there's only one possible name to begin
    // with, not several to disambiguate between.
    const uniqueMatch = this.buffStore.findByLandingText(stripped);
    if (uniqueMatch) {
      if (this._hasRecentOtherCast(uniqueMatch.name)) {
        if (this.trackOthersEnabled) {
          // The caster goes in double quotes deliberately: tools/replay-log.js normalises every
          // debug line by blanking quoted spans before tallying, so a quoted name keeps the
          // before/after histogram comparable instead of making every row read as "changed".
          this._debugLog(
            `LANDED "${uniqueMatch.name}" - unique text, but recently cast by "${this._recentOtherCaster(uniqueMatch.name)}"; landed anyway (track others ON)`
          );
          this._land(uniqueMatch);
        } else {
          this._debugLog(
            `IGNORED "${uniqueMatch.name}" - unique text, recently cast by "${this._recentOtherCaster(uniqueMatch.name)}", track others OFF`
          );
        }
        this._checkForEndedBuffs(line);
        return;
      }
      // A groupmate's continuously-renewing buff (e.g. an ally's bard song)
      // often never produces ANY visible cast-begin line to this player at
      // all, so _hasRecentOtherCast above can't catch it - but a real
      // memorizable spell the player doesn't currently have loaded in any
      // gem literally cannot have just been cast by them via a normal
      // gem-cast, which is evidence just as strong. currentlyMemorized only
      // reflects gems actually observed being loaded THIS session (from
      // "Beginning to memorize"/"finished memorizing"/"forget" lines), so an
      // empty set means "we don't know yet", not "nothing is memorized" -
      // and an already-active buff is exempted since a bard swapping their
      // OWN gems out mid-song shouldn't make its ongoing renewal suddenly
      // look like someone else's.
      const alreadyActive = this.activeBuffs.has(uniqueMatch.name.toLowerCase());
      const isMemorizableSpell = this.spellbookCheckFn ? this.spellbookCheckFn(uniqueMatch.name) : false;
      const inBurst = Date.now() < this.burstUntil;
      // A burst the player themselves triggered ("You activate X.", e.g.
      // Quick Buff) is presumed to have genuinely granted every buff it
      // lands, memorized-per-this-session or not - this is what covers a
      // real reported false-negative: currentlyMemorized only reflects gems
      // actually observed loading THIS session, so a burst landing right
      // after a fresh app launch (buffs already active in-game before the
      // app ever saw a memorize/forget line) would otherwise look
      // indistinguishable from "not memorized" and get silently IGNORED,
      // with no way to recover that specific buff for the rest of the
      // session. Deliberately permissive here, same "completeness over
      // perfect naming" reasoning as the rest of this burst system -
      // accepted known tradeoff: two people Quick-Buffing at the same
      // moment, or a cancelled Quick Buff, could let a buff through that
      // wasn't actually the player's. Scoped tightly to burst context only
      // (`inBurst`), never applied outside it.
      const knownNotMemorized =
        !alreadyActive &&
        !inBurst &&
        isMemorizableSpell &&
        this.currentlyMemorized.size > 0 &&
        !this.currentlyMemorized.has(uniqueMatch.name.toLowerCase());
      if (knownNotMemorized) {
        if (this.trackOthersEnabled) {
          this._debugLog(`LANDED "${uniqueMatch.name}" - unique text, but not currently memorized by you; landed anyway (track others ON)`);
          this._land(uniqueMatch);
        } else {
          this._debugLog(`IGNORED "${uniqueMatch.name}" - unique text, not currently memorized by you, track others OFF`);
        }
        this._checkForEndedBuffs(line);
        return;
      }
      if (inBurst) this.burstUntil = Date.now() + BURST_WINDOW_MS;
      this._debugLog(
        inBurst && isMemorizableSpell && !alreadyActive && this.currentlyMemorized.size > 0 && !this.currentlyMemorized.has(uniqueMatch.name.toLowerCase())
          ? `LANDED "${uniqueMatch.name}" - unique landing text, not currently memorized but assumed yours (burst context)`
          : `LANDED "${uniqueMatch.name}" - unique landing text, no other-cast evidence`
      );
      this._land(uniqueMatch);
      this._checkForEndedBuffs(line);
      return;
    }

    // Ambiguous landing text (shared by multiple buffs).
    const candidates = this._collapseRankVariants(this.buffStore.findAllByLandingText(stripped));
    if (candidates.length > 0) {
      const inBurst = Date.now() < this.burstUntil;
      const selfCandidates = this.spellbookCheckFn ? candidates.filter((c) => this.spellbookCheckFn(c.name)) : [];

      // A recent third-person cast-begin line naming one of these
      // candidates is concrete evidence someone else is the actual source
      // (most likely a group-targeted spell landing on everyone) - overrides
      // both spellbook-narrowing and the burst-window guess below, the same
      // way this file already refuses to blind-confirm a named cast that
      // never showed its own expected landing text (see the comment on the
      // castName/pendingCast handling further down).
      const otherCastMatch = candidates.find((c) => this._hasRecentOtherCast(c.name));

      // If exactly one of these candidates is already an actively tracked
      // buff, this landing is overwhelmingly more likely a renewal of that
      // same buff than a brand-new different one from the same family
      // starting up - e.g. an auto-renewing bard song that only ever shows
      // its shared landing text again, with no cast-begin line to confirm
      // which one each time. Refresh it directly instead of re-queuing the
      // same ambiguous choice on every renewal. Only skipped when there's
      // concrete otherCastMatch evidence pointing at a genuinely different
      // candidate, which should win over "something happens to already be
      // running".
      // Instants excluded deliberately. This tier exists because an ambiguous landing text is far
      // more likely to be a renewal of something already running than a different spell from the
      // same family starting up - but an instant is not running, it is a thing that happened, and
      // it is only still in the list because the engine holds onto it for the text auras. Letting
      // one act as evidence would mean a nuke cast a minute ago silently deciding what a later
      // ambiguous line was.
      const activeCandidate = candidates.find((c) => {
        const entry = this.activeBuffs.get(c.name.toLowerCase());
        return entry && !entry.instant;
      });
      if (activeCandidate && (!otherCastMatch || otherCastMatch.name === activeCandidate.name)) {
        this._debugLog(`RENEWED "${activeCandidate.name}" - ambiguous text "${stripped}" matches an already-active buff`);
        this._land(activeCandidate);
        this._checkForEndedBuffs(line);
        return;
      }

      // THE SPELLBOOK IS CHECKED BEFORE THE GEMS, and the order was reversed deliberately.
      //
      // The old comment here claimed "currently memorized" was strictly stronger evidence than
      // "ever scribed". On this server it is not, and the owner had to correct me on it: manually
      // un-memorising a spell DOES print "You forget X.", but a full EQ Legends LOADOUT SWAP -
      // the thing that changes every gem at once, including to another class - prints nothing at
      // all. There is no line for the app to see, so after one of those the gem list is simply
      // wrong, and nothing in the log can tell it so.
      //
      // The spellbook file cannot go stale that way. It is a snapshot of what this character has
      // scribed, and a loadout swap does not change that. It is the weaker filter in the sense
      // that it narrows less often, but it is the more TRUSTWORTHY one, and trustworthy beats
      // narrow when the two disagree.
      //
      // What did NOT move is the block below that queues a question when the spellbook leaves
      // more than one candidate. Moving the whole spellbook section above the gem check would
      // have dragged that with it, and every line where the spellbook leaves two candidates but
      // exactly one is in a gem would have stopped resolving itself and started asking. Measured
      // against 1.6 million lines before touching anything: the gem check decides 24 landings and
      // the spellbook check 6, so that is a real cost for no gain. Order changed; nothing lost.
      if (!otherCastMatch && selfCandidates.length === 1) {
        // Spellbook narrows it to exactly one thing I actually know, with
        // no sign anyone else just cast any of the candidates either - safe
        // to treat as my own cast even with no cast-begin/activate line at
        // all.
        if (inBurst) this.burstUntil = Date.now() + BURST_WINDOW_MS;
        this._debugLog(`LANDED "${selfCandidates[0].name}" - ambiguous text "${stripped}" narrowed to 1 by spellbook`);
        this._land(selfCandidates[0]);
        this._checkForEndedBuffs(line);
        return;
      }

      // Gems second: still worth having, because it narrows in plenty of cases the spellbook
      // cannot, and after a loadout swap it is wrong rather than useless - it just cannot be
      // trusted OVER the spellbook when the two disagree.
      const memorizedCandidates = candidates.filter((c) => this.currentlyMemorized.has(c.name.toLowerCase()));
      if (!otherCastMatch && memorizedCandidates.length === 1) {
        if (inBurst) this.burstUntil = Date.now() + BURST_WINDOW_MS;
        this._debugLog(
          `LANDED "${memorizedCandidates[0].name}" - ambiguous text "${stripped}" narrowed to 1 by currently-memorized gem`
        );
        this._land(memorizedCandidates[0]);
        this._checkForEndedBuffs(line);
        return;
      }

      if (!otherCastMatch && selfCandidates.length > 1) {
        // Spellbook still leaves more than one candidate - not actually
        // narrowed down, just narrowed to a shorter ambiguous list.
        // Silently landing selfCandidates[0] here was a real misattribution
        // bug: any spell sharing this text with another one the player also
        // has scribed (e.g. several "Selo's Accelerating X" songs all share
        // "Your feet move faster.") always resolved to whichever happened
        // to come first in that list, regardless of which was actually
        // cast. Hard rule: no guessing, ever, including in a burst (Quick
        // Buff) - a remembered resolution (see below) applies automatically
        // since that's a previously-confirmed answer, not a guess;
        // otherwise this always queues for the user to resolve, the same
        // way the "someone else's buff" ambiguous path already does.
        if (inBurst) this.burstUntil = Date.now() + BURST_WINDOW_MS;
        const remembered = this.selfAmbiguousResolutions.get(stripped);
        const rememberedBuff = remembered ? this.buffStore.getByName(remembered) : null;
        if (rememberedBuff) {
          this._debugLog(`LANDED "${rememberedBuff.name}" - remembered choice for "${stripped}" (your cast)`);
          this._land(rememberedBuff);
        } else {
          this._debugLog(
            `QUEUED "${stripped}" for you - spellbook narrowed to ${selfCandidates.length} candidates: ${selfCandidates.map((c) => c.name).join(', ')}`
          );
          this._queueAmbiguousCast(stripped, selfCandidates, true);
        }
        this._checkForEndedBuffs(line);
        return;
      }

      if (!otherCastMatch && inBurst) {
        // Landing during a burst the player themselves triggered ("You
        // activate X.") is presumed to be their own regardless of
        // spellbook - but which specific one it is remains genuinely
        // ambiguous with no per-buff cast line to go on, so this queues
        // for the user too (see hard rule above) rather than guessing
        // candidates[0]. A remembered resolution still applies directly.
        this.burstUntil = Date.now() + BURST_WINDOW_MS;
        const remembered = this.selfAmbiguousResolutions.get(stripped);
        const rememberedBuff = remembered ? this.buffStore.getByName(remembered) : null;
        if (rememberedBuff) {
          this._debugLog(`LANDED "${rememberedBuff.name}" - remembered choice for "${stripped}" (your cast, burst)`);
          this._land(rememberedBuff);
        } else {
          this._debugLog(
            `QUEUED "${stripped}" for you - burst context, not in spellbook, ${candidates.length} candidates: ${candidates.map((c) => c.name).join(', ')}`
          );
          this._queueAmbiguousCast(stripped, candidates, true);
        }
        this._checkForEndedBuffs(line);
        return;
      }

      // Not in my spellbook, no burst context, or a recent third-person
      // cast-begin line pointed at someone else instead - most likely
      // someone else's buff. Ignored unless the user has opted into
      // tracking others' buffs (self-buffs-only is the default).
      if (this.trackOthersEnabled) {
        if (otherCastMatch) {
          // otherCastMatch isn't just "not me" - it's the exact spell name
          // from a third-person "<Name> begins casting/singing X" line, so
          // there's nothing actually ambiguous left to ask about. Queuing
          // this for the user anyway (as if we didn't already know) was a
          // real bug - land it directly, same confidence as the player's
          // own named-cast path above.
          this._debugLog(
            `LANDED "${otherCastMatch.name}" - confirmed via third-person cast line from "${this._recentOtherCaster(otherCastMatch.name)}", track others ON`
          );
          this._land(otherCastMatch);
        } else {
          const remembered = this.otherAmbiguousResolutions.get(stripped);
          const rememberedBuff = remembered ? this.buffStore.getByName(remembered) : null;
          if (rememberedBuff) {
            this._debugLog(`LANDED "${rememberedBuff.name}" - remembered choice for "${stripped}" (others' buff)`);
            this._land(rememberedBuff);
          } else {
            this._debugLog(
              `QUEUED "${stripped}" for you - not your spellbook, track others ON, ${candidates.length} candidates: ${candidates.map((c) => c.name).join(', ')}`
            );
            this._queueAmbiguousCast(stripped, candidates, false);
          }
        }
      } else {
        this._debugLog(`IGNORED "${stripped}" - ambiguous, not your spellbook, track others OFF`);
      }
      this._checkForEndedBuffs(line);
      return;
    }

    const castName = matchCastBegin(line);
    if (castName) {
      // EQ can't queue a second cast while one is in progress, so a new
      // "begin casting" line reliably means the previous one never landed.
      this._cancelPendingCast();
      const known = this.buffStore.getByName(castName);
      // Persist "this is a bard song" on the roster entry itself the
      // moment we see the verb, regardless of whether this particular
      // cast ever confirms - see buffStore.markBardSong().
      if (known && matchSingingBegin(line)) this.buffStore.markBardSong(known.name);
      // Group/targeted spells can land on whoever you had targeted instead
      // of yourself - in that case you only ever see the third-person
      // message about them ("Valbladz looks powerful."), never your own
      // first-person line. When we know the exact text to expect, timing
      // out means it did NOT land on us, so the timer only clears the
      // pending state rather than confirming - blind-confirming here
      // previously produced real false positives. For spells with no known
      // text at all, there's no way to tell the difference, so timeout
      // confirming is still the best available fallback.
      const knowsExpectedText = !!known?.landingText;
      const timer = setTimeout(() => {
        if (knowsExpectedText) {
          this._debugLog(`CANCELLED pending cast "${castName}" - expected landing text never showed up (timed out)`);
          this._cancelPendingCast();
        } else {
          this._debugLog(
            known
              ? `LANDED "${known.name}" - named cast, no landing text on file, confirmed by timeout fallback`
              : `UNKNOWN "${castName}" - named cast, not in the buff database, confirmed by timeout fallback`
          );
          this._confirmPendingCast();
        }
      }, FALLBACK_CONFIRM_WINDOW_MS);
      this._debugLog(
        `CAST BEGIN "${castName}" - ${known ? `known, expecting "${known.landingText || '(no known landing text)'}"` : 'not in roster'}`
      );
      this.pendingCast = { name: castName, timer, landingText: known?.landingText || null };
      // Independent of pendingCast's lifecycle - see the class doc comment
      // on ally-buff tracking for why a group buff needs this to outlive
      // the caster's own landing confirmation.
      this.recentSelfCast = { name: castName, expiresAt: Date.now() + FALLBACK_CONFIRM_WINDOW_MS };
      this._checkForEndedBuffs(line);
      return;
    }

    this._checkForEndedBuffs(line);
  }

  _checkForEndedBuffs(line) {
    // Runs first, and does not return early, because it reads different line shapes from the self
    // loop below - letting one starve the other would be a silent, ordering-dependent bug.
    this._checkForEndedEnemyDebuffs(line);
    for (const [key, buff] of this.activeBuffs) {
      if (buff.endedText && line.includes(buff.endedText)) {
        this.activeBuffs.delete(key);
        this.emit('buffsChanged', this.getActiveBuffs());
        return; // a line only ever reports one buff fading
      }
    }
  }

  // Warns that somebody else has cast a debuff you asked to be told about.
  //
  // Fires on the CAST line rather than on the landing, deliberately and with a cost. The cost is
  // that a cast which is resisted or interrupted still warns - about one in ten. What it buys is
  // roughly two seconds of notice, measured: 96% of landings in the owner's logs arrive exactly
  // two seconds after the cast line. For a warning whose whole job is "do not break this mez",
  // arriving before it lands is the point. The landing line would be more certain and too late.
  //
  // It also names the caster, which the landing line cannot: "<Name> has been mesmerized." says
  // who it happened TO and never who did it.
  //
  // NOT filtered to group members, and NOT described as a party member. Two reasons, both from
  // her own logs. Half the third-person mez and charm casts in them are mobs - "A Teir`Dal
  // ranger", "A negotiator" - so a message claiming "a party member" would be wrong about half
  // the time, whereas naming the caster is right every time and a mob casting mez is a warning
  // worth having too. And gating on the group roster would make the whole feature silently dead
  // whenever the app starts mid-session, because membership is only ever learned from join and
  // leave lines seen live. Depending on that was already a bug in this engine once.
  _alertAllyCast(otherCast) {
    const spellName = this._isAlertedAllyCast(otherCast.spellName);
    if (!spellName) return;
    const caster = otherCast.casterName;
    // Keyed by caster and spell so the same person recasting replaces their own entry rather than
    // stacking up, and so two different people casting the same thing are two warnings.
    const key = `allycast::${caster.toLowerCase()}::${spellName.toLowerCase()}`;
    this.allyBuffs.set(key, {
      name: spellName,
      allyName: caster,
      durationSec: null,
      expiresAt: Date.now() + INSTANT_RETENTION_SEC * 1000,
      // An event, not something running. instant is what keeps it off every aura that draws a
      // countdown - which is exactly what she asked for: "a text alert to be careful, and not a
      // standalone timer that may be inaccurate."
      instant: true,
      landedAt: Date.now(),
      // Not onEnemy. The name on this entry is the CASTER, not a target, so treating it as a
      // debuff sitting on somebody would be wrong in the one place it matters.
      onEnemy: false,
      allyCast: true,
    });
    this._debugLog(`ALLY CAST ALERT "${spellName}" by "${caster}"`);
    this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
  }

  // Ends a debuff on something you are fighting, from the three lines the game actually prints
  // for it (see the pattern comments in buffParser).
  //
  // Deliberately limited to entries marked onEnemy. A buff on a groupmate has never been cleared
  // by anything but its own timer, and widening that here would change what is on screen today
  // for people who have not asked for any of this - "Your Spirit of Wolf spell has worn off of
  // Marrowbane." would start removing tiles that currently sit there until they run out. That
  // change is probably an improvement and is worth making on purpose, with the owner looking at
  // it, rather than as a side effect of adding mez tracking.
  _checkForEndedEnemyDebuffs(line) {
    let changed = false;
    const drop = (key) => {
      this.allyBuffs.delete(key);
      changed = true;
    };

    // Names the spell and the target both, so it needs no guessing at all.
    const worn = matchOthersWornOff(line);
    if (worn) {
      const key = `${worn.targetName.toLowerCase()}::${worn.spellName.toLowerCase()}`;
      const entry = this.allyBuffs.get(key);
      if (entry && entry.onEnemy) {
        this._debugLog(`ENEMY DEBUFF ENDED "${entry.name}" on "${entry.allyName}" - the log says it wore off`);
        drop(key);
      }
    }

    // Dead things hold no debuffs. Clears every one of them on that target at once, which is the
    // point - a mob dying is the most common way a debuff you are watching stops mattering.
    const slain = matchSlain(line);
    if (slain) {
      const prefix = `${slain.toLowerCase()}::`;
      for (const [key, entry] of this.allyBuffs) {
        if (entry.onEnemy && key.startsWith(prefix)) {
          this._debugLog(`ENEMY DEBUFF ENDED "${entry.name}" on "${entry.allyName}" - it died`);
          drop(key);
        }
      }
    }

    // A mez broken early. It does not name the spell, so it can only clear a mez - anything else
    // on that mob is still running.
    //
    // Measured caveat, so nobody later wonders why this never seems to fire: for a mez YOU cast it
    // is redundant. The game emits the wear-off line in the same second and, in all 98 pairs in
    // the owner's logs, always FIRST - so the branch above has already cleared the entry by the
    // time this one looks. It is kept because it is the only signal for a mez somebody ELSE cast,
    // which is where note 16 goes next, and because it costs one regex on lines that are rare.
    const awakened = matchAwakened(line);
    if (awakened) {
      const prefix = `${awakened.toLowerCase()}::`;
      for (const [key, entry] of this.allyBuffs) {
        if (!entry.onEnemy || !key.startsWith(prefix)) continue;
        const known = this.buffStore.getByName(entry.name);
        if (known && known.othersLandingSuffix === MEZ_LANDING_SUFFIX) {
          this._debugLog(`ENEMY DEBUFF ENDED "${entry.name}" on "${entry.allyName}" - the mez was broken`);
          drop(key);
        }
      }
    }

    if (changed) this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
  }

  // Who a third-person landing line is about.
  //
  // A player's name is one alphabetic word, and that strictness is what stops a line which merely
  // happens to END with the same words - a sentence fragment quoted in chat - from being read as
  // a landing. It stays the default for exactly that reason.
  //
  // A MOB's name is not one word. So for a spell an aura has explicitly asked to watch on enemies
  // (see setEnemyDebuffNamesFn) the shape is widened to what a mob name actually looks like:
  // letters, spaces, apostrophes, backticks and hyphens, a few words at most. Deliberately NOT
  // "anything before the suffix" - that would accept a whole sentence, and the strict check exists
  // because something has to.
  _isValidRecipient(name, known) {
    if (/^[A-Za-z]+$/.test(name)) return true;
    if (!this._isWatchedOnEnemies(known.name)) return false;
    if (!MOB_NAME_PATTERN.test(name)) return false;
    return name.trim().split(/\s+/).length <= MOB_NAME_MAX_WORDS;
  }

  _hasRecentOtherCast(name) {
    return this.recentOtherCasts.has(name.toLowerCase());
  }

  /** Who was last seen casting it, or null. For explaining a decision, never for making one. */
  _recentOtherCaster(name) {
    return this.recentOtherCasts.get(name.toLowerCase()) || null;
  }

  _cancelPendingCast() {
    if (this.pendingCast) {
      clearTimeout(this.pendingCast.timer);
      this.pendingCast = null;
    }
  }

  _confirmPendingCast() {
    const cast = this.pendingCast;
    if (!cast) return;
    clearTimeout(cast.timer);
    this.pendingCast = null;
    this._onBuffLanded(cast.name);
  }

  _onBuffLanded(name) {
    const known = this.buffStore.getByName(name);
    if (known) {
      this._land(known);
      return;
    }

    const key = name.toLowerCase();
    const existing = this.unknownBuffs.get(key);
    if (existing) {
      existing.lastSeenAt = Date.now();
    } else {
      this.unknownBuffs.set(key, { name, lastSeenAt: Date.now(), dismissed: false });
    }
    this.emit('unknownBuffsChanged', this.getUnknownBuffs());
  }

  // Buffs the user has explicitly chosen to stop tracking (see blockBuff())
  // never land at all - every passive detection path funnels through this
  // one method, so a single guard here is enough to keep a blocked name off
  // every widget and off the Buff Tracker page for good, not just hidden in
  // one place. resolveUnknown() deliberately does NOT go through this guard
  // - that's the user manually typing in a duration for something, which
  // should never be silently ignored.
  // Duration-extension AAs (Spell Casting Reinforcement, Extended
  // Enhancement) do not apply to every spell - some carry a fixed duration
  // the game never scales. Promised Renewal is the confirmed case, and the
  // user expects more to turn up, so this is a per-buff opt-out flag on the
  // roster rather than a hardcoded list of names.
  //
  // Without it the only lever was the global multiplier, which is all-or-
  // nothing: correcting one unscaled spell would have thrown out the scaling
  // every other buff genuinely needs.
  // KNOWN DEFECT, DELIBERATELY LEFT IN PLACE PENDING A DECISION - see FEATURES.md note 24.
  //
  // 275 of the 1,052 roster entries carry a landing text and NO durationSec. Multiplying an
  // absent duration gives NaN, that becomes expiresAt, and the sweep in _tick asks
  // `expiresAt <= now` - which is false for NaN, forever. So one of those landing produces a
  // tile reading "NaN:NaN" that never counts down and cannot be dismissed without a restart.
  // Forty-five of those spells' landing texts appear in the owner's real logs.
  //
  // It was fixed by refusing to land them, and the fix was REVERTED after measuring it: across
  // 1.6 million lines that removed 67 distinct spells and 18,405 landings. Most are instants
  // (29 nukes, 7 heals) that should never have had a timer - but 31 are real buffs, including
  // Armor of Protection, Barbcoat, Fury, Wolf Form and Shrink, and dropping those is a loss.
  //
  // Every option here trades one wrong behaviour for another, so it is the owner's call, not a
  // decision to make quietly inside a helper. The shape that loses least: land a no-duration
  // spell that HAS an ended text with no countdown at all and let its ended text remove it (18
  // of the 31 qualify), and refuse the rest. That needs the overlay to draw a tile with no
  // timer, which is a real change rather than a guard.
  _scaledDuration(entry) {
    const multiplier = entry.noDurationScaling ? 1 : this.durationMultiplierFn();
    return Math.round(entry.durationSec * multiplier);
  }

  _land(known) {
    if (this.blockedNames.has(known.name.toLowerCase())) {
      this._debugLog(`BLOCKED "${known.name}" - landing suppressed, you chose "No longer track" for this buff`);
      return;
    }
    const key = known.name.toLowerCase();
    // A spell that genuinely never runs out - Yaulp, Fury - marked in tools/roster-overrides.json,
    // which is also where to add more. It is a different thing from a spell the spreadsheet simply
    // has no duration for: this one lasts until it is dispelled, or you zone, or its ended text
    // arrives. null rather than Infinity, because Infinity survives arithmetic and would quietly
    // produce an Infinity countdown somewhere downstream; null cannot be mistaken for a number.
    if (known.infiniteDuration) {
      this.activeBuffs.set(key, {
        name: known.name,
        durationSec: null,
        expiresAt: null,
        infinite: true,
        endedText: known.endedText || null,
      });
      this.emit('buffsChanged', this.getActiveBuffs());
      return;
    }
    const effectiveDurationSec = this._scaledDuration(known);
    // AN INSTANT. The roster has no duration for it and it is not marked as lasting forever, so it
    // is something that happens rather than something that runs - a nuke, a heal, a gate.
    //
    // Shara's rule: "genuine no duration spells should not be tracked for duration based auras...
    // but can be added to instance based tracking such as sounds, and text only." So it still
    // LANDS, because that is how a sound or text aura hears about it at all, and the overlay is
    // what refuses to draw it as a countdown tile.
    //
    // It gets a short life rather than none, and that number is a display choice rather than a
    // claim about the game: a text aura has to have something on screen long enough to read, and
    // an event with no duration would otherwise vanish in the same tick it arrived. Everything
    // else about it is honest - durationSec stays null so nothing can render a countdown from it.
    if (!Number.isFinite(effectiveDurationSec)) {
      this.activeBuffs.set(key, {
        name: known.name,
        durationSec: null,
        expiresAt: Date.now() + INSTANT_RETENTION_SEC * 1000,
        // When it happened, so an aura can show it for its own chosen number of seconds - and so a
        // second cast can be told apart from the first one still sitting in the list, which is
        // what makes the sound fire again rather than once.
        landedAt: Date.now(),
        instant: true,
        endedText: known.endedText || null,
      });
      this.emit('buffsChanged', this.getActiveBuffs());
      return;
    }
    this.activeBuffs.set(key, {
      name: known.name,
      durationSec: effectiveDurationSec,
      expiresAt: Date.now() + effectiveDurationSec * 1000,
      endedText: known.endedText || null,
    });
    this.emit('buffsChanged', this.getActiveBuffs());
  }

  // Ally-buff equivalent of _land() - same blocked-name guard (blocking a
  // buff stops tracking it everywhere, not just for yourself), same
  // duration-multiplier application, but keyed by (ally, buff) and with no
  // endedText - see the allyBuffs field comment in the constructor.
  _landOnAlly(known, allyName) {
    if (this.blockedNames.has(known.name.toLowerCase())) {
      this._debugLog(`BLOCKED ally landing "${known.name}" on "${allyName}" - you chose "No longer track" for this buff`);
      return;
    }
    const key = `${allyName.toLowerCase()}::${known.name.toLowerCase()}`;
    const onEnemy = this._isEnemySpell(known);
    if (known.infiniteDuration) {
      this.allyBuffs.set(key, {
        name: known.name,
        allyName,
        durationSec: null,
        expiresAt: null,
        infinite: true,
        onEnemy,
      });
      this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
      return;
    }
    const effectiveDurationSec = this._scaledDuration(known);
    if (!Number.isFinite(effectiveDurationSec)) {
      this.allyBuffs.set(key, {
        name: known.name,
        allyName,
        durationSec: null,
        expiresAt: Date.now() + INSTANT_RETENTION_SEC * 1000,
        // When it happened, so an aura can show it for its own chosen number of seconds - and so a
        // second cast can be told apart from the first one still sitting in the list, which is
        // what makes the sound fire again rather than once.
        landedAt: Date.now(),
        instant: true,
        onEnemy,
      });
      this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
      return;
    }
    this.allyBuffs.set(key, {
      name: known.name,
      allyName,
      durationSec: effectiveDurationSec,
      expiresAt: Date.now() + effectiveDurationSec * 1000,
      onEnemy,
    });
    this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
  }

  // Called when the user assigns a duration (and optionally landing/ended
  // text) to something in the unknown list. Saves it to the buff database
  // AND starts tracking it immediately, since it just landed.
  resolveUnknown(name, durationSec, options = {}) {
    const entry = this.buffStore.upsert(name, durationSec, options);
    const key = name.toLowerCase();
    this.unknownBuffs.delete(key);
    const effectiveDurationSec = this._scaledDuration(entry);
    this.activeBuffs.set(key, {
      name: entry.name,
      durationSec: effectiveDurationSec,
      expiresAt: Date.now() + effectiveDurationSec * 1000,
      endedText: entry.endedText || null,
    });
    this.emit('unknownBuffsChanged', this.getUnknownBuffs());
    this.emit('buffsChanged', this.getActiveBuffs());
  }

  dismissUnknown(name) {
    const key = name.toLowerCase();
    this.unknownBuffs.delete(key);
    this.emit('unknownBuffsChanged', this.getUnknownBuffs());
  }

  removeActiveBuff(name) {
    this.activeBuffs.delete(name.toLowerCase());
    this.emit('buffsChanged', this.getActiveBuffs());
  }

  removeActiveAllyBuff(allyName, name) {
    this.allyBuffs.delete(`${allyName.toLowerCase()}::${name.toLowerCase()}`);
    this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
  }

  setBlockedNames(names) {
    this.blockedNames = new Map(names.map((n) => [n.toLowerCase(), n]));
  }

  // "No longer track" - stops this buff from ever landing again (see the
  // guard in _land()/_landOnAlly()) and clears it from both active lists
  // right now too, since blocking going forward doesn't retroactively
  // remove what's already showing.
  blockBuff(name) {
    this.blockedNames.set(name.toLowerCase(), name);
    this.activeBuffs.delete(name.toLowerCase());
    const lowerName = name.toLowerCase();
    for (const key of this.allyBuffs.keys()) {
      if (key.endsWith(`::${lowerName}`)) this.allyBuffs.delete(key);
    }
    this.emit('buffsChanged', this.getActiveBuffs());
    this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
    this.emit('blockedBuffsChanged', this.getBlockedBuffs());
  }

  unblockBuff(name) {
    this.blockedNames.delete(name.toLowerCase());
    this.emit('blockedBuffsChanged', this.getBlockedBuffs());
  }

  getBlockedBuffs() {
    return [...this.blockedNames.values()].sort((a, b) => a.localeCompare(b));
  }

  // isSelf tags which remembered-resolution bucket a click on this queued
  // entry should write to (see the two-map split on the constructor) - set
  // once here at queue time from whichever detection tier actually queued
  // it, not re-derived later. profileId (only meaningful when isSelf) is
  // the SAME idea applied to loadout profiles: whichever profile was
  // active the moment this was queued, so resolving it later always writes
  // to that profile's bucket even if the user has since switched profiles
  // - not whatever happens to be active at click time.
  // Asking "which bard song was that?" is pointless when no aura is showing
  // bard songs - the answer changes nothing visible, so it's pure interruption.
  // Songs are opt-in and off by default (see hideBardSongs in widgetStore.js),
  // which made this the common case rather than an edge one.
  //
  // Only suppresses when EVERY candidate is a song: a text shared between a
  // song and a regular buff still has a real answer worth having, since the
  // non-song outcome would display.
  _shouldSuppressAsHiddenBardSongs(candidates) {
    if (!candidates.length) return false;
    if (!candidates.every((c) => c.isBardSong)) return false;
    return !this.bardSongsVisibleFn();
  }

  // Injected by main.js - true when at least one on-screen aura would
  // actually display a bard song. Defaults to true so the engine keeps its
  // old behaviour standalone (e.g. in a plain Node test script) rather than
  // silently swallowing prompts when nothing wired it up.
  setBardSongsVisibleFn(fn) {
    this.bardSongsVisibleFn = fn;
  }

  _queueAmbiguousCast(text, candidates, isSelf) {
    if (this._shouldSuppressAsHiddenBardSongs(candidates)) {
      this._debugLog(
        `SKIPPED ambiguous "${text}" - every candidate is a bard song and no aura is showing bard songs`
      );
      return;
    }
    const existing = this.ambiguousCasts.get(text);
    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.isSelf = isSelf;
      existing.profileId = this.activeProfileId;
    } else {
      this.ambiguousCasts.set(text, {
        text,
        candidateNames: candidates.map((c) => c.name),
        lastSeenAt: Date.now(),
        isSelf,
        profileId: this.activeProfileId,
      });
    }
    this.emit('ambiguousCastsChanged', this.getAmbiguousCasts());
  }

  // Called when the user picks which buff an ambiguous cast actually was.
  // Remembered in the self or other bucket depending on which context
  // queued it (see _queueAmbiguousCast) - self resolutions persist across
  // party changes, other resolutions don't (see isPartyChangeLine
  // handling above).
  resolveAmbiguousCast(text, buffName) {
    const known = this.buffStore.getByName(buffName);
    if (!known) return;
    const queued = this.ambiguousCasts.get(text);
    const isSelf = queued ? queued.isSelf : true;
    if (isSelf) {
      // Writes to the profile that was active when this was QUEUED (tagged
      // in _queueAmbiguousCast), not whatever's active now - the user may
      // have switched profiles while this was still sitting unresolved.
      // Falls back to whatever's active now for an entry with no tag
      // (shouldn't happen post-migration, but matches the existing isSelf
      // fallback pattern just above for a missing queued entry).
      const profileId = queued && queued.profileId ? queued.profileId : this.activeProfileId;
      this._getOrCreateSelfResolutionsMap(profileId).set(text, buffName);
      this._saveSelfAmbiguousResolutions();
    } else {
      this.otherAmbiguousResolutions.set(text, buffName);
      this._saveOtherAmbiguousResolutions();
    }
    this.ambiguousCasts.delete(text);
    this._land(known);
    this.emit('ambiguousCastsChanged', this.getAmbiguousCasts());
  }

  dismissAmbiguousCast(text) {
    this.ambiguousCasts.delete(text);
    this.emit('ambiguousCastsChanged', this.getAmbiguousCasts());
  }

  // Saves every profile's bucket, not just the active one - a resolution
  // can be written to a non-active profile's bucket (see resolveAmbiguousCast)
  // so the active bucket alone isn't the whole picture.
  _saveSelfAmbiguousResolutions() {
    const serialized = Object.fromEntries(
      [...this.selfAmbiguousResolutionsByProfile.entries()].map(([profileId, map]) => [profileId, [...map.entries()]])
    );
    this.store.saveJson('selfAmbiguousResolutionsByProfile', serialized);
  }

  _saveOtherAmbiguousResolutions() {
    this.store.saveJson('otherAmbiguousResolutions', [...this.otherAmbiguousResolutions.entries()]);
  }

  // Manual escape hatch for every remembered "this ambiguous text means
  // buff X" resolution - the OTHER bucket entirely (same data
  // isPartyChangeLine already clears automatically), but only the ACTIVE
  // PROFILE's self bucket, not every profile's. Wiping every profile's
  // memory just because one loadout's answers went stale would defeat the
  // entire point of having separate profiles in the first place - a
  // resolution that turned out wrong belongs to whichever profile was
  // active when it was learned, so resetting scopes to that same profile.
  resetAmbiguousResolutions() {
    this.selfAmbiguousResolutions.clear();
    this.otherAmbiguousResolutions.clear();
    this._saveSelfAmbiguousResolutions();
    this._saveOtherAmbiguousResolutions();
  }

  // For the "view remembered choices" UI - one at a time, or search/filter
  // before deciding to reset everything with resetAmbiguousResolutions().
  // Self resolutions shown are the ACTIVE PROFILE's only (switching
  // profiles changes what this returns) - other resolutions aren't
  // profile-scoped at all, so that half is unaffected. Tagged so the UI can
  // show which is which - the same text can legitimately appear in both at
  // once (your own cast resolved one way, an unconfirmed ally's cast
  // resolved another).
  getAmbiguousResolutions() {
    const self = [...this.selfAmbiguousResolutions.entries()].map(([text, buffName]) => ({ text, buffName, isSelf: true }));
    const other = [...this.otherAmbiguousResolutions.entries()].map(([text, buffName]) => ({ text, buffName, isSelf: false }));
    return [...self, ...other].sort((a, b) => a.buffName.localeCompare(b.buffName));
  }

  removeAmbiguousResolution(text, isSelf) {
    if (isSelf) {
      this.selfAmbiguousResolutions.delete(text);
      this._saveSelfAmbiguousResolutions();
    } else {
      this.otherAmbiguousResolutions.delete(text);
      this._saveOtherAmbiguousResolutions();
    }
  }

  getAmbiguousCasts() {
    return [...this.ambiguousCasts.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  _tick() {
    const now = Date.now();
    for (const [key, buff] of this.activeBuffs) {
      // An infinite buff has no expiry to compare against and must survive every sweep - it ends
      // when its ended text arrives, when the player dismisses it, or not at all.
      if (buff.infinite) continue;
      if (buff.expiresAt <= now) this.activeBuffs.delete(key);
    }
    this.emit('buffsChanged', this.getActiveBuffs());

    for (const [key, buff] of this.allyBuffs) {
      // Same reasoning as the self sweep above - an ally can carry a buff that never runs out
      // too, and it has no expiry to compare against. Missing this half was caught by a test that
      // deliberately checked both maps rather than assuming one implied the other.
      if (buff.infinite) continue;
      if (buff.expiresAt <= now) this.allyBuffs.delete(key);
    }
    // Unconditional every tick, same as buffsChanged above - the overlay's
    // countdown text needs a fresh broadcast every second to visibly tick
    // down, not just when something actually expires. Emitting only on
    // expiry (tried this first) left ally-buff/custom-timer countdowns
    // frozen on screen except when some unrelated widget-config change
    // forced a full re-fetch.
    this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
  }

  // Read-only, for surfacing in the UI (see main-window.js) so a
  // misattribution like "this landed as my own cast but I know an ally cast
  // it" is actually diagnosable from the app itself instead of requiring a
  // log grep - also now a real input to detection (see the unique-landing-
  // text branch in handleLine). Prefers the roster's spelling where the spell
  // is a known buff, and otherwise falls back to the casing captured from the
  // log line itself (see the currentlyMemorized field comment) so an
  // unlisted spell still displays as "Rain of Spikes", not "rain of spikes".
  getCurrentlyMemorized() {
    return [...this.currentlyMemorized]
      .map(([lower, original]) => this.buffStore.getByName(lower)?.name || original || lower)
      .sort((a, b) => a.localeCompare(b));
  }

  // Several ranks of ONE spell sharing a landing text isn't real ambiguity -
  // it's the same buff either way, and asking "Shauri's Sonorous Clouding, I,
  // II or III?" is a question with no useful answer. Collapses them to the
  // lowest rank (see rankValue: an unsuffixed base name counts as 0, below
  // "I") so detection proceeds silently instead of prompting.
  //
  // Lowest rather than highest deliberately: it's the conservative guess for
  // duration, so a timer under-reads rather than showing a buff as still up
  // after it has actually dropped. The variants all stay in the roster - they
  // are real, separately-castable tiers - this only affects which one an
  // ambiguous landing resolves to.
  //
  // Only collapses when EVERY candidate shares one base name. A text shared
  // by genuinely different spells (plus, possibly, ranks of them) stays
  // ambiguous and still prompts, which is the "no guessing" rule this file
  // applies everywhere else.
  //
  // NOTE: tuned for EverQuest Legends specifically, where ranks observed so
  // far are pure power tiers of the same effect. A server where a numbered
  // variant is a meaningfully different spell would need this revisited - see
  // the rank-suffix gotcha in CLAUDE.md, which already documents that a bare
  // trailing numeral is NOT universally a rank.
  _collapseRankVariants(candidates) {
    if (candidates.length <= 1) return candidates;
    const base = stripRankSuffix(candidates[0].name).toLowerCase();
    const allSameSpell = candidates.every((c) => stripRankSuffix(c.name).toLowerCase() === base);
    if (!allSameSpell) return candidates;
    return [candidates.reduce((lowest, c) => (rankValue(c.name) < rankValue(lowest.name) ? c : lowest))];
  }

  // Raw internal entries (absolute expiresAt, not remaining seconds) for the
  // session snapshot - deliberately NOT getActiveBuffs(), which is a
  // display-shaped view: it resolves icons live, computes remainingSec, and
  // filters nothing. Restoring needs the storage shape back, unchanged.
  getSnapshotState() {
    return {
      selfBuffs: [...this.activeBuffs.values()],
      allyBuffs: [...this.allyBuffs.values()],
    };
  }

  // Puts saved entries back without re-running any detection. Anything past
  // its expiry has already been filtered out by sessionSnapshot.loadSnapshot,
  // and a blocked buff is dropped here in case the user blocked it between
  // sessions.
  restoreSnapshot({ selfBuffs = [], allyBuffs = [] }) {
    for (const buff of selfBuffs) {
      if (this.blockedNames.has(buff.name.toLowerCase())) continue;
      this.activeBuffs.set(buff.name.toLowerCase(), buff);
    }
    for (const buff of allyBuffs) {
      if (this.blockedNames.has(buff.name.toLowerCase())) continue;
      this.allyBuffs.set(`${buff.allyName.toLowerCase()}::${buff.name.toLowerCase()}`, buff);
    }
    if (selfBuffs.length) this.emit('buffsChanged', this.getActiveBuffs());
    if (allyBuffs.length) this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
    return selfBuffs.length + allyBuffs.length;
  }

  // Records a spell as memorized, keeping the picture to the fourteen real gem slots.
  //
  // The delete before the set is load-bearing and easy to miss: a Map does NOT move an existing
  // key to the end when you re-set it, so without the delete, re-memorizing a spell you already
  // had leaves it at its original position and the trim below would happily evict the gem you
  // just loaded while keeping one you swapped out ten minutes ago.
  _rememberMemorized(name) {
    const key = name.toLowerCase();
    this.currentlyMemorized.delete(key);
    this.currentlyMemorized.set(key, name);
    this._trimMemorized();
  }

  // Drops the stalest entries until the picture fits the gem bar. Map iterates in insertion
  // order, so the first key is the least recently seen.
  //
  // Whatever is dropped is always a guess - the overflow only exists because a "You forget X."
  // line was missed - but the stalest entry is the likeliest to be the wrong one, and a picture
  // that fits the bar is closer to the truth than one that cannot possibly be right.
  _trimMemorized() {
    let dropped = 0;
    while (this.currentlyMemorized.size > MAX_MEMORIZED_GEMS) {
      const oldest = this.currentlyMemorized.keys().next().value;
      this.currentlyMemorized.delete(oldest);
      dropped++;
    }
    if (dropped) {
      this._debugLog(`MEMORIZED TRIM dropped ${dropped} stale entr${dropped === 1 ? 'y' : 'ies'} - over ${MAX_MEMORIZED_GEMS} gems`);
    }
    return dropped;
  }

  _saveCurrentlyMemorized() {
    this.store.saveJson('currentlyMemorized', [...this.currentlyMemorized]);
  }

  // Manual correction for the persisted gem memory (see the field's comment).
  // Because the set now survives restarts it can be genuinely wrong rather
  // than merely empty - gems swapped while the app was closed leave it
  // remembering a spell that isn't loaded any more, which then acts as false
  // evidence in the detection tiers. The landing-page gem bar wires a click
  // on a gem to this.
  removeMemorized(name) {
    const lower = name.toLowerCase();
    if (!this.currentlyMemorized.delete(lower)) return false;
    this._saveCurrentlyMemorized();
    this.emit('memorizedChanged', this.getCurrentlyMemorized());
    return true;
  }

  clearMemorized() {
    if (this.currentlyMemorized.size === 0) return false;
    this.currentlyMemorized.clear();
    this._saveCurrentlyMemorized();
    this.emit('memorizedChanged', this.getCurrentlyMemorized());
    return true;
  }

  getActiveBuffs() {
    const now = Date.now();
    return [...this.activeBuffs.values()]
      .map((b) => {
        // Look the overlay/icon info up live (rather than caching it at
        // landing time) so editing it in the UI takes effect immediately.
        const known = this.buffStore.getByName(b.name);
        return {
          name: b.name,
          durationSec: b.durationSec,
          // null, not a number, for a buff that never runs out. Everything downstream checks for
          // it rather than trying to render a countdown that has no end.
          remainingSec: b.infinite || b.instant ? null : Math.max(0, Math.round((b.expiresAt - now) / 1000)),
          infinite: !!b.infinite,
          // An event rather than a running buff. The overlay uses this to keep it off auras that
          // draw countdowns, and to allow it on the two that do not.
          instant: !!b.instant,
          landedAt: b.landedAt || null,
          showOnOverlay: known ? known.showOnOverlay !== false : true,
          // != null, not a truthy check - icon id 0 is a real, pickable
          // icon (the picker's first thumbnail), not "no icon".
          iconUrl: known?.iconId != null ? this.iconUrlFn(known.iconId) : null,
          isBardSong: !!known?.isBardSong,
          // Note 37. The roster's own scaling category - buff, debuff, nuke, dot, heal, hot,
          // pet, charm - nine values, which is a legend someone can hold in their head where the
          // 109 fine-grained categories are not. Sent as a plain string and coloured by the
          // overlay; nothing in the main process cares what it looks like.
          spellCategory: known?.scaleCategory || null,
        };
      })
      // A buff that never runs out sorts LAST. remainingSec is null for those, and plain
      // subtraction would treat null as zero and put them at the top as if they were about to
      // expire - the opposite of the truth, in the position the eye goes to first.
      .sort((a, b) => {
        // Anything with no remaining time - infinite or instant - sorts LAST. remainingSec is null
        // for both, and plain subtraction treats null as zero, which would put them at the top as
        // if they were about to expire: the opposite of the truth, in the position the eye checks
        // first.
        const aNone = a.infinite || a.instant;
        const bNone = b.infinite || b.instant;
        if (aNone && bNone) return 0;
        if (aNone) return 1;
        if (bNone) return -1;
        return a.remainingSec - b.remainingSec;
      });
  }

  // Same shape as getActiveBuffs() plus allyName, so widget rendering code
  // can share formatting/filter logic between the two sources - see
  // widgetManager.js.
  getActiveAllyBuffs() {
    const now = Date.now();
    return [...this.allyBuffs.values()]
      .map((b) => {
        const known = this.buffStore.getByName(b.name);
        return {
          name: b.name,
          allyName: b.allyName,
          // Whether this landed on something you are fighting rather than on a groupmate. An aura
          // uses it to show one and not the other; nothing in the engine decides on it.
          onEnemy: !!b.onEnemy,
          // Somebody else started casting this. An aura shows it only if it asked to be warned;
          // see the allyCast filter in the overlay.
          allyCast: !!b.allyCast,
          durationSec: b.durationSec,
          // null, not a number, for a buff that never runs out. Everything downstream checks for
          // it rather than trying to render a countdown that has no end.
          remainingSec: b.infinite || b.instant ? null : Math.max(0, Math.round((b.expiresAt - now) / 1000)),
          infinite: !!b.infinite,
          // An event rather than a running buff. The overlay uses this to keep it off auras that
          // draw countdowns, and to allow it on the two that do not.
          instant: !!b.instant,
          landedAt: b.landedAt || null,
          showOnOverlay: known ? known.showOnOverlay !== false : true,
          // != null, not a truthy check - icon id 0 is a real, pickable
          // icon (the picker's first thumbnail), not "no icon".
          iconUrl: known?.iconId != null ? this.iconUrlFn(known.iconId) : null,
          isBardSong: !!known?.isBardSong,
          // Note 37. The roster's own scaling category - buff, debuff, nuke, dot, heal, hot,
          // pet, charm - nine values, which is a legend someone can hold in their head where the
          // 109 fine-grained categories are not. Sent as a plain string and coloured by the
          // overlay; nothing in the main process cares what it looks like.
          spellCategory: known?.scaleCategory || null,
        };
      })
      // A buff that never runs out sorts LAST. remainingSec is null for those, and plain
      // subtraction would treat null as zero and put them at the top as if they were about to
      // expire - the opposite of the truth, in the position the eye goes to first.
      .sort((a, b) => {
        // Anything with no remaining time - infinite or instant - sorts LAST. remainingSec is null
        // for both, and plain subtraction treats null as zero, which would put them at the top as
        // if they were about to expire: the opposite of the truth, in the position the eye checks
        // first.
        const aNone = a.infinite || a.instant;
        const bNone = b.infinite || b.instant;
        if (aNone && bNone) return 0;
        if (aNone) return 1;
        if (bNone) return -1;
        return a.remainingSec - b.remainingSec;
      });
  }

  getUnknownBuffs() {
    return [...this.unknownBuffs.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }
}

module.exports = { BuffEngine };
