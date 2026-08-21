# Session state — Opus 5 working on EQLS Auras

Written 2026-08-19 as a continuity record before a context compaction. **Read this first** after
any context loss, before touching anything.

Not part of the app. `package.json`'s `build.files` is `["src/**/*", "package.json"]`, so nothing
at the repo root ships.

---

## 1. Who and where

- **Shara** (she/her) owns and wrote this app. Non-programmer. Tests live in-game. Her GitHub is
  `LoxyBee`; the canonical app repo is `LoxyBee/EQLS-Auras`.
- **Lindsey** is Shara's partner and the person running this session. Also the Director on a
  sibling project (eqlsource.com).
- I am **Session C**, working directly with Shara until **23 August 2026**.
- **Working copy: `C:\Users\Lindsey\EQ tracker`** — this repo. Branch
  **`feat/eql-roster-and-backlog`**, based on `da698b4`.
- The deliverable is this folder, zipped and handed back, easy to pick up.

### Hard rules

- **`PERSONAL COPY DO NOT TOUCH.md` is off limits.** Untracked, never opened, never committed.
  It must stay that way.
- **Do not push anywhere.** No push access to `LoxyBee/EQLS-Auras`; nothing goes there without
  Shara's explicit consent.
- **`C:\Users\Lindsey\EQLS Auras` is a DIFFERENT repo** — Session C's own band material for
  eqlsource.com. Do not mix the two.
- **EverQuest runs live on this machine** (`eqgame`). Running the app is allowed. Driving it with
  synthetic clicks is NOT — one stray automated click already landed in her game window.
- Anything that can only be checked with the client running goes into `TESTING.md`, unchecked and
  marked unverified. Never claim something works that has not been seen working.

---

## 2. Current state

**17 commits ahead of `da698b4`. Working tree clean** apart from the untracked personal file.

```
npm test   ->  8 suites, 62 cases, green
```

| Suite | Cases | Guards |
|---|---|---|
| `test/pin.test.js` | 7 | the userData pin, incl. adding a `require` above it |
| `test/roster.test.js` | 9 | roster shape, capability snapshot, no runtime re-inflation |
| `test/roster-migration.test.js` | 7 | the one-time roster replacement |
| `test/memorized-cap.test.js` | 6 | the fourteen-gem cap |
| `test/focus-game.test.js` | 6 | refocusing EverQuest |
| `test/renderer-wiring.test.js` | 13 | renderer structure, sliders, drag regions, scale, sidebar |
| `test/trade-ping.test.js` | 7 | the trade-request pattern, against real logs |
| `tools/lib/xlsx.test.js` | 7 | the spreadsheet reader |

Baseline update when a roster change is intended: `node test/roster.test.js --update`.

---

## 3. Facts that were expensive to establish — do not re-derive

- **Game data lives at** `C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest Legends`
  (`spells_us.txt`, `spells_us_str.txt`). Both environments have the game installed.
- `spells_us_str.txt` **names its own columns in a header row**: field 3 `CASTEDMETXT` (landed on
  you), field 4 `CASTEDOTHERTXT` (landed on other), field 5 `SPELLGONE` (faded). Calibrated
  against Spirit of the Puma — matched the old roster byte-for-byte on all three.
- `spells_us.txt` positions, verified empirically: 0 id, 1 name, 8 cast ms, 10 recast ms,
  12 duration ticks (×6 = seconds), 36–51 per-class levels (255 = never, bard offset 7), 75 icon.
- **The spreadsheet's Name cells are two rich-text runs**: the real name, then a grey category
  tag. `run[0]` is the name. The tag vocabulary is **det (327), pet (82), port (76)** and an
  EMPTY run for the 378 buffs. Column D only carries det/buff/pet — the 76 `port` spells leave it
  blank, so stripping by column D silently breaks 76 names.
- **The sheet is the definitive EQL spell list.** The client's files carry every EverQuest
  version; this server runs a small subset. That is the whole reason the roster shrank.
- Her real logs are at `C:\Users\Lindsey\Desktop\eqlog_Shara_rivervale_2026-08-19.txt` and
  `C:\Users\Lindsey\Desktop\EQL Source\eqlog_*.txt`. Confirmed present in them:
  `You have entered <Zone>.` (58 zones, with instance suffixes like `Befallen 1 (Awakened)`),
  `<Name> is interested in making a trade.`, and charm/mez lines. **No mez lines exist** in the
  older logs — she plays CLR/BRD/SHM.
- **Detrimentals reuse the ally mechanism.** `" has been mesmerized."` is an ordinary
  `othersLandingSuffix`. The only blocker is `buffEngine.js`'s `/^[A-Za-z]+$/` recipient check,
  which rejects mob names because they contain spaces.
