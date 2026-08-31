# QoL & Feature Backlog

**This is the live backlog.** The older architectural / re-work roadmap (custom-timer overhaul,
multi-step aura type, aura scale, action-bar covers, etc.) lives in `CLAUDE.md`'s "Remaining
backlog" section. The owner's original 40-note list is complete except note #2 (first-aggro, she is
supplying it); the retired `FEATURES.md` / `NOTES-STATUS.md` / `HANDOFF.md` are in git history.

45 items, organised by area. Items 1–32 are the original batch; 33–43 were added 30 Aug (Section
C); 44–45 are enhancements that fell out of that work.

**Done:** #1, #2, #3 (a/b/c), #4, #5, #7, #8, #9, #10, #11, #12, #14, #16, #17, #18, #19, #20, #21,
#22, #23, #24, #25, #26, #27, #28, #29, #30, #31, #32, #33, #36, #39, #43, #44, #45, plus the
lockout / log-tools batch (Section D). **#13** declined (offline app). **#15** superseded by #45.
**#38** withdrawn (built, then pulled). **#34, #40, #41** dropped by the owner (31 Aug — #34 solved
another way, #40 purpose unclear, #41 "old, not needed").
**Still open:** #6 / #42 (profile-swap hotkey/command — parked, low priority), #35 (invis-drop
body-pull tell — parked, low priority), #37 (pet-is-attacking tracker — built on an unmerged
branch, not in this release).

Each item keeps the original ask. Tags describe **what kind of work it is**, not a judgement:

- **NEW** — capability the app does not have; you want it added.
- **CHANGE** — the app does this today, but not the way you want it.
- **DATA** — a spell / stance / zone entry is wrong or missing.
- **FIX** — something is visibly broken or misleading (your framing, or verified).
- **CLARIFY** — I need one more sentence from you before this can be scoped.

"Today:" lines are the current behaviour I actually checked in the code.

---

## A. Things that would genuinely make life easier

### 1. "Preview this aura" button — NEW — DONE
Flash a sample tile from the aura's settings panel to judge size / position / colour / font /
sound / justification without alt-tabbing into EQ.
*Fixed:* a **Preview** button next to Unlock / Reset position — `widgetManager.previewWidget(id)`
flashes a sample tile on the aura's real overlay window for ~6s (creating and showing the window
if it's hidden, then `applyVisibility` restores it). `overlay.js` `previewSampleBuffs()` switches
on the aura's `buffSource`.

### 2. Searchable zone picker for "Only in:" — CHANGE — DONE 30 Aug
The travel guide got a proper search-box popup (`zonePromptPopup.js` / `zone-prompt/`). The aura
settings "Only in:" control should get the same thing, or a filter field.
*Fixed:* the `<select id="widget-zone-select">` is replaced by a filter field
(`#widget-zone-search`) plus a click-to-add results list (`#widget-zone-options` /
`.zone-add-list`) — `renderZoneAddOptions()` replaces `populateZoneSelect()`. The value is always
a genuine zone string picked from `knownZones`, never parsed from typed text, so the no-typo
property the `<select>` was chosen for (24 Aug) is kept. `zone-gating.test.js` updated.

### 3. Full config backup / restore — NEW — DONE (all three parts)
One button to export **everything** — auras, profiles, known-buff edits, settings — and one to
import it. Matters for handing the app to other people and as a safety net before an update.
- **3a. "Open app data folder" button** — DONE. Setup › App data. Opens `userData` in Explorer.
- **3b. "Back up now" button** — DONE. `app:backupConfig` walks the top-level `userData`
  children one at a time into `userData/backups/backup-<stamp>/`, skipping Chromium `Cache`,
  `detection-logs`, and `backups` itself.
- **3c. Portable export / import bundle** — DONE. `src/main/configTransfer.js`. Export writes
  `userData/exports/eqls-config-<stamp>/` (every portable `.json` + `customSounds/` + `sounds/`,
  minus a 14-entry machine-specific deny-list — window bounds, live gem/zone state, EQ folder
  path, `splitProgress`). Import (in-app picker over exports **and** backups) takes a
  `pre-import-<stamp>` safety backup, swaps the files in, and restarts. IPC
  `config:export/import/listImportable/openExportsFolder`.

