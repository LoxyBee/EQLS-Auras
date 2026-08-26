# Session Handoff — 25 August 2026

Written for whoever picks this up next, including Shara herself. Supersedes the 23 August version
below the line — that one described a state that has since moved a long way; kept only because
its working-practices section still holds.

## Read these first, in this order

1. **`NOTES-STATUS.md`** — the live status of your 40-note backlog, one row per note. Start here;
   it is the answer to "what is done".
2. **`TESTING.md`** — everything built but **not yet confirmed in game**. Large, and deliberately
   so. Nothing in it counts as confirmed until you have seen it working. The newest section is
   dated 25 Aug, near the bottom.
3. **`CLAUDE.md`** — the durable source of truth. Conventions, architecture, and 29 detection
   gotchas that were each learned the hard way, plus the full backlog/priority list. Read the
   gotchas before touching detection.
4. **`FEATURES.md`** — the original note-dump with the full reasoning behind each one.
5. This file — what state the last session left things in.

---

## Where it stands

**All 40 notes are accounted for: 38 done, 1 blocked, 1 skipped, 0 partial.** (Note 26's row moved
from "open" to done this session — see below.)

- **#28 (blocked)** — Ally Buffs showed a buff you never cast. Still needs the bug to happen once
  more; the detection log now records what opened the burst and how long ago, which is the fact
  that was missing, so one more occurrence should be enough to diagnose.
- **#2 (skipped)** — first-aggro premade. Your call: you have solved this elsewhere and will bring
  it yourself. The greyed-out placeholder stays in Add Aura.

**Verification state, this session:** `npm test` — **52 suites, 802 cases, all green.**
`node tools/smoke-launch.js` was attempted but exited immediately with no error output, which
looks like it hit the single-instance lock from an already-running dev copy rather than a real
failure — worth a clean re-run with no other copy open before trusting it either way.
`node tools/replay-log.js` could not run in this environment (your log files live under a
different user path than this machine has); **this needs running for real before the P0/P0c/
stacking work below is trusted** — see "What needs your eyes" below.

**Branch `feat/eql-roster-and-backlog`. Nothing has been pushed anywhere.** The repo's top-level
docs were also reorganized this session — every status/planning doc except `README.md` and
`CLAUDE.md` now lives under `docs/`; this file is at `docs/HANDOFF.md` accordingly.

---

## What landed this session (25 August)

This was a big one — the P0 detection-engine rework CLAUDE.md flagged as the top backlog item, plus
a long list of live-reported bugs and QOL asks. All of it is described in full in the relevant
source-file comments (they're written narratively on purpose, so read them rather than trusting a
summary that will drift). This is the short version.

### The P0 detection rework, and why it's still off by default

Three separate, independently-switchable "Experimental" toggles now live under
**Log page → Diagnostics**, all **off by default** and all persisted:

- **"Use evidence-based detection"** (`useEvidenceModel`) — the actual P0 fix. Before this, the
  unique-landing-text tier's "not currently memorized" / "an ally's burst just fired" checks could
  silently `IGNORE` a real landing outright — a soft signal was treated as a hard veto, and later
  tiers that might have resolved it correctly never ran. With the toggle on, those two signals
  still count as evidence against the match, but the outcome becomes a queued disambiguation prompt
  instead of a silent drop. A genuine spellbook absence (the spell was never scribed at all) is
  untouched either way — that one is real negative evidence, not just an absence of positive
  evidence. See `buffEngine.js`'s constructor comment on `useEvidenceModel` and
  `test/evidence-based-detection.test.js`.
- **"Use cast-time-aware confirmation"** (`useCastTimeFilter`, the P0c idea CLAUDE.md had parked) —
  scales the fallback-confirm/cancel window by the spell's own cast time (from
  `CAST_TIME_RATES`, sheet-sourced per-mote-tier cast-time deltas, plus a confirmed Spell Casting
  Deftness AA multiplier) instead of one flat window for every spell, with a 500ms tolerance either
  side for log-timestamp rounding.
