# UX Visual Design — 2026-08-18

Status: **design settled, nothing implemented yet.** This is the visual counterpart to
`UX_REDESIGN_PLAN.md` — that document covers information architecture (what's collapsed by
default, what auto-expands, page-by-page layout); this one covers colour, typography, and how
sections are separated on screen. Read both, plus `CLAUDE.md`, before touching
`main-window.css` / `index.html` / `main-window.js`.

A working HTML mockup of the target look, built and iterated against real feedback, lives here:
**https://claude.ai/code/artifact/1d95df30-3d6c-4e37-86b9-0af38e84ac5a** — fetch it and read the
source; the CSS comments explain the reasoning behind each choice, which matters more than the
exact pixel values. Seeing the actual rendered blocks/stripes/gaps will make the layout
instructions below click faster than reading them as prose.

## What's changing and why

The current `main-window.css` uses a cool blue-grey palette (`#1b1e24` ground, `#24282f` cards)
and nests boxes inside boxes: `.card` → `.settings-section` → `.buff-list li` all get their own
background + border, stacked three deep in places like the widget settings panel. Two rounds of
visual feedback on the mockup identified the actual problems and the fix:

1. **Wrong palette family.** Cool slate-grey reads as a generic dev tool, not something themed
   around this game. Move to a warm dark umber/parchment palette (see tokens below) — this was
   cross-checked against two external references (an EverQuest Legends reference site and an
   unrelated game's build planner) that independently converge on the same family, and against
   the reasoning is documented in the mockup's own CSS comments.
2. **Nested boxes are the wrong way to separate content**, but *zero* visual separation (flat
   single-colour panels) is also wrong — that was tried and rejected as "hard on the eyes, no
   rest for the eyes." The right answer, confirmed against a reference spreadsheet: **flat,
   square-cornered blocks of colour, sitting side by side (never nested), separated by a small
   gap that reveals a darker background underneath.** Like cards in a physical layout, but the
   separation comes from gap + colour contrast, not from borders stacked on borders.

## Design tokens

Add these as CSS custom properties at the top of `main-window.css` (a `:root` block — the file
doesn't currently use CSS variables, so this is a genuine addition, not a rename):

```css
:root {
  --bg: #14100b;          /* darkest - the "gutter" behind blocks, and the sidebar */
  --panel: #1c160f;        /* one step up - window chrome, hover states */
  --panel-2: #241c12;      /* two steps up - the fill colour for content blocks and inputs */
  --line: #4a3c29;         /* visible hairline / dotted-rule colour */
  --line-soft: #3c3020;    /* quieter divider, used sparingly */
  --ink: #efe5d2;          /* primary text - parchment */
  --ink-mut: #b6a88b;      /* secondary text */
  --ink-dim: #8c8068;      /* tertiary text */
  --ink-faint: #6c6250;    /* placeholder/disabled */
  --accent: #cf9a4a;       /* brass - interactive elements, "you configured this" */
  --accent-soft: #cf9a4a1f;
  --accent-line: #8a672f;
  --bar: #6e5636;          /* muted brass - solid fill for block-header caps only, never text */
  --danger: #e2584a;       /* reserved for exactly one job: a buff about to expire */
  --danger-soft: #e2584a1a;
  --ok: #6fae82;
  --info: #5c93c4;         /* live/diagnostic status - distinct from "you configured this" */
  --info-soft: #5c93c41f;
}
```

Typography: no new fonts. Keep `'Segoe UI', system-ui, sans-serif` for body/UI and
`Consolas, monospace` for anything that's a number or a value (already the app's convention for
`.slider-value`, `.buff-timer` — just apply it more consistently, e.g. to every collapsed-section
summary). Uppercase + letter-spaced mono for section/status labels, same as the app already does
for `.settings-section-title`.

## The layout system

Apply this pattern everywhere `.card` → `.settings-section` → boxed list-items currently nest:

- **Gutter + blocks, not nested cards.** A page's content area sits on `--bg` (the gutter).
  Individual sections are flat `--panel-2` blocks — square corners (`border-radius: 0`), no
  border, no shadow — laid out in a vertical stack with a **6px gap** between them so the gutter
  shows through as a seam. Blocks never sit inside other blocks.
- **Block caps for real section breaks.** A block that needs a heading gets a small solid-fill
  bar at its own top, scoped to that block's width (not the full window) — background
  `var(--bar)`, light `var(--ink)` text, bold, uppercase, ~11px, letter-spaced. Reserve a second
  cap colour, `var(--info)`, specifically for blocks showing *live status* rather than
  *configuration* (e.g. "Active on this widget"), so the two kinds of information are never
  visually confused.
- **Dotted rules for row-to-row separation inside a block.** `border-bottom: 1px dotted
  var(--line)` between rows in a list — deliberately the quietest mark on the page, since the
  block boundary is already doing the heavy lifting.
- **A persistent left-edge colour stripe per row**, 4px wide, for anything that's part of a
  scannable list (collapsible settings topics, buff rows) — `var(--accent)` if the row holds a
  non-default/configured value, `var(--info)` if it's live/diagnostic, transparent otherwise.
  This must be visible whether the row is open or closed, hovered or not — it's a static identity
  marker, not an interaction state. **Do not** additionally draw a small dot/circle for this — it
  was tried and is redundant once the stripe exists; two "configured" cues stacked was itself
  part of the "hard on the eyes" complaint that led here.
- **Open/expanded state** gets a light background wash (`var(--accent-soft)`, or
  `var(--info-soft)` for info-striped rows) on just the header row, plus bold `var(--accent)`
  text on the title and a rotated chevron. This is a temporary interaction cue, separate from the
  persistent stripe.
- **Reserve `var(--danger)` for exactly one thing**: a buff whose remaining time has crossed the
  low-time threshold. Don't let it leak into delete buttons, error text, or anything else — it
  should be the loudest, rarest colour on screen so it keeps meaning "this needs you right now."

## Component-by-component

### 1. Widget settings panel

`#widget-settings-panel` in `index.html`, styled in `main-window.css`, behaviour in
`main-window.js`. This is the main piece. Per `UX_REDESIGN_PLAN.md`'s own grouping
(always-visible vs. collapsed-by-default, auto-expand rules), restructure into blocks:

- **Identity block** (always visible, no cap): Name input, Show this widget / Lock+Reposition
  row.
- **Display & Size block** (always visible, cap = "Display & Size"): style, sort order, opacity,
  icons-per-row/justification, sizing, mirror direction — whatever the plan already scoped as
  "always visible."
- **Configuration block** (cap = "Configuration"): the collapsible topics live together *inside
  this one block* — Buffs shown, Timer text, Label text, Alerts, Sounds, Loadout profiles. Each
  is a `.topic` row per the layout system above: chevron, title, inline value summary in mono
  (e.g. "5:12 · 13px · bottom-right"), left stripe if non-default, dotted separator between rows,
  click-to-expand with the accent-wash open state.
  - Auto-expand rule (from the plan): a topic opens by default if its collapsed value is
    non-default, or (for "Buffs shown" specifically) if the buff picker is empty — with a
    `var(--danger)`-left-border inline warning like "Nothing picked yet — this widget won't show
    anything until you select at least one buff below."
  - **Whether a topic counts as "configured" needs one explicit rule per field before wiring this
    up** — e.g. Alerts' flash threshold ships non-zero by default, so decide explicitly whether
    that counts as "default" or not, rather than leaving it to fall out of whatever comparison is
    easiest to write per field.
- **Live status block** (cap = "Active on this widget", `.info` cap colour): the live
  active-buffs list for this widget — a count pill (`border: 1px solid var(--info); color:
  var(--info)`) in the header, chip list of currently-active buffs in the body.
- **Manage block** (cap = "Manage widget"): Duplicate / Export as code / Delete widget.
- Custom timers and Loadout profiles checklist (currently separate cards
  `#widget-custom-timers-card`, `#widget-profiles-card`) fold into this same block system —
  Custom timers only renders for timer-type widgets per the existing logic, Loadout profiles can
  live as a topic inside the Configuration block.

JS work needed in `main-window.js`: toggle an `open` class on click (drives the CSS transition on
`.topic-body` via `max-height`), compute the inline mono summary text per topic from current
widget state, and set/unset a `configured` class on the topic element to drive the stripe colour.

### 2. Buff list rows

`.buff-list li`, used across Buff Tracker, Known Buffs, Active-on-this-widget, etc. Replace the
current bordered-box-per-row with flat rows inside a block: `border-bottom: 1px dotted
var(--line)` between rows (no border on the last row), hover picks out the row with a
`var(--panel)` background shift. Same information density, no repeated borders.

### 3. Sidebar

`renderWidgetSubmenu` in `main-window.js`.

- Tag the built-in Self Buffs widget with a small outline pill reading "Built-in" (mono,
  uppercase, bordered not filled — same family as the existing `.planned-badge` styling) so the
  missing delete option is explained rather than discovered by trying it.
- Add a small `var(--ok)`-coloured dot (deliberately a third hue — not accent, not danger) next
  to any widget scoped to specific loadout profiles, with a tooltip listing which ones, so a
  widget disappearing after a profile switch isn't confusing.
- Active nav item: a left accent-coloured bar instead of a filled background block, keeping
  consistent with the "chrome should be quiet, colour marks meaning" principle.

### 4. Setup page first-run state

When no EQ folder is configured yet: the EQ log file card becomes a promoted block (small
`var(--accent)` eyebrow reading "Start here", larger heading "Let's find your EverQuest log"),
and the other four Setup cards collapse to single-line closed rows (same chevron pattern as the
widget panel's topics) rather than being dimmed — one visual vocabulary for "not needed right
now," reused everywhere instead of introducing a second one just for this page.

### 5. Buff Tracker page — new "at a glance" strip

Add a row of gapped tiles (same gutter+block gap trick, at grid scale: `display:grid; gap:6px`
over the page's `--bg`) above the existing cards, showing live counts: Ambiguous casts pending,
Unknown casts pending, Active buffs, current Loadout profile. Zero-pending reads in quiet
`--ink-faint`; a pending count turns `var(--danger)`. Clicking a tile scrolls to the relevant card
below. This isn't in `UX_REDESIGN_PLAN.md` — it's a small addition surfacing "does anything need
me right now" before any card, which is the actual point of the plan's existing "needs your
attention above buff library" ordering, pushed one step further into layout instead of just copy
order.

## Process

Per this project's standing practice (see `CLAUDE.md`): implement in small, independently
testable steps, verified in the dev build (`npm start`) before moving on — one block/page at a
time, not one large rewrite. Suggested order:

1. Add the design tokens and confirm nothing visually breaks yet.
2. Convert the widget settings panel (biggest and most-discussed piece).
3. Buff list rows.
4. Sidebar badges.
5. Setup first-run.
6. The new at-a-glance strip.

Nothing here touches detection logic (`buffEngine.js`, `buffStore.js`, etc.) — this is
presentation-layer only.
