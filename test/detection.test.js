'use strict';
/**
 * The detection engine's first real coverage.
 *
 * handleLine() is the most consequential code in this project and, until this file, had none. It
 * is also the code that fails silently: when it goes wrong nobody sees an error, a timer somebody
 * relied on simply stops appearing. The owner's constraint on any work here is "if any
 * functionality is lost during this process that is to be considered a failure", and a constraint
 * with no mechanical guard behind it is a hope.
 *
 * BuffEngine takes its store as a constructor argument and imports no Electron, so the real engine
 * runs here against a plain in-memory fake - these are behavioural tests, not structural ones.
 *
 * The bulk of this file pins behaviour that ALREADY WORKED before anything was changed. That is
 * the point: it is a net under the tier work, not a description of new features.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

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
  return { engine, buffStore, log };
}

const names = (engine) => engine.getActiveBuffs().map((b) => b.name).sort();

// ---------------------------------------------------------------------------
// The basics, pinned because everything else stands on them
// ---------------------------------------------------------------------------

test('a unique landing text starts a timer', () => {
  const { engine } = makeEngine();
  engine.handleLine('[Wed Aug 19 20:15:02 2026] You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), ['Spirit of the Puma']);
  assert.equal(engine.getActiveBuffs()[0].remainingSec, 60);
});

test('its ended text stops it', () => {
  const { engine } = makeEngine();
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.equal(engine.getActiveBuffs().length, 1);
  engine.handleLine('The spirit of the puma departs.');
  assert.deepEqual(names(engine), []);
});

test('a blocked buff never lands', () => {
  const { engine } = makeEngine();
  engine.blockBuff('Spirit of the Puma');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), [], '"No longer track" has to mean it');
});

test('landing again refreshes rather than duplicating', () => {
  const { engine } = makeEngine();
  engine.handleLine('You begin to snarl as your features become feline.');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.equal(engine.getActiveBuffs().length, 1, 'a renewal must not become a second tile');
});

test('an ordinary chat line does nothing at all', () => {
  const { engine } = makeEngine();
  engine.handleLine("Baxa says, 'You begin to snarl as your features become feline.'");
  assert.deepEqual(names(engine), [], 'a quoted landing message is not a landing');
});

test('an expired buff is swept away', () => {
  const { engine } = makeEngine();
  engine.handleLine('The aria lifts you into the air.'); // Agilmente's Aria of Eagles, 18s
  assert.equal(engine.getActiveBuffs().length, 1);
  const entry = [...engine.activeBuffs.values()][0];
  entry.expiresAt = Date.now() - 1000;
  engine._tick();
  assert.deepEqual(names(engine), []);
});

// ---------------------------------------------------------------------------
// The debug log - reported live 25 Aug: "should there be a debug log of every
// aura that is fired/loaded/ended... so that there actually exists a way for
// you to tell the output from my inputs?" LANDED/IGNORED already existed;
// EXPIRED (natural sweep) and LOADED (session restore) did not.
// ---------------------------------------------------------------------------

test('a natural expiry is logged, not just the text-match ENDED paths', () => {
  const { engine, log } = makeEngine();
  engine.handleLine('The aria lifts you into the air.');
  const entry = [...engine.activeBuffs.values()][0];
  entry.expiresAt = Date.now() - 1000;
  engine._tick();
  assert.ok(
    log.some((l) => l.includes('EXPIRED') && l.includes('Aria of Eagles')),
    'the sweep removed it with no trace of why'
  );
});

test('an ally buff\'s natural expiry is logged too, same as the self-buff sweep', () => {
  const { engine, log } = makeEngine();
  engine._landOnAlly(engine.buffStore.getByName('Alliance') || { name: 'X', durationSec: 30 }, 'Baxa');
  const [entry] = [...engine.allyBuffs.values()];
  entry.expiresAt = Date.now() - 1000;
  entry.instant = false; // force the ordinary duration sweep path rather than the instant one
  engine._tick();
  assert.ok(
    log.some((l) => l.includes('EXPIRED') && l.includes('Baxa')),
    'the ally sweep must name both the buff and who it was on'
  );
});

test('restoring a session snapshot logs a LOADED line per buff, not just a batch count', () => {
  const { engine, log } = makeEngine();
  const count = engine.restoreSnapshot({
    selfBuffs: [{ name: 'Spirit of the Puma', durationSec: 1440, expiresAt: Date.now() + 60000 }],
    allyBuffs: [{ name: 'Shield of Flame', allyName: 'Baxa', durationSec: 600, expiresAt: Date.now() + 60000 }],
  });
  assert.equal(count, 2);
  assert.ok(log.some((l) => l.includes('LOADED') && l.includes('Spirit of the Puma')));
  assert.ok(log.some((l) => l.includes('LOADED') && l.includes('Shield of Flame') && l.includes('Baxa')));
});

// ---------------------------------------------------------------------------
// A spell the roster has no duration for
// ---------------------------------------------------------------------------
//
// 275 of the 1,052 roster entries carry a landing text and no duration, and there turned out to
// be two completely different reasons for that. Some genuinely never run out - Yaulp, Fury - and
// are marked as such (see infinite-duration.test.js). The rest are INSTANTS: a nuke, a heal, a
// gate, something that happens rather than something that runs.
//
// Until this was sorted out, an absent duration multiplied to NaN, NaN became the expiry, and the
// sweep asks `expiresAt <= now` - false for NaN, forever. The result was a tile reading "NaN:NaN"
// that never counted down and could not be dismissed without restarting.
//
// Vaela's rule for instants: not tracked on auras that draw countdowns, but available to sound and
// text auras, "just in case someone wants feedback when a cast is successful or resisted". So they
// still land - that is how those two hear about anything - and the overlay refuses to draw them as
// countdown tiles.

test('an instant lands with no remaining time, and no NaN anywhere', () => {
  const { engine, buffStore } = makeEngine();
  const instant = buffStore.getByName('Alliance');
  assert.equal(typeof instant.durationSec, 'undefined', 'the fixture spell now HAS a duration - pick another');

  engine._land(instant);
  const [buff] = engine.getActiveBuffs();
  assert.equal(buff.name, 'Alliance');
  assert.equal(buff.instant, true);
  assert.equal(buff.remainingSec, null, 'null, never NaN - NaN is what produced the unkillable tile');
  assert.equal(buff.durationSec, null, 'nothing may render a countdown from this');
});

test('and it can actually be swept away, unlike before', () => {
  // The defect was that the sweep asks `expiresAt <= now`, which is false for NaN forever. A
  // finite expiry is what makes it removable at all.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Alliance'));
  const entry = [...engine.activeBuffs.values()][0];
  assert.ok(Number.isFinite(entry.expiresAt), 'a non-finite expiry can never be swept');

  entry.expiresAt = Date.now() - 1000;
  engine._tick();
  assert.deepEqual(names(engine), [], 'it must be removable');
});

test('an instant sorts LAST, not first', () => {
  // Same trap as the infinite ones: remainingSec is null, and null sorts as zero.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Alliance'));
  engine._land(buffStore.getByName('Spirit of the Puma'));
  assert.deepEqual(names(engine).length, 2);
  assert.equal(engine.getActiveBuffs()[0].name, 'Spirit of the Puma', 'the real countdown comes first');
});

test('the overlay keeps instants off auras that draw countdowns', () => {
  // The rule itself. A list or icon aura filters them out; a text aura keeps them.
  const overlay = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'overlay.js'), 'utf8'
  );
  assert.match(
    overlay,
    /const drawsCountdowns = currentConfig\.displayMode !== 'text';/
  );
  assert.match(overlay, /if \(drawsCountdowns\) \{\s*\n\s*filtered = filtered\.filter\(\(b\) => !b\.instant\);/);

  // And the other half: an aura that does NOT draw countdowns keeps them, for its own number of
  // seconds rather than the full minute the engine holds them.
  assert.match(overlay, /const showFor = currentConfig\.textAuraInstantSec \|\| 6;/);
  assert.match(overlay, /now - b\.landedAt <= showFor \* 1000/);
});

test('a duration that IS known behaves correctly', () => {
  // The contrast, and the thing any fix must not disturb.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Spirit of the Puma'));
  assert.deepEqual(names(engine), ['Spirit of the Puma']);
  assert.equal(engine.getActiveBuffs()[0].remainingSec, 60);
});

test('the sweep still leaves a healthy buff alone', () => {
  const { engine } = makeEngine();
  engine.handleLine('You feel agile.'); // Agility, 3780s
  engine._tick();
  assert.deepEqual(names(engine), ['Agility'], 'the sweep must only remove what is actually over');
});

// ---------------------------------------------------------------------------
// The veto that keeps someone else's buff off your own aura
// ---------------------------------------------------------------------------

test('a buff someone else was seen casting is not counted as yours', () => {
  // Default is self-buffs only. A third-person cast line is the evidence, and it has no time
  // limit on purpose - an auto-renewing song shows that line once and then renews silently.
  const { engine } = makeEngine();
  engine.handleLine('Baxa begins to cast a spell.');
  engine.handleLine('Baxa begins casting Spirit of the Puma.');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), [], "someone else's buff must not land on your own aura");
});

test('but it IS counted once you ask to track other people buffs', () => {
  const { engine } = makeEngine();
  engine.setTrackOthersEnabled(true);
  engine.handleLine('Baxa begins casting Spirit of the Puma.');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), ['Spirit of the Puma']);
});

test('the veto now records WHO, without changing what it decides', () => {
  // The change is a Set to a Map so the debug log can name the caster. The KEY is unchanged
  // and has to stay unchanged: six decisions gate on _hasRecentOtherCast(spellName), and
  // widening the key to caster+spell would quietly weaken all of them.
  const { engine, log } = makeEngine();
  engine.handleLine('Motrin begins casting Spirit of the Puma.');

  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true, 'the veto must still fire');
  assert.equal(engine._hasRecentOtherCast('SPIRIT OF THE PUMA'), true, 'and still be case-insensitive');
  assert.equal(engine._hasRecentOtherCast('Agility'), false);
  assert.equal(engine._recentOtherCaster('Spirit of the Puma'), 'Motrin');
  assert.equal(engine._recentOtherCaster('Agility'), null, 'never seen cast means no name, not undefined');

  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), [], 'the veto still keeps it off your own aura');
  assert.ok(
    log.some((m) => m.includes('recently cast by "Motrin"')),
    'the whole point of the change is that the log can now say who'
  );
});

test('a second caster of the same spell does not break the veto', () => {
  // The failure this guards: keying on caster+spell instead of spell would mean the same spell
  // cast by two different people stopped matching itself, and the veto would silently stop
  // firing - with track-others off, that lands another player buff on your own aura.
  const { engine } = makeEngine();
  engine.handleLine('Motrin begins casting Spirit of the Puma.');
  engine.handleLine('Baxa begins casting Spirit of the Puma.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true);
  assert.equal(engine._recentOtherCaster('Spirit of the Puma'), 'Baxa', 'the latest caster wins');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), []);
});

test('a caster whose name is not one plain word still vetoes', () => {
  // Only about half of the caster names in the real logs are a single alphabetic word.
  // Anything that filtered them by shape - Cazic-Thule, A Teir`Dal something, someone's pet -
  // would silently stop vetoing for the rest.
  const { engine } = makeEngine();
  engine.handleLine('a greater kobold begins casting Spirit of the Puma.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true);
  assert.equal(engine._recentOtherCaster('Spirit of the Puma'), 'a greater kobold');
});

test('a party change still clears the veto', () => {
  // The clear is what stops a veto outliving the group it came from. It has to keep working
  // now that the collection is a Map.
  const { engine } = makeEngine();
  engine.handleLine('Motrin begins casting Spirit of the Puma.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true);
  engine.handleLine('You have been removed from the group.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), false, 'a stale veto would hide your own buffs');
});

// ---------------------------------------------------------------------------
// Which evidence wins when a buff message could be several spells
// ---------------------------------------------------------------------------

test('the spellbook is trusted over the memorized gems when they disagree', () => {
  // The owner had to correct me on this one. Manually un-memorising a spell DOES print
  // "You forget X." - but a full EQ Legends loadout swap, which changes every gem at once and
  // can change class, prints nothing at all. So after one of those the gem list is silently
  // wrong and no log line can say so, while the spellbook cannot go stale that way.
  //
  // Driven through the real engine with two candidates that share a landing message: one in
  // the spellbook, a different one in a gem. The spellbook must win.
  const { engine, buffStore, log } = makeEngine();
  const shared = buffStore.getAll().filter((e) => e.landingText === "You feel yourself falling.");
  const pair = shared.length >= 2 ? shared : buffStore.getAll()
    .reduce((acc, e) => {
      if (!e.landingText) return acc;
      (acc.byText[e.landingText] = acc.byText[e.landingText] || []).push(e);
      if (acc.byText[e.landingText].length === 2 && !acc.found) acc.found = acc.byText[e.landingText];
      return acc;
    }, { byText: {}, found: null }).found;
  assert.ok(pair && pair.length >= 2, 'no ambiguous landing text in the roster to test with');
  const [inBook, inGem] = pair;

  engine.setSpellbookCheckFn((name) => name === inBook.name);
  engine._rememberMemorized(inGem.name);
  engine.handleLine(inBook.landingText);

  assert.deepEqual(
    names(engine), [inBook.name],
    'the spellbook has to win - the gem list is the one that goes wrong after a loadout swap'
  );
  assert.ok(log.some((m) => m.includes('narrowed to 1 by spellbook')));
});

test('the gems still narrow when the spellbook cannot', () => {
  // Demoting the gem check must not mean discarding it. With no spellbook at all it is the
  // only narrowing the app has, and that is the owner situation today.
  const { engine, buffStore, log } = makeEngine();
  const byText = {};
  let pair = null;
  for (const e of buffStore.getAll()) {
    if (!e.landingText) continue;
    (byText[e.landingText] = byText[e.landingText] || []).push(e);
    if (byText[e.landingText].length === 2 && !pair) pair = byText[e.landingText];
  }
  assert.ok(pair, "no ambiguous landing text in the roster to test with");

  engine._rememberMemorized(pair[1].name);
  engine.handleLine(pair[0].landingText);
  assert.deepEqual(names(engine), [pair[1].name]);
  assert.ok(log.some((m) => m.includes('narrowed to 1 by currently-memorized gem')));
});

test('a debuff scribed in the spellbook is never landed on the player as a self-buff', () => {
  // Reported live, 24 Aug: "just had a buff Languid Pace on myself." Languid Pace is a Slow
  // debuff (kind 'det') sharing "You slow down." with two other Slow debuffs (Shiftless Deeds,
  // Tepid Deeds) - text that only ever appears when something ELSE slows the player. The player
  // had Languid Pace scribed (an ENC casts it AT enemies), so the spellbook-narrow tier took
  // "it's in my spellbook" as if it were evidence the landing was cast on the player themselves,
  // and confidently attributed a mob's slow to their own cast.
  const { engine, buffStore, log } = makeEngine();
  const languidPace = buffStore.getByName('Languid Pace');
  assert.ok(languidPace, 'expected Languid Pace in the roster');
  assert.equal(languidPace.scaleCategory, 'debuff', 'this test only means anything against a real debuff-category entry');
  const shared = buffStore.getAll().filter((e) => e.landingText === languidPace.landingText);
  assert.ok(shared.length > 1, 'expected "You slow down." to still be ambiguous in the roster');

  engine.setSpellbookCheckFn((name) => name === 'Languid Pace');
  engine.handleLine(languidPace.landingText);

  assert.deepEqual(names(engine), [], 'a debuff the player only knows how to cast at enemies was landed on the player');
  assert.ok(
    log.some((m) => m.includes('IGNORED') && m.includes(languidPace.landingText)),
    'expected the line to fall through to the ordinary "not mine" handling instead'
  );
});

test('a pet-only spell sharing a landing text is not offered as a candidate on the player', () => {
  // Reported live: "You feel smaller." is shared by Shrink (targets Single) and Tiny Companion
  // (targets Pet). In a burst (the player just activated Quick Buff), with no spellbook to narrow
  // it, the engine queued a real two-option prompt - Shrink or Tiny Companion - even though Tiny
  // Companion can only ever land on a pet, never a player. Now the pet-target candidate is dropped
  // before the burst tier, so Shrink alone remains and lands with no prompt at all.
  const { engine, buffStore, log } = makeEngine();
  const shrink = buffStore.getByName('Shrink');
  const tiny = buffStore.getByName('Tiny Companion');
  assert.ok(shrink && tiny, 'expected both Shrink and Tiny Companion in the roster');
  assert.equal(shrink.landingText, tiny.landingText, 'this test needs them to still share landing text');
  assert.equal(tiny.targets, 'Pet', 'Tiny Companion must be a Pet-target entry for this to mean anything');

  // no spellbook narrowing available; the player's own burst is the only self-evidence
  engine.handleLine('[Wed Aug 19 20:00:00 2026] You activate Quick Buff.');
  engine.handleLine(`[Wed Aug 19 20:00:01 2026] ${shrink.landingText}`);

  assert.deepEqual(names(engine), ['Shrink']);
  assert.ok(
    log.some((m) => m.includes('LANDED "Shrink"') && m.includes('only one candidate')),
    'with Tiny Companion dropped, Shrink is the only candidate and lands directly'
  );
  assert.ok(
    !log.some((m) => m.includes('Tiny Companion')),
    'Tiny Companion (Pet-target) must never appear as a candidate for a landing on the player'
  );
  assert.ok(
    !engine.getAmbiguousCasts().some((c) => c.text === shrink.landingText),
    'no unresolved Shrink-vs-Tiny-Companion prompt should be left pending'
  );
});

test('a group-wide instant grant triggered by an ALLY is not self-attributed, even with zero cast-begin evidence', () => {
  // Reported live 24 Aug, root-caused from the real raw log rather than guessed - the reporter's
  // own instruction: "memorised is not reliable, 'cast' combat log text is, and this is failing
  // that primary check." Checked, and the cast-begin check WAS working (it correctly IGNORED an
  // earlier cast of the same buff two hours before this one, with "recently cast by Baxa" as
  // the reason). It had nothing to work with for the second landing because there genuinely was no
  // "X begins casting Insight." anywhere in the log for it.
  //
  // What actually happened, found by reading the raw lines around the real landing: an ally
  // (Cade) triggered an instant multi-buff grant hitting the whole group at once - the exact
  // same shape this project already documents for the player's OWN "Quick Buff" (gotchas #12/#18),
  // just triggered by someone else, so nothing here ever opened a burst window for it. Real,
  // verbatim shape from the log - several people getting the same third-person suffix in the same
  // second as the player's own first-person landing, no "begins casting" line for any of them:
  //   "Kibobab's mind sharpens."       (the real line - but "'s mind sharpens." is itself shared by
  //   "Baxa's mind sharpens."        two spells in the roster, so it's a bad example for THIS
  //   "an elemental crusader's..."      test specifically - see the dedicated Insight test below,
  //                                      which uses the exact real spell instead.)
  // Reproduced here with an unambiguous stand-in suffix/text pair so this test isolates the
  // MULTI-RECIPIENT mechanism itself, not roster ambiguity on top of it.
  const { engine, buffStore, log } = makeEngine();
  const known = buffStore.getByName('Adorning Grace');
  assert.ok(known, 'expected Adorning Grace in the roster');
  engine.handleLine(`Kibobab${known.othersLandingSuffix}`);
  engine.handleLine(`Baxa${known.othersLandingSuffix}`);
  engine.handleLine(`an elemental crusader${known.othersLandingSuffix}`);
  engine.handleLine(known.landingText);

  assert.deepEqual(names(engine), [], 'a group-wide grant with no cast-begin evidence still self-attributed');
  assert.ok(
    log.some((m) => m.includes('IGNORED') && m.includes('recently cast')),
    'expected the same recentOtherCasts mechanism the cast-begin line already uses'
  );
});

test('the player\'s OWN AoE group buff landing on allies too is not mistaken for an ally\'s cast', () => {
  // Reported live immediately after the suffix-evidence fix above, and correct: "buffs are aoe,
  // so buffs landing on others does not mean it is their quick buff." A group buff's third-person
  // suffix lands on every groupmate whether the PLAYER cast it or an ally did - the suffix alone
  // can't tell those two apart. Fixed by moving the evidence-recording to run AFTER the two tiers
  // that already know how to explain a third-person landing from the player's own action
  // (recentSelfCast for a named cast, burstUntil for the player's own instant grant) - both
  // consume and RETURN on a match, so by the time the evidence-recording code runs, anything
  // already explained by the player's own recent cast is gone. Only a genuinely UNEXPLAINED
  // third-person landing reaches it.
  const { engine } = makeEngine();
  engine.handleLine('You begin casting Insight.');
  engine.handleLine('Kibobab looks wise.');
  engine.handleLine('Baxa looks wise.');
  engine.handleLine('Your mind fills with wisdom.');
  assert.deepEqual(names(engine), ['Insight'], 'the player\'s own group cast landing on herself was wrongly suppressed');
});

test('the confirmed cause: "Cade activates Quick Buff." opens a window of caution for the player\'s OWN landings', () => {
  // The reporter found the exact line themselves, straight from the chat log, after the
  // suffix-based fix above: "Cade activates Quick Buff." - the SAME instant multi-grant
  // ability gotchas #12/#18 already document for the player's own use ("You activate Quick
  // Buff."), just triggered by an ally. This is the direct, named cause - the suffix-evidence fix
  // above is what catches everything ELSE this same ability drops that doesn't happen to land on
  // another visible person at the same moment.
  const { engine, log } = makeEngine();
  engine.handleLine('Cade activates Quick Buff.');
  engine.handleLine('Your mind fills with wisdom.'); // Insight
  assert.deepEqual(names(engine), [], 'an ally\'s Quick Buff activation did not make the landing suspect');
  assert.ok(log.some((m) => m.includes('ALLY ACTIVATE') && m.includes('Cade') && m.includes('Quick Buff')));
  assert.ok(log.some((m) => m.includes('IGNORED') && m.includes("ally's instant grant")));
});

test('the player\'s OWN Quick Buff activation stays exactly as permissive as before', () => {
  // allyBurstUntil must never suppress anything when it's the PLAYER who triggered the burst -
  // that's burstUntil's job, and it's deliberately permissive (gotcha #12/#18). Regression guard:
  // it would be very easy for these two very-similarly-named flags to get crossed.
  const { engine } = makeEngine();
  engine.handleLine('You activate Quick Buff.');
  engine.handleLine('Your mind fills with wisdom.'); // Insight, never scribed, no spellbook info
  assert.deepEqual(names(engine), ['Insight'], 'the player\'s own burst became suspicious of its own landings');
});

test('the real Insight/Cade case: an out-of-class buff granted with no cast-begin line at all', () => {
  const { engine, buffStore } = makeEngine();
  const insight = buffStore.getByName('Insight');
  assert.ok(insight, 'expected Insight in the roster');
  assert.equal(insight.othersLandingSuffix, ' looks wise.');
  engine.handleLine('Kibobab looks wise.');
  engine.handleLine('Baxa looks wise.');
  engine.handleLine('an elemental crusader looks wise.');
  engine.handleLine(insight.landingText);
  assert.deepEqual(names(engine), [], 'Insight landed on a player whose class cannot even scribe it');
});

test('a third-person landing on just ONE other person is still recorded as evidence (no burst needed)', () => {
  // The multi-recipient case above is what actually happened, but the mechanism does not require
  // several people - a single ally's own buff landing on them is exactly as strong a signal as a
  // "begins casting" line would have been, and cheaper to produce as a test.
  const { engine, buffStore, log } = makeEngine();
  const known = buffStore.getAll().find((e) => e.othersLandingSuffix && e.landingText);
  assert.ok(known, 'expected at least one roster entry with both landing texts');
  engine.handleLine(`Baxa${known.othersLandingSuffix}`);
  engine.handleLine(known.landingText);
  assert.deepEqual(names(engine), [], `"${known.name}" self-attributed despite landing on Baxa moments earlier`);
  assert.ok(log.some((m) => m.includes('IGNORED') && m.includes('recently cast by "Baxa"')));
});

test('an ambiguous third-person suffix does not record evidence for the wrong spell', () => {
  const { engine, buffStore } = makeEngine();
  const shared = {};
  let ambiguousSuffix = null;
  for (const e of buffStore.getAll()) {
    if (!e.othersLandingSuffix) continue;
    (shared[e.othersLandingSuffix] = shared[e.othersLandingSuffix] || []).push(e);
    if (shared[e.othersLandingSuffix].length === 2) ambiguousSuffix = e.othersLandingSuffix;
  }
  assert.ok(ambiguousSuffix, 'expected at least one shared othersLandingSuffix in the roster to test with');
  const candidates = shared[ambiguousSuffix];
  engine.handleLine(`Baxa${ambiguousSuffix}`);
  // Neither candidate's own first-person landing should have been vetoed by an evidence entry
  // recorded for "the wrong one of two possible spells".
  for (const candidate of candidates) {
    if (!candidate.landingText) continue;
    const shares = buffStore.getAll().filter((e) => e.landingText === candidate.landingText).length;
    if (shares !== 1) continue; // only meaningful against a spell whose FIRST-person text is unique
    const { engine: fresh } = makeEngine();
    fresh.handleLine(`Baxa${ambiguousSuffix}`);
    fresh.handleLine(candidate.landingText);
    assert.deepEqual(
      names(fresh),
      [candidate.name],
      `an ambiguous third-person suffix wrongly vetoed "${candidate.name}"`
    );
  }
});

test('a detrimental spell can never land as a self-buff, from ANY tier - not just the spellbook one', () => {
  // Reported live 24 Aug, the SECOND time: "boil blood is a debuff, it should never be in buff
  // tracking... second time so there is a wider problem." The first time (Languid Pace, the test
  // above) was patched by filtering candidates inside the ambiguous-landing-text tier alone -
  // exactly the kind of per-tier point fix CLAUDE.md's P0 section warns collides with the next one.
  // Boil Blood proved it: its landing text ("Your blood boils.") is UNIQUE in the roster, so it
  // never goes anywhere near that tier at all - it lands through the highest-confidence one
  // (findByLandingText), which had no category check of its own.
  //
  // Fixed once, at the one place every self-landing tier already funnels through: _land() itself.
  // A first-person landing line ("Your X.") for a debuff/dot/charm/nuke can only ever mean the
  // player is the TARGET, never the caster - nothing you cast ever lands with your own name on it -
  // so this is a blanket refusal, not another tier-specific guess.
  const { engine, buffStore, log } = makeEngine();
  const boilBlood = buffStore.getByName('Boil Blood');
  assert.ok(boilBlood, 'expected Boil Blood in the roster');
  assert.equal(boilBlood.scaleCategory, 'dot', 'this test only means anything against a real dot-category entry');
  const shared = buffStore.getAll().filter((e) => e.landingText === boilBlood.landingText);
  assert.equal(shared.length, 1, 'expected Boil Blood\'s landing text to be unique - a shared one would exercise the wrong tier');

  engine.handleLine(boilBlood.landingText);

  assert.deepEqual(names(engine), [], 'a mob\'s dot on the player was landed as if it were her own buff');
  assert.ok(
    log.some((m) => m.includes('IGNORED') && m.includes('Boil Blood') && m.includes('detrimental')),
    'expected the blanket _land() guard to explain why, not silently do nothing'
  );
});

test('every detrimental category in the roster is covered by the same guard, not just dot', () => {
  const { engine, buffStore } = makeEngine();
  const categories = ['debuff', 'charm', 'dot', 'nuke'];
  for (const category of categories) {
    const entry = buffStore
      .getAll()
      .find((e) => e.scaleCategory === category && e.landingText && buffStore.getAll().filter((x) => x.landingText === e.landingText).length === 1);
    if (!entry) continue; // fine if the current roster has no unique-text example of this category
    engine.handleLine(entry.landingText);
    assert.equal(
      names(engine).includes(entry.name),
      false,
      `a ${category}-category spell ("${entry.name}") landed as a self-buff`
    );
  }
});

test('the order in the source is spellbook, then gems, then the question', () => {
  // The reorder had one trap: moving the whole spellbook section above the gem check would
  // have dragged with it the block that QUEUES a question when the spellbook leaves more than
  // one candidate - and every line that the gems resolve today would have started asking
  // instead. Only the single-candidate check moved.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'buffEngine.js'), 'utf8');
  const book = src.indexOf('narrowed to 1 by spellbook');
  const gems = src.indexOf('narrowed to 1 by currently-memorized gem');
  const ask = src.indexOf('spellbook narrowed to ${selfCandidates.length} candidates');
  assert.ok(book >= 0 && gems >= 0 && ask >= 0, 'one of the three narrowing paths has gone');
  assert.ok(book < gems, 'the spellbook must be consulted before the gems');
  assert.ok(gems < ask, 'the gems must still get their turn before the user is asked');
});


test('an instant is kept long enough for any aura to want it', () => {
  // The engine holds one for a minute so the most patient aura can still be showing it; how
  // long it is actually DRAWN is the aura setting. Holding for six would have made a longer
  // setting silently impossible.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Alliance'));
  const entry = [...engine.activeBuffs.values()][0];
  const heldSec = Math.round((entry.expiresAt - Date.now()) / 1000);
  assert.ok(heldSec >= 55, `held for only ${heldSec}s - a 60s aura setting could not work`);
});

test('every landing of an instant is a separate event', () => {
  // A nuke cast twice is two events. remainingSec is null for both, so the usual "did the timer
  // go back up" test can never see the second one - the sound would fire once and then stay
  // silent until the entry aged out. landedAt is what distinguishes them.
  const { engine, buffStore } = makeEngine();
  const spell = buffStore.getByName('Alliance');
  engine._land(spell);
  const first = engine.getActiveBuffs()[0].landedAt;
  assert.ok(first, "an instant must record when it happened");

  const entry = [...engine.activeBuffs.values()][0];
  entry.landedAt -= 5000; // stand in for time passing, so the next landing is distinguishable
  engine._land(spell);
  assert.notEqual(engine.getActiveBuffs()[0].landedAt, entry.landedAt, "a second cast must look new");
});

test('an instant is never treated as an already-running buff', () => {
  // The renewal tier exists because an ambiguous landing is usually a renewal of something
  // running. An instant is not running - it is only still in the list because the engine holds
  // it for the text auras - so letting it act as evidence would mean a nuke from a minute ago
  // silently deciding what a later ambiguous line was.
  const src2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'buffEngine.js'), 'utf8');
  const m = src2.match(/const activeCandidate = selfPlausible\.find\(\(c\) => \{([\s\S]*?)\}\);/);
  assert.ok(m, 'the renewal tier has been restructured');
  assert.match(m[1], /!entry\.instant/, 'an instant can still stand in as an active buff');
});
// ---------------------------------------------------------------------------
// Note 28 - making the next occurrence diagnosable
// ---------------------------------------------------------------------------

/**
 * "Ally Buffs showed a buff you never cast."
 *
 * The likeliest cause is a burst: your own activation opens a window, and a landing on a groupmate
 * inside it gets credited to you even though somebody else cast it. That has been unprovable
 * because the log line said only "burst context" - which reads identically whether the landing was
 * genuinely yours or not.
 *
 * The origin and its AGE are now recorded, and the age is the useful half: a landing credited to a
 * burst that opened eight seconds ago is far likelier to be somebody else's cast arriving inside
 * your window than one credited half a second after you pressed something.
 *
 * This does not fix the bug. It makes the next report of it diagnosable from the log she already
 * has, rather than needing the whole thing to happen again under observation.
 */
