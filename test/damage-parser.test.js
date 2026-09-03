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
  assert.deepEqual(hit, { attacker: 'You', target: 'Fright', amount: 394, kind: 'spell' });
});

test('your own melee damage names you as the attacker', () => {
  const hit = parseDamageLine(`${T}You crush a wan ghoul knight for 60 points of damage.`);
  assert.deepEqual(hit, { attacker: 'You', target: 'a wan ghoul knight', amount: 60, kind: 'melee' });
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
  assert.deepEqual(hit, { attacker: 'Baxa', target: 'A zol ghoul knight', amount: 8, kind: 'shield' });
});

test('someone else melee is read with both sides', () => {
  const hit = parseDamageLine(`${T}Baxa slashes a zol ghoul knight for 47 points of damage.`);
  assert.deepEqual(hit, { attacker: 'Baxa', target: 'a zol ghoul knight', amount: 47, kind: 'melee' });
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
    { attacker: 'Baxa', target: 'a zol ghoul knight', amount: 88, kind: 'melee' }
  );
  assert.deepEqual(
    parseDamageLine(`${T}Krung frenzies on a zol ghoul knight for 21 points of damage.`),
    { attacker: 'Krung', target: 'a zol ghoul knight', amount: 21, kind: 'melee' }
  );
  assert.deepEqual(
    parseDamageLine(`${T}Sneaky backstabs a wan ghoul knight for 512 points of damage.`),
    { attacker: 'Sneaky', target: 'a wan ghoul knight', amount: 512, kind: 'melee' }
  );
});

// When the PLAYER holds the damage shield, EQ writes "YOUR", not a possessive - almost every DS
// line in the fixture corpus is this form, and the old `(.+?)'s` matched about 1 in 20.
test('a damage shield worn by the player is credited to You', () => {
  assert.deepEqual(
    parseDamageLine(`${T}A rock golem is pierced by YOUR thorns for 5 points of non-melee damage.`),
    { attacker: 'You', target: 'A rock golem', amount: 5, kind: 'shield' }
  );
});

// EQ space-pads a single-digit day: "[Fri Aug  1 21:00:00 2026]" is two spaces and one digit.
// The old `\d{2}` + single-space stamp matched none of these, so the meter was dark for the
// first nine days of every month.
test('a single-digit-day timestamp is still stripped', () => {
  assert.deepEqual(
    parseDamageLine(`[Fri Aug  1 21:00:00 2026] You crush a wan ghoul knight for 60 points of damage.`),
    { attacker: 'You', target: 'a wan ghoul knight', amount: 60, kind: 'melee' }
  );
});

// The direct-nuke wording - ~21,000 lines the meter was blind to. A nuking loadout's whole
// output arrives this way, so the caster was simply absent from the meter.
test('the direct-damage-spell wording is read, first and third person', () => {
  assert.deepEqual(
    parseDamageLine(`${T}You hit a greater kobold for 943 points of magic damage by Energy Storm.`),
    { attacker: 'You', target: 'a greater kobold', amount: 943, kind: 'spell' }
  );
  assert.deepEqual(
    parseDamageLine(`${T}Gebektik hit Guard Xyxax for 42 points of magic damage by Lifebite.`),
    { attacker: 'Gebektik', target: 'Guard Xyxax', amount: 42, kind: 'spell' }
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
  assert.match(rows[0].valueText, /^300\s+75%$/);
  assert.match(rows[1].valueText, /^100\s+25%$/);
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
  assert.match(baxa.valueText, /^300\s+75%$/, "'total' - cumulative damage + share");
  assert.match(baxa.dpsText, /^75\/s\s+75%$/, "'dps' - attacker damage / the fight span + share");
  assert.match(baxa.bothText, /^300 \(75\/s\)\s+75%$/, "'both' - damage (rate) + share");
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
  assert.equal(rows.find((r) => r.name === 'Enro').valueText, '600  60%');
});

test("scope 'group' counts only admitted names and recomputes the denominator", () => {
  const e = new DamageEngine();
  e.setGroupFn(() => ['baxa']); // Baxa is in the group, Enro is a stranger
  seedFight(e);
  const rows = e.getActive(1000, 'group');
  assert.equal(rows.find((r) => r.name === 'Enro'), undefined, 'the stranger is not shown');
  const total = rows.find((r) => r.totalRow);
  assert.match(total.valueText, /^400/, 'total is You + Baxa only, not 1000');
  assert.equal(rows.find((r) => r.name === 'Baxa').valueText, '300  75%');
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

// Owner, 2 Sep: a mage pet ("Kobektik") showed as its own attacker row. In scope 'all', once the
// group roster is known, only you + admitted members get their own row; a summoned-pet-shaped
// name the roster does NOT vouch for folds into "Pets", any other outsider folds into "Other".
test("scope 'all': with a roster, outsiders bucket into Pets / Other", () => {
  const e = new DamageEngine();
  e.setGroupFn(() => ['avenrae', 'shubthulu']);
  e.handleLine(`${T}a zol ghoul knight has taken 100 damage from your Plague III.`, 1000);
  e.handleLine(`${T}Avenrae slashes a zol ghoul knight for 400 points of damage.`, 1000);
  e.handleLine(`${T}Kobektik hit a zol ghoul knight for 200 points of magic damage by Fire Bolt.`, 1000);
  e.handleLine(`${T}Kaerthos slashes a zol ghoul knight for 50 points of damage.`, 1000);
  const rows = e.getActive(1000, 'all');
  assert.ok(rows.find((r) => r.name === 'Avenrae'), 'an admitted member keeps their own row');
  const pets = rows.find((r) => r.name === 'Pets');
  assert.ok(pets && pets.isPet, 'the mage pet folds into Pets');
  assert.match(pets.valueText, /^200/);
  const other = rows.find((r) => r.name === 'Other');
  assert.ok(other && other.isOther, 'the non-group stranger folds into Other');
  assert.match(other.valueText, /^50/);
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

test('nothing counted -> captureState is null', () => {
  assert.equal(new DamageEngine().captureState(), null);
});

module.exports = () => report('damage-parser');
if (require.main === module) report('damage-parser').then((n) => process.exit(n ? 1 : 0));
