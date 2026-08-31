const { EventEmitter } = require('events');
const {
  matchCastBegin,
  matchSingingBegin,
  matchActivate,
  matchOtherActivate,
  matchOtherCastBegin,
  matchMemorizeFinished,
  matchForgetSpell,
  matchHealBySpell,
  matchOthersWornOff,
  matchDidNotTakeHold,
  matchOverwritten,
  matchSlain,
  matchOwnDeath,
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

// How recently a spell must have finished memorizing to count as self-cast evidence for a bard
// song landing with no cast-begin line of its own - see _attributeBardSongCaster's own comment.
// Reported live: this server's auto-sing mechanic can start a bard song playing the instant it's
// memorized, with no "You begin singing X." line at all, so a genuine self-cast fell through to
// Unknown. 6s is generous enough to cover the memorize-to-first-tick gap without reaching back far
// enough to credit an unrelated later memorize to an earlier landing.
const BARD_MEMORIZE_ATTRIBUTION_WINDOW_MS = 6000;

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

// A buff whose roster `targets` is one of these can only ever land on a pet, an animal, a mob or a
// corpse - never on the player - so it is never a candidate for a landing message ON the player.
// Reported live: "You feel smaller." is shared by Shrink (targets Single) and Tiny Companion
// (targets Pet), and the disambiguation queued a prompt every time the player cast Shrink, offering
// a spell that is mechanically impossible on a player. A denylist rather than a Self/Group/Friendly
// allowlist so a custom entry with no `targets` set is still considered a candidate.
const NON_PLAYER_TARGETS = new Set(['Pet', 'Animal', 'Undead', 'Construct', 'Corpse', 'Plant']);

// Notes 11/17. Extra duration per mote tier, as a fraction of BASE - linear, not compounding. See
// _scaledDuration for the measurements behind each one and for which of them are still the
// spreadsheet's word rather than established fact.
//
// A category missing from here scales its duration not at all, which is the sheet's position for
// nuke, heal and pet summon. Written as an absent key rather than an explicit zero so that adding
// a category to the roster cannot silently inherit somebody else's rate.
const MOTE_DURATION_RATES = {
  buff: 0.1, // measured: Spirit of the Puma VII, n=24
  charm: 0.1, // sheet only - never observed running to its natural end
  debuff: 0.1, // sheet only, and the sheet itself marks it assumed
  hot: 0.05, // measured: Celestial Healing IV, n=32
  dot: 0.05, // sheet only
};

// P0c, 25 Aug. Per-tier CAST TIME scaling, from the mote spreadsheet's "Benefits by category"
// table - Shara supplied it directly (a screenshot of the sheet), unlike MOTE_DURATION_RATES
// above where only buff and hot were ever independently measured against her own logs. Every
// category here is sheet-only, same unmeasured status as the duration rates marked "sheet only".
// Nuke/lifetap is the one outlier at -2%/tier; every other category (dot, heal, hot, debuff,
// charm, pet, buff) is -4%/tier. `heal`, `nuke` and `pet` get no entry in MOTE_DURATION_RATES
// (nothing to scale - they're instant or have no self-duration) but DO get one here, because cast
// time is a real number for all of them regardless of whether the effect itself has a duration.
const CAST_TIME_RATES = {
  nuke: -0.02,
  dot: -0.04,
  heal: -0.04,
  hot: -0.04,
  debuff: -0.04,
  charm: -0.04,
  pet: -0.04,
  buff: -0.04,
};

// Slack allowed around the scaled cast time before the app gives up waiting/blind-confirms, to
// absorb the log's one-second timestamp resolution plus ordinary lag - Shara's own instruction:
// "assume some rounding error, so it needs a window either side," corrected 25 Aug to half a
// second each side rather than the wider first guess. There is currently only one place this
// actually applies it (the pendingCast timeout below), which only ever fires on the LATE side -
// nothing in this file currently rejects a landing for arriving suspiciously early, so the
// "either side" tolerance is realized as one wider wait rather than two separate bounds.
const CAST_TIME_TOLERANCE_MS = 500;

// Whether the AA and Exaltation duration bonus applies to a spell. Shara, 23 August: "the AA
// should only apply to things marked as a BUFF. not just any beneficial." Shara, 24 August,
// correcting a second mistake: "ALL buffs are supposed to be subject to these increases. i have
// stressed this since the beginning." So the actual rule is simpler than the code ever made it -
// every spell the spreadsheet's own `kind` column marks 'buff' gets the bonus, full stop.
//
// The mistake both times was reaching for this file's OWN finer-grained scaleCategory split
// instead of the sheet's kind column. First pass: had it as buff/heal/hot/pet by scaleCategory,
// on the reasoning that the bonus is for beneficial spells and those are the beneficial
// categories - inference dressed up as measurement, and Curse (a dot, kind 'det') proved it
// wrong by NOT scaling the way that wider set predicted. Second pass narrowed to
// scaleCategory:'buff' alone, which silently dropped every 'hot' too, even though all 16 of the
// roster's scaleCategory:'hot' entries - Celestial Healing, Celestial Remedy and the rest - are
// kind:'buff' on the sheet. scaleCategory exists for the UNRELATED reason of note 27's mote-tier
// rate (+5%/tier for a hot, +10%/tier for a plain buff, both measured separately); it was never
// meant to also gate AA eligibility, which the sheet's kind column already settles by itself.
//
// Checked directly against kind rather than scaleCategory below, so nothing needs a whitelist of
// scaleCategory strings to stay in sync with the sheet's own classification.
function isAAEligible(entry) {
  return entry && entry.kind === 'buff';
}

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

// Note 24's post-cast repeat check. A bard song re-lands on a fixed pulse and an ordinary buff
// does not, so a landing text that comes back one pulse later is a song and one that does not is
// a buff. That is the only signal in the log that separates them, and it needs no user at all.
//
// SIX SECONDS, measured rather than assumed: across the owner's 1,521,971 log lines, the gap
// between consecutive repeats of an identical line is 6s on 314,324 occasions - four times the
// next most common gap, and every one of the ten most repeated lines pulses at 6s. Shara said it
// was 6 and it is.
//
// The tolerance exists because the log's resolution is one second and a pulse can be reported a
// tick either side. Deliberately not wider: at +/-2 a slow rebuff cycle starts looking like a
// pulse.
//
// DORMANT ON THE CURRENT ROSTER, and worth knowing before anyone debugs why it never fires. The
// check can only decide a landing text shared between exactly one bard song and something that is
// not a song, and the rebuilt roster has NONE: 108 landing texts are shared by two or more spells
// and not one of them is that shape. The note was written against the old 11,337-entry roster,
// where the collision existed; note 35 removed it by replacing the roster rather than by fixing
// this. Kept because the ambiguity returns the moment a song is added whose landing text an
// ordinary spell already uses, and because the pulse interval itself is wanted elsewhere.
const SONG_PULSE_SEC = 6;
const SONG_PULSE_TOLERANCE_SEC = 1;

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
    // Same idea as burstUntil, but opened by an ALLY's own activation line ("Dovairous activates
    // Quick Buff.") rather than the player's. Reported live and confirmed straight from the log:
    // an ally's Quick-Buff-equivalent instant grant hit the whole group, including the player, with
    // no per-spell cast line for any of it - the exact shape gotchas #12/#18 document for the
    // player's OWN activation, just triggered by someone else. burstUntil is deliberately permissive
    // (an ability the PLAYER used is presumed to have genuinely granted what it landed); this one is
    // the opposite - it exists to make the unique-landing-text tier MORE cautious during the window,
    // not less, since every buff it grants belongs to whoever activated it, not the player.
    this.allyBurstUntil = 0;
    // P0b, first piece: WHO opened the ally burst, mirroring burstOpenedBy below but for the
    // ally-triggered case. Shara's answer on scope, 25 Aug: "track who likely did it, but it
    // shouldn't hit self buffs unless toggled on" - so this is recorded unconditionally (it's
    // cheap, and useful in the debug log either way), but only actually reaches a queued prompt
    // when trackOthersEnabled is on. See the useEvidenceModel handling in the unique-landing-text
    // tier for where it's read.
    this.allyBurstOpenedBy = null; // { casterName, ability, at } | null
    // Note 28. WHAT opened the current burst, and when. Nothing reads this to make a decision -
    // it exists only so the detection log can say where a burst-context landing came from.
    //
    // That is the whole reason note 28 has been stuck. "Ally Buffs showed a buff you never cast"
    // is almost certainly a burst crediting somebody else's cast to you, but the log line said
    // only "burst context" - so a report of it could not be told apart from a correct landing
    // without reproducing the whole session. Recording the origin means the NEXT occurrence is
    // diagnosable from the log she already has, instead of needing it to happen a third time.
    this.burstOpenedBy = null; // { text, at } | null
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
    //
    // PER-PROFILE, same reasoning and same shape as selfAmbiguousResolutionsByProfile above. A
    // loadout swap on this server prints NOTHING - confirmed by searching a real log across a
    // whole swap window and finding zero forget/memorize/loadout/class/spellbook lines at all -
    // so the old single flat map kept vouching for the PREVIOUS loadout's gems as if they were
    // still loaded, and confirmed live to land a wrong spell off exactly that stale evidence.
    // Scoping per profile doesn't detect the swap either (nothing does - see CLAUDE.md gotcha #9
    // on why a burst-detector for this was explicitly rejected), but it does mean the user's own
    // manual profile switch - which they already do for every loadout swap, to keep
    // selfAmbiguousResolutions correct - now also resets this evidence to empty ("we don't know")
    // instead of carrying over a different loadout's gems as false confidence.
    // profileId -> Map<lowercased name, original-case name>. Migrates the old flat single-map
    // format (pre-per-profile) into DEFAULT_PROFILE_ID's bucket exactly once, same migration
    // shape as selfAmbiguousResolutionsByProfile above.
    const memorizedByProfile = store.loadJson('currentlyMemorizedByProfile', null);
    if (memorizedByProfile) {
      this.currentlyMemorizedByProfile = new Map(
        Object.entries(memorizedByProfile).map(([profileId, entries]) => [profileId, new Map(entries)])
      );
    } else {
      // Tolerates the older flat array-of-names format as well as the [lower, original] pairs
      // format that came right before per-profile scoping.
      const legacy = (store.loadJson('currentlyMemorized', []) || []).map((entry) =>
        Array.isArray(entry) ? [entry[0], entry[1]] : [String(entry).toLowerCase(), String(entry)]
      );
      this.currentlyMemorizedByProfile = new Map([[DEFAULT_PROFILE_ID, new Map(legacy)]]);
      this.store.saveJson(
        'currentlyMemorizedByProfile',
        Object.fromEntries([...this.currentlyMemorizedByProfile].map(([profileId, map]) => [profileId, [...map.entries()]]))
      );
    }
    // Map rather than Set: keyed by lowercased name (every lookup in the
    // detection tiers is case-insensitive) but carrying the original casing
    // as the value, so a memorized spell that ISN'T in the buff roster - a
    // nuke, a heal - can still be displayed properly instead of rendering as
    // "rain of spikes". Roster spells get their casing from the roster; these
    // have no other source for it.
    //
    // Convenience reference to the active profile's bucket, same pattern as
    // selfAmbiguousResolutions above - kept as a real Map so every existing
    // .get/.set/.delete/.clear call site didn't need to change.
    this.currentlyMemorized = this._getOrCreateMemorizedMap(this.activeProfileId);
    // Runtime-only, never persisted, never profile-scoped like currentlyMemorized itself - it
    // only ever needs to answer "was this memorized a few seconds ago", not survive a restart or
    // a loadout switch. See _attributeBardSongCaster and BARD_MEMORIZE_ATTRIBUTION_WINDOW_MS.
    this.recentlyMemorizedAt = new Map(); // lowercased name -> Date.now() it finished memorizing
    // Trim on load as well as on insert. A store saved before the cap existed can already hold
    // more than fourteen, and capping only new arrivals would leave that file permanently over
    // the limit - it would never come down on its own, because entries are only removed by a
    // "You forget X." line for a gem the app may never see again. Healing it here means one
    // launch fixes it, with no reset button to find.
    for (const map of this.currentlyMemorizedByProfile.values()) {
      this._trimMemorized(map);
    }
    this._saveCurrentlyMemorized();
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
    // `${casterKeyLower}::${songNameLower}` -> { name, castBy, durationSec, expiresAt, endedText }
    // - bard songs currently active ON THE PLAYER, regardless of who cast them, for the dedicated
    // Bard Songs aura. Keyed the same shape as allyBuffs (by caster, not just by name) so two
    // different casters maintaining the same song on the player are two entries, not one
    // overwriting the other - unlike activeBuffs below, which is name-only and can't distinguish
    // that. castBy is 'You', a real ally name, or null (attribution unknown - see
    // _attributeBardSongCaster). Populated additively from _land() alongside activeBuffs, not
    // instead of it - this never changes what lands as a self buff, it only ever adds a second,
    // caster-aware observation of the same landing for isBardSong entries specifically.
    this.bardSongs = new Map();
    // Lowercased song name -> true, for songs the memorize-window tier has ever confirmed as the
    // player's own (see _attributeBardSongCaster and BARD_MEMORIZE_ATTRIBUTION_WINDOW_MS).
    // Requested directly: once caught being memorized right before an auto-sung landing, that
    // should count as confirmed for as long as the spell STAYS memorized, not just for the 6s
    // window - "it should stay that way until you unmem it." Cleared alongside currentlyMemorized
    // itself (forget line, manual gem-bar correction, or "Forget all") so a re-memorize of the
    // same name later needs its own fresh confirmation rather than trusting a stale one.
    //
    // Profile-scoped the same way currentlyMemorized itself is (see that field's own comment and
    // gotcha #9) - runtime-only, not persisted, since it's derived confidence rather than data:
    // carrying a confirmation across a loadout swap would be exactly the false-confidence bug that
    // scoping currentlyMemorized per profile already exists to prevent.
    this.bardSongConfirmedMineByProfile = new Map();
    this.bardSongConfirmedMine = this._getOrCreateBardSongConfirmedSet(this.activeProfileId);
    this.blockedNames = new Map(); // lowercased name -> original-case name, see blockBuff()
    this.spellbookCheckFn = null; // (name) => boolean
    this.trackOthersEnabled = false;
    // P0 rework, off by default and independently switchable - see setUseEvidenceModel. Changes
    // exactly one thing: in the unique-landing-text tier, "not currently memorized"/"an ally's
    // burst just fired" stop being able to silently IGNORE a match on their own. They still count
    // against it, but the outcome becomes a queued prompt instead of a silent drop - a genuine
    // spellbook absence (neverScribed) is untouched either way, since that one is real negative
    // evidence, not just an absence of positive evidence. See CLAUDE.md's P0 section for the full
    // reasoning; kept behind a toggle specifically so a live regression can be reverted with one
    // click rather than a rebuild.
    this.useEvidenceModel = false;
    // P0c, off by default - its own switch, independent of useEvidenceModel above, so either can
    // be reverted without touching the other. See CAST_TIME_RATES/_scaledCastSec for what this
    // changes: the pendingCast timeout below (both the "confirmed by timeout fallback" branch and
    // the "expected text never showed up" cancel branch) uses the spell's own scaled cast time
    // instead of one flat 12s window for every spell, when the roster has a castSec for it.
    this.useCastTimeFilter = false;
    // Spell Casting Deftness (AA, 3 ranks: 10/25/50%) - confirmed live via the AA window, 25 Aug,
    // after an initial misread that called it "Subtlety" at a nonexistent rank 4/6. It "reduces the
    // cast time of beneficial spells that have a duration and an initial cast time of at least 3
    // seconds". This is a SECOND multiplier on top of CAST_TIME_RATES' per-mote-tier rate, the same
    // two-multiplier shape duration already has (mote tier x AA/Exaltation) - the character's own
    // rank 1 (10%) is what closed the gap between the mote-only prediction (2.16s for Spirit of the
    // Puma VII, before this existed) and the real in-game value (1.94s) seen on that character. See
    // setCastTimeMultiplierFn.
    this.castTimeMultiplierFn = () => 1;
    // Note 26, off by default - see setStackVerdictFn and _land()'s use of it. EQ prints an
    // explicit "has been overwritten" line for a buff overwritten on someone ELSE, but nothing at
    // all for one overwritten on the player's own self - so when a newly-landed self-buff would, by
    // the game's own stacking rule, silently replace one already active (see src/main/
    // spellStacking.js), this removes the stale one immediately instead of leaving it to time out
    // on its own or be misattributed later by a shared fade-text line. Injected as a function, same
    // DI reasoning as spellbookCheckFn - this engine has to keep running in a plain Node test and in
    // tools/replay-log.js, neither of which has the game's install files to read.
    this.stackVerdictFn = null; // (activeSpellId, incomingSpellId) => { overwrites, why } | null
    this.useStackingModel = false;
    // The heading model (docs/BUFF-STACKING.md, src/shared/buffLines.js). (incomingName, activeName)
    // => 'overwrites' | 'blocked' | 'coexist' | 'unknown'. Runs UNCONDITIONALLY in _land() for the
    // 'overwrites' verdict - those come from a measured "did not take hold" pair in a real log, or a
    // strict same-line tier bump (Yaulp III over Yaulp II), neither of which is a guess. The
    // effect-slot heuristic above stays behind useStackingModel for the pairs the line data does not
    // cover ('unknown').
    this.lineStackFn = null; // set by main.js from buffLines.stackDecision
    this.durationMultiplierFn = () => 1;
    this.iconUrlFn = (iconId) => `eqicon://icon/Alternate%201/${iconId}`;
    this.debugLogFn = null; // (message) => void - see setDebugLogFn
    this.bardSongsVisibleFn = () => true; // see setBardSongsVisibleFn
    this.bardSongDebuffsWantedFn = () => false; // #29 - see setBardSongDebuffsWantedFn
    this.tickTimer = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  // Lets an external module (character trait bonuses) scale how long a
  // landed buff is tracked for, without buffEngine needing to know anything
  // about AAs/exaltation itself.
  setDurationMultiplierFn(fn) {
    this.durationMultiplierFn = fn;
  }

  // fn() => the Spell Casting Deftness multiplier (e.g. 0.9 for the confirmed rank 1, 10%
  // reduction). See the constructor comment on castTimeMultiplierFn for what confirmed this.
  setCastTimeMultiplierFn(fn) {
    this.castTimeMultiplierFn = fn;
  }

  // fn(activeSpellId, incomingSpellId) => { overwrites, why } | null - see the constructor comment
  // on stackVerdictFn and _land()'s use of it.
  setStackVerdictFn(fn) {
    this.stackVerdictFn = fn;
  }

  setUseStackingModel(enabled) {
    this.useStackingModel = enabled;
  }

  // fn(incomingName, activeName) => 'overwrites' | 'blocked' | 'coexist' | 'unknown'. See the
  // constructor comment on lineStackFn and _land()'s use of it.
  setLineStackFn(fn) {
    this.lineStackFn = fn;
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

  // Note 40. Same shape as enemyDebuffNamesFn above, but for a Custom debuff
  // aura's "ally" mode: spells the aura wants tracked on an enemy WITHOUT
  // requiring the player to be the one who cast them. Deliberately a
  // separate set rather than a flag on the existing one, because the two
  // modes gate different code paths below - self mode still needs
  // recentSelfCast/the burst window, ally mode skips that gate entirely.
  // Shara's own words: "the name doesn't matter for now, just have it
  // tracked that a debuff happened from someone" - so unlike allyBuffs'
  // named-cast path this never records who cast it, only that the debuff
  // landed.
  setAllyEnemyDebuffNamesFn(fn) {
    this.allyEnemyDebuffNamesFn = fn;
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

  // True if EITHER mode's aura has asked for this spell on enemies - the mob-name
  // relaxation this gates exists to widen what counts as a valid recipient, and
  // that widening is needed the same way regardless of who is expected to have
  // cast it.
  _isWatchedOnEnemies(name) {
    const lower = name.toLowerCase();
    if (this.enemyDebuffNamesFn) {
      const names = this.enemyDebuffNamesFn();
      if (names && names.has(lower)) return true;
    }
    if (this.allyEnemyDebuffNamesFn) {
      const names = this.allyEnemyDebuffNamesFn();
      if (names && names.has(lower)) return true;
    }
    return false;
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
  // and currentlyMemorized at the new profile's own bucket. Nothing is
  // cleared or guessed: a profile the app hasn't seen before just starts
  // with an empty bucket, exactly like a brand new install would. For
  // currentlyMemorized specifically, that empty start is the actual fix -
  // see the field's comment on why carrying a DIFFERENT profile's gems
  // across a loadout swap was confirmed live to land the wrong buff.
  setActiveProfileId(profileId) {
    if (profileId === this.activeProfileId) return;
    this.activeProfileId = profileId;
    this.selfAmbiguousResolutions = this._getOrCreateSelfResolutionsMap(profileId);
    this.currentlyMemorized = this._getOrCreateMemorizedMap(profileId);
    this.bardSongConfirmedMine = this._getOrCreateBardSongConfirmedSet(profileId);
    this.emit('memorizedChanged', this.getCurrentlyMemorized());
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
    this.currentlyMemorizedByProfile.delete(profileId);
    this.bardSongConfirmedMineByProfile.delete(profileId);
    if (profileId === this.activeProfileId) {
      // this.selfAmbiguousResolutions/currentlyMemorized were direct
      // references to the Map objects just detached above - deleting them
      // from the outer maps doesn't clear these inner Maps, so without this
      // they would keep silently serving stale answers until the caller
      // calls setActiveProfileId() with the real replacement. Doesn't rely
      // on that call happening immediately (main.js does, right after, but
      // this stays correct on its own either way).
      this.selfAmbiguousResolutions = new Map();
      this.currentlyMemorized = new Map();
      this.bardSongConfirmedMine = new Set();
    }
    this._saveSelfAmbiguousResolutions();
    this._saveCurrentlyMemorized();
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

  // See the constructor comment above this.useEvidenceModel for exactly what this changes.
  // Nothing here needs to clear/reset anything - it only affects which branch a future line takes.
  setUseEvidenceModel(enabled) {
    this.useEvidenceModel = enabled;
  }

  // See the constructor comment above this.useCastTimeFilter. A pendingCast timer already running
  // when this is flipped keeps its original duration - only the NEXT cast begin picks up the new
  // setting, same as every other toggle in this file.
  setUseCastTimeFilter(enabled) {
    this.useCastTimeFilter = enabled;
  }

  stop() {
    clearInterval(this.tickTimer);
    this._cancelPendingCast();
  }

  handleLine(line) {
    const stripped = stripTimestamp(line);
    this._noteRefusedCast(line);

    // Backlog #12 - death strips every buff and song. The game clears them all; if you rez you
    // come back with none unless something restores them, and those re-register here like any
    // other landing. The line carries nothing else any tier below reads, so clear the lot and stop.
    if (matchOwnDeath(line)) {
      this._clearOnDeath();
      return;
    }

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
      // Only set where a burst BEGINS, never where one is extended - the extensions are all
      // downstream landings of the same burst, and overwriting this with each of them would erase
      // the one fact worth logging.
      this.burstOpenedBy = { text: activated, at: Date.now() };
      // Reported live: "Amplification II" (an AA-activated bard buff, "You activate Amplification
      // II.") landed at 50s instead of the true 60s shown in its own tooltip (base 30, AA+
      // Exaltation 65% -> 49.5 -> 50; the missing piece is the mote-rank bonus for rank II, which
      // would take it to the confirmed 60). Root cause: _rankForEntry() only ever reads
      // pendingCast/recentSelfCast, and this branch never set either - matchCastBegin's own
      // handler two hundred lines below sets recentSelfCast for a "casting"/"singing" begin line,
      // but an "activate" line fell through this untouched. So the rank in "Amplification II" was
      // being read correctly off the log line and then thrown away, exactly as if the numeral had
      // never been there. Confirmed as a real bug and not a display artefact: "duration based buff
      // songs scale with motes" - the owner's own words, so the tier bonus is real and was simply
      // never reaching activated abilities. Fixed the same way matchCastBegin's own landing does -
      // recentSelfCast specifically, not pendingCast, since pendingCast's confirm/cancel machinery
      // assumes one specific expected landing text, which is exactly wrong for something like Quick
      // Buff (also an "activate" line) that deliberately drops many buffs with no per-buff cast
      // line at all. recentSelfCast is pure lookup evidence for _rankForEntry, keyed by name after
      // rank-suffix stripping - Quick Buff's own granted buffs never share ITS name, so this cannot
      // misattribute a rank onto an unrelated burst-landed buff; it only ever fires for a landing
      // that is, by name, the very thing that was just activated.
      this.recentSelfCast = { name: activated, expiresAt: Date.now() + FALLBACK_CONFIRM_WINDOW_MS };
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

    // Confirmed straight from the log after the fix below: "Dovairous activates Quick Buff." -
    // an ally triggering the same instant multi-grant ability matchActivate exists for, just from
    // someone else. Opens allyBurstUntil (see the constructor comment) so the unique-landing-text
    // tier gets MORE cautious for the next few seconds, not less - every buff a burst like this
    // drops belongs to whoever activated it, and there is no per-spell name to check evidence
    // against the way a named cast has.
    const otherActivate = matchOtherActivate(line);
    if (otherActivate) {
      this.allyBurstUntil = Date.now() + BURST_WINDOW_MS;
      this.allyBurstOpenedBy = { casterName: otherActivate.casterName, ability: otherActivate.abilityName, at: Date.now() };
      this._debugLog(`ALLY ACTIVATE "${otherActivate.abilityName}" by "${otherActivate.casterName}" - self-buff landings are suspect for the next few seconds`);
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
      this.bardSongConfirmedMine.delete(forgotten.toLowerCase());
      // Also clears the raw memorize-window evidence itself (not just the durable confirmation
      // built from it) - otherwise a forget arriving within BARD_MEMORIZE_ATTRIBUTION_WINDOW_MS of
      // the original memorize could immediately re-confirm the very attribution just cleared.
      this.recentlyMemorizedAt.delete(forgotten.toLowerCase());
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
            `ALLY AMBIGUOUS "${suffix}" on "${allyName}" - burst context${this._burstOrigin()}, ${matches.length} candidates: ${matches.map((c) => c.name).join(', ')}`
          );
        } else if (matches.length === 1) {
          // Keep the burst alive the same way the self tiers do - a long
          // multi-buff burst shouldn't time out partway through just because
          // several of its landings went to other people.
          this.burstUntil = Date.now() + BURST_WINDOW_MS;
          this._debugLog(
            `ALLY LANDED "${matches[0].name}" on "${allyName}" - burst context${this._burstOrigin()}, unique third-person landing text`
          );
          this._landOnAlly(matches[0], allyName);
          this._checkForEndedBuffs(line);
          return;
        }
      }
    }

    // Reported live 24 Aug, and root-caused from the raw log rather than guessed: Insight (an
    // Enchanter buff) landed and stayed on a BRD/CLF player's Self Buffs, from an ally's own
    // instant multi-grant burst (see the ALLY ACTIVATE handling above and gotchas #12/#18) that
    // produced no per-spell cast line at all. What DID appear in the log for it was several other
    // people's third-person landing suffix for the exact same spell - "Kibobab's mind sharpens.",
    // "Avenrae's mind sharpens." - in the same second as "Your mind sharpens." on the player. The
    // two tiers just above already know how to read this shape of line; this reads it too, for
    // its own sake, when NEITHER of them already claimed it.
    //
    // That ordering is not incidental - it is the fix for a second bug this one could have caused.
    // Reported directly: "buffs are aoe, so buffs landing on others does not mean it is their
    // quick buff." Correct - if the PLAYER casts a group buff, its third-person suffix lands on
    // every groupmate too, and that is not evidence someone ELSE cast it. The two tiers above
    // already handle exactly that case (recentSelfCast for a named cast, burstUntil for the
    // player's own instant grant) and RETURN once they do - so by the time control reaches here,
    // any third-person landing that the player's own recent action already explains is gone,
    // consumed by whichever of those two tiers recognized it. What's left here is only the
    // remainder: a third-person landing with no self-cast/self-burst explanation on file at all -
    // which is exactly the ally-triggered-burst case this fix exists for.
    //
    // Recorded as evidence rather than attributed to anyone - nobody here knows WHO cast it, and
    // P0b's answer to that (recording who, not just suppressing) is real future work, not this
    // fix - but seeing the same spell's suffix land on someone else this recently, unexplained by
    // anything the player just did, is exactly the strength of evidence _hasRecentOtherCast
    // already trusted from a cast-begin line. A single unambiguous suffix match only, same bar the
    // two tiers above hold themselves to.
    const unexplainedThirdPerson = /^([A-Za-z]+)( .+)$/.exec(stripped);
    if (unexplainedThirdPerson) {
      const otherSuffixMatches = this.buffStore.findAllByOthersLandingSuffix(unexplainedThirdPerson[2]);
      if (otherSuffixMatches.length === 1) {
        this.recentOtherCasts.set(otherSuffixMatches[0].name.toLowerCase(), unexplainedThirdPerson[1]);
      }
    }

    // Note 40: a Custom debuff aura's "ally" mode - the same debuff-on-enemy
    // landing text as the self-mode tier above, but for spells an aura has
    // explicitly asked to watch WITHOUT expecting the player to be the
    // caster. No recentSelfCast/burst gate at all, on purpose: the whole
    // point of this mode is that the player is not the one casting it, so
    // gating on evidence of her own cast would defeat it. Caster identity is
    // not captured - Shara asked only that the debuff be tracked, not who
    // cast it - so this can't be folded into the ally-buff tiers above,
    // which exist specifically to attribute a landing to a groupmate.
    if (this.allyEnemyDebuffNamesFn) {
      const allyEnemyNames = this.allyEnemyDebuffNamesFn();
      if (allyEnemyNames && allyEnemyNames.size) {
        for (const lowerName of allyEnemyNames) {
          const known = this.buffStore.getByName(lowerName);
          if (!known || !known.othersLandingSuffix) continue;
          if (!stripped.endsWith(known.othersLandingSuffix)) continue;
          const targetName = stripped.slice(0, -known.othersLandingSuffix.length);
          if (!this._isValidRecipient(targetName, known)) continue;
          this._debugLog(
            `ENEMY DEBUFF LANDED "${known.name}" on "${targetName}" - watched as ally-cast, third-person landing text`
          );
          this._landOnAlly(known, targetName);
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
      // Bard songs get every soft/hard "might be someone else's" veto in this tier waived,
      // regardless of the global "Track buffs cast on me by others" toggle. Shara, 25 Aug, after
      // watching a real bard song get vetoed live: "bard songs should have this enabled by default
      // as you cannot separate them." That's not a settings request - it's the same conclusion
      // CLAUDE.md's P1 section already reached (self-vs-ally is genuinely undecidable for songs
      // from the log alone), now applied to the vetoes that were built for spells where it IS
      // decidable. Landing unconditionally is what makes the Bard Songs aura's own attribution
      // (_attributeBardSongCaster, You/an ally/Unknown) the actual answer to "whose is this",
      // instead of the log silently dropping half the evidence before that code ever runs.
      const trackOthersForThis = this.trackOthersEnabled || !!uniqueMatch.isBardSong;
      if (this._hasRecentOtherCast(uniqueMatch.name)) {
        if (trackOthersForThis) {
          // The caster goes in double quotes deliberately: tools/replay-log.js normalises every
          // debug line by blanking quoted spans before tallying, so a quoted name keeps the
          // before/after histogram comparable instead of making every row read as "changed".
          this._debugLog(
            `LANDED "${uniqueMatch.name}" - unique text, but recently cast by "${this._recentOtherCaster(uniqueMatch.name)}"; landed anyway (${this.trackOthersEnabled ? 'track others ON' : 'bard song'})`
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
      // Reported live 24 Aug: Insight (Enchanter-only, level 35) landed and stayed on a BRD/CLF
      // player's own Self Buffs list, with "Track buffs cast on me by others" OFF - "it should not
      // be put on me if it did not see my name cast it... this is a BASIC check from day 1."
      // Real gap: isMemorizableSpell gates the WHOLE currentlyMemorized check above, so a spell
      // this character's class could never scribe in the first place - not "unloaded right now",
      // never once in the book - skipped that check entirely and fell straight through to the
      // unconditional LANDED at the bottom of this block. The spellbook file only ever contains
      // spells this exact character's class can scribe, so absence from it altogether is stronger,
      // more reliable evidence than "not currently in a gem" (that one can go stale on a loadout
      // swap the log never reports - see the currentlyMemorized field comment. The file cannot).
      //
      // Known, accepted tradeoff: an item clicky can grant a buff whose real spell entry belongs to
      // a class the player isn't (a Cleric-flavoured trinket on a Bard, say), and that would now
      // read the same as "an ally cast this" - refused rather than tracked. There is currently no
      // way to tell "spell your class truly cannot scribe" apart from "clicky effect copying
      // another class's spell" from the log alone. If a clicky starts getting silently dropped,
      // that is the tradeoff showing up and needs its own signal, not a reason to revert this.
      const neverScribed = !!this.spellbookCheckFn && !isMemorizableSpell;
      // Confirmed straight from the log: "Dovairous activates Quick Buff." granted the whole group
      // a stack of buffs, Insight among them, with no per-spell cast line for any of it - see
      // allyBurstUntil's constructor comment. Unlike the player's OWN burst (inBurst, exempted via
      // !inBurst below), an ally's burst is the opposite kind of evidence: MORE reason for caution,
      // not less, since nothing here knows which of the buffs it dropped are even meant for the
      // player versus everyone else in the group.
      const alliesBursting = Date.now() < this.allyBurstUntil;
      const staleGem =
        isMemorizableSpell &&
        this.currentlyMemorized.size > 0 &&
        !this.currentlyMemorized.has(uniqueMatch.name.toLowerCase());
      const gate = !alreadyActive && !inBurst;

      // HARD veto: the spellbook file cannot go stale (see the comment above neverScribed), so a
      // class that truly can never scribe this spell is real negative evidence regardless of the
      // evidence-model toggle - the toggle only ever softens the two signals below, never this one.
      if (gate && neverScribed) {
        if (trackOthersForThis) {
          this._debugLog(`LANDED "${uniqueMatch.name}" - unique text, but never scribed by you at all; landed anyway (${this.trackOthersEnabled ? 'track others ON' : 'bard song'})`);
          this._land(uniqueMatch);
        } else {
          this._debugLog(`IGNORED "${uniqueMatch.name}" - unique text, never scribed by you at all, track others OFF`);
        }
        this._checkForEndedBuffs(line);
        return;
      }

      // SOFT negatives: an ally's burst having fired, or a gem not seen loaded this session,
      // neither one actually proves this landing isn't the player's own - both can be stale or
      // coincidental (see the currentlyMemorized field comment on why gems specifically can go
      // stale after a loadout swap the log never reports). Legacy behaviour (useEvidenceModel off)
      // still treats them as a hard veto, unchanged from before.
      //
      // With the model on, the two causes are NOT the same kind of uncertainty and P0b splits them:
      //   - staleGem is a question about the PLAYER's own cast (just weakly evidenced), so it always
      //     queues for you to confirm regardless of trackOthersEnabled - never a silent IGNORE, and
      //     never gated on the others-tracking setting, since it was never about someone else.
      //   - alliesBursting is genuinely a "was this actually an ally's, not mine" question - Shara's
      //     answer, 25 Aug: "track who likely did it, but it shouldn't hit self buffs unless toggled
      //     on". So the caster is recorded either way (allyBurstOpenedBy, cheap and useful in the
      //     debug log regardless), but it only ever reaches a queued prompt when trackOthersEnabled
      //     is on - with it off, this stays a silent IGNORE exactly like before, never a demoted
      //     prompt and never a silent self-land the way legacy's blind LAND used to do.
      if (gate && staleGem) {
        if (this.useEvidenceModel) {
          const remembered = this.selfAmbiguousResolutions.get(stripped);
          const rememberedBuff = remembered ? this.buffStore.getByName(remembered) : null;
          if (rememberedBuff) {
            this._debugLog(`LANDED "${rememberedBuff.name}" - remembered choice for "${stripped}" (your cast, soft evidence otherwise: not currently memorized by you)`);
            this._land(rememberedBuff);
          } else {
            // _queueAmbiguousCast itself decides and logs the outcome - a single candidate lands
            // directly (see its own comment on why a one-option prompt is never real ambiguity).
            this._queueAmbiguousCast(stripped, [uniqueMatch], true);
          }
        } else if (trackOthersForThis) {
          this._debugLog(`LANDED "${uniqueMatch.name}" - unique text, but not currently memorized by you; landed anyway (${this.trackOthersEnabled ? 'track others ON' : 'bard song'})`);
          this._land(uniqueMatch);
        } else {
          this._debugLog(`IGNORED "${uniqueMatch.name}" - unique text, not currently memorized by you, track others OFF`);
        }
        this._checkForEndedBuffs(line);
        return;
      }

      if (gate && alliesBursting) {
        if (this.useEvidenceModel && trackOthersForThis) {
          const remembered = this.otherAmbiguousResolutions.get(stripped);
          const rememberedBuff = remembered ? this.buffStore.getByName(remembered) : null;
          if (rememberedBuff) {
            this._debugLog(`LANDED "${rememberedBuff.name}" - remembered choice for "${stripped}" (others' buff, soft evidence otherwise: an ally's instant grant just fired)`);
            this._land(rememberedBuff);
          } else {
            // _queueAmbiguousCast itself decides and logs the outcome - a single candidate lands
            // directly, with the attribution folded into that same log line.
            const attributedTo = this.allyBurstOpenedBy ? this.allyBurstOpenedBy.casterName : null;
            this._queueAmbiguousCast(stripped, [uniqueMatch], false, attributedTo);
          }
          this._checkForEndedBuffs(line);
          return;
        }
        if (this.useEvidenceModel) {
          // trackOthersEnabled is off - this is fundamentally an ally-attribution question, and
          // "shouldn't hit self buffs unless toggled on" means it stays a silent IGNORE here, same
          // as legacy, rather than becoming a prompt nobody asked to see.
          this._debugLog(`IGNORED "${uniqueMatch.name}" - unique text, an ally's instant grant just fired, track others OFF`);
          this._checkForEndedBuffs(line);
          return;
        }
        // Only legacy (useEvidenceModel off) reaches here - both evidence-model branches above
        // already returned. This is the exact pre-P0b behaviour, unchanged.
        if (trackOthersForThis) {
          this._debugLog(`LANDED "${uniqueMatch.name}" - unique text, but an ally's instant grant just fired; landed anyway (${this.trackOthersEnabled ? 'track others ON' : 'bard song'})`);
          this._land(uniqueMatch);
        } else {
          this._debugLog(`IGNORED "${uniqueMatch.name}" - unique text, an ally's instant grant just fired, track others OFF`);
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
      // A debuff/dot/charm/nuke-category candidate is never self-targeted - these are always
      // cast AT something, never landed on the caster. Reported live: "You slow down." is shared
      // by three Slow debuffs (Languid Pace, Shiftless Deeds, Tepid Deeds); the player had
      // Languid Pace scribed (an ENC casts it at enemies), and the spellbook-narrow tier below
      // took "it's in my spellbook" as evidence the landing was cast ON the player - confidently
      // attributing a mob's slow to the player's own cast. Knowing a spell says nothing about
      // whether a line where its effect lands ON you is that spell's outgoing cast rather than
      // something else's incoming one, so every tier below that reasons "this must be my own
      // cast" is scoped to candidates that can legitimately land on their own caster in the
      // first place - which an enemy-only category never can.
      const selfPlausible = candidates.filter(
        (c) => !ENEMY_SPELL_CATEGORIES.has(c.scaleCategory) && !NON_PLAYER_TARGETS.has(c.targets)
      );
      const selfCandidates = this.spellbookCheckFn ? selfPlausible.filter((c) => this.spellbookCheckFn(c.name)) : [];

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
      const activeCandidate = selfPlausible.find((c) => {
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
      const memorizedCandidates = selfPlausible.filter((c) => this.currentlyMemorized.has(c.name.toLowerCase()));
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

      if (!otherCastMatch && inBurst && selfPlausible.length > 0) {
        // Landing during a burst the player themselves triggered ("You
        // activate X.") is presumed to be their own regardless of
        // spellbook - but which specific one it is remains genuinely
        // ambiguous with no per-buff cast line to go on, so this queues
        // for the user too (see hard rule above) rather than guessing
        // candidates[0]. A remembered resolution still applies directly.
        // Scoped to selfPlausible, not the raw candidate list - a burst is
        // evidence the PLAYER just triggered something, which still cannot
        // make an enemy-only category (a debuff/dot/charm/nuke) a plausible
        // answer for a line where the effect landed on them.
        this.burstUntil = Date.now() + BURST_WINDOW_MS;
        const remembered = this.selfAmbiguousResolutions.get(stripped);
        const rememberedBuff = remembered ? this.buffStore.getByName(remembered) : null;
        if (rememberedBuff) {
          this._debugLog(`LANDED "${rememberedBuff.name}" - remembered choice for "${stripped}" (your cast, burst)`);
          this._land(rememberedBuff);
        } else {
          this._debugLog(
            `QUEUED "${stripped}" for you - burst context, not in spellbook, ${selfPlausible.length} candidates: ${selfPlausible.map((c) => c.name).join(', ')}`
          );
          this._queueAmbiguousCast(stripped, selfPlausible, true);
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
      // P0c. Off by default (see this.useCastTimeFilter) - when on, and the roster has a castSec
      // for this spell, wait only as long as its own scaled cast time (+ rounding tolerance)
      // instead of one flat 12s for every spell regardless of how fast it actually casts. Falls
      // back to the old flat window whenever there's no castSec to scale, so a spell with no data
      // is never worse off than it is today.
      const scaledCastSec = this.useCastTimeFilter && known ? this._scaledCastSec(known, rankValue(castName)) : null;
      const confirmWindowMs = scaledCastSec != null ? Math.round(scaledCastSec * 1000) + CAST_TIME_TOLERANCE_MS : FALLBACK_CONFIRM_WINDOW_MS;
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
      }, confirmWindowMs);
      this._debugLog(
        `CAST BEGIN "${castName}" - ${known ? `known, expecting "${known.landingText || '(no known landing text)'}"` : 'not in roster'}` +
          (scaledCastSec != null ? ` (waiting ${(confirmWindowMs / 1000).toFixed(1)}s, cast-time filter ON)` : '')
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

  // Backlog #12. Death clears every self buff and every bard song on you - both maps hold only
  // "things currently on the player", and the player is dead. Buffs YOU cast on someone else
  // (allyBuffs) and debuffs on a mob (allyBuffs with onEnemy) are NOT touched: the ally is alive
  // and the mob's debuff has its own timer. Custom timers are cleared by customTimerEngine's own
  // death handling.
  _clearOnDeath() {
    let changed = false;
    if (this.activeBuffs.size) {
      this._debugLog(`DEATH - cleared ${this.activeBuffs.size} self buff(s)`);
      this.activeBuffs.clear();
      this.emit('buffsChanged', this.getActiveBuffs());
      changed = true;
    }
    if (this.bardSongs.size) {
      this._debugLog(`DEATH - cleared ${this.bardSongs.size} bard song(s)`);
      this.bardSongs.clear();
      this.emit('bardSongsChanged', this.getActiveBardSongs());
      changed = true;
    }
    // A pending cast the player was mid-way through cannot land now - clear its confirm timer too,
    // or it fires later and tries to confirm a buff on a corpse.
    if (this.pendingCast) {
      if (this.pendingCast.timer) clearTimeout(this.pendingCast.timer);
      this.pendingCast = null;
    }
    return changed;
  }

  _checkForEndedBuffs(line) {
    // Runs first, and does not return early, because it reads different line shapes from the self
    // loop below - letting one starve the other would be a silent, ordering-dependent bug.
    this._checkForEndedAllyBuffs(line);
    this._checkForEndedBardSongs(line);
    for (const [key, buff] of this.activeBuffs) {
      if (buff.endedText && line.includes(buff.endedText)) {
        this.activeBuffs.delete(key);
        this.emit('buffsChanged', this.getActiveBuffs());
        return; // a line only ever reports one buff fading
      }
    }
  }

  // Same shape as the self-buff loop just above, over the separate bardSongs map - a bard song's
  // endedText is whatever the roster already carries for it, same string either map would match.
  // Kept as its own small loop (not folded into the self loop) since bardSongs is keyed by
  // caster+name, not name alone, so more than one entry can legitimately share the same endedText
  // and both need checking, not just the first.
  _checkForEndedBardSongs(line) {
    let changed = false;
    for (const [key, song] of this.bardSongs) {
      if (song.endedText && line.includes(song.endedText)) {
        this.bardSongs.delete(key);
        changed = true;
        if (song.castBy === 'You' && this.bardSongConfirmedMine.has(song.name.toLowerCase())) {
          this._dropBardSongConfidence(song.name);
        }
      }
    }
    if (changed) this.emit('bardSongsChanged', this.getActiveBardSongs());
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

  // The one entry under this key has lost its debuff - dropped entirely, single tile.
  //
  // Returns true if anything changed, so callers can decide whether to emit.
  _dropOneInstance(key) {
    if (!this.allyBuffs.has(key)) return false;
    this.allyBuffs.delete(key);
    return true;
  }

  // A cast the game refused because something better is already there.
  //
  // Recorded on EVERY line, not only while a cast is pending. The first version of this sat inside
  // the pending-cast branch and caught 27 of the 189 in the owner's logs - the other 162 arrive
  // when nothing is pending, because a group-buff burst has no per-spell cast line to be pending
  // about. Those are exactly the ones worth having.
  //
  // It only WRITES TO THE LOG. Nothing is removed, and that is the important part: "did not take
  // hold" means the new cast failed, not that the old buff went anywhere. Eleven of these are
  // Talisman of Tnarg blocked by Talisman of Tnarg - a rebuff bouncing off one that is still
  // running - and dropping that tile would take away the buff she actually has.
  //
  // Not applying a tile for the refused cast is handled elsewhere and needs nothing here: with no
  // landing message there is nothing to land, and FAILURE_PATTERNS cancels the pending cast so no
  // fallback can invent one.
  _noteRefusedCast(line) {
    const noHold = matchDidNotTakeHold(line);
    if (!noHold) return;
    this._debugLog(
      `REFUSED "${noHold.spellName}"${noHold.targetName ? ` on "${noHold.targetName}"` : ' on you'}` +
        `${noHold.blockedBy ? ` - blocked by "${noHold.blockedBy}", which stays` : ' - no reason given'}`
    );
  }

  // Ends a buff or debuff on somebody else, from the lines the game actually prints for it (see
  // the pattern comments in buffParser).
  //
  // Two of these name the spell AND the target, so they are unambiguous and apply to every ally
  // entry - that is note 26, and it is the whole of it for a buff on somebody else. The note
  // assumed the app would have to model EverQuest's stacking rules to know a buff had been
  // replaced. It does not: the game says so outright.
  //
  // The other two name only a target, so they stay limited to entries marked onEnemy. A groupmate
  // dying is not a reason to forget their buffs - they may be rezzed - whereas a mob dying is.
  _checkForEndedAllyBuffs(line) {
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
      if (entry) {
        this._debugLog(`ALLY BUFF ENDED "${entry.name}" on "${entry.allyName}" - the log says it wore off`);
        // One of them, not all of them. The wear-off line names a mob NAME, and if three kobolds
        // are mezzed it can only mean one of the three.
        this._dropOneInstance(key);
        changed = true;
      }
    }

    // Note 26. The stale timer this whole note is about: a buff replaced by a better one, which
    // the app would otherwise keep counting down for the rest of its duration. 109 of these in
    // the owner's logs, one shape, no exceptions - and it names both spell and target, so nothing
    // has to be guessed about which tile to remove.
    const over = matchOverwritten(line);
    if (over) {
      const key = `${over.targetName.toLowerCase()}::${over.spellName.toLowerCase()}`;
      const entry = this.allyBuffs.get(key);
      if (entry) {
        this._debugLog(`ALLY BUFF ENDED "${entry.name}" on "${entry.allyName}" - overwritten by a better one`);
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
          this._dropOneInstance(key);
          changed = true;
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
          this._dropOneInstance(key);
          changed = true;
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
    // A multi-word recipient ("a dry bones skeleton") is only a valid target when some aura has
    // actually asked to see this spell on an enemy - a Custom debuff aura watching it, or (#29) a
    // Bard Songs aura with "Also show debuff songs" on for a debuff bard song.
    const wanted = this._isWatchedOnEnemies(known.name)
      || (known.isBardSong && this.bardSongDebuffsWantedFn());
    if (!wanted) return false;
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
  // KNOWN DEFECT, DELIBERATELY LEFT IN PLACE PENDING A DECISION - see the "Instant spells" /
  // "The open decision underneath this" section in docs/TESTING.md.
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
  /**
   * Notes 11 and 17. How long a buff actually lasts, which is three things multiplied.
   *
   * BASE, from the roster.
   *
   * MOTE TIER, the Roman numeral outside the name field. Shara: "duration should be base duration
   * from the roster, multiplied by the AA's, exaltations, and rank of the spell, which is listed
   * in the chat log when the player (not an ally) cast's a spell." The rates come from the
   * spreadsheet's "Spell Upgrades (motes)" sheet and are LINEAR against base, not compounding -
   * the sheet says so itself (a nuke at tier 5 is "10% less mana... ~30% harder" against rates of
   * 2% and 6% per tier), and the measurements below rule compounding out independently.
   *
   * Two of the sheet's rates were marked unverified and are now measured from her own logs:
   *   - buff +10%/tier. Spirit of the Puma VII, base 60, AA band 1.65: linear predicts 168.3s and
   *     the measured mode is 167 (n=24). Compounding predicts 192.9s, and 23 of those 24 fall
   *     below it, so it is refuted rather than merely unsupported.
   *   - hot +5%/tier. Celestial Healing IV, base 24: +5% predicts 47.5s and all 32 observations
   *     are 48 or more. +10% predicts 55.4s and 28 of the 32 fall short of it.
   * dot, debuff and charm carry the sheet's rates UNMEASURED, because every observation of them in
   * her logs was cut short by the mob dying. They are the sheet's numbers, not established fact.
   *
   * AA AND EXALTATION, applied to the BUFF category and nothing else. The code originally applied
   * the multiplier to everything without a noDurationScaling flag, which is 155 roster entries of
   * debuff, dot and charm - and those would have over-timed by up to 65% the moment an AA level was
   * set. Curse (base 30, a dot) measured 31-36 seconds across 31 castings on days when her buffs
   * measured x1.53; the multiplier would make it 45, and it never comes near.
   *
   * The narrowing from "beneficial" to "buff" is Shara's correction of 23 August, and the
   * measurement that made me get it wrong is worth recording. Celestial Healing IV, a hot with a
   * base of 24, measures 48 to 78 seconds - far more than the 29 the mote tier alone predicts -
   * and I read that as the AA bonus reaching heals over time.
   *
   * It was recasting. Her words: "the celestial healing timer duration being different is due to
   * refreshed casting." She re-casts the heal before the old one lapses, so the gap between landing
   * and wear-off covers several casts rather than one duration. The spread was the tell - a
   * fixed-duration buff measures inside a 14-second band and this one runs across 30 - and I read
   * a wide spread as noise around one number instead of as several durations end to end.
   *
   * The behaviour that follows from it is already right, and tested: every landing recomputes,
   * including a renewal, so a re-cast reapplies the calculation at whatever rank was just cast
   * rather than extending by the old duration. See _land and the recast tests.
   *
   * ROUNDING happens ONCE, over the combined multiplier. The two multipliers are order-independent
   * but rounding between them is not; doing it twice differs by up to a second.
   *
   * BARD SONGS then snap to the nearest 6 seconds (#17). Shara: song durations run in 6-second
   * intervals, so a mote-scaled result of, say, 33s is really 36. Floored at 6 (one tick) so a
   * short song can't round to nothing. Applied last, over the already-combined value, for the same
   * reason the multipliers round once: quantising an intermediate step drifts.
   */
  _scaledDuration(entry) {
    if (entry.noDurationScaling) return this._quantizeSong(entry, Math.round(entry.durationSec));
    const rankMult = 1 + (MOTE_DURATION_RATES[entry.scaleCategory] || 0) * this._rankForEntry(entry);
    const aaMult = isAAEligible(entry) ? this.durationMultiplierFn() : 1;
    return this._quantizeSong(entry, Math.round(entry.durationSec * rankMult * aaMult));
  }

  /** Snap a bard song's duration to the nearest 6s tick (#17); pass everything else through. */
  _quantizeSong(entry, seconds) {
    if (!entry.isBardSong) return seconds;
    return Math.max(6, Math.round(seconds / 6) * 6);
  }

  /**
   * The mote tier of the cast that is landing right now, or 0.
   *
   * Read from the cast the engine is already holding rather than threaded through the sixteen call
   * sites that can end in a landing. The name check is what makes that safe: the rank is applied
   * only when the pending or just-confirmed cast IS this spell, so a stale cast of something else
   * cannot lend its numeral to an unrelated landing.
   *
   * Returns 0 for anything cast by somebody else. Their rank IS in the log - "<Name> begins casting
   * <X> VII." - but nothing here has established which of their casts produced which landing, and
   * inventing that link would put a confidently wrong number on a groupmate's buff rather than an
   * honestly unscaled one.
   */
  _rankForEntry(entry) {
    const wanted = entry.name.toLowerCase();
    for (const castName of [this.pendingCast?.name, this.recentSelfCast?.name]) {
      if (!castName) continue;
      if (stripRankSuffix(castName).toLowerCase() === wanted) return rankValue(castName);
    }
    return 0;
  }

  // P0c. The spell's own cast time, scaled the same linear-per-tier way as _scaledDuration, for
  // use as the pendingCast wait window instead of one flat 12s for every spell regardless of how
  // long it actually takes to cast. rank is passed in rather than read via _rankForEntry, because
  // this runs at CAST BEGIN - before pendingCast/recentSelfCast are set - not at landing time.
  //
  // TWO multipliers, same shape as _scaledDuration's mote-tier x AA: CAST_TIME_RATES is the
  // per-mote-tier rate, castTimeMultiplierFn is Spell Casting Deftness on top of it - confirmed
  // live 25 Aug, it closed the exact gap between the mote-only prediction and the real in-game
  // value for Spirit of the Puma VII (2.16s predicted, 1.94s actual - castTimeMultiplierFn(0.9)
  // accounts for the rest). Gated on the AA's own stated eligibility, read straight off its
  // tooltip: "beneficial spells that have a duration and an initial cast time of at least 3
  // seconds" - so it's skipped for anything instant (no durationSec) or already faster than 3s
  // base, exactly like the AA itself would skip them.
  //
  // Returns null when there's nothing to scale (no castSec on the roster entry), so the caller can
  // fall back to the old flat window rather than inventing a number. Floored at 25% of base cast
  // time (never lower) so an extreme tier plus this sheet-only, unmeasured mote rate can't collapse
  // the wait to something implausibly small - the whole point is a safer window, not a hair-trigger one.
  _scaledCastSec(entry, rank) {
    if (typeof entry.castSec !== 'number') return null;
    const rankMult = 1 + (CAST_TIME_RATES[entry.scaleCategory] || 0) * rank;
    const eligibleForCastSpeedAA = typeof entry.durationSec === 'number' && entry.durationSec > 0 && entry.castSec >= 3;
    const aaMult = eligibleForCastSpeedAA ? this.castTimeMultiplierFn() : 1;
    return entry.castSec * Math.max(rankMult, 0.25) * aaMult;
  }

  _land(known) {
    if (this.blockedNames.has(known.name.toLowerCase())) {
      this._debugLog(`BLOCKED "${known.name}" - landing suppressed, you chose "No longer track" for this buff`);
      return;
    }
    // A detrimental spell's FIRST-PERSON landing text ("Your blood boils.") can only ever mean it
    // was cast at the player, not by them - nothing you cast lands with your own name on it. Every
    // detection tier that can reach _land() matches on that first-person text, with no category
    // check anywhere upstream, so a mob's dot/debuff/charm/nuke on the player was landing straight
    // into the Self Buffs list as if it were her own buff. Reported live: Boil Blood (an NPC
    // necromancer's fire DoT) showing as a tracked buff, "second time" - meaning this was never a
    // one-spell bug, it's every entry in this category. ENEMY_SPELL_CATEGORIES already exists for
    // exactly this classification (ally-buff landing uses it to mark onEnemy) - reused here rather
    // than inventing a second list that could drift out of sync with it. There is currently no
    // aura type that tracks a debuff landing ON the player (only ones the player casts AT
    // something), so this is a full refusal, not a redirect - the roster gap that would need
    // filling for "warn me when I'm dotted" is a separate feature, not this fix.
    if (ENEMY_SPELL_CATEGORIES.has(known.scaleCategory)) {
      this._debugLog(`IGNORED "${known.name}" - detrimental (${known.scaleCategory}), not something you can self-buff`);
      return;
    }
    // Note 26. Scoped to scaleCategory 'buff' on both sides, same gate isAAEligible uses - the
    // stacking module only models the core same-slot rule (see its own header comment on what it
    // deliberately skips: DoTs, Complete Heal, bard-song separation, group-spell arbitration), and
    // narrowing to plain buffs keeps this well inside what's actually been validated rather than
    // reaching into cases nothing has confirmed. A verdict here only ever REMOVES a stale entry
    // still sitting in activeBuffs under a DIFFERENT name - the buff about to land below always
    // proceeds regardless, so a wrong or missing verdict never blocks the landing itself.
    // The heading model / measured blocked-pairs (docs/BUFF-STACKING.md) - runs unconditionally,
    // these are observed conflicts or strict tier bumps, not a guess. Only ever removes a stale
    // tile still sitting under a DIFFERENT name; the incoming landing always proceeds below.
    if (this.lineStackFn && known.scaleCategory === 'buff') {
      for (const [activeKey, activeEntry] of [...this.activeBuffs]) {
        if (activeKey === known.name.toLowerCase()) continue;
        if (this.lineStackFn(known.name, activeEntry.name) === 'overwrites') {
          this._debugLog(`ENDED "${activeEntry.name}" - replaced by "${known.name}" (same buff line / known conflict)`);
          this.activeBuffs.delete(activeKey);
        }
      }
    }
    // The effect-slot heuristic, for pairs the line data does not cover - still behind the toggle.
    if (this.useStackingModel && this.stackVerdictFn && known.spellId && known.scaleCategory === 'buff') {
      for (const [activeKey, activeEntry] of this.activeBuffs) {
        if (activeKey === known.name.toLowerCase()) continue; // a recast of the same spell, not a conflict
        if (this.lineStackFn && this.lineStackFn(known.name, activeEntry.name) !== 'unknown') continue;
        const activeKnown = this.buffStore.getByName(activeEntry.name);
        if (!activeKnown || !activeKnown.spellId || activeKnown.scaleCategory !== 'buff') continue;
        const verdict = this.stackVerdictFn(activeKnown.spellId, known.spellId);
        if (verdict) {
          this._debugLog(`ENDED "${activeKnown.name}" - overwritten by "${known.name}" (${verdict.why})`);
          this.activeBuffs.delete(activeKey);
        }
      }
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
      if (known.isBardSong) this._trackBardSongOnPlayer(known, key);
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
      if (known.isBardSong) this._trackBardSongOnPlayer(known, key);
      this.emit('buffsChanged', this.getActiveBuffs());
      return;
    }
    this.activeBuffs.set(key, {
      name: known.name,
      durationSec: effectiveDurationSec,
      expiresAt: Date.now() + effectiveDurationSec * 1000,
      endedText: known.endedText || null,
    });
    if (known.isBardSong) this._trackBardSongOnPlayer(known, key);
    this.emit('buffsChanged', this.getActiveBuffs());
  }

  // Bard Songs aura support. Read-only, additive observation of a landing that already happened
  // above - never gates or changes what lands as a self buff, only adds a second, caster-aware
  // record for isBardSong entries specifically. Reads the entry _land() just stored (by `key`)
  // rather than recomputing duration/expiry itself, so the two can never drift apart.
  _trackBardSongOnPlayer(known, key) {
    const landed = this.activeBuffs.get(key);
    if (!landed) return; // defensive only - _land() always sets this before calling here
    const castBy = this._attributeBardSongCaster(known.name, known);
    const bardKey = `${(castBy || 'unknown').toLowerCase()}::${known.name.toLowerCase()}`;
    this._debugLog(`BARD SONG "${known.name}" - attributed to ${castBy || 'Unknown'}`);
    this.bardSongs.set(bardKey, {
      name: known.name,
      castBy,
      durationSec: landed.durationSec,
      expiresAt: landed.expiresAt,
      infinite: !!landed.infinite,
      endedText: landed.endedText || null,
    });
    this.emit('bardSongsChanged', this.getActiveBardSongs());
  }

  // Who cast a bard song landing right now, as best the log ever lets us know - "You", a real ally
  // name, or null (genuinely unattributable, not a guess). Computed generically from state that
  // already exists for other reasons, rather than threading a caster argument through every one of
  // _land()'s many call sites (see this project's own history with a whitelist/parameter list
  // missing one call site and silently losing a feature - not repeating that here).
  //
  // Reported live: a self-cast "Selo's Accelerating Chorus VI" was attributed to "Imperius" - not
  // a groupmate at all, but a MOB with the exact same-named ability ("Imperius begins singing
  // Selo's Accelerating Chorus.", confirmed in the raw log, ~20 minutes earlier the same session).
  // Root cause was here, not in the mob/ally line: recentSelfCast.name carries the log's own rank
  // suffix ("...VI"), and this compared it against `lower` - the roster's bare, unranked name -
  // with no stripRankSuffix() first. So the self-check silently failed for EVERY ranked bard song
  // cast, no matter how correct and recent, and fell through to _recentOtherCaster's answer - which
  // has no expiry at all (see recentOtherCasts' own comment on why: deliberately valid for a whole
  // group session), so a mob's cast from 20 minutes ago was still sitting there to be returned.
  // Fixed the same way _rankForEntry already strips a rank suffix before comparing - self-cast
  // evidence should never have been rank-sensitive to begin with, an unranked bard song ("Amplification"
  // with no numeral) already matched fine, which is why this went unnoticed until a ranked one hit it.
  _attributeBardSongCaster(name, known) {
    const lower = name.toLowerCase();
    // Absolute, checked before even direct cast-begin evidence: a spell whose own roster entry
    // says `targets: 'Self'` is mechanically impossible for anyone but the player to have cast in
    // a way that lands on the player - there is no group/targeted version of it to be confused
    // with (unlike gotcha #31's "Selo's Accelerating Chorus", a real group song a MOB happened to
    // share a name with). Requested directly: "amplification should also never be unknown, it's
    // always self only, so are a few other songs, like whistling warsong and jonthan's
    // provocation" - confirmed against the roster: Amplification, Jonthan's Whistling Warsong and
    // Jonthan's Provocation are all `targets: 'Self'`. Driven from that roster field rather than a
    // hardcoded name list, so it covers every such song, not just the three named live.
    if (known && known.targets === 'Self') {
      return 'You';
    }
    // The player's own confirmed cast, still within its window - direct, first-person evidence:
    // this exact "You begin casting/singing X" line was seen recently. Same check already used to
    // gate ally-buff landing (see the third-person suffix tier above).
    if (
      this.recentSelfCast &&
      stripRankSuffix(this.recentSelfCast.name).toLowerCase() === lower &&
      Date.now() < this.recentSelfCast.expiresAt
    ) {
      return 'You';
    }
    // A groupmate's own third-person "X begins casting/singing Y" line, seen recently for this
    // exact spell. _recentOtherCaster already existed purely for debug-log text ("never for making
    // one" per its own comment) - this is the first place its answer is actually acted on.
    const other = this._recentOtherCaster(name);
    if (other) return other;
    // A song the memorize-window tier below has confirmed as the player's own at some earlier
    // point THIS memorization - checked before that tier itself so an already-confirmed song
    // doesn't need a fresh memorize event every single repeat. Requested directly: "if the app
    // caught you memming a song and attributed it to you within the 6s window, it should stay
    // that way until you unmem it." Gated on still being memorized (not just once-confirmed-
    // forever) so a genuine unmem/re-memorize - a real loadout swap, a different spell taking the
    // slot - requires re-confirming rather than trusting a stale answer indefinitely; see the
    // forget-line/removeMemorized/clearMemorized call sites, which all clear this alongside
    // currentlyMemorized itself.
    if (this.bardSongConfirmedMine.has(lower) && this.currentlyMemorized.has(lower)) {
      return 'You';
    }
    // Last resort, only once real cast evidence (yours or an ally's) has come up empty: this
    // server can auto-sing a bard song the instant it's memorized, with no "You begin singing X."
    // line at all - see BARD_MEMORIZE_ATTRIBUTION_WINDOW_MS. Not proof, but the only player who
    // could have triggered "this was just memorized and started playing" is the one who memorized
    // it, so a memorize event for this exact spell within the window counts as self-cast evidence.
    // Confirmed durably (bardSongConfirmedMine, above) rather than just returned once, so this
    // one-time observation keeps covering every later repeat of the same still-memorized song.
    const memorizedAt = this.recentlyMemorizedAt.get(lower);
    if (memorizedAt != null && Date.now() - memorizedAt <= BARD_MEMORIZE_ATTRIBUTION_WINDOW_MS) {
      this.bardSongConfirmedMine.add(lower);
      return 'You';
    }
    // Genuinely last resort: if this exact song is already tracked as active under SOME caster,
    // a re-land with no fresh evidence at all is far more likely to be that same still-running
    // song repeating (this server's auto-sing mechanic can re-trigger a song with no cast-begin
    // line of its own, same as the memorize case above) than a brand new, different caster's cast
    // that happens to share a name. Reported live: the exact same songs showing under both "You"
    // and "Unknown" at once, on a consistent ~19s offset - the "You" landing correctly attributed,
    // then an auto-sing repeat a few seconds later found no fresh evidence and was attributed
    // "Unknown" instead of recognised as the same song, creating a second entry. Without this, the
    // "You" entry eventually expired on its own timer and the song then read as never cast at all
    // ("it forgets I cast them"). Checked last, after every stronger signal, so a real ally
    // starting the same-named song (caught by _recentOtherCaster above) is never overridden by a
    // stale attribution here.
    for (const song of this.bardSongs.values()) {
      if (song.name.toLowerCase() === lower && song.expiresAt > Date.now()) {
        return song.castBy;
      }
    }
    return null;
  }

  // A confirmed-mine song wearing off WITHOUT ever being renewed by a fresh landing (as opposed
  // to simply being overwritten in place, which never reaches this - see _trackBardSongOnPlayer's
  // bardSongs.set()) is treated as a signal that whatever made the memorize-window confirmations
  // trustworthy for this stretch of play may have changed - most likely a loadout swap this app
  // has no other way to see (CLAUDE.md gotcha #9 explicitly rejected a general swap-detector as
  // unreliable; this is a narrower, bard-song-specific signal built from a real observation - a
  // song actually stopping - not that same rejected idea). Requested directly: "if a song stops
  // being played, the confidence of the entire list drops." Un-confirms every OTHER confirmed-mine
  // song too, not just this one, so a later repeat of any of them needs fresh evidence again
  // rather than continuing to coast on confirmations that may now be stale. Deliberately does NOT
  // touch currentlyMemorized/recentlyMemorizedAt - the gem itself may genuinely still be
  // memorized, this is purely about whether the ATTRIBUTION is still trustworthy.
  _dropBardSongConfidence(name) {
    if (this.bardSongConfirmedMine.size === 0) return;
    this._debugLog(
      `BARD SONG CONFIDENCE DROP - "${name}" wore off without renewing, un-confirming ${this.bardSongConfirmedMine.size} song(s)`
    );
    this.bardSongConfirmedMine.clear();
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
    // #29 - a bard song that lands third-person (a debuff song like Largo's Melodic Binding on an
    // enemy, or a buff song on a groupmate) is ALSO surfaced on the Bard Songs aura via
    // _trackBardSongOnTarget, called once the duration-bearing allyBuffs entry below is set.
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
    // Notes 12 and 18 used to count identically-named mobs as separate instances under one key
    // ("a greater kobold" x2, x3...) since the log gives them no other identity. Scrapped 24 Aug:
    // the log can't tell a second same-named mob apart from a recast refreshing the one you already
    // have - chain-mezzing a target before it wakes hit this key exactly the same way a second mob
    // would, so the count climbed on a single target. One tile, one expiry - a new landing under
    // this key is a refresh, exactly like a buff on a groupmate already was.
    this.allyBuffs.set(key, {
      name: known.name,
      allyName,
      durationSec: effectiveDurationSec,
      expiresAt: Date.now() + effectiveDurationSec * 1000,
      onEnemy,
    });
    this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
    if (known.isBardSong) this._trackBardSongOnTarget(known, allyName, this.allyBuffs.get(key));
  }

  // #29 - a third-person bard song landing (a debuff song on an enemy, a buff song on a groupmate)
  // is mirrored into bardSongs so it shows on the Bard Songs aura. Keyed by target so the same song
  // on two enemies is two entries. isDebuff drives the aura's optional show/split-debuffs behaviour
  // and the debuff-coloured border. castBy is "You" when the enemy-side line was only reachable
  // because the player's own recent cast explained it.
  _trackBardSongOnTarget(known, targetName, entry) {
    if (!entry) return;
    const castBy = this._attributeBardSongCaster(known.name, known) || 'You';
    const bardKey = `on:${targetName.toLowerCase()}::${known.name.toLowerCase()}`;
    this.bardSongs.set(bardKey, {
      name: known.name,
      castBy,
      onTarget: targetName,
      isDebuff: this._isEnemySpell(known),
      durationSec: entry.durationSec,
      expiresAt: entry.expiresAt,
      infinite: !!entry.infinite,
      endedText: known.endedText || null,
    });
    this._debugLog(`BARD SONG "${known.name}" - ${this._isEnemySpell(known) ? 'debuff on' : 'buff on'} "${targetName}"`);
    this.emit('bardSongsChanged', this.getActiveBardSongs());
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

  // The Bard Songs aura's "Active on this aura" list has a Remove per row, same as ally buffs. The
  // key prefix is the caster lowercased; getActiveBardSongs surfaces a null caster as "Unknown",
  // which lowercases back to the "unknown::" the map actually uses.
  removeActiveBardSong(castBy, name) {
    this.bardSongs.delete(`${String(castBy || 'unknown').toLowerCase()}::${name.toLowerCase()}`);
    this.emit('bardSongsChanged', this.getActiveBardSongs());
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

  // #29 - injected by main.js, true when a Bard Songs aura has "Also show debuff songs" on. Lets a
  // debuff bard song landing on a mob-named target count as a valid recipient (see _isValidRecipient).
  setBardSongDebuffsWantedFn(fn) {
    this.bardSongDebuffsWantedFn = fn;
  }

  // The one bard song among candidates that are NOT all songs, or null.
  //
  // Both halves matter. If every candidate is a song the repeat says nothing about which, and if
  // none is, a repeat is just the buff being recast. Only a split set can be decided this way.
  /**
   * Note 28. Where the current burst came from, for the log only.
   *
   * Reads as ' (burst opened 4.2s ago by "Cannibalize")'. The AGE is the useful half: a landing
   * credited to a burst that opened eight seconds ago is far likelier to be somebody else's cast
   * arriving inside your window than one credited half a second after you pressed something.
   */
  _burstOrigin() {
    if (!this.burstOpenedBy) return ' (burst origin unknown)';
    const ageSec = ((Date.now() - this.burstOpenedBy.at) / 1000).toFixed(1);
    return ` (burst opened ${ageSec}s ago by "${this.burstOpenedBy.text}")`;
  }

  _songAmongSplitCandidates(candidates) {
    const songs = candidates.filter((c) => c.isBardSong);
    if (songs.length !== 1) return null;
    if (songs.length === candidates.length) return null;
    return songs[0];
  }

  // attributedTo (P0b): who likely caused this, when known - e.g. the ally whose burst opened the
  // window. Purely informational, surfaced in the debug log and stored on the queued entry for a
  // future UI to show; nothing here treats it as a resolution. Optional and only ever set by the
  // ally-burst soft-negative case in the unique-landing-text tier today.
  _queueAmbiguousCast(text, candidates, isSelf, attributedTo = null) {
    if (this._shouldSuppressAsHiddenBardSongs(candidates)) {
      this._debugLog(
        `SKIPPED ambiguous "${text}" - every candidate is a bard song and no aura is showing bard songs`
      );
      return;
    }
    // A single candidate is never a real choice. Reported live 25 Aug: "a popup asking what song
    // it is when there is ONLY one option is inexcusable no matter the context" - and correct on
    // the merits, not just as UX polish. Every call site that reaches here already knows the
    // identity with certainty (unique landing text, or a spellbook/gem narrowing that already
    // collapsed the field to one) - what's actually uncertain is confidence that it's the
    // player's OWN cast, which is a different question than "which spell is this." A one-button
    // "which one was it?" prompt answers a question that was never open, so this lands the single
    // candidate directly instead of queuing it - the same way a remembered resolution would,
    // just without needing one on file first. This is a general invariant, not scoped to bard
    // songs or to any one caller: nothing that reaches this function should ever end up asking a
    // question with only one possible answer.
    if (candidates.length === 1) {
      this._debugLog(
        `LANDED "${candidates[0].name}" - only one candidate; a single-option prompt is not a real choice` +
          (attributedTo ? `, likely "${attributedTo}"` : '')
      );
      this._land(candidates[0]);
      return;
    }
    const existing = this.ambiguousCasts.get(text);
    if (existing) {
      // Note 24. The same text, one pulse later, when the candidates are split between a bard song
      // and something that is not one: only the song could have re-landed on its own, so this
      // answers a question the app would otherwise have had to ask.
      const sinceSec = (Date.now() - existing.lastSeenAt) / 1000;
      const isPulse = Math.abs(sinceSec - SONG_PULSE_SEC) <= SONG_PULSE_TOLERANCE_SEC;
      const song = isPulse ? this._songAmongSplitCandidates(candidates) : null;
      if (song) {
        this._debugLog(
          `LANDED "${song.name}" - ambiguous text "${text}" repeated after ${sinceSec.toFixed(1)}s, ` +
            'which is a song pulse - nothing else re-lands on its own'
        );
        this.ambiguousCasts.delete(text);
        this._land(song);
        this.emit('ambiguousCastsChanged', this.getAmbiguousCasts());
        return;
      }
      existing.lastSeenAt = Date.now();
      existing.isSelf = isSelf;
      existing.profileId = this.activeProfileId;
      if (attributedTo) existing.attributedTo = attributedTo;
    } else {
      this.ambiguousCasts.set(text, {
        text,
        candidateNames: candidates.map((c) => c.name),
        lastSeenAt: Date.now(),
        isSelf,
        profileId: this.activeProfileId,
        ...(attributedTo ? { attributedTo } : {}),
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
      if (buff.expiresAt <= now) {
        this.activeBuffs.delete(key);
        this._debugLog(`EXPIRED "${buff.name}" - duration ran out`);
      }
    }
    this.emit('buffsChanged', this.getActiveBuffs());

    for (const [key, buff] of this.allyBuffs) {
      // Same reasoning as the self sweep above - an ally can carry a buff that never runs out
      // too, and it has no expiry to compare against. Missing this half was caught by a test that
      // deliberately checked both maps rather than assuming one implied the other.
      if (buff.infinite) continue;
      if (buff.expiresAt <= now) {
        this.allyBuffs.delete(key);
        this._debugLog(`EXPIRED "${buff.name}" on "${buff.allyName}" - duration ran out`);
      }
    }
    // Unconditional every tick, same as buffsChanged above - the overlay's
    // countdown text needs a fresh broadcast every second to visibly tick
    // down, not just when something actually expires. Emitting only on
    // expiry (tried this first) left ally-buff/custom-timer countdowns
    // frozen on screen except when some unrelated widget-config change
    // forced a full re-fetch.
    this.emit('allyBuffsChanged', this.getActiveAllyBuffs());

    for (const [key, song] of this.bardSongs) {
      // Same reasoning as the two sweeps above - a bard song can be marked infiniteDuration too
      // (rare, but the roster allows it for any buff), and has no expiry to compare against then.
      if (song.infinite) continue;
      if (song.expiresAt <= now) {
        this.bardSongs.delete(key);
        this._debugLog(`EXPIRED "${song.name}" (bard song, cast by ${song.castBy || 'unknown'}) - duration ran out`);
        if (song.castBy === 'You' && this.bardSongConfirmedMine.has(song.name.toLowerCase())) {
          this._dropBardSongConfidence(song.name);
        }
      }
    }
    this.emit('bardSongsChanged', this.getActiveBardSongs());
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
      bardSongs: [...this.bardSongs.values()],
    };
  }

  // Puts saved entries back without re-running any detection. Anything past
  // its expiry has already been filtered out by sessionSnapshot.loadSnapshot,
  // and a blocked buff is dropped here in case the user blocked it between
  // sessions.
  restoreSnapshot({ selfBuffs = [], allyBuffs = [], bardSongs = [] }) {
    for (const buff of selfBuffs) {
      if (this.blockedNames.has(buff.name.toLowerCase())) continue;
      this.activeBuffs.set(buff.name.toLowerCase(), buff);
      this._debugLog(`LOADED "${buff.name}" - restored from before restart`);
    }
    for (const buff of allyBuffs) {
      if (this.blockedNames.has(buff.name.toLowerCase())) continue;
      this.allyBuffs.set(`${buff.allyName.toLowerCase()}::${buff.name.toLowerCase()}`, buff);
      this._debugLog(`LOADED "${buff.name}" on "${buff.allyName}" - restored from before restart`);
    }
    for (const song of bardSongs) {
      if (this.blockedNames.has(song.name.toLowerCase())) continue;
      this.bardSongs.set(`${(song.castBy || 'unknown').toLowerCase()}::${song.name.toLowerCase()}`, song);
      this._debugLog(`LOADED "${song.name}" (bard song, cast by ${song.castBy || 'unknown'}) - restored from before restart`);
    }
    if (selfBuffs.length) this.emit('buffsChanged', this.getActiveBuffs());
    if (allyBuffs.length) this.emit('allyBuffsChanged', this.getActiveAllyBuffs());
    if (bardSongs.length) this.emit('bardSongsChanged', this.getActiveBardSongs());
    return selfBuffs.length + allyBuffs.length + bardSongs.length;
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
    this._trimMemorized(this.currentlyMemorized);
    this.recentlyMemorizedAt.set(key, Date.now());
    this._reclaimBardSongFromUnknown(key);
  }

  // Bard buffs, like every other buff, do not stack - the game only ever keeps one instance of a
  // given effect active on a character. If a song is currently tracked under some OTHER caster
  // (including the honest "Unknown" bucket) and the player is now confirmed to have that exact
  // spell memorized, it cannot genuinely still be a separate instance someone else is
  // maintaining - a real second copy would already have collapsed into one, and no-stacking means
  // the version actually surviving on the player right now is the more recent one. Requested
  // directly: "buffs do not stack on bard buffs, so if you are seen to have memmed a spell, that
  // same spell should be removed from the unknown list." Reattributed to 'You' rather than just
  // deleted - the memorize event is real, freshly observed evidence of who owns it now, not
  // nothing - and durably confirmed the same way the memorize-window tier is, so later repeats
  // don't need to re-earn it.
  _reclaimBardSongFromUnknown(lower) {
    const toReclaim = [];
    for (const [existingKey, song] of this.bardSongs) {
      if (song.name.toLowerCase() === lower && song.castBy !== 'You') {
        toReclaim.push([existingKey, song]);
      }
    }
    if (toReclaim.length === 0) return;
    for (const [existingKey, song] of toReclaim) {
      this.bardSongs.delete(existingKey);
      this.bardSongs.set(`you::${lower}`, { ...song, castBy: 'You' });
      this._debugLog(
        `BARD SONG "${song.name}" - reclaimed from "${song.castBy || 'Unknown'}" to You (buffs don't stack, and you were just seen memorizing it)`
      );
    }
    this.bardSongConfirmedMine.add(lower);
    this.emit('bardSongsChanged', this.getActiveBardSongs());
  }

  _getOrCreateMemorizedMap(profileId) {
    let map = this.currentlyMemorizedByProfile.get(profileId);
    if (!map) {
      map = new Map();
      this.currentlyMemorizedByProfile.set(profileId, map);
    }
    return map;
  }

  _getOrCreateBardSongConfirmedSet(profileId) {
    let set = this.bardSongConfirmedMineByProfile.get(profileId);
    if (!set) {
      set = new Set();
      this.bardSongConfirmedMineByProfile.set(profileId, set);
    }
    return set;
  }

  // Drops the stalest entries until the picture fits the gem bar. Map iterates in insertion
  // order, so the first key is the least recently seen.
  //
  // Whatever is dropped is always a guess - the overflow only exists because a "You forget X."
  // line was missed - but the stalest entry is the likeliest to be the wrong one, and a picture
  // that fits the bar is closer to the truth than one that cannot possibly be right.
  //
  // Takes the map explicitly (rather than always reading this.currentlyMemorized) so the
  // constructor's load-time trim can heal every profile's bucket, not just the active one.
  _trimMemorized(map) {
    let dropped = 0;
    while (map.size > MAX_MEMORIZED_GEMS) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
      dropped++;
    }
    if (dropped) {
      this._debugLog(`MEMORIZED TRIM dropped ${dropped} stale entr${dropped === 1 ? 'y' : 'ies'} - over ${MAX_MEMORIZED_GEMS} gems`);
    }
    return dropped;
  }

  _saveCurrentlyMemorized() {
    this.store.saveJson(
      'currentlyMemorizedByProfile',
      Object.fromEntries([...this.currentlyMemorizedByProfile].map(([profileId, map]) => [profileId, [...map.entries()]]))
    );
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
    this.bardSongConfirmedMine.delete(lower);
    this.recentlyMemorizedAt.delete(lower); // see the forget-line handler's own comment on why
    this._saveCurrentlyMemorized();
    this.emit('memorizedChanged', this.getCurrentlyMemorized());
    return true;
  }

  clearMemorized() {
    if (this.currentlyMemorized.size === 0) return false;
    this.currentlyMemorized.clear();
    this.bardSongConfirmedMine.clear();
    this.recentlyMemorizedAt.clear(); // see the forget-line handler's own comment on why
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

  // For the Bard Songs aura. Same shape/sort as getActiveAllyBuffs(). `allyName` reuses that exact
  // field name - the caster for a song on the player, the TARGET for a third-person song (#29) -
  // because that is what lets the overlay's existing group-by-player rendering work unmodified.
  // `isDebuff` is set on a debuff song (Largo's Melodic Binding and the like) on an enemy; the aura
  // hides those unless its Show debuff songs option is on, and can split them into their own group.
  getActiveBardSongs() {
    const now = Date.now();
    return [...this.bardSongs.values()]
      .map((b) => {
        const known = this.buffStore.getByName(b.name);
        const isDebuff = !!b.isDebuff;
        return {
          name: b.name,
          // "Unknown" rather than null/empty - see the constructor's own comment on bardSongs.
          // Emitted here, not left for the overlay to fall back on, so the existing ally-grouping
          // renderer needs zero changes to draw an actual, visible bucket for this.
          allyName: isDebuff ? b.onTarget : (b.castBy || 'Unknown'),
          isDebuff,
          durationSec: b.durationSec,
          remainingSec: b.infinite ? null : Math.max(0, Math.round((b.expiresAt - now) / 1000)),
          infinite: !!b.infinite,
          showOnOverlay: known ? known.showOnOverlay !== false : true,
          iconUrl: known?.iconId != null ? this.iconUrlFn(known.iconId) : null,
          isBardSong: true,
          spellCategory: isDebuff ? 'debuff' : (known?.scaleCategory || null),
        };
      })
      .sort((a, b) => {
        const aNone = a.infinite;
        const bNone = b.infinite;
        if (aNone && bNone) return 0;
        if (aNone) return 1;
        if (bNone) return -1;
        return a.remainingSec - b.remainingSec;
      });
  }
}

module.exports = { BuffEngine };
