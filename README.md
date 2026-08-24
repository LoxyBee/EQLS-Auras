# EQLS Auras

A buff-timer overlay for EverQuest Legends. It reads your log file and draws timers on top of the
game for buffs, debuffs, cooldowns, damage and travel routes.

---

## Running it

You need [Node.js](https://nodejs.org/) installed. Then, in this folder:

```
npm install
npm start
```

`npm install` only needs doing once (it fetches Electron and takes a few minutes). After that
`npm start` is all you need.

To build the Windows installer instead:

```
npm run dist
```

The installer lands in `dist/`. Neither `dist/` nor `node_modules/` is included in this package —
both are rebuilt by the commands above.

---

## Checking it still works

Three things, in increasing order of how much they prove:

```
node test/run.js            36 suites, 570 cases. Fast, no Electron.
node tools/smoke-launch.js  Starts the real app, holds, reports. Clicks nothing.
node tools/replay-log.js    Runs 1.5 million real log lines through the real engine.
```

The replay is the important one before shipping any detection change. Its baseline is **129
distinct buffs, 211,546 landings, 840 ally landings, 27 prompts, 91 unknown texts** — all five
should be identical, because a change that loses detection is a failure even if every test passes.

---

## The documentation, in reading order

| File | What it is |
| --- | --- |
| **`HANDOFF.md`** | Start here. What state things are in and what needs a person. |
| **`NOTES-STATUS.md`** | Every one of Shara's 39 notes, with what is built and what is not. |
| **`TESTING.md`** | Everything built but not yet confirmed in game. This is the to-do list for testing. |
| **`CLAUDE.md`** | Conventions, architecture, and 28 detection gotchas. Read the gotchas before touching detection. |
| **`FEATURES.md`** | The original note-dump, with the full reasoning behind each note. |
| **`OPUS-SESSION-STATE.md`** | A long continuity record of how the work was done and why. Section 9 is the current state. |

The three `UX_*` and `VISUAL_*` files are earlier design work, kept for reference.

---

## How it works, in one paragraph

EverQuest writes everything that happens to a log file. There is no universal "buff landed"
message — every spell has its own flavour text — so detection is exact-string matching against a
roster of 1,052 spells built from the EQL spreadsheet and the game's own string table. When a line
matches, a timer starts. Where a line is ambiguous the app asks rather than guesses, which is the
rule the whole design hangs off: **it would rather show nothing than show something wrong.**

Every log pattern in the codebase carries the number of times it matched across 1,521,971 real
lines. That is not decoration — the first time patterns here were written from memory, nine of
twelve matched nothing at all, and the feature they powered had never once fired.
