'use strict';
/**
 * Wipe/radial shade and the countdown number used to be one 3-way radio (cooldownStyle:
 * 'wipe'|'number'|'radial'). Requested directly: "wipe and cooldown number should be separate
 * things" - split into cooldownStyle (shade only: 'none'|'wipe'|'radial') and a new independent
 * cooldownShowNumber boolean. This pins the migration that keeps an EXISTING bar's on-screen look
 * unchanged after the split lands.
 */

const assert = require('node:assert/strict');
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

test('a brand new bar defaults to wipe shade, no number - unchanged from before the split', () => {
  const store = makeStore(null);
  const bar = store.getAll()[0];
  assert.equal(bar.cooldownStyle, 'wipe');
  assert.equal(bar.cooldownShowNumber, false);
});

module.exports = () => report('action-bar-cooldown-style');
if (require.main === module) report('action-bar-cooldown-style').then((n) => process.exit(n ? 1 : 0));
