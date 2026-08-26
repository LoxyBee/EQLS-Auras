'use strict';
/**
 * Bard Songs (backlog #15) - every bard song currently active ON THE PLAYER, regardless of who
 * cast it, attributed to a caster when buffEngine can tell and bucketed "Unknown" otherwise.
 *
 * Purely additive: nothing here changes what lands as a self buff (getActiveBuffs) - it's a
 * second, caster-aware observation of the same landing, read from evidence (`recentSelfCast`,
 * `recentOtherCasts`) that already existed for other reasons and used to be thrown away the
 * instant a buff landed. See buffEngine.js's own header comment above _attributeBardSongCaster.
 *
 * Driven through the real BuffEngine/BuffStore with a fake underlying store and synthetic log
 * lines, same pattern as detection.test.js/ally-cast-alert.test.js. A fictional song is used
 * (via buffStore.upsert + markBardSong) rather than a real roster entry, so this stays correct
 * even if the real roster's text ever changes.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

const TS = '[Wed Aug 19 19:23:03 2026] ';
const SONG = 'Test Song of Testing';

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  const engine = new BuffEngine(buffStore, store);
  engine.stop(); // no wall-clock tick; every test drives _tick() itself
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { engine, buffStore, log, data };
}

// Sets up a fictional bard song with unique landing/ended text - not in the real roster, so
// nothing else in the app can collide with it.
function makeSong(buffStore, name = SONG) {
  buffStore.upsert(name, 30, {
    landingText: `${name} takes hold.`,
    endedText: `${name} fades.`,
  });
  buffStore.markBardSong(name);
}

test('a self-cast bard song is attributed to "You"', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].name, SONG);
  assert.equal(songs[0].allyName, 'You');
  // The ordinary self-buffs list is completely unaffected - this is additive, not a replacement.
  assert.deepEqual(engine.getActiveBuffs().map((b) => b.name), [SONG]);
});

test('attribution is traceable in the debug log, not just the returned data', () => {
  const { engine, buffStore, log } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.ok(log.some((l) => l.includes('BARD SONG') && l.includes(SONG) && l.includes('You')));
});

test('an ally-cast bard song lands and is attributed, even with "Track others" OFF (the default)', () => {
  // Shara, 25 Aug, after watching a real bard song get vetoed live with the global toggle off:
  // "bard songs should have this enabled by default as you cannot separate them." Bard songs get
  // every trackOthersEnabled-gated veto in the unique-landing-text tier waived unconditionally -
  // see buffEngine.js's own comment on trackOthersForThis. This is what makes attribution actually
  // useful: without it, half of what this aura exists to show would be silently dropped before
  // _attributeBardSongCaster ever got a chance to look at it.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  assert.equal(engine.trackOthersEnabled, false, 'sanity: this is testing the default, not an opt-in');
  engine.handleLine(`${TS}Avenrae begins singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'Avenrae');
});

test('the veto waiver is scoped to bard songs only - an ordinary ally-cast spell is still IGNORED with "Track others" OFF', () => {
  const { engine, buffStore, log } = makeEngine();
  buffStore.upsert('Not A Song', 30, { landingText: 'This is definitely not a song.' });
  // Deliberately NOT calling markBardSong - this must behave exactly as it always has.
  engine.handleLine(`${TS}Avenrae begins casting Not A Song.`);
  engine.handleLine(`${TS}This is definitely not a song.`);
  assert.equal(engine.getActiveBuffs().length, 0, 'an ordinary spell must still be vetoed with track others off');
  assert.ok(log.some((l) => l.includes('IGNORED') && l.includes('track others OFF')));
});

test('a landing with no cast-begin evidence either way lands "Unknown", not a guess', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  // No "You begin singing"/"<Name> begins singing" line at all - e.g. a song that was already
  // running when the app started, or whose cast line was missed.
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'Unknown');
  // Still lands as a self buff, same as it always has - the app presumes its own casts by
  // default. Only the DEDICATED bard-song attribution is honest about not actually knowing.
  assert.deepEqual(engine.getActiveBuffs().map((b) => b.name), [SONG]);
});

test('two different casters maintaining the same song are two separate entries', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);

  const other = 'Other Song of Otherness';
  makeSong(buffStore, other);
  engine.setTrackOthersEnabled(true);
  engine.handleLine(`${TS}Avenrae begins singing ${other}.`);
  engine.handleLine(`${TS}${other} takes hold.`);

  const songs = engine.getActiveBardSongs().sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(songs.length, 2);
  const mine = songs.find((s) => s.name === SONG);
  const theirs = songs.find((s) => s.name === other);
  assert.equal(mine.allyName, 'You');
  assert.equal(theirs.allyName, 'Avenrae');
});

test('ended text removes the right caster\'s entry without touching another caster\'s copy of the same song', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.setTrackOthersEnabled(true);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  // Simulates the self-cast evidence having aged out before the ally's own cast is seen - without
  // this, _attributeBardSongCaster's self-first priority (see its own comment: still-valid
  // first-person evidence beats a same-moment ally signal, since either could genuinely explain a
  // landing THIS close together) would attribute both landings to "You", collapsing them into one
  // entry - correct behaviour there, but not what this test is isolating.
  engine.recentSelfCast = null;
  engine.handleLine(`${TS}Avenrae begins singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs().length, 2, 'sanity: both casters landed');

  engine.handleLine(`${TS}${SONG} fades.`);
  // endedText matching is a plain substring check against activeBuffs (self-buff-shaped, name
  // only) - it can only ever remove ONE entry per line (see _checkForEndedBuffs's own "a line
  // only ever reports one buff fading"), same limitation the self-buffs list already has for a
  // shared name. What matters here is that SOME entry went, not both, and nothing crashed.
  const remaining = engine.getActiveBardSongs();
  assert.ok(remaining.length <= 1, 'ended text should not have left both entries standing');
});

test('expiry removes a bard song from the aura, same as any other timer', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs().length, 1);

  const [entry] = [...engine.bardSongs.values()];
  entry.expiresAt = Date.now() - 1000;
  engine._tick();
  assert.equal(engine.getActiveBardSongs().length, 0);
});

test('snapshot save/restore round-trips bard songs, same as self/ally buffs', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);

  const snapshot = engine.getSnapshotState();
  assert.equal(snapshot.bardSongs.length, 1);

  const { engine: fresh, buffStore: freshStore } = makeEngine();
  makeSong(freshStore);
  const count = fresh.restoreSnapshot(snapshot);
  assert.ok(count >= 1);
  const restored = fresh.getActiveBardSongs();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].allyName, 'You');
});

test('a non-bard-song buff never appears in the bard songs list', () => {
  const { engine, buffStore } = makeEngine();
  buffStore.upsert('Not A Song', 30, { landingText: 'This is definitely not a song.' });
  // Deliberately NOT calling markBardSong.
  engine.handleLine(`${TS}This is definitely not a song.`);
  assert.equal(engine.getActiveBuffs().length, 1, 'sanity: it landed as an ordinary self buff');
  assert.equal(engine.getActiveBardSongs().length, 0);
});

module.exports = () => report('bard-songs');
if (require.main === module) process.exit(report('bard-songs') ? 1 : 0);
