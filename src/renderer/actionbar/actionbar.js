const barId = new URLSearchParams(window.location.search).get('barId');
const barEl = document.getElementById('bar');
let slotEls = []; // [{ slot, img, secondImg, cooldownOverlay, cooldownNumber, nameLabel }] - rebuilt whenever slotCount changes
let iconSet = '';
let currentSlots = []; // config.slots
let currentConfig = null;
let activeTimersBySlotKey = new Map(); // 'actionBarSlot:<barId>:<i>' -> the live entry from customTimerEngine.getActive()
let abilityGroupStateBySlot = new Map(); // slot index (this bar only) -> the live entry from abilityGroups.js
const WRAP_MAX_LINES = 2; // same cap the widget overlay's own label wrap uses (overlay.js)

// slotCount (1-12, see actionBarStore.js) active slots - iconsPerRow only decides how many of
// them fit on one line before the rest wrap onto the next, via #bar's flex-wrap plus the window
// itself being sized to exactly one row's width (see actionBarManager.js's computeSize).
function ensureSlots(total) {
  if (slotEls.length === total) return;
  barEl.innerHTML = '';
  slotEls = [];
  for (let i = 0; i < total; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const img = document.createElement('img');
    img.className = 'slot-icon';
    img.alt = '';
    img.style.display = 'none';
    // Second half of a diagonally-split gem (see render's own comment) - a separate stacked
    // image, not a background-image swap, so both halves can be plain eqicon:// art.
    const secondImg = document.createElement('img');
    secondImg.className = 'slot-icon slot-icon-second';
    secondImg.alt = '';
    secondImg.style.display = 'none';
    const cooldownOverlay = document.createElement('div');
    cooldownOverlay.className = 'slot-cooldown-overlay';
    cooldownOverlay.style.display = 'none';
    const cooldownNumber = document.createElement('span');
    cooldownNumber.className = 'slot-cooldown-number';
    cooldownNumber.style.display = 'none';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'slot-name-label';
    nameLabel.style.display = 'none';
    // The stance/invocation "active" overlay - a second, independent outline layered on top of
    // the ordinary configurable border, not a replacement for it. See abilityGroups.js.
    const activeBorder = document.createElement('div');
    activeBorder.className = 'slot-active-border';
    activeBorder.style.display = 'none';
    // The per-gem border (see actionBarStore.js's borderEnabled/borderWidthPx/borderOffsetPx/
    // borderColor) - its own element, not a second outline on .slot itself, so it can be layered
    // ON TOP of the bar-wide outline (drawn on .slot) rather than replacing it.
    const customBorder = document.createElement('div');
    customBorder.className = 'slot-custom-border';
    customBorder.style.display = 'none';
    slot.appendChild(img);
    slot.appendChild(secondImg);
    slot.appendChild(cooldownOverlay);
    slot.appendChild(cooldownNumber);
    slot.appendChild(nameLabel);
    slot.appendChild(customBorder);
    slot.appendChild(activeBorder);
    barEl.appendChild(slot);
    slotEls.push({ slot, img, secondImg, cooldownOverlay, cooldownNumber, nameLabel, customBorder, activeBorder });
  }
}

function formatSeconds(sec) {
  const s = Math.max(0, Math.ceil(sec));
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return String(s);
}

// Same positioning/sizing/color/wrap treatment overlay.js's applyTilePositionedTextStyle gives
// every widget's icon label - reused here (adapted, no low-time-warning color override, which
// doesn't apply to a gem) for BOTH of a gem's text fields, the name label and the cooldown
// countdown number, each with its own independent set of these same options (anchor - one of nine
// positions, size, color, wrap-to-fit vs spill-past-the-tile). Requested directly: "make the
// cooldown, and the label, two separate text fields, all the same options + anchoring."
function applyPositionedTextStyle(el, anchor, textSize, wrap, color, iconSize) {
  const [vertical, horizontal] = (anchor || 'bottom-center').split('-');
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
  el.style.color = color || '#f0f1f5';
  el.style.textShadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
  el.style.lineHeight = 'normal';

  if (wrap) {
    el.style.whiteSpace = 'normal';
    el.style.wordBreak = 'break-word';
    el.style.width = `${Math.max(0, iconSize - 4)}px`;
    el.style.overflow = 'hidden';
    el.style.display = '-webkit-box';
    el.style.webkitBoxOrient = 'vertical';
    el.style.webkitLineClamp = String(WRAP_MAX_LINES);
  } else {
    el.style.whiteSpace = 'nowrap';
    el.style.wordBreak = '';
    el.style.width = '';
    el.style.overflow = 'visible';
    el.style.display = '';
    el.style.webkitBoxOrient = '';
    el.style.webkitLineClamp = '';
  }
}

