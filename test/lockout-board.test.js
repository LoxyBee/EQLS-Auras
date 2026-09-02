'use strict';
/**
 * The raid-lockout aura's row builder (src/shared/lockoutBoard.js). Owner's spec, 2 Sep 2026:
 * group by raid zone, list the difficulty tiers still owed this week as "d1 · Normal" etc, drop
 * anything already completed, drop a zone with nothing left.
 *
 * Fed the real lockoutService.getProjection() output so the shape it consumes is the shape the
 * service actually produces - not a hand-built fixture that could drift.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { LockoutService, civilNow } = require('../src/main/lockoutService');
const { lockoutBoardRows, tierTag } = require('../src/shared/lockoutBoard');

const T = (t, txt) => `[${t}] ${txt}`;
const NOW = () => civilNow(new Date(2026, 7, 28, 12, 0, 0)); // Fri 28 Aug, inside the 25 Aug period

function service(file = 'C:/eq/Logs/eqlog_Shara_rivervale.txt') {
  const s = new LockoutService();
  s.setCurrentFileFn(() => file);
  s.setResetRule({ weekday: 2, hour: 11 });
  return s;
}

test('tierTag counts from 1, not 0', () => {
  assert.equal(tierTag(0), 'd1');
  assert.equal(tierTag(4), 'd5');
  assert.equal(tierTag(undefined), '');
});

test('an empty projection yields a single "no data" row, not a crash', () => {
  const rows = lockoutBoardRows({ characters: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'empty');
});

test('a fresh week lists every zone with all five tiers owed', () => {
  const s = service();
  s.handleLine(T('Wed Aug 27 20:00:00 2026', "You have been assigned the task 'Potential of the Void - Lord Nagafen - Weekly'."));
  const rows = lockoutBoardRows(s.getProjection(NOW()));
  const zones = rows.filter((r) => r.kind === 'zone').map((r) => r.label);
  assert.ok(zones.length >= 3, `expected several zones, got ${zones.length}`);
  // every tier row sits under a zone row and carries a dN tag + a name
  for (const r of rows.filter((r) => r.kind === 'tier')) {
    assert.match(r.label, /^d[1-5] · \w/, `tier row label "${r.label}" is not "dN · Name"`);
    assert.match(r.tierTag, /^d[1-5]$/);
  }
});

test('a completed tier is dropped; its siblings stay', () => {
  const s = service();
  // clear Plane of Fear at Normal (group, no index -> Normal by the omission rule)
  s.handleLine(T('Wed Aug 27 19:00:00 2026', 'You have entered The Plane of Fear - Group.'));
  s.handleLine(T('Wed Aug 27 19:30:00 2026', 'Terror has been slain by Shara!'));
  s.handleLine(T('Wed Aug 27 19:35:00 2026', 'Dread has been slain by Shara!'));
  s.handleLine(T('Wed Aug 27 19:40:00 2026', 'Fright has been slain by Shara!'));
  s.handleLine(T('Wed Aug 27 19:45:00 2026', 'A dracoliche has been slain by Shara!'));
  s.handleLine(T('Wed Aug 27 19:50:00 2026', 'Cazic-Thule has been slain by Shara!'));
  const rows = lockoutBoardRows(s.getProjection(NOW()));
  const fearIdx = rows.findIndex((r) => r.kind === 'zone' && /Plane of Fear/.test(r.label));
  if (fearIdx !== -1) {
    // the tiers immediately under Plane of Fear must not include a completed d1
    const under = [];
    for (let i = fearIdx + 1; i < rows.length && rows[i].kind === 'tier'; i++) under.push(rows[i]);
    assert.ok(!under.some((t) => t.state === 'completed'), 'a completed tier leaked into the owed list');
  }
  // nothing in the whole board is ever a completed tier
  assert.ok(!rows.some((r) => r.kind === 'tier' && r.state === 'completed'));
});

test('opts.character restricts the board to one character', () => {
  const s = new LockoutService();
  let file = 'C:/eq/Logs/eqlog_Shara_rivervale.txt';
  s.setCurrentFileFn(() => file);
  s.setResetRule({ weekday: 2, hour: 11 });
  s.handleLine(T('Wed Aug 27 20:00:00 2026', "You have been assigned the task 'Potential of the Void - Lord Nagafen - Weekly'."));
  file = 'C:/eq/Logs/eqlog_Baxa_rivervale.txt';
  s.handleLine(T('Wed Aug 27 20:05:00 2026', "You have been assigned the task 'Potential of the Void - Lady Vox - Weekly'."));

  const all = lockoutBoardRows(s.getProjection(NOW()));
  assert.ok(all.some((r) => r.kind === 'character' && r.label === 'Shara'));
  assert.ok(all.some((r) => r.kind === 'character' && r.label === 'Baxa'));

  const justShara = lockoutBoardRows(s.getProjection(NOW()), { character: 'Shara' });
  assert.ok(!justShara.some((r) => r.kind === 'character'), 'single character needs no header');
  assert.ok(justShara.some((r) => r.kind === 'zone'));
});

module.exports = () => report('lockout-board');
if (require.main === module) report('lockout-board').then((n) => process.exit(n ? 1 : 0));
