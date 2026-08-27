# UX/UI Redesign Plan — 2026-08-18

Status: **planning only, nothing implemented yet.** This documents a full pass through the main window's
layout, aimed at the learning-curve problem: right now every page shows everything at once (the widget
settings panel alone has ~35+ controls visible simultaneously, regardless of whether it's someone's first
widget or fifth), and explanation lives in dense inline hint paragraphs rather than being introduced when
it's actually needed. Read `CLAUDE.md` first as always — this doesn't change any detection behavior, only
how the main window (`src/renderer/main-window/`) presents it.

## Guiding principle

Only what's required to get one working thing on screen stays visible by default. Everything else collapses
as a **whole topic**, positioned where it naturally belongs in reading order, expanding in place when
clicked. Two rules keep this from becoming a maze:

- **Auto-expand on non-default state.** If a collapsed section already holds a non-default value (or, for
  a buff picker, is empty when it needs at least one buff to do anything), it opens automatically when the
  user lands there. Nothing already-configured should require the user to remember "did I hide something."
- **Don't split one topic across a visible/hidden line.** Earlier drafts of this plan put (e.g.) "icons per
  row" in the always-visible zone while "icon size" for the same grid was hidden in an "Advanced" zone
  elsewhere on the page — that forces scrolling back and forth to tune one thing. Fixed by making the
  collapse boundary run *between* topics, never *through* one.

### Ideas considered and rejected

Keeping these here so a future pass doesn't re-propose them without the reasoning:

