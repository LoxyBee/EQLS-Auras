'use strict';
/**
 * Note 37 - a coloured edge on each tile saying what kind of spell it is.
 *
 * This note was sized at several days and marked as needing work nobody wanted to do: the app had
 * no idea what type any spell was, and finding out meant re-mining the game's binary spell files,
 * field position by field position, on a custom server where every position had to be verified by
 * hand. The roster rebuild made that unnecessary - every entry now carries the category the
 * spreadsheet supplied - so what is left is choosing colours and drawing a border.
 *
 * The failure this suite mostly exists to prevent is a QUIET one. The colours live in CSS keyed
 * by category name; the categories come from the roster. If those two lists ever drift apart, the
 * affected spells simply lose their border and nothing anywhere says so. So the test compares
 * three separate lists against each other: what the roster actually contains, what the overlay is
 * willing to colour, and what the stylesheet has a colour for.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const engineSrc = read('src', 'main', 'buffEngine.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

/** Lifts the overlay's category-to-class decision out and makes it callable. */
function loadBorders() {
  const pick = (re, what) => {
    const m = overlaySrc.match(re);
    assert.ok(m, `${what} has been renamed or restructured - this suite cannot run`);
    return m[0];
  };
  const parts = [
    'let currentConfig = {};',
    pick(/const CATEGORY_CLASSES = new Set\(\[[^\]]*\]\);/, 'CATEGORY_CLASSES'),
    pick(/function applyCategoryBorder\(root, buff\) \{[\s\S]*?\n\}/, 'applyCategoryBorder'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function(
    `${parts.join('\n\n')}
     return {
       applyCategoryBorder,
       classes: [...CATEGORY_CLASSES],
       setConfig: (c) => { currentConfig = c; },
     };`
  )();
}

const B = loadBorders();

/** Just enough of an element for classList.add. */
const fakeEl = () => {
  const set = new Set();
  return { classes: set, classList: { add: (...c) => c.forEach((x) => set.add(x)) } };
};

/** Categories that actually appear on a shipped roster entry, ignoring the "no type" one. */
const rosterCategories = [
  ...new Set(roster.map((e) => e.scaleCategory).filter((c) => c && c !== 'none')),
].sort();

/** Categories the stylesheet has a colour for. */
const cssCategories = [...overlayCss.matchAll(/\.cat-([a-z]+)\s*\{\s*--cat-color:/g)]
  .map((m) => m[1])
  .sort();

// ---------------------------------------------------------------------------
// The three lists must agree
// ---------------------------------------------------------------------------

test('every entry in the roster carries a category to colour by', () => {
  const missing = roster.filter((e) => typeof e.scaleCategory !== 'string');
  assert.deepEqual(missing.map((e) => e.name), [], 'these roster entries have no scaleCategory');
  assert.ok(roster.length > 1000, `suspiciously small roster: ${roster.length}`);
});

test('the overlay is willing to colour exactly the categories the roster uses', () => {
  // A category in the roster that the overlay does not recognise loses its border silently.
  assert.deepEqual(
    [...B.classes].sort(), rosterCategories,
    'the overlay category list and the roster have drifted apart'
  );
});

test('every category the overlay colours has a colour in the stylesheet', () => {
  // And the other direction: a class with no rule sets an undefined custom property, which is not
  // an error anywhere - the border just quietly does not change.
  assert.deepEqual(cssCategories, [...B.classes].sort(), 'the stylesheet and the overlay disagree');
});

test('no two categories share a colour', () => {
  // Two categories the same colour is a legend that lies. Worth checking rather than eyeballing.
  const colours = [...overlayCss.matchAll(/\.cat-[a-z]+\s*\{\s*--cat-color:\s*(#[0-9a-f]{6})/g)]
    .map((m) => m[1].toLowerCase());
  assert.equal(colours.length, cssCategories.length, 'a category colour is not a plain hex value');
  assert.equal(new Set(colours).size, colours.length, `duplicate colours: ${colours.join(', ')}`);
});

test('damage and healing differ in lightness, not only in hue', () => {
  // Red against green is the one pair a large share of colour-blind players cannot separate, and
  // it is exactly the pair that was asked for. The hues stay; the mitigation is that the four
  // damage/heal colours also differ as greys, so they remain distinguishable without hue.
  const colourOf = (cat) => {
    const m = overlayCss.match(new RegExp(`\\.cat-${cat}\\s*\\{\\s*--cat-color:\\s*#([0-9a-f]{6})`));
    assert.ok(m, `no colour for ${cat}`);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // The over-time forms are the dark ones, their instant forms the light ones.
  assert.ok(colourOf('nuke') - colourOf('dot') > 40, 'damage and damage-over-time read as one grey');
  assert.ok(colourOf('heal') - colourOf('hot') > 40, 'healing and healing-over-time read as one grey');
});

// ---------------------------------------------------------------------------
// The decision itself
// ---------------------------------------------------------------------------

test('a spell with a category gets its class, and the shared one too', () => {
  B.setConfig({ categoryBordersEnabled: true });
  const el = fakeEl();
  B.applyCategoryBorder(el, { spellCategory: 'heal' });
  assert.ok(el.classes.has('cat'), 'the shared class carries the border rule itself');
  assert.ok(el.classes.has('cat-heal'), 'the per-category class carries the colour');
});

test('a spell with no category is left completely alone', () => {
  // 242 roster entries are category "none" - a plain edge is right for them, not a guessed colour.
  B.setConfig({ categoryBordersEnabled: true });
  for (const value of ['none', null, undefined, '', 'sideways']) {
    const el = fakeEl();
    B.applyCategoryBorder(el, { spellCategory: value });
    assert.equal(el.classes.size, 0, `an unrecognised category (${value}) should add no classes`);
  }
});

test('a custom timer gets no colour, rather than a misleading one', () => {
  // There is no spell behind a custom timer, so there is nothing to be right about.
  B.setConfig({ categoryBordersEnabled: true });
  const el = fakeEl();
  B.applyCategoryBorder(el, { name: 'My timer', id: 't1' });
  assert.equal(el.classes.size, 0);
});

test('turning it off really turns it off', () => {
  B.setConfig({ categoryBordersEnabled: false });
  const el = fakeEl();
  B.applyCategoryBorder(el, { spellCategory: 'nuke' });
  assert.equal(el.classes.size, 0);

  // Absent is not off - an aura saved before this field existed still gets borders.
  B.setConfig({});
  const el2 = fakeEl();
  B.applyCategoryBorder(el2, { spellCategory: 'nuke' });
  assert.ok(el2.classes.has('cat-nuke'), 'a missing setting must not read as switched off');
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('the engine sends the category on BOTH buff sources', () => {
  // Self buffs and ally buffs are built by two separate functions that have drifted before.
  assert.equal(
    (engineSrc.match(/spellCategory: known\?\.scaleCategory \|\| null/g) || []).length, 2,
    'one of getActiveBuffs / getActiveAllyBuffs is not sending the category'
  );
});

test('every tile gets the border, whichever kind it is', () => {
  // Applied inside buildTile rather than at each call site, so list rows and icon tiles cannot
  // end up with different behaviour.
  const fn = overlaySrc.match(/function buildTile\(buff, isText, isIcon\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'buildTile has been restructured');
  assert.match(fn[1], /applyCategoryBorder\(ref\.root, buff\)/);
});

test('the setting is stored, shared, and on by default', () => {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.create('Bordered');
  assert.equal(w.categoryBordersEnabled, true, 'the owner asked for it on by default');
  assert.equal(store.getById('self-buffs').categoryBordersEnabled, true);

  store.update(w.id, { categoryBordersEnabled: false });
  const imported = store.importCode(store.exportCode(w.id));
  assert.equal(imported.categoryBordersEnabled, false, 'it should travel in a share code');
});

test('the settings window can reach it, and hides it where it cannot apply', () => {
  assert.match(html, /id="widget-category-borders-checkbox"/, 'the control is missing');
  assert.match(rendererSrc, /categoryBordersCheckbox\.checked = widget\.categoryBordersEnabled !== false/,
    'the checkbox is never populated from the aura');
  assert.match(rendererSrc, /setWidgetCategoryBorders\(selectedId, categoryBordersCheckbox\.checked\)/);
  // A sound aura draws no tile; a text aura draws a plate of words rather than a spell tile.
  assert.match(rendererSrc, /bordersRowEl\.style\.display = isSoundOnly \|\| isTextAura \? 'none' : ''/);
});

module.exports = () => report('category-borders');
if (require.main === module) process.exit(report('category-borders') ? 1 : 0);