test('a burst-context ally landing records what opened the burst', () => {
  const { engine, buffStore, log } = makeEngine();
  const pick = buffStore
    .getAll()
    .find((b) => b.othersLandingSuffix && buffStore.findAllByOthersLandingSuffix(b.othersLandingSuffix).length === 1);
  assert.ok(pick, 'no unambiguous third-person landing text in the roster to test with');
  engine.handleLine('[Wed Aug 19 21:14:02 2026] You activate Cannibalize.');
  engine.handleLine(`[Wed Aug 19 21:14:06 2026] Baxa${pick.othersLandingSuffix}`);
  const landed = log.find((l) => l.startsWith('ALLY LANDED'));
  assert.ok(landed, 'the ally landing was not logged at all');
  assert.match(landed, /burst opened [\d.]+s ago by "Cannibalize"/);
});

// A burst can be extended by later landings, and the origin must survive that - otherwise the one
// fact worth logging is overwritten by the very events being explained.
test('extending a burst does not rewrite where it came from', () => {
  const { engine, buffStore, log } = makeEngine();
  const picks = buffStore
    .getAll()
    .filter((b) => b.othersLandingSuffix && buffStore.findAllByOthersLandingSuffix(b.othersLandingSuffix).length === 1)
    .slice(0, 2);
  assert.equal(picks.length, 2, 'need two unambiguous landing texts');
  engine.handleLine('[Wed Aug 19 21:14:02 2026] You activate Cannibalize.');
  engine.handleLine(`[Wed Aug 19 21:14:03 2026] Baxa${picks[0].othersLandingSuffix}`);
  engine.handleLine(`[Wed Aug 19 21:14:04 2026] Nell${picks[1].othersLandingSuffix}`);
  const landings = log.filter((l) => l.startsWith('ALLY LANDED'));
  assert.equal(landings.length, 2);
  for (const line of landings) assert.match(line, /by "Cannibalize"/);
});

