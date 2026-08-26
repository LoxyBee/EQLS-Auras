'use strict';
/**
 * The song-pulse repeat check - note 24's last piece.
 *
 * A bard song re-lands on a fixed pulse and an ordinary buff does not, so a landing text that
 * comes back one pulse later is a song. That is the only signal in the log which separates them
 * without asking anyone.
 *
 * SIX SECONDS IS MEASURED, not assumed. Across 1,521,971 real log lines the gap between
 * consecutive repeats of an identical line is 6s on 314,324 occasions - four times the next most
 * common gap - and every one of the ten most-repeated lines pulses at 6s.
 *
 * AND IT CANNOT CURRENTLY FIRE, which is the finding worth keeping. The check only decides a
 * landing text shared between exactly one song and one non-song, and the rebuilt roster has none
 * of those. The note was written against the old 11,337-entry roster where the collision existed;
 * note 35 removed it by replacing the roster. The last test here is a tripwire for that changing.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const engineSrc = read('src', 'main', 'buffEngine.js');
const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));

// _songAmongSplitCandidates, reproduced, and pinned against the real one below.
const songAmong = (candidates) => {
  const songs = candidates.filter((c) => c.isBardSong);
  if (songs.length !== 1) return null;
  if (songs.length === candidates.length) return null;
  return songs[0];
};

test('the pulse interval is six seconds and says where that came from', () => {
  assert.match(engineSrc, /const SONG_PULSE_SEC = 6;/);
  assert.match(engineSrc, /314,324/, 'the measurement behind the number is not recorded');
});

test('the tolerance is one second, not more', () => {
  // The log has one-second resolution so a pulse can land a tick either side. At two, an ordinary
  // rebuff cycle starts looking like a pulse.
  assert.match(engineSrc, /const SONG_PULSE_TOLERANCE_SEC = 1;/);
});

test('only a split candidate set can be decided this way', () => {
  const song = { name: 'Song', isBardSong: true };
  const buff = { name: 'Buff', isBardSong: false };
  assert.equal(songAmong([song, buff]).name, 'Song', 'the decidable case was refused');
  assert.equal(songAmong([song]), null, 'all songs - a repeat says nothing about which');
  assert.equal(songAmong([song, { name: 'S2', isBardSong: true }, buff]), null, 'two songs is still ambiguous');
  assert.equal(songAmong([buff]), null, 'no song at all - a repeat is just a recast');
});

test('the real function agrees, both halves of it', () => {
  const fn = engineSrc.match(/_songAmongSplitCandidates\(candidates\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, '_songAmongSplitCandidates has been renamed or restructured');
  assert.match(fn[1], /songs\.length !== 1/, 'more than one song would be resolved arbitrarily');
  assert.match(fn[1], /songs\.length === candidates\.length/, 'an all-song set would be resolved arbitrarily');
});

test('a repeat one pulse later resolves it, and any other gap does not', () => {
  const fn = engineSrc.match(/_queueAmbiguousCast\(text, candidates, isSelf, attributedTo = null\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, '_queueAmbiguousCast has been restructured');
  assert.match(fn[1], /Math\.abs\(sinceSec - SONG_PULSE_SEC\) <= SONG_PULSE_TOLERANCE_SEC/);
  assert.match(fn[1], /this\.ambiguousCasts\.delete\(text\)/, 'the prompt is left behind after resolving');
  assert.match(fn[1], /this\._land\(song\)/);
});

test('the ambiguity it solves does not exist on this roster', () => {
  // A tripwire, not a pass. If this ever stops being zero, a song and an ordinary spell have come
  // to share a landing text again - and the check above becomes live code that has never once run.
  const byText = {};
  for (const e of roster) {
    if (!e.landingText) continue;
    (byText[e.landingText] = byText[e.landingText] || []).push(e);
  }
  const shared = Object.values(byText).filter((c) => c.length > 1);
  assert.ok(shared.length > 50, `only ${shared.length} shared landing texts - has the roster changed?`);

  const splits = shared.filter((c) => {
    const songs = c.filter((x) => x.isBardSong);
    return songs.length === 1 && songs.length !== c.length;
  });
  assert.equal(
    splits.length,
    0,
    `${splits.length} landing texts are now split song-vs-buff, so the pulse check has gone live ` +
      'and needs testing against a real log for the first time'
  );

  // And the reason is written down where someone debugging "why does this never fire" will see it.
  assert.match(engineSrc, /DORMANT ON THE CURRENT ROSTER/);
});

module.exports = () => report('song-pulse');
if (require.main === module) process.exit(report('song-pulse') ? 1 : 0);
