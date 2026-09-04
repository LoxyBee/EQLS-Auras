'use strict';
/**
 * logGroupPeek.readRecentGroup - startup group-roster recovery.
 *
 * logWatcher starts at EOF and never replays history, so a restart mid-session leaves groupRoster
 * empty until the next join line. The damage meter's "group" scope then falls back to the whole
 * fight, and (once the friend/enemy bootstrap has to re-learn everyone) groupmates drop off the
 * current fight entirely. This reads UPWARD from the end of the live log to rebuild membership from
 * the join lines and the "<Name> tells the group" chatter, stopping at the player's own
 * join/removed line (a different group's roster ends there).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { readRecentGroup } = require('../src/main/logGroupPeek');
const { GroupRoster } = require('../src/main/groupRoster');

function tmpLog(lines, eol = '\r\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpeek-'));
  const p = path.join(dir, 'eqlog_Test.txt');
  fs.writeFileSync(p, lines.join(eol) + eol);
  return { p, dir };
}
const T = '[Thu Sep 03 17:00:00 2026] ';

test('rebuilds membership from join lines and group chat', () => {
  const { p, dir } = tmpLog([
    `${T}You have joined the group.`,
    `${T}Bobarafius has joined the group.`,
    `${T}Doraleous has joined the group.`,
    `${T}Avenrae tells the group, 'on my way'`,
    `${T}a Teir\`Dal rogue hits Bobarafius for 12 points of damage.`,
  ]);
  const g = readRecentGroup(p);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(g);
  assert.deepEqual(g.admitted.sort(), ['avenrae', 'bobarafius', 'doraleous']);
});

test('a "You have joined the group" line is the boundary - an earlier group does not bleed through', () => {
  const { p, dir } = tmpLog([
    `${T}Xaanru has joined the group.`,          // old group
    `${T}Yelisa tells the group, 'hi'`,          // old group
    `${T}You have been removed from the group.`,
    `${T}You have joined the group.`,            // new group starts here
    `${T}Bobarafius has joined the group.`,
    `${T}Doraleous tells the group, 'ready'`,
  ]);
  const g = readRecentGroup(p);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(g.admitted.sort(), ['bobarafius', 'doraleous']);
  assert.ok(!g.admitted.includes('xaanru') && !g.admitted.includes('yelisa'));
});

test('someone who left is off "members" but stays "admitted"', () => {
  const { p, dir } = tmpLog([
    `${T}You have joined the group.`,
    `${T}Bobarafius has joined the group.`,
    `${T}Doraleous has joined the group.`,
    `${T}Doraleous has left the group.`,
  ]);
  const g = readRecentGroup(p);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(g.admitted.sort(), ['bobarafius', 'doraleous'], 'their earlier damage still counts');
  assert.deepEqual(g.members.sort(), ['bobarafius']);
});

test('quoted chat about the group does not seed a name', () => {
  const { p, dir } = tmpLog([
    `${T}You have joined the group.`,
    `${T}Bobarafius has joined the group.`,
    `${T}Bobarafius tells the group, 'lol he said Fakename has joined the group'`,
  ]);
  const g = readRecentGroup(p);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(g.admitted.sort(), ['bobarafius']);
});

test('no group activity in the tail -> null', () => {
  const { p, dir } = tmpLog([`${T}You crush a rat for 3 points of damage.`, `${T}You gain experience!`]);
  const g = readRecentGroup(p);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(g, null);
});

test('GroupRoster.seed merges without wiping a live join', () => {
  const r = new GroupRoster();
  r.handleLine(`${T}Newguy has joined the group.`); // came in live since launch
  const changed = r.seed({ admitted: ['bobarafius', 'newguy'], members: ['bobarafius', 'newguy'] });
  assert.ok(changed);
  assert.deepEqual(r.getAdmitted().sort(), ['bobarafius', 'newguy']);
});

module.exports = () => report('log-group-peek');
if (require.main === module) report('log-group-peek').then((n) => process.exit(n ? 1 : 0));