test('a landing with no burst behind it says so rather than inventing one', () => {
  const { engine } = makeEngine();
  assert.equal(engine.burstOpenedBy, null);
  assert.match(engine._burstOrigin(), /burst origin unknown/);
});

// Fix 1+2: a groupmate's own melee-proc self-buff ("Korv simmers with fury." - Korv is an ally,
// this is his Fleeting Fury proc from meleeing) shares the same third-person-landing shape as a
// group buff, so a burst that stayed open too long let those procs land as buffs she cast on that
// groupmate. The 30s hard cap is the backstop - a burst older than that can never produce an
// ALLY LANDED however the window itself looks.
test('a burst older than the hard cap cannot produce an ally landing', () => {
  const { engine, buffStore, log } = makeEngine();
  const pick = buffStore
    .getAll()
    .find((b) => b.othersLandingSuffix && buffStore.findAllByOthersLandingSuffix(b.othersLandingSuffix).length === 1);
  assert.ok(pick);
  engine.handleLine('[Wed Aug 19 21:14:02 2026] You activate Cannibalize.');
  engine.burstUntil = Date.now() + 999999;   // pretend something kept the window open
  engine.burstOpenedBy.at -= 45000;          // ...but the burst itself opened 45s ago
  engine.handleLine(`[Wed Aug 19 21:14:47 2026] Korv${pick.othersLandingSuffix}`);
  assert.ok(!log.some((l) => l.startsWith('ALLY LANDED')), 'a stale burst must not credit a proc to the player');
});

