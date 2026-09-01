'use strict';
/**
 * groupRoster.js - who is in the player's group, and who has been this session.
 *
 * The damage meter's "just my group" scope filters on `admitted`, which must SURVIVE a member
 * leaving and be wiped only when the player's own membership changes. Every line here is a
 * confirmed wording (gotcha #7).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { GroupRoster } = require('../src/main/groupRoster');

const T = '[Wed Aug 19 21:14:02 2026] ';

test('a member joining is in both members and admitted', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}Baxa has joined the group.`);
  assert.deepEqual(g.getMembers(), ['baxa']);
  assert.ok(g.isAdmitted('Baxa'));
});

test('a member leaving drops from members but STAYS admitted', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}Baxa has joined the group.`);
  g.handleLine(`${T}Baxa has left the group.`);
  assert.deepEqual(g.getMembers(), []);
  assert.ok(g.isAdmitted('baxa'), 'their earlier damage still counts');
});

test('the player joining a fresh group wipes the roster', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}Baxa has joined the group.`);
  g.handleLine(`${T}You have joined the group.`);
  assert.deepEqual(g.getAdmitted(), []);
});

test('the player being removed wipes the roster', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}Baxa has joined the group.`);
  g.handleLine(`${T}You have been removed from the group.`);
  assert.deepEqual(g.getAdmitted(), []);
});

test('accepting into an existing group admits the named inviter', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}You notify Vaela that you agree to join the group.`);
  assert.ok(g.isAdmitted('Vaela'));
});

test('an ordinary chat line ending "has joined the group." seeds nobody', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}Baxa tells the guild, 'so then Enro has joined the group.'`);
  assert.deepEqual(g.getAdmitted(), []);
});

test('names are matched case-insensitively', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}BAXA has joined the group.`);
  assert.ok(g.isAdmitted('baxa'));
  assert.ok(!g.isAdmitted('someone else'));
});

module.exports = () => report('group-roster');
if (require.main === module) report('group-roster').then((n) => process.exit(n ? 1 : 0));
