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

**Run `npm install` first.** The test suite does not launch Electron, but one suite imports
`widgetManager`, which imports Electron itself — so on a fresh copy it fails with
`Cannot find module 'electron'` until the dependencies are there. The other 51 suites run without
it.

Three things, in increasing order of how much they prove:

```
node test/run.js            The whole test suite. Seconds, and launches nothing.
node tools/smoke-launch.js  Starts the real app, holds, reports. Clicks nothing.
node tools/replay-log.js    Runs 1.5 million real log lines through the real engine.
```

`smoke-launch` exists because no unit test starts Electron, and a hotkey registration that
*throws* rather than returning false once shipped past a completely green suite.

The replay is the important one before shipping any detection change. Its baseline is **129
distinct buffs, 211,546 landings, 840 ally landings, 27 prompts, 91 unknown texts** — all five
should be identical, because a change that loses detection is a failure even if every test passes.

---

## The documentation

| File | What it is |
| --- | --- |
| **`CLAUDE.md`** | Conventions, architecture, and the detection gotchas. Read the gotchas before touching detection. Its "Remaining backlog" section is the feature roadmap. |
| **`docs/QOL-BACKLOG.md`** | The live backlog — every requested change, tagged and sequenced. Start here for "what's next". |
| **`docs/TESTING.md`** | Everything built but not yet confirmed in game. The to-do list for live testing. |
| **`docs/BUFF-STACKING.md`** | The buff-stacking heading model — spec for the Buff Planner, wired into `src/shared/buffLines.js`. |
| **`docs/EVIDENCE.md`** | Provenance log for the raid-lockout parser — where every fact came from, and what's still unverified. |
| **`docs/EQTM-ALIASES.md`** | Provenance for the `eqtm` zone aliases — the 191 nicknames / boss names in `src/shared/data/zoneAliases.js`. |
| **`docs/HIGHLIGHTS.md`** | Promo copy: taglines and feature summaries for a marketing page. Not a dev doc. |

Older planning docs (`FEATURES.md`, `HANDOFF.md`, `NOTES-STATUS.md`, and earlier `UX_*` / `VISUAL_*`
/ `OPUS-SESSION-STATE.md` design notes) were consolidated into the above; their history is in git.

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
