const widgetId = new URLSearchParams(window.location.search).get('widgetId');

const listEl = document.getElementById('buff-list');
const contentWrap = document.getElementById('content-wrap');
const dragOverlayEl = document.getElementById('drag-overlay');

// Used only until the real config arrives from getConfig() below - a
// freshly created widget's window has to fully boot before that resolves,
// and in that brief window this is what governs what renders. Defaults to
// showing nothing rather than everything: a custom widget's whole point is
// a user-picked whitelist, so failing closed here is the safe direction,
// not "all" (which would flash - or worse, get stuck showing - every
// active buff on a widget the user hasn't configured yet).
let currentConfig = {
  displayMode: 'list',
  timerFormat: 'minutes-seconds',
  textSize: 13,
  iconSize: 46,
  contentAnchor: 'top-left',
  buffFilterMode: 'explicit',
  buffNames: [],
  excludedBuffNames: [],
  buffSource: 'self',
  sortOrder: 'default',
  lowTimeThresholdSec: 30,
  landingGlowEnabled: true,
  hideBardSongs: false,
  maxDurationFilterSec: 0,
  soundOnLand: false,
  soundOnExpire: false,
  soundWarningSec: 0,
  soundWarningLoopSec: 0,
  showRowIcon: false,
  mirrorRowDirection: false,
  showIconLabel: false,
  iconLabelSize: 11,
  iconLabelAnchor: 'top-center',
  wrapText: false,
  iconJustify: 'left',
};

// Short synthesized tones instead of bundled audio files - no assets to
// ship/license, and it's enough to be a distinct audible cue for land vs
// expire vs the pre-expiry warning. Lazily created since Chromium won't
// let an AudioContext start running before some user/window activity
// anyway, so there's nothing to gain by constructing it up front.
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep(freq, startDelayMs, durationMs) {
  const ctx = getAudioCtx();
  const startAt = ctx.currentTime + startDelayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationMs / 1000 + 0.02);
}

// One alert per render tick even if several buffs changed at once (e.g. a
// multi-buff burst cast landing together) - a chime per buff would be a
// wall of overlapping beeps instead of a useful cue.
function playAlertSound(kind) {
  if (kind === 'land') beep(880, 0, 110);
  else if (kind === 'expire') {
    beep(440, 0, 90);
    beep(300, 90, 130);
  } else if (kind === 'warning') beep(660, 0, 90);
}

// Identity key for every Set/Map that tracks a buff instance across
// renders (tileRefs, landedNames, shownNames, warnedAt,
// lastRemainingSec) - plain buff name for self buffs (unchanged from
// before ally-buff tracking existed), but name+ally for ally buffs, since
// the same buff name can be active on several different allies at once and
// each instance needs its own independent identity/timer/glow state.
function keyFor(buff) {
  return buff.allyName ? `${buff.allyName.toLowerCase()}::${buff.name.toLowerCase()}` : buff.name.toLowerCase();
}

function checkSoundWarnings(visible) {
  const thresholdSec = currentConfig.soundWarningSec || 0;
  if (thresholdSec <= 0) return;
  // 0 = warn once only (the original behavior) - a real loop interval
  // re-fires every N seconds for as long as the buff stays under
  // thresholdSec, until warnedAt gets cleared by a real expiry or renewal
  // (see justExpiredRaw/soundLandedRaw in render() below).
  const loopSec = currentConfig.soundWarningLoopSec || 0;
  const now = Date.now();
  for (const buff of visible) {
    const key = keyFor(buff);
    if (buff.remainingSec > thresholdSec) continue;
    const lastWarnedAt = warnedAt.get(key);
    if (lastWarnedAt === undefined) {
      warnedAt.set(key, now);
      playAlertSound('warning');
    } else if (loopSec > 0 && now - lastWarnedAt >= loopSec * 1000) {
      warnedAt.set(key, now);
      playAlertSound('warning');
    }
  }
}

