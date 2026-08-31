// EverQuest doesn't have one uniform "buff landed" message - every spell has
// its own custom flavor text (e.g. "You feel the spirit of wolf enter you."
// vs "Your weapons whir with a magical rhythm."). But that flavor text does
// reliably follow a small number of sentence patterns ("You feel...",
// "You are...", "Your skin/body/weapons/voice..."), so instead of blindly
// waiting out a fixed timer, we watch for a line that LOOKS like landing
// flavor text and confirm immediately when we see one. A fallback timer
// still exists as a safety net for the rare spell whose text doesn't match
// any of these patterns, so a cast never gets stuck pending forever.

// Every log line is prefixed with a timestamp like "[Sun Aug 16 12:32:27 2026] "
// which has to be stripped before matching message text against "^...".
const TIMESTAMP_PREFIX = /^\[\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4}\]\s*/;

const CAST_BEGIN_PATTERN = /^You begin casting (.+)\.$/;

// Bard songs use their own verb entirely - "You begin singing X.", never
// "casting" - so they need a separate pattern to get the same reliable
// named-cast treatment as regular spells.
const SINGING_PATTERN = /^You begin singing (.+)\.$/;

// AA abilities/discipline activations that can grant several buffs at once
// with no per-buff "You begin casting" line at all (e.g. "You activate
// Quick Buff." followed by a dozen-plus landing messages in a row).
const ACTIVATE_PATTERN = /^You activate (.+)\.$/;

// Third-person version of CAST_BEGIN_PATTERN/SINGING_PATTERN - "<Name>
// begins casting/singing X.", never "You begin...". The verb form alone
// ("begins" vs "begin") already excludes the player's own first-person
// line, no extra guard needed. Used to recognize when an ambiguous landing
// text most likely belongs to someone else's cast, not the player's own -
// see matchOtherCastBegin() below and buffEngine.js's use of it.
const OTHER_CAST_BEGIN_PATTERN = /^(.+?) begins (?:casting|singing) (.+)\.$/;

// Third-person version of ACTIVATE_PATTERN - "<Name> activates X.", never
// "You activate...". Reported live and confirmed straight from the log:
// "Cade activates Quick Buff." - an ally triggering the exact same
// instant multi-grant ability the player's own ACTIVATE_PATTERN exists for
// (gotchas #12/#18), with none of the buffs it drops carrying any per-spell
// cast line at all. Verb form alone excludes the player's own line, same as
// OTHER_CAST_BEGIN_PATTERN above.
const OTHER_ACTIVATE_PATTERN = /^(.+?) activates (.+)\.$/;

// Gem-swapping lines - confirmed exact wording from this server's own log:
// "You forget X." when a spell leaves a gem slot, "You have finished
// memorizing X." when one is scribed into one ("Beginning to memorize X..."
// fires first but can in principle be interrupted, so only the completion
// line is treated as authoritative). Used to track which of the player's
// scribed spells are actually sitting in a castable gem slot right now - a
// much stronger disambiguation signal than "ever scribed" for spells that
// share landing text with other ranks/versions the player has scribed in
// the past but isn't currently using (see buffEngine.js).
const MEMORIZE_FINISHED_PATTERN = /^You have finished memorizing (.+)\.$/;
const FORGET_SPELL_PATTERN = /^You forget (.+)\.$/;

// EQ's generic heal/proc combat message - confirmed exact wording from a
// real log: "You healed Vaela for 255 hit points by Talisman of Altuna."
// Only ever fires for the PLAYER'S OWN outgoing heal (who it landed on
// doesn't matter - it always names a spell the player themselves cast), so
// it's a strong disambiguation signal: if the named spell is one of the
// candidates for an ambiguous landing text still sitting in the queue, this
// confirms it directly, the same certainty as the player answering the
// ambiguous popup themselves. See buffEngine.js's use of this.
const HEAL_BY_SPELL_PATTERN = /^You healed .+ for \d+ hit points by (.+)\.$/;

// Safety net only - the fast path is matching a landing-flavor line below.
const FALLBACK_CONFIRM_WINDOW_MS = 12000;

// How long after an "activate" line to keep accepting buffs whose landing
// text is ambiguous (shared by multiple spells) - see buffEngine.js.
const BURST_WINDOW_MS = 8000;

