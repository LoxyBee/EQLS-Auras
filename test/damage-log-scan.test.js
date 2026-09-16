'use strict';
/**
 * The offline log scanner (owner, 13 Sep: "an option to back read your current log, or upload a
 * new log and parse out fights"). Feeds a real temp file through scanLogForFights() and checks the
 * result is a real, usable DamageEngine - zone-tagged fights, an uncapped history, and the
 * trailing fight (which never gets a "next line" to trigger its own close) still captured.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { scanLogForFights } = require('../src/main/damageLogScan');

function tempLog(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-scan-'));
  const file = path.join(dir, 'eqlog_Test_rivervale.txt');
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return { file, dir };
}

test('a whole log produces zone-tagged fights, including the trailing one', async () => {
  const { file, dir } = tempLog([
    '[Wed Aug 19 21:00:00 2026] You have entered Nagafen\'s Lair.',
    '[Wed Aug 19 21:00:05 2026] You crush a wan ghoul knight for 40 points of damage.',
    '[Wed Aug 19 21:00:06 2026] Baxa slashes a wan ghoul knight for 60 points of damage.',
    '[Wed Aug 19 21:05:00 2026] You have entered The Feerrott.',
    '[Wed Aug 19 21:05:05 2026] You crush a forest griffin for 25 points of damage.',
  ]);
  try {
    const engine = await scanLogForFights(file);
    const history = engine.getHistory();
    assert.equal(history.length, 2, 'both fights should have been captured, including the trailing one');
    const [newest, oldest] = history;
    assert.equal(newest.zone, 'The Feerrott');
    assert.equal(newest.totalDamage, 25);
    assert.equal(oldest.zone, "Nagafen's Lair");
    assert.equal(oldest.totalDamage, 100);
    // The trailing fight's own row/skill detail must still be readable afterward.
    const detail = engine.getHistoryFight(newest.id);
    assert.ok(detail, 'the trailing fight has no detail record - it was never really captured');
    assert.equal(detail.rows[0].name, 'You');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unstamped line does not crash the scan and is simply skipped', async () => {
  const { file, dir } = tempLog([
    '[Wed Aug 19 21:00:00 2026] You have entered Nagafen\'s Lair.',
    'a corrupted line with no timestamp at all',
    '[Wed Aug 19 21:00:05 2026] You crush a wan ghoul knight for 40 points of damage.',
  ]);
  try {
    const engine = await scanLogForFights(file);
    assert.equal(engine.getHistory().length, 1);
    assert.equal(engine.getHistory()[0].totalDamage, 40);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty file produces no history and does not throw', async () => {
  const { file, dir } = tempLog([]);
  try {
    const engine = await scanLogForFights(file);
    assert.deepEqual(engine.getHistory(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the scan is not bounded by the live 30-fight cap', async () => {
  const lines = ["[Wed Aug 19 21:00:00 2026] You have entered Nagafen's Lair."];
  let h = 21, m = 0;
  for (let i = 0; i < 40; i += 1) {
    m += 1;
    if (m >= 60) { m = 0; h += 1; }
    lines.push(`[Wed Aug 19 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00 2026] You crush a wan ghoul knight for ${i + 1} points of damage.`);
  }
  const { file, dir } = tempLog(lines);
  try {
    const engine = await scanLogForFights(file);
    assert.equal(engine.getHistory().length, 40, 'a scan should not silently drop fights past 30');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

module.exports = () => report('damage-log-scan');
if (require.main === module) report('damage-log-scan').then((n) => process.exit(n ? 1 : 0));
