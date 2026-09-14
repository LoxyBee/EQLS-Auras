'use strict';
/**
 * Combat tab class estimate (owner, 13-14 Sep). ONLY ever built from skill names an attacker was
 * actually seen CASTING - never a damage-log skill name, which can't prove who cast a buff (a
 * proc's damage sits on the attacker whether they cast the buff themselves or an ally did). A
 * skill castable by exactly one class is CONFIRMED evidence (rendered green); a skill shared by a
 * small number of classes is MAYBE evidence for each of them (orange); a skill shared by too many
 * classes to mean anything is ignored outright.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, report } = require('./harness');
const { estimateClasses } = require('../src/shared/classEstimator');
const gameSpellData = require('../src/main/gameSpellData');

test('a spell castable by exactly one class is CONFIRMED evidence for that class', () => {
  const lookup = (name) => ({ 'energy storm': ['Wiz'], 'spirit of the puma': ['Rng'] }[name.toLowerCase()] || null);
  assert.deepEqual(
    estimateClasses(['Energy Storm', 'Spirit of the Puma'], lookup),
    [{ name: 'Wiz', confidence: 'confirmed' }, { name: 'Rng', confidence: 'confirmed' }]
  );
});

test('a spell shared by a small number of classes is MAYBE for each of them, not confirmed', () => {
  const lookup = () => ['Wiz', 'Mag'];
  assert.deepEqual(
    estimateClasses(['Fireball'], lookup),
    [{ name: 'Wiz', confidence: 'maybe' }, { name: 'Mag', confidence: 'maybe' }]
  );
});

test('a class already confirmed elsewhere is not also listed as maybe', () => {
  const lookup = (name) => ({ 'harm touch': ['Wiz'], 'fireball': ['Wiz', 'Mag'] }[name.toLowerCase()] || null);
  assert.deepEqual(
    estimateClasses(['Harm Touch', 'Fireball'], lookup),
    [{ name: 'Wiz', confidence: 'confirmed' }, { name: 'Mag', confidence: 'maybe' }]
  );
});

test('a spell shared by too many classes to mean anything contributes nothing at all', () => {
  const lookup = () => ['War', 'Clr', 'Pal', 'Rng', 'SHD']; // 5 classes - past MAX_MAYBE_CLASSES
  assert.deepEqual(estimateClasses(['Generic AA'], lookup), []);
});

test('an unrecognised skill name (lookup returns null) is silently skipped, not an error', () => {
  const lookup = () => null;
  assert.deepEqual(estimateClasses(['Melee', 'Some Unknown Proc'], lookup), []);
});

test('duplicate single-class skills only count their class once', () => {
  const lookup = () => ['Nec'];
  assert.deepEqual(estimateClasses(['Lifetap', 'Lifetap II'], lookup), [{ name: 'Nec', confidence: 'confirmed' }]);
});

test('no skill names at all (or a null/undefined list) yields no classes, not a crash', () => {
  const lookup = () => ['Nec'];
  assert.deepEqual(estimateClasses([], lookup), []);
  assert.deepEqual(estimateClasses(null, lookup), []);
  assert.deepEqual(estimateClasses(undefined, lookup), []);
});

// Owner, 14 Sep: "what in the fuck happened to the class estimation? lol" - a screenshot showing
// 10-13 classes listed for a single attacker. Root cause: with enough DIFFERENT ambiguous
// 2-3-class spells observed, a plain set union of "maybe" candidates has no ceiling - given enough
// distinct spells, it approaches every class in the game. A multiclass character has EXACTLY 3
// classes, never more (the same fact the Buff Planner's own 3-class design relies on), so the
// result must never exceed that regardless of how much evidence comes in.
test('the result never exceeds 3 classes total, no matter how many different ambiguous spells were seen', () => {
  const lookup = (name) => ({
    a: ['Wiz', 'Mag'], b: ['Enc', 'Nec'], c: ['Shm', 'Dru'], d: ['Clr', 'Pal'],
    e: ['Rng', 'Bst'], f: ['War', 'SHD'], g: ['Mnk', 'Rog'], h: ['Brd', 'Ber'],
  }[name.toLowerCase()] || null);
  const result = estimateClasses(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], lookup);
  assert.ok(result.length <= 3, `expected at most 3 classes, got ${result.length}: ${JSON.stringify(result)}`);
});

test('when capping "maybe" candidates, the classes seen across the MOST distinct spells win, not an arbitrary set order', () => {
  // Nec shows up in 3 different ambiguous spells; Wiz and Mag only 1 each - Nec should survive a
  // cap to 1 remaining slot, not whichever happened to be inserted into the Set first.
  const lookup = (name) => ({
    a: ['Nec', 'Wiz'], b: ['Nec', 'Mag'], c: ['Nec', 'Shm'],
  }[name.toLowerCase()] || null);
  const result = estimateClasses(['A', 'B', 'C'], lookup);
  const names = result.map((c) => c.name);
  assert.ok(names.includes('Nec'), `the most-corroborated class must survive the cap: ${JSON.stringify(result)}`);
});

test('confirmed evidence always outranks maybe evidence when both compete for the 3 slots', () => {
  const lookup = (name) => ({
    real1: ['Nec'], real2: ['Shm'], real3: ['Rng'],
    ambiguous: ['Wiz', 'Mag'],
  }[name.toLowerCase()] || null);
  const result = estimateClasses(['real1', 'real2', 'real3', 'ambiguous'], lookup);
  assert.deepEqual(
    result.map((c) => c.confidence),
    ['confirmed', 'confirmed', 'confirmed'],
    'with 3 confirmed classes already, no maybe slot should remain'
  );
});

test('three single-class skills from three different classes surface all three - the whole point for a multiclass character', () => {
  const lookup = (name) => ({ 'a': ['Rng'], 'b': ['Nec'], 'c': ['Shm'] }[name.toLowerCase()] || null);
  const names = new Set(estimateClasses(['A', 'B', 'C'], lookup).map((c) => c.name));
  assert.deepEqual(names, new Set(['Rng', 'Nec', 'Shm']));
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

// Owner-reported bug, 14 Sep: a combat skill was confidently reported as "Enchanter" for a
// character who never touched an Enchanter spell. Root cause: two UNRELATED spells (not rank
// tiers of one spell) sharing the exact same name resolved via "first entry in the file wins" -
// whichever class's version happened to be listed first. The fix is a UNION across every entry
// sharing a name: a name that really does mean two different spells for two different classes now
// honestly reports "2 classes" (demoting it out of "confirmed" entirely, since MAX_MAYBE_CLASSES
// in classEstimator.js only starts at 2) instead of confidently picking a winner.
test('two different spells that happen to share a name resolve to the UNION of both classes, not whichever came first', () => {
  withTempInstall([
    spellLine(1, 'Chaos Flux', only(13)), // Enc-only, listed FIRST
    spellLine(2, 'Chaos Flux', only(3)), // Rng-only, listed second - would be shadowed by first-wins
  ], (dir) => {
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, 'Chaos Flux'), ['Rng', 'Enc']);
  });
});

test('the same union fix still gives a single, unambiguous answer for a genuine rank ladder (one real spell, several entries)', () => {
  withTempInstall([
    spellLine(1, 'Yaulp VIII', only(1)), // Clr-only
    spellLine(2, 'Yaulp IX', only(1)), // Clr-only - same class, not a different spell for a different class
  ], (dir) => {
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, 'Yaulp VIII'), ['Clr']);
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, 'Yaulp IX'), ['Clr']);
  });
});

// Owner, 14 Sep, live-tested: "shara is no longer a bard, despite using denon's desperate dirge"
// - then, when I wrongly guessed it was an auto-pulse-without-a-cast-line issue, the owner
// disproved that directly with a log screenshot showing a fresh "You begin singing Denon's
// Desperate Dirge X." every single time. The REAL cause, already documented in this project
// (CLAUDE.md gotcha #3): "Denon's Desperate Dirge" is the CONFIRMED case of a bard song whose
// ranked cast-line suffix has NO corresponding entry in spells_us.txt at all - only the bare,
// un-suffixed name exists there. An exact-match-only lookup was guaranteed to return null for the
// ranked name every time, no matter how many times it was actually sung.
test('a ranked cast-line name with no matching entry in the data falls back to the base name (Denon\'s Desperate Dirge, gotcha #3)', () => {
  withTempInstall([
    spellLine(1, "Denon's Desperate Dirge", only(7)), // Bard-only, base name ONLY - no ranked entry exists
  ], (dir) => {
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, "Denon's Desperate Dirge X"), ['Brd']);
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, "Denon's Desperate Dirge IX"), ['Brd']);
  });
});

// The fallback must never PAPER OVER a real distinct spell that has its own proper entry - Yaulp's
// own tiers (gotcha #13) are genuinely different spells, not a decorative suffix, and each already
// resolves directly via exact match. The fallback is a last resort, not a rewrite.
test('the rank-suffix fallback never fires when the exact ranked name already has its own real entry', () => {
  withTempInstall([
    spellLine(1, 'Yaulp VIII', only(1)), // Clr-only
    spellLine(2, 'Yaulp IX', only(9)), // a DIFFERENT class - a real, distinct tier, not a duplicate
  ], (dir) => {
    // If the fallback wrongly fired here, stripping "Yaulp IX" to "Yaulp" would find nothing (no
    // bare "Yaulp" entry exists) and return null instead of the exact tier's own real answer.
    assert.deepEqual(gameSpellData.getClassesForSpell(dir, 'Yaulp IX'), [gameSpellData.getClassesForSpell(dir, 'Yaulp IX')[0]]);
    assert.notDeepEqual(gameSpellData.getClassesForSpell(dir, 'Yaulp IX'), gameSpellData.getClassesForSpell(dir, 'Yaulp VIII'));
  });
});

test('a name with no suffix to strip and no match either way still returns null, not a false fallback hit', () => {
  withTempInstall([spellLine(1, 'Energy Storm', only(11))], (dir) => {
    assert.equal(gameSpellData.getClassesForSpell(dir, 'Not A Real Spell'), null);
  });
});

module.exports = () => report('class-estimator');
if (require.main === module) report('class-estimator').then((n) => process.exit(n ? 1 : 0));
