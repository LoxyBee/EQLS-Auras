# Session Handoff — 2026-08-17

This replaces the previous 2026-08-17 handoff (detection-engine overhaul + widget features) — that work
is done, stable, and now just part of the app. This document extends it with everything built **after**
that point in the same continuous session: icon-mode label/margin polish, a group-join detection bug fix,
a self-buff misattribution fix + new "currently memorized" UI, a big QOL feature batch, a custom-timer
"chat message" trigger builder, and — most importantly — **an open, unresolved architectural gap the user
identified that has NOT been fixed yet.** Read `CLAUDE.md` first as always — this supplements it, doesn't
replace it. The "Detection priority" comment block at the top of `buffEngine.js` remains the authoritative
source for how detection actually works.

## Status: dev build only, nothing shipped

Everything below is in `npm start` (dev build) only. `npm run dist` has not been run this session — the
packaged installer predates all of this. Don't rebuild/ship without asking.

User's standing preference (also in persistent memory): keep them on the dev build between sessions,
don't revert to the packaged app after testing.

## ⚠️ START HERE: unresolved bug the user identified, fix not yet implemented

The user plays a custom server ("EverQuest Legends") with a **multiclass "loadout" mechanic**: swapping
loadouts changes which spells are actually castable **without touching the spellbook file**, but it DOES
generate a real burst of `"You forget X."` / `"You have finished memorizing Y."` lines in the log
(confirmed empirically: ~14 events in ~15 seconds in the user's real log at one observed swap, timestamped
19:57:44–59).

The bug: `selfAmbiguousResolutions` (in `buffEngine.js` — a `Map<landingText, buffName>` of the user's own
past answers to "which buff did this ambiguous text mean", persisted to disk, consulted automatically on
every future occurrence of that same text so the user isn't re-prompted) is **never invalidated by
anything loadout-related**. It's only cleared by (a) the user manually removing one entry via "View
remembered choices", or (b) clicking "Reset remembered choices" (full manual reset, IPC
`buffs:resetAmbiguousResolutions`). It is deliberately **never** cleared on party change (unlike its
sibling `otherAmbiguousResolutions`, which IS cleared on party change) — that was a correct choice made
earlier this session, on the reasoning "which of MY OWN spells this text means is a property of the
player's spellbook/gear, not who's grouped with them." The user's insight is that this reasoning has a
hole: on THIS server, the player's effective castable-spell set can change (via loadout swap) independent
of both party membership AND the spellbook file, so a previously-correct self-resolution can silently
become wrong after a swap — e.g. ambiguous text T correctly resolved to buff X under loadout A, but under
loadout B the player can no longer cast X and CAN cast a different buff Y that happens to share the same
text T, yet the app will keep confidently applying the stale "T means X" answer forever with no prompt.

