'use strict';
/**
 * "Reset to default" on a premade-built aura, at the owner's request: "manage aura on PREMADE
 * auras should have a reset to default option at the bottom, in red."
 *
 * Only ever offered on an aura built from a premade - premadeOrigin is the recorded recipe, and a
 * hand-built Custom aura has none, so there is nothing to reset BACK to for one. Reset rebuilds
 * the premade's fields from today's defaults (not a frozen snapshot from creation time - see the
 * comment on resetToDefault itself), and explicitly leaves position, profile membership and zone
 * limits alone, since the premade never had an opinion on any of those.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const managerSrc = read('src', 'main', 'widgetManager.js');
const mainSrc = read('src', 'main', 'main.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// ---------------------------------------------------------------------------
// Who gets a recipe at all
// ---------------------------------------------------------------------------

test('every premade creator stamps a premadeOrigin', () => {
  const store = newStore();
  assert.ok(store.createAllyBuffs('Ally').premadeOrigin, 'Ally Buffs premade');
  assert.ok(store.createTextAura('D', { preset: 'dispelled' }).premadeOrigin, 'a text-aura preset');
  assert.ok(store.createBuffTimer('B', { spellName: 'Yaulp', source: 'self' }).premadeOrigin, 'buff timer');
  assert.ok(
    store.createCooldownTimer('C', { spellName: 'Yaulp', cooldownSec: 10 }).premadeOrigin,
    'cooldown timer'
  );
});

test('a blank text aura (no preset) gets no recipe - there is nothing built-in to reset to', () => {
  const store = newStore();
  const w = store.createTextAura('Blank');
  assert.equal(w.premadeOrigin, undefined);
});

test('resetToDefault refuses an aura with no recipe', () => {
  const store = newStore();
  const plain = store.create('Hand-built');
  assert.equal(store.resetToDefault(plain.id), false);
  const debuff = store.createDebuff('Debuff');
  assert.equal(debuff.premadeOrigin, undefined, 'Custom debuff aura is not a premade');
  assert.equal(store.resetToDefault(debuff.id), false);
});

// ---------------------------------------------------------------------------
// What resetting actually does
// ---------------------------------------------------------------------------

test('reset restores changed fields, and keeps position/profile/zone untouched', () => {
  const store = newStore();
  const w = store.createBuffTimer('Puma', { spellName: 'Spirit of the Puma', source: 'self' });
  store.savePosition(w.id, { x: 500, y: 300 });
  store.update(w.id, {
    buffNames: ['Something Else Entirely'],
    lowTimeThresholdSec: 999,
    soundOnLand: true,
    activeProfileIds: ['profile-7'],
    visibleInZones: ['Befallen'],
  });

  assert.equal(store.resetToDefault(w.id), true);
  const after = store.getById(w.id);

  // Restored
  assert.deepEqual(after.buffNames, ['Spirit of the Puma']);
  assert.equal(after.lowTimeThresholdSec, 30, 'defaultCustomWidget default');
  assert.equal(after.soundOnLand, false, 'defaultCustomWidget default - the sound turned on manually is gone');

  // Untouched
  assert.deepEqual(after.position, { x: 500, y: 300 });
  assert.deepEqual(after.activeProfileIds, ['profile-7']);
  assert.deepEqual(after.visibleInZones, ['Befallen']);
  assert.equal(after.id, w.id, 'reset must not mint a new id');
  assert.equal(after.name, 'Puma', 'reset must not revert a rename');
});

test('reset keeps the recipe, so it can be reset again', () => {
  const store = newStore();
  const w = store.createCooldownTimer('CD', { spellName: 'Promised Renewal', cooldownSec: 21 });
  store.resetToDefault(w.id);
  assert.ok(store.getById(w.id).premadeOrigin, 'premadeOrigin was dropped by its own reset');
  assert.equal(store.resetToDefault(w.id), true, 'a second reset should still work');
});

test('a cooldown timer resets its custom timer definition, not just buffNames', () => {
  const store = newStore();
  const w = store.createCooldownTimer('CD', { spellName: 'Promised Renewal', cooldownSec: 21 });
  store.update(w.id, {
    customTimers: [{ id: 'x', name: 'Tampered', durationSec: 1, triggerText: 'x', triggerMatch: 'contains', endedText: '' }],
  });
  store.resetToDefault(w.id);
  const after = store.getById(w.id);
  assert.equal(after.customTimers.length, 1);
  assert.equal(after.customTimers[0].name, 'Promised Renewal');
  assert.equal(after.customTimers[0].durationSec, 21);
  assert.equal(after.customTimers[0].triggerMatch, 'castOf');
});

// ---------------------------------------------------------------------------
// Wired end to end
// ---------------------------------------------------------------------------

test('the IPC channel is wired end to end', () => {
  assert.match(managerSrc, /function resetWidgetToDefault\(id\)/);
  assert.match(managerSrc, /^ {2}resetWidgetToDefault,$/m, 'not exported');
  assert.match(mainSrc, /ipcMain\.handle\('widget:resetToDefault'/);
  assert.match(preloadSrc, /resetWidgetToDefault: \(id\) =>/);
});

test('a reset pushes the new config to the running overlay window', () => {
  const fn = managerSrc.match(/function resetWidgetToDefault\(id\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'resetWidgetToDefault has been restructured');
  assert.match(fn[1], /pushConfigChanged\(id\)/, 'an unlocked/visible overlay would keep showing the old settings');
});

test('the button only appears on a premade aura, and it is styled dangerous', () => {
  assert.match(html, /id="reset-widget-btn" class="btn-danger">Reset to default/);
  assert.match(rendererSrc, /resetWidgetRowEl\.style\.display = widget\.premadeOrigin \? '' : 'none';/);
});

test('resetting asks first, the same way deleting does', () => {
  const fn = rendererSrc.match(/function handleReset\(id\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'handleReset has been restructured');
  assert.match(fn[1], /window\.confirm\(/);
  assert.match(fn[1], /if \(!confirmed\) return;/);
});

test('it sits on the same line as Duplicate/Export/Delete, reported live 25 Aug', () => {
  // reset-widget-row is a flex child of the SAME .row as the other three now, not a second .row
  // below them - it still has its own id for the show/hide rule above, but the DOM position moved.
  const cardStart = html.indexOf('id="widget-manage-card"');
  const cardBody = html.slice(cardStart, cardStart + 1200);
  const rowStart = cardBody.indexOf('<div class="row">');
  const rowEnd = cardBody.indexOf('</div>', cardBody.indexOf('id="reset-widget-row"'));
  assert.ok(rowStart > -1 && rowEnd > rowStart, 'the Manage aura row structure has been restructured');
  const rowBody = cardBody.slice(rowStart, rowEnd);
  assert.match(rowBody, /id="duplicate-widget-btn"/);
  assert.match(rowBody, /id="export-widget-btn"/);
  assert.match(rowBody, /id="delete-widget-btn"/);
  assert.match(rowBody, /id="reset-widget-row"/, 'Reset to default is not inside the same row as the other three');
  assert.doesNotMatch(
    cardBody.slice(0, rowStart),
    /class="row"/,
    'a second .row wrapper still exists ahead of the shared one - Reset never actually moved in'
  );
});

module.exports = () => report('reset-to-default');
if (require.main === module) process.exit(report('reset-to-default') ? 1 : 0);
