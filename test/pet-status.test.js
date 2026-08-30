'use strict';
/**
 * "Pet status" text aura (backlog #37) - is my charmed pet fighting?
 *
 * Owner corrected an earlier "can't be done": bards charm pets (Solon's Bewitching Bravura) and
 * there are enchanter logs too. A charmed pet takes a new name every charm, so this is a state
 * readout off the pet's own consistent speech lines, not a per-pet timer. Same TEXT_AURA_PRESET
 * shape as #36.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const rendererSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
const TS = '[Wed Aug 19 19:23:03 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.createTextAura('Pet status', { preset: 'petStatus' });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer);
  return { store, widget, engine };
}

test('the preset builds a text aura with the three states', () => {
  const { widget } = setup();
  assert.equal(widget.displayMode, 'text');
  assert.equal(widget.textAuraMessage, '{spell}');
  const labels = new Set(widget.customTimers.map((t) => t.name));
  assert.ok(labels.has('PET ENGAGED') && labels.has('PET IDLE') && labels.has('PET GONE'));
});

test('the pet acknowledging an attack shows PET ENGAGED', () => {
  const { engine } = setup();
  engine.handleLine(`${TS}A leering gargoyle told you, 'Attacking a deathly usher Master.'`);
  const active = engine.getActive();
  assert.equal(active.length >= 1, true);
  assert.ok(active.some((b) => b.name === 'PET ENGAGED'));
});

test('"calming down" shows PET IDLE', () => {
  const { engine } = setup();
  engine.handleLine(`${TS}A wanderer says, 'Sorry, Master... calming down.'`);
  assert.ok(engine.getActive().some((b) => b.name === 'PET IDLE'));
});

test('a charm wearing off shows PET GONE, and covers every charm spell', () => {
  const { engine, widget } = setup();
  engine.handleLine(`${TS}Your Solon's Bewitching Bravura spell has worn off of Bzzazzt.`);
  assert.ok(engine.getActive().some((b) => b.name === 'PET GONE'));
  // one PET GONE trigger per charm spell name, same convention as Charm Broke
  const goneTriggers = widget.customTimers.filter((t) => t.name === 'PET GONE');
  assert.ok(goneTriggers.length >= 10);
  assert.ok(goneTriggers.every((t) => t.triggerMatch === 'contains'));
});

test('ordinary combat text does not fire it', () => {
  const { engine } = setup();
  engine.handleLine(`${TS}You begin casting Solon's Bewitching Bravura VI.`);
  engine.handleLine(`${TS}A leering gargoyle hits a deathly usher for 40 points of damage.`);
  assert.equal(engine.getActive().length, 0);
});

test('it is wired into the premade list under event-alerts', () => {
  assert.match(rendererSrc, /id: 'pet-status'/);
  assert.match(rendererSrc, /createTextAuraWidget\(name, 'petStatus'\)/);
});

module.exports = () => report('pet-status');
if (require.main === module) report('pet-status').then((n) => process.exit(n ? 1 : 0));
