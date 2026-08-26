'use strict';
/**
 * The "example library" backlog ask: a worked example in the premade list showing something the
 * simpler premades can't, so it earns a place instead of duplicating Cooldown timer under a
 * second name. Reported live 25 Aug, checked against the running code the same day and found NOT
 * actually built (the note had been mismarked done, confused with the Cooldown timer premade
 * itself or the unrelated custom-timer modal rework).
 *
 * "Skill ready reminder" reuses the entire Cooldown timer picker/creation path unchanged (same
 * spell list, same recast-time field, same createCooldownTimerWidget call) and adds exactly one
 * thing after creation: reverseDetection flipped on, via the already-existing
 * setWidgetReverseDetection call. That's deliberate - the whole point is demonstrating what
 * Reverse detection does with real, working spell data, not inventing new engine behaviour.
 *
 * Driven by reading the renderer's own source (a DOM/Electron bridge isn't available in a plain
 * Node test), same convention as premade-list.test.js and buff-timer-premade.test.js.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const rendererSrc = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8')
  .replace(/\r\n/g, '\n');

test('the example premade exists, in the timers group, reusing the Cooldown timer panel', () => {
  const start = rendererSrc.indexOf("id: 'skill-ready-reminder'");
  assert.notEqual(start, -1, 'skill-ready-reminder premade entry not found');
  const entry = rendererSrc.slice(start, rendererSrc.indexOf('},', start));
  assert.match(entry, /group: 'timers'/, 'should sit with the other timer premades, not standalone');
  assert.match(entry, /panel: 'buff-timer'/, 'should reuse the existing spell-picker panel');
  assert.match(entry, /mode: 'cooldown'/, 'should reuse the Cooldown timer question set, not a new one');
  assert.match(entry, /reverseExample: true/);
});

test('resetBuffTimerPanel threads the reverse-example flag through, defaulting off', () => {
  const fnStart = rendererSrc.indexOf('function resetBuffTimerPanel(');
  assert.notEqual(fnStart, -1);
  const fn = rendererSrc.slice(fnStart, rendererSrc.indexOf('\n  }', fnStart));
  assert.match(fn, /resetBuffTimerPanel\(preferredSource, mode, reverseExample\)/);
  assert.match(
    fn, /buffTimerReverseExample = !!reverseExample/,
    'an ordinary premade (Buff timer, Cooldown timer, Debuff on an enemy) passes no third argument - !! must turn that into false, not undefined leaking through'
  );
});

test('the caller passes the new premade its own flag, not silently dropping it', () => {
  assert.match(
    rendererSrc,
    /resetBuffTimerPanel\(premade\.defaultSource, premade\.mode, premade\.reverseExample\)/,
    'the panel-opening call site was not updated to forward premade.reverseExample'
  );
});

test('creating in reverse-example mode flips reverseDetection on after the widget exists, not instead of creating it', () => {
  // Confirms the composition is additive: createCooldownTimerWidget still runs unconditionally,
  // and setWidgetReverseDetection is a second, separate call layered on top of its result - not a
  // different creation path that could drift from the real Cooldown timer's own behaviour.
  const createIdx = rendererSrc.indexOf('.createCooldownTimerWidget(buffTimerChoice.name, buffTimerChoice.name, cooldownSec, buffTimerChoice.iconId)');
  assert.notEqual(createIdx, -1, 'the plain cooldown-timer create call was not found where expected');
  const block = rendererSrc.slice(createIdx, rendererSrc.indexOf('\n      return;', createIdx));
  assert.match(block, /if \(buffTimerReverseExample\)/);
  assert.match(block, /setWidgetReverseDetection\(config\.id, true\)/);
});

module.exports = () => report('example-library');
if (require.main === module) report('example-library').then((n) => process.exit(n ? 1 : 0));
