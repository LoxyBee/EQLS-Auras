# QoL & Feature Backlog

**This is the live backlog.** The older architectural / re-work roadmap (custom-timer overhaul,
multi-step aura type, aura scale, action-bar covers, etc.) lives in `CLAUDE.md`'s "Remaining
backlog" section. Shara's original 40-note list is complete except note #2 (first-aggro, she is
supplying it); the retired `FEATURES.md` / `NOTES-STATUS.md` / `HANDOFF.md` are in git history.

45 items, organised by area. Items 1–32 are the original batch; 33–43 were added 30 Aug (Section
C); 44–45 are enhancements that fell out of that work.

**Done:** #1, #2, #3 (a/b/c), #4, #5, #7, #8, #10, #12, #14, #18, #22, #25, #28, #30, #31, #32,
#38, #39, #43, #44, #45, plus the lockout / log-tools batch (Section D). **#13** declined
(offline app). **#15** superseded by #45.
**Still open:** #6, #9, #11, #16, #17, #19, #20, #21, #23, #24, #26, #27, #29, #33–37, #40, #41, #42.

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

### 9. Fullscreen warning — NEW
The About page says EQ must be windowed / borderless. `foregroundWatcher.js` already knows when EQ
is focused; it could also notice exclusive-fullscreen and say *"auras won't be visible over EQ
right now"* instead of leaving you wondering why the overlay vanished.

### 10. Quick "mute all sounds" toggle in the top bar — NEW — DONE
Next to "Hide auras". For streaming or voice chat, without walking every aura's sound settings.
*Fixed:* a top-bar toggle backed by a runtime-only `widgetManager.soundsMuted` flag that gates
`shouldBeAudible` — **never persisted** (a fresh launch is always unmuted), and it silences
without hiding any tiles.

---

## B. Smaller things

### 11. Drag-to-move action bar gem-slot settings — NEW
Position the action-bar gem-slot settings by dragging.

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

### 16. Remember stances & invocations between logouts — NEW
Persist the user's chosen stances / invocations across restarts. (Depends on #20 / #21 existing.)

