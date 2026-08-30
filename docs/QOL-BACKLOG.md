# QoL & Feature Backlog

**This is the live backlog.** The older architectural / re-work roadmap (custom-timer overhaul,
multi-step aura type, aura scale, action-bar covers, etc.) lives in `CLAUDE.md`'s "Remaining
backlog" section. Shara's original 40-note list is complete except note #2 (first-aggro, she is
supplying it); the retired `FEATURES.md` / `NOTES-STATUS.md` / `HANDOFF.md` are in git history.

42 requested items, organised by area. Items 1–32 are the original batch; 33–42 were added
30 Aug (Section C). **Done so far:** #22, #28, #31, plus the lockout / log-tools batch written up
in Section D.

Each item keeps the original ask. Tags describe **what kind of work it is**, not a judgement:

- **NEW** — capability the app does not have; you want it added.
- **CHANGE** — the app does this today, but not the way you want it.
- **DATA** — a spell / stance / zone entry is wrong or missing.
- **FIX** — something is visibly broken or misleading (your framing, or verified).
- **CLARIFY** — I need one more sentence from you before this can be scoped.

"Today:" lines are the current behaviour I actually checked in the code.

---

## A. Things that would genuinely make life easier

### 1. "Preview this aura" button — NEW
Flash a sample tile for ~5 s from the aura's settings panel, so tile size / position / colour /
font / sound / justification can all be judged without alt-tabbing into EQ and casting something.
Sounds already have Preview buttons; the tile doesn't. The **Always on screen** checkbox is the
current workaround but it mutates config and has to be manually undone.

### 2. Searchable zone picker for "Only in:" — CHANGE — DONE 30 Aug
The travel guide got a proper search-box popup (`zonePromptPopup.js` / `zone-prompt/`). The aura
settings "Only in:" control should get the same thing, or a filter field.
*Fixed:* the `<select id="widget-zone-select">` is replaced by a filter field
(`#widget-zone-search`) plus a click-to-add results list (`#widget-zone-options` /
`.zone-add-list`) — `renderZoneAddOptions()` replaces `populateZoneSelect()`. The value is always
a genuine zone string picked from `knownZones`, never parsed from typed text, so the no-typo
property the `<select>` was chosen for (24 Aug) is kept. `zone-gating.test.js` updated.

### 3. Full config backup / restore — NEW
One button to export a bundle of **everything** — all auras, profiles, known-buff edits, settings —
and one to import it. There's per-aura "Export as code" today, but no "export everything". Matters
for handing the app to other people and for a safety net before an update.

Cheap stepping stones, in order of effort:
- **3a. "Open config folder" button** — mirrors the existing "Open sounds folder" control (one
  IPC handler + one button, opens the `userData` folder in Explorer). Lets you copy the JSON
  files out by hand for a backup. ~10 additive lines, touches no existing logic.
- **3b. "Back up now" button** — copies the config files into a dated file/folder inside
  `userData`. Self-contained.
- **3c.** the full export-bundle / import-bundle above.

### 4. Attention badges on the sidebar — NEW
A `(2)` badge on the "Buff Tracker" nav button when ambiguous / unknown casts are queued. Right
now they only surface on the Buff Tracker page or a popup — nothing in the app chrome tells you
while you're playing on another page.

### 5. "Is it working right now?" indicator — NEW
A one-line status on the Buff Tracker page, e.g. *"Watching eqlog_Shara_rivervale.txt — last line
3s ago"*. Currently the only confirmation the log is being tailed is Log → Diagnostics → Live
feed. A stale timestamp or wrong filename would be immediately visible.

### 6. Profile switching without alt-tab — NEW
A profile-cycle hotkey and/or an in-game command (`/tell eqprofile2`-style), same pattern as the
master-hide hotkey and `/tell eqtm`. Loadout swaps stay manual (deliberate) but shouldn't require
alt-tab → click chip → alt-back. Loadout swaps already generate log noise to hang a trigger off.

### 7. Stale "Not active yet." hint on the Timer-text colour picker — FIX — DONE 30 Aug
The hint said the control wasn't wired.
*Fixed:* the hint is removed from `index.html`. The timer-text-colour control was verified wired
end to end — list mode via `--timer-text-color`, icon mode via `applyTilePositionedTextStyle` —
so there is no mode where it does nothing; the hint was simply stale.

### 8. Live preview of `{spell}` / `{caster}` / `{profile}` templating — NEW
Show the resolved example string under the "Say:" field as you type, instead of finding out
in-game.

### 9. Fullscreen warning — NEW
The About page says EQ must be windowed / borderless. `foregroundWatcher.js` already knows when EQ
is focused; it could also notice exclusive-fullscreen and say *"auras won't be visible over EQ
right now"* instead of leaving you wondering why the overlay vanished.