Two earlier, weaker ideas were already explored and explicitly rejected/superseded before landing on this:
1. A "buff-fade cascade" (many buffs dropping off around the same time) was floated as a detection signal
   for "a loadout swap probably just happened" — the user pointed out this is a *side effect* of a swap,
   not reliable (won't happen every time someone swaps).
2. Checking spellbook-file staleness — real check, but not the actual mechanism here, since the spellbook
   file genuinely doesn't change on this server's loadout swaps.

**Design direction settled on but NOT YET IMPLEMENTED**: mirror the existing `BURST_WINDOW_MS`/
`burstUntil` pattern already used elsewhere in `buffEngine.js` (for Quick-Buff-style instant multi-effect
detection) as a template for a NEW burst detector on the forget/memorize handling block (currently around
`buffEngine.js` lines ~267–282 — re-check line numbers, nothing has moved but count from `matchForgetSpell`
/`matchMemorizeFinished` handling). Concretely: track a rolling count of forget+memorize events; if a
burst of several fires in quick succession (needs a real threshold — the one observed real-world data
point is ~14 events/~15s, but that's a single sample, not yet enough to pick a safe cutoff that won't
false-trigger on a routine single/double gem swap during normal play), clear `selfAmbiguousResolutions`
(and call `_saveSelfAmbiguousResolutions()`) exactly once per burst, same idea as the existing
`isPartyChangeLine` handling for the *other* bucket.

**Before wiring this into the live app**: per this session's established (and user-reinforced) practice,
build an isolated Node test script first — mock `store`, instantiate the real `BuffStore`/`BuffEngine`,
replay a realistic synthetic sequence of memorize/forget lines (including a plausible "routine single gem
swap" negative case) — to confirm the burst threshold actually distinguishes "loadout swap" from "normal
play" before touching `buffEngine.js` for real and before asking for a dev-build restart/retest. **Do not
just implement and ask the user to test live** — this is exactly the kind of subtle detection-logic change
this project has a history of getting wrong on the first guess (see CLAUDE.md's stated project history).

Also worth doing once a fix lands: add a line to CLAUDE.md's gotchas section documenting the loadout
mechanic and the fix, the same way the "Infusion of Spirit" third-person gotcha is documented — future
sessions won't otherwise know this server has a loadout mechanic at all.

No code has been written for this yet — only investigation (reading the relevant code sections). The user
interrupted mid-investigation specifically because I began reading/editing toward a fix without checking
the plan with them first — **check in on the exact design (especially the burst threshold number) before
implementing**, don't just land something and ask them to test blind.

## Everything else built this session, in order

### Icon-mode label/margin polish
- Fixed icon-mode label text clipping at the widget window's edge.
- Settled, after several rounds of user correction, on a final design where the widget window can be
  wider than the icon grid (to give unwrapped labels room), but the draggable blue drag-indicator overlay
  is always sized to exactly the icon grid — decoupled from the window's true size. Implemented via
  `position:fixed; inset` tricks in `overlay.js` plus an `originX`-compensated window-bounds system in
  `widgetManager.js` (`originXByWidget` Map, `fitToContent(id, contentWidth, contentHeight, originX)`,
  and a `'moved'` handler that adds the current origin offset back so real user drags still persist the
  correct canonical position).
- Fixed wrap-text being applied to timer text instead of only label text (moved the "Wrap text" toggle
  from the Timer text settings section to the Label text section — user caught it was still misplaced
  even after the first fix attempt).
- Fixed a wrap-CSS bug causing premature 3–6-character wrapping (needed explicit `width`, not `max-width`,
  for `-webkit-line-clamp` to size correctly).
- Capped wrapped label text to 2 lines max (was 3).
- Added a disabled "Margin width" placeholder slider to icon-mode widgets — **not functional yet**, just
  a UI placeholder for future spacing-between-icons work. Its stray hint text was removed per user
  request; it currently does nothing when moved.
- Added per-widget icon **Justification** (left/center/right) — active icons position themselves within
  the full "Icons per row" cap's reserved space instead of always packing from the left.
- Reorganized the widget settings panel: Opacity, Icons per row, Show icon on each row, Mirror direction,
  and Justification all moved into the "Display" card; List width/Row size/Icon size/Margin width stayed
  in "Size." Size card was also moved to appear above the text-related cards per user request.

### Rank-numeral duration scaling — investigated, documented, deliberately NOT built
Confirmed via direct `spells_us.txt` lookup this is a custom-server-only duration-scaling effect layered
on top of the base spell (not a roster-mining gap, not the same mechanism as Yaulp's genuinely-distinct
per-rank spell IDs). One real data point (Spirit of the Puma, rank VII, observed ~162s vs 60s base with an
existing 65% multiplier already stacked) isn't enough to fit a formula. Full writeup, including the exact
next step (collect 2–3 more rank/duration pairs from the live log when the user reports a buff naturally
expiring in play), is already in **CLAUDE.md backlog item #13** — don't duplicate it here, that's the
canonical location per the user's explicit "set this aside somewhere reachable" request.

### Group-join detection bug — fixed
Root cause: group-membership tracking only ever learned about members via lines describing people joining
the player's OWN group — it never handled the case of the player joining a group that already has other
members. Fixed by adding `matchGroupJoinAccepted` (matches "You notify X that you agree to join the
group.") in `buffParser.js`, tracked via a new `pendingGroupInviter` field on `BuffEngine`, consumed one
line ahead of the self-join clear. Verified via synthetic log injection after an initial live retest
false-negative turned out to be caused by the dev-build restart happening AFTER the relevant join event
(the app never replays log history, so the restart itself ate the test's signal — not a real bug in the
fix).

### Self-buff misattribution bug — fixed, plus new "Currently memorized" UI
Real bug: an ally-cast "Rizlona's Embers" was wrongly shown as the player's own buff. Root cause: the
"unique landing text" auto-confirm detection tier had no awareness of the player's *actual current* gem
loadout — it would confirm a landing as self-cast even when the player provably didn't have that spell
memorized right now. Fixed by adding a `currentlyMemorized`-based check to that tier in `buffEngine.js`:

```js
const alreadyActive = this.activeBuffs.has(uniqueMatch.name.toLowerCase());
const isMemorizableSpell = this.spellbookCheckFn ? this.spellbookCheckFn(uniqueMatch.name) : false;
const knownNotMemorized =
  !alreadyActive &&
  isMemorizableSpell &&
  this.currentlyMemorized.size > 0 &&
  !this.currentlyMemorized.has(uniqueMatch.name.toLowerCase());
if (knownNotMemorized) {
  if (this.trackOthersEnabled) { this._land(uniqueMatch); }
  else { /* ignored, debug logged */ }
  this._checkForEndedBuffs(line);
  return;
}
```

This directly motivated a user question — "does this app actively track what spells the user has
memorised? if it does, maybe that should be in the front end display somewhere?" — which led to a new
`getCurrentlyMemorized()` method and a live "Currently memorized" display in the main window UI, backed
by the same `currentlyMemorized` Set (built from `"You forget X."`/`"You have finished memorizing X."`
lines, session-only, not persisted — same "never replay history" limitation as everything else here).

**Note the direct link to the still-open task above**: this fix and the open multiclass-loadout gap are
closely related (`currentlyMemorized` correctly tracks gem-slot state moment-to-moment) but distinct —
this fix is about the "unique landing text" tier trusting stale spellbook-only info; the open gap is about
the SEPARATE `selfAmbiguousResolutions` cache never being invalidated by the same underlying gem-state
changes. Fixing one did not fix the other.

### Custom timer "chat message" trigger builder — new feature, additive only
Custom timers previously only supported raw "exact log line" triggers (free-text). Added a second,
structured entry mode built entirely from real, log-verified channel-message formats: a Channel dropdown
(Say/Group/Guild/Tell), a Who selector (Yourself or a specific named person), and plain message text —
composed into the real matching log-line format via `buildChatTriggerLine()` in `main-window.js`. **The
original "Exact log line" mode was deliberately kept, not replaced** — general-purpose raw-line triggering
still needs to exist for anything the chat builder can't express. Explicit user constraint: this chat
builder is ONLY for custom timers, not for the buff-detection system.

Also added while working on the custom-timer form: a **"Save as new"** option when editing an existing
custom timer, so edits can be committed as a brand-new timer without altering the one being edited.

Two related detection-correctness fixes landed alongside this (in `customTimerEngine.js`):
- Trigger/ended-text matching made case-insensitive (was case-sensitive, silently missing real matches).
- Fixed a bug where multiple active custom timers sharing the same end-trigger phrase would only have
  ONE of them actually end — now all matching timers end together.

### QOL feature batch (backlog items #18–#23 — implemented, verified, and removed from backlog)
Preceded by an explicit audit: "check my current functionality. see if there are currently any QOL gaps
that users might want" → "add all to backlog, set icons per row maximum to 20" (also done — icons-per-row
cap raised to 20). The six items, all implemented and confirmed working after a clean restart:
1. **Delete confirmations** — `window.confirm()` guards added before destructive widget/timer/buff
   deletes.
2. **Off-screen widget position recovery** — a "Reset position" action per widget
   (`resetPositionBtn`/`widget:resetPosition` IPC) for widgets that end up outside the visible screen
   area.
3. **Icon picker search** — see below, went through one full correction round.
4. **Widget duplication** — `duplicateWidget()`, built as literally `exportCode()` + `importCode()` +
   rename + position offset, reusing the existing export/import share-code substrate rather than a new
   code path.
5. **Copy-confirmation feedback** — visible confirmation when an export code is copied.
6. **Sidebar widget reordering** — `move(id, direction)` in `widgetStore.js` / `moveWidget` IPC, exposed
   in the sidebar as up/down controls (`renderWidgetSubmenu()` rewritten with `.nav-sub-row` +
   `.nav-sub-move-btn` styling in `main-window.css`).

**Correction round after live testing** (user's exact words): "search function should just live filter
the icons, not have a drop down of names as well, because it's too clunky." `buildIconPicker()` in
`main-window.js` was rewritten so the search input filters the icon grid directly in place (no separate
results list) — the icon grid renders once with all icons up front, each thumb tagged with its matching
buff name(s), and the search input just toggles `display: none` per-thumb on input. This is the current,
confirmed-working implementation — don't reintroduce a dropdown/list alongside the grid.

Also from that same correction round:
- "Put the duplicate, export, and delete buttons in their own card below active on this widget" — done: a
  new `#widget-manage-card` (Duplicate/Export/Delete) now sits directly below `#widget-active-buffs-card`
  in `index.html`; the old inline buttons at the bottom of the settings panel were removed.
- "Remove this text from sound card 'Planned: choosing your own sound per alert, and looping the warning
  sound.' add placeholder buttons for choose sound, and loop sound every:" — done: hint text trimmed, two
  disabled placeholder controls added (`widget-sound-loop-slider` and a "Choose sound" button), matching
  **CLAUDE.md backlog items #16 and #17** (sound file selection, looping warning sound) — these remain
  unbuilt, the placeholders are UI scaffolding only, not functional yet.

### A resolved tangent: Electron location-access alert
User reported a Windows "Electron is trying to access your location" alert coinciding with an internet
dropout, plus a screenshot. Investigated and confirmed benign (nothing in this app requests geolocation
deliberately — traced to routine Electron/Chromium/Windows Location Services interaction, not a security
concern). Fully resolved within the conversation, no code changes, nothing pending here.

## Known limitations — carried over, still true, don't "fix" without re-reading why

(See the previous handoff section preserved in git/session history for the full list — log-replay-never,
Quick Buff's variable buff count per cast, bard-song auto-tagging coverage gaps. All still accurate, no
changes to any of these this session.)

## Testing approach that worked well this session (same practice, reinforced again)

- **Live log injection** (`echo "[timestamp] text" >> <logfile>`, exact `[Day Mon DD HH:MM:SS YYYY]`
  format) to force scenarios on demand without playing — used again for the group-join fix retest.
- **Reading the user's real files directly** (log, `spells_us.txt`, `widgets.json`, the real
  `<CharName>-<Class>-Spellbook.txt`) to settle ambiguous questions empirically rather than guessing —
  used for the Puma duration data point, the group-join mechanics, the memorized-spell timing, and the
  loadout-swap log footprint (~14 forget/memorize events in ~15s).
  restart discipline (`npm start` doesn't hot-reload main-process changes; kill lingering `electron.exe`
  first or the single-instance lock silently no-ops a second `npm start`) — still applies, still worth
  double-checking before every retest.
- **Isolated Node test scripts** (mock `store`, real `BuffStore`/`BuffEngine`) to verify detection-logic
  changes before a full Electron restart — this is explicitly the planned next step for the still-open
  multiclass-loadout fix above, not yet done.
