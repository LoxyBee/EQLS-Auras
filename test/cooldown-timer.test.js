'use strict';
/**
 * The cooldown premade - note 15.
 *
 * The note was marked blocked because per-spell recast times "do not exist anywhere in this
 * project". They do now: the roster rebuild brought reuseSec in on 989 of 1,052 entries, so the
 * blocker was stale rather than real. What was left was the part the note warned about, and it
 * warned correctly.
 *
 * Three things in here are measured rather than chosen, and each one changed the design:
 *
 * The countdown is castSec + reuseSec, not reuseSec. The recast clock starts when a cast
 * FINISHES; this timer starts when it begins, because the cast line is the only line guaranteed
 * to appear. Promised Renewal is an 18s recast with a 3s cast, and the gap between her
 * consecutive casts in 1.5M lines of log peaks at exactly 21s. It also explains the mined 21.5s
 * figure that looked wrong against her in-game 18s - it was recast plus cast all along.
 *
 * Matching has to be rank-aware. 2,464 of her 10,692 casts carry a mote tier - "Cannibalize V",
 * "Promised Renewal VII" - and the roster holds only the base name. A timer keyed on the literal
 * name would never once fire for her.
 *
 * But it must not be loose. Thirteen spells with a real recast are a prefix of another spell:
 * "Fire" also starts "Fire Bolt", "Yaulp" also starts "Yaulp III". So the trigger is neither
 * exact-line nor contains - it is a third mode that parses the cast line and resolves the spell.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');
const { matchOwnInterrupt } = require('../src/main/buffParser');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const preloadSrc = read('src', 'preload', 'preload-main.js');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function setup(timers) {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const widgets = new WidgetStore(store);
  const buffs = new BuffStore(store);
  for (const [spellName, cooldownSec] of timers) {
    widgets.createCooldownTimer(spellName, { spellName, cooldownSec });
  }
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => widgets.getAll());
  engine.setResolveSpellFn((n) => {
    const known = buffs.getByName(n);
    return known ? known.name : null;
  });
  clearInterval(engine.tickTimer);
  return { widgets, engine };
}

const feed = (e, ...lines) => lines.forEach((l) => e.handleLine(TS + l));
const running = (e) => e.getActive().map((t) => t.name).sort();

// ---------------------------------------------------------------------------
// The data the note said did not exist
// ---------------------------------------------------------------------------

test('the roster carries recast times, so the note is unblocked', () => {
  const withReuse = roster.filter((e) => typeof e.reuseSec === 'number' && e.reuseSec > 0);
  assert.ok(withReuse.length > 900, `only ${withReuse.length} entries carry a recast time`);
  assert.ok(roster.some((e) => typeof e.castSec === 'number'), 'no cast time on any entry');
});

test('the global cooldown is excluded, and it is half the list', () => {
  // 1.5s is the shared global cooldown, not a per-spell recast. Offering those would be a
  // countdown that finishes before it can be read, on half the spells in the game.
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:castable'[\s\S]*?\n\);/);
  assert.ok(handler, 'the castable-spell list has been renamed or restructured');
  assert.match(handler[0], /e\.reuseSec > 1\.5/);

  const all = roster.filter((e) => typeof e.reuseSec === 'number' && e.reuseSec > 0);
  const real = all.filter((e) => e.reuseSec > 1.5);
  assert.ok(real.length > 400, `only ${real.length} spells left after excluding the global cooldown`);
  assert.ok(all.length - real.length > 400, 'the exclusion barely removes anything - has the data changed?');
});

test('the cooldown list is not the trackable list', () => {
  // A cooldown is started by the cast line, so it needs no landing text. Reusing the trackable
  // filter would drop a third of the candidates for a reason that does not apply to them.
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:castable'[\s\S]*?\n\);/)[0];
  assert.doesNotMatch(handler, /landingText/, 'the cooldown list is filtering on landing text');

  const real = roster.filter((e) => typeof e.reuseSec === 'number' && e.reuseSec > 1.5);
  const noLanding = real.filter((e) => !(e.landingText && String(e.landingText).trim()));
  assert.ok(noLanding.length > 100, `only ${noLanding.length} would be lost - is the distinction still real?`);
});

test('the offered countdown is the recast plus the cast time', () => {
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:castable'[\s\S]*?\n\);/)[0];
  assert.match(handler, /cooldownSec: e\.reuseSec \+/);

  // Promised Renewal is the one checked against the game and against the logs: 18 + 3 = 21, and
  // 21s is exactly where her consecutive casts pile up.
  const pr = roster.find((e) => e.name === 'Promised Renewal');
  assert.equal(pr.reuseSec, 18, 'Promised Renewal is no longer 18s - the worked example is stale');
  assert.equal(pr.castSec, 3);
});

// ---------------------------------------------------------------------------
// Starting it
// ---------------------------------------------------------------------------

test('a plain cast starts the countdown', () => {
  const { engine } = setup([['Promised Renewal', 21]]);
  feed(engine, 'You begin casting Promised Renewal.');
  assert.deepEqual(running(engine), ['Promised Renewal']);
  assert.equal(engine.getActive()[0].remainingSec, 21);
});

test('the ranked casts she actually makes start it too', () => {
  // The one that decides whether this works for her at all. She casts Promised Renewal VII 157
  // times, V 43 times and IX 34 times, and plain Promised Renewal far less.
  for (const rank of ['VII', 'V', 'IX', 'III']) {
    const { engine } = setup([['Promised Renewal', 21]]);
    feed(engine, `You begin casting Promised Renewal ${rank}.`);
    assert.deepEqual(running(engine), ['Promised Renewal'], `rank ${rank} did not start it`);
  }
});

test('a spell whose name merely ends in a numeral is its own spell', () => {
  // Yaulp III is not a rank of Yaulp - it is a separate spell with its own recast, and there are
  // ten like it in the roster (Rune I-IV, Burnout II-III, Monster Summoning I-II).
  const { engine } = setup([['Yaulp', 18]]);
  feed(engine, 'You begin casting Yaulp III.');
  assert.deepEqual(running(engine), [], 'casting Yaulp III started the Yaulp cooldown');
  feed(engine, 'You begin casting Yaulp.');
  assert.deepEqual(running(engine), ['Yaulp']);
});

test('a spell that merely starts with the same words does not fire it', () => {
  // Thirteen of the 478 candidates are a prefix of another spell. This is why the trigger is not
  // a "contains" match on "You begin casting Fire".
  const { engine } = setup([['Fire', 10]]);
  feed(engine, 'You begin casting Fire Bolt.');
  assert.deepEqual(running(engine), [], 'Fire Bolt started the Fire cooldown');
  feed(engine, 'You begin casting Fire.');
  assert.deepEqual(running(engine), ['Fire']);
});

test('a sung spell starts it', () => {
  const { engine } = setup([["Denon's Desperate Dirge", 12]]);
  feed(engine, "You begin singing Denon's Desperate Dirge IX.");
  assert.deepEqual(running(engine), ["Denon's Desperate Dirge"]);
});

test('somebody else casting it does nothing', () => {
  const { engine } = setup([['Promised Renewal', 21]]);
  feed(engine, 'Baxa begins casting Promised Renewal VII.');
  assert.deepEqual(running(engine), []);
});

test('recasting restarts the countdown rather than stacking', () => {
  const { engine } = setup([['Promised Renewal', 21]]);
  feed(engine, 'You begin casting Promised Renewal VII.');
  const first = engine.getActive()[0].id;
  feed(engine, 'You begin casting Promised Renewal VII.');
  assert.equal(engine.getActive().length, 1, 'a recast stacked a second countdown');
  assert.equal(engine.getActive()[0].id, first);
});

// ---------------------------------------------------------------------------
// Taking it back
// ---------------------------------------------------------------------------

test('an interrupted cast starts no cooldown', () => {
  // 16% of her casts are interrupted. A countdown that ignored this would sit there saying a
  // spell was unavailable when it was ready - and that is the answer she would act on.
  const { engine } = setup([['Promised Renewal', 21]]);
  feed(engine, 'You begin casting Promised Renewal VII.');
  assert.deepEqual(running(engine), ['Promised Renewal']);
  feed(engine, 'Your Promised Renewal spell is interrupted.');
  assert.deepEqual(running(engine), []);
});

test("somebody else's interrupt leaves hers alone", () => {
  // 1,141 of the 1,711 interrupt lines in her logs belong to other people.
  const { engine } = setup([['Promised Renewal', 21]]);
  feed(engine, 'You begin casting Promised Renewal VII.');
  feed(engine, "Baxa's Promised Renewal spell is interrupted.");
  assert.deepEqual(running(engine), ['Promised Renewal']);
});

test('an interrupt of a different spell leaves it alone', () => {
  const { engine } = setup([['Promised Renewal', 21]]);
  feed(engine, 'You begin casting Promised Renewal VII.');
  feed(engine, 'Your Superior Healing spell is interrupted.');
  assert.deepEqual(running(engine), ['Promised Renewal']);
});

test('an interrupt does not cancel a hand-built timer', () => {
  // Only castOf timers are cancelled. Nothing here knows what an arbitrary trigger meant, so
  // cancelling one on an unrelated line would be guessing.
  // The trigger text is the SPELL NAME on purpose, so the only thing standing between this timer
  // and the cancel is the castOf check. With unrelated trigger text the test passes whether that
  // check exists or not, and proves nothing.
  const { widgets, engine } = setup([]);
  const w = widgets.create('Manual');
  widgets.addCustomTimer(w.id, { name: 'My reminder', durationSec: 30, triggerText: 'Promised Renewal' });
  feed(engine, 'Promised Renewal');
  assert.deepEqual(running(engine), ['My reminder']);
  feed(engine, 'Your Promised Renewal spell is interrupted.');
  assert.deepEqual(running(engine), ['My reminder'], 'a hand-built timer was cancelled by an interrupt');
});

test('the interrupt line is matched, and only hers', () => {
  assert.equal(matchOwnInterrupt(`${TS}Your Superior Healing spell is interrupted.`), 'Superior Healing');
  assert.equal(matchOwnInterrupt(`${TS}Baxa's Tremor spell is interrupted.`), null);
  assert.equal(matchOwnInterrupt(`${TS}Your Yaulp spell has worn off.`), null);
});

// ---------------------------------------------------------------------------
// Nothing else changes
// ---------------------------------------------------------------------------

test('exact triggers are untouched by the new mode', () => {
  const { widgets, engine } = setup([]);
  const w = widgets.create('Manual');
  widgets.addCustomTimer(w.id, { name: 'Hi', durationSec: 5, triggerText: 'hi' });
  feed(engine, 'hi');
  assert.deepEqual(running(engine), ['Hi']);
  engine.activeTimers.clear();
  feed(engine, 'You begin casting Hi.');
  assert.deepEqual(running(engine), [], 'an exact trigger started matching cast lines');
});

test('castOf is stored only for a cooldown timer', () => {
  const { widgets } = setup([['Promised Renewal', 21]]);
  const cd = widgets.getAll().find((x) => x.customTimers && x.customTimers.length);
  assert.equal(cd.customTimers[0].triggerMatch, 'castOf');
  assert.equal(cd.customTimers[0].triggerText, 'Promised Renewal', 'triggerText must be the spell, not a line');
  assert.equal(cd.customTimers[0].durationSec, 21);
  assert.equal(cd.buffSource, 'customTimer');
  assert.deepEqual(cd.buffNames, ['Promised Renewal'], 'the overlay filters on buffNames, so it must name the spell');
});

// ---------------------------------------------------------------------------
// Reaching it
// ---------------------------------------------------------------------------

test('the premade is offered, opens the shared panel, and is not also on the roadmap', () => {
  assert.match(rendererSrc, /id: 'cooldown-timer',/, 'no Cooldown timer premade');
  assert.match(rendererSrc, /mode: 'cooldown',/);
  const planned = rendererSrc.slice(rendererSrc.indexOf('const PLANNED_PREMADE_WIDGETS = ['));
  assert.doesNotMatch(
    planned.slice(0, planned.indexOf('\n  ];')),
    /name: 'Cooldown timer'/,
    'Cooldown timer is still listed as "not built yet" - it would appear twice in Add Aura'
  );
});

test('the recast is offered as a correctable default, not a fact', () => {
  // Of the two recast times checked in game, one was wrong. Showing it as unchangeable truth
  // would be exactly the overclaim this project keeps catching itself in.
  assert.match(html, /id="buff-timer-cooldown-input"/, 'no way to correct the number');
  assert.match(rendererSrc, /buffTimerCooldownInput\.value = String\(buff\.cooldownSec\)/, 'not pre-filled');
  assert.match(rendererSrc, /usually right but not always/, 'the hint does not say the number can be wrong');
  // And a blank or nonsense box still builds something.
  assert.match(rendererSrc, /Number\.isFinite\(typed\) && typed > 0 \? typed : buffTimerChoice\.cooldownSec/);
});

test('it is wired end to end', () => {
  assert.match(preloadSrc, /getCastableBuffs:/, 'no bridge for the spell list');
  assert.match(preloadSrc, /createCooldownTimerWidget:/, 'no bridge for creating it');
  assert.match(mainSrc, /ipcMain\.handle\('buffs:castable'/, 'no handler for the list');
  assert.match(mainSrc, /ipcMain\.handle\('widget:createCooldownTimer'/, 'no handler for creating it');
  assert.match(managerSrc, /function createCooldownTimerWidget\(/, 'no manager function');
  assert.match(managerSrc, /^ {2}createCooldownTimerWidget,$/m, 'not exported');
  assert.match(mainSrc, /customTimerEngine\.setResolveSpellFn\(/, 'the engine cannot resolve a rank');
});

test('the panel asks no source question for a cooldown', () => {
  // A cooldown is always your own. Leaving "on you / on an ally" up would be a live control that
  // means nothing here.
  const fn = rendererSrc.match(/function chooseBuffTimerSpell\(buff\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'chooseBuffTimerSpell has been restructured');
  assert.match(fn[1], /if \(buffTimerMode === 'cooldown'\) \{/);
  assert.match(fn[1], /buffTimerSourceRow\.style\.display = 'none';/);
});

module.exports = () => report('cooldown-timer');
if (require.main === module) report('cooldown-timer').then((n) => process.exit(n ? 1 : 0));
