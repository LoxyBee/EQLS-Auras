'use strict';
/**
 * Trigger groups (owner, 16 Oct). A trigger can sit in a named group; in Independent mode a trigger
 * firing replaces whatever tile its group is showing - "one at a time" per group, several groups
 * side by side. It replaced the Stance & invocation premade's hidden trick (ending each tile on its
 * group's shared pick wording), which a player adding a stance by hand could not see.
 *
 * The owner's rules: new triggers are in no group by default; the group is picked from a per-row
 * dropdown (the app's own themed dropdown) with the ability to make new groups; in AND/OR the group
 * is disabled but NOT lost, so switching back to Independent restores it.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, normalizeWidget } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const TS = '[Thu Oct 16 10:00:00 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.create('Groups', { buffSource: 'customTimer' });
  for (const [name, line] of [['A1', 'a one'], ['A2', 'a two'], ['B1', 'b one'], ['B2', 'b two'], ['Loose', 'loose']]) {
    store.addCustomTimer(w.id, { name, durationSec: 60, triggerText: line });
  }
  const idOf = (name) => store.getById(w.id).customTimers.find((t) => t.name === name).id;
  for (const n of ['A1', 'A2']) store.setCustomTimerGroup(w.id, idOf(n), 'Alpha');
  for (const n of ['B1', 'B2']) store.setCustomTimerGroup(w.id, idOf(n), 'Beta');
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  engine.setGetWidgetsFn(() => store.getAll());
  const say = (...lines) => lines.forEach((l) => engine.handleLine(TS + l));
  const names = () => engine.getActive().map((t) => t.name).sort();
  return { store, w, idOf, engine, say, names };
}

test('a new trigger is in no group', () => {
  const store = new WidgetStore({ loadJson: (n, f) => f, saveJson: () => {} });
  const w = store.create('X', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'T', durationSec: 5, triggerText: 't' });
  assert.equal(store.getById(w.id).customTimers[0].group, undefined);
});

test('in Independent mode a trigger replaces only its own group\'s tile', () => {
  const { say, names } = setup();
  say('a one', 'b one', 'loose');
  assert.deepEqual(names(), ['A1', 'B1', 'Loose']);
  say('a two');
  assert.deepEqual(names(), ['A2', 'B1', 'Loose'], 'A2 replaced A1; Beta and the ungrouped trigger untouched');
  say('b two');
  assert.deepEqual(names(), ['A2', 'B2', 'Loose']);
});

test('in AND / OR mode groups are ignored - but kept, and work again back in Independent', () => {
  const { store, w, idOf, engine, say, names } = setup();
  store.setTriggerCombineMode(w.id, 'or');
  assert.equal(store.getById(w.id).customTimers.find((t) => t.name === 'A1').group, 'Alpha', 'not lost on a mode switch');
  say('a one');
  assert.equal(engine.getActive().length, 1, 'OR still means one tile for the whole aura');
  store.setTriggerCombineMode(w.id, 'independent');
  engine.resetTimers(w.id, store.getById(w.id).customTimers.map((t) => t.id)); // what main.js does on a mode change
  say('a one', 'a two');
  assert.deepEqual(names(), ['A2'], 'groups are back in force');
  assert.equal(store.getById(w.id).customTimers.find((t) => t.id === idOf('B1')).group, 'Beta');
});

test('group names are tidied, match an existing spelling, and join the aura\'s saved list', () => {
  const { store, w, idOf } = setup();
  store.setCustomTimerGroup(w.id, idOf('Loose'), '  alpha  ');
  assert.equal(store.getById(w.id).customTimers.find((t) => t.name === 'Loose').group, 'Alpha', 'joins "Alpha", no second group');
  store.addTriggerGroup(w.id, 'Gamma');
  assert.deepEqual(store.getById(w.id).triggerGroups, ['Alpha', 'Beta', 'Gamma'], 'a created group is saved even with no trigger in it');
  store.setCustomTimerGroup(w.id, idOf('Loose'), null);
  assert.equal(store.getById(w.id).customTimers.find((t) => t.name === 'Loose').group, undefined, 'null takes it out of any group');
  assert.ok(store.getById(w.id).triggerGroups.includes('Gamma'), 'the saved group stays offered');
});

test('the saved list always includes every group a trigger uses, and survives a share code', () => {
  const n = normalizeWidget({ id: 'x', kind: 'custom', customTimers: [{ id: 't', group: 'Stance' }], triggerGroups: ['Other', 'other'] });
  assert.deepEqual(n.triggerGroups, ['Other', 'Stance']);
  const { store, w } = setup();
  const copy = store.importCode(store.exportCode(w.id));
  assert.deepEqual(copy.triggerGroups, ['Alpha', 'Beta']);
  assert.deepEqual(copy.customTimers.map((t) => t.group || null), ['Alpha', 'Alpha', 'Beta', 'Beta', null]);
});

test('wiring: a per-row themed dropdown, disabled outside Independent, with "New group..."', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function buildTriggerGroupSelect\(widget, timer\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fn, 'buildTriggerGroupSelect is missing');
  assert.match(fn[0], /sel\.disabled = !independent;/, 'disabled - not hidden or cleared - in AND/OR');
  assert.match(fn[0], /add\(NEW_TRIGGER_GROUP, 'New group/);
  assert.match(fn[0], /appPrompt\(/, 'names a new group in the app\'s own pop-up, not an OS dialog');
  assert.match(renderer, /window\.SearchDropdown\.enhance\(groupSelect\)/, 'the app\'s own dropdown, not a native one');
  const mainSrc = read('src', 'main', 'main.js');
  assert.ok(mainSrc.includes("withAuraReset(id, () => widgetManager.setCustomTimerGroup(id, timerId, group))"));
});

module.exports = () => report('trigger-groups');
if (require.main === module) report('trigger-groups').then((n) => process.exit(n ? 1 : 0));
