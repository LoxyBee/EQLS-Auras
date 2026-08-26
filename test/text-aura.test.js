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
const {
  WidgetStore,
  DISPLAY_MODES,
  isTextAura,
  TEXT_AURA_PRESETS,
  clampInstantSec,
  MAX_INSTANT_DISPLAY_SEC,
} = require('../src/main/widgetStore');

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
    pick(/const ALWAYS_ON_KEY = '[^']+';/, 'ALWAYS_ON_KEY'),
    pick(/let mergeRule = '[a-z]+';/, 'mergeRule'),
    'let currentConfig = {};',
    'let widgetId = \'w1\';',
    'let lastSelfBuffs = [];',
    'let lastAllyBuffs = [];',
    'let lastCustomTimers = [];',
    'let lastDamageRows = [];',
    'let lastTravelRoutes = {};',
    pick(/function keyFor\(buff\) \{[\s\S]*?\n\}/, 'keyFor'),
    pick(/function mergedKeyFor\(bucket, burstIndex\) \{[\s\S]*?\n\}/, 'mergedKeyFor'),
    pick(/function splitIntoBursts\(members\) \{[\s\S]*?\n\}/, 'splitIntoBursts'),
    pick(/function mergeByDuration\(buffs\) \{[\s\S]*?\n\}/, 'mergeByDuration'),
    pick(/function sortBuffs\(buffs, order\) \{[\s\S]*?\n\}/, 'sortBuffs'),
    pick(/function displayName\(buff\) \{[\s\S]*?\n\}/, 'displayName'),
    pick(/function textFor\(buff\) \{[\s\S]*?\n\}/, 'textFor'),
    pick(/function visibleBuffs\(buffs\) \{[\s\S]*?\n\}/, 'visibleBuffs'),
    pick(/function currentSourceBuffs\(\) \{[\s\S]*?\n\}/, 'currentSourceBuffs'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function(
    `${parts.join('\n\n')}
     return {
       visibleBuffs, textFor, currentSourceBuffs,
       setConfig: (c) => { currentConfig = c; },
       setLastCustomTimers: (t) => { lastCustomTimers = t; },
     };`
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
  assert.match(rendererSrc, /window\.eqTracker\.createTextAuraWidget\(widgetName\(/);
  // And the radios are hidden altogether on one, since the type is fixed at creation. Sound-only
  // auras were moved onto the same footing afterwards. Rewritten 25 Aug for the additive
  // settings-panel model - visibility now comes from SHAPE_FIELDS's 'display-choice' field, absent
  // from both text and sound (and their customTimer siblings).
  assert.match(rendererSrc, /displayModeRowEl\.style\.display = has\('display-choice'\) \? '' : 'none';/);
  const fn = rendererSrc.match(/const SHAPE_FIELDS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(fn, 'SHAPE_FIELDS has been renamed or restructured');
  for (const shape of ['text', 'text-customTimer', 'ally-alert', 'sound', 'sound-customTimer']) {
    assert.doesNotMatch(fn[1], new RegExp(`'${shape}': \\[[^\\]]*'display-choice'`), `${shape} is a fixed type, not a display style`);
  }
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

test('{spell} resolves to a custom timer\'s capturedText, not the timer\'s own name', () => {
  // Reported live 24 Aug: "resist text should say 'resisted your [skill name]'". A customTimer
  // buff's .name is the TIMER's own name ("Resisted"), never the real spell - capturedText (set
  // by customTimerEngine.js from a "contains" trigger's own leftover match text) is what actually
  // carries it, so {spell} has to prefer that when it's there.
  O.setConfig(textConfig({ textAuraMessage: 'resisted your {spell}' }));
  const timerBuff = { name: 'Resisted', capturedText: "Denon's Dissension", showOnOverlay: true, iconUrl: null, isBardSong: false };
  assert.equal(O.textFor(timerBuff), "resisted your Denon's Dissension");
});

test('{spell} still falls back to the ordinary buff name when there is no capturedText', () => {
  O.setConfig(textConfig({ textAuraMessage: '{spell} landed' }));
  assert.equal(O.textFor(buff('Spirit of the Puma', 10)), 'Spirit of the Puma landed');
});

test('an ally buff announces who it is on', () => {
  O.setConfig(textConfig({ textAuraMessage: '' }));
  assert.equal(O.textFor(buff('Puma', 10, 'Avenrae')), 'Avenrae: Puma');
});

test('{mob} reads the same field {caster} does - reported live as a viable way to name a mob', () => {
  // "r {mob} also should be a viable input, so that you can call a mobs name into the text
  // popup." For an enemy debuff, allyName is never really a caster (buffEngine._landOnAlly uses
  // it identically for a groupmate or a mob the debuff landed on) - {mob} is the same value under
  // a name that reads correctly for that case, not a second data source.
  O.setConfig(textConfig({ textAuraMessage: 'Mez resisted by {mob}' }));
  assert.equal(O.textFor(buff('Mesmerize', 0, 'a greater kobold')), 'Mez resisted by a greater kobold');
  O.setConfig(textConfig({ textAuraMessage: '{caster} and {mob} are the same value' }));
  assert.equal(O.textFor(buff('X', 0, 'Avenrae')), 'Avenrae and Avenrae are the same value');
});

test('{mob} falls back to a custom timer\'s capturedPrefix when there is no allyName', () => {
  // Reported live 25 Aug: "Your {spell} was resisted by {mob} did not print mob name" - a plain
  // customTimer trigger (the Resist flash premade and anything like it) has no ally-landing
  // infrastructure behind it at all, so buff.allyName is always empty there and {mob}/{caster}
  // printed nothing. capturedPrefix is customTimerEngine's own answer: the text BEFORE a
  // "contains" trigger's match, the same way capturedText is already the text after it - "An imp
  // protector" out of "An imp protector resisted your Denon's Dissension!".
  O.setConfig(textConfig({ textAuraMessage: 'Your {spell} was resisted by {mob}' }));
  const timerBuff = {
    name: 'Resisted',
    capturedText: "Denon's Dissension",
    capturedPrefix: 'An imp protector',
    showOnOverlay: true,
    iconUrl: null,
    isBardSong: false,
  };
  assert.equal(O.textFor(timerBuff), "Your Denon's Dissension was resisted by An imp protector");
});

test('{mob} prefers a real allyName over capturedPrefix when both happen to be present', () => {
  // allyName means the app actually knows who/what this landed on via ally-landing infrastructure
  // - a stronger signal than a plain trigger's leftover text - so it must win rather than be
  // silently overridden by whichever field happens to be checked first.
  O.setConfig(textConfig({ textAuraMessage: '{mob}' }));
  assert.equal(
    O.textFor({ name: 'X', allyName: 'Avenrae', capturedPrefix: 'a greater kobold', showOnOverlay: true, iconUrl: null, isBardSong: false }),
    'Avenrae'
  );
});

// ---------------------------------------------------------------------------
// The dispel announcer
// ---------------------------------------------------------------------------

test('the dispel announcer is built from the real log lines', () => {
  const w = newStore().createTextAura('You Have Been Dispelled', { preset: 'dispelled' });
  assert.equal(w.displayMode, 'text');
  assert.equal(w.buffSource, 'customTimer');
  // Was the bare word 'DISPELLED' until 25 Aug, when it was changed to match the owner's own
  // live widget - see the "override the premade with what I have" note on defaultSelfBuffsWidget
  // in widgetStore.js.
  assert.equal(w.textAuraMessage, 'You have been dispelled');
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

test('a customTimer-sourced announcer is not filtered by buffNames - reported live as "resist flash does nothing"', () => {
  // The Resist flash and Dispelled premades are buffSource:'customTimer' with buffFilterMode left
  // at the ordinary custom-widget default ('explicit', buffNames: []). There is nothing to "pick" -
  // what fires is entirely the widget's own customTimers trigger text - so the buffNames filter
  // (built for spell pickers) must never apply to this source, or the definition's own name never
  // matches an empty list and the aura silently shows nothing, exactly as reported live.
  O.setConfig(textConfig({ buffSource: 'customTimer', buffFilterMode: 'explicit', buffNames: [] }));
  const timerBuff = { name: 'Resisted', remainingSec: 1, showOnOverlay: true, iconUrl: null, isBardSong: false };
  const out = O.visibleBuffs([timerBuff]);
  assert.equal(out.length, 1, 'a firing custom timer must reach the screen even with an empty buffNames list');
  assert.equal(out[0].name, 'Resisted');
});

test('an enemy-debuff aura draws exactly one tile too, even in icon/list mode', () => {
  // Not really about text auras, but the visibleBuffs harness above already exists and does
  // exactly what this needs. Reported live 24 Aug against an AoE mez landing on three different
  // mobs at once: three tiles appeared, one per mob. Owner's answer: "ONE tile total for the
  // whole aura, always... like a text aura" - so trackOnEnemies gets the same one-tile rule the
  // text-aura constraint above enforces, regardless of display mode.
  const enemyBuff = (allyName, remainingSec) => ({
    name: 'Mesmerize', durationSec: 30, remainingSec, allyName, onEnemy: true,
    showOnOverlay: true, iconUrl: null, isBardSong: false,
  });
  O.setConfig({
    displayMode: 'icons', buffFilterMode: 'explicit', buffNames: ['Mesmerize'],
    trackOnEnemies: true, sortOrder: 'time-remaining',
  });
  const out = O.visibleBuffs([
    enemyBuff('a greater kobold', 15),
    enemyBuff('an orc pawn', 15),
    enemyBuff('a gnoll bouncer', 15),
  ]);
  assert.equal(out.length, 1, 'three different mobs mezzed by one AoE cast produced more than one tile');
});

test('an ordinary ally aura (not tracking enemies) is unaffected - still shows one tile per person', () => {
  const buffOn = (allyName) => ({
    name: 'Spirit of Wolf', durationSec: 1440, remainingSec: 900, allyName,
    showOnOverlay: true, iconUrl: null, isBardSong: false,
  });
  O.setConfig({
    displayMode: 'icons', buffFilterMode: 'explicit', buffNames: ['Spirit of Wolf'],
    trackOnEnemies: false, sortOrder: 'time-remaining',
  });
  const out = O.visibleBuffs([buffOn('Avenrae'), buffOn('Marrowbane')]);
  assert.equal(out.length, 2, 'the one-tile rule leaked into an aura that never asked for it');
});

test('the "Buffs shown" heading says "Triggers" on a text aura', () => {
  // "Buffs shown" describes an icon/list aura - a grid of things it displays. A text aura shows
  // none of that; it fires one line of words when a picked spell lands. Reported live as part of
  // the text-aura settings panel being visibly built on top of icon-aura creation. Originally
  // relabelled "Buff to trigger" - reworded again 25 Aug, reported live as clearer just "Triggers".
  assert.match(html, /id="widget-buff-filter-title"/, 'the heading needs its own id to be renamed live');
  assert.match(html, /id="buff-picker-modal-title"/, 'the picker modal it opens needs the same rename');
  assert.match(
    rendererSrc,
    /const filterTitle = widget\.displayMode === 'text' \? 'Triggers' : 'Buffs shown';/
  );
  assert.match(rendererSrc, /filterTitleEl\.textContent = filterTitle;/);
  assert.match(rendererSrc, /buffPickerModalTitleEl\.textContent = filterTitle;/);
});

test('a customTimer widget only shows its OWN timer definitions, not every widget\'s', () => {
  // customTimers:active is one global broadcast carrying every active definition from every
  // customTimer-sourced widget. Reported live 24 Aug: the Resist flash premade "still not
  // appearing" once a second, hand-built custom timer aura also existed - each widget's overlay
  // window was drawing from the SAME unscoped pool, so a text aura (which shows only one tile)
  // could end up picking the OTHER widget's active trigger instead of its own.
  O.setConfig(textConfig({ buffSource: 'customTimer', customTimers: [{ id: 'resist-1' }] }));
  O.setLastCustomTimers([
    { id: 'resist-1', name: 'Resisted', remainingSec: 1 },
    { id: 'other-widget-timer', name: 'Something Else', remainingSec: 30 },
  ]);
  const out = O.currentSourceBuffs();
  assert.equal(out.length, 1, 'a widget must not see another widget\'s active timer at all');
  assert.equal(out[0].id, 'resist-1');
});

test('an OR/AND-combined aura is not filtered out by the same own-widget scoping', () => {
  // Reported live 25 Aug: "i have custom timer aura with hi and hello as 2 different triggers set
  // to OR, but neither activates anything." customTimerEngine's 'and'/'or' triggerCombineMode
  // fires one instance keyed by the WIDGET's own id (`or:<widgetId>`/`and:<widgetId>` - see
  // _resolveActivations), because no single trigger definition owns a combined activation. The
  // ownIds set right above was built purely from real per-trigger ids (customTimers[].id), so that
  // synthetic key matched nothing and got silently filtered out before visibleBuffs ever saw it -
  // completely invisible on screen, not merely mis-picked the way the test above covers.
  O.setConfig(textConfig({
    id: 'w1',
    buffSource: 'customTimer',
    customTimers: [{ id: 'hi' }, { id: 'hello' }],
  }));
  O.setLastCustomTimers([
    { id: 'or:w1', name: 'hi', remainingSec: 5 },
    { id: 'and:w1', name: 'hi', remainingSec: 5 },
    { id: 'or:some-other-widget', name: 'unrelated', remainingSec: 5 },
  ]);
  const out = O.currentSourceBuffs().map((t) => t.id).sort();
  assert.deepEqual(out, ['and:w1', 'or:w1'], 'the combo instance for THIS widget must survive the scoping filter');
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
  // has its source fixed at creation; a text aura is where it can be changed afterwards, because
  // reacting to a line of log text is as much its job as reacting to a buff. Its button in the
  // add-aura list promises exactly that, and an option promised in the copy and refused by the
  // code is worse than one never offered.
  assert.match(html, /id="widget-buff-source-timer-label"/, 'the third source option is missing');
  // Rewritten 25 Aug for the additive settings-panel model - visibility now comes from
  // SHAPE_FIELDS's 'buff-source-timer-label' field, present on the text-aura family and its
  // customTimer sibling, absent everywhere else.
  assert.match(
    rendererSrc,
    /buffSourceTimerLabelEl\.style\.display = has\('buff-source-timer-label'\) \? '' : 'none';/,
    'the third source option is not shown for the announcer type'
  );
  const fn = managerSrc.match(/function setBuffSource\(id, source\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'setBuffSource has been restructured');
  assert.match(fn[1], /isTextAura\(current\)/, 'the coercion no longer allows it');
  assert.match(fn[1], /'customTimer'/, 'triggers are no longer an accepted source at all');
  assert.doesNotMatch(fn[1], /source === 'ally' \? 'ally' : 'self'/, 'the old two-way coercion is back');

  // And the row itself has to stay visible once one IS on triggers, or the choice is one-way -
  // 'text-customTimer' is its own shape specifically so 'buff-source' can stay in its field list
  // even though the plain 'custom-timer' shape (a non-announcer aura on triggers) excludes it.
  const tableFn = rendererSrc.match(/const SHAPE_FIELDS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(tableFn, 'SHAPE_FIELDS has been renamed or restructured');
  assert.match(tableFn[1], /'text-customTimer': \[[^\]]*'buff-source'[^-]/, 'text-customTimer lost its own "Watching:" row once switched to triggers');
  assert.doesNotMatch(tableFn[1], /'custom-timer': \[[^\]]*'buff-source'[^-]/, 'a non-announcer timer aura must not offer a choice fixed at creation');
});

test('"Sort by" is hidden on a text aura - reported live as pointless clutter for a one-tile type', () => {
  // "text aura's do not need a sort by toggle, they are one and done only." Reverses an earlier,
  // deliberate decision to keep it visible (sortOrder genuinely still decides which one shows on
  // the rare occasion more than one watched thing is active at once) - only the CONTROL is
  // hidden, the field and the logic that reads it are untouched.
  // Rewritten 25 Aug for the additive settings-panel model - visibility now comes from
  // SHAPE_FIELDS's 'sort' field, absent from every text shape.
  assert.match(rendererSrc, /sortOrderRowEl\.style\.display = has\('sort'\) \? '' : 'none';/);
  const fn = rendererSrc.match(/const SHAPE_FIELDS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(fn, 'SHAPE_FIELDS has been renamed or restructured');
  for (const shape of ['text', 'text-customTimer', 'ally-alert', 'sound', 'sound-customTimer']) {
    assert.doesNotMatch(fn[1], new RegExp(`'${shape}': \\[[^\\]]*'sort'`), `${shape} still shows a sort-order row it never uses`);
  }
});

test('the "Say" field saves as you type, not only when you click away', () => {
  // Reported live 24 Aug: "the say text field doesn't update all the time when i try to edit it,
  // it should be freely editable and stay with whatever has been put in it." 'change' alone only
  // fires on blur/Enter - anything typed and left mid-edit was never actually saved, so the store
  // could disagree with what was visibly in the box for as long as focus stayed there.
  assert.match(
    rendererSrc,
    /textMessageInput\.addEventListener\('input', \(\) => \{/,
    'the field only saves on blur/Enter, not as you type'
  );
  const fn = rendererSrc.match(/textMessageInput\.addEventListener\('input', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the input listener has been restructured');
  assert.match(fn[1], /setTimeout\(/, 'every keystroke fires its own IPC round-trip with no debounce');
  assert.match(fn[1], /window\.eqTracker\.setWidgetTextAuraMessage\(selectedId, textMessageInput\.value\)/);
  // 'change' must still exist too, so blurring commits immediately rather than waiting out the
  // debounce - and cancels any pending debounced save so the two can never race each other.
  const changeFn = rendererSrc.match(/textMessageInput\.addEventListener\('change', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(changeFn, 'the change listener is gone');
  assert.match(changeFn[1], /clearTimeout\(textMessageSaveTimer\)/, 'blur does not cancel a pending debounced save');
});

test('the Say field is never overwritten while it still has focus', () => {
  // Reported live 24 Aug, the SECOND report on this field: a later edit ("...was resisted by
  // mob") never reached the saved file, which instead still held an EARLIER one - not lost on
  // save, lost on the NEXT re-render. selectWidget rebuilds this whole panel from scratch, and
  // that runs on more than "you clicked a different aura" - right-clicking THIS SAME aura's own
  // move box on the overlay (onOpenWidgetSettings, note 6) calls it again on the widget already
  // open, and if the debounced save above hadn't finished writing back yet, the re-render stamped
  // the box with the store's still-older value right over whatever was actively being typed.
  // Anchored to the start of the line (with optional leading whitespace) so this only matches an
  // UNGUARDED assignment - the guarded one further down ends with the identical substring, which
  // a bare (unanchored) search would have matched too, passing even with the guard removed.
  assert.doesNotMatch(
    rendererSrc,
    /^\s*textMessageInput\.value = widget\.textAuraMessage \|\| '';/m,
    'the field is still populated unconditionally, with no focus guard'
  );
  assert.match(
    rendererSrc,
    /if \(document\.activeElement !== textMessageInput\) textMessageInput\.value = widget\.textAuraMessage \|\| '';/,
    'the field can still be overwritten while the user has it focused and is mid-edit'
  );
});

test('the Say field survives navigating away and back, not just a re-render of the same aura', () => {
  // Reported live 24 Aug, the THIRD report on this field, precisely reproduced by the owner: "i
  // update field. move to another aura, come back, text is reverted. have to ctrl R to get the
  // updated text." The save really did reach the file - findWidget(id) reads only this renderer's
  // OWN cached `widgets` array, and that array is populated once by refreshWidgets() and never
  // touched again by a plain setWidgetXyz(...) IPC call. Switching away and back re-reads the same
  // stale pre-edit snapshot no matter how correct the real store already was. Fixed by writing the
  // setter's own return value - already the fresh widget, every widgetManager.js setter returns it
  // - straight into the local cache, so the very next findWidget() sees it without a full re-fetch.
  const fn = rendererSrc.match(/function updateLocalWidgetCache\(config\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'updateLocalWidgetCache has been restructured');
  assert.match(fn[1], /widgets\.findIndex\(\(w\) => w\.id === config\.id\)/);
  assert.match(fn[1], /widgets\[index\] = config/, 'the local cache entry is never actually replaced');

  const inputFn = rendererSrc.match(/textMessageInput\.addEventListener\('input', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(inputFn, 'the input listener has been restructured');
  assert.match(
    inputFn[1],
    /\.then\(updateLocalWidgetCache\)/,
    'the debounced save never refreshes the local cache, so the stale snapshot survives'
  );

  const changeFn = rendererSrc.match(/textMessageInput\.addEventListener\('change', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(changeFn, 'the change listener has been restructured');
  assert.match(
    changeFn[1],
    /\.then\(updateLocalWidgetCache\)/,
    'the immediate blur/Enter save never refreshes the local cache, so the stale snapshot survives'
  );
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

test('an idle text aura keeps a wide window instead of shrinking to an icon-sized square', () => {
  // Reported live as "custom text aura when moving is just icon shaped" - the drag box IS the
  // window's real bounds (see overlay.css), and an idle text aura renders no tile at all (nothing
  // to flash), so its measured content width is ~0. Without a floor, fitToContent shrank the
  // window down to its bare 40px minimum, which reads as a small square exactly like an icon
  // tile the moment you unlock it to drag - even though nothing about the aura's TYPE changed.
  const minWidthFn = managerSrc.match(/function minWidthFor\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(minWidthFn, 'minWidthFor is missing - the idle-width floor for text auras');
  assert.match(minWidthFn[1], /displayMode === 'text'/);

  const minWidthConst = managerSrc.match(/const TEXT_AURA_MIN_IDLE_WIDTH_PX = (\d+);/);
  assert.ok(minWidthConst, 'the idle-width floor constant is missing');
  assert.ok(Number(minWidthConst[1]) > 40, 'the floor must be wider than the bare 40px minimum, or nothing changed');

  const fitFn = managerSrc.match(/function fitToContent\(id, contentWidth, contentHeight, originX = 0\) \{([\s\S]*?)\n\}/);
  assert.ok(fitFn, 'fitToContent has been restructured');
  assert.match(fitFn[1], /minWidthFor\(config\)/, 'the idle-width floor is computed but never applied');
});

test('the controls a text aura cannot use are hidden', () => {
  // Rewritten 25 Aug for the additive settings-panel model. updateDisplayModeVisibility is gone -
  // replaced by widgetShape()/SHAPE_FIELDS/applySettingsPanelShape - so this now checks the table
  // directly: a shape reached via displayMode:'text' (widgetShape's own branch) must exclude
  // 'merge' and 'timer-text', and must include 'text-fields' (which drives
  // textMessageRowEl/textAuraSizeRowEl together, see applySettingsPanelShape's body).
  const shapeFn = rendererSrc.match(/function widgetShape\(widget\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(shapeFn, 'widgetShape has been restructured');
  assert.match(shapeFn[1], /if \(widget\.displayMode === 'text'\) \{/, 'text is no longer its own branch');

  assert.match(rendererSrc, /textMessageRowEl\.style\.display = has\('text-fields'\) \? '' : 'none';/);
  assert.match(rendererSrc, /textAuraSizeRowEl\.style\.display = has\('text-fields'\) \? '' : 'none';/);
  assert.match(rendererSrc, /mergeRowEl\.style\.display = has\('merge'\) \? '' : 'none';/);
  assert.match(rendererSrc, /timerTextTopicEl\.style\.display = has\('timer-text'\) \? '' : 'none';/);

  const tableFn = rendererSrc.match(/const SHAPE_FIELDS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(tableFn, 'SHAPE_FIELDS has been renamed or restructured');
  for (const shape of ['text', 'text-customTimer', 'ally-alert']) {
    assert.match(tableFn[1], new RegExp(`'${shape}': \\[[^\\]]*'text-fields'`), `${shape} lost its Say/size fields`);
    assert.doesNotMatch(tableFn[1], new RegExp(`'${shape}': \\[[^\\]]*'merge'`), `${shape} still offers merging one tile`);
    assert.doesNotMatch(tableFn[1], new RegExp(`'${shape}': \\[[^\\]]*'timer-text'`), `${shape} still offers countdown styling it has no countdown for`);
  }
  // The icon/list-mode groups are gated on 'display-choice' being present at all (see
  // applySettingsPanelShape's showsIconOnly/showsListOnly), which every text shape already
  // excludes - no separate re-hide patch is needed the way the old imperative code had one.
  assert.doesNotMatch(rendererSrc, /if \(isTextAura\) \{/, 'the old manual re-hide patch is still here, meaning the new gating did not actually replace it');
});


// ---------------------------------------------------------------------------
// How long an instant stays up
// ---------------------------------------------------------------------------

test('a text aura decides for itself how long an event stays on screen', () => {
  // Shara: "the 6 second display for text only auras should be a setting the user can do for
  // themselves. default it to 6 though, incase the user forgets to change it."
  const store = newStore();
  const w = store.createTextAura('Announcer');
  assert.equal(w.textAuraInstantSec, 6, 'it has to work without anyone finding the setting first');

  store.update(w.id, { textAuraInstantSec: 20 });
  const imported = store.importCode(store.exportCode(w.id));
  assert.equal(imported.textAuraInstantSec, 20, 'it should travel in a share code');
});

test('an impossible number is brought back to something the engine can honour', () => {
  // The engine keeps an instant for sixty seconds and no longer, so a share code asking for five
  // minutes would produce an aura that silently stopped at sixty - which looks like the setting
  // not working rather than like a limit.
  assert.equal(clampInstantSec(6), 6);
  assert.equal(clampInstantSec(999), MAX_INSTANT_DISPLAY_SEC);
  assert.equal(clampInstantSec(0), 1, 'zero would mean it never appears at all');
  assert.equal(clampInstantSec(-5), 1);
  assert.equal(clampInstantSec(undefined), 6, 'missing means the default, not zero');
  assert.equal(clampInstantSec('soon'), 6);

  const engineSrc = read('src', 'main', 'buffEngine.js');
  const m = engineSrc.match(/const INSTANT_RETENTION_SEC = (\d+);/);
  assert.ok(m, 'the engine retention constant has been renamed');
  assert.equal(
    Number(m[1]), MAX_INSTANT_DISPLAY_SEC,
    'the slider maximum and the engine retention must be the same number, or the top of the ' +
    'slider is a promise the engine cannot keep'
  );
});

test('the setting is reachable, populated, and hidden on other aura types', () => {
  assert.match(html, /id="widget-text-instant-slider"/, 'the control is missing');
  assert.match(rendererSrc, /textInstantSlider\.value = String\(instantSec\)/, 'never populated');
  assert.match(rendererSrc, /setWidgetTextAuraInstantSec\(selectedId, seconds\)/);
  // Rewritten 25 Aug for the additive settings-panel model - 'text-instant' is its own field,
  // deliberately absent from 'text-customTimer' (a text aura on triggers, which has no `instant`
  // flag to filter by - see the next test) even though every other text-mode shape has it.
  //
  // Also gated on !widget.alwaysOn (added 25 Aug, progressive-disclosure audit finding): "Always
  // on screen, with nothing to wait for" directly contradicts a still-active "how long to show the
  // event after it fires" slider sitting right above it, and nothing was hiding one when the other
  // was on.
  assert.match(rendererSrc, /const showsTextInstant = has\('text-instant'\) && !widget\.alwaysOn;/);
  assert.match(rendererSrc, /textInstantRowEl\.style\.display = showsTextInstant \? '' : 'none';/);
  const tableFn = rendererSrc.match(/const SHAPE_FIELDS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(tableFn, 'SHAPE_FIELDS has been renamed or restructured');
  for (const shape of ['text', 'ally-alert']) {
    assert.match(tableFn[1], new RegExp(`'${shape}': \\[[^\\]]*'text-instant'`), `${shape} lost the slider`);
  }
  // The slider bounds have to agree with the clamp, or the UI offers what the store refuses.
  const bounds = html.match(/id="widget-text-instant-slider"[^>]*min="(\d+)"[^>]*max="(\d+)"/);
  assert.ok(bounds, 'the slider has no bounds');
  assert.equal(Number(bounds[1]), 1);
  assert.equal(Number(bounds[2]), MAX_INSTANT_DISPLAY_SEC);
});

test('"Show events for" is hidden on a customTimer text aura - it never did anything there', () => {
  // Reported live 24 Aug: "custom text timers have two settings for duration, one in the actual
  // custom timer, and a slider at the top... there should never be two sources for this to ease
  // confusion." There was never really a second source - customTimerEngine's output carries no
  // `instant` flag at all, so this slider's filter always let a custom-timer buff straight
  // through no matter what it was set to. Hidden now so the only visible duration control is the
  // one that actually does something: the top-level Duration slider in Custom triggers (see
  // widget-trigger-duration-slider), added the same day - every trigger shares it now, so there
  // is only ever one number to look at. Rewritten 25 Aug: 'text-customTimer' is a shape of its
  // own specifically so 'text-instant' can be left out of ITS field list while every other
  // text-mode shape keeps it (see the test above) - the two-argument function this test used to
  // pin (updateDisplayModeVisibility, needing buffSource to tell 'text' from 'text-customTimer'
  // apart) is gone; widgetShape() reads widget.buffSource directly instead.
  const shapeFn = rendererSrc.match(/function widgetShape\(widget\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(shapeFn, 'widgetShape has been restructured');
  assert.match(
    shapeFn[1],
    /return widget\.buffSource === 'customTimer' \? 'text-customTimer' : 'text';/,
    'buffSource no longer distinguishes a plain text aura from one on triggers'
  );
  const tableFn = rendererSrc.match(/const SHAPE_FIELDS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(tableFn, 'SHAPE_FIELDS has been renamed or restructured');
  assert.doesNotMatch(tableFn[1], /'text-customTimer': \[[^\]]*'text-instant'/, 'a customTimer text aura still shows a slider that filters nothing');
});

// ---------------------------------------------------------------------------
// The width-creep bug (reported 24 Aug: "text auras width keeps creeping wider and wider
// when unlocked to move it")
// ---------------------------------------------------------------------------
//
// content-wrap has no CSS width rule of its own (display:flex, nothing else), so clearing its
// inline width to '' left it a plain block box - which defaults to FILLING its containing block
// (body, 100%), not shrinking to the text inside it. Every measurement in reportSizeIfChanged then
// just read the window's own current width back at itself: the window resizes to width+8,
// content-wrap re-fills to that new 100%, gets measured 8px wider, and so on with no ceiling. It
// grows regardless of lock state - unlocking is just the only time anyone is watching closely
// enough to see it happen.

test('content-wrap shrink-wraps to the text instead of filling the window', () => {
  const fn = overlaySrc.match(/if \(config\.displayMode === 'text'\) \{([\s\S]*?)\n {2}\} else if/);
  assert.ok(fn, 'the text-mode branch of applyConfig has been restructured');
  assert.match(
    fn[1],
    /contentWrap\.style\.width = 'max-content';/,
    'an empty string here fills the window instead of shrinking to the text - the exact feedback loop reported as "creeping wider and wider"'
  );
});

module.exports = () => report('text-aura');
if (require.main === module) process.exit(report('text-aura') ? 1 : 0);
