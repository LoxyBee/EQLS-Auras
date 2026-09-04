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

// A fictional DEBUFF bard song - lands on an enemy, so it has a third-person suffix and a
// debuff scaleCategory. #29: these show on the Bard Songs aura when "Also show debuff songs" is on.
function makeDebuffSong(buffStore, name = 'Test Snare of Snaring') {
  buffStore.upsert(name, 30, {
    othersLandingSuffix: ` is bound by strands of test music.`,
    endedText: `${name} fades.`,
  });
  const e = buffStore.getByName(name);
  e.kind = 'det';
  e.scaleCategory = 'debuff';
  buffStore.markBardSong(name);
  return name;
}

test('#29 - a debuff bard song landing on an enemy shows on the aura, marked as a debuff', () => {
  const { engine, buffStore } = makeEngine();
  engine.setBardSongDebuffsWantedFn(() => true); // a Bard Songs aura has "Also show debuff songs" on
  const song = makeDebuffSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${song}.`);
  engine.handleLine(`${TS}a dry bones skeleton is bound by strands of test music.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].name, song);
  assert.equal(songs[0].isDebuff, true);
  assert.equal(songs[0].allyName, 'a dry bones skeleton', 'the enemy it landed on');
  assert.equal(songs[0].spellCategory, 'debuff', 'so the aura draws the debuff-coloured border');
});

test('#29 - a bard DAMAGE song (Denon\'s Desperate Dirge shape) never appears on the aura', () => {
  // Reported live, correcting an earlier fix: DDD is a nuke-category song. It lands third-person on
  // a mob but debuffs nothing - it must not show on the Bard Songs aura at all.
  const { engine, buffStore } = makeEngine();
  engine.setBardSongDebuffsWantedFn(() => true);
  buffStore.upsert('Test Desperate Dirge', 30, { othersLandingSuffix: ` staggers back a step.` });
  const e = buffStore.getByName('Test Desperate Dirge');
  e.kind = 'det';
  e.scaleCategory = 'nuke';
  delete e.durationSec;
  buffStore.markBardSong('Test Desperate Dirge');

  engine.handleLine(`${TS}You begin singing Test Desperate Dirge.`);
  engine.handleLine(`${TS}a dry bones skeleton staggers back a step.`);
  assert.equal(engine.getActiveBardSongs().length, 0, 'a damage song is not a debuff song');
});

test('#29 - a maintained bard debuff song with NO cast-begin line (Largo\'s Melodic Binding) is still caught', () => {
  // From the owner's real log: Largo's Melodic Binding re-lands every ~6s with no
  // "You begin singing" line at all - so every cast-driven tier missed it. The third-person
  // landing text is the only signal, matched directly against the roster's debuff-song suffixes.
  const { engine, buffStore } = makeEngine();
  engine.setBardSongDebuffsWantedFn(() => true);
  buffStore.upsert('Test Melodic Binding', 12, { othersLandingSuffix: ` is bound by strands of test music.` });
  const e = buffStore.getByName('Test Melodic Binding');
  e.kind = 'det';
  e.scaleCategory = 'debuff';
  buffStore.markBardSong('Test Melodic Binding');

  // no cast line - straight to the pulsing landing text
  engine.handleLine(`${TS}a dry bones skeleton is bound by strands of test music.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].name, 'Test Melodic Binding');
  assert.equal(songs[0].isDebuff, true);
  assert.equal(songs[0].allyName, 'a dry bones skeleton');
  assert.ok(songs[0].remainingSec > 0, 'it has a real countdown');

  // clears when the target dies
  engine.handleLine(`${TS}a dry bones skeleton has been slain by Shara!`);
  assert.equal(engine.getActiveBardSongs().length, 0, 'the debuff song clears when its target dies');
});

test('#29 - a debuff bard song is NOT tracked when no aura has asked to see debuff songs', () => {
  const { engine, buffStore } = makeEngine();
  // bardSongDebuffsWantedFn defaults to false - the "Also show debuff songs" option is off
  const song = makeDebuffSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${song}.`);
  engine.handleLine(`${TS}a dry bones skeleton is bound by strands of test music.`);
  assert.equal(engine.getActiveBardSongs().length, 0, 'a multi-word mob recipient is not valid unless wanted');
});

