'use strict';
/**
 * "The fight breakdown for each zone should say what fight it is - if a named was fought it
 * should list the named, if no named was found it should just say Trash" (owner, 14 Sep).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { labelFight } = require('../src/shared/fightLabel');

test('a fight with only article-prefixed trash targets is labelled Trash', () => {
  assert.equal(labelFight(['a zol ghoul knight', 'an ice bones']), 'Trash');
});

test('a fight against a bare-named target lists that name', () => {
  assert.equal(labelFight(['a zol ghoul knight', 'Fright']), 'Fright');
});

test('a fight with more than one named target (an add pull) joins them, dropping none', () => {
  assert.equal(labelFight(['Fright', 'Djarn']), 'Fright & Djarn');
});

test('no enemy targets at all is Trash, not a crash', () => {
  assert.equal(labelFight([]), 'Trash');
  assert.equal(labelFight(null), 'Trash');
  assert.equal(labelFight(undefined), 'Trash');
});

module.exports = () => report('fight-label');
if (require.main === module) report('fight-label').then((n) => process.exit(n ? 1 : 0));
