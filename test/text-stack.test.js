'use strict';
/**
 * Stacked-line text feed - config.stackTextLines (+ maxStackTextLines).
 *
 * A plain text aura shows one line and silently replaces it every time something new fires, so a
 * burst of three resists in two seconds looked identical to one. With "Stack multiple lines" on,
 * each firing becomes its own fading line in a short vertical feed (oldest on top, newest on the
 * bottom), capped at "Lines visible" (2..4, default 2 - enough to still read the line before the
 * newest without it turning into a scrolling combat log). Off by default everywhere; the Resist
 * flash premade ships with it on.
 *
 * The feed is built in overlay.js's renderTextFeed, NOT the engine: the engine already keeps one
 * active entry per trigger and moves its clock forward on a repeat (an instant's landedAt, or a
 * customTimer's remainingSec jumping back up), which is the signal the feed watches to know an
 * event fired again. Identical consecutive lines merge with an "x3" so spamming one resist can't
 * blow past the cap.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, clampStackTextLines } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('a new text aura has stacking off and 2 lines visible - the behaviour-preserving default', () => {
  const store = newStore();
  const widget = store.createTextAura('Announcer');
  assert.equal(widget.stackTextLines, false);
  assert.equal(widget.maxStackTextLines, 2);
});

test('the Resist flash premade ships with stacking ON at 2 lines', () => {
  const store = newStore();
  const widget = store.createTextAura('Resisted', { preset: 'resisted' });
  assert.equal(widget.stackTextLines, true);
  assert.equal(widget.maxStackTextLines, 2);
});

test('maxStackTextLines is pulled back into 2..4', () => {
  for (const [given, expected] of [[99, 4], [1, 2], [0, 2], [3, 3], [4, 4], [-5, 2], ['x', 2], [2.6, 3]]) {
    assert.equal(clampStackTextLines(given), expected, `${given} -> ${expected}`);
  }
});

test('a stored out-of-range / non-number value is normalised on load, not passed to the overlay', () => {
  const store1 = newStore();
  const widget = store1.createTextAura('Announcer');
  widget.maxStackTextLines = 'lots';
  widget.stackTextLines = 'yes';
  store1._save();
  const data = store1.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(widget.id).maxStackTextLines, 2);
  assert.equal(store2.getById(widget.id).stackTextLines, true); // any truthy -> real boolean
});

test('both fields round-trip through a share code', () => {
  const store = newStore();
  const widget = store.createTextAura('Announcer');
  store.update(widget.id, { stackTextLines: true, maxStackTextLines: 4 });
  const imported = store.importCode(store.exportCode(widget.id));
  assert.equal(imported.stackTextLines, true);
  assert.equal(imported.maxStackTextLines, 4);
});

// ---------------------------------------------------------------------------
// v2 -> v3 migration: turn stacking on for Resist flash auras that already exist
// ---------------------------------------------------------------------------

function loadWith(widgets, version = 2) {
  const data = { widgets: { version, widgets } };
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

const resistTimer = { id: 't', name: 'Resisted', durationSec: 4, triggerText: 'resisted your ', triggerMatch: 'contains', endedText: '' };

test('an existing Resist flash aura (by premade origin) gets stacking on at 2 lines', () => {
  const store = loadWith([
    { id: 'sb', kind: 'self-buffs-builtin', name: 'Self Buffs' },
    { id: 'r', kind: 'custom', name: 'Resisted', displayMode: 'text', buffSource: 'customTimer',
      premadeOrigin: { kind: 'textAura', preset: 'resisted' }, customTimers: [resistTimer] },
  ]);
  const w = store.getById('r');
  assert.equal(w.stackTextLines, true);
  assert.equal(w.maxStackTextLines, 2);
});

test('a Resist flash aura that lost its premadeOrigin is still caught, by its trigger text', () => {
  const store = loadWith([
    { id: 'r', kind: 'custom', name: 'My resists', displayMode: 'text', buffSource: 'customTimer',
      customTimers: [{ ...resistTimer, triggerText: 'RESISTED YOUR ' }] },
  ]);
  assert.equal(store.getById('r').stackTextLines, true);
});

test('a non-resist text aura in the same save is left alone', () => {
  const store = loadWith([
    { id: 'd', kind: 'custom', name: 'Dispelled', displayMode: 'text', buffSource: 'customTimer',
      premadeOrigin: { kind: 'textAura', preset: 'dispelled' },
      customTimers: [{ id: 'd1', name: 'Dispelled', durationSec: 4, triggerText: 'You feel very dispelled.', endedText: '' }] },
  ]);
  assert.equal(store.getById('d').stackTextLines, false);
});

test('the migration runs once - a user who turned stacking back off is not re-stomped', () => {
  const store = loadWith(
    [{ id: 'r', kind: 'custom', name: 'Resisted', displayMode: 'text', buffSource: 'customTimer',
      premadeOrigin: { kind: 'textAura', preset: 'resisted' }, customTimers: [resistTimer],
      stackTextLines: false }],
    3 // already migrated
  );
  assert.equal(store.getById('r').stackTextLines, false);
});

test('a Resist flash aura the user had already widened keeps its own "Lines visible"', () => {
  const store = loadWith([
    { id: 'r', kind: 'custom', name: 'Resisted', displayMode: 'text', buffSource: 'customTimer',
      premadeOrigin: { kind: 'textAura', preset: 'resisted' }, customTimers: [resistTimer],
      maxStackTextLines: 4 },
  ]);
  const w = store.getById('r');
  assert.equal(w.stackTextLines, true);
  assert.equal(w.maxStackTextLines, 4);
});

test('the store version lands on 5 after the migrations', () => {
  const store = loadWith([{ id: 'sb', kind: 'self-buffs-builtin', name: 'Self Buffs' }]);
  store.getById('sb'); // force load
  assert.equal(store.data.version, 5);
});

test('v3->v4 drops a GCD-tracker aura and strips a stray anyCast timer', () => {
  const store = loadWith(
    [
      { id: 'sb', kind: 'self-buffs-builtin', name: 'Self Buffs' },
      {
        id: 'gcd', kind: 'custom', name: 'Global recovery', buffSource: 'customTimer',
        premadeOrigin: { kind: 'gcdTimer' },
        customTimers: [{ id: 'g', name: 'GCD', durationSec: 1.5, triggerText: 'any cast', triggerMatch: 'anyCast', gcdRecovery: true }],
      },
      {
        id: 'mixed', kind: 'custom', name: 'Mixed', buffSource: 'customTimer',
        customTimers: [
          { id: 'keep', name: 'Keep me', durationSec: 5, triggerText: 'hello', triggerMatch: 'contains' },
          { id: 'strip', name: 'Stray', durationSec: 1.5, triggerText: 'x', triggerMatch: 'anyCast', gcdRecovery: true },
        ],
      },
    ],
    3
  );
  store.getById('sb'); // force load + migrate
  assert.ok(!store.getById('gcd'), 'the GCD aura survived the migration');
  const mixed = store.getById('mixed');
  assert.deepEqual(mixed.customTimers.map((t) => t.id), ['keep'], 'the stray anyCast timer was not stripped');
  assert.equal(store.data.version, 5);
});

// ---------------------------------------------------------------------------
// The wiring - renderer -> IPC -> manager -> store
// ---------------------------------------------------------------------------

test('setStackTextLines / setMaxStackTextLines are wired end to end, cap clamped in the setter', () => {
  assert.match(managerSrc, /maxStackTextLines: clampStackTextLines\(count\)/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setStackTextLines'/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setMaxStackTextLines'/);
  assert.match(managerSrc, /function setStackTextLines\(id, enabled\)/);
  assert.match(managerSrc, /function setMaxStackTextLines\(id, count\)/);
  assert.match(managerSrc, /\n  setStackTextLines,/, 'setStackTextLines not exported from widgetManager');
  assert.match(managerSrc, /\n  setMaxStackTextLines,/, 'setMaxStackTextLines not exported from widgetManager');
  assert.match(preloadSrc, /setWidgetStackTextLines: \(id, value\) =>/);
  assert.match(preloadSrc, /setWidgetMaxStackTextLines: \(id, value\) =>/);
});

test('the controls exist in the settings panel and are populated from the aura', () => {
  assert.match(html, /id="widget-text-stack-checkbox"/);
  assert.match(html, /id="widget-text-stack-max-slider"[^>]*min="2"[^>]*max="4"/);
  assert.match(rendererSrc, /textStackCheckbox\.checked = !!widget\.stackTextLines;/);
  assert.match(rendererSrc, /textStackMaxSlider\.value = String\(maxStackLines\);/);
});

test('the checkbox and slider save on change', () => {
  assert.match(rendererSrc, /textStackCheckbox\.addEventListener\('change'[\s\S]*?setWidgetStackTextLines\(selectedId, textStackCheckbox\.checked\)/);
  assert.match(rendererSrc, /textStackMaxSlider\.addEventListener\('input'[\s\S]*?setWidgetMaxStackTextLines\(selectedId, n\)/);
});

test('"Lines visible" is an expanding sub-option - only shown once stacking is on', () => {
  // in applySettingsPanelShape
  assert.match(
    rendererSrc,
    /textStackMaxRowEl\.style\.display = showsTextStack && widget\.stackTextLines \? '' : 'none';/
  );
  // and live, the moment the checkbox flips, without waiting for a re-select
  assert.match(
    rendererSrc,
    /textStackMaxRowEl\.style\.display = textStackCheckbox\.checked \? '' : 'none';/
  );
});

test('text-stack is a field of every text shape, and no other', () => {
  const tableSrc = rendererSrc.match(/const SHAPE_FIELDS = \{[\s\S]*?\n {2}\};/)[0];
  // eslint-disable-next-line no-new-func
  const { SHAPE_FIELDS } = new Function(`${tableSrc}\nreturn { SHAPE_FIELDS };`)();
  for (const [shape, fields] of Object.entries(SHAPE_FIELDS)) {
    const shouldHave = ['ally-alert', 'text', 'text-customTimer'].includes(shape);
    assert.equal(fields.includes('text-stack'), shouldHave, `shape "${shape}"`);
  }
});

// ---------------------------------------------------------------------------
// overlay.js structure
// ---------------------------------------------------------------------------

test('render() hands a stacking text aura to its own feed path and returns', () => {
  assert.match(
    overlaySrc,
    /if \(currentConfig\.displayMode === 'text' && currentConfig\.stackTextLines && !currentConfig\.alwaysOn && !showingPreviewSample\) \{[\s\S]*?renderTextFeed\(buffs\);\s*\n\s*return;/
  );
});

test('switching back into the feed path forces one repaint over whatever the tile path drew', () => {
  // The "Show example content" sample is drawn by the tile path; without this the feed can skip
  // its repaint (unchanged signature) and leave that sample stuck. See overlay.js.
  assert.match(
    overlaySrc,
    /if \(listEl\.dataset\.mode !== 'text-feed'\) lastFeedSig = null;\s*\n\s*renderTextFeed\(buffs\);/
  );
});

test('applyConfig drops the feed history whenever the feed is not the active mode', () => {
  assert.match(
    overlaySrc,
    /if \(!\(config\.displayMode === 'text' && config\.stackTextLines\)\) resetTextFeed\(\);/
  );
});

test('the fade keyframe exists in the overlay stylesheet', () => {
  assert.match(overlayCss, /@keyframes feed-fade \{/);
});

// ---------------------------------------------------------------------------
// The feed logic itself, run for real
// ---------------------------------------------------------------------------

function loadFeed() {
  const pick = (re, what) => {
    const m = overlaySrc.match(re);
    assert.ok(m, `${what} has been renamed or restructured - this suite cannot run`);
    return m[0];
  };
  const parts = [
    pick(/const textFeed = \[\];[\s\S]*?const FEED_FADE_MS = \d+;/, 'feed module state'),
    pick(/function resetTextFeed\(\) \{[\s\S]*?\n\}/, 'resetTextFeed'),
    pick(/function pushFeedLine\(text, now\) \{[\s\S]*?\n\}/, 'pushFeedLine'),
    pick(/function renderTextFeed\(buffs\) \{[\s\S]*?\n\}/, 'renderTextFeed'),
    // stubs for everything renderTextFeed leans on that isn't the feed
    'let currentConfig = {};',
    'let hasRenderedBefore = true;',
    'let drawn = 0;',
    'const tileRefs = new Map();',
    'const listEl = { innerHTML: "", className: "", dataset: {}, appendChild() {} };',
    'let soundPlays = 0;',
    'function keyFor(b) { return b.key; }',
    'function textFor(b) { return b.text; }',
    'function applyTextAuraStyle() {}',
    'function reportSizeIfChanged() {}',
    'function playAlertSound() { soundPlays++; }',
    'function visibleBuffs(buffs) { return buffs; }',
    'function drawTextFeed() { drawn++; }',
  ];
  // eslint-disable-next-line no-new-func
  return new Function(
    `${parts.join('\n\n')}
     return {
       renderTextFeed, resetTextFeed,
       feed: () => textFeed.map((l) => ({ text: l.text, count: l.count })),
       setConfig: (c) => { currentConfig = c; },
       sounds: () => soundPlays,
     };`
  )();
}

const instant = (key, text, landedAt) => ({ key, text, landedAt, instant: true });
const trigger = (key, text, remainingSec) => ({ key, text, remainingSec });

test('two different lines from the same trigger both stack', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 4, textAuraInstantSec: 6, soundOnLand: false });
  F.renderTextFeed([trigger('resist', 'Your Stun was resisted by an orc', 4)]);
  F.renderTextFeed([trigger('resist', 'Your Tash was resisted by an orc', 4)]);
  assert.deepEqual(F.feed(), [
    { text: 'Your Stun was resisted by an orc', count: 1 },
    { text: 'Your Tash was resisted by an orc', count: 1 },
  ]);
});

test('the same line repeated merges with a count instead of a second row', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 4, textAuraInstantSec: 6 });
  F.renderTextFeed([instant('nuke', 'Resisted!', 1000)]);
  F.renderTextFeed([instant('nuke', 'Resisted!', 2000)]); // fired again - landedAt moved
  F.renderTextFeed([instant('nuke', 'Resisted!', 3000)]);
  assert.deepEqual(F.feed(), [{ text: 'Resisted!', count: 3 }]);
});

test('a customTimer re-fire (remainingSec jumps back up) is a new firing', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 4, textAuraInstantSec: 6 });
  F.renderTextFeed([trigger('resist', 'Resisted A', 4)]);
  F.renderTextFeed([trigger('resist', 'Resisted A', 2)]); // still counting down - NOT a re-fire
  assert.deepEqual(F.feed(), [{ text: 'Resisted A', count: 1 }]);
  F.renderTextFeed([trigger('resist', 'Resisted A', 4)]); // jumped back up - re-fired
  assert.deepEqual(F.feed(), [{ text: 'Resisted A', count: 2 }]);
});

test('the visible-line cap drops the oldest, keeping the newest N', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 2, textAuraInstantSec: 60 });
  for (const t of ['one', 'two', 'three', 'four']) F.renderTextFeed([instant('k', t, Date.now() + Math.random())]);
  assert.deepEqual(F.feed().map((l) => l.text), ['three', 'four']);
});

test('the cap is itself clamped to 2..4 even if a bad config slips through', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 99, textAuraInstantSec: 60 });
  for (let i = 0; i < 8; i++) F.renderTextFeed([instant('k', `line ${i}`, Date.now() + i)]);
  assert.equal(F.feed().length, 4);
});

test('a line older than "Show events for" is pruned', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 4, textAuraInstantSec: 1 }); // 1s lifetime
  F.renderTextFeed([instant('k', 'old', 1)]);
  assert.equal(F.feed().length, 1);
  // nothing new fires; a render ~1.2s later should have aged the line out
  const realNow = Date.now;
  Date.now = () => realNow() + 1300;
  try {
    F.renderTextFeed([]);
  } finally {
    Date.now = realNow;
  }
  assert.equal(F.feed().length, 0);
});

test('resetTextFeed empties it so a toggle off/on cannot resurrect an old burst', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 4, textAuraInstantSec: 60 });
  F.renderTextFeed([instant('k', 'stale', 1)]);
  assert.equal(F.feed().length, 1);
  F.resetTextFeed();
  assert.deepEqual(F.feed(), []);
});

test('a new firing plays the land sound when the aura asks for one', () => {
  const F = loadFeed();
  F.setConfig({ stackTextLines: true, maxStackTextLines: 4, textAuraInstantSec: 6, soundOnLand: true });
  F.renderTextFeed([instant('k', 'first', 1)]);
  F.renderTextFeed([instant('k', 'first', 1)]); // same stamp - not a firing
  assert.equal(F.sounds(), 1);
  F.renderTextFeed([instant('k', 'first', 2)]); // moved - a firing
  assert.equal(F.sounds(), 2);
});

module.exports = () => report('text-stack');
if (require.main === module) report('text-stack').then((n) => process.exit(n ? 1 : 0));