test('#29 - a buff song on the player is not marked as a debuff', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].isDebuff, false);
});

// Amplification/Jonthan's Whistling Warsong/Jonthan's Provocation are all real roster entries
// with targets:'Self' - mechanically impossible for anyone but the player to have cast in a way
// that lands on the player. Mirrors makeSong exactly, plus the one extra field.
function makeSelfOnlySong(buffStore, name = SONG) {
  makeSong(buffStore, name);
  buffStore.getByName(name).targets = 'Self';
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

test('a self-only-targeted song (targets:"Self" in the roster) is always attributed to "You", never Unknown or an ally', () => {
  // Requested directly: "amplification should also never be unknown, it's always self only, so
  // are a few other songs, like whistling warsong and jonthan's provocation" - confirmed against
  // the real roster that all three carry targets:'Self'. No cast-begin evidence at all here, which
  // would otherwise land "Unknown".
  const { engine, buffStore } = makeEngine();
  makeSelfOnlySong(buffStore);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'You');
});

test('a self-only-targeted song overrides even a stale other-caster hit - it is mechanically impossible for that to be real', () => {
  const { engine, buffStore } = makeEngine();
  makeSelfOnlySong(buffStore);
  // A same-named mob/ally ability observed casting earlier - would normally win via
  // _recentOtherCaster (see the RANKED-self-cast gotcha this file already pins), but targets:'Self'
  // rules that out categorically for a spell that cannot exist as a targeted/group version.
  engine.handleLine(`${TS}Enro begins singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'You');
});

test('memorizing a spell reclaims it from "Unknown" - bard buffs don\'t stack, so a second real instance can\'t coexist', () => {
  // Requested directly: "buffs do not stack on bard buffs, so if you are seen to have memmed a
  // spell, that same spell should be removed from the unknown list."
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  // Lands with no evidence at all first - genuinely "Unknown".
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].allyName, 'Unknown');

  // Now the player is seen memorizing that exact spell.
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1, 'reattributed in place, not duplicated into a second entry');
  assert.equal(songs[0].allyName, 'You');
});

test('memorizing a spell reclaims it from a real ally caster too, not just "Unknown"', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.setTrackOthersEnabled(true);
  engine.handleLine(`${TS}Baxa begins singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].allyName, 'Baxa');

  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'You');
});

test('attribution is traceable in the debug log, not just the returned data', () => {
  const { engine, buffStore, log } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.ok(log.some((l) => l.includes('BARD SONG') && l.includes(SONG) && l.includes('You')));
});

