# Visual Style Guide — how this app's look actually works

This explains the *method* behind this app's appearance, not the specific palette. Everything
below is written so it transfers to a different app with a completely different colour choice —
nowhere does it say "use warm brown." If you're trying to give another project this same
crisp/clean/cohesive feel, follow the rules, not the hex values in `main-window.css`.

## The idea in one sentence

Almost everything that makes this UI feel deliberate instead of generic comes from **refusing to
have a separate "neutral chrome" colour** — borders, dividers, section banners, and interactive
highlights all draw from *one* accent hue at different strengths, text defaults to the brightest
tone available instead of a "safe" grey, and one clean sans-serif is used everywhere prose is
prose while a monospace font is carved out specifically for numbers. Nothing here is about which
colours you pick — it's about how few colour *roles* you allow yourself, and how consistently you
apply each one.

## 1. Three surfaces, one accent, one reserved colour — decide this before anything else

Pick:
- A **ground** tone (the darkest/lightest extreme, whichever direction your theme runs) — this is
  the page background and the "gutter" that shows between content blocks.
- **Two surface steps** above the ground — one for chrome (nav, title bar, hover states), one for
  the fill colour of actual content blocks/cards. Two steps is enough; a UI that needs a fourth
  step is usually a sign the *layout* is wrong, not that you need another shade.
- **One accent hue.** This single colour is going to do triple duty: borders, interactive
  elements, and "you selected/configured this." Resist adding a second "pretty" colour — the
  whole point is that when this colour shows up, it always means the same category of thing.