- **"Use self-buff overwrite detection"** (`useStackingModel`) — this is note 26's answer, the one
  thing `NOTES-STATUS.md` used to list as still genuinely open. New file `src/main/spellStacking.js`
  reimplements the core of EQEmu's public `Mob::CheckStackConflict` algorithm against the game's own
  `spells_us.txt`, verified against seven confirmed pairs pulled from your real logs (five
  "did not take hold... (Blocked by X)" lines, plus the two shared-fade-text pairs — Nimble/Agility
  and Symbol of Pinzarn/Symbol of Naltron — that used to be genuinely undecidable). When on, a
  newly-landed self-buff that the game's own stacking rule would silently replace removes the stale
  one immediately, instead of leaving it to time out or get misattributed by a shared fade line
  later. Deliberately narrower than the full EQEmu algorithm (no illusions/procs, no Complete Heal,
  no DoT-vs-DoT, no bard-song pool) — a verdict here only ever *removes* a stale entry, never adds
  a false one.

All three are wired end-to-end (main.js persistence, IPC, checkbox in Diagnostics) and covered by
their own test files, but **none has been run against a real log session yet** — that's the single
biggest thing this handoff is asking for. Turn them on one at a time, play a session, and watch the
detection log.

### Everything else that shipped

- **Bard Songs aura** (backlog #15) — a dedicated premade tracking every bard song active on you
  regardless of caster, grouped by whoever cast it when the engine can tell (self cast line vs. an
  ally's third-person cast-begin line), falling into a visible "Unknown" bucket rather than
  guessing otherwise. The unique-landing-text tier's ally-cast vetoes are waived unconditionally
  for songs specifically — confirmed live that this is required, not just convenient, because
  self-vs-ally is genuinely undecidable for songs from the log alone.
- **Charm Broke premade** — text alert when your own charm target breaks, watching the game's
  generic "spell has worn off of" template under every roster spell tagged `scaleCategory:'charm'`.
- **Settings-panel rework** — every aura now resolves to one of 12 "shapes," with a single table
  deciding which optional rows/cards each shape shows. Fixes two real leaks: Damage parser and
  Travel guide no longer show a buff picker or a "Watching:" row that never did anything for them.
  Structurally verified (264-check shape-matrix test); **still needs your eyes on the actual running
  panels** — full checklist in `TESTING.md`.
- **Custom timer overhaul, duration half** — "Custom timers" section renamed "Custom triggers";
  the per-trigger Duration field is gone, replaced by one slider on the aura that every trigger
  shares, closing a real reported confusion ("two settings for duration... there should never be
  two sources").
- **Buff-timer "also track cooldown" toggle**, **spell-stacking-aware self-buff overwrite** (above),
  **currentlyMemorized now scoped per loadout profile** (a loadout swap prints zero forget/memorize
  lines, so the old flat map kept vouching for the previous loadout's gems after a swap — confirmed
  live to land the wrong buff off exactly that stale evidence).
- **Two new debug logs**, both off by default behind the existing Diagnostics toggle: one in
  `customTimerEngine.js` (every trigger fired/loaded/ended — custom triggers had *no* trace of this
  before, which is what made the last two live-reported bugs need a manual `widgets.json` read to
  root-cause), and one for alert sounds actually playing (answers "is the app slow, or is it the
  log-poll interval" as a measurement instead of a guess).
- **Sidebar polish**: the per-widget status dot is now shown on every widget (not just
  profile-restricted ones), coloured green/grey by whether it's actually on for the *current*
  profile right now, not by scoping alone. A width control for note 37's coloured tile edge, shown
  only for icon-mode tiles once the edge itself is on.
- **Text-aura justification** (left/right/middle) — not CSS text-align, since a text tile shrink-
  wraps to its own message; this decides which edge of the window stays anchored as the message's
  width changes.
- **Zero-duration custom timer fix** — a trigger built purely to make a noise (0s duration) used to
  double-beep (land beep + warning beep in the same tick) and to leave a flash-visible tile for one
  render frame it shouldn't have had at all.
- A pre-existing bug that `TESTING.md`'s prior "settings-panel rework" note flagged (uncaught
  `ReferenceError`s on every launch from `HOTKEY_LABELS`/`selectedId` being read outside the
  function that declares them) has since been fixed — both are now declared inside
  `initWidgetsPanel`, the function that actually uses them.

### Housekeeping visible in the working tree

- `archive/buffEngine-backup-2026-08-25-pre-p0-rework.js` — a snapshot taken before the P0 rework,
  kept for comparison. Leave it in `archive/`, same convention as the legacy 11,337-entry roster.
- `test/all-of-triggers.test.js` and `test/sound-only.test.js` were deleted; both are superseded by
  rewritten coverage in other files (`trigger-combine-mode.test.js` and the settings-panel-shape
  updates to `sound-only`-adjacent tests respectively) — not a coverage loss, a replacement.
- **Two deletions worth flagging rather than assuming are correct**: `needs-duration-review.txt`
  (an intermediate roster-building worklist) and `new spell roster to be added.xlsx` (the
  spreadsheet `CLAUDE.md` documents as the *authoritative source* for `node tools/build-roster.js
  --write`) are both gone from the working tree. If the roster ever needs rebuilding again, that
  file's absence would block it — worth confirming with Shara whether this was deliberate cleanup
  (the roster build already ran and its output is what matters going forward) or an accidental
  delete, before this gets committed.

---

## What needs your eyes

In priority order:

1. **Run a real log session with the three P0/P0c/stacking toggles on, one at a time**, and watch
   the detection log. This is new, unverified-in-game, and is the single most important item — it's
   the fix for the class of bug you diagnosed yourself ("every check that doesn't pass should
   continue, not end the check").
2. **`node tools/replay-log.js`** against your real logs, to confirm the five baseline figures
   (129 distinct buffs / 211,546 landings / 840 ally landings / 27 prompts / 91 unknown texts) still
   match with the toggles off, and to get fresh numbers with them on.
3. The settings-panel-rework checklist in `TESTING.md` (12 aura shapes, listed individually).
4. Confirm whether the two deletions above (`needs-duration-review.txt`, the roster xlsx) were
   intentional before this branch is committed/pushed.
5. Note 28, as before — send the detection log the next time Ally Buffs shows something you didn't
   cast; the burst-origin/age info should now make it diagnosable in one occurrence.

---

## Working practices that earned their place

- **Measure, don't guess.** Every log pattern in this codebase carries the count it matched across
  your real logs. The first time patterns were written from memory, nine of twelve matched nothing
  at all and the feature they powered had never once fired — while its tests, written from the same
  memory, all passed.
- **Mutation testing, every time.** Break the rule on purpose, confirm the test fails, restore.
- **Replay before and after anything touching detection.** `node tools/replay-log.js`. All five
  figures must match, because losing functionality counts as failure — see item 2 above, this is
  outstanding for this session's work.
- **Launch the app before saying it works.** `node tools/smoke-launch.js`.
- **When Shara states a game fact, that is evidence.** Measure to get the number, not to decide
  whether to believe her.

## Hard rules, unchanged

- **`PERSONAL COPY DO NOT TOUCH.md` is off limits.** In `.gitignore`, never opened, never
  committed. That gitignore entry is the only thing that makes `git add -A` safe to type here.
- **Do not push anywhere.** Nothing goes to `LoxyBee/EQLS-Auras` without Shara's explicit consent.
- **EverQuest runs live on this machine.** Running the app is fine; driving it with synthetic
  clicks is not — a stray automated click has already landed in her game window.

---

# Prior handoff — 23 August 2026

Kept for history. See "Where it stands" above for the current state; the notes below describe an
earlier point (37/39 done) that the 25 August session has since moved well past.

**37 of the 39 notes are done. 0 partial. 1 blocked. 1 skipped.** Verification then: 36 test
suites, 570 cases, all green. `npm run dist` builds the NSIS installer. The full-log replay was
identical to baseline on all five figures at that time.

What landed that session: #19 Damage parser, #11/#17 rank scaling (plus fixing the AA bonus
wrongly applying to debuffs/DoTs/mez), #20 Travel guide, #9 all-of triggers, #30 share codes from
chat, #24/#34 confirmed already-done, #28 made diagnosable via burst-origin logging.
