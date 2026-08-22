const crypto = require('crypto');
const zlib = require('zlib');
const { DEFAULT_PROFILE_ID } = require('./profileStore');

// Persisted list of overlay widgets. The very first widget ("self-buffs")
// is the pre-existing single overlay, migrated in-place so upgrading users
// see zero change in behavior - see loadOrMigrate() below. Everything lives
// in one widgets.json file (not one-file-per-widget) since the whole list
// is always read/written together by the widget-management UI.
const DEFAULT_TEXT_SIZE = 13;
const DEFAULT_ICON_SIZE = 46;
const DEFAULT_ANCHOR = 'bottom-center'; // matches the original hardcoded tile-time position
const DEFAULT_ICONS_PER_ROW = 4;
const DEFAULT_ROW_SIZE = 28; // matches the original hardcoded list-row height at default text size
const DEFAULT_LIST_WIDTH = 220;

// How an aura presents itself. 'sound-only' is an aura that draws NOTHING - no tiles, no
// window content, not even the dashed drag box while unlocked - and exists purely to make a
// noise when something it is watching lands, expires, or is about to expire.
//
// It is a DISPLAY MODE rather than a new kind of aura on purpose. Every filter, buff source,
// custom timer and sound setting that already exists keeps working untouched; any existing
// aura can be switched to it and back without losing a single setting; and nothing in the
// share-code path, the profile system or the widget list needs to learn a new concept. A new
// kind would have meant teaching all of that about a fourth case for no user-visible gain.
//
// Unknown values normalize to 'list', which is exactly what the overlay already did with them
// (it tests displayMode === 'icons' and treats everything else as a list), so this is a guard
// that changes no behaviour rather than a new rule. It earns its place on the import path,
// which is the one place a value this app never wrote can arrive from.
//   'text'       - a TEXT AURA. Draws one line of words and nothing else: no icon, no countdown,
//                  no bar. It shows while the thing it watches is active and disappears when
//                  that ends. Limited to ONE tile however many things it is watching, which is
//                  what makes it an announcement rather than a list.
//
// 'text' is deliberately NOT offered in the Display style radios beside List and Icons, even
// though that is exactly what it is underneath. The owner's reasoning, and it is the right call:
// a fourth radio on every aura is a fourth thing to read and rule out on every aura, and the goal
// is accessibility. It is chosen once, at creation, next to "Custom buff aura" and "Custom timer
// aura" - which is where someone deciding what KIND of thing to make is already looking.
const DISPLAY_MODES = ['list', 'icons', 'sound-only', 'text'];

function normalizeDisplayMode(mode) {
  return DISPLAY_MODES.includes(mode) ? mode : 'list';
}

function isSoundOnly(widget) {
  return !!widget && widget.displayMode === 'sound-only';
}

// 1 to 60. The ceiling is not arbitrary: buffEngine keeps an instant for 60 seconds and no
// longer, so a larger number here would be a promise the engine cannot keep.
const MAX_INSTANT_DISPLAY_SEC = 60;

function clampInstantSec(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 6;
  return Math.min(MAX_INSTANT_DISPLAY_SEC, Math.max(1, Math.round(value)));
}

function isTextAura(widget) {
  return !!widget && widget.displayMode === 'text';
}