// A bard song landing must never re-arm the burst window - they auto-pulse every ~6s forever, so
// letting them extend it is what held the window open for minutes (Fix 1+2).
test('a bard song landing during a burst does not extend the burst window', () => {
  const { engine, buffStore } = makeEngine();
  const song = buffStore.getAll().find((b) => b.landingText
    && buffStore.findAllByLandingText(b.landingText).length === 1);
  assert.ok(song, 'need a spell with unique landing text');
  buffStore.setBardSong(song.name, true); // the tagger runs at startup, not in this fixture
  engine.handleLine('[Wed Aug 19 21:14:02 2026] You activate Quick Buff.');
  const sentinel = Date.now() + 999999;   // a value only a re-arm would overwrite
  engine.burstUntil = sentinel;
  engine.handleLine(`[Wed Aug 19 21:14:04 2026] ${song.landingText}`);
  assert.equal(engine.burstUntil, sentinel, 'a song landing left burstUntil untouched');
});

// Fix 1+2 follow-up: "<name> simmers with fury." is a melee proc that reuses Fleeting Fury's
// flavor text - the roster entry is flagged noBurstAllyAttribution so a proc firing inside a
// genuinely-fresh Quick Buff burst is not logged as a buff she cast on that groupmate.
test('a roster entry flagged noBurstAllyAttribution never ally-lands from a burst', () => {
  const { engine, buffStore, log } = makeEngine();
  const ff = buffStore.getByName('Fleeting Fury');
  assert.ok(ff && ff.noBurstAllyAttribution, 'Fleeting Fury should carry the flag');
  engine.handleLine('[Wed Aug 19 21:14:02 2026] You activate Quick Buff.');
  engine.handleLine(`[Wed Aug 19 21:14:03 2026] Korv${ff.othersLandingSuffix}`);
  assert.ok(!log.some((l) => l.startsWith('ALLY LANDED')), 'a flagged proc-collider must not ally-land');
  assert.ok(log.some((l) => l.includes('noBurstAllyAttribution')));
});

