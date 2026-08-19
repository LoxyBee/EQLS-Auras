# Session Handoff — 2026-08-18

## Read these first, in this order

1. **`CLAUDE.md`** — the durable source of truth. Project conventions, architecture, and 19 hard-won detection gotchas. The backlog at the bottom is prioritised.
2. **`TESTING.md`** — everything built but **not yet confirmed in real gameplay**. This is large right now. Nothing in it counts as done until seen working in-game.
3. **`FEATURES.md`** — wanted but not built. New capability only; bugs and architecture live in `CLAUDE.md`.
4. This file — what happened in the last session and what state it left things in.

## Status: dev build only

Everything is in `npm start` (dev build). **`npm run dist` has NOT been run since a large amount of new code landed** — three new main-process modules exist that have never been packaged (`gameSpellData.js`, `rosterBackfill.js`, `sessionSnapshot.js`, plus `bardSongTagger.js`). Verifying the packaged build is a genuine outstanding risk, not a formality.

Standing user preference: keep them on the dev build between sessions.

---

## THE TWO THINGS THAT ACTUALLY MATTER

Everything else in this file is detail. These two are the substance.

### 1. The detection engine is architecturally wrong (P0 in CLAUDE.md)

`buffEngine.js`'s `handleLine()` is a chain of tiers, each ending in `return`. When a tier matches on *text* but fails a *confidence* sub-check, it still returns — so the line is consumed and every later tier that might have resolved it correctly never runs. The user diagnosed this themselves: *"every check if not passed, should continue, not end the check."*

This has now produced misdetections from four separate directions. Several point fixes have been applied around it (burst-context memorized exemption, heal-proc auto-resolve, ally burst path) and **those may become redundant or need folding into the rework** — don't treat them as settled design.

**Nothing else on the backlog matters as much.** This is the app's actual job.

### 2. The roster is missing ~37,000 spells, and that silently corrupts detection

The original mining kept only spells with a duration field `> 0`. That dropped real, castable buffs — and a missing entry doesn't just hide a buff, it makes some *other* spell's shared landing text look **unique**, which promotes a guess into the highest-confidence auto-confirm tier.

Measured: **351 landing texts appear unique to the app but are shared in the game's own data.**

Half-fixed: `rosterBackfill.js` restored 1,083 bard songs (roster 11,337 → 12,420). The non-song half is **still open** — including `Armor of Protection`, which is why a "You feel protected." prompt once offered four candidates none of which was the right answer.

There's a cheaper interim option written up in `CLAUDE.md`: build a shared-text veto index from raw game data and use it *only* to block the unique-text auto-confirm. No roster changes, no duration questions, kills the false-confidence problem on its own.

---

## What landed this session

### Detection / correctness
- **Ally-buff tracking now works at all.** It had never fired once — the tier was gated on `recentSelfCast` (set only by a named cast line, which Quick Buff never produces) and on the recipient being a known group member (only learned from join/leave lines seen live). Both gates removed/bypassed; the recipient's name now comes from the landing line itself. Gotchas #17, #18.
- **Quick-Buff bursts no longer ignore already-active buffs** — inside a burst window the not-memorized exclusion is skipped.
- **Heal-proc auto-resolve** — `"You healed X for N hit points by <Spell>"` names the answer outright and resolves a queued ambiguous cast.
- **Rank collapsing** — a landing text shared only by ranks of one spell resolves silently to the lowest rank instead of prompting. Genuinely different spells still prompt.
- **Bard songs**: tagged from game data (1 → 1,430 tagged), backfilled into the roster, opt-in and off by default, prompts suppressed when no aura shows them.
- **Per-buff "No AA scaling"** flag — some spells carry a fixed duration the duration-extension AAs never touch. Promised Renewal is set to 12s + excluded.

### Behaviour / state
- **Session restore** — live timers survive a restart within a 5-minute grace window. Gotcha #19.
- **Memorized gems persist** across restarts, shown as a 14-slot gem bar on the landing page, click a gem to forget.
- **Profile-gated aura visibility** — `activeProfileIds` is now the on/off control; the global "Show this aura" toggle is gone. Unticking every profile hides the aura.
- **Auto-hide split into two settings**, the second (show while this app is focused) off by default. Unlocked auras are never auto-hidden.
- **Shutdown instrumentation** — the app was seen exiting unprompted with no crash dump and no way to tell which of three quit paths fired. All are now logged.

### UI
Custom timer form is a modal with a data-driven trigger picker; ally buffs can group by player with headings (alphabetical, horizontal or vertical); window size/position persists; colour pickers and margin width wired up; overlay master controls consolidated onto the Overlay Auras page.

---

## Open questions needing the user, not code

- **Inferno Shield duration.** App shows ~24m; measured from the log it's 16–17½m against a 900s base. The user has confirmed this is **NOT** the AA-scaling exclusion — it's a separate problem, still undiagnosed.
- **The non-song roster gap** — needs a decision on approach (re-mine vs veto index) before anyone builds it.
- **`Promised Renewal XII`** was left at 18s. It has different landing text from the base spell, so it's a genuinely distinct spell whose real duration hasn't been measured.
- **Bundled roster is stale.** All roster fixes are in the user's local data only. A fresh install still gets the broken roster; the bard half self-heals on launch, the rest doesn't.

---

## Working practices that have earned their place

- **Measure, don't guess.** The user's real log and `spells_us.txt` have settled more questions this session than reasoning did — including catching two cases where a plausible-sounding theory was simply wrong. Field positions in the spell data were established by scanning every field against known values, not from docs.
- **Isolated Node scripts** (mock `store`, real `BuffStore`/`BuffEngine`) before touching the live app. Caught real regressions.
- **Watch out for tests that pass for the wrong reason.** One session-restore test "passed" while not actually exercising the thing it claimed to; it was only caught by checking the expected number appeared.
- **Verify markup structurally** (duplicate ids, div balance, dangling `getElementById`, renderer→preload API) before every restart that touches HTML. This caught several breakages pre-flight.
- **Do not use offset-based string slicing to edit HTML.** It silently deleted an unrelated modal this session. Use targeted edits.
- **Beware bash eating backticks** in `python -c` heredocs — it stripped code references out of docs twice and produced an empty `debugLog()` call once.
- Restart discipline: `taskkill //F //IM electron.exe //T` then `npm start`; `node --check` every touched file.
