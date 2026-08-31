'use strict';
/**
 * Wipe/radial shade and the countdown number used to be one 3-way radio (cooldownStyle:
 * 'wipe'|'number'|'radial'). Requested directly: "wipe and cooldown number should be separate
 * things" - split into cooldownStyle (shade only: 'none'|'wipe'|'radial') and a new independent
 * cooldownShowNumber boolean. This pins the migration that keeps an EXISTING bar's on-screen look
 * unchanged after the split lands.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { ActionBarStore } = require('../src/main/actionBarStore');

function makeStore(seed) {
  const data = {};
  if (seed) data.actionBars = seed;
  return new ActionBarStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('an old bar saved with cooldownStyle:"number" migrates to shade:"none" + showNumber:true - same look, new shape', () => {
  const store = makeStore({
    bars: [{ id: 'a', name: 'Old Bar', cooldownStyle: 'number', slots: [] }],
  });
  const bar = store.getById('a');
  assert.equal(bar.cooldownStyle, 'none');
  assert.equal(bar.cooldownShowNumber, true);
});

test('an old bar saved with cooldownStyle:"wipe" keeps the shade and stays showNumber:false - it never showed a number before', () => {
  const store = makeStore({
    bars: [{ id: 'a', name: 'Old Bar', cooldownStyle: 'wipe', slots: [] }],
  });
  const bar = store.getById('a');
  assert.equal(bar.cooldownStyle, 'wipe');
  assert.equal(bar.cooldownShowNumber, false);
});

test('a bar that already has cooldownShowNumber saved is never re-migrated, even if cooldownStyle happens to be "number"', () => {
  // Defensive: the migration is keyed on cooldownShowNumber being ABSENT, not on the style value
  // alone, so a bar someone deliberately re-saved with an unexpected combination is left alone.
  const store = makeStore({
    bars: [{ id: 'a', name: 'Bar', cooldownStyle: 'number', cooldownShowNumber: false, slots: [] }],
  });
  const bar = store.getById('a');
  assert.equal(bar.cooldownStyle, 'number', 'not migrated - cooldownShowNumber was already present');
  assert.equal(bar.cooldownShowNumber, false);
});

test('a bar created via store.create defaults to wipe shade, no number - unchanged from before the split', () => {
  const store = makeStore(null);
  const bar = store.create('Test Bar');
  assert.equal(bar.cooldownStyle, 'wipe');
  assert.equal(bar.cooldownShowNumber, false);
});

test('a fresh install starts with NO action bars - no empty overlay dropped on the game', () => {
  const store = makeStore(null);
  assert.deepEqual(store.getAll(), [], 'first run must not seed a default action bar');
});

test('an existing saved bar still loads normally - the no-default-bar change is fresh-install only', () => {
  const multi = makeStore({ bars: [{ id: 'a', name: 'My Bar', visible: true, slots: [] }] });
  assert.equal(multi.getAll().length, 1);
  assert.equal(multi.getById('a').name, 'My Bar');
});

// QOL #11 - drag one gem onto another to SWAP them; nothing else moves.
test('swapSlots exchanges exactly the two slots, leaves every other slot alone', () => {
  const store = makeStore(null);
  const bar = store.create('Bar');
  const slots = store.getById(bar.id).slots;
  slots[1].name = 'B';
  slots[1].iconId = 10;
  slots[6].name = 'G';
  slots[4].name = 'E'; // an untouched slot between them
  store.update(bar.id, { slots });

  store.swapSlots(bar.id, 1, 6); // drag 2 onto 7
  let s = store.getById(bar.id).slots;
  assert.equal(s[1].name, 'G', 'slot 2 now holds what was in slot 7');
  assert.equal(s[6].name, 'B', 'slot 7 now holds what was in slot 2');
  assert.equal(s[6].iconId, 10, 'the whole slot object swapped, not just the name');
  assert.equal(s[4].name, 'E', 'the slot between them is untouched');
  assert.equal(s.length, 12);

  store.swapSlots(bar.id, 6, 1); // swap back
  assert.equal(store.getById(bar.id).slots[1].name, 'B');
  assert.equal(store.getById(bar.id).slots[6].name, 'G');

  const before = JSON.stringify(store.getById(bar.id).slots);
  store.swapSlots(bar.id, 3, 3);     // equal index -> no-op
  store.swapSlots(bar.id, 'x', 'y'); // garbage -> clamps to 0,0 -> no-op
  assert.equal(JSON.stringify(store.getById(bar.id).slots), before, 'a no-op swap changed nothing');
  assert.equal(store.swapSlots('nope', 0, 1), null, 'unknown bar id returns null');
});

// QOL #11 + #19 - the gem grid is drag-to-reorder and marks configured slots.
test('the gem grid is wired for drag-to-reorder and the configured marker', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8'
  );
  assert.match(src, /box\.draggable = true/, '#11 - gem boxes must be draggable');
  assert.match(src, /swapActionBarSlots\(selectedActionBarId, a, b\)/, '#11 - drop must call the swap IPC');
  assert.match(src, /function slotIsConfigured\(s\)/, '#19 - the configured test helper');
  assert.match(src, /classList\.toggle\('configured', slotIsConfigured\(s\)\)/, '#19 - marker applied per box');

  const preload = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'preload', 'preload-main.js'), 'utf8'
  );
  assert.match(preload, /swapActionBarSlots:.*actionBar:swapSlots/, 'the preload bridge exists');
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.css'), 'utf8'
  );
  assert.match(css, /\.icon-picker-box\.configured::after/, '#19 - the marker has a style');
});

module.exports = () => report('action-bar-cooldown-style');
if (require.main === module) report('action-bar-cooldown-style').then((n) => process.exit(n ? 1 : 0));