- **One reserved colour**, separate from the accent, for exactly one urgent meaning ("this needs
  you right now" — an error, an expiring timer, whatever that is in your app). Never let it leak
  into anything decorative. If it shows up in two unrelated places, a user learns to ignore it.
- Optionally, **one more colour** for "live/diagnostic status" if your app has that category of
  information (something that updates on its own, as opposed to something the user configured) —
  keeping it distinct from the accent means "you set this" and "this is happening right now"
  never get visually confused.

```css
:root {
  --ground: /* darkest/lightest extreme */;
  --surface-1: /* one step off ground - chrome, hover */;
  --surface-2: /* two steps off ground - content block fill */;
  --accent: /* your one interactive/identity colour */;
  --danger: /* reserved, one meaning, used sparingly */;
}
```

## 2. Every border comes from the accent, not a separate grey

This is the single highest-leverage rule here. Don't define a "neutral divider" colour that's
unrelated to your accent — derive it *from* the accent instead:

```css
:root {
  --line: var(--accent-line);        /* accent at reduced brightness/saturation */
  --line-soft: color-mix(in srgb, var(--accent-line) 50%, transparent);
}
```

Every hairline, every card/block border, every dotted row-separator, every input and button
border, uses `--line` (or the softer variant). The effect: nothing in the chrome reads as
"generic default browser/OS grey" — the whole interface feels like it belongs to one palette, all
the way down to a text input's 1px outline. This was the actual fix for an app that looked like "a
developer tool" despite already having a themed palette everywhere else — the palette wasn't the
problem, an unrelated grey border colour sitting underneath it was.

## 3. Three weights of separation, matched to how important the boundary actually is

Don't give every divider the same visual weight — that's what makes a UI exhausting to look at
even when the colours are fine (the actual complaint that led here: "one long run of the same
colour, no rest for the eyes"). Use three distinct strengths, and never skip a tier:

1. **Quietest — dotted, low-opacity line.** Row-to-row separation inside a list. It should be
   almost subliminal; if you can't half-ignore it, it's too strong.
2. **Medium — solid 1px line at full accent strength.** The boundary of a card/block, or a
   persistent identity marker (e.g. a coloured left edge on a row meaning "this one is
   configured/active"). This is the workhorse weight — most structure in the app should read at
   this level.
3. **Loudest — a solid-fill banner.** Reserved for a real section break, not just any label. A
   muted (not full-brightness) step of the accent as a *background fill*, sized to the width of
   just the block it labels, not the whole page. Because it's rare, it stays meaningful — if every
   heading got this treatment, none of them would stand out.

If you only have tier 2, everything looks like one undifferentiated wall of medium-strength lines.
If you only have tier 1, nothing is legible. The tiers only work as a *set*.

## 4. Flat blocks, never nested, separated by a gap that reveals the ground

The most common mistake this app made on the way here: giving every logical section its own
background + border, then nesting those sections inside a page section that *also* has its own
background + border. Three levels of "box inside a box inside a box" compounds visual weight fast.

The fix: pick **one** elevation for "a block of content" (`--surface-2`). Lay blocks out as
siblings — in a vertical stack or a grid — with a small gap between them (roughly 4–8px) so the
darker ground shows through as a seam, the way grout shows between tiles. A block never contains
another block. If a block needs an internal grouping, that's tier-1 or tier-2 separation from
rule 3 above (a dotted rule, a banner), not another nested surface.

```css
.block-stack { display: flex; flex-direction: column; gap: 6px; }
.block {
  background: var(--surface-2);
  border: 1px solid var(--line);   /* see rule 2 - not a separate grey */
  border-radius: 0;                /* see rule 7 */
}
```

Whether a border on top of the gap is *necessary* is genuinely a judgment call — a gap alone can
be enough separation in a short mockup, but once real, dense content fills the page, a border
usually turns out to still be needed. Don't assume gap-only will hold up; check it against the
actual app, not a demo.

## 5. Text: bright by default, hierarchy is weight, not colour

Default/body text should be the *brightest* tone your palette has, not a cautious mid-grey.
Reserve dimmer tones for content that's genuinely secondary (placeholders, timestamps, disabled
states) — and even your dimmest usable tier should still be comfortably legible against your
darkest surface, not just technically-passes-contrast-checker legible.

For anything selectable (nav items, tabs, chips): don't give the selected state a *different
colour* from the default — give it more **weight** instead. If default text is already at maximum
brightness, there's no brighter colour left to signal "this one's selected" with; bold does that
job without competing for the same visual channel colour is already using for structure (rule 2).

```css
.nav-item          { color: var(--text-default); font-weight: 400; }
.nav-item.selected { color: var(--text-default); font-weight: 700; }
```

## 6. Typography: one clean sans everywhere, one monospace carve-out for numbers

- Pick a single geometric or humanist sans-serif for all prose/UI text — something with
  consistent stroke weight and simple letterforms (this is most of what reads as "crisp" — a
  default OS font like Segoe UI or Arial is fine but looks generic; a font actually chosen for the
  job looks considered). Load it once, apply it to `body`, and stop thinking about it.
- Carve out **one exception**: a monospace face for anything that's a *number the user is tracking
  changing in real time* (a timer, a counter, a measurement). Monospace digits don't jitter or
  reshuffle horizontally as they change, and it doubles as a visual signal — "this is data," not
  prose — the same way a spreadsheet or terminal reads as more precise than a paragraph. Don't
  apply this font everywhere "for consistency"; it's specifically for values, not labels.
- Use uppercase + a little letter-spacing (`0.06–0.1em`) for small structural labels (section
  captions, status badges, nav-adjacent metadata). This is a cheap, well-worn convention that
  instantly reads as "this is UI chrome," separating it from content at a glance without needing
  another colour or a bigger font.
- Keep the type scale small and deliberate (a handful of sizes, reused everywhere) and lean on
  **weight** (400/600/700) more than size to build hierarchy — a page doesn't need six font sizes
  if three sizes and two weights cover every real distinction you need to make.

## 7. Square by default; round only literal toggles/pills

Pick one border-radius rule and apply it almost everywhere: **square corners** for anything that's
structural or data-bearing — blocks, cards, buttons, inputs, list rows. Reserve rounded corners
(fully round, `border-radius: 999px`) for things that are genuinely pill/chip/tag-shaped — a
loadout switcher, a status tag, a filter toggle. The reasoning: a rounded corner on a measurement
or a data surface reads as "approximate"; a square corner reads as "precise." Applying this
consistently (not "round some cards, square others") is what makes it register as a rule rather
than an accident.

## 8. Spend colour on meaning, not decoration

By the time you've done 1–7, colour in this UI is already fully booked: the accent means
"interactive / configured / selected," the reserved colour means one specific urgent thing, and
everything else is a brightness/weight distinction, not a hue distinction. Don't reach for a new
colour to make something "pop" — if it needs to stand out, it should be borrowing one of the roles
you already defined (a stronger border, a banner fill, bold text), not introducing a third hue that
now needs its own explanation.

## 9. Match the window chrome, or it always looks bolted on

If this is a desktop app, the OS-default title bar and menu bar can't be recoloured to match
whatever palette you just built — they'll always read as a mismatched seam between "your app" and
"the OS," no matter how considered everything below it is. A frameless window with a custom title
bar drawn in the same surfaces/accent/type as the rest of the app (even a minimal one — a mark, a
title, three small buttons) closes that gap. Keep the OS's expected interaction conventions
though: draggable title area, double-click to maximize, a close button that hints red on hover —
users shouldn't have to relearn window management just because the colours changed.

## How this app actually got here (briefly)

Worth knowing because the rules above weren't guessed up front — they're what survived real
iteration:

1. First pass nested a card inside a card inside a card. Rejected: too many stacked borders.
2. Second pass went fully flat — no borders anywhere, separation from a colour-step gap alone.
   Rejected: "hard on the eyes, no rest for the eyes" — zero separation is just as tiring as too
   much.
3. Landed on the three-tier system (rule 3) plus flat gapped blocks (rule 4) — closer, but a
   highlight border eventually got added back to every block anyway once real content (not a short
   mockup) was on screen. Gap-only separation didn't hold up at scale.
4. Borders and dividers were still on a separate neutral-grey token at this point, unrelated to
   the accent — that's what still read as "generic" even with a themed palette everywhere else.
   Unifying every line colour to the accent (rule 2) is what actually finished the look.
5. Default text was a muted "safe" tone throughout, including on primary navigation — flipped to
   white-by-default with weight (not colour) marking selection (rule 5).

None of this needed to happen in this order for a new project — it's included so the *reasoning*
for each rule is traceable back to a real problem it fixed, not just asserted.

## Quick checklist for applying this to a new palette

- [ ] One ground tone, two surface steps, one accent, one reserved "urgent" colour chosen
- [ ] `--line` derived from the accent, not a separate grey; a softer alpha variant for the
      quietest tier
- [ ] Three distinct separator weights defined and used consistently (dotted/quiet,
      solid/medium, banner-fill/loud)
- [ ] Content lives in flat, non-nested blocks with a gap + border, never box-in-a-box
- [ ] Default text is your brightest tone; selection state is bold, not a new colour
- [ ] One sans everywhere, one monospace carve-out for live numeric values only
- [ ] Square corners by default; fully-round only for real pill/tag/toggle elements
- [ ] Every colour used maps back to one of: accent, reserved/urgent, or a brightness/weight step
- [ ] If it's a desktop app, the window chrome itself is themed too, not left as OS default
