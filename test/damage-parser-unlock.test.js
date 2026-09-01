'use strict';
/**
 * Damage parser, unlocked (1 Sep). It was built and wired since note 19 but held out of the Add
 * Aura list because its settings panel had the buff-aura shape - a "Buffs shown" source + spell
 * picker that mean nothing for a list of attacker rows. Now it has its own shape (only what a list
 * of non-spell rows can use) and a clickable premade, the same treatment Travel guide got 26 Aug.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

function store() {
  let saved;
  return {
    loadJson: (k, f) => (k === 'widgets' ? saved || f : f),
    saveJson: (k, v) => { if (k === 'widgets') saved = JSON.parse(JSON.stringify(v)); },
  };
}

test('the damage shape drops every buff-tile control and keeps only what a row of numbers uses', () => {
  const m = rendererSrc.match(/'damage':\s*\[([^\]]*)\]/);
  assert.ok(m, 'SHAPE_FIELDS.damage not found');
  const fields = m[1];
  for (const gone of ['sort', 'merge', 'borders', 'alerts', 'buff-picker', 'buff-source', 'display-choice']) {
    assert.ok(!fields.includes(`'${gone}'`), `damage shape must not offer "${gone}"`);
  }
  for (const kept of ['list-format', 'timer-text', 'opacity', 'position', 'damage-settings']) {
    assert.ok(fields.includes(`'${kept}'`), `damage shape should have "${kept}"`);
  }
});

test('Damage parser is a real clickable premade, not a locked roadmap entry', () => {
  const built = rendererSrc.match(/const PREMADE_WIDGETS = \[([\s\S]*?)\n {2}\];/);
  const planned = rendererSrc.match(/const PLANNED_PREMADE_WIDGETS = \[([\s\S]*?)\n {2}\];/);
  assert.ok(built && planned);
  assert.match(built[1], /id: 'damage-parser'/);
  assert.match(built[1], /createDamageMeterWidget\(name, false\)/);
  assert.match(built[1], /group: 'standalone'/);
  assert.ok(!/name: 'Damage parser'/.test(planned[1]), 'Damage parser must not still be in the roadmap list');
});

test('createDamageMeter builds a list-mode damage aura with the row-scrambling guards, and a premadeOrigin', () => {
  const w = new WidgetStore(store()).createDamageMeter('DPS', {});
  assert.equal(w.buffSource, 'damage');
  assert.equal(w.displayMode, 'list');
  assert.equal(w.sortOrder, 'default', 'rows arrive pre-sorted; any sort would scramble them');
  assert.equal(w.landingGlowEnabled, false);
  assert.equal(w.listWidth, 260);
  assert.deepEqual(w.premadeOrigin, { kind: 'damage', mineOnly: false });
});

test('resetToDefault rebuilds a damage aura, keeping id / position / name', () => {
  const s = store();
  const ws = new WidgetStore(s);
  const w = ws.createDamageMeter('DPS', { mineOnly: true });
  ws.savePosition(w.id, { x: 111, y: 222 });
  ws.update(w.id, { sortOrder: 'alphabetical', listWidth: 999 }); // user messed with it

  assert.equal(ws.resetToDefault(w.id), true);
  const fresh = new WidgetStore(s).getById(w.id);
  assert.equal(fresh.id, w.id);
  assert.equal(fresh.name, 'DPS');
  assert.deepEqual(fresh.position, { x: 111, y: 222 });
  assert.equal(fresh.sortOrder, 'default', 'reset restored the row order guard');
  assert.equal(fresh.listWidth, 260);
  assert.equal(fresh.mineOnly, true, 'the origin remembered "just my row"');
});

module.exports = () => report('damage-parser-unlock');
if (require.main === module) report('damage-parser-unlock').then((n) => process.exit(n ? 1 : 0));