function defaultSelfBuffsWidget(overrides = {}) {
  return {
    id: 'self-buffs',
    kind: 'self-buffs-builtin',
    name: 'Self Buffs',
    deletable: false,
    enabled: true,
    displayMode: 'list',
    timerFormat: 'minutes-seconds',
    textSize: DEFAULT_TEXT_SIZE,
    iconSize: DEFAULT_ICON_SIZE,
    contentAnchor: DEFAULT_ANCHOR,
    iconsPerRow: DEFAULT_ICONS_PER_ROW,
    rowSize: DEFAULT_ROW_SIZE,
    listWidth: DEFAULT_LIST_WIDTH,
    opacity: 1,
    width: 220,
    height: 500,
    position: null,
    buffFilterMode: 'all',
    buffNames: [],
    // Only meaningful when buffFilterMode is 'all' (an "everything" mode
    // with no picked list to remove a name from) - a per-widget "don't
    // track this buff here" list, distinct from the separate app-wide
    // blocked-buffs feature (buffStore.js) which stops tracking a buff
    // everywhere. Set from this widget's own "Active on this widget" card
    // in main-window.js, never shared with any other widget.
    excludedBuffNames: [],
    locked: true,
    sortOrder: 'default',
    lowTimeThresholdSec: 30,
    landingGlowEnabled: true,
    // Note 8 - see defaultCustomWidget's comment on this field.
    mergeSameDuration: false,
    // Note 37 - a coloured edge by what kind of spell it is. On by default, at the owner's
    // request, so it works without anyone going looking for it.
    categoryBordersEnabled: true,
    // Notes 11/16/17. Watch the picked spells on the things you cast them AT rather than on your
    // group - mez, charm, snare, slow. Off by default and opt-in per aura on purpose: mob names
    // are not one word, so accepting them at all requires relaxing a check that exists to stop a
    // sentence being read as a landing, and doing that for every spell would mean 160,000 extra
    // landings across the owner's logs, 100,000 of them from two bard songs pulsing on everything
    // in range. Opting in per aura bounds it by what someone actually asked to see.
    trackOnEnemies: false,
    // Note 16, answered by Shara on 21 August. A TEXT aura can warn that somebody else has cast
    // one of the spells it watches - "be careful", rather than a countdown on a debuff that is
    // not yours. She ruled out the timer herself: an ally's debuff has no ending line in the log,
    // so any duration shown for it would be invented, and "a text alert to be careful, and not a
    // standalone timer that may be inaccurate" is what she asked for instead.
    allyDebuffAlert: false,
    // Text auras only. What the aura actually says - blank means "use the name of whatever it is
    // watching", which is the sensible default for a buff and usually wrong for a trigger, where
    // the point is to say something short and loud like DISPELLED.
    textAuraMessage: '',
    // Its own size, deliberately not the shared textSize. That one is capped at 28px because it
    // also drives list rows and icon labels, and the whole point of an announcement is that it
    // can be much bigger than that without dragging every other aura's text up with it.
    textAuraSize: 32,
    // Text auras only. How long an INSTANT - a nuke, a heal, something with no duration at all -
    // stays on screen after it happens. Six by default, because a number that has to be found and
    // set before the feature works at all is a feature most people never see working.
    textAuraInstantSec: 6,
    hideBardSongs: true,
    maxDurationFilterSec: 0, // 0 = no cutoff
    soundOnLand: false,
    soundOnExpire: false,
    soundWarningSec: 0, // 0 = off
    soundWarningLoopSec: 0, // 0 = warn once only, matches soundWarningSec's own "0 = off" convention
    // null = default synthesized beep. A real soundService.js registry id
    // (see soundService.js) otherwise - one custom sound per alert TYPE,
    // not one shared sound for the whole widget, per backlog #16's "per
    // alert type, per widget" scope.
    landSoundId: null,
    expireSoundId: null,
    warningSoundId: null,
    // 0-100 - one shared volume for every alert sound on this widget
    // (custom files and the default beeps alike), not a separate slider
    // per alert type. Converted to a 0-1 fraction where it's actually
    // applied (overlay.js).
    alertVolume: 100,
    // List mode only - an icon next to the progress bar, and which side
    // everything anchors to (icon + bar's "full" edge), see overlay.js.
    showRowIcon: false,
    mirrorRowDirection: false,
    // Icon mode only - an optional second text overlay showing the
    // buff/timer's name, with its own independent size/position controls
    // (iconLabelSize/iconLabelAnchor) mirroring how the "timer text" -
    // the formatted countdown - already has textSize/contentAnchor. Off
    // by default (top-center, distinct from the timer text's default
    // bottom-center, so enabling it doesn't start out overlapping).
    showIconLabel: false,
    iconLabelSize: 11,
    iconLabelAnchor: 'top-center',
    // Text colours for the two icon-mode text overlays and the list-mode
    // timer. A buff about to expire still overrides these with the reserved
    // danger colour (see overlay.js) - that warning must not be themeable
    // away.
    timerTextColor: '#f0f1f5',
    labelTextColor: '#f0f1f5',
    // Ally auras only - group tiles by whose buff it is, with the ally's name
    // as a heading above each group, instead of one flat undifferentiated
    // list. groupAllyDirection stacks those groups down the screen
    // ('vertical') or side by side ('horizontal'). hideAllyNameOnTile drops
    // the redundant "Name: " prefix from each tile once the heading already
    // says whose group it is.
    groupAllyBuffs: false,
    groupAllyDirection: 'vertical',
    hideAllyNameOnTile: false,
    // Icon mode only - pixels of space between icons in the grid.
    iconMarginPx: 5,
    // Icon mode only - whether timer/label text wraps and clips to stay
    // fully inside its own tile, or overflows past it (see overlay.js's
    // applyTilePositionedTextStyle). On by default for the two "show
    // everything" premade widgets (Self Buffs, Ally Buffs) - packed grids
    // of many icons is exactly where unconstrained overflow text runs into
    // its neighbors and becomes unreadable. Off by default on a plain
    // custom widget (see defaultCustomWidget) - those are much more often
    // just one or two icons with room to spare, where letting a long name
    // spill out fully is more useful than clipping it.
    wrapText: true,
    // Icon mode only - how active icons are positioned within the grid's
    // reserved width when there are fewer of them than "Icons per row" -
    // 'left' (fill from the start, the original/default behavior), 'center',
    // or 'right'. Maps directly to CSS justify-content in overlay.js.
    iconJustify: 'left',
    // Which loadout profiles (see profileStore.js) this widget belongs to
    // - pure membership bookkeeping (used when creating a new profile, to
    // ask which existing widgets should migrate into it), NOT a visibility
    // filter. A widget stays on-screen regardless of the active profile;
    // this only controls which profiles' ambiguous-cast memory it's
    // considered part of. Defaults to just the default profile so existing
    // widgets don't silently vanish from "membership" on upgrade.
    activeProfileIds: [DEFAULT_PROFILE_ID],
    ...overrides,
  };
}