### 17. Song durations round to the nearest 6 seconds — CHANGE
Song durations run in 6-second intervals, not per-second. When a song duration is upgraded with
motes, the result must be rounded to the nearest 6 seconds.
*Today:* mote scaling (`buffEngine`, `_rankForEntry` / scaling math — see gotcha #27) rounds once
over the combined multiplier with no 6-second quantisation for `isBardSong` entries.

### 18. Changelog — NEW — DONE
An in-app changelog.
*Fixed:* `src/shared/data/changelog.js` (a `CHANGELOG` array, newest first, `version: 'Unreleased'`
at the top), `app:getChangelog` IPC, rendered on the About page under "What's changed"
(`initChangelog()` → `#changelog-body`, `textContent`). The Documentation session owns the
content — it updates the top entry (new features first, then fixes) in the pre-PR doc pass.

### 19. Indicator for whether an action-bar slot has a skill bound — NEW
Show which action-bar slots currently have an active skill bound to them.

### 20. Balanced / Defensive / Mage Hunter / Striker stances not selectable — DATA
None of these stances can be selected. They should be.
*Needs:* exact in-game names + effect data to add them to the roster source.

### 21. Spellblade and Empowering Invocations missing — DATA
Add them to the roster source. *Needs:* in-game names + data.

### 22. Per-line centred justification for text-only auras — CHANGE — DONE 30 Aug
Each line of a text-only aura should be centre-justified on its own, even when several lines are
active at once.
*Fixed:* `overlay.js` `drawTextFeed()` now sets the feed column's `align-items` from
`currentConfig.textJustify` (each `.text-tile` is `width:max-content`, so without an explicit
cross-axis alignment shorter lines sit left even under centre/right); `applyConfig` clears it when
leaving text-feed mode. Completes the already-wired `textJustify` setting (`test/text-justify.test.js`,
8 cases, green). *(Change was authored ~27 Aug and sat uncommitted; committed 30 Aug.)*

### 23. Scheduled automatic log split — NEW
Set a time of day to auto-split the log (useful for lockout tracking). A setting in Settings,
mirrored into the tracker tab.
*Today:* `logSplitter.js` does continuous per-day splitting; there's no scheduled manual split.

### 24. Auto-archive logs / prompt on load when the log is big — NEW
On app load, if the log is large enough to benefit from archiving, either auto-archive or prompt
the user. Must fire **even on first load**, in case the user has never archived.
*Today:* `logService.js` has manual "Archive log" (copy + truncate); nothing checks size on
startup.

### 25. Line-aura images paint on top of their coloured border — FIX — DONE 30 Aug
On line (list) auras the icon image sat above the coloured category border; the border should be
higher.
*Fixed:* the category edge is redrawn on `.buff-row.cat::after` at `z-index: 3`, above every
child, instead of as an inset `box-shadow` the flex-sibling icon could cover. Icon tiles are
unchanged (nothing paints over their box-shadow). `overlay.css` only.

### 26. "You feel smaller" can only ever be Shrink, never Tiny Companion — CHANGE
The disambiguation always resolves this landing text to Shrink.
*Today verified:* **both** Shrink and Tiny Companion are in the roster, both with landing text
`"You feel smaller."`, both with no duration set — so it's genuine shared/ambiguous text
(gotcha #2) and resolution always picks the same one. Want Tiny Companion reachable. Both also
need a real duration.

### 27. "No active on this aura" for bard songs — CLARIFY
Original note: *"NO ACTIVE ON THIS AURA BUFFS FOR BARD SONGS."*
I'm not sure which you mean:
- (a) the Bard Songs aura should show a "no active buffs on this aura" empty state like other
  auras, or
- (b) bard songs aren't registering as active on the Bard Songs aura at all.

### 28. Cassindra's Chant of Clarity set to 1 min — DATA — RESOLVED 30 Aug
Showed a 1-minute duration in-app; wrong.
*Fixed:* you confirmed the real duration is **12s**; applied in `tools/roster-overrides.json` +
code (session eq-tracker-d3). Kept here for the record — drop from the active list.

### 29. Debuff bard songs should be tracked — NEW
Debuff-type bard songs (mez / slow / snare / dot songs) should be tracked on the Bard Songs aura.
*Today:* only `kind:'buff'` songs feed the Bard Songs aura; debuff songs are not tracked there.

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

### 33. Zone-named kill tracker — NEW
A widget that counts mob kills and labels the count with the current zone — e.g.
*"Plane of Fire — 47 kills"*. Segments on zone change.
*Today:* `damageEngine.js` already reads death lines and derives friend/enemy direction
(gotcha #20); `widgetManager` / `customTimerEngine` already track the current zone. This is a new
counter widget stacked on both — no new log parsing, mostly a new widget kind + overlay render +
a `SHAPE_FIELDS` entry.
*Open:* per-zone running totals kept for the whole session, or just the current zone reset on
entry? Call out named-boss kills separately?

### 34. Bard 6-second pulse timer tracker — NEW
A metronome widget showing the bard song pulse cadence — a 6s repeating countdown so you can see
when the next pulse tick lands (and whether a fading song gets one more tick).
*Today:* the 6s pulse is confirmed (note 24 — 314,324 gaps measured at exactly 6s); nothing
surfaces it. Needs an anchor line, then free-run every 6s, re-anchored on each observed pulse.
*Open:* anchor off any song-pulse line, or off your own song specifically?

### 35. First-hit tracker: also flag invis dropping before the boss aggros — NEW
An invis / IVU wearing off *before* a mob aggros is itself a body-pull tell, same as a first
melee/spell hit. The first-hit tracker should treat "invis faded → then aggro" as a body pull.
*Today:* the first-aggro premade is note #2, which you're bringing yourself — this hangs off that.
`buffParser.js` would need the invis-fade wordings.
*Needs:* the exact invis-fade lines from your log; and what "before the boss aggros" is measured
against (an aggro line vs. first damage).

### 36. Loss-of-control widget — fear / charm / mez on you — NEW
One widget that lights up when the player is feared, charmed, or mezzed (i.e. can't act), with a
countdown when the duration is knowable and just a state flag when it isn't.
*Today:* the app tracks buffs/debuffs but has no "you are CC'd" concept. The self-fear / self-mez /
self-charm landing+fade lines are in the logs (notes 11/16/17 — 251 mez landings, 129 charms);
the roster carries `scaleCategory:'charm'`/`'mez'`/fear entries to watch.
*Open:* countdown or on/off alert only? Include root / snare / stun, or strictly the three named?

### 37. Pet-is-attacking tracker — NEW
An indicator for whether your pet is currently engaged — pet-attack / pet-target lines vs.
pet-returning / pet-dead lines.
*Needs:* the pet combat wordings from your log (pet hit, pet taunt / "My leader is…", pet death,
`/pet back off` and `/pet get lost` acknowledgements).

### 38. GCD tracker — NEW — DONE  *(the "Global recovery" premade placeholder)*
A "Global recovery (GCD)" premade in the Timers group — a short countdown of the global recovery
time between casts.
*Fixed:* a new `anyCast` custom-timer trigger mode (fires on any cast / song / activate line).
Tile length = `1.5 × (1 − 0.02 × mote rank of the spell)`, rounded to the nearest 0.1s with exact
halves rounding **down** (1.35 → 1.3); rank 0 = 1.5s. The −2%/tier comes from the same mote sheet
as the buff-duration and cast-time rates (**unmeasured against a live log**, same caveat as those).
The per-cast duration is computed in `handleLine` via a `gcdRecovery` flag, the same pattern the
buff+cooldown premade uses for `buffDurationSec`.

### 39. Ship the bundled sound files somewhere browsable — NEW / CHANGE — DONE
Put the starter sounds where they're easy to browse and keep, not wiped on uninstall.
*Fixed (redesigned by the owner — `userData`, not Downloads):* the starter sounds, the "Choose
sound…" browse folder, and files you drop in now all live in **`userData/sounds/`**, seeded on
startup from the install `sounds/` bundle (`soundService.seedStarterSounds()` — idempotent, never
overwrites a file already there, never touches user files). `defaultPickerDir()` prefers it. The
install `sounds/` folder is purely the seed source now. One folder family with auras / profiles →
one backup location (#3a/#3b), survives uninstall, nothing written to Downloads.

### 40. Memmed-spell set checker — "if these spells are memmed, show the set" — NEW
Define named gem sets ("Raid heals", "Burn", "Utility"…). When the currently-memorised spells
match a defined set, show that set's name.
*Today:* `currentlyMemorized` is tracked and persisted per profile (gotchas #16, #9) and shown as
"Currently memorized"; there's no concept of a named set or of matching against one.
*Open:* exact match on all 14 gems, or "contains these key spells"? Shows where — main window, or
an overlay aura?

### 41. New mez premade — NEW
A second mez premade, distinct from the Mesmerize worked example (#17).
*Needs:* what it does differently — a different spell, group / AoE mez, a break alert rather than
a timer, per-mob vs. one-tile (note #12)?

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
- **#23** (scheduled *time-of-day* auto-split, mirrored into the tracker tab) — **still open.**
  This batch added a *manual* trim and an automatic *weekly* rotation at the reset boundary,
  which is related but not a user-set daily schedule. May be lower-value now — the owner's call.
- **#24** (auto-archive / prompt on load when the log is big, even on first load) — **partly.**
  Weekly rotation is on by default, so last week auto-archives on load once the reset has passed,
  and "Trim log to this week" is a prompt surface when the log spans a prior week. Not done: a
  *size-threshold* check on first load regardless of reset timing.

---

## Working notes

- Several Claude sessions edit this tree in parallel — check `ListAgents` before touching a hot
  file (`index.html`, `main-window.js`, `overlay.js`, `buffEngine.js` are the usual ones), and
  route doc/backlog edits through the **Documentation** session (see `CLAUDE.md`).
- `#20` / `#21` need new roster entries — `tools/roster-overrides.json` only *edits* existing
  spells, it can't add them, so those wait on a spreadsheet change.

---

## Implementation order

The cheap-wins and quick-wins phases are **done** (see the "Done" list at the top). What's left,
roughly cheapest first:

### Next up — quick, no new subsystems
- **#17** round mote-scaled song durations to 6s — `buffEngine.js`, ~2 lines
- **#9** exclusive-fullscreen warning — `foregroundWatcher.js` already has the hook

### Profile & app chrome
- **#6 + #42** profile-cycle hotkey and/or `/tell` command word for macro profile swap
  *(need your call: hotkey, chat command, or both)*

### New tracker widgets  *(build the shared "counter / state" widget kind + overlay render +
`SHAPE_FIELDS` entry once — #38's `anyCast` trigger + tracker plumbing is the first of these and
is done; the rest stack on it, cheapest first)*
- **#34** bard 6s pulse tracker — pulse cadence is already confirmed, just needs surfacing
- **#36** loss-of-control widget (fear / charm / mez on you)
- **#37** pet-is-attacking tracker  *(need: pet combat wordings from your log)*
- **#33** zone-named kill tracker — reuses `damageEngine` death lines + zone tracking
- **#40** memmed-spell set checker — reuses `currentlyMemorized`
- **#41** second mez premade *(need the spec — what's different from #17's worked example)*

### Blocked on your input
- **#20 / #21** stances & invocations — need in-game names + effect data (spreadsheet change,
  `roster-overrides.json` can't add new spells)
- **#26** Shrink / Tiny Companion — real durations + making Tiny Companion reachable (detection)
- **#27** bard-song "no active" — which of the two meanings?
- **#29** debuff bard songs tracked on the Bard Songs aura — need a sample log line
- **#35** invis-drop-before-aggro body-pull tell → your own first-hit tracker; need the
  invis-fade wordings
- **#41** new mez premade — need the spec (what's different from #17)

### Bigger, each mostly self-contained
- **#24 + #23** log management: size-check-on-load auto-archive + scheduled time-of-day split
  (the lockout batch did a manual trim + automatic weekly rotation — see Section D)
- **#11 + #19** action-bar gem-slot drag positioning + bound-skill indicator
- **#16** persist stances / invocations across restarts  → #20 / #21

---

## Where I still need input

- **#27** — which of the two meanings above?
- **#20 / #21** — in-game names and effect data for the missing stances / invocations.
- **#26** — the correct duration for Shrink / Tiny Companion, if you know it.
- **#29** — a log line or two showing a debuff song you want caught.
- **#6 / #42** — profile swap: hotkey, in-game `/tell` command word, or both?
- **#33** — per-zone running totals for the session, or just the current zone reset on entry?
- **#34** — anchor the 6s pulse off any song-pulse line, or off your own song only?
- **#35** — the exact invis-fade log wordings; and "before aggro" measured against what line?
- **#36** — countdown or on/off only; and do root / snare / stun count as loss of control?
- **#37** — the pet combat log wordings (attack, taunt, death, back-off ack).
- **#40** — match on all 14 gems or on key spells; show in the main window or an aura?
- **#41** — what does the new mez premade do that the Mesmerize worked example (#17) doesn't?