- `loadJson` **silently returns the fallback** on any parse error. A hand-edited settings file
  with a BOM (PowerShell's `-Encoding utf8` writes one) is ignored without a word.

---

## 4. What was built, and the reasoning that must not be lost

### The roster rebuild — the priority fix

`src/shared/data/buffs.json`: **11,337 generic entries → 1,052 real EQL spells**, built by
`tools/build-roster.js` from the spreadsheet plus the game files. Old roster archived at
`archive/buffs-legacy-11337.json` (outside `src/`, never ships, **do not restore**).

Measured against her real 19 Aug session, 28,240 distinct lines:

| | before | after |
|---|---|---|
| auto-confirmed | 19 | **49** |
| recognised at all | 45 | **83** |
| ambiguous (prompts) | 26 | 34 |

The eight extra prompts are lines the old roster did not recognise **at all**, so nothing
regressed.

**Three things here are counter-intuitive and were each learned the hard way:**

1. **Replacing the roster naively would have ended detection.** The spreadsheet ships its four
   text columns empty (0/1052). Landing text is the only signal; without it, every timer silently
   stops. The game files supplied it — 720 spells now have landing text where cross-referencing
   the old roster alone managed 297. Only **five** spells are genuinely undetectable (Calm-line
   spells that print nothing).
2. **Shrinking the roster does NOT reduce ambiguity by itself** — it hides it. 50 landing texts
   became roster-unique, and all 50 are still shared in the client's data. I added a game-wide
   sharing flag for this, then **reverted it** when Shara pointed out those rivals are
   other-expansion spells this server does not run. `landingTextSharedBy` is still recorded on
   entries as evidence but **deliberately not consulted** — see the long note in
   `buffStore._getLandingIndex`.
3. **`backfillBardSongs` would have undone it.** It ran on every launch and would have added
   ~1,499 other-expansion bard songs (1,052 → ~2,551), silently, at runtime. Now not called;
   the module is left intact with an annotated import, and a test fails if it is rewired.

The rebuild also **fixes CLAUDE.md gotcha #15's confirmed live bug**: Armor of Protection was
"mined out of existence", so `"You feel protected."` resolved confidently to the wrong spell. It
is present again and that line now correctly offers two candidates.

**Promised Renewal is 15s with `noDurationScaling`** — Shara verified in game; both the sheet and
the game data say 18s. The correction lives in `tools/roster-overrides.json` so a rebuild cannot
undo it.

**Migration (`eqlRosterV1` in `buffStore.js`)**: replaces rather than merges, because the existing
version-gated pass only ADDS and would have left ~12,000 entries. Keeps custom buffs and
show-on-overlay choices. Writes **nothing** to userData. It also marks the five legacy one-shot
migrations done — they ran *after* it and undid it, and `unmatchedCustomPurgedV1` deleted the
user's hand-made buffs. **The tests caught that within a minute of being written.**

### Everything else landed

| Note | What | Where |
|---|---|---|
| 22 | "Unlock all auras" scoped to the overview page only | `all-auras-card` toggled in select/deselect |
| 32a | Alert volume slider never loaded its saved value | `main-window.js` selectWidget |
| 3 | Memorized gems capped at 14, stalest evicted | `buffEngine.js` `_rememberMemorized` / `_trimMemorized` |
| 29 | Refocus EverQuest after the last ambiguity | `foregroundWatcher.focusGameWindow` |
| 33 | Modals opt out of the drag region (**fix unconfirmed**) | `main-window.css` `.modal-backdrop` |
| 7 | App text size, via Electron zoom | `webPreferences.zoomFactor` + `ui:setScale` |
| 13 | Resizable sidebar | `--sidebar-width`, `initSidebarResize` |
| 36 | Trade request ping — first sound-only alert | `initTradePing` |
| 25/5 | Roadmap placeholders, red danger button | premade list, `btn-danger` |
| — | Share codes now `EQLSAURAS1-` (was `EQBT2-`) | `widgetStore.js` |

**Subtleties that look like simplifications but are not:**

- **UI scale is set at window creation, not after load.** A post-load listener has to be `.once`,
  and `.once` does not re-arm — Ctrl+R silently reset the zoom to 100%.
- **The sidebar has TWO clamps.** The stored preference is clamped only to its own range; the
  displayed width is additionally capped to the window. Collapsing them means launching once in a
  narrow window permanently overwrites a width chosen in a wide one.
- **`_rememberMemorized` deletes before setting.** A Map does not move an existing key to the end
  on re-set, so without it, re-memorising evicts the gem just loaded.
- **The trade ping needs no new IPC** — the settings renderer already receives every log line via
  `log:line` / `onLogLine`.

---

## 5. Open — needs Shara

1. **The 0–200 volume range (note 32b).** The bug half is fixed and probably explains the whole
   report. If she still wants it: an audio element's volume caps at 1.0, so >100% needs Web Audio;
   `createMediaElementSource` reroutes an element **permanently**; and `alertVolume` is persisted
   per aura **and travels in share codes**, so changing what 100 means changes every existing aura.
   My recommendation: leave at 0–100.
2. **Note 33** — does the profile name box fail every time, or only in a small window? If it fails
   maximised, my diagnosis is wrong and the real cause is unfound.
3. Everything in `TESTING.md`'s **NEEDS THE LIVE CLIENT** section is unverified.

---

## 6. Where I am in the plan

`FEATURES.md` holds all 39 raw notes, sorted, with a 13-step build order and twelve groups.

- Steps **1–4 done** (placeholders, small correctness, main-window chrome, alert layer).
- **Next: step 5** — notes **4 + 31 together**, the aura visibility precedence model. They must
  land as one change or they fight over which override wins.
  - The relevant code is `widgetManager.shouldBeOnScreen`, which today puts profile membership
    ABOVE unlock, so an aura toggled off for the current profile cannot be moved. Note 31 wants
    unlock to beat profile membership; note 4 adds a master hide-all that must slot into the same
    precedence.
- Then step 6 (note 8, merged tiles), step 7 (note 23, text-only mode — unblocks four others),
  step 8 (note 35 data), step 9 (note 24, detection rework), and so on.
- **18 of 39 notes are blocked** on a real log line, a decision, or data that does not exist. They
  are listed together in `FEATURES.md` with exactly what is missing.

---

## 7. How I have been working

- Everything simulated that can be; the rest written into `TESTING.md` for Shara.
- Every behavioural change gets a test, and the test gets **mutation-checked** — break the thing
  deliberately, confirm the test fails, restore. A test that cannot fail is worth nothing.
- Commit messages carry the reasoning, especially where the obvious choice was wrong.
- Claims are measured, not asserted. Where something is an assumption it says so — see the zoom
  comment in `main.js`, which was rewritten after review for exactly this.
- Fan out subagents for comprehension and design; write code in one voice.