// The same fresh burst, but for a spell a groupmate was just seen self-casting - their own
// self-buff landing, not something the player granted. (Legit player group-casts set
// recentSelfCast, not recentOtherCasts, so those still land.)
test('a burst ally-landing is skipped when the recipient was just seen self-casting it', () => {
  const { engine, buffStore, log } = makeEngine();
  const pick = buffStore
    .getAll()
    .find((b) => b.othersLandingSuffix
      && !b.noBurstAllyAttribution
      && buffStore.findAllByOthersLandingSuffix(b.othersLandingSuffix).length === 1);
  assert.ok(pick);
  engine.handleLine(`[Wed Aug 19 21:14:00 2026] Rwek begins casting ${pick.name}.`);
  engine.handleLine('[Wed Aug 19 21:14:02 2026] You activate Quick Buff.');
  engine.handleLine(`[Wed Aug 19 21:14:03 2026] Rwek${pick.othersLandingSuffix}`);
  assert.ok(!log.some((l) => l.startsWith('ALLY LANDED')), "the groupmate's own self-buff was credited to the player");
  assert.ok(log.some((l) => l.includes('was just seen self-casting it')));
});

// ...but only recently. recentOtherCasts is a whole-session memory, so an old self-cast by a
// groupmate must NOT retroactively suppress a burst landing (the player may genuinely have
// group-cast it since - Infusion of Spirit: player casts 13:18, groupmate self-casts 00:04+1d).
test('a stale other-cast does not suppress a burst ally-landing', () => {
  const { engine, buffStore, log } = makeEngine();
  const pick = buffStore
    .getAll()
    .find((b) => b.othersLandingSuffix
      && !b.noBurstAllyAttribution
      && buffStore.findAllByOthersLandingSuffix(b.othersLandingSuffix).length === 1);
  assert.ok(pick);
  engine.handleLine(`[Wed Aug 19 21:00:00 2026] Rwek begins casting ${pick.name}.`);
  engine.recentOtherCastAt.set(pick.name.toLowerCase(), Date.now() - 90000); // 90s ago
  engine.handleLine('[Wed Aug 19 21:14:02 2026] You activate Quick Buff.');
  engine.handleLine(`[Wed Aug 19 21:14:03 2026] Rwek${pick.othersLandingSuffix}`);
  assert.ok(log.some((l) => l.startsWith('ALLY LANDED')), 'a stale self-cast wrongly suppressed the landing');
});
module.exports = () => report('detection');
if (require.main === module) report('detection').then((n) => process.exit(n ? 1 : 0));
