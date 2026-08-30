# EQLS Auras

Electron desktop app that tails an EverQuest log file in real time and shows a transparent, click-through overlay with countdown timers for the player's active buffs. Formerly "EQ Buff Tracker" - renamed to EQLS Auras as a step toward an eventual "EQLsource" branded app (not there yet). The userData folder deliberately still lives at the old `EQ Buff Tracker` path (see `main.js`'s `app.setPath('userData', ...)` pin) so the rename never disturbs anyone's actual saved data - if this gets renamed again later, that pin should stay put rather than being updated to match, unless a real data migration is being done deliberately. Built for a user with no coding experience — explain setup/testing steps in plain terms, and prefer small verifiable steps over big untested changes (this project has a real history of subtle detection bugs that only showed up under live testing).

**Terminology split, deliberate, don't "fix":** every user-visible string calls these overlay windows "auras" (page titles, button labels, dialogs, etc.), but the entire codebase underneath still calls them "widgets" - file names (`widgetStore.js`, `widgetManager.js`), variable/function names, IPC channel names (`widget:create` etc.), and the field names inside the persisted `widgets.json` are all still "widget." This was an explicit, scoped user decision (offered three options: UI-text-only / UI-text-plus-code-identifiers / full-rename-including-saved-data - UI-text-only was chosen specifically to keep zero risk to existing saved data). Don't rename the internal stuff to match without checking with the user first.

Server context: the user plays **"EverQuest Legends"**, a custom/private EQ server (not live EQ, not a standard emulator ruleset) via a Daybreak launcher install. Log/spell-data formats matched the classic EQEmu-style schema closely enough to mine directly, but some values (durations, spell availability) may differ from live EQ. This server also has a **multiclass "loadout" mechanic**: the player can swap loadouts, which changes which spells are actually castable *without* touching the spellbook file — but it does generate a real burst of `"You forget X."`/`"You have finished memorizing Y."` lines (confirmed: ~14 events in ~15s for one observed swap). See gotcha #9 below — this is why loadout profiles (`profileStore.js`) exist.

## Docs are written by a dedicated "Documentation" session — don't write them yourself

Applies to a **new feature** or a **major edit** (a new subsystem, a behaviour change users will
notice, a design decision worth recording, anything that needs a `docs/TESTING.md` checklist).
That session writes the CODE (and its code comments) only; the documentation it implies — anything
under `docs/` (including `docs/TESTING.md`, `docs/QOL-BACKLOG.md`, `docs/HIGHLIGHTS.md`) and any
substantial new `CLAUDE.md` section — is handed to a separate session named **"Documentation"**,
not written inline.

**Does NOT apply to routine bug fixes, small refactors, or tweaks** — no message needed, just fix
it. Only send Documentation something when the change is big enough that you'd otherwise be writing
a docs update or a new CLAUDE.md note for it. When in doubt, a fix is small.

- **Before you start**, check `ListAgents` for a live session whose name contains "Documentation".
  If one is running, `SendMessage` it what you're about to build and which files you'll touch.
- **When you finish** (or hit a doc-worthy milestone), send it the facts to write up: what
  changed, why, reviewer notes, `docs/TESTING.md` checklist items, `docs/QOL-BACKLOG.md` entries
  to add or mark done, and any new `CLAUDE.md` section that's needed.
- **If no Documentation session is running**, tell the user, keep coding, and collect the pending
  doc items in a list to hand off later. Do **not** start writing `docs/` or `QOL-BACKLOG.md`
  yourself to fill the gap.
- **Still do inline**: fixing a stale doc reference, a typo, a one-line note, and all code
  comments. The handoff is for new sections, checklists, backlog status changes, and design
  write-ups.
- A one-off `/create-pr` PR body is fine to write yourself — that's not project docs.

## User's stated goals & priorities (read this before changing detection behavior)

- **Self-buffs are the default and priority.** Tracking buffs cast by *others* on the player is opt-in, off by default, and explicitly deferred to live in the future multi-widget overlay system rather than the main window.
- **Ally-buff tracking** (buffs the player casts *on other people*) is confirmed **core/planned functionality**, but explicitly "build when convenient" — not blocking other work. Likely reuses the third-person landing-message infrastructure (see "Infusion of Spirit" gotcha below).
- **Completeness over perfect naming** for instant multi-buff abilities (e.g. "Quick Buff" granting ~14 buffs at once with no per-buff cast line). The user explicitly said a possibly-mislabeled buff showing up beats a real buff being silently dropped — this is why the burst-window/ambiguous-fallback logic exists and is intentionally permissive in that one context.
- **Rank suffixes ("Rk. II/III", trailing Roman numerals) are not part of a spell's real name** for matching purposes — but see the important nuance below: this is *not* universally true and blindly stripping broke things once already.
- The user wants to eventually **package and hand this app to other people** — it now builds a real Windows installer (see Packaging section). Keep `npm run dist` working.
- Collaboration style: the user tests live in-game and reports exact symptoms/screenshots. When something breaks, they want it *actually* root-caused (see the "duplicate instance" and "packaged build" debugging episodes) — not a guessed fix. Prefer adding temporary file-based debug logging (packaged Windows GUI apps have no visible console) over guessing, then removing it once confirmed.

## Architecture