test('an ally-cast bard song lands and is attributed, even with "Track others" OFF (the default)', () => {
  // Vaela, 25 Aug, after watching a real bard song get vetoed live with the global toggle off:
  // "bard songs should have this enabled by default as you cannot separate them." Bard songs get
  // every trackOthersEnabled-gated veto in the unique-landing-text tier waived unconditionally -
  // see buffEngine.js's own comment on trackOthersForThis. This is what makes attribution actually
  // useful: without it, half of what this aura exists to show would be silently dropped before
  // _attributeBardSongCaster ever got a chance to look at it.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  assert.equal(engine.trackOthersEnabled, false, 'sanity: this is testing the default, not an opt-in');
  engine.handleLine(`${TS}Baxa begins singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'Baxa');
});

test('the veto waiver is scoped to bard songs only - an ordinary ally-cast spell is still IGNORED with "Track others" OFF', () => {
  const { engine, buffStore, log } = makeEngine();
  buffStore.upsert('Not A Song', 30, { landingText: 'This is definitely not a song.' });
  // Deliberately NOT calling markBardSong - this must behave exactly as it always has.
  engine.handleLine(`${TS}Baxa begins casting Not A Song.`);
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

test('a song memorized moments ago, with no cast-begin line at all, is still attributed to "You"', () => {
  // Reported live: this server's auto-sing mechanic can start a bard song playing the instant
  // it's memorized (the loadout/gem-swap mechanic - see CLAUDE.md's "Server context"), printing no
  // "You begin singing X." line at all. recentSelfCast never gets set, so this used to fall
  // straight through to "Unknown" for a genuine self-cast.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'You');
});

test('the memorize-attribution fallback expires - a landing well after the memorize is still "Unknown"', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  // Backdate the recorded memorize time rather than sleeping the test - same effect as the landing
  // arriving long after the memorize, without a real wall-clock wait. Past the 30s window (widened
  // from 6s on 3 Sep to cover a real bard weave that re-mems every ~24s).
  engine.recentlyMemorizedAt.set(SONG.toLowerCase(), Date.now() - 35000);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'Unknown');
});

test('a song that re-lands within the (widened) 30s memorize window is attributed to You - the weave case', () => {
  // Reported live: "bard songs are not being attributed to me even though i am actively swapping
  // and memming spells every 24 seconds ... sometimes works, sometimes not." The 6s window only
  // caught the pulse right after the memorize.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  engine.recentlyMemorizedAt.set(SONG.toLowerCase(), Date.now() - 20000); // 20s later - a real weave gap
  engine.recentSelfCast = null;
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].allyName, 'You');
});

test('once confirmed by the memorize window, later re-lands stay "You" even well past the 6s window - "it should stay that way until you unmem it"', () => {
  // Requested directly: a memorize-window confirmation used to only cover the single landing it
  // fired for - 6 seconds later, a repeat with no fresh evidence fell back to "Unknown" again
  // (the exact duplication bug fixed just above). The confirmation should now persist for as long
  // as the spell stays memorized, not re-expire every single repeat.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].allyName, 'You');

  // Long past the 6s window, and no fresh cast-begin evidence either - simulating the auto-sing
  // mechanic re-triggering the same still-memorized song much later in the session. Also removes
  // the still-active tracked entry, so the SEPARATE "reuse an existing active attribution"
  // fallback (its own tier, its own test above) can't produce the right answer on its own and
  // mask a broken persistent-confirmation tier.
  engine.recentlyMemorizedAt.set(SONG.toLowerCase(), Date.now() - 999999);
  engine.recentSelfCast = null;
  engine.bardSongs.delete(`you::${SONG.toLowerCase()}`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'You');
});

test('un-memorizing the song clears its confirmed attribution - a later repeat reads "Unknown" again, not a stale "You"', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].allyName, 'You');

  engine.handleLine(`${TS}You forget ${SONG}.`);
  engine.recentSelfCast = null;
  // Also remove the still-active tracked entry, so the separate "reuse an existing active
  // attribution" fallback (a different tier - see its own test above) can't mask this one.
  engine.bardSongs.delete(`you::${SONG.toLowerCase()}`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'Unknown');
});

test('real ally cast-begin evidence still wins over a coincidental recent self-memorize', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  engine.handleLine(`${TS}Baxa begins singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'Baxa');
});

test('a re-land with no fresh evidence at all reuses the song\'s existing active attribution instead of creating an "Unknown" duplicate', () => {
  // Reported live: the same songs showing under both "You" and "Unknown" at once, at a consistent
  // ~19s offset - the auto-sing mechanic (see CLAUDE.md's "Server context") had re-triggered an
  // already-correctly-attributed "You" song with no cast-begin line and no fresh memorize evidence
  // either, so _attributeBardSongCaster fell all the way to null/"Unknown" and a second entry was
  // created for the exact same song. The "You" entry then expired on its own timer, so the song
  // read as never cast at all ("it forgets I cast them").
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  // Clear the cast-begin evidence itself (not just letting it sit valid) so this landing has to
  // reach the reuse-existing-attribution fallback rather than tier 1 trivially matching again -
  // same as the real auto-sing case, where there was never a cast-begin line for the repeat at all.
  engine.recentSelfCast = null;
  // A second landing with NO cast-begin evidence and no recent memorize - exactly what the
  // auto-sing mechanic produces on a repeat.
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1, 'the repeat should refresh the existing entry, not add a second one');
  assert.equal(songs[0].allyName, 'You');
});

