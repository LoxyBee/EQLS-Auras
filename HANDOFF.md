# Session Handoff — 23 August 2026

Written for whoever picks this up next, including Shara herself.

## Read these first, in this order

1. **`NOTES-STATUS.md`** — the live status of your 39-note backlog, one row per note. Start here;
   it is the answer to "what is done".
2. **`TESTING.md`** — everything built but **not yet confirmed in game**. Large, and deliberately
   so. Nothing in it counts as confirmed until you have seen it working.
3. **`CLAUDE.md`** — the durable source of truth. Conventions, architecture, and 28 detection
   gotchas that were each learned the hard way. Read the gotchas before touching detection.
4. **`FEATURES.md`** — the original note-dump with the full reasoning behind each one.
5. This file — what state the last session left things in.

---

## Where it stands

**37 of the 39 notes are done. 0 partial. 1 blocked. 1 skipped.**

- **#28 (blocked)** — Ally Buffs showed a buff you never cast. It cannot be diagnosed until it
  happens again, and that is genuinely the only thing standing in the way. See below.
- **#2 (skipped)** — first-aggro premade. Your call: you have solved this elsewhere and will bring
  it yourself. The greyed-out placeholder stays in Add Aura.

**Verification state:** 36 test suites, 570 cases, all green. The app launches and stays up
(`node tools/smoke-launch.js` — real Electron, clicks nothing). `npm run dist` builds the NSIS
installer. The full-log replay is identical to baseline on all five figures.

**Branch `feat/eql-roster-and-backlog`, based on `da698b4`. Nothing has been pushed anywhere.**

---

## The one thing that needs you

**Note 28.** The likeliest cause is a burst: activating something opens a short window, and a buff
landing on a groupmate inside it gets credited to you even when somebody else cast it. It has been
unprovable because the detection log said only `burst context` for both the correct case and the
wrong one — a report of the bug and a report of normal operation read identically.

That is fixed. The log now records what opened the burst and how long ago:

```
ALLY LANDED "Spirit of the Puma" on "Avenrae" - burst context
(burst opened 4.2s ago by "Cannibalize"), unique third-person landing text
```

The age is the diagnostic half. Half a second after you pressed something is plausibly yours;
eight seconds later is probably somebody else's cast arriving inside your window.

**When it next happens:** note the buff name and roughly the time, then send that day's file from
the `detection-logs` folder. One occurrence should now be enough.

---

## Three things I could not verify, and would like your eyes on

These are in `TESTING.md` too, but they are the ones that matter most because I had no way to
settle them myself.

1. **Debuff and charm/mez tier rates.** The spreadsheet says +10% per tier and marks it *assumed*.
   Every observation of one in your logs was cut short by the mob dying before the spell ran out,
   so I have nothing to check it against. Togor's Insects V should read **315s** against a base of
   210. If it wears off noticeably early or late, that number is the suspect.
2. **Zone names in the travel guide.** 38 of the 104 are places you have never entered, so their
   exact EQL wording is inferred — mostly the question of a leading "The". They cannot be dropped;
   real routes pass through them. If one reads wrong, tell me the right spelling.
3. **The Permafrost pair.** Your zone list has both `Permafrost Keep` and
   `The Permafrost Caverns - Group`; classic EverQuest has one zone there. I have treated them as
   the same place. If they are actually two, routing to the second sends you to the wrong door.

---

## What landed this session

Seven notes, each with its own commit carrying the full reasoning. Short version:

- **#19 Damage parser.** One row per attacker for the current fight. Direction is *derived* rather
  than guessed from name shape — see gotcha #20, and note that `Fright` is a monster with a
  one-word name, which is what kills the obvious approach.
- **#11/#17 Rank scaling**, plus a bug that was already shipped: the AA duration bonus was being
  applied to debuffs, DoTs and mez. 155 roster entries would have over-timed by up to 65% the
  moment you set your AA level. Now `buff` only, per your correction.
- **#20 Travel guide.** Zone graph sourced and cross-checked; routes from where you are to wherever
  you say, using travel spells you have actually scribed. Destination set in game with
  `/tell <zone>`.
- **#9 All-of triggers**, to your design: no shared window, each condition holds for its own time,
  a zone condition holds until you leave.
- **#30 Share codes from chat.** Both blockers answered by measurement. It offers, never imports.
- **#24 and #34** were already done and marked wrong. Checked rather than trusted.
- **#28** made diagnosable, as above.

---

## Working practices that earned their place

- **Measure, don't guess.** Every log pattern in this codebase carries the count it matched across
  your 1,521,971 lines. This is not decoration: the first time patterns were written from memory,
  **nine of twelve matched nothing at all** and the feature they powered had never once fired —
  while its tests, written from the same memory, all passed.
- **Mutation testing, every time.** Break the rule on purpose, confirm the test fails, restore. It
  caught **eight tests passing while proving nothing** this session alone. A green suite is not
  evidence until it has been shown it can go red.
- **Replay before and after anything touching detection.** `node tools/replay-log.js`. Baseline:
  129 distinct buffs, 211,546 landings, 840 ally landings, 27 prompts, 91 unknown texts. All five
  must match, because losing functionality counts as failure.
- **Launch the app before saying it works.** `node tools/smoke-launch.js`. A
  `globalShortcut.register('Pause')` that *throws* rather than returning false shipped past a green
  suite once, and the UI advertised a hotkey that had never worked.
- **When Shara states a game fact, that is evidence.** Twice this session a measurement appeared to
  contradict her and she was right both times. Measure to get the number, not to decide whether to
  believe her.

## Hard rules, unchanged

- **`PERSONAL COPY DO NOT TOUCH.md` is off limits.** In `.gitignore`, never opened, never
  committed. That gitignore entry is the only thing that makes `git add -A` safe to type here.
- **Do not push anywhere.** Nothing goes to `LoxyBee/EQLS-Auras` without Shara's explicit consent.
- **EverQuest runs live on this machine.** Running the app is fine; driving it with synthetic
  clicks is not — a stray automated click has already landed in her game window.
