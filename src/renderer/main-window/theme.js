/* Custom theme colors (Setup -> App settings -> Colors). Owner, 15 Sep: "mostly just core
 * colours, background, text, text highlight, etc etc, outlines" - originally four pickers, one
 * per category, auto-deriving the rest of that category's shade ramp (the user chose "auto derive
 * it for now" over full per-variable control). Extended to six the same day after live feedback on
 * the first version:
 *   - "highlight and text highlight should be seperate colours" - a bold Highlight pick made the
 *     sidebar's SELECTED-row fill and small accent touches (buttons, borders, badges) compete for
 *     the same visual weight everywhere at once. Split into Highlight (buttons/borders/badges) and
 *     Text highlight (the selected-row/tab/chip fill, --select).
 *   - "some outlines are marked as highlights and not outlines, like the card edges" - .card/
 *     .block/.modal-card/etc had been hardcoded to --accent-line directly instead of the semantic
 *     --line the Outline picker actually controls; fixed in main-window.css, not here - see its
 *     :root comment on --panel-fill/--select for the mirror of this file's own reasoning.
 *   - "card panels should have their ow picker too, incase people want two tone setups" - added
 *     Panels (--panel-fill), independent of the base Background so a card surface can be a
 *     genuinely different tone from the page/gutter behind it.
 *
 * Pure color math with no DOM dependency (deriveTheme, and the mix/hex helpers under it) so it can
 * be unit-tested directly with real assertions on the computed hex values - this codebase's other
 * renderer scripts are IIFEs verified only by regex over their source text, which cannot catch a
 * wrong shade the way a real computed-value assertion can. applyTheme is the one DOM-touching
 * function, kept deliberately thin (just a loop of style.setProperty calls) so the part worth
 * getting wrong-and-catching is the math, not the wiring.
 *
 * Scope is the MAIN WINDOW'S OWN CHROME ONLY (Buff Tracker, Setup, Combat tab, etc.) - the
 * :root custom properties in main-window.css. It does NOT touch the overlay/aura windows, which
 * already have their own separate per-aura color/opacity/border settings and load a different
 * stylesheet (overlay.css) with no shared :root palette to override.
 *
 * The six CATEGORY colors the user actually picks:
 *   background     - anchors --panel; --bg (darker) and --panel-2 (lighter) derive from it
 *   panels         - anchors --panel-fill (card/block surfaces) directly; independent of
 *                    background/--bg, which --panel-fill is chained to by default (one tone,
 *                    today's shipped look) until this category overrides it
 *   text           - anchors --ink; --ink-mut/--ink-dim/--ink-faint step down toward background
 *   highlight      - anchors --accent; --accent-soft/--accent-line/--accent-dim/--bar derive from it
 *   textHighlight  - anchors --select (the selected-row/tab/chip fill) directly - no further tiers
 *   outline        - anchors --line; --line-soft is the same color at lower opacity
 *
 * `null` (or any category missing) means "no override for this category" - applyTheme(null)
 * (or omitting a category) removes the inline overrides for exactly that category's variables,
 * falling back to main-window.css's own shipped defaults, never a hardcoded guess at what they
 * were.
 */
