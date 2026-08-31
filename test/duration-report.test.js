'use strict';
/**
 * QOL #49 - the per-buff "Duration looks wrong" report. buildDurationReport() is pure; it is
 * lifted out of main-window.js and run. The button wiring is checked structurally.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src', 'renderer', 'main-window');
const rendererSrc = fs.readFileSync(path.join(ROOT, 'main-window.js'), 'utf8');

function loadReport() {
  const m = rendererSrc.match(/function buildDurationReport\(\{ buff, versionInfo, logTail \}\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'buildDurationReport has been renamed or restructured');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}\nreturn buildDurationReport;`)();
}
const build = loadReport();

test('names the spell, its computed duration and the rank pulled off the name', () => {
  const out = build({
    buff: { name: 'Spirit of the Puma VII', durationSec: 168, remainingSec: 140 },
    versionInfo: { appVersion: '1.4.0' },
    logTail: '[x] LANDED "Spirit of the Puma VII" - 168s',
  });
  assert.match(out, /EQLS Auras 1\.4\.0/);
  assert.match(out, /Spell: Spirit of the Puma VII/);
  assert.match(out, /Rank in the name: VII/);
  assert.match(out, /App computed: 168s/);
  assert.match(out, /Time left when reported: 140s/);
  assert.match(out, /```\n\[x\] LANDED "Spirit of the Puma VII" - 168s\n```/);
});

test('leaves the tooltip and expectation blank for the player to fill', () => {
  const out = build({ buff: { name: 'Brilliance', durationSec: 30, remainingSec: 5 }, versionInfo: {}, logTail: 'x' });
  assert.match(out, /In-game tooltip says: \(fill in/);
  assert.match(out, /I expected: \(fill in\)/);
});

test('an unranked buff says (none), not a stray match', () => {
  const out = build({ buff: { name: 'Clarity', durationSec: 100, remainingSec: 50 }, versionInfo: {}, logTail: 'x' });
  assert.match(out, /Rank in the name: \(none\)/);
});

test('an instant / permanent buff with no duration is reported honestly', () => {
  const out = build({ buff: { name: 'Yaulp', durationSec: null, remainingSec: null }, versionInfo: {}, logTail: 'x' });
  assert.match(out, /App computed: \(no duration/);
  assert.match(out, /Time left when reported: n\/a/);
});

test('no detection log -> tells the user how to get one, does not emit an empty fence', () => {
  const out = build({ buff: { name: 'X', durationSec: 1, remainingSec: 1 }, versionInfo: {}, logTail: '' });
  assert.match(out, /turn on Diagnostics/);
  assert.ok(!out.includes('```'), 'no code fence when there is nothing to fence');
});

test('the button is wired into the Active-on-this-aura row', () => {
  assert.match(rendererSrc, /durBtn\.textContent = 'Duration looks wrong'/);
  assert.match(rendererSrc, /buildDurationReport\(\{ buff, versionInfo, logTail \}\)/);
  assert.match(rendererSrc, /li\.append\(\.\.\.\(icon \? \[icon\] : \[\]\), nameSpan, timerSpan, removeBtn, durBtn\)/);
});

module.exports = () => report('duration-report');
if (require.main === module) report('duration-report').then((n) => process.exit(n ? 1 : 0));
