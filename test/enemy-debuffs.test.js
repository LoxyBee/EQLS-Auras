'use strict';
/**
 * Debuffs on things you are fighting - notes 11, 16, 17.
 *
 * Why this could never work before: a landing on someone else is read from a line like
 * "<name> has been mesmerized.", and the engine only accepted <name> if it was ONE alphabetic
 * word. That check is not arbitrary - it is what stops a chat message that happens to end with
 * the same words from being read as a spell landing. But a mob is "a greater kobold", so every
 * mez, charm, snare and slow the owner has ever cast was rejected by it.
 *
 * Why it is opt-in rather than simply relaxed: measured across her 1.5 million real log lines,
 * dropping that check for everything admits about 160,000 landings, of which 106,876 are two
 * bard songs pulsing on every mob in earshot. Opting in per aura bounds the volume by what
 * someone actually asked to see.
 *
 * The three ending lines were found by counting them in those same logs. None of them is in the
 * roster, and one of them - "has been awakened by" - was not known to the project at all: the
 * note on AoE mez assumed a mez broken by damage was silent. It is not, four times in five.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');
const { matchOthersWornOff, matchSlain, matchAwakened } = require('../src/main/buffParser');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'data', 'buffs.json'), 'utf8'));
const managerSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'widgetManager.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'widgetStore.js'), 'utf8');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function memory() {
  const data = {};
  return {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
}

// watching: array of spell names an aura has opted into, or null for "nobody opted into anything",
// which is the state every existing install is in.
function engine(watching) {
  const store = memory();
  const e = new BuffEngine(new BuffStore(store), store);
  e.stop(); // no ticking - every test here drives the lines itself
  if (watching) {
    const set = new Set(watching.map((s) => s.toLowerCase()));
    e.setEnemyDebuffNamesFn(() => set);
  }
  return e;
}

const feed = (e, ...lines) => lines.forEach((l) => e.handleLine(TS + l));
const names = (e) => e.getActiveAllyBuffs().map((b) => `${b.allyName}::${b.name}`).sort();

// ---------------------------------------------------------------------------
// The opt-in, and the guarantee that nothing changes without it
// ---------------------------------------------------------------------------

test('with nothing opted in, a mob name is rejected exactly as before', () => {
  // The whole no-regression promise rests on this one. Every install that has not asked for enemy
  // tracking must behave identically to before the feature existed.
  const e = engine(null);
  feed(e, 'You begin casting Mesmerize.', 'orc legionnaire has been mesmerized.');
  assert.deepEqual(names(e), []);
});

test('opting in admits the same line', () => {
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'orc legionnaire has been mesmerized.');
  assert.deepEqual(names(e), ['orc legionnaire::Mesmerize']);
});

test('opting one spell in does not admit a different one', () => {
  // The bound only holds if it is per spell. If opting into Mesmerize relaxed the check globally,
  // the 106,876 bard-song landings come straight back.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Charm.', 'orc legionnaire has been charmed.');
  assert.deepEqual(names(e), []);
});

test('a real player name still lands whether or not anything is opted in', () => {
  for (const watching of [null, ['Mesmerize']]) {
    const e = engine(watching);
    feed(e, 'You begin casting Mesmerize.', 'Marrowbane has been mesmerized.');
    assert.deepEqual(names(e), ['Marrowbane::Mesmerize'], `watching=${watching}`);
  }
});

test('the relaxed check still refuses a sentence', () => {
  // What the strict single-word check was there for. Widened to mob names is not widened to
  // anything at all - a chat line ending in the same words must still be rejected.
  //
  // Two shapes, because two separate caps do the work and a test that only trips one of them
  // leaves the other free to be deleted. The long one is caught by the length cap; the short one
  // is under 38 characters and is caught only by the word cap.
  const e = engine(['Mesmerize']);
  const known = { name: 'Mesmerize', scaleCategory: 'debuff' };
  // Seven words in thirty characters: short enough to slip past the length cap, so only the word
  // cap can reject it. Real mob names top out around five words.
  assert.equal(e._isValidRecipient('he said the camp is over there', known), false, 'word cap');
  // Two words, forty-six characters: only the length cap can reject this one. The previous case
  // trips both caps, so on its own it would let either be deleted unnoticed.
  assert.equal(e._isValidRecipient('a naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaame', known), false, 'length cap');
  assert.equal(
    e._isValidRecipient('a very long name that runs past any plausible mob', known), false, 'both caps'
  );
  feed(e, 'You begin casting Mesmerize.',
    'Someone said in general chat that the whole camp has been mesmerized.');
  assert.deepEqual(names(e), []);
});

test('real mob names from the logs are all accepted', () => {
  const e = engine(['Mesmerize']);
  const known = { name: 'Mesmerize', scaleCategory: 'debuff' };
  const mobs = [
    'a greater kobold',
    'a Teir`Dal ranger',
    'an elite gnoll shaman',
    'Baron Telyx V`Zher',
    'the froglok shin lord',
    'orc legionnaire',
    'a spinechiller spider',
    'The Prophet',
  ];
  for (const mob of mobs) {
    assert.ok(e._isValidRecipient(mob, known), `rejected a real mob name: ${mob}`);
  }
});

// ---------------------------------------------------------------------------
// Telling an enemy apart from a groupmate
// ---------------------------------------------------------------------------

test('what makes a landing an enemy landing is the spell, not the name', () => {
  // Plenty of mobs have one-word names - Bonefire and Marrowbane are both real, and both are mezzed
  // in the logs - so the shape of the name cannot decide this. The spell's category can.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'Bonefire has been mesmerized.');
  assert.equal(e.getActiveAllyBuffs()[0].onEnemy, true);
});

test('an ordinary buff on a groupmate is not marked as being on an enemy', () => {
  const e = engine(null);
  feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
  const buff = e.getActiveAllyBuffs().find((b) => b.name === 'Spirit of Wolf');
  assert.ok(buff, 'the ally buff did not land - this test proves nothing unless it does');
  assert.equal(buff.onEnemy, false, 'a beneficial buff must never be flagged as an enemy');
});

test('every mez and charm in the roster is categorised as something cast at an enemy', () => {
  // If the roster ever recategorised these, the tiles would silently stop being marked and would
  // start showing up on ally auras instead.
  const family = roster.filter(
    (e) => e.othersLandingSuffix === ' has been mesmerized.' || e.othersLandingSuffix === ' has been charmed.'
  );
  assert.ok(family.length >= 7, `only ${family.length} mez/charm entries - has the roster changed?`);
  for (const e of family) {
    assert.ok(['debuff', 'charm'].includes(e.scaleCategory), `${e.name} is categorised ${e.scaleCategory}`);
  }
});

// ---------------------------------------------------------------------------
// How it ends
// ---------------------------------------------------------------------------

test('the wear-off line ends it, naming spell and target', () => {
  // Verbatim from eqlog_Shara_rivervale_2026-08-19.txt.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'orc legionnaire has been mesmerized.');
  assert.deepEqual(names(e), ['orc legionnaire::Mesmerize']);
  feed(e, 'Your Mesmerize spell has worn off of orc legionnaire.');
  assert.deepEqual(names(e), []);
});

test('death ends it, and the casing changes between the two lines', () => {
  // The land line keeps the mob's natural casing ("orc legionnaire"); the slain line forces a
  // capital ("Orc legionnaire"). Verified across 6,617 slain lines with no exceptions. A
  // case-sensitive lookup would clear nothing, ever.
  for (const death of ['Orc legionnaire has been slain by Avenrae!', 'You have slain orc legionnaire!']) {
    const e = engine(['Mesmerize']);
    feed(e, 'You begin casting Mesmerize.', 'orc legionnaire has been mesmerized.');
    feed(e, death);
    assert.deepEqual(names(e), [], `not cleared by: ${death}`);
  }
});

test('a broken mez ends it', () => {
  // The line the project did not know existed. 142 of them in the logs.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'orc legionnaire has been mesmerized.');
  feed(e, 'Orc legionnaire has been awakened by Shara.');
  assert.deepEqual(names(e), []);
});

test('a break only clears a mez, not everything on that mob', () => {
  // "awakened" does not name a spell, so it can only be trusted to end the thing it describes.
  // A charm or a snare on the same mob is still running.
  const e = engine(['Mesmerize', 'Charm']);
  feed(e, 'You begin casting Charm.', 'orc legionnaire has been charmed.');
  feed(e, 'Orc legionnaire has been awakened by Shara.');
  assert.deepEqual(names(e), ['orc legionnaire::Charm']);
});

test('an ending line for one mob leaves another mob alone', () => {
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'orc legionnaire has been mesmerized.');
  feed(e, 'You begin casting Mesmerize.', 'a sonic bat has been mesmerized.');
  feed(e, 'Orc legionnaire has been slain by Avenrae!');
  assert.deepEqual(names(e), ['a sonic bat::Mesmerize']);
});

test('a groupmate dying does not forget their buffs', () => {
  // The death and break lines name only a TARGET, not a spell, so they stay limited to enemy
  // entries. A mob dying means its debuffs are gone; a groupmate dying means they will probably be
  // rezzed with their buffs intact, and forgetting them would be the app inventing a change the
  // log never reported.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
  const before = names(e);
  assert.ok(before.includes('Marrowbane::Spirit of Wolf'), 'the ally buff did not land - nothing is being tested');
  feed(e, 'Marrowbane has been slain by a gnoll!', 'Marrowbane has been awakened by Shara.');
  assert.deepEqual(names(e), before, 'a groupmate dying cleared their buffs');
});

test('a line naming the spell AND the target does clear an ally buff', () => {
  // Note 26, and the deliberate change of mind. This was scoped to enemies only when enemy
  // tracking went in, to avoid altering anything nobody had asked about. Shara has since asked
  // for note 26 specifically, and these two lines are the answer to it: they name the spell and
  // the target, so there is nothing to guess and no reason to hold back.
  for (const ending of [
    'Your Spirit of Wolf spell has worn off of Marrowbane.',
    'Your Spirit of Wolf spell on Marrowbane has been overwritten.',
  ]) {
    const e = engine(null);
    feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
    assert.ok(names(e).includes('Marrowbane::Spirit of Wolf'), 'the ally buff did not land');
    feed(e, ending);
    assert.deepEqual(names(e), [], `not cleared by: ${ending}`);
  }
});

test('an overwrite of a different spell, or on a different target, is left alone', () => {
  const e = engine(null);
  feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
  feed(e, 'Your Spirit of Wolf spell on Avenrae has been overwritten.');
  assert.deepEqual(names(e), ['Marrowbane::Spirit of Wolf'], 'the wrong target was cleared');
  feed(e, 'Your Bravery spell on Marrowbane has been overwritten.');
  assert.deepEqual(names(e), ['Marrowbane::Spirit of Wolf'], 'the wrong spell was cleared');
});

// ---------------------------------------------------------------------------
// The line shapes themselves
// ---------------------------------------------------------------------------

test('the ending patterns match the real lines and nothing else', () => {
  assert.deepEqual(matchOthersWornOff(`${TS}Your Mesmerize spell has worn off of orc legionnaire.`), {
    spellName: 'Mesmerize',
    targetName: 'orc legionnaire',
  });
  assert.equal(matchSlain(`${TS}Orc centurion has been slain by Avenrae!`), 'Orc centurion');
  assert.equal(matchSlain(`${TS}You have slain orc legionnaire!`), 'orc legionnaire');
  assert.equal(matchAwakened(`${TS}A worry wraith has been awakened by Shara.`), 'A worry wraith');

  // The self form has no target and must not be read as one.
  assert.equal(matchOthersWornOff(`${TS}Your Yaulp spell has worn off.`), null);
  // The player dying is a different line and must not clear a mob's debuffs.
  assert.equal(matchSlain(`${TS}You have been slain by a gnoll!`), null);
});

test('a spell name in an ending line can carry a rank numeral', () => {
  // Real examples from the logs: Plague III, Envenomed Bolt IV, Togor's Insects V.
  assert.deepEqual(matchOthersWornOff(`${TS}Your Togor's Insects V spell has worn off of a greater kobold.`), {
    spellName: "Togor's Insects V",
    targetName: 'a greater kobold',
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('the aura setting exists, is off by default, and is shareable', () => {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.create('Mez');
  assert.equal(w.trackOnEnemies, false, 'enemy tracking must be off unless asked for');
  assert.match(storeSrc, /'trackOnEnemies',/, 'not in SHAREABLE_FIELDS, so a share code would drop it');
});

test('only spells from auras that opted in are sent to the engine', () => {
  const fn = managerSrc.match(/function getEnemyDebuffNames\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'getEnemyDebuffNames has been renamed or restructured');
  assert.match(fn[1], /if \(!config\.trackOnEnemies\) continue;/);
  assert.match(fn[1], /toLowerCase\(\)/, 'the engine lowercases its lookup, so the set must be lowercased too');
  // Not filtered by profile: detection must not depend on which loadout happens to be selected.
  assert.doesNotMatch(fn[1], /profile/i);
});

test('the engine is given the list at startup', () => {
  assert.match(mainSrc, /buffEngine\.setEnemyDebuffNamesFn\(\(\) => widgetManager\.getEnemyDebuffNames\(\)\)/);
});

// ---------------------------------------------------------------------------
// Reaching it, and drawing it
// ---------------------------------------------------------------------------

test('an aura that did not ask for enemies does not draw them', () => {
  // The half that matters most. Without it the Ally Buffs aura fills up with mobs - and it would,
  // because the enemy mark is set by the spell's category, so it already applies to debuffs on
  // one-word-named mobs the app has been detecting all along.
  const overlay = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'overlay', 'overlay.js'), 'utf8');
  assert.match(overlay, /if \(!currentConfig\.trackOnEnemies\) \{/, 'no enemy filter in the overlay');
  assert.match(
    overlay,
    /filtered = filtered\.filter\(\(b\) => !b\.onEnemy\);/,
    'the filter does not actually drop enemy landings'
  );
});

test('the runtime toggle is gone - enemy tracking is fixed at creation now', () => {
  // Reversed at the owner's instruction, 2026-08-24: "debuffs shouldn't need a toggle for this it
  // should be base functionality. that is the point of it being a custom debuff." The toggle also
  // had no legitimate use left once the buff/debuff picker became category-locked (see
  // isDetBuff/wantsDebuffs in gem-slots.test.js) - a Custom buff aura can only ever pick
  // buff-category spells, so there was never a debuff-category pick left for "also watch these on
  // enemies" to apply to. trackOnEnemies itself is untouched: still a real stored field, still set
  // permanently by createDebuff (true) vs the plain custom creator (false), still read everywhere
  // detection and the picker filter need it - only the runtime checkbox that could flip it after
  // creation is gone.
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload-main.js'), 'utf8');
  assert.doesNotMatch(html, /id="widget-track-enemies-checkbox"/, 'the checkbox is back');
  assert.doesNotMatch(renderer, /trackEnemiesCheckbox/, 'a dangling reference to the removed control');
  // The backend setter is deliberately left in place - harmless, and this project's precedent
  // (hideBardSongs, showOnAllProfiles) is to leave a field's plumbing rather than migrate it away
  // for no benefit. Nothing in the UI calls it any more, which is the point of this test.
  assert.match(preload, /setWidgetTrackOnEnemies:/, 'the backend bridge was removed along with the UI');
  assert.match(mainSrc, /ipcMain\.handle\('widget:setTrackOnEnemies'/);
  assert.match(managerSrc, /function setTrackOnEnemies\(id, enabled\)/);
});

test('the "Watching:" row is hidden on a debuff aura too, not shown reading "allies"', () => {
  // The other half of the same report: "'buffs you've cast on allies' [is] enabled, but this has
  // nothing to do with casting spells on an ally, it is enemies ONLY." Same treatment as
  // allyDebuffAlert (see ally-cast-alert.test.js) and for the same underlying reason -
  // buffSource:'ally' on a debuff aura is a plumbing requirement, not a real choice, so showing it
  // as a choice was actively wrong.
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const fn = renderer.match(/const announcer = widget\.displayMode === 'text'[\s\S]*?buffSourceRow\.style\.display =([\s\S]*?);/);
  assert.ok(fn, 'the buffSourceRow visibility rule has been restructured');
  assert.match(fn[1], /!widget\.trackOnEnemies/, 'a debuff aura still shows "Watching: Buffs you\'ve cast on allies"');
});

// ---------------------------------------------------------------------------
// The "Debuff on an enemy" premade - note 16
// ---------------------------------------------------------------------------

test('the premade builds an ally-source aura with the enemy switch already on', () => {
  // An enemy landing goes into the ally list, because "not you" is all the log line says. The
  // point of the premade is that nobody has to know that.
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.createBuffTimer('Mez', { spellName: 'Mesmerize', source: 'enemy' });
  assert.equal(w.buffSource, 'ally');
  assert.equal(w.trackOnEnemies, true);
  assert.deepEqual(w.buffNames, ['Mesmerize']);
  assert.equal(w.buffFilterMode, 'explicit');
});

test('the other two sources do not turn the enemy switch on', () => {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  for (const source of ['self', 'ally', undefined, 'sideways']) {
    const w = store.createBuffTimer('X', { spellName: 'Agility', source });
    assert.equal(w.trackOnEnemies, false, `source=${source} switched enemy tracking on`);
  }
});

test('only spells you actually cast at something offer the enemy option', () => {
  // A heal has third-person landing text and so passes the ally test. Offering "on an enemy" for
  // it would build an aura that never lights up - the same failure note 14 called out.
  const handler = mainSrc.match(/ipcMain\.handle\('buffs:trackable'[\s\S]*?\n\);/);
  assert.ok(handler, 'the trackable-spell list has been restructured');
  assert.match(handler[0], /enemy: hasThirdPersonText && isDetrimental/);
  assert.match(handler[0], /\['debuff', 'charm', 'dot', 'nuke'\]\.includes\(e\.scaleCategory\)/);

  // And the distinction is real, not a filter that passes everything.
  const trackable = roster.filter((e) => e.landingText && String(e.landingText).trim());
  const ally = trackable.filter((e) => e.othersLandingSuffix && String(e.othersLandingSuffix).trim());
  const enemy = ally.filter((e) => ['debuff', 'charm', 'dot', 'nuke'].includes(e.scaleCategory));
  assert.ok(enemy.length > 100, `only ${enemy.length} spells could be watched on an enemy`);
  assert.ok(enemy.length < ally.length, 'every ally-capable spell is enemy-capable - check the categories');
});

test('the enemy option is disabled, with a reason, where it cannot apply', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const fn = renderer.match(/function chooseBuffTimerSpell\(buff\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'chooseBuffTimerSpell has been renamed or restructured');
  assert.match(fn[1], /enemyRadio\.disabled = !buff\.enemy/);
  assert.match(fn[1], /buffTimerEnemyWarning\.textContent =/, 'it disables the option without saying why');
});

test('picking an unsupported spell does not leave a disabled radio selected', () => {
  // Both branches clear their own radio only if it was the one selected. An earlier version reset
  // to "self" unconditionally, so choosing the enemy option and then a spell without ally text
  // silently threw the choice away.
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const fn = renderer.match(/function chooseBuffTimerSpell\(buff\) \{([\s\S]*?)\n {2}\}/)[1];
  assert.match(fn, /if \(enemyRadio\.checked\) \{/);
  assert.match(fn, /if \(allyRadio\.checked\) \{/);
  // And the premade's preference is applied last, once both know whether they are available.
  assert.match(fn, /if \(preferred && !preferred\.disabled\) preferred\.checked = true;/);
});

test('every spell-picking premade shares one panel', () => {
  // The alternative is a second picker over the same 720 spells, which is the thing note 14 was
  // written generically to avoid.
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  assert.match(renderer, /id: 'enemy-debuff',/, 'no Debuff on an enemy entry in the premade list');
  assert.match(renderer, /defaultSource: 'enemy',/);
  // Three now - Buff timer, Cooldown timer and Debuff on an enemy - and that is the point of
  // having built the panel generically. A second picker over the same spells is what note 14 was
  // written to avoid.
  const panels = renderer.match(/panel: 'buff-timer',/g) || [];
  assert.ok(panels.length >= 3, `only ${panels.length} premades share the panel`);
});

test('the third option exists in the markup', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'index.html'), 'utf8');
  assert.match(html, /id="buff-timer-enemy-label"/);
  assert.match(html, /name="buff-timer-source" value="enemy"/);
  assert.match(html, /id="buff-timer-enemy-warning"/);
});

// ---------------------------------------------------------------------------
// Counting identically-named mobs - notes 12 and 18
// ---------------------------------------------------------------------------

test('three mobs with the same name count as three', () => {
  // Shara, 23 August: "2 kobolds should list as x2, when one dies, it should be reduced to x1."
  // The log gives them no separate identity, so the entry holds one expiry per instance.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.');
  for (let i = 0; i < 3; i += 1) feed(e, 'a greater kobold has been mesmerized.');
  assert.equal(e.getActiveAllyBuffs()[0].count, 3);
});

test('each way one can end removes exactly one', () => {
  // Not all of them. The first version filtered instances by value, and because an AoE mez lands
  // on every mob in the same millisecond they all shared a timestamp - so one death wiped the lot.
  for (const ending of [
    'A greater kobold has been slain by Avenrae!',
    'Your Mesmerize spell has worn off of a greater kobold.',
    'A greater kobold has been awakened by Shara.',
  ]) {
    const e = engine(['Mesmerize']);
    feed(e, 'You begin casting Mesmerize.');
    for (let i = 0; i < 3; i += 1) feed(e, 'a greater kobold has been mesmerized.');
    feed(e, ending);
    assert.equal(e.getActiveAllyBuffs()[0].count, 2, `wrong count after: ${ending}`);
  }
});

test('the last one ending clears the tile', () => {
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.');
  feed(e, 'a greater kobold has been mesmerized.');
  feed(e, 'a greater kobold has been mesmerized.');
  feed(e, 'A greater kobold has been slain by Avenrae!');
  feed(e, 'A greater kobold has been slain by Avenrae!');
  assert.deepEqual(names(e), []);
});

test('a buff on a groupmate does not accumulate a count', () => {
  // Re-buffing one person is a refresh, not a second target. Only things cast AT something can
  // have several recipients sharing a name.
  const e = engine(null);
  for (let i = 0; i < 3; i += 1) {
    feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
  }
  const buff = e.getActiveAllyBuffs().find((b) => b.name === 'Spirit of Wolf');
  assert.ok(buff);
  assert.equal(buff.count, 1, 'refreshing a groupmate buff counted it twice');
});

test('the countdown shown is the soonest of them', () => {
  // For a mez the number that matters is when the NEXT one wakes up, not the last.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'a greater kobold has been mesmerized.');
  const entry = [...e.allyBuffs.values()][0];
  entry.instances = [Date.now() + 90000, Date.now() + 5000];
  entry.expiresAt = Math.min(...entry.instances);
  assert.equal(e.getActiveAllyBuffs()[0].remainingSec, 5);

  // The check above sets the instances by hand, so it cannot see the LANDING path picking the
  // wrong one - two mezzes landing in this test land in the same millisecond and every choice
  // looks identical. Pinned at the source instead.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'buffEngine.js'), 'utf8');
  assert.match(src, /expiresAt: Math\.min\(\.\.\.instances\)/, 'a landing takes the last expiry, not the soonest');
  assert.match(src, /entry\.expiresAt = Math\.min\(\.\.\.entry\.instances\)/, 'removing one takes the wrong new soonest');
});

test('a count of one is never shown', () => {
  // Her instruction, and it is enforced in one place rather than at each call site.
  const overlay = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'overlay', 'overlay.js'), 'utf8');
  const fn = overlay.match(/function countFor\(buff\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'countFor has been renamed or restructured');
  assert.match(fn[1], /buff\.count > 1/, 'a count of 1 would be drawn');
  assert.match(fn[1], /return null;/);
});

module.exports = () => report('enemy-debuffs');
if (require.main === module) process.exit(report('enemy-debuffs') ? 1 : 0);
