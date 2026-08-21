'use strict';
/**
 * The sound-only aura - an aura that draws nothing and exists purely to make a noise.
 *
 * Two very different kinds of check live here, because the feature spans both processes.
 *
 * The widget-store half is REAL behaviour: WidgetStore takes its persistence as a constructor
 * argument, so a plain in-memory fake drives the actual code, including the share-code path.
 *
 * The widgetManager / overlay / settings-window half is STRUCTURAL - the same approach and the
 * same reason as renderer-wiring.test.js. widgetManager.js requires Electron at module load and
 * overlay.js needs a DOM, so neither can run in a plain Node process. Reading them as text is
 * worth more than a richer check that needs a running app and therefore never gets run.
 *
 * What the structural checks are really protecting is ORDER, which is where this feature breaks
 * silently rather than loudly:
 *   - in shouldBeOnScreen, a sound-only aura must be exempt from auto-hide but NOT from profile
 *     membership;
 *   - in overlay.js's render, the early return must sit after the alerts fire and before the DOM
 *     is built. A line too high and the aura is silent; a line too low and it draws.
 * Neither mistake throws. Both would just quietly do the wrong thing.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, DISPLAY_MODES, normalizeDisplayMode, isSoundOnly } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const managerSrc = read('src', 'main', 'widgetManager.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const mainSrc = read('src', 'main', 'main.js');

/** In-memory stand-in for src/main/store.js, same shape the other suites use. */
function fakeStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    data,
    loadJson: (name, fallback) => (name in data ? JSON.parse(JSON.stringify(data[name])) : fallback),
    saveJson: (name, value) => { data[name] = JSON.parse(JSON.stringify(value)); },
  };
}

const newStore = () => new WidgetStore(fakeStore());

// ---------------------------------------------------------------------------
// The display mode itself
// ---------------------------------------------------------------------------

test('sound-only is a real display mode, and nonsense still falls back to list', () => {
  assert.deepEqual(DISPLAY_MODES, ['list', 'icons', 'sound-only']);
  assert.equal(normalizeDisplayMode('sound-only'), 'sound-only');
  assert.equal(normalizeDisplayMode('icons'), 'icons');
  assert.equal(normalizeDisplayMode('list'), 'list');
  // 'list' specifically, because that is what the overlay ALREADY did with an unrecognised
  // value - it tests for 'icons' and treats everything else as a list. Normalizing to anything
  // else would be a behaviour change dressed up as a guard.
  assert.equal(normalizeDisplayMode('carousel'), 'list');
  assert.equal(normalizeDisplayMode(undefined), 'list');
  assert.equal(normalizeDisplayMode(null), 'list');
});

test('a stored aura keeps its display mode', () => {
  const store = newStore();
  const w = store.create('Fades');
  store.update(w.id, { displayMode: 'sound-only' });
  assert.equal(store.getById(w.id).displayMode, 'sound-only');
});

test('a foreign display mode cannot arrive by either import route', () => {
  // The case that matters: a share code minted by some later build naming a mode this one has
  // never heard of. It has to land as something drawable, not as an aura that renders nothing
  // and gives the user no way to tell why.
  //
  // There are two import routes and they run through DIFFERENT code. importCode() creates a
  // widget and normalizes it; applyCodeToSelfBuffs() patches the existing singleton in place via
  // update(), which does not normalize. Both are checked, because the first one passing says
  // nothing about the second - and Self Buffs is the aura that cannot be deleted and recreated
  // to escape a bad value.
  const forge = (fields) => {
    const store = newStore();
    const w = store.create('Forged');
    store.update(w.id, fields);
    return store.exportCode(w.id);
  };
  const code = forge({ displayMode: 'holographic', buffFilterMode: 'explicit', buffNames: ['Spirit of the Puma'] });

  const importer = newStore();
  const imported = importer.importCode(code);
  assert.ok(imported, 'the forged code did not import at all');
  assert.equal(imported.displayMode, 'list', 'importCode let an unknown display mode through');
  // The rest of the code still applies - the guard must not throw the whole import away.
  assert.deepEqual(imported.buffNames, ['Spirit of the Puma']);

  const applier = newStore();
  applier.applyCodeToSelfBuffs(code);
  assert.equal(
    applier.getById('self-buffs').displayMode, 'list',
    'applyCodeToSelfBuffs let an unknown display mode through - this path skips normalizeWidget'
  );
});

