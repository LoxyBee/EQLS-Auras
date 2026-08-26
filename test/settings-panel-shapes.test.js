'use strict';
/**
 * The additive settings-panel model (25 Aug rework).
 *
 * Reported live: "it is not a shortcut, it's a custom, and needs to be recatagorised" (about Ally
 * Buffs in the Add Aura list) led into "can you wire everything in to make sure it does NOT break
 * anything?" about the per-aura SETTINGS panel - the page you land on after selecting an aura,
 * with cards like "Buffs shown", "Display & size", "Configuration".
 *
 * Before this, three places (updateDisplayModeVisibility, a block inline in selectWidget, half of
 * renderBuffFilter) each independently decided whether a row/card applied to the current aura,
 * using their own isTextAura/isSoundOnly/announcer booleans - SUBTRACTIVE: build the whole
 * buff-aura panel, hide what doesn't apply. That's the exact shape of bug CLAUDE.md already
 * documents twice (the old "Extra conditions" section buried where nobody would look; Damage
 * parser/Travel guide still showing a picker and a "Watching:" row that mean nothing for either).
 *
 * This file is additive instead: widgetShape(widget) resolves one of ten shapes, and
 * SHAPE_FIELDS lists exactly which optional rows/cards each shape gets. Every OTHER test file that
 * used to pin a specific isTextAura/isSoundOnly boolean expression now pins its own corner of this
 * table (see ally-cast-alert, category-borders, enemy-debuffs, merged-tiles, profile-label,
 * text-aura, text-justify .test.js). This file is the one place that checks the WHOLE
 * table at once, in both directions - because the gap those per-feature tests cannot see is a
 * field silently missing from a shape nothing else happens to assert about. Confirmed the hard way
 * during this rework: removing 'ally-grouping' from 'custom-buff' passed the entire suite until
 * this file existed to catch it - every other test only ever checked EXCLUSION from shapes that
 * shouldn't have a field, never INCLUSION for the shapes that should.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const rendererSrc = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8')
  .replace(/\r\n/g, '\n');

// Pulls widgetShape(widget) and SHAPE_FIELDS out and runs them for real, rather than regex-testing
// their source text - this file's whole point is checking the DATA, not the code shape.
function loadShapeLogic() {
  const shapeFn = rendererSrc.match(/function widgetShape\(widget\) \{[\s\S]*?\n {2}\}/);
  assert.ok(shapeFn, 'widgetShape has been renamed or restructured - this suite cannot run');
  const tableSrc = rendererSrc.match(/const SHAPE_FIELDS = \{[\s\S]*?\n {2}\};/);
  assert.ok(tableSrc, 'SHAPE_FIELDS has been renamed or restructured - this suite cannot run');
  // eslint-disable-next-line no-new-func
  return new Function(`${shapeFn[0]}\n${tableSrc[0]}\nreturn { widgetShape, SHAPE_FIELDS };`)();
}

const { widgetShape, SHAPE_FIELDS } = loadShapeLogic();

const ALL_SHAPES = [
  'self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'ally-alert', 'text',
  'text-customTimer', 'custom-timer', 'damage', 'travel',
];

// ---------------------------------------------------------------------------
// widgetShape() dispatch - one representative widget per shape
// ---------------------------------------------------------------------------

const REPRESENTATIVES = {
  'self-buffs': { kind: 'self-buffs-builtin' },
  'ally-buffs': { kind: 'ally-buffs-builtin', buffSource: 'ally' },
  'bard-songs': { kind: 'bard-songs-builtin', buffSource: 'bardSongs' },
  'custom-buff': { kind: 'custom', buffSource: 'self', displayMode: 'icons' },
  'custom-debuff': { kind: 'custom', buffSource: 'ally', trackOnEnemies: true, displayMode: 'list' },
  'ally-alert': { kind: 'custom', buffSource: 'ally', allyDebuffAlert: true, displayMode: 'text' },
  'text': { kind: 'custom', buffSource: 'self', displayMode: 'text' },
  'text-customTimer': { kind: 'custom', buffSource: 'customTimer', displayMode: 'text' },
  'custom-timer': { kind: 'custom', buffSource: 'customTimer', displayMode: 'icons' },
  'damage': { kind: 'custom', buffSource: 'damage', displayMode: 'list' },
  'travel': { kind: 'custom', buffSource: 'travel', displayMode: 'list' },
};

test('every shape has exactly one representative widget that resolves to it', () => {
  for (const shape of ALL_SHAPES) {
    const widget = REPRESENTATIVES[shape];
    assert.ok(widget, `no representative widget for shape "${shape}"`);
    assert.equal(widgetShape(widget), shape, `this representative resolves to the wrong shape`);
  }
});

test('every entry in SHAPE_FIELDS is a real, known shape - no dead or misspelled key', () => {
  const keys = Object.keys(SHAPE_FIELDS);
  assert.deepEqual(keys.sort(), [...ALL_SHAPES].sort(), 'SHAPE_FIELDS and the shape list have drifted apart');
});

test('kind wins over everything - the three builtins can never be read as any other shape', () => {
  assert.equal(widgetShape({ kind: 'self-buffs-builtin', buffSource: 'damage', displayMode: 'text' }), 'self-buffs');
  assert.equal(widgetShape({ kind: 'ally-buffs-builtin', trackOnEnemies: true, displayMode: 'text' }), 'ally-buffs');
  assert.equal(widgetShape({ kind: 'bard-songs-builtin', trackOnEnemies: true, displayMode: 'text' }), 'bard-songs');
});

test('damage/travel win over display mode and trackOnEnemies - a standalone tool is never anything else', () => {
  assert.equal(widgetShape({ kind: 'custom', buffSource: 'damage', displayMode: 'text' }), 'damage');
  assert.equal(widgetShape({ kind: 'custom', buffSource: 'travel', trackOnEnemies: true }), 'travel');
});

test('allyDebuffAlert only creates its own shape on a text aura, not a list/icon one', () => {
  // The premade this exists for (allyCast) is always built as a text aura, and nothing else sets
  // allyDebuffAlert - on any other display mode it is simply not read.
  assert.equal(widgetShape({ kind: 'custom', buffSource: 'ally', allyDebuffAlert: true, displayMode: 'icons' }), 'custom-buff');
});

// ---------------------------------------------------------------------------
// Full field-membership matrix - the actual safety net
// ---------------------------------------------------------------------------

// One row per field this table drives, each naming EVERY shape that must include it. Everything
// not listed for a field is asserted to exclude it. Kept as an explicit allow-list (not derived
// from SHAPE_FIELDS itself) so a shape silently losing a field it should have shows up as a
// mismatch here, the same way the 'ally-grouping' regression that motivated this file would have.
const FIELD_SHAPES = {
  // damage/travel deliberately exclude 'display-choice' (and 'buff-source'/'buff-picker' below) -
  // CLAUDE.md's own words on this: "hiding the *rest* of the panel for these two kinds (Buffs
  // shown, the source row, the display-mode radios that mean nothing for either)". sort/merge/
  // borders/timer-text/opacity/position/alerts are left AS THEY WERE for these two - CLAUDE.md
  // scoped the fix to those three specifically, not everything a buff tile also has.
  'display-choice': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'custom-timer'],
  'sort': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'custom-timer', 'damage', 'travel'],
  'merge': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'custom-timer', 'damage', 'travel'],
  'borders': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'custom-timer', 'damage', 'travel'],
  'timer-text': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'custom-timer', 'damage', 'travel'],
  'opacity': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'ally-alert', 'text', 'text-customTimer', 'custom-timer', 'damage', 'travel'],
  'position': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'ally-alert', 'text', 'text-customTimer', 'custom-timer', 'damage', 'travel'],
  'alerts': ['self-buffs', 'ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff', 'ally-alert', 'text', 'text-customTimer', 'custom-timer', 'damage', 'travel'],
  'text-fields': ['ally-alert', 'text', 'text-customTimer'],
  'text-instant': ['ally-alert', 'text'],
  'ally-alert-toggle': ['ally-alert', 'text', 'text-customTimer'],
  'always-on': ['ally-alert', 'text', 'text-customTimer'],
  'buff-source': ['custom-buff', 'ally-alert' /* excluded below on purpose - see the note */, 'text', 'text-customTimer'],
  'buff-source-timer-label': ['text', 'text-customTimer'],
  'debuff-cast-by': ['custom-debuff'],
  'buff-picker': ['custom-buff', 'custom-debuff', 'ally-alert', 'text'],
  'self-buffs-filter': ['self-buffs', 'ally-buffs'],
  'custom-timers': ['text-customTimer', 'custom-timer'],
  // bard-songs deliberately does NOT get 'self-buffs-filter' (no picker - this aura's whole
  // content already is bard songs, unconditionally) or 'track-others' (global engine state, not
  // per-widget, already lives on Self Buffs) - only the grouping it was actually built for.
  'ally-grouping': ['ally-buffs', 'bard-songs', 'custom-buff', 'custom-debuff'],
  'track-others': ['self-buffs'],
  'damage-settings': ['damage'],
  'travel-settings': ['travel'],
};
// 'buff-source' is the one field with a real, deliberate exception baked into the design: an
// ally-cast-alert aura's buffSource:'ally' is plumbing (see widgetShape's own comment history),
// not a real "Watching:" choice, so 'ally-alert' is REMOVED from its allow-list here on purpose -
// left in the object literal above as a comment-in-place rather than silently absent, so a future
// reader sees the exclusion was considered, not missed.
FIELD_SHAPES['buff-source'] = FIELD_SHAPES['buff-source'].filter((s) => s !== 'ally-alert');

