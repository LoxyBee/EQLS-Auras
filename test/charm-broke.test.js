'use strict';
/**
 * "Charm Broke" (25 Aug) - a premade alert for when your own charm wears off, per the owner's own
 * instruction: "i also need a premade aura for when your charmed target breaks, you can find the
 * syntax in the logs."
 *
 * The syntax IS in the logs, confirmed directly: "Your <SpellName> spell has worn off of
 * <Target>." - the game's own generic wears-off-of-someone message (confirmed present for
 * entirely unrelated buffs too - Alacrity, Agility, Agilmente's Aria of Eagles all wearing off
 * allies use the identical template), watched here under every one of the roster's own
 * charm-category spell names specifically, so what makes it a "charm broke" alert is the trigger
 * list, not the wording.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

const TS = '[Wed Aug 19 19:23:03 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.createTextAura('Charm Broke', { preset: 'charmBroke' });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // no sweeping - these tests drive it themselves
  return { store, widget, engine };
}

test('every charm-category spell in the current roster has its own trigger in the preset', () => {
  const { widget } = setup();
  const triggerNames = new Set(widget.customTimers.map((t) => t.triggerText.replace(/ spell has worn off of$/, '')));
  const rosterCharmNames = roster.filter((e) => e.scaleCategory === 'charm').map((e) => e.name);
  assert.ok(rosterCharmNames.length > 0, 'no charm spells in the roster to check against');
  for (const name of rosterCharmNames) {
    assert.ok(triggerNames.has(name), `"${name}" is a real charm spell but has no trigger in the Charm Broke preset`);
  }
});

test('a real charm-break line from the game fires it', () => {
  const { engine } = setup();
  // Confirmed straight from the owner's own log.
  engine.handleLine(`${TS}Your Beguile spell has worn off of a greater kobold.`);
  assert.equal(engine.getActive().length, 1);
});

test('the target name is captured for the {spell} token, not swallowed by the match', () => {
  const { engine } = setup();
  engine.handleLine(`${TS}Your Allure spell has worn off of Sabertooth Overseer.`);
  const [active] = engine.getActive();
  assert.equal(active.capturedText, 'Sabertooth Overseer');
});

test('an unrelated buff wearing off on an ally does not fire this - only charm spells do', () => {
  const { engine } = setup();
  // The exact same game-wide template, confirmed in the owner's own log too - but Alacrity is not
  // a charm spell, so this aura must stay silent for it.
  engine.handleLine(`${TS}Your Alacrity spell has worn off of Avenrae.`);
  assert.equal(engine.getActive().length, 0);
});

test('the tile clears itself after the configured duration, same as Dispelled/Resisted', () => {
  const { engine } = setup();
  engine.handleLine(`${TS}Your Charm spell has worn off of a fire giant warrior.`);
  assert.equal(engine.getActive().length, 1);
  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() - 1;
  engine._tick();
  assert.equal(engine.getActive().length, 0);
});

test('the message template uses {spell} to show the freed target\'s name', () => {
  const storeSrc = read('src', 'main', 'widgetStore.js');
  assert.match(storeSrc, /textAuraMessage: '\{spell\} has broken free!'/);
});

test('the premade is offered under Event alerts, next to Resist flash and Dispelled', () => {
  assert.match(rendererSrc, /id: 'charm-broke'/);
  const entry = rendererSrc.match(/\{\s*id: 'charm-broke',[\s\S]*?\n {4}\},/);
  assert.ok(entry, 'the Charm Broke premade entry has been restructured');
  assert.match(entry[0], /group: 'event-alerts'/);
  assert.match(entry[0], /createTextAuraWidget\(name, 'charmBroke'\)/);
});

module.exports = () => report('charm-broke');
if (require.main === module) report('charm-broke').then((n) => process.exit(n ? 1 : 0));