// Draws whichever cooldown style the whole bar is set to (see actionBarStore.js's cooldownStyle -
// one setting for every gem, not per-gem), driven by the live remaining time from
// customTimerEngine - the same engine every widget's custom timers already run through (see
// actionBarManager.getPseudoWidgets). Called on every config push AND every active-timers tick
// (every second), since either can change what a slot should show.
//
// Whether the 'number' style's countdown hides the name label while running is its own toggle
// (cooldownReplacesLabel) now that the two are independently positioned/sized/coloured - they
// might share a spot (replace makes sense) or sit in different corners (both can coexist).
function updateCooldownVisuals() {
  // Independent of each other now, not a 3-way radio - requested directly: "wipe and cooldown
  // number should be separate things." cooldownStyle is now shade-only ('none'|'wipe'|'radial');
  // cooldownShowNumber is its own toggle, so any combination (shade alone, number alone, both,
  // neither) is possible. See actionBarStore.js's own comment for the old-data migration.
  const shadeStyle = currentConfig?.cooldownStyle || 'wipe';
  const showNumber = !!currentConfig?.cooldownShowNumber;
  const replacesLabel = currentConfig?.cooldownReplacesLabel !== false;
  slotEls.forEach(({ img, secondImg, cooldownOverlay, cooldownNumber, nameLabel }, i) => {
    const slotCfg = currentSlots[i];
    // A stance/invocation gem has no manually-configured `cooldown` trigger at all - see
    // abilityGroups.js - so its cooldown display comes from the OTHER feed (applyAbilityGroupState)
    // instead of the ordinary customTimers one. The two are mutually exclusive by construction
    // (setSlotToggleGroup clears the manual cooldown's relevance), so preferring whichever one
    // actually has live data for this slot is enough - no priority conflict in practice.
    const timer = slotCfg?.toggleGroup
      ? abilityGroupStateBySlot.get(i)
      : activeTimersBySlotKey.get(`actionBarSlot:${barId}:${i}`);
    const cooling = (slotCfg?.cooldown || slotCfg?.toggleGroup) && timer && timer.durationSec > 0;
    const showingNumber = cooling && showNumber;

    nameLabel.style.display = showingNumber && replacesLabel ? 'none' : slotCfg?.name ? '' : 'none';
    // Requested directly: "grey out anything on cooldown" - a plain CSS filter on the icon
    // image(s) themselves, independent of whichever shade/number combination is also showing.
    const grayscale = cooling ? 'grayscale(1)' : '';
    img.style.filter = grayscale;
    secondImg.style.filter = grayscale;

    if (!cooling) {
      cooldownOverlay.style.display = 'none';
      cooldownNumber.style.display = 'none';
      return;
    }
    const frac = Math.max(0, Math.min(1, timer.remainingSec / timer.durationSec));

    if (showNumber) {
      cooldownNumber.style.display = '';
      cooldownNumber.textContent = formatSeconds(timer.remainingSec);
      applyPositionedTextStyle(
        cooldownNumber,
        currentConfig?.cooldownTextAnchor,
        currentConfig?.cooldownTextSize || 13,
        !!currentConfig?.cooldownTextWrap,
        currentConfig?.cooldownTextColor,
        currentConfig?.iconSize
      );
    } else {
      cooldownNumber.style.display = 'none';
    }

    if (shadeStyle === 'radial') {
      cooldownOverlay.style.display = '';
      cooldownOverlay.style.clipPath = 'none';
      cooldownOverlay.style.background = `conic-gradient(rgba(0, 0, 0, 0.75) ${frac * 360}deg, transparent 0)`;
    } else if (shadeStyle === 'wipe') {
      // A solid shade that recedes from the top down as the cooldown counts down, via clip-path
      // clipping away a growing top portion of the (otherwise full-box) overlay, leaving a
      // shrinking bar pinned to the bottom.
      cooldownOverlay.style.display = '';
      cooldownOverlay.style.background = 'rgba(0, 0, 0, 0.75)';
      cooldownOverlay.style.clipPath = `inset(${(1 - frac) * 100}% 0 0 0)`;
    } else {
      cooldownOverlay.style.display = 'none';
    }
  });
}