### 4. Attention badges on the sidebar — NEW — DONE
A count badge on the "Buff Tracker" nav button when ambiguous / unknown casts are queued.
*Fixed:* brass pill (`.nav-badge`), hidden at 0, shown while casts wait.

### 5. "Is it working right now?" indicator — NEW — DONE
*Fixed:* a *"Reading eqlog_X.txt — last line 3s ago"* line on the Buff Tracker page, fed by a
new `log:activity` IPC, coloured ok / warn by how stale the last line is.

### 6. Profile switching without alt-tab — NEW
A profile-cycle hotkey and/or an in-game command (`/tell eqprofile2`-style), same pattern as the
master-hide hotkey and `/tell eqtm`. Loadout swaps stay manual (deliberate) but shouldn't require
alt-tab → click chip → alt-back. Loadout swaps already generate log noise to hang a trigger off.

### 7. Stale "Not active yet." hint on the Timer-text colour picker — FIX — DONE 30 Aug
The hint said the control wasn't wired.
*Fixed:* the hint is removed from `index.html`. The timer-text-colour control was verified wired
end to end — list mode via `--timer-text-color`, icon mode via `applyTilePositionedTextStyle` —
so there is no mode where it does nothing; the hint was simply stale.

### 8. Live preview of `{spell}` / `{caster}` / `{profile}` templating — NEW — DONE
*Fixed:* a live `{spell}` / `{caster}` / `{mob}` / `{profile}` preview line under the "Say:"
field, resolving as you type.

### 9. Fullscreen warning — NEW — DONE
The About page says EQ must be windowed / borderless; when it isn't, the overlay silently vanishes.
*Fixed:* `foregroundWatcher`'s PowerShell query also calls `SHQueryUserNotificationState` now —
state 3 (D3D fullscreen) or 4 (presentation) sets a `foregroundFullscreen` flag on `focusChanged`.
`main.js` broadcasts `overlay:fullscreenWarning`; the Buff Tracker page shows a warning line in
the detection-status card. Only fires while the foreground watcher is running (auto-hide on).
*(The `SHQueryUserNotificationState` P/Invoke is verified against MS docs but not yet run on the
real machine — see TESTING.md.)*

### 10. Quick "mute all sounds" toggle in the top bar — NEW — DONE
Next to "Hide auras". For streaming or voice chat, without walking every aura's sound settings.
*Fixed:* a top-bar toggle backed by a runtime-only `widgetManager.soundsMuted` flag that gates
`shouldBeAudible` — **never persisted** (a fresh launch is always unmuted), and it silences
without hiding any tiles.

---

## B. Smaller things

### 11. Drag-to-move action bar gem-slot settings — NEW — DONE
Position the action-bar gem-slot settings by dragging.
*Fixed:* drag one gem box onto another on an action bar's settings grid to **swap** the two slots
(icon / name / border / cooldown / toggle trade places) — slots between them are untouched, it is
not a list reorder. `ActionBarStore.swapSlots` → `actionBarManager.swapSlots` → `actionBar:swapSlots`
IPC → `swapActionBarSlots` preload. (Wording was untraceable to an original note — the owner
confirmed "swap, not reorder".)