function defaultCustomWidget(name) {
  return {
    id: crypto.randomUUID(),
    kind: 'custom',
    name,
    deletable: true,
    enabled: true,
    displayMode: 'list',
    timerFormat: 'minutes-seconds',
    textSize: DEFAULT_TEXT_SIZE,
    iconSize: DEFAULT_ICON_SIZE,
    contentAnchor: DEFAULT_ANCHOR,
    // 1, not DEFAULT_ICONS_PER_ROW (4, used by the two "show everything"
    // builtins) - a custom buff widget or custom timer widget almost always
    // starts out tracking just one thing, so a 4-wide grid with 3 empty
    // slots was a confusing default. defaultAllyBuffsWidget overrides this
    // back to DEFAULT_ICONS_PER_ROW since it inherits from this function but
    // isn't a single-item widget the same way.
    iconsPerRow: 1,
    rowSize: DEFAULT_ROW_SIZE,
    listWidth: DEFAULT_LIST_WIDTH,
    opacity: 1,
    width: 220,
    height: 300,
    position: null,
    buffFilterMode: 'explicit',
    buffNames: [],
    // See defaultSelfBuffsWidget's comment - only meaningful in 'all' mode,
    // which a plain custom widget never uses by default but can end up in
    // if imported/edited, so it's still given a default here.
    excludedBuffNames: [],
    // Which engine data source this widget's buffs come from - 'self'
    // (buffs on the player) or 'ally' (buffs the player has cast on
    // groupmates). Only meaningful/user-facing for kind:'custom' - the two
    // builtin kinds each have a fixed, implied source (see
    // defaultSelfBuffsWidget/defaultAllyBuffsWidget).
    buffSource: 'self',
    // Only meaningful when buffSource is 'customTimer' - this widget's own
    // private set of text-trigger timer definitions (see
    // customTimerEngine.js), never shared with any other widget.
    // { id, name, durationSec, triggerText, endedText }[]
    customTimers: [],
    locked: true,
    sortOrder: 'default',
    lowTimeThresholdSec: 30,
    landingGlowEnabled: true,
    // Note 8. Collapses buffs that share a duration into one tile showing the lowest remaining
    // time and a count of how many are behind it - a Quick Buff set on a full group is about
    // fourteen tiles per ally otherwise. Per-aura, because it suits an ally aura far more than a
    // self-buff one. WHAT counts as "the same" is a separate, app-wide setting - see mergeRule
    // in main.js, which the owner asked for because either reading is defensible.
    mergeSameDuration: false,
    // Note 37 - a coloured edge by what kind of spell it is. On by default, at the owner's
    // request, so it works without anyone going looking for it.
    categoryBordersEnabled: true,
    // Notes 11/16/17. Watch the picked spells on the things you cast them AT rather than on your
    // group - mez, charm, snare, slow. Off by default and opt-in per aura on purpose: mob names
    // are not one word, so accepting them at all requires relaxing a check that exists to stop a
    // sentence being read as a landing, and doing that for every spell would mean 160,000 extra
    // landings across the owner's logs, 100,000 of them from two bard songs pulsing on everything
    // in range. Opting in per aura bounds it by what someone actually asked to see.
    trackOnEnemies: false,
    // Note 16, answered by Shara on 21 August. A TEXT aura can warn that somebody else has cast
    // one of the spells it watches - "be careful", rather than a countdown on a debuff that is
    // not yours. She ruled out the timer herself: an ally's debuff has no ending line in the log,
    // so any duration shown for it would be invented, and "a text alert to be careful, and not a
    // standalone timer that may be inaccurate" is what she asked for instead.
    allyDebuffAlert: false,
    // Text auras only. What the aura actually says - blank means "use the name of whatever it is
    // watching", which is the sensible default for a buff and usually wrong for a trigger, where
    // the point is to say something short and loud like DISPELLED.
    textAuraMessage: '',
    // Its own size, deliberately not the shared textSize. That one is capped at 28px because it
    // also drives list rows and icon labels, and the whole point of an announcement is that it
    // can be much bigger than that without dragging every other aura's text up with it.
    textAuraSize: 32,
    // Text auras only. How long an INSTANT - a nuke, a heal, something with no duration at all -
    // stays on screen after it happens. Six by default, because a number that has to be found and
    // set before the feature works at all is a feature most people never see working.
    textAuraInstantSec: 6,
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
    // Text colours for the two icon-mode text overlays and the list-mode
    // timer. A buff about to expire still overrides these with the reserved
    // danger colour (see overlay.js) - that warning must not be themeable
    // away.
    timerTextColor: '#f0f1f5',
    labelTextColor: '#f0f1f5',
    // Ally auras only - group tiles by whose buff it is, with the ally's name
    // as a heading above each group, instead of one flat undifferentiated
    // list. groupAllyDirection stacks those groups down the screen
    // ('vertical') or side by side ('horizontal'). hideAllyNameOnTile drops
    // the redundant "Name: " prefix from each tile once the heading already
    // says whose group it is.
    groupAllyBuffs: false,
    groupAllyDirection: 'vertical',
    hideAllyNameOnTile: false,
    // Icon mode only - pixels of space between icons in the grid.
    iconMarginPx: 5,
    // Off by default here - see defaultSelfBuffsWidget's comment on why the
    // two builtin "show everything" kinds default this on instead
    // (defaultAllyBuffsWidget overrides it back to true below).
    wrapText: false,
    iconJustify: 'left',
    activeProfileIds: [DEFAULT_PROFILE_ID], // see defaultSelfBuffsWidget's comment
  };
}

// The "Ally Buffs" premade - same "show everything, filtered by these
// options" shape as Self Buffs (buffFilterMode:'all' + hideBardSongs +
// maxDurationFilterSec), just sourced from buffs the player has cast on
// groupmates instead of on themselves. Unlike Self Buffs this is NOT a
// fixed singleton auto-seeded on every install - the user adds it
// on-demand from the "Premade widget" option in the add-widget flow (see
// main-window.js), and it's deletable/re-addable like any other widget,
// so no migration/seeding logic is needed for it.
function defaultAllyBuffsWidget(name) {
  return {
    ...defaultCustomWidget(name),
    kind: 'ally-buffs-builtin',
    buffFilterMode: 'all',
    buffSource: 'ally',
    height: 500,
    hideBardSongs: true,
    maxDurationFilterSec: 0,
    wrapText: true, // see defaultSelfBuffsWidget's comment
    iconsPerRow: DEFAULT_ICONS_PER_ROW, // see defaultCustomWidget's comment on why it's 1 there but not here
  };
}

// Fields that make sense to share between users via an export/import code -
// deliberately everything about how a widget looks and what it filters,
// and nothing about where it sits or how big its window is (id, position,
// width, height, locked, kind, deletable, enabled) - the recipient's own
// screen layout and widget list are theirs to manage, not something an
// exported code should overwrite or assume.
const SHAREABLE_FIELDS = [
  'name',
  'displayMode',
  'timerFormat',
  'textSize',
  'iconSize',
  'contentAnchor',
  'iconsPerRow',
  'rowSize',
  'listWidth',
  'opacity',
  'buffFilterMode',
  'buffNames',
  'excludedBuffNames',
  'buffSource',
  'customTimers',
  'sortOrder',
  'lowTimeThresholdSec',
  'landingGlowEnabled',
  'mergeSameDuration',
  'categoryBordersEnabled',
  'trackOnEnemies',
  'allyDebuffAlert',
  'textAuraMessage',
  'textAuraSize',
  'textAuraInstantSec',
  'soundOnLand',
  'soundOnExpire',
  'soundWarningSec',
  'soundWarningLoopSec',
  'alertVolume',
  'hideBardSongs',
  'timerTextColor',
  'groupAllyBuffs',
  'groupAllyDirection',
  'hideAllyNameOnTile',
  'labelTextColor',
  'iconMarginPx',
  'maxDurationFilterSec',
  'showRowIcon',
  'mirrorRowDirection',
  'showIconLabel',
  'iconLabelSize',
  'iconLabelAnchor',
  'wrapText',
  'iconJustify',
];

