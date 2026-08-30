'use strict';

// EQLS Lockouts — parsing core.
//
// Pure. No `require` of anything at all. No Electron, no DOM, no filesystem,
// no timers, and `Date.now()` is never called in this file. Lines in, an
// explicit `now` in, JSON-clonable state out.
//
// WHAT THIS MODULE IS FOR
//
// EverQuest Legends does not print a raid lockout line. We checked: see
// docs/EVIDENCE.md. What it *does* print is a weekly task, by name, on the
// kill:
//
//   You have been assigned the task 'Potential of the Void - Lord Nagafen - Weekly'.
//   Your task 'Potential of the Void - Lord Nagafen - Weekly' has been updated.
//   You have been given: Void-Touched Potential
//
// Every other tool that ships this feature infers a lockout from kill history
// and hardcodes a reset day. This module does neither. It records what the
// game said and when, and reports the reset boundary as the *bracket* the
// observations actually support — never as a constant.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE
//
// No reset day is hardcoded. `projectReset()` returns `provenance: 'not
// recorded'` until two assignments of the same task have been observed on
// opposite sides of a turnover. There is no default. There is no fallback
// constant. If you are tempted to add one, read docs/EVIDENCE.md first: the
// only two published implementations of this feature both ship a typed
// Tuesday, and one of them marks it "VERIFY IN GAME" in its own source.
//
// TIME, AND WHY IT IS AWKWARD ON PURPOSE
//
// A log stamp is `[Mon Aug 10 17:14:49 2026]`. It carries no timezone and no
// UTC offset. It is the game client's local wall clock, nothing more. This
// module therefore works entirely in *civil time* and refuses to produce an
// instant. `civilOf()` returns a monotone integer for differencing only; it is
// not an epoch and must not be displayed or persisted as one.
//
// The known cost, stated rather than hidden: across a daylight-saving
// transition, a civil difference is off by the size of the shift. `CAVEAT_DST`
// is attached to every interval this module reports. `crossesPossibleDstShift`
// is emitted on each bracket and is **always null**, because this module has no
// timezone and therefore genuinely cannot decide it — the field exists so a
// host that DOES know its zone can fill it in, not because we computed it.

// ===========================================================================
// THE CONTRACT
// ===========================================================================
//
// Everything below is a promise to the host application. Six of these came from
// Session C, who read a real Electron log-parsing app and listed what a retrofit
// module has to satisfy. They are written here rather than only in the code that
// satisfies them, because a constraint honoured in one function and undocumented
// is a constraint the next edit breaks.
//
// 1. INPUT IS THE RAW LINE, PREFIX AND ALL.
//    Give this module exactly what the tailer emits:
//        [Wed Aug 19 19:17:52 2026] You say, 'danger'
//    Do NOT strip the timestamp first. Host parsers commonly strip it as their
//    first step; here the timestamp IS the measurement, and a stripped line
//    parses to null rather than failing loudly. Lines the module does not model
//    are ignored, so it is safe to feed it everything.
//
// 2. THE CLOCK IS NEVER READ. `now` IS THE ONLY TIME SOURCE.
//    No `Date.now()`, no `new Date()`, no timers, no intervals in this file.
//    Stronger, and this is the property that matters: **`now` does not affect
//    accumulated state at all.** `applyLine` never sees it. It is an argument to
//    `project()` only, where it feeds derived views like `hoursAgo`. So replaying
//    a million lines produces byte-identical state to receiving them live, and a
//    test asserts it.
//
// 3. ONE-SECOND RESOLUTION, AND NO ORDERING WITHIN A SECOND.
//    The log stamps to the second. Two events sharing a stamp arrive in an order
//    the log does not guarantee, and **nothing in this module may depend on that
//    order.**
//
//    This is not theoretical. Two sessions on this project were bitten by it
//    independently, in different codebases: Session C by a mez break and its
//    wear-off sharing a stamp, and this module by the Voidling's closing line
//    arriving BEFORE the task line it was being used to terminate:
//
//        [Tue Aug 11 20:40:44 2026] You say, 'danger'
//        [Tue Aug 11 20:40:44 2026] Voidling says, 'Your hubris risks our very reality itself.'
//        [Tue Aug 11 20:40:44 2026] You have been assigned the task '... Lady Vox - Weekly'.
//
//    That produced a false reset bracket from a granted task read as a refusal. The fix was structural, not a patch: `applyLine` classifies
//    nothing. It records raw observations, and `classifyRequests` decides later
//    with the whole window visible. **Any future logic that asks "did A happen
//    before B" must instead ask "did A and B both happen within N seconds".**
//
// 4. STATE IS JSON, AND ONLY JSON.
//    No Map, Set, Date, function, undefined, Infinity or NaN ever enters state.
//    Those survive every unit test and silently empty or corrupt on the first
//    reload. State is plain objects, arrays, strings, numbers, booleans and null,
//    so `JSON.parse(JSON.stringify(state))` is exact. A test asserts the round
//    trip is deep-equal.
//
// 5. NO FILE IS OWNED, NO DEFAULT IS OWNED.
//    This module never reads or writes anything. It has no config file, no
//    persistence, and no opinion about where state lives. It hands back a plain
//    object; the host owns defaults, backfill and migration, because that
//    ownership living in one place is what lets a host change its schema without
//    a migration.
//
// 6. FEEDING THE SAME LINE TWICE IS SAFE. IT IS IDEMPOTENT.
//    Stated plainly because "undecided is what hurts": a tailer that re-reads a
//    tail, a backfill that overlaps the live stream, or the same file arriving
//    twice under different names all produce **no change in state**. Every
//    observation is keyed by (timestamp, kind, identity) and a repeat increments
//    `dropped.duplicate` instead of being recorded. A test feeds the fixture
//    twice and asserts the state is deep-equal to feeding it once.
//
//    Verified by diff, not by assertion: replaying the whole stream changes
//    exactly ONE key in the entire state object — `dropped.duplicate`, the
//    counter recording how many repeats were rejected. That counter is supposed
//    to move. Nothing else does.
//
//    Voidling replies are the one thing NOT stored as an event. They are a set
//    of SECONDS, because one NPC answers several players at once and prints two
//    lines per exchange, so a list would grow on replay. An earlier revision
//    exempted them from dedupe and called it a deliberate exception; the
//    CONTRACT 6 test proved that broke idempotence, and the exception is gone.
//    Presence is all they are for, and a set is idempotent by construction.
//
//    THAT SET IS BOUNDED, AND HERE IS THE BOUND. It holds at most MAX_EVENTS
//    (5,000) distinct seconds, oldest dropped first. A set with no bound is a
//    leak in a page the owner is asked to leave open all evening, and "it is a
//    set so it cannot grow" is only true of repeats — distinct seconds keep
//    arriving as long as the client is running. At one Voidling exchange per
//    second sustained, 5,000 seconds is about 83 minutes of continuous hailing;
//    in real play the corpus produces 195 replies across three weeks. The cost
//    of the bound is that a refusal older than the 5,000th most recent Voidling
//    second loses its positive control and degrades to `unknown` — the safe
//    direction, never to a false lockout.
//
// 7. ONE STATE PER CHARACTER. THE CHARACTER IS AN INPUT.
//    `createState(character)` requires the name and refuses to be shared.
//
//    **THIS IS A CLAIM ABOUT OUR DATA, NOT ABOUT THE GAME.** An earlier revision
//    of this comment argued the lockout is "per character, not per account". An
//    adversarial pass refuted that unanimously, and the fact that kills it is in
//    our own logs:
//
//        eqlog_Avenrae_rivervale.txt      Your total time entitled on this account is approximately 0 years, 12 days.
//        eqlog_Shara_rivervale_*.txt      Your total time entitled on this account is approximately 0 years, 9 days.
//
//    **Two different values means two different accounts.** So the fact that
//    Avenrae and Shara each received their own grant of the same task, seconds
//    apart at the same Voidling, says NOTHING about per-character versus
//    per-account — two accounts would each get a grant under either rule. The
//    observation had no power to distinguish them and should never have been
//    offered as though it did.
//
//    Worse, the hedge attached to it said "the logs do not say which". The logs
//    say exactly which, in the game's own /played output, and nobody had
//    searched. That is a clearance asserted without a string, which is the fault
//    this project exists to catch.
//
//    **The real reason for per-character state is operational and sufficient:**
//    a log file belongs to one character, a host tailer follows whichever file
//    changed last and therefore hops between them, and merging two characters'
//    observation streams fabricates measurements. Not hypothetically — the first
//    version of this module reported a FOUR-SECOND reset bracket built from
//    Avenrae's grant at 17:14:49 and Shara's at 17:14:53.
//
//    Whether the game scopes lockouts per character or per account is
//    **not recorded**, and settling it needs two characters on ONE account,
//    which this corpus does not contain.
//
// ===========================================================================

// ---------------------------------------------------------------------------
// Difficulty grammar
// ---------------------------------------------------------------------------
//
// DERIVED, NOT TYPED. Every pair below was read out of the client's own
// instance-invite line across 27 distinct instance names in our corpus, with
// no exceptions and no conflicts:
//
//   Lumbarin has asked you to join the instance: Nagafen's Lair - Group 1 (Awakened).
//
// This table is derived, not hand-maintained: regenerated from the corpus by an analysis script
// kept outside the repo. If the game adds a tier, re-run that derivation and update the table
// from its output rather than editing it here.
const DIFFICULTY_LABELS = ['Normal', 'Awakened', 'Adaptive', 'Fused', 'Refined'];

// The three bosses observed carrying a weekly task in our corpus. This list is
// NOT used to gate parsing — `parseLine` accepts any boss name the game emits,
// because a list of bosses we happen to have killed is not a list of bosses
// that exist. It is exported only so a UI can show known-vs-new.
const OBSERVED_WEEKLY_BOSSES = ['Lord Nagafen', 'Lady Vox', 'Master Yael'];

const CAVEAT_DST =
  'Log stamps carry no timezone. An interval spanning a daylight-saving ' +
  'transition is wrong by the size of the shift. Treat as a bound, not a duration.';

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

// `[Mon Aug 10 17:14:49 2026] rest of line`
// Day is zero-padded in every line measured in our corpus, but classic EQ
// space-pads single-digit days, so both are accepted. Costs nothing.
const TS_RE = /^\[([A-Za-z]{3}) ([A-Za-z]{3}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\] ?(.*)$/;

// Splits a raw log line into its civil timestamp and its message.
// Returns null when the line does not carry a stamp — which is a real case:
// a line can arrive mid-write, and multi-line lore text has no stamp.
function splitStamp(line) {
  if (typeof line !== 'string') return null;
  // A CHEAP DISCRIMINATOR BEFORE THE REGEX. Every stamped line begins '[', and
  // the overwhelming majority of a log is combat and chat that this module does
  // not model. Testing one character code first avoids running the timestamp
  // pattern over all of it. Borrowed from the Sky Ledger, which found the same
  // thing on the same shape of file. `charCodeAt` on an empty string returns
  // NaN, which fails the comparison, so it doubles as the empty-line guard.
  if (line.charCodeAt(0) !== 91) return null;   // 91 = '['
  // STRIP A TRAILING CR. The logs are CRLF — measured, every line of all 15
  // files — and a host that splits on '\n' alone (a very common idiom) hands us
  // lines ending in '\r'.
  //
  // Without this the failure is silent and total: TS_RE still matches, because
  // `.` matches CR, so the CR rides along inside `message` and every anchored
  // shape regex below fails on its `$`. The line is dropped, `dropped.unstamped`
  // is NOT incremented because the stamp parsed fine, and the module reports
  // "no lockouts, ever" with a clean diagnostic. That is the exact failure this
  // project exists to catch — a false negative that looks like a real one.
  //
  // It has never bitten us only because `readline({crlfDelay: Infinity})` and
  // the host's `split(/\r\n|\n/)` both strip CR first. That is luck, not design.
  if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
  const m = TS_RE.exec(line);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  return {
    at: {
      weekday: m[1],          // as the client wrote it; never recomputed
      year: Number(m[7]),
      month,
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
      second: Number(m[6]),
    },
    message: m[8],
  };
}

// A monotone integer over civil time, for differencing ONLY.
// Date.UTC is a pure arithmetic function of its arguments — it reads no clock.
// The result is deliberately not an instant: see the header note on time.
function civilOf(at) {
  return Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second);
}

// 0 = Sunday, matching JS getUTCDay, computed from the civil date rather than
// trusted from the client's three-letter weekday. Both are reported; a
// mismatch is surfaced rather than silently resolved.
function civilWeekday(at) {
  return new Date(civilOf(at)).getUTCDay();
}

function formatCivil(at) {
  const p = (n, w) => String(n).padStart(w, '0');
  return `${at.year}-${p(at.month, 2)}-${p(at.day, 2)} ${p(at.hour, 2)}:${p(at.minute, 2)}:${p(at.second, 2)}`;
}

// ---------------------------------------------------------------------------
// Line shapes
// ---------------------------------------------------------------------------
//
// Every pattern below was read off a line in our own logs or off the client's
// own string table at
// `<install>/eqstr_us.txt`. None was invented, and none came from another
// project's source. Provenance per shape is in docs/EVIDENCE.md.