- `src/main/main.js` — entry point, wires everything together, all `ipcMain` handlers.
- `src/main/logWatcher.js` — tails the newest `eqlog_*.txt` in the Logs folder, polls every 200ms, never replays history. `resyncOffset()` re-anchors it past a kept tail after a trim so nothing is re-emitted.
- `src/main/logSplitter.js` — continuously copies the log into per-day (and optionally per-session-gap) files; also has manual "Archive log" (copy + truncate) support in `logService.js`. A re-split from offset 0 **dedupes against the day file's own tail** so lines are not doubled.
- `src/main/logRotation.js` — the weekly log rotation, **ON by default** (see "Lockouts and log rotation" below). `trimAtBoundary()` is the manual "Trim log to this week" (backward EOF scan via `findWeekStartOffset`); `logHoldsCurrentWeek()` feeds the archive-now danger warning; it refuses to rotate a log with play after the reset (`skippedSpansBoundary`).
- `src/main/lockoutCore.js` — pure raid-lockout parser (no `require`, no clock, no fs; lines + explicit `now` in, JSON-clonable state out). EQL prints **no lockout line**, so it keys off the weekly-task assignment lines around a boss kill. **No reset day is hardcoded** — `projectReset()` returns `provenance: 'not recorded'` until it has seen the same weekly assigned on both sides of a turnover. Provenance for every fact it relies on is in `docs/EVIDENCE.md` — read that before touching it.
- `src/main/lockoutService.js` — wires `lockoutCore` to the app: backfill reads **only the live log** (was a whole-Logs-folder scan), plus `setLogTarget` ("Change log file"), `addLogs` ("Add split files", gap-gated), single-flight `rebuild()`, and `extraLogs` count.
- `src/shared/easternReset.js` — resolves the weekly reset in `America/New_York`, DST-aware, `now` passed in. Consumed by `lockoutService` and `logRotation`. The reset day/hour is user-editable (store key `lockoutReset`, IPC `lockoutReset:get/set`, mirrored between the Lockouts page and Setup as one setting); default **Tuesday 11:00 US Eastern**.
- `src/main/buffParser.js` — pure regex/text helpers: cast-begin ("casting" **and** "singing" — bard songs use a different verb), AA "activate" lines, failure messages, party join/leave messages, generic landing-text heuristics, and `stripRankSuffix`.
- `src/main/buffStore.js` — buff database (`{name, durationSec, landingText, endedText, iconId, showOnOverlay}`). **The install (`src/shared/data/buffs.json`) is the source of truth for spell data, rebuilt fresh on every launch, not a version-gated one-time migration** — see gotcha #29. Only three things persist in userData across that rebuild: a fully custom entry (`custom: true`), a spell the user hand-corrected via Known Buffs' Save button (`edited: true`), and three small per-spell toggles with no install-side value (`showOnOverlay`; `isBardSong` once `isBardSongUserSet`; `noDurationScaling` once `noDurationScalingUserSet`).
- `src/main/buffEngine.js` — the actual detection state machine. **Read the big comment block at the top of this file before touching detection logic** — it documents the full priority order (named cast > unique landing text > spellbook-narrowed ambiguous text > burst-window ambiguous text > opt-in others'-buff prompt) and why each layer exists.
- `src/main/profileStore.js` — named loadout profiles (see gotcha #9), one active at a time; `buffEngine.js` keeps a separate self-cast ambiguous-resolution memory per profile, switched via the chip bar at the top of the main window.
- `src/main/gameSpellData.js` — the single shared parse of the game's own `spells_us.txt`, lazily loaded and cached per install root. Exists because several features need facts about spells the app's roster deliberately *doesn't* contain (nukes, heals, anything the mining filter dropped): currently which spells are bard-only, and icon art for any spell by name. **Field positions were all established empirically against the user's real file, not assumed from EQEmu docs** — name is field 1, the 16 per-class levels are 36–51 (255 = never castable, Bard at offset 7), and the icon id is **field 75** (verified by scanning every field against the roster's own `iconId` across 40 sampled buffs: field 75 matched 40/40, no other field matched more than 2). If a future change needs another field, verify it the same way rather than trusting a schema doc — this server is a custom ruleset.
- `src/main/bardSongTagger.js` — flags every bard-only spell in the roster as `isBardSong`, using `gameSpellData.js`. See gotcha #14 for why this exists and why it's additive-only.
- `src/main/rosterBackfill.js` — adds bard songs the original mining filter dropped (it kept only spells with a duration >0, which excluded 386 real songs outright). Runs before the tagger on every launch, idempotent, never overwrites an existing entry. See gotcha #15.
- `src/main/damageEngine.js` — the damage meter (note 19). Reads damage lines, decides which are *outgoing*, and emits one row per attacker for the current fight. **Direction is derived, never guessed from name shape** — you are on your own side, anything you damage is an enemy, anyone damaging a known enemy is a friend, anyone damaging a known friend is an enemy. That bidirectional bootstrap took credited damage from 22% to 65% of a real log day. See gotcha #20.
- `src/shared/damageLines.js` — the five damage wordings, each carrying the count it matched across 1,521,971 lines. Split out of the engine so tests exercise the real patterns. See gotcha #21 for the possessive trap.
- `src/shared/data/zoneGraph.js` — 104 zones, their connections (`land`/`boat`/`portal`) and 61 travel spells, for note 20. Sourced EQL-specific and cross-checked against three others; **38 display names are inferred and flagged `nameConfidence: 'inferred'`** because the player has never entered those zones. Generated once from research; nothing regenerates it, so edits belong in the file. **Some zones are one-way sinks** — The Hole (enter via Paineel; Erudin/Neriak pads inside are exit-only, QOL #32) and Plane of Hate (enter via Oasis of Marr; leave by Gate/Origin, so its outbound `connections` are empty, QOL #43). Same shape as the instance-tier exclusion in gotcha #23. Provenance for the tricky edges is in the caveat comment at the bottom of the file.
- `src/shared/data/zoneAliases.js` — 191 curated community nicknames / raid-boss names for zones (from `docs/EQTM-ALIASES.md` §6) plus an auto-indexed client short-name (QOL #30). `searchPickableZones()` unions substring + alias + short-name matches (exact-or-prefix, 2-char floor); `travel:searchZones` IPC feeds the `zone-prompt` renderer. Aliases are matched but deliberately **not listed** in real-zone results (QOL #31's rule).
- `src/shared/zoneRouting.js` — breadth-first routing over that graph, plus `resolveDestinationName` for note 20's `/tell` command. **Breadth-first and not Dijkstra on purpose**: weighting a boat against a zone line would be inventing numbers nothing measures. See gotcha #22.
- `src/shared/travelCommand.js` — recognises the game's `"<Name> is not online at this time."` reply to a failed `/tell`, which is how the travel guide's destination is set from inside the game. See gotcha #23.
- `src/shared/shareCodeChat.js` — spots an aura share code pasted into chat (note 30). **Recognises and never applies**; see gotcha #24.
- `src/shared/zoneVisibility.js` — the one zone-visibility rule, extracted so tests import it rather than reproducing it. It exists because a reproduced copy passed four times while the real rule was inverted.
- `src/main/sessionSnapshot.js` — persists live timer state (self buffs, ally buffs, custom timers) so a restart does not wipe everything currently running. Restores only within a 5-minute grace window. See gotcha #19.
- `src/main/foregroundWatcher.js` — polls (every 2s, inline PowerShell/P-Invoke, no native module) which of EQ / this app owns the foreground window, emitting `{ eqFocused, ownAppFocused }`. Two separate auto-hide settings key off those independently — see gotcha #10.
- `src/main/spellbookService.js` — auto-detects and parses the character's `<CharName>-<Class>-Spellbook.txt` file (found in the EQ install root, not Logs) to know exactly which spells the player has scribed; this is the primary disambiguation signal for self-buffs. A manual **character/server override** (`setCharacterOverride()` / `_effectiveBaseName()`, store key `spellbookCharacter`, IPC `spellbook:getCharacter/setCharacter`, QOL #14) beats the log-derived name when set — for when auto-detection picks the wrong log or none. `getExpectation()` reports `manualCharacter`.
- `src/main/iconExtractor.js` / `iconService.js` — reads real spell icon art directly from the user's own EQ install (`Textures/Alternate N/SpellsNN.tga`, hand-rolled TGA reader + PNG encoder, no deps), served to renderers via a custom `eqicon://` protocol, cached in userData. Icon set (Alternate 1/2/3) is user-selectable since they're genuinely different art styles.
- `src/main/overlayWindow.js` — the actual transparent/click-through always-on-top overlay (currently a single window, not yet the multi-widget system).
- `src/main/foregroundWatcher.js` — polls (every 2s, via an inline PowerShell/P-Invoke snippet, no native npm module) whether `eqgame.exe` is the OS foreground window; `widgetManager.setForegroundHidden()` hides/shows enabled widgets accordingly. On by default (Setup page checkbox to turn it off) - see gotcha #10 for why process name, not window title, is the match target.
- `src/main/soundService.js` — custom alert sounds. Mirrors `iconService.js`'s pattern exactly (same reason: a sandboxed renderer can't load an arbitrary local file path directly) - a native file picker copies the chosen audio file into `userData/customSounds/` under a fresh id, served back to renderers via a registered `eqsound://` protocol. Each widget has three independent slots (`landSoundId`/`expireSoundId`/`warningSoundId`, one per alert type, not one shared sound) - `null` means the original synthesized beep in `overlay.js`. **A picked sound is still saved under `userData` on purpose** - see the userData-in-install-folder decision below. **`bundledSoundsDir()` (25 Aug)** is a separate, real folder shipped INSIDE the install itself (`sounds/` next to the .exe, via `package.json`'s `extraFiles` - not packed into `app.asar`, which is one opaque file nothing can browse or write into), seeded with a handful of synthesized starter sounds (`tools/generate-bundled-sounds.js` - hand-rolled tones, no external audio, nothing to license). It's the picker's default folder once nothing's remembered yet, ahead of `C:\Windows\Media` - so "Choose sound..." opens there showing the starters, and dropping a file into that folder via Explorer makes it show up the same way. Resolves differently packaged vs dev (`app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()` - packaged, `getAppPath()` points inside `app.asar`, which `extraFiles` content is never placed in). **Update (30 Aug, QOL #39): the browse/drop folder is now `userData/sounds/`**, seeded on startup from `bundledSoundsDir()` by `seedStarterSounds()` (idempotent — never overwrites a file already there, never touches user files); `defaultPickerDir()` prefers it. The install `sounds/` is purely the seed source now, so the whole sound library lives with auras/profiles under `userData` and travels with a backup/export.
  - **`soundCooldownSec` (per-aura, QOL #45)** — a 0–60s floor on the gap between any two alert sounds from one aura, across all three slots. Clamped by `widgetStore.clampSoundCooldownSec` (a **module export**, not an instance method — calling it on the store instance throws and silently eats the whole `update()`; that was a real bug). In `SHAREABLE_FIELDS` + `normalizeWidget`. This is the owner's replacement for the never-built looping-sound aura (QOL #15).
- `src/main/configTransfer.js` — portable config export/import (QOL #3c). `exportConfig()` writes `userData/exports/eqls-config-<stamp>/` with every portable `.json` + `customSounds/` + `sounds/`, **minus a ~14-entry machine-specific deny-list** — window bounds, live gem/zone state, the EQ folder path, `splitProgress`: anything that must NOT travel between installs. `importConfig()` takes a `pre-import-<stamp>` safety backup under `backups/`, swaps the files in, and restarts. `listImportable()` offers both export bundles and backup folders. Separate from `app:backupConfig` (QOL #3b), which just snapshots the whole `userData` (skipping `Cache`/`detection-logs`/`backups`) into `backups/backup-<stamp>/`.

**Considered and reversed the same session: moving ALL saved data (buffs, widgets, custom sounds, settings, logs) from `userData` into the install folder too.** Asked for directly, and the reason it didn't ship: Windows' NSIS uninstaller deletes the entire install directory, so anything stored there would be permanently lost on uninstall/reinstall - today, uninstalling leaves `userData` (and everything in it) untouched. Once that tradeoff was named, the owner's own words: *"do not do this for saved user data... appdata is fine then. but i would still like a standalone sounds bundle to ship with the app."* The bundled-sounds folder above is unaffected by this reversal because losing a SEED file on uninstall costs nothing - it ships again with the next install - which is exactly the distinction that makes the install folder safe for that one thing and not for anything the user actually tunes.
- `src/renderer/main-window/` — the normal app window (multi-page: Buff Tracker, Known Buffs, Overlay, Log & Setup).
- `src/renderer/overlay/` — the game overlay renderer (list or icon-grid display mode).
- `src/shared/data/buffs.json` — the starter roster: **1,052 entries, the spells EQ Legends actually has**. No longer mined. Built by `tools/build-roster.js` from `new spell roster to be added.xlsx` (the curated EQL list — authoritative for what exists and for durations) enriched from the game's own `spells_us.txt`/`spells_us_str.txt` (authoritative for TEXT, since detection is exact-string matching). Rebuild with `node tools/build-roster.js --write`; run it with no flag first for a report. Manual corrections live in `tools/roster-overrides.json` so a rebuild cannot silently undo them. The previous 11,337-entry mined roster is kept at `archive/buffs-legacy-11337.json` — outside `src/` so it never ships — for reference only; **do not restore it**, add the missing spell to the spreadsheet instead.
  - **Why smaller is the point.** "Is this landing line unique?" is judged by counting roster entries, so every spell this server does not have still voted on ambiguity. Measured against a real session: recognised landing lines went 45 → 83 and auto-confirmed 19 → 49. Gotcha #15's confirmed live bug is fixed by it — Armor of Protection is back, and `"You feel protected."` now correctly offers it as a candidate.
  - **`rosterBackfill.js` is no longer wired in.** It undid a mining mistake that no longer exists; run against the new roster it would re-read the client file and add ~1,499 other-expansion bard songs, taking 1,052 → ~2,551. A test in `test/roster.test.js` fails if it is ever called again.

## Lockouts and log rotation

Raid-lockout tracking and the log-management tools that grew alongside it (`feat/lockouts`, PR #15).

- **No reset day is hardcoded, anywhere in the parser.** `lockoutCore.js` reports
  `provenance: 'not recorded'` until it has observed the same weekly task on both sides of a
  turnover. The two other published lockout trackers for this content both ship a typed Tuesday;
  this one treats that as a hint, not a fact. Every line shape and every claim the core relies on
  has its provenance written down in **`docs/EVIDENCE.md`** — read it before changing detection or
  the reset logic. When a fact hasn't been verified, that file says so plainly; keep it that way.
- **The reset setting is separate from the parser.** `src/shared/easternReset.js` +
  `logRotation.js` carry a user-editable reset (default **Tuesday 11:00 US Eastern**, the owner's
  first-hand operational choice, 23 Aug) used for *log rotation*. It's DST-aware and resolves to
  one real instant regardless of the machine's timezone. This default does not leak into the
  parser's "not recorded" stance.
- **Weekly log rotation now defaults ON** — the single highest-risk change in this batch. Guardrails:
  it refuses to rotate a log containing play *after* the reset boundary (`skippedSpansBoundary`,
  with a status line explaining the skip); "Trim log to this week" verifies the archive's size
  before rewriting the live log; and `logWatcher`/`logSplitter` `resyncOffset()` past the kept
  tail so the trimmed week is never re-emitted to the buff engine or re-split.
- **All lockout/log prompts are in-app modals** (`appConfirm()` / `pickLogFiles()` in
  `main-window.js`), not native `window.confirm` / `dialog.showOpenDialog`.

## Detection engine gotchas (learned the hard way — don't re-break these)

1. **EQ log lines have no universal "buff landed" message.** Every spell has its own flavor text. Detection relies on exact-text matching (`landingText`/`endedText` mined from the game's own string table), not generic parsing.
2. **A LOT of landing text is shared across many spells** (e.g. "You begin to regenerate." is shared by ~30 different regen-line spells — it's genuinely EQ's generic system message, not spell-unique). Text shared by >1 buff is excluded from the *unconditional* instant-match index (`buffStore.findByLandingText`) to avoid false positives, but is still resolvable via `findAllByLandingText` + spellbook filtering + burst windows + the opt-in ambiguous-cast queue. Do not "simplify" this back to a single flat index — it was tried and caused real false positives (a buff the user never cast showing up) and misattribution (a real cast showing up under a random unrelated name).
3. **Rank suffix nuance**: `Rk. II`/`Rk. III` is *always* a pure power-tier of the identical spell (same text) — safe to collapse in the roster. A bare trailing Roman numeral (`Yaulp VIII` vs `Yaulp IX`) is often a **genuinely different spell** with its own game-data entry, different duration, sometimes different text — do NOT collapse these in the roster (verified: Yaulp has ~19 distinct tiers with different text). The permissive fallback (strip *any* trailing suffix including bare numerals) only lives in `buffStore.getByName()`'s fallback path and spellbook matching, specifically to handle decorative log suffixes that AREN'T real distinct spells (e.g. bard songs sometimes show a tier number in the cast line that has no corresponding entry in `spells_us.txt` at all — "Denon's Desperate Dirge" is the confirmed example, only one un-suffixed ID exists in game data).
4. **A named spell can land on someone else, not you** (group/targeted spells landing on your current target). If we know the exact expected landing text and it never shows up, the fallback timer now *cancels* the pending cast rather than blind-confirming it — blind-confirming here previously caused real false positives ("Infusion of Spirit" showing active when it actually landed on a group-mate named "Valbladz"). This third-person-message pattern (`"<Name> looks powerful."` vs the caster's own `"You are infused with power."`) is exactly the infrastructure the planned ally-buff-tracking feature will reuse.
5. **Bard songs use "You begin singing X.", not "casting".** `matchCastBegin()` in buffParser.js already checks both patterns — if you ever see a class-specific cast verb bug again, check this pattern list first.
6. **Duration floor in roster mining**: originally filtered spells under 2 minutes, which silently excluded nearly all bard songs (they're designed to be short/re-sung). Current mining only excludes truly zero-duration (`ticks < 1`) effects.
7. **Party composition changes invalidate ambiguous-cast memory** — confirmed real log wording: `You have joined the group.` / `You have been removed from the group.` / `<Name> has joined the group.` / `<Name> has left the group.` Note this only ever fires for the player's OWN group-join events — joining a group that *already has other members* needed a separate signal (`matchGroupJoinAccepted`, "You notify X that you agree to join the group.") since the existing members never individually "join" from the log's perspective. Missing this caused a real bug (an existing member's buffs never registering) until fixed.
8. **"Unique landing text" auto-confirm must check current gem state, not just "ever scribed."** A unique landing-text match used to auto-confirm as the player's own cast purely because the spell existed somewhere in their spellbook — but a spell can be scribed and NOT currently memorized (different gem loadout), and an ally casting something with the same unique text would then get silently misattributed to the player. Fixed by cross-checking `currentlyMemorized` (built live from `"You forget X."`/`"You have finished memorizing X."` lines) before auto-confirming; if the spell is knowably NOT in a gem slot right now, treat the landing as suspicious rather than self-cast. `currentlyMemorized` is also now surfaced directly in the main window UI ("Currently memorized") since the user pointed out it's useful information on its own, not just an internal signal.
9. **`selfAmbiguousResolutions` is scoped per loadout profile — fixed via manual profiles, not auto-detection.** It's deliberately never cleared on party change (correct — which of the player's OWN spells an ambiguous text means isn't about who's grouped with them), but that reasoning had a hole on this server: a loadout swap (see "Server context" above) can make a past self-resolution wrong without touching party membership OR the spellbook file. A burst-detector on forget/memorize events (mirroring `BURST_WINDOW_MS`) was the first idea but was explicitly rejected — the user pointed out a normal Quick-Buff-style fade/re-memorize cluster during ordinary play would false-trigger it, and there's no reliable signal that distinguishes "loadout swap" from "routine gem juggling." **Landed instead**: `src/main/profileStore.js` (named loadout profiles, one active at a time, persisted) + `buffEngine.js`'s `selfAmbiguousResolutionsByProfile` (one resolution bucket per profile instead of one flat map, swapped via `setActiveProfileId()`). The user switches profiles manually via the chip bar at the top of the main window (`initProfileBar()` in `main-window.js`) whenever they actually swap loadouts — no auto-detection at all. A pending ambiguous cast is tagged with whichever profile was active when it was *queued* (not when it's resolved), so answering it after switching profiles still writes to the right bucket. Confirmed working live (screenshot-verified: switching to a fresh profile correctly re-prompted an ambiguous cast that was already resolved under the old one). **`activeProfileIds` also gates on-screen visibility** — see gotcha #13.
10. **A widget's `activeProfileIds` IS its on/off switch — there is deliberately no separate global "enabled" toggle.** An earlier version had both: a global `enabled` checkbox ("Show this aura") *and* profile membership that was pure organizational bookkeeping with no visibility effect. The user explicitly reversed this: profiles are supposed to control which auras are on screen, and two independent concepts meant two places to look when an aura didn't appear. **Landed**: `widgetManager.js`'s `isVisibleForActiveProfile(config)` is the single source of truth (empty `activeProfileIds` means "show on every profile", **not** "show nowhere" — also an explicit user choice, so a new widget can't silently be invisible); `applyProfileVisibility()` re-evaluates every widget on profile switch (wired from main.js's `profiles:setActive`); `setActiveProfileIds` shows/hides immediately. The `enabled` field is still **persisted** in `widgets.json` but is no longer read anywhere for visibility — left in place purely to avoid a data migration (see this file's opening paragraph on the userData-path incident). Don't reintroduce it as a second gate, and don't "clean it up" out of the store without a deliberate migration.
11. **Auto-hide overlay matches on process name (`eqgame`), never window title.** The Daybreak launcher (`LaunchPad.exe`) and the actual game client both show "EverQuest Legends" as their window title, so title-matching would count the launcher as "the game" too. Confirmed directly via `Get-Process | Where MainWindowTitle` while the user had the game running, not guessed. **Also matches this app's OWN process name** (derived from `process.execPath`, not hardcoded - survives a rename automatically) - the first version only matched `eqgame`, so clicking into the main window or a widget to drag/configure it (briefly making THAT window, not `eqgame`, the foreground window) made the overlay vanish mid-interaction, defeating the point of dragging it. On Windows every window this app owns shares one process image regardless of which BrowserWindow backs it, so one process-name check covers the main window, every widget, and the ambiguous popup at once. See `foregroundWatcher.js`.
12. **Quick Buff (and similarly instant multi-grant abilities) genuinely drops a variable number of buffs per cast — confirmed at least three times now by directly diffing the raw log, not an app bug.** One cast landed 11 of ~14 expected; a later cast also landed 11 of 14 but with a *different* 3 missing; reported again live in-game showing 11 icons. There's no code path in this app that would explain it selectively dropping exactly 3 specific lines from a burst while correctly keeping the other 11 - the log itself never contains those lines to begin with. **Do not "fix" this by chasing it as a detection bug** - if it comes up again, cross-check the raw log around that timestamp first (it will confirm the missing lines were never written at all) before assuming the app dropped something.
13. **Custom timer definitions can legitimately share a display name and even the exact same trigger text - `customTimerEngine.js` must key active-instance state by each definition's own `id`, never by name.** Confirmed real, intentional user setup: two "Custom Timer" definitions both named the same thing, both triggered by the identical chat line, given two different icons on purpose, expected to activate simultaneously. An earlier version only returned the *first* matching definition per log line (`_findTriggerMatch`, singular) and tracked `activeTimers` keyed by `name.toLowerCase()` - so even fixing the first-match bug alone would've had the second activation silently overwrite the first in the Map. `overlay.js`'s `keyFor()` (the identity key backing every render-tracking Map/Set) has the same failure mode for any buff type that can have duplicate names - it already handles this correctly for ally buffs (name+allyName) and now for custom timers (`id`), but don't add a new buff source without checking whether IT can also produce name collisions.

14. **Bard songs are tagged from the game's own spell data, not from watching for "singing" cast lines.** `markBardSong()` (the original mechanism) only fires when the player personally sings a spell *while the app is running* and the app catches the `"You begin singing X."` line — it tags one spell per observation. That left the real roster with **1 of 11,337** entries flagged, which made "Hide bard songs" look completely broken when the filter logic was actually fine. `src/main/bardSongTagger.js` now reads `spells_us.txt` directly at startup (and on EQ-folder change) and tags every spell **only the Bard class can cast** — fields 36–51 are the 16 per-class required levels, `255` = never castable, Bard is offset 7. Verified empirically before wiring in: Selo's Accelerating Chorus / Vilia's Verses of Celerity / Amplification / Selo's Accelerando all bard-only; Talisman of Altuna (Shm/Bst) and Resolution (Clr/Pal) correctly not. Tags 346 additional entries on the user's install. **Additive-only on purpose** — it never sets a flag back to `false`, because the Known Buffs list has a manual two-way override (`buffStore.setBardSong`) and a deliberate user correction there must not be silently reverted on every launch. Idempotent; only writes when it actually changes something.

15. **A missing roster entry doesn't just hide a buff — it silently upgrades a guess into the app's highest-confidence tier.** The "unique landing text" tier auto-confirms with no other evidence, and "unique" is judged against *the roster*, not against the game data. So every spell the mining dropped can make some other spell's shared text look unique. Confirmed live: `Brilliance` and `Cassindra's Chant of Clarity` both land with `"Your mind clears."`, but only Brilliance was in the roster, so every Chant of Clarity the user sang was confidently logged as Brilliance. **Partly addressed** by `rosterBackfill.js`, which restores bard songs (1,083 added on the user's install, taking the roster 11,337 → 12,420 and bard-song tags 347 → 1,430). The mining rule that caused it — keep only spells whose duration field (field 12) is `> 0` — is wrong: 386 bard-only spells carry `0` there and are still real, castable, currently-sung songs. Backfilled songs with no duration get 12s (2 ticks), the modal bard-song duration (828 of the 1,164 songs that do carry one use exactly that). **Still open**: the same filter dropped ~37k non-song entries too, including Armor of Protection, which is what made the `"You feel protected."` popup offer 4 candidates that didn't include the right answer. That half needs its own decision — there's no defensible blanket duration for arbitrary non-song spells the way there is for songs.

16. **`currentlyMemorized` is now PERSISTED, and is a memory rather than live truth — it can be wrong, not just empty.** It used to reset on every launch, which was itself a bug source: an empty set means "we don't know", and the detection tiers treat not-currently-memorized as evidence a landing wasn't the player's, so restarting mid-session caused real buffs to be silently ignored. It now saves to `currentlyMemorized.json` on every gem change and reloads at startup, so the common case (app restarted, gems unchanged) is correct instead of blank. **The tradeoff is deliberate**: gems swapped while the app is closed leave it remembering something untrue, and a *wrong* entry is worse than a missing one. That's why the landing-page gem bar makes every filled gem clickable to forget (`removeMemorized`), plus a "Forget all" button (`clearMemorized`) — those exist as the correction mechanism for exactly this, don't remove them without replacing the correction path. Stored as `[lowercase, originalCase]` pairs, not a flat name array: the lowercase key is what every detection lookup matches on, while the original casing is the only source of a decent display name for a memorized spell that *isn't* in the buff roster (a nuke, a heal) — without it those render as "rain of spikes". The loader still tolerates the old flat-array format.

17. **Ally-buff detection must NOT require the recipient to be a known group member.** `groupMembers` is only ever learned from join/leave lines seen live, so grouping up before launching the app — or any restart mid-session — leaves it empty, and gating on it silently disabled ally tracking completely. Confirmed from a real log: a `You begin casting Shield of Flame.` whose `Avenrae is enveloped by flame.` landed 3 seconds later was ignored purely because the group had formed nearly 3 hours before the app started. Both ally paths now take the recipient's name **from the landing line itself** (EQ names are a single alphabetic word, so `^([A-Za-z]+)( .+)$` splits it unambiguously) and look the remaining suffix up in the roster. `groupMembers` is still maintained because it's real information, but nothing depends on it being complete — don't reintroduce it as a gate. False positives are bounded by the suffix having to match a real `othersLandingSuffix`: ordinary chat during a burst finds no match and is ignored (verified).
18. **Ally-buff tracking had never fired once — the whole tier was gated behind a signal an instant multi-target ability never produces.** `recentSelfCast` is only ever set by a named cast line (`You begin casting X.`), but Quick Buff emits `You activate Quick Buff.` with no per-spell cast lines, so during exactly the burst where the player buffs their group it was null and the ally tier was skipped entirely. Confirmed from the real debug log: **zero** `ALLY` decisions ever recorded, despite the roster carrying 9,219 third-person suffixes and group membership tracking working correctly. Nothing was wrong with the roster, the suffixes, the group tracking, or the Ally Buffs aura — just the gate. **Fixed** by adding a second ally path that runs on burst context instead of a named cast: strip the groupmate's name off the line and reverse-look-up the remaining suffix via `buffStore.findAllByOthersLandingSuffix()` (a new grouped index, invalidated in `_save()` alongside the landing-text ones). **Requires an unambiguous suffix** — 858 of the 2,034 distinct suffixes are shared by several spells, and this project's "no guessing" rule applies to ally attribution as much as self; a shared suffix is logged as `ALLY AMBIGUOUS` and skipped rather than resolved to whichever candidate came first. Verified by replaying the real 13:05:38 burst: 2 buffs correctly land on Avenrae, 2 correctly declined as ambiguous. **Obvious next step**: the heal-proc line (`You healed Avenrae for 255 hit points by Symbol of Pinzarn.`) names the exact answer for one of those ambiguous cases, one line later - the same signal already used to auto-resolve *self* ambiguity (gotcha above) would resolve ally ambiguity too, but ally ambiguity isn't queued anywhere yet so it needs a short-lived pending-ally-landing memory first.

19. **Live timer state survives a restart, but only for 5 minutes — see `src/main/sessionSnapshot.js`.** Active self buffs, ally buffs and custom timers used to be session-only, so any restart wiped every running timer and the overlay sat empty until each buff happened to be recast (the app never replays log history, so nothing rebuilt it). Now snapshotted to `sessionSnapshot.json` on change (debounced 2s) and flushed on `before-quit`, then restored at startup. **The restore needs no arithmetic**: active entries already store `expiresAt` as an absolute timestamp rather than a remaining-seconds countdown, so a 100-minute buff whose app was closed for 3 minutes simply comes back with 97 left, and anything that expired meanwhile fails the `expiresAt > now` filter. **The 5-minute cap is the judgement call, and it is not about arithmetic**: the app cannot see what happened in-game while closed, so after a long gap a buff that hasn't technically expired may still be long gone (death, camp, zone, relog). A stale timer reads as authoritative in a way an empty list does not, so the cap deliberately errs toward showing nothing. Also refuses to restore if the system clock moved backwards, since every `expiresAt` is then meaningless relative to now. Restore runs *after* `applyInstallRoot()` so the roster is backfilled/tagged first — a restored buff is looked up by name for its icon.

20. **Whether a damage line is yours is derivable; it is not guessable from names.** The obvious approach to a damage meter is to judge from the shape of a name whether it is a player or a monster. It does not survive these logs: `Fright has taken 394 damage from your Envenomed Bolt IV.` is a monster with a one-word name, shaped exactly like a player's. `damageEngine.js` derives direction instead, from one seed and three rules — you are on your own side; anything YOU damage is an enemy (the log's grammar says so outright); anyone damaging a known enemy is a friend; anyone damaging a known friend is an enemy. Rules two and three feed each other, which is the whole point: rule one alone credits **22%** of a real log day, because her groupmate spends the night fighting mobs she never touches, and adding rule three takes it to **65%** with the remaining 35% correctly excluded as incoming. Lines that cannot yet be placed are HELD and re-examined whenever the sets grow, so the opening seconds of a pull are not lost to the bootstrap.

21. **In `X has taken N damage from Denon's Disruptive Discord V by Avenrae.` the apostrophe-s is the SPELL, not the caster.** 44,508 lines are shaped that way. Reading the possessive as the attacker would have been confidently wrong on every one of them; the attacker is the name after `by`. A damage shield is the exact opposite — `A zol ghoul knight is pierced by Avenrae's thorns` — where the possessive IS the attacker. Two wordings that look alike and mean opposite things, which is why both were measured separately rather than assumed to share a shape.

22. **The travel router is breadth-first on purpose.** Weighting the edges would mean claiming a boat costs more than a zone line, or a portal less than both, and there is no measurement behind any of those numbers. Fewest hops is a claim the data supports. Two details that look redundant and are not: the fewer-spells tie-break is invisible today because the move ordering agrees with it (measured across all 10,712 routes), but it is the mechanism that HOLDS the guarantee — reverse the ordering and routes stay correct with it and break without it. And the instance-tier exclusion in the short-name lookup only decides the answer for **7 of the 12 shared short names** — the ones like `soldungb` → Nagafen's Lair where the short name appears nowhere in the display name. Both were nearly deleted as dead code.

23. **Instance tiers are one-way in the zone graph, and correctly so.** `Befallen 3 (Fused)` lists a way out to West Commonlands; West Commonlands lists no way back in, because there is no zone line into a particular tier — you enter through the game's instance system. All 27 variants are like this, which is why 2,079 routes *into* them find nothing. The router handles it by routing to the ordinary place and adding a final `Enter <tier>` step, rather than fabricating an edge or refusing a plainly reachable destination.

24. **A share code arriving from chat is text another player typed.** `shareCodeChat.js` recognises one and the main process offers it; nothing imports it. `"Look at it"` hands the code to the ordinary import screen with every confirmation that already lives there. There is deliberately no IPC channel that would apply a chat code directly, and two structural tests fail if one appears — importing on sight would let anyone reconfigure the app by talking in guild chat. Related: a *modal* was the wrong instrument, because this arrives unprompted while she is playing and one that stole focus mid-fight would be worse than the feature is good.

25. **The AA/Exaltation duration bonus applies to every spell the roster's own `kind` column marks `buff`, and NOTHING else.** Shara, 23 August: *"the AA should only apply to things marked as a BUFF. not just any beneficial."* I had it on buff, heal, hot and pet, reasoning that the bonus is for beneficial spells and those are the beneficial categories — inference presented as a measurement. Before that it was applied to *everything* without a `noDurationScaling` flag, which is **155 entries** of debuff, dot and charm that would have over-timed by up to 65% the moment an AA level was set. Curse (base 30, a dot) measures 31-36s across 31 castings on days when her buffs measured x1.53; the multiplier would make it 45. The gate is a whitelist, not a blacklist, so an unrecognised category runs short rather than outliving the thing it times.
    **Second mistake, corrected 24 August: I read "BUFF" as this file's own finer-grained `scaleCategory` ('buff' only), not the roster's `kind` column, and that silently dropped every `hot`.** All 16 of the roster's `scaleCategory:'hot'` entries — Celestial Healing, Celestial Remedy, and the rest — are `kind:'buff'` on the sheet. Reported live: Celestial Remedy popping a flat 24s with no bonus applied. Shara: *"HOTs are listed as buffs in the roster sheet provided, it should have always worked"* and *"ALL buffs are supposed to be subject to these increases. i have stressed this since the beginning."* `isAAEligible()` now checks `entry.kind === 'buff'` directly instead of a `scaleCategory` whitelist, so nothing needs to stay in sync with the sheet's own classification by hand. This does **not** reopen Curse or any other `kind:'det'`/`'pet'` entry — those aren't buffs by the sheet's own column either way, dot/debuff/charm/nuke/pet-summon durations are unaffected, and the Curse measurement above still stands. **The only spell currently exempted from a `kind:'buff'` entry getting the bonus is Promised Renewal**, via its own `noDurationScaling` flag (a separate, directly measured exception — 225 castings flat at 15s regardless of rank or AA level, see gotcha 27's neighbor in the code). Shara's words on that boundary: *"exceptions are exceptions for a reason, currently the only exception is promised renewal"* — don't add another one without the same kind of direct measurement behind it.

26. **A wide spread in a measured duration means several casts, not noise around one.** Celestial Healing IV measures 48-78s where its mote tier predicts 29, and I read that as evidence the AA bonus reached heals over time. It was recasting: she refreshes the heal before the old one lapses, so landing-to-wear-off spans several casts. The tell was the *shape* — a fixed-duration buff measures inside a 14-second band (Spirit of the Puma VII, n=24) and this one ran across 30. Every landing already recomputes, including a renewal, because renewals go through `_land()` like everything else, so a re-cast reapplies the calculation at whatever rank was just cast.

27. **Mote tier scaling is linear against base, not compounding, and the rank is READ rather than threaded.** `duration = base x (1 + rate x tier) x aa`, rounded ONCE over the combined multiplier — rounding between the steps differs by up to a second. Measured: buff +10%/tier (Spirit of the Puma VII predicts 168.3s, measured mode 167; compounding predicts 192.9s and 23 of 24 observations fall below it, so it is refuted rather than merely unused). `_rankForEntry` reads the numeral off the cast the engine is already holding rather than threading an argument through the sixteen call sites that can end in a landing, with a name check so a stale cast cannot lend its numeral to something else. Somebody else's cast gets **no** rank: their numeral is in the log, but nothing establishes which of their casts produced which landing, and an honestly unscaled number beats a confidently wrong one.

28. **An IPC handler that destructures a fixed list of names drops anything missing from it, in silence.** `triggerMatch: 'castOf'` was absent from `addCustomTimer`'s whitelist for the entire time castOf timers existed; the cooldown premade only worked because it writes the timer object directly and never goes through that path. Anything routed through the UI was quietly downgraded and never fired. Note 9's `allOf` had to be added in **four** places — both handlers, destructure and forwarding call — and there is a test that gutting any one of them fails.

29. **Trusting userData over the install for roster DATA meant a real bug fix could ship and do nothing.** `buffStore.js` used to seed the roster into userData once, then upgrade it via a version-gated merge (`STARTER_VERSION` + a growing pile of one-time migration flags in `buffsMeta.json`) that only refreshed an entry if it "looked untouched" — no `landingText`/`endedText`/`iconId` set at all. That heuristic could never actually fire on a normal roster entry, because every one ships WITH all three from day one. Consequence, confirmed live: Alacrity's duration was wrong (660s instead of the measured 492s), fixed in the bundled roster, and an already-seeded install kept showing the old number regardless — the fix genuinely could not reach anyone who had already launched the app once. Shara: *"it should be seeded from the install not the person's saved files because it interrupts old installs and doesn't allow live updates."* Rebuilt so the install (`src/shared/data/buffs.json`) is authoritative for spell data on **every construction**, not a one-time seed — no version number, no migration flags, nothing to remember to bump. Only three things still live in userData because the install has no copy of them at all: a fully custom entry (`custom: true`), a spell the user hand-corrected through Known Buffs' Save button (`edited: true`, set by `upsert()` — carefully NOT set by `setShowOnOverlay`'s call through the same method, or ticking one checkbox would freeze a spell's data forever), and three small toggles with no install-side value (`showOnOverlay`; `isBardSong` once `isBardSongUserSet`; `noDurationScaling` once `noDurationScalingUserSet`). `bardSongTagger.js`'s additive-only pass was updated to respect `isBardSongUserSet` too — without it, a manual "no, not a bard song" correction (`isBardSong: false`) was indistinguishable from "never tagged" and got silently re-tagged true on the next launch.

30. **An AA-activated ability's rank numeral was being read correctly and then thrown away, silently skipping the mote-tier duration bonus for it specifically.** Reported live: "Amplification II" (a bard AA ability - `"You activate Amplification II."`, not a `"casting"`/`"singing"` begin-line) landed at 50s where its own in-game tooltip read `"0:30 (1:00)"` — 30 base, 60 with the character's real AA+Exaltation bonus. `_rankForEntry()` only ever reads `pendingCast`/`recentSelfCast`, and `handleLine()`'s `matchActivate` branch never set either — `matchCastBegin`'s own branch, two hundred lines further down, is what sets `recentSelfCast` for a cast/sung line, and an activate line simply fell through it untouched. The result: 50s was exactly base × AA alone (30 × 1.65 = 49.5 → 50) with zero mote contribution, even though the rank was sitting right there in the log line and `matchActivate` was already returning it intact — the numeral was parsed correctly and then discarded before it ever reached the scaling math. Confirmed as a real bug rather than a display artefact by the owner's own words when asked whether mote scaling should even apply to a duration-based song at all: *"duration based buff songs scale with motes."* Fixed by setting `recentSelfCast` (not `pendingCast` — see below) in the `activated` branch too, the same shape `matchCastBegin`'s branch already uses. **Why `recentSelfCast` and not `pendingCast`**: `pendingCast`'s confirm/cancel timer machinery assumes one specific expected landing text is about to arrive, which is exactly wrong for an activate line like Quick Buff that deliberately drops many buffs with no per-buff cast line at all (gotcha #12's whole reason for existing) — `recentSelfCast` is pure lookup evidence for `_rankForEntry`, keyed by name after rank-suffix stripping, so Quick Buff's own name never matches any of the buffs it actually grants and cannot lend them a bogus rank (pinned by its own test, `duration-scaling.test.js`'s "Quick Buff activating cannot lend its own name's rank"). Verified end to end against the real roster and the real `handleLine()` pipeline (not a hand-set `recentSelfCast`, since the whole bug was about whether the log line's own rank ever reached that field) — 50 → 59 (30 × 1.2 mote × 1.65 AA, matching the formula exactly); the remaining 1s against the tooltip's rounded `"1:00"` is more likely the game client's own display rounding than a further formula error, but that last second hasn't been independently confirmed either way.

31. **Bard-song self-attribution never actually checked the player's own recent cast for a RANKED song — a rank suffix silently defeated its own self-check.** Reported live: singing "Selo's Accelerating Chorus VI" (self-cast) got attributed to "Imperius" — traced from the raw log to a MOB with an identically-named ability, seen singing it via `"Imperius begins singing Selo's Accelerating Chorus."` roughly 20 minutes earlier the same session (mob names in this game are shaped exactly like player names, see gotcha #20 — nothing distinguishes them here). `_attributeBardSongCaster()`'s self-check compared `recentSelfCast.name.toLowerCase()` directly against the roster's bare name, with no `stripRankSuffix()` first — so `"selo's accelerating chorus vi"` never equalled `"selo's accelerating chorus"`, the self-check silently failed on every ranked cast, and execution fell through to `_recentOtherCaster()`, which returned the stale mob-cast evidence — `recentOtherCasts` has no expiry at all, by design (see its own comment: valid for the whole group session, since a group buff's own third-person suffix can legitimately need to outlive a much shorter cast window). Fixed the same way `_rankForEntry` already strips a rank suffix before comparing (gotcha #27) — an unranked bard song ("Amplification" with no numeral) already worked, which is exactly why this went unnoticed until a ranked one hit it. `test/bard-songs.test.js` pins both the ranked-cast regression and the unranked case still working, and it's mutation-tested — reverting the one-line `stripRankSuffix()` addition reproduces the exact reported symptom (`'Imperius' !== 'You'`).

32. **Death clears live state, but only forward.** `buffParser.matchOwnDeath` is `/^You have been slain by .+!$/` — the player's *own* death, a different verb from the mob-death lines `matchSlain` catches (`"<Name> has been slain by …"`). On it, `buffEngine._clearOnDeath()` drops active buffs + bard songs + the pending cast, and `customTimerEngine` clears active timers **except ones in their recast-cooldown phase** (a cooldown keeps ticking through death — the ability is still on cooldown when you're rezzed). Replay over the real corpus: 48 death-clears + 19 song-clears, no detections lost. `sessionSnapshot` needed no change. **Never-replay-history means a death that happened before the app started can't retroactively clear anything** — same limitation as `currentlyMemorized` and zone tracking. QOL #12.

## Where the backlog actually lives

**`docs/QOL-BACKLOG.md` is the live backlog** — every requested change, tagged (NEW / CHANGE /
DATA / FIX / CLARIFY) and sequenced. Start there.

Shara's original 40-note backlog is **complete except #2** (a first-aggro premade, which she is
supplying herself). The per-note record used to live in `docs/NOTES-STATUS.md` and the
session-by-session reasoning in `docs/HANDOFF.md` / `docs/FEATURES.md`; all three were retired
once the work landed — their history is in git. Where an item below references a note number,
that's the original 40-note numbering.

The prose below is older triage kept for the *reasoning* behind why things were built the way
they were, not for status — `QOL-BACKLOG.md` and `docs/TESTING.md` are the current picture.

## Standalone-tool auras' settings-panel shape — designed and built 25 Aug; Travel guide unlocked 26 Aug, Damage parser still locked

**Travel guide creation was unlocked 26 Aug, at the owner's direct request** — it's back in
`PREMADE_WIDGETS` in `main-window.js` (`id: 'travel-guide'`, `group: 'standalone'`), with its own
`SHAPE_FIELDS.travel` (`['list-format', 'timer-text', 'opacity', 'position', 'alerts',
'travel-settings']` — see below for why 'sort'/'merge'/'borders' were dropped rather than kept from
the 25 Aug shape, and what 'list-format' replaces them with). Damage parser is still locked out of
the Add Aura premade list, exactly as this section originally described — it remains in
`PLANNED_PREMADE_WIDGETS` rather than `PREMADE_WIDGETS`, so no *new* Damage parser can be created
yet. Existing auras of either kind, made before the original 24 Aug lock, were untouched by any of
this and kept working the whole time.

**Travel guide also got several other things 26 Aug, all at the owner's request, not part of the
original settings-panel rework:**
- **A searchable zone-picker popup**, opened by `/tell` — see the destination-command redesign
  below for exactly what word. It's a second always-on-top window
  (`src/main/zonePromptPopup.js`, `src/renderer/zone-prompt/`), same shape as `ambiguousPopup.js`
  but with a search box over the full zone list rather than a short candidate-button row.
- **The same popup asks where the player currently is, chained right after a destination is set**,
  if `widgetManager.getCurrentZone()` is still `null` (nothing ever replays zone history at
  startup — see gotcha #19's sibling reasoning for `currentlyMemorized`). Picking an answer there
  calls the exact same `applyZoneChangeAndNotify()` the real log-driven zone-change listener calls,
  so it's indistinguishable from the app having seen a real zone line — including feeding
  zone-gated aura visibility, not just the travel route. Only triggered off `/tell`, matching the
  original ask: this is a reaction to the player actively using the travel aura, not a proactive
  popup on every launch.
- **The current zone is shown as the top line of the aura at all times** (`Current zone: <zone>`),
  even before a destination is picked - asked for directly, and genuinely useful as a standalone
  "where am I" readout independent of the route underneath it.
- **Reaching the destination clears it automatically.** `travelRowsFor` shows "You are in <zone>"
  for exactly one tick (the 1s interval, or the next zone line, whichever comes first), then calls
  `widgetManager.setTravelDestination(widget.id, '')` right there, so the aura falls straight back
  to its idle "Pick a destination" state with nothing further to do.

**The destination command was redesigned the same day, after a real false-positive was reported.**
The original design (23 Aug, Shara's own idea) read the *exact word* typed into a failed `/tell` as
a possible zone name - `/tell qeynos`. The owner's own words on why that had to go: a real zone name
(Freeport) is also a real player's name, so an ordinary social `/tell` to an offline guildmate could
look exactly like a travel command, and it was happening in practice, not just in theory. **`main.js`
no longer calls `resolveDestinationName` from the live `/tell` listener at all** - the exported
function and its own tests in `zone-routing.test.js` are untouched (still a valid, tested pure
utility), it is simply never invoked from the running app any more. The only thing the listener
reacts to now is one fixed word, `TRAVEL_PICKER_COMMAND = 'eqtm'`. First built as a word longer
than EverQuest's own 15-letter character-name cap (collision-proof, at the owner's own instruction
that it "needs to be a name that no one has or will ever have"), then explicitly swapped to the
short `eqtm` at the owner's own follow-up call - weighed against that same requirement, and chosen
anyway for faster typing, accepting the (small, no longer zero) risk that a real player could
someday be named it. Typing it again while the popup is already open closes it instead of doing
nothing or reopening it (`pendingZonePrompt` truthy → `closeZonePrompt()` instead of
`openZonePrompt`) - one command to remember for both directions. Every *other* `/tell` target,
including a real zone name, is left completely alone by this aura.

**Why 'sort'/'merge'/'borders' were dropped from `SHAPE_FIELDS.travel` when it was unlocked** (the
25 Aug design above still had all three): a route leg is not a spell. 'sort' let someone pick
"Alphabetical"/"Time remaining" for a widget whose rows MUST stay in the walking order the router
returned — `widgetStore.createTravelGuide` hardcodes `sortOrder:'default'` for exactly that reason,
so the control could only ever scramble a real route, not just look wrong. 'merge' collapses tiles
"sharing a duration" into one — every travel leg carries the same infinite/no-duration shape, so it
would have collapsed the entire route into a single tile. 'borders' colours a tile by spell
category — a leg has no `spellCategory` at all, so it was pure dead weight (harmless, just useless,
unlike the other two). See `test/category-borders.test.js` and `test/settings-panel-shapes.test.js`
for the field-matrix tests that pin all of this. 'list-format' is the replacement: a new
`SHAPE_FIELDS` key (independent of `'display-choice'`, since travel never offers the icon/list
choice at all) that shows just the list-width/row-size sliders — the two sizing controls that
actually shape how a multi-line route reads — without the icon-per-row/mirror-direction toggles
that mean nothing when every row's `iconUrl` is `null`.

**Why the lock existed:** both used to reuse the ordinary per-aura settings panel — the one built
for a buff aura, with a "Buffs shown" card offering a source (self/ally/enemy) and a spell picker.
Neither meant anything for these two: a route has no spell to pick and no source to be cast from; a
damage meter's rows are attackers, not buffs. The owner's own words: *"custom standalone auras are
not supposed to follow this same UI format."*

**Now built**, as part of a much broader settings-panel rework (25 Aug, see
`test/settings-panel-shapes.test.js` and its own header comment for the full design): every aura
resolves to one of twelve shapes via `widgetShape()`, and a `SHAPE_FIELDS` table says which
optional rows/cards each shape gets. Damage parser and Travel guide are each their own shape now,
and neither includes the buff-picker card, the "Watching:" row, or the Display style radios — only
their own settings block (`widget-damage-settings` / `widget-travel-settings`) plus whichever of
the ordinary aura fields actually apply (Travel guide's own list narrowed further on 26 Aug — see
above). Confirmed structurally (the shape-field matrix test) and by launching the app clean;
**not yet confirmed by opening an existing Damage parser aura's settings and looking at it** — see
docs/TESTING.md's "Settings-panel rework (25 Aug)" section for that checklist (its Travel guide
half is superseded by the 26 Aug unlock above).

**Damage parser is still locked, deliberately — this is a separate decision from the panel design
being done.** (Travel guide's own lock was lifted 26 Aug, at the owner's direct request — see
above.) Re-enabling *creation* of a new Damage parser aura is a one-line mechanical change whenever
wanted: add an `id: 'damage-parser'` entry back to `PREMADE_WIDGETS` in `main-window.js`, with a
`create()` calling `window.eqTracker.createDamageMeterWidget(name, false)` — the IPC channel,
preload bridge and `widgetManager.js` functions behind it were never touched and still work end to
end — then delete the matching entry from `PLANNED_PREMADE_WIDGETS`. Don't do this without being
asked; the design being finished doesn't imply the lock should lift on its own. **Give it a
`group: 'standalone'`** when it moves — see the premade-list grouping note just below; an entry
with no `group` is silently dropped from the Add Aura list rather than shown ungrouped (confirmed
by `test/premade-list.test.js`'s own coverage of this).

## Premade list grouped by Timers / Event alerts / Standalone tools — 25 Aug

Replaced the previous "Shortcuts vs Standalone tools" split (could-you-have-built-this-yourself),
which did little sorting work in practice since almost everything qualified as a Shortcut. The
owner's own framing: *"i would like to split buff, debuff, and cooldown into a category, and
resist, dispelled into another"* - the real distinguishing property was already sitting in the
data, not something new to invent: `panel: 'buff-timer'` entries (Buff timer, Cooldown timer,
Debuff on an enemy - pick a spell/target, get a countdown) vs the fixed `createTextAuraWidget`
presets (Resist flash, Dispelled - watch for one system message, flash, nothing to pick). Standalone
tools (Ally Buffs, Bard Songs, plus the locked/planned Travel guide, Damage parser, First aggro) kept
as their own group and deliberately last - *"standalone's still at the bottom."*

Every entry in both `PREMADE_WIDGETS` and `PLANNED_PREMADE_WIDGETS` now carries its own `group:`
field (`'timers'` / `'event-alerts'` / `'standalone'`), replacing the old `STANDALONE_PREMADES` Set
that only ever distinguished two buckets. `renderPremadeList()` builds each `PREMADE_GROUPS`
section from both arrays together, filtered by that group - **the separate "Not built yet" section
and `renderPlannedPremades()` function are gone entirely**; a planned/locked entry (Travel guide,
Damage parser, First aggro, Global recovery) now renders inline, greyed out with its "Planned"
badge, inside the same group heading its built siblings use, per the owner's explicit ask to *"roll
the placeholders into their final categories."* `renderPremadeChoice(premade, planned)` is the one
render path for both real and placeholder entries now, instead of two near-duplicate functions.

**Add Aura modal "Back" bug, fixed the same day.** Reported live: *"when on this menu and hitting
back, it sends you two screens back instead of 1."* Root cause: every `.add-widget-back` button
across every panel called the same `showAddWidgetChoices()`, correct for a panel reached directly
from Choices (import/chat/premade-list/custom) but wrong for the buff-timer panel specifically -
that one is reached FROM the premade list, one screen further in, so its own Back button was
skipping the premade list and landing on Choices instead. `showAddWidgetPremadePanel()` is the
buff-timer panel's real one-step-back now; every other panel's Back button is untouched. See
`test/premade-list.test.js`.

## "Also track when it's ready to cast again" — 25 Aug

A toggle on the Buff timer panel (not a new premade - the owner's own correction to an earlier
"4th premade" proposal: *"you can add a toggle selection on a new row for cooldown, ONLY if the
skill has a cooldown. cooldown premade is already making the assumption they do not want the
duration"*). Builds a single tile that counts the buff's own active duration first, then rolls
straight into the recast cooldown without resetting, reusing note 10's existing two-phase
`'duration'`->`'cooldown'` mechanism in `customTimerEngine.js` rather than inventing a new one.

Only shown when the picked spell is in BOTH the duration list (`buffs:trackable`) and the recast-
time list (`buffs:castable`), cross-referenced by name, AND "Yourself" is selected - a customTimer
`castOf` trigger (what this actually builds) has no concept of "on an ally," so the row hides
itself for the other two sources rather than offering a checkbox that would do nothing.
`widgetStore.createCooldownTimer` grew one new optional parameter, `buffDurationSec`; omitted, it
is byte-identical to the plain Cooldown timer premade that already existed - carried end to end
through `widgetManager` → the `widget:createCooldownTimer` IPC handler → the preload bridge. See
`test/buff-plus-cooldown.test.js`.

*(A "Global recovery (GCD)" premade + an `anyCast` trigger mode were built here 30 Aug and then
**withdrawn** by the owner — the ~1.5s recovery only ever flashed on a whole-second overlay, not
worth the surface area. `widgets.json` schema v3→v4 drops any GCD auras. Trigger modes are back to
`contains` / `castOf` / `zoneEnter` / `zoneLeave`.)*

**Same conversation, separate finding:** the Buff timer picker was offering spells with NO
duration at all - Anarchy, an Enchanter nuke, showed up labelled "no duration." Owner: *"nukes are
not buffs, remove them from the buff selection list. remove anything that does not have a
duration for clarity."* `buffs:trackable` (`main.js`) now requires a real duration (a number, or
`infiniteDuration`) in addition to the existing landing-text check - debuffs with real durations
(mez/charm/snare/slow) are unaffected, this only drops genuine instants. See
`test/buff-timer-premade.test.js`.

## "Charm Broke" premade — 25 Aug

A text-alert premade (Event alerts group, alongside Resist flash/Dispelled) for when the player's
own charm wears off. The owner's instruction: *"i also need a premade aura for when your charmed
target breaks, you can find the syntax in the logs."* It was: `"Your <SpellName> spell has worn
off of <Target>."` - confirmed directly in her log, and confirmed to be the game's generic
wears-off-of-someone template rather than charm-specific text (Alacrity/Agility/Agilmente's Aria
of Eagles wearing off allies all use the identical shape). What makes this a charm-break alert is
watching for it under every one of the roster's own `scaleCategory:'charm'` spell names
specifically (`CHARM_SPELL_NAMES` in `widgetStore.js`, 14 entries as of this roster - a hardcoded
snapshot, same convention `allyCast`'s own spell list already uses in this file, not derived live
from the roster) - same "completeness over perfect naming" reasoning as everywhere else in this
project. `"<name> spell has worn off of"` in `contains` mode captures the freed target's name as
`{spell}` via the same capturedText mechanism the Resist flash preset already uses for the same
shape of capture, just landing on a target name here instead of a resisted spell name. See
`test/charm-broke.test.js`.

## Stacked text lines — text-aura feed (26 Aug)

A **"Stack multiple lines"** checkbox on every text aura (`stackTextLines`, `SHAPE_FIELDS` key
`text-stack`, on shapes `text`/`text-customTimer`/`ally-alert`). Owner's ask: a plain text aura
replaces its one line on every new event, so a burst of three resists in two seconds looked
identical to one - stack them as a short fading feed instead, each line its own trigger. **Off by
default everywhere except the Resist flash premade** (`TEXT_AURA_PRESETS.resisted` sets
`stackTextLines: true`), which is the case it exists for. A `maxStackTextLines` slider (2-4,
default 2 - "so you can read the line before but it's not obnoxious", owner's words) is an
expanding sub-option, shown only once the checkbox is on; `clampStackTextLines` in `widgetStore.js`
is the one gate (`setMaxStackTextLines` and `normalizeWidget` both go through it, since `update()`
deliberately doesn't normalize - same pattern as `clampInstantSec`). A **v2->v3 `widgets.json`
migration** (`_loadOrMigrate`) turns `stackTextLines` on, at 2 lines, for every Resist flash aura
that already exists - identified by `premadeOrigin.preset === 'resisted'` or, if that was lost, a
text aura carrying a `"resisted your "` trigger - at the owner's request ("update all existing
resist widgets, including my own"). Version-gated like the v1->v2 bard-song bump, so a later
"actually, off" is not re-stomped; an already-widened "Lines visible" is kept.

**Built entirely in the renderer, engine untouched** - `overlay.js`'s `renderTextFeed()` is its own
`render()` branch (returns early, before the tile-diff/merge/group machinery, like the `grouped`
path). It reads the same active-buff list every other aura gets and keeps a short local history:
the engine already keeps ONE active entry per trigger and just moves its clock forward on a repeat
(an instant's `landedAt`, a customTimer's `remainingSec` jumping back up - the exact signal the
renewal sound already reads), so the feed watches that clock move and appends a line each time.
Identical consecutive lines merge with an `x3` rather than repeating (so spamming one resist can't
blow the cap). `visibleBuffs(buffs, { noTextLimit: true })` is the one signature change - the
normal text path still slices to one tile. Lines fade via a CSS `feed-fade` keyframe with a
per-line (possibly negative) `animation-delay` so a surviving line resumes its fade rather than
restarting when a neighbour ages out. `resetTextFeed()` is called from `applyConfig` whenever the
feed isn't the active mode, so toggling off/on can't resurrect an old burst. See
`test/text-stack.test.js` (engine-level feed behaviour is mutation-tested) and TESTING.md's
"Stacked text lines" checklist - **not yet run in a real session.**

## Buff optimiser / Buff Planner (26 Aug) — page built but LOCKED, aura not yet built

**Locked 27 Aug at Shara's request** ("lock the buff planner tab ... so that no one can access
it") until the `buff-loadout` overlay aura ships. The sidebar nav button is removed from
`index.html`; the `#page-planner` section and all of `buffPlanner.js` / `spellEffects.js` /
`buffLines.js` stay in place and keep their tests. `initBuffPlanner()` bails immediately when
`.nav-btn[data-page="page-planner"]` isn't found, so nothing wires up and no IPC fires. To
re-enable: add the nav button back (`data-page="page-planner"`, `id="planner-nav-btn"`) — that's
the whole change. `test/planner-wiring.test.js` pins the locked state.

Shara's ask: "input 3 classes, spit out your highest-level buffs and the best setup across the 14
buff slots." Design forks she chose: a main-window page **plus** a loadout aura, drag-to-reorder
priority (not a curated ranking), the 3 classes **tied to the active loadout profile**, and -
corrected 26 Aug after first build - **one shared character level, not per-class** ("it's one
character with a multiclass loadout, not three mains"), capped at **50** (the EQ Legends cap). The
level picker sits above the single row of three class dropdowns.

**`src/main/buffPlanner.js`** is the brain - pure, no file/path access. `computePlan({ roster,
classes, level, priorityOrder, checkStack, spellData, lines })` -> `{ ..., slots, songSlots,
permanentSlots, totals, statsKnown, stackingKnown }`. `lines` is `src/shared/buffLines.js` (the
heading model - see below and `docs/BUFF-STACKING.md`); `main.js` always passes it.
- Candidates: every `kind:'buff'` roster entry one of the 3 classes can cast at the character
  level, whose `targets` can land on the player (`Self`/`Group`/`Friendly`/`Group Member`/`Single`
  - not Pet/Animal/Undead). **Heal-over-time spells excluded** (`scaleCategory` `hot`/`heal` -
  Shara, 26 Aug: "heals should be excluded").
- **Ranked purely by character-stat magnitude** - Shara, 27 Aug: "rank them by best, that means
  numerical", "level and duration have absolutely 0 to do with anything", "actual character stats
  only", "i don't want SPA anywhere near the calculations". **`spellEffects.js`** reads the real
  +STR / +AC / haste% numbers from `spells_us.txt`'s effect slots (reusing `spellStacking.js`'s
  `denseEffects`/`effectValue`). Its `STATS` list is the **complete set of character stats the
  planner knows** - the 7 attributes, AC, ATK, haste, spell haste, the 5 resists + all-resists,
  damage shield, rune, spell rune, max HP, max mana - each paired with the effect number the game
  file uses (an implementation detail that appears **nowhere** else - not in the returned data
  (`{stat, value, order}`), not in the planner, not on screen; the term "SPA" is banned from
  `spellEffects.js` and `buffPlanner.js`, pinned by a test). Any effect that isn't one of those
  stats - heal components, procs, vision, illusion, focus limits, pacify - is discarded here and
  never reaches the planner.
- **STATS list + weights (updated 27 Aug on Shara's review of a live plan):** added `HP regen`
  (effect 0), `mana regen` (effect 15 - was mislabelled `max mana`; effect 15 is a per-tick mana
  buff, Clarity-style, not a max-mana raise), `endurance regen` (effect 189), and `cast speed`
  (effect 127, replacing the unused `spell haste` on effect 118). `max mana` moved to effect 97.
  **`STAT_WEIGHT`: regen stats are 4x** ("mana and endurance regen should be a high priority") -
  a per-tick value is small (~10-15) so it needs the multiplier to sit alongside a +40 stat;
  **resists dropped to 0.1x** (0.15 for `all resists`) - was 0.25, still let 4-5 single-element
  resist buffs fill the tail of the 14 ahead of anything useful. `cast speed` is a raw % scored
  1.5x (top priority, like haste - Shara: "blessing of faith/piety is a cast speed buff and needs
  the same priority as haste"). These effect numbers are the standard client ones, NOT verified
  against her file - see TESTING.md's checklist for what to confirm. `buffPlanner.NON_STAT_CATEGORIES` is the coarse companion filter
  (whole categories: Duration Heals, Echoes, Delayed, Movement, Vision, Illusion:*, Spell Focus,
  Invulnerability, ...) so the plan is sane even with no spell file; with the file, a buff granting
  zero known stats is also dropped.
- Each category's headline stat is learned *empirically* (the stat most of that category's spells
  grant - "Strength" -> STR, no hardcoded assumption). `betterCandidate` compares that number;
  `orderCandidates` fills slots by `statScore` so the least valuable buffs drop first. `totals`
  sums every slotted buff's stats (haste kept-best, not summed), in character-sheet order.
  No EQ folder -> name order, `statsKnown: false`.
- **STR/DEX/AGI/AC are confirmed against the owner's file** via `spell-stacking.test.js`'s
  fixtures; the rest use the standard client effect numbers - a wrong one shows as an obviously
  wrong number for a *named* stat, not gibberish. Live check in TESTING.md.
- **Three pools** (`poolFor()` routes each candidate; permanent checked first):
  - **14 spell-buff slots** and the **5-slot bard-song pool** (`songSlots`, only when BRD is one
    of the classes - `isBardSongEntry` = `isBardSong` flag or Bard-only class list) go through
    ONE `collapseByStacking` pass together (see the "category is a stat label" bullet below), then
    split by pool; each pool then fills by priority order + stat score.
  - **Uncapped permanent pool** (`permanentSlots`, `infiniteDuration` - Yaulp, Fury) collapses
    SEPARATELY and is NOT deduped against the temp buffs: Fury (permanent shaman Strength) keeps
    its own permanent listing even though a temp Strength buff is also in the 14. "Cast once and
    forget" - the player wants it listed regardless (Shara, 27 Aug).
- **The roster's `category` column is a STAT LABEL, not a stacking line** - learned the hard way
  27 Aug when Shara posted a real, valid 14-buff cleric/shaman/bard loadout that ran `Strength`
  AND `Infusion of Spirit` AND `Talisman of Altuna` (all "stat" categories that overlap) and my
  category-collapse had thrown two of the fourteen away. **The planner does NOT collapse by
  category.** Every stat/combat buff the classes can cast is a candidate.
- **The heading model (`src/shared/buffLines.js` + `src/shared/data/buff-lines.json`)** is how
  conflicts are resolved now - see `docs/BUFF-STACKING.md`. A **heading** is a slot; same heading =
  mutually exclusive, different heading = stack. A **line** is an upgrade ladder sharing a heading,
  `members` ordered low->high. `buff-lines.json` also carries `blockedPairs` (33 directional "X did
  not take hold, blocked by Y" observations mined from real logs) and combination buffs (Aegolism,
  Harnessing of Spirit) that `blocks` the individual lines they subsume.
  `buffLines.stackDecision(incoming, active)` returns `overwrites` / `blocked` / `coexist` /
  `unknown`. `buffPlanner.resolveByHeadings()` collapses each line to its best castable tier, then
  walks candidates in priority order claiming headings, dropping anything whose heading is taken or
  that `stackDecision` calls `blocked`/`overwrites` (-> overflow with a `reason`). Only
  CLR/SHM/BRD/ENC/DRU + universal resist lines are defined so far; an `unknown` pair falls back to
  `spellStacking.checkOverwrite`.
- **`collapseByStacking` / `collapseByCategory` are the fallback** used only when `lines` is absent
  (never, in the real app - `main.js` always passes `buffLines`); they set `approximate: true` /
  `stackingKnown: false`. `checkStack` (`spellStacking.checkOverwrite`) is always wired when the
  spell file is reachable, not gated on the `useStackingModel` diagnostic toggle.
- **The Self Buffs overlay uses the same model to drop stale tiles.** `buffEngine.setLineStackFn()`
  is wired in `main.js` to `buffLines.stackDecision`; in `_land()`, when a `kind:'buff'` spell
  lands, any active buff the incoming one `overwrites` is removed immediately (logged
  `ENDED "<x>" - replaced by "<y>"`). This runs unconditionally (measured pairs + strict line tiers
  are not guesses); the old effect-slot heuristic behind `useStackingModel` now only handles pairs
  `stackDecision` returns `unknown` for.
- The headline stat shown on a row is matched by **name** to the category's calibrated stat, not
  by value - a "Charisma" buff that also gives +40 INT still leads with its CHA figure.
- **Resist buffs are weighted 0.25x** in the default slot order (`STAT_WEIGHT` in spellEffects) -
  "situational and lower priority" (Shara) - so a +40 resist doesn't outrank a +40 stat buff for a
  slot. The drag order still overrides everything.
- The 14 slots are just `candidates.slice(0, 14)` after ordering by the user's dragged
  `priorityOrder` (names), with un-ordered buffs following by `DEFAULT_CATEGORY_PRIORITY` then name.
  Everything past 14 -> overflow `reason: "no free slot"`.

**Data model**: `profileStore.js` grew `plannerClasses` (up to 3 codes), `plannerLevel` (1..50),
and `buffPlanOrder` (names), per profile, all optional. `main.js` has
`planner:getInput|setClasses|setLevel|setOrder|compute` -
**`compute` is always recomputed live from `buffStore.getAll()`, never persisted** (the roster is
rebuilt every launch, so a cached plan would drift - same reasoning as gotcha #29).

**Page**: `initBuffPlanner()` in `main-window.js`, `#page-planner` / "Buff Planner" nav button.
A character-level input, one row of three class dropdowns, the 14-slot list, a "Symphonic" card
(shown only with BRD), a "Permanent buffs" card (shown when non-empty), one drag-to-reorder
priority list covering the buff + song slots (HTML5 DnD), and a "Won't fit" card. Recomputes on
every level/class/drag change and on `onActiveProfileChanged`.
Tests: `test/buff-planner.test.js` (the maths + heading model, mutation-tested),
`test/buff-lines.test.js` (the shipped `buff-lines.json` + `stackDecision`),
`test/planner-wiring.test.js` (store + IPC + page markup + the engine/planner both using
`buffLines`), `test/spell-stacking.test.js` (the `buffEngine` stale-tile removal).
**Not yet run in the real app** - see docs/TESTING.md.

**Still to build - the `buff-loadout` aura** (Shara chose "page + aura"): a repeatable aura kind
that renders the planned 14 as overlay tiles - active buffs counting down (cross-referenced against
the engine's `activeBuffs`), missing ones as greyed "not up" placeholders, so it doubles as a
"what am I missing" checklist while buffing. Reuses `customTimerEngine`'s reverse-detection
`alwaysOnEntry()` shape for the placeholders. Needs: a `widgetStore` kind, engine plumbing to feed
it the plan + active state, `overlay.js` rendering, a `SHAPE_FIELDS` entry, and a premade-list
entry under `group: 'standalone'`. Not started.

## Remaining backlog (see TaskList tool for live status)

Historical numbering (#7, #13-#15) preserved from an earlier pass for continuity; everything else below is unnumbered, freshly triaged from a raw user note-dump into bugs-vs-features and rough time-to-execute. None of it has been scoped in detail yet - treat "quick/medium/large" as a sizing guess, not a commitment, and confirm design specifics with the user before starting anything in the Large bucket.

**Suggested priority order** (reasoned from data-correctness first, then effort/impact, then dependency order):
1. **P0 - the detection-engine rework.** Everything in "Detection engine: architectural rework" below. **Built 25 Aug as an opt-in Experimental toggle, off by default, unverified in a real play session — see that section's status note.** The user has now hit the *same class* of misdetection three separate times from three different angles (bard songs ignored, Quick Buff ignored, disambiguation offering wrong candidates), and correctly diagnosed the shared root cause themselves. Point fixes here have started colliding with each other - stop patching tiers and redo the resolution flow. Nothing else in this list matters as much, because this is the app's actual job. The next real step is running a live session with the toggle on, not more building.
2. **P1 - bard song handling.** Cheap containment fixes (opt-in toggle, "hide bard songs" bug, experimental labelling) that reduce active daily pain while the rework above is designed. Deliberately *containment*, not a real fix - the real fix is the rework.
3. **P2 - quick UI wins**, batched together. Cheap, low-risk, no dependency on anything above.
4. **P3 - Sounds/Alerts UX polish** (medium, self-contained).
5. **P4 - custom timer overhaul** (large) - do this *before* the individual combat/zone/negative/static-text trigger features, since they're designed to hang off it; building those piecemeal first would mean redoing them once the overhaul lands.
6. **P5 - everything else** medium/large and self-contained (planned features tab, example library, sounds-per-trigger, multi-step aura type, aura scale control).
7. **P6 - action bar cover replacements** last - by far the biggest single item, and a whole separate subsystem unrelated to buff tracking.

- **#7 Multi-widget advanced overlay system** — done (independent widgets with own position/size/opacity/filter/timer format/text size all exist; opt-in others'-buff tracking lives on the Self Buffs widget's own settings).

### P0 — Detection engine: architectural rework

**Status, 25 Aug: built, shipped OFF by default, not yet run against a real log session.** The
early-return-vs-evidence fix described below is now `buffEngine.js`'s `useEvidenceModel` toggle
("Use evidence-based detection" under Log page → Diagnostics); `test/evidence-based-detection.test.js`
pins what it changes.
**The roster-gap root cause below (missing spells making shared text look unique) was NOT
re-mined** — that's still open exactly as described; the evidence-model toggle only fixes the
early-return structure, not the roster gap. Keeping the original diagnosis below intact since the
reasoning is still the reference for anyone touching this.

**This is one problem with several symptoms, not several bugs. Do not fix the symptoms individually.**

The user's own diagnosis, and it's correct: *"i think the problem is memmed or not is setting an auto fail? and doesn't check others after. every check if not passed, should continue, not end the check."*

`buffEngine.js`'s `handleLine()` is a chain of detection tiers, each ending in `return`. When a tier *matches on text* but then *fails a confidence sub-check*, it still returns — so the line is consumed and every later tier that might have resolved it correctly never runs. Concretely, the `uniqueMatch` tier's `knownNotMemorized` branch logs `IGNORED` and returns, rather than demoting the match to "less certain, keep looking." The result is a hard fail where a soft downgrade was intended. **The rework**: restructure from "first tier to match wins and terminates" into "gather evidence from every applicable tier, score it, then decide once at the end." Every signal (named pending cast, unique text, spellbook membership, currently-memorized gems, burst context, recent other-casts, heal-proc lines, remembered resolutions) becomes a weighted input to one decision, not an early exit.

**SECOND, INDEPENDENT ROOT CAUSE — CONFIRMED FROM THE RAW LOG + GAME DATA. This one is arguably worse, because it poisons the evidence the tiers reason about.**

**The roster is missing 37,212 of the 48,368 spells that have a landing-text string, and as a direct result 351 landing texts look UNIQUE to the app when they are genuinely shared in the game's own data.** The "unique landing text" tier is the app's highest-confidence auto-confirm path, so it is confidently wrong in 351 distinct ways. Both of the user's reports on 2026-08-18 are instances of this, not separate bugs:

- **The 13:05:38 "You feel protected." case.** Verified directly in `eqlog_Shara_rivervale.txt` line 503132. The real answer was **Armor of Protection** — named outright on the *very next line* (`You healed Shara for 212 hit points by Armor of Protection.`). The popup offered 4 candidates and Armor of Protection was not among them, because **it is not in the roster at all** (nor in the bundled `src/shared/data/buffs.json`). Game data has 7 spells landing with that exact text; the roster has 4. So the popup wasn't mis-ranking candidates — the correct answer had been mined out of existence. *Note this also means the heal-proc auto-resolve added earlier that same session would NOT have rescued this case, since it only matches against names already in the candidate list. That fix needs widening: a heal-proc line should be able to resolve to a spell the candidate list doesn't contain.*
- **The "Brilliance" case.** App logged `LANDED "Brilliance" - unique landing text`. Not unique: `Brilliance` (id 33) and `Cassindra's Chant of Clarity` (id 1287) both land with `"Your mind clears."` The roster contains Brilliance but not Cassindra's Chant of Clarity, so it looked unique.

**Why they were excluded — confirmed by diffing included vs excluded spells:** the mining kept only spells whose duration field (field 12 in this server's `spells_us.txt` schema) is non-zero. Armor of Protection, Armor of the Faithful and Cassindra's Chant of Clarity all have `0` there, while Brilliance (400), Aura of the Crusader (1440) and Blessed Armor of the Risen (1440) do not. But the excluded ones are demonstrably real, persistent buffs — Armor of Protection visibly landed and stuck in the log above. They evidently derive their duration from something other than that field (a formula, or server-side computation). **The rule documented elsewhere in this file — "only excludes truly zero-duration (`ticks < 1`) effects" — is wrong in practice and is throwing away real buffs.** Re-mining needs a better duration rule *and* must stop treating "no duration in this field" as "not a buff".

**Care needed when re-mining:** not every one of the 37,212 missing entries should come back. Some are genuinely instant effects that share text with real buffs (e.g. `"Your wounds fade."` is shared by the buff Wolf Mending and the instant heals Greater Healing / Remedy), and some are rank variants that this project *deliberately* collapses (`Promised Renewal Rk. II/III` — see the rank-suffix gotcha). The goal is not "import everything", it's "stop the roster from making shared text look unique." A cheaper interim option worth considering: keep the roster as-is but build a *separate* index of every landing text that is shared in the raw game data, and use it purely to veto the unique-text auto-confirm tier — no roster changes, no duration questions to answer, and it removes the false-confidence problem on its own.

Confirmed symptoms of the early-return structure, distinct from the roster gap above:
- **Bard songs constantly IGNORED as "not currently memorized."** Real log: `IGNORED "Vilia's Verses of Celerity" - unique text, not currently memorized by you, track others OFF` firing repeatedly, plus `IGNORED "Amplification"`, for the user's *own* songs. Bards re-sing constantly and swap gems freely, so `currentlyMemorized` is a particularly bad signal for them specifically.
- **Disambiguation popup offered candidates that didn't include the spell actually cast.** Screenshot-confirmed: `"You feel protected."` offered Aura of the Crusader / Blessed Armor of the Risen / Kazumi's Note of Preservation / Kesiri's Gift — none of which was what the user cast. **Needs raw-log investigation before designing the fix**: pull the user's log around `13:05:38` on the day reported, find the Quick Buff activation and the memorize lines immediately preceding it, and work out whether (a) the correct spell was filtered out of `candidates` by spellbook narrowing, (b) the roster's `landingText` for the real spell doesn't match that string at all (a mining gap), or (c) the memorized-candidates tier didn't fire because `currentlyMemorized` was stale/incomplete. **Do not guess between these three** — this project's history is explicit that guessed detection fixes cause regressions.
- **Memorized-gem evidence not being used even when it was available.** User memorized spells and *then* cast Quick Buff, and the memorize lines were in the log, but the disambiguation didn't use them. Suspect the same early-return structure, but confirm against the real log rather than assuming.
- Related, already patched but only as point fixes (both need re-examining once the rework lands, they may become redundant or may need folding into the scoring model): the burst-context memorized exemption and the heal-proc auto-resolve, both listed under "Implemented, needs live confirmation" below.

### P0c — Cast time as a false-positive filter

**Status, 25 Aug: built, shipped OFF by default, not yet run against a real log session** — this
was parked below as "idea only, NOT now" and has since been built anyway, as
`buffEngine.js`'s `useCastTimeFilter` toggle ("Use cast-time-aware confirmation" under Diagnostics,
independent of `useEvidenceModel` above). Uses `CAST_TIME_RATES` (sheet-sourced per-mote-tier cast
time deltas) plus a confirmed Spell Casting Deftness AA multiplier, with a 500ms tolerance either
side for log-timestamp rounding. The "why parked" reasoning below is kept
for context on what it does NOT yet handle (nothing beyond the sheet's per-category rate and the
one confirmed AA multiplier — haste/focus effects still aren't modelled).

User's note, recorded so it isn't lost: **cast time should eventually narrow the window in which a landing can plausibly be the player's own.** A spell that takes ~3 seconds to cast doesn't need the app listening for its landing text for anything like the current window - anything arriving well outside that window is far more likely to be someone else's cast landing on the player. That would cut false positives in the tiers that currently rely on loose time windows (`FALLBACK_CONFIRM_WINDOW_MS`, `BURST_WINDOW_MS`).

**Why this is parked rather than queued**: cast times are *dynamic* on this server - haste, focus effects, AA, and the same rank-scaling mechanic already documented in backlog #13 all move them, so the static value in `spells_us.txt` (field position not yet identified) is a starting point at best, not the real number. Doing this properly means modelling per-cast timing rather than reading one field, which is a big change and should land **after** the P0 detection rework, not before - the rework replaces the early-return tier structure those windows live inside, so building this first would mean building it twice.

### P0b — Attribution should be "who did I see cast this", not a self/ally veto

**Status, 25 Aug: partially addressed.** `recentOtherCasts` is now a `Map` from spell name to
`casterName` (was a `Set`, name-only), and `_recentOtherCaster()` retrieves it — no longer thrown
away. This is what bard-song caster attribution (note 15, `_attributeBardSongCaster`) actually
reads. It's still used as a veto/attribution signal in the places described below, not yet folded
into a general weighted-evidence model the way the user's proposed model asks for — that's the
part still open, tracked as part of the wider P0 evidence-model work above.

Raised by the user, and the code confirms the problem: **`matchOtherCastBegin()` returns `{ casterName, spellName }` but `buffEngine.js` throws `casterName` away** — it only does `recentOtherCasts.add(spellName)`. So the engine knows *someone else* cast a spell but not *who*, and uses that solely as a **veto**: the landing then gets `IGNORED` outright (track-others off) or blind-landed as the player's (track-others on). There is no path that attributes an observed cast to the ally who cast it. (`allyBuffs` is a different feature entirely — buffs the *player* casts *on* groupmates, matched via third-person landing text.)

User's proposed model, which is better and should shape the rework:
- Positive evidence (currently memorized, remembered resolution, named pending cast, heal-proc) can affirmatively say "yes, this is yours."
- Absence of that evidence must **never** be treated as proof it *isn't* yours — today it is, which is the same early-return failure as the main P0 item.
- When an ally is observed casting something, record it **as seen from that ally** (keep `casterName`) rather than as a nameless suppression flag.

Applies to bard songs especially, but it isn't song-specific — it's the general attribution model.

### P1 — Bard song handling (containment, pending the P0 rework)

User's position, verbatim: *"BARD SONGS PROBABLY NEEDS TO NOT CARE ABOUT ALLY VS SELF. AND HAVE A NOTE THAT IT DOESN'T. CAUSING TOO MANY PROBLEMS. MARK AS EXPERIMENTAL"*, and *"i think bard songs need to be removed from self buffs entirely and moved into it's own bard song widget because it's impossible to tell"*.

- **[DONE] "Hide bard songs" did nothing — root cause was tagging, not filtering.** Both filter sites (`overlay.js`'s `visibleBuffs()`, `main-window.js`'s `filterActiveBuffsForWidget()`) were correct all along; the live roster simply had **1 of 11,337** entries flagged `isBardSong`, because `markBardSong()` only ever fires from a live "You begin singing X." line, one spell at a time, for spells the player personally sings. Fixed by `src/main/bardSongTagger.js` — see gotcha #14. Live roster went 1 → 347 tagged.
- **[DONE] Bard songs are now opt-in on Self Buffs.** `hideBardSongs` defaults to `true` for new widgets, plus a version-gated `widgets.json` v1→v2 migration that set it `true` on existing widgets exactly once (so a later "yes I do want songs" choice isn't stomped every launch). The checkbox is relabelled **"Show bard songs"** and inverted in the renderer — the persisted field is still `hideBardSongs`, deliberately not renamed to avoid a data migration for no benefit.
- **[DONE] Bard songs and "Track buffs cast on me by others" both carry an Experimental badge** (`.experimental-badge`), with hint text on each stating plainly that self-vs-ally is not reliably knowable from the log.
- **[DONE, 25 Aug] Dedicated Bard Song aura** — this is backlog #15 below; see that note's writeup for the full build (caster attribution via `_recentOtherCaster`/`recentSelfCast`, its own `bardSongs` map, unconditional ally-cast landing for songs specifically). Deliberately doesn't care about self-vs-ally by design, not as a placeholder — revisit only if the P0 rework above ever makes the distinction genuinely recoverable.

### Awaiting live confirmation

A large amount has been built but never confirmed in real gameplay. **`docs/TESTING.md` is the live checklist** - it lists every unconfirmed item with what to do and what to expect, and is the single source of truth for that. Do not duplicate it here.

### Bugs / copy accuracy (unsized - needs clarification first)
- The "Where buff data comes from" text in the app needs updating. User didn't specify what's wrong with the current wording - ask before touching it.

### P2 — Features: quick wins

**All seven items below are DONE, checked directly against the running code 25 Aug 2026** (this
list had gone stale - it was still describing "Open sounds folder" as newly added at the top of
the Sounds section, a disabled placeholder for the two text-colour pickers, and a disabled
placeholder for the margin-width slider, none of which is true any more):
- Buff library: "Add a new buff..." is the leftmost button in the Custom buffs card, beside "View custom buffs...".
- Active profile chip is solid brass (`--accent` fill, dark text) when active - see `.profile-chip.active` in `main-window.css`.
- Main window size/position persists across launches - `src/main/mainWindow.js`'s `restoredBounds()`, saved to `mainWindowBounds`, falls back to a centred default only when nothing's saved or the saved spot is off-screen.
- "Unlock to move" / "Reset position" now live in the Display & size block, styled `.btn-prominent`.
- "Open sounds folder" is the last control in the Sounds section, after the warning/loop sliders.
- Timer text colour and label text colour (`widget-timer-text-color-picker`/`widget-label-text-color-picker`) are fully wired - `setWidgetTimerTextColor`/`setWidgetLabelTextColor`, populated from the selected widget on open.
- Margin width (`widget-margin-width-slider`) is fully wired to `setWidgetIconMargin`, same pattern.

### P3/P4/P5 — Features: medium
- ~~Sounds section should only expand the sound-picker controls once the relevant "Play a sound" toggle is on~~ — **DONE, checked 25 Aug.** `widget-sound-land-row`/`widget-sound-expire-row` stay hidden until their own checkbox is on, and "Warn before expiry" is a checkbox (`widget-sound-warning-checkbox`) that expands its own sub-options, not a bare slider - see `initTradePing`'s neighbor wiring in `main-window.js` around line 3896.
- ~~Alerts and Sounds topics maybe merge into one~~ — **DONE, 25 Aug.** One topic ("Alerts & Sounds"), same `topic-alerts` id and every field's own element id unchanged from before the merge - `main-window.js`'s `alertsTopicEl`/shape-field gating needed zero code changes. The warning sound picker already sat directly under its own warning-threshold slider before this; the merge was the two *topics* becoming one, not a rearrangement within either.
- ~~"Planned features" tab in the app itself~~ — **VETOED, 25 Aug.** Owner's own words: *"veto the planned page, i don't care about it."* Not building this - kept here only as a record so it doesn't get re-proposed without that context. A stub "Action Bars" nav tab/page was added the same session instead (see the Action bar cover replacements entry below) - genuinely different ask, not a substitute for this one.
- Combat detection as a new custom-timer trigger type (open question: what exact log signal marks entering/leaving combat on this server - needs a real log sample before this can be scoped further).
- ~~Zone detection as a new custom-timer trigger type~~ — **DONE (25 Aug), awaiting live confirmation in docs/TESTING.md.** Distinct from the existing "Only in" zone-gating (`widgetStore.js`'s `visibleInZones`, persistent whole-aura visibility) - this is a momentary, one-shot trigger: the instant the player enters or leaves a picked zone, the timer starts for the aura's own `triggerDurationSec`, same as any other custom trigger. Clarified with the user before building, since the overlap with "Only in" wasn't obvious at first glance - confirmed they wanted the timed one-shot event specifically ("a 30s reminder that fires once on zone entry"), not persistent visibility, which "Only in" already covers. Two new `triggerMatch` modes, `zoneEnter`/`zoneLeave` (added to `TRIGGER_MATCH_MODES` in `widgetStore.js`, same whitelist gotcha #28 warns about), with `triggerText` holding a zone name rather than a line - same shape as `castOf`. `customTimerEngine.js` keeps its own `currentZone` (mirrors widgetManager's separate copy, same DI reasoning as everywhere else in that file), computed from `matchZoneChange()` against the RAW line (that function is timestamp-anchored by design, so `_findTriggerMatches` now takes the raw line alongside the stripped one). `zoneLeave` needs the zone being left, which `matchZoneChange` never reports on its own - tracked as `zoneLeft = this.currentZone` before it's overwritten, so the very first zone change this engine ever sees can only fire an "entering" trigger, never "leaving" (nothing was tracked yet to have left - same never-replay-history limitation as `currentlyMemorized` and widgetManager's own zone tracking). The zone picker reuses the same `knownZones` list the "Only in" picker already fetches once at startup - no separate IPC round-trip. See `test/zone-trigger.test.js`.
- ~~"Negative"/inverse triggers~~ — **DONE (25 Aug), awaiting live confirmation in docs/TESTING.md.** A real, working "Reverse detection" checkbox now sits in the Custom triggers card next to "+ Add trigger" (was a disabled+Planned per-trigger checkbox in the timer modal - moved and reworked after Shara's correction: *"reverse should not be in each individual trigger, it should be a global functionality of an aura, so that you can set 2 AND triggers without having to mess with both triggers separately."* `widget.reverseDetection` is whole-aura, and rides on whatever `triggerCombineMode` already decides "fires" for that widget - independent (each trigger its own default-visible tile, its own hide-on-fire), AND (one combo tile, stays on until every trigger in the set has been seen - the motivating case: *"a tile that is marking 'this skill is ready, cast it to make it go away'"*), OR (one combo tile, goes off the moment any one fires). Rather than pre-seeding a "not yet triggered" entry into `activeTimers` (which would need invalidating on every widget CRUD path), `customTimerEngine.js`'s `getActive()` synthesizes the default-visible tile(s) live for any reverse-mode key not currently "hiding" - the same live-computation reasoning as `overlay.js`'s `alwaysOnEntry()` and BuffEngine's live icon lookups. `activeTimers` only ever holds a reverse-mode key (a definition's own id in independent mode, or the widget's `and:<widgetId>`/`or:<widgetId>` combo key) while `phase:'hidden'`, shaped and expired exactly like an ordinary `phase:'duration'` entry, so snapshot/restore needed no special-casing either. Renders through the same tile pipeline as every other custom-timer buff (an infinite buff, `remainingSec: null`), so it works in icon/tile, list, and text display modes with no extra rendering code. See the engine's own header comment above the class for the full design, and `test/reverse-trigger.test.js` for the engine-level tests, including the AND-combo case.
- ~~Static text label display mode~~ — **DONE.** `displayMode:'text'` in `widgetStore.js`, chosen once at aura creation - a text aura draws one line and nothing else, no icon, no bar, no countdown, exactly this ask.
- ~~Example library entries in the premade-widget list~~ — **DONE, 25 Aug.** "Skill ready reminder" in the Timers group - reuses the whole Cooldown timer picker/creation path unchanged (`buffTimerReverseExample` flag threaded through `resetBuffTimerPanel`), then flips `reverseDetection` on for the finished widget via the same `setWidgetReverseDetection` call the Custom triggers card's own checkbox uses. Deliberately not a second Cooldown timer under a different name - it demonstrates what Reverse detection does against real spell data, which is genuinely non-obvious. See `test/example-library.test.js`.
- Sounds scoped per-trigger instead of per-aura (open question from the user, phrased as a "maybe") - would move alert-sound settings from one set per aura to one set per individual buff/trigger within an aura. Worth weighing against the added settings-UI complexity before committing to it.

### P4/P5/P6 — Features: large / re-architecture, design first
- **Custom timer creation overhaul — DONE for the timer form itself.** The old flow had the add-form sitting inline in the Custom timers topic, with a list below whose Edit button reached across to populate it; add and edit felt like two different screens. Now a `+ Add timer` button opens `#custom-timer-modal-backdrop` with every field visible and active, and Edit opens the same modal pre-populated (title switches Add/Edit, primary button switches Add timer/Save changes, "Save as new" only appears while editing). `populateTimerForm()` was split out of the list's Edit handler so both paths share one form. Deleting the timer currently open closes the modal rather than leaving a stale form. The trigger-type picker inside it is data-driven — `TRIGGER_TYPES` in `main-window.js` at **module scope** (it must be initialised before `renderTriggerTypeChoices()` runs, which happens before the mode radios are queried; declaring it inside `initWidgetsPanel` put it in a temporal dead zone and threw at startup). Adding a real trigger type is: add an entry with a `fieldsId`, add that panel's markup, handle the mode in `readTimerFormData`. Zone change and Combat state ship as disabled Planned entries. The Reverse-detection checkbox is no longer one of them - see the P3/P4/P5 entry above, now DONE. **Still open**: this covers the per-timer form only — the user's broader note also wants the *Add Aura* modal itself reworked the same way.
- **Multi-step/sequential aura type.** A new aura *kind* (chosen from the Add Aura modal, not a setting on an existing kind) where a defined sequence of triggers must fire in order, and only ONE icon/list line is ever active at a time across the whole sequence - unlike every current aura type, where multiple tracked items can be active simultaneously. Real new data model + engine behavior, not a tweak to `customTimerEngine.js`.
- **Aura scale option.** A single unified scale control (under Size) that scales icon + list + text together in one motion, draggable directly on the overlay via the existing blue move-mode box - an alternative to today's separate icon-size/text-size sliders. User raised their own open question: whether this should just *replace* icon size outright to cut down on option sprawl, rather than living alongside it.
- **Action bar cover replacements.** An entirely new overlay category, unrelated to buff tracking - small images/borders placed over the game's actual hotbar buttons, with a configurable action-bar layout and a size-percent control, ranging from full custom icons down to plain colored/transparent border frames (border-image support explicitly not built yet). By far the biggest single item in this whole list - treat as its own feature area, not an extension of the widget/aura system. **Stub added 25 Aug**: a real "Action Bars" nav tab and page exist (`page-action-bars` in `index.html`) with a "Coming soon" card and nothing wired to anything - requested directly as "a temp tab... we'll work on that next anyway", i.e. this is next in line, not started.
  - Follow-on once that exists: pixel-stepper nudge controls for fine-positioning each action bar cover.
  - Follow-on/parallel, but possibly useful for buff icons too, not just action bar covers: general icon border support.

### Parked / low priority
- **#13 Rank-numeral duration scaling** — EverQuest Legends appends a trailing rank numeral to some cast-begin lines only (e.g. `"You begin casting Spirit of the Puma VII."` — landing/ended text stay numeral-free). Confirmed via direct `spells_us.txt` lookup that this is **not** the same mechanism as Yaulp's real per-tier spell IDs (Yaulp II–XIX genuinely exist as distinct spell IDs; Cannibalize VII/Malosi V/Promised Renewal IX do **not** — those numerals have no matching spell ID at all). So it's a custom server-side duration scaling effect layered on top of the base spell, not a roster/mining gap — do not attempt to "fix" this by re-mining. One data point so far: Spirit of the Puma (spell ID 6906, base 60s) observed landing at ~162s while cast at rank VII with the user's existing 65% Reinforcement+Exaltation multiplier already active — not enough alone to solve for the scaling formula (could be linear-per-rank, %-per-rank, or table-based, and this one point can't isolate the rank-VII bonus from the existing 65% multiplier already stacked on it). **Next step**: collect 2-3 more rank/duration pairs (different numerals on different buffs) — when the user reports a buff name after it wears off naturally in play, pull exact cast-begin/expire timestamps directly from the live log file (`eqlog_*.txt`, path in `config.json`'s `eqFolder`) rather than asking for manual stopwatching. Once a formula is fit, wire it in as a second multiplier alongside `durationMultiplierFor()` in `src/main/main.js` (`buffEngine.setDurationMultiplierFn` already supports composing factors).
- **#14 "You Have Been Dispelled" event-notification widget** — a premade widget idea, listed as a disabled "Planned" placeholder in the Add Widget modal's premade list (`main-window.js`'s `PLANNED_PREMADE_WIDGETS`) but not built. Not a duration/countdown widget like every other widget kind — a one-shot flash/message when the player's own dispel line lands (`"You feel very dispelled."`, confirmed in the live log; other severities like `"You feel a bit dispelled."` likely exist too, unconfirmed). This is a genuinely different widget *category* (event notification, no timer, no active/inactive state) from everything `widgetStore.js`/`overlay.js` currently model, so building it means designing that category, not just adding another `buffSource`.
- ~~**#15 "Bard Song" premade widget**~~ — **DONE (25 Aug), awaiting live confirmation in docs/TESTING.md.** The answer to "what makes it worth a dedicated widget": caster attribution. Tracks every bard song currently active ON THE PLAYER, regardless of who cast it (self or an ally), grouped by caster when `buffEngine.js` can actually tell, falling into a visible "Unknown" group otherwise rather than guessing. Purely additive at the detection layer - a new `bardSongs` Map, populated alongside (never instead of) `activeBuffs` from inside `_land()`, keyed `${casterKeyLower}::${songNameLower}` (same shape as `allyBuffs`, so two different casters maintaining the same song on the player are two entries, not one overwriting the other - `activeBuffs`'s name-only key can't do that). Attribution (`_attributeBardSongCaster`) is computed once, generically, from two signals that already existed for other reasons and were previously discarded the instant a buff landed: `recentSelfCast` (the player's own confirmed cast, self-first priority when both signals are live at once) and `_recentOtherCaster` (a groupmate's own third-person cast-begin line, previously only ever used for debug-log text - this is the first place its answer is actually acted on). Neither signal firing means genuinely unattributable, not a guess - "Unknown" bucket.

**The unique-landing-text tier's four "might be someone else's" vetoes are waived for bard songs specifically, regardless of the global "Track buffs cast on me by others" toggle.** First built to inherit the ordinary gate (an ally-cast landing stays `IGNORED` unless that toggle is on), which was correct for the P0/P0b work this session started from - but live-tested against the real log with the toggle off, and Shara's actual words watching it happen: *"bard songs should have this enabled by default as you cannot separate them."* That's the same conclusion CLAUDE.md's P1 section already reached (self-vs-ally is genuinely undecidable for songs from the log alone) applied to vetoes that were built for spells where it IS decidable - landing unconditionally is what lets `_attributeBardSongCaster` actually answer "whose is this" instead of the log silently dropping the evidence before that code runs. `trackOthersForThis = this.trackOthersEnabled || known.isBardSong` replaces the raw toggle at all four veto points inside the unique-landing-text tier (`_hasRecentOtherCast`, never-scribed, stale-gem legacy, allies-bursting legacy - `buffEngine.js` around line 1013 onward); the deeper ambiguous-candidates tier (shared landing text, rare for songs post-mining-rework) is untouched, out of scope. Confirmed live by injecting synthetic lines into the real combat log with the toggle OFF the whole time: self-cast → `BARD SONG "Anthem de Arms" - attributed to You`, no cast-begin evidence → `attributed to Unknown`, third-person ally cast-begin → `attributed to Avenrae` - all three in one debug-log session, `test/bard-songs.test.js` also pins a same-toggle-off regression test that an ORDINARY (non-song) ally-cast spell is still correctly `IGNORED`, so the waiver stays scoped to `isBardSong` and doesn't leak into general detection. New premade widget (`bard-songs-builtin` kind, `BARD_SONGS_KIND` exported from `widgetStore.js`), following the Ally Buffs pattern (repeatable, user adds it from "+ Add aura", not a fixed singleton). Settings panel deliberately excludes the buff picker (`self-buffs-filter` - this aura's whole content already is bard songs, unconditionally) and "Track buffs cast on me by others" (global engine state, not per-widget, already lives on Self Buffs) - only the same visual/alert fields Self Buffs and Ally Buffs both have, plus Ally Buffs' grouping UI, reused verbatim: `getActiveBardSongs()` emits the caster into the SAME `allyName` field `getActiveAllyBuffs()` already uses, which is what let the existing `overlay.js` group-by-player rendering work with zero changes. See `test/bard-songs.test.js` for the engine-level tests, including two casters on the same song, ended-text/expiry not crossing between casters, and snapshot restore.

## Working with Shara

- **She is not a programmer and tests in game.** Anything only checkable with the client running
  goes in `docs/TESTING.md`, unchecked. Never claim something works that has not been seen working.
- **Anything sitting in `docs/TESTING.md` awaiting her is DONE, not partial.** Her instruction, 23
  August: *"tests are not work for you, anything that needs to be tested by me later goes in
  there."* Marking such work partial measures my confidence rather than the state of the work.
- **When she states a game fact, that is evidence.** *"you do not need proof, it happens... the
  proof is that I told you it is."* Twice now a measurement of mine appeared to contradict her and
  she was right both times — the song pulse (confirmed at 314,324 six-second gaps) and the
  Celestial Healing spread (which was recasting, not AA scaling). Measure to get the *number*, not
  to decide whether to believe her.
- **Do not drive the app with synthetic clicks.** EverQuest runs live on this machine and a stray
  automated click has already landed in her game window. Launching the app is fine —
  `tools/smoke-launch.js` starts real Electron, holds, reports, and clicks nothing.

## Packaging

`npm run dist` (electron-builder, NSIS installer) works but hit a real environment issue worth knowing about: electron-builder tries to download/extract a macOS code-signing tools archive (`winCodeSign`) even for a plain unsigned Windows build, and extracting it fails on Windows without Developer Mode enabled (symlink permission error on two irrelevant `.dylib` files). Fixed by manually extracting the archive with `darwin*` excluded and placing it at the expected cache path (`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\`) — that cache entry should persist across rebuilds on this machine. If it ever needs redoing on a fresh machine, don't ask the user to enable Windows Developer Mode as a first resort; this workaround avoids that.

The app also has `app.requestSingleInstanceLock()` — running two copies at once was a real, confusing bug (two independent log watchers + two overlays + two buff engines, and it's not obvious which one you're looking at). Don't remove this guard.

## Testing approach that's worked well

- Live-test against the user's real log file — append synthetic lines with `echo "[timestamp] text" >> <logfile>` to simulate casts without needing to actually play, then check the split-log output and/or the app's Active Buffs list.
- For packaged-build-only bugs: temporary file-based debug logging (`fs.appendFileSync` to a file in `app.getPath('userData')`) since packaged Windows GUI apps don't show console output even launched from a terminal. Always remove before shipping.
- **Mutation testing, every time.** Break the rule on purpose, confirm the test fails, restore.
  This session it caught **eight tests that passed while proving nothing**: two that returned early
  when their fixture was missing, one that searched for a string absent from the file, one whose
  900-character window spilled into the next function and found the word it wanted there, one
  comparing two timestamps taken in the same millisecond, one asserting a flag on a spell the flag
  could not affect, and two picking an example where a second mechanism covered for the one under
  test. A green suite is not evidence until it has been shown it can go red.
- **`node tools/replay-log.js`** before and after anything touching detection. It runs 1,521,971
  real lines through the real engine. The baseline is **129 distinct buffs, 211,546 landings, 840
  ally landings, 27 prompts, 91 unknown texts** — all five must be identical, because Shara's
  constraint is that *"if any functionality is lost during this process that is to be considered a
  failure."*
- **`node tools/smoke-launch.js`** before saying the app works. Tests never start Electron, and a
  `globalShortcut.register('Pause')` that *throws* rather than returning false shipped past a
  green suite once because of that.
- Unit-test detection logic changes directly against the real roster via a quick inline Node script (mock the `store` object's `loadJson`/`saveJson`, instantiate real `BuffStore`/`BuffEngine`, feed synthetic log lines) before rebuilding the whole app — much faster iteration than a full Electron rebuild cycle each time.