test('a real sound-only code still applies to Self Buffs as sound-only', () => {
  // The guard above must not be so eager that it flattens a legitimate value.
  const source = newStore();
  const w = source.createSoundOnly('Sound');
  const code = source.exportCode(w.id);

  const target = newStore();
  target.applyCodeToSelfBuffs(code);
  assert.equal(target.getById('self-buffs').displayMode, 'sound-only');
});

test('isSoundOnly does not mistake a missing widget for a sound-only one', () => {
  assert.equal(isSoundOnly({ displayMode: 'sound-only' }), true);
  assert.equal(isSoundOnly({ displayMode: 'list' }), false);
  assert.equal(isSoundOnly(undefined), false);
  assert.equal(isSoundOnly(null), false);
});

// ---------------------------------------------------------------------------
// The premade
// ---------------------------------------------------------------------------

test('the Sound only premade starts silent, watching nothing, with an expire sound ready', () => {
  const store = newStore();
  const w = store.createSoundOnly('Sound only');

  assert.equal(w.displayMode, 'sound-only');
  assert.equal(w.kind, 'custom', 'it should be an ordinary custom aura, not a fourth kind');
  assert.equal(w.deletable, true);

  // Fails closed. Filter mode 'all' plus an expire sound would beep every single time any buff
  // anywhere ran out - a machine gun, not an alert.
  assert.equal(w.buffFilterMode, 'explicit');
  assert.deepEqual(w.buffNames, []);

  // But ready: the moment a buff is picked it does the thing the aura is for, without a second
  // trip into the Sounds section.
  assert.equal(w.soundOnExpire, true);
  assert.equal(w.alertVolume, 100, 'the volume slider is 0-100 and 100 is the default - see note 32');
});

