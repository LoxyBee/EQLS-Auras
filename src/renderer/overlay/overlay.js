const widgetId = new URLSearchParams(window.location.search).get('widgetId');

const listEl = document.getElementById('buff-list');
const contentWrap = document.getElementById('content-wrap');
const dragOverlayEl = document.getElementById('drag-overlay');
const dragNameEl = document.getElementById('drag-name');

// Note 6. Only reachable while unlocked, since the whole box is hidden otherwise.
dragNameEl.addEventListener('click', () => window.eqOverlay.openSettings(widgetId));

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
  landSoundId: null,
  expireSoundId: null,
  warningSoundId: null,
  alertVolume: 100,
  showRowIcon: false,
  mirrorRowDirection: false,
  showIconLabel: false,
  iconLabelSize: 11,
  iconLabelAnchor: 'top-center',
  wrapText: false,
  iconJustify: 'left',
  groupAllyBuffs: false,
  groupAllyDirection: 'vertical',
  hideAllyNameOnTile: false,
  timerTextColor: '#f0f1f5',
  labelTextColor: '#f0f1f5',
  iconMarginPx: 5,
};

// Short synthesized tones instead of bundled audio files - no assets to
// ship/license, and it's enough to be a distinct audible cue for land vs
// expire vs the pre-expiry warning. Lazily created since Chromium won't
// let an AudioContext start running before some user/window activity
// anyway, so there's nothing to gain by constructing it up front.
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // An overlay window is click-through and never focused, so it can never receive the user
  // gesture a suspended context waits for - if one ever suspends here, nothing would ever wake
  // it and the aura would go permanently, silently deaf. Electron's own default
  // (autoplayPolicy: 'no-user-gesture-required', electron.d.ts) means this should not happen at
  // all; the two lines are insurance, and they mirror what the settings window already does.
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// Whether this aura is switched ON for the current loadout profile. Pushed from the main
// process; see widgetManager.shouldBeAudible for why it is a separate question from whether the
// window is on screen. Starts true because a window only ever exists for an aura that was
// on-profile when it was created, and the real value is fetched as this script boots.
let audible = true;

function beep(freq, startDelayMs, durationMs) {
  const ctx = getAudioCtx();
  const startAt = ctx.currentTime + startDelayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const volumeFraction = (currentConfig.alertVolume ?? 100) / 100;
  const peakGain = Math.max(0.0001, 0.22 * volumeFraction);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationMs / 1000 + 0.02);
}

// Reused per kind rather than a fresh Audio() per play - re-triggered via
// currentTime=0 + play() again, which handles rapid re-fires (e.g. a short
// loop interval) fine for these short alert clips. Keyed by soundId too,
// not just kind, so switching which file a slot uses (in the widget's own
// settings) doesn't keep playing the OLD file from a stale element.
const customAudioEls = { land: null, expire: null, warning: null };
function playCustomSound(kind, soundId) {
  let audio = customAudioEls[kind];
  if (!audio || audio.dataset.soundId !== soundId) {
    audio = new Audio(`eqsound://sound/${soundId}`);
    audio.dataset.soundId = soundId;
    customAudioEls[kind] = audio;
  }
  audio.currentTime = 0;
  audio.volume = (currentConfig.alertVolume ?? 100) / 100;
  // Best-effort - a rejected play() (e.g. the file went missing from
  // customSounds/ since it was picked) shouldn't become an uncaught error,
  // just silently produce no sound that one time.
  audio.play().catch(() => {});
}

// One alert per render tick even if several buffs changed at once (e.g. a
// multi-buff burst cast landing together) - a chime per buff would be a
// wall of overlapping beeps instead of a useful cue.
function playAlertSound(kind) {
  // Profile membership is the app's on/off switch, and OFF has to mean silent as well as
  // invisible. Hiding the window does not stop this function being called - the engine keeps
  // broadcasting and render() keeps running behind a hidden window - so the check has to be
  // here, at the last point before a noise is actually made.
  if (!audible) return;
  const soundId = currentConfig[`${kind}SoundId`];
  if (soundId) {
    playCustomSound(kind, soundId);
    return;
  }
  if (kind === 'land') beep(880, 0, 110);
  else if (kind === 'expire') {
    beep(440, 0, 90);
    beep(300, 90, 130);
  } else if (kind === 'warning') beep(660, 0, 90);
}

