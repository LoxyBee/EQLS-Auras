'use strict';
/**
 * Raid/group instance difficulty tier for display (owner, 14 Sep: "let's make all raid entries
 * include their difficulty level (d0, d4, etc etc)"). Confirmed against the owner's own real log:
 * "The Permafrost Caverns" alone has five distinct instance strings that all strip to the
 * identical base name via loadoutLockedZones.js's INSTANCE_SUFFIX - without this, five genuinely
 * different raids were indistinguishable in the Combat tab's history.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { difficultyLabel } = require('../src/shared/zoneDifficulty');

test('a bare "- Group" suffix (no number) is the base tier, d0', () => {
  assert.equal(difficultyLabel('The Permafrost Caverns - Group'), 'd0');
});

test('a numbered "- Group N (Name)" suffix extracts the number', () => {
  assert.equal(difficultyLabel('The Permafrost Caverns - Group 1 (Awakened)'), 'd1');
  assert.equal(difficultyLabel('The Permafrost Caverns - Group 2 (Adaptive)'), 'd2');
  assert.equal(difficultyLabel('The Permafrost Caverns - Group 3 (Fused)'), 'd3');
  assert.equal(difficultyLabel('The Permafrost Caverns - Group 4 (Refined)'), 'd4');
});

test('a "N (Name)" suffix with no "- Group" prefix also extracts the number', () => {
  assert.equal(difficultyLabel('The Ruins of Old Paineel 1 (Awakened)'), 'd1');
});

test('a zone with no instance suffix at all has no difficulty - returns null, not "d0"', () => {
  assert.equal(difficultyLabel('The Ruins of Old Paineel'), null);
  assert.equal(difficultyLabel('The Plane of Fear'), null);
});

test('an empty/missing zone string returns null, not a crash', () => {
  assert.equal(difficultyLabel(''), null);
  assert.equal(difficultyLabel(null), null);
  assert.equal(difficultyLabel(undefined), null);
});

module.exports = () => report('zone-difficulty');
if (require.main === module) report('zone-difficulty').then((n) => process.exit(n ? 1 : 0));
