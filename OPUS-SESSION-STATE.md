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

**44 commits ahead of `da698b4`. Working tree clean.** `PERSONAL COPY DO NOT TOUCH.md` is now in
`.gitignore` - it was staged once by a careless `git add -A` and amended straight back out, and
the ignore entry is what makes that command safe to type here at all.

```
npm test   ->  18 suites, 234 cases, green
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
| `test/sound-only.test.js` | 21 | sound-only auras, both import routes, sound parity across aura types |
| `test/visibility.test.js` | 14 | the whole on-screen / audible precedence model |
| `test/move-box.test.js` | 9 | the move-box name pill and its drag-region trap |
| `test/merged-tiles.test.js` | 31 | merged tiles: both rules, tile identity, and where merging meets render() |
| `test/text-aura.test.js` | 22 | text auras: the one-tile rule, the words, the dispel announcer |
| `test/category-borders.test.js` | 13 | coloured edges: roster, overlay and stylesheet must agree |
| `test/detection.test.js` | 21 | the detection engine's coverage: tiers, the veto, instants |
| `test/infinite-duration.test.js` | 14 | spells that never run out, and the null-comparison traps |
| `test/buff-timer-premade.test.js` | 11 | the Buff timer premade, and what it refuses to offer |
| `test/spellbook-diagnostic.test.js` | 6 | the spellbook status says what to do, not "it will appear" |
| `tools/lib/xlsx.test.js` | 7 | the spreadsheet reader |

**`test/visibility.test.js` uses a new technique worth knowing about:** it replaces `electron` in
the require cache with a small fake before requiring `widgetManager.js`, which lets the real
manager be driven directly. It proves this app's decision logic and nothing about how a real
BrowserWindow behaves, and the suite says so at the top. Use it again where the decision is dense;
do not use it where the Electron behaviour itself is the thing in question.

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

### Since the compaction — sound-only auras, and the visibility model

**Sound-only auras (asked directly, 20 Aug).** A third `displayMode`, not a fourth `kind`. As a
mode, every filter, buff source, custom timer and sound setting keeps working untouched, any aura
can be switched to it and back losslessly, and the share-code path, profiles and the aura list
needed no new concept. It keeps its overlay window - that window is where the sound comes from,
and `overlay.js` already owns the entire alert pipeline, so the change is one early `return`
placed between the alerts firing and the DOM being built.

**A real bug surfaced by that work: hiding a window never silenced it.** A hidden overlay keeps
receiving engine broadcasts and keeps running `render()`, which is where the alert sounds fire.
Invisible and silent were the same thing until an aura could be nothing but sound. The rule now:
profile membership silences (it is the on/off switch); the screen-clearing rules deliberately do
not, because hearing a buff about to drop while tabbed out is most of the point.

**Visibility precedence (notes 4 + 31 + 6, build order step 5).** `shouldBeOnScreen` now carries
the model at the top of the function - ON/OFF rules versus SCREEN-CLEARING rules - and its clause
order IS the behaviour. Master hide beats unlock, deliberately. Per-aura unlock beats profile-off;
"Unlock all auras" does not. Sound-only is exempt from screen-clearing and never from profile.

**Not obvious, learned the hard way here:**

- `createWidgetWindow` locks every window it creates. The window created BY an unlock is the one
  exception; without the `runtimeLock.has` guard the unlock is overwritten the moment it works.
- A sound-only aura must stay click-through however it is locked, or an unlocked one is an
  invisible rectangle over the game swallowing clicks.
- `applyCodeToSelfBuffs` patches in place via `update()`, which does NOT run `normalizeWidget`.
  It is the one import route that skips the guards, and Self Buffs is the one aura that cannot be
  deleted to escape a bad value.
- A click listener inside a `-webkit-app-region: drag` box never fires. No error, no console
  output. The move-box name must be an explicit no-drag child, and small.
- Matching source text for `drag` also matches `no-drag`. Capture and compare exactly, and strip
  comments first, or the test passes against prose describing the rule.

---

## 5. Open — needs Shara

1. ~~The 0–200 volume range (note 32b).~~ **Closed 20 Aug 2026** — Shara: "keep the volume slider
   as it is, 0-100 is fine." The bug half stays fixed; the re-range is not being built, so
   `alertVolume` still means percent 0–100, no `createMediaElementSource` chain is introduced, and
   no already-minted share code changes meaning.
2. **Note 33** — does the profile name box fail every time, or only in a small window? If it fails
   maximised, my diagnosis is wrong and the real cause is unfound.
3. **Note 4's hotkey** — not built. A `globalShortcut` is swallowed before EverQuest sees it, so
   it has to be a key she never uses in game. Needs her to name one, or to say skip it.
4. **Note 8's two interpretations** — "the player name" on a merged tile (the recipient, or her
   own character?), and "same duration" (the full duration, or landed in the same burst?). Both
   are flagged in the note itself. This is what blocks build order step 6.
5. **Should copying a share code say that a custom sound FILE does not travel?** For a list aura
   that is a cosmetic loss; for a sound-only aura the sound IS the aura.
6. Everything in `TESTING.md`'s **NEEDS THE LIVE CLIENT** section is unverified.

---

## 6. Where I am in the plan

`FEATURES.md` holds all 39 raw notes, sorted, with a 13-step build order and twelve groups.

- Steps **1–8 done**, plus note 37 out of order. Step 5 was notes 4, 31 and 6; step 6 was note 8;
  step 7 was note 23, **redefined by Shara as a text aura TYPE rather than a display style**; step
  8 turned out to be already done inside the roster rebuild, so the work there was correcting
  three notes that still described the old world. Plus the sound-only aura (later moved into the
  custom list beside the text aura), the Pause hotkey and the share-code sound warning.
- **Note 37 was taken out of order and is done.** Its blocker - "the app has NO idea what type any
  spell is" - was removed by the roster rebuild, which dropped it from several days to a few hours.
  Taking it was a deliberate deviation from the build order: step 9 is blocked, and note 37 had
  become the least volatile available item, which is the ordering principle the plan is built on.
- **Next: step 9** (note 24, detection rework) — **blocked** on a real log sample of an ambiguous
  bard-song landing text repeating on the next pulse. BUT three of its four parts do NOT depend on
  that assumption and are described in the note as real changes: a failed tier consuming the line
  so no later tier can rescue it (`buffEngine.js:592-601`), memorized gems being checked before
  /outputfile spells when it should be the other way round (`:653`), and the caster's name being
  captured by the parser and thrown away at `:374`. Those three are the highest-value unblocked
  work left - and the riskiest in the app, since this is the detection engine. Her 28,240-line log
  is the safety net: replay before and after, the way the roster rebuild was validated.
- **The rest of note 23 is a second feature, not a leftover:** text as an *alert option on other
  auras* ("showing text when a timer condition is met, or something is applied, or failed"). It
  reuses the text tile's rendering. The mez/charm premades with icon-plus-text are downstream of
  the detrimental detection work, which is still blocked.
- **Notes 12 and 18 are the rest of the merged-tile cluster and are blocked** on notes 11 and 17
  respectively, both of which are downstream of the detrimental-detection work. The count badge
  note 12 wants is already built and shared.
- **18 of 39 notes are blocked** on a real log line, a decision, or data that does not exist. They
  are listed together in `FEATURES.md` with exactly what is missing.

---

### Merged tiles — what review found, and what it says about the method

The merged-tiles change was written, tested, committed, and THEN reviewed by four agents with
different lenses. The review raised twelve findings that deduplicated to four real defects, three
of which were silent - no error, no console output, just an aura quietly doing the wrong thing:

1. A merged tile is led by whichever member expires first. Recast that one and the lead changes
   while the group does not, so nothing forced a rebuild and the tile kept the old name.
2. `warnedAt` is keyed by the tile; both places that prune it iterate RAW keys, which can never
   equal a merged key. A merged tile warned once and then never again.
3. Turning merging on re-identified every tile, so anything already in the warning window beeped.
4. The count badge painted under the countdown bar and took its colour.

**The lesson worth keeping: a test that re-types a formula proves a copy correct.** The signature
test duplicated the `mergeKey` expression instead of using it, so a mutation adding
`remainingSec` to the real one - which would rebuild every tile once a second - changed nothing
any test could see. Lift the real expression out of the source and run it.

**Do this again.** Both times a fan-out review has run over this session's own work it has found
real defects that the tests, written by the same person who wrote the code, did not.

---

### Text auras — and a design principle worth reusing

Note 23 asked for a third *display style*. Shara redefined it as a *type*: "this might cause
confusion with all the options, and my goal is accessibility over all." So a text aura is chosen
once, at creation, beside Custom buff aura and Custom timer aura, and the Display style radios are
hidden on one. Underneath it is still just `displayMode: 'text'`, reusing everything the
sound-only mode built.

**The principle: where a choice is OFFERED is a separate decision from how it is STORED.** A test
now fails if 'text' ever appears as a fourth radio.

**Worth knowing:** the expensive half of note 23 - "how long does the text stay up" - evaporated.
It is answered by whatever the aura already watches: a buff shows while the buff is up, a trigger
for its own duration, and "until a closing text" is what a custom timer's ended-text already does.
No new lifetime rules in either engine.

**The dispel announcer is real** because the log line was finally found in her own logs:
`You feel very dispelled.` The other two strengths are inference from the third-person forms.
A test reads her actual log and fails if the attested wording stops appearing.

### The indexOf trap — fixed in four places, worth never repeating

Several tests proved an ordering with `a.indexOf(x) < a.indexOf(y)` without first asserting that
`x` exists. **indexOf returns -1 for a missing needle, and -1 is less than any real index** - so
every one of those checks passed most confidently at exactly the moment the guard it protected had
been deleted. A related one matched a *variable name* that also appears inside the block it
guards, so neutering the branch to `if (false)` left it happy.

Assert existence first, and anchor on the thing that does the work rather than a name near it.
Both were found by mutation testing, not by reading.

---

### The roster rebuild paid for itself twice over

Worth knowing before planning anything: the rebuild did not just fix detection. Every entry now
carries `category` (109 values), `scaleCategory` (9), `classes`, `level`, `manaCost`,
`castSec`, `reuseSec` and `targets`. Measured coverage: landing text 720, others-landing suffix
810, ended text 528, reuse 989, category and scaleCategory 1,052 each.

That silently unblocked note 37 (built) and is the foundation notes 13-style rank scaling and the
premade builders were waiting on. **Before sizing anything that says "the app has no idea what
type a spell is", check the roster - that sentence is out of date.**

### The at-a-glance table now has a Status column

It used to say only whether a note was blocked, which meant a table summarising all 39 said
nothing about the ones that were finished. It now reads: **17 done, 1 fix-unconfirmed, 12
blocked.** Each "done" was verified against the source or the commit that landed it.

---

### Step 9, the detection rework — read this before touching buffEngine

**`tools/replay-log.js` is the safety net and it is not optional.** It replays the owner's real
logs through the real engine and records what was detected. Capture before, change, capture after,
diff. Nothing about detection should be claimed without it.

**It lied to me once, and the way it lied is the lesson.** It counted calls to `_land` rather than
actual landings, so a change that made `_land` decline still showed "no regressions". Corrected, the
same change showed **157**. If you extend the harness, measure OUTCOMES, never attempts.

**A default capture is also blind to two whole tiers**, and this is not the harness's fault - it is
the owner's real situation. She has no spellbook file, so `selfCandidates` is empty on every line
and the spellbook tiers never fire. `--spellbook <path>` replays with one; build a stand-in from
her cast lines if needed.

**What was decided, with the evidence:**

- **Part C — built.** `recentOtherCasts` is a Map so the log can name the caster. Proved neutral:
  every total identical across 1.6M lines, one debug row renamed. **Never widen the KEY** to
  caster+spell - six gates read it, and the same spell cast by two people would stop matching.
- **Part B — declined.** Its premise ("a loadout swap never says you un-memorised anything") is
  false here: 1,816 `You forget X.` lines, all acted on. The literal reorder also loses
  auto-resolutions, because the spellbook block QUEUES when it narrows to more than one.
- **Part A — not buildable as written.** And a general rule fell out of it: **do not convert
  `return` to fall-through in `handleLine`.** Every consume site calls `_checkForEndedBuffs`
  first, that deletes one active buff per call, and ~90 ended-texts are shared between buffs - so a
  line reaching it twice removes two live timers.

### THE BIGGEST LESSON OF THE SESSION: I measured a signal and inferred its cause

On part B I found 1,816 `You forget X.` lines in the logs and concluded that loadout swaps
announce themselves, so the gem list could not go stale — and argued against the change Shara had
asked for. **She was right and I was wrong.** Those lines are what a MANUAL un-memorise prints. A
full EQ Legends loadout swap prints nothing at all.

The evidence was real; the inference from it was not. 1,816 forget lines are perfectly consistent
with "swaps are silent and she un-memorises by hand a lot", and I never considered that reading
before telling her her own premise was factually wrong.

**She has the game. I have the file.** When those two disagree about what the game does, the file
is evidence about the file.

### The three no-duration cases, now settled

A roster entry with no duration turned out to mean three different things, and treating them alike
is what produced the NaN tile:

1. **Infinite** — Yaulp, Fury. Marked in `tools/roster-overrides.json`, no countdown, never swept.
2. **Instant** — nukes, heals, gates. Lands so sound and text auras can react; the OVERLAY keeps it
   off any aura that draws countdowns. Short display life, never NaN.
3. **Genuinely unknown** — none left in practice; anything not marked infinite is treated as an
   instant.

**`null <= 30` is true in JavaScript**, and `remainingSec` is null for cases 1 and 2. That single
fact broke four separate places: the low-time colour, the pre-expiry warning sound, the sort order,
and the ally sweep. Expect it anywhere a number is optional.

### Two live defects, both measured, both awaiting Shara

1. **The spellbook file has never existed.** 14,650 landings discarded and ~11,000 more turned into
   prompts across her logs, purely for want of it. The UI now says so instead of promising it will
   appear on its own. **Needs: the exact in-game command, to name it in the hint.**
2. ~~275 roster entries have a landing text and no duration → NaN expiry.~~ **FIXED** — see the
   three cases above. What is left is small: Frenzy and Rage look like Fury and are listed as
   candidates in the overrides file rather than marked, and the six-second display life for an
   instant is an invented number worth arguing with.

---

### THE ROSTER REBUILD KEEPS UNBLOCKING THINGS - check before believing any "blocked"

This has now happened three times, and it will happen again. A note written before the rebuild
says something is impossible; the rebuild quietly made it possible; nobody connected the two.

- **Note 37** (coloured borders) said "the app has NO idea what type any spell is". Every entry
  now carries `category` and `scaleCategory`. Several days -> a few hours. **Built.**
- **Note 35** (the roster itself) was marked blocked on the spreadsheet's empty text columns. The
  game's own files had them. **Done, and it was the priority fix.**
- **Note 15** (cooldown premade) is marked blocked on "per-spell recast seconds do not exist
  anywhere in this project". **989 of 1,052 entries now carry `reuseSec`**, mined from the game
  data with the field position verified the way the note demands. Distribution is credible: median
  1.5s, which is the global recovery floor, with 199 spells in the 10-60s band. It needs Shara to
  confirm one or two against the real client before a countdown is built on it, and then it is
  buildable.

**Before sizing anything that says a spell property is unavailable, look at a roster entry.** They
now carry: category, scaleCategory, classes, level, manaCost, castSec, reuseSec, targets, iconId,
landingText, othersLandingSuffix, endedText, durationSec, infiniteDuration.

### The premade list can now ask a question

Note 14 made `PREMADE_WIDGETS` understand `panel` as well as `create`. Notes 15, 16 and 34 are
the same shape - pick one spell, answer one question - and should reuse the buff-timer panel
rather than each growing their own picker. That was note 14's own advice and it is worth keeping.

---

## 7. How I have been working

- Everything simulated that can be; the rest written into `TESTING.md` for Shara.
- Every behavioural change gets a test, and the test gets **mutation-checked** — break the thing
  deliberately, confirm the test fails, restore. A test that cannot fail is worth nothing.
- Commit messages carry the reasoning, especially where the obvious choice was wrong.
- Claims are measured, not asserted. Where something is an assumption it says so — see the zoom
  comment in `main.js`, which was rewritten after review for exactly this.
- Fan out subagents for comprehension and design; write code in one voice.

---

## 8. Continuity: 21-23 August (written before a context compaction)

**State: 76 commits ahead of `da698b4`, 30 suites / 451 cases green, tree clean.**
`npm test` passes. `node tools/smoke-launch.js` starts the real app clean. `npm run dist` builds.

### The standing rules, restated because they are easy to lose

- `PERSONAL COPY DO NOT TOUCH.md` is off limits. It is in `.gitignore`; never open it.
- EverQuest runs on this machine. Launching the app is allowed; **driving it with synthetic
  clicks is not** — a stray click once landed in the game window.
- Push to `samusmylove47-maker/EQLSAuras` (the Director exchange) is granted. **`LoxyBee/EQLS-Auras`
  is read-only** — never push the app repo.
- Commit as `Claude (Opus 5) <noreply@anthropic.com>` via `-c user.name=... -c user.email=...`.
- "If any functionality is lost during this process that is to be considered a failure."

### Notes closed since section 7

15 (cooldown premade), 16, 17 (RESIST flash), 21 (loadout label, as a global setting), 26
(overwrites), 27 (Buffs shown card + gem slots), 38 (zone gating), 10 (duration→cooldown), 12 and
18 (counting mobs that share a name). Note 2 is **SKIPPED** at her instruction.

`NOTES-STATUS.md` is the live record — 28 DONE, 10 PART, 1 NOT, 3 BLOCKED, 2 SKIPPED.

### The two things still to build, and her answers in full

**A. The loadout-profile modal (her answer 4, 23 Aug).** Not started.
> "when you make a second loadout, it should turn on the display, but the toggle to turn it off
> should be on the same menu that the create extra profile is on, if this means a modal, then make
> one. probably the "add" and "settings" buttons on the profile bar can become one button that
> opens a modal to add, delete, and change profile options."

So: merge `#profile-add-btn` and `#profile-manage-btn` (`index.html`, profile bar) into one button
opening a modal that adds, deletes and configures profiles; move the loadout-label toggle
(currently on the Overlay Auras page, `#loadout-label-checkbox`) into it; and auto-enable the label
the first time a second profile is created — version-gated so it happens once and does not come
back after she turns it off.