// Identity key for every Set/Map that tracks a buff instance across
// renders (tileRefs, landedNames, shownNames, warnedAt,
// lastRemainingSec) - plain buff name for self buffs (unchanged from
// before ally-buff tracking existed), name+ally for ally buffs, since the
// same buff name can be active on several different allies at once, and
// each instance needs its own independent identity/timer/glow state. Custom
// timers carry their own definition id (see customTimerEngine.js) and use
// that instead of name - two definitions are allowed to share a display
// name (e.g. same trigger text, different icons, meant to both show at
// once), and a name-only key would collapse them into a single tile.
function keyFor(buff) {
  // Checked FIRST. A merged tile is built by spreading its lead member, so it still carries that
  // member's allyName and id - fall through to either of those and two different merged groups
  // on the same ally would collide, or a merged custom timer would take its lead's identity.
  if (buff.mergedKey) return buff.mergedKey;
  if (buff.allyName) return `${buff.allyName.toLowerCase()}::${buff.name.toLowerCase()}`;
  if (buff.id) return `id::${buff.id}`;
  return buff.name.toLowerCase();
}

function checkSoundWarnings(visible) {
  const thresholdSec = currentConfig.soundWarningSec || 0;

  // Changing a setting must not make a noise. Toggling merging on, or switching the app-wide
  // merge rule, re-identifies every tile - and a tile already inside the warning window with no
  // record against its new identity would warn again for something the user has already been
  // told about. Instead, the first pass after a config change quietly RECORDS what is already in
  // the window and plays nothing. Same reasoning as hasRenderedBefore in render(): the state
  // existed before this arrangement did, so it is not news.
  if (warningsSuppressedOnce) {
    warningsSuppressedOnce = false;
    if (thresholdSec > 0) {
      const now = Date.now();
      for (const buff of visible) {
        if (buff.remainingSec <= thresholdSec) warnedAt.set(keyFor(buff), now);
      }
    }
    return;
  }

  if (thresholdSec <= 0) return;
  // 0 = warn once only (the original behavior) - a real loop interval
  // re-fires every N seconds for as long as the buff stays under
  // thresholdSec, until warnedAt gets cleared by a real expiry or renewal
  // (see justExpiredRaw/soundLandedRaw in render() below).
  const loopSec = currentConfig.soundWarningLoopSec || 0;
  const now = Date.now();
  for (const buff of visible) {
    const key = keyFor(buff);
    if (buff.remainingSec > thresholdSec) {
      // Back above the threshold means whatever this tile is counting down was renewed or
      // replaced, so the fact that it was warned about no longer applies - it must be able to
      // warn again on the way down.
      //
      // For an ordinary buff this is belt and braces: render() already clears the entry on
      // expiry and on renewal, and remaining never rises otherwise. For a MERGED tile it is the
      // only thing that works. Both of render()'s pruning loops iterate raw engine keys, and a
      // merged tile's key is deliberately one no raw buff ever carries, so nothing there could
      // ever clear it - a merged tile warned once and then stayed silent for the rest of the
      // session.
      warnedAt.delete(key);
      continue;
    }
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
//
// The name prefix is dropped when the tile already sits under a heading
// naming that ally (grouping on), or when the user has turned it off
// outright - repeating "Avenrae:" on every tile in Avenrae's own group is
// just noise eating tile width.
function displayName(buff) {
  if (!buff.allyName) return buff.name;
  if (currentConfig.hideAllyNameOnTile || currentConfig.groupAllyBuffs) return buff.name;
  return `${buff.allyName}: ${buff.name}`;
}

// Ally buffs split by whose they are, each group under its own heading.
//
// Groups are ordered alphabetically by name, NOT by whose buff happened to
// land first. Alphabetical is stable: a person's section stays in the same
// place all session, so you learn where to look instead of re-reading the
// headings every time something is recast. First-appearance order would
// reshuffle whenever someone's last buff dropped and came back.
//
// Buffs WITHIN each group keep the aura's own sort order (cast order, time
// remaining, alphabetical - whatever the user picked), which is applied
// upstream in visibleBuffs.
function groupByAlly(buffs) {
  const groups = new Map();
  for (const buff of buffs) {
    const key = buff.allyName || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(buff);
  }
  return [...groups.entries()]
    .map(([allyName, list]) => ({ allyName, buffs: list }))
    .sort((a, b) => a.allyName.localeCompare(b.allyName));
}

// Grouping only makes sense when tiles actually carry an ally name - a self
// or custom-timer aura would produce one nameless group, which is just the
// flat list with a blank heading over it.
function shouldGroupByAlly(visible) {
  return !!currentConfig.groupAllyBuffs && visible.some((b) => b.allyName);
}

// Note 8's count, and deliberately ONE builder rather than two. Note 12 wants the identical badge
// on a different kind of merged tile, and two copies of a thing described as "the same badge" is
// how they end up not being the same badge.
function buildCountBadge(count) {
  const badge = document.createElement('span');
  badge.className = 'count-badge';
  badge.textContent = `\u00d7${count}`;
  badge.title = `${count} buffs merged into this one`;
  return badge;
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
  // Between the name and the time, so the countdown stays where the eye already looks for it.
  if (buff.mergedCount > 1) content.insertBefore(buildCountBadge(buff.mergedCount), time);

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
  // Appended after the icon so it draws over it - .buff-tile is position:relative and the badge
  // is absolutely placed in its corner.
  if (buff.mergedCount > 1) root.appendChild(buildCountBadge(buff.mergedCount));

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
function applyTilePositionedTextStyle(el, low, anchor, textSize, wrap, color) {
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
  // The low-time warning colour deliberately overrides any custom colour -
  // "this is about to run out" is the one meaning that must never be themed
  // away (same reasoning as --danger being reserved in the main window).
  el.style.color = low ? '#ff8080' : color || '#f0f1f5';
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
    applyTilePositionedTextStyle(ref.timeEl, low, currentConfig.contentAnchor || 'bottom-center', currentConfig.textSize || 10, false, currentConfig.timerTextColor);
    if (ref.labelEl) {
      applyTilePositionedTextStyle(
        ref.labelEl,
        low,
        currentConfig.iconLabelAnchor || 'top-center',
        currentConfig.iconLabelSize || 11,
        !!currentConfig.wrapText,
        currentConfig.labelTextColor
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

// ---------------------------------------------------------------------------------------------
// Note 8 - merged tiles.
//
// Buffs sharing a duration collapse into ONE tile showing the lowest remaining time, whose buffs
// they are, and a count of how many are behind it. A Quick Buff set on a full group is about
// fourteen tiles per ally otherwise.
//
// WHAT counts as "the same" is an app-wide setting (see mergeRule in main.js), because both
// readings are defensible and the owner asked to be able to try each:
//   'duration' - same total duration, full stop.
//   'burst'    - same total duration AND landed together.
//
// "Landed together" needs no landing timestamp, which is fortunate because the overlay is never
// sent one. Two buffs of the same duration cast in the same burst have, by definition, the same
// time remaining - so a tolerance on remainingSec is the same test. Three seconds absorbs the
// rounding without merging things cast a pull apart.
const BURST_TOLERANCE_SEC = 3;

let mergeRule = 'duration';

// The merged tile's identity, and it has to be STABLE across renders: warnedAt and tileRefs are
// both keyed by it, so an identity that churned would rebuild the tile constantly and re-fire the
// pre-expiry warning.
//
// Built from the BUCKET the group belongs to - who it is on, and how long these buffs last -
// rather than from the members themselves. An earlier version used the alphabetically-first
// member key, which was stable against time passing but NOT against membership: casting one more
// buff of the same length re-sorted the members, changed the anchor, and made an already-warned
// group look brand new, so it beeped again. A bucket cannot be changed by anything joining or
// leaving it.
//
// burstIndex distinguishes two bursts that share a bucket, which only the 'burst' rule can
// produce - under 'duration' it is always 0 and the identity is completely fixed for as long as
// the group exists. Under 'burst' it renumbers if an entire earlier burst ends, which is the one
// remaining way this can move.
function mergedKeyFor(bucket, burstIndex) {
  return `merged::${bucket}::${burstIndex}`;
}

// Splits one same-duration bucket into bursts. Greedy against the group's own first member
// rather than its neighbour, so a long chain of buffs one second apart cannot drift arbitrarily
// far from where it started and end up as a single group spanning a minute.
//
// KNOWN LIMIT, recorded rather than claimed away. remainingSec is not a stable quantity: the
// engine computes it as Math.round((expiresAt - now) / 1000) at whatever instant it happens to
// broadcast, and it broadcasts on every landing and expiry as well as on the second. So for two
// buffs cast about BURST_TOLERANCE_SEC apart, the rounded gap can read as 3 at one sample and 4
// at the next, and the pair merges and unmerges as unrelated buffs come and go. Only pairs within
// about half a second of the boundary are affected, and the visible effect is one tile briefly
// becoming two and rejoining. Fixing it properly needs either the absolute expiry time in the
// overlay payload or a memory of the previous grouping, and neither is worth carrying for this.
function splitIntoBursts(members) {
  if (mergeRule !== 'burst') return [members];
  const sorted = [...members].sort((a, b) => b.remainingSec - a.remainingSec);
  const bursts = [];
  for (const buff of sorted) {
    const current = bursts[bursts.length - 1];
    if (current && current[0].remainingSec - buff.remainingSec <= BURST_TOLERANCE_SEC) current.push(buff);
    else bursts.push([buff]);
  }
  return bursts;
}

function mergeByDuration(buffs) {
  // Bucketed per recipient as well as per duration. The tile says whose buffs these are, and one
  // covering two different people could not - which is also why a merged tile keeps its lead
  // member's allyName rather than inventing a combined label.
  const buckets = new Map();
  for (const buff of buffs) {
    const bucket = `${(buff.allyName || '').toLowerCase()}::${buff.durationSec}`;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(buff);
  }

  const out = [];
  for (const [bucket, members] of buckets) {
    splitIntoBursts(members).forEach((group, burstIndex) => {
      if (group.length < 2) {
        // A group of one is left completely untouched - no merged key, no badge, no difference
        // from an aura with merging switched off. Worth being deliberate about: it is what makes
        // turning the toggle on harmless for an aura that never has anything to merge.
        out.push(group[0]);
        return;
      }
      // The lead is the one about to expire, because that is the timer the tile shows - so the
      // tile also names it and wears its icon. Naming any other member would put a countdown and
      // a name on screen that describe different buffs.
      //
      // The lead can CHANGE without the group changing: recast the buff that was about to run
      // out and it goes to the back of the queue. render() has to notice, which is why the lead's
      // name is part of the structural signature - see mergeKey there.
      const lead = group.reduce((a, b) => (b.remainingSec < a.remainingSec ? b : a));
      out.push({
        ...lead,
        mergedCount: group.length,
        mergedKeys: group.map(keyFor),
        mergedKey: mergedKeyFor(bucket, burstIndex),
      });
    });
  }
  return out;
}

/** The raw buff keys a tile stands for - itself, unless it is a merged one. */
function memberKeys(buff) {
  return buff.mergedKeys || [keyFor(buff)];
}

/** Whether any raw buff behind this tile is in the given set of raw keys. */
function anyMemberIn(buff, set) {
  return memberKeys(buff).some((key) => set.has(key));
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
  // Merged AFTER filtering and BEFORE sorting. After filtering, or an excluded buff would still
  // be counted in a badge; before sorting, so the merged tile takes its place in the order by the
  // remaining time it actually shows rather than by whichever member happened to be first.
  if (currentConfig.mergeSameDuration) filtered = mergeByDuration(filtered);
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

// Set by applyConfig, honoured once by checkSoundWarnings - see the note there. A settings change
// re-identifies tiles, and re-identifying something is not a reason to beep about it.
let warningsSuppressedOnce = false;

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
  // NOT the same set as visibleKeys once merging is on, and the difference matters. The landing
  // glow and the alert sounds are worked out from RAW buff keys; a merged tile has a key of its
  // own that no raw buff ever carries, so matching against tile keys would leave a merged aura
  // never glowing and never beeping. This set names the raw buffs currently on screen.
  const visibleSet = new Set(visible.flatMap(memberKeys));

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

  // A sound-only aura stops here, and WHERE this line sits is the whole design.
  //
  // Everything above it is the alert pipeline: which buffs count as visible for this aura,
  // first-landing vs renewal detection, the land and expire sounds, the warning threshold and
  // its repeat loop. All of it still runs, unchanged, because sound is the entire point of the
  // mode. Everything below it is DOM building and window sizing, and a sound-only aura has
  // neither. That split is why this mode needed no second copy of the alert logic.
  //
  // The tiles are cleared rather than left alone: an aura switched to sound-only part-way
  // through a session still has its old tiles in listEl, and nothing further down would ever
  // remove them. dataset.mode is stamped so switching back to list or icons trips
  // structureChanged below and rebuilds from scratch.
  //
  // reportContentSize is deliberately never reached. The window keeps whatever size it last
  // had instead of being resized to fit content that is never drawn - it is transparent,
  // click-through and empty, so its size has no observable effect, and leaving it alone means
  // switching back out of sound-only restores the size the user had chosen.
  if (currentConfig.displayMode === 'sound-only') {
    if (listEl.children.length) {
      listEl.innerHTML = '';
      tileRefs.clear();
    }
    listEl.dataset.mode = 'sound-only';
    return;
  }

  // Compared against the DOM's actual current child count, not just
  // tileRefs.size - the two can be independently reset (applyConfig clears
  // tileRefs before this ever runs) in a way that made "0 visible now" and
  // "0 tracked already" compare as "unchanged" even though the DOM still
  // had a stale leftover tile nobody ever told to go away. Comparing
  // against reality directly can't drift out of sync like that.
  // Grouped rendering nests tiles inside per-ally containers, so listEl's own
  // children are groups rather than tiles and the plain count check below
  // can't see a change. A signature of the group layout (names + sizes +
  // direction) is compared instead - it changes exactly when the nesting
  // needs rebuilding, and stays stable while only timers tick.
  // Everything a merged tile draws ONCE, at build time: its badge count and its name. Both have
  // to be part of the structural signature or the tile keeps showing a stale one.
  //
  // The name is the subtle half. A merged tile is led by the member about to run out, and
  // recasting that member sends it to the back of the queue - so the lead changes while the group
  // does not. The count is unchanged, the identity is unchanged, so nothing else in the check
  // below moves, and render() takes the in-place path, which updates the countdown and the icon
  // but never the name. The tile then counts down one buff while naming another, which is worse
  // than showing no tile at all.
  //
  // Empty string for an unmerged tile, so an aura with merging off produces a constant signature
  // and behaves exactly as it did before any of this existed.
  const mergeKey = visible.map((b) => (b.mergedCount ? `${b.mergedCount}:${b.name}` : '')).join('|');

  const grouped = shouldGroupByAlly(visible);
  const groups = grouped ? groupByAlly(visible) : null;
  const groupKey = grouped
    ? `${currentConfig.groupAllyDirection || 'vertical'}|${groups.map((g) => `${g.allyName}:${g.buffs.length}`).join(',')}`
    : '';

  const structureChanged =
    listEl.dataset.mode !== modeKey ||
    listEl.dataset.groupKey !== groupKey ||
    listEl.dataset.mergeKey !== mergeKey ||
    (!grouped && listEl.children.length !== visibleKeys.length) ||
    visibleKeys.some((key) => !tileRefs.has(key));

  if (structureChanged) {
    listEl.innerHTML = '';
    tileRefs.clear();
    listEl.classList.toggle('icon-grid', isIcon && !grouped);
    listEl.classList.toggle('ally-grouped', grouped);
    listEl.classList.toggle('ally-grouped-horizontal', grouped && currentConfig.groupAllyDirection === 'horizontal');
    listEl.dataset.mode = modeKey;
    listEl.dataset.groupKey = groupKey;
    listEl.dataset.mergeKey = mergeKey;

    if (grouped) {
      for (const group of groups) {
        const section = document.createElement('div');
        section.className = 'ally-group';
        const heading = document.createElement('div');
        heading.className = 'ally-group-heading';
        heading.textContent = group.allyName;
        // Heading text tracks the label colour setting so a grouped aura
        // stays visually consistent with its own tiles.
        heading.style.color = currentConfig.labelTextColor || '#f0f1f5';
        heading.style.fontSize = `${Math.max(9, (currentConfig.textSize || 13) - 1)}px`;
        section.appendChild(heading);

        const body = document.createElement('div');
        body.className = 'ally-group-body' + (isIcon ? ' icon-grid' : '');
        for (const buff of group.buffs) {
          const ref = isIcon ? buildIconTile(buff) : buildListRow(buff);
          updateRef(ref, buff, isIcon);
          if (currentConfig.landingGlowEnabled !== false && anyMemberIn(buff, newlyLanded)) {
            ref.root.classList.add('just-landed');
            ref.root.addEventListener('animationend', () => ref.root.classList.remove('just-landed'), { once: true });
          }
          tileRefs.set(keyFor(buff), ref);
          body.appendChild(ref.root);
        }
        section.appendChild(body);
        listEl.appendChild(section);
      }
      reportSizeIfChanged();
      return;
    }

    for (const buff of visible) {
      const ref = isIcon ? buildIconTile(buff) : buildListRow(buff);
      updateRef(ref, buff, isIcon);
      // Only a genuinely new arrival gets the one-shot glow - a tile
      // recreated here because a *different* buff changed the visible set
      // (forcing this same full-rebuild path) must not replay it.
      if (currentConfig.landingGlowEnabled !== false && anyMemberIn(buff, newlyLanded)) {
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
    //
    // Grouped tiles are deliberately NOT re-appended: they live inside their
    // own per-ally container, and appending to listEl would rip every tile
    // out of its group and pile them flat at the top level - on every tick.
    // Any reordering that actually matters changes the group signature, which
    // takes the rebuild path above instead.
    for (const buff of visible) {
      const ref = tileRefs.get(keyFor(buff));
      updateRef(ref, buff, isIcon);
      if (!grouped) listEl.appendChild(ref.root);
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
  // Applied here rather than in render() so an aura switched to sound-only clears off the
  // screen immediately, instead of staying visible until the next buff tick happens to arrive -
  // which, on a quiet aura, could be a very long time.
  document.body.classList.toggle('sound-only', config.displayMode === 'sound-only');
  // Note 6 - the aura's own name in its move box, so a screen full of unlocked blue rectangles
  // says which is which. Set from applyConfig rather than once at boot because a rename arrives
  // as a config change, and the box would otherwise show the old name until the next restart.
  dragNameEl.textContent = config.name || '';
  document.documentElement.style.setProperty('--text-size', `${config.textSize || 13}px`);
  document.documentElement.style.setProperty('--icon-size', `${config.iconSize || 46}px`);
  document.documentElement.style.setProperty('--timer-text-color', config.timerTextColor || '#f0f1f5');
  document.documentElement.style.setProperty('--icon-gap', `${config.iconMarginPx ?? 5}px`);
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
  // See warningsSuppressedOnce. Changing a setting must not produce a sound.
  warningsSuppressedOnce = true;
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

window.eqOverlay.getMergeRule().then((rule) => {
  mergeRule = rule;
  render(currentSourceBuffs());
});
window.eqOverlay.onMergeRuleChanged((rule) => {
  mergeRule = rule;
  render(currentSourceBuffs());
});

window.eqOverlay.getAudible(widgetId).then((value) => {
  audible = value !== false;
});
window.eqOverlay.onAudibleChanged((value) => {
  audible = value !== false;
});

window.eqOverlay.getConfig(widgetId).then(applyConfig);
window.eqOverlay.onConfigChanged(applyConfig);
