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
// Note 9/17's custom-triggers rework, 24 Aug. Used to be one durationSec per trigger, editable in
// the Add/Edit Timer modal - which meant a widget with several triggers (the Dispelled premade's
// three severities, say) COULD have them silently drift out of sync with each other, and every
// aura also carried a second, separate "Show events for" slider that looked like it might also
// control duration but never did anything for a customTimer aura at all. Reported live: "there
// should never be two sources for this to ease confusion... the timer should be entirely top
// level... anything that needs a timer should have a slider that affects every trigger." One
// number per WIDGET now; every trigger on it always shares it.
const DEFAULT_TRIGGER_DURATION_SEC = 5;

// How long an AND-combine trigger stays "seen" before it has to be re-satisfied - see
// andWindowSec's own comment on defaultCustomWidget. 30s matches the old hardcoded
// AND_SEEN_HOLD_MS this setting replaces; the slider's own range (0-30) is the ceiling on how
// wide the owner asked this to ever go, not just the default.
const DEFAULT_AND_WINDOW_SEC = 30;
const MAX_AND_WINDOW_SEC = 30;

// How an aura presents itself.
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
//
// 'sound-only' EXISTED here (25 Aug) and was removed the same day: setTriggerDurationSec now
// accepts 0, so a Custom timer aura with a 0-second trigger and a raw log-line trigger already
// covers the same ground - a tile that flashes for under a second and beeps. The owner's call,
// verbatim: "that functionality of an entire sound aura will not be needed in future and can be
// removed." No migration for anyone who had one saved - normalizeDisplayMode's fallback to
// 'list' below now applies to it like any other unrecognised value, by design (see the AskUser
// exchange this removal came out of).
const DISPLAY_MODES = ['list', 'icons', 'text'];

function normalizeDisplayMode(mode) {
  return DISPLAY_MODES.includes(mode) ? mode : 'list';
}

// 1 to 60. The ceiling is not arbitrary: buffEngine keeps an instant for 60 seconds and no
// longer, so a larger number here would be a promise the engine cannot keep.
const MAX_INSTANT_DISPLAY_SEC = 60;

function clampInstantSec(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 6;
  return Math.min(MAX_INSTANT_DISPLAY_SEC, Math.max(1, Math.round(value)));
}

// Stacked-line text feed - "Lines visible". 2 to 4: 2 so the line before the newest is still
// readable, 4 so it stays an announcement rather than a scrolling combat log. A non-number (or a
// share code asking for more) lands on 2 rather than throwing a wall of text at the overlay.
const MIN_STACK_TEXT_LINES = 2;
const MAX_STACK_TEXT_LINES = 4;

function clampStackTextLines(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MIN_STACK_TEXT_LINES;
  return Math.min(MAX_STACK_TEXT_LINES, Math.max(MIN_STACK_TEXT_LINES, Math.round(n)));
}

// Per-aura sound cooldown (reported live 30 Aug): the shortest gap allowed between two alert
// sounds from one aura, so something that refreshes constantly (a bard song pulsing every 6s)
// does not beep every time. 0 = off (every alert plays); ceiling 60s.
function clampSoundCooldownSec(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(60, Math.max(0, Math.round(n)));
}

function isTextAura(widget) {
  return !!widget && widget.displayMode === 'text';
}

