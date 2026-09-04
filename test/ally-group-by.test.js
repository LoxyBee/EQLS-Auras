'use strict';
/**
 * Ally Buffs "one section per buff" (owner, 3 Sep: "organise by buff. this way i can cast puma
 * 8 times and it will all be under the 'puma' category ... hide skill names and only show ally
 * names on the icon/list").
 *
 * groupByAlly and displayName are pure over `currentConfig` + a buff list, so they are lifted out
 * of overlay.js and run rather than read as text (same trick as merged-tiles.test.js).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, normalizeWidget, SHAREABLE_FIELDS } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const overlaySrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'overlay', 'overlay.js'), 'utf8');

function load() {
  const pick = (re, what) => {
    const m = overlaySrc.match(re);
    assert.ok(m, `${what} has been renamed or restructured`);
    return m[0];
  };
  const parts = [
    'let currentConfig = {};',
    pick(/function groupByAlly\(buffs\) \{[\s\S]*?\n\}/, 'groupByAlly'),
    pick(/function displayName\(buff\) \{[\s\S]*?\n\}/, 'displayName'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function(`${parts.join('\n\n')}
    return { groupByAlly, displayName, setConfig: (c) => { currentConfig = c; } };`)();
}
const O = load();
const buff = (name, allyName) => ({ name, allyName, durationSec: 60, remainingSec: 40 });

test('allyGroupBy is a shareable field and normalizes to ally | buff', () => {
  assert.ok(SHAREABLE_FIELDS.includes('allyGroupBy'));
  assert.equal(normalizeWidget({ kind: 'custom', name: 'x', allyGroupBy: 'buff' }).allyGroupBy, 'buff');
  assert.equal(normalizeWidget({ kind: 'custom', name: 'x', allyGroupBy: 'nonsense' }).allyGroupBy, 'ally');
  assert.equal(normalizeWidget({ kind: 'custom', name: 'x' }).allyGroupBy, 'ally', 'default is by player');
});

test("group by buff: one section per spell, tiles named by player", () => {
  O.setConfig({ groupAllyBuffs: true, allyGroupBy: 'buff' });
  const groups = O.groupByAlly([
    buff('Spirit of the Puma', 'Fahh'),
    buff('Spirit of the Puma', 'Leche'),
    buff('Talisman of Altuna', 'Fahh'),
  ]);
  assert.deepEqual(groups.map((g) => g.heading), ['Spirit of the Puma', 'Talisman of Altuna']);
  assert.deepEqual(groups[0].buffs.map((b) => b.allyName), ['Fahh', 'Leche']);
  // the tile text is the ally, not the spell
  assert.equal(O.displayName(buff('Spirit of the Puma', 'Fahh')), 'Fahh');
});

test('group by player (default): one section per person, tiles named by spell', () => {
  O.setConfig({ groupAllyBuffs: true, allyGroupBy: 'ally' });
  const groups = O.groupByAlly([buff('Spirit of the Puma', 'Fahh'), buff('Talisman of Altuna', 'Fahh')]);
  assert.deepEqual(groups.map((g) => g.heading), ['Fahh']);
  assert.equal(O.displayName(buff('Spirit of the Puma', 'Fahh')), 'Spirit of the Puma');
});

test('ungrouped ally buff still shows "Player: Spell"', () => {
  O.setConfig({ groupAllyBuffs: false });
  assert.equal(O.displayName(buff('Spirit of the Puma', 'Fahh')), 'Fahh: Spirit of the Puma');
});

module.exports = () => report('ally-group-by');
if (require.main === module) report('ally-group-by').then((n) => process.exit(n ? 1 : 0));
