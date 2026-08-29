# QoL & Feature Backlog

32 requested items, organised by area. Nothing here is started.

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

### 28. Cassindra's Chant of Clarity set to 1 min — DATA
Shows a 1-minute duration in-app; that's wrong.
*Today verified:* the bundled roster has **no** duration for Cassindra's Chant of Clarity. The
1-minute value is coming from somewhere else — a fallback default, or the shared landing text
`"Your mind clears."` (also used by Brilliance — gotcha #15) resolving to the wrong spell.
Needs: find the real duration and where the 1-min is leaking in.

### 29. Debuff bard songs should be tracked — NEW
Debuff-type bard songs (mez / slow / snare / dot songs) should be tracked on the Bard Songs aura.
*Today:* only `kind:'buff'` songs feed the Bard Songs aura; debuff songs are not tracked there.

### 30. Community shorthand / nicknames for zones in `eqtm` — NEW
Recognise community nicknames and shorthand for zones ("inny", etc.), and also let the picker
search by boss name.

### 31. No "+N more" truncation in the `eqtm` search list — CHANGE
If a match is a real zone, always list it — don't cap the results. Do **not** list nicknames or
shorthand in that list (those are #30, kept separate).
*Today:* `zone-prompt.js:23` slices to `RENDER_CAP` and shows `"+N more - keep typing to narrow
it down"`.

### 32. The Hole route goes through Erudin instead of Paineel — FIX
Routing to Ruins of Old Paineel (The Hole) sends you via Erudin; it should go via Paineel.
*Today verified:* `zoneGraph.js` gives The Ruins of Old Paineel two-way edges to **both** Erudin
(portal) and Paineel (land). BFS (fewest hops, gotcha #22) picks the Erudin path. Fix means
deciding whether the Erudin portal is actually an entrance or exit-only (like the instance tiers
in gotcha #23), or otherwise correcting that edge.

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

## Rough grouping for scheduling

**Small / low-risk, can start now:**
7, 25, 31, 22, 28 (once the source of the 1-min value is found)

**Data — need info from you (names / durations / log samples):**
20, 21, 26, 27, 28, 29, 32, 17

**The "stop alt-tabbing" cluster:**
1, 8, 2

**App chrome & toggles:**
5, 4, 10, 6, 9, 18

**Bigger, each its own PR:**
3 (backup/restore), 13 (auto-updater), 24 + 23 (log management), 14 (char import),
11 + 19 (action bars), 12 (death handling), 15 (looping sound), 16 (stance persistence),
30 (zone nicknames / boss search)

---

## Where I still need input

- **#7** — delete the hint, or does it not work in some mode?
- **#27** — which of the two meanings above?
- **#20 / #21** — in-game names and effect data for the missing stances / invocations.
- **#26 / #28** — the correct durations, if you know them.
- **#29** — a log line or two showing a debuff song you want caught.
- **#30** — should the nickname list be hand-curated or pulled from somewhere?
