'use strict';
/**
 * The "Buff timer" premade - note 14.
 *
 * No new detection at all: "one named spell on me" and "one named spell on an ally" were always
 * supported aura configurations. This is purely a guided way to reach one, which is the whole
 * reason it is worth having - the alternative is knowing to make a custom aura, find the buff
 * picker, search 720 spells and tick exactly one.
 *
 * It is also the FIRST premade that asks something before it builds anything, so it is
 * deliberately built generically: the planned cooldown and enemy-debuff premades are the same
 * shape and should reuse this rather than each growing their own picker.
 *
 * The failure worth guarding hardest is the one note 14 called out itself: ally tracking only
 * works for a spell whose roster entry carries third-person landing text. Offering "on an ally"
 * for a spell without it builds an aura that silently never lights up - no error, nothing on
 * screen, just a tile that never appears.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// ---------------------------------------------------------------------------
// What it builds
// ---------------------------------------------------------------------------

test('it builds an aura watching exactly one named spell', () => {
  const store = newStore();
  const w = store.createBuffTimer('Spirit of the Puma', { spellName: 'Spirit of the Puma', source: 'self' });
  assert.equal(w.kind, 'custom', 'it must be an ordinary aura, not a new kind');
  assert.equal(w.buffFilterMode, 'explicit');
  assert.deepEqual(w.buffNames, ['Spirit of the Puma']);
  assert.equal(w.buffSource, 'self');
  assert.equal(w.iconsPerRow, 1, 'one spell is one tile - a four-wide grid would be three empty columns');
});

test('it can watch the same spell on an ally instead', () => {
  const store = newStore();
  const w = store.createBuffTimer('Puma on allies', { spellName: 'Spirit of the Puma', source: 'ally' });
  assert.equal(w.buffSource, 'ally');
  assert.deepEqual(w.buffNames, ['Spirit of the Puma']);
});

test('anything other than ally means yourself', () => {
  // A share code or a stray value must not produce a third, undefined source.
  const store = newStore();
  for (const source of [undefined, null, 'self', 'sideways', 'customTimer']) {
    assert.equal(store.createBuffTimer('X', { spellName: 'Agility', source }).buffSource, 'self');
  }
});

test('it is built in one call, not assembled on screen', () => {
  // Four chained setters from the renderer would each be an IPC round trip pushing a config change
  // to the overlay, so the aura would visibly build itself - source, then filter, then name.
  assert.match(managerSrc, /function createBuffTimerWidget\(name, spellName, source\)/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:createBuffTimer'/);
  assert.match(preloadSrc, /createBuffTimerWidget: \(name, spellName, source\)/);
  const fn = managerSrc.match(/function createBuffTimerWidget[\s\S]*?\n\}/);
  assert.equal(
    (fn[0].match(/widgetStore\./g) || []).length, 1,
    'it should reach the store exactly once'
  );
});

// ---------------------------------------------------------------------------
// What it offers, and what it refuses to offer
// ---------------------------------------------------------------------------

test('only spells the app can actually track are offered', () => {
  // A spell with no landing message cannot be detected at all, so offering it would build an aura
  // that never does anything.
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:trackable'[\s\S]*?\n\);/);
  assert.ok(handler, 'the trackable-spell list has been restructured');
  assert.match(handler[0], /e\.landingText && String\(e\.landingText\)\.trim\(\)/);

  // And there really is a difference worth filtering on.
  const trackable = roster.filter((e) => e.landingText && String(e.landingText).trim());
  assert.ok(trackable.length > 400, `only ${trackable.length} trackable spells - has the roster changed?`);
  assert.ok(trackable.length < roster.length, 'if everything were trackable this filter would be pointless');
});

test('each spell says whether it can be watched on an ally', () => {
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:trackable'[\s\S]*?\n\);/);
  assert.match(handler[0], /ally: !!\(e\.othersLandingSuffix && String\(e\.othersLandingSuffix\)\.trim\(\)\)/);

  // The gap is real: some trackable spells have no third-person text at all.
  const trackable = roster.filter((e) => e.landingText && String(e.landingText).trim());
  const allyCapable = trackable.filter((e) => e.othersLandingSuffix && String(e.othersLandingSuffix).trim());
  assert.ok(
    allyCapable.length < trackable.length,
    'every trackable spell supports ally tracking, so the warning below can never fire - check the roster'
  );
});

test('the ally option is disabled, with a reason, for a spell that cannot use it', () => {
  // Note 14's stated risk. Disabled rather than hidden, so it reads as "not possible for this
  // spell" instead of the option having mysteriously moved.
  const fn = rendererSrc.match(/function chooseBuffTimerSpell\(buff\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'chooseBuffTimerSpell has been renamed or restructured');
  const body = fn[1];
  assert.match(body, /allyRadio\.disabled = !buff\.ally/);
  assert.match(body, /allyRadio\.checked = false/, 'a spell picked while ally was selected would keep it');
  assert.match(body, /buffTimerAllyWarning\.textContent =/, 'it disables the option without saying why');
  assert.match(body, /never light up/, 'the warning does not say what would go wrong');
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

test('it is a searchable list, not a dropdown', () => {
  // 720 trackable spells is far past what a dropdown can be used with.
  assert.match(html, /id="buff-timer-search"/, 'there is no search box');
  assert.match(html, /id="buff-timer-list"/);
  assert.doesNotMatch(html, /<select[^>]*id="buff-timer/, 'a dropdown cannot be used at this size');
  assert.match(rendererSrc, /const BUFF_TIMER_RENDER_CAP = \d+;/, 'an uncapped list is a long scroll nobody reads');
});

test('the empty and no-match states explain themselves', () => {
  const fn = rendererSrc.match(/function renderBuffTimerList\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'renderBuffTimerList has been restructured');
  assert.match(fn[1], /Type to search/, 'an empty list with no prompt looks broken');
  // "None" is not enough: a spell can be perfectly real and still absent because the roster has
  // no landing message for it, which is a different problem from a typo.
  assert.match(fn[1], /landing message/, 'a no-match result does not say why something might be missing');
});

test('the premade opens the panel instead of building immediately', () => {
  assert.match(rendererSrc, /id: 'buff-timer',/, 'no Buff timer entry in the premade list');
  assert.match(rendererSrc, /panel: 'buff-timer',/);
  assert.match(rendererSrc, /if \(premade\.panel\) \{/, 'the list still assumes every premade builds at once');
  // And the panel is reset each time, or the last spell picked would still be showing - carrying
  // the premade's own starting choice, since two premades now share this one panel and differ
  // only in which of the three "On:" options they open on.
  assert.match(rendererSrc, /resetBuffTimerPanel\(premade\.defaultSource\)/);
});

test('the trackable list is fetched fresh when the modal opens', () => {
  // Held for the session it would go stale: editing a buff on the Known Buffs page can change
  // whether it is trackable at all.
  const fn = rendererSrc.match(/function openAddWidgetModal\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'openAddWidgetModal has been restructured');
  assert.match(fn[1], /getTrackableBuffs\(\)/);
});

module.exports = () => report('buff-timer-premade');
if (require.main === module) process.exit(report('buff-timer-premade') ? 1 : 0);
