const widgetId = new URLSearchParams(window.location.search).get('widgetId');

const listEl = document.getElementById('buff-list');
const contentWrap = document.getElementById('content-wrap');
const dragOverlayEl = document.getElementById('drag-overlay');
const dragNameEl = document.getElementById('drag-name');

// Note 6: the name is a plain label riding along with the rest of the drag box (it used to be its
// own no-drag button, which was "too small" a target). Right-clicking the box used to open the
// aura's settings, but that never worked reliably (freeze-bug history) and was removed 1 Sep at
// the owner's instruction - get to an aura's settings from the sidebar list.

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
  soundCooldownSec: 0,
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
  textJustify: 'left',
  stackTextLines: false,
  maxStackTextLines: 2,
  groupAllyBuffs: false,
  groupAllyDirection: 'vertical',
  hideAllyNameOnTile: false,
  showDebuffSongs: false,
  splitSongsByType: false,
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

// Reported live: a custom timer's land sound sometimes played twice for what was a single
// trigger, timing-dependent on exactly where the engine's 1-second tick happened to land relative
// to the log line. Rather than chase every possible source of a near-simultaneous double
// broadcast (this widget's own engine tick, another engine's independent unconditional tick, a
// config-change re-render - render() is called from a dozen separate listeners, see the block of
// onXChanged wiring near the bottom of this file), a floor on how close together two plays of the
// SAME kind can land is a direct, general guard against all of them at once. Per kind, not global
// - a land and an expire genuinely can (and should) both sound within the same second for an
// ordinary short timer, and this must never merge those into one.
const lastAlertPlayedAt = new Map(); // kind -> ms timestamp
const MIN_ALERT_INTERVAL_MS = 200;

// The user-set per-aura cooldown (soundCooldownSec, reported live 30 Aug) - the shortest gap
// between ANY two alert sounds from this aura, across all kinds. Distinct from MIN_ALERT_INTERVAL_MS
// above (a fixed per-kind anti-double-fire guard); this one is a deliberate throttle for an aura
// that refreshes constantly - a bard song pulsing every 6s set to sound only every 24, say. Shared
// across kinds on purpose: "I just heard this aura" is the thing being rate-limited.
let lastAnyAlertAt = 0;

