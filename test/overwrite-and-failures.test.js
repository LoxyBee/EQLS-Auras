'use strict';
/**
 * Note 26 - the stale timer left behind when a buff is replaced - and the failure lines that
 * turned out to be wrong while looking for it.
 *
 * The note assumed this needed a model of EverQuest's buff stacking. It does not. Research into
 * the emulator source confirmed the real rule is per effect SLOT, which the app has no data for
 * and could not compute - but it also turned out not to matter, because the game announces the
 * replacement outright:
 *
 *     Your Shield of Thistles spell on Avenrae has been overwritten.
 *
 * 109 of those in the owner's logs, one shape, no exceptions, naming both the spell and the
 * target. For a buff on YOURSELF there is no line at all - the app relies on the spell's own
 * endedText, which it already handles. Worth knowing: the 112 lines that look like a self
 * wear-off are every one of them "Your pet's <Spell> spell has worn off."
 *
 * The second half is a bug found on the way. FAILURE_PATTERNS was written from memory of
 * EverQuest's wording and NINE OF ITS TWELVE PATTERNS MATCHED NOTHING across 1,521,971 real lines.
 * The game says "Your <Spell> spell fizzles!", not "Your spell fizzles"; "did not take hold", not
 * "would not take hold". Every pattern is now counted against the logs before it goes in.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');
const { matchOverwritten, isFailureLine } = require('../src/main/buffParser');

const ROOT = path.join(__dirname, '..');
const parserSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'buffParser.js'), 'utf8').replace(/\r\n/g, '\n');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function engine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const e = new BuffEngine(new BuffStore(store), store);
  e.stop();
  return e;
}
const feed = (e, ...lines) => lines.forEach((l) => e.handleLine(TS + l));
const allies = (e) => e.getActiveAllyBuffs().map((b) => `${b.allyName}::${b.name}`).sort();

// ---------------------------------------------------------------------------
// The overwrite line
// ---------------------------------------------------------------------------

test('the line is matched, and only in its real shape', () => {
  assert.deepEqual(matchOverwritten(`${TS}Your Shield of Thistles spell on Avenrae has been overwritten.`), {
    spellName: 'Shield of Thistles',
    targetName: 'Avenrae',
  });
  // Real neighbours from the logs that must not be confused with it.
  assert.equal(matchOverwritten(`${TS}Your Shield of Thistles spell has worn off of Avenrae.`), null);
  assert.equal(matchOverwritten(`${TS}Your pet's Burnout spell has worn off.`), null);
  assert.equal(matchOverwritten(`${TS}Your Protection of Rock spell did not take hold on Avenrae.`), null);
});

test('a spell name with a rank numeral survives the match', () => {
  assert.deepEqual(matchOverwritten(`${TS}Your Promised Renewal VII spell on Avenrae has been overwritten.`), {
    spellName: 'Promised Renewal VII',
    targetName: 'Avenrae',
  });
});

test('an overwritten buff stops being tracked', () => {
  // Note 26 itself. Verbatim shapes from the logs.
  const e = engine();
  feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
  assert.deepEqual(allies(e), ['Marrowbane::Spirit of Wolf']);
  feed(e, 'Your Spirit of Wolf spell on Marrowbane has been overwritten.');
  assert.deepEqual(allies(e), [], 'the replaced buff is still counting down');
});

test('it clears only the named spell on the named target', () => {
  const e = engine();
  feed(e, 'You begin casting Spirit of Wolf.', 'Marrowbane is surrounded by a brief lupine aura.');
  feed(e, 'Your Spirit of Wolf spell on Avenrae has been overwritten.');
  assert.deepEqual(allies(e), ['Marrowbane::Spirit of Wolf'], 'the wrong target was cleared');
  feed(e, 'Your Bravery spell on Marrowbane has been overwritten.');
  assert.deepEqual(allies(e), ['Marrowbane::Spirit of Wolf'], 'the wrong spell was cleared');
});

test('an overwrite for something not being tracked does nothing bad', () => {
  const e = engine();
  feed(e, 'Your Bravery spell on Avenrae has been overwritten.');
  assert.deepEqual(allies(e), []);
});

// ---------------------------------------------------------------------------
// A buff on YOURSELF being replaced
// ---------------------------------------------------------------------------

test('a self buff replaced by a better one hands over cleanly', () => {
  // I said twice that this could not be worked out, because Skin like Wood and Skin like Steel
  // both fade with "Your skin returns to normal." and the app could not tell which had ended.
  // That was wrong, and Shara said so. It only matters if BOTH are running at once, and the
  // stacking rule that causes the overwrite is the same rule that prevents that. Whichever one
  // the app is actually holding is the one the fade belongs to.
  //
  // The app never has to decide which spell is "better" either. The game decides and then reports
  // both halves - the old one fading and the new one landing - and following that is enough.
  const e = engine();
  feed(e, 'You begin casting Skin like Wood.', 'Your skin turns hard as wood.');
  assert.deepEqual(e.getActiveBuffs().map((b) => b.name), ['Skin like Wood']);

  feed(e, 'You begin casting Skin like Steel.');
  assert.deepEqual(e.getActiveBuffs().map((b) => b.name), ['Skin like Wood'], 'it went early');

  feed(e, 'Your skin returns to normal.');
  assert.deepEqual(e.getActiveBuffs().map((b) => b.name), [], 'the replaced buff is still counting down');

  feed(e, 'Your skin turns hard as steel.');
  const now = e.getActiveBuffs();
  assert.deepEqual(now.map((b) => b.name), ['Skin like Steel']);
  assert.ok(now[0].remainingSec > 1620, "the new buff inherited the old one's duration");
});

test('the shared fade text is real, and widespread', () => {
  // 90 ended texts are shared by more than one spell, so this is not one awkward pair - it is the
  // normal case, and it works.
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'data', 'buffs.json'), 'utf8'));
  const byText = {};
  for (const entry of roster) {
    if (!entry.endedText) continue;
    (byText[entry.endedText] = byText[entry.endedText] || []).push(entry.name);
  }
  const shared = Object.values(byText).filter((v) => v.length > 1);
  assert.ok(shared.length > 50, `only ${shared.length} shared ended texts - has the roster changed?`);
  const skin = byText['Your skin returns to normal.'] || [];
  assert.ok(skin.includes('Skin like Wood') && skin.includes('Skin like Steel'), 'the worked example is stale');
});

// ---------------------------------------------------------------------------
// The failure patterns, every one counted against the logs
// ---------------------------------------------------------------------------

test('the real failure wordings are caught', () => {
  // Each of these is a verbatim line from the owner's logs, and each was MISSED before.
  for (const line of [
    'Your Spirit of the Puma spell fizzles!',
    'Your Mesmerize spell is interrupted.',
    'Your Protection of Rock spell did not take hold on Avenrae. (Blocked by Bravery.)',
    'Your Protection of Rock spell did not take hold. (Blocked by Bravery.)',
    "Your Selo's Accelerando spell did not take hold on Cavity.",
    'Insufficient Mana to cast this spell!',
  ]) {
    assert.ok(isFailureLine(TS + line), `not recognised as a failure: ${line}`);
  }
});

test('somebody else failing is not your failure', () => {
  // 1,141 of the 1,711 interrupt lines belong to other people, and every fizzle but one does.
  for (const line of [
    "Wambo's Shock of Venom spell fizzles!",
    "Avenrae's Tremor spell is interrupted.",
    "Kylieah's Minor Conjuration: Water spell fizzles!",
  ]) {
    assert.equal(isFailureLine(TS + line), false, `treated as your own failure: ${line}`);
  }
});

test('an ordinary line is not a failure', () => {
  for (const line of [
    'You feel the spirit of wolf enter you.',
    'Orc centurion resisted your Mesmerize!',
    'Your Mesmerize spell has worn off of orc legionnaire.',
  ]) {
    assert.equal(isFailureLine(TS + line), false, `treated as a failure: ${line}`);
  }
});

test('every failure pattern names a spell, or is one exact whole line', () => {
  // The rule that came out of measuring. A pattern that names no spell also fires for things the
  // player was doing other than casting, and cancelling the pending cast then costs a real
  // landing - two spells stopped landing at all when four such patterns were tried.
  const block = parserSrc.match(/const FAILURE_PATTERNS = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'FAILURE_PATTERNS has been restructured');
  const pats = [...block[1].matchAll(/^\s*(\/.*?\/i),/gm)].map((m) => m[1]);
  assert.ok(pats.length >= 4, `only ${pats.length} failure patterns found`);
  for (const p of pats) {
    const namesSpell = p.includes('.+ spell');
    const wholeLine = p.startsWith('/^') && p.includes('$/');
    assert.ok(namesSpell || wholeLine, `${p} is neither spell-named nor anchored to a whole line`);
  }
});

test('no failure pattern is dead against the real logs', () => {
  // The bug this suite exists because of: nine of the twelve original patterns matched nothing at
  // all. A pattern nobody has counted is a pattern nobody knows is working.
  const block = parserSrc.match(/const FAILURE_PATTERNS = \[([\s\S]*?)\n\];/)[1];
  // Regex literals only - a comment line starts with two slashes and carries no count of its own.
  const lines = block.split('\n').filter((l) => /^\s*\/[^/]/.test(l));
  assert.ok(lines.length >= 4, `only ${lines.length} patterns found - has the format changed?`);
  for (const l of lines) {
    assert.match(
      l,
      /\/\/\s*[\d,]+/,
      `this pattern carries no count from the logs, so nobody knows it fires: ${l.trim()}`
    );
  }
});

test('the patterns that were tried and rejected are written down', () => {
  // So the next person does not re-add them, find them plausible, and lose the same two spells.
  assert.match(parserSrc, /DELIBERATELY NOT HERE, having been tried and measured/);
  assert.match(parserSrc, /too far away/);
});

module.exports = () => report('overwrite-and-failures');
if (require.main === module) report('overwrite-and-failures').then((n) => process.exit(n ? 1 : 0));
