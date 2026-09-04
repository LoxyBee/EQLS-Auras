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

test('a spell with no duration is not offered, even if it has landing text', () => {
  // Reported live 25 Aug: Anarchy (an Enchanter nuke, no duration at all) showing up in the Buff
  // timer picker labelled "no duration" - "nukes are not buffs, remove them from the buff
  // selection list. remove anything that does not have a duration for clarity." A no-duration
  // entry only ever had landing text because the detection engine needs it for INSTANT-event
  // tracking (a sound/text flash, never a countdown) - real, but not what "pick a spell and get a
  // duration timer for it" means.
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:trackable'[\s\S]*?\n\);/);
  assert.ok(handler, 'the trackable-spell list has been restructured');
  assert.match(
    handler[0],
    /\.filter\(\(e\) => \(typeof e\.durationSec === 'number' && e\.durationSec > 0\) \|\| e\.infiniteDuration\)/,
    'the duration filter is missing or was reworded'
  );

  const trackable = roster
    .filter((e) => e.landingText && String(e.landingText).trim())
    .filter((e) => (typeof e.durationSec === 'number' && e.durationSec > 0) || e.infiniteDuration);

  const anarchy = roster.find((e) => e.name === 'Anarchy');
  assert.ok(anarchy, 'Anarchy is missing from the roster - the case this guards no longer exists to check');
  assert.equal(anarchy.scaleCategory, 'nuke');
  assert.ok(!anarchy.durationSec && !anarchy.infiniteDuration, 'Anarchy now has a duration - the case this guards cannot occur');
  assert.ok(!trackable.some((e) => e.name === 'Anarchy'), 'Anarchy is still offered as a "buff" to track');

  // The filter must not be a blunt "exclude all nukes/debuffs" rule - a real debuff with a real
  // duration (how "wears off" gets timed at all) has to stay offered.
  const realDebuff = roster.find((e) => e.scaleCategory === 'debuff' && e.durationSec > 0 && e.landingText);
  assert.ok(realDebuff, 'no duration-bearing debuff found in the roster to check against');
  assert.ok(trackable.some((e) => e.name === realDebuff.name), `"${realDebuff.name}" has a real duration and should still be offered`);
});

test('each spell says whether it can be watched on an ally - and a detrimental one never can', () => {
  // Reported directly, 24 Aug: "allure is marked as a buff to cast on an ally, it is not." Allure
  // is a charm (roster: kind 'det', scaleCategory 'charm') with real third-person text
  // ("<Name> has been charmed."), so the OLD rule here - ally purely from third-person text
  // existing, with no regard for what kind of landing it was - offered "Someone you cast it on"
  // for it. A charm is cast AT something, never landed on a groupmate as a buff.
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:trackable'[\s\S]*?\n\);/);
  assert.match(handler[0], /hasThirdPersonText = !!\(e\.othersLandingSuffix && String\(e\.othersLandingSuffix\)\.trim\(\)\)/);
  assert.match(handler[0], /ally: hasThirdPersonText && !isDetrimental/, 'a debuff/charm/dot/nuke can still be offered as "ally"');
  // 3 Sep: Affliction (a DoT) offered "Yourself". A detrimental spell carries a second-person
  // landing text only because an enemy casting it on you produces one - it is not a self-buff.
  assert.match(handler[0], /self: !isDetrimental/, 'a detrimental spell must not be offered "on yourself"');
  assert.match(handler[0], /e\.kind === 'det'/, 'kind:"det" (Affliction) is caught even if scaleCategory misses it');

  // The gap is real: some trackable spells have no third-person text at all.
  const trackable = roster.filter((e) => e.landingText && String(e.landingText).trim());
  const allyCapable = trackable.filter((e) => e.othersLandingSuffix && String(e.othersLandingSuffix).trim());
  assert.ok(
    allyCapable.length < trackable.length,
    'every trackable spell supports ally tracking, so the warning below can never fire - check the roster'
  );

  // And the specific case that was reported, checked directly against the real roster rather than
  // trusting the rule in the abstract.
  const allure = roster.find((e) => e.name === 'Allure');
  assert.ok(allure, 'Allure is missing from the roster - the case this guards no longer exists to check');
  assert.equal(allure.scaleCategory, 'charm');
  assert.ok(allure.othersLandingSuffix, 'Allure has no third-person text - the case this guards cannot occur');
});