function render(config) {
  currentConfig = config;
  document.documentElement.style.setProperty('--margin', `${config.marginPx}px`);
  document.documentElement.style.setProperty('--icon-size', `${config.iconSize}px`);
  ensureSlots(config.slotCount || config.totalSlots || 12);

  // The border is a CSS outline, not a plain border - outline-offset accepts negative values,
  // which is what lets it sit INSET from the tile's true edge rather than exactly on it (a plain
  // border has no such offset concept). Bar-wide, same as cooldownStyle/nameLabel* - one look for
  // every gem.
  const borderWidth = config.borderWidthPx || 2;
  const borderOffset = config.borderOffsetPx ?? 1;
  const borderColor = config.borderColor || '#d2d6e1';

  currentSlots = config.slots || [];
  slotEls.forEach(({ slot, img, secondImg, nameLabel, cooldownOverlay, customBorder }, i) => {
    const s = currentSlots[i] || {};
    // Forces the WHOLE box invisible - icon, border and background together, not just the icon -
    // since opacity applies to the .slot element itself, which is what draws the border/background
    // (see actionbar.css). Requested directly: "this should also 0 opacity the border of that gem".
    slot.style.opacity = s.disabled ? '0' : '1';
    slot.style.outline = `${borderWidth}px solid ${borderColor}`;
    slot.style.outlineOffset = `-${borderOffset}px`;

    // Per-gem border - drawn on its own child layer, on top of the bar-wide outline above, not
    // tied to whether the gem has an icon. An inset box-shadow rather than a second outline -
    // reported live: raising the BAR-WIDE offset made an already-visible custom border vanish,
    // because two outlines in the same stacking context (one on .slot itself, one on this child)
    // don't reliably respect normal parent/child paint order in Chromium - an outline can paint
    // as a final decoration pass regardless of a descendant's z-index. A box-shadow is ordinary
    // child content, painted above the parent's own outline exactly like any other child, so this
    // sidesteps the ambiguity instead of depending on it. inset (not outline-offset) pulls the
    // ring inward the same way.
    if (s.borderEnabled) {
      customBorder.style.display = '';
      customBorder.style.inset = `${s.borderOffsetPx ?? 1}px`;
      customBorder.style.boxShadow = `inset 0 0 0 ${s.borderWidthPx || 2}px ${s.borderColor || '#d2d6e1'}`;
    } else {
      customBorder.style.display = 'none';
      customBorder.style.boxShadow = 'none';
    }

    // Per-gem, not bar-wide - see actionBarStore.js's insetPx comment. Applied to the cooldown
    // overlay too, so a wipe/pie darkens exactly the visible (shrunk) icon rather than a
    // mismatched full-tile box around it.
    //
    // img/secondImg are <img> elements, not plain <div>s - a REPLACED element sized only by
    // `inset` (no explicit width/height) keeps its own intrinsic size and just gets shifted to
    // center within the inset box, it does not shrink to fit it. That's a real CSS rule, not a
    // rendering quirk, and it's exactly what "just shifts the icon, doesn't shrink it" was:
    // `inset: Npx` alone shrinks a plain div (cooldownOverlay below) correctly, but silently only
    // repositions an <img>. Setting width/height explicitly (calc, not auto) is what forces the
    // actual shrink for the two image elements specifically.
    const insetPx = s.insetPx || 0;
    img.style.top = `${insetPx}px`;
    img.style.left = `${insetPx}px`;
    img.style.width = `calc(100% - ${insetPx * 2}px)`;
    img.style.height = `calc(100% - ${insetPx * 2}px)`;
    secondImg.style.top = `${insetPx}px`;
    secondImg.style.left = `${insetPx}px`;
    secondImg.style.width = `calc(100% - ${insetPx * 2}px)`;
    secondImg.style.height = `calc(100% - ${insetPx * 2}px)`;
    cooldownOverlay.style.inset = `${insetPx}px`;

    // Multi icon: two images stacked in the same tile, each clipped to a diagonal triangle - the
    // primary icon top-left, the second bottom-right. Only actually splits once BOTH halves have
    // an icon picked; with just the primary set, it draws exactly like a normal single-icon gem.
    const splitting = s.multiIcon && s.iconId != null && s.secondIconId != null;
    img.style.clipPath = splitting ? 'polygon(0 0, 100% 0, 0 100%)' : 'none';

    if (s.iconId == null || !iconSet) {
      img.style.display = 'none';
      // A stand-in for the icon, not a tint - only meaningful while there is no icon to cover it
      // anyway. Empty string/null reverts to the CSS default (the dark calibration-box look);
      // the literal string 'transparent' is its own explicit choice, distinct from "unset" -
      // requested directly, since "unset" still shows the dark calibration tint, not a truly
      // see-through gem. Any other string is a real CSS colour picked from the colour input.
      slot.style.backgroundColor = s.bgColor || '';
    } else {
      img.src = `eqicon://icon/${encodeURIComponent(iconSet)}/${s.iconId}`;
      img.style.display = '';
      // With an icon showing AND an inset in use, the tile's own dark semi-transparent CSS
      // default background would sit right in the ring the inset exists to reveal, dimming
      // exactly the game art it was meant to show through. Reported directly: "the option also
      // doesn't make it fully transparent, it reveals a grey semi transparent background... when
      // an icon is active the background needs removal also for only that gem slot." Cleared only
      // while both are true - insetPx:0 (the common case) is untouched, same as before.
      slot.style.backgroundColor = insetPx > 0 ? 'transparent' : '';
    }

    if (splitting && iconSet) {
      secondImg.src = `eqicon://icon/${encodeURIComponent(iconSet)}/${s.secondIconId}`;
      secondImg.style.display = '';
      secondImg.style.clipPath = 'polygon(100% 0, 100% 100%, 0 100%)';
    } else {
      secondImg.style.display = 'none';
    }

    if (s.name) {
      nameLabel.textContent = s.name;
      nameLabel.style.display = '';
      applyPositionedTextStyle(
        nameLabel,
        config.nameLabelAnchor,
        s.nameSizeOverride ?? config.nameLabelSize ?? 11,
        config.nameLabelWrap !== false,
        config.nameLabelColor,
        config.iconSize
      );
    } else {
      nameLabel.style.display = 'none';
    }
  });
  updateCooldownVisuals();
  updateActiveBorders();
}