### 12. Auras stop when you die — NEW — DONE
When the player dies, active auras/timers should stop rather than keep counting.
*Fixed:* `buffParser.matchOwnDeath` (`/^You have been slain by .+!$/` — a different verb from the
mob-death lines `matchSlain` catches). `buffEngine._clearOnDeath()` clears active buffs + bard
songs + the pending cast; `customTimerEngine` clears active timers **except** ones in their
recast-cooldown phase. Replay over the real corpus: 48 death-clears + 19 song-clears, no
regression. Snapshot/restore needed no change (never-replay-history means a death *before* the
app starts can't retroactively clear anything).

### 13. Auto-updater — NEW — DECLINED
App updates itself. **Declined by the owner** — the app is offline-only and an auto-updater needs
a network call. `#18` (changelog) covers "what changed" without it.

### 14. Import character name / server, auto-build the filename — NEW — DONE
Enter name + server and have the app derive the spellbook filename automatically.
*Fixed:* two fields (name + server) in Setup › Spellbook detection build `<name>_<server>` and
feed `spellbookService.setCharacterOverride()` / `_effectiveBaseName()`, which beats the
log-derived character name when set. Persisted as `spellbookCharacter`; `getExpectation()`
reports `manualCharacter`. For when auto-detection picks the wrong log or none.

### 15. Looping-sound premade — NEW — SUPERSEDED
A tempo generator: after a chat line is read, play a sound every X seconds until a second chat
line is read.
*Superseded 30 Aug* by the per-aura **"Sound cooldown" slider** (`soundCooldownSec`, 0–60s) — the
owner's replacement for this: rather than a metronome, it sets the shortest gap between any two
alert sounds from one aura (across land/expire/warning). The motivating case (a pulsing buff
beeping on every refresh) is solved by capping the rate, not by adding a loop. Reopen only if a
true metronome is still wanted for something.

### 16. Remember stances & invocations between logouts — NEW — DONE
Persist the user's chosen stances / invocations across restarts. (Depends on #20 / #21 existing.)
*Fixed:* the active stance / invocation is now persisted by toggle **name** (survives re-laying-out
the bars, which a slot key wouldn't), restored at startup and resolved against the current bar
layout. New store key `activeAbilityGroups`; `abilityGroups.js` gains `activeNameByGroup`,
`setPersistFn()`, `restore()`. Same "a stance is a character state you're still in" reasoning as
the startup zone recovery.

### 17. Song durations round to the nearest 6 seconds — CHANGE — DONE
Song durations run in 6-second intervals. A mote-upgraded song duration must land on a 6s boundary.
*Fixed:* `_scaledDuration` in `buffEngine.js` quantises `isBardSong` entries to a multiple of 6
as the **last** step (after tier × AA), floored at 6. Non-song durations are untouched.

### 18. Changelog — NEW — DONE
An in-app changelog.
*Fixed:* `src/shared/data/changelog.js` (a `CHANGELOG` array, newest first, `version: 'Unreleased'`
at the top), `app:getChangelog` IPC, rendered on the About page under "What's changed"
(`initChangelog()` → `#changelog-body`, `textContent`). The Documentation session owns the
content — it updates the top entry (new features first, then fixes) in the pre-PR doc pass.

### 19. Indicator for whether an action-bar slot has a skill bound — NEW — DONE
Show which action-bar slots currently have an active skill bound to them.
*Fixed:* a small accent dot on any gem box that has anything configured (icon, name, cooldown,
toggle, border, background, or disabled) — so a bar's real layout stands out from the empty
padding slots. Settings-panel only. (Also an untraceable-wording judgement call — owner may want
to confirm or redo.)

### 20. Balanced / Defensive / Mage Hunter / Striker stances not selectable — DATA — DONE
None of these stances can be selected. They should be.
*Fixed:* `roster-overrides.json` can now **add** spells (not just edit existing ones), so 8 stances
and 7 invocations were added to the roster by name. The `actionBar:getKnownAbilityGroups` picker
is now built **from the roster** (category Stance / Invocation) unioned with the `KNOWN_` seed
lists — a hardcoded 3 + 6 list was the actual reason the extra stances "couldn't be selected".
6 of the 15 landing texts are log-confirmed; the other 9 are **derived** from the confirmed
template (`"You assume a/an <x> stance."` / `"You begin reciting the <x> invocation."`) and marked
`DERIVED — correct this line if wrong` in `roster-overrides.json` — they need one live in-game
confirm each (TESTING.md).

### 21. Spellblade and Empowering Invocations missing — DATA — DONE
Add them to the roster source.
*Fixed:* covered by the same change as #20 — see above.

### 22. Per-line centred justification for text-only auras — CHANGE — DONE 30 Aug
Each line of a text-only aura should be centre-justified on its own, even when several lines are
active at once.
*Fixed:* `overlay.js` `drawTextFeed()` now sets the feed column's `align-items` from
`currentConfig.textJustify` (each `.text-tile` is `width:max-content`, so without an explicit
cross-axis alignment shorter lines sit left even under centre/right); `applyConfig` clears it when
leaving text-feed mode. Completes the already-wired `textJustify` setting (`test/text-justify.test.js`,
8 cases, green). *(Change was authored ~27 Aug and sat uncommitted; committed 30 Aug.)*

### 23. Scheduled automatic log split — NEW — DONE (reframed)
Set a time of day to auto-split the log (useful for lockout tracking). A setting in Settings,
mirrored into the tracker tab.
*Fixed:* the original wording traced to nothing (not the owner's note 23, which was text-only
auras). The owner's actual intent: set **when the per-day split file rolls over**. `logSplitter`'s
`extractDateKey` now takes a `dayStartHour` (0–23, default 0 = calendar midnight); a non-zero value
shifts each line's stamp back that many hours before bucketing, so a raid past midnight stays in
one file dated for the night it started. Live log and real timestamps are untouched — it only
decides which copy-file a line lands in, and does **not** affect weekly rotation or lockout
tracking. New "New day starts at:" dropdown on the Log page; store key
`splitSettings.splitDayStartHour`. (Same change removed the dead session-gap split option.) The
"mirrored into the tracker tab" part was not done — the setting lives on the Log page only.

### 24. Auto-archive logs / prompt on load when the log is big — NEW — DONE
On app load, if the log is large enough to benefit from archiving, either auto-archive or prompt
the user. Must fire **even on first load**, in case the user has never archived.
*Fixed:* on launch, if the live log has grown past 50 MB (on size alone — no calendar or rotation
timing, so it fires for someone who has never archived), an in-app modal offers "Trim to this
week". That routes through the lockout-safe `trimAtBoundary` (archive everything before this
week's reset, keep the current lockout week in the live log) rather than a whole-log archive that
would blank the Lockouts grid. A 7-day re-nudge cap (`logArchivePromptDismissedAt`); a successful
trim clears the dismissal so a later regrowth re-nudges.

### 25. Line-aura images paint on top of their coloured border — FIX — DONE 30 Aug
On line (list) auras the icon image sat above the coloured category border; the border should be
higher.
*Fixed:* the category edge is redrawn on `.buff-row.cat::after` at `z-index: 3`, above every
child, instead of as an inset `box-shadow` the flex-sibling icon could cover. Icon tiles are
unchanged (nothing paints over their box-shadow). `overlay.css` only.

### 26. "You feel smaller" can only ever be Shrink, never Tiny Companion — CHANGE — DONE
The disambiguation always resolves this landing text to Shrink.
*Fixed (the other way round):* Tiny Companion `targets` a **Pet**, so it can never land on the
player — the bug was that the disambiguation was queuing a real Shrink-vs-Tiny-Companion prompt at
all. `buffEngine` now drops candidates whose roster `targets` is Pet / Animal / Undead / Construct
/ Corpse / Plant before the self-cast tiers (a denylist, so a custom entry with no `targets` is
still considered). Shrink now resolves alone with no prompt. *(A real duration for either spell is
a separate DATA item and still open.)*

### 27. "No active on this aura" for bard songs — CLARIFY — DONE
Original note: *"NO ACTIVE ON THIS AURA BUFFS FOR BARD SONGS."*
*Fixed:* it was meaning (b) — the "Active on this aura" card in the Bard Songs premade's settings
showed nothing. The settings window had no bard-songs feed (no preload bridge; it fell through to
self buffs) and `filterActiveBuffsForWidget` applied the inherited `hideBardSongs: true` default
which strips every row. Added the IPC / preload / renderer feed (`getActiveBardSongs` +
`onActiveBardSongsChanged` + `removeActiveBardSong`, mirroring ally-buffs) and a `bardSongs` bypass
in `filterActiveBuffsForWidget`.

### 28. Cassindra's Chant of Clarity set to 1 min — DATA — RESOLVED 30 Aug
Showed a 1-minute duration in-app; wrong.
*Fixed:* you confirmed the real duration is **12s**; applied in `tools/roster-overrides.json` +
code (session eq-tracker-d3). Kept here for the record — drop from the active list.

### 29. Debuff bard songs should be tracked — NEW — DONE
Debuff-type bard songs (mez / slow / snare / dot songs) should be tracked on the Bard Songs aura.
*Fixed:* the Bard Songs aura is now a hybrid buff/debuff feed. A bard song that lands third-person
(a debuff song on an enemy) is mirrored into `bardSongs` keyed by target, with `isDebuff` +
`spellCategory: 'debuff'` (so it gets the debuff-coloured border automatically). Two per-aura
options, both **off by default**: `showDebuffSongs` (opt them into the feed) and `splitSongsByType`
(group buff / debuff songs into their own sections). Settings block `#widget-bard-song-settings`,
`SHAPE_FIELDS` key `bard-song-options`.

### 30. Community shorthand / nicknames for zones in `eqtm` — NEW — DONE
Recognise community nicknames and shorthand for zones ("inny", etc.), and let the picker search
by boss name.
*Fixed:* `src/shared/data/zoneAliases.js` — 191 curated aliases (from `docs/EQTM-ALIASES.md` §6)
plus an auto-indexed client short-name. `searchPickableZones()` unions substring + alias +
short-name matches (exact-or-prefix, 2-char floor); `travel:searchZones` IPC feeds the
`zone-prompt` renderer. Nicknames/boss-names are matched but still **not listed** in the
real-zone results (that separation is #31's rule).

### 31. No "+N more" truncation in the `eqtm` search list — CHANGE — DONE 30 Aug
If a match is a real zone, always list it — don't cap the results. Do **not** list nicknames or
shorthand in that list (those are #30, kept separate).
*Was:* `zone-prompt.js` sliced to `RENDER_CAP` (60) and showed `"+N more - keep typing to narrow
it down"`.
*Fixed:* removed the cap in `zone-prompt.js render()` — every real-zone match is now listed
(~104 unfiltered, renders fine); dropped the now-unused `.zone-more` CSS rule. The "no matches"
line is unchanged. No test covered this file; renderer-only change.

### 32. The Hole route goes through Erudin instead of Paineel — FIX — DONE 30 Aug
Routing to Ruins of Old Paineel (The Hole) sent you via Erudin; it should go via Paineel.
*Fixed:* researched — the Erudin and Neriak-3rd-Gate teleport pads are *inside* The Hole and
exit-only; every documented entrance is the Paineel ground route. Both edges are now one-way in
`src/shared/data/zoneGraph.js` (removed `Erudin→Hole` and `Neriak-3rd-Gate→Hole`, kept the
outbound exits), same shape as the instance-tier exclusion in gotcha #23. Sources in the caveat
comment at the bottom of `zoneGraph.js`. `zone-routing.test.js` green.

---

## C. New work — 30 Aug batch

A raw note-dump (33–43), plus 44–45 which came out of building it. Same tag meanings as above.
Several need one more sentence from you before they can be scoped — flagged inline and repeated
under "Where I still need input".

### 33. Zone-named kill tracker → per-zone named-kill board — NEW — DONE
Original ask was a kill counter; the owner's actual scope was **per-zone named tracking** — enter
a tracked zone and every named mob shows "up"; a slain line greys it; re-enter a fresh instance
and the board resets.
*Fixed:* new `raidNamed` buff source + `raid-named-builtin` aura kind + `SHAPE_FIELDS` entry;
`src/shared/data/raidZoneNameds.js` (16 zones — the 6 Voidling raid zones + 8 surveyed dungeons:
Mistmoore, Lower Guk, Crushbone, Befallen, Blackburrow instanced; Najena, Splitpaw, the Warrens
open-world with per-named respawn countdowns) and `src/main/raidNamedTracker.js` (own engine +
`changed` event). Boss / mini / lesser 3-tier sort. Apostrophes are matched as the backtick the
EQL client emits. **Not covered** (a deliberate scope line): ~50 no-named overworld / city zones,
and Temple of Cazic-Thule / Upper Guk / RunnyEye / Unrest (eqlwiki-only, not eqlsource-surveyed).
An earlier build restricted the board to raid zones behind a "Voidling danger" gate — that was an
over-narrowing and was discarded; **do not rebuild it**.

### 34. Bard 6-second pulse timer tracker — NEW — DROPPED
A metronome widget showing the bard song pulse cadence.
*Dropped by the owner (31 Aug) — solved another way.*

### 35. First-hit tracker: also flag invis dropping before the boss aggros — NEW — PARKED
An invis / IVU wearing off *before* a mob aggros is itself a body-pull tell, same as a first
melee/spell hit. The first-hit tracker should treat "invis faded → then aggro" as a body pull.
*Parked (low priority, 31 Aug)* — hangs off the owner's own first-aggro premade (note #2).
*Needs:* the exact invis-fade lines from the log; and what "before the boss aggros" is measured
against (an aggro line vs. first damage).

### 36. Loss-of-control widget — fear / charm / mez on you — NEW — DONE
One widget that lights up when the player is feared, charmed, or mezzed (i.e. can't act).
*Fixed:* a text-alert premade (Event alerts group) showing STUNNED / MESMERIZED / CHARMED / AFRAID
/ ROOTED / SNARED, cleared by the fade line — 15 exact trigger/ended pairs (`LOSS_OF_CONTROL` in
`widgetStore.js`), same "watch a wording set under one tile" pattern as Charm Broke. It also
catches the game's **generic** `"You lose control of yourself!"` (cleared by `"You have control of
yourself again."`, labelled CONTROLLED, 45s safety net) — the game writes that when a charm lands
on the player with no spell-specific line. `widgets.json` schema migration adds the CONTROLLED
trigger to any existing Loss of control aura that lacks it.

### 37. Pet-is-attacking tracker — NEW — BUILT (not in this release)
An indicator for whether your pet is currently engaged — pet-attack / pet-target lines vs.
pet-returning / pet-dead lines.
*Built on an unmerged branch* (`TEXT_AURA_PRESETS.petStatus`: PET ENGAGED / IDLE / GONE off the
pet's own speech lines, Event alerts group) — not part of the pre-PR `integration` batch, so not
shipping yet. Fold into the next batch.

### 38. GCD tracker — NEW — WITHDRAWN
A "Global recovery (GCD)" premade — a short countdown of the recovery time between casts.
*Built 30 Aug, then withdrawn by the owner the same day.* The global recovery is only ~1.5s, and
on a whole-second overlay tick that tile only ever flashed — not worth the surface area (a new
`anyCast` trigger mode, per-spell cast-time injection, a store-schema bump). Removed entirely
(`widgets.json` v3→v4 drops any GCD auras; trigger modes back to `contains` / `castOf` /
`zoneEnter` / `zoneLeave`). The greyed "Global recovery" placeholder that used to sit in the
Timers premade list is gone with it. Reopen only if the recovery turns out to matter and the
overlay can show sub-second timing.

### 39. Ship the bundled sound files somewhere browsable — NEW / CHANGE — DONE
Put the starter sounds where they're easy to browse and keep, not wiped on uninstall.
*Fixed (redesigned by the owner — `userData`, not Downloads):* the starter sounds, the "Choose
sound…" browse folder, and files you drop in now all live in **`userData/sounds/`**, seeded on
startup from the install `sounds/` bundle (`soundService.seedStarterSounds()` — idempotent, never
overwrites a file already there, never touches user files). `defaultPickerDir()` prefers it. The
install `sounds/` folder is purely the seed source now. One folder family with auras / profiles →
one backup location (#3a/#3b), survives uninstall, nothing written to Downloads.

### 40. Memmed-spell set checker — "if these spells are memmed, show the set" — NEW — DROPPED
Define named gem sets; show the set's name when the memorised spells match.
*Dropped by the owner (31 Aug): "i don't know what this was for."*

### 41. New mez premade — NEW — DROPPED
A second mez premade, distinct from the Mesmerize worked example (#17).
*Dropped by the owner (31 Aug): "old, not needed."*

### 42. Chat-read command and/or hotkey for macro-driven profile swap — folds into #6
Your open question ("chat read for macro profile swap? hotkey?") *is* backlog item **#6**
(Profile switching without alt-tab). Recording both options there: a profile-cycle hotkey, and/or
an in-game `/tell` command word your macros can fire (same pattern as `/tell eqtm`). Still need
your call on which — or both.

### 43. Plane of Hate ← Oasis of Marr portal modelled two-way but is one-way in — FIX — DONE
eqlwiki: no return portal from Plane of Hate — you Gate / Origin out. Same shape as #32 (and
gotcha #23).
*Fixed:* Plane of Hate's outbound `connections` are emptied (it's a spell-only sink); the inbound
edge stays. Two `zone-routing` tests updated. Same commit tidied the Plane of Sky / Plane of Fear
clarifying comments.

### 44. Searchable spell picker for the "Skill cast" custom-timer trigger — CHANGE — DONE
The trigger's spell picker was a `<select>`; bard songs were missing from it entirely.
*Fixed:* a filter bar + click-list (like #2's zone picker). `buffs:allNames` now returns
`{name, iconId, isBardSong}` for every roster spell — the old `buffs:castable` filtered to
recast > 1.5s, which silently excluded songs and instants. Reported live 30 Aug.

### 45. Per-aura "Sound cooldown" slider — NEW — DONE
A 0–60s slider per aura (`soundCooldownSec`) setting the shortest gap between any two alert sounds
from that aura, across all three kinds (land / expire / warning). Stops a pulsing buff beeping on
every refresh. In `SHAREABLE_FIELDS` + `normalizeWidget`; clamped by
`widgetStore.clampSoundCooldownSec`. This is the owner's replacement for the looping-sound aura
(#15). *(A first cut didn't persist — `widgetManager.setSoundCooldownSec` called the clamp on the
store instance instead of the module export, and the throw silently ate the whole `update()`;
fixed same day.)*

---

## D. Shipped — lockout & log tools (30 Aug, PR #15)

Landed on `feat/lockouts` (`ff4b7a5` + follow-ups). Full architecture writeup is in `CLAUDE.md`
("Lockouts and log rotation"); the in-game test checklist is `docs/TESTING.md` section 10;
parser provenance is `docs/EVIDENCE.md`.

- **Raid-lockout grid.** EQL prints no lockout line, so `lockoutCore.js` keys off the weekly-task
  assignment lines around a boss kill. It never hardcodes a reset day — reports "not recorded"
  until it has seen a turnover both ways.
- **User-editable weekly reset** (`lockoutReset`, default Tuesday 11:00 US Eastern), DST-aware via
  `src/shared/easternReset.js`, mirrored between the Lockouts page and Setup as one setting.
- **Weekly log rotation now defaults ON**, with guardrails (won't rotate across a boundary with
  post-reset play; status line explains a skip).
- **"Trim log to this week"** — manual backward-EOF trim, archive size-verified before the live
  log is rewritten, kept week not re-emitted/re-split.
- **"Change log file" / "Add split files"** — read the lockout grid from a chosen split/archive
  file; add-split pre-ticks only the current week; a missing target falls back to the live log.
- **"EQ running but not logging" watcher** — modal prompt for `/log on` after a grace window.
- **All lockout/log prompts are in-app modals** now (no native `window.confirm` /
  `dialog.showOpenDialog`). The "start new file after a session gap" checkbox was removed.
- **Fixes carried in the same batch:** crash-safe `store.saveJson` (temp-file-then-rename);
  `logSplitter` no longer doubles lines on a re-split from offset 0; backfill reads only the live
  log (was a whole-folder scan); grid cells show the kill date; period heading uses short month
  names.

**Related numbered items:**
- **#23** — **DONE** in a later batch as a user-set per-day split rollover hour (not a scheduled
  archive). See #23 above.
- **#24** — **DONE** in a later batch: a 50 MB size check on launch that offers a week-safe trim.
  See #24 above.

---

## Working notes

- Several Claude sessions edit this tree in parallel — check `ListAgents` before touching a hot
  file (`index.html`, `main-window.js`, `overlay.js`, `buffEngine.js` are the usual ones), and
  route doc/backlog edits through the **Documentation** session (see `CLAUDE.md`).
- The roster spreadsheet is retired (31 Aug). `src/shared/data/buffs.json` is the roster of
  record; `tools/roster-overrides.json` is the one place it's edited and can now both `set`
  (correct an existing entry) and `add` (a brand-new spell). Rebuild with
  `node tools/build-roster.js --write`.

---

## Implementation order

Almost everything is **done** (see the "Done" list at the top). What genuinely remains:

### Parked — low priority, the owner's call to revive
- **#6 / #42** — profile-cycle hotkey and/or a `/tell` command word for macro profile swap.
  Still needs the owner's call: hotkey, chat command, or both.
- **#35** — invis-drop-before-aggro body-pull tell → hangs off the owner's own first-hit tracker
  (note #2). Needs the exact invis-fade log wordings and what "before aggro" is measured against.

### Built but not in this release
- **#37** — pet-is-attacking tracker. Built on an unmerged branch; not part of the pre-PR
  `integration` batch.

### Data follow-up (not doc work — a live-play task)
- 9 of the 15 stance / invocation landing texts (#20 / #21) are **derived**, not log-confirmed.
  Each needs one in-game use to confirm the wording; a wrong one gets its `roster-overrides.json`
  `why` line corrected. Listed in `docs/TESTING.md`.

---

## Where I still need input

- **#6 / #42** — profile swap: hotkey, in-game `/tell` command word, or both?
- **#35** — the exact invis-fade log wordings; and "before aggro" measured against what line?