// One alert per render tick even if several buffs changed at once (e.g. a
// multi-buff burst cast landing together) - a chime per buff would be a
// wall of overlapping beeps instead of a useful cue.
function playAlertSound(kind) {
  // Profile membership is the app's on/off switch, and OFF has to mean silent as well as
  // invisible. Hiding the window does not stop this function being called - the engine keeps
  // broadcasting and render() keeps running behind a hidden window - so the check has to be
  // here, at the last point before a noise is actually made.
  if (!audible) return;
  const now = Date.now();
  const lastPlayed = lastAlertPlayedAt.get(kind);
  if (lastPlayed !== undefined && now - lastPlayed < MIN_ALERT_INTERVAL_MS) return;
  const cooldownMs = (currentConfig.soundCooldownSec || 0) * 1000;
  if (cooldownMs > 0 && now - lastAnyAlertAt < cooldownMs) return;
  lastAlertPlayedAt.set(kind, now);
  lastAnyAlertAt = now;
  // Debug-only (see preload-overlay.js's debugLog bridge - gated the same as every other
  // detection line by the Diagnostics toggle, off by default). The shared debugLog() prefix is
  // only second-precision (toLocaleTimeString has no ms), which is too coarse to measure an
  // in-game-action-to-sound delay against - the ms suffix here is what actually makes that
  // measurable. Only logged for a sound that actually plays, not one this function bailed out of
  // above (muted, or eaten by the debounce).
  window.eqOverlay.debugLog(`SOUND ${kind} - "${currentConfig.name || widgetId}" .${String(now % 1000).padStart(3, '0')}`);
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
    // Nothing that never runs out can be "about to run out". Skipped explicitly because
    // `null > thresholdSec` is false, so the check below would otherwise treat it as in the
    // warning window and beep about it once a loop interval, forever.
    if (buff.infinite) {
      warnedAt.delete(key);
      continue;
    }
    // A 0-second custom timer trigger has nothing to be "about to run out" - remainingSec is
    // already 0 the instant it lands, so without this it warned in the same breath as landing,
    // every single time. See the zeroDurationKeys note in render() for the matching expire-sound
    // fix this belongs beside.
    if (currentConfig.buffSource === 'customTimer' && buff.durationSec === 0) {
      warnedAt.delete(key);
      continue;
    }
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

// The symbol, not a word, and not a blank. A blank reads as "the timer is broken"; "forever" is
// too wide for an icon tile at any sensible size.
const INFINITE_LABEL = '\u221e';

function formatTime(totalSec, format) {
  // A buff that never runs out has no remaining time - null, deliberately, so it cannot be
  // mistaken for zero anywhere. Checked first, before any format branch, because every one of
  // them would otherwise print "null" or NaN.
  if (totalSec === null) return INFINITE_LABEL;
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

// Note 19. A translucent per-attacker bar fill for the damage meter - same stable hue as
// colorForName, but lighter and see-through so the row's name and number stay readable over it.
function damageBarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `hsla(${hash % 360}, 55%, 50%, 0.3)`;
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
// outright - repeating "Baxa:" on every tile in Baxa's own group is
// just noise eating tile width.
function displayName(buff) {
  // The damage meter's total row, when it's showing the running tally between pulls rather than the
  // last fight - see damageEngine.getActive.
  if (buff.totalRow && buff.scopeFellBack) return 'Total (whole fight)';
  if (buff.totalRow && buff.sinceZone) return 'Total (since zone)';
  // A charmed pet you own, kept distinct across re-charms by a trailing "#n" - shown as " #n".
  if (buff.isPet && /#\d+$/.test(buff.name || '')) return buff.name.replace(/#(\d+)$/, ' #$1');
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

// #29 - the Bard Songs aura only, and only once a debuff song is actually showing (nothing to
// split otherwise). The heading text reuses the same allyName field the group renderer already
// draws, so no rendering change is needed.
function shouldSplitSongs(visible) {
  return currentConfig.buffSource === 'bardSongs'
    && !!currentConfig.splitSongsByType
    && visible.some((b) => b.isDebuff);
}

function groupBySongType(buffs) {
  const buffSongs = buffs.filter((b) => !b.isDebuff);
  const debuffSongs = buffs.filter((b) => b.isDebuff);
  const out = [];
  if (buffSongs.length) out.push({ allyName: 'Buff songs', buffs: buffSongs });
  if (debuffSongs.length) out.push({ allyName: 'Debuff songs', buffs: debuffSongs });
  return out;
}

// A maintained debuff song (Largo's Melodic Binding and the like) has no cast line and re-lands
// every ~6s on EVERY mob it is on, so the feed carries one entry per target - three mobs, three
// near-identical tiles. On the aura it is one song: collapse every debuff song to a single tile
// keyed by name, the soonest-expiring instance as the lead (its timer is the one worth watching),
// with the merged badge showing how many enemies carry it. Buff songs are left exactly as they
// are - a buff song on the player is genuinely one thing already.
function collapseDebuffSongs(songs) {
  const byName = new Map();
  for (const s of songs) {
    if (!s.isDebuff) continue;
    const k = s.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(s);
  }
  if (!byName.size) return songs;

  const out = songs.filter((b) => !b.isDebuff);
  for (const [k, group] of byName) {
    const lead = group.reduce((a, b) =>
      ((b.remainingSec ?? Infinity) < (a.remainingSec ?? Infinity) ? b : a));
    out.push({
      ...lead,
      allyName: null, // it is "the song", not "the song on mob X"
      id: null, // so keyFor falls through to the stable mergedKey below, not a per-target id
      mergedKey: `debuffsong::${k}`,
      ...(group.length > 1
        ? { mergedCount: group.length, mergedKeys: group.map(keyFor) }
        : {}),
    });
  }
  return out;
}

// Note 8's count, and deliberately ONE builder rather than two. Note 12 wants the identical badge
// on a different kind of merged tile, and two copies of a thing described as "the same badge" is
// how they end up not being the same badge.
function buildCountBadge(count, why) {
  const badge = document.createElement('span');
  badge.className = 'count-badge';
  badge.textContent = `\u00d7${count}`;
  badge.title = why || (count + ' buffs merged into this one');
  return badge;
}

// Note 12. How many of this tile there really are: merged buffs on one target.
//
// An enemy debuff used to count identically-named mobs sharing one key ("a greater kobold" x2,
// x3...), scrapped 24 Aug because the log can't tell a second same-named mob apart from a recast
// refreshing the one target you already have - it's one tile now, duration refreshed on a new
// cast, same as a buff on a groupmate always was.
//
// the owner, 23 August: "a count of x1 should not be displayed, only display count when multiple
// exist." Returning null in the ordinary case is what enforces it, once, rather than at each call
// site.
function countFor(buff) {
  if (buff.mergedCount > 1) {
    const why = buff.isDebuff
      ? `this song is on ${buff.mergedCount} enemies`
      : `${buff.mergedCount} buffs merged into this one`;
    return { n: buff.mergedCount, why };
  }
  return null;
}

// A TEXT AURA's whole rendering: one line of words, and nothing else. No icon, no countdown, no
// bar - not hidden by CSS but never built, so there is nothing to leak through at an awkward size
// or catch a stray style later.
//
// The words are the user's own if they set any, and the name of whatever is being watched if not.
// A buff aura reads well either way ("Spirit of the Puma"); a trigger almost always wants
// something short and loud instead, which is why the field exists.
function buildTextTile(buff) {
  const root = document.createElement('div');
  root.className = 'text-tile';
  root.textContent = textFor(buff);
  applyTextAuraStyle(root);
  // timeEl/barEl deliberately null - updateRef checks for them rather than assuming every tile
  // has a countdown, because this is the first kind that does not.
  return { root, timeEl: null, barEl: null, iconWrapEl: null, labelEl: null, lastIconUrl: undefined };
}

// What a text aura actually says.
//
// {caster} and {spell} are substituted so one aura can cover a whole list of spells and still say
// which one just happened, and who by. the owner's example wording was "Party member has cast
// Mesmerize on a creature"; the tokens are what let her write that for real, with the actual name
// in it, instead of a fixed line that is only right for one spell.
//
// {mob} reads from that exact same buff.allyName field - reported live 24 Aug: "r {mob} also
// should be a viable input, so that you can call a mobs name into the text popup." For an enemy
// debuff (trackOnEnemies), allyName is never actually a caster - it's the mob the debuff landed
// on (see buffEngine.js's _landOnAlly, used identically for a groupmate or a target), so writing
// "{caster}" into a message like "Mesmerize resisted by {caster}" was always asking for the right
// value under a name that reads backwards for that case. Both tokens are kept, both read the same
// field - which one to write is just whichever reads naturally for what the aura is watching.
//
// buff.allyName falls back to buff.capturedPrefix for a customTimer buff - reported live 25 Aug:
// "{mob} did not print mob name" on "Your {spell} was resisted by {mob}", a plain trigger aura
// with no ally-landing infrastructure behind it at all, so allyName is always empty there.
// capturedPrefix is customTimerEngine's own answer to the same question a "contains" trigger's
// capturedText already answers for {spell} - the text BEFORE the match instead of after it, e.g.
// "An imp protector" out of "An imp protector resisted your Denon's Dissension!".
//
// Substituted for every text aura, not just the warning ones - a token in a message that resolved
// on some auras and printed literally on others would be a worse rule than either.
function textFor(buff) {
  const message = (currentConfig.textAuraMessage || '').trim();
  if (!message) return displayName(buff);
  if (!message.includes('{')) return message;
  return message
    .replace(/\{caster\}/g, buff.allyName || buff.capturedPrefix || '')
    .replace(/\{mob\}/g, buff.allyName || buff.capturedPrefix || '')
    // Never the synthetic always-on name - that string is an internal key, not something to put
    // in front of anyone. capturedText wins when present - a customTimer buff's own .name is the
    // TIMER's name (e.g. "Resisted"), never the actual spell; capturedText is whatever a
    // "contains" trigger's own text left over on the real line (see customTimerEngine.js), which
    // for "resisted your " is the actual spell that got resisted. Reported live: "resist text
    // should say 'resisted your [skill name]'" - the Resist flash premade's default message is
    // now literally that, with {spell} resolving to it.
    .replace(/\{spell\}/g, buff.name === ALWAYS_ON_KEY ? '' : buff.capturedText || buff.name || '')
    // Note 21. Pushed with the config rather than stored, so it is right the instant you switch.
    .replace(/\{profile\}/g, currentConfig.activeProfileName || '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function applyTextAuraStyle(el) {
  el.style.fontSize = `${currentConfig.textAuraSize || 32}px`;
  el.style.color = currentConfig.labelTextColor || '#f0f1f5';
}

// Note 37 - a coloured edge saying what KIND of spell this is. The colours themselves live in
// overlay.css so they can be changed without touching logic; this only decides which class goes
// on the tile.
//
// Applied at build time, like the name and the icon: a spell does not change category while it is
// running, so there is nothing here for the per-tick update path to keep in step.
//
// A merged tile inherits its lead member's category, which is right - the lead is the buff it is
// naming and counting down. A custom timer has no spell behind it and so gets no colour at all,
// rather than a misleading one.
const CATEGORY_CLASSES = new Set(['buff', 'debuff', 'nuke', 'dot', 'heal', 'hot', 'pet', 'charm']);

function applyCategoryBorder(root, buff) {
  if (currentConfig.categoryBordersEnabled === false) return;
  const category = buff.spellCategory;
  if (!category || !CATEGORY_CLASSES.has(category)) return;
  root.classList.add('cat', `cat-${category}`);
}

/** The one place that decides which kind of tile a mode gets, so every call site agrees. */
function buildTile(buff, isText, isIcon) {
  const ref = isText ? buildTextTile(buff) : isIcon ? buildIconTile(buff) : buildListRow(buff);
  applyCategoryBorder(ref.root, buff);
  return ref;
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
  const listCount = countFor(buff);
  if (listCount) content.insertBefore(buildCountBadge(listCount.n, listCount.why), time);

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

  // QOL #46 - the depletion shade, drawn over the icon (see updateTileShade). Always built so the
  // per-tick path can just show/hide it; inert until the aura's iconDepletionShade is set.
  const shade = document.createElement('div');
  shade.className = 'tile-shade';
  shade.style.display = 'none';
  root.appendChild(shade);

  const ref = { root, timeEl: time, shadeEl: shade, labelEl: null, lastIconUrl: undefined };
  updateTileIcon(ref, buff);
  // Appended after the icon so it draws over it - .buff-tile is position:relative and the badge
  // is absolutely placed in its corner.
  const iconCount = countFor(buff);
  if (iconCount) root.appendChild(buildCountBadge(iconCount.n, iconCount.why));

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

// QOL #46 - the icon-mode depletion shade. Same two looks the action bars use for cooldowns
// (actionbar.js updateCooldownVisuals): 'wipe' is a solid shade pinned to the bottom that shrinks
// as the buff runs down; 'radial' is a conic wedge that closes like a clock. The fraction is
// remaining/duration, so a full tile means a fresh buff. Skipped for anything with no real
// countdown - an infinite buff, a damage-meter row (valueText), a raid-board named.
function updateTileShade(ref, buff) {
  const el = ref.shadeEl;
  if (!el) return;
  const style = currentConfig.iconDepletionShade || 'none';
  const hasCountdown =
    style !== 'none' &&
    !buff.infinite &&
    buff.valueText == null &&
    typeof buff.durationSec === 'number' &&
    buff.durationSec > 0 &&
    typeof buff.remainingSec === 'number';
  if (!hasCountdown) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }
  const frac = Math.max(0, Math.min(1, buff.remainingSec / buff.durationSec));
  el.style.display = '';
  if (style === 'radial') {
    el.style.clipPath = 'none';
    el.style.background = `conic-gradient(rgba(0, 0, 0, 0.62) ${frac * 360}deg, transparent 0)`;
  } else {
    el.style.background = 'rgba(0, 0, 0, 0.62)';
    el.style.clipPath = `inset(${(1 - frac) * 100}% 0 0 0)`;
  }
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
  // Above the QOL #46 depletion shade (z-index:1) so a darkening tile never swallows its own
  // countdown / label.
  el.style.zIndex = '2';
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
  // QOL #48 - a tile in its brief post-expiry linger. Greyed, labelled, no countdown, no shade,
  // and explicitly not `.low` (remaining is 0, which would otherwise read as "expiring" and
  // pulse red). render() has already kept it out of every sound/glow set.
  if (buff._expired) {
    ref.root.classList.add('expired-linger');
    ref.root.classList.remove('low', 'just-landed');
    if (isIcon) updateTileIcon(ref, buff);
    if (ref.shadeEl) ref.shadeEl.style.display = 'none';
    const t = ref.timeEl;
    if (t) t.textContent = 'done';
    return;
  }
  ref.root.classList.remove('expired-linger');

  // A 0-second custom timer trigger has nothing to show for any length of time - the tile exists
  // purely so the sound pipeline above has a buff to see land, not because there is a countdown
  // worth putting on screen. Opacity rather than not building the tile at all, since sound only
  // fires for buffs this widget is actually "displaying" (see render()'s own comment on that
  // rule) - an invisible tile still counts as displayed, a skipped one would go silent too.
  const isZeroDurationPing = currentConfig.buffSource === 'customTimer' && buff.durationSec === 0;
  ref.root.classList.toggle('zero-duration-ping', isZeroDurationPing);

  const threshold = currentConfig.lowTimeThresholdSec ?? 30;
  // !buff.infinite matters more than it looks: remainingSec is null for one of those, and
  // `null <= 30` is TRUE in JavaScript - so without this a buff that never runs out would sit
  // there permanently coloured as though it were seconds from expiring. !isZeroDurationPing for
  // the same reason - remainingSec is always 0 for one of these too, which is always <= threshold,
  // and .low's own CSS rule runs a `pulse` animation that ANIMATES opacity - overriding
  // .zero-duration-ping's static opacity:0 outright regardless of selector specificity (a CSS
  // animation always wins over a non-!important static value on the same property). Reported
  // live: the "invisible" tile still visibly pulsed for exactly this reason.
  const low = !isZeroDurationPing && !buff.infinite && threshold > 0 && buff.remainingSec <= threshold;
  ref.root.classList.toggle('low', low);

  const rampAmber = rampColorFor(buff, low, isZeroDurationPing, threshold);

  // Note 10: "if the tile doesn't visibly say which phase it is in, the number on screen is
  // actively misleading". A cooldown counts down to when you CAN use something; a duration counts
  // down to when you can no longer rely on it. Same tile, same digits, opposite meanings - so the
  // cooldown phase is dimmed and outlined, and the tooltip says which it is in words.
  const cooling = buff.phase === 'cooldown';
  ref.root.classList.toggle('cooldown-phase', cooling);
  if (cooling) ref.root.title = `${displayName(buff)} - cooling down, ready in ${buff.remainingSec}s`;
  else if (ref.root.title) ref.root.title = '';

  // Backlog #33 - a killed named on the raid board. Dimmed and struck through, but kept on screen
  // so the aura stays a "what's left" checklist. A killed named in a respawning zone still has a
  // remainingSec, which the countdown line below shows.
  ref.root.classList.toggle('raid-killed', !!buff.killed);
  if (currentConfig.buffSource === 'raidNamed') ref.root.classList.toggle('raid-boss', buff.tier === 'boss');
  // A text aura has no countdown to update - it says its piece and disappears when whatever it is
  // watching ends. Checked rather than assumed, because it is the first tile without one.
  if (!ref.timeEl) return;
  // Note 19. A tile carrying valueText is not counting anything down - it is a damage meter row,
  // and this is where its number goes. Two lines rather than a second renderer: every list
  // setting the aura already has (row height, text size, colours, anchor, drag, per-loadout
  // visibility) then applies to it for free. Inert for every other aura, which never sets it.
  // Note 19. A damage aura's per-attacker rows read as cumulative damage ('total'), their own
  // per-second rate ('dps'), or "damage (rate)" ('both') - damageValueMode, applied here so one
  // engine feeds meters that differ on it. The Total row only carries valueText (already both), so
  // this leaves it alone. `damageShowDps` is the old boolean this replaced - still honoured if the
  // mode was never set.
  let damageText = buff.valueText;
  if (currentConfig.buffSource === 'damage') {
    const mode = currentConfig.damageValueMode || (currentConfig.damageShowDps ? 'dps' : 'total');
    if (mode === 'dps' && buff.dpsText != null) damageText = buff.dpsText;
    else if (mode === 'both' && buff.bothText != null) damageText = buff.bothText;
  }
  ref.timeEl.textContent =
    damageText != null ? damageText : formatTime(buff.remainingSec, currentConfig.timerFormat);
  if (isIcon) {
    updateTileIcon(ref, buff);
    updateTileShade(ref, buff);
    applyTilePositionedTextStyle(ref.timeEl, low, currentConfig.contentAnchor || 'bottom-center', currentConfig.textSize || 10, false, rampAmber || currentConfig.timerTextColor);
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
    // Note 19. The damage meter's Total row: a plain label + value line, no bar - it is not a
    // comparison against anything.
    if (buff.noBar) {
      ref.barEl.style.display = 'none';
    } else {
      ref.barEl.style.display = '';
      // A full bar for a buff that never depletes. An empty one would say the opposite of the
      // truth. barPercent before the infinite check, or a damage row - which IS infinite, having
      // no expiry - would draw every bar full and show nothing about who is doing what.
      const pct =
        typeof buff.barPercent === 'number'
          ? Math.max(0, Math.min(100, buff.barPercent))
          : buff.infinite
            ? 100
            : buff.durationSec > 0
              ? Math.max(0, Math.min(100, (buff.remainingSec / buff.durationSec) * 100))
              : 0;
      ref.barEl.style.width = `${pct}%`;
      // Note 19. Each attacker's bar gets a stable colour derived from the name (owner's call), so
      // the same person keeps the same colour tick to tick. Only for a damage meter - every other
      // aura's bar stays the one CSS fill.
      ref.barEl.style.background = currentConfig.buffSource === 'damage' ? damageBarColor(buff.name) : '';
    }
    // QOL #47 - list mode. Empty string clears the override so the row falls back to its CSS
    // colour (--timer-text-color, or the red .buff-row.low .time rule when low).
    ref.timeEl.style.color = rampAmber || '';
    updateRowIcon(ref, buff);
  }
}

// QOL #47 - the amber heads-up tier for the timer text. Between the expiring-soon flash threshold
// and twice it, fade the text to amber so how-close-to-expiry reads at a glance, not only at the
// red flash right at the end. Same guards as `low` (an infinite buff has a null remainingSec, a
// zero-duration ping is always "at" 0, a damage row carries valueText not a countdown); never
// drawn over the red - `.low` wins - and only when the aura opted in.
function rampColorFor(buff, low, isZeroDurationPing, threshold) {
  if (!currentConfig.timerColorRamp || low || isZeroDurationPing || buff.infinite) return null;
  if (buff.valueText != null || !(threshold > 0) || typeof buff.remainingSec !== 'number') return null;
  return buff.remainingSec <= threshold * 2 ? '#ffbe4d' : null;
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

// Note 21. An aura with nothing to watch still has something to say.
//
// Every other aura on screen exists because a buff arrived. This one has no event behind it at
// all, so there is no buff to hand the renderer and it would draw an empty box for ever. One
// synthetic entry, made here rather than in the engine, because nothing about it is detection -
// the main process has no reason to invent a buff that never landed.
//
// The name is deliberately not a real spell name. keyFor() and the landing-glow and sound paths
// all key off it, and a synthetic entry colliding with a real buff's key would make one of them
// flash or beep for the other.
const ALWAYS_ON_KEY = '__always-on__';

function alwaysOnEntry() {
  return {
    name: ALWAYS_ON_KEY,
    allyName: null,
    durationSec: null,
    remainingSec: null,
    infinite: true,
    instant: false,
    landedAt: null,
    showOnOverlay: true,
    iconUrl: null,
    isBardSong: false,
    spellCategory: null,
    onEnemy: false,
    allyCast: false,
  };
}

function visibleBuffs(buffs, opts = {}) {
  // Before every filter below it, because none of them apply: there is nothing to include or
  // exclude, no duration to cap, and no source to read from.
  if (currentConfig.alwaysOn) return [alwaysOnEntry()];

  // Note 19, and here for the same reason. A damage meter's rows are people, not spells, so every
  // filter below is about something these rows do not have: there is no buff list to match a
  // player's name against, no bard song to hide, and no duration to cap. Leaving them to fall
  // through would filter the meter to nothing - buffFilterMode is 'explicit' on a custom aura and
  // no attacker's name is ever in buffNames.
  //
  // The meter's own two display settings are applied HERE rather than in the engine, which is what
  // lets two damage auras differ on them while sharing one engine and one set of numbers.
  // Note 20, and the same argument as the damage meter below it: a route's rows are directions,
  // not spells, so there is no buff list to match them against and no duration to cap. The main
  // process has already decided what this aura shows.
  if (currentConfig.buffSource === 'travel') return buffs;

  // Backlog #33. The board already IS the current zone's whole named list - every row is meant to
  // show, killed ones just dimmed (see the .killed class in render). No picker, no duration cap,
  // same argument as travel/damage above.
  if (currentConfig.buffSource === 'raidNamed') return buffs;

  // feat/module-system. The module already decided what its aura shows; there is no spell list to
  // match against and no duration cap to apply. Same argument as travel/raidNamed above.
  if (currentConfig.buffSource === 'module') return buffs;

  if (currentConfig.buffSource === 'damage') {
    let rows = buffs;
    // Your row only. It hides the others rather than un-counting them, so the percentage still
    // reads as your share of the whole fight.
    if (currentConfig.mineOnly) rows = rows.filter((b) => b.name === 'You' || b.isPet || b.totalRow);
    if (currentConfig.showTotalRow === false) rows = rows.filter((b) => !b.totalRow);
    // Line C - the combined owner-unknown charmed-pet row, hidden if the aura asked.
    if (currentConfig.showCharmedPetsRow === false) rows = rows.filter((b) => !b.unknownPets);
    // Top-N attacker rows only (owner's call, default 6). The engine sends every row sorted
    // biggest-first; this keeps the meter from running off the screen in a raid. The Total row is
    // never counted against the cap - it draws last and is a summary, not an attacker.
    const cap = Number(currentConfig.damageRowCap);
    if (Number.isFinite(cap) && cap > 0) {
      let kept = 0;
      rows = rows.filter((b) => b.totalRow || ++kept <= cap);
    }
    return rows;
  }

  // Backlog #15. Same argument as travel/damage above: this feed already IS every bard song on
  // the player, unconditionally - there is no picker (buffFilterMode is meaningless here, on
  // purpose - see widgetStore.js's defaultBardSongsWidget), so the name-list/hideBardSongs/
  // allyCast/onEnemy filters below would either do nothing or, in hideBardSongs' case, strip
  // every single tile this aura has (every entry here has isBardSong true by construction).
  if (currentConfig.buffSource === 'bardSongs') {
    // #29 - debuff songs (on an enemy) ride the same feed but are opt-in.
    const shown = buffs.filter((b) => b.showOnOverlay !== false && (currentConfig.showDebuffSongs || !b.isDebuff));
    // One maintained debuff song on N mobs is one song - collapse it to a single tile.
    return collapseDebuffSongs(shown);
  }

  let filtered;
  // CUSTOM TIMER - there is no spell name to pick from a list here; what this aura watches is
  // entirely defined by its own customTimers trigger text, already set up in Custom timers. Falling
  // through to the buffNames filter below (built for picking spells) left every triggers-sourced
  // text aura - the Resist flash and Dispelled premades included - showing nothing at all, because
  // their definitions' names ("Resisted", "Dispelled") were never in an empty buffNames list.
  if (currentConfig.buffSource === 'customTimer') {
    filtered = buffs;
  } else if (currentConfig.buffFilterMode === 'all') {
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
  // SOMEBODY ELSE'S CAST - a warning, not a buff. This used to be one-directional (strip alerts
  // from an aura that did not ask for them) and nothing stripped the other way, so an aura built
  // FROM the "Someone else cast a mez" premade - buffSource 'ally', buffNames full of mez/charm
  // spell names, exactly to receive these alerts - could ALSO show a real ally-buff landing for
  // one of those names, if the owner genuinely cast one of them on a groupmate herself. Reported
  // as "it's tracking buffs you've cast on allies", which is exactly what that gap let through.
  // An alert aura and an ordinary Ally Buffs aura are now a strict partition of the same list -
  // each end only ever sees its own kind, never the other's.
  filtered = filtered.filter((b) => !!b.allyCast === !!currentConfig.allyDebuffAlert);

  // ENEMIES - a debuff on something you are fighting, rather than a buff on a groupmate.
  //
  // The engine marks these; the aura decides whether it wants them. Without this the Ally Buffs
  // aura would fill up with mobs, which is not what anyone means by "ally buffs" - and the mark
  // is set by the spell's category, so it already applies to debuffs on one-word-named mobs that
  // the app has been detecting all along.
  //
  // The test for "does this aura want them" is the aura's own trackOnEnemies setting, the same
  // one that told the engine to widen its recipient check. One switch, so an aura cannot end up
  // asking to detect something it then refuses to draw.
  if (!currentConfig.trackOnEnemies) {
    filtered = filtered.filter((b) => !b.onEnemy);
  }

  // INSTANTS - nukes, heals, gates - only belong on an aura that is not drawing a countdown.
  //
  // the owner's rule: they "should not be added to selection lists that have a duration based tile"
  // but "can be added to... text only custom auras... just in case someone wants feedback when a
  // cast is successful or resisted". So a list or icon aura filters them out here, and a text
  // aura keeps them.
  //
  // Done at the aura level rather than by not landing them at all, because the engine has one
  // active list feeding every aura - refusing to land would take them away from the kind of aura
  // that is supposed to have them.
  const drawsCountdowns = currentConfig.displayMode !== 'text';
  if (drawsCountdowns) {
    filtered = filtered.filter((b) => !b.instant);
  } else {
    // The engine keeps an instant for a full minute so that ANY aura can still be showing it.
    // Each aura then decides for itself how long that is - "Show events for" on a text aura,
    // default six seconds. Without this every text aura would show every nuke for sixty seconds.
    const showFor = currentConfig.textAuraInstantSec || 6;
    const now = Date.now();
    filtered = filtered.filter((b) => !b.instant || !b.landedAt || now - b.landedAt <= showFor * 1000);
  }

  // Merged AFTER filtering and BEFORE sorting. After filtering, or an excluded buff would still
  // be counted in a badge; before sorting, so the merged tile takes its place in the order by the
  // remaining time it actually shows rather than by whichever member happened to be first.
  if (currentConfig.mergeSameDuration) filtered = mergeByDuration(filtered);
  const sorted = sortBuffs(filtered, currentConfig.sortOrder);

  // A TEXT AURA IS ONE TILE, always, however many things it is watching. That is what makes it an
  // announcement rather than a list, and it is the owner's explicit constraint on the type.
  //
  // Enforced here, at the last moment, rather than by stopping the user picking a second thing.
  // The dispel announcer watches three different lines of log text precisely so it catches all
  // three severities, and only one of them can ever match at a time - a limit on what may be
  // WATCHED would have made that impossible while limiting nothing anyone can see. After sorting,
  // so which one wins follows the aura's own sort order rather than arrival luck.
  //
  // An aura tracking debuffs ON ENEMIES gets the same one-tile rule, in icon/list mode too - not
  // just text. Reported live 24 Aug against an AoE mez: three different mobs mezzed by the same
  // cast produced three tiles, and the owner's answer was explicit - "ONE tile total for the whole
  // aura, always... like a text aura." The engine still tracks every distinct target underneath
  // (death/wear-off/mez-broken detection needs that - see buffEngine's allyBuffs), this only
  // narrows what's DRAWN, the same way the text-aura rule above narrows drawing without touching
  // what's watched.
  if (currentConfig.trackOnEnemies) return sorted.slice(0, 1);
  // A text aura is normally a single tile. The one exception is the stacked-line feed
  // (renderTextFeed), which asks for the whole set with { noTextLimit: true } so it can track
  // every recent firing rather than only the newest - see this file's render() dispatch.
  if (currentConfig.displayMode === 'text') return opts.noTextLimit ? sorted : sorted.slice(0, 1);
  return sorted;
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
  // Text mode's own use of the same currentOriginX mechanism icon mode's label margin already
  // relies on above - see that field's own comment. A text tile is CSS white-space:nowrap and
  // content-wrap is 'max-content' (see applyConfig's text branch), so the window's WIDTH changes
  // with every different message ("DISPELLED" vs "resisted your Denon's Dissension") while
  // fitToContent always keeps the window's stored ANCHOR position fixed and grows/shrinks the
  // opposite edge - which today is unconditionally the left edge (currentOriginX 0 growing
  // right), with no way to keep the right edge or the center fixed instead. Reported live 24 Aug:
  // "text only triggers however need a text justification setting, left right and middle".
  // 'left' keeps the anchor as the left edge (0 offset, the original/only behavior). 'right'
  // needs the window's x to shift left by the FULL width as it grows, so the offset equals the
  // measured width itself. 'center' splits the difference. Recomputed on every measurement
  // (message length changes every time), unlike icon mode's fixed label margin.
  if (currentConfig.displayMode === 'text') {
    const TEXT_JUSTIFY_ORIGIN = { left: 0, center: width / 2, right: width };
    currentOriginX = TEXT_JUSTIFY_ORIGIN[currentConfig.textJustify] ?? 0;
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

// QOL #48 - icon-mode expired linger. `key -> { buff, until }`, where `buff` is a frozen copy of
// the tile's last live state re-flagged `_expired`. `prevRealByKey` is the real (non-linger)
// visible set from the previous render, the diff source for "what just vanished".
const expiredLinger = new Map();
let prevRealByKey = new Map();
let lingerRerenderTimer = null;

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

// The same idea for instants, which have no remaining time to compare. Keyed the same way, holding
// the moment each one last happened.
const lastInstantLandedAt = new Map();

// A 0-second custom timer trigger (see widgetStore.js's setTriggerDurationSec - a trigger built
// purely to make a noise, with nothing meaningful to count down) lands and disappears in the same
// tick, so treating that disappearance as a genuine "expired" event fires the expire sound right
// alongside the land sound - reported live as the sound going off "multiple times in a row" for
// what the user expected to be a single ping. Keyed the same way as the maps above and carried
// across renders, because by the render where a key actually vanishes from `buffs` there is no
// buff object left to read durationSec off any more - this remembers which keys were zero-duration
// while they still existed, so that render's expire check can still tell the difference.
let zeroDurationKeys = new Set();

// Not the first ever render for this widget window - guards sound alerts
// (but not the landing glow, which already handled this) so opening the
// widget or reloading it doesn't fire a "landed" sound for every buff
// that was already active before this window existed to hear about it.
let hasRenderedBefore = false;

// ---------------------------------------------------------------------------
// Stacked-line text feed (config.stackTextLines)
//
// A plain text aura shows one line and replaces it every time something new fires - so a burst of
// three resists in two seconds looks identical to one. With stacking on, each firing becomes its
// own line in a short vertical feed (oldest on top, newest on the bottom, chat style) and each
// line fades out on its own timer.
//
// Built here in the renderer, not the engine, because the engine already gives us what we need:
// it keeps ONE active entry per trigger and just moves its clock forward on a repeat (an instant's
// landedAt, or a customTimer's remainingSec jumping back up - the same signal the renewal sound
// already reads). The feed watches that clock move and appends a line each time it does. Identical
// consecutive lines merge with an "x3" rather than repeating, so spamming one resist can't blow
// past the cap.
// ---------------------------------------------------------------------------
const textFeed = []; // [{ text, count, firstAt, lastAt }], oldest first
const feedLastSeen = new Map(); // `${keyFor(b)}\u0000${renderedText}` -> { landedAt, remaining }
let lastFeedSig = null;
const FEED_FADE_MS = 1200; // how long a line spends visibly fading before it is pruned

function resetTextFeed() {
  textFeed.length = 0;
  feedLastSeen.clear();
  lastFeedSig = null;
}

function pushFeedLine(text, now) {
  const last = textFeed[textFeed.length - 1];
  if (last && last.text === text) {
    // A repeat of the line already on the bottom - bump its count and restart its fade clock
    // rather than adding a second identical row.
    last.count += 1;
    last.firstAt = now;
    last.lastAt = now;
    return;
  }
  textFeed.push({ text, count: 1, firstAt: now, lastAt: now });
}

function drawTextFeed(now, lifetimeMs) {
  listEl.innerHTML = '';
  tileRefs.clear();
  listEl.className = 'buff-list';
  listEl.dataset.mode = 'text-feed';
  listEl.dataset.groupKey = '';
  listEl.dataset.mergeKey = '';
  // Each .text-tile is width:max-content, so lines of different lengths need the column's
  // cross-axis alignment set explicitly or the shorter ones sit against the left edge even
  // under centre/right justification (the window itself is already anchored to match - see
  // fitToContent's TEXT_JUSTIFY_ORIGIN).
  const FEED_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };
  listEl.style.alignItems = FEED_ALIGN[currentConfig.textJustify] || 'flex-start';
  for (const line of textFeed) {
    const el = document.createElement('div');
    el.className = 'text-tile text-feed-line';
    el.textContent = line.count > 1 ? `${line.text}  x${line.count}` : line.text;
    applyTextAuraStyle(el);
    // Negative delay is deliberate and valid: a line that survives a redraw (because a DIFFERENT
    // line aged out) resumes its fade from where it was rather than snapping back to full opacity.
    const age = now - line.firstAt;
    const delay = lifetimeMs - FEED_FADE_MS - age;
    el.style.animation = `feed-fade ${FEED_FADE_MS}ms linear ${delay}ms forwards`;
    listEl.appendChild(el);
  }
}

function renderTextFeed(buffs) {
  const pool = visibleBuffs(buffs, { noTextLimit: true });
  const now = Date.now();
  const lifetimeMs = Math.max(1, currentConfig.textAuraInstantSec || 6) * 1000;
  const cap = Math.max(2, Math.min(4, currentConfig.maxStackTextLines || 2));
  let sawNew = false;

  const liveKeys = new Set();
  for (const b of pool) {
    const text = textFor(b);
    if (!text) continue;
    const srcKey = `${keyFor(b)}\u0000${text}`;
    liveKeys.add(srcKey);
    const seen = feedLastSeen.get(srcKey);
    const landedAt = b.landedAt || null;
    const remaining = typeof b.remainingSec === 'number' ? b.remainingSec : null;
    let fired;
    if (!seen) {
      fired = true; // first time this exact line has appeared in the pool
    } else if (landedAt !== null) {
      fired = landedAt !== seen.landedAt; // an instant fired again
    } else if (remaining !== null && seen.remaining !== null) {
      fired = remaining > seen.remaining + 0.5; // a customTimer trigger re-fired (clock jumped up)
    } else {
      fired = false;
    }
    if (fired) {
      pushFeedLine(text, now);
      sawNew = true;
    }
    feedLastSeen.set(srcKey, { landedAt, remaining });
  }
  for (const k of feedLastSeen.keys()) {
    if (!liveKeys.has(k)) feedLastSeen.delete(k);
  }

  // Age out whole lines, then hold to the visible-line cap (array is oldest-first, so the excess
  // and the expired are both at the front).
  for (let i = textFeed.length - 1; i >= 0; i--) {
    if (now - textFeed[i].firstAt >= lifetimeMs) textFeed.splice(i, 1);
  }
  if (textFeed.length > cap) textFeed.splice(0, textFeed.length - cap);

  const sig = `${textFeed.map((l) => `${l.firstAt}:${l.count}`).join('|')}|${cap}`;
  if (sig !== lastFeedSig) {
    lastFeedSig = sig;
    drawTextFeed(now, lifetimeMs);
  }

  if (hasRenderedBefore && sawNew && currentConfig.soundOnLand) playAlertSound('land');
  hasRenderedBefore = true;
  reportSizeIfChanged();
}

// QOL #48 core. Given this render's REAL (non-linger) visible list, update expiredLinger: start
// lingering anything that was real last render, is gone now, and had a genuine countdown; drop
// lingers whose time is up or whose buff has come back. Returns the linger buffs to append and
// the soonest `until` (for scheduling the clear-out re-render). Pure apart from the two
// module-level Maps it is the owner of.
function trackExpiredLinger(realVisible, keyFn, lingerMs) {
  const now = Date.now();
  const currentKeys = new Set(realVisible.map(keyFn));
  for (const [key, buff] of prevRealByKey) {
    if (currentKeys.has(key) || expiredLinger.has(key)) continue;
    if (buff.infinite || buff.instant || buff.valueText != null) continue;
    if (!(typeof buff.durationSec === 'number' && buff.durationSec > 0)) continue;
    expiredLinger.set(key, {
      buff: { ...buff, _expired: true, infinite: false, instant: false, remainingSec: 0 },
      until: now + lingerMs,
    });
  }
  let soonest = Infinity;
  for (const [key, entry] of expiredLinger) {
    if (currentKeys.has(key) || entry.until <= now) {
      expiredLinger.delete(key);
      continue;
    }
    if (entry.until < soonest) soonest = entry.until;
  }
  prevRealByKey = new Map(realVisible.map((b) => [keyFn(b), b]));
  return { lingers: [...expiredLinger.values()].map((e) => e.buff), soonest };
}

function clearExpiredLinger() {
  expiredLinger.clear();
  prevRealByKey = new Map();
  if (lingerRerenderTimer) {
    clearTimeout(lingerRerenderTimer);
    lingerRerenderTimer = null;
  }
}

function render(buffs) {
  // The stacked-line text feed is its own render path - it keeps a short scrolling history of
  // recent firings instead of one live tile, so none of the tile-diffing / merge / grouping
  // machinery below applies. alwaysOn wins (nothing to stack when there is no event at all).
  if (currentConfig.displayMode === 'text' && currentConfig.stackTextLines && !currentConfig.alwaysOn && !showingPreviewSample) {
    // The tile path and the feed path each track what they last drew independently (tileRefs /
    // dataset.mode vs lastFeedSig). Coming BACK to the feed after the tile path drew something -
    // most visibly the "Show example content" sample - the feed can compute an unchanged signature
    // (both empty => same string) and skip its repaint, leaving that stale tile on screen. Force
    // one repaint whenever the list isn't already in feed mode.
    if (listEl.dataset.mode !== 'text-feed') lastFeedSig = null;
    renderTextFeed(buffs);
    return;
  }

  // The example sample is shown exactly as handed over, past every filter - the point is to judge
  // the tile's look and placement, not to re-test the aura's own spell list. Real content while the
  // toggle is on still filters normally (showingPreviewSample is false then).
  const visible = showingPreviewSample ? buffs : visibleBuffs(buffs);
  const isText = currentConfig.displayMode === 'text';
  const isIcon = currentConfig.displayMode === 'icons';
  const modeKey = isText ? 'text' : isIcon ? 'icons' : 'list';

  // QOL #48 - hold an expired icon tile briefly, greyed, rather than letting it vanish. The
  // linger buffs are appended for the tile-facing parts of render() only (`tileBuffs`); every
  // sound / glow / "genuinely expired" set below still works from the real `visible`, so the
  // expire sound fires at the true expiry, not when the linger clears.
  let tileBuffs = visible;
  const lingerSec = isIcon && !showingPreviewSample ? currentConfig.expiredLingerSec || 0 : 0;
  if (lingerSec > 0) {
    const { soonest } = trackExpiredLinger(visible, keyFor, lingerSec * 1000);
    if (expiredLinger.size) tileBuffs = [...visible, ...[...expiredLinger.values()].map((e) => e.buff)];
    if (lingerRerenderTimer) clearTimeout(lingerRerenderTimer);
    lingerRerenderTimer = null;
    if (Number.isFinite(soonest)) {
      lingerRerenderTimer = setTimeout(() => {
        lingerRerenderTimer = null;
        render(currentSourceBuffs());
      }, Math.max(50, soonest - Date.now() + 20));
    }
  } else {
    clearExpiredLinger();
  }

  const visibleKeys = tileBuffs.map((b) => keyFor(b));
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
    // An INSTANT has no remaining time to watch rise, so the renewal test below can never see a
    // second cast of one - it would beep for the first nuke and then stay silent for every one
    // after it until the entry aged out. landedAt changes on every landing, which is the only
    // signal that says "this happened again".
    if (b.instant) {
      const prevLanded = lastInstantLandedAt.get(key);
      if (prevLanded === undefined || b.landedAt !== prevLanded) soundLandedRaw.add(key);
      lastInstantLandedAt.set(key, b.landedAt);
      continue;
    }
    const prevRemaining = lastRemainingSec.get(key);
    // A custom timer with a cooldown (Note 10) rolls straight from 'duration' into 'cooldown'
    // when its duration ends, rather than disappearing - and remainingSec jumps UP when it does
    // (from ~0 to the cooldown length), which is exactly the signal this renewal test otherwise
    // reads as "cast again". Reported live: a 0s-duration/20s-cooldown trigger's land sound firing
    // a second time about a second after the first, for what was one single trigger firing once -
    // the phase rolling over, misread as a renewal. Only a 'duration'-phase buff (or a phase-less
    // one - self/ally buffs have no concept of cooldown phase at all) can genuinely be "cast
    // again"; a 'cooldown'-phase buff counting up into its cooldown never can.
    if (b.phase !== 'cooldown' && (prevRemaining === undefined || b.remainingSec > prevRemaining)) {
      soundLandedRaw.add(key);
    }
    lastRemainingSec.set(key, b.remainingSec);
  }
  for (const key of lastInstantLandedAt.keys()) {
    if (!rawSet.has(key)) lastInstantLandedAt.delete(key);
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

  // A 0-second custom timer never really "expires" - it landed and that was the whole event, so
  // the tell-tale is checked against zeroDurationKeys as it stood BEFORE this render (the buff
  // itself is already gone from `buffs` by the time its key shows up in justExpired). Refreshed
  // from the current buffs afterward, for whichever key vanishes on the NEXT render instead.
  const justExpiredForSound = new Set([...justExpired].filter((name) => !zeroDurationKeys.has(name)));
  zeroDurationKeys = new Set(
    buffs
      .filter((b) => currentConfig.buffSource === 'customTimer' && b.durationSec === 0)
      .map((b) => keyFor(b))
  );

  if (hasRenderedBefore) {
    if (currentConfig.soundOnLand && soundNewlyLanded.size > 0) playAlertSound('land');
    if (currentConfig.soundOnExpire && justExpiredForSound.size > 0) playAlertSound('expire');
  }
  checkSoundWarnings(visible);
  hasRenderedBefore = true;

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
  const mergeKey = tileBuffs.map((b) => (b.mergedCount ? `${b.mergedCount}:${b.name}` : '')).join('|');

  // A text aura is a single tile, so there is nothing to group and no heading that would make
  // sense above one line of words.
  // #29 - the Bard Songs aura's "Split buffs / debuffs" toggle groups by song type instead of by
  // caster; it wins over caster-grouping when both are on.
  const splitSongs = !isText && shouldSplitSongs(tileBuffs);
  const grouped = !isText && (splitSongs || shouldGroupByAlly(tileBuffs));
  const groups = grouped ? (splitSongs ? groupBySongType(tileBuffs) : groupByAlly(tileBuffs)) : null;
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
          const ref = buildTile(buff, isText, isIcon);
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

    for (const buff of tileBuffs) {
      const ref = buildTile(buff, isText, isIcon);
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
    for (const buff of tileBuffs) {
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
let lastBardSongs = [];
let lastCustomTimers = [];
// Note 19. Three scoped views from one engine (whole fight / just my group / just me) - the aura
// picks its own by damageScope. See damageViews() in main.js.
let lastDamageViews = { all: [], group: [], mine: [] };
// Backlog #33. One shared board - the current raid zone's named list, killed ones flagged.
let lastRaidNamed = [];
// Note 20. Keyed by aura id - one broadcast carries every travel aura's route and each window
// takes its own. See pushTravelRoutes in main.js for why it is shaped that way.
let lastTravelRoutes = {};
// feat/module-system. One broadcast carries every custom module's live entries, keyed by module
// id; a module aura reads its own slice by currentConfig.moduleId.
let lastModuleEntries = {};

// QOL #1 - "Preview this aura" from the settings panel. While active, currentSourceBuffs() hands
// render() a sample set instead of the real one and visibleBuffs() lets it straight through, so
// the tile shows regardless of what the aura actually filters to. Reverts on its own.
let previewActive = false;

function previewSampleBuffs() {
  const now = Date.now();
  const mk = (name, remainingSec, durationSec, extra = {}) => ({
    name, remainingSec, durationSec, landedAt: now, spellCategory: 'buff',
    iconUrl: null, showOnOverlay: true, ...extra,
  });
  switch (currentConfig.buffSource) {
    case 'ally':
      return [mk('Spirit of Wolf', 140, 300, { allyName: 'Graznthok' }), mk('Aegolism', 520, 600, { allyName: 'Faelinn' })];
    case 'bardSongs':
      return [mk("Selo's Accelerando", 15, 18, { allyName: 'You', isBardSong: true }), mk('Chorus of Marr', 12, 18, { allyName: 'Faelinn', isBardSong: true })];
    case 'customTimer':
      return [mk(currentConfig.name || 'Preview', 8, 12, { id: 'preview' })];
    case 'raidNamed':
      return [
        mk('Cazic-Thule', null, null, { tier: 'boss', killed: false, infinite: true }),
        mk('Dread', null, null, { tier: 'mini', killed: true, infinite: true }),
        mk('Fright', null, null, { tier: 'mini', killed: false, infinite: true }),
      ];
    case 'module':
      return [mk(currentConfig.name || 'Module', 9, 12, { key: 'preview' })];
    default:
      return [mk('Spirit of Wolf', 140, 300), mk('Aegolism', 520, 600)];
  }
}

window.eqOverlay.onPreviewMode(({ enabled } = {}) => {
  previewActive = !!enabled;
  render(currentSourceBuffs());
});
// A window recreated (profile switch, resize) while preview was on/off would otherwise boot with
// previewActive = false and miss the one-shot event - re-sync from the main process on load.
if (window.eqOverlay.getPreviewMode) {
  window.eqOverlay.getPreviewMode(widgetId).then((on) => {
    previewActive = !!on;
    render(currentSourceBuffs());
  });
}

// QOL - "Show example content" is a persistent toggle now, not a timed flash. While it's on, an
// aura with nothing real to show fills with sample tiles so you can see where to put it and how
// big it is; the moment real content arrives it takes over (real always wins over the sample).
// `showingPreviewSample` records which of the two the current render is showing, so filters/linger
// are only bypassed for the actual sample.
let showingPreviewSample = false;

function currentSourceBuffs() {
  const real = realSourceBuffs();
  if (previewActive && real.length === 0) {
    showingPreviewSample = true;
    return previewSampleBuffs();
  }
  showingPreviewSample = false;
  return real;
}

function realSourceBuffs() {
  if (currentConfig.buffSource === 'ally') return lastAllyBuffs;
  // Backlog #15. Every bard song currently active on the player, already grouped-by-caster-ready
  // (see buffEngine.getActiveBardSongs - it emits `allyName` holding the CASTER here, reusing that
  // exact field so the existing ally-grouping renderer below needs no changes at all).
  if (currentConfig.buffSource === 'bardSongs') return lastBardSongs;
  // customTimers:active is one broadcast carrying every active definition from EVERY widget - same
  // shape as lastTravelRoutes above it, and it needs the same per-widget scoping travel already
  // gets. Without this, a widget showed every OTHER customTimer widget's active triggers too, not
  // just its own - two customTimer auras (e.g. the Resist flash premade plus a hand-built one)
  // silently fought over which one showed, since a text aura draws only one tile and picks whichever
  // definition sorts first out of the combined pool. Reported live as "resist flash still not
  // appearing" once the widget existed alongside another custom timer aura.
  if (currentConfig.buffSource === 'customTimer') {
    const ownIds = new Set((currentConfig.customTimers || []).map((t) => t.id));
    ownIds.add(`and:${currentConfig.id}`);
    ownIds.add(`or:${currentConfig.id}`);
    // Reported live 25 Aug: an OR-combined aura (two triggers, "hi" and "hello") never showed
    // anything at all. An 'and'/'or' triggerCombineMode fires one instance keyed by the WIDGET's
    // own id (`and:<widgetId>`/`or:<widgetId>` - see customTimerEngine.js's _resolveActivations),
    // not by any single trigger's own id, because no one definition owns a combined activation.
    // ownIds above only ever held real per-trigger ids, so that synthetic key matched nothing here
    // and got filtered straight out before visibleBuffs ever saw it - completely invisible, not a
    // display bug, on every combine mode except 'independent' (which never produces a synthetic key
    // in the first place, so this went unnoticed until someone actually tried AND/OR on a real
    // aura). Prefixed with THIS widget's own id, so it can never accidentally admit another
    // customTimer widget's combo tile the way the ownIds set as a whole exists to prevent.
    return lastCustomTimers.filter((t) => ownIds.has(t.id));
  }
  // Note 19. Rows arrive already sorted biggest-first from damageEngine, which is why a damage
  // meter is created with sortOrder 'default' - see createDamageMeter. Any other sort order would
  // reorder them by a time remaining they deliberately do not have.
  if (currentConfig.buffSource === 'damage') {
    const scope = currentConfig.damageScope || 'all';
    return lastDamageViews[scope] || lastDamageViews.all || [];
  }
  if (currentConfig.buffSource === 'travel') return lastTravelRoutes[widgetId] || [];
  // Backlog #33. One shared board (the current zone's named list), not per-widget - like damage,
  // unlike travel/customTimer.
  if (currentConfig.buffSource === 'raidNamed') return lastRaidNamed;
  // feat/module-system. One shared broadcast keyed by module id; this aura takes its own module's.
  if (currentConfig.buffSource === 'module') return lastModuleEntries[currentConfig.moduleId] || [];
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
  document.body.classList.toggle('text-aura', config.displayMode === 'text');
  // Drop any stacked-line history the moment the feed is not the active mode, so toggling it off
  // and back on (or switching display mode) never resurrects lines from a previous burst.
  if (!(config.displayMode === 'text' && config.stackTextLines)) resetTextFeed();
  // Note 6 - the aura's own name in its move box, so a screen full of unlocked blue rectangles
  // says which is which. Set from applyConfig rather than once at boot because a rename arrives
  // as a config change, and the box would otherwise show the old name until the next restart.
  dragNameEl.textContent = config.name || '';
  document.documentElement.style.setProperty('--text-size', `${config.textSize || 13}px`);
  document.documentElement.style.setProperty('--icon-size', `${config.iconSize || 46}px`);
  document.documentElement.style.setProperty('--timer-text-color', config.timerTextColor || '#f0f1f5');
  document.documentElement.style.setProperty('--icon-gap', `${config.iconMarginPx ?? 5}px`);
  document.documentElement.style.setProperty('--row-size', `${config.rowSize || 28}px`);
  // Note 37 follow-up - the coloured edge's own width, previously a fixed 1px baked into .cat's
  // CSS. Read here rather than left as a bare CSS literal so Size & Display's slider actually
  // does something; the toggle that decides whether the edge shows at ALL is still the separate
  // categoryBordersEnabled check in applyCategoryBorder.
  document.documentElement.style.setProperty('--cat-border-width', `${config.categoryBorderWidthPx || 1}px`);

  if (config.displayMode === 'text') {
    // A text aura is sized by its words, not by a setting. Every explicit width the other two
    // modes set has to be cleared, or a line of 48px text is clipped to whatever "List width"
    // happened to be - which looks like the text being broken rather than the box being narrow.
    //
    // 'max-content', not '' (empty/auto). content-wrap has no CSS width rule of its own, so an
    // empty string left it a plain block box, which defaults to FILLING its containing block
    // (body, 100%) rather than shrinking to its text. That made every measurement in
    // reportSizeIfChanged below just read the window's own current width back at itself: the
    // window resizes to width+8, content-wrap re-fills to the new 100%, gets measured as 8px
    // wider, and so on with no ceiling - a live version of the exact feedback loop this file's own
    // CSS comment on #content-wrap warns about. Reported as the aura "creeping wider and wider"
    // while unlocked - it grows on every resize regardless of lock state, but unlocking is the
    // only time anyone is watching the window closely enough to see it happen.
    // max-content makes content-wrap shrink-wrap to .text-tile's own max-content width instead,
    // which is what actually decides the size and does not change just because the window did.
    currentOriginX = 0;
    listEl.style.maxWidth = '';
    listEl.style.margin = '';
    listEl.style.justifyContent = '';
    listEl.style.width = '';
    contentWrap.style.width = 'max-content';
    dragOverlayEl.style.position = '';
    dragOverlayEl.style.inset = '';
    dragOverlayEl.style.top = '';
    dragOverlayEl.style.left = '';
    dragOverlayEl.style.transform = '';
    dragOverlayEl.style.width = '';
    dragOverlayEl.style.height = '';
  } else if (config.displayMode === 'icons') {
    // Icons per row is an explicit count, not a natural reflow based on
    // how many happen to fit at the current icon size - constrain the
    // grid's width to exactly that many columns (+ gaps) so it wraps
    // predictably regardless of icon size. content-wrap gets that same
    // width explicitly too (not "fit-content") - fit-content sizing on a
    // flex column whose child is itself a flex-wrap grid is an intrinsic-
    // sizing edge case browsers don't resolve consistently, and was
    // producing a wildly wrong (much too narrow) measured width. An
    // explicit pixel value removes the ambiguity entirely.
    listEl.style.alignItems = ''; // cleared in case a text-feed left it set (see drawTextFeed)
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
    listEl.style.alignItems = ''; // cleared in case a text-feed left it set (see drawTextFeed)
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
  // QOL #48 - a config change re-identifies tiles; a linger held over from the old config (old
  // mode, old source, old filter) would be re-attributed to whatever now sits at that key.
  clearExpiredLinger();
  // See warningsSuppressedOnce. Changing a setting must not produce a sound.
  warningsSuppressedOnce = true;
  Promise.all([
    window.eqOverlay.getActiveBuffs(),
    window.eqOverlay.getActiveAllyBuffs(),
    window.eqOverlay.getActiveBardSongs(),
    window.eqOverlay.getActiveCustomTimers(),
  ]).then(([selfBuffs, allyBuffs, bardSongs, customTimers]) => {
    lastSelfBuffs = selfBuffs;
    lastAllyBuffs = allyBuffs;
    lastBardSongs = bardSongs;
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
window.eqOverlay.getActiveBardSongs().then((songs) => {
  lastBardSongs = songs;
  render(currentSourceBuffs());
});
window.eqOverlay.onActiveBardSongsChanged((songs) => {
  lastBardSongs = songs;
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

window.eqOverlay.getActiveRaidNamed().then((rows) => {
  lastRaidNamed = rows;
  render(currentSourceBuffs());
});
window.eqOverlay.onRaidNamedChanged((rows) => {
  lastRaidNamed = rows;
  render(currentSourceBuffs());
});

window.eqOverlay.getTravelRoutes().then((routes) => {
  lastTravelRoutes = routes;
  render(currentSourceBuffs());
});
window.eqOverlay.onTravelRoutesChanged((routes) => {
  lastTravelRoutes = routes;
  render(currentSourceBuffs());
});

// feat/module-system - every custom module's live entries, keyed by module id.
if (window.eqOverlay.getModuleEntries) {
  window.eqOverlay.getModuleEntries().then((all) => {
    lastModuleEntries = all || {};
    render(currentSourceBuffs());
  });
  window.eqOverlay.onModuleEntries((all) => {
    lastModuleEntries = all || {};
    render(currentSourceBuffs());
  });
}

function applyDamageViews(views) {
  // Tolerate the old bare-array shape from any stale main process during a hot reload.
  if (Array.isArray(views)) lastDamageViews = { all: views, group: views, mine: views };
  else if (views && typeof views === 'object') lastDamageViews = views;
  render(currentSourceBuffs());
}
window.eqOverlay.getActiveDamage().then(applyDamageViews);
window.eqOverlay.onActiveDamageChanged(applyDamageViews);

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
