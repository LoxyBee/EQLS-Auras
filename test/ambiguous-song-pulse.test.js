'use strict';
/**
 * Layer 2 of the 31 Aug "Psalm of Purity not on the bard song list" report.
 *
 * note-24's pulse check only runs on a landing that already reached _queueAmbiguousCast (spellbook
 * left 2+, or a burst). With the spellbook signal down and no burst, "You feel protected from
 * poison." [Psalm of Purity (song) + Endure Poison (not)] hits the terminal IGNORED branch first.
 *
 * This adds a STANDALONE watch on that branch: an ambiguous self landing about to be IGNORED, if
 * the same text re-lands on the 6s cadence SONG_PULSE_CONFIRM_HITS times and exactly one candidate
 * is a bard song, lands the song - no spellbook, no burst.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

const TS = (h, m, s) => `[Mon Sep 01 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} 2026] `;
const TEXT = 'You feel protected from test poison.';

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  // A song and a plain resist buff that share one landing text - the Psalm/Endure shape.
  buffStore.upsert('Test Psalm of Purity', 30, { landingText: TEXT, endedText: 'Your test psalm fades.' });
  buffStore.upsert('Test Endure Poison', 600, { landingText: TEXT });
  buffStore.markBardSong('Test Psalm of Purity');
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  // spellbook signal DOWN - nothing is "in the book"
  engine.setSpellbookCheckFn(() => false);
  return { engine, buffStore, log };
}

const active = (engine) => engine.getActiveBuffs().map((b) => b.name);

test('one ambiguous landing is still IGNORED - a single sighting is not a pulse', () => {
  const { engine, log } = makeEngine();
  engine.handleLine(TS(19, 31, 0) + TEXT);
  assert.deepEqual(active(engine), []);
  assert.ok(log.some((m) => m.includes('IGNORED') && m.includes(TEXT)));
});

test('three pulses on the 6s cadence land the song, with no spellbook and no burst', () => {
  const { engine, log } = makeEngine();
  // The engine reads Date.now(); rather than sleep 12s, poke the watch entry's lastAt back 6s
  // between hits so each one lands on cadence.
  const rewind = () => {
    const w = engine._songPulseWatch.get(TEXT);
    if (w) w.lastAt -= 6000;
  };
  engine.handleLine(TEXT);            // hit 1 -> watch { hits: 1 }
  assert.equal(active(engine).length, 0);
  rewind();
  engine.handleLine(TEXT);            // hit 2 (on cadence)
  assert.equal(active(engine).length, 0);
  rewind();
  engine.handleLine(TEXT);            // hit 3 -> land
  assert.deepEqual(active(engine), ['Test Psalm of Purity']);
  assert.ok(log.some((m) => m.includes('re-landed on the 6s song cadence')));
});

test('a broken cadence resets the count', () => {
  const { engine } = makeEngine();
  const setGap = (secAgo) => {
    const w = engine._songPulseWatch.get(TEXT);
    if (w) w.lastAt = Date.now() - secAgo * 1000;
  };
  engine.handleLine(TEXT);
  setGap(6); engine.handleLine(TEXT);   // hit 2
  setGap(20); engine.handleLine(TEXT);  // way off cadence -> resets to hit 1
  setGap(6); engine.handleLine(TEXT);   // hit 2 again
  assert.equal(active(engine).length, 0, 'the 20s gap reset it, so this is only the 2nd clean hit');
  setGap(6); engine.handleLine(TEXT);   // hit 3 -> land
  assert.deepEqual(active(engine), ['Test Psalm of Purity']);
});

test('never fires when the candidates are all songs, or none is a song', () => {
  // all songs
  const d1 = {};
  const s1 = { loadJson: (n, f) => (n in d1 ? d1[n] : f), saveJson: (n, v) => { d1[n] = v; } };
  const bs1 = new BuffStore(s1);
  bs1.upsert('Song A', 30, { landingText: TEXT });
  bs1.upsert('Song B', 30, { landingText: TEXT });
  bs1.markBardSong('Song A'); bs1.markBardSong('Song B');
  const e1 = new BuffEngine(bs1, s1); e1.stop(); e1.setSpellbookCheckFn(() => false);
  const rw1 = () => { const w = e1._songPulseWatch.get(TEXT); if (w) w.lastAt -= 6000; };
  e1.handleLine(TEXT); rw1(); e1.handleLine(TEXT); rw1(); e1.handleLine(TEXT);
  assert.equal(e1.getActiveBuffs().length, 0, 'two songs - the pulse cannot say which');

  // no song
  const d2 = {};
  const s2 = { loadJson: (n, f) => (n in d2 ? d2[n] : f), saveJson: (n, v) => { d2[n] = v; } };
  const bs2 = new BuffStore(s2);
  bs2.upsert('Buff A', 30, { landingText: TEXT });
  bs2.upsert('Buff B', 30, { landingText: TEXT });
  const e2 = new BuffEngine(bs2, s2); e2.stop(); e2.setSpellbookCheckFn(() => false);
  const rw2 = () => { const w = e2._songPulseWatch.get(TEXT); if (w) w.lastAt -= 6000; };
  e2.handleLine(TEXT); rw2(); e2.handleLine(TEXT); rw2(); e2.handleLine(TEXT);
  assert.equal(e2.getActiveBuffs().length, 0, 'no song among the candidates');
});

module.exports = () => report('ambiguous-song-pulse');
if (require.main === module) report('ambiguous-song-pulse').then((n) => process.exit(n ? 1 : 0));