// Field values below (icon mode, size/position, sort/threshold, sounds-toggle state) match the
// owner's own live Self Buffs widget as of 25 Aug, at her request: "override the premade settings
// with the ones i have... screen position included." A fresh install (or a "Reset to default" on
// a widget that still traces back to this one) now lands on her actual working setup instead of
// the original placeholder layout. landSoundId/expireSoundId/warningSoundId are deliberately left
// alone (null) even though her own widget has a landSoundId set - that id names a file in HER
// customSounds folder specifically (see soundService.js), which would not exist on anyone else's
// install; shipping it as a default would silently point at a missing file. activeProfileIds is
// left alone for the same reason - her saved widget lists her own profile UUIDs, meaningless to a
// fresh install that has not created those profiles.
function defaultSelfBuffsWidget(overrides = {}) {
  return {
    id: 'self-buffs',
    kind: 'self-buffs-builtin',
    name: 'Self Buffs',
    deletable: false,
    enabled: true,
    displayMode: 'icons',
    timerFormat: 'rounded-minutes',
    textSize: 24,
    iconSize: 66,
    contentAnchor: DEFAULT_ANCHOR,
    iconsPerRow: 14,
    rowSize: 40,
    listWidth: 310,
    opacity: 1,
    width: 1018,
    height: 74,
    position: { x: 440, y: 4 },
    buffFilterMode: 'all',
    buffNames: [],
    // Only meaningful when buffFilterMode is 'all' (an "everything" mode
    // with no picked list to remove a name from) - a per-widget "don't
    // track this buff here" list, distinct from the separate app-wide
    // blocked-buffs feature (buffStore.js) which stops tracking a buff
    // everywhere. Set from this widget's own "Active on this widget" card
    // in main-window.js, never shared with any other widget.
    excludedBuffNames: ['Illusion: Dark Elf'],
    locked: true,
    sortOrder: 'time-remaining',
    lowTimeThresholdSec: 25,
    landingGlowEnabled: false,
    // Note 8 - see defaultCustomWidget's comment on this field.
    mergeSameDuration: false,
    // Note 37 - a coloured edge by what kind of spell it is. On by default, at the owner's
    // request, so it works without anyone going looking for it.
    categoryBordersEnabled: true,
    categoryBorderWidthPx: 1,
    // Notes 11/16/17. Watch the picked spells on the things you cast them AT rather than on your
    // group - mez, charm, snare, slow. Off by default and opt-in per aura on purpose: mob names
    // are not one word, so accepting them at all requires relaxing a check that exists to stop a
    // sentence being read as a landing, and doing that for every spell would mean 160,000 extra
    // landings across the owner's logs, 100,000 of them from two bard songs pulsing on everything
    // in range. Opting in per aura bounds it by what someone actually asked to see.
    trackOnEnemies: false,
    // Note 40. Only meaningful when trackOnEnemies is true. 'self' (default,
    // backward compatible) keeps the original behaviour - a watched debuff
    // only lands here while there's evidence the player herself cast it.
    // 'ally' drops that requirement: the same debuff on the same enemy, but
    // tracked the moment its third-person landing text appears, regardless
    // of who cast it. the owner's words: "just have it tracked that a debuff
    // happened from someone, it doesn't need a name" - so 'ally' mode never
    // records a caster, only that the debuff landed.
    debuffCastBy: 'self',
    // Note 16, answered by the owner on 21 August. A TEXT aura can warn that somebody else has cast
    // one of the spells it watches - "be careful", rather than a countdown on a debuff that is
    // not yours. She ruled out the timer herself: an ally's debuff has no ending line in the log,
    // so any duration shown for it would be invented, and "a text alert to be careful, and not a
    // standalone timer that may be inaccurate" is what she asked for instead.
    allyDebuffAlert: false,
    // Note 21. A text aura with nothing to watch, that simply says something and stays. Every
    // other aura is driven by a buff arriving; this one has no event at all, so without this the
    // overlay has nothing to build a tile from and draws an empty box for ever.
    alwaysOn: false,
    // Note 19, the damage meter's three settings. They live on the aura rather than in global
    // settings because two meters are a reasonable thing to want - one showing the whole group and
    // one showing only you - and a global setting would make that impossible.
    //
    // Ten seconds of no damage ends the fight. Every EQ parser picks a number here and every
    // number is somewhat wrong; a slow pull with a long pause in it reads as two fights, and a
    // fast chain of pulls reads as one. Settable rather than fixed because the right value depends
    // on what is being fought, which the app cannot know.
    fightTimeoutSec: 10,
    // Count only your own damage. Off by default on measurement, not taste: across the owner's
    // 1,521,971 logged lines her character deals 2,712 damage lines against roughly 346,000 from
    // everyone else, so a meter defaulting to "just mine" would be an almost empty box for her.
    mineOnly: false,
    // The leading row carrying the fight's total and its rate. The per-attacker rows below it
    // cannot show a rate - each attacker's own share of the elapsed time is not something the log
    // records - so this is where the number people actually quote comes from.
    showTotalRow: true,
    // Note 21's Risk, and it is the whole feature. An aura's visibility IS its profile membership,
    // so a label telling you WHICH profile is active would vanish the moment you switched to a
    // profile it was not a member of - exactly the situation it exists to help with. This makes it
    // a member of all of them, including ones created later, which a list of ids cannot do.
    showOnAllProfiles: false,
    // Note 38. Zone names this aura is limited to. EMPTY MEANS EVERYWHERE, and that polarity is
    // the whole safety argument: the app often cannot tell which zone you are in, because the only
    // line that says so is the one printed when you change zone. Start the app mid-session and the
    // expected wait for that line is about 55 minutes of play, with a five-hour case in these
    // logs. If unknown meant hidden, every zone-gated aura would vanish after a restart and stay
    // vanished, silently, with the app unable to say why. Unknown therefore means shown: a false
    // positive is visible and self-corrects the moment you zone, a false negative is invisible and
    // lasts a session.
    //
    // Zone strings are stored exactly as the game prints them, with no collapsing - the owner,
    // 22 August: "make them separate". "Befallen" and "Befallen 1 (Awakened)" are two entries, as are
    // "The Plane of Fear" and "The Plane of Fear - Group".
    visibleInZones: [],
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
    // Text auras only. When a second event arrives while an earlier one is still on screen, add it
    // as a new line below rather than silently replacing the text - a short scrolling fade feed.
    // Off by default, so every existing text aura (Resist flash, Dispelled, hand-built) behaves
    // exactly as it did before. Turned on for the Resist flash premade specifically (see the
    // `resisted` preset), where a burst of resists is the whole thing you want to see. See
    // overlay.js's renderTextFeed.
    stackTextLines: false,
    // How many stacked lines stay on screen at once before the oldest drops off. 2 by default -
    // enough to still read the line before the newest one, few enough that it stays an
    // announcement and not a combat log. Capped at 4 for the same reason.
    maxStackTextLines: 2,
    hideBardSongs: true,
    maxDurationFilterSec: 600,
    soundOnLand: false,
    soundOnExpire: false,
    soundWarningSec: 0, // 0 = off
    soundWarningLoopSec: 0, // 0 = warn once only, matches soundWarningSec's own "0 = off" convention
    soundCooldownSec: 0, // 0 = off - shortest gap between two alert sounds from this aura
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
    alertVolume: 10,
    // List mode only - an icon next to the progress bar, and which side
    // everything anchors to (icon + bar's "full" edge), see overlay.js.
    showRowIcon: true,
    mirrorRowDirection: false,
    // Icon mode only - an optional second text overlay showing the
    // buff/timer's name, with its own independent size/position controls
    // (iconLabelSize/iconLabelAnchor) mirroring how the "timer text" -
    // the formatted countdown - already has textSize/contentAnchor. Off
    // by default (top-center, distinct from the timer text's default
    // bottom-center, so enabling it doesn't start out overlapping).
    showIconLabel: true,
    iconLabelSize: 11,
    iconLabelAnchor: 'top-center',
    // Text colours for the two icon-mode text overlays and the list-mode
    // timer. A buff about to expire still overrides these with the reserved
    // danger colour (see overlay.js) - that warning must not be themeable
    // away.
    timerTextColor: '#ffffff',
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
    iconMarginPx: 2,
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
    iconJustify: 'center',
    // Text mode only. Reported live 24 Aug: "text only triggers however need a text
    // justification setting, left right and middle". A text tile is CSS white-space:nowrap and
    // shrink-wraps its window to exactly the words it's showing (see overlay.css's own comment on
    // why), so there's no fixed box for text-align to justify text WITHIN - every message already
    // fills its tile exactly. What actually varies is the tile's WIDTH itself, message to message
    // ("DISPELLED" vs "resisted your Denon's Dissension"), and the real question is which edge of
    // the window stays put while that happens. 'left' (default, the original/only behavior) keeps
    // the LEFT edge anchored and grows rightward - same direction icon/list mode already default
    // to. 'right' keeps the right edge anchored and grows left; 'center' grows both ways evenly.
    // Applied in overlay.js's reportSizeIfChanged, the same currentOriginX mechanism icon mode's
    // label-overflow margin already uses to keep a grid's on-screen position stable while its
    // window resizes - this is that same idea, just driven by the text's own measured width
    // instead of a fixed label margin.
    textJustify: 'left',
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
    // { id, name, durationSec, triggerText, endedText }[]. durationSec on each entry always
    // matches triggerDurationSec below - see setTriggerDurationSec's comment for why it's still
    // stored per-entry instead of being computed, even though it can never diverge.
    customTimers: [],
    // The one duration every trigger on this widget shares - see the constant's own comment.
    // Meaningless outside buffSource:'customTimer', same as customTimers itself.
    triggerDurationSec: DEFAULT_TRIGGER_DURATION_SEC,
    // How this widget's customTimers combine, when it has more than one. Reported live 25 Aug,
    // replacing the old per-timer "Extra conditions" all-of list - that lived inside ONE trigger's
    // edit modal, out of sight, and could only ever express "all of these lines together mean this
    // ONE trigger fired." The owner's ask was simpler and more visible: define several ordinary
    // triggers (already supported - see the "+ Add trigger" list) and choose how the SET of them
    // behaves.
    //   'independent' (default) - today's original behaviour, unchanged. Every trigger is its own
    //     instance; if two are true at once, two tiles show.
    //   'or' - still fires on any single trigger, but the whole widget shares ONE instance, so it
    //     can never show more than one tile even when several of its triggers are true at once.
    //   'and' - nothing fires until every trigger on the widget has been seen; one combined tile
    //     for the whole set, not one per trigger.
    // Meaningless with 0 or 1 triggers - see customTimerEngine.js for where this is read.
    triggerCombineMode: 'independent',
    // How long a trigger stays "seen" for AND-combine purposes once it matches a line - reported
    // live 25 Aug: "the window fo rboth triggers is 30 seconds?" confirmed yes, and it was a fixed
    // constant with no way to change it (customTimerEngine.js's old AND_SEEN_HOLD_MS). One number
    // per widget, not per trigger - the user's own ask was a single window "for both triggers", not
    // an independent clock on each one. Meaningless outside triggerCombineMode:'and'.
    andWindowSec: DEFAULT_AND_WINDOW_SEC,
    // Reverse detection ("negative triggers" in CLAUDE.md's backlog): shows this aura's tile ON
    // by default, then hides it for triggerDurationSec once whatever triggerCombineMode already
    // decides fires (one trigger, an AND set, or an OR set) - the opposite of the normal
    // off-until-triggered behaviour. Whole-aura, not per-trigger - the user's own ask, so that
    // combining it with AND ("stay on until both of these happen") is one checkbox next to the
    // combine-mode control, not a flag set on each individual trigger. See customTimerEngine.js
    // for the actual show/hide mechanics.
    reverseDetection: false,
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
    categoryBorderWidthPx: 1,
    // Notes 11/16/17. Watch the picked spells on the things you cast them AT rather than on your
    // group - mez, charm, snare, slow. Off by default and opt-in per aura on purpose: mob names
    // are not one word, so accepting them at all requires relaxing a check that exists to stop a
    // sentence being read as a landing, and doing that for every spell would mean 160,000 extra
    // landings across the owner's logs, 100,000 of them from two bard songs pulsing on everything
    // in range. Opting in per aura bounds it by what someone actually asked to see.
    trackOnEnemies: false,
    // Note 40. Only meaningful when trackOnEnemies is true. 'self' (default,
    // backward compatible) keeps the original behaviour - a watched debuff
    // only lands here while there's evidence the player herself cast it.
    // 'ally' drops that requirement: the same debuff on the same enemy, but
    // tracked the moment its third-person landing text appears, regardless
    // of who cast it. the owner's words: "just have it tracked that a debuff
    // happened from someone, it doesn't need a name" - so 'ally' mode never
    // records a caster, only that the debuff landed.
    debuffCastBy: 'self',
    // Note 16, answered by the owner on 21 August. A TEXT aura can warn that somebody else has cast
    // one of the spells it watches - "be careful", rather than a countdown on a debuff that is
    // not yours. She ruled out the timer herself: an ally's debuff has no ending line in the log,
    // so any duration shown for it would be invented, and "a text alert to be careful, and not a
    // standalone timer that may be inaccurate" is what she asked for instead.
    allyDebuffAlert: false,
    // Note 21. A text aura with nothing to watch, that simply says something and stays. Every
    // other aura is driven by a buff arriving; this one has no event at all, so without this the
    // overlay has nothing to build a tile from and draws an empty box for ever.
    alwaysOn: false,
    // Note 19, the damage meter's three settings. They live on the aura rather than in global
    // settings because two meters are a reasonable thing to want - one showing the whole group and
    // one showing only you - and a global setting would make that impossible.
    //
    // Ten seconds of no damage ends the fight. Every EQ parser picks a number here and every
    // number is somewhat wrong; a slow pull with a long pause in it reads as two fights, and a
    // fast chain of pulls reads as one. Settable rather than fixed because the right value depends
    // on what is being fought, which the app cannot know.
    fightTimeoutSec: 10,
    // Count only your own damage. Off by default on measurement, not taste: across the owner's
    // 1,521,971 logged lines her character deals 2,712 damage lines against roughly 346,000 from
    // everyone else, so a meter defaulting to "just mine" would be an almost empty box for her.
    mineOnly: false,
    // The leading row carrying the fight's total and its rate. The per-attacker rows below it
    // cannot show a rate - each attacker's own share of the elapsed time is not something the log
    // records - so this is where the number people actually quote comes from.
    showTotalRow: true,
    // Note 21's Risk, and it is the whole feature. An aura's visibility IS its profile membership,
    // so a label telling you WHICH profile is active would vanish the moment you switched to a
    // profile it was not a member of - exactly the situation it exists to help with. This makes it
    // a member of all of them, including ones created later, which a list of ids cannot do.
    showOnAllProfiles: false,
    // Note 38. Zone names this aura is limited to. EMPTY MEANS EVERYWHERE, and that polarity is
    // the whole safety argument: the app often cannot tell which zone you are in, because the only
    // line that says so is the one printed when you change zone. Start the app mid-session and the
    // expected wait for that line is about 55 minutes of play, with a five-hour case in these
    // logs. If unknown meant hidden, every zone-gated aura would vanish after a restart and stay
    // vanished, silently, with the app unable to say why. Unknown therefore means shown: a false
    // positive is visible and self-corrects the moment you zone, a false negative is invisible and
    // lasts a session.
    //
    // Zone strings are stored exactly as the game prints them, with no collapsing - the owner,
    // 22 August: "make them separate". "Befallen" and "Befallen 1 (Awakened)" are two entries, as are
    // "The Plane of Fear" and "The Plane of Fear - Group".
    visibleInZones: [],
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
    // Text auras only. Stack each new event as its own fading line instead of replacing the text -
    // see the field's own comment in defaultSelfBuffsWidget and overlay.js's renderTextFeed. Off
    // here; the Resist flash premade turns it on (TEXT_AURA_PRESETS.resisted).
    stackTextLines: false,
    maxStackTextLines: 2,
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
    textJustify: 'left', // meaningless here - neither builtin kind can be a text aura
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
// Size/position/icon-mode fields below match the owner's own live Ally Buffs widget as of 25 Aug -
// same "override the premade with what I have, screen position included" request as
// defaultSelfBuffsWidget above. landSoundId is left out for the same reason it's left out there:
// her widget's landSoundId names a file in HER customSounds folder, which would not exist on a
// fresh install.
function defaultAllyBuffsWidget(name) {
  return {
    ...defaultCustomWidget(name),
    kind: 'ally-buffs-builtin',
    displayMode: 'icons',
    buffFilterMode: 'all',
    buffSource: 'ally',
    width: 670,
    height: 68,
    position: { x: 154, y: 309 },
    textSize: 21,
    iconSize: 60,
    hideBardSongs: true,
    maxDurationFilterSec: 900,
    wrapText: true, // see defaultSelfBuffsWidget's comment
    iconsPerRow: 10, // see defaultCustomWidget's comment on why it's 1 there but not here
    showIconLabel: true,
    timerTextColor: '#ffffff',
    iconMarginPx: 2,
    groupAllyBuffs: true,
    groupAllyDirection: 'horizontal',
    categoryBorderWidthPx: 2,
  };
}

// The "Bard Songs" premade (backlog #15) - every bard song currently active ON THE PLAYER,
// regardless of who cast it, grouped by caster when buffEngine.js can tell (see
// _attributeBardSongCaster there), falling into an "Unknown" group otherwise. Deliberately NOT
// buffFilterMode:'all' + hideBardSongs/maxDurationFilterSec like Self/Ally Buffs above - those
// exist to let a picker-based aura EXCLUDE bard songs or long buffs, and neither concept applies
// here: this aura's whole content already is bard songs, unconditionally, with no picker at all
// (see overlay.js's visibleBuffs() bardSongs bypass). Same non-singleton, user-adds-it-on-demand
// shape as Ally Buffs, for the same reason - see that function's own comment.
// Size/position/icons-per-row match the owner's own live Bard Songs widget as of 25 Aug - same
// request as defaultSelfBuffsWidget/defaultAllyBuffsWidget above.
// The "Raid named" board (backlog #33). No picker, no source - the content is the current raid
// zone's named list, greyed as they die (see raidNamedTracker.js). A list, not icons: it reads as
// a checklist. Non-singleton, user-adds-it, same shape as Bard Songs / Ally Buffs.
function defaultRaidNamedWidget(name) {
  return {
    ...defaultCustomWidget(name),
    kind: RAID_NAMED_KIND,
    buffSource: 'raidNamed',
    displayMode: 'list',
    width: 220,
    height: 260,
    position: { x: 52, y: 120 },
    categoryBorderWidthPx: 0,
  };
}

function defaultBardSongsWidget(name) {
  return {
    ...defaultCustomWidget(name),
    kind: BARD_SONGS_KIND,
    buffSource: 'bardSongs',
    displayMode: 'icons',
    width: 270,
    height: 54,
    position: { x: 52, y: 418 },
    // On by default - the whole point of this aura is caster grouping, unlike Ally Buffs where
    // it's an opt-in extra. See main-window.js's SHAPE_FIELDS('bard-songs') for why the picker/
    // hide-bard-songs/track-others controls that would normally sit alongside this are absent
    // entirely rather than just left off.
    groupAllyBuffs: true,
    wrapText: true,
    iconsPerRow: 5,
    categoryBorderWidthPx: 2,
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
  'triggerDurationSec',
  'triggerCombineMode',
  'andWindowSec',
  'reverseDetection',
  'sortOrder',
  'lowTimeThresholdSec',
  'landingGlowEnabled',
  'mergeSameDuration',
  'categoryBordersEnabled',
  'categoryBorderWidthPx',
  'trackOnEnemies',
  'debuffCastBy',
  'allyDebuffAlert',
  'alwaysOn',
  'fightTimeoutSec',
  'mineOnly',
  'showTotalRow',
  'travelDestination',
  'showOnAllProfiles',
  'visibleInZones',
  'textAuraMessage',
  'textAuraSize',
  'textAuraInstantSec',
  'stackTextLines',
  'maxStackTextLines',
  'soundOnLand',
  'soundOnExpire',
  'soundWarningSec',
  'soundWarningLoopSec',
  'soundCooldownSec',
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
  'textJustify',
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
    // Clamped to the slider's own 8-28 range. The control was wired to the wrong DOM element for
    // a while (a shared id with the much larger text-aura message slider, 12-120), so a text aura
    // whose message size was dragged up also got its `textSize` pushed past 28 - harmless there
    // (a text aura draws no countdown) but wrong if the aura is ever switched to a tile mode.
    textSize: Math.min(
      28,
      Math.max(8, typeof widget.textSize === 'number' ? widget.textSize : LEGACY_TEXT_SIZE_PX[widget.textSize] || DEFAULT_TEXT_SIZE)
    ),
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
    // regardless of what's stored, since its source isn't user-editable;
    // raid-named-builtin the same, forcing 'raidNamed'.
    buffSource:
      widget.kind === 'ally-buffs-builtin'
        ? 'ally'
        : widget.kind === RAID_NAMED_KIND
          ? 'raidNamed'
          : widget.buffSource || 'self',
    // Coerced for the same reason customTimers and excludedBuffNames are, and it was the one
    // list field missing the guard. Share codes are pasted out of chat by design, and overlay.js
    // feeds this straight into a Set - a non-array throws there and takes the whole render with
    // it, showing up as tiles that simply stop updating.
    buffNames: Array.isArray(widget.buffNames) ? widget.buffNames : [],
    customTimers: Array.isArray(widget.customTimers) ? widget.customTimers : [],
    // A widget saved before this field existed still has its real duration sitting on its first
    // trigger (they were all in sync anyway on every real aura seen so far - see the field's own
    // comment) - read it from there rather than resetting everyone to the bare default. A widget
    // with no triggers yet, or no buffSource:'customTimer' at all, has nothing to read and gets
    // the default, same as a brand new one would.
    triggerDurationSec:
      typeof widget.triggerDurationSec === 'number'
        ? widget.triggerDurationSec
        : Array.isArray(widget.customTimers) && typeof widget.customTimers[0]?.durationSec === 'number'
          ? widget.customTimers[0].durationSec
          : DEFAULT_TRIGGER_DURATION_SEC,
    triggerCombineMode: ['independent', 'and', 'or'].includes(widget.triggerCombineMode)
      ? widget.triggerCombineMode
      : 'independent',
    andWindowSec:
      typeof widget.andWindowSec === 'number' && Number.isFinite(widget.andWindowSec)
        ? Math.max(0, Math.min(MAX_AND_WINDOW_SEC, Math.round(widget.andWindowSec)))
        : DEFAULT_AND_WINDOW_SEC,
    excludedBuffNames: Array.isArray(widget.excludedBuffNames) ? widget.excludedBuffNames : [],
    sortOrder: widget.sortOrder || 'default',
    lowTimeThresholdSec: typeof widget.lowTimeThresholdSec === 'number' ? widget.lowTimeThresholdSec : 30,
    landingGlowEnabled: widget.landingGlowEnabled !== false,
    mergeSameDuration: !!widget.mergeSameDuration,
    // !== false, so an aura saved before this field existed gets the borders too rather than
    // being the only one without them. That does change how existing auras LOOK on first launch
    // after upgrading, which is called out in TESTING.md rather than left as a surprise.
    categoryBordersEnabled: widget.categoryBordersEnabled !== false,
    // Note 37 follow-up - the edge itself was always a fixed 1px, reported live as "make it
    // wider" once the colour existed to see. 1 to 6: 1 matches every aura that predates this
    // field exactly (byte-identical look on upgrade), 6 is a deliberate ceiling - past that a
    // tile's own art starts disappearing under its own border rather than being framed by it.
    categoryBorderWidthPx:
      typeof widget.categoryBorderWidthPx === 'number'
        ? Math.max(1, Math.min(6, Math.round(widget.categoryBorderWidthPx)))
        : 1,
    trackOnEnemies: !!widget.trackOnEnemies,
    allyDebuffAlert: !!widget.allyDebuffAlert,
    alwaysOn: !!widget.alwaysOn,
    showOnAllProfiles: !!widget.showOnAllProfiles,
    // Fails open. A corrupted or absent value becomes "everywhere" rather than "nowhere", for the
    // reason in the field comment above - the polarity lives here so it cannot be got wrong by a
    // caller.
    visibleInZones: Array.isArray(widget.visibleInZones) ? widget.visibleInZones : [],
    textAuraMessage: typeof widget.textAuraMessage === 'string' ? widget.textAuraMessage : '',
    textAuraSize: typeof widget.textAuraSize === 'number' ? widget.textAuraSize : 32,
    // Clamped to the engine's own retention ceiling. A share code asking for five minutes would
    // otherwise produce an aura that silently shows its text for sixty seconds and no longer,
    // which looks like the setting not working rather than like a limit.
    textAuraInstantSec: clampInstantSec(widget.textAuraInstantSec),
    stackTextLines: !!widget.stackTextLines,
    maxStackTextLines: clampStackTextLines(widget.maxStackTextLines),
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
    soundCooldownSec: clampSoundCooldownSec(widget.soundCooldownSec),
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
    textJustify: ['left', 'center', 'right'].includes(widget.textJustify) ? widget.textJustify : 'left',
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
// One reserved kind, so there can only ever be one of these and nothing else can be mistaken for
// it. Exported because widgetManager decides visibility by kind and the renderer hides it from the
// delete button - three files have to agree on the string, so none of them should spell it.
const LOADOUT_LABEL_KIND = 'loadout-label-builtin';

// Same reasoning as LOADOUT_LABEL_KIND just above, exported for the same reason - main-window.js's
// widgetShape() needs to recognise it too, and 'ally-buffs-builtin'/'self-buffs-builtin' being bare
// repeated string literals in several files instead of a shared constant is this project's own
// stated lesson in that comment, not a pattern to repeat a third time.
const BARD_SONGS_KIND = 'bard-songs-builtin';
// Backlog #33 - the raid named-kill board. Like BARD_SONGS_KIND it has no buff picker and no
// source choice (its content is fixed: the current zone's named list), so it reuses the same
// settings-panel shape. Fed by raidNamedTracker.js, not buffEngine.
const RAID_NAMED_KIND = 'raid-named-builtin';

// The trigger modes customTimerEngine understands. Anything else is exact whole-line matching.
// Kept beside the store rather than in the engine because this is the list the store validates
// against, and a mode missing from HERE is a mode that silently stops working.
const TRIGGER_MATCH_MODES = ['contains', 'castOf', 'zoneEnter', 'zoneLeave'];

// Every scaleCategory:'charm' spell in the current roster (src/shared/data/buffs.json), for the
// "Charm broke" text-aura preset below. A snapshot, not derived live from the roster at build time
// - same convention allyCast's own hardcoded spell list already uses in this file, and for the
// same reason: this is a small, rarely-changing set, and reading the roster JSON from inside
// widgetStore.js would be a new coupling for a one-time list. If a new charm spell is ever added
// to the roster, add its name here too.
const CHARM_SPELL_NAMES = [
  'Allure', 'Allure of the Wild', 'Befriend Animal', 'Beguile', 'Beguile Animals',
  'Beguile Plants', 'Beguile Undead', 'Cajole Undead', 'Cajoling Whispers', 'Charm',
  'Charm Animals', 'Dominate Undead', "Solon's Bewitching Bravura", "Solon's Song of the Sirens",
];

// Backlog #36 - the "you can't act right now" text aura. { label, land, end } triples: `land` is
// the exact line the game writes when that control lands ON THE PLAYER, `end` a substring of the
// line when it lifts. Both drawn from the roster's own landingText/endedText for the charm / fear /
// root / snare / mez families plus what actually appears in the owner's logs ("You are stunned!" /
// "You are no longer stunned." 352/387 times, "You are ensnared." / "You have been entranced.").
// The game's universal "You are no longer X." fade wording makes `end` reliable; the per-timer
// `secs` is only a safety net for a missed fade line. Not exhaustive - mob-specific positional
// stuns and unusual roots won't all be here - but the trigger list is editable like any aura's.
const LOSS_OF_CONTROL = [
  { label: 'STUNNED', land: 'You are stunned!', end: 'You are no longer stunned.', secs: 10 },
  { label: 'STUNNED', land: 'You are stunned by a gust of air.', end: 'You are no longer stunned.', secs: 10 },
  { label: 'STUNNED', land: 'You are struck by a sudden force.', end: 'You are no longer stunned.', secs: 10 },
  { label: 'MESMERIZED', land: 'You have been entranced.', end: 'You are no longer entranced.', secs: 45 },
  { label: 'MESMERIZED', land: 'You are mesmerized.', end: 'You are no longer mesmerized.', secs: 45 },
  { label: 'CHARMED', land: 'You have been charmed.', end: 'You are no longer charmed.', secs: 45 },
  { label: 'CHARMED', land: 'You are captivated by the bewitching tune.', end: 'You are no longer captivated.', secs: 45 },
  { label: 'CHARMED', land: 'You are captivated by the haunting tune.', end: 'You are no longer captivated.', secs: 45 },
  { label: 'AFRAID', land: 'Your mind fills with fear.', end: 'You are no longer afraid.', secs: 30 },
  { label: 'AFRAID', land: 'Your mind snaps in terror.', end: 'You are no longer terrified.', secs: 30 },
  { label: 'ROOTED', land: 'Your feet adhere to the ground.', end: 'Your feet come free.', secs: 40 },
  { label: 'ROOTED', land: 'Your feet become entwined.', end: 'The roots fall from your feet.', secs: 40 },
  { label: 'SNARED', land: 'You are ensnared.', end: 'You are no longer ensnared.', secs: 40 },
  { label: 'SNARED', land: 'Your legs feel weak.', end: 'Strength returns to your legs.', secs: 40 },
  { label: 'SNARED', land: 'You slow down as your feet are covered in tangling weeds.', end: 'The tangling weeds wither away.', secs: 40 },
];

const TEXT_AURA_PRESETS = {
  // Note 17's red RESIST flash. Originally 1.4 seconds, her own number, raised to 5s at a later
  // request so the flash stayed readable rather than clearing on the sweep right after it
  // appeared - and settled at 4s (with width/height/position below) by 25 Aug, matching her own
  // live widget; see the "override the premade with what I have" note on defaultSelfBuffsWidget.
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
  // Timers are swept once a second, so any duration here clears on the first tick after it - 4s
  // means somewhere between 4 and 5 seconds in practice, not exactly 4.
  //
  // "Your {spell} was resisted by {mob}" - the wording settled on 25 Aug, once {mob} existed (see
  // overlay.js's textFor() comment) to name the resisting target as well as the resisted spell.
  // {spell} resolves to whatever the trigger's own "contains" match left over on the real line
  // (customTimerEngine's capturedText) - for "An imp protector resisted your Denon's Dissension!"
  // that's "Denon's Dissension". {mob} resolves the same way to the text BEFORE the match
  // ("An imp protector").
  resisted: () => ({
    buffSource: 'customTimer',
    textAuraMessage: 'Your {spell} was resisted by {mob}',
    textAuraSize: 48,
    // On by default here specifically: a resist rarely comes alone, and silently replacing the
    // previous line meant a three-resist burst looked identical to one. 2 lines so the resist
    // before the newest is still readable without it turning into a scrolling log.
    stackTextLines: true,
    maxStackTextLines: 2,
    triggerDurationSec: 4,
    width: 514,
    height: 81,
    position: { x: 919, y: 241 },
    customTimers: [
      {
        id: crypto.randomUUID(),
        name: 'Resisted',
        durationSec: 4,
        triggerText: 'resisted your ',
        triggerMatch: 'contains',
        endedText: '',
      },
    ],
  }),
  // Note 16 as the owner specified it on 21 August: a warning that somebody else has cast a debuff,
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

  // Message, duration and placement below match the owner's own live widget as of 25 Aug (was the
  // bare word "DISPELLED" at 8s, before she changed both) - see the "override the premade with
  // what I have" note on defaultSelfBuffsWidget.
  dispelled: () => ({
    buffSource: 'customTimer',
    textAuraMessage: 'You have been dispelled',
    textAuraSize: 48,
    triggerDurationSec: 4,
    width: 160,
    height: 56,
    position: { x: 875, y: 188 },
    customTimers: [
      { id: crypto.randomUUID(), name: 'Dispelled', durationSec: 4, triggerText: 'You feel very dispelled.', endedText: '' },
      { id: crypto.randomUUID(), name: 'Dispelled', durationSec: 4, triggerText: 'You feel dispelled.', endedText: '' },
      { id: crypto.randomUUID(), name: 'Dispelled', durationSec: 4, triggerText: 'You feel a bit dispelled.', endedText: '' },
    ],
  }),

  // "When your charmed target breaks" (25 Aug) - found directly in the owner's own log, per her
  // own instruction: "you can find the syntax in the logs." The generic game-wide wears-off
  // message - "Your <SpellName> spell has worn off of <Target>." - confirmed present for entirely
  // unrelated buffs too (Alacrity, Agility, Agilmente's Aria of Eagles all wearing off allies use
  // the identical template), so it isn't charm-specific text; what makes this a charm-break alert
  // is watching for it under every one of the roster's own charm-category spell names specifically
  // (CHARM_SPELL_NAMES below), same "completeness over perfect naming" reasoning as everywhere
  // else charm/mez spells get enumerated in this file (see allyCast's own list above).
  //
  // "contains" mode on "<name> spell has worn off of" (not the full line - the target name after
  // it varies) captures the remainder as {spell} via customTimerEngine's own capturedText
  // mechanism - the same token the Resist flash preset already uses for the same shape of capture,
  // just landing on the freed target's name here instead of a resisted spell's.
  // Placement below matches the owner's own live widget as of 25 Aug - see the "override the
  // premade with what I have" note on defaultSelfBuffsWidget.
  charmBroke: () => ({
    buffSource: 'customTimer',
    textAuraMessage: '{spell} has broken free!',
    textAuraSize: 40,
    triggerDurationSec: 6,
    width: 160,
    height: 48,
    position: { x: 898, y: 191 },
    customTimers: CHARM_SPELL_NAMES.map((name) => ({
      id: crypto.randomUUID(),
      name: 'Charm broke',
      durationSec: 6,
      triggerText: `${name} spell has worn off of`,
      triggerMatch: 'contains',
      endedText: '',
    })),
  }),

  // Backlog #36 - one text tile that shows what is stopping you acting (STUNNED / MESMERIZED /
  // CHARMED / AFRAID / ROOTED / SNARED) and clears when it lifts. The message is '{spell}', which
  // resolves to the firing timer's own name (see overlay.js textFor) - so the same aura shows the
  // right word for whichever control landed. Exact-match triggers (not 'contains'): every `land`
  // string here is a whole game line, and 'contains' on "stunned" would also catch "no longer
  // stunned". `endedText` is the primary clear; `durationSec` is the fallback if that line is
  // missed. Not stacked - the newest control replaces the line, which is the one you're under now.
  lossOfControl: () => ({
    buffSource: 'customTimer',
    textAuraMessage: '{spell}',
    textAuraSize: 48,
    triggerDurationSec: 40,
    customTimers: LOSS_OF_CONTROL.map((cc) => ({
      id: crypto.randomUUID(),
      name: cc.label,
      durationSec: cc.secs,
      triggerText: cc.land,
      endedText: cc.end,
    })),
  }),

  // Backlog #37 - "is my charmed pet fighting". A bard (Solon's Bewitching Bravura) or enchanter
  // (Charm / Beguile / Allure) charmed pet takes a new name every charm, so this can't key on a
  // pet name - it's a state readout off the pet's own speech lines, which ARE consistent:
  //   "<X> told you, 'Attacking <target> Master.'"      -> engaged (repeats on every target switch)
  //   "<X> says, 'Sorry, Master... calming down.'"       -> backed off
  //   "<X> says, '...That is not a legal target.'"       -> can't attack, still yours
  //   "Your <charm spell> spell has worn off of <mob>."  -> pet gone (same lines as charmBroke)
  // '{spell}' shows the firing timer's label. Short-ish durations so a stale state fades; the
  // engaged line re-fires constantly while the pet actually fights, keeping that tile alive.
  petStatus: () => ({
    buffSource: 'customTimer',
    textAuraMessage: '{spell}',
    textAuraSize: 44,
    triggerDurationSec: 30,
    customTimers: [
      { id: crypto.randomUUID(), name: 'PET ENGAGED', durationSec: 30, triggerText: ", 'Attacking ", triggerMatch: 'contains', endedText: '' },
      { id: crypto.randomUUID(), name: 'PET IDLE', durationSec: 20, triggerText: 'Sorry, Master... calming down.', triggerMatch: 'contains', endedText: '' },
      { id: crypto.randomUUID(), name: 'PET IDLE', durationSec: 20, triggerText: 'That is not a legal target.', triggerMatch: 'contains', endedText: '' },
      ...CHARM_SPELL_NAMES.map((name) => ({
        id: crypto.randomUUID(),
        name: 'PET GONE',
        durationSec: 6,
        triggerText: `${name} spell has worn off of`,
        triggerMatch: 'contains',
        endedText: '',
      })),
    ],
  }),
};

// Note 21, as the owner redirected it on 21 August: the loadout label is a global option, not
// something you build in Add Aura. "It should be a permanent option that is not tied to creating
// an aura."
//
// It is still a widget underneath, and that is deliberate rather than lazy: everything it needs -
// a position you can drag, locking, opacity, sizing, surviving a restart - already exists for
// widgets and would otherwise have to be written again for one label. What the owner asked for is
// where the SWITCH lives and that it is permanent, and both of those are true here. It never
// appears in Add Aura, it is created once the first time it is switched on, and switching it off
// hides it rather than deleting it, so its position is still there when it comes back.
function defaultLoadoutLabelWidget() {
  const widget = defaultCustomWidget('Loadout label');
  widget.kind = LOADOUT_LABEL_KIND;
  widget.displayMode = 'text';
  widget.buffSource = 'customTimer';
  widget.alwaysOn = true;
  widget.showOnAllProfiles = true;
  widget.textAuraMessage = '{profile}';
  widget.textAuraSize = 24;
  return widget;
}

function defaultsForKind(kind, name) {
  if (kind === LOADOUT_LABEL_KIND) return defaultLoadoutLabelWidget();
  if (kind === 'self-buffs-builtin') return defaultSelfBuffsWidget();
  if (kind === 'ally-buffs-builtin') return defaultAllyBuffsWidget(name);
  if (kind === BARD_SONGS_KIND) return defaultBardSongsWidget(name);
  if (kind === RAID_NAMED_KIND) return defaultRaidNamedWidget(name);
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
      // v2 -> v3: the Resist flash premade now ships with stacked text lines on (a burst of
      // resists reads as several fading lines rather than the last one silently replacing the
      // rest - see TEXT_AURA_PRESETS.resisted and overlay.js's renderTextFeed). Turn it on for
      // every Resist flash aura that already exists, at the owner's request ("update all existing
      // resist widgets, including my own"). Version-gated so a later "actually, off" choice is not
      // re-stomped every launch. A Resist flash aura is identified by its premade origin, or - if
      // that was lost - by a text aura carrying the preset's own "resisted your " trigger text.
      if (data.version < 3) {
        for (const widget of data.widgets) {
          const byOrigin =
            widget.premadeOrigin &&
            widget.premadeOrigin.kind === 'textAura' &&
            widget.premadeOrigin.preset === 'resisted';
          const byTrigger =
            widget.displayMode === 'text' &&
            Array.isArray(widget.customTimers) &&
            widget.customTimers.some(
              (t) => typeof t.triggerText === 'string' && t.triggerText.toLowerCase().includes('resisted your')
            );
          if (byOrigin || byTrigger) {
            widget.stackTextLines = true;
            widget.maxStackTextLines = clampStackTextLines(widget.maxStackTextLines);
          }
        }
        data.version = 3;
      }
      // v3 -> v4: the GCD / global-recovery tracker (backlog #38) was removed - the recovery is
      // ~1.5s and the overlay counts in whole seconds, so a correctly-timed tile only ever
      // flashed. Drop any aura built from that premade, and strip a stray gcdRecovery/anyCast
      // timer from anything else (there is no path that put one anywhere but a gcdTimer aura, but
      // an imported share code could carry one). Version-gated, so nothing to redo on later loads.
      if (data.version < 4) {
        data.widgets = data.widgets.filter(
          (w) => !(w.premadeOrigin && w.premadeOrigin.kind === 'gcdTimer')
        );
        for (const widget of data.widgets) {
          if (Array.isArray(widget.customTimers)) {
            widget.customTimers = widget.customTimers.filter(
              (t) => !t.gcdRecovery && t.triggerMatch !== 'anyCast'
            );
          }
        }
        data.version = 4;
      }
      this.store.saveJson('widgets', data);
      return data;
    }

    const oldSettings = this.store.loadJson('overlaySettings', {});
    const oldPosition = this.store.loadJson('overlayPosition', null);

    // Only override the built-in defaults (see defaultSelfBuffsWidget's own comment on those,
    // 25 Aug) when a REAL pre-widget-system install actually left these files behind - a
    // genuinely fresh install has neither, and should get the new defaults rather than have this
    // migration path silently reintroduce the old list/null layout it used to always pass here.
    const overrides = {};
    if (Object.keys(oldSettings).length > 0) {
      overrides.enabled = oldSettings.enabled !== false;
      overrides.displayMode = oldSettings.displayMode === 'icons' ? 'icons' : 'list';
    }
    if (oldPosition) overrides.position = oldPosition;

    const selfBuffs = defaultSelfBuffsWidget(overrides);

    const data = { version: 4, widgets: [selfBuffs] };
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
    widget.premadeOrigin = { kind: 'allyBuffs' };
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  createBardSongs(name, { activeProfileIds } = {}) {
    const widget = defaultBardSongsWidget(name);
    widget.premadeOrigin = { kind: 'bardSongs' };
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  createRaidNamed(name, { activeProfileIds } = {}) {
    const widget = defaultRaidNamedWidget(name);
    widget.premadeOrigin = { kind: 'raidNamed' };
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

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
    if (preset && TEXT_AURA_PRESETS[preset]) {
      Object.assign(widget, TEXT_AURA_PRESETS[preset](widget));
      // Only a PRESET counts as a premade for "Reset to default" - a blank Custom text aura (no
      // preset) has no recipe to reset back to, only whatever the user builds themselves.
      widget.premadeOrigin = { kind: 'textAura', preset };
    }
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
    widget.premadeOrigin = { kind: 'buffTimer', spellName, source };
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // Note 15. A countdown to when a spell can be cast again, rather than how long it lasts.
  //
  // cooldownSec is castSec + reuseSec, and the addition is not a fudge - it is measured. The
  // recast clock starts when a cast COMPLETES, not when it begins, and this timer starts on the
  // cast line because that is the only line guaranteed to appear. Promised Renewal has an 18s
  // recast and a 3s cast, and the gap between consecutive casts in the owner's logs peaks at
  // exactly 21s. Counting the recast alone would call the spell ready three seconds early, every
  // time - and it also explains the mined 21.5s figure that looked wrong against her in-game 18s:
  // it was recast plus cast all along.
  //
  // Editable afterwards, and that matters. Recast times are mined and are right most of the time
  // but not always - of two checked in game, one was wrong. This is a good default, not a fact.
  //
  // buffDurationSec, optional: the "Buff + cooldown" case (25 Aug) - a single tile that counts
  // down the BUFF's own active time first, then rolls straight into the recast cooldown without
  // resetting, using customTimerEngine's existing two-phase 'duration'->'cooldown' mechanism
  // (Note 10) - built here rather than as a new trigger type, since a spell that has both a real
  // buff duration and a real recast time is exactly this method's existing castOf shape with one
  // more field filled in. Omitted (undefined), this method is unchanged: a plain single-phase
  // recast countdown, same as the Cooldown timer premade has always built.
  createCooldownTimer(name, { spellName, cooldownSec, buffDurationSec, iconId, activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name || spellName || 'Cooldown');
    widget.buffSource = 'customTimer';
    widget.iconsPerRow = 1;
    const hasBuffDuration = typeof buffDurationSec === 'number' && buffDurationSec > 0;
    widget.customTimers = [
      {
        id: crypto.randomUUID(),
        name: spellName,
        // The buff's own length when tracking both phases; otherwise the recast countdown itself,
        // exactly as before.
        durationSec: hasBuffDuration ? buffDurationSec : cooldownSec,
        // The SPELL, not a line of text - see customTimerEngine's castOf mode. It is what makes
        // "You begin casting Cannibalize V." start the Cannibalize cooldown without also letting
        // "Fire" start on "Fire Bolt".
        triggerText: spellName,
        triggerMatch: 'castOf',
        endedText: '',
        iconId: iconId ?? undefined,
        // Note 10's phase-roll field. Undefined (not 0) when there's no second phase to roll
        // into - same reasoning as addCustomTimer's own cooldownSec field a few methods down:
        // a timer with no cooldown should stay byte-identical to one built before this option
        // existed.
        cooldownSec: hasBuffDuration ? cooldownSec : undefined,
      },
    ];
    widget.buffNames = [spellName];
    widget.premadeOrigin = { kind: 'cooldownTimer', spellName, cooldownSec, buffDurationSec, iconId };
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }


  // Note 20. The travel guide.
  //
  // Another plain custom aura, this time with buffSource 'travel'. The destination is the only
  // thing it needs from the user; where you are comes from the zone the app is already tracking
  // for note 38, and which travel spells you have comes from the spellbook it is already reading.
  createTravelGuide(name, { destination = '', activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name || 'Travel');
    widget.buffSource = 'travel';
    // The legs arrive in walking order. Any sort would shuffle the directions.
    widget.sortOrder = 'default';
    // A leg reads "Sail to Butcherblock Mountains", which is longer than a spell name.
    widget.listWidth = 280;
    widget.travelDestination = destination;
    // Nothing lands and nothing expires, so the glow has no event to fire on.
    widget.landingGlowEnabled = false;
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // Note 19. The damage meter.
  //
  // A plain custom aura with buffSource 'damage', not a new kind. That is the whole reason this
  // method is six lines: every setting an aura already has - row height, text size, colours,
  // anchor, opacity, dragging, per-loadout visibility, zone limits, share codes - applies to it
  // without any of them learning a new concept.
  createDamageMeter(name, { mineOnly = false, activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name || 'Damage');
    widget.buffSource = 'damage';
    // Rows arrive from damageEngine already sorted biggest-first. Any other order would re-sort
    // them by a time remaining they deliberately do not have, which would scramble them.
    widget.sortOrder = 'default';
    // Wider than the default: a row is a name, a number and a percentage, where an ordinary aura's
    // row is a name and a countdown.
    widget.listWidth = 260;
    widget.mineOnly = !!mineOnly;
    // Nothing lands and nothing expires, so the landing glow has no event to fire on and would
    // simply never run. Off explicitly rather than left on and inert, so the settings page does
    // not offer a switch that cannot do anything.
    widget.landingGlowEnabled = false;
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // The one loadout label, or null. There is never more than one - see ensureLoadoutLabel.
  getLoadoutLabel() {
    return this.data.widgets.find((w) => w.kind === LOADOUT_LABEL_KIND) || null;
  }

  // Created on first use rather than seeded for everyone, so someone who never turns it on never
  // has it in their widgets.json at all.
  ensureLoadoutLabel() {
    const existing = this.getLoadoutLabel();
    if (existing) return existing;
    const widget = defaultLoadoutLabelWidget();
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // Note 34's second half. the owner, 23 August: "buff AND debuff need their own custom templates.
  // add a debuff template."
  //
  // It is an ally-source aura with enemy watching already on, which is the combination nobody
  // would find by themselves: a debuff on a mob arrives as a landing on "not you", so it comes
  // through the ALLY list, and the enemy switch is what widens the recipient check enough to
  // accept a name like "a greater kobold". Two settings, in two different places, neither of them
  // obviously about debuffs. That is exactly what a template is for.
  //
  // The note was blocked on "real log samples for detrimental spells on this server - the land
  // line, the resist line and the worn-off line". All three have since been counted against
  // 1,521,971 lines, so the block is gone rather than waived.
  createDebuff(name, { activeProfileIds } = {}) {
    const widget = defaultCustomWidget(name);
    widget.buffSource = 'ally';
    widget.trackOnEnemies = true;
    if (activeProfileIds) widget.activeProfileIds = activeProfileIds;
    this.data.widgets.push(widget);
    this._save();
    return widget;
  }

  // The single duration every trigger on this widget shares - see the constant's own comment for
  // why this replaced a per-trigger field. Still WRITTEN onto every existing customTimers entry's
  // own durationSec (rather than only living on the widget and having customTimerEngine read it
  // from there) so the engine itself needs no changes at all - it already reads a timer's own
  // durationSec, and every trigger's copy simply never gets to disagree with the widget's any
  // more. A change here takes effect on every timer immediately, running or not - "a slider that
  // affects every trigger" was the explicit ask, not just future ones.
  setTriggerDurationSec(id, seconds) {
    const widget = this.getById(id);
    if (!widget) return null;
    // Garbage (NaN, a string) falls back to the default; a real number - including 0, which is
    // deliberately legitimate (a trigger that only has to make a noise, not stay on screen for
    // any length of time) - is clamped instead of treated as "unset". `|| DEFAULT` alone would
    // have mistaken a deliberate 0 for garbage too. Negative still floors at 0.
    const n = Number(seconds);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(3600, Math.round(n))) : DEFAULT_TRIGGER_DURATION_SEC;
    widget.triggerDurationSec = clamped;
    for (const timer of widget.customTimers || []) timer.durationSec = clamped;
    this._save();
    return widget;
  }

  // See the field's own comment on defaultCustomWidget for what each of the three modes means.
  // Whitelisted rather than passed through, same reasoning as triggerMatch below - a share code or
  // a stray IPC call with garbage here should fall back to the always-safe default rather than
  // leave the widget in a mode the engine does not recognise.
  setTriggerCombineMode(id, mode) {
    const widget = this.getById(id);
    if (!widget) return null;
    widget.triggerCombineMode = ['independent', 'and', 'or'].includes(mode) ? mode : 'independent';
    this._save();
    return widget;
  }

  // Reported live 25 Aug, after confirming the window really was a fixed, invisible 30s constant:
  // "place the trigger window timing below the add trigger button. allow it to be changable, 0-30
  // seconds... this should be doable for anything that supports AND Triggers." One number per
  // widget (not per trigger - the ask was a single window "for both triggers"), clamped the same
  // way every other duration-ish slider here is - a garbage/out-of-range value falls back to the
  // safe default rather than leaving AND combos silently using something nobody chose.
  setAndWindowSec(id, seconds) {
    const widget = this.getById(id);
    if (!widget) return null;
    const n = Number(seconds);
    widget.andWindowSec = Number.isFinite(n) ? Math.max(0, Math.min(MAX_AND_WINDOW_SEC, Math.round(n))) : DEFAULT_AND_WINDOW_SEC;
    this._save();
    return widget;
  }

  // See defaultCustomWidget's own comment on the field - whole-aura, not per-trigger.
  setReverseDetection(id, enabled) {
    const widget = this.getById(id);
    if (!widget) return null;
    widget.reverseDetection = !!enabled;
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
  addCustomTimer(id, { name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec }) {
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
      // Whitelisted rather than passed through, so a typo becomes plain exact matching instead of
      // a mode the engine does not recognise. 'castOf' was missing from this list while castOf
      // timers existed - the cooldown premade only worked because it writes the timer object
      // directly and never comes through here, so anything routed this way was silently
      // downgraded to exact and would never have fired.
      triggerMatch: TRIGGER_MATCH_MODES.includes(triggerMatch) ? triggerMatch : undefined,
      // Note 10. Seconds to count down AFTER the duration runs out, before the ability is ready
      // again. Undefined rather than 0 when unset, so a timer that has never used this stays
      // byte-identical to one written before the feature existed.
      cooldownSec: Number(cooldownSec) > 0 ? Number(cooldownSec) : undefined,
    };
    widget.customTimers = [...(widget.customTimers || []), timer];
    widget.buffNames = widget.customTimers.map((t) => t.name);
    this._save();
    return widget;
  }

  updateCustomTimer(
    id,
    timerId,
    { name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId, triggerMatch, cooldownSec }
  ) {
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
    // Reported live 24 Aug: this field was missing from this method's parameter list entirely, so
    // editing an existing timer silently left whatever triggerMatch it had from creation in place
    // no matter what the edit form actually showed - confirmed on a real saved timer, stuck at
    // 'contains' from its original raw-text creation after being edited into chat mode, which
    // synthesizes a whole line ("You say, '...'") that 'contains' matching against was never meant
    // to apply to. Same whitelist as addCustomTimer, for the same reason (a typo becomes plain
    // exact matching, not a mode the engine does not recognise) - always written, not left alone
    // like cooldownSec below, because every Save from the form computes a definite value for
    // the CURRENT mode (undefined in chat mode, 'contains' or undefined in raw mode) and should
    // fully replace whatever the timer had before, not merge with it.
    timer.triggerMatch = TRIGGER_MATCH_MODES.includes(triggerMatch) ? triggerMatch : undefined;
    // Only touched when the caller actually said something about it. An empty box sends 0 and
    // clears it, which is right; a caller that has never heard of the field leaves it alone, which
    // is also right. Rewriting unconditionally meant any code path not yet updated for a new field
    // would silently wipe it - the same shape of bug as the castOf drop above.
    if (cooldownSec !== undefined) {
      timer.cooldownSec = Number(cooldownSec) > 0 ? Number(cooldownSec) : undefined;
    }
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

  // "Reset to default", at the owner's request - only ever shown on an aura built from a premade,
  // for exactly the reason premadeOrigin exists: without a recorded recipe there is nothing to
  // reset BACK to, only a guess at what the user might have originally meant.
  //
  // Rebuilds the fields that premade sets, from the SAME defaults each creator above uses -
  // deliberately not just "restore a snapshot taken at creation time", because a snapshot would
  // also restore whatever the roster/icon data looked like back then. Re-running today's defaults
  // means a reset also picks up an icon added to the roster since, or a corrected recast time -
  // which is what "default" should mean for something built from a fixed recipe, not a frozen copy
  // of a moment in the past.
  //
  // id/name/position/width/height/activeProfileIds/visibleInZones/premadeOrigin itself are
  // explicitly carried over rather than reset - this restores the aura's BEHAVIOUR back to the
  // premade's defaults, not its place on screen, its profile membership, or its zone limits, none
  // of which the premade had an opinion on in the first place.
  resetToDefault(id) {
    const widget = this.getById(id);
    if (!widget || !widget.premadeOrigin) return false;
    const origin = widget.premadeOrigin;
    let fresh = null;
    if (origin.kind === 'allyBuffs') {
      fresh = defaultAllyBuffsWidget(widget.name);
    } else if (origin.kind === 'bardSongs') {
      fresh = defaultBardSongsWidget(widget.name);
    } else if (origin.kind === 'textAura' && TEXT_AURA_PRESETS[origin.preset]) {
      fresh = defaultCustomWidget(widget.name);
      fresh.displayMode = 'text';
      Object.assign(fresh, TEXT_AURA_PRESETS[origin.preset](fresh));
    } else if (origin.kind === 'buffTimer') {
      fresh = defaultCustomWidget(widget.name);
      fresh.buffSource = origin.source === 'ally' || origin.source === 'enemy' ? 'ally' : 'self';
      fresh.trackOnEnemies = origin.source === 'enemy';
      fresh.buffFilterMode = 'explicit';
      fresh.buffNames = origin.spellName ? [origin.spellName] : [];
      fresh.iconsPerRow = 1;
    } else if (origin.kind === 'cooldownTimer') {
      fresh = defaultCustomWidget(widget.name);
      fresh.buffSource = 'customTimer';
      fresh.iconsPerRow = 1;
      fresh.customTimers = [
        {
          id: crypto.randomUUID(),
          name: origin.spellName,
          durationSec: origin.cooldownSec,
          triggerText: origin.spellName,
          triggerMatch: 'castOf',
          endedText: '',
          iconId: origin.iconId ?? undefined,
        },
      ];
      fresh.buffNames = [origin.spellName];
    }
    if (!fresh) return false;
    const preserved = {
      id: widget.id,
      name: widget.name,
      position: widget.position,
      width: widget.width,
      height: widget.height,
      activeProfileIds: widget.activeProfileIds,
      visibleInZones: widget.visibleInZones,
      premadeOrigin: widget.premadeOrigin,
    };
    Object.assign(widget, fresh, preserved);
    this._save();
    return true;
  }

  // Replaced the up/down-arrow "move one step" control with drag-to-reorder, at the owner's
  // instruction - the arrows are gone from the sidebar entirely now. getAll()/the sidebar both
  // still just render this.data.widgets in array order, so reordering is still nothing more than
  // rearranging this one array; only how the new order arrives changed.
  //
  // Takes the FULL list of ids in their new order, from the renderer's drag handler, rather than a
  // single id and a target index - a drag already knows the whole resulting order, and recomputing
  // an index from a drop position here would be redoing work the browser's dragover math already
  // did, with more chances to get an off-by-one wrong.
  //
  // Defensive against a stale or partial list: any id in orderedIds that no longer exists is
  // silently skipped, and any widget NOT named in orderedIds keeps its relative position, appended
  // after the ones that were - so a reorder call built from a renderer snapshot that missed a
  // widget (one created by another window between render and drop, say) degrades to "did nothing
  // to the widget it didn't know about" rather than silently deleting it from the list.
  reorderWidgets(orderedIds) {
    const known = new Map(this.data.widgets.map((w) => [w.id, w]));
    const reordered = orderedIds.map((id) => known.get(id)).filter(Boolean);
    const placed = new Set(reordered.map((w) => w.id));
    const leftover = this.data.widgets.filter((w) => !placed.has(w.id));
    this.data.widgets = [...reordered, ...leftover];
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

  // Note 30. What a code IS, without doing anything with it. A code arriving from chat is text
  // another player typed, so the app needs to be able to say "Baxa sent a Resist flash aura"
  // before anyone decides anything - and reading is the only part of that which is safe to do
  // without being asked.
  peekCode(code) {
    const payload = this._decodeCode(code);
    if (!payload) return null;
    return { name: payload.name, kind: payload.kind || 'custom' };
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
    // happen - a code from before 'sound-only' was removed could still carry it, which
    // normalizeDisplayMode below silently turns back into 'list'. A code carries only its diff
    // from the defaults, so an absent displayMode genuinely means 'list'.
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
  LOADOUT_LABEL_KIND,
  BARD_SONGS_KIND,
  DISPLAY_MODES,
  TEXT_AURA_PRESETS,
  normalizeDisplayMode,
  isTextAura,
  clampInstantSec,
  clampSoundCooldownSec,
  MAX_INSTANT_DISPLAY_SEC,
  clampStackTextLines,
  MIN_STACK_TEXT_LINES,
  MAX_STACK_TEXT_LINES,
};