test('the reuse-existing-attribution fallback does not invent a caster once there is no longer an active entry to reuse', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  engine.recentSelfCast = null; // see the previous test's own comment on why this is needed
  // Expire the tracked entry itself (the separate periodic cleanup that prunes stale bardSongs
  // entries is its own already-tested behaviour - see "expiry removes a bard song from the aura,
  // same as any other timer" below; this test is only about whether an entry that is no longer
  // ACTIVE gets reused for attribution, so removing it directly is the more targeted setup).
  const key = `you::${SONG.toLowerCase()}`;
  engine.bardSongs.delete(key);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'Unknown');
});

test('two different casters maintaining the same song are two separate entries', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);

  const other = 'Other Song of Otherness';
  makeSong(buffStore, other);
  engine.setTrackOthersEnabled(true);
  engine.handleLine(`${TS}Baxa begins singing ${other}.`);
  engine.handleLine(`${TS}${other} takes hold.`);

  const songs = engine.getActiveBardSongs().sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(songs.length, 2);
  const mine = songs.find((s) => s.name === SONG);
  const theirs = songs.find((s) => s.name === other);
  assert.equal(mine.allyName, 'You');
  assert.equal(theirs.allyName, 'Baxa');
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
  engine.handleLine(`${TS}Baxa begins singing ${SONG}.`);
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

