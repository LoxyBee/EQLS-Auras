'use strict';
/**
 * Note 19 - the damage parser.
 *
 * Two things are being tested here and they are worth naming separately.
 *
 * FIRST, that the line patterns match the wordings that are actually in the owner's logs. Every
 * literal line in this file was copied out of them, not written from memory. That distinction is
 * the whole reason this suite exists in the shape it does: the last time this codebase wrote log
 * patterns from memory, nine of twelve matched nothing across 1.5 million lines and the feature
 * they powered had never once fired, while its tests - written from the same memory - all passed.
 * A test that agrees with a wrong pattern proves nothing.
 *
 * SECOND, that the friend/enemy bootstrap does what its comment claims. That is the part with real
 * logic in it, and the part where a plausible-looking mistake would quietly halve the numbers.
 *
 * Both import the real modules. Nothing here reimplements a rule in order to check it - a
 * reproduced copy passed four times in this project while the real rule was inverted.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { parseDamageLine } = require('../src/shared/damageLines');
const { DamageEngine, formatDamage } = require('../src/main/damageEngine');

const T = '[Wed Aug 19 21:14:02 2026] ';

// ---------------------------------------------------------------------------
// The line patterns
// ---------------------------------------------------------------------------

test('your own spell damage names you as the attacker', () => {
  const hit = parseDamageLine(`${T}Fright has taken 394 damage from your Envenomed Bolt IV.`);
  assert.deepEqual(hit, { attacker: 'You', target: 'Fright', amount: 394, kind: 'spell', skill: 'Envenomed Bolt IV', critical: false });
});

test('your own melee damage names you as the attacker', () => {
  const hit = parseDamageLine(`${T}You crush a wan ghoul knight for 60 points of damage.`);
  assert.deepEqual(hit, { attacker: 'You', target: 'a wan ghoul knight', amount: 60, kind: 'melee', skill: 'Melee', critical: false });
});

// The single most important case in the file. 44,508 lines in the owner's logs have an
// apostrophe-s inside the SPELL name, and the obvious reading - that the possessive names the
// caster - is wrong on every one of them. The "by" suffix is the attacker.
test("a possessive in the spell name is not the caster", () => {
  const hit = parseDamageLine(
    `${T}A pledge familiar has taken 32 damage from Denon's Disruptive Discord V by Baxa.`
  );
  assert.equal(hit.attacker, 'Baxa', 'the name after "by" is the attacker');
  assert.equal(hit.target, 'A pledge familiar');
  assert.equal(hit.amount, 32);
});

// And here the possessive IS the attacker - the opposite of the line above. The two shapes were
// measured separately for exactly this reason.
test('a damage shield credits the person wearing it', () => {
  const hit = parseDamageLine(
    `${T}A zol ghoul knight is pierced by Baxa's thorns for 8 points of non-melee damage.`
  );
  assert.deepEqual(hit, { attacker: 'Baxa', target: 'A zol ghoul knight', amount: 8, kind: 'shield', skill: 'thorns', critical: false });
});

test('someone else melee is read with both sides', () => {
  const hit = parseDamageLine(`${T}Baxa slashes a zol ghoul knight for 47 points of damage.`);
  assert.deepEqual(hit, { attacker: 'Baxa', target: 'a zol ghoul knight', amount: 47, kind: 'melee', skill: 'Melee', critical: false });
});

test('a monster casting a spell is read the same way, attacker and all', () => {
  const hit = parseDamageLine(`${T}Baxa has taken 40 damage from Heat Blood by a soul seductress.`);
  assert.equal(hit.attacker, 'a soul seductress');
  assert.equal(hit.target, 'Baxa');
});

// "You gain party experience!!" begins with "You gain" and contains no damage. An earlier,
// looser pattern counted 2,990 experience lines as melee swings.
test('lines that are not damage are not damage', () => {
  for (const line of [
    'You gain party experience!!',
    'You have gained a level!',
    'Your Plague III spell has worn off of Fright.',
    'A zol ghoul knight has been slain by Baxa!',
    '',
  ]) {
    assert.equal(parseDamageLine(`${T}${line}`), null, `should not parse: ${line}`);
  }
});

test('a line with no timestamp still parses', () => {
  // The replay tools and the snapshot path both hand over bare lines.
  assert.equal(parseDamageLine('You crush a wan ghoul knight for 60 points of damage.').amount, 60);
});

// Cross-checked against a second EQ Legends parser + fixture corpus. `cleaves` (warrior) and
// `frenzies on` (berserker/monk) alone are ~5% of all melee and were silently uncounted; the
// rarer additions (backstabs, smites, ...) are real too. "frenzies on" carries its "on".
test('the melee verbs added from the fixture cross-check all parse', () => {
  assert.deepEqual(
    parseDamageLine(`${T}Baxa cleaves a zol ghoul knight for 88 points of damage.`),
    { attacker: 'Baxa', target: 'a zol ghoul knight', amount: 88, kind: 'melee', skill: 'Melee', critical: false }
  );
  assert.deepEqual(
    parseDamageLine(`${T}Krung frenzies on a zol ghoul knight for 21 points of damage.`),
    { attacker: 'Krung', target: 'a zol ghoul knight', amount: 21, kind: 'melee', skill: 'Melee', critical: false }
  );
  assert.deepEqual(
    parseDamageLine(`${T}Sneaky backstabs a wan ghoul knight for 512 points of damage.`),
    { attacker: 'Sneaky', target: 'a wan ghoul knight', amount: 512, kind: 'melee', skill: 'Melee', critical: false }
  );
});

// When the PLAYER holds the damage shield, EQ writes "YOUR", not a possessive - almost every DS
// line in the fixture corpus is this form, and the old `(.+?)'s` matched about 1 in 20.
test('a damage shield worn by the player is credited to You', () => {
  assert.deepEqual(
    parseDamageLine(`${T}A rock golem is pierced by YOUR thorns for 5 points of non-melee damage.`),
    { attacker: 'You', target: 'A rock golem', amount: 5, kind: 'shield', skill: 'thorns', critical: false }
  );
});

// EQ space-pads a single-digit day: "[Fri Aug  1 21:00:00 2026]" is two spaces and one digit.
// The old `\d{2}` + single-space stamp matched none of these, so the meter was dark for the
// first nine days of every month.
test('a single-digit-day timestamp is still stripped', () => {
  assert.deepEqual(
    parseDamageLine(`[Fri Aug  1 21:00:00 2026] You crush a wan ghoul knight for 60 points of damage.`),
    { attacker: 'You', target: 'a wan ghoul knight', amount: 60, kind: 'melee', skill: 'Melee', critical: false }
  );
});

// The direct-nuke wording - ~21,000 lines the meter was blind to. A nuking loadout's whole
// output arrives this way, so the caster was simply absent from the meter.
test('the direct-damage-spell wording is read, first and third person', () => {
  assert.deepEqual(
    parseDamageLine(`${T}You hit a greater kobold for 943 points of magic damage by Energy Storm.`),
    { attacker: 'You', target: 'a greater kobold', amount: 943, kind: 'spell', direct: true, skill: 'Energy Storm', critical: false }
  );
  assert.deepEqual(
    parseDamageLine(`${T}Gebektik hit Guard Xyxax for 42 points of magic damage by Lifebite.`),
    { attacker: 'Gebektik', target: 'Guard Xyxax', amount: 42, kind: 'spell', direct: true, skill: 'Lifebite', critical: false }
  );
});

test('a trailing " (Critical)" (or "(Riposte)") does not drop the hit', () => {
  assert.equal(
    parseDamageLine(`${T}You hit a lava guardian for 943 points of fire damage by Energy Storm. (Critical)`).amount,
    943
  );
  assert.equal(
    parseDamageLine(`${T}A zol ghoul knight has taken 32 damage from Ice Comet by Baxa. (Critical)`).attacker,
    'Baxa'
  );
  assert.equal(
    parseDamageLine(`${T}Baxa crushes a zol ghoul knight for 47 points of damage. (Riposte)`).amount,
    47
  );
});

// Owner, 13 Sep - crit rate on the per-skill breakdown. The game brackets several different things
// the same way ("(Critical)", "(Riposte)", "(Strikethrough)", ...); only the exact word "Critical"
// means a crit; the others must read as false, not just "truthy suffix present".
test('critical is true only for the exact "(Critical)" suffix, across every wording that carries one', () => {
  assert.equal(
    parseDamageLine(`${T}You hit a lava guardian for 943 points of fire damage by Energy Storm. (Critical)`).critical,
    true
  );
  assert.equal(
    parseDamageLine(`${T}Gebektik hit Guard Xyxax for 42 points of magic damage by Lifebite. (Critical)`).critical,
    true
  );
  assert.equal(
    parseDamageLine(`${T}Baxa crushes a zol ghoul knight for 88 points of damage. (Critical)`).critical,
    true
  );
  assert.equal(
    parseDamageLine(`${T}You crush a wan ghoul knight for 60 points of damage. (Critical)`).critical,
    true
  );
  assert.equal(
    parseDamageLine(`${T}A zol ghoul knight has taken 32 damage from Ice Comet by Baxa. (Critical)`).critical,
    true
  );
  assert.equal(
    parseDamageLine(`${T}Fright has taken 394 damage from your Envenomed Bolt IV. (Critical)`).critical,
    true
  );
});

test('a "(Riposte)"/"(Strikethrough)" suffix is not mistaken for a crit', () => {
  assert.equal(
    parseDamageLine(`${T}Baxa crushes a zol ghoul knight for 47 points of damage. (Riposte)`).critical,
    false
  );
  assert.equal(
    parseDamageLine(`${T}Baxa crushes a zol ghoul knight for 47 points of damage. (Strikethrough)`).critical,
    false
  );
});

test('an ordinary hit with no bracketed suffix at all is not a crit', () => {
  assert.equal(
    parseDamageLine(`${T}Baxa crushes a zol ghoul knight for 47 points of damage.`).critical,
    false
  );
});

// Damage shields are pure retaliation - the game never crit-flags them.
test('a damage shield is never a crit', () => {
  assert.equal(
    parseDamageLine(`${T}A zol ghoul knight is pierced by Baxa's thorns for 8 points of non-melee damage.`).critical,
    false
  );
});

test('"You hit yourself ... by Cannibalization" is NOT outgoing damage', () => {
  // Cannibalize's HP->mana self-cost. Counting it would make the bootstrap tag "yourself" an enemy.
  assert.equal(
    parseDamageLine(`${T}You hit yourself for 1864 points of unresistable damage by Cannibalization Rk. II.`),
    null
  );
});

test('the direct-spell wording does not collide with melee or the "has taken" wordings', () => {
  // melee has no "by <spell>", "has taken" has no " hit ... for N points of <type>"
  assert.equal(parseDamageLine(`${T}Baxa slashes a zol ghoul knight for 47 points of damage.`).kind, 'melee');
  assert.equal(parseDamageLine(`${T}Fright has taken 394 damage from your Envenomed Bolt IV.`).attacker, 'You');
});

// ---------------------------------------------------------------------------
// The friend/enemy bootstrap
// ---------------------------------------------------------------------------

// Rule 1. Nothing is known at the start except that you are on your own side.
test('your own damage proves its target is an enemy', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  assert.ok(e.enemies.has('fright'));
  assert.equal(e.byAttacker.get('You').damage, 100);
});

// Rule 2, and the reason the meter is not just a self-parser.
test('anyone damaging a known enemy is counted as a friend', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes Fright for 300 points of damage.`, 1000);
  assert.ok(e.friends.has('baxa'));
  assert.equal(e.byAttacker.get('Baxa').damage, 300);
});

// Rule 3, and the one that took the credited share of a real log day from 22% to 65%. Without it,
// a groupmate fighting mobs you never personally touch contributes nothing.
test('anyone damaging a known friend is an enemy, and their damage is not counted', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes Fright for 300 points of damage.`, 1000);
  // Baxa is now known to be a person. So whatever hits him is a monster...
  e.handleLine(`${T}A flouting gargoyle hits Baxa for 31 points of damage.`, 1000);
  assert.ok(e.enemies.has('a flouting gargoyle'));
  assert.equal(e.byAttacker.has('A flouting gargoyle'), false, 'incoming damage must not be counted');
  // ...and now that the gargoyle is known to be a monster, Baxa hitting IT counts, even though
  // you never touched it yourself. This is the chain the note needed.
  e.handleLine(`${T}Baxa slashes A flouting gargoyle for 55 points of damage.`, 1000);
  assert.equal(e.byAttacker.get('Baxa').damage, 355);
});

test('damage aimed at you is never counted as damage you did', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Fright hits YOU for 31 points of damage.`, 1000);
  assert.equal(e.byAttacker.get('You').damage, 100, 'the 31 was incoming');
  assert.equal(e.totalDamage, 100);
});

// The opening seconds of a pull, which arrive before anything has proved the mob is a mob.
test('lines held before the mob was known are credited once it is', () => {
  const e = new DamageEngine();
  // Nothing is known yet, so neither of these can be placed.
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 200 points of damage.`, 1000);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 100 points of damage.`, 1000);
  assert.equal(e.totalDamage, 0);
  assert.equal(e.pending.length, 2);
  // Now you hit it, which proves what it is - and the two held lines belong to this fight.
  e.handleLine(`${T}a zol ghoul knight has taken 50 damage from your Plague III.`, 2000);
  assert.equal(e.totalDamage, 350, 'the two held lines were credited too');
  assert.equal(e.pending.length, 0);
});

test('a held line older than the fight timeout is dropped, not credited', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 999 points of damage.`, 1000);
  // Thirty seconds later. That hit belonged to some earlier fight, not this one.
  e.handleLine(`${T}a zol ghoul knight has taken 50 damage from your Plague III.`, 31000);
  assert.equal(e.totalDamage, 50);
});

// The log writes your name two different ways depending on which side of the verb you are on.
test('the shouted YOU is the same person as You', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle hits YOU for 31 points of damage.`, 1000);
  assert.ok(e.enemies.has('a flouting gargoyle'), 'hitting you makes it an enemy without you acting');
  assert.equal(e.totalDamage, 0, 'but being hit is not damage you did');
});

// ---------------------------------------------------------------------------
// Fights
// ---------------------------------------------------------------------------

test('a fight ends after the timeout and the meter falls back to the since-zone tally', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  assert.equal(e.getActive(1000).length, 2); // Total + You
  assert.equal(e.getActive(1000)[1].name, 'Total', 'labelled as the current fight');
  e.tick(5000);
  assert.equal(e.getActive(5000).length, 2, 'still inside the timeout');
  e.tick(20000);
  // The fight is over, but "since zone-in" keeps the number on screen between pulls.
  const after = e.getActive(20000);
  assert.equal(after.length, 2);
  assert.equal(after[after.length - 1].name, 'Total');
  assert.equal(after[after.length - 1].sinceZone, true);
  // Only a zone line wipes it.
  e.enterZone(21000);
  assert.deepEqual(e.getActive(21000), []);
});

test('a DoT / melody-song tick does not hold the fight open past the last real hit', () => {
  // Owner, 5 Sep: a maintained DoT (or a /melody-cast song) ticking on a straggler every ~6s kept
  // the meter's fight from ever closing. The fight now ends timeoutSec after the last MELEE or
  // directly-cast NUKE; ticks are still credited but do not reset the timer.
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You crush a wan ghoul knight for 200 points of damage.`, 1000); // a real hit
  e.handleLine(`${T}a wan ghoul knight has taken 40 damage from your Ignite.`, 6000);
  // A DoT tick 12s after the crush: the fight has already ended (10s after the last real hit),
  // so the crush + the early tick are gone and only this straggler tick is live.
  e.handleLine(`${T}a wan ghoul knight has taken 40 damage from your Ignite.`, 13000);
  e.tick(13000);
  assert.equal(e.totalDamage, 40, 'the crush (200) and the 6s tick fell out when the fight ended');
});

// Owner, 16 Sep, reported live: a Plane of Fear raid (Cazic-Thule + adds) got split into 3
// separate fights by a periodic Dragon Fear - everyone in the group feared ("You lose control of
// yourself!") for several seconds at a time, stopping the GROUP's own melee/nukes, while the mob
// side kept swinging the whole time. The fight-end timer only ever watched the group's OWN real
// hits (_credit() is only called for dir === 'out'), so that incoming combat did nothing to keep
// it alive - "it's supposed to also count the enemies hits to stay in combat, not just allies."
test('an enemy landing a real hit on the group keeps the fight open too, not just the group\'s own hits', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You slash Cazic-Thule for 100 points of damage.`, 1000);
  // 6s later: nothing from the group's own side, but the mob is still swinging (feared/kiting,
  // say) - a real melee hit, the group's incoming twin of a real outgoing hit.
  e.handleLine(`${T}Cazic-Thule hits YOU for 60 points of damage.`, 7000);
  // 9s after THAT incoming hit (under the 10s timeout) - the group's own damage resumes. Without
  // counting the incoming hit, the gap since the group's last real hit would read as 15s (past
  // timeout) and this would incorrectly start a brand new fight instead of continuing the same one.
  e.handleLine(`${T}You slash Cazic-Thule for 50 points of damage.`, 16000);
  assert.equal(e.getHistory().length, 0, 'the fight must never have been force-closed and captured');
  assert.equal(e.totalDamage, 150, 'one continuous fight - both outgoing hits credited to it');
});

test('an incoming DoT tick (poison/disease ticking on the group) does NOT hold the fight open on its own', () => {
  // Symmetric to the outgoing-DoT test above - a mob's maintained DoT ticking on a straggler after
  // the real fighting has stopped must not hold a finished fight open forever either.
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You slash Cazic-Thule for 100 points of damage.`, 1000);
  // An incoming DoT tick 13s after the last real hit - a "has taken ... by" wording, not melee/direct.
  e.handleLine(`${T}YOU has taken 100 damage from Rotting Flesh by a dracoliche.`, 14000);
  e.tick(14000);
  assert.equal(e.getHistory().length, 1, 'the DoT tick alone should not have kept the old fight open');
});

// Owner, 16 Sep: "can the timer just be paused when under a fear effect?" - a raid-wide Dragon
// Fear was stopping BOTH sides at once (feared raiders can't reach anything to hit, so incoming
// hits went quiet too - the previous fix alone would not have saved this one), so the fight-idle
// clock genuinely pauses now while the player can't act at all, rather than just measuring a
// longer window against it.
test('the fight-idle clock pauses entirely while the player is feared/stunned/mezzed/charmed', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You slash Cazic-Thule for 100 points of damage.`, 1000);
  e.handleLine(`${T}A dracoliche begins casting Dragon Fear.`, 2000);
  // The generic loss-of-control line - Dragon Fear has no roster entry of its own.
  e.handleLine(`${T}You lose control of yourself!`, 2000);
  // 13s of total silence, both directions - past the 10s timeout, but paused.
  // Confirmed live: this specific spell's OWN end line ("You are no longer afraid.") does not
  // match the generic land line's "official" pairing ("You have control of yourself again.") -
  // the pause has to clear on ANY recognized end line, not just that one entry's own.
  e.handleLine(`${T}You are no longer afraid.`, 15000);
  e.handleLine(`${T}You slash Cazic-Thule for 50 points of damage.`, 1000);
  assert.equal(e.getHistory().length, 0, 'the fear must not have force-closed the fight');
  assert.equal(e.totalDamage, 150, 'one continuous fight - both hits credited to it');
});

test('a missed/unrecognized "control regained" line cannot pause the fight forever - the safety net still fires', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You slash Cazic-Thule for 100 points of damage.`, 1000);
  e.handleLine(`${T}You lose control of yourself!`, 2000);
  // No end line ever arrives. Well past the 45s safety net (the longest pausesCombat entry).
  e.handleLine(`${T}You slash Cazic-Thule for 50 points of damage.`, 50000);
  assert.equal(e.getHistory().length, 1, 'the old fight should have been closed once the safety net expired');
  assert.equal(e.totalDamage, 50, 'a fresh fight, not a continuation of the stale one');
});

test('being rooted or snared does NOT pause the fight clock - you can still swing and cast through either', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You slash Cazic-Thule for 100 points of damage.`, 1000);
  e.handleLine(`${T}You are ensnared.`, 2000);
  // 15s of silence - past the timeout, and a snare must not paper over it.
  e.handleLine(`${T}You slash Cazic-Thule for 50 points of damage.`, 17000);
  assert.equal(e.getHistory().length, 1, 'a snare incorrectly paused the fight clock');
  assert.equal(e.totalDamage, 50, 'a fresh fight, not a continuation of the timed-out one');
});

test("a known friend's melee on a fresh article-prefixed mob is credited without waiting on the player", () => {
  // Owner, 10 Sep: after a group reform the roster resets, so a groupmate's melee on the next pull
  // sat unclassified until the player's own (slow, AE) damage landed - 30s+ for a bard - and the
  // meter showed no fight in between. A known friend hitting an "a/an/the <mob>" name proves the
  // mob hostile now, since an article name is always a mob (gotcha #20).
  const e = new DamageEngine();
  // Baxa is learned a friend the ordinary way (hitting a mob the player already tagged).
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes Fright for 300 points of damage.`, 1000);
  assert.ok(e.friends.has('baxa'));

  // Now a brand-new pull. The player has not touched "a phantasm" at all yet.
  e.handleLine(`${T}Baxa slashes a phantasm for 250 points of damage.`, 5000);
  assert.ok(e.enemies.has('a phantasm'), 'the mob was proven hostile by Baxa hitting it');
  assert.equal(e.byAttacker.get('Baxa').damage, 550, "Baxa's melee on it counts immediately");
});

test("the friend-hits-mob rule never fires on a player-shaped target, or off a damage shield", () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes Fright for 300 points of damage.`, 1000);
  // A one-word target (could be a player) is NOT auto-tagged an enemy off a friend's hit.
  e.handleLine(`${T}Baxa slashes Zorrick for 40 points of damage.`, 2000);
  assert.ok(!e.enemies.has('zorrick'), 'friendly fire is not a mob');
  // A damage-shield line ("burned by ... flames") never teaches.
  e.handleLine(`${T}Baxa is burned by a phantasm's flames for 13 points of non-melee damage.`, 3000);
  assert.ok(!e.enemies.has('a phantasm'), 'a DS line does not tag the shield holder');
});

test('a fight is not ended while unclassified combat is still flowing', () => {
  // Owner, 10 Sep: "combat ending even when i'm dealing damage, avenrae attacking, ongoing." Right
  // after a group reform, a groupmate's melee stays pending until the player personally hits the
  // mob. Ending the fight in that gap - and dropping the held lines with it - is the bug.
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You crush Fright for 500 points of damage.`, 1000); // an old fight
  e.tick(1000);
  // 15s later: the old fight has timed out, but an UNCLASSIFIABLE groupmate is meleeing a fresh
  // mob (name not yet a known enemy, mate not yet a known friend - a plain melee, no article).
  e.handleLine(`${T}Newmate slashes Somemob for 120 points of damage.`, 16000);
  e.handleLine(`${T}Newmate slashes Somemob for 90 points of damage.`, 18000);
  e.tick(19000);
  assert.equal(e.pending.length, 2, 'the held lines are not thrown away while combat is live');
  // The player finally lands their slow AE - the held lines belong to this fight.
  e.handleLine(`${T}Somemob has taken 300 damage from your Plague III.`, 20000);
  assert.equal(e.byAttacker.get('Newmate').damage, 210, 'nothing was lost to a premature fight end');
});

test('a directly-cast nuke DOES hold the fight open (it is a real hit)', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You hit a wan ghoul knight for 900 points of fire damage by Lava Storm.`, 1000);
  e.handleLine(`${T}You hit a wan ghoul knight for 900 points of fire damage by Lava Storm.`, 8000);
  e.tick(12000);
  const total = e.getActive(12000)[e.getActive(12000).length - 1];
  assert.ok(!total.sinceZone, 'still the current fight - the last nuke was only 4s ago');
});

test('a new fight starts clean rather than adding to the last one', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Fright has taken 700 damage from your Plague III.`, 60000);
  assert.equal(e.totalDamage, 700, 'the first fight is over and does not carry forward');
});

// Forgetting them would make every pull re-bootstrap from your own first hit, losing the opening
// of each one - which is the gap the bootstrap exists to close.
test('a fight ending does not forget which things are enemies', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.tick(60000);
  assert.ok(e.enemies.has('fright'), 'still known to be a monster');
  // So a groupmate opening the next pull on it counts from the very first swing.
  e.handleLine(`${T}Baxa slashes Fright for 42 points of damage.`, 61000);
  assert.equal(e.byAttacker.get('Baxa').damage, 42);
});

test('the timeout is clamped rather than trusted', () => {
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 0 });
  assert.ok(e.timeoutSec >= 1, 'a zero timeout would end every fight the instant it began');
  e.setOptions({ fightTimeoutSec: 99999 });
  assert.ok(e.timeoutSec <= 600);
  e.setOptions({ fightTimeoutSec: Number.NaN });
  assert.ok(Number.isFinite(e.timeoutSec));
});

// ---------------------------------------------------------------------------
// The rows the overlay draws
// ---------------------------------------------------------------------------

test('rows are biggest first, with the total LAST and bar-less', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes Fright for 300 points of damage.`, 1000);
  const rows = e.getActive(1000);
  assert.deepEqual(rows.map((r) => r.name), ['Baxa', 'You', 'Total'], 'total sits at the bottom now');
  assert.equal(rows[0].valueText, '300');
  assert.equal(rows[0].pctText, '75%', 'the share rides its own column now');
  assert.equal(rows[1].valueText, '100');
  assert.equal(rows[1].pctText, '25%');
  const total = rows[2];
  assert.equal(total.noBar, true, 'the total is a plain label + value, no bar');
  assert.equal(total.barPercent, null);
});

// The two fields that let a damage row reuse the buff renderer, and the reason no second renderer
// was written. If either name changes, the meter silently draws countdowns instead of numbers.
test('a row carries valueText and barPercent and no timer', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  const row = e.getActive(1000).find((r) => r.name === 'You');
  assert.equal(typeof row.valueText, 'string');
  assert.equal(typeof row.barPercent, 'number');
  assert.equal(row.remainingSec, null, 'nothing here counts down');
  assert.equal(row.instant, false, 'and nothing here is an instant, which would make it beep');
});

test('the bar shows each row against the biggest, not against the total', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes Fright for 300 points of damage.`, 1000);
  const rows = e.getActive(1000);
  assert.equal(rows.find((r) => r.name === 'Baxa').barPercent, 100, 'the biggest row fills its bar');
  assert.ok(Math.abs(rows.find((r) => r.name === 'You').barPercent - 33.33) < 0.1);
});

test('each attacker row carries all three value readings, using the same fight length as the total', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}a kobold has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes a kobold for 300 points of damage.`, 5000); // 4s span
  const rows = e.getActive(5000);
  const baxa = rows.find((r) => r.name === 'Baxa');
  assert.equal(baxa.valueText, '300', "'total' - cumulative damage");
  assert.equal(baxa.dpsText, '75/s', "'dps' - attacker damage / the fight span");
  assert.equal(baxa.bothText, '300 (75/s)', "'both' - damage (rate)");
  assert.equal(baxa.pctText, '75%', 'the share is its own field / column');
  // the total row always shows both, so it only needs valueText
  assert.equal(rows.find((r) => r.name === 'Total').dpsText, undefined);
  assert.equal(rows.find((r) => r.name === 'Total').bothText, undefined);
});

test('an idle engine draws nothing at all', () => {
  assert.deepEqual(new DamageEngine().getActive(1000), []);
});

// A fight one second long divided a total by a zero-length window before this was clamped.
test('the rate on the first hit of a fight is a number', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fright has taken 100 damage from your Plague III.`, 1000);
  const total = e.getActive(1000).find((r) => r.name === 'Total');
  assert.match(total.valueText, /100\/s$/);
  assert.ok(!/Infinity|NaN/.test(total.valueText));
});

test('big numbers shorten and small ones do not', () => {
  assert.equal(formatDamage(999), '999');
  assert.equal(formatDamage(9999), '9999');
  assert.equal(formatDamage(10000), '10.0k');
  assert.equal(formatDamage(195700), '195.7k');
  assert.equal(formatDamage(2500000), '2.50m');
});

// ---------------------------------------------------------------------------
// Seeding from debuffs, for a character who does not attack
// ---------------------------------------------------------------------------

test('something you merely mezzed counts as an enemy', () => {
  const e = new DamageEngine();
  e.setKnownEnemiesFn(() => ['a zol ghoul knight']);
  // No attack of your own anywhere - this character only debuffs.
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 47 points of damage.`, 1000);
  assert.equal(e.byAttacker.get('Baxa').damage, 47);
});

test('the enemy seed is read live, not copied once', () => {
  const e = new DamageEngine();
  let mezzed = [];
  e.setKnownEnemiesFn(() => mezzed);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 47 points of damage.`, 1000);
  assert.equal(e.totalDamage, 0, 'nothing known yet');
  mezzed = ['a zol ghoul knight'];
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 10 points of damage.`, 1500);
  assert.equal(e.totalDamage, 57, 'the held line was credited once the mez was known');
});

// ---------------------------------------------------------------------------
// Scopes: whole fight / just my group / just me  (feat/group-roster-and-charm-pets)
// ---------------------------------------------------------------------------

function seedFight(e) {
  // You hit the mob (rule 1), a groupmate and a stranger both also hit it (rule 2).
  e.handleLine(`${T}a zol ghoul knight has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 300 points of damage.`, 1000);
  e.handleLine(`${T}Enro slashes a zol ghoul knight for 600 points of damage.`, 1000);
}

test("scope 'all' is unchanged - everyone counts, % over the whole fight", () => {
  const e = new DamageEngine();
  seedFight(e);
  const rows = e.getActive(1000, 'all');
  const total = rows.find((r) => r.totalRow);
  assert.match(total.valueText, /^1000/);
  assert.equal(rows.find((r) => r.name === 'Enro').valueText, '600');
});

test("scope 'group' counts only admitted names and recomputes the denominator", () => {
  const e = new DamageEngine();
  e.setGroupFn(() => ['baxa']); // Baxa is in the group, Enro is a stranger
  seedFight(e);
  const rows = e.getActive(1000, 'group');
  assert.equal(rows.find((r) => r.name === 'Enro'), undefined, 'the stranger is not shown');
  const total = rows.find((r) => r.totalRow);
  assert.match(total.valueText, /^400/, 'total is You + Baxa only, not 1000');
  assert.equal(rows.find((r) => r.name === 'Baxa').valueText, '300');
});

test("scope 'group' with no roster falls back to the whole fight, flagged", () => {
  const e = new DamageEngine();
  seedFight(e);
  const rows = e.getActive(1000, 'group');
  const total = rows.find((r) => r.totalRow);
  assert.equal(total.scopeFellBack, true);
  assert.match(total.valueText, /^1000/);
});

test("scope 'mine' is you plus your charmed pets only", () => {
  const e = new DamageEngine();
  e.setPetsFn(() => ({
    ownPetKeyByName: new Map([['a spite golem', 'a spite golem#1']]),
    unknownPetNames: new Set(),
    allyPetLeader: new Map(),
  }));
  seedFight(e);
  e.handleLine(`${T}a spite golem has taken 50 damage from a zol ghoul knight.`, 1000); // pet vs mob
  e.handleLine(`${T}a spite golem slashes a zol ghoul knight for 50 points of damage.`, 1000);
  const rows = e.getActive(1000, 'mine');
  const names = rows.filter((r) => !r.totalRow).map((r) => r.name).sort();
  assert.deepEqual(names, ['You', 'a spite golem#1']);
});

// ---------------------------------------------------------------------------
// Charmed pets
// ---------------------------------------------------------------------------

test('an own charmed pet is its own labelled row, kept distinct by generation', () => {
  const e = new DamageEngine();
  e.setPetsFn(() => ({
    ownPetKeyByName: new Map([['a spite golem', 'a spite golem#2']]),
    unknownPetNames: new Set(),
    allyPetLeader: new Map(),
  }));
  e.handleLine(`${T}a zol ghoul knight has taken 10 damage from your Plague III.`, 1000);
  e.handleLine(`${T}a spite golem slashes a zol ghoul knight for 200 points of damage.`, 1000);
  const row = e.getActive(1000, 'all').find((r) => r.name === 'a spite golem#2');
  assert.ok(row && row.isPet);
});

test('unknown-owner charmed pets fold into one "Charmed pets" row', () => {
  const e = new DamageEngine();
  e.setPetsFn(() => ({
    ownPetKeyByName: new Map(),
    unknownPetNames: new Set(['a spite golem', 'a stone golem']),
    allyPetLeader: new Map(),
  }));
  e.handleLine(`${T}a zol ghoul knight has taken 10 damage from your Plague III.`, 1000);
  e.handleLine(`${T}a spite golem slashes a zol ghoul knight for 100 points of damage.`, 1000);
  e.handleLine(`${T}a stone golem slashes a zol ghoul knight for 100 points of damage.`, 1000);
  const rows = e.getActive(1000, 'all');
  const pets = rows.filter((r) => r.unknownPets);
  assert.equal(pets.length, 1);
  assert.match(pets[0].valueText, /^200/);
});

// Owner, 3 Sep: "i want all the damage separated on the backend, so that when something happens
// that can retroactively split this ... it isn't lost." Every hit's attacker is tallied raw,
// regardless of classification, so a groupmate recognised late shows their FULL damage - not just
// what landed after the app worked out who they were.
test('a groupmate learned late gets their complete damage, not just what came after', () => {
  const e = new DamageEngine();
  // No roster, nothing seeded. Avenrae fights a mob the player never touches - unclassifiable, so
  // it would normally sit in `pending` and be dropped after the fight timeout.
  e.handleLine(`${T}Avenrae slashes a lockjaw for 500 points of damage.`, 1000);
  e.handleLine(`${T}Avenrae slashes a lockjaw for 500 points of damage.`, 2000);
  // Now the player tags the mob AND Avenrae is confirmed a group member.
  e.handleLine(`${T}a lockjaw has taken 10 damage from your Plague III.`, 3000);
  e.setGroupFn(() => ['avenrae']);
  e.handleLine(`${T}Avenrae slashes a lockjaw for 500 points of damage.`, 4000);
  const av = e.getActive(4000, 'all').find((r) => r.name === 'Avenrae');
  assert.ok(av, 'Avenrae has her own row');
  assert.match(av.valueText, /^1\.5k|^1500/, 'all 1500, not just the 500 after she was recognised');
});

test('a fully-classified friend is byte-identical - raw is only a top-up', () => {
  const e = new DamageEngine();
  e.setGroupFn(() => ['baxa']);
  e.handleLine(`${T}a zol ghoul knight has taken 10 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 300 points of damage.`, 1000);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 300 points of damage.`, 2000);
  const baxa = e.getActive(2000, 'all').find((r) => r.name === 'Baxa');
  assert.match(baxa.valueText, /^600/, 'no double-count - raw equals classified here');
});

// Owner, 2 Sep: a mage pet ("Kobektik") showed as its own attacker row - fixed by folding a
// summoned-pet-shaped name into "Pets" regardless of the group roster.
//
// Owner, 15 Sep, live report against a real raid: "Everyone in the fight" (scope 'all') used to
// ALSO fold every real player outside her own ~6-person group roster into one anonymous "Other"
// row once that roster filled in - in a 24-person raid, three subgroups' worth of named attackers
// (one of them outdamaging everyone she could still see by name) vanished into a single 51%
// bucket, for a scope whose entire point is showing everyone. It looked fine before the roster
// filled in (an empty roster left everyone with their own row, the pre-existing fallback) and
// wrong the moment it did, which is backwards - group membership has nothing to do with who a
// scope named "Everyone" should name. "Show at most N rows" (damageRowCap, overlay.js) already
// caps a big raid's row count, sorted biggest-first, so nothing here needs an anonymous bucket to
// keep the screen manageable - only a genuinely pet-shaped name still folds, same as before.
test("scope 'all': every real player keeps their own row regardless of the group roster - only a pet-shaped name folds", () => {
  const e = new DamageEngine();
  e.setGroupFn(() => ['avenrae', 'shubthulu']);
  e.handleLine(`${T}a zol ghoul knight has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Avenrae slashes a zol ghoul knight for 400 points of damage.`, 1000);
  e.handleLine(`${T}Kobektik hit a zol ghoul knight for 200 points of magic damage by Fire Bolt.`, 1000);
  e.handleLine(`${T}Kaerthos slashes a zol ghoul knight for 50 points of damage.`, 1000);
  const rows = e.getActive(1000, 'all');
  assert.ok(rows.find((r) => r.name === 'Avenrae'), 'an admitted member keeps their own row');
  const pets = rows.find((r) => r.name === 'Pets');
  assert.ok(pets && pets.isPet, 'the mage pet still folds into Pets - that part is unchanged');
  assert.match(pets.valueText, /^200/);
  const kaerthos = rows.find((r) => r.name === 'Kaerthos');
  assert.ok(kaerthos, 'a real player outside the group roster must keep their own row, not vanish into "Other"');
  assert.match(kaerthos.valueText, /^50/);
  assert.equal(rows.find((r) => r.name === 'Other'), undefined, '"Other" must not exist in this scope any more - every real name is shown');
  assert.equal(rows.find((r) => r.name === 'Kobektik'), undefined, 'the pet is not its own row any more');
});

test("scope 'all': a possessive-named pet folds into Pets regardless of roster", () => {
  const e = new DamageEngine();
  e.handleLine(`${T}a zol ghoul knight has taken 10 damage from your Plague III.`, 1000);
  e.handleLine(`${T}a zol ghoul knight has taken 300 damage from Ice Comet by Chrysaetos\`s pet.`, 1000);
  // ^ "X has taken N damage from SPELL by ATTACKER" - attacker is Chrysaetos`s pet
  const rows = e.getActive(1000, 'all');
  assert.ok(rows.find((r) => r.name === 'Pets'), 'a possessive pet folds even with no group roster');
});

// Owner, 3 Sep: "a Teir`Dal rogue" (a wild-charmed mob fighting alongside the group) showed as its
// own attacker row. An article-prefixed name that reaches the meter has already been classified as
// a friendly attacker - it can only be a charmed monster, never a player - so it folds into the one
// "Charmed pets" row even when the group roster is empty and petTracker never saw the charm line.
test("scope 'all': an article-prefixed friendly attacker folds into Charmed pets", () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 100 points of damage.`, 1000); // enemy established
  e.handleLine(`${T}a Teir\`Dal rogue backstabs a zol ghoul knight for 400 points of damage.`, 1000);
  const rows = e.getActive(1000, 'all');
  assert.equal(rows.find((r) => /Teir/i.test(r.name)), undefined, 'the mob is not its own row');
  const charmed = rows.find((r) => r.name === 'Charmed pets');
  assert.ok(charmed && charmed.unknownPets, 'it folds into the Charmed pets row');
  assert.match(charmed.valueText, /^400/);
});

// Owner, 3 Sep: after a restart the current-fight meter lost the groupmates while the since-zone
// tally kept them. Root cause: the friend/enemy bootstrap starts empty, and a bard who does little
// direct damage never seeds the enemy set fast enough to classify a groupmate's hits on a mob she
// never personally touched. A confirmed group member is a friend for classification, full stop.
test('a confirmed group member is a friend without the bootstrap having to prove it', () => {
  const e = new DamageEngine();
  e.setGroupFn(() => ['bobarafius', 'avenrae']);
  // Nobody has attacked yet - the enemy set is empty. Bobarafius (a group member) hits a mob.
  e.handleLine(`${T}Bobarafius slashes a hardened skeleton for 300 points of damage.`, 1000);
  const rows = e.getActive(1000, 'all');
  const bob = rows.find((r) => r.name === 'Bobarafius');
  assert.ok(bob, 'the groupmate is credited on the current fight immediately');
  assert.match(bob.valueText, /^300/);
  assert.ok(e.enemies.has('a hardened skeleton'), 'and the mob is now a known enemy');
});

// A damage shield is pure retaliation and must never teach a side. In a charm-war zone this was
// collapsing the whole bootstrap (measured live: the group tagged as enemies, mobs as friends).
test('a damage-shield line does not add anyone to the friend or enemy sets', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}a zol ghoul knight has taken 5 damage from your Plague III.`, 1000); // knight = enemy
  // A charmed pet's thorns hit the knight. Old behaviour: rule 2 makes "a spite golem" a friend.
  e.handleLine(`${T}a zol ghoul knight is pierced by a spite golem's thorns for 7 points of non-melee damage.`, 1000);
  assert.ok(!e.friends.has('a spite golem'), 'a DS hit is not proof of a side');
  // A mob's flame shield hits a groupmate. Old behaviour: rule 3 could tag the groupmate an enemy.
  e.setGroupFn(() => []);
  e.handleLine(`${T}a zol ghoul knight has taken 5 damage from your Plague III.`, 1000);
  e.friends.add('avenrae');
  e.handleLine(`${T}Avenrae is burned by Footman of V\`Zher's flames for 7 points of non-melee damage.`, 1000);
  assert.ok(!e.enemies.has('avenrae'), 'the groupmate is not flipped to enemy by a shield hit');
});

// Reported live 7 Sep, Befallen (no charms all session): a "Charmed pets" damage row (78, 2%)
// with nothing charmed. In a charm-war zone the friend/enemy bootstrap leaks a hostile mob onto
// the friend side; its outgoing damage was folding into a "Charmed pets" row that shouldn't exist.
// The fold now requires petTracker to report SOME charm activity this session.
test('an article-prefixed friendly attacker is NOT folded into Charmed pets when nothing has been charmed', () => {
  const e = new DamageEngine();
  e.setPetsFn(() => ({
    ownPetKeyByName: new Map(),
    unknownPetNames: new Set(),
    allyPetLeader: new Map(),
    charmSeen: false,
  }));
  e.handleLine(`${T}You crush a zol ghoul knight for 100 points of damage.`, 1000);
  e.handleLine(`${T}a Teir\`Dal rogue backstabs a zol ghoul knight for 400 points of damage.`, 1000);
  const rows = e.getActive(1000, 'all');
  assert.equal(rows.find((r) => r.name === 'Charmed pets'), undefined, 'no phantom Charmed pets row');
  assert.equal(rows.find((r) => /Teir/i.test(r.name)), undefined, 'and the leaked mob is not its own row');
});

test('...but it IS folded when petTracker reports a charm this session', () => {
  const e = new DamageEngine();
  e.setPetsFn(() => ({
    ownPetKeyByName: new Map(),
    unknownPetNames: new Set(),
    allyPetLeader: new Map(),
    charmSeen: true, // an enchanter in the group is charm-farming
  }));
  e.handleLine(`${T}You crush a zol ghoul knight for 100 points of damage.`, 1000);
  e.handleLine(`${T}a Teir\`Dal rogue backstabs a zol ghoul knight for 400 points of damage.`, 1000);
  const charmed = e.getActive(1000, 'all').find((r) => r.name === 'Charmed pets');
  assert.ok(charmed && /^400/.test(charmed.valueText), 'a real wild charm still folds in');
});

test("scope 'mine': an article-prefixed friendly attacker is dropped, not shown", () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 100 points of damage.`, 1000);
  e.handleLine(`${T}a Teir\`Dal rogue backstabs a zol ghoul knight for 400 points of damage.`, 1000);
  const rows = e.getActive(1000, 'mine');
  assert.equal(rows.find((r) => r.name === 'Charmed pets'), undefined, 'not in the mine scope');
  assert.equal(rows.find((r) => /Teir/i.test(r.name)), undefined);
});

test('name-collision guard: a name in both friends and enemies is dropped, not credited', () => {
  const e = new DamageEngine();
  // A charmed "a spite golem" fights a mob you tagged, so rule 2 makes the name a friend...
  e.handleLine(`${T}a zol ghoul knight has taken 5 damage from your Plague III.`, 1000);
  e.handleLine(`${T}a spite golem slashes a zol ghoul knight for 100 points of damage.`, 1000);
  assert.ok(e.friends.has('a spite golem'));
  // ...while a DIFFERENT, identically-named add is something you've mezzed/snared - a real
  // same-name pet/mob collision (the scenario this guard exists for), fed the same way any other
  // debuff target reaches the enemy set: via knownEnemiesFn, consulted through _isEnemy.
  e.setKnownEnemiesFn(() => ['a spite golem']);
  assert.ok(e._isEnemy('a spite golem'), 'seeded into e.enemies as a side effect');
  assert.ok(e.enemies.has('a spite golem') && e.friends.has('a spite golem'), 'now in both sets');
  const credited = (e.byAttacker.get('a spite golem') || { damage: 0 }).damage;
  e.handleLine(`${T}a spite golem slashes a zol ghoul knight for 999 points of damage.`, 1000);
  assert.equal(
    (e.byAttacker.get('a spite golem') || { damage: 0 }).damage,
    credited,
    'the ambiguous hit was not credited'
  );
});

// Found by measuring against a real week-long log: "You crush Zorrick for 37 points of damage." -
// a real groupmate, hit by the player's own melee/AoE (friendly fire, a duel, a mistargeted click -
// the log doesn't say which). Before this fix, rule 1 unconditionally added the target to
// `enemies`, so one stray hit like that put a real ally in BOTH sets - and every one of their own
// outgoing hits for the rest of the session then tripped the collision guard above and got
// silently dropped. Measured impact on the real log: two groupmates, ~1.1 MILLION damage points
// (over 6% of the whole log) zeroed out by a combined 3 friendly-fire lines.
test('a friendly-fire hit on a known ally does not poison the enemy set', () => {
  const e = new DamageEngine();
  // Baxa is an established friend from ordinary group play.
  e.handleLine(`${T}a zol ghoul knight has taken 5 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 100 points of damage.`, 1000);
  assert.ok(e.friends.has('baxa'));
  // One stray hit lands on Baxa. It is still credited (it happened) - but Baxa must NOT become an
  // enemy, or every later Baxa hit gets dropped by the collision guard.
  e.handleLine(`${T}You crush Baxa for 37 points of damage.`, 1000);
  assert.equal(e.byAttacker.get('You').damage, 42, 'the stray hit is still credited to You (5 earlier + 37)');
  assert.equal(e.enemies.has('baxa'), false, 'a known friend is not silently made an enemy');
  // Baxa's own damage keeps counting afterwards.
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 200 points of damage.`, 1000);
  assert.equal(e.byAttacker.get('Baxa').damage, 300);
});

test('captureState / restoreState carries the tallies and the friend/enemy sets across a restart', () => {
  const a = new DamageEngine();
  a.handleLine(`${T}You slash a zol ghoul knight for 100 points of damage.`, 1000);
  a.handleLine(`${T}Baxa slashes a zol ghoul knight for 60 points of damage.`, 2000);
  const snap = a.captureState();
  assert.ok(snap);

  const b = new DamageEngine();
  const n = b.restoreState(snap, 30_000, 5000); // 5s later, well inside the fight timeout
  assert.ok(n > 0);
  assert.equal(b.byAttacker.get('You').damage, 100);
  assert.equal(b.byAttacker.get('Baxa').damage, 60);
  assert.ok(b.enemies.has('a zol ghoul knight'));
  assert.ok(b.friends.has('baxa'), 'Baxa was proved a friend by hitting a known enemy - that survives');
});

test('a fight that timed out during the gap is dropped on restore, but the sets are kept', () => {
  const a = new DamageEngine();
  a.handleLine(`${T}You slash a zol ghoul knight for 100 points of damage.`, 1000);
  const snap = a.captureState();

  const b = new DamageEngine();
  // 90s later - past the 10s default fight timeout
  b.restoreState(snap, 90_000, 1000 + 90_000);
  assert.equal(b.fightStartedAt, null, 'the stale fight is gone');
  assert.ok(b.enemies.has('a zol ghoul knight'), 'the bootstrap set is kept so the next pull is not lost');
});

// Owner, 14 Sep: "EVERY part of the app should have a recovery for accidental close" - found while
// looking into a real report of missing history: bySkillByAttacker/bySkillByHealer were never part
// of captureState() at all, so a fight restored across a restart kept the right TOTAL per attacker
// but silently lost their per-skill breakdown the moment it was later captured to history.
test('captureState / restoreState also carries each attacker\'s per-skill breakdown, not just their flat total', () => {
  const a = new DamageEngine();
  a.handleLine(`${T}You slash a zol ghoul knight for 40 points of damage.`, 1000);
  a.handleLine(`${T}You slash a zol ghoul knight for 60 points of damage.`, 1500);
  const snap = a.captureState();

  const b = new DamageEngine();
  b.restoreState(snap, 30_000, 5000);
  b.setOptions({ fightTimeoutSec: 10 });
  b.tick(5000 + 20000); // past the idle timeout - closes the restored fight, capturing it to history
  const hist = b.getHistory();
  assert.equal(hist.length, 1, 'the restored fight must actually reach history once it closes');
  const fight = b.getHistoryFight(hist[0].id);
  const you = fight.rows.find((r) => r.name === 'You');
  assert.ok(you, 'the restored attacker must still be in the captured fight');
  const melee = you.bySkill.find((s) => s.skill === 'Melee');
  assert.ok(melee, 'the per-skill breakdown must survive the restart, not just the flat damage total');
  assert.equal(melee.damage, 100);
  assert.equal(melee.hits, 2);
});

// ---------------------------------------------------------------------------
// Denon's Desperate Dirge gets its own bright-red slice of the LIVE overlay meter's bar too, not
// just the Combat tab (owner, 14 Sep: "this should also apply to the aura version of the combat
// meter"). `denonPercent` on a getActive() tile is "what share of THIS row's own bar" - a fraction
// overlay.js paints as a second colour inset into the same bar, never a separate number.
// ---------------------------------------------------------------------------

test('a getActive() tile carries denonPercent - the share of that row\'s own damage from Denon\'s Desperate Dirge', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a fire giant for 10 points of damage.`, 500); // establish "a fire giant" as the enemy first
  e.handleLine(`${T}A fire giant has taken 300 damage from Denon's Desperate Dirge V by Aristirin.`, 1000);
  e.handleLine(`${T}Aristirin slashes a fire giant for 100 points of damage.`, 1500);
  const tiles = e.getActive(1500);
  const row = tiles.find((t) => t.name === 'Aristirin');
  assert.ok(row, 'Aristirin must have a row');
  // 300 of Aristirin's own 400 damage (300 dirge + 100 melee) is the dirge - 75%.
  assert.equal(row.denonPercent, 75);
});

test('a row with no Denon\'s damage at all gets denonPercent 0, not undefined', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 40 points of damage.`, 1000);
  const row = e.getActive(1000).find((t) => t.name === 'You');
  assert.equal(row.denonPercent, 0);
});

test('a rank suffix on the dirge is still recognised ("Denon\'s Desperate Dirge" alone, and higher ranks)', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a fire giant for 10 points of damage.`, 500); // establish "a fire giant" as the enemy first
  e.handleLine(`${T}A fire giant has taken 200 damage from Denon's Desperate Dirge IX by Aristirin.`, 1000);
  const row = e.getActive(1000).find((t) => t.name === 'Aristirin');
  assert.equal(row.denonPercent, 100, 'a rank numeral must not stop the prefix match');
});

test('denonPercent survives a fight ending - it must not vanish once the meter falls back to the since-zone total', () => {
  // Reported live 14 Sep: "the denon's red disappears when viewing the aura for the zone total."
  // Root cause: Denon's attribution read bySkillByAttacker, which reset() (a fight ending) wipes -
  // so by the time getActive() fell back to the since-zone tally, there was nothing left to
  // attribute. sinceZoneBySkillByAttacker is the fix: same accumulation as bySkillByAttacker, but
  // only cleared by enterZone(), same rule as sinceZoneByAttacker itself.
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 10 });
  e.handleLine(`${T}You crush a fire giant for 10 points of damage.`, 500); // establish "a fire giant" as the enemy first
  e.handleLine(`${T}A fire giant has taken 300 damage from Denon's Desperate Dirge V by Aristirin.`, 1000);
  e.handleLine(`${T}Aristirin slashes a fire giant for 100 points of damage.`, 1500);
  e.tick(20000); // past the fight timeout - reset() fires, clearing the fight-scoped skill map
  const tiles = e.getActive(20000);
  const row = tiles.find((t) => t.name === 'Aristirin');
  assert.ok(row, 'Aristirin must still have a row in the since-zone fallback');
  assert.equal(row.denonPercent, 75, 'the since-zone tile must still know its own Denon\'s share');
});

test('the heal side never gets a denonPercent - Denon\'s is a damage skill, not a heal', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1000);
  e.handleLine(`${T}You have healed Baxa for 50 points by Light Healing.`, 1500);
  const healTiles = e.getActive(1500, 'all', 'healing');
  const row = healTiles.find((t) => t.name === 'Baxa' || t.name === 'You');
  if (row) assert.equal(row.denonPercent, undefined, 'a heal-metric tile has no reason to carry a damage-only field at all');
});

test('nothing counted -> captureState is null', () => {
  assert.equal(new DamageEngine().captureState(), null);
});

// ---------------------------------------------------------------------------
// Owner, 15 Sep, screenshot: "Envenomed Bolt" and "Envenomed Bolt IX" listed as two separate skill
// rows for the same cast, plus "i also worry how inaccurate the hits count is for DOTs since 40
// seems really low". Confirmed against the real log: this server's direct-hit wording ("Tenam hit
// a shiverback for 55 points of poison damage by Envenomed Bolt.") never carries the rank numeral,
// while every DoT tick from the SAME cast ("... has taken 460 damage from Envenomed Bolt IX by
// Tenam.") does. Same shape as gotcha #3's Denon's Desperate Dirge case (a decorative log-line
// numeral, not a genuinely different spell) - stripRankSuffix already existed for this, just was
// never applied to a damage/heal skill's own aggregation key. Splitting one DoT's hit count across
// two rows is also the direct explanation for the "hits seems low" half of the same report - the
// true count was always there, just divided between two labels.
// ---------------------------------------------------------------------------

test('a direct-hit line missing its rank numeral merges into the same row as the DoT ticks that carry it', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a shiverback for 10 points of damage.`, 900); // establish "a shiverback" as the enemy first
  e.handleLine(`${T}Tenam hit a shiverback for 55 points of poison damage by Envenomed Bolt.`, 1000);
  e.handleLine(`${T}A shiverback has taken 460 damage from Envenomed Bolt IX by Tenam.`, 1005);
  e.handleLine(`${T}A shiverback has taken 495 damage from Envenomed Bolt IX by Tenam.`, 1010);
  const live = e.getLiveFight();
  const tenam = live.rows.find((r) => r.name === 'Tenam');
  assert.ok(tenam, 'Tenam must have a row');
  assert.equal(tenam.bySkill.length, 1, 'must be ONE row, not split across "Envenomed Bolt" and "Envenomed Bolt IX"');
  assert.equal(tenam.bySkill[0].skill, 'Envenomed Bolt', 'the merged row must not carry a stray rank numeral either');
  assert.equal(tenam.bySkill[0].damage, 1010, 'all three hits must be summed into the one row');
  assert.equal(tenam.bySkill[0].hits, 3, 'the hit COUNT must also merge - this is what made the DoT tick count look artificially low');
});

test('the same rank-suffix merge applies to healing skills, not just damage', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1000);
  e.handleLine(`${T}You healed Baxa for 100 hit points by Celestial Healing.`, 1500);
  e.handleLine(`${T}You healed Baxa for 120 hit points by Celestial Healing VII.`, 1600);
  const live = e.getLiveFight();
  const you = live.healRows.find((r) => r.name === 'You');
  assert.equal(you.bySkill.length, 1, 'must merge into one "Celestial Healing" row regardless of which cast carried a rank numeral');
  assert.equal(you.bySkill[0].damage, 220);
  assert.equal(you.bySkill[0].hits, 2);
});

test('a genuinely different skill name is never merged just because it shares a prefix', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a shiverback for 10 points of damage.`, 900);
  e.handleLine(`${T}Tenam hit a shiverback for 55 points of poison damage by Envenomed Bolt.`, 1000);
  e.handleLine(`${T}A shiverback has taken 300 damage from Envenomed Breath by Tenam.`, 1005);
  const live = e.getLiveFight();
  const tenam = live.rows.find((r) => r.name === 'Tenam');
  assert.equal(tenam.bySkill.length, 2, 'Envenomed Bolt and Envenomed Breath are different spells and must stay separate rows');
});

// ---------------------------------------------------------------------------
// Monster life-leech "heals" (gotcha: LEECH_HEAL_SPELLS) - reported live 15 Sep against a real
// Lord Nagafen kill. "Lord Nagafen healed Avenrae for 0 (451) hit points by Leech Touch I." landed
// seconds into the fight, before any damage line had proven Nagafen hostile - and the ordinary heal
// rule ("the recipient is a known friend, so the healer must be one too") took it at face value and
// taught Nagafen as a FRIEND. Once mislearned, the friend/enemy collision guard refused every later
// genuinely-correct "Nagafen hit you" line to ever fix it, so the rest of a 115-second, 200k-damage
// fight sat unclassified and uncounted - the Combat tab showed a 48-second, 45k fragment named only
// after the OTHER boss in the pull, with Nagafen's own name and damage missing entirely.
//
// Confirmed live: scanning the full multi-week log got this fight right (Nagafen was already a
// known enemy from an earlier day by the time the bad line appeared, so the mislearn attempt was a
// no-op against the collision guard); scanning just that one day's split-log file got it wrong,
// because that scan meets Nagafen for the first time right as the poisoning line arrives. Traced
// directly against the real engine and the real log lines, not guessed.
// ---------------------------------------------------------------------------

test('a monster life-leech "heal" (Leech Touch) does not teach the monster friend status', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Lord Nagafen healed you for 0 (451) hit points by Leech Touch I.`, 1000);
  assert.equal(e.friends.has('lord nagafen'), false, 'the leech-heal line must not learn Nagafen as a friend');
});

test('once the leech-heal line is out of the way, a real incoming hit correctly teaches the monster hostile - and its damage survives', () => {
  const e = new DamageEngine();
  // Mirrors the real report's exact ordering: the leech-heal line arrives first, before any damage
  // line has said anything about which side Nagafen is on.
  e.handleLine(`${T}Lord Nagafen healed you for 0 (451) hit points by Leech Touch I.`, 1000);
  e.handleLine(`${T}Lord Nagafen hit you for 490 points of fire damage by Lava Breath.`, 1001);
  e.handleLine(`${T}You hit Lord Nagafen for 3033 points of unresistable damage by Harm Touch.`, 1002);
  const live = e.getLiveFight();
  const you = live.rows.find((r) => r.name === 'You');
  assert.ok(you, 'Nagafen must still be classifiable as an enemy - the Harm Touch hit must be credited');
  assert.equal(you.damage, 3033);
});

test('the same protection covers Life Leech and a bare (unranked) spell name, not just "Leech Touch I"', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Lord Nagafen healed you for 82 hit points by Life Leech.`, 1000);
  assert.equal(e.friends.has('lord nagafen'), false);
});

test('a monster healing ITSELF via life-leech is still just dropped, not credited as healing received', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Lord Nagafen healed itself for 94 hit points by Life Leech.`, 1000);
  const live = e.getLiveFight();
  assert.equal(live, null, 'nothing legitimate happened here from the player\'s perspective - no fight should even start');
});

test('the leech-heal exception is narrow - an ORDINARY ally heal still correctly teaches friend status', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Konarer healed you for 50 hit points by Blessing of the Lord Commander.`, 1000);
  assert.equal(e.friends.has('konarer'), true, 'a real heal must be unaffected by this narrow exception');
});

// Caught by direct question against the real log, after the first version of this fix shipped: the
// SAME spell names ("Leech Touch I") are also a genuine PLAYER self-heal - a lifesteal proc off a
// Harm Touch crit, real and meant to show up on the Healing tab. A player self-heal can never
// cross-contaminate the friend/enemy sets (healer and target are the same name), so it was never
// the dangerous shape the monster's cross-target version is - only h !== t is guarded.
test('a PLAYER\'S OWN self-heal via the same spell name (Leech Touch/Life Leech) is still fully credited', () => {
  const e = new DamageEngine();
  // Establish Avenrae as a friend the ordinary way - her own outgoing hit on a known enemy.
  e.handleLine(`${T}You hit Lord Nagafen for 100 points of unresistable damage by Harm Touch.`, 1000);
  e.handleLine(`${T}Avenrae hit Lord Nagafen for 3033 points of unresistable damage by Harm Touch X.`, 1001);
  e.handleLine(`${T}Avenrae healed itself for 0 (3033) hit points by Leech Touch I.`, 1001);
  const live = e.getLiveFight();
  const avenrae = live.healRows.find((r) => r.name === 'Avenrae');
  assert.ok(avenrae, 'Avenrae\'s own lifesteal must still be credited as healing done, not silently dropped');
  assert.equal(avenrae.damage, 0, '"0 (3033)" means 0 ACTUAL healing (already full) - the credited amount must be the real one, not the potential cap');
});

module.exports = () => report('damage-parser');
if (require.main === module) report('damage-parser').then((n) => process.exit(n ? 1 : 0));
