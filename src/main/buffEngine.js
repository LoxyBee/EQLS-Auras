const { EventEmitter } = require('events');
const {
  matchCastBegin,
  matchSingingBegin,
  matchActivate,
  matchOtherCastBegin,
  matchMemorizeFinished,
  matchForgetSpell,
  matchGroupMemberJoined,
  matchGroupMemberLeft,
  matchGroupJoinAccepted,
  isFailureLine,
  isPartyChangeLine,
  looksLikeLandingMessage,
  stripTimestamp,
  FALLBACK_CONFIRM_WINDOW_MS,
  BURST_WINDOW_MS,
} = require('./buffParser');
const { DEFAULT_PROFILE_ID } = require('./profileStore');

const TICK_INTERVAL_MS = 1000;

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
    this.recentOtherCasts = new Set(); // lowercased spell name last seen cast by someone else, cleared on party change
    // lowercased spell name -> currently sitting in a gem slot (built from
    // "You forget X."/"You have finished memorizing X." lines - see
    // handleLine). Not persisted and not backfilled from history (same
    // "never replay the log" limitation as everything else here), so it
    // only reflects gem swaps made since the app started watching.
    this.currentlyMemorized = new Set();
    // Confirmed group members, lowercased name -> real-case name (from
    // "<Name> has joined the group." lines) - session-only like everything
    // else here, and bounds ally-buff detection to actual groupmates rather
    // than any name that happens to appear in a third-person landing line.
    // No way to discover members already in the group before the app
    // started watching or before the player joined - same "never replay
    // history" limitation as currentlyMemorized/recentOtherCasts.
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
      this.recentOtherCasts.add(otherCast.spellName.toLowerCase());
      this._checkForEndedBuffs(line);
      return;
    }

    // Gem swaps - you can only ever cast what's currently memorized, so
    // this is a stronger disambiguation signal than "ever scribed" (see
    // the ambiguous-candidates handling below, which checks this first).
    const forgotten = matchForgetSpell(line);
    if (forgotten) {
      this.currentlyMemorized.delete(forgotten.toLowerCase());
      this.emit('memorizedChanged', this.getCurrentlyMemorized());
      this._checkForEndedBuffs(line);
      return;
    }
    const memorized = matchMemorizeFinished(line);
    if (memorized) {
      this.currentlyMemorized.add(memorized.toLowerCase());
      this.emit('memorizedChanged', this.getCurrentlyMemorized());
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
    if (this.recentSelfCast && Date.now() < this.recentSelfCast.expiresAt && this.groupMembers.size > 0) {
      const known = this.buffStore.getByName(this.recentSelfCast.name);
      if (known && known.othersLandingSuffix) {
        for (const allyName of this.groupMembers.values()) {
          if (stripped === `${allyName}${known.othersLandingSuffix}`) {
            this._debugLog(`ALLY LANDED "${known.name}" on "${allyName}" - named cast, confirmed by third-person landing text`);
            this._landOnAlly(known, allyName);
            this._checkForEndedBuffs(line);
            return;
          }
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
          this._debugLog(`LANDED "${uniqueMatch.name}" - unique text, but recently cast by someone else; landed anyway (track others ON)`);
          this._land(uniqueMatch);
        } else {
          this._debugLog(`IGNORED "${uniqueMatch.name}" - unique text, recently cast by someone else, track others OFF`);
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
      const knownNotMemorized =
        !alreadyActive &&
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
      if (Date.now() < this.burstUntil) this.burstUntil = Date.now() + BURST_WINDOW_MS;
      this._debugLog(`LANDED "${uniqueMatch.name}" - unique landing text, no other-cast evidence`);
      this._land(uniqueMatch);
      this._checkForEndedBuffs(line);
      return;
    }

    // Ambiguous landing text (shared by multiple buffs).
    const candidates = this.buffStore.findAllByLandingText(stripped);
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
      const activeCandidate = candidates.find((c) => this.activeBuffs.has(c.name.toLowerCase()));
      if (activeCandidate && (!otherCastMatch || otherCastMatch.name === activeCandidate.name)) {
        this._debugLog(`RENEWED "${activeCandidate.name}" - ambiguous text "${stripped}" matches an already-active buff`);
        this._land(activeCandidate);
        this._checkForEndedBuffs(line);
        return;
      }

      // Checked before the broader "ever scribed" spellbook narrowing below -
      // you can only ever cast what's currently memorized in a gem slot, so
      // this is strictly stronger evidence. Matters most for spells that
      // share landing text with an older/different rank the player scribed
      // at some point in the past but doesn't have loaded right now (e.g.
      // several stat-buff ranks accumulated while leveling) - "ever
      // scribed" alone can't tell those apart, "currently memorized" can.
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
          this._debugLog(`LANDED "${otherCastMatch.name}" - confirmed via third-person cast line, track others ON`);
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
    for (const [key, buff] of this.activeBuffs) {
      if (buff.endedText && line.includes(buff.endedText)) {
        this.activeBuffs.delete(key);
        this.emit('buffsChanged', this.getActiveBuffs());
        return; // a line only ever reports one buff fading
      }
    }
  }

  _hasRecentOtherCast(name) {
    return this.recentOtherCasts.has(name.toLowerCase());
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
  _land(known) {
    if (this.blockedNames.has(known.name.toLowerCase())) {
      this._debugLog(`BLOCKED "${known.name}" - landing suppressed, you chose "No longer track" for this buff`);
      return;
    }
    const key = known.name.toLowerCase();
    const effectiveDurationSec = Math.round(known.durationSec * this.durationMultiplierFn());
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
    const effectiveDurationSec = Math.round(known.durationSec * this.durationMultiplierFn());
    this.allyBuffs.set(key, {
      name: known.name,
      allyName,
      durationSec: effectiveDurationSec,
      expiresAt: Date.now() + effectiveDurationSec * 1000,
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
    const effectiveDurationSec = Math.round(entry.durationSec * this.durationMultiplierFn());
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
  _queueAmbiguousCast(text, candidates, isSelf) {
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
      if (buff.expiresAt <= now) this.activeBuffs.delete(key);
    }
    this.emit('buffsChanged', this.getActiveBuffs());

    for (const [key, buff] of this.allyBuffs) {
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
  // text branch in handleLine). currentlyMemorized itself only ever stores
  // lowercased names (the matching key), so this looks each one up against
  // the roster for a properly-cased name to display - falls back to the
  // lowercased form for anything not in the roster (a custom/unlisted spell
  // can still be memorized and matched, just without a nicer display name).
  getCurrentlyMemorized() {
    return [...this.currentlyMemorized]
      .map((lower) => this.buffStore.getByName(lower)?.name || lower)
      .sort((a, b) => a.localeCompare(b));
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
          remainingSec: Math.max(0, Math.round((b.expiresAt - now) / 1000)),
          showOnOverlay: known ? known.showOnOverlay !== false : true,
          // != null, not a truthy check - icon id 0 is a real, pickable
          // icon (the picker's first thumbnail), not "no icon".
          iconUrl: known?.iconId != null ? this.iconUrlFn(known.iconId) : null,
          isBardSong: !!known?.isBardSong,
        };
      })
      .sort((a, b) => a.remainingSec - b.remainingSec);
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
          durationSec: b.durationSec,
          remainingSec: Math.max(0, Math.round((b.expiresAt - now) / 1000)),
          showOnOverlay: known ? known.showOnOverlay !== false : true,
          // != null, not a truthy check - icon id 0 is a real, pickable
          // icon (the picker's first thumbnail), not "no icon".
          iconUrl: known?.iconId != null ? this.iconUrlFn(known.iconId) : null,
          isBardSong: !!known?.isBardSong,
        };
      })
      .sort((a, b) => a.remainingSec - b.remainingSec);
  }

  getUnknownBuffs() {
    return [...this.unknownBuffs.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }
}

module.exports = { BuffEngine };