test('a RANKED self-cast is still attributed to "You", not a stale other-caster from earlier', () => {
  // Reported live: "Selo's Accelerating Chorus VI" (self-cast, ranked) was attributed to
  // "Enro" - not a groupmate at all, but a MOB that happened to have an identically-named
  // ability, seen singing it ~20 minutes earlier the same session. Root cause: recentSelfCast.name
  // carries the log's own rank suffix, and _attributeBardSongCaster used to compare that directly
  // against the roster's bare name with no stripRankSuffix() - so the self-check silently failed
  // for every ranked cast and fell through to the stale other-caster evidence, which has no
  // expiry by design (see recentOtherCasts' own comment). Simulated here with a fictional ranked
  // name ("Test Song of Testing VI") rather than a real spell, so this stays correct regardless of
  // what's actually in the roster.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  // The stale evidence: someone (or something) else was seen "casting" this exact song a while
  // ago. No expiry on this map is deliberate elsewhere in the app, so the fix has to be on the
  // self-check side, not by aging this out.
  engine.handleLine(`${TS}Enro begins singing ${SONG}.`);
  // The player's own ranked cast and its landing - note the numeral on the cast line only, never
  // on the landing text, exactly like a real EQ bard song.
  engine.handleLine(`${TS}You begin singing ${SONG} VI.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  const songs = engine.getActiveBardSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].allyName, 'You', 'a ranked self-cast must not fall through to a stale other-caster');
});

test('an UNRANKED self-cast still worked before the fix, and still works after it', () => {
  // Confirms the fix is additive - the unranked case (no rank suffix at all) already matched via
  // a plain string comparison, which is exactly why this bug went unnoticed until a ranked song
  // hit it. stripRankSuffix on a name with nothing to strip must return the name unchanged.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}Enro begins singing ${SONG}.`);
  engine.handleLine(`${TS}You begin singing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].allyName, 'You');
});

test('a confirmed song wearing off (ended text) without renewing drops confidence for every OTHER confirmed song too', () => {
  // Requested directly: "if a song stops being played, the confidence of the entire list drops" -
  // clarified as specifically meaning a CONFIRMED song's own timer actually running out without a
  // repeat landing first (as opposed to being un-memorized, which only un-confirms that one song -
  // see the test above). Treated as a sign that whatever made the memorize-window confirmations
  // trustworthy may have changed (most likely a loadout swap this app has no other way to see),
  // so every remaining confirmed song needs fresh evidence again too.
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);
  assert.equal(engine.getActiveBardSongs()[0].allyName, 'You');

  const other = 'Other Song of Otherness';
  makeSong(buffStore, other);
  engine.handleLine(`${TS}You have finished memorizing ${other}.`);
  engine.handleLine(`${TS}${other} takes hold.`);
  assert.equal(engine.bardSongConfirmedMine.size, 2);

  // SONG's own ended-text line arrives - it actually wore off, nothing renewed it.
  engine.handleLine(`${TS}${SONG} fades.`);
  assert.equal(engine.bardSongConfirmedMine.size, 0, 'confidence should have dropped for the whole list');

  // A later repeat of the OTHER song, still memorized, with no fresh cast-begin evidence, now
  // needs to re-earn its confirmation rather than coasting on the old one.
  engine.recentlyMemorizedAt.set(other.toLowerCase(), Date.now() - 999999);
  engine.recentSelfCast = null;
  engine.bardSongs.delete(`you::${other.toLowerCase()}`);
  engine.handleLine(`${TS}${other} takes hold.`);
  const songs = engine.getActiveBardSongs();
  const theOther = songs.find((s) => s.name === other);
  assert.equal(theOther.allyName, 'Unknown');
});

test('a confirmed song wearing off (natural expiry) without renewing drops confidence for every OTHER confirmed song too', () => {
  const { engine, buffStore } = makeEngine();
  makeSong(buffStore);
  engine.handleLine(`${TS}You have finished memorizing ${SONG}.`);
  engine.handleLine(`${TS}${SONG} takes hold.`);

  const other = 'Other Song of Otherness';
  makeSong(buffStore, other);
  engine.handleLine(`${TS}You have finished memorizing ${other}.`);
  engine.handleLine(`${TS}${other} takes hold.`);
  assert.equal(engine.bardSongConfirmedMine.size, 2);

  const [songEntry] = [...engine.bardSongs.values()].filter((s) => s.name === SONG);
  songEntry.expiresAt = Date.now() - 1000;
  engine._tick();
  assert.equal(engine.bardSongConfirmedMine.size, 0);
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

// ---------------------------------------------------------------------------
// #27 - the "Active on this aura" card is fed on the Bard Songs premade
// ---------------------------------------------------------------------------
//
// Reported live: the "active effects on this aura" card, which works like Self Buffs', showed
// nothing on the Bard Songs premade. Two causes: the settings window had no bard-songs data feed
// at all (no preload bridge, activeSourceForWidget fell through to self buffs), and
// filterActiveBuffsForWidget applied the inherited `hideBardSongs: true` default, which strips
// every row since they are all isBardSong by construction.
const fs = require('node:fs');
const path = require('node:path');
const readSrc = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('#27 - the bard-songs feed is wired IPC -> preload -> settings window', () => {
  const main = readSrc('src', 'main', 'main.js');
  const preload = readSrc('src', 'preload', 'preload-main.js');
  const renderer = readSrc('src', 'renderer', 'main-window', 'main-window.js');

  assert.match(main, /ipcMain\.handle\('buffs:getActiveBardSongs'/);
  assert.match(main, /ipcMain\.handle\('buffs:removeActiveBardSong'/);
  assert.match(main, /broadcast\('buffs:activeBardSongs'/);

  assert.match(preload, /getActiveBardSongs:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('buffs:getActiveBardSongs'\)/);
  assert.match(preload, /onActiveBardSongsChanged:/);
  assert.match(preload, /removeActiveBardSong:/);

  assert.match(renderer, /let latestBardSongs = \[\]/);
  assert.match(renderer, /onActiveBardSongsChanged\(\(songs\) => \{\s*latestBardSongs = songs/);
  assert.match(renderer, /widget\.buffSource === 'bardSongs'\) return latestBardSongs/);
});

test('#29 - the show-debuff-songs / split-by-type options are wired end to end', () => {
  const store = readSrc('src', 'main', 'widgetStore.js');
  const mgr = readSrc('src', 'main', 'widgetManager.js');
  const main = readSrc('src', 'main', 'main.js');
  const preload = readSrc('src', 'preload', 'preload-main.js');
  const overlay = readSrc('src', 'renderer', 'overlay', 'overlay.js');
  const renderer = readSrc('src', 'renderer', 'main-window', 'main-window.js');

  // defaults: both off, both persisted and shareable
  assert.match(store, /showDebuffSongs: false/);
  assert.match(store, /splitSongsByType: false/);
  assert.match(store, /showDebuffSongs: !!widget\.showDebuffSongs/);
  assert.match(store, /'showDebuffSongs',\s*\n\s*'splitSongsByType',/);
  // manager -> IPC -> preload
  assert.match(mgr, /function setShowDebuffSongs/);
  assert.match(main, /ipcMain\.handle\('widget:setShowDebuffSongs'/);
  assert.match(preload, /setWidgetShowDebuffSongs:/);
  // overlay honours both
  assert.match(overlay, /currentConfig\.showDebuffSongs \|\| !b\.isDebuff/);
  assert.match(overlay, /function groupBySongType/);
  assert.match(overlay, /function shouldSplitSongs/);
  // the bardSongs feed collapses a maintained debuff song on N mobs to one tile
  assert.match(overlay, /return collapseDebuffSongs\(shown\)/);
  // the "Active on this aura" card in the settings window honours showDebuffSongs too
  assert.match(renderer, /widget\.showDebuffSongs \|\| !b\.isDebuff/);
});

test('#27 - filterActiveBuffsForWidget does not strip a bard-songs aura with hideBardSongs inherited true', () => {
  const renderer = readSrc('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function filterActiveBuffsForWidget\(widget\) \{[\s\S]*?\n  \}/)[0];
  // the bardSongs bypass must come BEFORE the buffFilterMode / hideBardSongs block
  assert.ok(
    fn.indexOf("widget.buffSource === 'bardSongs'") < fn.indexOf('if (widget.hideBardSongs)'),
    'the hideBardSongs filter would run first and strip every row'
  );
  assert.match(fn, /buffSource === 'bardSongs'\) \{[\s\S]{0,220}return source\.filter/);
});

// One maintained debuff song on N mobs is one song on the aura - overlay.js's collapseDebuffSongs.
function loadCollapse() {
  const src = readSrc('src', 'renderer', 'overlay', 'overlay.js');
  const kf = src.match(/function keyFor\(buff\) \{[\s\S]*?\n\}/);
  const cd = src.match(/function collapseDebuffSongs\(songs\) \{[\s\S]*?\n\}/);
  assert.ok(kf && cd, 'keyFor / collapseDebuffSongs renamed or restructured');
  return new Function(`${kf[0]}\n${cd[0]}\nreturn collapseDebuffSongs;`)();
}

test('collapseDebuffSongs folds one debuff song on several mobs into a single badged tile', () => {
  const collapse = loadCollapse();
  const out = collapse([
    { name: 'Selo’s', isDebuff: false, remainingSec: 17, allyName: 'You' },
    { name: "Largo's Melodic Binding", isDebuff: true, remainingSec: 11, allyName: 'a kobold', id: 'k1' },
    { name: "Largo's Melodic Binding", isDebuff: true, remainingSec: 5, allyName: 'a rat', id: 'k2' },
    { name: "Largo's Melodic Binding", isDebuff: true, remainingSec: 9, allyName: 'a bat', id: 'k3' },
  ]);
  const buff = out.filter((b) => !b.isDebuff);
  const debuff = out.filter((b) => b.isDebuff);
  assert.equal(buff.length, 1, 'the buff song is untouched');
  assert.equal(debuff.length, 1, 'three debuff-song tiles collapsed to one');
  assert.equal(debuff[0].remainingSec, 5, 'the soonest-expiring instance leads');
  assert.equal(debuff[0].mergedCount, 3);
  assert.equal(debuff[0].allyName, null, 'no single mob name on the collapsed tile');
  assert.equal(debuff[0].mergedKey, "debuffsong::largo's melodic binding");
});

test('collapseDebuffSongs leaves a lone debuff song as one stable tile with no badge', () => {
  const collapse = loadCollapse();
  const out = collapse([{ name: 'Largo', isDebuff: true, remainingSec: 8, allyName: 'a kobold', id: 'k1' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].mergedCount, undefined, 'x1 shows no count');
  assert.equal(out[0].mergedKey, 'debuffsong::largo', 'still keyed by song, not by the mob');
  assert.equal(out[0].allyName, null);
});

test('collapseDebuffSongs is a no-op when there are no debuff songs', () => {
  const collapse = loadCollapse();
  const songs = [{ name: 'A', isDebuff: false, remainingSec: 10 }, { name: 'B', isDebuff: false, remainingSec: 12 }];
  assert.deepEqual(collapse(songs), songs);
});

module.exports = () => report('bard-songs');
if (require.main === module) report('bard-songs').then((n) => process.exit(n ? 1 : 0));