### 10. Quick "mute all sounds" toggle in the top bar — NEW
Next to "Hide auras". For streaming or voice chat, without walking every aura's sound settings.

---

## B. Smaller things

### 11. Drag-to-move action bar gem-slot settings — NEW
Position the action-bar gem-slot settings by dragging.

### 12. Auras stop when you die — NEW
When the player dies, active auras/timers should stop rather than keep counting.

### 13. Auto-updater — NEW
App updates itself. Ties in with #18 (changelog).

### 14. Import character name / server, auto-build the filename — NEW
Enter name + server and have the app derive the inventory / spellbook filename automatically.
*Today:* `spellbookService.js` auto-detects `<CharName>-<Class>-Spellbook.txt`; this adds a manual
entry path for when that fails.

### 15. Looping-sound premade — NEW
A tempo generator: after a chat line is read, play a sound every X seconds, and keep going until
a second chat line is read.

### 16. Remember stances & invocations between logouts — NEW
Persist the user's chosen stances / invocations across restarts. (Depends on #20 / #21 existing.)

### 17. Song durations round to the nearest 6 seconds — CHANGE
Song durations run in 6-second intervals, not per-second. When a song duration is upgraded with
motes, the result must be rounded to the nearest 6 seconds.
*Today:* mote scaling (`buffEngine`, `_rankForEntry` / scaling math — see gotcha #27) rounds once
over the combined multiplier with no 6-second quantisation for `isBardSong` entries.

### 18. Changelog — NEW
An in-app changelog.

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

### 30. Community shorthand / nicknames for zones in `eqtm` — NEW
Recognise community nicknames and shorthand for zones ("inny", etc.), and also let the picker
search by boss name.

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

Ten items from a raw note-dump. Same tag meanings as above. Several need one more sentence from
you before they can be scoped — flagged inline and repeated under "Where I still need input".

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

### 38. GCD tracker — NEW — IN PROGRESS  *(the "Global recovery" premade placeholder)*
Same item as the greyed **Global recovery** premade in the Timers group. A short countdown for the
global recovery time between casts.
*Scaling (owner-supplied, 30 Aug):* base **1.5s**, **−2% per mote tier**, displayed to the
nearest 0.1s with exact halves rounding **down** (1.35 → 1.3). So it IS mote-scaled.
*Build:* its own branch/PR — needs a new "any cast" trigger mode + rank parsing in
`customTimerEngine.js` + a recovery-rate constant. Not a one-liner like #7/#32/#2/#25. Anchor:
every `You begin casting` / `You activate` line. Full handoff to come when it lands.

### 39. Ship the bundled sound files into the Downloads folder — NEW / CHANGE
Put the prebundled starter sounds where they're easy to browse and keep — the **Downloads**
folder — rather than (or as well as) the `sounds/` folder next to the .exe.
*Today:* `soundService.js`'s `bundledSoundsDir()` ships the starters in `sounds/` beside the exe
and opens the picker there; that folder is wiped on uninstall. A copy dropped in `Downloads`
survives uninstall, is easy to find, and is easy to share.
*Open:* copy on first run, or a "Put starter sounds in my Downloads" button?

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

### 43. Plane of Hate ← Oasis of Marr portal is modelled two-way but is one-way in — FIX
eqlwiki: there is no return portal from Plane of Hate — you Gate / Origin out. Same shape as #32
(and gotcha #23). The `Plane of Hate → Oasis of Marr` edge in `zoneGraph.js` should be removed,
keeping the inbound one.
*Assigned:* Short Context, folded into their `eqtm` data expansion (this + #30 nicknames +
boss-name search + comment-accuracy fixes on Plane of Sky / Plane of Fear).

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

Sequenced by: (1) cheap wins that unblock nothing else, (2) shared plumbing before the things that
sit on it, (3) park anything waiting on your input, (4) big single-PR features last. A "→" means
"needs the thing before it". (The `feat/lockouts` fork has merged, so nothing waits on it any more.)

### Phase 0 — cheap, isolated
1. ~~**#31** remove the "+N more" cap in the `eqtm` picker~~ **DONE 30 Aug**
2. ~~**#28** Cassindra's Chant of Clarity → 12s~~ **DONE (eq-tracker-d3)**
3. ~~**#7** delete the stale "Not active yet." hint — `index.html`~~ **DONE 30 Aug**
4. ~~**#32** fix The Hole routing edge — `zoneGraph.js`~~ **DONE 30 Aug** (Erudin/Neriak pads are
   exit-only; edges made one-way)
5. **#3a** "Open config folder" button — additive, mirrors "Open sounds folder"
6. **#39** as a button ("Put starter sounds in my Downloads") — additive

### Phase 1 — quick wins, no new subsystems
7. ~~**#2** searchable "Only in:" zone picker~~ **DONE 30 Aug** (filter field + click-to-add list)
8. ~~**#25** line-aura border above the icon — `overlay.css`~~ **DONE 30 Aug** (`::after`, z-index 3)
9. ~~**#22** per-line centred justification for text auras~~ **DONE 30 Aug** (committed an
   orphaned ~27 Aug change)
