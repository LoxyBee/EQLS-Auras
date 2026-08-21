'use strict';
/**
 * Text auras - an aura that draws one line of words and nothing else.
 *
 * The owner's shape for this, in her words: "if a buff is active, it displays text, no icon, no
 * timer... it should be limited to 1 tile/event only... a text only aura type alongside custom
 * buff aura and custom timer aura."
 *
 * Two things about that are load-bearing and easy to lose:
 *
 *   1. It is a TYPE, chosen once at creation - NOT a fourth Display style radio, even though
 *      underneath it is exactly a fourth display mode. She considered the radio and rejected it:
 *      a fourth option on every aura is a fourth thing to read and rule out on every aura, and
 *      the goal is accessibility. Nothing here may quietly turn it back into a radio.
 *   2. ONE tile, always, however many things it watches. The dispel announcer listens for three
 *      different lines precisely so it catches all three strengths of the message, so the limit
 *      is on what is DRAWN, never on what may be watched.
 *
 * The pure parts of the overlay are lifted out and run, the same way merged-tiles.test.js does.
 * The rest is structural, because overlay.js needs a DOM.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, DISPLAY_MODES, isTextAura, TEXT_AURA_PRESETS } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const managerSrc = read('src', 'main', 'widgetManager.js');
const mainSrc = read('src', 'main', 'main.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

function fakeStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    loadJson: (name, fallback) => (name in data ? JSON.parse(JSON.stringify(data[name])) : fallback),
    saveJson: (name, value) => { data[name] = JSON.parse(JSON.stringify(value)); },
  };
}
const newStore = () => new WidgetStore(fakeStore());

/** Lifts the filtering/sorting/one-tile path out of overlay.js and makes it callable. */
function loadOverlayLogic() {
  const pick = (re, what) => {
    const m = overlaySrc.match(re);
    assert.ok(m, `${what} has been renamed or restructured - this suite cannot run`);
    return m[0];
  };
  const parts = [
    pick(/const BURST_TOLERANCE_SEC = \d+;/, 'BURST_TOLERANCE_SEC'),
    pick(/let mergeRule = '[a-z]+';/, 'mergeRule'),
    'let currentConfig = {};',
    pick(/function keyFor\(buff\) \{[\s\S]*?\n\}/, 'keyFor'),
    pick(/function mergedKeyFor\(bucket, burstIndex\) \{[\s\S]*?\n\}/, 'mergedKeyFor'),
    pick(/function splitIntoBursts\(members\) \{[\s\S]*?\n\}/, 'splitIntoBursts'),
    pick(/function mergeByDuration\(buffs\) \{[\s\S]*?\n\}/, 'mergeByDuration'),
    pick(/function sortBuffs\(buffs, order\) \{[\s\S]*?\n\}/, 'sortBuffs'),
    pick(/function displayName\(buff\) \{[\s\S]*?\n\}/, 'displayName'),
    pick(/function textFor\(buff\) \{[\s\S]*?\n\}/, 'textFor'),
    pick(/function visibleBuffs\(buffs\) \{[\s\S]*?\n\}/, 'visibleBuffs'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function(
    `${parts.join('\n\n')}
     return { visibleBuffs, textFor, setConfig: (c) => { currentConfig = c; } };`
  )();
}

const O = loadOverlayLogic();

const buff = (name, remainingSec, allyName) => ({
  name,
  durationSec: 1440,
  remainingSec,
  ...(allyName ? { allyName } : {}),
  showOnOverlay: true,
  iconUrl: null,
  isBardSong: false,
});

const textConfig = (extra = {}) => ({
  displayMode: 'text',
  buffFilterMode: 'all',
  buffNames: [],
  sortOrder: 'time-remaining',
  textAuraMessage: '',
  textAuraSize: 32,
  ...extra,
});

// ---------------------------------------------------------------------------
// The type
// ---------------------------------------------------------------------------

test('text is a real display mode and a text aura is an ordinary custom aura', () => {
  assert.ok(DISPLAY_MODES.includes('text'));
  assert.equal(isTextAura({ displayMode: 'text' }), true);
  assert.equal(isTextAura({ displayMode: 'list' }), false);
  assert.equal(isTextAura(undefined), false);

  const w = newStore().createTextAura('Announcer');
  assert.equal(w.displayMode, 'text');
  assert.equal(w.kind, 'custom', 'it must not become a fourth kind of aura');
  assert.equal(w.deletable, true);
  assert.equal(w.buffSource, 'self', 'the buff picker should be usable immediately');
  assert.equal(w.textAuraMessage, '', 'blank means "use the name of what it is watching"');
  assert.equal(w.textAuraSize, 32);
});

test('it is NOT offered as a fourth Display style radio', () => {
  // The owner considered exactly that and rejected it, on the grounds that a fourth option on
  // every aura is a fourth thing to read and rule out on every aura. It is chosen once, at
  // creation, beside "Custom buff aura" and "Custom timer aura".
  const values = [...html.matchAll(/name="widget-display-mode" value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(!values.includes('text'), 'text has been added as a Display style radio');
  assert.match(html, /id="modal-add-text-widget-btn"/, 'the creation button is missing');
  assert.match(rendererSrc, /window\.eqTracker\.createTextAuraWidget\(name\)/);
  // And the radios are hidden altogether on one, since the type is fixed at creation. Sound-only
  // auras were moved onto the same footing afterwards, so both share this line.
  assert.match(rendererSrc, /displayModeRowEl\.style\.display = isTextAura \|\| isSoundOnly \? 'none' : ''/);
});

test('its own text size is separate from the shared one', () => {
  // The shared textSize is capped at 28px because it also drives list rows and icon labels. An
  // announcement needs to be far bigger than that without dragging every other aura up with it.
  const sharedMax = html.match(/id="widget-text-size-slider"[^>]*max="(\d+)"/);
  assert.ok(sharedMax, 'the text-aura size slider is missing');
  assert.ok(Number(sharedMax[1]) >= 96, 'an announcement should be able to get properly large');
  const otherMax = html.match(/id="widget-text-size-slider"[^>]*min="(\d+)"/);
  assert.ok(otherMax && Number(otherMax[1]) >= 12);
  assert.match(rendererSrc, /textAuraSizeSlider\.value = String\(textAuraSize\)/, 'never populated');
});

// ---------------------------------------------------------------------------
// One tile, always
// ---------------------------------------------------------------------------

test('a text aura shows exactly one thing, however many are active', () => {
  O.setConfig(textConfig());
  const out = O.visibleBuffs([buff('Aegolism', 900), buff('Brilliance', 100), buff('Clarity', 500)]);
  assert.equal(out.length, 1, 'this is the constraint that makes it an announcement, not a list');
});

test('which one it shows follows the aura sort order', () => {
  // Sort order still means something on a one-tile aura: it is what decides WHICH one.
  O.setConfig(textConfig({ sortOrder: 'time-remaining' }));
  assert.equal(O.visibleBuffs([buff('A', 900), buff('B', 100)])[0].name, 'B');

  O.setConfig(textConfig({ sortOrder: 'alphabetical' }));
  assert.equal(O.visibleBuffs([buff('Zeal', 900), buff('Aegolism', 100)])[0].name, 'Aegolism');
});

test('an ordinary aura is completely unaffected by the one-tile rule', () => {
  O.setConfig(textConfig({ displayMode: 'list' }));
  assert.equal(O.visibleBuffs([buff('A', 900), buff('B', 100), buff('C', 500)]).length, 3);
  O.setConfig(textConfig({ displayMode: 'icons' }));
  assert.equal(O.visibleBuffs([buff('A', 900), buff('B', 100)]).length, 2);
});

test('nothing active means nothing drawn', () => {
  O.setConfig(textConfig());
  assert.deepEqual(O.visibleBuffs([]), []);
});

test('the aura filter still applies before the one-tile rule', () => {
  // Otherwise it would announce something the user had deliberately excluded.
  O.setConfig(textConfig({ buffFilterMode: 'explicit', buffNames: ['Brilliance'] }));
  const out = O.visibleBuffs([buff('Aegolism', 100), buff('Brilliance', 900)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Brilliance');
});

// ---------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------

test('it says the user words when there are any, and the name when there are not', () => {
  O.setConfig(textConfig({ textAuraMessage: 'DISPELLED' }));
  assert.equal(O.textFor(buff('Whatever', 10)), 'DISPELLED');

  O.setConfig(textConfig({ textAuraMessage: '' }));
  assert.equal(O.textFor(buff('Spirit of the Puma', 10)), 'Spirit of the Puma');

  // Whitespace is not a message. Someone who clears the box by pressing space should get the
  // name back, not a blank plate sitting over the game.
  O.setConfig(textConfig({ textAuraMessage: '   ' }));
  assert.equal(O.textFor(buff('Spirit of the Puma', 10)), 'Spirit of the Puma');
});

test('an ally buff announces who it is on', () => {
  O.setConfig(textConfig({ textAuraMessage: '' }));
  assert.equal(O.textFor(buff('Puma', 10, 'Avenrae')), 'Avenrae: Puma');
});

// ---------------------------------------------------------------------------
// The dispel announcer
// ---------------------------------------------------------------------------

test('the dispel announcer is built from the real log lines', () => {
  const w = newStore().createTextAura('You Have Been Dispelled', { preset: 'dispelled' });
  assert.equal(w.displayMode, 'text');
  assert.equal(w.buffSource, 'customTimer');
  assert.equal(w.textAuraMessage, 'DISPELLED');
  assert.ok(w.textAuraSize > 32, 'an announcement like this should arrive already large');

  const triggers = w.customTimers.map((t) => t.triggerText);
  assert.deepEqual(triggers, [
    'You feel very dispelled.',
    'You feel dispelled.',
    'You feel a bit dispelled.',
  ]);
  for (const timer of w.customTimers) {
    assert.ok(timer.id, 'every definition needs its own id or they overwrite each other');
    assert.ok(timer.durationSec > 0, 'a duration of zero would never be seen');
  }
  // Three definitions, still one tile - no single log line can match two of them anyway.
  assert.equal(new Set(w.customTimers.map((t) => t.id)).size, 3);
});

test('the attested dispel line really does appear in the owner logs', () => {
  // Only "You feel very dispelled." is attested. The other two are inferred from the
  // third-person forms, all three of which DO appear ("feels dispelled", "feels a bit
  // dispelled", "feels very dispelled"). A trigger that never matches costs nothing; a missing
  // one means a real dispel goes unannounced - so all three ship, and TESTING.md says which is
  // which rather than letting the inference pass for a fact.
  const candidates = [
    'C:/Users/Lindsey/Desktop/eqlog_Shara_rivervale_2026-08-19.txt',
    'C:/Users/Lindsey/Desktop/EQL Source/eqlog_Shara_rivervale_2026-08-17.txt',
  ].filter((p) => fs.existsSync(p));
  if (!candidates.length) {
    console.log('       (no real log available here - skipped)');
    return;
  }
  const attested = 'You feel very dispelled.';
  const found = candidates.some((p) =>
    fs.readFileSync(p, 'utf8').split(/\r?\n/).some((raw) => raw.replace(/^\[[^\]]+\]\s*/, '').trim() === attested)
  );
  assert.ok(found, `"${attested}" no longer appears in the logs - has the wording changed?`);

  // And it has to match the way the engine matches: whole line, exact.
  const preset = TEXT_AURA_PRESETS.dispelled();
  assert.equal(preset.customTimers[0].triggerText, attested);
});

test('the announcer is offered as a premade and no longer listed as unbuilt', () => {
  assert.match(rendererSrc, /id: 'dispelled'/, 'the premade entry is missing');
  assert.match(rendererSrc, /createTextAuraWidget\(name, 'dispelled'\)/);
  const planned = rendererSrc.match(/const PLANNED_PREMADE_WIDGETS = \[([\s\S]*?)\n  \];/);
  assert.ok(planned, 'the planned list has been restructured');
  assert.ok(
    !/You Have Been Dispelled/.test(planned[1]),
    'it is built now, so it must not still be sitting in the "not built yet" list'
  );
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('every hop of the text aura wiring exists', () => {
  assert.match(preloadSrc, /createTextAuraWidget: \(name, preset\)/);
  assert.match(preloadSrc, /setWidgetTextAuraMessage: \(id, value\)/);
  assert.match(preloadSrc, /setWidgetTextAuraSize: \(id, value\)/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:createTextAura'/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setTextAuraMessage'/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setTextAuraSize'/);
  assert.match(managerSrc, /function createTextAuraWidget\(name, preset\)/);
  assert.match(managerSrc, /\n  createTextAuraWidget,/, 'not exported');
});

test('its settings travel in a share code', () => {
  const store = newStore();
  const w = store.createTextAura('Announcer');
  store.update(w.id, { textAuraMessage: 'MEZ BROKE', textAuraSize: 72 });
  const imported = store.importCode(store.exportCode(w.id));
  assert.ok(imported);
  assert.equal(imported.displayMode, 'text');
  assert.equal(imported.textAuraMessage, 'MEZ BROKE');
  assert.equal(imported.textAuraSize, 72);
});

test('an announcer aura can be pointed at any source, including its own triggers', () => {
  // "text only aura should be able to track everything other auras can track". Every other aura
  // has its source fixed at creation; the two announcer types - text and sound-only - are where
  // it can be changed afterwards, because reacting to a line of log text is as much their job as
  // reacting to a buff. Both of their buttons in the add-aura list promise exactly that, and an
  // option promised in the copy and refused by the code is worse than one never offered.
  assert.match(html, /id="widget-buff-source-timer-label"/, 'the third source option is missing');
  assert.match(
    rendererSrc,
    /buffSourceTimerLabelEl\.style\.display = isTextAura \|\| isSoundOnly \? '' : 'none'/,
    'the third source option is not shown for both announcer types'
  );
  const fn = managerSrc.match(/function setBuffSource\(id, source\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'setBuffSource has been restructured');
  assert.match(fn[1], /isTextAura\(current\) \|\| isSoundOnly\(current\)/, 'the coercion no longer allows it');
  assert.match(fn[1], /'customTimer'/, 'triggers are no longer an accepted source at all');
  assert.doesNotMatch(fn[1], /source === 'ally' \? 'ally' : 'self'/, 'the old two-way coercion is back');

  // And the row itself has to stay visible once one IS on triggers, or the choice is one-way.
  assert.match(rendererSrc, /const announcer = widget\.displayMode === 'text' \|\| widget\.displayMode === 'sound-only';/);
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

test('the text tile is built with no countdown, bar or icon at all', () => {
  // Not hidden by CSS - never built. There is then nothing to leak through at an awkward size or
  // pick up a stray style later.
  const fn = overlaySrc.match(/function buildTextTile\(buff\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'buildTextTile has been renamed or restructured');
  const body = fn[1];
  assert.match(body, /timeEl: null/);
  assert.match(body, /barEl: null/);
  assert.match(body, /iconWrapEl: null/);
  assert.doesNotMatch(body, /createElement\('img'\)/);
});

test('the update path copes with a tile that has no countdown', () => {
  // Every tile before this one had a timeEl, and updateRef wrote to it unconditionally. Left as
  // it was, the very first render of a text aura would throw on a null.
  const fn = overlaySrc.match(/function updateRef\(ref, buff, isIcon\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'updateRef has been restructured');
  const body = fn[1];
  // Existence asserted BEFORE the ordering. indexOf returns -1 when the guard is gone, and -1 is
  // less than any real index - so an ordering check on its own passes most loudly at exactly the
  // moment the guard has been deleted. Mutation testing found that; it is worth remembering
  // anywhere indexOf is used to prove one thing comes before another.
  const guard = body.indexOf('if (!ref.timeEl) return;');
  const write = body.indexOf('ref.timeEl.textContent');
  assert.ok(guard >= 0, 'the guard is gone - a text aura throws on its first render');
  assert.ok(write >= 0, 'updateRef no longer writes the countdown at all');
  assert.ok(guard < write, 'the guard must come before the write');
});

test('the tile is legible over the game, and keeps the reserved low-time colour', () => {
  // It sits on top of whatever the player is looking at. White words on a snowfield are invisible,
  // and an announcement you cannot read is worse than none because you stop trusting it.
  const rule = overlayCss.match(/\.text-tile \{([\s\S]*?)\}/);
  assert.ok(rule, '.text-tile has been renamed');
  assert.match(rule[1], /background:/, 'no backdrop - it would vanish against pale scenery');
  assert.match(rule[1], /text-shadow:/);
  assert.match(rule[1], /width: max-content/, 'a fixed width would clip a long message');
  // The low-time colour is reserved and deliberately cannot be themed away anywhere else.
  assert.match(overlayCss, /\.text-tile\.low \{\s*color: #ff8080/);
});

test('the mode is drawn by its own branch, not by falling through to list mode', () => {
  assert.match(overlaySrc, /const isText = currentConfig\.displayMode === 'text';/);
  assert.match(overlaySrc, /const modeKey = isText \? 'text' : isIcon \? 'icons' : 'list';/);
  assert.match(overlaySrc, /function buildTile\(buff, isText, isIcon\)/);
  // Both build sites - grouped and ungrouped - must go through it, or one mode silently differs.
  // Anchored on the assignment so the function's own declaration is not counted as a third.
  assert.equal((overlaySrc.match(/= buildTile\(buff, isText, isIcon\)/g) || []).length, 2);
  // applyConfig has to clear the explicit widths the other modes set, or big text is clipped.
  assert.match(overlaySrc, /if \(config\.displayMode === 'text'\) \{/);
});

test('an empty text aura opens tall enough to show its own words', () => {
  const fn = managerSrc.match(/function minHeightFor\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'minHeightFor has been restructured');
  assert.match(fn[1], /config\.textAuraSize/, 'a large announcement would open clipped');
});

test('the controls a text aura cannot use are hidden', () => {
  const fn = rendererSrc.match(/function updateDisplayModeVisibility\(displayMode\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'updateDisplayModeVisibility has been restructured');
  const src = fn[1];
  assert.match(src, /const isTextAura = displayMode === 'text'/);
  assert.match(src, /textMessageRowEl\.style\.display = isTextAura \? '' : 'none'/);
  assert.match(src, /textAuraSizeRowEl\.style\.display = isTextAura \? '' : 'none'/);
  assert.match(src, /mergeRowEl\.style\.display = isSoundOnly \|\| isTextAura \? 'none' : ''/);
  assert.match(src, /timerTextTopicEl\.style\.display = isSoundOnly \|\| isTextAura \? 'none' : ''/);
  // The list-mode groups show for anything that is not icon mode, so they need the extra clause.
  assert.match(src, /if \(isTextAura\) \{/);
});

module.exports = () => report('text-aura');
if (require.main === module) process.exit(report('text-aura') ? 1 : 0);
