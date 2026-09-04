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

test('a member talking in group chat is admitted - the "already in the group when I joined" case', () => {
  // Reported live: Avenrae and Nocturis were in the group when Shara joined, so no "has joined"
  // line ever named them, and the damage meter folded them into "Other".
  const g = new GroupRoster();
  g.handleLine(`${T}You have joined the group.`);
  g.handleLine(`${T}Avenrae tells the group, 'pulling'`);
  g.handleLine(`${T}Nocturis tells the raid, 'oom'`);
  assert.ok(g.isAdmitted('avenrae') && g.isAdmitted('nocturis'));
});

test('a guild/say line that merely quotes "tells the group" seeds nobody', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}Baxa tells the guild, 'she tells the group, hurry up'`);
  assert.deepEqual(g.getAdmitted(), []);
});

test('names are matched case-insensitively', () => {
  const g = new GroupRoster();
  g.handleLine(`${T}BAXA has joined the group.`);
  assert.ok(g.isAdmitted('baxa'));
  assert.ok(!g.isAdmitted('someone else'));
});

test('restart protection: the roster persists on change and restores within the grace window', () => {
  let saved = null;
  const g = new GroupRoster();
  g.setPersistFn((s) => { saved = s; });
  g.handleLine(`${T}You have joined the group.`);
  g.handleLine(`${T}Avenrae has joined the group.`);
  g.handleLine(`${T}Shubthulu has joined the group.`);
  assert.deepEqual([...saved.admitted].sort(), ['avenrae', 'shubthulu']);

  const restored = new GroupRoster();
  restored.restore(saved);
  assert.ok(restored.isAdmitted('avenrae') && restored.isAdmitted('shubthulu'));
});

test('restart protection: a stale or future-dated snapshot is dropped, not trusted', () => {
  const base = { members: ['avenrae'], admitted: ['avenrae'] };
  const now = 1_000_000_000_000;
  const tooOld = new GroupRoster();
  tooOld.restore({ ...base, at: now - 25 * 60 * 1000 }, now);
  assert.deepEqual(tooOld.getAdmitted(), []);
  const future = new GroupRoster();
  future.restore({ ...base, at: now + 60_000 }, now);
  assert.deepEqual(future.getAdmitted(), []);
  const fresh = new GroupRoster();
  fresh.restore({ ...base, at: now - 60_000 }, now);
  assert.deepEqual(fresh.getAdmitted(), ['avenrae']);
});

test('restart protection: joining a fresh group after restore wipes the restored roster', () => {
  const g = new GroupRoster();
  g.restore({ members: ['oldmate'], admitted: ['oldmate'], at: Date.now() - 60_000 });
  assert.ok(g.isAdmitted('oldmate'));
  g.handleLine(`${T}You have joined the group.`);
  assert.deepEqual(g.getAdmitted(), []);
});

module.exports = () => report('group-roster');
if (require.main === module) report('group-roster').then((n) => process.exit(n ? 1 : 0));
