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
- **But never show more tiles than is accurate** (owner, 1 Sep). The app can't see the character's active level, so it must not *invent* buffs. Landing the 11 buffs Quick Buff actually dropped is fine — that's the case above. Landing all 4 candidates of a shared landing line when only 1 or 2 landed is **not** fine: a buff that didn't land showing on the overlay is worse than one that did being mislabelled. This bounds the rule above — permissiveness is for "*which* of these did I cast", never "*how many* landed". If a wrong remembered ambiguous resolution ever does need addressing, that is a correction path — not more permissive landing. (The owner declined building one for the Shield of Words case, 1 Sep — the stale resolutions stay and keep applying; that's accepted, not a bug to chase.)
- **Rank suffixes ("Rk. II/III", trailing Roman numerals) are not part of a spell's real name** for matching purposes — but see the important nuance below: this is *not* universally true and blindly stripping broke things once already.
- The user wants to eventually **package and hand this app to other people** — it now builds a real Windows installer (see Packaging section). Keep `npm run dist` working.
- Collaboration style: the user tests live in-game and reports exact symptoms/screenshots. When something breaks, they want it *actually* root-caused (see the "duplicate instance" and "packaged build" debugging episodes) — not a guessed fix. Prefer adding temporary file-based debug logging (packaged Windows GUI apps have no visible console) over guessing, then removing it once confirmed.

## Architecture

- `src/main/main.js` — entry point, wires everything together, all `ipcMain` handlers. Every log-line consumer is called inside a per-listener try/catch (`_lineHandlerFaults`), so one throwing handler can't kill the line bus for the others. The first fault per `(label, error-type, first-stack-frame)` signature (`_faultSig()` — deliberately not the error message, which can interpolate data and make a fresh key every throw) emits a `diagnostics:lineHandlerFault` broadcast carrying the human-readable message; at most `_LINE_HANDLER_FAULT_CAP` (50) distinct signatures per session, then further faults are swallowed. **Nothing renders that broadcast yet** — it's wired for a future diagnostics surface (share-code hardening follow-up, PR #41).
- `src/main/logWatcher.js` — tails the newest `eqlog_*.txt` in the Logs folder, polls every 200ms, never replays history. `resyncOffset()` re-anchors it past a kept tail after a trim so nothing is re-emitted.
- `src/main/logSplitter.js` — continuously copies the log into per-day (and optionally per-session-gap) files; also has manual "Archive log" (copy + truncate) support in `logService.js`. A re-split from offset 0 **dedupes against the day file's own tail** so lines are not doubled.
- `src/main/logRotation.js` — the weekly log rotation, **ON by default** (see "Lockouts and log rotation" below). `trimAtBoundary()` is the manual "Trim log to this week" (backward EOF scan via `findWeekStartOffset`); `logHoldsCurrentWeek()` feeds the archive-now danger warning; it refuses to rotate a log with play after the reset (`skippedSpansBoundary`).
- `src/main/lockoutCore.js` — pure raid-lockout parser (no `require`, no clock, no fs; lines + explicit `now` in, JSON-clonable state out). EQL prints **no lockout line**, so it keys off the weekly-task assignment lines around a boss kill. **No reset day is hardcoded** — `projectReset()` returns `provenance: 'not recorded'` until it has seen the same weekly assigned on both sides of a turnover. Provenance for every fact it relies on is in `docs/EVIDENCE.md` — read that before touching it.
- `src/main/lockoutService.js` — wires `lockoutCore` to the app: backfill reads **only the live log** (was a whole-Logs-folder scan), plus `setLogTarget` ("Change log file"), `addLogs` ("Add split files", gap-gated), single-flight `rebuild()`, and `extraLogs` count.
- `src/shared/easternReset.js` — resolves the weekly reset in `America/New_York`, DST-aware, `now` passed in. Consumed by `lockoutService` and `logRotation`. The reset day/hour is user-editable (store key `lockoutReset`, IPC `lockoutReset:get/set`, mirrored between the Lockouts page and Setup as one setting); default **Tuesday 11:00 US Eastern**.
- `src/main/buffParser.js` — pure regex/text helpers: cast-begin ("casting" **and** "singing" — bard songs use a different verb), AA "activate" lines, failure messages, party join/leave messages, generic landing-text heuristics, and `stripRankSuffix`.
- `src/main/buffStore.js` — buff database (`{name, durationSec, landingText, endedText, iconId, showOnOverlay}`). **The install (`src/shared/data/buffs.json`) is the source of truth for spell data, rebuilt fresh on every launch, not a version-gated one-time migration** — see gotcha #29. Only three things persist in userData across that rebuild: a fully custom entry (`custom: true`), a spell the user hand-corrected via Known Buffs' Save button (`edited: true`), and three small per-spell toggles with no install-side value (`showOnOverlay`; `isBardSong` once `isBardSongUserSet`; `noDurationScaling` once `noDurationScalingUserSet`).
- `src/main/buffEngine.js` — the actual detection state machine. **Read the big comment block at the top of this file before touching detection logic** — it documents the full priority order (named cast > unique landing text > spellbook-narrowed ambiguous text > burst-window ambiguous text > opt-in others'-buff prompt) and why each layer exists.
- `src/shared/spellStackingEngine.js` — the **full EQEmu `CheckStackConflict` port** (every mechanic: same-effect-slot collision, `SPA 148/149` block/overwrite directives, bard-song separation, rank ladders, `calcSpellValue` formula table). Pure, no deps. `verdict(a, b)` → `-1` incoming blocked / `0` stacks / `1` incoming overwrites the worn one. Parity-verified 100% over 6.75M verdicts against the reference implementation (`tools/stacking-parity.js`, `test/spell-stacking-engine.test.js`). Replaced the old `spellStacking.js` effect-slot heuristic, which is **deleted**; `spellEffects.js` now gets its stat magnitudes from this engine's `calcSpellValue`.
- `src/main/stackingService.js` — binds that engine to the live roster. `makeStackingService(buffStore)` → `{ verdict, planConflict, wouldOverwriteLive, invalidate }`. `wouldOverwriteLive` is what `buffEngine._land` calls for the stale-tile sweep; `planConflict` (checks both directions, returns `{ overwrites, blocked, conflict }`) is what the Buff Planner calls. `invalidate()` on roster rebuild.
- `src/shared/buffLines.js` + `src/shared/data/buff-lines.json` — the **curated heading model** (see `docs/BUFF-STACKING.md`). A *heading* is a mutually-exclusive effect slot; a *line* is an upgrade ladder sharing a heading. `stackDecision(incoming, active)` → `overwrites` / `blocked` / `coexist` / `unknown`. `stacksExplicitly(a, b)` is true **only** for an authored `stacksWith` link — a plain `coexist` fall-through (no shared heading, no recorded conflict) is *weak* and the ported engine may still veto it. `blockedPairs` carries 33 directional "X did not take hold, blocked by Y" observations mined from real logs. Curated decides first everywhere; the ported engine fills `unknown` and overrules weak `coexist`.
- `src/main/profileStore.js` — named loadout profiles (see gotcha #9), one active at a time; `buffEngine.js` keeps a separate self-cast ambiguous-resolution memory per profile, switched via the chip bar at the top of the main window.
- `src/main/gameSpellData.js` — the single shared parse of the game's own `spells_us.txt`, lazily loaded and cached per install root. Exists because several features need facts about spells the app's roster deliberately *doesn't* contain (nukes, heals, anything the mining filter dropped): currently which spells are bard-only, and icon art for any spell by name. **Field positions were all established empirically against the user's real file, not assumed from EQEmu docs** — name is field 1, the 16 per-class levels are 36–51 (255 = never castable, Bard at offset 7), and the icon id is **field 75** (verified by scanning every field against the roster's own `iconId` across 40 sampled buffs: field 75 matched 40/40, no other field matched more than 2). If a future change needs another field, verify it the same way rather than trusting a schema doc — this server is a custom ruleset.
- `src/main/bardSongTagger.js` — flags every bard-only spell in the roster as `isBardSong`, using `gameSpellData.js`. See gotcha #14 for why this exists and why it's additive-only.
- `src/main/damageEngine.js` — the damage meter (note 19). Reads damage lines, decides which are *outgoing*, and emits one row per attacker for the current fight. **Direction is derived, never guessed from name shape** — you are on your own side, anything you damage is an enemy, anyone damaging a known enemy is a friend, anyone damaging a known friend is an enemy. That bidirectional bootstrap took credited damage from 22% to 65% of a real log day. See gotcha #20 **and gotcha #40** (a charm-war zone was collapsing the bootstrap — damage-shield lines never teach a side now, a `groupRoster`-confirmed member is a friend with no bootstrap needed, `<member> hits X` proves X an enemy the way `You hit X` does, and `_learnFriend`/`_learnEnemy` refuse to put a name on a side the other set already holds). Per-aura `damageRowCap` (default 6, 1–20, in `SHAREABLE_FIELDS`) caps how many attacker rows draw; the total row is exempt from the cap (it still obeys its own `showTotalRow`). An article-prefixed attacker classified friendly (a wild charm) folds into the "Charmed pets" row, never its own.
- `src/shared/damageLines.js` — the five damage wordings, each carrying the count it matched across 1,521,971 lines. Split out of the engine so tests exercise the real patterns. See gotcha #21 for the possessive trap.
- `src/shared/data/zoneGraph.js` — 104 zones, their connections (`land`/`boat`/`portal`) and 61 travel spells, for note 20. Sourced EQL-specific and cross-checked against three others; **38 display names are inferred and flagged `nameConfidence: 'inferred'`** because the player has never entered those zones. Generated once from research; nothing regenerates it, so edits belong in the file. **Some zones are one-way sinks** — The Hole (enter via Paineel; Erudin/Neriak pads inside are exit-only, QOL #32) and Plane of Hate (enter via Oasis of Marr; leave by Gate/Origin, so its outbound `connections` are empty, QOL #43). Same shape as the instance-tier exclusion in gotcha #23. Provenance for the tricky edges is in the caveat comment at the bottom of the file.
- `src/shared/data/zoneAliases.js` — 191 curated community nicknames / raid-boss names for zones (from `docs/EQTM-ALIASES.md` §6) plus an auto-indexed client short-name (QOL #30). `searchPickableZones()` unions substring + alias + short-name matches (exact-or-prefix, 2-char floor); `travel:searchZones` IPC feeds the `zone-prompt` renderer. Aliases are matched but deliberately **not listed** in real-zone results (QOL #31's rule).
- `src/shared/zoneRouting.js` — breadth-first routing over that graph, plus `resolveDestinationName` for note 20's `/tell` command. **Breadth-first and not Dijkstra on purpose**: weighting a boat against a zone line would be inventing numbers nothing measures. See gotcha #22.
- `src/shared/travelCommand.js` — recognises the game's `"<Name> is not online at this time."` reply to a failed `/tell`, which is how the travel guide's destination is set from inside the game. See gotcha #23.
- `src/shared/shareCodeChat.js` — spots an aura share code pasted into chat (note 30). **Recognises and never applies**; see gotcha #24. **Share code v3 (3 Sep):** `widgetStore.exportCode` writes `'EQa1' + base64url([kindByte] + deflate(numeric-keyed diff))` — a bare default aura is ~6 chars (was ~79). The aura kind is one byte (`SHARE_KINDS` index); a changed field is its index in `SHAREABLE_FIELDS`, which is now a **wire format — APPEND ONLY, never reorder or delete**. `name` is never encoded (the recipient names it); `position`/`width`/`height` were already excluded; a customTimer's UUID is stripped on export and regenerated on decode (before `sanitizeCustomTimers`, which drops id-less entries). Legacy `'EQLSAURAS1-'` codes still decode (`V2_SHARE_CODE_PREFIX`). `encodeShareCode` is exported for tests.
- `src/shared/zoneVisibility.js` — the one zone-visibility rule, extracted so tests import it rather than reproducing it. It exists because a reproduced copy passed four times while the real rule was inverted.
- `src/main/sessionSnapshot.js` — persists live timer state (self buffs, ally buffs, custom timers) so a restart does not wipe everything currently running. Restores only within a 5-minute grace window. See gotcha #19.
- `src/main/foregroundWatcher.js` — polls (**300ms**, a self-rescheduling `setTimeout` loop rather than `setInterval` so a slow respawn can't pile up queries; was 2000ms, tightened after a live report that a 2s poll made the overlay visibly slow to show/hide when swapping windows — inline PowerShell/P-Invoke, no native module) which of EQ / this app owns the foreground window, emitting `{ eqFocused, ownAppFocused }`; `widgetManager.setForegroundHidden()` hides/shows enabled widgets from it, matching on `eqgame.exe`'s process name (see gotcha #10 for why process name, not window title, is the match target, and why it also matches this app's own process). On by default, Setup-page checkbox to turn it off. The same PS query also calls `SHQueryUserNotificationState` and sets a `foregroundFullscreen` flag on state 3 (D3D fullscreen) / 4 (presentation) — `main.js` turns that into an `overlay:fullscreenWarning` broadcast and the Buff Tracker page shows a "auras can't draw over exclusive full-screen" line (QOL #9; the P/Invoke is doc-verified, not yet run on the real machine).
- `src/main/spellbookService.js` — auto-detects and parses the character's `<CharName>-<Class>-Spellbook.txt` file (found in the EQ install root, not Logs) to know exactly which spells the player has scribed; this is the primary disambiguation signal for self-buffs. A manual **character/server override** (`setCharacterOverride()` / `_effectiveBaseName()`, store key `spellbookCharacter`, IPC `spellbook:getCharacter/setCharacter`, QOL #14) beats the log-derived name when set — for when auto-detection picks the wrong log or none. `getExpectation()` reports `manualCharacter`.
- `src/main/iconExtractor.js` / `iconService.js` — reads real spell icon art directly from the user's own EQ install (`Textures/Alternate N/SpellsNN.tga`, hand-rolled TGA reader + PNG encoder, no deps), served to renderers via a custom `eqicon://` protocol, cached in userData. Icon set (Alternate 1/2/3) is user-selectable since they're genuinely different art styles.
- `src/main/overlayWindow.js` — the actual transparent/click-through always-on-top overlay (currently a single window, not yet the multi-widget system).
- `src/main/soundService.js` — custom alert sounds. Mirrors `iconService.js`'s pattern exactly (same reason: a sandboxed renderer can't load an arbitrary local file path directly) - a native file picker copies the chosen audio file into `userData/customSounds/` under a fresh id, served back to renderers via a registered `eqsound://` protocol. Each widget has three independent slots (`landSoundId`/`expireSoundId`/`warningSoundId`, one per alert type, not one shared sound) - `null` means the original synthesized beep in `overlay.js`. **A picked sound is still saved under `userData` on purpose** - see the userData-in-install-folder decision below. **`bundledSoundsDir()` (25 Aug)** is a separate, real folder shipped INSIDE the install itself (`sounds/` next to the .exe, via `package.json`'s `extraFiles` - not packed into `app.asar`, which is one opaque file nothing can browse or write into), seeded with a handful of synthesized starter sounds (`tools/generate-bundled-sounds.js` - hand-rolled tones, no external audio, nothing to license). It's the picker's default folder once nothing's remembered yet, ahead of `C:\Windows\Media` - so "Choose sound..." opens there showing the starters, and dropping a file into that folder via Explorer makes it show up the same way. Resolves differently packaged vs dev (`app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()` - packaged, `getAppPath()` points inside `app.asar`, which `extraFiles` content is never placed in). **Update (30 Aug, QOL #39): the browse/drop folder is now `userData/sounds/`**, seeded on startup from `bundledSoundsDir()` by `seedStarterSounds()` (idempotent — never overwrites a file already there, never touches user files); `defaultPickerDir()` prefers it. The install `sounds/` is purely the seed source now, so the whole sound library lives with auras/profiles under `userData` and travels with a backup/export.
  - **`soundCooldownSec` (per-aura, QOL #45)** — a 0–60s floor on the gap between any two alert sounds from one aura, across all three slots. Clamped by `widgetStore.clampSoundCooldownSec` (a **module export**, not an instance method — calling it on the store instance throws and silently eats the whole `update()`; that was a real bug). In `SHAREABLE_FIELDS` + `normalizeWidget`. This is the owner's replacement for the never-built looping-sound aura (QOL #15).
- `src/main/configTransfer.js` — portable config export/import (QOL #3c). `exportConfig()` writes `userData/exports/eqls-config-<stamp>/` with every portable `.json` + `customSounds/` + `sounds/`, **minus a ~14-entry machine-specific deny-list** — window bounds, live gem/zone state, the EQ folder path, `splitProgress`: anything that must NOT travel between installs. `importConfig()` takes a `pre-import-<stamp>` safety backup under `backups/`, swaps the files in, and restarts. `listImportable()` offers both export bundles and backup folders. Separate from `app:backupConfig` (QOL #3b), which just snapshots the whole `userData` (skipping `Cache`/`detection-logs`/`backups`) into `backups/backup-<stamp>/`.

**Considered and reversed the same session: moving ALL saved data (buffs, widgets, custom sounds, settings, logs) from `userData` into the install folder too.** Asked for directly, and the reason it didn't ship: Windows' NSIS uninstaller deletes the entire install directory, so anything stored there would be permanently lost on uninstall/reinstall - today, uninstalling leaves `userData` (and everything in it) untouched. Once that tradeoff was named, the owner's own words: *"do not do this for saved user data... appdata is fine then. but i would still like a standalone sounds bundle to ship with the app."* The bundled-sounds folder above is unaffected by this reversal because losing a SEED file on uninstall costs nothing - it ships again with the next install - which is exactly the distinction that makes the install folder safe for that one thing and not for anything the user actually tunes.
- `src/main/moduleHost.js` — the drop-in custom-module host (see `## Custom modules`). A pure log-line observer, same DI shape as the other engines (no `electron` import). Scans the install's `modules/` folder, `fs.watch`es it, validates each file against the v1 contract, and feeds enabled modules the line bus. Two tiers keyed on `CORE_MODULE_IDS` — read its header comment. `src/renderer/main-window/main-window.js`'s `initModules()` (per-module settings pages / aura-panel cards) and `initModulesPanel()` (the Log & Setup → Custom modules list) are the renderer halves.
- `src/renderer/main-window/` — the normal app window (multi-page: Buff Tracker, Known Buffs, Overlay, Log & Setup).
- `src/renderer/overlay/` — the game overlay renderer (list or icon-grid display mode).
  - **Icon-mode aura tiles carry three independent optional readouts**, all per-aura and off by default: a **depletion shade** (`iconDepletionShade` — none/wipe/radial, a shrinking dark overlay standing in for the countdown bar icon mode lacks), a **graduated timer colour** (`timerColorRamp` — timer text fades amber→red as it runs down, ahead of the existing `.low` flash), and an **expired linger** (`expiredLingerSec`, 0–6s — holds an expired tile/row greyed and reading "done" before it clears). All in `overlay.js` (`updateTileShade` / `rampColorFor` / `trackExpiredLinger`), all in `SHAREABLE_FIELDS`. The depletion shade and timer-colour ramp are icon-only (a list row has its own bar); **the expired linger also works in List mode** (owner, 3 Sep) — `lingerSec` gate is `!isText`, its settings row lives outside the icon-only block gated on `has('display-choice')`, and `.buff-row.expired-linger` mirrors `.buff-tile.expired-linger` in the CSS.
  - **`hideInfiniteBuffs`** (per-aura, off by default, in `SHAREABLE_FIELDS`) — a Self Buffs aura drops every permanent buff (Yaulp, Fury, the Shielding / coat / wolf-form line — anything `infinite`) from its list. Filtered in `overlay.js`'s `visibleBuffs` right after the name filter; `widgetManager.setHideInfiniteBuffs` + `widget:setHideInfiniteBuffs` IPC; the settings row is `has('merge')`-gated so it only shows on buff-style auras.
- `src/shared/data/buffs.json` — **the roster of record: ~1,067 entries, the spells EQ Legends actually has.** No longer mined; **no spreadsheet** (retired 31 Aug — the owner: *"i do not want the spreadsheet to have anything to do with the code... it was ONLY meant as a reference"*). `tools/build-roster.js` rebuilds `buffs.json` from the *current* `buffs.json` plus every `set` / `add` in `tools/roster-overrides.json`, re-deriving `landingTextSharedBy` and enrichment (text, icon, cast/reuse times) from the game's own `spells_us.txt` / `spells_us_str.txt`. Fully idempotent — a rebuild with no override changes is byte-identical. Rebuild with `node tools/build-roster.js --write`; run it with no flag first for a report. **`tools/roster-overrides.json` is the one place the roster is edited**: `"<spell name>": { "why": "...", "set": {…} }` corrects an existing entry, `"<spell name>": { "why": "...", "add": {…} }` adds a brand-new one. `tools/lib/xlsx.js` is deleted. The previous 11,337-entry mined roster is at `archive/buffs-legacy-11337.json` (outside `src/`, never ships) for reference only; **do not restore it** — add the missing spell via an `add` block.
  - **Why smaller is the point.** "Is this landing line unique?" is judged by counting roster entries, so every spell this server does not have still voted on ambiguity. Measured against a real session: recognised landing lines went 45 → 83 and auto-confirmed 19 → 49. Gotcha #15's confirmed live bug is fixed by it — Armor of Protection is back, and `"You feel protected."` now correctly offers it as a candidate.
  - **`rosterBackfill.js` was deleted (1 Sep).** It undid an old mining mistake that no longer exists; run against the current roster it would re-read the client file and pull in ~1,499 other-expansion bard songs. A missing song now goes in the same way as any other missing spell — a `tools/roster-overrides.json` `add`. `test/roster.test.js` fails if the file, or a `require` of it, ever comes back. (`gameSpellData.getBardSongRecords` is now unused — kept only as a thin cache read.)
- `src/shared/data/raidZoneNameds.js` — the named-kill board's data: **16 tracked zones** (6 Voidling raid zones + 8 surveyed dungeons — Mistmoore, Lower Guk, Crushbone, Befallen, Blackburrow instanced with `respawns:false`, i.e. a fresh instance = a fresh board; Najena, The Lair of the Splitpaw, The Warrens open-world with `respawns:true` and per-named respawn countdowns). Each entry lists its nameds by tier (`boss` / `mini` / `lesser`). Apostrophes are written as the backtick the EQL client actually emits (`Coercer T`vala`); matching normalises case and one leading article. Some spellings are flagged unverified in comments. **NOT covered, deliberately:** ~50 no-named overworld/city zones, and Temple of Cazic-Thule / Upper Guk / RunnyEye / Unrest (eqlwiki-only, not eqlsource-surveyed). Provenance is `docs/research/eql-zones-and-nameds.md`.
- `src/main/raidNamedTracker.js` — the board's engine: own `currentZone`, a `changed` event, rebuilds the board on zone change; a slain line greys a named; `setZone()` is also called by the startup zone-recovery. A new `raidNamed` buff source + `raid-named-builtin` aura kind + its own `SHAPE_FIELDS` entry; `overlay.js` dims killed rows.
  - **The board has two kinds of entry — the hybrid, owner-confirmed 1 Sep.** A **dungeon** entry (no flag) lights up on a plain `You have entered X.` line — #33's "every tracked zone". A **`raid: true`** entry (the 3 Planes, Permafrost Keep, The Ruins of Old Paineel, Kedge Keep) lights up ONLY after the player's own `You say, 'danger'` to the Voidling armed that zone change: a raid instance and a group instance of the same zone are identical in the log (same zone name, same `- Group` / difficulty suffix — measured against the owner's real logs), so the hail is the only discriminator — the same signal `lockoutCore` keys its weekly-attempt event on. `raidNamedTracker._raidEntryArmed` + the per-entry `raid` gate in `_enterZone`; `buffParser.matchOwnVoidlingDanger`; `logZonePeek.readLastZoneEntry` returns `{ zone, viaVoidling }` (256 KB back-scan) so a mid-raid restart rebuilds the board and a restart in a group instance does not.
  - **Never seed a dungeon board from the classic raid target list.** Owner's rule: "raid instances are already-existing areas; the raids are bosses moved into a separate instance." A dungeon board needs real dungeon-clear kill lines from a live log. Nagafen's Lair was wrong this way (listed the Sol B raid bosses — fixed to Efreeti Lord Djarn + kobolds). **`Permafrost Keep` (only Lady Vox) is the next suspect** — needs a dungeon-clear log; flag as known-thin, don't invent.
  - *(An earlier pass discarded the Voidling gate as "an over-narrowing" and this file said "don't rebuild it"; the owner reversed that on 1 Sep — the gate is real for the raid half.)*
- `src/main/abilityGroups.js` — the action bar's mutually-exclusive toggle groups (stance, invocation). `activeNameByGroup` tracks the active pick **by toggle name** (survives a bar re-layout, which a slot index wouldn't); `setPersistFn()` + `restore()` persist it to store key `activeAbilityGroups` and restore it at startup, resolved against the current bar layout. Same "a stance is a character state you're still in, not a timed buff" reasoning as `logZonePeek`. `actionBar:getKnownAbilityGroups` builds the toggle-name picker **from the roster** (spells whose category is Stance / Invocation) unioned with the `KNOWN_` seed lists — a hardcoded seed list alone was why several real stances "couldn't be selected".
- `src/main/actionBarStore.js` / `src/main/actionBarManager.js` — the Action Bars page's data + orchestration. `swapSlots(barId, a, b)` exchanges two gem slots wholesale (icon/name/border/cooldown/toggle) — a **swap**, not a list reorder; slots between are untouched. Drag-to-swap on the settings grid, plus a marker dot on any slot that has anything configured. `actionBar:swapSlots` / `actionBar:enterMoveMode` IPC.
- `src/main/moveHudWindow.js` + `src/renderer/move-hud/` + `src/preload/preload-move-hud.js` — the **move HUD** (see its own section below). A detached, screen-clamped panel for nudging one aura *or* one action bar into position.
- `src/main/gridGuideWindow.js` + `src/renderer/grid-guide/` + `src/preload/preload-grid-guide.js` — a faint, click-through, full-screen grid overlay (primary display only) shown while the move HUD is open **and** snap-to-grid is on.
- `src/main/positionSnap.js` — snap-to-grid state (`{ enabled, sizePx }`, store key `overlaySnapGrid`) shared by `widgetManager` and `actionBarManager` so both the aura HUD and the action-bar HUD snap the same way.
- `src/main/logZonePeek.js` — **one of two things read back from log history.** `logWatcher` starts at EOF and never replays, so a mid-session restart leaves every zone consumer blind until the next zone line. This scans *upward* from the end of the live log (64 KB chunks, capped at 64 MB) for the most recent `"You have entered X."` and feeds it to zone-gated aura visibility, the named board, `customTimerEngine.seedZone()` (sets `currentZone` **without** firing a `zoneEnter` trigger), and the travel guide. A zone line is unambiguous and the player is almost certainly still there — unlike a buff landing, which is why this is a narrow exception to never-replay.
- `src/main/logGroupPeek.js` — the second. `readRecentGroup()` rebuilds the group roster the same way after a restart, when the session-restore snapshot was too stale (or absent): scan up from EOF, collect join lines + `"<Name> tells the group"` chatter, stop at the player's own `"You have joined / been removed from the group."` (a different group's roster ends there), fold to `{ members, admitted }`. `main.js`'s startup tail-scan calls it and `GroupRoster.seed()` merges it in only when `getAdmitted()` is still empty. Group membership is stable and recoverable; without this the damage meter's `group` scope falls back to the whole fight and, worse, groupmates drop off the *current* fight because the friend/enemy bootstrap has to re-learn everyone. `test/log-group-peek.test.js`.
- `src/renderer/main-window/search-dropdown.js` — the themed searchable `<select>` replacement. `window.SearchDropdown.{enhance, enhanceAll}`; runs once at the end of `init()`. Native `<select>` **list** styling is OS-drawn on Windows (the closed control themes fine, the open popup does not — that's why this exists). Each `<select>` stays in the DOM as the source of truth (visually hidden), with a `.sd-display` button + `.sd-popup` drawn beside it in app palette; a pick mirrors to `sel.value` and fires a bubbling `change`, so existing listeners are untouched. A `MutationObserver` rebuilds the list when options change; a filter box appears past `FILTER_THRESHOLD = 7` options.

## Move HUD

Positioning one aura or one action bar precisely. **Shipped as a detached panel in `feat/aura-move-hud`
(PR #29), then reworked 1 Sep on `feat/per-box-nudge-arrows`** — the description below is the
current, reworked shape; the original single-panel-with-a-4-arrow-pad design is gone.

- Every unlocked aura/bar gets its **own floating nudge-pad window** (`src/main/nudgePadWindow.js`,
  `src/renderer/nudge-pad/`) centred directly over its blue drag box: a 3×3 d-pad (arrows on the
  cross) plus a centre ⚙ button. This is true for **both** single-aura move and **"Unlock all
  auras"** now — unlike the original design, unlock-all is no longer bulk-free-drag-only; every
  unlocked box gets its own pad. `positionSnap.setActiveAll()` is what makes snap apply to all of
  them at once in that mode.
- **Step and Snap are shared, global settings**, not per-pad — one small floating panel
  (`moveHudWindow.js`, `PANEL_W/H = 320×150`, opens top-centre of the work area, store key
  `moveHudPosition`) holds Step (1px/10px) + Snap (checkbox + grid size) on one row, plus — only in
  single-aura mode — **Centre horizontally** / **Centre vertically** buttons (`moveHud:centre` IPC,
  computed against `screen.getDisplayMatching()`'s work area).
- **The centre ⚙ on a pad opens that aura's settings** (`nudgePad:openSettings`) — this ends the
  move session but remembers it: `main.js` tracks `suspendedMove = { kind, id }`, and a
  **"↩ Back to moving"** button (top bar) calls `move:resume`, which re-enters the exact same mode
  (single aura, or "all") without you having to re-open the Overlay Auras page and re-click Unlock.
- No frame wraps the aura and there is no click-through hole (dropped from an earlier design, still
  true). The aura keeps its own blue drag box for coarse positioning; right-click-to-open-settings
  on the box was tried and removed (clicking a box no longer does anything but drag it).
- A nudge persists the same canonical anchor a drag does. `main.js`'s move mode is
  `{ kind: 'widget' | 'actionBar', id }` for a single aura, or a distinct all-mode — `hudMode`
  tracks which; `endMoveSession({ suspend })` is the one shared teardown both paths funnel through.

## Custom modules

A **drop-in module** is one self-contained `.js` file that adds a new custom-aura type without a branch, a build, or a new release — the intended way for a trusted collaborator session to extend the app without touching `src/`. Full contract: `docs/MODULE-AUTHORING.md` (source-only, never shipped); worked examples `modules/aggro-board.js` (bundled) and `docs/modules/pull-timer.js`. Host is `src/main/moduleHost.js` — pure observer, no sandbox (trusted-source model), additive-only (built-in aura types untouched).

- **Two tiers, keyed on `CORE_MODULE_IDS`** (in `moduleHost.js`, currently `['aggro-board', 'pull-timer']`; renamed from `BUNDLED_MODULE_IDS`). A **core** id is folded in by this project with a deliberate source edit + a build, so it's trusted like the app's own code: always enabled, no consent, and **never shown** on the Setup page's Custom modules list (`getRegistered` marks it `core: true`, the renderer filters it out). A **user-added** `.js` — anything else in the `modules/` folder — is **inert until enabled** on that list, and every enable shows a consent dialog. The Custom modules card stays hidden until at least one genuinely user-added file exists.
- `enabledModuleIds` (persisted) is the allow-list for the user-added tier; it defaults to the core ids.
- `modules/` lives **inside the install** (next to the `.exe`, shipped via `package.json` `extraFiles`), not `userData`. Dev build reads the repo's `modules/`. Config export carries `moduleSettings.json` but **not** the `.js` files.
- A module can put its `page` settings on the aura's own panel (`settingsUI: 'aura'`, default) or a dedicated sidebar page (`'sidebar'`). NOT a marketed feature — keep user-facing copy low-key, nothing in HIGHLIGHTS.
- `experimental: true` in a module's export badges its Add-Aura entry **"Experimental"**. A module can also be held back entirely: `LOCKED_MODULE_AURAS` (in `main-window.js`) lists ids that are loaded and parsing (so tests still run) but shown as a **"Planned" placeholder** in Add Aura instead of being creatable.
- **`modules/aggro-board.js` is currently LOCKED** (`LOCKED_MODULE_AURAS`, owner's call 2 Sep) while its raid-boss-mob parsing is reworked — it does not appear as a creatable aura, and it must NOT be announced as a shipped feature (pulled from the 1.0.0 changelog + HIGHLIGHTS). The module stays loaded. Its mob parsing: an article (`a`/`an`/`the`) in front of a name is unambiguously a mob; an **article-less** melee line (`Lady Vox hits Korv for …`) could be a mob *or* a player, so it's only a mob if the name isn't a known player this session — players are learned from article-prefixed hits that target them, and from death / taunt lines. Without this the board read nothing for whole raid fights (every named/raid boss is article-less). The module header has the full discriminator.

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
4. **A named spell can land on someone else, not you** (group/targeted spells landing on your current target). If we know the exact expected landing text and it never shows up, the fallback timer now *cancels* the pending cast rather than blind-confirming it — blind-confirming here previously caused real false positives ("Infusion of Spirit" showing active when it actually landed on a group-mate named "Fenn"). This third-person-message pattern (`"<Name> looks powerful."` vs the caster's own `"You are infused with power."`) is exactly the infrastructure the planned ally-buff-tracking feature will reuse.
5. **Bard songs use "You begin singing X.", not "casting".** `matchCastBegin()` in buffParser.js already checks both patterns — if you ever see a class-specific cast verb bug again, check this pattern list first.
6. **Duration floor in roster mining**: originally filtered spells under 2 minutes, which silently excluded nearly all bard songs (they're designed to be short/re-sung). Current mining only excludes truly zero-duration (`ticks < 1`) effects.
7. **Party composition changes invalidate ambiguous-cast memory** — confirmed real log wording: `You have joined the group.` / `You have been removed from the group.` / `<Name> has joined the group.` / `<Name> has left the group.` Note this only ever fires for the player's OWN group-join events — joining a group that *already has other members* needed a separate signal (`matchGroupJoinAccepted`, "You notify X that you agree to join the group.") since the existing members never individually "join" from the log's perspective. Missing this caused a real bug (an existing member's buffs never registering) until fixed.
8. **"Unique landing text" auto-confirm must check current gem state, not just "ever scribed."** A unique landing-text match used to auto-confirm as the player's own cast purely because the spell existed somewhere in their spellbook — but a spell can be scribed and NOT currently memorized (different gem loadout), and an ally casting something with the same unique text would then get silently misattributed to the player. Fixed by cross-checking `currentlyMemorized` (built live from `"You forget X."`/`"You have finished memorizing X."` lines) before auto-confirming; if the spell is knowably NOT in a gem slot right now, treat the landing as suspicious rather than self-cast. `currentlyMemorized` is also now surfaced directly in the main window UI ("Currently memorized") since the user pointed out it's useful information on its own, not just an internal signal.
9. **`selfAmbiguousResolutions` is scoped per loadout profile — fixed via manual profiles, not auto-detection.** It's deliberately never cleared on party change (correct — which of the player's OWN spells an ambiguous text means isn't about who's grouped with them), but that reasoning had a hole on this server: a loadout swap (see "Server context" above) can make a past self-resolution wrong without touching party membership OR the spellbook file. A burst-detector on forget/memorize events (mirroring `BURST_WINDOW_MS`) was the first idea but was explicitly rejected — the user pointed out a normal Quick-Buff-style fade/re-memorize cluster during ordinary play would false-trigger it, and there's no reliable signal that distinguishes "loadout swap" from "routine gem juggling." **Landed instead**: `src/main/profileStore.js` (named loadout profiles, one active at a time, persisted) + `buffEngine.js`'s `selfAmbiguousResolutionsByProfile` (one resolution bucket per profile instead of one flat map, swapped via `setActiveProfileId()`). The user switches profiles manually via the chip bar at the top of the main window (`initProfileBar()` in `main-window.js`) whenever they actually swap loadouts — no auto-detection at all. A pending ambiguous cast is tagged with whichever profile was active when it was *queued* (not when it's resolved), so answering it after switching profiles still writes to the right bucket. Confirmed working live (screenshot-verified: switching to a fresh profile correctly re-prompted an ambiguous cast that was already resolved under the old one). **`activeProfileIds` also gates on-screen visibility** — see gotcha #13.
10. **A widget's `activeProfileIds` IS its on/off switch — there is deliberately no separate global "enabled" toggle.** An earlier version had both: a global `enabled` checkbox ("Show this aura") *and* profile membership that was pure organizational bookkeeping with no visibility effect. The user explicitly reversed this: profiles are supposed to control which auras are on screen, and two independent concepts meant two places to look when an aura didn't appear. **Landed**: `widgetManager.js`'s `isVisibleForActiveProfile(config)` is the single source of truth (empty `activeProfileIds` means "show on every profile", **not** "show nowhere" — also an explicit user choice, so a new widget can't silently be invisible); `applyProfileVisibility()` re-evaluates every widget on profile switch (wired from main.js's `profiles:setActive`); `setActiveProfileIds` shows/hides immediately. The old `enabled` field **was removed** by the `widgets.json` v5 → v6 migration — it had lingered unread for a while (to dodge a migration) and that migration finally happened. Don't reintroduce it as a second visibility gate.
11. **Auto-hide overlay matches on process name (`eqgame`), never window title.** The Daybreak launcher (`LaunchPad.exe`) and the actual game client both show "EverQuest Legends" as their window title, so title-matching would count the launcher as "the game" too. Confirmed directly via `Get-Process | Where MainWindowTitle` while the user had the game running, not guessed. **Also matches this app's OWN process name** (derived from `process.execPath`, not hardcoded - survives a rename automatically) - the first version only matched `eqgame`, so clicking into the main window or a widget to drag/configure it (briefly making THAT window, not `eqgame`, the foreground window) made the overlay vanish mid-interaction, defeating the point of dragging it. On Windows every window this app owns shares one process image regardless of which BrowserWindow backs it, so one process-name check covers the main window, every widget, and the ambiguous popup at once. See `foregroundWatcher.js`.
12. **Quick Buff (and similarly instant multi-grant abilities) genuinely drops a variable number of buffs per cast — confirmed at least three times now by directly diffing the raw log, not an app bug.** One cast landed 11 of ~14 expected; a later cast also landed 11 of 14 but with a *different* 3 missing; reported again live in-game showing 11 icons. There's no code path in this app that would explain it selectively dropping exactly 3 specific lines from a burst while correctly keeping the other 11 - the log itself never contains those lines to begin with. **Do not "fix" this by chasing it as a detection bug** - if it comes up again, cross-check the raw log around that timestamp first (it will confirm the missing lines were never written at all) before assuming the app dropped something.
13. **Custom timer definitions can legitimately share a display name and even the exact same trigger text - `customTimerEngine.js` must key active-instance state by each definition's own `id`, never by name.** Confirmed real, intentional user setup: two "Custom Timer" definitions both named the same thing, both triggered by the identical chat line, given two different icons on purpose, expected to activate simultaneously. An earlier version only returned the *first* matching definition per log line (`_findTriggerMatch`, singular) and tracked `activeTimers` keyed by `name.toLowerCase()` - so even fixing the first-match bug alone would've had the second activation silently overwrite the first in the Map. `overlay.js`'s `keyFor()` (the identity key backing every render-tracking Map/Set) has the same failure mode for any buff type that can have duplicate names - it already handles this correctly for ally buffs (name+allyName) and now for custom timers (`id`), but don't add a new buff source without checking whether IT can also produce name collisions.

14. **Bard songs are tagged from the game's own spell data, not from watching for "singing" cast lines.** `markBardSong()` (the original mechanism) only fires when the player personally sings a spell *while the app is running* and the app catches the `"You begin singing X."` line — it tags one spell per observation. That left the old mined roster with **1 of 11,337** entries flagged, which made "Hide bard songs" look completely broken when the filter logic was actually fine. `src/main/bardSongTagger.js` now reads `spells_us.txt` directly at startup (and on EQ-folder change) and tags every spell **only the Bard class can cast** — fields 36–51 are the 16 per-class required levels, `255` = never castable, Bard is offset 7. Verified empirically before wiring in: Selo's Accelerating Chorus / Vilia's Verses of Celerity / Amplification / Selo's Accelerando all bard-only; Talisman of Altuna (Shm/Bst) and Resolution (Clr/Pal) correctly not. **Additive-only on purpose** — it never sets a flag back to `false`, because the Known Buffs list has a manual two-way override (`buffStore.setBardSong`) and a deliberate user correction there must not be silently reverted on every launch. Idempotent; only writes when it actually changes something.

15. **A missing roster entry doesn't just hide a buff — it silently upgrades a guess into the app's highest-confidence tier.** The "unique landing text" tier auto-confirms with no other evidence, and "unique" is judged by counting *roster* entries, not game data. So a spell that's castable on EQL but absent from the roster can make some *other* spell's shared landing text look unique. Confirmed live: `Brilliance` and `Cassindra's Chant of Clarity` both land with `"Your mind clears."`, but only Brilliance was in the roster, so every Chant of Clarity was confidently logged as Brilliance. **This is a data gap, not a structural flaw — and the fix is NOT to count against `spells_us.txt`.** The roster (~1,067) is deliberately scoped to what EQ Legends actually has; the game file carries every spell from every EQ version ever shipped, almost none castable here, and vetoing an auto-confirm because some 2015-expansion spell shares the text would make the app prompt "which spell was that?" for buffs that were never ambiguous here — a permanent regression for a rare mislabel that gotcha #8 already accepts. The real, narrow issue is a genuinely-castable EQL spell that was missed when the roster was built (Armor of Protection, confirmed from a real log; 386 bard songs dropped by an early duration filter). Each is fixed by adding that one spell via `tools/roster-overrides.json` `add`, after which the roster's own share-counting handles it. **Ongoing data task** (report → confirm it's a real EQL spell → `add`), no engine change. See `docs/TEARDOWN-AND-REMEDIATION.md` revised #3 / P1-1.

16. **`currentlyMemorized` is now PERSISTED, and is a memory rather than live truth — it can be wrong, not just empty.** It used to reset on every launch, which was itself a bug source: an empty set means "we don't know", and the detection tiers treat not-currently-memorized as evidence a landing wasn't the player's, so restarting mid-session caused real buffs to be silently ignored. It now saves to `currentlyMemorized.json` on every gem change and reloads at startup, so the common case (app restarted, gems unchanged) is correct instead of blank. **The tradeoff is deliberate**: gems swapped while the app is closed leave it remembering something untrue, and a *wrong* entry is worse than a missing one. That's why the landing-page gem bar makes every filled gem clickable to forget (`removeMemorized`), plus a "Forget all" button (`clearMemorized`) — those exist as the correction mechanism for exactly this, don't remove them without replacing the correction path. Stored as `[lowercase, originalCase]` pairs, not a flat name array: the lowercase key is what every detection lookup matches on, while the original casing is the only source of a decent display name for a memorized spell that *isn't* in the buff roster (a nuke, a heal) — without it those render as "rain of spikes". The loader still tolerates the old flat-array format.

17. **Ally-buff detection must NOT require the recipient to be a known group member.** `groupMembers` is only ever learned from join/leave lines seen live, so grouping up before launching the app — or any restart mid-session — leaves it empty, and gating on it silently disabled ally tracking completely. Confirmed from a real log: a `You begin casting Shield of Flame.` whose `Baxa is enveloped by flame.` landed 3 seconds later was ignored purely because the group had formed nearly 3 hours before the app started. Both ally paths now take the recipient's name **from the landing line itself** (EQ names are a single alphabetic word, so `^([A-Za-z]+)( .+)$` splits it unambiguously) and look the remaining suffix up in the roster. `groupMembers` is still maintained because it's real information, but nothing depends on it being complete — don't reintroduce it as a gate. False positives are bounded by the suffix having to match a real `othersLandingSuffix`: ordinary chat during a burst finds no match and is ignored (verified).
18. **Ally-buff tracking had never fired once — the whole tier was gated behind a signal an instant multi-target ability never produces.** `recentSelfCast` is only ever set by a named cast line (`You begin casting X.`), but Quick Buff emits `You activate Quick Buff.` with no per-spell cast lines, so during exactly the burst where the player buffs their group it was null and the ally tier was skipped entirely. Confirmed from the real debug log: **zero** `ALLY` decisions ever recorded, despite the roster carrying 9,219 third-person suffixes and group membership tracking working correctly. Nothing was wrong with the roster, the suffixes, the group tracking, or the Ally Buffs aura — just the gate. **Fixed** by adding a second ally path that runs on burst context instead of a named cast: strip the groupmate's name off the line and reverse-look-up the remaining suffix via `buffStore.findAllByOthersLandingSuffix()` (a new grouped index, invalidated in `_save()` alongside the landing-text ones). **Requires an unambiguous suffix** — 858 of the 2,034 distinct suffixes are shared by several spells, and this project's "no guessing" rule applies to ally attribution as much as self; a shared suffix is logged as `ALLY AMBIGUOUS` and skipped rather than resolved to whichever candidate came first. Verified by replaying the real 13:05:38 burst: 2 buffs correctly land on Baxa, 2 correctly declined as ambiguous. **Obvious next step**: the heal-proc line (`You healed Baxa for 255 hit points by Symbol of Pinzarn.`) names the exact answer for one of those ambiguous cases, one line later - the same signal already used to auto-resolve *self* ambiguity (gotcha above) would resolve ally ambiguity too, but ally ambiguity isn't queued anywhere yet so it needs a short-lived pending-ally-landing memory first.

19. **Live timer state survives a restart, but only for 5 minutes — see `src/main/sessionSnapshot.js`.** Active self buffs, ally buffs and custom timers used to be session-only, so any restart wiped every running timer and the overlay sat empty until each buff happened to be recast (the app never replays log history, so nothing rebuilt it). Now snapshotted to `sessionSnapshot.json` on change (debounced 2s) and flushed on `before-quit`, then restored at startup. **The restore needs no arithmetic**: active entries already store `expiresAt` as an absolute timestamp rather than a remaining-seconds countdown, so a 100-minute buff whose app was closed for 3 minutes simply comes back with 97 left, and anything that expired meanwhile fails the `expiresAt > now` filter. **The 5-minute cap is the judgement call, and it is not about arithmetic**: the app cannot see what happened in-game while closed, so after a long gap a buff that hasn't technically expired may still be long gone (death, camp, zone, relog). A stale timer reads as authoritative in a way an empty list does not, so the cap deliberately errs toward showing nothing. Also refuses to restore if the system clock moved backwards, since every `expiresAt` is then meaningless relative to now. Restore runs *after* `applyInstallRoot()` so the roster is backfilled/tagged first — a restored buff is looked up by name for its icon.

20. **Whether a damage line is yours is derivable; it is not guessable from names.** The obvious approach to a damage meter is to judge from the shape of a name whether it is a player or a monster. It does not survive these logs: `Fright has taken 394 damage from your Envenomed Bolt IV.` is a monster with a one-word name, shaped exactly like a player's. `damageEngine.js` derives direction instead, from one seed and three rules — you are on your own side; anything YOU damage is an enemy (the log's grammar says so outright); anyone damaging a known enemy is a friend; anyone damaging a known friend is an enemy. Rules two and three feed each other, which is the whole point: rule one alone credits **22%** of a real log day, because her groupmate spends the night fighting mobs she never touches, and adding rule three takes it to **65%** with the remaining 35% correctly excluded as incoming. Lines that cannot yet be placed are HELD and re-examined whenever the sets grow, so the opening seconds of a pull are not lost to the bootstrap.

21. **In `X has taken N damage from Denon's Disruptive Discord V by Baxa.` the apostrophe-s is the SPELL, not the caster.** 44,508 lines are shaped that way. Reading the possessive as the attacker would have been confidently wrong on every one of them; the attacker is the name after `by`. A damage shield is the exact opposite — `A zol ghoul knight is pierced by Baxa's thorns` — where the possessive IS the attacker. Two wordings that look alike and mean opposite things, which is why both were measured separately rather than assumed to share a shape.

22. **The travel router is breadth-first on purpose.** Weighting the edges would mean claiming a boat costs more than a zone line, or a portal less than both, and there is no measurement behind any of those numbers. Fewest hops is a claim the data supports. Two details that look redundant and are not: the fewer-spells tie-break is invisible today because the move ordering agrees with it (measured across all 10,712 routes), but it is the mechanism that HOLDS the guarantee — reverse the ordering and routes stay correct with it and break without it. And the instance-tier exclusion in the short-name lookup only decides the answer for **7 of the 12 shared short names** — the ones like `soldungb` → Nagafen's Lair where the short name appears nowhere in the display name. Both were nearly deleted as dead code.

23. **Instance tiers are one-way in the zone graph, and correctly so.** `Befallen 3 (Fused)` lists a way out to West Commonlands; West Commonlands lists no way back in, because there is no zone line into a particular tier — you enter through the game's instance system. All 27 variants are like this, which is why 2,079 routes *into* them find nothing. The router handles it by routing to the ordinary place and adding a final `Enter <tier>` step, rather than fabricating an edge or refusing a plainly reachable destination.

24. **A share code arriving from chat is text another player typed.** `shareCodeChat.js` recognises one and the main process offers it; nothing imports it. `"Look at it"` hands the code to the ordinary import screen with every confirmation that already lives there. There is deliberately no IPC channel that would apply a chat code directly, and two structural tests fail if one appears — importing on sight would let anyone reconfigure the app by talking in guild chat. Related: a *modal* was the wrong instrument, because this arrives unprompted while she is playing and one that stole focus mid-fight would be worse than the feature is good.

25. **The AA/Exaltation duration bonus applies to every spell the roster's own `kind` column marks `buff`, and NOTHING else.** the owner, 23 August: *"the AA should only apply to things marked as a BUFF. not just any beneficial."* I had it on buff, heal, hot and pet, reasoning that the bonus is for beneficial spells and those are the beneficial categories — inference presented as a measurement. Before that it was applied to *everything* without a `noDurationScaling` flag, which is **155 entries** of debuff, dot and charm that would have over-timed by up to 65% the moment an AA level was set. Curse (base 30, a dot) measures 31-36s across 31 castings on days when her buffs measured x1.53; the multiplier would make it 45. The gate is a whitelist, not a blacklist, so an unrecognised category runs short rather than outliving the thing it times.
    **Second mistake, corrected 24 August: I read "BUFF" as this file's own finer-grained `scaleCategory` ('buff' only), not the roster's `kind` column, and that silently dropped every `hot`.** All 16 of the roster's `scaleCategory:'hot'` entries — Celestial Healing, Celestial Remedy, and the rest — are `kind:'buff'` on the sheet. Reported live: Celestial Remedy popping a flat 24s with no bonus applied. The owner: *"HOTs are listed as buffs in the roster sheet provided, it should have always worked"* and *"ALL buffs are supposed to be subject to these increases. i have stressed this since the beginning."* `isAAEligible()` now checks `entry.kind === 'buff'` directly instead of a `scaleCategory` whitelist, so nothing needs to stay in sync with the sheet's own classification by hand. This does **not** reopen Curse or any other `kind:'det'`/`'pet'` entry — those aren't buffs by the sheet's own column either way, dot/debuff/charm/nuke/pet-summon durations are unaffected, and the Curse measurement above still stands. **The only spell currently exempted from a `kind:'buff'` entry getting the bonus is Promised Renewal**, via its own `noDurationScaling` flag (a separate, directly measured exception — 225 castings flat at 15s regardless of rank or AA level, see gotcha 27's neighbor in the code). The owner's words on that boundary: *"exceptions are exceptions for a reason, currently the only exception is promised renewal"* — don't add another one without the same kind of direct measurement behind it.

26. **A wide spread in a measured duration means several casts, not noise around one.** Celestial Healing IV measures 48-78s where its mote tier predicts 29, and I read that as evidence the AA bonus reached heals over time. It was recasting: she refreshes the heal before the old one lapses, so landing-to-wear-off spans several casts. The tell was the *shape* — a fixed-duration buff measures inside a 14-second band (Spirit of the Puma VII, n=24) and this one ran across 30. Every landing already recomputes, including a renewal, because renewals go through `_land()` like everything else, so a re-cast reapplies the calculation at whatever rank was just cast.

27. **Mote tier scaling is linear against base, not compounding, and the rank is READ rather than threaded.** `duration = base x (1 + rate x tier) x aa`, rounded ONCE over the combined multiplier — rounding between the steps differs by up to a second. Measured: buff +10%/tier (Spirit of the Puma VII predicts 168.3s, measured mode 167; compounding predicts 192.9s and 23 of 24 observations fall below it, so it is refuted rather than merely unused). `_rankForEntry` reads the numeral off the cast the engine is already holding rather than threading an argument through the sixteen call sites that can end in a landing, with a name check so a stale cast cannot lend its numeral to something else. Somebody else's cast gets **no** rank: their numeral is in the log, but nothing establishes which of their casts produced which landing, and an honestly unscaled number beats a confidently wrong one. **Bard songs then snap to 6s** (QOL #17): after tier × AA, `_scaledDuration` quantises any `isBardSong` entry to the nearest multiple of 6, floored at 6 — songs pulse on a 6-second cadence (see the song-pulse note), so a scaled song duration that isn't a multiple of 6 is wrong. Non-song durations are untouched.

28. **An IPC handler that destructures a fixed list of names drops anything missing from it, in silence.** `triggerMatch: 'castOf'` was absent from `addCustomTimer`'s whitelist for the entire time castOf timers existed; the cooldown premade only worked because it writes the timer object directly and never goes through that path. Anything routed through the UI was quietly downgraded and never fired. Note 9's `allOf` had to be added in **four** places — both handlers, destructure and forwarding call — and there is a test that gutting any one of them fails.

29. **Trusting userData over the install for roster DATA meant a real bug fix could ship and do nothing.** `buffStore.js` used to seed the roster into userData once, then upgrade it via a version-gated merge (`STARTER_VERSION` + a growing pile of one-time migration flags in `buffsMeta.json`) that only refreshed an entry if it "looked untouched" — no `landingText`/`endedText`/`iconId` set at all. That heuristic could never actually fire on a normal roster entry, because every one ships WITH all three from day one. Consequence, confirmed live: Alacrity's duration was wrong (660s instead of the measured 492s), fixed in the bundled roster, and an already-seeded install kept showing the old number regardless — the fix genuinely could not reach anyone who had already launched the app once. The owner: *"it should be seeded from the install not the person's saved files because it interrupts old installs and doesn't allow live updates."* Rebuilt so the install (`src/shared/data/buffs.json`) is authoritative for spell data on **every construction**, not a one-time seed — no version number, no migration flags, nothing to remember to bump. Only three things still live in userData because the install has no copy of them at all: a fully custom entry (`custom: true`), a spell the user hand-corrected through Known Buffs' Save button (`edited: true`, set by `upsert()` — carefully NOT set by `setShowOnOverlay`'s call through the same method, or ticking one checkbox would freeze a spell's data forever), and three small toggles with no install-side value (`showOnOverlay`; `isBardSong` once `isBardSongUserSet`; `noDurationScaling` once `noDurationScalingUserSet`). `bardSongTagger.js`'s additive-only pass was updated to respect `isBardSongUserSet` too — without it, a manual "no, not a bard song" correction (`isBardSong: false`) was indistinguishable from "never tagged" and got silently re-tagged true on the next launch.

30. **An AA-activated ability's rank numeral was being read correctly and then thrown away, silently skipping the mote-tier duration bonus for it specifically.** Reported live: "Amplification II" (a bard AA ability - `"You activate Amplification II."`, not a `"casting"`/`"singing"` begin-line) landed at 50s where its own in-game tooltip read `"0:30 (1:00)"` — 30 base, 60 with the character's real AA+Exaltation bonus. `_rankForEntry()` only ever reads `pendingCast`/`recentSelfCast`, and `handleLine()`'s `matchActivate` branch never set either — `matchCastBegin`'s own branch, two hundred lines further down, is what sets `recentSelfCast` for a cast/sung line, and an activate line simply fell through it untouched. The result: 50s was exactly base × AA alone (30 × 1.65 = 49.5 → 50) with zero mote contribution, even though the rank was sitting right there in the log line and `matchActivate` was already returning it intact — the numeral was parsed correctly and then discarded before it ever reached the scaling math. Confirmed as a real bug rather than a display artefact by the owner's own words when asked whether mote scaling should even apply to a duration-based song at all: *"duration based buff songs scale with motes."* Fixed by setting `recentSelfCast` (not `pendingCast` — see below) in the `activated` branch too, the same shape `matchCastBegin`'s branch already uses. **Why `recentSelfCast` and not `pendingCast`**: `pendingCast`'s confirm/cancel timer machinery assumes one specific expected landing text is about to arrive, which is exactly wrong for an activate line like Quick Buff that deliberately drops many buffs with no per-buff cast line at all (gotcha #12's whole reason for existing) — `recentSelfCast` is pure lookup evidence for `_rankForEntry`, keyed by name after rank-suffix stripping, so Quick Buff's own name never matches any of the buffs it actually grants and cannot lend them a bogus rank (pinned by its own test, `duration-scaling.test.js`'s "Quick Buff activating cannot lend its own name's rank"). Verified end to end against the real roster and the real `handleLine()` pipeline (not a hand-set `recentSelfCast`, since the whole bug was about whether the log line's own rank ever reached that field) — 50 → 59 (30 × 1.2 mote × 1.65 AA, matching the formula exactly); the remaining 1s against the tooltip's rounded `"1:00"` is more likely the game client's own display rounding than a further formula error, but that last second hasn't been independently confirmed either way.

31. **Bard-song self-attribution never actually checked the player's own recent cast for a RANKED song — a rank suffix silently defeated its own self-check.** Reported live: singing "Selo's Accelerating Chorus VI" (self-cast) got attributed to "Enro" — traced from the raw log to a MOB with an identically-named ability, seen singing it via `"Enro begins singing Selo's Accelerating Chorus."` roughly 20 minutes earlier the same session (mob names in this game are shaped exactly like player names, see gotcha #20 — nothing distinguishes them here). `_attributeBardSongCaster()`'s self-check compared `recentSelfCast.name.toLowerCase()` directly against the roster's bare name, with no `stripRankSuffix()` first — so `"selo's accelerating chorus vi"` never equalled `"selo's accelerating chorus"`, the self-check silently failed on every ranked cast, and execution fell through to `_recentOtherCaster()`, which returned the stale mob-cast evidence — `recentOtherCasts` has no expiry at all, by design (see its own comment: valid for the whole group session, since a group buff's own third-person suffix can legitimately need to outlive a much shorter cast window). Fixed the same way `_rankForEntry` already strips a rank suffix before comparing (gotcha #27) — an unranked bard song ("Amplification" with no numeral) already worked, which is exactly why this went unnoticed until a ranked one hit it. `test/bard-songs.test.js` pins both the ranked-cast regression and the unranked case still working, and it's mutation-tested — reverting the one-line `stripRankSuffix()` addition reproduces the exact reported symptom (`'Enro' !== 'You'`).

32. **Death clears live state, but only forward.** `buffParser.matchOwnDeath` is `/^You have been slain by .+!$/` — the player's *own* death, a different verb from the mob-death lines `matchSlain` catches (`"<Name> has been slain by …"`). On it, `buffEngine._clearOnDeath()` drops active buffs + bard songs + the pending cast, and `customTimerEngine` clears active timers **except ones in their recast-cooldown phase** (a cooldown keeps ticking through death — the ability is still on cooldown when you're rezzed). Replay over the real corpus: 48 death-clears + 19 song-clears, no detections lost. `sessionSnapshot` needed no change. **Never-replay-history means a death that happened before the app started can't retroactively clear anything** — same limitation as `currentlyMemorized` and zone tracking. QOL #12.

33. **A maintained bard debuff song prints no cast line and no per-pulse line — only the nameless third-person effect text, re-landing every ~6s.** Confirmed from the owner's raw log: Largo's Melodic Binding shows up purely as `<mob> is bound by strands of solid music.` every ~6 seconds, with zero `You begin singing` lines anywhere in the session — so every cast-driven detection tier misses it completely. The Bard Songs aura's hybrid buff/debuff feed (QOL #29) handles it with its **own unconditional `handleLine` path**, gated only on a Bard Songs aura having asked for debuff songs (`showDebuffSongs`, off by default): match the third-person landing text straight against the roster's debuff-song `othersLandingSuffix` values (`_getDebuffSongSuffixes`); an unambiguous hit is mirrored onto the aura keyed by target, a shared suffix is logged `BARD DEBUFF SONG AMBIGUOUS` and skipped (the no-guessing rule). A debuff song clears from the aura when its target dies (`matchSlain` prunes `bardSongs`). **A bard DAMAGE song is not a debuff song** — Denon's Desperate Dirge and the like are `scaleCategory:'nuke'`; they land third-person on a mob but debuff nothing, so `_isDebuffSong()` (which allows only `DEBUFF_SONG_CATEGORIES = {debuff, charm, dot}`) keeps them off the aura and `_trackBardSongOnTarget` bails for them. `splitSongsByType` (also off by default) then groups buff vs debuff songs into their own sections. Screenshot-confirmed working in-game 31 Aug. `test/bard-songs.test.js`.

34. **During an *ally's* Quick Buff, an ambiguous landing that narrows to one of your spells is NOT auto-landed.** Extends gotcha #18. `MULTI_GRANT_ABILITIES` (`buffEngine.js`, currently just `Quick Buff`) — when the *exact* line `<Name> activates Quick Buff.` opens the 5s ally-burst window and **you aren't also bursting**, a shared-text landing that the gem/spellbook tier would otherwise resolve to one of your own spells falls through to the normal ambiguous handling (queued prompt, or silent IGNORE) instead. Scoped tight, from the owner's domain knowledge + a full-corpus replay (−44 landings / 511,743, **+229 correct ally attributions, 0 buffs lost**): only that one known ability by its exact line (not "any ally activate" — a raid keeps that window open permanently, and the broad version cost −60k landings); not when `inBurst` (both Quick Buffing at once is unsolvable, so your own burst wins); **never a bard song** (Quick Buff can't grant songs, so a song landing in the window is yours regardless — this also structurally protects maintained Psalm/Selo's/Hymn); and not a renewal of something already active. A remembered self-resolution is deliberately not honoured here — it answers "which of my spells is this text", not "is this landing even mine".

35. **A groupmate's own self-cast must not land on your Ally Buffs — the named-cast ally path now checks `recentOtherCasts` too.** Live bug (Sep 1): the player cast Spirit of the Puma on Orlando; Ally Buffs showed it on Chrysaetos, because Chrysaetos had self-cast his *own* Puma 2s earlier and his third-person landing (`Chrysaetos growls with the spirit of the puma.`) was matched to her pending cast. The burst-context ally path (#18) already skipped a groupmate's own self-cast; the "named cast confirmed by third-person landing text" path didn't. `_allySelfCastRecently()` — a **local, rank-aware** pass over `recentOtherCasts` (recipient == the person just seen casting this spell, inside the 60s window → their own self-cast → consume the line, don't attribute). **Deliberately local:** a first attempt rank-stripped the whole `recentOtherCasts` key and that made the self tiers suppress the player's own maintained songs when a groupmate sang the same one (replay: −1851 Selo's Accelerando, −986 Amplification). The map stays raw-keyed; only this one check strips ranks. The IGNORE branch also has to *return* — an earlier version fell through to the "unexplained third-person" recorder and re-introduced the bad key shape. `test/ally-named-cast-recent-other.test.js`.

36. **Buff duration formula 50 = permanent-until-cancelled — reading field 12 for these buffs gave ~0s and they vanished off the overlay ~1 min after landing.** EQEmu's `CalcBuffDuration_formula` case 50 returns the `-1` "doesn't tick" sentinel *before* field 12 is consulted (field 12 there is only a PvP cap); the published EQL spell references render every formula-50 spell as "permanent". The old mining did `field12 × 6` and gave 45 real long buffs — Armor of the Faithful, the whole Shielding line, the damage-shield "coat" line, permanent wolf/vision forms — a near-zero duration. The owner watched Armor of the Faithful still blocking casts long after the app had dropped its tile. `tools/build-roster.js` now sets `infiniteDuration: true` (and deletes `durationSec`) for `buffDurationFormula === 50 && goodEffect >= 1 && !buffDuration`, unless a `roster-overrides.json` `set` pins `infiniteDuration`/`durationSec`. Two entries carry a real field-12 value (Dark Temptation 3600, Phantom Plate 4320) and are left finite pending a live "it didn't expire" report — flip them by dropping the `&& !e.buffDuration`. These feed the planner's permanent pool (gotcha: a permanent-tier line member like Rage now correctly outranks its finite sibling Frenzy). Research + build, 3 Sep.

37. **Curated stacking data proposes; the ported engine vetoes — in `buffEngine._land`'s stale-tile sweep and the Buff Planner both.** A curated `overwrites` only removes an active tile if `stackingService.verdict` agrees the two don't stack (verdict is not `0` and not `-1`) — AEM's full parse found ~104 curated `overwrites` pairs the real game engine stacks fine, where a tile was vanishing mid-buff. The reverse also happens: a *weak* `coexist` (different curated headings, no recorded conflict, **no** authored `stacksWith`) is overruled when the engine says the pair collides — Cantata of Soothing vs Cassindra's Chorus of Clarity sit on different curated bard-regen headings so curated says `coexist`, but the engine and the owner in-game agree Chorus blocks Cantata. `buffLines.stacksExplicitly(a, b)` is the guard: an authored `stacksWith` link is left strictly alone, only the plain fall-through is engine-overrulable. Wired via `buffEngine.setStackVetoFn` / `setLineStacksExplicitlyFn` from `main.js`. `test/spell-stacking.test.js`, `test/buff-lines.test.js`.

38. **Exactly one bard song vs exactly one non-song buff sharing a landing text is told apart by the 6s song pulse alone — so that check runs *above* the renewal / spellbook / gem tiers, not below.** `_songVsSingleBuff(candidates)` spots the 1-song-1-buff shape; `_pulsedAmbiguousSong` then confirms the song once the same text has re-landed on the ~6s cadence `SONG_PULSE_CONFIRM_HITS` times. It had to move ahead of the other tiers because a non-song candidate one of them grabs — a now-permanent Frenzy sharing `"You go berserk."` with McVaxius' Berserker Crescendo (owner report, 3 Sep) — absorbs every pulse as its own renewal, so the pulse detector downstream never sees the cadence. On confirm the song wins outright with no prompt, any provisional tile for the non-song candidate is dropped, and a queued ambiguous prompt for that text is cleared. First sighting / broken cadence → holds, and the tiers below make the provisional call. The later (line ~1720) pulse call is gated off when `strictSongBuff` already handled it, so its watch isn't advanced twice. `test/bard-songs.test.js`.

39. **A monster is never written to `recentOtherCasts` — a mob "casting" a buff spell was silently vetoing the player's own landing of it, forever.** `recentOtherCasts` (the "someone else cast this spell" memory, no expiry — see gotcha #31/#35) had no filter on the *caster*, and it is only ever read to withhold or re-attribute a **beneficial** buff. A monster does not cast those onto the group. Reported live (3 Sep): the player's own Center (from her Quick Buff) logged `IGNORED - recently cast by "A Teir\`Dal rogue"` (a charmed mob), one line before `You healed Shara for 48 by Center` proved it was hers. **Fix:** in the `matchOtherCastBegin` handler, an article-prefixed caster (`isArticlePrefixedMobName` from `petNames.js` — `/^(a|an|the)\s/i`, minus possessives) is not recorded. One filter at the write site covers every consumer at once — the self unique-text veto, the ambiguous-self `otherCastMatch`, the burst-context ally path (`_recentOtherCaster(one.name) === allyName`), `_allySelfCastRecently`, bard-song caster attribution. The ally-cast debuff warning still fires (`_alertAllyCast` is outside the guard). A mob's *debuff* landing on the player is unaffected — that path never reads this map. Named mobs shaped like a player ("Enro", "Cazic-Thule") are out of scope: the article is the only shape tell the log gives (gotcha #20). **Accepted trade:** the frozen replay showed `distinctAllyLandings` −97 — every one verified as another raider's own self-cast (Auspice/Eminence ×24, Jonthan's Provocation/Meliyne ×30) that a *coincidental* mob cast of the same spell had been preventing the engine from resolving. `distinctBuffsLanded` +3 (Center, Yaulp, Light Healing). Owner accepted it as a correction. Same commit: during the player's **own** Quick Buff, an ambiguous landing a groupmate was also seen casting now **queues a prompt** instead of a silent IGNORE (owner: "there should be ways to tell, and when not it should go to me"). `test/detection.test.js`.

40. **A charm-war zone collapses the damage-meter friend/enemy bootstrap — the group ends up tagged as enemies, the mobs as friends, and the mobs' incoming damage credited as group DPS.** Reported live (3 Sep, Befallen): necro pets + charmed mobs + enemy mobs that share a name with the charmed ones feed the transitive bootstrap (gotcha #20) contradictory facts until the two sets merge. The pollutant is **damage-shield lines** (`X is pierced by Y's thorns`, `burned by Y's flames`) — pure retaliation, they never teach a side the triggering hit didn't, and in a charm war they cross every pairing. **Fixes (`damageEngine.js`):** (a) a `kind:'shield'` line still gets a *direction* when both sides are known but never `.add()`s to either set; (b) `_learnFriend` / `_learnEnemy` refuse to put a name on a side the other set already holds — first classification wins, a later contradiction is noise (an explicit signal — `knownEnemiesFn`, the group roster — still overrides, and the collision guard still covers a genuine same-name pet/enemy clash); (c) `restoreState` drops any name that came back on both sides; (d) a `groupRoster`-confirmed member is a friend for classification with no bootstrap, and `<member> hits X` proves X an enemy the way `You hit X` does — so a groupmate fighting mobs the player never touches is credited on the *current* fight immediately (the owner's "combat vs out-of-combat names differ" report — the since-zone tally had everyone, the current fight had lost them). `test/damage-parser.test.js`.

41. **`_allySelfCastRecently`'s "was it their own self-cast?" window is one cast-length for a normal buff, the full 60s only for a bard song.** A song an ally sang once keeps re-emitting its landing text for the whole song, so their single cast explains a landing up to a minute later. A normal buff lands ONCE, within its cast time — a re-land 30s after the ally's cast is a fresh application by whoever just cast, i.e. the player. Reported live (3 Sep): re-casting Spirit of the Puma on Jarlaxle stopped refreshing his Ally Buffs tile for 60s after Jarlaxle cast Puma once himself (`ALLY IGNORED - Jarlaxle was just seen self-casting it`). Split: `isBardSong` → `OTHER_SELF_CAST_WINDOW_MS` (60s), else `FALLBACK_CONFIRM_WINDOW_MS` (12s). Gotcha #35's original case (a groupmate's own Puma landing 2s after his cast) is well inside 12s. Frozen replay: all 5 invariants identical. `test/ally-named-cast-recent-other.test.js`.

42. **A `255` in a spellbook file's level column means "no class of this character can ever cast this" — it is not a scribed spell.** `spellbookService._readOne` took the second tab-separated field as the spell name and ignored the first (the required level; `255` is EQ's uncastable sentinel, the same value `gameSpellData` reads for per-class castability, gotcha #14). A multiclass character's `/outputfile spellbook` dump lists those rows anyway. Reported live (3 Sep): a raid enchanter's Clarity (`"A cool breeze slips through your mind."`, shared by 5 spells) landed on her own Self Buffs because `255\tClarity` was in her SHM book and the ambiguous-narrowed-by-spellbook tier resolved it to Clarity. `_readOne` now skips `level === '255'` lines. `test/spellbook-multi-file.test.js`.

43. **`groupRoster` also learns a member from `"<Name> tells the group/raid/party, '…'"`.** Joining a group that already has members produces NO per-member "has joined" line for the ones already there (gotcha #7), and `matchGroupJoinAccepted` names only the one person you notified — so an existing member who never speaks is invisible to the roster. Reported live (3 Sep): Avenrae and Nocturis, in the group when Shara joined, never got their own damage-meter rows (folded into "Other"). A member talking in group chat is unambiguous current membership; the same signal `logGroupPeek` already uses on the startup scan.

45. **Bard-song fixes, 3 Sep (two).** (a) **Mote-rank duration carries across renewals.** A maintained song re-lands every ~6s with no cast line, `recentSelfCast` lives ~12s, so every renewal past the first fell through `_rankForEntry` with rank 0 and the song's duration collapsed to base × AA. `_land` now stores `castRank` on the active entry and carries it to the next renewal; `_scaledDuration(entry, rank)` takes it explicitly. A genuine re-sing at a different rank still wins (fresh cast line). (b) **The memorize-window self-attribution is 30s, not 6s.** `BARD_MEMORIZE_ATTRIBUTION_WINDOW_MS` — a real weave re-mems its whole rotation every ~24s (measured: two 4-song halves ~12s apart) and songs lapse/re-land constantly, so a 6s window only caught the pulse right after each memorize and the rest read "Unknown". `recentlyMemorizedAt` refreshes on every `"You have finished memorizing X."`, so 30s keeps an active rotation continuously credited. `_recentOtherCaster` (a real ally cast) is still checked first; a `targets:'Self'` song is still unconditional. `test/duration-scaling.test.js`, `test/bard-songs.test.js`.

46. **The Buff-timer premade picker holds only buffs; a detrimental spell (`kind:'det'`) is not offered "on yourself" and does not appear in the buff list at all.** Reported live (3 Sep): Affliction (a Disease DoT) showed in the Buff-timer picker defaulting to "Yourself" (it carries a second-person landing text only because an enemy casting it on you produces one). `buffs:trackable` now returns `self: !isDetrimental` (and `isDetrimental` catches `kind:'det'`, not just the `scaleCategory` list); `buffTimerPool()` in `main-window.js` splits `trackableBuffs` by which premade opened the shared panel — "Debuff on an enemy" (`defaultSource:'enemy'`) gets the `enemy` spells, "Buff timer" the `self` ones. The renderer disables an unusable "On:" radio and always lands the selection on an enabled one. `test/buff-timer-premade.test.js`, `test/enemy-debuffs.test.js`.

47. **`closeOnBackdropClick` — a modal closes only on a click whose mousedown ALSO started on the backdrop.** Reported live: picking a spell from a searchable dropdown "sometimes" closed the Add Aura modal. The dropdown's `<li>` items fire on `mousedown` and `pick()` hid the popup there, removing the `<li>` before the following `click` was dispatched — the browser then retargeted that click to whatever was under the pointer (the backdrop, when the popup overlapped it). Two fixes: `search-dropdown.js`'s `pick()` defers `close()` to the next tick; `closeOnBackdropClick` (shared helper in `main-window.js`) tracks the mousedown target. Applied to `setupModalToggle` (~15 modals), Add Aura, the custom-timer modal, the buff picker. `test/search-dropdown.test.js`.

49. **The damage meter keeps a raw per-name tally that no classification can drop.** Owner (3 Sep): "i want all the damage separated on the backend, so that when something happens that can retroactively split this ... it isn't lost." `damageEngine` now records every parsed damage line's ATTACKER into `rawFightByName` (cleared with `byAttacker` on `reset`) and `rawZoneByName` (cleared with `sinceZoneByAttacker` on `enterZone`), regardless of `_classify`'s verdict. `_tilesFrom` reconciles: a name that is a **confirmed friend now** — the player, someone in the group roster (gotcha #43), or a name already in `friends` — gets the larger of its classified total and its raw total. So a groupmate whose opening damage was unclassifiable (they fought a mob nobody else had touched) or went to "Other" (roster didn't know them yet) shows their COMPLETE damage the moment they're recognised, instead of that stretch being lost to the `pending` age cutoff or a fight reset. A fully-classified friend is unchanged (raw == classified → no top-up). Enemies and still-unknown names never consult raw. `test/damage-parser.test.js`.

48. **Ally Buffs "one section per buff" grouping** (`allyGroupBy: 'ally' | 'buff'`, per-aura, in `SHAREABLE_FIELDS`, only meaningful when `groupAllyBuffs` is on). `'ally'` (default) is the existing per-person grouping; `'buff'` makes one headed section per spell (heading = spell name, tiles named by recipient) — owner's "cast puma 8 times and it will all be under the 'puma' category." `overlay.js`'s `groupByAlly` keys on `buff.name` vs `buff.allyName`; `displayName` shows the other one. Settings: a "One section per: Player / Buff" radio under the grouping toggle. `test/ally-group-by.test.js`. **Side-by-side groups** (`groupAllyDirection: 'horizontal'`) in list mode: `overlay.js`'s render sets `content-wrap` to `max-content` and each `.ally-group` to a fixed column at the "List width" (CSS var `--ally-col-width`) — without that the columns were all crushed into one list-width (reported live 3 Sep). Vertical grouping and non-grouped list mode still pin `content-wrap` to the list width. **`sortDirection`** (`'asc'` default, per-aura, appended to `SHAREABLE_FIELDS`) flips whichever `sortOrder` is chosen — including `'default'` (cast order → newest first) — and `overlay.js`'s `orderGroups` applies the same `sortOrder`+`sortDirection` to the *sections/columns* of a grouped aura, not only the tiles inside each (owner, 3 Sep). `groupBySongType` keeps its fixed buff-then-debuff order.

50. **A raid-wide AE buff was auto-landed as the player's own spell that shares its landing text.** Reported live (3 Sep): "alacrity just landed in my self buffs even though i never cast it." A raid AE haste prints `Leche feels much faster. / Fahh feels much faster. / ... / You feel much faster.` in one tick. `"You feel much faster."` is shared by 13 spells so it goes through the ambiguous self path; Alacrity was the only one of the 13 in her spellbook, so the spellbook-narrow tier auto-landed it with no cast line of hers anywhere. The tell it ignored: the *same* landing text just landed third-person on a crowd. `buffEngine._recordThirdPersonLanding` (top of `handleLine`, one O(1) `findAllByOthersLandingSuffix` lookup per `<OneWord> <rest>` line) records `landingText -> {at, names:Set}`; `_looksLikeIncomingAE(text)` is true when ≥`AE_LANDING_MIN_OTHERS` (3) distinct others got it within `AE_LANDING_WINDOW_MS` (3s). When true, `incomingAE` skips the spellbook/gem "narrowed to one thing you know" auto-land tiers **and** the "your own burst is open" queue branch (a raid-wide Spirit of Wolf recast 34s after her own Quick Buff was showing up on her Self Buffs — reported live) — the line is simply IGNORED, off Self Buffs, no prompt during Quick Buff chaos. It is **not** gated on `otherCastMatch`: a buff on 3+ people at once is not yours whether or not someone was seen casting it. A remembered resolution and an already-active renewal still win (prior confirmed answers, not guesses). Complement to the single-unambiguous-suffix recorder at ~line 1220, which deliberately records nothing for a *shared* suffix. **Accepted frozen-replay shift (Sep 3, one day):** `totalLandings` −4, `ambiguousPrompts` 22→10; `distinctBuffsLanded` and `distinctAllyLandings` unchanged, no regressions. `test/detection.test.js`.
51. **A raid leader shuffling players between groups prints no join line — a silent groupmate is invisible to the damage meter.** Reported live (3 Sep): Avenrae and Nocturis were in the player's group during the raid but folded into "Other" on the meter, because EQ only prints `"<Name> has joined the group."` for a normal invite (gotcha #7), the two never spoke in group/raid chat (gotcha #43 would have caught them), and a raid-window group move announces nothing. Every `targets:'Group'` / `'Group Member'` spell the *player* lands on someone proves that someone is grouped — you cannot land a Group-target spell on a non-groupmate. `buffEngine.setGroupmateSink(fn)` fires from `_landOnAlly` when `!onEnemy && known.targets` is a group target; `main.js` wires it to `groupRoster.noteGroupmate(name)` (rejects a mob phrase / non-single-word name, otherwise `_add`s to `members`+`admitted`). Additive, like `bardSongTagger` — never removes anyone. `test/detection.test.js`, `test/group-roster.test.js`.
52. **The player's own burst window (`burstUntil`) was re-armed at every self-plausible ambiguous landing, so a raid buff phase held it open indefinitely.** Reported live (3 Sep): "my quick buff already happened, it's a 10 MINUTE cooldown, my window should be closed long before 34 seconds." Each of the ~6 re-arm sites in `handleLine` did `this.burstUntil = Date.now() + BURST_WINDOW_MS` whenever a self-plausible ambiguous buff landed while the window was open — and during a raid, other people's buffs land on the player constantly, each one pushing the window forward another 5s. Now all re-arm sites call `_rearmBurst()`, which refuses past `SELF_BURST_REARM_CAP_MS` (5s) from `burstOpenedBy.at` (the real open time, never re-armed); the window then lapses on its own ~5s later. **`inBurst`'s own definition (`Date.now() < burstUntil`) is deliberately untouched** — a first attempt made `inBurst` itself hard-capped and that flipped the `gate = !alreadyActive && !inBurst` guard, exposing ~1,070 real Quick-Buff-grant landings to the `alliesBursting`/`staleGem` vetoes (frozen-replay regression). Bounding only the *re-arm* has zero landing impact (replay: all five invariants stable, no regressions). The initial open in `matchActivate` (line ~913) is not a re-arm and is left alone. `test/detection.test.js`.

## Where the backlog actually lives

**`docs/QOL-BACKLOG.md` is the live backlog** — every requested change, tagged (NEW / CHANGE /
DATA / FIX / CLARIFY) and sequenced. Start there.

The owner's original 40-note backlog is **complete except #2** (a first-aggro premade, which she is
supplying herself). The per-note record used to live in `docs/NOTES-STATUS.md` and the
session-by-session reasoning in `docs/HANDOFF.md` / `docs/FEATURES.md`; all three were retired
once the work landed — their history is in git. Where an item below references a note number,
that's the original 40-note numbering.

The prose below is older triage kept for the *reasoning* behind why things were built the way
they were, not for status — `QOL-BACKLOG.md` and `docs/TESTING.md` are the current picture.

## Standalone-tool auras' settings-panel shape — designed and built 25 Aug; Travel guide unlocked 26 Aug, Damage parser unlocked (feat/damage-parser-unlock, 1 Sep release)

**Travel guide creation was unlocked 26 Aug, at the owner's direct request** — it's back in
`PREMADE_WIDGETS` in `main-window.js` (`id: 'travel-guide'`, `group: 'standalone'`), with its own
`SHAPE_FIELDS.travel` (`['list-format', 'timer-text', 'opacity', 'position', 'alerts',
'travel-settings']` — see below for why 'sort'/'merge'/'borders' were dropped rather than kept from
the 25 Aug shape, and what 'list-format' replaces them with).

**Damage parser was unlocked for the 1.0.0 release** (`feat/damage-parser-unlock`) — it too is now
in `PREMADE_WIDGETS` (`id: 'damage-parser'`, `group: 'standalone'`), creatable from Add Aura like
any other premade. It also picked up scope filtering ('all'/'group'/'mine' — see
`src/main/groupRoster.js`/`petTracker.js`) and charmed-pet rows along the way. The rest of this
section is kept for the reasoning behind the panel-shape work; treat every "still locked" sentence
below as historical, not current status.

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
The original design (23 Aug, the owner's own idea) read the *exact word* typed into a failed `/tell` as
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

**Built** as part of a much broader settings-panel rework (25 Aug, see
`test/settings-panel-shapes.test.js` and its own header comment for the full design): every aura
resolves to one of twelve shapes via `widgetShape()`, and a `SHAPE_FIELDS` table says which
optional rows/cards each shape gets. Damage parser and Travel guide are each their own shape,
and neither includes the buff-picker card, the "Watching:" row, or the Display style radios — only
their own settings block (`widget-damage-settings` / `widget-travel-settings`) plus whichever of
the ordinary aura fields actually apply (Travel guide's own list narrowed further on 26 Aug — see
above). Both display-verified live: creatable from Add Aura, settings panel opens and shows the
right fields, no leftover buff-picker/Watching remnants.

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
and `renderPlannedPremades()` function are gone entirely**; a planned/locked entry (`Damage parser`,
`First aggro` - the two still in `PLANNED_PREMADE_WIDGETS`) now renders inline, greyed out with its "Planned"
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

**Locked 27 Aug at the owner's request** ("lock the buff planner tab ... so that no one can access
it") until the `buff-loadout` overlay aura ships. The sidebar nav button is removed from
`index.html`; the `#page-planner` section and all of `buffPlanner.js` / `spellEffects.js` /
`buffLines.js` stay in place and keep their tests. `initBuffPlanner()` bails immediately when
`.nav-btn[data-page="page-planner"]` isn't found, so nothing wires up and no IPC fires. To
re-enable: add the nav button back (`data-page="page-planner"`, `id="planner-nav-btn"`) — that's
the whole change. `test/planner-wiring.test.js` pins the locked state.

the owner's ask: "input 3 classes, spit out your highest-level buffs and the best setup across the 14
buff slots." Design forks she chose: a main-window page **plus** a loadout aura, drag-to-reorder
priority (not a curated ranking), the 3 classes **tied to the active loadout profile**, and -
corrected 26 Aug after first build - **one shared character level, not per-class** ("it's one
character with a multiclass loadout, not three mains"), capped at **50** (the EQ Legends cap). The
level picker sits above the single row of three class dropdowns.

**`src/main/buffPlanner.js`** is the brain - pure, no file/path access. `computePlan({ roster,
classes, level, priorityOrder, checkStack, spellData, lines, excludedStats, excludedBuffs })` ->
`{ slots, overflow, songSlots, songOverflow, specialSongs, permanentSlots, combatSlots, totals,
statsKnown, stackingKnown, stackingCoverage, excludedStats, excludedBuffs, ... }`. `main.js` wires
the real roster, `stackingService`, and `spellEffects.js` in; tests wire fakes. **`buffPlanner.js`
and `spellEffects.js` both carry current, detailed header + inline comments — read those before
changing the maths.** The decisions that aren't in the code:

- **Candidates** — every `kind:'buff'` roster entry one of the 3 classes can cast at the character
  level, `targets` in `PLAYER_TARGETS` (Self/Group/Friendly/Group Member/Single), not
  `scaleCategory` `hot`/`heal`, not in `NON_STAT_CATEGORIES`, and (with the spell file) granting at
  least one recognised character stat. Ranked **purely by character-stat magnitude** — owner, 27
  Aug: "actual character stats only", "i don't want SPA anywhere near the calculations" (the term
  "SPA" is banned in `spellEffects.js`/`buffPlanner.js`, pinned by a test). `spellEffects.STATS` is
  the full stat set the planner knows.
- **Spell AC is stored 4× the applied value — `spellEffects.js` divides it down, floored**
  (`STAT_DIVISOR = { AC: 4 }`). Matches the owner's in-game readings and the published EQL spell
  references (Yaulp III raw 40 → +10, Verses of Victory raw 50 → +12). Every other stat is 1:1.
  Level-scaling ramps and the AC soft cap are out of scope — the planner ranks buffs, it is not a
  character sheet.
- **Balanced / Melee / Caster are stat-toggle PRESETS, not a weighting** (owner, 3 Sep: "remove
  the ... 0.5 weighting and instead have it just deselect them from the toggles when stats are
  useless ... more visual for the user"). `spellEffects.PRESET_EXCLUDES` lists which stats each
  preset un-ticks (Melee drops WIS/INT/mana regen/cast speed/max mana/spell damage %; Caster drops
  STR/DEX/AGI/ATK/haste/HP on hit; Balanced drops nothing). The renderer writes the resulting list
  to `plannerExcludedStats`; a deselected stat scores 0 (`combinedWeightScale`). **Resists and the
  rune stats get no toggle chip at all** (`NON_EXCLUDABLE`) — owner: "res buffs don't need a
  toggle as they are low priority anyway" — they still score, at their low `STAT_WEIGHT`.
- **No "always worth taking" list.** The old flat `PROC_SCORE_BOOST` was deleted 3 Sep — owner:
  "if it needs to have an always worth taking list it means the weights are wrong". A pure-proc
  buff (Spirit of the Puma, Katta's) scores nothing and lives in the uncapped Combat pool where
  score is only a display order.
- **Four pools** (`poolFor()`): **`buff`** (the 14 pre-combat slots), **`song`** (bard only, 5
  `songSlots`), **`permanent`** (`infiniteDuration` — Yaulp, Fury; uncapped; resolved on its own so
  Fury keeps its listing next to a temp Strength buff), **`combat`** (a short buff `durationSec <=
  300` **or** a `Combat Innates` proc; uncapped; owner's "burst-swap" loadout; **not** in `totals`).
- **The roster's `category` column is a STAT LABEL, not a stacking line** — the planner does NOT
  collapse by category. Conflicts are resolved through the curated heading model (`buffLines`, see
  the Architecture bullet and `docs/BUFF-STACKING.md`): `resolveByHeadings()` collapses each line
  to its best castable tier, orders by drag-priority-then-score, then walks the list claiming
  effect headings — a buff whose heading is taken, that a curated `blocked`/`overwrites` names, or
  that the ported engine says collides on an `unknown` / weak-`coexist` pair, goes to overflow
  with a reason. A **combination buff** (Aegolism, Harnessing of Spirit) only claims its headings
  if it scores ≥ the summed score of the line members it *subsumes* (its authored `blocks` list) —
  not a `stackDecision('overwrites')` sweep, which also catches buffs that *replace* the combo.
- **Drop reasons, all surfaced in the "Won't fit" card and the per-slot "why this one?" hover**
  (`beat` array on every slotted buff, inverted from every dropped buff's `beatenBy` + `reason`):
  `lineDrops` (lower tier), `zeroedDrops` (every scored stat turned off by the preset),
  `crossPoolDrops` (a permanent/combat buff the model says a slotted-14 buff blocks),
  `manualDrops` (the user X'd it — `excludedBuffs`), and `discountRedundantMultipliers` (a
  haste / cast-speed buff that isn't the strongest source of that multiplier loses that stat's
  weight — EQ applies one haste source at a time, but the buff still stacks for its other stats).
- **`specialSongs`** — Amplification is pinned as a reference row at the top of the song list
  (`special: true`, `score: null`, not counted against the 5 slots), only when a chosen bard class
  can cast it. It's a multiplier on every other running song, so its value depends on the whole
  loadout — "not something to math out here" (owner, 3 Sep). Note text: *"Boosts your Singing
  songs. Shown for reference."*
- **`songInstrument`** — every bard entry carries its instrument type (Brass / Singing / Stringed /
  Wind / Percussion), derived by `build-roster.js` from `spells_us.txt` field 32 (skill enum).
  Shown on each song row; `test/roster.test.js` pins the valid values + bard-only.
- **`collapseByStacking` / `collapseByCategory`** are the fallback for when `lines` is absent
  (never in the real app); they set `approximate: true` → `stackingKnown: false`.

**Data model** — `profileStore.js`, all per-profile and optional: `plannerClasses` (≤3 codes),
`plannerLevel` (1–50), `buffPlanOrder` (names, drag order), `plannerExcludedStats`,
`plannerExcludedBuffs`. A legacy `plannerPlaystyle` on an old profile is folded into the exclusion
list on read by `main.js`'s `plannerExcludedFor()` (nothing writes it any more). IPC:
`planner:getInput | setExcludedStats | setExcludedBuffs | setClasses | setLevel | setOrder |
compute`. `getInput` also returns `allStats` (`EXCLUDABLE_STATS`) and `presetExcludes`
(`PRESET_EXCLUDES`) for the renderer. **`compute` is recomputed live from `buffStore.getAll()`
every call, never persisted** (roster rebuilds every launch — same reasoning as gotcha #29).

**Page** — `initBuffPlanner()` in `main-window.js`, `#page-planner`. Level input + one row of
three class dropdowns; the preset buttons + per-stat toggle chips; the 14-slot loadout card,
"Symphonic" (bard only), "Permanent buffs", "Combat buffs", drag-to-reorder priority list, and
"Won't fit". All sections are `<details class="planner-acc" open>` **except Priority order and
Won't fit, which start closed** (owner). The loadout card header carries a **"Reset removed"**
button (shown only when `excludedBuffs` is non-empty). Every slotted row has an **X** that appends
its name to `excludedBuffs` and recomputes — the next-best buff pulls up into the freed slot.
Recomputes on every level / class / preset / toggle / drag / X change and on
`onActiveProfileChanged`.

Tests: `test/buff-planner.test.js` (maths + heading model + presets + X-removal, mutation-tested),
`test/spell-effects.test.js` (`combinedWeightScale`, `PRESET_EXCLUDES`, AC ÷4), `test/buff-lines.test.js`
(`buff-lines.json` + `stackDecision` + `stacksExplicitly`), `test/planner-wiring.test.js` (store +
IPC + markup), `test/spell-stacking.test.js` + `test/spell-stacking-engine.test.js` (the ported
engine + `buffEngine` stale-tile removal). **Not yet run in the real app** — see `docs/TESTING.md`.

**Still to build - the `buff-loadout` aura** (the owner chose "page + aura"): a repeatable aura kind
that renders the planned 14 as overlay tiles - active buffs counting down (cross-referenced against
the engine's `activeBuffs`), missing ones as greyed "not up" placeholders, so it doubles as a
"what am I missing" checklist while buffing. Reuses `customTimerEngine`'s reverse-detection
`alwaysOnEntry()` shape for the placeholders. Needs: a `widgetStore` kind, engine plumbing to feed
it the plan + active state, `overlay.js` rendering, a `SHAPE_FIELDS` entry, and a premade-list
entry under `group: 'standalone'`. Not started.

## Remaining backlog (see TaskList tool for live status)

`docs/QOL-BACKLOG.md` is the live backlog for smaller items; this section is the larger
architectural roadmap. It was **pruned of shipped work 31 Aug** — only genuinely-open items are
kept below, and git history holds the record of what landed
(the P1 bard-song containment, the P2 quick UI wins, the per-timer form overhaul, the Bard Songs
aura, and the first real slice of Action Bars are all done). None of what's left has been scoped
in detail; confirm design specifics with the owner before starting anything large.

**What's left, roughly in priority order:**
1. **P0 — the detection-engine rework** (below). Built 25 Aug as opt-in Diagnostics toggles, off
   by default, **never run in a real session** — the next step is a live session with them on,
   not more building. This is the app's actual job and nothing else matters as much.
2. **Add-Aura modal rework** — the per-timer form was overhauled; the Add-Aura modal itself
   wasn't (below).
3. **Multi-step / sequential aura type**, **unified aura-scale control**, **action-bar cover
   images** — each unbuilt, each its own design effort (below).
4. **Smaller open questions** — combat-state custom-timer trigger (needs a log sample),
   per-trigger sound settings, the "Where buff data comes from" copy fix.

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

- **The 13:05:38 "You feel protected." case.** Verified directly in `eqlog_<char>_rivervale.txt` line 503132. The real answer was **Armor of Protection** — named outright on the *very next line* (`You healed <char> for 212 hit points by Armor of Protection.`). The popup offered 4 candidates and Armor of Protection was not among them, because **it is not in the roster at all** (nor in the bundled `src/shared/data/buffs.json`). Game data has 7 spells landing with that exact text; the roster has 4. So the popup wasn't mis-ranking candidates — the correct answer had been mined out of existence. *Note this also means the heal-proc auto-resolve added earlier that same session would NOT have rescued this case, since it only matches against names already in the candidate list. That fix needs widening: a heal-proc line should be able to resolve to a spell the candidate list doesn't contain.*
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

### Add-Aura modal rework

The per-timer form was overhauled — `+ Add timer` opens `#custom-timer-modal-backdrop` with every
field visible, Edit reopens the same modal pre-populated, and the trigger-type picker is
data-driven (`TRIGGER_TYPES` in `main-window.js`, module scope; adding a real trigger type is an
entry with a `fieldsId` + that panel's markup + a case in `readTimerFormData`).

**The Add Aura choices screen was restructured 3 Sep** (`c926c41`) — owner's exact shape after two
wrong turns: the **original four buttons, plus one new "Standalone tools" button = five buttons,
grouped under three `<h4 class="add-widget-cat">` headings**, NOT sub-menus and NOT one giant
scrolling page. `#add-widget-choices` in `index.html`:
- **Standalone tools** → `data-choice="tools"` → `#add-widget-tools-panel`
- **Premade & custom** → `data-choice="premade"` → `#add-widget-premade-panel` · `data-choice="custom"` → `#add-widget-custom-panel`
- **Import** → `data-choice="import"` → `#add-widget-import-panel` (code box) · `data-choice="chat"` → routes to the import panel

Each `.add-widget-choice` click shows `#add-widget-${choice}-panel`; every panel's Back button
returns to `showAddWidgetChoices()` **except** the buff-timer panel (reached *from* the premade
list, one level deeper), whose Back is `showAddWidgetPremadePanel()`. `renderPremadeList()` sends
the `group: 'standalone'` premades to `#add-widget-tools-panel` and the rest to
`#add-widget-premade-panel`.

**The aura-name field was removed from Add Aura entirely** (`2be4382`) — `#add-widget-custom-panel`
no longer has a name input, and `widgetName(fallback)` just returns the fallback. Auras are named
by their kind; there is no editable name (same rule as buffs — never add one).

### Smaller open questions

- **Combat-state custom-timer trigger** — needs a real log sample: what exact line marks
  entering / leaving combat on this server?
- **Sounds scoped per-trigger instead of per-aura** — an owner "maybe": move alert-sound settings
  from one set per aura to one per buff/trigger within an aura. Weigh against the added
  settings-UI complexity.
- **"Where buff data comes from" copy** — the owner flagged it needs updating but didn't say what
  is wrong; ask before touching it.

### Bigger, unbuilt — design first
- **Multi-step/sequential aura type.** A new aura *kind* (chosen from the Add Aura modal, not a setting on an existing kind) where a defined sequence of triggers must fire in order, and only ONE icon/list line is ever active at a time across the whole sequence - unlike every current aura type, where multiple tracked items can be active simultaneously. Real new data model + engine behavior, not a tweak to `customTimerEngine.js`.
- **Aura scale option.** A single unified scale control (under Size) that scales icon + list + text together in one motion, draggable directly on the overlay via the existing blue move-mode box - an alternative to today's separate icon-size/text-size sliders. User raised their own open question: whether this should just *replace* icon size outright to cut down on option sprawl, rather than living alongside it.
- **Action bar cover replacements.** An entirely new overlay category, unrelated to buff tracking - small images/borders placed over the game's actual hotbar buttons, with a configurable action-bar layout and a size-percent control, ranging from full custom icons down to plain colored/transparent border frames (border-image support explicitly not built yet). Treat as its own feature area, not an extension of the widget/aura system.
  - **The Action Bars page is real now, not a stub.** `actionBarStore.js` / `actionBarManager.js` back a working layout with per-slot icon / name / border / cooldown / toggle, mutually-exclusive toggle groups (`abilityGroups.js` — stance / invocation, persisted), gem drag-to-**swap** on the settings grid, a marker dot on configured slots, and the move HUD for positioning a bar. **Still unbuilt:** the cover-image layer itself (custom art / plain border frames drawn *over* the game's hotbar), and `border-image` support.
  - Follow-on once the cover layer exists: pixel-stepper nudge controls (the move HUD covers coarse positioning already).
  - Follow-on/parallel, but possibly useful for buff icons too: general icon border support.

### Parked / low priority
- **#13 Rank-numeral duration scaling** — EverQuest Legends appends a trailing rank numeral to some cast-begin lines only (e.g. `"You begin casting Spirit of the Puma VII."` — landing/ended text stay numeral-free). Confirmed via direct `spells_us.txt` lookup that this is **not** the same mechanism as Yaulp's real per-tier spell IDs (Yaulp II–XIX genuinely exist as distinct spell IDs; Cannibalize VII/Malosi V/Promised Renewal IX do **not** — those numerals have no matching spell ID at all). So it's a custom server-side duration scaling effect layered on top of the base spell, not a roster/mining gap — do not attempt to "fix" this by re-mining. One data point so far: Spirit of the Puma (spell ID 6906, base 60s) observed landing at ~162s while cast at rank VII with the user's existing 65% Reinforcement+Exaltation multiplier already active — not enough alone to solve for the scaling formula (could be linear-per-rank, %-per-rank, or table-based, and this one point can't isolate the rank-VII bonus from the existing 65% multiplier already stacked on it). **Next step**: collect 2-3 more rank/duration pairs (different numerals on different buffs) — when the user reports a buff name after it wears off naturally in play, pull exact cast-begin/expire timestamps directly from the live log file (`eqlog_*.txt`, path in `config.json`'s `eqFolder`) rather than asking for manual stopwatching. Once a formula is fit, wire it in as a second multiplier alongside `durationMultiplierFor()` in `src/main/main.js` (`buffEngine.setDurationMultiplierFn` already supports composing factors).
- **#14 "You Have Been Dispelled" event-notification widget** — a premade widget idea, listed as a disabled "Planned" placeholder in the Add Widget modal's premade list (`main-window.js`'s `PLANNED_PREMADE_WIDGETS`) but not built. Not a duration/countdown widget like every other widget kind — a one-shot flash/message when the player's own dispel line lands (`"You feel very dispelled."`, confirmed in the live log; other severities like `"You feel a bit dispelled."` likely exist too, unconfirmed). This is a genuinely different widget *category* (event notification, no timer, no active/inactive state) from everything `widgetStore.js`/`overlay.js` currently model, so building it means designing that category, not just adding another `buffSource`.
## Working with the owner

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
  ally landings, 27 prompts, 91 unknown texts** — all five must be identical, because the owner's
  constraint is that *"if any functionality is lost during this process that is to be considered a
  failure."* **Freeze a copy of the logs first** — the owner plays live and `logSplitter` appends
  to the day files continuously, so a before/after over the live files gets a "different line
  counts — not comparable" warning and every row reads as changed.
  **One accepted baseline shift (3 Sep):** gotcha #39 dropped `distinctAllyLandings` ~4% (2146→2049
  on a 527k-line window) — every lost landing was verified as another raider's own self-cast that
  a coincidental mob cast had been shielding the app from resolving. The owner accepted it as a
  correction, not a loss. `distinctBuffsLanded` rose (+3: Center, Yaulp, Light Healing).
- **`node tools/smoke-launch.js`** before saying the app works. Tests never start Electron, and a
  `globalShortcut.register('Pause')` that *throws* rather than returning false shipped past a
  green suite once because of that.
- Unit-test detection logic changes directly against the real roster via a quick inline Node script (mock the `store` object's `loadJson`/`saveJson`, instantiate real `BuffStore`/`BuffEngine`, feed synthetic log lines) before rebuilding the whole app — much faster iteration than a full Electron rebuild cycle each time.