function formatTime(totalSec, format) {
  if (format === 'seconds-only') return `${totalSec}`;
  if (format === 'rounded-minutes') {
    // Under a minute, rounding up to whole minutes ("1m") is misleading
    // for a countdown - fall back to the same plain seconds count
    // seconds-only mode uses instead.
    if (totalSec < 60) return `${totalSec}`;
    // Floor, not ceil - a countdown showing "3m" while only 2:54 actually
    // remains (ceil(2.9) = 3) reads as more time left than there really
    // is. Floor always shows whole minutes truly still remaining.
    return `${Math.floor(totalSec / 60)}m`;
  }
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Simple deterministic color per buff name, used for the placeholder icon
// tile background until real game icons are wired in.
function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 45%, 32%)`;
}

function initials(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Ally buffs need to show WHO they're on (the same buff can be active on
// several different allies at once) - self buffs (no allyName) render
// exactly as before.
function displayName(buff) {
  return buff.allyName ? `${buff.allyName}: ${buff.name}` : buff.name;
}

function buildListRow(buff) {
  const root = document.createElement('div');
  root.className = 'buff-row';
  // Icon position and which edge the bar anchors/counts down to both flip
  // together under this one class - see overlay.css. Read at row-creation
  // time only (a config change already forces every row to rebuild fresh,
  // same as an icon-set switch does - see applyConfig's tileRefs.clear()).
  root.classList.toggle('mirrored', !!currentConfig.mirrorRowDirection);

  // The bar/name/time live in their own wrapper, separate from the icon,
  // so the bar's absolute-position fill is contained to the space actually
  // left after the icon - without this, the bar (sized as a % of the
  // whole row) would extend behind/under the icon instead of visibly
  // stopping at its edge.
  const content = document.createElement('div');
  content.className = 'buff-row-content';

  // Fill anchored to the "full" edge (left normally, right when mirrored -
  // see .mirrored .buff-row-bar), so as it shrinks toward 0% the opposite
  // edge is what recedes.
  const bar = document.createElement('div');
  bar.className = 'buff-row-bar';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = displayName(buff);

  const time = document.createElement('span');
  time.className = 'time';

  content.append(bar, name, time);

  const ref = { root, timeEl: time, barEl: bar, iconWrapEl: null, lastIconUrl: undefined };
  if (currentConfig.showRowIcon) {
    const iconWrap = document.createElement('div');
    iconWrap.className = 'buff-row-icon';
    ref.iconWrapEl = iconWrap;
    root.append(iconWrap, content);
    updateRowIcon(ref, buff);
  } else {
    root.append(content);
  }
  return ref;
}

// Same "swap only if the URL actually changed" reasoning as
// updateTileIcon() below (icon-set switching without a structural change)
// - kept separate rather than shared since the two contexts insert into
// different container shapes.
function updateRowIcon(ref, buff) {
  if (!ref.iconWrapEl) return;
  if (ref.lastIconUrl === buff.iconUrl) return;
  ref.lastIconUrl = buff.iconUrl;
  ref.iconWrapEl.innerHTML = '';
  if (buff.iconUrl) {
    const img = document.createElement('img');
    img.src = buff.iconUrl;
    img.alt = '';
    ref.iconWrapEl.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'tile-placeholder';
    placeholder.style.background = colorForName(buff.name);
    placeholder.textContent = initials(buff.name);
    ref.iconWrapEl.appendChild(placeholder);
  }
}

function buildIconTile(buff) {
  const root = document.createElement('div');
  root.className = 'buff-tile';
  root.title = displayName(buff);

  const time = document.createElement('span');
  time.className = 'tile-time';
  root.appendChild(time);

  const ref = { root, timeEl: time, labelEl: null, lastIconUrl: undefined };
  updateTileIcon(ref, buff);

  // Read once at build time, not tracked for later updates - a name only
  // ever changes by way of a different buff replacing this tile entirely
  // (a structural change, which always rebuilds from scratch anyway), same
  // as .name in buildListRow.
  if (currentConfig.showIconLabel) {
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = displayName(buff);
    root.appendChild(label);
    ref.labelEl = label;
  }
  return ref;
}

// Swaps the tile's icon <img> (or fallback placeholder) only when the
// buff's iconUrl actually changed - switching icon sets, or assigning an
// icon to a custom buff that didn't have one, both change buff.iconUrl for
// an already-tracked buff without its name changing, which the
// structural-change check in render() doesn't catch on its own (it's
// deliberately name/mode-based, not per-field, to avoid the constant
// teardown/rebuild churn that caused the countdown-label rendering bug).
function updateTileIcon(ref, buff) {
  if (ref.lastIconUrl === buff.iconUrl) return;
  ref.lastIconUrl = buff.iconUrl;
  const old = ref.root.querySelector('img, .tile-placeholder');
  if (old) old.remove();

  let iconEl;
  if (buff.iconUrl) {
    iconEl = document.createElement('img');
    iconEl.src = buff.iconUrl;
    iconEl.alt = buff.name;
  } else {
    iconEl = document.createElement('div');
    iconEl.className = 'tile-placeholder';
    iconEl.style.background = colorForName(buff.name);
    iconEl.textContent = initials(buff.name);
  }
  ref.root.insertBefore(iconEl, ref.timeEl);
}

// Positions/sizes/colors a text overlay on top of an icon tile (the
// countdown, or the optional name label - see buildIconTile) via inline
// styles rather than an external stylesheet rule. This is here because the
// external-stylesheet version of this exact rule reliably failed to paint
// at all in this window (confirmed with hardcoded values, no CSS vars,
// explicit height, cache-busted reload, and reduced DOM churn - none of it
// made a difference), while the identical properties applied inline always
// painted correctly. Root cause not fully isolated; inline styles sidestep
// it entirely and cost nothing extra to maintain. anchor/textSize are
// passed in (not read from a single fixed currentConfig field) so the
// timer text and the label text can each have their own independent
// position/size.
// Multi-line clamp used when wrapText is on - a fixed line count rather
// than something computed from the tile's actual height, since the goal is
// just "stays roughly inside the icon", not an exact fit for every possible
// icon-size/text-size combination. 2, not more - a 3rd wrapped line pushed
// the text up far enough into the icon art itself to look broken rather
// than just compact, so anything past 2 lines ellipsizes instead.
const WRAP_MAX_LINES = 2;

// wrap: only ever true for the label text, never the timer - "Wrap text to
// fit inside the icon" is specifically about the name label (the thing
// liable to be a long multi-word buff name), not the countdown (always
// short - "5:12", "312", "6m" - which has no business wrapping at all).
function applyTilePositionedTextStyle(el, low, anchor, textSize, wrap) {
  const [vertical, horizontal] = anchor.split('-');

  // Plain text, no background bar - a filled box reads as an odd banner
  // once it's anchored into a corner instead of spanning the tile's full
  // width. A 4-direction dark outline keeps it legible against any icon
  // art without needing a background.
  //
  // Centering uses left:50%/top:50% + transform:translate(-50%,-50%), not
  // left:2px + right:2px + text-align:center - the fixed-span approach only
  // centers correctly while content fits inside that span, and unwrapped
  // overflow content (wrapText off) is often wider than the tile by design.
  // The translate technique centers correctly either way.
  el.style.position = 'absolute';
  el.style.top = vertical === 'top' ? '2px' : vertical === 'middle' ? '50%' : 'auto';
  el.style.bottom = vertical === 'bottom' ? '2px' : 'auto';
  el.style.left = horizontal === 'left' ? '2px' : horizontal === 'center' ? '50%' : 'auto';
  el.style.right = horizontal === 'right' ? '2px' : 'auto';
  const translateX = horizontal === 'center' ? '-50%' : '0';
  const translateY = vertical === 'middle' ? '-50%' : '0';
  el.style.transform = `translate(${translateX}, ${translateY})`;
  el.style.textAlign = horizontal === 'left' ? 'left' : horizontal === 'right' ? 'right' : 'center';
  el.style.fontFamily = 'Consolas, monospace';
  el.style.fontSize = `${textSize}px`;
  el.style.fontWeight = '700';
  el.style.color = low ? '#ff8080' : '#f0f1f5';
  el.style.background = 'none';
  el.style.textShadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
  el.style.height = 'auto';
  el.style.lineHeight = 'normal';

  if (wrap) {
    // Contained to the tile's own width (a small inset, not the exact icon
    // size, so it never touches the tile's edges) and capped to a few lines
    // with an ellipsis past that - "stays inside the icon" per the user's
    // request, the opposite of the overflow behavior below. Matters most on
    // a widget showing many icons packed together (Self Buffs, Ally Buffs),
    // where an unconstrained label runs straight into its neighbor's text.
    //
    // An explicit width, not max-width - -webkit-box (needed for the
    // multi-line ellipsis clamp below) doesn't reliably size itself up to
    // fill an available max-width the way normal block content does, and
    // was observed wrapping short text (e.g. "Strength") after only 5-6
    // characters, nowhere near the icon's actual edge. An explicit width
    // removes that ambiguity - the box always fills exactly this much
    // space and wraps within it, not before it.
    const iconSize = currentConfig.iconSize || 46;
    el.style.whiteSpace = 'normal';
    el.style.wordBreak = 'break-word';
    el.style.width = `${Math.max(0, iconSize - 4)}px`;
    el.style.maxWidth = '';
    el.style.overflow = 'hidden';
    el.style.display = '-webkit-box';
    el.style.webkitBoxOrient = 'vertical';
    el.style.webkitLineClamp = String(WRAP_MAX_LINES);
  } else {
    // Deliberately allowed to overflow the tile (no width/overflow clamp) -
    // a name is often wider than a small icon, and .buff-tile itself no
    // longer clips (see its own comment) specifically so this can spill out
    // instead of being cut off. Most useful on a widget showing only one or
    // a few icons at a time, where there's room to spare and truncating a
    // long custom-timer name serves nobody.
    el.style.whiteSpace = 'nowrap';
    el.style.wordBreak = '';
    el.style.width = '';
    el.style.maxWidth = '';
    el.style.overflow = 'visible';
    el.style.display = '';
    el.style.webkitBoxOrient = '';
    el.style.webkitLineClamp = '';
  }
}

function updateRef(ref, buff, isIcon) {
  const threshold = currentConfig.lowTimeThresholdSec ?? 30;
  const low = threshold > 0 && buff.remainingSec <= threshold;
  ref.root.classList.toggle('low', low);
  ref.timeEl.textContent = formatTime(buff.remainingSec, currentConfig.timerFormat);
  if (isIcon) {
    updateTileIcon(ref, buff);
    applyTilePositionedTextStyle(ref.timeEl, low, currentConfig.contentAnchor || 'bottom-center', currentConfig.textSize || 10, false);
    if (ref.labelEl) {
      applyTilePositionedTextStyle(
        ref.labelEl,
        low,
        currentConfig.iconLabelAnchor || 'top-center',
        currentConfig.iconLabelSize || 11,
        !!currentConfig.wrapText
      );
    }
  } else {
    const pct = buff.durationSec > 0 ? Math.max(0, Math.min(100, (buff.remainingSec / buff.durationSec) * 100)) : 0;
    ref.barEl.style.width = `${pct}%`;
    updateRowIcon(ref, buff);
  }
}

// 'default' leaves the array in whatever order it arrived in (cast order,
// from the main process) - not a no-op sort call, since re-sorting stable
// input every tick for no reason is wasted work.
function sortBuffs(buffs, order) {
  if (order === 'time-remaining') return [...buffs].sort((a, b) => a.remainingSec - b.remainingSec);
  if (order === 'alphabetical') return [...buffs].sort((a, b) => a.name.localeCompare(b.name));
  return buffs;
}

function visibleBuffs(buffs) {
  let filtered;
  if (currentConfig.buffFilterMode === 'all') {
    filtered = buffs.filter((b) => b.showOnOverlay !== false);
    // Self Buffs-only filters - buffFilterMode:'all' is exclusive to that
    // built-in widget, custom widgets always use 'explicit' with their own
    // picked list instead, so these never apply there.
    if (currentConfig.hideBardSongs) filtered = filtered.filter((b) => !b.isBardSong);
    if (currentConfig.maxDurationFilterSec > 0) {
      filtered = filtered.filter((b) => b.durationSec <= currentConfig.maxDurationFilterSec);
    }
    if (currentConfig.excludedBuffNames && currentConfig.excludedBuffNames.length > 0) {
      const excludeSet = new Set(currentConfig.excludedBuffNames.map((n) => n.toLowerCase()));
      filtered = filtered.filter((b) => !excludeSet.has(b.name.toLowerCase()));
    }
  } else {
    const nameSet = new Set((currentConfig.buffNames || []).map((n) => n.toLowerCase()));
    filtered = buffs.filter((b) => nameSet.has(b.name.toLowerCase()));
  }
  return sortBuffs(filtered, currentConfig.sortOrder);
}

// Both modes fit their window's height to exactly however many rows/icons
// are visible right now, and icon mode's width too (list mode's width
// instead comes from the "List width" setting, applied in applyConfig
// before this ever measures anything).
let lastReportedWidth = null;
let lastReportedHeight = null;
let lastReportedOriginX = null;

// How far the grid's own left edge sits inset from content-wrap's left edge
// right now (0 outside icon mode, or when no label margin is reserved) -
// see applyConfig's icon-mode branch. Sent to the main process alongside
// the measured size so it can shift the actual window's x position to
// compensate (see widgetManager.js's fitToContent) - otherwise a wider
// window (to fit reserved label-overflow margin) growing from its fixed
// top-left corner would visibly shift every icon right the moment the
// label toggled on, then back when it toggled off.
let currentOriginX = 0;

function reportSizeIfChanged() {
  const rect = contentWrap.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  // The drag-overlay's height is set here as an explicit pixel value (see
  // applyConfig's icon-mode branch, which only sets its width/left/top) not
  // CSS height:100% - content-wrap's own height is deliberately auto/
  // content-driven (see its own comment), and a percentage height on an
  // absolutely-positioned child doesn't resolve against a container whose
  // own height isn't itself a definite value, collapsing to fit the drag-
  // overlay's own text content instead of the actual icon grid's height.
  //
  // window.innerHeight, not the measured content-wrap rect above - a
  // widget with zero active icons has near-zero real content height, but
  // the actual BrowserWindow is floored to a sensible minimum by
  // widgetManager.js's minHeightFor() specifically so an empty widget still
  // has a clickable/draggable area at all. Using the content measurement
  // here reproduced the same "too short to see" problem that floor exists
  // to prevent, just one layer up (a correctly-floored window with a
  // drag-overlay too short to fill it). The real window height is always
  // at least that floor, whether or not there's content to justify it.
  //
  // Kept in sync with every real size change, not just applyConfig (which
  // runs before any tile has actually been measured), and harmless outside
  // icon mode - list mode resets the drag-overlay back to position:fixed,
  // where an inline height here would have no effect at all.
  if (currentConfig.displayMode === 'icons') {
    dragOverlayEl.style.height = `${window.innerHeight}px`;
  }
  if (width === lastReportedWidth && height === lastReportedHeight && currentOriginX === lastReportedOriginX) return;
  lastReportedOriginX = currentOriginX;
  lastReportedWidth = width;
  lastReportedHeight = height;
  window.eqOverlay.reportContentSize(widgetId, width, height, currentOriginX);
}

// Buffs are tracked by name so a plain countdown tick (the vast majority
// of updates - this runs every second) only touches each existing
// element's text/bar-width in place, instead of tearing down and
// rebuilding every tile/row from scratch. The constant destroy-and-recreate
// churn that used to happen here was interrupting the browser's own
// layout/paint work often enough to produce genuinely incomplete,
// inconsistent frames (icons rendering but their countdown label not
// painting in time) - this wasn't a CSS bug, it was starving the renderer
// of a stable frame to finish painting. A full rebuild still happens, but
// only when the visible buff set or the display mode actually changes.
const tileRefs = new Map(); // lowercased buff name -> { root, timeEl, barEl? }

// Tracks every buff the ENGINE currently has active, regardless of this
// widget's own display filters - deliberately not the same as "currently
// shown here" (see shownNames below). Using the filtered/visible set for
// this caused a real bug: dragging the "hide buffs longer than" slider
// changes which buffs pass THIS widget's filter without any buff actually
// landing or expiring, and comparing against the visible set alone read
// each reveal as a fresh landing - firing the glow/sound every time the
// slider crossed a buff's duration. Comparing against the true engine-wide
// active set instead means only a genuine landing/expiry ever counts,
// independent of what this widget happens to be filtering in or out.
const landedNames = new Set();

// What THIS widget actually had on screen last render - used together with
// landedNames to tell "genuinely expired" (gone from landedNames too) apart
// from "just filtered out by a setting change" (still in landedNames, only
// dropped from here).
const shownNames = new Set();

// key -> ms timestamp of the last warning sound played this "life" of the
// buff (see checkSoundWarnings) - a Map, not just a Set, so a looping
// warning can tell how long it's been since the last fire, not just
// whether one has ever happened. Pruned only on a genuine expiry or a
// fresh (re)land (see justExpiredRaw and soundLandedRaw below), not a
// filter change, so a later recast warns again but a filter toggle never
// resets or repeats a warning for a buff that never stopped running.
const warnedAt = new Map();

// Last-seen remainingSec per raw active buff - lets the SOUND alerts (but
// deliberately not the glow, see below) notice a buff being re-cast even
// though it never actually left the active list, e.g. an auto-renewing
// bard song re-sung every few seconds well before its short duration would
// run out. landedNames/newlyLandedRaw only catch a buff going from absent
// to present, which an auto-renewed buff only ever does once (or never, if
// it was already active before this widget started watching) - but a
// renewal always resets its expiry, so remainingSec jumping back UP
// instead of ticking down is an unambiguous "this just got cast again"
// signal regardless of whether the buff was ever technically absent.
const lastRemainingSec = new Map();

// Not the first ever render for this widget window - guards sound alerts
// (but not the landing glow, which already handled this) so opening the
// widget or reloading it doesn't fire a "landed" sound for every buff
// that was already active before this window existed to hear about it.
let hasRenderedBefore = false;

function render(buffs) {
  const visible = visibleBuffs(buffs);
  const isIcon = currentConfig.displayMode === 'icons';
  const modeKey = isIcon ? 'icons' : 'list';
  const visibleKeys = visible.map((b) => keyFor(b));
  const visibleSet = new Set(visibleKeys);

  const rawSet = new Set(buffs.map((b) => keyFor(b)));
  const newlyLandedRaw = new Set([...rawSet].filter((name) => !landedNames.has(name)));
  const justExpiredRaw = new Set([...landedNames].filter((name) => !rawSet.has(name)));
  landedNames.clear();
  rawSet.forEach((name) => landedNames.add(name));
  for (const name of justExpiredRaw) warnedAt.delete(name);

  // Renewal detection for sound purposes only - see lastRemainingSec above.
  const soundLandedRaw = new Set();
  for (const b of buffs) {
    const key = keyFor(b);
    const prevRemaining = lastRemainingSec.get(key);
    if (prevRemaining === undefined || b.remainingSec > prevRemaining) soundLandedRaw.add(key);
    lastRemainingSec.set(key, b.remainingSec);
  }
  for (const key of lastRemainingSec.keys()) {
    if (!rawSet.has(key)) lastRemainingSec.delete(key);
  }
  for (const name of soundLandedRaw) warnedAt.delete(name);

  // Effects only ever fire for buffs this widget is actually displaying -
  // intersecting with what was/is visible here means a widget never glows
  // or beeps about a buff it doesn't show, while a pure filter-visibility
  // change (as opposed to a real landing/expiry/renewal) still can't
  // trigger either, since it never shows up in the raw sets above.
  //
  // The glow deliberately keeps using newlyLandedRaw (first-ever-landing
  // only, not renewals) - a visual flash every few seconds on a maintained
  // song would just be noise nobody asked for. Sound uses soundLandedRaw
  // instead, which also catches renewals, since the whole point here was
  // that the engine visibly treats each renewal as a fresh landing
  // (duration resets in the tracker) and the "on land" sound should agree.
  const newlyLanded = new Set([...newlyLandedRaw].filter((name) => visibleSet.has(name)));
  const soundNewlyLanded = new Set([...soundLandedRaw].filter((name) => visibleSet.has(name)));
  const justExpired = new Set([...justExpiredRaw].filter((name) => shownNames.has(name)));
  shownNames.clear();
  visibleSet.forEach((name) => shownNames.add(name));

  if (hasRenderedBefore) {
    if (currentConfig.soundOnLand && soundNewlyLanded.size > 0) playAlertSound('land');
    if (currentConfig.soundOnExpire && justExpired.size > 0) playAlertSound('expire');
  }
  checkSoundWarnings(visible);
  hasRenderedBefore = true;

  // Compared against the DOM's actual current child count, not just
  // tileRefs.size - the two can be independently reset (applyConfig clears
  // tileRefs before this ever runs) in a way that made "0 visible now" and
  // "0 tracked already" compare as "unchanged" even though the DOM still
  // had a stale leftover tile nobody ever told to go away. Comparing
  // against reality directly can't drift out of sync like that.
  const structureChanged =
    listEl.dataset.mode !== modeKey ||
    listEl.children.length !== visibleKeys.length ||
    visibleKeys.some((key) => !tileRefs.has(key));

  if (structureChanged) {
    listEl.innerHTML = '';
    tileRefs.clear();
    listEl.classList.toggle('icon-grid', isIcon);
    listEl.dataset.mode = modeKey;
    for (const buff of visible) {
      const ref = isIcon ? buildIconTile(buff) : buildListRow(buff);
      updateRef(ref, buff, isIcon);
      // Only a genuinely new arrival gets the one-shot glow - a tile
      // recreated here because a *different* buff changed the visible set
      // (forcing this same full-rebuild path) must not replay it.
      if (currentConfig.landingGlowEnabled !== false && newlyLanded.has(keyFor(buff))) {
        ref.root.classList.add('just-landed');
        // Must come off once the one-shot animation finishes, not linger
        // forever - .just-landed and .low both set the `animation` shorthand,
        // and CSS cascade lets whichever class's rule comes later in the
        // stylesheet win the WHOLE property, not just for as long as its
        // animation is actually playing. Left permanently on, it silently
        // blocked the low-time pulse from ever showing on that tile again -
        // and since every buff counts as "newly landed" on a widget's very
        // first render, that was nearly every tile.
        ref.root.addEventListener('animationend', () => ref.root.classList.remove('just-landed'), { once: true });
      }
      tileRefs.set(keyFor(buff), ref);
      listEl.appendChild(ref.root);
    }
  } else {
    // Same buffs, same mode - update in place and re-append in the
    // current sort order (appendChild on an already-attached node moves
    // it rather than cloning, so this reorders without recreating).
    for (const buff of visible) {
      const ref = tileRefs.get(keyFor(buff));
      updateRef(ref, buff, isIcon);
      listEl.appendChild(ref.root);
    }
  }
  // Unconditional, not just inside the structureChanged branch above - a
  // config change (icons-per-row, icon size, list width, ...) can resize
  // content-wrap without changing which buffs are shown at all, and a
  // widget with zero active buffs both before and after never counts as
  // "structure changed" in the first place (0 tiles compared against 0
  // tiles), so that path alone left an empty widget's window stuck at its
  // old size until something else happened to force a rebuild. Cheap to
  // call every render regardless - reportSizeIfChanged only actually
  // reports when the measured size or origin really changed.
  reportSizeIfChanged();
}

// Both sources are always fetched/subscribed regardless of which one this
// widget currently shows - switching buffSource (only possible on a custom
// widget, see main-window.js) just needs to start rendering the other
// already-live cache immediately, not wait on a fresh subscription/fetch
// round-trip.
let lastSelfBuffs = [];
let lastAllyBuffs = [];
let lastCustomTimers = [];

function currentSourceBuffs() {
  if (currentConfig.buffSource === 'ally') return lastAllyBuffs;
  if (currentConfig.buffSource === 'customTimer') return lastCustomTimers;
  return lastSelfBuffs;
}

function applyLockState(locked) {
  document.body.classList.toggle('unlocked', !locked);
}

const ICON_GRID_GAP_PX = 6;
// Fixed, not measured - a label's actual width depends on the buff name
// text, which isn't known (and shouldn't drive constant widget resizing)
// ahead of render time. A reasonable fixed allowance rather than an exact
// fit; a genuinely very long name can still clip at the window edge.
const LABEL_OVERFLOW_MARGIN_PX = 60;

function applyConfig(config) {
  currentConfig = config;
  document.documentElement.style.setProperty('--text-size', `${config.textSize || 13}px`);
  document.documentElement.style.setProperty('--icon-size', `${config.iconSize || 46}px`);
  document.documentElement.style.setProperty('--row-size', `${config.rowSize || 28}px`);

  if (config.displayMode === 'icons') {
    // Icons per row is an explicit count, not a natural reflow based on
    // how many happen to fit at the current icon size - constrain the
    // grid's width to exactly that many columns (+ gaps) so it wraps
    // predictably regardless of icon size. content-wrap gets that same
    // width explicitly too (not "fit-content") - fit-content sizing on a
    // flex column whose child is itself a flex-wrap grid is an intrinsic-
    // sizing edge case browsers don't resolve consistently, and was
    // producing a wildly wrong (much too narrow) measured width. An
    // explicit pixel value removes the ambiguity entirely.
    const perRow = config.iconsPerRow || 4;
    const iconSize = config.iconSize || 46;
    // +8 = .buff-list's own 4px horizontal padding x2 - box-sizing:border-box
    // means max-width includes padding, so without adding it back the
    // content area (where icons actually lay out) ends up 8px too narrow
    // to fit as many per row as intended (e.g. "2 per row" only fit 1).
    const gridWidth = perRow * iconSize + (perRow - 1) * ICON_GRID_GAP_PX + 8;
    listEl.style.maxWidth = `${gridWidth}px`;
    // Where active tiles sit within the grid's own (fixed, cap-based) width
    // when there are fewer of them than "Icons per row" - e.g. a cap of 20
    // with only 1 buff active puts that one tile in the middle of the space
    // 20 would occupy when set to 'center', instead of always flush left.
    // flex-wrap means this applies per row independently, which is exactly
    // what's wanted once there's more than one row too.
    const JUSTIFY_CONTENT_MAP = { left: 'flex-start', center: 'center', right: 'flex-end' };
    listEl.style.justifyContent = JUSTIFY_CONTENT_MAP[config.iconJustify] || 'flex-start';
    // A label wide enough to overflow past the grid's own edge (the whole
    // point of letting it overflow at all when wrapText is off - see
    // .buff-tile's comment) still can't render past the WIDGET WINDOW's own
    // edge - that's an OS-level clip, nothing CSS can do about it. Reserving
    // extra width on content-wrap gives it actual room in the window to
    // spill into, without needing the grid itself to move (see below) - only
    // reserved when the label can actually overflow at all, since wrapText
    // on means it's clamped to stay inside its own tile instead (nothing to
    // reserve room for).
    // A label centered on a tile (the default anchor, and true for any
    // single-icon widget regardless of anchor since there's only one column)
    // overflows in BOTH directions from its center point - room reserved on
    // only one side (an earlier version reserved right-only to avoid a
    // window-position complication, see below) still clipped the other side
    // whenever a label was wide enough. Both sides, always, when reserved.
    const labelMargin = config.showIconLabel && !config.wrapText ? LABEL_OVERFLOW_MARGIN_PX : 0;
    listEl.style.width = `${gridWidth}px`;
    // Centered in the reserved margin (not flush-left) - a BrowserWindow
    // only ever grows from its top-left corner, so a wider window without
    // this would put all the new width on the right, and centering is what
    // actually gives the label room on the left too. On its own this would
    // visibly shift every icon right the moment the label toggled on (then
    // back when it toggled off) - currentOriginX (reported to the main
    // process below) is how the window's own x position gets shifted left
    // to compensate, so the grid's actual on-screen position stays put
    // either way. See widgetManager.js's fitToContent for the other half.
    listEl.style.marginLeft = labelMargin ? `${labelMargin}px` : '';
    contentWrap.style.width = `${gridWidth + labelMargin * 2}px`;
    currentOriginX = labelMargin;
    // The drag-overlay (visible only while unlocked, for repositioning) is
    // deliberately sized to just the icon grid's own footprint, not
    // content-wrap's full width - a widget window can legitimately be wider
    // than its icons to give an unwrapped label room to spill into (above),
    // but that reserved margin isn't itself part of "the widget," and a
    // dashed blue box implying otherwise was actively confusing (it read as
    // "the widget is this big" when the icons themselves were much
    // smaller). position:absolute here, not the CSS default position:fixed
    // (which covers the whole viewport/window regardless of ancestors) -
    // absolute against content-wrap (position:relative) lets it be
    // constrained to just the grid's own box instead, centered the same way
    // the grid itself is. Height still matches content-wrap's full height -
    // only width is ever over-reserved here.
    dragOverlayEl.style.position = 'absolute';
    dragOverlayEl.style.inset = '';
    dragOverlayEl.style.top = '0';
    dragOverlayEl.style.left = '50%';
    dragOverlayEl.style.transform = 'translateX(-50%)';
    dragOverlayEl.style.width = `${gridWidth}px`;
    dragOverlayEl.style.height = '100%';
  } else {
    currentOriginX = 0;
    // List mode's width is an explicit setting, not something dragged or
    // derived - content-wrap is pinned to exactly that value, and height
    // stays content-driven so however many rows are currently visible
    // always fit without needing a manual resize. No reserved-margin
    // concept here at all, so the drag-overlay covering content-wrap's full
    // bounds (the CSS default - position:fixed, inset:0) is already correct
    // and needs no per-mode override, unlike icon mode above.
    listEl.style.maxWidth = '';
    listEl.style.margin = '';
    listEl.style.justifyContent = '';
    // Icon mode sets an explicit pixel width above (see its comment) that
    // an explicit width always overrides the default stretch-to-fill
    // sizing list mode depends on - without resetting it here, a widget
    // that was ever in icon mode even once carries that stale width into
    // list mode forever after, silently clipping every row to whatever the
    // icon grid happened to measure instead of the real "List width"
    // setting.
    listEl.style.width = '';
    contentWrap.style.width = `${config.listWidth || 220}px`;
    dragOverlayEl.style.position = '';
    dragOverlayEl.style.inset = '';
    dragOverlayEl.style.top = '';
    dragOverlayEl.style.left = '';
    dragOverlayEl.style.transform = '';
    dragOverlayEl.style.width = '';
    dragOverlayEl.style.height = '';
  }

  // A config change (display mode, buff filter, icons-per-row, etc.)
  // always forces a full rebuild, since the DOM shape - or which buffs
  // even belong on this widget - may need to change even if the same
  // buffs are still active. Re-fetches active buffs fresh rather than
  // trusting the last cached buffsChanged snapshot, so a config change
  // always reflects current reality (a picked buff, an edited icon)
  // immediately instead of waiting on the next tick.
  tileRefs.clear();
  Promise.all([
    window.eqOverlay.getActiveBuffs(),
    window.eqOverlay.getActiveAllyBuffs(),
    window.eqOverlay.getActiveCustomTimers(),
  ]).then(([selfBuffs, allyBuffs, customTimers]) => {
    lastSelfBuffs = selfBuffs;
    lastAllyBuffs = allyBuffs;
    lastCustomTimers = customTimers;
    render(currentSourceBuffs());
  });
}

window.eqOverlay.getActiveBuffs().then((buffs) => {
  lastSelfBuffs = buffs;
  render(currentSourceBuffs());
});
window.eqOverlay.onActiveBuffsChanged((buffs) => {
  lastSelfBuffs = buffs;
  render(currentSourceBuffs());
});
window.eqOverlay.getActiveAllyBuffs().then((buffs) => {
  lastAllyBuffs = buffs;
  render(currentSourceBuffs());
});
window.eqOverlay.onActiveAllyBuffsChanged((buffs) => {
  lastAllyBuffs = buffs;
  render(currentSourceBuffs());
});
window.eqOverlay.getActiveCustomTimers().then((timers) => {
  lastCustomTimers = timers;
  render(currentSourceBuffs());
});
window.eqOverlay.onActiveCustomTimersChanged((timers) => {
  lastCustomTimers = timers;
  render(currentSourceBuffs());
});

window.eqOverlay.getLockState(widgetId).then(applyLockState);
window.eqOverlay.onLockChanged(applyLockState);

window.eqOverlay.getConfig(widgetId).then(applyConfig);
window.eqOverlay.onConfigChanged(applyConfig);