10. **#17** round mote-scaled song durations to 6s — `buffEngine.js`, ~2 lines
11. **#8** live `{spell}`/`{caster}`/`{profile}` preview under the "Say:" field
12. **#1** "Preview this aura" button — flash a sample tile for ~5s
13. **#5** "is it working right now?" status line on the Buff Tracker page
14. **#4** sidebar attention badge for queued ambiguous/unknown casts
15. **#10** "mute all sounds" toggle in the top bar

### Phase 2 — profile & app chrome
16. **#6 + #42** profile-cycle hotkey and/or `/tell` command word for macro profile swap
    *(need your call: hotkey, chat command, or both)*
17. **#9** exclusive-fullscreen warning — `foregroundWatcher.js` already has the hook
18. **#18** in-app changelog
19. **#13** auto-updater  → #18

### Phase 3 — new tracker widgets  *(build the shared "counter / state" widget kind + overlay
render + `SHAPE_FIELDS` entry once, then these stack on it, cheapest first)*
20. **#38** GCD tracker — **IN PROGRESS** on its own branch/PR (scaling resolved: 1.5s base,
    −2%/tier, nearest 0.1s, halves round down; needs an "any cast" trigger mode + rank parsing)
21. **#34** bard 6s pulse tracker — pulse cadence is already confirmed, just needs surfacing
22. **#36** loss-of-control widget (fear / charm / mez on you)
23. **#37** pet-is-attacking tracker  *(need: pet combat wordings from your log)*
24. **#33** zone-named kill tracker — reuses `damageEngine` death lines + zone tracking
25. **#40** memmed-spell set checker — reuses `currentlyMemorized`

### Phase 4 — waiting on your input; slot in wherever it lands once answered
- **#20 / #21** stances & invocations — need in-game names + effect data (spreadsheet change,
  `roster-overrides.json` can't add new spells)
- **#26** Shrink / Tiny Companion — real durations + making Tiny Companion reachable (detection)
- **#27** bard-song "no active" — which of the two meanings?
- **#29** debuff bard songs tracked on the Bard Songs aura — need a sample log line
- **#35** invis-drop-before-aggro body-pull tell → your own first-hit tracker (#2); need the
  invis-fade wordings
- **#41** new mez premade — need the spec (what's different from #17)
- **#30** zone nicknames / boss-name search — hand-curated list or sourced from somewhere?

### Phase 5 — big, each its own PR, no dependency on the above
- **#3** full config backup / restore (bundle export + import)  → #3a, #3b
- **#24 + #23** log management: size-check-on-load auto-archive + scheduled auto-split
- **#14** character name / server import → auto-build the filename
- **#11 + #19** action-bar gem-slot drag positioning + bound-skill indicator
- **#12** stop auras/timers when the player dies
- **#15** looping-sound premade (tempo generator between two chat lines)
- **#16** persist stances / invocations across restarts  → #20 / #21
- **#39** (full version) copy starter sounds to Downloads on first run, if the button (Phase 0)
  isn't enough

### Recommended next 5 — status

**#7, #32, #2, #25 — done 30 Aug** (`feat/backlog-recommended-5`, PR #17). **#38 — in progress**
on its own branch. So the whole recommended-5 batch is landed or building; pick the next 5 from
Phase 1–3 above.

---

## Where I still need input

- **#27** — which of the two meanings above?
- **#20 / #21** — in-game names and effect data for the missing stances / invocations.
- **#26** — the correct duration for Shrink / Tiny Companion, if you know it. (#28 is resolved: 12s.)
- **#29** — a log line or two showing a debuff song you want caught.
- **#30** — should the nickname list be hand-curated or pulled from somewhere?
- **#6 / #42** — profile swap: hotkey, in-game `/tell` command word, or both?
- **#33** — per-zone running totals for the session, or just the current zone reset on entry?
- **#34** — anchor the 6s pulse off any song-pulse line, or off your own song only?
- **#35** — the exact invis-fade log wordings; and "before aggro" measured against what line?
- **#36** — countdown or on/off only; and do root / snare / stun count as loss of control?
- **#37** — the pet combat log wordings (attack, taunt, death, back-off ack).
- **#39** — copy sounds to Downloads on first run, or only via a button?
- **#40** — match on all 14 gems or on key spells; show in the main window or an aura?
- **#41** — what does the new mez premade do that the Mesmerize worked example (#17) doesn't?