// Party composition changing invalidates any "we guessed this ambiguous
// text means buff X because of who's in the group" memory (see
// buffEngine.js) - confirmed exact wording from this server's own log.
const PARTY_CHANGE_PATTERNS = [
  /^You have joined the group\.$/,
  /^You have been removed from the group\.$/,
  /^.+ has joined the group\.$/,
  /^.+ has left the group\.$/,
];

// Capturing versions of the "someone else" party-change lines, used to
// maintain an actual roster of current group member names (see
// buffEngine.js's groupMembers) - needed to bound ally-buff detection to
// confirmed group members rather than any name that happens to appear in a
// third-person landing line.
const GROUP_MEMBER_JOINED_PATTERN = /^(.+) has joined the group\.$/;
const GROUP_MEMBER_LEFT_PATTERN = /^(.+) has left the group\.$/;

// When you accept an invite into a group that already existed (as opposed to
// someone joining a group you're already in), the log never names the
// pre-existing members - only your own content-free "You have joined the
// group." shows up. This line is the one exception: it names the person
// whose invite you accepted, one line before that self-join line lands. See
// buffEngine.js's pendingGroupInviter for how it survives the self-join
// roster clear that immediately follows.
const GROUP_JOIN_ACCEPTED_PATTERN = /^You notify (.+) that you agree to join the group\.$/;

// Lines that mean the cast in progress is not going to land. Only consulted while a cast is
// pending, so a stray match costs one cancelled timer rather than anything permanent.
//
// EVERY PATTERN HERE WAS COUNTED AGAINST THE OWNER'S 1,521,971 REAL LOG LINES, and the counts are
// beside them. The previous list was written from memory of EverQuest's wording and nine of its
// twelve patterns matched nothing whatsoever - "Your spell fizzles" (the game says "Your <Spell>
// spell fizzles!"), "would not take hold" (it says "did not take hold"), "Your spell is
// interrupted" (it says "Your <Spell> spell is interrupted."). If you add one, count it first.
const FAILURE_PATTERNS = [
  // Named-spell failures. Unambiguous: the line says which spell, so it cannot be about anything
  // else the player was doing.
  /^Your .+ spell fizzles!$/i,                        // 1
  /^Your .+ spell is interrupted\.$/i,                // 571
  /^Your .+ spell did not take hold/i,                // 189 - stacking, see matchOverwritten
  // Names no spell, but it is one exact whole line and measures free.
  /^Insufficient Mana to cast this spell!$/i,         // 389
];

// DELIBERATELY NOT HERE, having been tried and measured:
//
//   /^Your target is too far away, get closer!$/i    2,959
//   /^You cannot see your target\.$/i                  464
//   /^Your target is out of range, get closer!$/i       46
//   /^You cannot perform that action right now\.$/i     41
//   /^You must first select a target for this spell!$/i  303
//
// They look like cast failures and they are real lines, but they name no spell and they are not
// only about casting - they fire for anything needing range or line of sight. Adding them
// cancelled 883 more pending casts and cost two spells that then never landed at all: with the
// pending cast gone, the landing that followed had no cast to be matched against and fell through
// to the ambiguous tier instead. Every pattern above names a spell, which is what makes it safe.
//
// Measured against 1,521,971 lines: with the four range/target lines in, distinct buffs landed
// dropped 129 -> 127. "You must first select a target" looks safer than those - it is one exact
// whole line and can only be about a spell - and it still cost one, 129 -> 128, so it is out too.
// With only the list above, distinct buffs stays at 129 and 570 failed casts are still cancelled.
//
// The lesson, since it cost two measurements to learn: whether a pattern is safe has nothing to do
// with how obviously it means "the cast failed". It depends on whether cancelling the pending cast
// takes away the only thing that was disambiguating the landing which follows.

// Common sentence openers EQ uses for "an effect just happened to you" text.
// Deliberately narrow (anchored to the start of the line) to avoid matching
// unrelated chat ("Someone tells you...") or combat spam.
const LANDING_HINT_PATTERNS = [
  /^You feel /i,
  /^You are (?:now |suddenly |surrounded|infused|imbued|engulfed|encased|blessed|filled)/i,
  /^Your skin /i,
  /^Your body /i,
  /^Your weapons /i,
  /^Your voice /i,
  /^Your muscles /i,
  /^Your eyes /i,
  /^Your throat /i,
];