// v2: only non-default fields, deflate-compressed before base64 - v1 (plain
// JSON + base64, no diffing) never shipped to a real user, so there's no
// back-compat need, just a distinct prefix in case an old code ever
// resurfaces (importCode rejects an unrecognized prefix cleanly).
// Prefix on every exported aura code. Two jobs: it tells this app a pasted string is one of
// ours rather than base64 from somewhere else, and it is distinctive enough to spot in a line of
// game chat - which is what the planned "import from chat" feature needs to recognise.
//
// Bumped from EQBT2- when the roster was rebuilt. Old codes referenced spells from the generic
// 11,337-entry roster that no longer exist, so they could not be honoured anyway; a prefix change
// makes them fail cleanly at the door instead of importing an aura whose buffs silently never
// fire. Breaking them was agreed rather than assumed.
const SHARE_CODE_PREFIX = 'EQLSAURAS1-';

// Recognised, no longer decodable. Kept so the import UI can eventually say "this code is from an
// older version" instead of "invalid code" - a much better answer for someone pasting a code a
// friend sent last week. Nothing consults this yet; wiring it belongs with the import feature.
const LEGACY_SHARE_CODE_PREFIXES = ['EQBT2-'];

// textSize used to be a 'small'|'medium'|'large' enum (fixed 3-step radio
// buttons) - now it's a free px number via a slider. Widgets saved under
// the old scheme need a one-time value conversion, not a UI meaning
// change, so existing users land on the equivalent numeric size instead of
// silently falling back to a default.
const LEGACY_TEXT_SIZE_PX = { small: 11, medium: 13, large: 16 };

function normalizeWidget(widget) {
  return {
    ...widget,
    displayMode: normalizeDisplayMode(widget.displayMode),
    textSize: typeof widget.textSize === 'number' ? widget.textSize : LEGACY_TEXT_SIZE_PX[widget.textSize] || DEFAULT_TEXT_SIZE,
    iconSize: typeof widget.iconSize === 'number' ? widget.iconSize : DEFAULT_ICON_SIZE,
    contentAnchor: widget.contentAnchor || DEFAULT_ANCHOR,
    iconsPerRow: typeof widget.iconsPerRow === 'number' ? widget.iconsPerRow : DEFAULT_ICONS_PER_ROW,
    rowSize: typeof widget.rowSize === 'number' ? widget.rowSize : DEFAULT_ROW_SIZE,
    // Falls back to the widget's existing (possibly hand-dragged) window
    // width on first upgrade, not a fresh default, so nobody's list widget
    // visibly jumps size the first time this field appears.
    listWidth: typeof widget.listWidth === 'number' ? widget.listWidth : widget.width || DEFAULT_LIST_WIDTH,
    // Existing widgets saved before ally-buff tracking existed have no
    // buffSource at all - they were always self-only, so 'self' is the
    // behavior-preserving default. ally-buffs-builtin always forces 'ally'
    // regardless of what's stored, since its source isn't user-editable.
    buffSource: widget.kind === 'ally-buffs-builtin' ? 'ally' : widget.buffSource || 'self',
    // Coerced for the same reason customTimers and excludedBuffNames are, and it was the one
    // list field missing the guard. Share codes are pasted out of chat by design, and overlay.js
    // feeds this straight into a Set - a non-array throws there and takes the whole render with
    // it. On an ordinary aura that shows up as tiles that stop updating; on a sound-only aura it
    // is completely silent, with nothing on screen to notice missing.
    buffNames: Array.isArray(widget.buffNames) ? widget.buffNames : [],
    customTimers: Array.isArray(widget.customTimers) ? widget.customTimers : [],
    excludedBuffNames: Array.isArray(widget.excludedBuffNames) ? widget.excludedBuffNames : [],
    sortOrder: widget.sortOrder || 'default',
    lowTimeThresholdSec: typeof widget.lowTimeThresholdSec === 'number' ? widget.lowTimeThresholdSec : 30,
    landingGlowEnabled: widget.landingGlowEnabled !== false,
    mergeSameDuration: !!widget.mergeSameDuration,
    // !== false, so an aura saved before this field existed gets the borders too rather than
    // being the only one without them. That does change how existing auras LOOK on first launch
    // after upgrading, which is called out in TESTING.md rather than left as a surprise.
    categoryBordersEnabled: widget.categoryBordersEnabled !== false,
    trackOnEnemies: !!widget.trackOnEnemies,
    allyDebuffAlert: !!widget.allyDebuffAlert,
    textAuraMessage: typeof widget.textAuraMessage === 'string' ? widget.textAuraMessage : '',
    textAuraSize: typeof widget.textAuraSize === 'number' ? widget.textAuraSize : 32,
    // Clamped to the engine's own retention ceiling. A share code asking for five minutes would
    // otherwise produce an aura that silently shows its text for sixty seconds and no longer,
    // which looks like the setting not working rather than like a limit.
    textAuraInstantSec: clampInstantSec(widget.textAuraInstantSec),
    hideBardSongs: !!widget.hideBardSongs,
    timerTextColor: typeof widget.timerTextColor === 'string' ? widget.timerTextColor : '#f0f1f5',
    groupAllyBuffs: !!widget.groupAllyBuffs,
    groupAllyDirection: widget.groupAllyDirection === 'horizontal' ? 'horizontal' : 'vertical',
    hideAllyNameOnTile: !!widget.hideAllyNameOnTile,
    labelTextColor: typeof widget.labelTextColor === 'string' ? widget.labelTextColor : '#f0f1f5',
    iconMarginPx: typeof widget.iconMarginPx === 'number' ? widget.iconMarginPx : 5,
    maxDurationFilterSec: typeof widget.maxDurationFilterSec === 'number' ? widget.maxDurationFilterSec : 0,
    soundOnLand: !!widget.soundOnLand,
    soundOnExpire: !!widget.soundOnExpire,
    soundWarningSec: typeof widget.soundWarningSec === 'number' ? widget.soundWarningSec : 0,
    soundWarningLoopSec: typeof widget.soundWarningLoopSec === 'number' ? widget.soundWarningLoopSec : 0,
    landSoundId: typeof widget.landSoundId === 'string' ? widget.landSoundId : null,
    expireSoundId: typeof widget.expireSoundId === 'string' ? widget.expireSoundId : null,
    warningSoundId: typeof widget.warningSoundId === 'string' ? widget.warningSoundId : null,
    alertVolume: typeof widget.alertVolume === 'number' ? widget.alertVolume : 100,
    showRowIcon: !!widget.showRowIcon,
    mirrorRowDirection: !!widget.mirrorRowDirection,
    showIconLabel: !!widget.showIconLabel,
    iconLabelSize: typeof widget.iconLabelSize === 'number' ? widget.iconLabelSize : 11,
    iconLabelAnchor: widget.iconLabelAnchor || 'top-center',
    // Existing widgets saved before this field existed default to on for
    // the two "show everything" builtins (matches defaultSelfBuffsWidget/
    // defaultAllyBuffsWidget's own defaults for a fresh one) and off for
    // anything else - see defaultSelfBuffsWidget's comment for why.
    wrapText:
      typeof widget.wrapText === 'boolean'
        ? widget.wrapText
        : widget.kind === 'self-buffs-builtin' || widget.kind === 'ally-buffs-builtin',
    iconJustify: ['left', 'center', 'right'].includes(widget.iconJustify) ? widget.iconJustify : 'left',
    // Existing widgets saved before profiles existed default to just the
    // default profile - see defaultSelfBuffsWidget's comment on this field.
    activeProfileIds: Array.isArray(widget.activeProfileIds) ? widget.activeProfileIds : [DEFAULT_PROFILE_ID],
  };
}