// The active-timers broadcast is global (every bar's pseudo-widgets ride the same channel - see
// actionBarManager.getPseudoWidgets), so this renderer only picks out entries keyed for ITS OWN
// bar, ignoring every other bar's.
const slotKeyPrefix = `actionBarSlot:${barId}:`;
function applyActiveTimers(list) {
  activeTimersBySlotKey = new Map();
  for (const t of list || []) {
    if (typeof t.id === 'string' && t.id.startsWith(slotKeyPrefix)) activeTimersBySlotKey.set(t.id, t);
  }
  updateCooldownVisuals();
}

// Same shape as applyActiveTimers just above - a global broadcast (every bar's stances/
// invocations ride the same channel, see abilityGroups.js), filtered down to this bar's own slots.
function applyAbilityGroupState(list) {
  abilityGroupStateBySlot = new Map();
  for (const entry of list || []) {
    if (entry.barId === barId) abilityGroupStateBySlot.set(entry.index, entry);
  }
  updateCooldownVisuals();
  updateActiveBorders();
}

// The green border is independent of cooldownStyle (wipe/number/radial) - it always draws the
// same way regardless of which cooldown display the bar is set to, since it's a distinct signal
// ("this is the one that's active") layered on top rather than one of the interchangeable styles.
function updateActiveBorders() {
  slotEls.forEach(({ activeBorder }, i) => {
    const entry = abilityGroupStateBySlot.get(i);
    activeBorder.style.display = entry && entry.isActive ? '' : 'none';
  });
}

async function boot() {
  iconSet = (await window.eqActionBar.getIconSet()) || '';
  const config = await window.eqActionBar.getConfig(barId);
  render(config);
  window.eqActionBar.onConfigChanged(render);

  applyActiveTimers(await window.eqActionBar.getActiveCustomTimers());
  window.eqActionBar.onActiveCustomTimersChanged(applyActiveTimers);

  applyAbilityGroupState(await window.eqActionBar.getAbilityGroupState());
  window.eqActionBar.onAbilityGroupStateChanged(applyAbilityGroupState);

  const locked = await window.eqActionBar.getLockState(barId);
  document.body.classList.toggle('unlocked', !locked);
  window.eqActionBar.onLockChanged((isLocked) => {
    document.body.classList.toggle('unlocked', !isLocked);
  });
}

boot();
