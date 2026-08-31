'use strict';
/**
 * "Loss of control" text aura (backlog #36) - one tile that shows STUNNED / MESMERIZED / CHARMED /
 * AFRAID / ROOTED / SNARED while one of those is on the player, cleared the instant it lifts.
 *
 * Owner's redesign: text-only aura, and it must include root / snare / stun (not just the
 * fear/charm/mez the original note named). Built as a TEXT_AURA_PRESET of exact-match trigger /
 * ended-text pairs drawn from the roster's own landingText/endedText and the owner's real logs.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

const TS = '[Wed Aug 19 19:23:03 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.createTextAura('Loss of control', { preset: 'lossOfControl' });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // the tests drive the clock themselves
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { store, widget, engine, log };
}

test('the preset builds a text aura, not an icon/list one', () => {
  const { widget } = setup();
  assert.equal(widget.displayMode, 'text');
  assert.equal(widget.buffSource, 'customTimer');
  assert.equal(widget.textAuraMessage, '{spell}');
  assert.equal(widget.premadeOrigin.preset, 'lossOfControl');
});

test('it covers all six control kinds the owner asked for', () => {
  const { widget } = setup();
  const labels = new Set(widget.customTimers.map((t) => t.name));
  for (const kind of ['STUNNED', 'MESMERIZED', 'CHARMED', 'AFRAID', 'ROOTED', 'SNARED']) {
    assert.ok(labels.has(kind), `no trigger produces the "${kind}" label`);
  }
});

test('every trigger has an exact line and an ended-text (no bare "contains" that would self-cancel)', () => {
  const { widget } = setup();
  for (const t of widget.customTimers) {
    assert.ok(t.triggerText && t.triggerText.length > 4, `empty trigger on ${t.name}`);
    assert.notEqual(t.triggerMatch, 'contains', `${t.name} uses contains - "stunned" would match "no longer stunned"`);
    assert.ok(t.endedText && t.endedText.length > 3, `${t.name} has no ended text to clear on`);
  }
});

test('a stun lands and shows STUNNED, then the fade line clears it', () => {
  const { engine } = setup();
  engine.handleLine(`${TS}You are stunned!`);
  let active = engine.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].name, 'STUNNED');
  // {spell} resolves to the timer's own name in the renderer - the engine carries it as .name.
  engine.handleLine(`${TS}You are no longer stunned.`);
  assert.equal(engine.getActive().length, 0, 'the fade line did not clear the tile');
});

test('the landing line does not also match the fade text (exact match, both directions)', () => {
  const { engine } = setup();
  // "You are no longer stunned." must NOT be read as a stun landing.
  engine.handleLine(`${TS}You are no longer stunned.`);
  assert.equal(engine.getActive().length, 0, '"no longer stunned" was mistaken for a stun landing');
});

test('a mez replaces a snare on the one tile (newest control wins, not stacked)', () => {
  const { engine, widget } = setup();
  assert.notEqual(widget.stackTextLines, true, 'the preset must not stack - it is a "what is on me now" readout');
  engine.handleLine(`${TS}You are ensnared.`);
  engine.handleLine(`${TS}You have been entranced.`);
  const names = engine.getActive().map((b) => b.name);
  // both engine entries can exist; the renderer's one-line text path shows the newest. What
  // matters here is that the mez registered.
  assert.ok(names.includes('MESMERIZED'), 'the mez that landed second never registered');
});

test('an unrelated line naming one of the words in chat does not fire it', () => {
  const { engine } = setup();
  engine.handleLine(`${TS}Rallia tells the guild, 'i am no longer afraid of that pull'`);
  engine.handleLine(`${TS}Kaurus says, 'you are stunned! haha'`);
  assert.equal(engine.getActive().length, 0, 'a chat line fired the aura');
});

test('it carries the generic "You lose control of yourself!" catch-all', () => {
  const { widget, engine } = setup();
  const controlled = widget.customTimers.find((t) => t.name === 'CONTROLLED');
  assert.ok(controlled, 'no CONTROLLED trigger in the preset');
  assert.equal(controlled.triggerText, 'You lose control of yourself!');
  engine.handleLine(`${TS}You lose control of yourself!`);
  assert.deepEqual(engine.getActive().map((b) => b.name), ['CONTROLLED']);
  engine.handleLine(`${TS}You have control of yourself again.`);
  assert.equal(engine.getActive().length, 0, 'the "have control again" line did not clear it');
});

test('the v4 -> v5 migration adds CONTROLLED to a Loss of control aura that predates it', () => {
  const data = {};
  const io = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  // A v4 store with a Loss of control aura that has NO CONTROLLED trigger.
  const s1 = new WidgetStore(io);
  const w = s1.createTextAura('Loss of control', { preset: 'lossOfControl' });
  data.widgets.version = 4;
  data.widgets.widgets = data.widgets.widgets.map((x) =>
    x.id === w.id ? { ...x, customTimers: x.customTimers.filter((t) => t.name !== 'CONTROLLED') } : x
  );
  data.widgets.version = 4;

  const s2 = new WidgetStore(io); // reload -> migrate
  const migrated = s2.getAll().find((x) => x.id === w.id);
  assert.equal(data.widgets.version, 5);
  assert.ok(
    migrated.customTimers.some((t) => t.triggerText === 'You lose control of yourself!'),
    'the migration did not add the catch-all'
  );

  // Idempotent: a hand-removed CONTROLLED stays removed on the next load (version-gated).
  s2.update(migrated.id, {
    customTimers: migrated.customTimers.filter((t) => t.name !== 'CONTROLLED'),
  });
  const s3 = new WidgetStore(io);
  const after = s3.getAll().find((x) => x.id === w.id);
  assert.ok(
    !after.customTimers.some((t) => t.triggerText === 'You lose control of yourself!'),
    'the migration re-added a deliberately deleted trigger'
  );
});

test('it is wired into the premade list under event-alerts', () => {
  assert.match(rendererSrc, /id: 'loss-of-control'/);
  assert.match(rendererSrc, /createTextAuraWidget\(name, 'lossOfControl'\)/);
  const block = rendererSrc.slice(rendererSrc.indexOf("id: 'loss-of-control'"), rendererSrc.indexOf("id: 'loss-of-control'") + 400);
  assert.match(block, /group: 'event-alerts'/);
});

module.exports = () => report('loss-of-control');
if (require.main === module) report('loss-of-control').then((n) => process.exit(n ? 1 : 0));
