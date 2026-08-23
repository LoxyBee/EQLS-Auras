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
 * WHERE THE SWITCH LIVES, twice corrected. On 21 August: "it should be a part of global config,
 * not add aura... a permanent option that is not tied to creating an aura" - so the premade went.
 * On 23 August: "the toggle to turn it off should be on the same menu that the create extra
 * profile is on" - so it now sits in the Loadouts modal, which is where loadouts are made and
 * deleted. Both moves are the same instinct: put the control where its subject already is.
 *
 * It is still a widget underneath, and that is a choice worth defending rather than an accident:
 * a draggable position, locking, opacity, sizing and surviving a restart all exist for widgets
 * already, and writing them again for one label would be the actual bloat.
 *
 * AND IT NOW SWITCHES ITSELF ON, once, the first time a second loadout exists - with one loadout
 * it has nothing to say. Gated on a flag of its own rather than on the profile count, because
 * gating on the count means switching it off and later adding a third loadout turns it back on,
 * forever. That is the failure the note warned about when it asked for this to be version-gated.
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

test('the switch lives with the loadouts, not with the auras', () => {
  assert.match(html, /id="loadout-label-checkbox"/, 'no global toggle');
  assert.match(mainSrc, /ipcMain\.handle\('settings:getLoadoutLabel'/);
  assert.match(mainSrc, /ipcMain\.handle\('settings:setLoadoutLabel'/);
  assert.match(preloadSrc, /getLoadoutLabel:/);
  assert.match(preloadSrc, /setLoadoutLabel:/);
  assert.match(rendererSrc, /loadoutLabelCheckbox\.addEventListener\('change'/);
  assert.match(rendererSrc, /loadoutLabelCheckbox\.checked = !!enabled;/, 'it never shows its saved state');
  // Moved on 23 August: "the toggle to turn it off should be on the same menu that the create
  // extra profile is on". The label is about loadouts, so it belongs with them rather than in a
  // list of aura settings - and that is now the same modal that creates and deletes them.
  const modal = html.slice(html.indexOf('id="manage-profiles-modal-backdrop"'));
  const own = modal.slice(0, modal.indexOf('id="add-widget-modal-backdrop"'));
  assert.match(own, /id="loadout-label-checkbox"/, 'the toggle is not in the Loadouts modal');
  assert.equal((html.match(/id="loadout-label-checkbox"/g) || []).length, 1, 'it was copied, not moved');
});

test('one button on the profile bar, not two', () => {
  // Her words: "probably the 'add' and 'settings' buttons on the profile bar can become one button
  // that opens a modal to add, delete, and change profile options."
  assert.doesNotMatch(html, /id="profile-add-btn"/, 'the separate + button is still there');
  assert.match(html, /id="profile-manage-btn"[^>]*>Loadouts</, 'the one button is not labelled');
  // The add flow still exists - it is reached from inside the modal now.
  assert.match(html, /id="manage-profiles-add-btn"/, 'no way to add a loadout any more');
  assert.match(rendererSrc, /setupModalToggle\('create-profile-modal-backdrop', 'manage-profiles-add-btn'/);
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

test('it switches itself on the first time a second loadout exists', () => {
  // Her answer, 23 August: "when you make a second loadout, it should turn on the display".
  const handler = mainSrc.match(/ipcMain\.handle\('profiles:create'[\s\S]*?\n\}\);/);
  assert.ok(handler, "the profiles:create handler has been restructured");
  assert.match(handler[0], /profileStore\.getAll\(\)\.length >= 2/);
  assert.match(handler[0], /widgetManager\.setLoadoutLabelEnabled\(true\)/);
});

test('it can only ever do that once', () => {
  // Gated on a flag of its own, NOT on the profile count. Otherwise switching it off and later
  // adding a third loadout turns it back on, and she has to keep switching it off forever - which
  // is exactly what the note warned about when it asked for this to be version-gated.
  const handler = mainSrc.match(/ipcMain\.handle\('profiles:create'[\s\S]*?\n\}\);/)[0];
  assert.match(handler, /loadJson\('loadoutLabelAutoOffered', false\)/);
  assert.match(handler, /saveJson\('loadoutLabelAutoOffered', true\)/);
  // The flag is written whether or not the label was already on, so a person who turned it on
  // themselves before making a second loadout does not get it forced again later.
  // The flag must be set OUTSIDE the "is it already on" check. Inside it, someone who switched the
  // label on themselves before making a second loadout never gets the flag written, and the
  // auto-enable is still armed the next time they turn it off.
  const gate = handler.slice(handler.indexOf("loadJson('loadoutLabelAutoOffered'"));
  const save = gate.indexOf("saveJson('loadoutLabelAutoOffered', true)");
  const guard = gate.indexOf('if (!widgetManager.isLoadoutLabelEnabled())');
  assert.ok(save >= 0 && guard >= 0, 'the auto-enable block has been restructured');
  assert.ok(save < guard, 'the flag is set inside the already-on check, so it can arm itself again');
});

test('the box hears about it switching itself on', () => {
  // Otherwise she opens the modal to an unticked box beside a label that is plainly on screen.
  assert.match(mainSrc, /settings:loadoutLabelChanged/);
  assert.match(preloadSrc, /onLoadoutLabelChanged:/);
  assert.match(rendererSrc, /onLoadoutLabelChanged\(\(enabled\) => \{/);
  assert.match(rendererSrc, /loadoutLabelCheckbox\.checked = !!enabled;[\s\S]{0,40}refreshWidgets\(\)/);
});

module.exports = () => report('profile-label');
if (require.main === module) process.exit(report('profile-label') ? 1 : 0);