- **A UI nudge tied to burst-detecting forget/memorize log lines** ("looks like you swapped loadouts,
  switch profiles?") — rejected. `CLAUDE.md` backlog item #24 explicitly flags that burst threshold as
  unverified against routine single/double gem swaps (only one real data point: ~14 events/~15s for one
  observed swap). A UI trigger built on it would produce false-positive nudges during normal play, which
  is worse than no nudge. This needs the engine-side threshold verification first (per #24's own
  "verify against a synthetic Node test script" requirement), not a UI shortcut around it.
- **One single global "Advanced settings" disclosure at the bottom of the widget panel** — rejected, see
  the scrolling problem above. Superseded by per-topic collapse.
- **A page-level Basic/Advanced mode toggle that hides whole pages or the "+ Add widget" modal** —
  rejected. Creating and importing widgets (especially importing a share code from someone else) is core
  day-one functionality, not something to gate behind a toggle.
- **Hiding the loadout profile bar until a second profile exists** — rejected. Unlike widget config depth,
  not knowing about profiles doesn't just mean a missing feature — it means silently wrong buff guesses
  after a class/loadout swap, which the user won't notice as "a hidden feature I should go find." This one
  has to be taught proactively, not discovered.
- **A first-run wizard (multi-step modal flow)** — rejected in favor of a smarter default landing page
  instead (see Setup section below). Adds ceremony to the common case (auto-detection just works) for the
  sake of the uncommon case (it doesn't).

## Page-by-page plan

### Buff Tracker
No structural change. Add a visual divider between the two groups that already exist in the right order:
**"Needs your attention"** (Ambiguous casts, Unknown casts) above **"Buff library"** (Add a new buff,
Custom buffs, Known buffs).

### Overlay Widgets

**Page-level content moves:**
- *Icon set* card moves to Setup → Client setup (it's a one-time global art-matching pick, not per-widget —
  living here implied a scope it doesn't have).
- *Widgets intro* card trims to one line ("A widget is its own overlay window — pick one from the sidebar,
  or Add widget to create one."). The fuller explanation (can't delete Self Buffs, needs windowed/borderless
  EQ) moves to About.

**Sidebar widget list** (`renderWidgetSubmenu` in `main-window.js:926`, currently a flat manually-reordered
list): visually tag the built-in Self Buffs widget so it reads as built-in (explains the missing delete
option instead of leaving the user to wonder); add a small indicator when a widget is scoped to specific
loadout profiles rather than all of them, so switching profiles and having a widget disappear isn't
confusing.

**Per-widget settings panel — the full new order:**

Always visible:
1. Name
2. Show this widget / Lock+Reposition
3. Display & Size — style (list/icons), sort order, opacity, icons-per-row/justification, sizing, mirror
   direction

   *Reasoning for putting Display & Size ahead of Buffs shown*: it's the tactile, immediate-feedback part
   of using an overlay (drag it, resize it, watch it change) and the part people keep coming back to as
   they actually play. Buffs shown is mostly a one-time decision, and for the built-in Self Buffs widget
   it isn't even a picker on this page — that widget's list is set via the "Overlay" checkbox on the Known
   Buffs list elsewhere, so what's left here is just filters.

Collapsed by default, each expands in place, auto-expands per the rule above:
4. ▸ Buffs shown — source (self/ally), buff picker, self-buff filters, track-others toggle. Auto-expands
   if the picker is empty (a fresh custom widget has nothing selected and would otherwise render nothing
   on the overlay with no visible cue why) or if filters differ from default.
5. ▸ Timer text — format, text size, position (anchor grid, icon mode only)
6. ▸ Label text — show label, wrap, size, position (icon mode only; the "Show label" checkbox is itself
   the disclosure trigger for its own sub-options, already the existing pattern in the code)
7. ▸ Alerts — expiring-soon flash threshold, landing glow
8. ▸ Sounds — land/expire sounds, warn-before-expiry threshold (opt-in by design already; the checkbox is
   the commitment, nothing further needs hiding beneath it)
9. ▸ Active on this widget — live status list + excluded-buffs toggle. This is diagnostic/admin content
   (confirms detection is working, lets you remove a stuck instance), not a setup step — treated the same
   as the Log page's Detection log below, not given setup-flow prominence.
10. ▸ Custom timers *(only rendered at all for Custom timer widgets, not buff-source widgets)*
11. ▸ Loadout profiles — which profiles this widget belongs to
12. ▸ Manage widget — duplicate / export as code / delete

### Setup
Split into two headed sections on the same page (no new nav item):
- **Client setup**: EQ log file (folder + active file), Icon set (moved here from Overlay Widgets), Status/
  version.
- **Character setup**: AA Reinforcement, Exaltation, Spellbook detection, Currently memorized.
  - AA is character-wide, confirmed not per-loadout-profile — stays as a single global value.
  - Exaltation's scope is uncertain (might end up per-profile, likely not). Don't build per-profile
    override now, but lay out this section so an "Override per loadout profile" checkbox could sit next to
    Exaltation later without restructuring the section.

**Default landing page**: on first launch, with no EQ folder configured yet, land on Setup instead of Buff
Tracker, with the EQ log file card promoted (different heading, e.g. "Let's find your EverQuest log",
everything else on the page dimmed/collapsed below it). If auto-detection succeeds — likely the common case
for a standard Daybreak install — the user may never see this state at all; the app opens straight to Buff
Tracker with a one-line confirmation ("EQ log detected, tracking started") instead of silence. Once a
working folder/log is confirmed, the landing page reverts to Buff Tracker permanently and Setup returns to
its normal five-card layout. No modal wizard, no forced multi-step flow.

### Log
Log splitting and Archive log stay primary and always visible. *Live log feed (testing)* and *Detection
log* move under a single collapsed "Diagnostics" disclosure at the bottom — real debugging tools this
project relies on (per `CLAUDE.md`'s testing-approach notes), kept one click away rather than competing for
attention during routine split/archive management.

### About
Receives the content pulled off other pages:
- The fuller "how widgets work" explanation (from Overlay Widgets' trimmed intro card).
- A new "How loadout profiles work" card — the profile bar itself only has a tooltip today; this is where
  someone who wants the full picture (why they exist, when to switch, the multiclass gotcha) can read it,
  consistent with how "How a buff gets identified" already works as a deep-dive reference.

## Loadout profile bar
Stays visible above the nav at all times, unconditionally — never gated behind any toggle. Unlike widget
settings depth, not knowing to switch profiles after a class/loadout swap causes silent bad data (stale
`selfAmbiguousResolutions`, see `CLAUDE.md` gotcha #9), not just a missing feature the user would notice and
go looking for. The first-run flow (see Setup above) should include one line explaining this up front:
"If you swap loadouts on this character, come back here and switch (or add) a profile — otherwise old buff
guesses can carry over wrong."

## Open items / not decided here
- Exact interaction pattern for the ▸/▾ disclosures (native `<details>`/`<summary>` vs a custom
  collapsible div) — implementation detail, doesn't affect this plan.
- Whether a persistent "always show advanced" preference is worth adding once the per-topic collapse is
  live and someone's actually used it for a while — deferred until there's a real complaint about
  re-expanding sections repeatedly, rather than speculatively building it now.
- CSS/spacing for the promoted Setup-page first-run card.

## Next step
Nothing has been touched in `index.html` / `main-window.js` / `main-window.css` yet. Implementation should
happen in small, independently testable steps per this project's standing practice (see `CLAUDE.md`) —
one page or one panel at a time, verified in the dev build (`npm start`) before moving to the next, rather
than one large untested rewrite.
