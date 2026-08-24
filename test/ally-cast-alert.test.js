'use strict';
/**
 * "Someone else cast a mez" - note 16's last open question, answered by Shara on 21 August.
 *
 * I had put two options to her: show an ally's debuff without a countdown, or not at all. She
 * chose a third and better one - make it a warning rather than a tracker. Her words: "a text
 * alert to be careful, and not a standalone timer that may be inaccurate."
 *
 * That sidesteps the thing that made the feature half-broken. The game prints no line when
 * somebody else's debuff ends - one of her logs has 14 mez landings and zero wear-off lines,
 * because all 14 were a groupmate's - so any duration shown for one would have been invented.
 * A warning has no duration to be wrong about.
 *
 * Two decisions in here are mine and are worth arguing with if they are wrong:
 *
 * It fires on the CAST line, not the landing. That costs a false warning when a cast is resisted
 * or interrupted, about one in ten. It buys roughly two seconds of notice - 96% of landings in
 * her logs arrive exactly two seconds after the cast - and for a warning whose job is "do not
 * break this mez", arriving before it lands is the entire point.
 *
 * It names the caster instead of saying "a party member". Half the third-person mez and charm
 * casts in her logs are mobs, and gating on the group roster would make the feature silently dead
 * whenever the app starts mid-session, which was already a bug in this engine once.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const engineSrc = read('src', 'main', 'buffEngine.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const mainSrc = read('src', 'main', 'main.js');
const storeSrc = read('src', 'main', 'widgetStore.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const preloadSrc = read('src', 'preload', 'preload-main.js');

const TS = '[Mon Aug 10 17:11:05 2026] ';

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// watching: spells some aura asked to be warned about, or null for "nobody asked" - the state
// every existing install is in.
function engine(watching) {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const e = new BuffEngine(new BuffStore(store), store);
  e.stop();
  if (watching) {
    const set = new Set(watching.map((s) => s.toLowerCase()));
    e.setAllyDebuffAlertNamesFn(() => set);
  }
  return e;
}

const feed = (e, ...lines) => lines.forEach((l) => e.handleLine(TS + l));
const alerts = (e) => e.getActiveAllyBuffs().filter((b) => b.allyCast).map((b) => `${b.allyName}::${b.name}`);

// The overlay's textFor, reproduced. Kept in step by the test at the bottom, which fails if the
// real one stops substituting.
function renderText(config, buff) {
  const message = (config.textAuraMessage || '').trim();
  if (!message) return buff.name;
  if (!message.includes('{')) return message;
  return message
    .replace(/\{caster\}/g, buff.allyName || '')
    .replace(/\{spell\}/g, buff.name || '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Nothing changes for anyone who has not asked
// ---------------------------------------------------------------------------

test('with nothing opted in, a groupmate casting mez does nothing', () => {
  const e = engine(null);
  feed(e, 'Lumbarin begins casting Mesmerization VII.', 'Avenrae begins casting Charm.');
  assert.deepEqual(alerts(e), []);
});

test('opting into one spell does not warn about another', () => {
  const e = engine(['Mesmerization']);
  feed(e, 'Avenrae begins casting Charm.');
  assert.deepEqual(alerts(e), []);
});

test('a third-person cast still feeds the disambiguation it always did', () => {
  // The alert is bolted onto a line the engine already read for another purpose. If it swallowed
  // the line, or returned early past it, rival-caster tracking would silently stop working.
  const e = engine(['Mesmerization']);
  feed(e, 'Lumbarin begins casting Mesmerization VII.');
  assert.equal(e._recentOtherCaster('Mesmerization VII'), 'Lumbarin');
});

// ---------------------------------------------------------------------------
// What it warns about
// ---------------------------------------------------------------------------

test('the ranks her groupmates actually cast all match the base spell', () => {
  // This is the one that decides whether the feature works at all for her. She picks
  // "Mesmerization" from the buff list, because that is the roster entry. Her groupmates cast
  // "Mesmerization VII" and "Mesmerization VI". Matching only the literal string would mean
  // picking the spell and never once being warned.
  const e = engine(['Mesmerization']);
  feed(e,
    'Lumbarin begins casting Mesmerization VII.',
    'Jeeve begins casting Mesmerization VI.',
    'Eriador begins casting Mesmerization V.',
    'Mynthi Davissi begins casting Mesmerization.');
  assert.deepEqual(alerts(e).sort(), [
    'Eriador::Mesmerization V',
    'Jeeve::Mesmerization VI',
    'Lumbarin::Mesmerization VII',
    'Mynthi Davissi::Mesmerization',
  ]);
});

test('the rank is kept in what it says, not stripped', () => {
  // Matching is rank-insensitive; display is not. Which rank was cast is exactly the interesting
  // part, and it is the only place the app ever learns it.
  const e = engine(['Mesmerization']);
  feed(e, 'Lumbarin begins casting Mesmerization VII.');
  assert.equal(e.getActiveAllyBuffs()[0].name, 'Mesmerization VII');
});

test('a sung debuff warns too', () => {
  // "begins singing" is a second cast verb, 215 lines in her logs. A bard debuff never says
  // "casting", so a matcher anchored on that word alone would miss every one of them.
  const e = engine(["Denon's Disruptive Discord"]);
  feed(e, "Lumbarin begins singing Denon's Disruptive Discord.");
  assert.deepEqual(alerts(e), ["Lumbarin::Denon's Disruptive Discord"]);
});

test('her own cast never warns her', () => {
  // "You begin casting X." is a different line shape from "<Name> begins casting X." - but this is
  // the single most obvious way for the feature to become useless noise, so it is pinned.
  const e = engine(['Mesmerize', 'Mesmerization']);
  feed(e, 'You begin casting Mesmerize.');
  assert.deepEqual(alerts(e), []);
});

test('a mob casting it is named, not called a party member', () => {
  // Verbatim from her logs, and not an edge case: "A Teir`Dal ranger" casts Mesmerization 13
  // times, "A negotiator" 6. A message claiming "a party member has cast" would be wrong about
  // half the time it fired.
  const e = engine(['Mesmerization', 'Cajoling Whispers']);
  feed(e, 'A Teir`Dal ranger begins casting Mesmerization.', 'A worry wraith begins casting Cajoling Whispers.');
  assert.deepEqual(alerts(e).sort(), ['A Teir`Dal ranger::Mesmerization', 'A worry wraith::Cajoling Whispers']);
});

test('two people casting the same thing are two warnings, and a recast is one', () => {
  const e = engine(['Mesmerization']);
  feed(e, 'Lumbarin begins casting Mesmerization VII.', 'Jeeve begins casting Mesmerization VII.');
  assert.equal(alerts(e).length, 2, 'one warning replaced the other');
  const before = e.getActiveAllyBuffs().find((b) => b.allyName === 'Lumbarin').landedAt;
  feed(e, 'Lumbarin begins casting Mesmerization VII.');
  assert.equal(alerts(e).length, 2, 'a recast by the same person stacked instead of replacing');
  const after = e.getActiveAllyBuffs().find((b) => b.allyName === 'Lumbarin').landedAt;
  assert.ok(after >= before, 'a recast must refresh the warning, or it will not re-show');
});

// ---------------------------------------------------------------------------
// It is a warning, not a timer - her actual requirement
// ---------------------------------------------------------------------------

test('it carries no countdown, and cannot', () => {
  // The whole point of her answer. An instant has no remaining time by construction, so there is
  // no number here to be wrong.
  const e = engine(['Charm']);
  feed(e, 'Avenrae begins casting Charm.');
  const b = e.getActiveAllyBuffs()[0];
  assert.equal(b.remainingSec, null, 'a warning must not show a countdown');
  assert.equal(b.instant, true);
  assert.equal(b.allyCast, true);
});

test('it is not marked as a debuff sitting on an enemy', () => {
  // The name on this entry is the CASTER, not a target. Marking it onEnemy would put a person's
  // name into a list of things being debuffed, and would drag it into the wrong aura's filter.
  const e = engine(['Mesmerization']);
  feed(e, 'Lumbarin begins casting Mesmerization VII.');
  assert.equal(e.getActiveAllyBuffs()[0].onEnemy, false);
});

test('an aura that did not ask for warnings never draws them, and an alert aura draws ONLY warnings', () => {
  // A strict partition, not a one-way filter. The one-way version - strip alerts from an aura
  // that did not ask for them, and leave everything else alone - let an alert aura (buffSource
  // 'ally', buffNames full of mez/charm names) also show a REAL ally-buff landing for one of
  // those names, if the owner genuinely cast one on a groupmate. Reported as "it's tracking
  // buffs you've cast on allies" - the alert aura was never meant to show landings at all.
  assert.match(
    overlaySrc,
    /filtered = filtered\.filter\(\(b\) => !!b\.allyCast === !!currentConfig\.allyDebuffAlert\);/
  );
});

test('a countdown aura would drop it even if the filter were removed', () => {
  // Belt and braces, and it is her rule from the instants work: something that happens rather
  // than something that runs belongs only on sound and text auras. The instant filter already
  // enforces that, so a warning can never appear as a tile with a timer on it.
  assert.match(overlaySrc, /if \(drawsCountdowns\) \{\s*\n\s*filtered = filtered\.filter\(\(b\) => !b\.instant\);/);
});

// ---------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------

test('the message names who cast what', () => {
  const store = newStore();
  const w = store.createTextAura('Ally mez', { preset: 'allyCast' });
  const e = engine(['Mesmerization']);
  feed(e, 'Lumbarin begins casting Mesmerization VII.');
  assert.equal(renderText(w, e.getActiveAllyBuffs()[0]), 'Lumbarin cast Mesmerization VII - careful');
});

test('a message with no tokens is left exactly as written', () => {
  const buff = { allyName: 'Lumbarin', name: 'Mesmerization VII' };
  assert.equal(renderText({ textAuraMessage: 'DISPELLED' }, buff), 'DISPELLED');
});

test('the overlay really does substitute, and not just this test', () => {
  const fn = overlaySrc.match(/function textFor\(buff\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'textFor has been renamed or restructured');
  // The braces are escaped in the source (they sit inside a regex literal), so match the token
  // names rather than the rendered form.
  assert.match(fn[1], /caster/);
  assert.match(fn[1], /spell/);
  assert.match(fn[1], /buff\.allyName/);
  assert.match(fn[1], /buff\.name/);
});

// ---------------------------------------------------------------------------
// The premade and the toggle
// ---------------------------------------------------------------------------

test('the premade ships watching the mez and charm family', () => {
  const store = newStore();
  const w = store.createTextAura('Ally mez', { preset: 'allyCast' });
  assert.equal(w.displayMode, 'text');
  assert.equal(w.allyDebuffAlert, true);
  assert.equal(w.buffSource, 'ally');
  assert.equal(w.buffFilterMode, 'explicit');
  for (const spell of ['Mesmerize', 'Mesmerization', 'Charm', 'Allure', 'Beguile']) {
    assert.ok(w.buffNames.includes(spell), `the premade does not watch ${spell}`);
  }
});

test('the warning dwells longer than the six-second default', () => {
  // A warning about something still true in a few seconds, not a flash confirming something over.
  const store = newStore();
  assert.ok(store.createTextAura('x', { preset: 'allyCast' }).textAuraInstantSec > 6);
});

test('the setting is off by default and survives a share code', () => {
  const store = newStore();
  assert.equal(store.create('plain').allyDebuffAlert, false);
  assert.match(storeSrc, /'allyDebuffAlert',/, 'not in SHAREABLE_FIELDS, so sharing the aura drops it');
});

test('the toggle is reachable end to end', () => {
  assert.match(html, /id="widget-ally-alert-checkbox"/, 'no checkbox');
  assert.match(rendererSrc, /allyAlertCheckbox\.addEventListener\('change'/, 'nothing listens to it');
  assert.match(rendererSrc, /allyAlertCheckbox\.checked = !!widget\.allyDebuffAlert;/, 'never shows its saved state');
  assert.match(preloadSrc, /setWidgetAllyDebuffAlert:/, 'no bridge');
  assert.match(mainSrc, /ipcMain\.handle\('widget:setAllyDebuffAlert'/, 'no handler');
  assert.match(managerSrc, /function setAllyDebuffAlert\(id, enabled\)/, 'no manager function');
  assert.match(managerSrc, /^ {2}setAllyDebuffAlert,$/m, 'not exported');
  assert.match(mainSrc, /buffEngine\.setAllyDebuffAlertNamesFn\(/, 'the engine is never told what to watch');
});

test('the toggle appears only on a text aura', () => {
  // Her wording: "a toggle under text only custom creation". A tile aura has nothing to draw for
  // a warning with no duration.
  assert.match(rendererSrc, /allyAlertRowEl\.style\.display = isTextAura \? '' : 'none';/);
  assert.match(rendererSrc, /allyAlertHintEl\.style\.display = isTextAura \? '' : 'none';/);
});

test('only auras that asked are sent to the engine', () => {
  const fn = managerSrc.match(/function getAllyDebuffAlertNames\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'getAllyDebuffAlertNames has been renamed or restructured');
  assert.match(fn[1], /if \(!config\.allyDebuffAlert\) continue;/);
  assert.match(fn[1], /toLowerCase\(\)/, 'the engine lowercases its lookup, so the set must be too');
});

test('the reasoning for firing on the cast line is written down', () => {
  // Not decoration. It is a deliberate trade - a false warning on a resist, in exchange for two
  // seconds of notice - and the next person to read this will otherwise "fix" it to the landing.
  // The METHOD, not the call site above it - indexOf finds the call first, and the text before
  // that is unrelated code.
  const at = engineSrc.indexOf('  _alertAllyCast(otherCast) {');
  assert.notEqual(at, -1, '_alertAllyCast has been renamed or restructured');
  const comment = engineSrc.slice(Math.max(0, at - 1800), at);
  assert.match(comment, /two seconds/i, 'the timing trade is not explained');
  assert.match(comment, /group|party/i, 'why it does not filter to the group is not explained');
});

module.exports = () => report('ally-cast-alert');
if (require.main === module) process.exit(report('ally-cast-alert') ? 1 : 0);
