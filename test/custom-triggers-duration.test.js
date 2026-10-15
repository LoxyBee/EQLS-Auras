'use strict';
/**
 * "Custom triggers" - one duration per aura, not one per trigger.
 *
 * Reported live 24 Aug, looking at the Dispelled premade's settings panel: "custom text timers
 * have two settings for duration, one in the actual custom timer, and a slider at the top. i do
 * not know which has priority but there should never be two sources for this to ease confusion."
 * The second slider ("Show events for") never actually did anything for a customTimer aura -
 * see text-aura.test.js's own test for that half. This file is the other half: the per-trigger
 * Duration field in the Add/Edit Timer modal is gone, replaced by one slider on the aura itself
 * that every trigger on it shares, and the whole section (heading, hint, buttons) is relabelled
 * "Custom triggers" to match - "the custom timers section should be 'custom triggers', anything
 * that needs a timer should have a slider that affects every trigger."
 *
 * The internal names (customTimers, customTimerEngine.js, addCustomTimer, ...) are deliberately
 * NOT renamed, same terminology-split reasoning CLAUDE.md already documents for "widget"/"aura" -
 * this is a user-visible relabel, not a data migration.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('a new custom-timer aura starts with the default duration', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  assert.equal(widget.triggerDurationSec, 5);
});

test('setTriggerDurationSec sets the widget field AND rewrites every existing trigger', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 5, triggerText: 'a' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 5, triggerText: 'b' });
  const after = store.setTriggerDurationSec(widget.id, 12);
  assert.equal(after.triggerDurationSec, 12);
  assert.deepEqual(after.customTimers.map((t) => t.durationSec), [12, 12], 'existing triggers did not follow the new duration');
});

test('a trigger added AFTER the duration was raised also gets it - there is nowhere else to set it', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.setTriggerDurationSec(widget.id, 20);
  // The real form always sends the widget's own triggerDurationSec as durationSec (see
  // readTimerFormData's own test below) - reproduced directly here at the store level.
  const after = store.addCustomTimer(widget.id, { name: 'C', durationSec: 20, triggerText: 'c' });
  assert.equal(after.customTimers.at(-1).durationSec, 20);
});

test('the value is clamped to something sane, same guard every other duration-ish slider gets', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  // 0 is deliberately legitimate now, not clamped away: a trigger built purely to make a sound
  // has nothing to show for any length of time, so it shouldn't need a minimum on-screen
  // duration it never actually uses. Negative still floors at 0.
  assert.equal(store.setTriggerDurationSec(widget.id, 0).triggerDurationSec, 0);
  assert.equal(store.setTriggerDurationSec(widget.id, -5).triggerDurationSec, 0);
  assert.equal(store.setTriggerDurationSec(widget.id, 99999).triggerDurationSec, 3600);
  assert.equal(store.setTriggerDurationSec(widget.id, 'banana').triggerDurationSec, 5, 'garbage falls back to the default, not NaN');
});

test('a widget saved before this field existed inherits it from its first trigger, not the bare default', () => {
  // Reproduces exactly what was on disk for a real aura before this feature: three triggers, all
  // sharing the same duration (they always had to agree by hand), no triggerDurationSec at all.
  const store1 = newStore();
  const widget = store1.create('Dispelled', { buffSource: 'customTimer' });
  widget.customTimers = [
    { id: 'a', name: 'Dispelled', durationSec: 8, triggerText: 'x' },
    { id: 'b', name: 'Dispelled', durationSec: 8, triggerText: 'y' },
  ];
  delete widget.triggerDurationSec;
  store1._save();

  // A second WidgetStore reading the same saved data, the same way the app re-reads it on
  // startup - normalizeWidget runs on every load, not just once.
  const data = store1.store.loadJson('widgets', null);
  const store2 = new WidgetStore({
    loadJson: (n, f) => (n === 'widgets' ? JSON.parse(JSON.stringify(data)) : f),
    saveJson: () => {},
  });
  const reloaded = store2.getById(widget.id);
  assert.equal(reloaded.triggerDurationSec, 8, 'an existing aura silently reset to the bare default on upgrade');
});

test('a widget with no triggers yet falls back to the plain default, not undefined or NaN', () => {
  const store1 = newStore();
  const widget = store1.create('Empty', { buffSource: 'customTimer' });
  widget.customTimers = [];
  delete widget.triggerDurationSec;
  store1._save();
  const data = store1.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(widget.id).triggerDurationSec, 5);
});

test('it round-trips through a share code and through Duplicate (the same code path)', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.setTriggerDurationSec(widget.id, 15);
  const imported = store.importCode(store.exportCode(widget.id));
  assert.equal(imported.triggerDurationSec, 15);
});

test('the two built-in premades set it to match their own triggers', () => {
  // Both durations settled at 4s by 25 Aug (were 5s/8s) to match the owner's own live widgets -
  // see the "override the premade with what I have" note on defaultSelfBuffsWidget in
  // widgetStore.js.
  const store = newStore();
  const resisted = store.createTextAura('Resist flash', { preset: 'resisted' });
  assert.equal(resisted.triggerDurationSec, 4);
  assert.equal(resisted.customTimers[0].durationSec, 4);
  const dispelled = store.createTextAura('You Have Been Dispelled', { preset: 'dispelled' });
  assert.equal(dispelled.triggerDurationSec, 4);
  assert.ok(dispelled.customTimers.every((t) => t.durationSec === 4));
});

// ---------------------------------------------------------------------------
// The wiring - IPC end to end
// ---------------------------------------------------------------------------

test('setTriggerDurationSec is wired all the way from the renderer to the store', () => {
  assert.match(preloadSrc, /setWidgetTriggerDurationSec: \(id, seconds\)/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setTriggerDurationSec'/);
  assert.match(managerSrc, /function setTriggerDurationSec\(id, seconds\)/);
  assert.match(managerSrc, /\n  setTriggerDurationSec,/, 'not exported from widgetManager');
});

// ---------------------------------------------------------------------------
// The UI
// ---------------------------------------------------------------------------

test('the per-trigger Duration field is gone from the Add/Edit Timer modal', () => {
  assert.doesNotMatch(html, /id="widget-new-timer-minutes"/, 'the old per-trigger minutes field is still there');
  assert.doesNotMatch(html, /id="widget-new-timer-seconds"/, 'the old per-trigger seconds field is still there');
  assert.doesNotMatch(rendererSrc, /newTimerMinutesInput|newTimerSecondsInput/, 'JS still references the removed inputs');
});

test('the top-level Duration is a minute + second pair, wired both ways (owner, 5 Sep - up to 60m)', () => {
  // Replaced the 0..60s slider so a respawn window (10-15m) can be entered. The store already
  // clamped to 3600s; only the input was the wall.
  assert.match(html, /id="widget-trigger-duration-min"[^>]*max="60"/);
  assert.match(html, /id="widget-trigger-duration-sec"[^>]*max="59"/);
  assert.match(rendererSrc, /writeMinSec\(triggerDurationMinInput, triggerDurationSecInput, seconds\)/, 'never populated when a widget is selected');
  assert.match(rendererSrc, /const seconds = readMinSec\(triggerDurationMinInput, triggerDurationSecInput\)/);
  assert.match(
    rendererSrc,
    /window\.eqTracker\.setWidgetTriggerDurationSec\(selectedId, seconds\)/,
    'the boxes do not actually save anywhere'
  );
  // readMinSec caps at the store's own ceiling so an oversized entry can't get past the renderer.
  // 60 minutes by default (every duration); a trigger's Cooldown passes its own 3-hour max.
  assert.match(rendererSrc, /function readMinSec\(minEl, secEl, max = 3600\) \{/);
  assert.match(rendererSrc, /return Math\.min\(max, m \* 60 \+ s\)/);
});

test('the per-trigger Cooldown is also a minute + second pair', () => {
  assert.match(html, /id="widget-new-timer-cooldown-min"/);
  assert.match(html, /id="widget-new-timer-cooldown-sec"/);
  assert.match(rendererSrc, /cooldownSec: readMinSec\(newTimerCooldownMinInput, newTimerCooldownSecInput, COOLDOWN_MAX_SEC\)/);
  // edit populates both boxes, blank when there is no cooldown
  assert.match(rendererSrc, /writeMinSec\(newTimerCooldownMinInput, newTimerCooldownSecInput, timer\.cooldownSec \|\| 0, true, COOLDOWN_MAX_SEC\)/);
});

test('the form reads duration from the widget itself, not from any input box', () => {
  const fn = rendererSrc.match(/function readTimerFormData\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'readTimerFormData has been restructured');
  assert.match(fn[1], /findWidget\(selectedId\)\?\.triggerDurationSec/);
  assert.doesNotMatch(fn[1], /newTimerMinutesInput|newTimerSecondsInput/);
});

test('the section and its controls are relabelled "trigger", not "timer"', () => {
  // Internal names stay put on purpose - see this file's own top comment. Only what a person
  // reads changes.
  assert.match(html, /<span class="topic-title">Custom triggers<\/span>/);
  assert.match(html, /Triggers defined here belong only to this aura\./);
  assert.match(html, />\+ Add trigger</);
  assert.match(html, /id="custom-timer-modal-title">Add trigger</);
  assert.match(rendererSrc, /customTimerModalTitle\.textContent = timer \? 'Edit trigger' : 'Add trigger'/);
  assert.match(rendererSrc, /newTimerAddBtn\.textContent = 'Add trigger'/);
  assert.match(rendererSrc, /None yet - use \+ Add trigger\./);
  assert.match(rendererSrc, /Delete trigger "\$\{timer\.name\}"/);
});

test('the per-row duration display is gone from the trigger list - the slider above it is the only one now', () => {
  const fn = rendererSrc.match(/function renderCustomTimersList\(widget\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'renderCustomTimersList has been restructured');
  assert.doesNotMatch(fn[1], /buff-timer/, 'a per-row duration element is still being built');
  assert.doesNotMatch(fn[1], /durationSec \/ 60/, 'still formatting a per-row m:ss duration');
});

// ---------------------------------------------------------------------------
// The shared box says what it does, and each trigger's own cooldown is visible on its row
// (reported live: a cooldown HUD looked like every trigger had the same timer)
// ---------------------------------------------------------------------------

test('the aura-wide box is labelled "Duration shown", and its hover explains how the cooldown follows it', () => {
  const row = html.match(/<span class="label" title="([^"]*)">Duration shown:<\/span>\s*<input type="number" id="widget-trigger-duration-min"/);
  assert.ok(row, 'the shared duration box should be labelled "Duration shown:"');
  assert.match(row[1], /same for every trigger/);
  assert.match(row[1], /Cooldown/);
});

test('each trigger row shows its own cooldown, compactly formatted', () => {
  const fnSrc = rendererSrc.match(/function formatTriggerSeconds\(total\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnSrc, 'formatTriggerSeconds is missing');
  const formatTriggerSeconds = new Function(`${fnSrc[0]}; return formatTriggerSeconds;`)();
  assert.equal(formatTriggerSeconds(45), '45s');
  assert.equal(formatTriggerSeconds(360), '6m');
  assert.equal(formatTriggerSeconds(90), '1m 30s');
  assert.equal(formatTriggerSeconds(4200), '1h 10m');
  assert.equal(formatTriggerSeconds(3600), '1h');
  const list = rendererSrc.match(/function renderCustomTimersList\(widget\) \{[\s\S]*?\n {2}\}/);
  assert.ok(list);
  assert.match(list[0], /if \(Number\(timer\.cooldownSec\) > 0\) \{/, 'only a trigger that has a cooldown gets the note');
  assert.match(list[0], /formatTriggerSeconds\(Number\(timer\.cooldownSec\)\)\} cooldown/);
});

// ---------------------------------------------------------------------------
// A trigger's OWN "Show for" - one aura holding tiles that stay up for different lengths
// (owner, 15 Oct: "how do [I] manage a 'show for' duration that is independent per trigger?")
// ---------------------------------------------------------------------------

const { CustomTimerEngine } = require('../src/main/customTimerEngine');
const { sanitizeCustomTimers } = require('../src/main/widgetStore');

function engineFor(store) {
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  engine.setGetWidgetsFn(() => store.getAll());
  return engine;
}
const LINE = (t) => `[Wed Aug 19 19:23:03 2026] ${t}`;

test('a trigger with its own Show for keeps it; the aura-wide box only covers triggers without one', () => {
  const store = newStore();
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'Short', durationSec: 5, triggerText: 'short thing', showForSec: 15 });
  store.addCustomTimer(w.id, { name: 'Shared', durationSec: 5, triggerText: 'shared thing' });
  store.setTriggerDurationSec(w.id, 120); // the aura-wide box changes - must not touch "Short"
  const engine = engineFor(store);
  engine.handleLine(LINE('short thing'));
  engine.handleLine(LINE('shared thing'));
  const byName = Object.fromEntries(engine.getActive().map((t) => [t.name, t.durationSec]));
  assert.deepEqual(byName, { Short: 15, Shared: 120 });
});

test('Show for 0 is a real value, and clearing it (null) goes back to the aura\'s', () => {
  const store = newStore();
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'A', durationSec: 30, triggerText: 'a', showForSec: 0 });
  const id = store.getById(w.id).customTimers[0].id;
  assert.equal(store.getById(w.id).customTimers[0].showForSec, 0, '0 must not be treated as "unset"');
  store.updateCustomTimer(w.id, id, { ...store.getById(w.id).customTimers[0], showForSec: null });
  assert.equal(store.getById(w.id).customTimers[0].showForSec, undefined, 'null clears the override');
  store.updateCustomTimer(w.id, id, { ...store.getById(w.id).customTimers[0], showForSec: 45 });
  const t = store.getById(w.id).customTimers[0];
  store.updateCustomTimer(w.id, id, { name: t.name, durationSec: t.durationSec, triggerText: t.triggerText });
  assert.equal(store.getById(w.id).customTimers[0].showForSec, 45, 'a caller that never mentions it leaves it alone');
});

test('Reverse detection hides a used trigger for its OWN Show for plus its cooldown', () => {
  const store = newStore();
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.setReverseDetection(w.id, true);
  store.addCustomTimer(w.id, { name: 'A', durationSec: 5, triggerText: 'a', showForSec: 20, cooldownSec: 100 });
  store.setTriggerDurationSec(w.id, 0);
  const engine = engineFor(store);
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  engine.handleLine(LINE('a'));
  assert.ok(log.some((l) => l.includes('hiding for 120s')), log.join('\n'));
});

test('imports and share codes clamp it like every other trigger number, and drop garbage', () => {
  const [a, b, c] = sanitizeCustomTimers([
    { id: 'a', showForSec: 99999 },
    { id: 'b', showForSec: 'nonsense' },
    { id: 'c', showForSec: null },
  ]);
  assert.equal(a.showForSec, 3600);
  assert.equal(b.showForSec, undefined);
  assert.equal(c.showForSec, undefined);
});

test('the new field gets through both IPC handlers and the form (a missed list drops it silently)', () => {
  for (const ch of ['widget:addCustomTimer', 'widget:updateCustomTimer']) {
    const at = mainSrc.indexOf(`'${ch}'`);
    const handler = mainSrc.slice(at, mainSrc.indexOf('\n);', at));
    assert.equal((handler.match(/showForSec/g) || []).length, 2, `${ch}: must both destructure and forward showForSec`);
  }
  assert.match(rendererSrc, /showForSec: readShowFor\(\),/, 'readTimerFormData must send it');
  assert.match(rendererSrc, /return showForBlank\(\) \? null : readMinSec\(newTimerShowForMinInput, newTimerShowForSecInput\);/,
    'two empty boxes mean "use the aura\'s", not 0');
  assert.match(html, /<span class="topic-title">Duration shown override<\/span>/, 'the title must say it overrides the aura\'s');
  assert.match(html, />Instead of the aura's:<\/span>\s*<input type="number" id="widget-new-timer-showfor-min"/);
  assert.match(html, /id="widget-new-timer-showfor-min"/);
  assert.match(html, /id="widget-new-timer-showfor-sec"/);
});

// Reported live (owner's own test aura, from its share code): Duration shown 0 + a Cooldown showed
// nothing. The cooldown phase kept reporting the 0s duration, and the overlay draws a 0-second
// trigger tile as an invisible sound-only ping.
test('a 0s duration with a cooldown reports the COOLDOWN as its length, so it is drawn and its bar is right', () => {
  const store = newStore();
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'Mend', durationSec: 0, triggerText: 'You mend your wounds and heal', triggerMatch: 'contains', cooldownSec: 15, showForSec: 0 });
  store.addCustomTimer(w.id, { name: 'Not mend', durationSec: 0, triggerText: 'hea2', triggerMatch: 'contains', cooldownSec: 20 });
  store.setTriggerDurationSec(w.id, 0);
  const engine = engineFor(store);
  const realNow = Date.now;
  const t0 = realNow();
  try {
    Date.now = () => t0;
    engine.handleLine(LINE('You mend your wounds and heal some damage.'));
    engine.handleLine(LINE('hea2'));
    Date.now = () => t0 + 1500;
    engine._tick();
    const byName = Object.fromEntries(engine.getActive().map((t) => [t.name, t]));
    for (const [name, cd] of [['Mend', 15], ['Not mend', 20]]) {
      assert.equal(byName[name].phase, 'cooldown', name);
      assert.equal(byName[name].durationSec, cd, `${name}: must report its cooldown length, not 0`);
    }
  } finally { Date.now = realNow; }
  const overlay = read('src', 'renderer', 'overlay', 'overlay.js');
  assert.match(overlay, /buff\.durationSec === 0 && buff\.phase !== 'cooldown'/, 'a cooldown tile is never an invisible ping');
});

module.exports = () => report('custom-triggers-duration');
if (require.main === module) report('custom-triggers-duration').then((n) => process.exit(n ? 1 : 0));