test('every field is present on exactly the shapes that should have it, and absent from every other', () => {
  for (const [field, expectedShapes] of Object.entries(FIELD_SHAPES)) {
    for (const shape of ALL_SHAPES) {
      const has = new Set(SHAPE_FIELDS[shape] || []).has(field);
      const shouldHave = expectedShapes.includes(shape);
      assert.equal(
        has, shouldHave,
        `field "${field}" on shape "${shape}": expected ${shouldHave ? 'present' : 'absent'}, got ${has ? 'present' : 'absent'}`
      );
    }
  }
});

test('no shape has a field this table does not know about - a typo would otherwise render as nothing', () => {
  const knownFields = new Set(Object.keys(FIELD_SHAPES));
  for (const [shape, fields] of Object.entries(SHAPE_FIELDS)) {
    for (const field of fields) {
      assert.ok(knownFields.has(field), `shape "${shape}" uses unrecognised field "${field}" - typo, or this test needs updating`);
    }
  }
});

// ---------------------------------------------------------------------------
// The wiring - applySettingsPanelShape/renderBuffFilter have to actually be called with a fresh
// Set every time something could have changed the shape, or the table above is correct in theory
// and disconnected in practice.
// ---------------------------------------------------------------------------

test('selectWidget computes the shape once and hands the same Set to renderBuffFilter', () => {
  const fn = rendererSrc.match(/function selectWidget\(id\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'selectWidget has been restructured');
  assert.match(fn[1], /const shapeFields = applySettingsPanelShape\(widget\);/, 'the shape is not computed here at all');
  assert.match(fn[1], /renderBuffFilter\(widget, shapeFields\);/, 'renderBuffFilter is given its own, possibly different, Set');
});

test('filterCard\'s own visibility is driven by the same fields renderBuffFilter was handed', () => {
  const fn = rendererSrc.match(/function renderBuffFilter\(widget, fields\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBuffFilter has been restructured');
  assert.match(
    fn[1],
    /filterCard\.style\.display = fields\.has\('self-buffs-filter'\) \|\| fields\.has\('buff-picker'\) \? '' : 'none';/,
    'filterCard no longer agrees with the shape that was actually computed'
  );
});

test('switching buffSource re-derives the shape from the fresh widget, not the stale one', () => {
  const fn = rendererSrc.match(/buffSourceRadios\.forEach\(\(radio\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the buffSourceRadios listener has been restructured');
  assert.match(
    fn[1],
    /renderBuffFilter\(widget, applySettingsPanelShape\(widget\)\);/,
    'ally-grouping (etc.) would silently keep the OLD source\'s visibility'
  );
});

test('switching display mode re-derives the shape synchronously, from real widget data - not a bare guess', () => {
  // The old code called updateDisplayModeVisibility(radio.value) with ONE argument, so buffSource
  // was always undefined inside it - harmless only because these radios are unreachable on any
  // shape where buffSource would have mattered to the outcome. This pins that the replacement
  // reads the rest of the widget's real fields rather than repeating that landmine under a new
  // name.
  const fn = rendererSrc.match(/displayModeRadios\.forEach\(\(radio\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the displayModeRadios listener has been restructured');
  assert.match(fn[1], /const current = findWidget\(selectedId\);/);
  assert.match(fn[1], /applySettingsPanelShape\(current \? \{ \.\.\.current, displayMode: radio\.value \} : \{ displayMode: radio\.value \}\);/);
});

module.exports = () => report('settings-panel-shapes');
if (require.main === module) report('settings-panel-shapes').then((n) => process.exit(n ? 1 : 0));
