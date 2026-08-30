# QoL & Feature Backlog

**This is the live backlog.** The older architectural / re-work roadmap (custom-timer overhaul,
multi-step aura type, aura scale, action-bar covers, etc.) lives in `CLAUDE.md`'s "Remaining
backlog" section. Shara's original 40-note list is complete except note #2 (first-aggro, she is
supplying it); the retired `FEATURES.md` / `NOTES-STATUS.md` / `HANDOFF.md` are in git history.

42 requested items, organised by area. Nothing here is started (except #28, resolved 30 Aug).
Items 1–32 are the original batch; 33–42 were added 30 Aug (Section C).

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

### 2. Searchable zone picker for "Only in:" — CHANGE
The travel guide got a proper search-box popup (`zonePromptPopup.js` / `zone-prompt/`). The aura
settings "Only in:" control should get the same thing, or a filter field.
*Today:* "Only in:" is a raw `<select id="widget-zone-select">` (104 entries) at
`index.html:259` — finding "Befallen 1 (Awakened)" is a scroll hunt.

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

### 7. Stale "Not active yet." hint on the Timer-text colour picker — FIX
The hint under `index.html:658` says the control isn't wired.
*Today:* it **is** wired end to end — `overlay.js:1621` sets `--timer-text-color` for list rows,
and `overlay.js:735` passes `timerTextColor` to icon-mode tiles. So the hint is simply stale.
**Open question:** just delete the hint, or is there a mode where it genuinely does nothing?

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

### 22. Per-line centred justification for text-only auras — CHANGE
Each line of a text-only aura should be centre-justified on its own, even when several lines are
active at once.
*Today:* text-aura rendering lives in `overlay.js` `renderTextFeed()` (the stacked-lines feed).

### 23. Scheduled automatic log split — NEW
Set a time of day to auto-split the log (useful for lockout tracking). A setting in Settings,
mirrored into the tracker tab.
*Today:* `logSplitter.js` does continuous per-day splitting; there's no scheduled manual split.

### 24. Auto-archive logs / prompt on load when the log is big — NEW
On app load, if the log is large enough to benefit from archiving, either auto-archive or prompt
the user. Must fire **even on first load**, in case the user has never archived.
*Today:* `logService.js` has manual "Archive log" (copy + truncate); nothing checks size on
startup.

### 25. Line-aura images paint on top of their coloured border — FIX
On line (list) auras the icon image sits above the coloured category border; the border should be
higher.
*Today:* the category border is an `inset box-shadow` on the row (`overlay.css:339-340`), which
an image child paints over. Fix means giving the border its own layer above the icon.

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

### 32. The Hole route goes through Erudin instead of Paineel — FIX
Routing to Ruins of Old Paineel (The Hole) sends you via Erudin; it should go via Paineel.
*Today verified:* `zoneGraph.js` gives The Ruins of Old Paineel two-way edges to **both** Erudin
(portal) and Paineel (land). BFS (fewest hops, gotcha #22) picks the Erudin path. Fix means
deciding whether the Erudin portal is actually an entrance or exit-only (like the instance tiers
in gotcha #23), or otherwise correcting that edge.

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

### 38. GCD tracker — NEW  *(this is the "Global recovery" placeholder, note #25)*
Same item as the greyed **Global recovery** premade in the Timers group. A short countdown for the
global recovery time between casts.
*Today:* placeholder only. Needs the recovery value (fixed ~1.5s, or variable on this server?) and
an anchor — starts on every `You begin casting` / `You activate` line.
*Depends on:* the `castOf` trigger (note #15) — the mechanism already exists.

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

---

## Merge safety — what's safe to touch before the incoming fork

A complete new fork is coming that must merge cleanly. Ranked by conflict risk:

**Safe to do now — isolated data files / pure deletions, trivial to re-apply if they do conflict:**

| # | Change | File | Needs from you |
|---|--------|------|----------------|
| 7  | Delete the stale "Not active yet." hint | `index.html` (1 line) | just a yes |
| 28 | Correct Cassindra's Chant of Clarity duration | `tools/roster-overrides.json` (1 entry) | the real duration |
| 32 | Fix The Hole routing edge | `src/shared/data/zoneGraph.js` (1 edge) | confirm: is the Erudin portal an entrance, or exit-only? |
| 31 | Remove the "+N more" cap in the `eqtm` picker | `zone-prompt.js` (1–2 lines) | just a yes |

**Small, but in code the fork will probably rewrite — better done *after* the merge:**

| # | Change | File |
|---|--------|------|
| 17 | Round mote-scaled song durations to 6 s | `buffEngine.js` (~2 lines in the scaling fn) |
| 22 | Per-line centred justification | `overlay.js` `renderTextFeed()` |
| 25 | Border above icon on line auras | `overlay.css` (small, maybe a pseudo-element) |
| 26 | Give Shrink / Tiny Companion real durations | `tools/roster-overrides.json` (safe) — but making Tiny Companion *reachable* is detection logic (not safe) |

**Not simple — need a spreadsheet change or a design pass regardless of the fork:**
20, 21 (new roster entries — `roster-overrides.json` only *edits* existing spells, it can't add
them), plus everything in the "Bigger" list below.

**Recommendation:** merge the fork first, then stack the small fixes on top. The only things worth
doing beforehand are the four in the first table — none of them live in files a UI/feature fork
is likely to rewrite.

---

## Implementation order

Sequenced by: (1) get out of the incoming fork's way, (2) cheap wins that unblock nothing else,
(3) shared plumbing before the things that sit on it, (4) park anything waiting on your input,
(5) big single-PR features last. A "→" means "needs the thing before it".

### Phase 0 — before the fork merges  *(isolated, ~1 line each, trivial to re-apply)*
1. ~~**#31** remove the "+N more" cap in the `eqtm` picker — `zone-prompt.js`~~ **DONE 30 Aug**
2. ~~**#28** Cassindra's Chant of Clarity → 12s — `roster-overrides.json`~~ **DONE (eq-tracker-d3)**
3. **#7** delete the stale "Not active yet." hint — `index.html`  *(blocked: d3 owns index.html;
   just needs your yes)*
4. **#32** fix The Hole routing edge — `zoneGraph.js`  *(need: is the Erudin portal an
   entrance or exit-only?)*
5. **#3a** "Open config folder" button — additive, mirrors "Open sounds folder"  *(blocked: needs
   main.js + index.html)*
6. **#39** as a button ("Put starter sounds in my Downloads") — additive  *(blocked: needs
   main.js + index.html)*