**B. All-of triggers (note 9, her answer 1, 23 Aug).** Not started. Two answers now in:
> "nothing shown when half is done, only show when both are active. if one is active, it should be
> invisible to the player until the other happens."
> "the time window should be whatever each individual trigger has. this kind of functionality will
> primarily be used for 'if in this zone (no duration check), and this thing happens', so limiting
> it to checks happen within a set time frame is not something i want."

**This changes the model and the change matters.** There is no global AND-window. Each PART of the
condition is satisfied for its own duration after it fires, and a part with no duration — a zone
check — stays satisfied until it stops being true. The timer runs while **all** parts are
simultaneously satisfied, and shows nothing at all until then. That is a state intersection, not
an event-pair with a timeout, and it is why the zone example is the primary use case.

### What is blocking each PART note (she asked for this on return)

- **9** — see B above; half of it (any-of) already works by giving two timers the same name.
- **11** — duration still comes from the roster, not from the rank in the cast line.
- **19, 20** — placeholders only. 20 needs zone-connectivity data that exists nowhere.
- **21** — auto-enable, which is part of A above.
- **23, 24, 32, 33, 34** — each has one named gap in `NOTES-STATUS.md`; 33 needs her to confirm a
  fix that was never reproduced.
- **26** — done for others' buffs and for self buffs; nothing outstanding that is not research.

