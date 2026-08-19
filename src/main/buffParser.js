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
// real log: "You healed Shara for 255 hit points by Talisman of Altuna."
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

const FAILURE_PATTERNS = [
  /Your spell fizzles/i,
  /casting has been interrupted/i,
  /Your spell is interrupted/i,
  /resisted the .*spell/i,
  /would not take hold/i,
  /would not have taken hold/i,
  /You can.t see your target/i,
  /unable to reach your target/i,
  /Insufficient Mana/i,
  /You cannot cast spells (here|while)/i,
  /out of range/i,
  /you are unable to/i,
];

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

function looksLikeLandingMessage(line) {
  const stripped = line.replace(TIMESTAMP_PREFIX, '');
  return LANDING_HINT_PATTERNS.some((pattern) => pattern.test(stripped));
}

module.exports = {
  matchCastBegin,
  matchSingingBegin,
  matchActivate,
  matchOtherCastBegin,
  matchMemorizeFinished,
  matchForgetSpell,
  matchHealBySpell,
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
};
