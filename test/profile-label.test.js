'use strict';
/**
 * The loadout label - note 21.
 *
 * The note was blocked on the text-only aura, which shipped as note 23, so the blocker is gone.
 * What was left needed two mechanisms that did not exist, and one of them is the whole feature.
 *
 * An aura's visibility IS its profile membership - a list of ids. A label whose job is to tell you
 * WHICH profile is active would therefore vanish the moment you switched to a profile it was not a
 * member of, which is precisely the moment you want to read it. The note calls that out as its
 * Risk. A list cannot fix it either, because it would have to name profiles that do not exist yet.
 * Hence showOnAllProfiles, a separate thing from the list.
 *
 * The second is that every render path is driven by a buff arriving, and this aura has no event
 * behind it at all - hence alwaysOn and one synthetic entry.
 *
 * WHERE THE SWITCH LIVES. Shara redirected this on 21 August: "it should be a part of global
 * config, not add aura... a permanent option that is not tied to creating an aura", to keep the
 * Add Aura list from bloating. So it is a checkbox on the Overlay Auras page beside the other
 * app-wide aura settings, and there is no premade for it at all.
 *
 * It is still a widget underneath, and that is a choice worth defending rather than an accident:
 * a draggable position, locking, opacity, sizing and surviving a restart all exist for widgets
 * already, and writing them again for one label would be the actual bloat. What she asked for is
 * that the switch be permanent and not require building an aura, and both hold.
 *
 * NOT built: the note also asks for the label to appear automatically once a second profile
 * exists. Left for her to confirm, because a thing that creates itself is also a thing that comes
 * back after you delete it - the note says so itself.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const managerSrc = read('src', 'main', 'widgetManager.js');
const mainSrc = read('src', 'main', 'main.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const preloadSrc = read('src', 'preload', 'preload-main.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// widgetManager.isVisibleForActiveProfile, reproduced. Pinned against the real one below.
const visibleOn = (config, activeId) =>
  (config.showOnAllProfiles ? true : (config.activeProfileIds || []).includes(activeId));

// overlay.textFor, reproduced. Pinned against the real one below.
const ALWAYS_ON_KEY = '__always-on__';
function renderText(config, buff) {
  const message = (config.textAuraMessage || '').trim();
  if (!message) return buff.name;
  if (!message.includes('{')) return message;
  return message
    .replace(/\{caster\}/g, buff.allyName || '')
    .replace(/\{spell\}/g, buff.name === ALWAYS_ON_KEY ? '' : buff.name || '')
    .replace(/\{profile\}/g, config.activeProfileName || '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// The Risk the note names
// ---------------------------------------------------------------------------

test('the label survives a profile that did not exist when it was made', () => {
  // The single thing this feature is for. An ordinary aura fails this by design; the label must
  // not, or it disappears at the one moment it has something to say.
  const store = newStore();
  const label = store.ensureLoadoutLabel();
  assert.equal(visibleOn(label, 'a-profile-created-next-week'), true);
});

test('an ordinary aura still belongs only to the profiles it was given', () => {
  // The other half of the same guarantee: this must not have leaked into everything.
  const store = newStore();
  const plain = store.create('Ordinary');
  assert.equal(visibleOn(plain, 'a-profile-created-next-week'), false);
  assert.equal(plain.showOnAllProfiles, false, 'show-on-all must be off unless asked for');
});

test('the real visibility check honours it, and checks it first', () => {
  const fn = managerSrc.match(/function isVisibleForActiveProfile\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'isVisibleForActiveProfile has been renamed or restructured');
  assert.match(fn[1], /if \(config\.showOnAllProfiles\) return true;/);
  // Before the id list, or an aura in no profiles at all would still be hidden.
  assert.ok(
    fn[1].indexOf('showOnAllProfiles') < fn[1].indexOf('activeProfileIds'),
    'the all-profiles check must come before the id list'
  );
});

test('it can still be switched off', () => {
  // The note assumed unticking every profile would do it. With show-on-all set, that does nothing
  // at all - so the toggle is required rather than a nicety, or the label cannot be turned off
  // without deleting it.
  assert.match(html, /id="widget-all-profiles-checkbox"/, 'no way to turn it off');
  assert.match(managerSrc, /function setShowOnAllProfiles\(id, enabled\)/);
  const fn = managerSrc.match(/function setShowOnAllProfiles\(id, enabled\) \{([\s\S]*?)\n\}/);
  assert.match(fn[1], /applyVisibility\(config\)/, 'turning it off must take the aura off screen now');
});

// ---------------------------------------------------------------------------
// An aura with nothing to wait for
// ---------------------------------------------------------------------------

test('an always-on aura draws without any buff', () => {
  assert.match(overlaySrc, /if \(currentConfig\.alwaysOn\) return \[alwaysOnEntry\(\)\];/);
  // And before every filter, since none of them have anything to act on.
  const fn = overlaySrc.match(/function visibleBuffs\(buffs\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'visibleBuffs has been restructured');
  assert.ok(
    fn[1].indexOf('alwaysOn') < fn[1].indexOf('buffFilterMode'),
    'the always-on entry is created after a filter that could discard it'
  );
});

test('the synthetic entry carries no countdown', () => {
  const fn = overlaySrc.match(/function alwaysOnEntry\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'alwaysOnEntry has been renamed');
  assert.match(fn[1], /remainingSec: null/);
  assert.match(fn[1], /instant: false/);
  assert.match(fn[1], /infinite: true/);
});

test('its name cannot collide with a real spell', () => {
  // keyFor, the landing glow and the alert sounds all key off the name. A synthetic entry sharing
  // a real buff's key would make one of them fire for the other.
  assert.match(overlaySrc, /const ALWAYS_ON_KEY = '__always-on__';/);
  const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));
  assert.ok(!roster.some((e) => e.name === '__always-on__'), 'a real spell now has the synthetic name');
});

test('the internal key never reaches the screen', () => {
  const label = newStore().ensureLoadoutLabel();
  const shown = renderText({ ...label, textAuraMessage: '{spell}{profile}', activeProfileName: 'Healing' },
    { name: ALWAYS_ON_KEY, allyName: null });
  assert.equal(shown, 'Healing');
  assert.doesNotMatch(shown, /__always-on__/);
});

// ---------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------

test('it shows the active profile name', () => {
  const label = newStore().ensureLoadoutLabel();
  const entry = { name: ALWAYS_ON_KEY, allyName: null };
  for (const name of ['Default', 'Cleric healing', 'Bard pulling']) {
    assert.equal(renderText({ ...label, activeProfileName: name }, entry), name);
  }
});

test('the wording is hers to change', () => {
  const label = newStore().ensureLoadoutLabel();
  const entry = { name: ALWAYS_ON_KEY, allyName: null };
  assert.equal(
    renderText({ ...label, textAuraMessage: 'Loadout: {profile}', activeProfileName: 'Bard pulling' }, entry),
    'Loadout: Bard pulling'
  );
});

test('the overlay really substitutes the profile token', () => {
  const fn = overlaySrc.match(/function textFor\(buff\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'textFor has been restructured');
  assert.match(fn[1], /profile/);
  assert.match(fn[1], /currentConfig\.activeProfileName/);
  // And the real one guards the synthetic name. The check above this test uses a local copy of
  // textFor, which cannot notice if the guard is deleted from the overlay itself.
  assert.match(fn[1], /ALWAYS_ON_KEY/, 'the internal key would be printed as if it were a spell');
});

// ---------------------------------------------------------------------------
// Keeping the name current
// ---------------------------------------------------------------------------

test('the name is computed, never stored on the aura', () => {
  // Stored, every aura would carry a stale copy of a name that can be renamed or deleted under it.
  const label = newStore().ensureLoadoutLabel();
  assert.equal(label.activeProfileName, undefined, 'the profile name is being persisted');
  assert.match(managerSrc, /function withActiveProfile\(config\) \{/);
  assert.match(managerSrc, /activeProfileName: getActiveProfileNameFn\(\)/);
});

test('switching profile pushes the new name, not just visibility', () => {
  // Visibility alone would leave the label reading the previous profile until something unrelated
  // refreshed it - which is the failure that looks exactly like the feature not working.
  const fn = managerSrc.match(/function applyProfileVisibility\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'applyProfileVisibility has been restructured');
  assert.match(fn[1], /applyVisibility\(config\)/);
  assert.match(fn[1], /pushConfigChanged\(config\.id\)/);
});

test('the name is looked up fresh each time', () => {
  // So a rename shows immediately and a deleted profile cannot leave a name on screen.
  assert.match(mainSrc, /widgetManager\.setActiveProfileNameFn\(\(\) => \{/);
  const fn = mainSrc.match(/setActiveProfileNameFn\(\(\) => \{([\s\S]*?)\n\}\);/);
  assert.match(fn[1], /profileStore\.getAll\(\)/, 'the name must be read from the store, not cached');
});

// ---------------------------------------------------------------------------
// Reaching it
// ---------------------------------------------------------------------------

test('it is NOT in Add Aura', () => {
  // Her instruction. The Add Aura list is going to be long enough without permanent app settings
  // living in it.
  assert.doesNotMatch(rendererSrc, /id: 'profile-label',/, 'the loadout label is back in Add Aura');
  assert.doesNotMatch(rendererSrc, /'profileLabel'/, 'the premade preset is still referenced');
  const storeSrc = read('src', 'main', 'widgetStore.js');
  assert.doesNotMatch(storeSrc, /profileLabel:/, 'the dead preset is still in the store');
});

test('the switch is a global setting, beside the other app-wide aura settings', () => {
  assert.match(html, /id="loadout-label-checkbox"/, 'no global toggle');
  assert.match(mainSrc, /ipcMain\.handle\('settings:getLoadoutLabel'/);
  assert.match(mainSrc, /ipcMain\.handle\('settings:setLoadoutLabel'/);
  assert.match(preloadSrc, /getLoadoutLabel:/);
  assert.match(preloadSrc, /setLoadoutLabel:/);
  assert.match(rendererSrc, /loadoutLabelCheckbox\.addEventListener\('change'/);
  assert.match(rendererSrc, /loadoutLabelCheckbox\.checked = !!enabled;/, 'it never shows its saved state');
  // On the Overlay Auras page with the other app-wide settings, not on a widget's own panel.
  const page = html.slice(html.indexOf('id="page-overlay"'), html.indexOf('id="widget-settings-panel"'));
  assert.match(page, /id="loadout-label-checkbox"/, 'the toggle is not on the Overlay Auras page');
});

test('it is off until switched on, and remembers', () => {
  assert.match(mainSrc, /widgetManager\.setLoadoutLabelEnabledState\(loadJson\('loadoutLabelEnabled', false\)\)/,
    'not restored at boot, or not defaulting to off');
  assert.match(mainSrc, /setSaveLoadoutLabelEnabledFn/, 'the setting is never persisted');
  const fn = managerSrc.match(/function setLoadoutLabelEnabled\(enabled\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'setLoadoutLabelEnabled has been renamed or restructured');
  assert.match(fn[1], /saveLoadoutLabelEnabledFn\(!!enabled\)/);
});

test('the widget is created on first use, then only hidden', () => {
  // Deleting and recreating would throw away wherever she dragged it, which is the one thing
  // about it she will have taken any trouble over.
  const fn = managerSrc.match(/function setLoadoutLabelEnabled\(enabled\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /widgetStore\.ensureLoadoutLabel\(\)/);
  assert.doesNotMatch(fn, /delete|remove/i, 'switching it off must not destroy the label');

  const store = newStore();
  assert.equal(store.getLoadoutLabel(), null, 'the label should not exist until asked for');
  const first = store.ensureLoadoutLabel();
  assert.ok(first, 'ensureLoadoutLabel built nothing');
  assert.equal(store.ensureLoadoutLabel().id, first.id, 'a second call made a second label');
  assert.equal(store.getAll().filter((w) => w.kind === 'loadout-label-builtin').length, 1);
});

test('what it is created as', () => {
  const w = newStore().ensureLoadoutLabel();
  assert.equal(w.kind, 'loadout-label-builtin');
  assert.equal(w.displayMode, 'text');
  assert.equal(w.alwaysOn, true);
  assert.equal(w.showOnAllProfiles, true);
  assert.equal(w.textAuraMessage, '{profile}');
});

test('the switch decides whether it is on screen, and nothing else does', () => {
  const fn = managerSrc.match(/function shouldBeOnScreen\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'shouldBeOnScreen has been restructured');
  assert.match(fn[1], /config\.kind === LOADOUT_LABEL_KIND && !loadoutLabelEnabled/);
  // Only ever returns false and falls through, so master hide and the focus auto-hide still apply
  // to it - restating those here would be a second copy to keep in step.
  assert.doesNotMatch(
    fn[1].slice(0, fn[1].indexOf('isSoundOnly')),
    /masterHidden/,
    'the label clause re-implements master hide instead of falling through to it'
  );
});

test('both settings are off by default and survive a share code', () => {
  const store = newStore();
  const plain = store.create('plain');
  assert.equal(plain.alwaysOn, false);
  assert.equal(plain.showOnAllProfiles, false);
  const storeSrc = read('src', 'main', 'widgetStore.js');
  assert.match(storeSrc, /'alwaysOn',/, 'alwaysOn is not shareable');
  assert.match(storeSrc, /'showOnAllProfiles',/, 'showOnAllProfiles is not shareable');
});

test('both toggles are wired end to end', () => {
  assert.match(html, /id="widget-always-on-checkbox"/);
  assert.match(rendererSrc, /alwaysOnCheckbox\.checked = !!widget\.alwaysOn;/);
  assert.match(rendererSrc, /allProfilesCheckbox\.checked = !!widget\.showOnAllProfiles;/);
  assert.match(rendererSrc, /alwaysOnCheckbox\.addEventListener\('change'/);
  assert.match(rendererSrc, /allProfilesCheckbox\.addEventListener\('change'/);
  assert.match(preloadSrc, /setWidgetAlwaysOn:/);
  assert.match(preloadSrc, /setWidgetShowOnAllProfiles:/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setAlwaysOn'/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setShowOnAllProfiles'/);
  assert.match(managerSrc, /^ {2}setAlwaysOn,$/m);
  assert.match(managerSrc, /^ {2}setShowOnAllProfiles,$/m);
});

test('always-on is offered only where it means something', () => {
  assert.match(rendererSrc, /alwaysOnRowEl\.style\.display = isTextAura \? '' : 'none';/);
});

module.exports = () => report('profile-label');
if (require.main === module) process.exit(report('profile-label') ? 1 : 0);