### Hard-won facts that must not be relearned

- **`globalShortcut.register('Pause')` THROWS in Electron.** It is not a valid accelerator. The
  hide-auras hotkey is `ScrollLock`, falling back to `Alt+Shift+H`, each inside a `try`.
- **No unit test starts Electron.** `tools/smoke-launch.js` exists because of that; run it after
  any change to `main.js`, a preload, or window creation.
- **Testing a rule by reproducing it in the test file has failed four times** — every copy passed
  while the real rule was inverted. `src/shared/zoneVisibility.js` exists so the test can import
  the real function. Prefer that; where impossible, add a source-level assertion as well.
- **A value crossing four layers where one enumerates fields is this codebase's commonest defect.**
  `cooldownSec`, `triggerMatch` and `castOf` each shipped correct-but-unreachable. Always add an
  end-to-end test naming every layer.
- **The logs are CRLF.** `logWatcher` and `tools/replay-log.js` split on `/\r?\n/` and are fine; an
  ad-hoc script that splits on `\n` silently finds nothing with a `$`-anchored pattern.
- **Anchor any pattern that reads a game line on the timestamp.** A player typed
  "You have entered Everfrost." into General chat; unanchored, that relocates the app.
- **The detection log is `%APPDATA%/EQ Buff Tracker/detection-logs/detection-YYYY-MM-DD.log`.**
  It was previously a loose file nobody could find, which blocked note 28 for days.
- Measure detection changes with `node tools/replay-log.js --out X.json` then `--diff before after`.
  Baseline with nothing opted in: **129 buffs, 211,546 landings, 840 ally landings, 27 prompts,
  91 unknown texts.** Any drop in the first number is a regression until proven otherwise.

*Session C, 2026-08-23.*