// You have been assigned the task 'Potential of the Void - Lord Nagafen - Weekly'.
const TASK_ASSIGNED_RE = /^You have been assigned the task '(.+?)'\.$/;

// Your task 'Potential of the Void - Lord Nagafen - Weekly' has been updated.
const TASK_UPDATED_RE = /^Your task '(.+?)' has been updated\.$/;

// You have been given: Void-Touched Potential
const GIVEN_RE = /^You have been given: (.+)$/;

// Splits `Potential of the Void - Lord Nagafen - Weekly` into its parts.
// Anchored on the trailing cadence word so a boss name containing " - " cannot
// break it. The cadence is captured as written rather than matched against a
// list — if the game ships a "Daily", this still parses and the caller sees it.
const TASK_NAME_RE = /^(.+?) - (.+) - ([A-Za-z]+)$/;

// THE LOCKOUT SIGNAL.
//
// The weekly task is granted by a dialogue tree on an NPC named Voidling,
// standing in the static parent zone. Measured, verbatim, both outcomes:
//
//   GRANTED
//     [Mon Aug 10 17:14:47] You say, 'Hail, voidling'
//     [Mon Aug 10 17:14:48] Voidling says, 'Ah, another who thinks themselves a Legend. ... the [danger]...'
//     [Mon Aug 10 17:14:49] You say, 'danger'
//     [Mon Aug 10 17:14:49] You have been assigned the task 'Potential of the Void - Lord Nagafen - Weekly'.
//     [Mon Aug 10 17:14:49] Voidling says, 'Your hubris risks our very reality itself.'
//
//   REFUSED  (locked out)
//     [Mon Aug 10 18:05:16] You say, 'Hail, voidling'
//     [Mon Aug 10 18:05:16] Voidling says, 'Ah, another who thinks themselves a Legend. ... the [danger]...'
//     [Mon Aug 10 18:05:17] You say, 'danger'
//     [Mon Aug 10 18:05:18] Voidling says, 'Your hubris risks our very reality itself.'
//
// The two are identical but for the task line. When you are locked out the
// game says NOTHING — there is no refusal line, no timer line, no lockout line
// anywhere in 440 MB of log. Silence is the whole signal.
//
// WHY THAT IS SAFE HERE, when "silence" is normally this project's worst
// exposure: the Voidling's closing line fires in BOTH cases. It is a positive
// control built into the mechanic. An exchange with no Voidling line nearby is
// reported as UNKNOWN, never as a refusal, so a filtered channel cannot be
// mistaken for a lockout.
//
// BE PRECISE ABOUT WHAT THE CONTROL PROVES, because an audit found the obvious
// reading is too strong. **It proves the channel is showing NPC dialogue. It
// does NOT prove the Voidling answered ME.** The NPC replies to every player who
// hails it, zone-wide: measured, 123 of 195 closing lines in the corpus have no
// first-person `danger` within the preceding five seconds at all, and only 35 of
// 63 own-`danger` says draw a reply in the same second (19 at +1s, 2 at +2s,
// 2 at +4s, 5 never within 5s).
//
// That is still exactly the control this needs — the failure being guarded
// against is a chat filter hiding system text, and any Voidling line disproves
// that. But it is not proof that a given exchange completed, and it must not be
// written up as though it were.
const SELF_DANGER_RE = /^You say, 'danger'$/;
const VOIDLING_RE = /^Voidling says, '/;
const VOIDLING_CLOSING_RE = /^Voidling says, 'Your hubris risks our very reality itself\.'$/;

// You have entered The Ruins of Old Paineel - Group 2 (Adaptive).
// You have entered The Plane of Sky 0 (Normal).
// You have entered Nektulos Forest.
const ENTERED_RE = /^You have entered (.+?)\.$/;

// NOT EVERY "You have entered" IS A ZONE, and treating one as a zone silently
// destroys the instance context a kill needs.
//
// Measured, in the owner's own log:
//
//   [Mon Aug 10 18:05:40 2026] You have entered The Ruins of Old Paineel - Group 1 (Awakened).
//   [Mon Aug 10 18:05:40 2026] You have entered an area where levitation effects do not function.
//   [Mon Aug 10 18:11:22 2026] Master Yael has been slain by Cavity!
//
// The levitation notice parsed as a zone named "an area where levitation
// effects do not function", which is a bare name, which is the open world — so
// it cleared the instance and that Master Yael kill lost its difficulty. One
// real completion, silently dropped, by a message about levitation.
//
// The exclusion list is not guesswork from the corpus. It is the COMPLETE set
// the client can print, read out of the shipped string table
// `<install>/eqstr_us.txt`, where exactly three entries begin "You have entered":
//
//   3342  You have entered an area where levitation effects do not function.
//   5151  You have entered an Arena (PvP) area.
//   5492  You have entered            <- the zone template, "You have entered %1."
//
// The Arena line never occurred in our corpus and would have bitten identically.
const NOT_A_ZONE = new Set([
  'an area where levitation effects do not function',
  'an Arena (PvP) area',
]);

// A zone name the client writes always begins with a capital or an article-cap
// ("The Plane of Sky", "Nagafen's Lair", "Paineel"). Anything starting
// lower-case is a sentence, not a place. This is a BACKSTOP for a string the
// next patch adds that we have not seen: such a line is ignored rather than
// treated as a zone, and flagged, so it surfaces instead of silently clearing
// the instance the way the levitation notice did.
const LOOKS_LIKE_A_SENTENCE = /^[a-z]/;

// Lumbarin has asked you to join the instance: Nagafen's Lair - Group 1 (Awakened).        Would you like to join? ...
// Client string 3527. The run of spaces is the client's, and is matched
// loosely so a change in its width cannot break the parse.
const INSTANCE_INVITE_RE = /^(.+?) has asked you to join the instance: (.+?)\.\s+Would you like to join\?/;

// Zone names come in FOUR shapes, all measured across the 68 distinct zone
// strings in our corpus. Getting this wrong collapses two populations into
// one bucket, which is the error this project has already made once:
//
//   The Plane of Sky                              open world      (37 of 68)
//   The Permafrost Caverns - Group                group instance, difficulty NOT STATED
//   The Ruins of Old Paineel - Group 2 (Adaptive) group instance at D2
//   The Plane of Fear 4 (Refined)                 raid  instance at D4
//
// The third shape is the trap, AND I READ IT BACKWARDS FOR TWO WEEKS.
//
// This comment used to say `- Group` with no index means "difficulty not
// recorded — not D0". **It means D0 and nothing else.** The client omits the
// index and the label exactly when the index is zero.
//
// The correction cost a shipped tool that answered nothing. Every kill in a
// Normal instance carried `difficultyStated: false`, and one such kill blanked
// a whole row of the grid to `unknown`. The owner ran it after a week of
// raiding and got "0 of 25 done".
//
// MEASURED, all 16 log files, 26 Aug 2026 — the counts are the proof:
//
//   line shape                                   0    1    2    3    4
//   `has asked you to join the instance: ...`   12   16   13   19   18
//   `You have entered <Zone> - Group N (L).`     0   16   13   19   17
//   `You have entered <Zone> - Group.`          12    -    -    -    -
//
//   grep -acE "You have entered .* - (Group|Solo) 0 \(" <file>   ->  0, every file
//
// Tiers 1, 2 and 3 match invite-for-entry EXACTLY. Tier 4 is 18 invites to 17
// entries — one invite not accepted, which is what an invite is. And tier 0 is
// 12 invites to 12 bare entries and **not one entry line anywhere that states
// an index of 0**. Three of the twelve are directly paired on 26 Aug 2026:
//
//   17:52:12  Shangfei has asked you to join the instance: The Plane of Hate - Group 0 (Normal).
//   17:55:57  You have entered The Plane of Hate - Group.
//
// so the same instance is written both ways, three minutes apart, by the same
// client. The tier is STATED — by omission, which is a statement once the
// convention is measured. It is carried as `difficultyFromOmission` so any
// caller can see which rule assigned it, and a test asserts the 0-index entry
// line stays absent: the day one appears, the rule is dead and must be told so.
//
// `- Solo` DOES NOT GET THIS RULE, and the asymmetry is deliberate. `grep -a
// -- " - Solo"` over all 16 files returns **0** on every one — no entry line,
// no invite line, nothing. So there is no observation to extend the rule with,
// and extending it would be inventing a number. Bare `- Solo` therefore keeps
// `difficulty: null`, which degrades a cell to `unknown` — the old, safe,
// useless answer. **The owner's alt+Z window shows a `Solo 3` lock, so the
// shape is real and our logs have simply never seen one.** That gap is open.
const INSTANCE_FULL_RE = /^(.+?)(\s+-\s+(?:Group|Solo))?\s+(\d+)\s+\(([^)]+)\)$/;
const INSTANCE_BARE_RE = /^(.+?)\s+-\s+(Group|Solo)$/;

function parseInstanceName(name) {
  let m;

  if ((m = INSTANCE_FULL_RE.exec(name))) {
    const index = Number(m[3]);
    return {
      zone: m[1],
      instanced: true,
      group: /Group/.test(m[2] || ''),
      solo: /Solo/.test(m[2] || ''),
      difficulty: index,
      // The label the client wrote, kept verbatim. DIFFICULTY_LABELS is only
      // consulted to flag a disagreement — it never overrides the game.
      difficultyLabel: m[4],
      labelMatchesTable: DIFFICULTY_LABELS[index] === m[4],
      difficultyFromOmission: false,   // the client wrote the number itself
    };
  }

  if ((m = INSTANCE_BARE_RE.exec(name))) {
    // The omission IS the statement — for Group, where it is measured 12 times
    // out of 12 with no counterexample in 16 files. For Solo, where it is
    // measured zero times, it is not.
    const isGroup = m[2] === 'Group';
    return {
      zone: m[1],
      instanced: true,
      group: isGroup,
      solo: m[2] === 'Solo',
      difficulty: isGroup ? 0 : null,
      difficultyLabel: isGroup ? DIFFICULTY_LABELS[0] : null,
      labelMatchesTable: isGroup ? true : null,
      // Which rule assigned the tier: `true` means "the client wrote no index,
      // and no index means zero". Carried all the way to the kill so a cell can
      // say how it knows, and so this one inference stays findable if it is
      // ever wrong.
      difficultyFromOmission: isGroup,
    };
  }

  return { zone: name, instanced: false, group: false, solo: false, difficulty: null, difficultyLabel: null, labelMatchesTable: null, difficultyFromOmission: false };
}