// Ready-made text auras. Each returns the fields to overlay onto a fresh custom widget.
//
// The dispel announcer is the one the roadmap has listed as "not built yet" since the premade
// list was written. It is real now because the log line finally is: "You feel very dispelled."
// appears in the owner's own logs. The other two severities are inferred from the third-person
// forms, which DO all three appear ("feels dispelled", "feels a bit dispelled", "feels very
// dispelled") - so they are included, and TESTING.md says plainly which of the three is attested
// and which two are inference. A trigger that never matches costs nothing; a missing one means a
// real dispel goes unannounced.
//
// Three definitions, one tile: a text aura only ever draws one thing, and no single log line can
// match two of these anyway.
const TEXT_AURA_PRESETS = {
  // Note 17's red RESIST flash, at the 1.4 seconds she asked for.
  //
  // One trigger covers every spell rather than one per spell, because "resisted your " only ever
  // appears in the line the game writes when something YOU cast is resisted. Counted across
  // 1,521,971 log lines: 970 matches, every one of them that shape. The two lines that could be
  // confused with it are safely excluded - "You resist <Caster>'s <Spell>!" (761 lines, a resist
  // happening TO you) does not contain the phrase, and neither do the 11 third-party resists of
  // the form "<Mob> resisted <Someone>'s <Spell>!".
  //
  // Worth knowing it was checked: one line in those logs is a player typing the word "resisted"
  // in chat. It says "resisted my slows", not "resisted your", so it does not fire this.
  //
  // The 1.4 is her number, and it is honest to about a second: timers are swept once a second, so
  // the flash actually clears on the first tick after 1.4s - somewhere between 1.4 and 2.4 seconds
  // depending on where in the tick it landed. Left as 1.4 rather than rounded to 2, because the
  // sweep is what to change if that ever matters, not the number written here.
  resisted: () => ({
    buffSource: 'customTimer',
    textAuraMessage: 'RESISTED',
    textAuraSize: 48,
    customTimers: [
      {
        id: crypto.randomUUID(),
        name: 'Resisted',
        durationSec: 1.4,
        triggerText: 'resisted your ',
        triggerMatch: 'contains',
        endedText: '',
      },
    ],
  }),
  // Note 16 as Shara specified it on 21 August: a warning that somebody else has cast a debuff,
  // not a timer on one. It ships watching the mez and charm family because that is the case she
  // described - do not break a groupmate's mez - and the buff list is editable like any other
  // aura's, so adding slows or snares is a tick each.
  //
  // The message names the caster rather than saying "a party member", because half the
  // third-person mez and charm casts in her logs are mobs and the log line does not distinguish
  // them. See the comment on _alertAllyCast in buffEngine.
  allyCast: () => ({
    buffSource: 'ally',
    buffFilterMode: 'explicit',
    buffNames: ['Mesmerize', 'Mesmerization', 'Dazzle', 'Charm', 'Allure', 'Beguile', 'Cajoling Whispers'],
    allyDebuffAlert: true,
    textAuraMessage: '{caster} cast {spell} - careful',
    textAuraSize: 36,
    // Longer than the 6s default. This one is a warning about something that will still be true
    // in a few seconds, not a flash confirming something that already happened.
    textAuraInstantSec: 8,
  }),

  dispelled: () => ({
    buffSource: 'customTimer',
    textAuraMessage: 'DISPELLED',
    textAuraSize: 48,
    customTimers: [
      { id: crypto.randomUUID(), name: 'Dispelled', durationSec: 8, triggerText: 'You feel very dispelled.', endedText: '' },
      { id: crypto.randomUUID(), name: 'Dispelled', durationSec: 8, triggerText: 'You feel dispelled.', endedText: '' },
      { id: crypto.randomUUID(), name: 'Dispelled', durationSec: 8, triggerText: 'You feel a bit dispelled.', endedText: '' },
    ],
  }),
};