(function (root) {
  'use strict';

  const HEX_RE = /^#([0-9a-f]{6})$/i;

  function isValidHex(hex) {
    return typeof hex === 'string' && HEX_RE.test(hex);
  }

  function hexToRgb(hex) {
    const m = HEX_RE.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function toHexByte(n) {
    return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  }

  function rgbToHex({ r, g, b }) {
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  }

  // RGB -> HSL (h in 0-360, s/l in 0-100). Every derived shade below shifts LIGHTNESS (and
  // sometimes saturation) in HSL space rather than blending RGB channels toward black/white -
  // measured against the app's own shipped palette first: bg/panel/panel-2 are the same hue and
  // saturation, stepping only in lightness (L 6.1 -> 8.4 -> 10.6), and blending toward pure white
  // in plain RGB instead washes a dark warm color out toward grey rather than a lighter version of
  // itself (checked directly - mixing #1c160f 20% toward white gives #49453f, a desaturated grey-
  // beige nothing like the shipped #241c12). HSL lightness shift is what actually reproduces "the
  // same color, lighter" for an arbitrary user-picked hue, not just the shipped brass one.
  function hexToHsl(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: s * 100, l: l * 100 };
  }

  function hueToRgbChannel(p, q, tCandidate) {
    let t = tCandidate;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToHex({ h, s, l }) {
    const hh = ((h % 360) + 360) % 360 / 360;
    const ss = Math.max(0, Math.min(100, s)) / 100;
    const ll = Math.max(0, Math.min(100, l)) / 100;
    if (ss === 0) {
      const v = ll * 255;
      return rgbToHex({ r: v, g: v, b: v });
    }
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    return rgbToHex({
      r: hueToRgbChannel(p, q, hh + 1 / 3) * 255,
      g: hueToRgbChannel(p, q, hh) * 255,
      b: hueToRgbChannel(p, q, hh - 1 / 3) * 255,
    });
  }

  // Shifts a color's own lightness by `deltaL` (percentage points, +/-) and optionally its
  // saturation by `deltaS`, clamped to a valid HSL range. Hue is never touched - this is what
  // keeps a derived shade reading as "the same color", not a drift toward some other hue.
  function shiftHsl(hex, deltaL, deltaS) {
    const hsl = hexToHsl(hex);
    if (!hsl) return hex;
    return hslToHex({
      h: hsl.h,
      s: hsl.s + (deltaS || 0),
      l: hsl.l + deltaL,
    });
  }

  // Interpolates lightness (and saturation) from `hex` toward `towardHex`'s own lightness/
  // saturation by `weight` (0 = pure hex, 1 = pure towardHex's L/S). Used to fade text toward
  // whatever background it sits on without drifting toward grey the way an RGB blend toward a
  // dark neutral would.
  //
  // HUE NEEDS ITS OWN CASE for an achromatic start color (white/grey/black, s=0) - its hue is
  // meaningless (most HSL implementations, this one included, just default it to 0/red) BECAUSE
  // saturation is 0, so it draws nothing at that saturation. The moment saturation is faded UP
  // toward the target's, that arbitrary 0 stops being invisible and shows up as a stray reddish
  // tint (checked directly: fading white toward a warm dark background produced pinkish
  // ink-mut/dim/faint instead of the intended warm tan). Borrowing the TARGET's hue whenever the
  // start is achromatic is what the ramp actually needs to look like - text quieting toward the
  // background's own warmth, not toward a hue nobody picked.
  function fadeHslToward(hex, towardHex, weight) {
    const a = hexToHsl(hex);
    const b = hexToHsl(towardHex);
    if (!a || !b) return hex;
    const w = Math.max(0, Math.min(1, weight));
    const startHue = a.s === 0 ? b.h : a.h;
    return hslToHex({
      h: startHue,
      s: a.s + (b.s - a.s) * w,
      l: a.l + (b.l - a.l) * w,
    });
  }

  // Appends a two-hex-digit alpha channel - matches how this app's own shipped palette already
  // writes a translucent tone (e.g. --accent-soft: #cf9a4a1f), so a derived value round-trips
  // through the exact same #rrggbbaa shape as a hand-authored one.
  function withAlpha(hex, alphaHex) {
    return `${hex}${alphaHex}`;
  }

  // The one function with real logic in this file. Everything else is a helper it calls.
  // `categories` is `{ background, text, highlight, outline }`, each an optional '#rrggbb' string
  // or missing/null (no override for that category). Returns a flat { '--css-var': 'value' } map
  // of ONLY the variables belonging to a category that was actually supplied - never a partial or
  // guessed value for a category the caller didn't ask to override.
  //
  // The deltas below (+/-5 L for background tiers, etc) are not a reconstruction of the shipped
  // palette's own exact numbers - those measured out to a very subtle +/-2.2 L, tuned by eye for
  // one specific dark warm brass hue. A user picking their OWN color needs a step wide enough to
  // actually read as three distinct tiers across whatever hue/lightness they pick, so these are
  // deliberately a bit more generous while keeping the same shape (background steps only in
  // lightness; text fades toward the background's own lightness/saturation; highlight darkens for
  // its line/bar tiers, lightly mutes for its "dim" text-safe tier).
  function deriveTheme(categories) {
    const c = categories || {};
    const out = {};

    if (isValidHex(c.background)) {
      out['--panel'] = c.background;
      out['--bg'] = shiftHsl(c.background, -5);
      out['--panel-2'] = shiftHsl(c.background, 5);
    }

    // A single anchor, no further tiers - .card/.block just need ONE fill color. Independent of
    // --bg/background on purpose (see this file's header comment on the "two tone" request); when
    // this category is not set, --panel-fill stays chained to --bg in main-window.css's own :root.
    if (isValidHex(c.panels)) {
      out['--panel-fill'] = c.panels;
    }

    if (isValidHex(c.text)) {
      // Faded toward the background's own lightness/saturation (falling back to the shipped
      // --panel - the surface text actually sits on, not the darker --bg gutter tier - if no
      // background override is active), not toward black/white - so secondary text tiers read as
      // "the same text, quieter against THIS background" for any pair the user picks, rather than
      // drifting toward grey the way a plain RGB blend does (see shiftHsl's comment).
      const fadeTo = isValidHex(c.background) ? c.background : '#1c160f';
      out['--ink'] = c.text;
      out['--ink-mut'] = fadeHslToward(c.text, fadeTo, 0.12);
      out['--ink-dim'] = fadeHslToward(c.text, fadeTo, 0.35);
      out['--ink-faint'] = fadeHslToward(c.text, fadeTo, 0.55);
    }

    if (isValidHex(c.highlight)) {
      out['--accent'] = c.highlight;
      out['--accent-soft'] = withAlpha(c.highlight, '1f');
      out['--accent-line'] = shiftHsl(c.highlight, -19, -9);
      out['--accent-dim'] = shiftHsl(c.highlight, -4, -10);
      out['--bar'] = shiftHsl(c.highlight, -23, -24);
    }

    // A single anchor, no further tiers - the sidebar's selected-row/tab fill and the active
    // profile chip all just need ONE fill color, independent of --accent so a bold Highlight pick
    // does not also take over the app's biggest, most dominant fill (see this file's header
    // comment on the "highlight and text highlight" report).
    if (isValidHex(c.textHighlight)) {
      out['--select'] = c.textHighlight;
    }

    if (isValidHex(c.outline)) {
      out['--line'] = c.outline;
      out['--line-soft'] = withAlpha(c.outline, '80');
    }

    return out;
  }

  // Applies (or clears) the derived variables on :root. `categories` null/undefined clears every
  // variable this module ever touches, reverting fully to main-window.css's shipped defaults -
  // used by "Reset to default". A partial `categories` object (some keys missing) clears only
  // the missing categories' own variables and leaves the others as they were, so resetting one
  // picker never disturbs the other three.
  const ALL_VARS_BY_CATEGORY = {
    background: ['--panel', '--bg', '--panel-2'],
    panels: ['--panel-fill'],
    text: ['--ink', '--ink-mut', '--ink-dim', '--ink-faint'],
    highlight: ['--accent', '--accent-soft', '--accent-line', '--accent-dim', '--bar'],
    textHighlight: ['--select'],
    outline: ['--line', '--line-soft'],
  };

  function applyTheme(categories, styleTarget) {
    const target = styleTarget || (root.document && root.document.documentElement);
    if (!target) return;
    const derived = deriveTheme(categories);
    const c = categories || {};
    for (const [category, vars] of Object.entries(ALL_VARS_BY_CATEGORY)) {
      const active = isValidHex(c[category]);
      for (const name of vars) {
        if (active) target.style.setProperty(name, derived[name]);
        else target.style.removeProperty(name);
      }
    }
  }

  const api = {
    isValidHex, hexToRgb, rgbToHex, hexToHsl, hslToHex, shiftHsl, fadeHslToward, withAlpha,
    deriveTheme, applyTheme, ALL_VARS_BY_CATEGORY,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.EQTheme = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