// Parses one raw log line into an event, or null if it is not one we model.
// Pure: same input, same output, always.
// KILL LINES. Two shapes, and a search that knows only the first misses real kills.
//
//   Innoruuk, the Prince of Hate has been slain by Jrhx!
//   You have slain Innoruuk, the Prince of Hate!
//
// The first-person form is what the client writes when YOU land the killing
// blow. Measured across the five roster bosses, 8 of their kills take that form,
// and a parser searching only "has been slain by" loses every one of them.
//
// BOTH ARE ANCHORED AT THE START OF THE MESSAGE, and that is load-bearing.
// `grep -F "Innoruuk has been slain by"` returns 73 hits in our corpus of which
// NONE are the boss: they are `Cleric of Innoruuk` (68), `A Sage of Innoruuk`
// (4) and `A Knight of Innoruuk` (1). Add `Innoruuk\`s Chosen` (39+10) and a
// substring roster over-counts this one boss by roughly fourteen times.
const SLAIN_BY_RE = /^(.+?) has been slain by (.+?)!$/;
const YOU_SLEW_RE = /^You have slain (.+?)!$/;

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------
//
// Five bosses × five difficulty tiers = 25 cells, one completion per tier per
// week. Supplied first-hand by the owner, 23 Aug 2026.
//
// KEYED ON THE GAME'S STRING; the owner's wording is a display label only. That
// split is not tidiness — **an unmatched roster row and a genuinely uncompleted
// raid render identically**, so a typo here would show an empty row forever and
// look exactly like the thing this tracker exists to warn about. Three of the
// five needed correcting against real data:
//
//   owner wrote     game writes
//   Innoruuk    ->  Innoruuk, the Prince of Hate
//   Cazic Thule ->  Cazic-Thule                     (hyphen; "Cazic Thule" returns 0)
//   Vox / Nagafen / Yael                            exact
//
// A test asserts every key matches at least one boss string seen in real data,
// so a typo fails the build instead of rendering as an empty row.
// THE WEEKLY TASK IS NOT PER BOSS. It is the first three raids of the week.
//
// The owner, first-hand, 23 Aug 2026:
//
//   "Potential of the Void — these are only given to the player for the first 3
//    raids you complete each week. You may only ever carry 3 of them."
//
// **This overturns a reading I published an hour earlier.** Our corpus contains
// weekly tasks for only Lady Vox, Lord Nagafen and Master Yael, and I reported
// that as a property of those bosses — that Innoruuk and Cazic-Thule "have no
// Voidling weekly". Wrong. Those three are simply the raids that happened to be
// done first in the weeks we hold. Any raid can carry the task; only the first
// three in a week do.
//
// Measured, and it fits exactly. Per character, per week beginning Tuesday:
//
//   Avenrae, week of 11 Aug:  18 roster boss kills, 3 task grants, 3 tokens
//   Shara,   week of 11 Aug:  16 roster boss kills, 3 task grants, 3 tokens
//   Both, week of 4 Aug:       7 roster boss kills, 3 task grants, 3 tokens
//
// Eighteen raids, three tokens. The cap is on the token, not on the boss.
//
// TWO CONSEQUENCES, and both matter more than the correction itself:
//
// 1. A REFUSED VOIDLING HAIL MEANS "YOU HAVE USED YOUR THREE THIS WEEK", NOT
//    "THIS BOSS IS LOCKED". Every refusal in our corpus follows three grants in
//    the same week. The refusal is a signal about the CAP, and reading it as a
//    per-boss lockout would be wrong.
//
// 2. THE 25-CELL GRID AND THE TOKEN CAP ARE DIFFERENT SYSTEMS. The grid tracks
//    one completion per boss per tier per week — the owner's model, 25 cells.
//    The token tracks the first three raids of the week — one counter, three
//    deep. A boss can be open on the grid while the token cap is spent, and the
//    module must never let one answer the other.
//
// `weeklyTask` below therefore records only what our corpus HAPPENED to observe,
// and is not a claim about the boss.
const WEEKLY_TASK_IS_PER_BOSS = false;
// ===========================================================================
// THE ROW IS THE RAID, NOT THE BOSS
// ===========================================================================
//
// A player decides whether to *run Plane of Fear*. They do not decide whether
// to kill Cazic-Thule. So the row is labelled by what you RUN and names what it
// CONTAINS, and there is still exactly one cell per tier.
//
// This was five boss rows until the alt+Z window showed a single Plane of Fear
// run producing lockout rows for FIVE bosses at once, and a Plane of Hate run
// for TWO. Five cells moving in lockstep would be noise; worse, a row reading
// "Cazic Thule" when it means "the Plane of Fear raid" makes the player learn
// which boss we happened to pick to stand for the zone.
//
// Where the raid holds one boss — Vox, Nagafen, Yael — the boss name IS the
// right label and nothing changes for it.
//
// **THE ASSUMPTION UNDERNEATH, STATED BECAUSE IT IS ONE.**
//
// One cell per raid is correct only if the bosses inside a raid SHARE a lock.
// The alt+Z window is CONSISTENT with that and does not prove it: those bosses
// appeared together after runs that took them together, which is equally what
// five separate locks started at the same moment would look like.
//
// **If they ever diverge, one cell would hide it.** A player who killed Terror
// but not Cazic-Thule would see one cell, and the cell cannot be half true. The
// observation that would separate the two models is a run that clears SOME of a
// zone's bosses, followed by evidence about the others — and whether our corpus
// holds one is recorded in docs/EVIDENCE.md rather than assumed here.
//
// This is the same shape as the kill-stamping caveat: the model is the best fit
// to what we have seen, and the thing it would fail to show is named.
//
// FOUR THINGS THE CORPUS SAYS ABOUT THIS LIST THAT THE alt+Z WINDOW DID NOT.
// Measured across 16 files, 6.3M lines, 93 kills of the ten named bosses.
//
// 1. **EVERY ONE OF THOSE KILLS WAS IN A `- Group N` INSTANCE.** Zero in the
//    bare `Zone N` raid shape, zero in the open world — and the raid shape of
//    these zones DOES occur in the logs (14 Fear visits, 5 Hate visits) without
//    producing a single one of them. So "raid" here is the owner's word for the
//    activity, not the client's word for the instance shape, and nothing in this
//    module should key on the shape believing otherwise.
//
// 2. **THE PLANE OF HATE LIST IS INCOMPLETE FOR THE RAID SHAPE.** Ten further
//    bosses from our kill-line analysis of the corpus die inside Plane of Hate instances — but
//    only in the bare `Zone N` shape, and Innoruuk and the Maestro appear only
//    in `- Group N`. The two shapes hold different populations. The alt+Z window
//    was taken after Group-shape runs, so it could only ever have shown these
//    two. **A Hate row built from that window describes the group instance and
//    not the raid instance**, and that is not yet decided anywhere.
//
// 3. **THE PLANE OF FEAR LIST IS COMPLETE AT FIVE.** The only other candidate,
//    Phoboplasm, fails on its own evidence: it is absent from
//    our kill-line analysis of the corpus and dies up to FIVE times in one visit, where each of
//    the five dies exactly once per visit. A lockout boss dies once.
//
// 4. **`singleBoss` WAS FALSE FOR TWO OF THE THREE, and is now measured.**
//    The owner's alt+Z window lists FOUR bosses under Nagafen's Lair. The
//    corpus agrees independently. Counting group visits and asking which mobs
//    die EXACTLY ONCE ON EVERY VISIT — the signature that separates a lockout
//    boss from trash that always spawns:
//
//      Nagafen's Lair, 15 group visits
//        King Tranix 14/15 · Lord Nagafen 14/15 · Magus Rokyl 14/15
//        Warlord Skarlon 12/15
//        (a fire giant warrior is also 14/15 — but up to SIXTEEN per visit)
//
//      The Permafrost Caverns, 12 group visits
//        Lady Vox 12/12 · Giant wooly spider 12/12 · A priest of Nagafen 12/12
//        an ice giant diplomat 10/12
//        (an ice giant is also 12/12 — but up to SEVEN per visit)
//
//    "Killed on every visit" alone is worthless; it is universality PLUS
//    exactly-one-per-visit that discriminates, and the trash above shows why.
//
//    **A PRIEST OF NAGAFEN WAS HIDING BEHIND ITS ARTICLE.** Nobody had named
//    it, in the window or in any order, and it carries Lady Vox's exact
//    signature. It is the same trap as `a dracoliche`: the leading article
//    reads as trash and is not.
//
//    ~~"Only The Ruins of Old Paineel is genuinely single: all seven of its
//    group visits killed Master Yael and nothing else."~~ **THE SECOND HALF IS
//    FALSE.** Over 25 group visits Paineel also kills an elemental channeler
//    (20/25), a flighty fiend (17/25) and an elemental warrior (7/25). Master
//    Yael is the only mob at 25/25, so Paineel is single-REQUIRED-boss — but
//    "and nothing else" was a claim I never measured.
//
// 5. **THERE IS A THIRD KILL-LINE SHAPE AND THIS MODULE DOES NOT PARSE IT.**
//    `<Name> died.` — 47 lines across the 16 files, 8 of them inside a
//    `- Group` instance. It is NOT parsed, and that is a decision rather than
//    an oversight: the shape covers player and pet deaths as well as mob
//    deaths. `Shara died.` and `Avenrae died.` are both in it, so reading it as
//    a kill line would score the owner's own death as a boss kill.
//
//    **It touches none of the ten roster bosses** — searched all 16 files for
//    every roster spelling in a `died.` line and got zero — so the grid is
//    unaffected today. Where it DOES matter is the roster question above:
//    Warlord Skarlon and an ice giant diplomat each die twice in this shape,
//    which is most of the gap between their counts and 15/15 and 12/12.
//    Parsing it safely needs a way to tell a mob death from a player death,
//    and we do not have one yet.
//
// **NOT A DISCOVERED ROSTER, AND DELIBERATELY NOT YET.** A tracker that learns
// its raids from observed timer rows beats one that ships a list — but if
// `/dzlisttimers` logs, the roster discovers itself for free and anything built
// now is thrown away. This list is the interim, and it is small on purpose.
const RAIDS = Object.freeze([
  // TWO LISTS, AND THEY ARE NOT THE SAME LIST.
  //
  //   `bosses`   COMPLETION KEYS. Killing any one of these marks the cell done.
  //   `alsoDies` measured to die exactly once on (nearly) every group visit,
  //              and NOT used to complete anything.
  //
  // The split is the whole of my answer to "the roster ships as single-boss".
  // It is wrong that these zones hold one boss — the window says four and the
  // corpus agrees. But **promoting them to completion keys can only fail in the
  // dangerous direction.** Lord Nagafen already dies on every visit where
  // Tranix does, so adding Tranix buys nothing; the one case it changes is a
  // group that kills Tranix and then WIPES on Nagafen, where the tool would
  // report the raid done and the player would miss it. That is precisely the
  // failure this tool exists to prevent.
  //
  // So they are recorded, named in the tooltip, and inert — until the
  // shared-lock question is settled by an alt+Z reading for these zones.
  // **Director: promoting `alsoDies` to `bosses` is a one-line change and it
  // is yours, not mine.**
  {
    key: "Nagafen's Lair",
    label: 'Lord Nagafen',
    bosses: Object.freeze(['Lord Nagafen']),
    alsoDies: Object.freeze(['King Tranix', 'Magus Rokyl', 'Warlord Skarlon']),
    singleBoss: false,                // the window lists four; measured 14/15, 14/15, 12/15
    weeklyTaskObserved: true,
  },
  {
    key: 'The Permafrost Caverns',
    label: 'Lady Vox',
    // A priest of Nagafen carries Lady Vox's exact signature — 12/12 visits,
    // exactly once — and NOBODY had named it, in the window or in any order.
    // Its leading article is what hid it, the same way `a dracoliche` hid.
    alsoDies: Object.freeze(['Giant wooly spider', 'A priest of Nagafen', 'an ice giant diplomat']),
    bosses: Object.freeze(['Lady Vox']),
    singleBoss: false,
    weeklyTaskObserved: true,
  },
  {
    key: 'The Ruins of Old Paineel',
    label: 'Master Yael',
    bosses: Object.freeze(['Master Yael']),
    // Master Yael is the only mob at 25/25. The three below are common but not
    // universal, so they do not carry the boss signature — this is the one zone
    // of the three that really is single-boss.
    alsoDies: Object.freeze([]),
    singleBoss: true,
    weeklyTaskObserved: true,
  },
  {
    key: 'The Plane of Fear',
    label: 'Plane of Fear',           // what you RUN
    // What it CONTAINS. Kill-line spellings, not the alt+Z window's — the
    // window writes "Dracoliche", the game writes "a dracoliche", and a name
    // that does not match renders as a raid still owed.
    bosses: Object.freeze(['Terror', 'Dread', 'Fright', 'a dracoliche', 'Cazic-Thule']),
    alsoDies: Object.freeze([]),
    singleBoss: false,
    weeklyTaskObserved: false,
  },
  {
    key: 'The Plane of Hate',
    label: 'Plane of Hate',
    bosses: Object.freeze(['Innoruuk, the Prince of Hate', 'Maestro of Rancor']),
    alsoDies: Object.freeze([]),
    singleBoss: false,
    weeklyTaskObserved: false,
  },
].map(Object.freeze));

// THE CLIENT CAPITALISES THE FIRST CHARACTER OF A LINE, so a mob whose name
// begins with a lowercase article appears in TWO spellings:
//
//     A dracoliche has been slain by Orlando!     <- 8 kills, sentence-initial
//     You have slain a dracoliche!                <- 3 kills, mid-sentence
//
// Exact equality on `a dracoliche` therefore catches 3 of 11 — and a missed kill
// renders as a raid still owed, which is the precise failure the roster assert
// exists to prevent, arriving through capitalisation instead of through a typo.
// Same defect on `the Hand of Veeshan`: 5 of its kills read `The`.
//
// So the match folds case. That is safe HERE and would not be safe for a
// substring match: `A priest of Nagafen` and `a priest of Nagafen` are the same
// mob, but neither equals `Lord Nagafen`, so exact-equality-ignoring-case cannot
// collide the way `includes()` would. A test asserts no two roster bosses
// collide under the fold.
function normaliseBossName(name) {
  return String(name).toLowerCase();
}

// Every boss name that belongs to a raid, to the raid that holds it, keyed on
// the folded form so both spellings resolve.
const RAID_OF_BOSS = Object.freeze(
  RAIDS.reduce((m, r) => {
    for (const b of r.bosses) m[normaliseBossName(b)] = r.key;
    return m;
  }, {})
);

