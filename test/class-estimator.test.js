'use strict';
/**
 * Combat tab class estimate (owner, 13 Sep). Buffs can't be used for this - a buff landing on the
 * attacker doesn't say who cast it, so an ally casting Puma on them would look identical to a
 * self-cast. A combat/damage line has no such ambiguity: it always names the actual attacker. So
 * estimateClasses() only ever looks at skill names already attributed to one specific attacker,
 * and only counts a skill as evidence when it's castable by exactly one class.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, report } = require('./harness');
const { estimateClasses } = require('../src/shared/classEstimator');
const gameSpellData = require('../src/main/gameSpellData');

test('a skill castable by exactly one class is counted as evidence for that class', () => {
  const lookup = (name) => ({ 'energy storm': ['Wiz'], 'puma maw': ['Rng'] }[name.toLowerCase()] || null);
  assert.deepEqual(estimateClasses(['Energy Storm', 'Puma Maw'], lookup), ['Wiz', 'Rng']);
});

test('a skill shared by several classes contributes nothing - ambiguous, not guessed', () => {
  const lookup = (name) => ({ 'fireball': ['Wiz', 'Mag'], 'harm touch': ['Wiz'] }[name.toLowerCase()] || null);
  assert.deepEqual(estimateClasses(['Fireball', 'Harm Touch'], lookup), ['Wiz']);
});

test('an unrecognised skill name (lookup returns null) is silently skipped, not an error', () => {
  const lookup = () => null;
  assert.deepEqual(estimateClasses(['Melee', 'Some Unknown Proc'], lookup), []);
});

test('duplicate single-class skills only count their class once', () => {
  const lookup = () => ['Nec'];
  assert.deepEqual(estimateClasses(['Lifetap', 'Lifetap II'], lookup), ['Nec']);
});

test('no skill names at all (or a null/undefined list) yields no classes, not a crash', () => {
  const lookup = () => ['Nec'];
  assert.deepEqual(estimateClasses([], lookup), []);
  assert.deepEqual(estimateClasses(null, lookup), []);
  assert.deepEqual(estimateClasses(undefined, lookup), []);
});

test('three single-class skills from three different classes surface all three - the whole point for a multiclass character', () => {
  const lookup = (name) => ({ 'a': ['Rng'], 'b': ['Nec'], 'c': ['Shm'] }[name.toLowerCase()] || null);
  assert.deepEqual(new Set(estimateClasses(['A', 'B', 'C'], lookup)), new Set(['Rng', 'Nec', 'Shm']));
});

// ---------------------------------------------------------------------------
// gameSpellData.getClassesForSpell - the real field-36..51 parse, feeding the pure estimator above.
// ---------------------------------------------------------------------------

// Builds one spells_us.txt line with real field positions: id, name, ..., 16 per-class levels
// starting at field 36, ..., icon at field 75. Every other field is left blank (parse() doesn't
// read them). `levels` is a 16-length array, 255 meaning "can never cast it" per the game's own
// convention (see gameSpellData.js's header comment).
function spellLine(id, name, levels, iconId = 100) {
  const fields = new Array(76).fill('');
  fields[0] = String(id);
  fields[1] = name;
  fields[12] = '60'; // arbitrary non-zero duration, unused by this test
  for (let i = 0; i < 16; i++) fields[36 + i] = String(levels[i]);
  fields[75] = String(iconId);
  return fields.join('^');
}

const NEVER = 255;
// War, Clr, Pal, Rng, SHD, Dru, Mnk, Brd, Rog, Shm, Nec, Wiz, Mag, Enc, Bst, Ber
const NONE = new Array(16).fill(NEVER);
function only(index, level = 1) {
  const levels = NONE.slice();
  levels[index] = level;
  return levels;
}

function withTempInstall(lines, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eql-spells-'));
  fs.writeFileSync(path.join(dir, 'spells_us.txt'), lines.join('\n'), 'utf8');
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('getClassesForSpell reads the real field-36..51 layout - a Wizard-only nuke resolves to just Wiz', () => {
  withTempInstall([spellLine(1, 'Energy Storm', only(11))], (dir) => {
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, 'Energy Storm'), ['Wiz']);
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, 'energy storm'), ['Wiz'], 'must be case-insensitive');
  });
});

test('a spell several classes can cast lists every one of them, in class-id order', () => {
  const levels = NONE.slice();
  levels[9] = 1; // Shm
  levels[10] = 1; // Nec
  withTempInstall([spellLine(2, 'Shared Nuke', levels)], (dir) => {
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, 'Shared Nuke'), ['Shm', 'Nec']);
  });
});

test('an unrecognised spell name returns null, not an empty array (so the estimator can tell "no data" from "no class")', () => {
  withTempInstall([spellLine(1, 'Energy Storm', only(11))], (dir) => {
    assert.equal(gameSpellData.getClassesForSpell(dir, 'Not A Real Spell'), null);
  });
});

module.exports = () => report('class-estimator');
if (require.main === module) report('class-estimator').then((n) => process.exit(n ? 1 : 0));