function stripTimestamp(line) {
  return line.replace(TIMESTAMP_PREFIX, '');
}

// Spell ranks show up as a trailing " Rk. II"/" Rk. III" or a bare trailing
// Roman numeral ("Denon's Desperate Dirge IX") depending on the spell -
// they're not part of the spell's actual identity, just a power tier, so
// name lookups/comparisons strip this before matching.
const RANK_SUFFIX = /\s+(?:Rk\.?\s*[IVX]+|[IVX]+)$/i;

function stripRankSuffix(name) {
  return name.replace(RANK_SUFFIX, '').trim();
}

const ROMAN_VALUES = { I: 1, V: 5, X: 10 };

// How high a rank a spell name carries, for picking the lowest of several
// variants of the same spell (see buffEngine's rank collapsing). A name with
// no suffix at all is rank 0 - lower than "I" - since that's the base spell.
// Returns 0 for anything unparseable, which keeps it out of the way.
function rankValue(name) {
  const match = RANK_SUFFIX.exec(name);
  if (!match) return 0;
  const numeral = match[0].replace(/\s+|Rk\.?/gi, '').toUpperCase();
  let total = 0;
  for (let i = 0; i < numeral.length; i++) {
    const current = ROMAN_VALUES[numeral[i]] || 0;
    const next = ROMAN_VALUES[numeral[i + 1]] || 0;
    total += current < next ? -current : current;
  }
  return total;
}

