'use strict';
/**
 * QOL #50 - the dismissible "still to set up" checklist on the Buff Tracker page. setupNudgeGaps()
 * is pure (no DOM); it is lifted out of main-window.js and run. The card markup, the persisted
 * dismiss flag, and the IPC are checked structurally.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const rendererSrc = read('renderer', 'main-window', 'main-window.js');
const html = read('renderer', 'main-window', 'index.html');
const preloadSrc = read('preload', 'preload-main.js');
const mainSrc = read('main', 'main.js');

function loadGaps() {
  const m = rendererSrc.match(/function setupNudgeGaps\(\{ log, spellbook, character, widgets \}\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'setupNudgeGaps has been renamed or restructured');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}\nreturn setupNudgeGaps;`)();
}
const gaps = loadGaps();
const texts = (input) => gaps(input).map((i) => i.text);

const READY = {
  log: { eqFolder: 'C:/Games/EQ' },
  spellbook: { filePath: 'C:/Games/EQ/Bob-Cleric-Spellbook.txt' },
  character: { aaLevel: 3 },
  widgets: [{ id: 'a' }],
};

test('a fully configured install shows nothing', () => {
  assert.deepEqual(gaps(READY), []);
});

test('no EQ folder is the first and only folder-related row (the spellbook row is gated behind it)', () => {
  const t = texts({ ...READY, log: {}, spellbook: {} });
  assert.ok(t.some((x) => /EverQuest folder/.test(x)));
  assert.ok(!t.some((x) => /spellbook file/.test(x)), 'no point naming a file when there is no folder to find it in');
});

test('folder set but no spellbook file -> the spellbook row', () => {
  assert.ok(texts({ ...READY, spellbook: {} }).some((x) => /spellbook file/.test(x)));
});

test('AA counts as set if ANY of the three levels is non-zero', () => {
  assert.ok(texts({ ...READY, character: { aaLevel: 0, exaltationLevel: 0, deftnessLevel: 0 } }).some((x) => /AA levels/.test(x)));
  assert.deepEqual(gaps({ ...READY, character: { exaltationLevel: 2 } }), []);
  assert.deepEqual(gaps({ ...READY, character: { deftnessLevel: 1 } }), []);
});

test('no auras at all -> the aura row, pointing at the overlay page', () => {
  const items = gaps({ ...READY, widgets: [] });
  assert.equal(items.length, 1);
  assert.equal(items[0].page, 'page-overlay');
});

test('order: folder/spellbook, then AA, then auras', () => {
  const t = texts({ log: {}, spellbook: {}, character: {}, widgets: [] });
  assert.deepEqual(
    t.map((x) => (/EverQuest folder/.test(x) ? 'folder' : /AA levels/.test(x) ? 'aa' : 'aura')),
    ['folder', 'aa', 'aura']
  );
});

test('the card, dismiss flag and IPC are wired', () => {
  assert.match(html, /id="setup-nudge-card"/);
  assert.match(html, /id="setup-nudge-dismiss"/);
  assert.match(rendererSrc, /initSetupNudge\(\);/);
  assert.match(rendererSrc, /window\.eqTracker\.dismissSetupNudge\(\)/);
  assert.match(rendererSrc, /window\.eqTracker\.getSetupNudgeDismissed\(\)/);
  assert.match(preloadSrc, /getSetupNudgeDismissed: \(\) =>/);
  assert.match(preloadSrc, /dismissSetupNudge: \(\) =>/);
  assert.match(mainSrc, /ui:getSetupNudgeDismissed/);
  assert.match(mainSrc, /saveJson\('setupNudgeDismissed', true\)/);
});

test('the first-run setup wizard is wired end to end', () => {
  // modal + all five steps
  assert.match(html, /id="setup-wizard-backdrop"/);
  for (const step of ['welcome', 'folder', 'logging', 'aa', 'done']) {
    assert.match(html, new RegExp(`data-step="${step}"`), `wizard step "${step}" missing`);
  }
  assert.match(html, /id="open-setup-wizard-btn"/, 'no "Run setup again" button on the Setup page');

  // renderer: shows once, marks done on Finish, reuses the real Setup IPC
  assert.match(rendererSrc, /function initSetupWizard\(\)/);
  assert.match(rendererSrc, /initSetupWizard\(\);/);
  assert.match(rendererSrc, /window\.eqTracker\.getSetupWizardDone\(\)\.then\(\(done\) => \{ if \(!done\) open\(\)/);
  assert.match(rendererSrc, /if \(STEPS\[i\] === 'done'\) \{ close\(true\)/);
  assert.match(rendererSrc, /window\.eqTracker\.chooseLogFolder\(\)/);
  assert.match(rendererSrc, /window\.eqTracker\.setCharacterSettings\(\{/);
  // can't skip past the folder step with nothing chosen
  assert.match(rendererSrc, /nextBtn\.disabled = step === 'folder' && !hasFolder/);

  // IPC + preload for the persisted "done" flag
  assert.match(preloadSrc, /getSetupWizardDone: \(\) =>/);
  assert.match(preloadSrc, /setSetupWizardDone: \(done\) =>/);
  assert.match(mainSrc, /ui:getSetupWizardDone/);
  assert.match(mainSrc, /saveJson\('setupWizardDone'/);
});

module.exports = () => report('setup-nudge');
if (require.main === module) report('setup-nudge').then((n) => process.exit(n ? 1 : 0));
