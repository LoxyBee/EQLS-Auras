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
  // Verbatim from eqlog_Vaela_rivervale_2026-08-19.txt.
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
  for (const death of ['Orc legionnaire has been slain by Baxa!', 'You have slain orc legionnaire!']) {
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
  feed(e, 'Orc legionnaire has been awakened by Vaela.');
  assert.deepEqual(names(e), []);
});

test('a break only clears a mez, not everything on that mob', () => {
  // "awakened" does not name a spell, so it can only be trusted to end the thing it describes.
  // A charm or a snare on the same mob is still running.
  const e = engine(['Mesmerize', 'Charm']);
  feed(e, 'You begin casting Charm.', 'orc legionnaire has been charmed.');
  feed(e, 'Orc legionnaire has been awakened by Vaela.');
  assert.deepEqual(names(e), ['orc legionnaire::Charm']);
});

test('an ending line for one mob leaves another mob alone', () => {
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'orc legionnaire has been mesmerized.');
  feed(e, 'You begin casting Mesmerize.', 'a sonic bat has been mesmerized.');
  feed(e, 'Orc legionnaire has been slain by Baxa!');
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
  feed(e, 'Marrowbane has been slain by a gnoll!', 'Marrowbane has been awakened by Vaela.');
  assert.deepEqual(names(e), before, 'a groupmate dying cleared their buffs');
});