function matchCastBegin(line) {
  const stripped = stripTimestamp(line);
  const match = CAST_BEGIN_PATTERN.exec(stripped) || SINGING_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

// Separate from matchCastBegin so callers that already matched a cast-begin
// line can tell which verb it used (e.g. to tag the resulting buff as a
// bard song for the "hide bard songs" widget filter) without re-deriving
// the name.
function matchSingingBegin(line) {
  const stripped = stripTimestamp(line);
  return SINGING_PATTERN.test(stripped);
}

function matchActivate(line) {
  const stripped = stripTimestamp(line);
  const match = ACTIVATE_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

function matchOtherActivate(line) {
  const stripped = stripTimestamp(line);
  const match = OTHER_ACTIVATE_PATTERN.exec(stripped);
  if (!match) return null;
  return { casterName: match[1].trim(), abilityName: match[2].trim() };
}

function matchOtherCastBegin(line) {
  const stripped = stripTimestamp(line);
  const match = OTHER_CAST_BEGIN_PATTERN.exec(stripped);
  if (!match) return null;
  return { casterName: match[1].trim(), spellName: match[2].trim() };
}

function matchMemorizeFinished(line) {
  const stripped = stripTimestamp(line);
  const match = MEMORIZE_FINISHED_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

function matchForgetSpell(line) {
  const stripped = stripTimestamp(line);
  const match = FORGET_SPELL_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

function matchHealBySpell(line) {
  const stripped = stripTimestamp(line);
  const match = HEAL_BY_SPELL_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

function matchGroupMemberJoined(line) {
  const stripped = stripTimestamp(line);
  const match = GROUP_MEMBER_JOINED_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

function matchGroupMemberLeft(line) {
  const stripped = stripTimestamp(line);
  const match = GROUP_MEMBER_LEFT_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

function matchGroupJoinAccepted(line) {
  const stripped = stripTimestamp(line);
  const match = GROUP_JOIN_ACCEPTED_PATTERN.exec(stripped);
  return match ? match[1].trim() : null;
}

function isPartyChangeLine(line) {
  const stripped = stripTimestamp(line);
  return PARTY_CHANGE_PATTERNS.some((pattern) => pattern.test(stripped));
}

function isFailureLine(line) {
  const stripped = line.replace(TIMESTAMP_PREFIX, '');
  return FAILURE_PATTERNS.some((pattern) => pattern.test(stripped));
}

// ---------------------------------------------------------------------------
// How a debuff on something you are fighting comes to an end.
//
// A buff on YOU ends with the roster's endedText. A debuff on a mob does not: none of these three
// lines is in the roster, and until now the app had no way to know a mez had broken, so an enemy
// tile could only ever count down to zero and hope. All three shapes below were counted against
// the owner's 1,521,971 real log lines, and the counts are in the note beside each one.
// ---------------------------------------------------------------------------

// "Your Mesmerize spell has worn off of orc legionnaire."  (1,440 lines)
//
// The best of the three by far, because it names the spell AND the target, so nothing has to be
// guessed. Its one limit is that it is CASTER-SCOPED: it only ever appears for a spell YOU cast.
// One of the owner's logs has 14 mez landings and not one wear-off line, because every one of
// those mezzes was a groupmate's.
const OTHERS_WORN_OFF_PATTERN = /^Your (.+) spell has worn off of (.+)\.$/;

// "A worry wraith has been slain by Vaela!"  (6,617)   /   "You have slain a worry wraith!"  (482)
//
// Two shapes, and they capitalize differently: the slain-by form forces a capital at the start of
// the sentence ("A worry wraith"), while the you-have-slain form keeps the name's natural casing
// ("a worry wraith"). The same mob therefore appears both ways, which is why every lookup built
// on these has to be case-insensitive.
const SLAIN_BY_PATTERN = /^(.+) has been slain by .+!$/;
const YOU_SLEW_PATTERN = /^You have slain (.+)!$/;

// The PLAYER'S OWN death - a different wording from the mob-death lines above ("You HAVE been
// slain by ...", not "<X> HAS been slain by ..."), which is why matchSlain never matched it.
// Backlog #12: death strips every buff, so the engines clear their active state on this line.
const OWN_DEATH_PATTERN = /^You have been slain by .+!$/;

// "Orc legionnaire has been awakened by Vaela."  (142)
//
// A mez broken early by damage, naming whoever broke it. This line was not known to the project
// at all - the note covering AoE mez assumed a break was silent - and it is the only way to tell
// a mez that was broken from one that ran its course. It does not name the spell, so it can only
// clear a mez, not an arbitrary debuff.
//
// Two things worth knowing. It is not a complete signal - of roughly 121 identifiable breaks, 99
// emitted this line, so about four in five; the timer stays as the backstop. And for a mez YOU
// cast it is redundant, because the wear-off line above lands in the same second and always
// first (98 of 98 pairs). Its real use is a mez cast by somebody else, which produces no
// wear-off line at all.
const AWAKENED_PATTERN = /^(.+) has been awakened by .+\.$/;

function matchOthersWornOff(line) {
  const m = OTHERS_WORN_OFF_PATTERN.exec(stripTimestamp(line));
  return m ? { spellName: m[1], targetName: m[2] } : null;
}

// The name of whatever just died, or null. Both death shapes, since either can be the one that
// ends a fight the player was tracking a debuff through.
function matchSlain(line) {
  const stripped = stripTimestamp(line);
  const m = SLAIN_BY_PATTERN.exec(stripped) || YOU_SLEW_PATTERN.exec(stripped);
  return m ? m[1] : null;
}

// True when this line is the player's own death.
function matchOwnDeath(line) {
  return OWN_DEATH_PATTERN.test(stripTimestamp(line));
}

function matchAwakened(line) {
  const m = AWAKENED_PATTERN.exec(stripTimestamp(line));
  return m ? m[1] : null;
}

// "Your Superior Healing spell is interrupted."  (571 of the owner's own; 1,141 more belong to
// other people and are deliberately not matched here - theirs start with a name, not "Your").
//
// Matters for cooldowns. A recast clock only starts if the cast actually finished, and 16% of her
// casts are interrupted, so a countdown started on the cast line has to be taken back when this
// arrives or it will sit there claiming a spell is unavailable when it is ready.
//
// The spell is named without its rank in almost every case - "Your Superior Healing spell is
// interrupted." even though the cast line said "Superior Healing III" - so the caller should
// resolve it the same way it resolves a cast name.
const OWN_INTERRUPT_PATTERN = /^Your (.+) spell is interrupted\.$/;

// "Your Shield of Thistles spell on Baxa has been overwritten."  (109 lines, one shape, no
// exceptions.)
//
// Note 26, and it turns out to be the whole of it for a buff on somebody else. The note assumed
// the app would have to model EverQuest's stacking rules to know when a buff had been replaced.
// It does not: the game says so, and it names both the spell and the target.
//
// The counterpart for a buff on YOURSELF is the spell's own endedText, which the app already
// handles - there is no "worn off" line for a self buff at all. The 112 lines that look like one
// are every last one of them "Your pet's <Spell> spell has worn off."
const OVERWRITTEN_PATTERN = /^Your (.+) spell on (.+) has been overwritten\.$/;

// "Your Protection of Rock spell did not take hold on Baxa. (Blocked by Bravery.)"
//
// The other half of note 26, and the half that matters more: a cast that was REFUSED because
// something better is already there. 189 in the owner's logs - 133 naming a target, 51 on herself,
// 5 with no blocker named at all.
//
// It is already treated as a cast failure by FAILURE_PATTERNS, which is what stops a tile
// appearing. This matcher exists to pull the three names out so the debug log can say WHICH buff
// won, which is the only record anywhere of what actually stacks on this server.
//
// The blocker clause is optional on purpose. All 5 lines without it are real, and a cast that
// failed with no reason given is still a cast that failed.
const NO_HOLD_PATTERN = /^Your (.+) spell did not take hold(?: on (.+?))?\.(?: \(Blocked by (.+)\.\))?$/;

// "You have entered The Ruins of Old Guk 1 (Awakened)."  (225 lines, one shape)
//
// Note 38. The ONLY line that names the zone you are in - there is no periodic announcement and
// no way to ask. `LOADING, PLEASE WAIT...` fires on every zone change and carries no name.
//
// ANCHORED ON THE TIMESTAMP, and that is not tidiness. Anyone can type this sentence into General
// chat, and one person did:
//
//   [Mon Aug 17 02:01:16 2026] Maryona tells General:1, 'Back in 2000 playing my DE Mage, went to
//   explore Permafrost. ... Loading, please wait... You have entered Everfrost. ...'
//
// An unanchored lazy match pulls "Everfrost" out of that - a real zone name, from a stranger's
// chat, silently moving the app to a zone the player has never been in. Anchored: 225 matches
// instead of 226, and the one it drops is that line.
//
// Greedy to the end is then safe: no zone name in 1,521,971 lines contains a full stop.
const ZONE_PATTERN =
  /^\[[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \d{4}\] You have entered (.+)\.$/;

// Not a zone, despite the identical opening. Absent from this owner's logs but a real EverQuest
// line, so it is excluded on purpose rather than by luck.
const NOT_A_ZONE_PREFIX = /^an area where /i;

function matchZoneChange(line) {
  // Matched against the RAW line, timestamp and all. logWatcher splits incoming data on CRLF as
  // well as LF, so no trailing carriage return ever reaches here. An offline script that reads a
  // log file itself must strip its own line endings first - four of these logs are CRLF, and an
  // end-anchored pattern silently finds nothing on them otherwise.
  const m = ZONE_PATTERN.exec(String(line));
  if (!m) return null;
  if (NOT_A_ZONE_PREFIX.test(m[1])) return null;
  return m[1];
}

function matchDidNotTakeHold(line) {
  const m = NO_HOLD_PATTERN.exec(stripTimestamp(line));
  if (!m) return null;
  return { spellName: m[1], targetName: m[2] || null, blockedBy: m[3] || null };
}

function matchOverwritten(line) {
  const m = OVERWRITTEN_PATTERN.exec(stripTimestamp(line));
  return m ? { spellName: m[1], targetName: m[2] } : null;
}

function matchOwnInterrupt(line) {
  const m = OWN_INTERRUPT_PATTERN.exec(stripTimestamp(line));
  return m ? m[1] : null;
}

function looksLikeLandingMessage(line) {
  const stripped = line.replace(TIMESTAMP_PREFIX, '');
  return LANDING_HINT_PATTERNS.some((pattern) => pattern.test(stripped));
}

module.exports = {
  matchCastBegin,
  matchSingingBegin,
  matchActivate,
  matchOtherActivate,
  matchOtherCastBegin,
  matchMemorizeFinished,
  matchForgetSpell,
  matchHealBySpell,
  matchGroupMemberJoined,
  matchGroupMemberLeft,
  matchGroupJoinAccepted,
  matchZoneChange,
  matchDidNotTakeHold,
  matchOverwritten,
  matchOwnInterrupt,
  matchOthersWornOff,
  matchSlain,
  matchOwnDeath,
  matchAwakened,
  isFailureLine,
  isPartyChangeLine,
  looksLikeLandingMessage,
  stripTimestamp,
  stripRankSuffix,
  rankValue,
  FALLBACK_CONFIRM_WINDOW_MS,
  BURST_WINDOW_MS,
};