function defaultsForKind(kind, name) {
  if (kind === 'self-buffs-builtin') return defaultSelfBuffsWidget();
  if (kind === 'ally-buffs-builtin') return defaultAllyBuffsWidget(name);
  return defaultCustomWidget(name);
}

class WidgetStore {
  constructor(store) {
    this.store = store;
    this.data = this._loadOrMigrate();
  }

  // Reads the pre-widget single-overlay settings (overlaySettings.json /
  // overlayPosition.json) exactly once and seeds the "self-buffs" widget
  // from them, so an upgrading user's existing overlay position/mode/
  // enabled state carries over untouched. Left in place (not deleted) as a
  // harmless leftover / recovery safety net. On a genuinely fresh install
  // both files are absent, producing the same defaults the old
  // overlayWindow.js used.
  _loadOrMigrate() {
    const existing = this.store.loadJson('widgets', null);
    if (existing) {
      const data = { ...existing, widgets: existing.widgets.map(normalizeWidget) };
      // v1 -> v2: bard songs became opt-in rather than shown by default.
      // Version-gated so it runs exactly once - a user who later decides they
      // DO want songs shown must not have that choice stomped on every launch.
      // Needed because until now `isBardSong` was almost never set on the
      // roster (see bardSongTagger.js), so "show songs" was the de-facto
      // behaviour by accident rather than by choice.
      if (!data.version || data.version < 2) {
        for (const widget of data.widgets) widget.hideBardSongs = true;
        data.version = 2;
      }
      this.store.saveJson('widgets', data);
      return data;
    }

    const oldSettings = this.store.loadJson('overlaySettings', {});
    const oldPosition = this.store.loadJson('overlayPosition', null);

    const selfBuffs = defaultSelfBuffsWidget({
      enabled: oldSettings.enabled !== false,
      displayMode: oldSettings.displayMode === 'icons' ? 'icons' : 'list',
      position: oldPosition,
    });

    const data = { version: 2, widgets: [selfBuffs] };
    this.store.saveJson('widgets', data);
    return data;
  }

  _save() {
    this.store.saveJson('widgets', this.data);
  }

  getAll() {
    return this.data.widgets;
  }

  getById(id) {
    return this.data.widgets.find((w) => w.id === id) || null;
  }

