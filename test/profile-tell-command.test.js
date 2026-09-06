'use strict';
/**
 * QOL #6/#42 - a per-profile /tell command word. Typing `/tell <word>` in game (which the server
 * answers with "<word> is not online at this time.") switches the app to the matching loadout
 * profile, so a loadout-swap macro can keep the app in step without an alt-tab. Same channel the
 * travel picker (`eqtm`) and lockout board (`eqrlm`) already use.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { ProfileStore, DEFAULT_PROFILE_ID } = require('../src/main/profileStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function makeStore(seed) {
  const data = {};
  if (seed) data.profiles = { version: 1, profiles: seed, activeProfileId: seed[0].id };
  return new ProfileStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('setTellCommand stores a lowercased, letters-and-digits-only word', () => {
  const s = makeStore();
  const p = s.setTellCommand(DEFAULT_PROFILE_ID, '  Caster-2!  ');
  assert.equal(p.tellCommand, 'caster2');
});

test('setTellCommand caps at 15 chars (EverQuest\'s name limit)', () => {
  const s = makeStore();
  const p = s.setTellCommand(DEFAULT_PROFILE_ID, 'a'.repeat(30));
  assert.equal(p.tellCommand.length, 15);
});

test('an empty word clears the command rather than storing ""', () => {
  const s = makeStore();
  s.setTellCommand(DEFAULT_PROFILE_ID, 'caster');
  const p = s.setTellCommand(DEFAULT_PROFILE_ID, '   ');
  assert.equal('tellCommand' in p, false);
});

test('setTellCommand on an unknown id returns null and writes nothing', () => {
  const s = makeStore();
  assert.equal(s.setTellCommand('nope', 'x'), null);
});

test('creating loadouts auto-assigns eqld1, eqld2, eqld3... by position', () => {
  const s = makeStore();
  assert.equal(s.getProfile(DEFAULT_PROFILE_ID).tellCommand, undefined, 'a lone Default gets nothing to switch from');
  const p2 = s.create('Melee');
  assert.equal(s.getProfile(DEFAULT_PROFILE_ID).tellCommand, 'eqld1', 'Default gets its number once a second loadout exists');
  assert.equal(p2.tellCommand, 'eqld2');
  const p3 = s.create('Caster');
  assert.equal(p3.tellCommand, 'eqld3');
  assert.equal(s.getProfile(p2.id).tellCommand, 'eqld2', 'earlier auto-words are left alone');
});

test('a hand-picked or deliberately-cleared word is never re-stomped by a later create', () => {
  const s = makeStore();
  s.create('Melee'); // Default -> eqld1, Melee -> eqld2
  s.setTellCommand(DEFAULT_PROFILE_ID, 'tank'); // hand-picked
  const p3 = s.create('Caster');
  assert.equal(s.getProfile(DEFAULT_PROFILE_ID).tellCommand, 'tank', 'not overwritten');
  assert.equal(p3.tellCommand, 'eqld3');
  // clearing sticks too
  const cleared = s.getAll().find((p) => p.tellCommand === 'eqld2');
  s.setTellCommand(cleared.id, '');
  s.create('Bard');
  assert.equal(s.getProfile(cleared.id).tellCommand, undefined, 'a cleared word stays cleared');
});

test('an install with loadouts made before this feature is backfilled on load', () => {
  const s = makeStore([
    { id: 'a', name: 'Default' },
    { id: 'b', name: 'Melee' },
    { id: 'c', name: 'Caster', tellCommand: 'nuke' },
  ]);
  assert.equal(s.getProfile('a').tellCommand, 'eqld1');
  assert.equal(s.getProfile('b').tellCommand, 'eqld2');
  assert.equal(s.getProfile('c').tellCommand, 'nuke', 'an existing word is kept');
});

test('the command word survives a reload', () => {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  new ProfileStore(store).setTellCommand(DEFAULT_PROFILE_ID, 'melee');
  assert.equal(new ProfileStore(store).getProfile(DEFAULT_PROFILE_ID).tellCommand, 'melee');
});

test('the in-game command is wired: listener -> activateProfile, IPC, preload, Loadouts modal', () => {
  const main = read('src', 'main', 'main.js');
  const preload = read('src', 'preload', 'preload-main.js');
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');

  // A dedicated log-line listener that reads the failed /tell and matches it to a profile word.
  assert.match(main, /onLogLine\('profileCommand'/);
  assert.match(main, /all\.find\(\(p\) => \(p\.tellCommand \|\| ''\) === word\)/);
  // It switches the loadout through the SAME path the chip bar and modal use.
  assert.match(main, /function activateProfile\(id\)/);
  assert.match(main, /if \(activateProfile\(match\.id\)\)/);
  // IPC + preload for editing the word.
  assert.match(main, /ipcMain\.handle\('profiles:setTellCommand'/);
  assert.match(preload, /setProfileTellCommand: \(id, word\) => ipcRenderer\.invoke\('profiles:setTellCommand'/);
  // The editable field lives on each row of the Loadouts (manage profiles) modal.
  assert.match(renderer, /setProfileTellCommand\(profile\.id, word\)/);
  assert.match(renderer, /li\.append\(nameField, cmdField, deleteBtn\)/);
});

test('opening "Add a loadout" hides the Manage modal, and closing it brings Manage back', () => {
  // Reported live 5 Sep: the two modals stacked half-overlapping. One on screen at a time now.
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /manage-profiles-add-btn'\)\.addEventListener\('click', \(\) => \{\s*\n\s*manageBackdrop\.style\.display = 'none';/);
  assert.match(renderer, /function reopenManage\(\)/);
  assert.match(renderer, /getElementById\('close-create-profile-modal'\)\.addEventListener\('click', reopenManage\)/);
  assert.match(renderer, /closeOnBackdropClick\(createBackdrop, reopenManage\)/);
  // ...and a successful create returns to Manage too, not to a bare page.
  assert.match(renderer, /createProfile\(name, widgetIdsToMigrate\)\.then\(\(\) => \{\s*\n\s*createBackdrop\.style\.display = 'none';\s*\n\s*reopenManage\(\);/);
});

module.exports = () => report('profile-tell-command');
if (require.main === module) report('profile-tell-command').then((n) => process.exit(n ? 1 : 0));