test('the premade is offered in the add-aura list and reaches a real IPC channel', () => {
  assert.match(rendererSrc, /id: 'sound-only'/, 'no Sound only entry in PREMADE_WIDGETS');
  assert.match(rendererSrc, /window\.eqTracker\.createSoundOnlyWidget\(name\)/);
  // Every hop has to exist or the button throws on click: preload bridge, then main handler.
  assert.match(preloadSrc, /createSoundOnlyWidget: \(name\) => ipcRenderer\.invoke\('widget:createSoundOnly'/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:createSoundOnly'/);
  assert.match(managerSrc, /function createSoundOnlyWidget\(name\)/);
  assert.match(managerSrc, /\n  createSoundOnlyWidget,/, 'createSoundOnlyWidget is not exported');
});

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

test('a sound-only aura survives a share code, and its local sound files do not travel', () => {
  const store = newStore();
  const source = store.createSoundOnly('Fade warner');
  store.update(source.id, {
    buffFilterMode: 'explicit',
    buffNames: ['Spirit of the Puma'],
    soundWarningSec: 10,
    alertVolume: 45,
    // A registry id for a file in THIS install's userData. Meaningless to anyone else.
    expireSoundId: 'c0ffee00-0000-4000-8000-000000000000',
  });

  const code = store.exportCode(source.id);
  assert.ok(code.startsWith('EQLSAURAS1-'), `unexpected share code prefix: ${code.slice(0, 20)}`);

  const imported = store.importCode(code);
  assert.ok(imported, 'the code did not import');
  assert.equal(imported.displayMode, 'sound-only', 'the mode is the whole point of the aura');
  assert.deepEqual(imported.buffNames, ['Spirit of the Puma']);
  assert.equal(imported.soundWarningSec, 10);
  assert.equal(imported.alertVolume, 45);
  // Custom sound FILES are deliberately not shareable - the id points at a file in the sender's
  // own userData, so carrying it across would give the recipient a silent, unexplained slot.
  assert.equal(imported.expireSoundId, null);
});

test('an import can tell you it is about to make Self Buffs stop drawing', () => {
  // Applying a sound-only code to Self Buffs is a legitimate thing to want and a catastrophic
  // thing to do by accident: Self Buffs cannot be deleted, so an unexpected one leaves the user
  // staring at an empty screen. peekCode carries the mode so the confirm dialog can say so.
  const store = newStore();
  const silent = store.createSoundOnly('Silent');
  const ordinary = store.create('Ordinary');

  assert.equal(store.peekCode(store.exportCode(silent.id)).displayMode, 'sound-only');
  // A code is a diff against the defaults, so an ordinary aura never carries displayMode at all -
  // absent has to read as 'list', not as undefined.
  assert.equal(store.peekCode(store.exportCode(ordinary.id)).displayMode, 'list');
  assert.equal(store.peekCode('not a code'), null);

  assert.match(
    rendererSrc, /this code is for a SOUND ONLY aura/i,
    'the Self Buffs confirm dialog no longer warns about a sound-only code'
  );
});

test('the alert path refuses to make a noise for an aura that is switched off', () => {
  // Hiding a window does not silence it: a hidden overlay keeps receiving the engine broadcasts
  // and keeps running render(). The check therefore has to sit at the last point before a noise
  // is actually made, which is playAlertSound - not at any of the places that decide what is on
  // screen.
  const fn = overlaySrc.match(/function playAlertSound\(kind\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'playAlertSound has been renamed or restructured');
  const body = fn[1].replace(/^\s*\/\/.*$/gm, '');
  assert.match(body, /if \(!audible\) return;/, 'nothing stops a switched-off aura beeping');
  // First statement in the body, before any branch that could play something.
  assert.ok(
    body.indexOf('if (!audible) return;') < body.indexOf('playCustomSound'),
    'the guard must come before any playback path'
  );
  // And it has to actually be fed from the main process, in both directions.
  assert.match(overlaySrc, /window\.eqOverlay\.getAudible\(widgetId\)/, 'never fetched at boot');
  assert.match(overlaySrc, /window\.eqOverlay\.onAudibleChanged\(/, 'never updated on a profile switch');
  assert.match(read('src', 'preload', 'preload-overlay.js'), /getAudible: \(widgetId\)/);
  assert.match(read('src', 'preload', 'preload-overlay.js'), /widget:audibleChanged/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:isAudible'/);
});

test('the overlay wakes a suspended audio context', () => {
  // An overlay window is click-through and never focused, so it can never receive the user
  // gesture a suspended context waits for - if one ever suspended, nothing would wake it and the
  // aura would go permanently, silently deaf.
  const fn = overlaySrc.match(/function getAudioCtx\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'getAudioCtx has been renamed or restructured');
  assert.match(fn[1], /audioCtx\.state === 'suspended'/);
  assert.match(fn[1], /audioCtx\.resume\(\)/);
});

// ---------------------------------------------------------------------------
// Sound options on every aura type
// ---------------------------------------------------------------------------

test('every aura type carries the full set of sound settings, with the same defaults', () => {
  const store = newStore();
  const selfBuffs = store.getById('self-buffs');
  assert.ok(selfBuffs, 'the Self Buffs builtin should be seeded on a fresh store');

  const soundFields = Object.keys(selfBuffs).filter((k) => /^(sound|land|expire|warning|alert)/i.test(k));
  // Guard the guard: if the naming convention ever changes, this test could silently check
  // nothing at all.
  assert.ok(soundFields.length >= 8, `expected the sound fields to be found, got ${soundFields.join(', ')}`);

  const others = {
    'ally builtin': store.createAllyBuffs('Ally'),
    'custom aura': store.create('Custom'),
    'custom timer aura': store.create('Timers', { buffSource: 'customTimer' }),
    'sound-only aura': store.createSoundOnly('Sound'),
  };

  for (const [label, widget] of Object.entries(others)) {
    for (const field of soundFields) {
      assert.ok(field in widget, `${label} has no ${field} - it cannot be configured for sound`);
      // soundOnExpire is the one deliberate difference: the Sound only premade turns it on.
      if (label === 'sound-only aura' && field === 'soundOnExpire') continue;
      assert.deepEqual(
        widget[field], selfBuffs[field],
        `${label}'s ${field} default disagrees with Self Buffs'`
      );
    }
  }
});

test('the Sounds section of the settings window is not hidden for any aura type', () => {
  // The owner asked for sound options on every aura type. They already were, and this is what
  // keeps that true: no code anywhere may hide the Sounds topic. Alerts and the timer-text topic
  // ARE hidden for sound-only auras (both are purely about how a tile looks), so this check is
  // specific rather than a blanket "nothing is hidden".
  assert.match(html, /id="topic-sounds"/, 'the Sounds topic id has changed - update this test');
  const hides = rendererSrc.match(/topic-sounds/g) || [];
  assert.deepEqual(
    hides, [],
    'something in the renderer now references the Sounds topic by id, which usually means it is ' +
    'being shown or hidden conditionally - sound settings must stay available on every aura'
  );
});

// ---------------------------------------------------------------------------
// Order: where a wrong line number is silent rather than loud
// ---------------------------------------------------------------------------

test('shouldBeOnScreen exempts a sound-only aura from auto-hide but not from its profile', () => {
  const body = managerSrc.match(/function shouldBeOnScreen\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(body, 'shouldBeOnScreen has been renamed or restructured');
  const src = body[1];

  const profile = src.indexOf('isVisibleForActiveProfile');
  const soundOnly = src.indexOf('isSoundOnly(config)');
  const unlocked = src.indexOf('isUnlocked(config.id)');
  const foreground = src.indexOf('foregroundHidden');

  assert.ok(profile >= 0 && soundOnly >= 0 && unlocked >= 0 && foreground >= 0,
    'one of the four visibility clauses is missing');
  // Profile membership is the app's on/off switch. An aura switched off for the current profile
  // must be genuinely off - a sound-only aura that kept beeping after being switched off would
  // be untraceable, because there is nothing on screen to point at.
  assert.ok(profile < soundOnly, 'profile membership must still be checked before the sound-only exemption');
  // And it must sit above the auto-hide return, or a sound-only aura goes deaf whenever EQ loses
  // focus - a hidden window is one Chromium is entitled to throttle.
  assert.ok(soundOnly < foreground, 'the sound-only exemption must come before the auto-hide check');
  assert.ok(unlocked < foreground, 'unlocking must still beat auto-hide');
});

test('setting the display mode cannot silently turn sound-only into list', () => {
  const body = managerSrc.match(/function setDisplayMode\(id, mode\) \{([\s\S]*?)\n\}/);
  assert.ok(body, 'setDisplayMode has been renamed or restructured');
  // The original coerced with mode === 'icons' ? 'icons' : 'list', which would quietly discard
  // any third mode. It has to go through the store's own normaliser instead.
  assert.match(body[1], /normalizeDisplayMode\(mode\)/);
  assert.doesNotMatch(body[1], /\?\s*'icons'\s*:\s*'list'/);
  // Switching in or out of sound-only changes whether the aura should be on screen at all.
  assert.match(body[1], /applyVisibility\(config\)/,
    'switching modes must re-evaluate visibility, or an aura made sound-only while EQ was ' +
    'unfocused stays hidden and therefore deaf');
});

test('the overlay stops after the alerts fire and before it draws anything', () => {
  // Scoped to render()'s own body, and written against the FIRST mention of sound-only rather
  // than a particular line of it. An earlier draft checked one exact string, which meant a
  // second, earlier bail-out added above the alerts slipped past - the aura would have gone
  // silent while every assertion still passed. Mutation testing caught that; this is the fix.
  const fn = overlaySrc.match(/\nfunction render\(buffs\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'render() has been renamed or restructured');
  const body = fn[1];

  const landAlert = body.indexOf("playAlertSound('land')");
  const warnings = body.indexOf('checkSoundWarnings(visible)');
  const firstBail = body.indexOf("displayMode === 'sound-only'");
  const structure = body.indexOf('const structureChanged =');

  assert.ok(landAlert >= 0 && warnings >= 0 && structure >= 0, 'render() has been restructured');
  assert.ok(firstBail >= 0, 'the sound-only early return is gone - the aura would draw tiles');
  // Too high and the aura is silent; too low and it draws. Neither throws.
  assert.ok(landAlert < firstBail, 'nothing may bail out on sound-only before the land/expire alerts fire');
  assert.ok(warnings < firstBail, 'nothing may bail out on sound-only before the warning-threshold loop runs');
  assert.ok(firstBail < structure, 'the early return must come before the DOM is rebuilt');

  // Comments stripped first: this block is heavily commented, and prose about sound-only would
  // otherwise be counted as code doing something about it.
  const code = body.replace(/^\s*\/\/.*$/gm, '');
  const mentions = code.match(/sound-only/g) || [];
  assert.equal(
    mentions.length, 2,
    'render() should mention sound-only exactly twice in code - the guard and the dataset stamp. ' +
    'A third mention usually means a second bail-out somewhere the ordering check cannot see. ' +
    `Found: ${mentions.length}`
  );
});

test('the overlay clears any tiles left behind when an aura is switched to sound-only', () => {
  const block = overlaySrc.match(/if \(currentConfig\.displayMode === 'sound-only'\) \{([\s\S]*?)\n  \}/);
  assert.ok(block, 'the sound-only block has changed shape');
  assert.match(block[1], /listEl\.innerHTML = ''/, 'old tiles would be left on screen forever');
  assert.match(block[1], /tileRefs\.clear\(\)/);
  assert.match(block[1], /return;/);
});

test('the sound-only body class is applied by the overlay and honoured by its stylesheet', () => {
  assert.match(
    overlaySrc,
    /document\.body\.classList\.toggle\('sound-only', config\.displayMode === 'sound-only'\)/,
    'the class is not applied from applyConfig, so an aura switched to sound-only would stay on ' +
    'screen until the next buff tick'
  );
  assert.match(overlayCss, /body\.sound-only #content-wrap \{\s*display: none;/);
  // The unlock chrome is a fixed-position element. It disappears with its ancestor because
  // display:none removes the whole subtree - but the rule has to be able to win the specificity
  // tie with body.unlocked .drag-overlay, which is why it is written against the id.
  const hideRule = overlayCss.indexOf('body.sound-only #content-wrap');
  const unlockRule = overlayCss.indexOf('body.unlocked .drag-overlay');
  assert.ok(unlockRule >= 0 && hideRule > unlockRule,
    'the sound-only rule must come after the unlocked rule in source order');
});

// ---------------------------------------------------------------------------
// The settings window
// ---------------------------------------------------------------------------

test('Sound only is offered as a display style, spelled the way the store expects', () => {
  const values = [...html.matchAll(/name="widget-display-mode" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['list', 'icons', 'sound-only']);
  // A radio whose value the store rejects would silently save as 'list' and look like the
  // setting simply did not stick.
  for (const v of values) assert.equal(normalizeDisplayMode(v), v);
});

test('the controls a sound-only aura cannot use are hidden, not left dead on screen', () => {
  const body = rendererSrc.match(/function updateDisplayModeVisibility\(displayMode\) \{([\s\S]*?)\n  \}/);
  assert.ok(body, 'updateDisplayModeVisibility has been renamed or restructured');
  const src = body[1];
  assert.match(src, /const isSoundOnly = displayMode === 'sound-only'/);

  // Each of these is a real saveable setting that could not possibly have an effect on an aura
  // that draws nothing. Leaving a live control on screen doing nothing is how someone ends up
  // certain the app is broken.
  const hidden = ['sortOrderRowEl', 'opacityRowEl', 'positionRowEl', 'positionHintEl', 'timerTextTopicEl', 'alertsTopicEl'];
  for (const el of hidden) {
    assert.match(
      src, new RegExp(`${el}\\.style\\.display = isSoundOnly \\? 'none' : ''`),
      `${el} is not hidden for a sound-only aura`
    );
  }
  assert.match(src, /soundOnlyHintEl\.style\.display = isSoundOnly \? '' : 'none'/);
  // The list-mode groups are shown for anything that is not icon mode, so they need the extra
  // clause or they reappear on a sound-only aura.
  assert.match(src, /listOnlySettings\.style\.display = isIcons \|\| isSoundOnly \? 'none' : ''/);
  assert.match(src, /displayListOnlySettings\.style\.display = isIcons \|\| isSoundOnly \? 'none' : ''/);
});

test('ally grouping is hidden for a sound-only aura, where renderBuffFilter would restore it', () => {
  // updateDisplayModeVisibility cannot own this one: renderBuffFilter runs afterwards and would
  // put the options straight back.
  assert.match(rendererSrc, /widget\.displayMode !== 'sound-only';\r?\n    allyGroupingSettingsEl\.style\.display/);
});

module.exports = () => report('sound-only');
if (require.main === module) process.exit(report('sound-only') ? 1 : 0);
