'use strict';
/**
 * The "reset or keep progress?" popup (owner's weekly notes, 13 Sep) - a small always-on-top
 * window, generic by design so a later question (the damage meter's own zone-re-entry ask, still
 * queued) can reuse it rather than getting a second copy - see resetPromptWindow.js's own header.
 * Only the raid-named board actually asks it anything today.
 *
 * resetPromptWindow.js requires 'electron' (a BrowserWindow), so - same convention as
 * raid-named-wiring.test.js / zone-timer.test.js - its wiring is checked by reading source rather
 * than executing it; the DECISION logic it fronts for lives in raidNamedTracker.js and is fully
 * exercised (constructed and run) in raid-named-tracker.test.js.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

test('the window module is generic - it takes a message/labels and reports back a choice, no raid-board knowledge', () => {
  const src = read('src', 'main', 'resetPromptWindow.js');
  assert.match(src, /function ask\(\{ message, resetLabel[^}]*\}, onAnswer\)/);
  assert.doesNotMatch(src, /raidNamed|RaidNamedTracker/i, 'the popup module should not know who is asking');
});

test('main.js owns the decision - raidNamedTracker.resolveResetPrompt is called from the answer callback', () => {
  const src = read('src', 'main', 'main.js');
  assert.match(src, /raidNamedTracker\.on\('resetPromptNeeded', \(\{ zone \}\) => \{/);
  assert.match(src, /resetPromptWindow\.ask\(/);
  assert.match(src, /raidNamedTracker\.resolveResetPrompt\(choice\)/);
});

test('it is wired IPC -> preload -> renderer', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(main, /ipcMain\.handle\('resetPrompt:getPending'/);
  assert.match(main, /ipcMain\.handle\('resetPrompt:answer'/);
  const preload = read('src', 'preload', 'preload-reset-prompt.js');
  assert.match(preload, /getPending: \(\) => ipcRenderer\.invoke\('resetPrompt:getPending'\)/);
  assert.match(preload, /answer: \(choice\) => ipcRenderer\.invoke\('resetPrompt:answer', choice\)/);
  assert.match(preload, /onPendingChanged:/);
  const rendererJs = read('src', 'renderer', 'reset-prompt', 'reset-prompt.js');
  assert.match(rendererJs, /window\.eqResetPrompt\.answer\('keep'\)/);
  assert.match(rendererJs, /window\.eqResetPrompt\.answer\('reset'\)/);
});

test('the renderer HTML loads its own script and CSS, not a copy of the ambiguous popup\'s', () => {
  const html = read('src', 'renderer', 'reset-prompt', 'index.html');
  assert.match(html, /reset-prompt\.css/);
  assert.match(html, /reset-prompt\.js/);
});

module.exports = () => report('reset-prompt');
if (require.main === module) report('reset-prompt').then((n) => process.exit(n ? 1 : 0));
