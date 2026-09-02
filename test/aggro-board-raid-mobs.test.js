'use strict';
/**
 * Aggro Board raid fix. Its melee-line pattern required "a/an/the " in front of the mob name, so
 * every NAMED mob and raid boss ("Lady Vox", "Unmoving", "Muck covered elemental") was invisible -
 * the board sat on "nothing swinging" for whole raid fights (reported live, Sep 1).
 *
 * The article is optional now; an article-less "<name> <verb> <player> for N" is disambiguated
 * from a PLAYER meleeing something by a learned player set (bootstrapped from captures + the
 * targets of article mob hits + ctx.groupMembers), the same bidirectional style damageEngine uses.
 *
 * Each test gets a fresh module (cache-busted) because PLAYERS/MOBS/state are module-level.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { test, report } = require('./harness');

const MODPATH = path.join(__dirname, '..', 'modules', 'aggro-board.js');
function freshModule() {
  delete require.cache[require.resolve(MODPATH)];
  return require(MODPATH);
}
function driver(mod, groupMembers = []) {
  const ctx = { stripTimestamp: (l) => l.replace(/^\[[^\]]+\]\s*/, ''), now: Date.now(), groupMembers };
  const s = { showMargin: true, staleSeconds: 12 };
  return (line) => {
    const out = mod.onLine(`[ts] ${line}`, ctx, s);
    return out ? out.find((e) => !e.clear) || null : null;
  };
}

test('an article-less named mob now populates the board (was invisible)', () => {
  const run = driver(freshModule());
  const r = run('Muck covered elemental hits Avenrae for 15 points of damage.');
  assert.ok(r && r.key === 'aggro-holder' && r.name.includes('Avenrae'),
    'a named raid mob hitting a player must register');
});

test('a single-word proper-noun mob (Unmoving) registers too', () => {
  const run = driver(freshModule());
  const r = run('Unmoving bashes Avenrae for 26 points of damage.');
  assert.ok(r && r.key === 'aggro-holder' && r.name.includes('Avenrae'));
});

test('a PLAYER meleeing a single-word mob is NOT read as a mob hit', () => {
  const run = driver(freshModule());
  // Korv is established as a player by an article mob hitting him...
  const first = run('a vis ghoul knight hits Korv for 40 points of damage.');
  assert.ok(first.name.includes('Korv') && first.name.includes('ghoul') === false); // board holder is Korv, mob is the ghoul knight
  // ...so this is Korv attacking, not a mob called Korv hitting Unmoving - the line is ignored
  assert.equal(run('Korv crushes Unmoving for 300 points of damage.'), null, 'a player melee must not register or reset the board');
  // and the board is untouched: the ghoul knight dying still clears it (proves state.mob never flipped to "unmoving")
  const dead = run('a vis ghoul knight has been slain by Korv!');
  assert.equal(dead.key, 'aggro-quiet', 'the tracked mob was still the ghoul knight, not Unmoving');
});

test('a capture line seeds the player set for raidmates outside the group', () => {
  const run = driver(freshModule(), []); // empty group - Stonewahl is a raidmate, not grouped
  run("Stonewahl has captured Lady Vox's attention with an unparalleled approach!");
  // Stonewahl is now a known player, so this article-less line is Stonewahl attacking Vox
  const r1 = run('Stonewahl slashes Lady Vox for 500 points of damage.');
  assert.equal(r1, null, 'a raidmate meleeing the boss is not a mob hit');
  // but the boss hitting a groupmate IS
  const r2 = run('Lady Vox hits Avenrae for 800 points of damage.');
  assert.ok(r2 && r2.name.includes('Avenrae'));
});

test('ctx.groupMembers seeds the player set', () => {
  const run = driver(freshModule(), ['Baxa', 'Avenrae']);
  const r = run('Baxa bashes Unmoving for 120 points of damage.');
  assert.equal(r, null, 'a group member meleeing a mob is not a mob hit');
});

test('article mob hits are unchanged - still accepted, and self-clear on slain', () => {
  const run = driver(freshModule());
  const hit = run('a vis ghoul knight hits Baxa for 40 points of damage.');
  assert.ok(hit && hit.name.includes('Baxa'));
  const dead = run('a vis ghoul knight has been slain by Baxa!');
  assert.equal(dead.key, 'aggro-quiet');
});

test('"X has been slain by Y" does not poison the mob set with a dead player', () => {
  const run = driver(freshModule(), ['Avenrae']);
  run('Avenrae has been slain by Lady Vox!'); // Avenrae is a player who died
  // Avenrae meleeing later must still not read as a mob hit
  const r = run('Avenrae kicks Lady Vox for 40 points of damage.');
  assert.equal(r, null);
});

test('still valid as a v1 module', () => {
  const { validateModule } = require('../src/main/moduleHost');
  assert.equal(validateModule(freshModule()).ok, true);
});

module.exports = () => report('aggro-board-raid-mobs');
if (require.main === module) report('aggro-board-raid-mobs').then((n) => process.exit(n ? 1 : 0));
