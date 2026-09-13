'use strict';
/**
 * Fight history (owner's weekly notes, 13 Sep) - "a way to save and look back at past fights
 * instead of losing them the moment the meter resets", plus the per-skill breakdown behind each
 * row. In-memory for the running session only - not written to disk (see damageEngine.js's
 * `history` field comment) - and capped at MAX_HISTORY so a long session can't grow it forever.
 *
 * getHistory() is the summary list (Combat tab's list view); getHistoryFight(id) is one fight's
 * full row list including each row's own bySkill breakdown (the detail view).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { DamageEngine } = require('../src/main/damageEngine');

const T = '[Wed Aug 19 21:14:02 2026] ';

function endFight(e, atMs) {
  e.setOptions({ fightTimeoutSec: 10 });
  e.tick(atMs + 20000); // well past the timeout - forces _expireIfIdle -> reset() -> capture
}

test('a completed fight is captured to history with its total and top attacker', () => {
  const e = new DamageEngine();
  // The player's own hit proves "a zol ghoul knight" hostile (Rule 1) before Baxa's melee on the
  // same target can be classified (Rule 2) - an unestablished target would hold Baxa's line as
  // unclassifiable rather than credit it.
  e.handleLine(`${T}You crush a zol ghoul knight for 40 points of damage.`, 1000);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 100 points of damage.`, 2000);
  endFight(e, 2000);
  const history = e.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].totalDamage, 140);
  assert.equal(history[0].topAttacker, 'Baxa');
  assert.ok(typeof history[0].id === 'number');
  assert.equal(history[0].durationSec, 1, 'the two hits were 1s apart');
});

test('a fight with no counted damage is never recorded (nothing worth remembering)', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle hits YOU for 31 points of damage.`, 1000); // incoming only
  endFight(e, 1000);
  assert.deepEqual(e.getHistory(), []);
});

test('getHistoryFight returns the full row list with each attacker\'s own per-skill breakdown', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 60 points of damage.`, 1000);
  e.handleLine(`${T}You hit a zol ghoul knight for 200 points of magic damage by Energy Storm.`, 1500);
  e.handleLine(`${T}You hit a zol ghoul knight for 150 points of magic damage by Energy Storm.`, 2000);
  endFight(e, 2000);
  const id = e.getHistory()[0].id;
  const fight = e.getHistoryFight(id);
  assert.ok(fight, 'the detail record vanished even though the summary named it');
  const you = fight.rows.find((r) => r.name === 'You');
  assert.equal(you.damage, 410);
  assert.deepEqual(
    you.bySkill.map((s) => [s.skill, s.damage]),
    [['Energy Storm', 350], ['Melee', 60]],
    'biggest skill first, melee and the nuke kept separate'
  );
});

test('a name that folds two attacks into one skill (repeated Melee) sums into a single row', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 1 points of damage.`, 900);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 40 points of damage.`, 1000);
  e.handleLine(`${T}Baxa crushes a zol ghoul knight for 25 points of damage.`, 1500);
  endFight(e, 1500);
  const fight = e.getHistoryFight(e.getHistory()[0].id);
  const baxa = fight.rows.find((r) => r.name === 'Baxa');
  assert.deepEqual(baxa.bySkill, [{ skill: 'Melee', damage: 65, hits: 2 }]);
});

test('a groupmate recognised late still shows their FULL damage in history, not just what landed after', () => {
  // Same reconciliation the live meter uses (gotcha #49) - a name folded to "Other"/unclassified
  // early on gets topped up from the raw tally the moment it's recognised as a friend. History
  // must read the SAME reconciled number, not a second, independent (and lower) one.
  const e = new DamageEngine();
  // Avenrae fights a mob the player hasn't touched yet - unclassifiable, held.
  e.handleLine(`${T}Avenrae slashes a zol ghoul knight for 500 points of damage.`, 1000);
  // The player's own hit proves the mob hostile and flushes the held line.
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1200);
  endFight(e, 1200);
  const fight = e.getHistoryFight(e.getHistory()[0].id);
  const avenrae = fight.rows.find((r) => r.name === 'Avenrae');
  assert.ok(avenrae, 'the early, held hit never made it into history at all');
  assert.equal(avenrae.damage, 500);
});

test('history keeps at most MAX_HISTORY fights, dropping the oldest first', () => {
  const e = new DamageEngine();
  let t = 1000;
  for (let i = 0; i < 35; i += 1) {
    e.handleLine(`${T}You crush a zol ghoul knight for ${i + 1} points of damage.`, t);
    endFight(e, t);
    t += 25000;
  }
  const history = e.getHistory();
  assert.equal(history.length, 30, 'MAX_HISTORY was not enforced');
  assert.equal(history[0].totalDamage, 35, 'newest is not first');
  assert.equal(history[history.length - 1].totalDamage, 6, 'the oldest 5 should have been dropped, not the newest');
});

test('getHistoryFight returns null for an id that was never recorded, or has aged out', () => {
  const e = new DamageEngine();
  assert.equal(e.getHistoryFight(999), null);
});

module.exports = () => report('damage-history');
if (require.main === module) report('damage-history').then((n) => process.exit(n ? 1 : 0));
