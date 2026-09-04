'use strict';
/**
 * Action Bars appearance-overrides pass (owner, 4 Sep): reorder the Edit Gem modal (Icon, then
 * Stance/Invocation, then an "Appearance overrides" accordion holding Background/Border/Text), add
 * a per-gem text COLOUR override alongside the existing text SIZE override, and a bar-wide default
 * Background to go with the existing per-gem one - "any setting for the action bar should have
 * both global settings and per gem override settings."
 *
 * Only the data layer (ActionBarStore) is unit-testable outside Electron - actionBarManager.js
 * requires BrowserWindow/screen directly. This pins the new fields' defaults and normalization.
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

test('a fresh bar defaults to no bar-wide background override (null = calibration tint)', () => {
  const store = makeStore();
  const bar = store.create('Test');
  assert.equal(bar.bgColor, null);
});

test('a fresh gem defaults to no text colour override', () => {
  const store = makeStore();
  const bar = store.create('Test');
  assert.equal(bar.slots[0].nameColorOverride, null);
});

test('an old bar/slot saved before these fields existed normalizes to the same "no override" defaults', () => {
  const store = makeStore({
    bars: [{ id: 'a', name: 'Old Bar', slots: [{ iconId: 5 }] }],
  });
  const bar = store.getById('a');
  assert.equal(bar.bgColor, null, 'bar-wide background - no crash, no override');
  assert.equal(bar.slots[0].nameColorOverride, null, 'per-gem text colour - no crash, no override');
});

test('a bar-wide background of "transparent" or a hex string round-trips through normalize', () => {
  const transparent = makeStore({ bars: [{ id: 'a', name: 'B', bgColor: 'transparent', slots: [] }] });
  assert.equal(transparent.getById('a').bgColor, 'transparent');
  const custom = makeStore({ bars: [{ id: 'a', name: 'B', bgColor: '#336699', slots: [] }] });
  assert.equal(custom.getById('a').bgColor, '#336699');
});

test('a per-gem text colour override round-trips through normalize, same shape as the size override', () => {
  const store = makeStore({
    bars: [{ id: 'a', name: 'B', slots: [{ iconId: null, nameSizeOverride: 16, nameColorOverride: '#ff8800' }] }],
  });
  const slot = store.getById('a').slots[0];
  assert.equal(slot.nameSizeOverride, 16);
  assert.equal(slot.nameColorOverride, '#ff8800');
});

test('a non-string/empty nameColorOverride normalizes to null, not an empty override', () => {
  const store = makeStore({ bars: [{ id: 'a', name: 'B', slots: [{ nameColorOverride: '' }] }] });
  assert.equal(store.getById('a').slots[0].nameColorOverride, null);
});

module.exports = () => report('action-bar-appearance-overrides');
if (require.main === module) report('action-bar-appearance-overrides').then((n) => process.exit(n ? 1 : 0));