// ---------------------------------------------------------------------------
// The reset rule — the ONE place a reset constant is permitted to live
// ---------------------------------------------------------------------------
//
// Everywhere else in this module, a hardcoded reset day is forbidden and a test
// fails if one appears. This field is the single exception, and it carries its
// provenance on its face so it can never be mistaken for something we measured.
//
// `hour` is **null on purpose**. The owner gave a day, not a time. Inventing an
// hour to make the arithmetic tidy is exactly the fault this module refuses, so
// the period boundary is a DAY and everything landing inside that day is
// reported as ambiguous rather than resolved. See `projectGrid`.
// ===========================================================================
// THREE DIFFERENT OBJECTS. DO NOT MERGE THEM.
// ===========================================================================
//
// The owner's alt+Z "Instance Information" window, screenshotted 25 Aug 2026
// after four raid runs, shows the state we had concluded the client never
// exposes. It lists 36 "Outstanding Instance Timers" in three columns —
// Lockout Time, Instance Name, Event Name — and it separates three things this
// module had every reason to confuse:
//
//   1. THE WEEKLY TASK — `Potential of the Void - <Boss> - Weekly`, the
//      Void-Touched Potential token, capped at the first three raids of the
//      week, resetting on a WEEKDAY BOUNDARY (Tuesday). See RESET_RULE.
//
//   2. THE INSTANCE LOCKOUT — 28 rows whose Event Name is a boss name, each
//      reading 5d:23h:58m:5s. A SIX-DAY ROLLING TIMER from when it is taken.
//      There is no weekday and no boundary. See LOCKOUT_MODEL.
//
//   3. THE REPLAY TIMER — 8 rows whose Event Name is literally "Replay Timer",
//      reading 0d:0h:58m. About an hour, and it governs RE-ENTRY, not loot.
//      See REPLAY_MODEL. This is almost certainly the origin of the "rolling
//      18 hours" fan claim this project could never place, and it must never
//      leak into a lockout cell.
//
// **THE SEPARATION IS THE FINDING.** Under pressure to reconcile them, this
// module recorded that "the loot lockout may still be a different object from
// the weekly task and I am not merging them". The window shows both, side by
// side, with different periods and different anchors.
//
// AND OUR OWN NEGATIVE EVIDENCE BRACKETS IT FROM THE OTHER SIDE. We measured
// that any cycle up to 5.78 days was refuted — a weekly still refused on the
// 5.78th day. Six days clears that by about five hours. A measurement made
// without seeing this window and a window read without seeing that measurement
// agree, which is the strongest corroboration this project has produced.

const RESET_RULE = Object.freeze({
  weekday: 2,                    // 0 = Sunday, so 2 = Tuesday
  weekdayName: 'Tuesday',
  hour: null,                    // not recorded
  provenance: 'stated',          // NOT 'measured'. We did not observe this.
  source: 'owner, first-hand, 23 Aug 2026',
  // Our own measurement, kept beside it so the two can be compared at a glance.
  // The bracket contains a Tuesday, so the rule is consistent with what we saw;
  // consistency is not confirmation and the wording stays careful.
  measuredBracketPacific: 'Mon 10 Aug 15:34 → Tue 11 Aug 17:37 2026',
  measuredBracketContainsRule: true,
  note:
    'A day, not an instant. The hour of the turnover has never been measured, ' +
    'so a kill on the boundary day itself cannot be assigned to a period.',
});

// OBJECT 2 — the instance loot lockout. A ROLLING TIMER, not a weekday.
//
// WHAT THE WINDOW ACTUALLY DETERMINES, and it is less than I first claimed.
//
// Two readings, one moment:
//     replay remaining  0d0h58m05s  =      3,485 s
//     boss   remaining  5d23h58m05s =    518,285 s
//
// Call the periods R and B and the elapsed time E. Then R − E = 3485 and
// B − E = 518285. **Two equations, three unknowns.** Subtracting them cancels E
// entirely:
//
//     B − R = 514,800 s = EXACTLY 5 days 23 hours
//
// **That difference is the measurement.** It is exact, it is a clean whole
// number, and it holds for every possible elapsed time — nothing was assumed to
// get it.
//
// **The absolute periods are NOT determined, and an earlier revision of this
// comment said they were.** It claimed the two timers "solve each other" and
// that six days "falls out". They do not and it does not: six days is the
// answer *if* the replay period is one hour, and every other plausible replay
// period is equally self-consistent to the second —
//
//     R = 1h   → E = 115 s     → B = 6d 0h 0m
//     R = 90m  → E = 1,915 s   → B = 6d 0h 30m
//     R = 2h   → E = 3,715 s   → B = 6d 1h 0m
//     R = 3h   → E = 7,315 s   → B = 6d 2h 0m
//
// The claim that no other pairing gives a whole number was simply false. An
// adversarial pass caught it, and the fault is the one this project keeps
// finding in other people's work: an assumption presented as a derivation.
//
// So `days` is recorded as CONDITIONAL. `differenceSeconds` is the fact.
const LOCKOUT_MODEL = Object.freeze({
  kind: 'rolling',

  // THE MEASUREMENT — assumption-free.
  differenceFromReplaySeconds: 514800,   // exactly 5d 23h
  differenceProvenance: 'observed',

  // THE PERIOD — conditional, and labelled so it can never be read as measured.
  days: 6,
  daysProvenance: 'conditional',
  condition: 'the Replay Timer period is exactly one hour',
  alternatives: Object.freeze([
    { replayPeriod: '1h', lockoutDays: 6 },
    { replayPeriod: '90m', lockoutDays: 6.0208 },
    { replayPeriod: '2h', lockoutDays: 6.0417 },
    { replayPeriod: '3h', lockoutDays: 6.0833 },
  ]),

  provenance: 'observed',
  source: "the owner's alt+Z Instance Information window, 25 Aug 2026",

  // WHAT WOULD SETTLE IT, cheaply: open alt+Z immediately after entering ONE
  // instance. The Replay Timer will then read close to its full period, which
  // fixes R, which fixes B through the exact difference above.
  settledBy: 'open alt+Z within a minute of entering a fresh instance and read the Replay Timer',

  // ONE COMMON ORIGIN, and this half survives everything thrown at it.
  //
  // 14 distinct locks were earned across kills spanning 20:54:59 to 22:37:12 —
  // 6,133 seconds. A timer stamped at each kill would render 14 DIFFERENT values
  // at any single instant, spread across 1h42m. The window shows one value with
  // zero spread. Per-kill is dead.
  //
  // The rounding explanation is dead too, and killed by the detail that first
  // looked like a problem: the replay rows read 58m04s AND 58m05s. A display
  // that resolves one second cannot also merge a 6,133-second spread.
  commonOrigin: true,
  commonOriginTolerance: 'about 1 second',
  anchorEvent: null,   // NOT RECORDED — see below

  // THE ANCHOR IS NOT RECORDED, and an earlier revision overstated this too.
  // The moment the screenshot was taken is unknown — there is no file, no
  // timestamp, no independent clock — so the "common instant" was derived from
  // an assumed elapsed time and then matched to a salient log line. That is one
  // free parameter fitted to itself. Several other lines fit as well, and under
  // R = 2h the same reasoning lands on a different real log line entirely.
  anchorNote:
    'A lock cannot precede the kill that earns it, so the common origin is at ' +
    'or after 22:37:12. Beyond that the log does not say, and no line anywhere ' +
    'in the corpus announces a timer being granted.',

  corroboration:
    'Our own measurement refuted any cycle up to 5.78 days, from a weekly still ' +
    'refused 5.78 days after it was granted. Every candidate above clears that.',

  caveats: Object.freeze([
    'The unit that carries this lockout appears to be the INSTANCE, not the boss: ' +
    'one Plane of Fear run produced rows for all five of its bosses.',
    'Rows appear for both the Solo and the Group shape of a tier from Group-only ' +
    'runs. Two rows is not two locks; a shared lock displayed twice fits equally. ' +
    'The window is 18 distinct locks shown twice, NOT 36 independent stamps.',
    'The lockout does not start at the kill. Where it does start is not recorded, ' +
    'and a tracker inferring from kills is therefore measuring a different event ' +
    'from the one that matters — which no volume of kill data would reveal.',
  ]),
});

// OBJECT 3 — the replay timer. Instance RE-ENTRY, not loot.
//
// Eight rows reading 0d:0h:58m, Event Name literally "Replay Timer". It governs
// how soon the same instance may be entered again and has nothing to do with
// whether its loot is still owed. Modelled here so it can be EXCLUDED
// explicitly rather than leaking into a lockout cell.
const REPLAY_MODEL = Object.freeze({
  kind: 'rolling',
  minutes: 60,
  provenance: 'observed',
  source: "the owner's alt+Z Instance Information window, 25 Aug 2026",
  governs: 're-entry to the same instance',
  doesNotGovern: 'whether the loot in that instance is still available',
  note:
    'Almost certainly the origin of the "rolling 18 hours" community claim this ' +
    'project could never place. It is an hour, not eighteen, and it is not a lockout.',
});

// The zone-to-boss structure, as OBSERVED in the alt+Z window and the live log.
//
// This is the shape our 25-cell grid does not model: Vox, Nagafen and Yael are
// single-boss instances, but Fear and Hate are not — one run of Fear produces
// lockout rows for five bosses at once. So the lockable unit looks like the
// INSTANCE, with bosses as its contents.
//
// **NOT HARDCODED AS A ROSTER.** These names are recorded as evidence of the
// structure, not shipped as the list of what exists. The window proves the
// roster is DISCOVERABLE — a tracker that learns its bosses from observed timer
// rows beats one that ships a list and goes stale on the next patch.
const OBSERVED_ZONES = Object.freeze({
  'The Plane of Fear': Object.freeze(['Terror', 'Dread', 'Fright', 'Dracoliche', 'Cazic-Thule']),
  'The Plane of Hate': Object.freeze(['Innoruuk', 'Maestro of Rancor']),
});

// THE NAME MAPPING, and it is the roster trap arriving through a second door.
//
// The alt+Z window and the kill lines do not use the same strings. An unmapped
// name renders as a MISSING lockout, which looks exactly like a raid you still
// owe — the same failure the roster assert exists to prevent, reached from the
// other side.
//
// Only the names that DIFFER are listed. Everything else matches exactly, and a
// test asserts that, so an entry silently becoming unnecessary is caught too.
const WINDOW_TO_KILL_NAME = Object.freeze({
  'Innoruuk': 'Innoruuk, the Prince of Hate',
  'Dracoliche': 'a dracoliche',
});

function parseLine(line) {
  const split = splitStamp(line);
  if (!split) return null;
  const { at, message } = split;

  let m;

  if ((m = TASK_ASSIGNED_RE.exec(message))) {
    return { kind: 'task-assigned', at, ...describeTask(m[1]) };
  }
  if ((m = TASK_UPDATED_RE.exec(message))) {
    return { kind: 'task-updated', at, ...describeTask(m[1]) };
  }
  if ((m = GIVEN_RE.exec(message))) {
    return { kind: 'given', at, item: m[1] };
  }
  if ((m = ENTERED_RE.exec(message))) {
    const name = m[1];
    // A non-zone notice must NOT be reported as a zone-in; see NOT_A_ZONE.
    if (NOT_A_ZONE.has(name)) return { kind: 'not-a-zone', at, text: name };
    if (LOOKS_LIKE_A_SENTENCE.test(name)) return { kind: 'not-a-zone', at, text: name, unrecognised: true };
    return { kind: 'entered', at, ...parseInstanceName(name) };
  }
  if ((m = INSTANCE_INVITE_RE.exec(message))) {
    return { kind: 'instance-invite', at, from: m[1], ...parseInstanceName(m[2]) };
  }
  if (SELF_DANGER_RE.test(message)) {
    return { kind: 'weekly-request', at };
  }
  if (VOIDLING_RE.test(message)) {
    return { kind: 'voidling-reply', at, closing: VOIDLING_CLOSING_RE.test(message) };
  }
  // parseLine stays OPEN TO ANY NAME. Whether a slain thing is a raid boss is a
  // roster question, decided later; nothing here filters by roster.
  if ((m = SLAIN_BY_RE.exec(message))) {
    return { kind: 'kill', at, slain: m[1], killer: m[2], byYou: false };
  }
  if ((m = YOU_SLEW_RE.exec(message))) {
    return { kind: 'kill', at, slain: m[1], killer: null, byYou: true };
  }
  return null;
}