  // buffSource is fixed at creation time (see main-window.js's "Custom
  // buff widget" vs "Custom timer widget" choice) - 'self' unless the
  // caller explicitly asks for 'customTimer'.
  // activeProfileIds override: a brand new widget should belong to whichever
  // loadout profile the user is actually ON right now, not always just
  // DEFAULT_PROFILE_ID - otherwise a widget added while on a non-default
  // profile silently isn't "active" on the profile you made it for. Callers
  // (widgetManager.js) pass the real current active profile; omitted only
  // by lower-level callers with no better answer (e.g. first-run migration,
  // when DEFAULT_PROFILE_ID truly is the only profile that exists yet).
  create(name, { buffSource, activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name);
    if (buffSource === 'customTimer') widget.buffSource = 'customTimer';
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  createAllyBuffs(name, { activeProfileIds } = {}) {
    const widget = defaultAllyBuffsWidget(name);
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // The "Sound only" premade - an ordinary custom widget that happens to start in
  // displayMode 'sound-only'. Deliberately NOT its own kind: see DISPLAY_MODES above.
  //
  // It starts SILENT, and that is the right default even though a premade that does nothing
  // out of the box looks unhelpful. buffFilterMode 'explicit' with an empty buffNames means it
  // watches nothing until the user picks something, matching how every other custom widget
  // fails closed. The alternative - filter mode 'all' with an expire sound on - would beep
  // every single time any buff anywhere ran out, which is a machine gun, not an alert. The
  // add-aura flow drops the user straight onto this widget's own settings page (focusWidget in
  // main-window.js), so "pick what it listens for" is the very next thing on screen.
  //
  // soundOnExpire is on so that the moment they pick a buff, it does the thing the aura is for
  // without a second trip into the Sounds section.
  // A TEXT AURA. Presets rather than free-form config, so the premade announcers and the blank
  // one both come through here and the IPC surface stays a name and a known string.
  //
  // Starts on 'self' buffs unless a preset says otherwise: the buff picker is immediately usable,
  // whereas an empty trigger list needs a trip through another dialog before it can do anything.
  // The source is switchable afterwards, including to text triggers, which is what makes this
  // able to watch everything any other aura can watch.
  createTextAura(name, { preset, activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name);
    widget.displayMode = 'text';
    if (preset && TEXT_AURA_PRESETS[preset]) Object.assign(widget, TEXT_AURA_PRESETS[preset](widget));
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // The "buff timer" premade (note 14) - one named spell, on you or on an ally, built rather than
  // configured by hand. There is no new detection here at all: both shapes were always supported
  // aura configurations, and this is purely a guided way to reach one.
  //
  // Deliberately built in ONE call rather than by chaining four setters from the renderer. Each
  // of those would be a separate IPC round trip that pushes a config change to the overlay, so
  // the aura would visibly assemble itself - source, then filter, then name - on screen.
  // source: 'self' | 'ally' | 'enemy'.
  //
  // 'enemy' is note 16's premade and is the same aura as 'ally' with the enemy switch already on -
  // an enemy debuff lands in the ally list, because "not you" is all the log line tells you. It is
  // a separate option here rather than a checkbox the user finds afterwards because the whole
  // point of a premade is not having to know that mez and Spirit of Wolf take the same route.
  createBuffTimer(name, { spellName, source, activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name || spellName || 'Buff timer');
    widget.buffSource = source === 'ally' || source === 'enemy' ? 'ally' : 'self';
    widget.trackOnEnemies = source === 'enemy';
    widget.buffFilterMode = 'explicit';
    widget.buffNames = spellName ? [spellName] : [];
    // One spell means one tile, so the four-wide grid a "show everything" aura wants would be
    // three empty columns. defaultCustomWidget already picks 1 for exactly this reason; this is
    // just being explicit that it matters here.
    widget.iconsPerRow = 1;
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  createSoundOnly(name, { activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name);
    widget.displayMode = 'sound-only';
    widget.soundOnExpire = true;
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // Timers are private to the widget they're defined on (see
  // defaultCustomWidget's customTimers field doc) - no shared pool, so no
  // separate timer store, just an array field on the widget itself.
  // buffNames is kept in sync automatically (not a separate user-facing
  // pick step) so the existing explicit-buffNames-filter rendering path in
  // overlay.js already isolates this widget's own timers out of the
  // engine's combined active list, with zero special-casing needed there.
  addCustomTimer(id, { name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch }) {
    const widget = this.getById(id);
    if (!widget) return null;
    const timer = {
      id: crypto.randomUUID(),
      name,
      durationSec,
      triggerText,
      endedText: endedText || undefined,
      // { channel, isSelf, name, message } - present only when this timer
      // was set up via the "Chat message" builder in main-window.js, so
      // re-opening it for editing can restore that same structured form
      // instead of falling back to raw-text mode. triggerText/endedText
      // above are what customTimerEngine.js actually matches against
      // either way - these are purely for the edit UI, matching logic
      // never reads them.
      triggerChat: triggerChat || undefined,
      endedChat: endedChat || undefined,
      // ?? not || - icon id 0 (the picker grid's first icon, a completely
      // real/valid choice) is falsy and would otherwise get silently
      // discarded as if no icon was picked.
      iconId: iconId ?? undefined,
      // 'contains' or undefined. See customTimerEngine._findTriggerMatches - for a game line with
      // a name in the middle of it, which no fixed string can ever equal. Left undefined rather
      // than defaulted to 'exact' so every timer already saved stays byte-identical.
      triggerMatch: triggerMatch === 'contains' ? 'contains' : undefined,
    };
    widget.customTimers = [...(widget.customTimers || []), timer];
    widget.buffNames = widget.customTimers.map((t) => t.name);
    this._save();
    return widget;
  }

  updateCustomTimer(id, timerId, { name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId }) {
    const widget = this.getById(id);
    if (!widget) return null;
    const timer = (widget.customTimers || []).find((t) => t.id === timerId);
    if (!timer) return null;
    timer.name = name;
    timer.durationSec = durationSec;
    timer.triggerText = triggerText;
    timer.endedText = endedText || undefined;
    timer.triggerChat = triggerChat || undefined; // see addCustomTimer's comment
    timer.endedChat = endedChat || undefined;
    timer.iconId = iconId ?? undefined; // see addCustomTimer's comment on why not ||
    widget.buffNames = widget.customTimers.map((t) => t.name);
    this._save();
    return widget;
  }

  removeCustomTimer(id, timerId) {
    const widget = this.getById(id);
    if (!widget) return null;
    widget.customTimers = (widget.customTimers || []).filter((t) => t.id !== timerId);
    widget.buffNames = widget.customTimers.map((t) => t.name);
    this._save();
    return widget;
  }

  // "Don't track on this widget" - scoped to just this one widget's 'all'
  // mode filter (see excludedBuffNames' field comment), not the separate
  // app-wide blockedBuffs list. Case-insensitive dedup, same as buffNames
  // elsewhere in this file.
  excludeBuff(id, name) {
    const widget = this.getById(id);
    if (!widget) return null;
    const list = widget.excludedBuffNames || [];
    if (!list.some((n) => n.toLowerCase() === name.toLowerCase())) {
      widget.excludedBuffNames = [...list, name];
      this._save();
    }
    return widget;
  }

  unexcludeBuff(id, name) {
    const widget = this.getById(id);
    if (!widget) return null;
    widget.excludedBuffNames = (widget.excludedBuffNames || []).filter(
      (n) => n.toLowerCase() !== name.toLowerCase()
    );
    this._save();
    return widget;
  }

  // Called by main.js when a loadout profile is deleted - membership
  // bookkeeping only (see activeProfileIds' field comment), so this just
  // strips the id from wherever it appears. A widget ending up with zero
  // profiles is fine, same as it starting with any particular set - it
  // just isn't "in" any profile's migration checklist until added again.
  removeProfileFromAllWidgets(profileId) {
    let changed = false;
    for (const widget of this.data.widgets) {
      if (widget.activeProfileIds.includes(profileId)) {
        widget.activeProfileIds = widget.activeProfileIds.filter((id) => id !== profileId);
        changed = true;
      }
    }
    if (changed) this._save();
  }

  update(id, patch) {
    const widget = this.getById(id);
    if (!widget) return null;
    Object.assign(widget, patch);
    this._save();
    return widget;
  }

  remove(id) {
    const widget = this.getById(id);
    if (!widget || widget.deletable === false) return false;
    this.data.widgets = this.data.widgets.filter((w) => w.id !== id);
    this._save();
    return true;
  }

  // Swaps a widget with its immediate neighbor in the stored array -
  // getAll()/the sidebar submenu both just render this.data.widgets in
  // array order, so this is the whole implementation of "reorder the
  // sidebar list." No-ops silently at either end rather than wrapping
  // around, since "move up" on the first widget doing nothing is the less
  // surprising behavior.
  move(id, direction) {
    const index = this.data.widgets.findIndex((w) => w.id === id);
    if (index === -1) return false;
    const targetIndex = index + (direction === 'up' ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= this.data.widgets.length) return false;
    const [widget] = this.data.widgets.splice(index, 1);
    this.data.widgets.splice(targetIndex, 0, widget);
    this._save();
    return true;
  }

  savePosition(id, position) {
    return this.update(id, { position });
  }

  saveSize(id, { width, height }) {
    return this.update(id, { width, height });
  }

  // Returns a copyable text code encoding this widget's look/filter
  // settings (see SHAREABLE_FIELDS) - null if the widget doesn't exist.
  // Kept short two ways: only fields that differ from a fresh default
  // widget are included at all (most exported widgets share most of their
  // settings with the default - a whole widget's worth of unchanged
  // sliders/toggles costs nothing), and the remaining JSON is
  // deflate-compressed before base64, not just base64 on its own. `kind`
  // rides along so importCode()/applyCodeToSelfBuffs() know which one this
  // code is for - Self Buffs is a singleton, so a code exported from it has
  // to be routed to overwrite the existing one, never to spawn a second.
  exportCode(id) {
    const widget = this.getById(id);
    if (!widget) return null;
    const defaults = defaultsForKind(widget.kind, widget.name);
    const payload = { name: widget.name, kind: widget.kind };
    for (const field of SHAREABLE_FIELDS) {
      if (field === 'name') continue;
      if (JSON.stringify(widget[field]) !== JSON.stringify(defaults[field])) payload[field] = widget[field];
    }
    const compressed = zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    return SHARE_CODE_PREFIX + compressed.toString('base64');
  }

  _decodeCode(code) {
    if (typeof code !== 'string' || !code.startsWith(SHARE_CODE_PREFIX)) return null;
    try {
      const compressed = Buffer.from(code.slice(SHARE_CODE_PREFIX.length), 'base64');
      const payload = JSON.parse(zlib.inflateRawSync(compressed).toString('utf8'));
      if (!payload || typeof payload.name !== 'string' || !payload.name.trim()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  // Decodes a code without applying it, so a caller (the import UI) can
  // tell whether it's a Self Buffs code - which needs a confirm-before-
  // overwrite prompt - before anything actually changes. Returns
  // { name, kind } or null for an invalid/foreign code.
  peekCode(code) {
    const payload = this._decodeCode(code);
    if (!payload) return null;
    const builtinKinds = ['self-buffs-builtin', 'ally-buffs-builtin'];
    const kind = builtinKinds.includes(payload.kind) ? payload.kind : 'custom';
    // displayMode is here so the Self Buffs confirm dialog can say what is actually about to
    // happen. A sound-only code applied to Self Buffs is a legitimate thing to want and a
    // catastrophic thing to do by accident: Self Buffs cannot be deleted, so an unexpected one
    // leaves the user staring at an empty screen with no obvious way back. A code carries only
    // its diff from the defaults, so an absent displayMode genuinely means 'list'.
    return { name: payload.name, kind, displayMode: normalizeDisplayMode(payload.displayMode) };
  }

  // Creates a brand-new widget from a code - never overwrites an existing
  // widget, and never trusts window placement/id from the code itself (see
  // SHAREABLE_FIELDS). Refuses a Self-Buffs-exported code here (use
  // applyCodeToSelfBuffs for those instead, there's only ever one Self
  // Buffs widget to apply it to) - an ally-buffs-builtin code is fine to
  // import as a new widget though, since unlike Self Buffs it was never a
  // singleton. Missing fields (anything equal to the default, so never
  // included in the first place) fall back to that kind's own defaults.
  // Returns the new widget, or null.
  // activeProfileIds isn't in SHAREABLE_FIELDS (see that list's comment -
  // same reasoning as id/position, it's local bookkeeping a share code
  // shouldn't carry) so it always comes from defaultsForKind's fallback
  // unless overridden here - same "belongs to whichever profile you're
  // actually on" reasoning as create()/createAllyBuffs() above. Used by
  // both a genuine import (someone else's code) and duplicateWidget()
  // (which is implemented as export+import of the same widget).
  importCode(code, { activeProfileIds } = {}) {
    const payload = this._decodeCode(code);
    if (!payload || payload.kind === 'self-buffs-builtin') return null;

    const name = payload.name.trim();
    const widget = defaultsForKind(payload.kind === 'custom' ? undefined : payload.kind, name);
    widget.id = crypto.randomUUID();
    for (const field of SHAREABLE_FIELDS) {
      if (field !== 'name' && payload[field] !== undefined) widget[field] = payload[field];
    }
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(normalizeWidget(widget));
    this._save();
    return this.getById(widget.id);
  }

  // Applies a code's settings directly onto the existing Self Buffs widget
  // instead of creating anything new - settings only, the name is fixed
  // and never touched. Caller is responsible for confirming with the user
  // first (see peekCode) since this overwrites in place. Works for a code
  // exported from either kind of widget, on the theory that "apply these
  // settings to my Self Buffs widget" is a reasonable thing to want either
  // way - the singleton-vs-new-widget routing only matters for import.
  applyCodeToSelfBuffs(code) {
    const payload = this._decodeCode(code);
    if (!payload) return null;
    const defaults = defaultSelfBuffsWidget();
    const patch = {};
    for (const field of SHAREABLE_FIELDS) {
      if (field === 'name') continue;
      patch[field] = payload[field] !== undefined ? payload[field] : defaults[field];
    }
    // This is the one import path that does NOT go through normalizeWidget - importCode()
    // creates a widget and normalizes it, while this one patches an existing one in place via
    // update(), which deliberately does not normalize (it is also the setter every settings
    // control uses, and re-normalizing on every slider drag would be waste).
    //
    // Only displayMode is guarded here rather than the whole patch, because it is the only
    // shareable field where an unrecognised value has no sensible rendering. A foreign mode
    // would leave Self Buffs drawing nothing with no visible reason why, and Self Buffs is the
    // one aura that cannot be deleted and recreated to escape it.
    patch.displayMode = normalizeDisplayMode(patch.displayMode);
    return this.update('self-buffs', patch);
  }
}

module.exports = {
  WidgetStore,
  DISPLAY_MODES,
  TEXT_AURA_PRESETS,
  normalizeDisplayMode,
  isSoundOnly,
  isTextAura,
  clampInstantSec,
  MAX_INSTANT_DISPLAY_SEC,
};