test('a line naming the spell AND the target does clear an ally buff', () => {
  // Note 26, and the deliberate change of mind. This was scoped to enemies only when enemy
  // tracking went in, to avoid altering anything nobody had asked about. Vaela has since asked
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
  feed(e, 'Your Spirit of Wolf spell on Baxa has been overwritten.');
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
  assert.equal(matchSlain(`${TS}Orc centurion has been slain by Baxa!`), 'Orc centurion');
  assert.equal(matchSlain(`${TS}You have slain orc legionnaire!`), 'orc legionnaire');
  assert.equal(matchAwakened(`${TS}A worry wraith has been awakened by Vaela.`), 'A worry wraith');

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
  // Rewritten 25 Aug for the additive settings-panel model: widgetShape() gives a
  // trackOnEnemies:true aura its own shape ('custom-debuff'), so it's SHAPE_FIELDS' job to leave
  // 'buff-source' out of that shape's list, rather than a live boolean hiding a row built for it.
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const shapeFn = renderer.match(/function widgetShape\(widget\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(shapeFn, 'widgetShape has been restructured');
  assert.match(shapeFn[1], /if \(widget\.trackOnEnemies\) return 'custom-debuff';/, 'trackOnEnemies no longer gets its own shape');
  const tableFn = renderer.match(/const SHAPE_FIELDS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(tableFn, 'SHAPE_FIELDS has been renamed or restructured');
  assert.doesNotMatch(
    tableFn[1],
    /'custom-debuff': \[[^\]]*'buff-source'/,
    'a debuff aura still shows "Watching: Buffs you\'ve cast on allies"'
  );
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
  // After every "On:" option's disabled state is set for this spell, one pass re-checks exactly
  // the picked radio - the premade's preferred option if this spell allows it, otherwise the first
  // enabled one (self > enemy > ally). So a disabled radio can never stay selected, whichever
  // combination of self/ally/enemy this spell supports (Affliction supports enemy only).
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const fn = renderer.match(/function chooseBuffTimerSpell\(buff\) \{([\s\S]*?)\n {2}\}/)[1];
  assert.match(fn, /const wanted = radioFor\(buffTimerPreferredSource\)/);
  assert.match(fn, /wanted && !wanted\.disabled\s*\?\s*wanted/, 'the premade preference is honoured when it is available');
  assert.match(fn, /order\.map\(radioFor\)\.find\(\(r\) => r && !r\.disabled\)/, 'no fallback to the first enabled option');
  assert.match(fn, /r\.checked = r === pick/, 'the picked radio is not the only one set - others could stay checked');
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
// One tile per enemy debuff key - notes 12 and 18 scrapped 24 August
// ---------------------------------------------------------------------------
//
// Notes 12/18 originally counted identically-named mobs sharing one key as separate instances
// ("a greater kobold" x2, x3...), since the log gives them no other identity. Reported live 24
// Aug: chain-mezzing a single target before it wakes (the normal way to hold CC on a mob) hits
// that same key exactly the way a second, genuinely different mob would, so the count climbed on
// what was really only ever one mezzed target. Vaela: "scrap multi tile combining for aoe debuffs
// for now. count just the duration, refreshed on a new cast. single tile." So a second landing
// under the same key is a refresh, exactly like a buff on a groupmate always was - no count, no
// instances array, one tile, its duration reset to whatever the new landing carries.

test('a second landing on the same key refreshes the one tile rather than adding a second', () => {
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.');
  feed(e, 'a greater kobold has been mesmerized.');
  feed(e, 'You begin casting Mesmerize.');
  feed(e, 'a greater kobold has been mesmerized.');
  assert.equal(e.getActiveAllyBuffs().length, 1, 'a recast under the same key must not create a second tile');
  assert.equal(names(e).length, 1);
});

test('the refreshed tile carries the new landing\'s duration, not the old one', () => {
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'a greater kobold has been mesmerized.');
  const first = e.getActiveAllyBuffs()[0];
  const oldExpiry = [...e.allyBuffs.values()][0].expiresAt;
  // Force the existing entry to look like it's about to expire, then recast - the refreshed
  // entry's expiry must move, proving the new landing actually overwrote it rather than being a
  // no-op against an existing key.
  [...e.allyBuffs.values()][0].expiresAt = Date.now() + 1000;
  feed(e, 'You begin casting Mesmerize.', 'a greater kobold has been mesmerized.');
  const after = [...e.allyBuffs.values()][0].expiresAt;
  assert.ok(after > Date.now() + 1000, 'a recast landing did not refresh the duration');
  assert.equal(first.name, 'Mesmerize');
  void oldExpiry;
});

test('any of the three ending lines clears the tile outright - there is only ever one', () => {
  for (const ending of [
    'A greater kobold has been slain by Baxa!',
    'Your Mesmerize spell has worn off of a greater kobold.',
    'A greater kobold has been awakened by Vaela.',
  ]) {
    const e = engine(['Mesmerize']);
    feed(e, 'You begin casting Mesmerize.', 'a greater kobold has been mesmerized.');
    feed(e, ending);
    assert.deepEqual(names(e), [], `tile survived: ${ending}`);
  }
});

test('a buff on a groupmate still refreshes rather than stacking', () => {
  // Unchanged behavior - a groupmate always had one recipient by definition, and this is now the
  // same rule an enemy debuff follows too.
  const e = engine(null);
  for (let i = 0; i < 3; i += 1) {
    feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
  }
  const matches = e.getActiveAllyBuffs().filter((b) => b.name === 'Spirit of Wolf');
  assert.equal(matches.length, 1, 're-casting a groupmate buff created a second tile');
});

test('no count field survives on an enemy debuff, and no x2 badge can be drawn for one', () => {
  // The instances/count mechanism is gone at the source, not just hidden - a stale "count" field
  // left on the engine's output would be a trap for the next thing that reads it.
  const e = engine(['Mesmerize']);
  feed(e, 'You begin casting Mesmerize.', 'a greater kobold has been mesmerized.');
  assert.equal('count' in e.getActiveAllyBuffs()[0], false);

  const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'buffEngine.js'), 'utf8');
  assert.doesNotMatch(src, /\.instances\b/, 'the scrapped instances field is still read or written in buffEngine.js');

  const overlay = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'overlay', 'overlay.js'), 'utf8');
  const fn = overlay.match(/function countFor\(buff\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'countFor has been renamed or restructured');
  assert.doesNotMatch(fn[1], /buff\.count/, 'the scrapped per-mob count is still read by the overlay');
});

// ---------------------------------------------------------------------------
// Note 40 - the "Watching: cast by an ally" mode. Same debuff, same enemy,
// same countdown as everything above, but tracked the moment its
// third-person landing text appears, with no requirement at all that the
// player be the one who cast it. Vaela's words: "just have it tracked that a
// debuff happened from someone, it doesn't need a name" - so unlike the
// ally-buff tiers this never records who cast it.
// ---------------------------------------------------------------------------

// allyWatching: spells opted into "ally" mode - tracked with no self-cast evidence at all.
function engineAlly(allyWatching, selfWatching) {
  const store = memory();
  const e = new BuffEngine(new BuffStore(store), store);
  e.stop();
  if (allyWatching) {
    const set = new Set(allyWatching.map((s) => s.toLowerCase()));
    e.setAllyEnemyDebuffNamesFn(() => set);
  }
  if (selfWatching) {
    const set = new Set(selfWatching.map((s) => s.toLowerCase()));
    e.setEnemyDebuffNamesFn(() => set);
  }
  return e;
}

test('ally mode lands a debuff with no self-cast evidence at all', () => {
  // The whole point of the mode: no "You begin casting" line precedes this, nothing else has
  // named the spell, and it still lands.
  const e = engineAlly(['Mesmerize']);
  feed(e, 'a greater kobold has been mesmerized.');
  assert.deepEqual(names(e), ['a greater kobold::Mesmerize']);
});

test('ally mode still needs the mob-name relaxation, same as self mode', () => {
  // A multi-word mob name only ever passes _isValidRecipient once _isWatchedOnEnemies says yes for
  // that spell - proving the ally-mode set feeds that same check, not a separate unbounded one.
  const e = engineAlly(['Mesmerize']);
  feed(e, 'a greater kobold has been mesmerized.');
  assert.deepEqual(names(e), ['a greater kobold::Mesmerize'], 'a real mob name should have landed');
});

test('ally mode does not admit a spell nobody opted into', () => {
  const e = engineAlly(['Mesmerize']);
  feed(e, 'a greater kobold has been charmed.');
  assert.deepEqual(names(e), []);
});

test('self mode and ally mode are independent - opting a spell into one does not opt it into the other', () => {
  // Mesmerize in ally mode only: a self-mode-only spell watcher would never see it, and it must
  // still land here with no self-cast evidence.
  const allyOnly = engineAlly(['Mesmerize'], null);
  feed(allyOnly, 'a greater kobold has been mesmerized.');
  assert.deepEqual(names(allyOnly), ['a greater kobold::Mesmerize'], 'ally-mode spell did not land in ally mode');

  // Charm in self mode only: with no self-cast evidence at all, it must NOT land just because a
  // different spell is watched in ally mode.
  const selfOnly = engineAlly(['Mesmerize'], ['Charm']);
  feed(selfOnly, 'orc legionnaire has been charmed.');
  assert.deepEqual(names(selfOnly), [], 'self-mode spell landed without any self-cast evidence');
});

test('ally mode caster identity is never captured - only that it landed', () => {
  const e = engineAlly(['Mesmerize']);
  feed(e, 'a greater kobold has been mesmerized.');
  const entry = [...e.allyBuffs.values()][0];
  assert.equal(entry.allyName, 'a greater kobold', 'names only the recipient, same as every other ally-buff entry');
  assert.ok(!('casterName' in entry) && !('castBy' in entry), 'no caster field was ever added to the entry');
});

test('the watching-toggle setting exists, defaults to self, and is shareable', () => {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.createDebuff('Mez');
  assert.equal(w.debuffCastBy, 'self', 'must default to the original self-cast behaviour');
  assert.match(storeSrc, /'debuffCastBy',/, 'not in SHAREABLE_FIELDS, so a share code would drop it');
});

test('getAllyEnemyDebuffNames and getEnemyDebuffNames are mutually exclusive by the toggle', () => {
  const selfFn = managerSrc.match(/function getEnemyDebuffNames\(\) \{([\s\S]*?)\n\}/);
  const allyFn = managerSrc.match(/function getAllyEnemyDebuffNames\(\) \{([\s\S]*?)\n\}/);
  assert.ok(selfFn, 'getEnemyDebuffNames has been renamed or restructured');
  assert.ok(allyFn, 'getAllyEnemyDebuffNames is missing');
  assert.match(selfFn[1], /debuffCastBy === 'ally'\) continue;/, "self-mode list must skip auras switched to ally mode");
  assert.match(allyFn[1], /debuffCastBy !== 'ally'\) continue;/, "ally-mode list must skip everything but ally mode");
});

test('the engine is given the ally-mode list at startup too', () => {
  assert.match(
    mainSrc,
    /buffEngine\.setAllyEnemyDebuffNamesFn\(\(\) => widgetManager\.getAllyEnemyDebuffNames\(\)\)/
  );
});

module.exports = () => report('enemy-debuffs');
if (require.main === module) report('enemy-debuffs').then((n) => process.exit(n ? 1 : 0));