function describeTask(taskName) {
  const m = TASK_NAME_RE.exec(taskName);
  if (!m) return { task: taskName, series: null, boss: null, cadence: null };
  return { task: taskName, series: m[1], boss: m[2], cadence: m[3] };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STATE_VERSION = 1;

// A log file belongs to ONE character (`eqlog_<Character>_<server>.txt`), and
// a task is granted to a character, not to an account. Two grouped characters
// each get their own grant, seconds apart — measured, in our own corpus:
//
//   [Mon Aug 10 17:14:49 2026] ... 'Potential of the Void - Lord Nagafen - Weekly'.   (Avenrae)
//   [Mon Aug 10 17:14:53 2026] ... 'Potential of the Void - Lord Nagafen - Weekly'.   (Shara)
//
// Merged into one state those read as a task assigned twice four seconds
// apart, which this module would then report as a four-second reset bracket.
// That is an instrument manufacturing a finding, and it is the failure mode
// this project has caught in its own tooling more than once.
//
// So state is PER CHARACTER, and the character is required at construction.
// A host that tails "whichever eqlog_*.txt changed last" — which follows the
// player across character switches — must keep one state per character and
// route by filename. `characterFromLogFilename` does that parse.
function createState(character, opts) {
  if (typeof character !== 'string' || !character) {
    throw new TypeError(
      'createState(character): a character name is required. State cannot be ' +
      'shared across characters — two grouped characters each receive their ' +
      'own task grant, and merging them fabricates reset brackets.'
    );
  }
  const raids = (opts && opts.raids) || RAIDS;
  return {
    version: STATE_VERSION,
    character,
    // The RAIDS whose boss kills are recorded. `parseLine` stays open to every
    // name; this is the only place the list narrows anything, and it is
    // overridable so the host is not stuck with ours.
    raids: raids.map((r) => ({
      key: r.key,
      label: r.label,
      bosses: r.bosses.slice(),
      // Measured to die once on (nearly) every group visit, and NOT completion
      // keys — see the two-lists note above RAIDS. Copied into the state so a
      // restored snapshot renders the same tooltip as a live one.
      alsoDies: (r.alsoDies || []).slice(),
      singleBoss: r.singleBoss === true,
      // Observed in OUR corpus; not a property of the raid. See the note above.
      weeklyTaskObserved: r.weeklyTaskObserved === true,
    })),
    // Kills of roster bosses, each carrying the instance it happened in.
    kills: [],
    // The instance most recently entered, so a kill can be attributed to a
    // difficulty. Null means the open world or nothing seen yet.
    currentInstance: null,
    // One entry per task name, in first-seen order.
    tasks: {},
    // Every `You have been given:` line, so a caller can reconcile against the
    // 3-per-week cap in the 28 Jul 2026 patch note without re-parsing.
    grants: [],
    // Instances entered, deduped by name. Feeds the data-model question of
    // whether a lockout attaches to an instance; we do not yet claim it does.
    instances: {},
    // Every `You say, 'danger'` — a request for the weekly. Classified in the
    // projection, not here.
    requests: [],
    // Civil times of Voidling lines, the positive control for a refusal.
    voidlingReplies: [],
    // Ordered log of what was observed, for provenance. Bounded — see `applyLine`.
    events: [],
    // The dedupe index, SEPARATE from `events` and far larger.
    //
    // These were one array once, and that was a real bug rather than a tidiness
    // problem: `events` is bounded at MAX_EVENTS for memory, and when the bound
    // was reached the oldest keys fell out of the dedupe index with them. Replay
    // a corpus longer than the bound — which the owner's own 12 Shara files
    // are — and the early observations are accepted a second time. Measured
    // before the fix: every 10 Aug task assignment recorded TWICE and the
    // Void-Touched Potential count read 9 instead of 6.
    //
    // A plain object, not a Set, because state must survive JSON round-tripping.
    seen: {},
    seenCount: 0,
    firstSeen: null,
    lastSeen: null,
    // Contiguous runs of observed log time. A gap longer than SPAN_GAP_MS
    // starts a new span. This is how a HOLE IN THE MIDDLE of the record is
    // made visible: checking only firstSeen and lastSeen would report full
    // coverage for a log that is missing the two days containing the reset.
    spans: [],
    dropped: { unstamped: 0, duplicate: 0, beyondDedupeHorizon: 0 },
  };
}

const MAX_EVENTS = 5000;
// The dedupe index is deliberately far larger than the provenance log. The
// owner's own corpus produces ~12k observations for one character, so a bound
// of 5000 was actively corrupting counts.
const MAX_SEEN = 200000;

// Drops the oldest half of the dedupe index when it overflows, so the horizon
// recedes rather than the index being cleared outright.
function pruneSeen(state) {
  const entries = Object.entries(state.seen).sort((a, b) => a[1] - b[1]);
  const keep = entries.slice(Math.floor(entries.length / 2));
  const next = {};
  for (const [k, v] of keep) next[k] = v;
  state.seen = next;
  state.seenCount = keep.length;
}

function oldestSeen(state) {
  let min = Infinity;
  for (const k in state.seen) if (state.seen[k] < min) min = state.seen[k];
  return min;
}

// Applies one raw line. Mutates and returns `state` — cheap, and the caller
// owns the object. Returns the same state unchanged for lines we do not model.
//
// DUPLICATE SUPPRESSION IS LOAD-BEARING, NOT HOUSEKEEPING. Two characters in
// one group both log the same events, and a tailer that follows "whichever
// eqlog_*.txt was modified most recently" will hop between those files and
// replay the same moment twice. Counting one kill as two would corrupt every
// interval this module reports.
const SPAN_GAP_MS = 30 * 60 * 1000;

function applyLine(state, line) {
  // EVERY stamped line extends coverage, not just the ones we model. Coverage
  // is about what we were in a position to see, and we saw every line.
  const stamped = typeof line === 'string' && line.length ? splitStamp(line) : null;
  if (stamped) noteCoverage(state, civilOf(stamped.at));

  const ev = parseLine(line);
  if (!ev) {
    if (typeof line === 'string' && line.length && !stamped) state.dropped.unstamped++;
    return state;
  }

  const civil = civilOf(ev.at);
  // A Voidling reply is a PRESENCE CONTROL, not an event. It never enters
  // `events` and never emits a change, because several players share one NPC
  // and the count is meaningless. It is recorded below as a set of seconds.
  if (ev.kind === 'voidling-reply') {
    if (!state.voidlingReplies.includes(civil)) {
      state.voidlingReplies.push(civil);
      if (state.voidlingReplies.length > MAX_EVENTS) state.voidlingReplies.shift();
    }
    return state;
  }

  const key = dedupeKey(ev, civil);
  // Older states persisted before `seen` existed still carry only `events`.
  if (!state.seen) { state.seen = {}; state.seenCount = 0; }
  if (Object.prototype.hasOwnProperty.call(state.seen, key)) {
    state.dropped.duplicate++;
    return state;
  }
  state.seen[key] = civil;
  state.seenCount++;
  if (state.seenCount > MAX_SEEN) pruneSeen(state);

  // THE DEDUPE HORIZON. Now genuinely remote rather than four months away: the
  // index holds MAX_SEEN observations, not MAX_EVENTS, and the counter below
  // still fires if it is ever exceeded.
  //
  // `events` is bounded at MAX_EVENTS, so duplicate suppression can only see
  // that far back. Replay a stream longer than the bound and the oldest keys
  // have already been trimmed: the repeats are accepted as new, and
  // `dropped.duplicate` still reads 0. Silent double-counting with a clean
  // diagnostic is the worst failure this module can have, and an audit found it
  // reachable in roughly four months at the measured event rate.
  //
  // So: an observation older than the oldest key we still hold is counted.
  // It is still RECORDED — discarding real data would be worse — but
  // `dropped.beyondDedupeHorizon > 0` tells a host "you fed me something from
  // before my memory; I can no longer promise idempotence, rebuild from the
  // log." Visible beats silent.
  if (state.seenCount >= MAX_SEEN && civil < oldestSeen(state)) {
    state.dropped.beyondDedupeHorizon++;
  }

  if (state.firstSeen === null || civil < state.firstSeen) state.firstSeen = civil;
  if (state.lastSeen === null || civil > state.lastSeen) state.lastSeen = civil;

  state.events.push({ key, kind: ev.kind, civil, at: ev.at });
  if (state.events.length > MAX_EVENTS) state.events.shift();

  if (ev.kind === 'task-assigned' || ev.kind === 'task-updated') {
    const t = (state.tasks[ev.task] ||= {
      task: ev.task,
      series: ev.series,
      boss: ev.boss,
      cadence: ev.cadence,
      assignments: [],
      completions: [],
    });
    const bucket = ev.kind === 'task-assigned' ? t.assignments : t.completions;
    bucket.push({ civil, at: ev.at, weekday: civilWeekday(ev.at) });
    bucket.sort((a, b) => a.civil - b.civil);
  }

  if (ev.kind === 'given') {
    state.grants.push({ item: ev.item, civil, at: ev.at });
  }

  // Requests and Voidling replies are stored RAW and classified later, in the
  // projection. Classifying here would mean deciding "granted or refused" at
  // the moment the request arrives, before the answer has been read — and the
  // first version of the analysis script did exactly that and produced a false
  // measurement, because the Voidling's closing line can arrive BEFORE the task
  // line. A streaming classifier cannot see the whole window; a projection can.
  if (ev.kind === 'weekly-request') {
    state.requests.push({ civil, at: ev.at });
    if (state.requests.length > MAX_EVENTS) state.requests.shift();
  }

  if (ev.kind === 'entered' || ev.kind === 'instance-invite') {
    if (ev.instanced) {
      const k = `${ev.zone}|${ev.group ? 'group' : 'raid'}|${ev.difficulty}`;
      const rec = (state.instances[k] ||= {
        zone: ev.zone,
        group: ev.group,
        difficulty: ev.difficulty,
        difficultyLabel: ev.difficultyLabel,
        // Whether the GAME stated a difficulty for this record — by writing the
        // index, or by omitting it, which for `- Group` means zero and is
        // measured 12/12. `difficultyFromOmission` says which of the two.
        //
        // What still cannot be counted: an instance entered as `- Group` and one
        // entered as `- Group 0 (Normal)` would key the same, but the second
        // shape has never occurred, so that collision is theoretical. The real
        // caveat stands — `instances` is an upper bound on distinct instances,
        // because re-entering the same instance after a zone-out is
        // indistinguishable from entering a new one at the same tier.
        difficultyStated: ev.difficulty !== null,
        difficultyFromOmission: ev.difficultyFromOmission === true,
        seen: 0,
      });
      rec.seen++;
    }

    // Only a ZONE-IN moves the player. An invite is someone else's offer and
    // may be declined, so it must never set the current instance — doing so
    // would attribute a later kill to an instance never entered.
    if (ev.kind === 'entered') {
      state.currentInstance = ev.instanced
        ? {
            zone: ev.zone,
            group: ev.group,
            difficulty: ev.difficulty,
            difficultyLabel: ev.difficultyLabel,
            difficultyStated: ev.difficulty !== null,
            difficultyFromOmission: ev.difficultyFromOmission === true,
            enteredCivil: civil,
          }
        : null; // a bare zone name is the OPEN WORLD, which is not a grid cell
    }
  }

  if (ev.kind === 'kill') {
    // The raid list narrows here and nowhere else. EXACT equality, never
    // substring: `Cleric of Innoruuk` and `Innoruuk\`s Chosen` are different
    // mobs that a substring match would score as the boss, and `Terror pet` is
    // not Terror.
    const slainKey = normaliseBossName(ev.slain);
    const entry = state.raids.find(
      (r) => r.bosses.some((b) => normaliseBossName(b) === slainKey)
    );
    if (entry) {
      const inst = state.currentInstance;
      state.kills.push({
        // WHICH RAID this kill belongs to, and which boss it actually was. The
        // cell is keyed by the raid; the boss is kept so a completion can say
        // what was killed rather than just that something was.
        raid: entry.key,
        // The spelling the game actually wrote on this line, not the canonical
        // one — so a completion can be traced back to its exact log line.
        boss: ev.slain,
        civil,
        at: ev.at,
        byYou: ev.byYou === true,
        // Attribution is "the instance most recently entered". Where no
        // instance has been entered, or the last zone-in was the open world,
        // this is null and the kill resolves no grid cell.
        zone: inst ? inst.zone : null,
        group: inst ? inst.group : null,
        difficulty: inst ? inst.difficulty : null,
        difficultyStated: inst ? inst.difficultyStated : false,
        // TRUE when the tier came from the omission rule rather than a written
        // index. A cell completed on such a kill says so, so the one inference
        // in the chain is visible at the point it is used.
        difficultyFromOmission: inst ? inst.difficultyFromOmission === true : false,
        instanced: Boolean(inst),
        secondsSinceZoneIn: inst ? (civil - inst.enteredCivil) / 1000 : null,
      });
      if (state.kills.length > MAX_EVENTS) state.kills.shift();
    }
  }

  return state;
}

// Extends the observation spans. Lines usually arrive in order; a line that
// arrives out of order (two log files fed back to front) is merged rather than
// starting a spurious span.
// One span per play session (>30 min apart). Unbounded, this grows without limit on a huge
// unarchived log and every line then rescans the whole array. Cap it: when full, the two OLDEST
// spans are fused into one. That widens the oldest span across a gap - harmless, because only the
// CURRENT period's spans decide a cell, and the earliest `from` (all `spansPriorWeek` needs) is
// preserved.
const MAX_SPANS = 2000;

function noteCoverage(state, civil) {
  const spans = state.spans;
  // Iterate newest-first: lines usually arrive in order, so the match is at the end.
  for (let i = spans.length - 1; i >= 0; i--) {
    const sp = spans[i];
    if (civil >= sp.from - SPAN_GAP_MS && civil <= sp.to + SPAN_GAP_MS) {
      if (civil < sp.from) sp.from = civil;
      if (civil > sp.to) sp.to = civil;
      return;
    }
  }
  spans.push({ from: civil, to: civil });
  spans.sort((a, b) => a.from - b.from);
  // Merge any spans the new one bridged.
  for (let i = spans.length - 1; i > 0; i--) {
    if (spans[i].from - spans[i - 1].to <= SPAN_GAP_MS) {
      spans[i - 1].to = Math.max(spans[i - 1].to, spans[i].to);
      spans.splice(i, 1);
    }
  }
  while (spans.length > MAX_SPANS) {
    spans[0].to = spans[1].to;
    spans.splice(1, 1);
  }
}

function dedupeKey(ev, civil) {
  switch (ev.kind) {
    case 'task-assigned':
    case 'task-updated':
      return `${civil}|${ev.kind}|${ev.task}`;
    case 'given':
      return `${civil}|given|${ev.item}`;
    case 'kill':
      // Keyed on the SLAIN NAME, not just the second. Without this the default
      // key is `<second>|kill`, and two different bosses dying in the same
      // second collapse into one — a silent lost completion, which for a tool
      // whose job is "do not forget a raid" is the wrong direction to fail in.
      // `byYou` is deliberately NOT in the key: one real kill writes the
      // third-person line in one character's log and the first-person line in
      // another's, and within a single character's stream only one form appears.
      return `${civil}|kill|${ev.slain}`;
    case 'weekly-request':
      return `${civil}|request`;
    case 'voidling-reply':
      return `${civil}|voidling`;
    case 'entered':
      return `${civil}|entered|${ev.zone}|${ev.difficulty}`;
    case 'instance-invite':
      return `${civil}|invite|${ev.from}|${ev.zone}|${ev.difficulty}`;
    default:
      return `${civil}|${ev.kind}`;
  }
}

function applyLines(state, lines) {
  for (const line of lines) applyLine(state, line);
  return state;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------
//
// Every value that leaves this module carries `provenance`, one of:
//   'observed'     — read directly off a log line, with that line cited
//   'inferred'     — computed from observed lines, with the reasoning named
//   'not recorded' — we have not seen it. There is no default and no guess.

const NOT_RECORDED = Object.freeze({ provenance: 'not recorded', value: null });

// Reports the reset boundary as a bracket, never a point.
//
// A weekly task re-assigned after an earlier assignment implies the weekly
// period rolled over between them. That gives an open interval: after the last
// event of the old period, before the first assignment of the new one. Both
// ends are observations. The reset instant is somewhere inside and this
// function will not pretend to know where.
//
// Two independent brackets a week apart would let a caller intersect them and
// narrow the estimate sharply. We report every bracket found so that
// intersection is the caller's to make, and `widthHours` is emitted beside every
// one of them, because a bracket wider than a day cannot distinguish a
// Tuesday-morning reset from a Monday-evening one and must not be drawn as
// though it could.
//
// No width is quoted in this comment on purpose. An earlier revision said "a
// 27-hour bracket" here while the measured values were 26.098 and 26.056 — a
// number typed beside the data it claims to describe, in the one file whose
// whole doctrine forbids exactly that. The exact widths are deliberately not
// restated here — they come from the corpus derivation, not from this file.
function projectReset(state) {
  const brackets = [];

  for (const t of Object.values(state.tasks)) {
    // ONLY a task the game itself labels with a cadence may bracket a reset.
    //
    // This is not tidying. Our corpus holds ordinary tasks — 'Something is
    // Wrrrong', 'This Means Warrr' — assigned and completed nine times inside
    // two minutes on 13 Aug 2026. Those are freely repeatable and carry no
    // cadence word. Admitting them here produces "reset brackets" a few
    // seconds wide, which would then dominate `narrowest` and read as a
    // precise measurement of nothing.
    //
    // The entire claim rests on the game printing the word "Weekly" itself. A
    // task that does not carry a cadence says nothing about a period, and the
    // module says nothing about it in return.
    if (!t.cadence) continue;
    if (t.assignments.length < 2) continue;
    for (let i = 1; i < t.assignments.length; i++) {
      const prev = t.assignments[i - 1];
      const next = t.assignments[i];
      // The lower bound is the latest evidence of the OLD period still being
      // in force — the last completion at or after the previous assignment, if
      // there is one, otherwise the assignment itself.
      const lastOld = t.completions
        .filter((c) => c.civil >= prev.civil && c.civil < next.civil)
        .reduce((acc, c) => (acc === null || c.civil > acc.civil ? c : acc), null);
      // A REFUSED request is later evidence that the old period was still in
      // force than the completion is, so it can tighten the lower bound. But
      // only under a condition that is easy to miss and that cost a false
      // measurement here before it was added:
      //
      // A REFUSAL DOES NOT NAME A BOSS. The game prints nothing at all, so all
      // we know is that *some* Voidling declined. Once ANY task of the new
      // period has been granted, the new period is demonstrably running, and a
      // later refusal only means that particular boss was already taken again
      // — it says nothing about the old period. Admitting those produced a
      // nine-second "reset bracket" between a refusal at 21:44:10 and a grant
      // at 21:44:19, which was the same attempt pressed twice.
      //
      // So a refusal may tighten the lower bound only if it precedes the FIRST
      // grant of the new period, across every task.
      // "The new period has started" means some task has been granted a SECOND
      // time — a first-time grant of a different boss is still the old period,
      // and treating it as new made this rule refuse to tighten at all.
      // This is the weakest safe form: it assumes nothing about whether tasks
      // reset together, only that a re-grant is the earliest proof of a new
      // period we actually hold.
      const rows = classifyRequests(state);
      let firstNewGrant = null;
      for (const other of Object.values(state.tasks)) {
        if (!other.cadence) continue;
        for (let k = 1; k < other.assignments.length; k++) {
          const c = other.assignments[k].civil;
          if (c > prev.civil && (firstNewGrant === null || c < firstNewGrant)) firstNewGrant = c;
        }
      }
      const refusals = rows.filter(
        (r) =>
          r.result === 'refused' &&
          r.civil >= prev.civil &&
          r.civil < next.civil &&
          (firstNewGrant === null || r.civil < firstNewGrant)
      );
      const lastRefusal = refusals.length ? refusals[refusals.length - 1] : null;
      let after = lastOld || prev;
      if (lastRefusal && lastRefusal.civil > after.civil) {
        after = { civil: lastRefusal.civil, at: fromCivil(lastRefusal.civil), weekday: undefined, fromRefusal: true };
      }
      brackets.push({
        task: t.task,
        boss: t.boss,
        cadence: t.cadence,
        afterCivil: after.civil,
        after: formatCivil(after.at),
        afterWeekday: after.weekday !== undefined ? after.weekday : civilWeekday(after.at),
        // true when the lower bound came from a REFUSED request rather than a
        // completion — a stronger and later piece of evidence.
        fromRefusal: after.fromRefusal === true,
        beforeCivil: next.civil,
        before: formatCivil(next.at),
        beforeWeekday: next.weekday,
        widthHours: (next.civil - after.civil) / 3600000,
        crossesPossibleDstShift: null, // caller's zone is unknown to this module
      });
    }
  }

  if (!brackets.length) {
    return {
      ...NOT_RECORDED,
      reason:
        'No task has been observed assigned twice. A reset boundary is only ' +
        'measurable across a re-assignment; nothing in the lines seen so far ' +
        'brackets one.',
      brackets: [],
      caveats: [CAVEAT_DST],
    };
  }

  // The intersection of every bracket, if one exists. This is the whole value
  // of collecting more than one: two brackets a week apart, reduced modulo a
  // week, can be far narrower than either alone. We compute the plain
  // intersection only — the modular reduction needs a period we have not
  // measured, and assuming seven days here would be exactly the typed constant
  // this module refuses to ship.
  const lo = Math.max(...brackets.map((b) => b.afterCivil));
  const hi = Math.min(...brackets.map((b) => b.beforeCivil));

  return {
    provenance: 'inferred',
    value: null, // there is no single instant, and there will not be one
    brackets,
    narrowest: brackets.reduce((a, b) => (b.widthHours < a.widthHours ? b : a)),
    intersects: lo < hi,
    intersectionHours: lo < hi ? (hi - lo) / 3600000 : null,
    basis:
      'A task the game itself labels with a cadence was assigned, and then ' +
      'assigned again. The period between the last evidence of the old ' +
      'assignment and the first evidence of the new one contains the turnover.',
    caveats: [
      CAVEAT_DST,
      'A bracket bounds the turnover; it does not identify a weekday or an ' +
      'hour unless it is narrower than the ambiguity being resolved.',
    ],
  };
}


// ---------------------------------------------------------------------------
// Classifying a weekly request
// ---------------------------------------------------------------------------

// A grant lands in the same second or the next one; 3s is generous.
const GRANT_WINDOW_MS = 3000;
// The Voidling must be demonstrably present and talking for a silence to mean
// anything. Without that, the request is UNKNOWN, never REFUSED.
const CONTROL_BEFORE_MS = 20000;
const CONTROL_AFTER_MS = 5000;
// Repeated `danger` while spamming the NPC is one attempt, not several.
const COLLAPSE_MS = 6000;

// Returns one row per request: GRANTED (with the boss), REFUSED, or UNKNOWN.
//
// REFUSED is the lockout observation. It is only ever emitted when a Voidling
// line sits inside the control window, so a chat filter that hid system text
// yields UNKNOWN rather than a false lockout.
function classifyRequests(state) {
  const assignments = [];
  for (const t of Object.values(state.tasks)) {
    if (!t.cadence) continue;
    for (const a of t.assignments) assignments.push({ civil: a.civil, boss: t.boss, task: t.task });
  }
  assignments.sort((a, b) => a.civil - b.civil);

  const collapsed = [];
  for (const r of state.requests.slice().sort((a, b) => a.civil - b.civil)) {
    const last = collapsed[collapsed.length - 1];
    if (last && r.civil - last.civil <= COLLAPSE_MS) { collapsed[collapsed.length - 1] = r; continue; }
    collapsed.push(r);
  }

  return collapsed.map((r) => {
    const grant = assignments.find((a) => a.civil >= r.civil && a.civil - r.civil <= GRANT_WINDOW_MS);
    const control = state.voidlingReplies.some(
      (v) => v >= r.civil - CONTROL_BEFORE_MS && v <= r.civil + CONTROL_AFTER_MS
    );
    return {
      at: formatCivil(r.at),
      civil: r.civil,
      result: grant ? 'granted' : control ? 'refused' : 'unknown',
      boss: grant ? grant.boss : null,
      positiveControl: control,
    };
  });
}

// A lower bound on the period, measured.
//
// If a boss's weekly was granted at T and a request was REFUSED at T + d with
// no intervening grant, the period is at least d. This is the strongest thing
// the logs say about the length of the cycle, and unlike a weekday it is a
// real measurement rather than a guess.
function projectPeriod(state) {
  const rows = classifyRequests(state);
  const grants = rows.filter((r) => r.result === 'granted');
  if (!grants.length) {
    return { ...NOT_RECORDED, reason: 'No weekly has been observed granted.' };
  }
  const lastGrant = grants[grants.length - 1];
  const laterRefusals = rows.filter((r) => r.result === 'refused' && r.civil > lastGrant.civil);
  if (!laterRefusals.length) {
    return {
      ...NOT_RECORDED,
      reason: 'No refused request has been observed after the most recent grant, ' +
              'so nothing bounds the period from below.',
    };
  }
  const furthest = laterRefusals[laterRefusals.length - 1];
  const days = (furthest.civil - lastGrant.civil) / 86400000;
  return {
    provenance: 'inferred',
    atLeastDays: Number(days.toFixed(3)),
    lastGrantAt: lastGrant.at,
    stillRefusedAt: furthest.at,
    basis:
      'The weekly granted at lastGrantAt was still refused at stillRefusedAt, ' +
      'with a Voidling present as positive control and no grant in between. ' +
      'The period is therefore at least this long. It is a floor, not a value.',
    caveats: [
      CAVEAT_DST,
      'This bounds the period from below only. It says nothing about the upper ' +
      'bound, and nothing about which weekday or hour the turnover falls on.',
    ],
  };
}

// ---------------------------------------------------------------------------
// The grid — 5 bosses × 5 tiers
// ---------------------------------------------------------------------------
//
// WHAT REMAINS, NOT WHAT IS DONE. The owner's reason for wanting this is worth
// keeping in front of whoever edits it:
//
//   "we humans experience our own form of compression drift, and only remember
//    that we've done some of those raids, not precisely which ones... The
//    tracker becomes the human safeguard against forgetting to complete raids
//    by the reset deadline."
//
// So the open cells lead and the completed ones recede. A grid that foregrounds
// completions is a scoreboard; this is a checklist of what is still owed.
//
// FIVE CELL STATES. The distinction between the last two is the whole point,
// and `conditional` is the one that stops the tool being useless:
//
//   completed    a kill observed at that difficulty since the last reset
//   available    no kill since the reset, AND coverage spans the whole period
//   conditional  a kill at that difficulty ON THE BOUNDARY DAY. Which side of
//                the turnover it fell is unknowable because the reset HOUR has
//                never been measured — but the instant that decides it IS
//                known, so the cell carries it: "completed if the reset fell at
//                or before 22:37:12, still open if it fell after".
//   unknown      evidence exists that cannot be assigned to this cell at all —
//                a kill at a difficulty the game did not state
//   not_looked   coverage does not span the period — fresh install, no backfill
//
// **`conditional` was `unknown` until 26 Aug 2026, and that cost us the tool.**
// The owner ran the shipped build after a week of raiding and got "0 of 25 done
// · 15 uncertain". Every one of those cells knew the exact instant that decided
// it and said nothing. A refusal to guess is right; a refusal to help is not,
// and they are not the same refusal.
//
// **`not_looked` must never render as `available`.** "I have not looked" and
// "you have not done it" are the same picture and different facts, and a fresh
// install showing 25 available cells would have told the user a comfortable lie.
//
// NO COUNTDOWN. `available` is a state, never a time. The owner asked for no
// countdown and the module could not honestly produce one anyway: the reset
// hour is not recorded.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function projectGrid(state, now, opts = {}) {
  requireCivil(now);
  const nowCivil = civilOf(now);

  // THE RESET RULE.
  //
  // Preferred: the host resolves the boundary itself - in US Eastern, with the daylight-saving
  // change already handled - and passes `boundaryCivil` (and `periodEndCivil`), civil components
  // in the SAME frame the kill stamps are in. The reset weekday/hour still come through for
  // display and are Eastern.
  //
  // Fallback (tests, or a host that does not resolve it): `{ resetWeekday, resetHour }` and the
  // boundary is computed here in the `now` frame. `RESET_RULE` if neither is given.
  const userSet = Number.isInteger(opts.resetWeekday) || Number.isInteger(opts.resetHour) || !!opts.boundaryCivil;
  const weekday = Number.isInteger(opts.resetWeekday) ? opts.resetWeekday : RESET_RULE.weekday;
  const hour = Number.isInteger(opts.resetHour) ? opts.resetHour : RESET_RULE.hour;
  const hourKnown = !!opts.boundaryCivil || hour !== null;
  const weekdayName = WEEKDAY_NAMES[weekday] || RESET_RULE.weekdayName;

  const nowDay = Date.UTC(now.year, now.month - 1, now.day);
  let boundaryDayStart;
  if (opts.boundaryCivil) {
    boundaryDayStart = civilOf(opts.boundaryCivil);
  } else {
    // Walk back to the most recent reset weekday at or before `now`. Midnight when the hour is
    // unknown; that weekday at `hour:00` when it is.
    const dow = new Date(nowDay).getUTCDay();
    const back = (dow - weekday + 7) % 7;
    boundaryDayStart = nowDay - back * 86400000 + (hourKnown ? hour * 3600000 : 0);
    if (hourKnown && back === 0 && nowCivil < boundaryDayStart) boundaryDayStart -= 7 * 86400000;
  }
  const boundaryDayEnd = hourKnown ? boundaryDayStart : boundaryDayStart + 86400000;
  const periodEndCivil = opts.periodEndCivil
    ? civilOf(opts.periodEndCivil)
    : boundaryDayStart + 7 * 86400000;

  const coverageStart = state.firstSeen;
  const coverageEnd = state.lastSeen;

  // THE GAPS THAT MATTER, and the assumption underneath them.
  //
  // Endpoint coverage is not enough. A record that starts before the boundary
  // and ends after `now` can still be missing the two days in the middle that
  // contain the reset, and reporting `open` off that is the comfortable lie
  // this tool exists not to tell.
  //
  // An earlier revision of this comment asserted that a gap in the log means
  // the client was not running, so no raid happened in it. **The owner told us
  // on 23 Aug 2026, first-hand, that they may have had logging switched off
  // during exactly such a gap.** So the assumption is false, and it was the
  // load-bearing one: a gap can hide a raid that really happened.
  //
  // The module cannot tell "not playing" from "not logging" — nothing in the
  // file distinguishes them. So it does the only honest thing: it REPORTS every
  // gap, and treats a large one as `not_looked` rather than `open`.
  //
  // THE THRESHOLD IS A JUDGEMENT, NOT A MEASUREMENT, and is labelled as one.
  // 24 hours separates the case we know about — a 36.6 h hole across the reset,
  // which the owner confirms was probably logging-off — from ordinary daily
  // gaps of 7 to 18 hours in the same record. A caller who wants to be stricter
  // has `coverageHoles` and can decide for itself; nothing is hidden either way.
  const PERIOD_GAP_TOLERANCE_MS = 24 * 60 * 60 * 1000;
  // Gaps at or above this are always listed, even when tolerated, so a run of
  // small holes cannot add up to a missing evening without anyone seeing it.
  const GAP_REPORT_MS = 60 * 60 * 1000;

  const periodFrom = boundaryDayStart;
  const periodTo = nowCivil;
  const relevant = (state.spans || [])
    .filter((sp) => sp.to >= periodFrom && sp.from <= periodTo)
    .sort((a, b) => a.from - b.from);

  const allGaps = [];
  let cursor = periodFrom;
  for (const sp of relevant) {
    if (sp.from > cursor + GAP_REPORT_MS) {
      allGaps.push({ from: cursor, to: sp.from, hours: (sp.from - cursor) / 3600000 });
    }
    cursor = Math.max(cursor, sp.to);
  }
  if (periodTo > cursor + GAP_REPORT_MS) {
    allGaps.push({ from: cursor, to: periodTo, hours: (periodTo - cursor) / 3600000 });
  }
  // The ones big enough to change the answer.
  const holes = allGaps.filter((g) => g.to - g.from > PERIOD_GAP_TOLERANCE_MS);

  const spans =
    coverageStart !== null &&
    coverageEnd !== null &&
    relevant.length > 0 &&
    holes.length === 0;

  // IS `now` ITSELF ON THE BOUNDARY DAY? Then the period start is ambiguous.
  //
  // Because the reset HOUR is not recorded, on Tuesday we do not know whether
  // the turnover has already happened. Two hypotheses are live:
  //   H1 — it has: the period began at the start of today
  //   H2 — it has not: the period is still the one that began last Tuesday
  // An earlier revision silently assumed H1, which reported "25 still open" on
  // a Tuesday afternoon for a character who had raided all week. That errs in
  // the safe direction, but it is an assumption presented as a fact, and this
  // module does not do that.
  //
  // So: evaluate BOTH, and where they disagree, SAY WHICH WAY EACH ONE FALLS.
  //
  // An earlier revision collapsed the disagreement to a bare `unknown`, and the
  // owner ran that build and learned nothing from it. A cell that cannot decide
  // still knows a great deal: it knows the exact instant that decides it. So it
  // says "done if the reset was at or before 22:37 on Tue 25 Aug, open if it was
  // after" — which is the same refusal to guess, and is actually usable.
  //
  // THE WHOLE PROBLEM IN ONE LINE. A kill at time k counts for the current
  // period if and only if `T <= k`, where T is the reset instant, and all we
  // know about T is which DAY it falls on. So for each tier, take the LATEST
  // kill k of that raid at that tier:
  //
  //   k at or after the end of the boundary day   ->  T <= k always      -> done
  //   k before the start of the boundary day      ->  T >  k always      -> open
  //   k inside the boundary day                   ->  DEPENDS, pivot = k
  //
  // The pivot is the LATEST such kill, not the earliest: any reset at or before
  // it leaves at least one kill inside the period.
  // Only a possibility when the hour is unknown - with it pinned, the boundary is a point and
  // there is no ambiguous day to be on.
  const onBoundaryDay = !hourKnown && nowCivil >= boundaryDayStart && nowCivil < boundaryDayEnd;
  const priorBoundaryStart = boundaryDayStart - 7 * 86400000;

  const cells = [];
  for (const entry of state.raids) {
    // ANY boss of this raid completes the raid's cell. That is the shared-lock
    // assumption made operational; see the note on RAIDS.
    const mine = state.kills.filter((k) => k.raid === entry.key);

    // Evaluate one hypothesis: what does the grid say if the period began at
    // `from`? Returns the cell state for difficulty `d`, ignoring coverage.
    const under = (from, d) => {
      // With the hour known `from` IS the boundary instant, so everything at or after it is in
      // period and nothing sits in an ambiguous "boundary day" window.
      const dayEnd = hourKnown ? from : from + 86400000;
      const period = mine.filter((k) => k.civil >= dayEnd);
      // PER TIER, and this used to be the bug. `onDay` and `unstated` were
      // both computed across the whole row, so ONE ambiguous kill blanked all
      // five cells of a raid — including cells where no kill of any kind had
      // happened and the honest answer was plainly `open`. Eight kills produced
      // twelve `unknown` cells that way.
      const onDay = mine
        .filter((k) => k.civil >= from && k.civil < dayEnd && k.difficultyStated && k.difficulty === d)
        .sort((a, b) => a.civil - b.civil);
      const unstated = period.filter((k) => k.instanced && !k.difficultyStated);
      const done = period
        .filter((k) => k.difficultyStated && k.difficulty === d)
        .sort((a, b) => a.civil - b.civil);
      if (done.length) {
        // A KILL PROVES COMPLETION, NOT CONSUMPTION.
        //
        // Measured, one character, one week, one tier: Avenrae killed
        // Innoruuk at D4 on 12, 15 AND 16 Aug 2026 — inside the week beginning
        // Tue 11 Aug, every one in a group instance. So a boss can be killed
        // again after the weekly is done, which the 28 Jul patch note supports:
        // a locked-out kill still pays a guaranteed drop.
        //
        // The grid therefore marks the FIRST completion of the period and
        // leaves the repeats alone. It does not count them, does not treat them
        // as a second completion, and does not read a repeat as evidence that
        // the lockout had cleared.
        const first = done[0];
        return {
          s: 'completed',
          done,
          first,
          repeats: done.length - 1,
          why: `${first.boss} at D${d} on ${formatCivil(first.at)}` +
               (done.length > 1 ? ` (and ${done.length - 1} later kill(s) this period, not counted)` : ''),
        };
      }
      // A KILL ON THE BOUNDARY DAY DECIDES THE CELL — we just do not know which
      // way, and we know exactly what would tell us. So the cell carries the
      // instant instead of a shrug. The pivot is the LATEST such kill: any
      // reset at or before it leaves at least one kill inside the period.
      if (onDay.length) {
        const pivot = onDay[onDay.length - 1];
        return {
          s: 'conditional',
          done,
          repeats: 0,
          pivot,
          doneIf: `the reset fell at or before ${formatCivil(pivot.at)}`,
          openIf: `the reset fell after ${formatCivil(pivot.at)}`,
          why:
            `completed if ${`the reset fell at or before ${formatCivil(pivot.at)}`}, still open if it fell after — ` +
            `${onDay.length} kill(s) at D${d} on the reset day itself` +
            (onDay.length > 1 ? ` (${formatCivil(onDay[0].at).slice(11)}..${formatCivil(pivot.at).slice(11)})` : '') +
            `, and the reset HOUR has never been measured`,
        };
      }
      if (unstated.length) {
        // Survives the omission rule only for a bare `- Solo` instance or a kill
        // with no zone-in before it. One of this row's five cells may be done
        // and we cannot say which — so every cell of the row carries it.
        return { s: 'unknown', done, repeats: 0, why: `${unstated.length} kill(s) this period at a tier the game did not state — one of this raid's five tiers may be done` };
      }
      return { s: 'open', done, repeats: 0, why: 'no kill observed since the reset, and coverage spans the period' };
    };

    for (let d = 0; d < DIFFICULTY_LABELS.length; d++) {
      const h1 = under(boundaryDayStart, d);
      const h2 = onBoundaryDay ? under(priorBoundaryStart, d) : h1;

      let cellState;
      let because;
      // Non-null only when the cell is `conditional`: the instant that decides
      // it, and which way it falls on each side. This is the whole of the
      // "stop collapsing to ?" change — the structure a UI needs to render
      // "done if the reset was before 22:37, open if after" instead of a shrug.
      let decidedBy = null;
      // A KILL LINE IS AN OBSERVATION, AND A COVERAGE GAP CANNOT UN-SEE IT.
      //
      // `!spans` downgrades a cell to `not_looked` when the log does not cover the whole period —
      // correct for an `open` cell, because "no kill seen" is only evidence of absence when there
      // was nothing you missed. But a cell that IS backed by a kill line at that tier in this
      // period is `completed` regardless: the kill is in the log, it was read, and a hole
      // elsewhere in the week does not make it un-happen. This is the module's own `evidence`
      // split (completed = OBSERVED, open = INFERRED "only because coverage spans the period")
      // finally applied here. Without it, a real kill in a partial log renders as `not_looked`.
      const observed = h1.s === 'completed' && (h2.s === 'completed' || !onBoundaryDay);
      if (observed) {
        cellState = 'completed';
        because = h1.why;
      } else if (!spans) {
        cellState = 'not_looked';
        because = coverageStart === null
          ? 'no lines seen at all'
          : holes.length
            ? `no record of ${holes.map((h) => `${h.hours.toFixed(1)}h`).join(' + ')} inside this period`
            : 'coverage does not span this period';
      } else if (h1.s === h2.s && h1.why === h2.why) {
        cellState = h1.s;
        because = h1.why;
        decidedBy = h1.pivot
          ? { pivot: formatCivil(h1.pivot.at), doneIf: h1.doneIf, openIf: h1.openIf }
          : null;
      } else {
        // THE TWO HYPOTHESES DISAGREE, which happens only on the boundary day
        // itself. Name both branches; do not collapse them to a shrug.
        //
        //   H1 — the turnover has already happened today
        //   H2 — it has not, so the period is still last week's
        //
        // This used to emit a bare `unknown`. It now emits the same refusal to
        // guess with the two outcomes attached, because a player who is told
        // "done if the reset already happened, open if not" can look at the
        // clock and decide; a player told "?" cannot do anything at all.
        cellState = 'conditional';
        const say = (h) => (h.s === 'conditional' ? `${h.doneIf} — ${h.s}` : h.s);
        because =
          `today is ${weekdayName} and the reset hour is not set, so ` +
          `whether the turnover has happened yet is unknown: "${say(h1)}" if it has, ` +
          `"${say(h2)}" if it has not`;
        decidedBy = {
          pivot: h1.pivot ? formatCivil(h1.pivot.at) : null,
          doneIf: h1.s === 'completed' || h2.s === 'completed'
            ? `the turnover has ${h1.s === 'completed' ? 'already happened' : 'not happened yet'}`
            : h1.doneIf || h2.doneIf || null,
          openIf: h1.s === 'open' || h2.s === 'open'
            ? `the turnover has ${h1.s === 'open' ? 'already happened' : 'not happened yet'}`
            : h1.openIf || h2.openIf || null,
        };
      }

      cells.push({
        raid: entry.key,
        label: entry.label,
        // What this row contains, so a player never has to know which boss we
        // picked to stand for the zone.
        bosses: entry.bosses.slice(),
        // NOT `bosses.length === 1`. That derived it from the completion-key
        // list and so asserted "Nagafen's Lair is a single-boss raid" purely
        // because we had only listed one key — a claim about the game read off
        // our own configuration. It is now a measured field on the entry.
        singleBoss: entry.singleBoss === true,
        // Measured to die exactly once on (nearly) every group visit, and
        // deliberately NOT completion keys — see the note above RAIDS.
        alsoDies: (entry.alsoDies || []).slice(),
        // Whether a weekly task for this boss was ever seen in our corpus. NOT
        // a claim that the boss can or cannot carry one — the task goes to the
        // first three raids of the week, whichever they are.
        weeklyTaskObserved: entry.weeklyTaskObserved === true,
        difficulty: d,
        difficultyLabel: DIFFICULTY_LABELS[d],
        state: cellState,
        because,
        // See the declaration above. Null unless `state === 'conditional'`.
        decidedBy,
        // WHAT KIND OF FACT THIS IS. `completed` is OBSERVED — a kill line, in
        // the log, at that tier, in this period. `open` is INFERRED, and only
        // under the one-completion-per-tier-per-week model the owner supplied:
        // it means "no kill seen", which is evidence of absence only because
        // coverage spans the period. `unknown` and `not_looked` are neither.
        evidence: cellState === 'completed' ? 'observed'
          : cellState === 'open' ? 'inferred from the one-per-week model'
          : cellState === 'conditional' ? 'conditional on the reset hour, which is not measured'
          : 'not established',
        // TRUE when the tier that resolved this cell came from the omission rule
        // — the client wrote `- Group` with no index, which is measured 12/12 to
        // mean Normal. Surfaced per cell so the one inference in the chain is
        // visible exactly where it is relied on.
        tierFromOmission: (h1.done || []).some((k) => k.difficultyFromOmission === true),
        // WHEN the first completion of this period happened, as a civil stamp,
        // and WHICH boss did it. Null unless the cell is `completed`.
        //
        // These exist because the browser page was reading the date back out of
        // `because` with a regex — parsing our own prose. It worked until the
        // regex was mangled by a shell heredoc and the date silently vanished
        // from every cell, which is the mild version; the bad version is
        // rewording `because` some Tuesday and breaking the view with no error
        // anywhere. A view should read a field, not a sentence.
        completedAt: cellState === 'completed' && h1.first ? formatCivil(h1.first.at) : null,
        completedBy: cellState === 'completed' && h1.first ? h1.first.boss : null,
        // Later kills of the same boss at the same tier in the same period.
        // Recorded, never counted: a kill proves completion, not consumption.
        repeatKills: h1.repeats || 0,
        // Which instance shape the completion happened in. Recorded but NOT used
        // to split the grid: whether a kill in `- Group N` and a kill in
        // `Zone N` share one lock is unmeasured, so the grid keeps the owner's
        // 25 cells and carries the shape so the question stays answerable.
        shapes: [...new Set(h1.done.map((k) => (k.group ? 'group' : 'raid')))],
      });
    }
  }

  const by = (s) => cells.filter((c) => c.state === s);
  const fmtBoundary = (civil) =>
    hourKnown ? formatCivil(fromCivil(civil)).slice(0, 16) : formatCivil(fromCivil(civil)).slice(0, 10);
  return {
    resetRule: (() => {
      // Default is Tuesday 11:00 US Eastern; anything else is the user's own.
      const isDefault = weekday === 2 && hour === 11;
      const changed = userSet && !isDefault;
      return {
        weekday,
        weekdayName,
        hour,
        zone: 'US Eastern',
        provenance: changed ? 'set by you' : 'default',
        source: changed ? 'your setting' : 'in-game lockout timer reading (Tuesday 11:00 Eastern)',
      };
    })(),
    period: {
      // The exact week window, in the log's own local frame. `periodStart`/`periodEnd` carry the
      // hour when it is known; `boundaryDay` stays the date-only form the old callers read.
      boundaryDay: formatCivil(fromCivil(boundaryDayStart)).slice(0, 10),
      boundaryWeekday: weekdayName,
      periodStart: fmtBoundary(boundaryDayStart),
      periodEnd: fmtBoundary(periodEndCivil),
      hourKnown,
      // Stated once, at the top of the projection, so a caller cannot render
      // the grid without it being available to render alongside.
      evidenceNote:
        '"completed" is OBSERVED: a kill line at that tier in this period. ' +
        '"open" is INFERRED from the one-completion-per-tier-per-week model — it ' +
        'means no kill was seen, which counts as evidence of absence only ' +
        'because coverage spans the period. "conditional" is a kill we found ' +
        'that falls on the reset day itself: the cell names the instant that ' +
        'decides it, because the reset HOUR has never been measured. A kill ' +
        'proves completion, not consumption: repeats are recorded and not counted.',
      nowIsOnBoundaryDay: onBoundaryDay,
      coverageSpansPeriod: spans,
      // Stretches of the period we have no record of, longer than a raid takes.
      // Empty means the period is fully observed. Non-empty is exactly why the
      // cells read not_looked rather than open.
      // Gaps large enough to change a cell to not_looked.
      coverageHoles: holes.map((h) => ({
        from: formatCivil(fromCivil(h.from)),
        to: formatCivil(fromCivil(h.to)),
        hours: Number(h.hours.toFixed(2)),
      })),
      // EVERY gap of an hour or more, tolerated ones included. Listed so a run
      // of small holes cannot quietly add up to a missing raid night.
      coverageGaps: allGaps.map((h) => ({
        from: formatCivil(fromCivil(h.from)),
        to: formatCivil(fromCivil(h.to)),
        hours: Number(h.hours.toFixed(2)),
        tolerated: h.to - h.from <= PERIOD_GAP_TOLERANCE_MS,
      })),
      coverageAssumption:
        'A gap cannot be told apart from "not playing" or "not logging" — the ' +
        'file records neither. The owner confirmed on 23 Aug 2026 that logging ' +
        'was probably off during one such gap, so gaps are NOT assumed empty. ' +
        'Gaps over 24 h make a cell not_looked; that threshold is a judgement, ' +
        'not a measurement, and every gap is listed in coverageGaps regardless.',
      coverageGapToleranceHours: 24,
      coverageFrom: coverageStart === null ? null : formatCivil(fromCivil(coverageStart)),
      coverageTo: coverageEnd === null ? null : formatCivil(fromCivil(coverageEnd)),
    },
    // OPEN FIRST. This ordering is the feature.
    open: by('open'),
    openCount: by('open').length,
    // Cells whose answer turns on the unmeasured reset hour. Each one carries
    // `decidedBy` — the instant, and which way it falls on each side. These are
    // NOT `uncertain`: they are answered, with a stated condition.
    conditional: by('conditional'),
    conditionalCount: by('conditional').length,
    uncertain: by('unknown'),
    uncertainCount: by('unknown').length,
    notLooked: by('not_looked'),
    notLookedCount: by('not_looked').length,
    completed: by('completed'),
    completedCount: by('completed').length,
    cells,
  };
}

// The per-boss view a UI would show. `now` is REQUIRED and must be a civil
// timestamp from the same clock that wrote the log — see `civilFromDate` in
// the adapter. Passing an epoch here is a bug and throws, because a silent
// timezone error is exactly the failure this module exists to avoid.
function requireCivil(now) {
  if (!now || typeof now !== 'object' || typeof now.year !== 'number') {
    throw new TypeError(
      'project(state, now): `now` must be a civil timestamp object ' +
      '{year, month, day, hour, minute, second} taken from the same clock that ' +
      'writes the log. It is not a Date and not an epoch — this module has no ' +
      'timezone and will not guess one.'
    );
  }
}

function project(state, now) {
  requireCivil(now);
  const nowCivil = civilOf(now);

  const bosses = Object.values(state.tasks).map((t) => {
    const lastAssigned = t.assignments[t.assignments.length - 1] || null;
    const lastCompleted = t.completions[t.completions.length - 1] || null;
    return {
      boss: t.boss,
      task: t.task,
      cadence: t.cadence,
      timesAssigned: t.assignments.length,
      timesCompleted: t.completions.length,
      lastAssigned: lastAssigned
        ? { provenance: 'observed', value: formatCivil(lastAssigned.at), hoursAgo: (nowCivil - lastAssigned.civil) / 3600000 }
        : NOT_RECORDED,
      lastCompleted: lastCompleted
        ? { provenance: 'observed', value: formatCivil(lastCompleted.at), hoursAgo: (nowCivil - lastCompleted.civil) / 3600000 }
        : NOT_RECORDED,
      // Deliberately absent: `available`, `resetsAt`, `locked`. Answering any
      // of those needs the reset rule, and the reset rule is not known. A UI
      // showing "available in 3d 4h" would be inventing a number.
      available: NOT_RECORDED,
    };
  });

  return {
    version: STATE_VERSION,
    character: state.character,
    now: formatCivil(now),
    bosses,
    reset: projectReset(state),
    period: projectPeriod(state),
    requests: classifyRequests(state),
    grants: {
      provenance: state.grants.length ? 'observed' : 'not recorded',
      total: state.grants.length,
      items: state.grants.map((g) => ({ item: g.item, at: formatCivil(g.at) })),
    },
    instances: Object.values(state.instances),
    coverage: {
      provenance: state.firstSeen === null ? 'not recorded' : 'observed',
      from: state.firstSeen === null ? null : formatCivil(fromCivil(state.firstSeen)),
      to: state.lastSeen === null ? null : formatCivil(fromCivil(state.lastSeen)),
      // A tailer that starts at end-of-file has seen nothing before it started.
      // Saying so is the difference between "no lockout" and "not looked".
      note:
        'Covers only the lines fed to this module. A live tailer that begins ' +
        'at the end of the file has no history; backfill explicitly if history ' +
        'is wanted.',
    },
    dropped: state.dropped,
    caveats: [CAVEAT_DST],
  };
}

// `eqlog_Avenrae_rivervale.txt` -> `Avenrae`
// `eqlog_Shara_rivervale_2026-08-14b.txt` -> `Shara`
//
// The character is in the FILENAME, never in the line. A host that routes
// lines to the right per-character state needs this; a host that only ever
// watches one character does not. Pure string function, no filesystem.
function characterFromLogFilename(filename) {
  const m = /^eqlog_([^_]+)_/i.exec(String(filename).replace(/^.*[\\/]/, ''));
  return m ? m[1] : null;
}

function fromCivil(civil) {
  const d = new Date(civil);
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()],
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

// The thresholds that change behaviour, exported so a host can read them rather
// than discover them. This module owns no config file and takes no options —
// these are constants, published so the numbers are not hidden. If a host needs
// them different, that is a conversation, not a setting.
const THRESHOLDS = Object.freeze({
  GRANT_WINDOW_MS,          // how long after `danger` a grant still counts
  CONTROL_BEFORE_MS,        // how far back a Voidling line satisfies the control
  CONTROL_AFTER_MS,
  COLLAPSE_MS,              // repeated `danger` inside this is one attempt
  MAX_EVENTS,               // dedupe horizon, in observations
});

module.exports = {
  THRESHOLDS,
  // parsing
  parseLine,
  splitStamp,
  parseInstanceName,
  // state
  createState,
  applyLine,
  applyLines,
  // projection
  project,
  projectReset,
  projectGrid,
  projectPeriod,
  classifyRequests,
  // time helpers (pure)
  civilOf,
  civilWeekday,
  formatCivil,
  fromCivil,
  characterFromLogFilename,
  // tables
  DIFFICULTY_LABELS,
  RAIDS,
  RAID_OF_BOSS,
  normaliseBossName,
  RESET_RULE,
  LOCKOUT_MODEL,
  REPLAY_MODEL,
  OBSERVED_ZONES,
  WINDOW_TO_KILL_NAME,
  OBSERVED_WEEKLY_BOSSES,
  STATE_VERSION,
  CAVEAT_DST,
};
