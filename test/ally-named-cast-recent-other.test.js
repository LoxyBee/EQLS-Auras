'use strict';
/**
 * Live bug (owner, Sep 1 20:30, found by Log Scanner): she cast Spirit of the Puma on Orlando;
 * Ally Buffs showed it on Chrysaetos, and her real cast (which failed on Orlando 1s later) showed
 * nothing. Chrysaetos self-cast his OWN Spirit of the Puma 2s earlier, and
 * "Chrysaetos growls with the spirit of the puma." (his landing on himself) was attributed to her
 * pending cast.
 *
 * The "ALLY LANDED ... named cast, confirmed by third-person landing text" path never checked
 * recentOtherCasts. The burst-context ally path already had that skip. It now does too - via a
 * LOCAL rank-aware check (_allySelfCastRecently), because recentOtherCasts is keyed by the raw
 * cast-line name and keying it rank-stripped globally regressed the player's own maintained bard
 * songs (a groupmate singing "Selo's ... VI" would suppress her own Selo's re-lands).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

const TS = (s) => `[Mon Sep 01 20:30:${String(s).padStart(2, '0')} 2026] `;

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const engine = new BuffEngine(new BuffStore(store), store);
  engine.stop();
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  engine.setTrackOthersEnabled(true);
  return { engine, log };
}
const allyBuffs = (engine) => engine.getActiveAllyBuffs().map((b) => `${b.name}@${b.allyName}`);

test("a groupmate's own RANKED self-cast is not attributed to her pending cast on someone else", () => {
  const { engine, log } = makeEngine();
  engine.handleLine(`${TS(7)}Chrysaetos begins casting Spirit of the Puma VIII.`);
  engine.handleLine(`${TS(9)}You begin casting Spirit of the Puma VII.`);
  engine.handleLine(`${TS(9)}Chrysaetos growls with the spirit of the puma.`);

  assert.ok(!allyBuffs(engine).some((s) => s.startsWith('Spirit of the Puma@Chrysaetos')),
    'his own self-cast landing was grabbed for her cast');
  assert.ok(log.some((m) => /ALLY IGNORED "Spirit of the Puma" on "Chrysaetos"[\s\S]*just seen self-casting/.test(m)));
});

test('her cast landing on the ACTUAL target still registers', () => {
  const { engine } = makeEngine();
  engine.handleLine(`${TS(7)}Chrysaetos begins casting Spirit of the Puma VIII.`);
  engine.handleLine(`${TS(9)}You begin casting Spirit of the Puma VII.`);
  engine.handleLine(`${TS(9)}Orlando growls with the spirit of the puma.`);
  assert.ok(allyBuffs(engine).some((s) => s.startsWith('Spirit of the Puma@Orlando')),
    'a genuine ally-cast on her real target must still land');
});

test('the skip is bounded - a groupmate cast >60s ago no longer suppresses', () => {
  const { engine } = makeEngine();
  engine.handleLine(`${TS(7)}Chrysaetos begins casting Spirit of the Puma VIII.`);
  // age the stored other-cast past the 60s window
  for (const k of engine.recentOtherCastAt.keys()) engine.recentOtherCastAt.set(k, Date.now() - 120000);
  engine.handleLine(`${TS(9)}You begin casting Spirit of the Puma VII.`);
  engine.handleLine(`${TS(9)}Chrysaetos growls with the spirit of the puma.`);
  assert.ok(allyBuffs(engine).some((s) => s.startsWith('Spirit of the Puma@Chrysaetos')));
});

test('re-casting a non-song buff on an ally who cast it ~30s ago still refreshes their tile', () => {
  // Reported live (3 Sep): Jarlaxle (a shaman) cast Spirit of the Puma once; for the next 60s
  // every re-cast Shara landed on him was IGNORED as "Jarlaxle just self-cast it" and his aura
  // tile stopped updating. A non-song buff lands once within its cast time - a landing 30s after
  // the ally's cast is a fresh application by whoever just cast, which is the player.
  const { engine, log } = makeEngine();
  engine.handleLine(`${TS(0)}Jarlaxle begins casting Spirit of the Puma VIII.`);
  for (const k of engine.recentOtherCastAt.keys()) engine.recentOtherCastAt.set(k, Date.now() - 30000);
  engine.handleLine(`${TS(30)}You begin casting Spirit of the Puma VII.`);
  engine.handleLine(`${TS(31)}Jarlaxle growls with the spirit of the puma.`);
  assert.ok(
    allyBuffs(engine).some((s) => s.startsWith('Spirit of the Puma@Jarlaxle')),
    'the re-cast on Jarlaxle should land and refresh his tile'
  );
  assert.ok(!log.some((m) => /ALLY IGNORED "Spirit of the Puma" on "Jarlaxle"/.test(m)));
});

test('the window is short for a non-song buff, full 60s for a bard song', () => {
  const { engine } = makeEngine();
  engine.handleLine(`${TS(0)}Chrysaetos begins casting Spirit of the Puma VIII.`);
  const key = 'spirit of the puma viii';
  engine.recentOtherCastAt.set(key, Date.now() - 30000); // 30s ago

  // Non-song: 30s is past the one-cast window - not "their landing" any more.
  assert.equal(engine._allySelfCastRecently('Spirit of the Puma', 'Chrysaetos', false), false);
  // Song: their single cast still explains a pulse 30s later.
  assert.equal(engine._allySelfCastRecently('Spirit of the Puma', 'Chrysaetos', true), true);
});

test('a DIFFERENT groupmate casting it does not suppress the real recipient', () => {
  const { engine } = makeEngine();
  engine.handleLine(`${TS(7)}Chrysaetos begins casting Spirit of the Puma VIII.`);
  engine.handleLine(`${TS(9)}You begin casting Spirit of the Puma VII.`);
  // Horse got hers - Horse never self-cast, so this is her cast landing on Horse
  engine.handleLine(`${TS(9)}Horse growls with the spirit of the puma.`);
  assert.ok(allyBuffs(engine).some((s) => s.startsWith('Spirit of the Puma@Horse')));
});

test('recentOtherCasts is still keyed RAW (rank kept) - the global keying was not changed', () => {
  const { engine } = makeEngine();
  engine.handleLine(`${TS(7)}Chrysaetos begins casting Spirit of the Puma VIII.`);
  assert.ok(engine.recentOtherCasts.has('spirit of the puma viii'), 'the raw key is gone');
  assert.ok(!engine.recentOtherCasts.has('spirit of the puma'), 'a rank-stripped key was added globally - that regressed maintained songs');
  // but the local rank-aware check still finds it
  assert.equal(engine._allySelfCastRecently('Spirit of the Puma', 'Chrysaetos'), true);
  assert.equal(engine._allySelfCastRecently('Spirit of the Puma', 'Someone Else'), false);
});

test('the IGNORE branch consumes the line - it does not fall through and pollute recentOtherCasts with an unranked key', () => {
  const { engine, log } = makeEngine();
  engine.handleLine(`${TS(7)}Chrysaetos begins casting Spirit of the Puma VIII.`);
  engine.handleLine(`${TS(9)}You begin casting Spirit of the Puma VII.`);
  engine.handleLine(`${TS(9)}Chrysaetos growls with the spirit of the puma.`);
  assert.ok(log.some((m) => /ALLY IGNORED "Spirit of the Puma" on "Chrysaetos"/.test(m)));
  // Falling through to the "unexplained third-person" recorder (further down handleLine) would
  // set recentOtherCasts['spirit of the puma'] (rank-stripped) - the exact key shape that
  // regressed the player's own maintained songs. The raw ranked key is fine; the bare one is not.
  assert.ok(!engine.recentOtherCasts.has('spirit of the puma'),
    'the IGNORE branch fell through and a rank-stripped key leaked into recentOtherCasts');
});

module.exports = () => report('ally-named-cast-recent-other');
if (require.main === module) report('ally-named-cast-recent-other').then((n) => process.exit(n ? 1 : 0));