### Phase 1 — quick wins, post-merge, no new subsystems
7. **#2** searchable "Only in:" zone picker — reuse `zonePromptPopup.js` wholesale
8. **#25** line-aura border above the icon — `overlay.css`, own layer
9. **#22** per-line centred justification for text auras — `overlay.js renderTextFeed()`
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
20. **#38** GCD tracker — smallest; the `castOf` mechanism (#15) already exists
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

### Recommended next 5
**#7, #32, #2, #38, #25** — #7 and #32 clear the fork's path (#7 waits on d3 releasing
`index.html`; #32 waits on one game-fact answer from you), #2 is a self-contained reuse win, #38
is the smallest of the new trackers and proves out the widget-kind plumbing the rest of Phase 3
needs, and #25 is a contained `overlay.css` fix.
*(#31 done, #28 done.)*

---

## Where I still need input

- **#7** — delete the hint, or does it not work in some mode?
- **#27** — which of the two meanings above?
- **#20 / #21** — in-game names and effect data for the missing stances / invocations.
- **#26** — the correct duration for Shrink / Tiny Companion, if you know it. (#28 is resolved: 12s.)
- **#29** — a log line or two showing a debuff song you want caught.
- **#30** — should the nickname list be hand-curated or pulled from somewhere?
- **#32** — is the Erudin↔The Hole portal an entrance, or exit-only?
- **#6 / #42** — profile swap: hotkey, in-game `/tell` command word, or both?
- **#33** — per-zone running totals for the session, or just the current zone reset on entry?
- **#34** — anchor the 6s pulse off any song-pulse line, or off your own song only?
- **#35** — the exact invis-fade log wordings; and "before aggro" measured against what line?
- **#36** — countdown or on/off only; and do root / snare / stun count as loss of control?
- **#37** — the pet combat log wordings (attack, taunt, death, back-off ack).
- **#38** — is global recovery a fixed ~1.5s on this server, or variable?
- **#39** — copy sounds to Downloads on first run, or only via a button?
- **#40** — match on all 14 gems or on key spells; show in the main window or an aura?
- **#41** — what does the new mez premade do that the Mesmerize worked example (#17) doesn't?