test('each "On:" option is disabled with a reason for a spell that cannot use it', () => {
  // Note 14's stated risk, plus the 3 Sep report: Affliction (a DoT, `self:false`) was offering
  // "Yourself". Disabled rather than hidden, so it reads as "not possible for this spell" instead
  // of the option having mysteriously moved, and the panel always lands on a working radio.
  const fn = rendererSrc.match(/function chooseBuffTimerSpell\(buff\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'chooseBuffTimerSpell has been renamed or restructured');
  const body = fn[1];
  assert.match(body, /selfRadio\.disabled = !buff\.self/);
  assert.match(body, /allyRadio\.disabled = !buff\.ally/);
  assert.match(body, /enemyRadio\.disabled = !buff\.enemy/);
  // A disabled radio can never be left selected: after every disabled state is set, one pass
  // re-checks exactly the picked (enabled) one.
  assert.match(body, /r\.checked = r === pick/, 'a disabled radio could stay selected');
  assert.match(body, /\.find\(\(r\) => r && !r\.disabled\)/, 'no fallback to the first enabled option');
  assert.match(body, /buffTimerAllyWarning\.textContent =/, 'it disables the option without saying why');
  assert.match(body, /never light up/, 'the ally warning does not say what would go wrong');
  assert.match(body, /cast at a target, not on you/, 'a detrimental spell gets no "watch it on you" message');
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

test('it is a real dropdown, not a search box over a capped list', () => {
  // Reversed at the owner's instruction, 2026-08-24: a search box with a 40-result cap and an
  // "...and N more - keep typing" dead end at the bottom was reported outright as "stupid
  // functionality". A native <select> has no such cap - it scrolls, and typing a letter jumps to
  // it, which a custom list was reimplementing badly.
  assert.match(html, /id="buff-timer-select"/, 'no dropdown in the markup');
  assert.doesNotMatch(html, /id="buff-timer-search"/, 'the old search box is back');
  assert.doesNotMatch(html, /id="buff-timer-list"/, 'the old capped list is back');
  assert.doesNotMatch(rendererSrc, /BUFF_TIMER_RENDER_CAP/, 'a render cap has no meaning for a <select>');
});

test('the dropdown is populated fresh whenever the pool or the mode changes', () => {
  const fn = rendererSrc.match(/function populateBuffTimerSelect\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'populateBuffTimerSelect has been renamed or restructured');
  assert.match(fn[1], /buffTimerSelect\.innerHTML = '';/, 'stale options from the last pool would linger');
  assert.match(fn[1], /buffTimerPool\(\)/, 'must read the mode-appropriate list, not always trackableBuffs');
  assert.match(fn[1], /\.sort\(/, 'an unsorted 720-entry dropdown is as hard to use as no dropdown at all');
});

test('the Buff timer picker holds only buffs, the Debuff picker only detrimental spells', () => {
  // Owner, 3 Sep: "they should never be in the buff picker. there is a separate debuff picker for
  // det spells." buffTimerPool splits trackableBuffs by which premade opened the panel.
  const fn = rendererSrc.match(/function buffTimerPool\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'buffTimerPool has been renamed or restructured');
  assert.match(fn[1], /buffTimerPreferredSource === 'enemy'/, 'the two lists are not split by premade');
  assert.match(fn[1], /trackableBuffs\.filter\(\(b\) => b\.enemy\)/, 'the enemy list is not filtered to enemy spells');
  assert.match(fn[1], /trackableBuffs\.filter\(\(b\) => b\.self\)/, 'the buff list still shows detrimental spells');

  // Against the real roster: Affliction (a DoT) is in the enemy set and NOT the buff set.
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'data', 'buffs.json'), 'utf8'));
  const a = roster.find((e) => e.name === 'Affliction');
  assert.ok(a && (a.kind === 'det' || a.scaleCategory === 'dot'), 'Affliction is no longer a detrimental spell - pick another');
});

test('picking an option resolves back to the real buff object', () => {
  // The <select>'s value is only ever a name (an option cannot hold a whole object), so the
  // change handler has to look the buff back up in the current pool rather than trust the string.
  assert.match(
    rendererSrc,
    /buffTimerSelect\.addEventListener\('change', \(\) => \{\s*\n\s*const buff = buffTimerPool\(\)\.find/
  );
});

test('the premade opens the panel instead of building immediately', () => {
  assert.match(rendererSrc, /id: 'buff-timer',/, 'no Buff timer entry in the premade list');
  assert.match(rendererSrc, /panel: 'buff-timer',/);
  assert.match(rendererSrc, /if \(premade\.panel\) \{/, 'the list still assumes every premade builds at once');
  // And the panel is reset each time, or the last spell picked would still be showing - carrying
  // the premade's own starting choice, since two premades now share this one panel and differ
  // only in which of the three "On:" options they open on.
  assert.match(rendererSrc, /resetBuffTimerPanel\(premade\.defaultSource, premade\.mode, premade\.reverseExample\)/);
});

test('the trackable list is fetched fresh when the modal opens', () => {
  // Held for the session it would go stale: editing a buff on the Known Buffs page can change
  // whether it is trackable at all.
  const fn = rendererSrc.match(/function openAddWidgetModal\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'openAddWidgetModal has been restructured');
  assert.match(fn[1], /getTrackableBuffs\(\)/);
});

module.exports = () => report('buff-timer-premade');
if (require.main === module) report('buff-timer-premade').then((n) => process.exit(n ? 1 : 0));
