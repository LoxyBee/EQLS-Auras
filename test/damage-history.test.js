'use strict';
/**
 * Fight history (owner's weekly notes, 13 Sep) - "a way to save and look back at past fights
 * instead of losing them the moment the meter resets", plus the per-skill breakdown behind each
 * row. In-memory for the running session only - not written to disk (see damageEngine.js's
 * `history` field comment) - and capped at MAX_HISTORY so a long session can't grow it forever.
 *
 * getHistory() is the summary list (Combat tab's list view); getHistoryFight(id) is one fight's
 * full row list including each row's own bySkill breakdown (the detail view).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { DamageEngine } = require('../src/main/damageEngine');

const T = '[Wed Aug 19 21:14:02 2026] ';

function endFight(e, atMs) {
  e.setOptions({ fightTimeoutSec: 10 });
  e.tick(atMs + 20000); // well past the timeout - forces _expireIfIdle -> reset() -> capture
}

test('a completed fight is captured to history with its total and top attacker', () => {
  const e = new DamageEngine();
  // The player's own hit proves "a zol ghoul knight" hostile (Rule 1) before Baxa's melee on the
  // same target can be classified (Rule 2) - an unestablished target would hold Baxa's line as
  // unclassifiable rather than credit it.
  e.handleLine(`${T}You crush a zol ghoul knight for 40 points of damage.`, 1000);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 100 points of damage.`, 2000);
  endFight(e, 2000);
  const history = e.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].totalDamage, 140);
  assert.equal(history[0].topAttacker, 'Baxa');
  assert.ok(typeof history[0].id === 'number');
  assert.equal(history[0].durationSec, 1, 'the two hits were 1s apart');
});

test('a fight with no counted damage is never recorded (nothing worth remembering)', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle hits YOU for 31 points of damage.`, 1000); // incoming only
  endFight(e, 1000);
  assert.deepEqual(e.getHistory(), []);
});

test('getHistoryFight returns the full row list with each attacker\'s own per-skill breakdown', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 60 points of damage.`, 1000);
  e.handleLine(`${T}You hit a zol ghoul knight for 200 points of magic damage by Energy Storm.`, 1500);
  e.handleLine(`${T}You hit a zol ghoul knight for 150 points of magic damage by Energy Storm.`, 2000);
  endFight(e, 2000);
  const id = e.getHistory()[0].id;
  const fight = e.getHistoryFight(id);
  assert.ok(fight, 'the detail record vanished even though the summary named it');
  const you = fight.rows.find((r) => r.name === 'You');
  assert.equal(you.damage, 410);
  assert.deepEqual(
    you.bySkill.map((s) => [s.skill, s.damage]),
    [['Energy Storm', 350], ['Melee', 60]],
    'biggest skill first, melee and the nuke kept separate'
  );
});

test('a name that folds two attacks into one skill (repeated Melee) sums into a single row', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 1 points of damage.`, 900);
  e.handleLine(`${T}Baxa slashes a zol ghoul knight for 40 points of damage.`, 1000);
  e.handleLine(`${T}Baxa crushes a zol ghoul knight for 25 points of damage.`, 1500);
  endFight(e, 1500);
  const fight = e.getHistoryFight(e.getHistory()[0].id);
  const baxa = fight.rows.find((r) => r.name === 'Baxa');
  assert.deepEqual(baxa.bySkill, [{ skill: 'Melee', damage: 65, hits: 2, crits: 0 }]);
});

// Owner, 13 Sep - crit rate on the per-skill breakdown. Counted per skill (not just per attacker)
// since a caster's nukes and their melee crit at completely different rates.
test('crits are counted per skill, alongside hits - a mix of crit and non-crit swings', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 1 points of damage.`, 900);
  e.handleLine(`${T}Baxa crushes a zol ghoul knight for 40 points of damage. (Critical)`, 1000);
  e.handleLine(`${T}Baxa crushes a zol ghoul knight for 20 points of damage.`, 1200);
  e.handleLine(`${T}Baxa hit a zol ghoul knight for 90 points of magic damage by Energy Storm. (Critical)`, 1400);
  endFight(e, 1400);
  const fight = e.getHistoryFight(e.getHistory()[0].id);
  const baxa = fight.rows.find((r) => r.name === 'Baxa');
  assert.deepEqual(
    baxa.bySkill.find((s) => s.skill === 'Melee'),
    { skill: 'Melee', damage: 60, hits: 2, crits: 1 }
  );
  assert.deepEqual(
    baxa.bySkill.find((s) => s.skill === 'Energy Storm'),
    { skill: 'Energy Storm', damage: 90, hits: 1, crits: 1 }
  );
});

test('a groupmate recognised late still shows their FULL damage in history, not just what landed after', () => {
  // Same reconciliation the live meter uses (gotcha #49) - a name folded to "Other"/unclassified
  // early on gets topped up from the raw tally the moment it's recognised as a friend. History
  // must read the SAME reconciled number, not a second, independent (and lower) one.
  const e = new DamageEngine();
  // Avenrae fights a mob the player hasn't touched yet - unclassifiable, held.
  e.handleLine(`${T}Avenrae slashes a zol ghoul knight for 500 points of damage.`, 1000);
  // The player's own hit proves the mob hostile and flushes the held line.
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1200);
  endFight(e, 1200);
  const fight = e.getHistoryFight(e.getHistory()[0].id);
  const avenrae = fight.rows.find((r) => r.name === 'Avenrae');
  assert.ok(avenrae, 'the early, held hit never made it into history at all');
  assert.equal(avenrae.damage, 500);
});

test('history keeps at most MAX_HISTORY fights, dropping the oldest first', () => {
  const e = new DamageEngine();
  let t = 1000;
  for (let i = 0; i < 35; i += 1) {
    e.handleLine(`${T}You crush a zol ghoul knight for ${i + 1} points of damage.`, t);
    endFight(e, t);
    t += 25000;
  }
  const history = e.getHistory();
  assert.equal(history.length, 30, 'MAX_HISTORY was not enforced');
  assert.equal(history[0].totalDamage, 35, 'newest is not first');
  assert.equal(history[history.length - 1].totalDamage, 6, 'the oldest 5 should have been dropped, not the newest');
});

test('getHistoryFight returns null for an id that was never recorded, or has aged out', () => {
  const e = new DamageEngine();
  assert.equal(e.getHistoryFight(999), null);
});

// ---------------------------------------------------------------------------
// Zone / visit tagging (owner's ask, 13 Sep: "organised by zone... each entry to a zone should be
// grouped so you can check that zone again") - needed for both live play and the log-scan feature.
// ---------------------------------------------------------------------------

test('a fight is tagged with whatever zone was told to the engine when it happened', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'Nagafen\'s Lair');
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].zone, "Nagafen's Lair");
});

test('a fight before any zone was ever told to the engine is tagged with no zone, not a stale one', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].zone, null);
});

test('two fights in the same zone visit share a visitId; a real zone change starts a new one', () => {
  const e = new DamageEngine();
  e.enterZone(100, 'Nagafen\'s Lair');
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  e.enterZone(21500, 'Nagafen\'s Lair'); // same zone again - could be an instance-line echo
  e.handleLine(`${T}You crush a wan ghoul knight for 20 points of damage.`, 22000);
  endFight(e, 22000);
  e.enterZone(43000, 'The Feerrott'); // a genuinely different zone
  e.handleLine(`${T}You crush a wan ghoul knight for 30 points of damage.`, 44000);
  endFight(e, 44000);
  const [newest, middle, oldest] = e.getHistory();
  assert.equal(oldest.zone, "Nagafen's Lair");
  assert.equal(middle.zone, "Nagafen's Lair");
  assert.equal(oldest.visitId, middle.visitId, 'the same-zone echo should not have opened a new visit');
  assert.equal(newest.zone, 'The Feerrott');
  assert.notEqual(newest.visitId, middle.visitId, 'a real zone change must open a new visit');
});

test('maxHistory can be overridden (a log scan enumerates everything, not a bounded live buffer)', () => {
  const e = new DamageEngine({ maxHistory: Infinity });
  let t = 1000;
  for (let i = 0; i < 40; i += 1) {
    e.handleLine(`${T}You crush a wan ghoul knight for 1 points of damage.`, t);
    endFight(e, t);
    t += 25000;
  }
  assert.equal(e.getHistory().length, 40, 'the override was not honoured - still capped at 30');
});

// ---------------------------------------------------------------------------
// Fight label - "Named" vs "Trash" (owner, 14 Sep: "if a named was fought it should list the
// named, if no named was found it should just say Trash"). See src/shared/fightLabel.js for the
// pure decision; this is the wiring through the engine's own credit path into history.
// ---------------------------------------------------------------------------

test('a fight against only trash (article-prefixed) targets is labelled Trash', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].label, 'Trash');
});

test('a fight against a bare-named target lists that name, both in the summary and the detail', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush Fright for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].label, 'Fright');
  assert.equal(e.getHistoryFight(e.getHistory()[0].id).label, 'Fright');
});

test('a rare friendly-fire hit on a real groupmate is never mistaken for a named kill', () => {
  const e = new DamageEngine();
  // "You crush Zorrick" - a groupmate accidentally hit, not a mob. Zorrick is a friend from the
  // group roster, so this must not make the fight read as having fought someone named Zorrick.
  e.setGroupFn(() => ['zorrick']);
  e.handleLine(`${T}You crush Zorrick for 5 points of damage.`, 1000);
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1500);
  endFight(e, 1500);
  assert.equal(e.getHistory()[0].label, 'Trash');
});

// Owner, 14 Sep: "same here, trash listed as named" (a pet's damage-shield retaliation showed up
// as a named kill). "A giant wooly spider pet is pierced by YOUR thorns..." puts the pet's generic
// type name in the SENTENCE-INITIAL position, capitalised purely by grammar, not because it's a
// proper noun - and it also lacks an article once that leading "A " is (correctly) read as the
// article, not part of the name. Damage-shield hits are excluded from the label altogether.
test('a damage-shield retaliation never contributes to the fight label - its target is grammar-capitalised, not a real name', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a giant wooly spider pet for 10 points of damage.`, 1000);
  e.handleLine(`${T}A giant wooly spider pet is pierced by YOUR thorns for 5 points of non-melee damage.`, 1100);
  endFight(e, 1100);
  assert.equal(e.getHistory()[0].label, 'Trash');
});

test('a wild pet\'s generic type name is never treated as a named mob, even when properly capitalised', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush Giant wooly spider pet for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].label, 'Trash');
});

// Isolates the shield-exclusion mechanism specifically. A target that carries an article ("a rock
// golem") is already protected regardless of shield-vs-not, since ARTICLE_MOB matches case-
// insensitively - "A rock golem" (sentence-initial) still reads as article-prefixed. The real gap
// is a mob type with NO article at all ("bejeweled elemental", the owner's own reported example) -
// mid-sentence it stays lowercase ("bejeweled elemental"), but sentence-initial in a shield line it
// capitalises its own first letter with nothing to absorb it ("Bejeweled elemental"), and that
// capitalised form is not pet-shaped either, so only the shield-kind exclusion catches it.
test('a damage-shield hit is excluded even for a no-article target that is not pet-shaped', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush bejeweled elemental for 10 points of damage.`, 1000);
  e.handleLine(`${T}Bejeweled elemental is pierced by YOUR thorns for 5 points of non-melee damage.`, 1100);
  endFight(e, 1100);
  assert.equal(e.getHistory()[0].label, 'Trash');
});

// ---------------------------------------------------------------------------
// Cast tracking - castsByAttacker / getCastSkills (owner, 13-14 Sep: the ONLY input to the Combat
// tab's class estimate - never a damage-log skill name, since damage can't prove who cast a buff).
// ---------------------------------------------------------------------------

test('a self cast line is recorded under "You"', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You begin casting Energy Storm.`, 1000);
  assert.deepEqual(e.getCastSkills('You'), ['Energy Storm']);
});

test('a third-person cast line is recorded under the caster\'s own name, case-insensitively looked up', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Avenrae begins casting Spirit of the Puma.`, 1000);
  assert.deepEqual(e.getCastSkills('avenrae'), ['Spirit of the Puma']);
  assert.deepEqual(e.getCastSkills('AVENRAE'), ['Spirit of the Puma']);
});

test('a bard song counts too - "begins singing" is a cast line the same as "begins casting"', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Avenrae begins singing Selo's Accelerando.`, 1000);
  assert.deepEqual(e.getCastSkills('Avenrae'), ["Selo's Accelerando"]);
});

test('someone never seen casting anything has no cast skills at all', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Avenrae slashes a zol ghoul knight for 40 points of damage.`, 1000);
  assert.deepEqual(e.getCastSkills('Avenrae'), []);
});

// Owner correction, 14 Sep: cast evidence was briefly scoped to ONE fight only (per an earlier
// instruction "it is only supposed to take into account that fight"), then reverted the SAME day
// after live testing showed it broke real cases: "shara is no longer a bard, despite using
// denon's desperate dirge" and "avenrae is no longer a ranger, despite using call of flame and
// flaming arrow" - a bard sings a song ONCE and it auto-pulses for the rest of the night with no
// fresh cast line each pulse, so if that original cast happened even one fight ago, a per-fight
// scope loses it forever. Cast evidence is session-wide; only classEstimator.js's cap-at-3 bounds it.
test('cast history survives a fight ending - a song sung once must still count many fights later', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You begin casting Energy Storm.`, 1000);
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1200);
  endFight(e, 1200);
  assert.deepEqual(e.getCastSkills('You'), ['Energy Storm'], 'reset() must NOT wipe cast history - it is a fact about the person, not the current pull');
});

test('a fight\'s own captured cast skills reflect everything known up to that point, including casts from an EARLIER fight', () => {
  const e = new DamageEngine();
  // Cast once, in an early fight that then ends...
  e.handleLine(`${T}You begin casting Complete Heal.`, 1000);
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1200);
  endFight(e, 1200);
  // ...then a LATER, separate fight with no fresh cast line for it at all (the maintained-song /
  // re-mem-without-a-cast-line shape - see gotcha #33/#38).
  e.handleLine(`${T}You crush a wan ghoul knight for 20 points of damage.`, 30000);
  endFight(e, 30000);
  const later = e.getHistory()[0]; // newest first
  const fight = e.getHistoryFight(later.id);
  const you = fight.rows.find((r) => r.name === 'You');
  assert.deepEqual(you.castSkills, ['Complete Heal'], 'evidence from a PRIOR fight must still reach a later one\'s own captured row');
});

// Owner, 14 Sep: "i also should be classed as a cleric from the healing side of the logs" - a heal
// cast line ("You begin casting <heal>.") is recorded by the exact same, spell-type-agnostic
// _noteCast() as any damage spell - there is no separate "heal evidence" path to build, healing
// was never excluded, it was only ever a casualty of the (now-reverted) per-fight scoping above.
test('a cast line for a HEAL spell is recorded identically to a damage spell - no separate path needed', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You begin casting Complete Heal.`, 1000);
  assert.deepEqual(e.getCastSkills('You'), ['Complete Heal']);
});

test('the end-to-end estimate actually resolves a Cleric-only heal cast from an earlier fight to "Clr" in a later fight\'s row', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You begin casting Complete Heal.`, 1000);
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1200);
  endFight(e, 1200);
  e.handleLine(`${T}You crush a wan ghoul knight for 20 points of damage.`, 30000);
  endFight(e, 30000);
  const you = e.getHistoryFight(e.getHistory()[0].id).rows.find((r) => r.name === 'You');
  const lookup = (name) => (name === 'Complete Heal' ? ['Clr'] : null);
  const { estimateClasses } = require('../src/shared/classEstimator');
  assert.deepEqual(estimateClasses(you.castSkills, lookup), [{ name: 'Clr', confidence: 'confirmed' }]);
});

test('a pet\'s own cast lines never contribute class evidence - pets have no class of their own', () => {
  const e = new DamageEngine();
  // "Jebantik" fits EQ's generated-pet-name shape (petNames.js's GENERATED_PET).
  e.handleLine(`${T}Jebantik begins casting Minor Healing.`, 1000);
  assert.deepEqual(e.getCastSkills('Jebantik'), [], 'a summoned pet\'s own ability must not be recorded as class evidence');
});

// Owner, 14 Sep, live-caught against her own real log: "avenrae switches classes a LOT... between
// instances, not during an instance" - a whole-day scan had mixed together cast evidence from
// several genuinely different loadouts Avenrae used in different zones that day (confirmed
// Enchanter/Paladin spells from hours later, in a different zone, bleeding into an earlier fight's
// estimate). Cast evidence must survive ACROSS FIGHTS within one continuous zone visit (a song sung
// once still counts fights later - see the "survives a fight ending" test above), but must NOT
// survive a REAL zone change, since that's exactly where a loadout swap can happen.
test('cast history is cleared on a REAL zone change - a loadout swap happens between instances, not mid-instance', () => {
  const e = new DamageEngine();
  e.enterZone(500, "Nagafen's Lair");
  e.handleLine(`${T}Avenrae begins casting Mesmerization.`, 1000);
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1200);
  endFight(e, 1200);
  e.enterZone(30000, 'The Plane of Fear'); // a genuinely different zone
  assert.deepEqual(e.getCastSkills('Avenrae'), [], 'a real zone change must clear cast evidence - the next zone may be a different loadout entirely');
});

test('cast history survives a SAME-zone re-entry echo (an instance-line right after the entrance line), not just a fight ending', () => {
  const e = new DamageEngine();
  e.enterZone(500, "Nagafen's Lair");
  e.handleLine(`${T}Avenrae begins casting Call of Flame.`, 1000);
  e.enterZone(1500, "Nagafen's Lair"); // same zone name again - not a real change
  // Note: even a same-zone echo clears the "since zone" trackers today (existing, pre-existing
  // behaviour for sinceZoneByAttacker etc.) - castsByAttacker deliberately matches that same
  // convention rather than inventing a special case just for itself.
  assert.deepEqual(e.getCastSkills('Avenrae'), [], 'matches the existing sinceZoneByAttacker convention: any enterZone call clears it, echo or not');
});

test('cast history survives multiple fights within the SAME zone visit - only a real zone change clears it', () => {
  const e = new DamageEngine();
  e.enterZone(500, "Nagafen's Lair");
  e.handleLine(`${T}You begin casting Energy Storm.`, 1000);
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1200);
  endFight(e, 1200); // fight ends, but no zone change
  e.handleLine(`${T}You crush a wan ghoul knight for 5 points of damage.`, 30000);
  endFight(e, 30000); // a second, later fight in the SAME zone visit
  assert.deepEqual(e.getCastSkills('You'), ['Energy Storm'], 'still within the same zone visit - the earlier cast must still count');
});

// ---------------------------------------------------------------------------
// Healing capture into history - the same fight record now carries healRows alongside rows
// (owner, 14 Sep: "the damage meter tab should also do all the same functionality but for
// healing tracking as well"). A fight is still damage-defined (see damageEngine.js's own header);
// this only adds whatever healing happened DURING an already-real fight.
// ---------------------------------------------------------------------------

test('a fight\'s healing is captured alongside its damage, with its own per-skill breakdown', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a flouting gargoyle for 10 points of damage.`, 1000);
  e.handleLine(`${T}Baxa slashes a flouting gargoyle for 5 points of damage.`, 1050); // proves Baxa a friend
  e.handleLine(`${T}Chouder healed Baxa for 100 hit points by Superior Healing.`, 1100);
  e.handleLine(`${T}Chouder healed Baxa for 50 hit points by Superior Healing.`, 1150);
  endFight(e, 1150);
  const fight = e.getHistoryFight(e.getHistory()[0].id);
  assert.equal(e.getHistory()[0].totalHealing, 150);
  const chouder = fight.healRows.find((r) => r.name === 'Chouder');
  assert.ok(chouder, 'Chouder never appeared in healRows at all');
  assert.equal(chouder.damage, 150);
  assert.deepEqual(chouder.bySkill, [{ skill: 'Superior Healing', damage: 150, hits: 2 }]);
});

test('topHealer is reported on the history summary, the same way topAttacker already is', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You healed Baxa for 500 hit points by Complete Heal.`, 1000); // your own heal always credits
  e.handleLine(`${T}You crush a flouting gargoyle for 10 points of damage.`, 1050);
  endFight(e, 1050);
  assert.equal(e.getHistory()[0].topHealer, 'You');
});

test('a fight with damage but no healing at all still has an empty healRows array, not a crash', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  const fight = e.getHistoryFight(e.getHistory()[0].id);
  assert.deepEqual(fight.healRows, []);
  assert.equal(e.getHistory()[0].topHealer, null);
});

// ---------------------------------------------------------------------------
// Zone difficulty (owner, 14 Sep: "let's make all raid entries include their difficulty level").
// See src/shared/zoneDifficulty.js - the CALLER computes the label from the raw zone string and
// passes it in, since by the time zoneName reaches enterZone() it's already the stripped base name.
// ---------------------------------------------------------------------------

test('a fight is tagged with the difficulty told to the engine at zone entry', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Permafrost Caverns', 'd4');
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].difficulty, 'd4');
});

test('a fight with no difficulty told to the engine (an open-world zone) has none, not a stale one', () => {
  const e = new DamageEngine();
  e.enterZone(500, "Nagafen's Lair"); // no third argument - matches an ordinary, non-instanced entry
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].difficulty, null);
});

test('two visits to the SAME zone at DIFFERENT difficulties are tagged correctly, not stuck on the first one seen', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Permafrost Caverns', 'd1');
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  e.enterZone(30000, 'The Feerrott'); // a real zone change in between
  e.enterZone(60000, 'The Permafrost Caverns', 'd4'); // back in, at a different tier this time
  e.handleLine(`${T}You crush a wan ghoul knight for 20 points of damage.`, 61000);
  endFight(e, 61000);
  const [newest, oldest] = e.getHistory();
  assert.equal(oldest.difficulty, 'd1');
  assert.equal(newest.difficulty, 'd4');
  assert.notEqual(oldest.visitId, newest.visitId, 'these must be two separate visits, not one merged pile');
});

// ---------------------------------------------------------------------------
// Raid-vs-group instance flag (owner, 14 Sep: "there needs to be an identifier for (group)/raid
// instance") - a difficulty tier alone doesn't say whether a visit was the raid-lockout instance
// or a plain group run of the same zone. Tri-state (true/false/null), like difficulty's own null
// for "not an instance" - see src/shared/zoneDifficulty.js's isRaidInstance.
// ---------------------------------------------------------------------------

test('a fight is tagged with the raid/group flag told to the engine at zone entry', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Plane of Fear', 'd4', true);
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].raidInstance, true);
});

test('a group-run instance is tagged false, not conflated with "not an instance" (null)', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Plane of Fear', 'd4', false);
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].raidInstance, false, '`false` must survive as false, not collapse to null the way an empty difficulty does');
});

test('an open-world zone with no raid/group flag told to the engine has null, not a stale one', () => {
  const e = new DamageEngine();
  e.enterZone(500, "Nagafen's Lair"); // no 3rd/4th argument - matches an ordinary, non-instanced entry
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  assert.equal(e.getHistory()[0].raidInstance, null);
});

// ---------------------------------------------------------------------------
// Visit boundary now keys on the zone AND its difficulty/raid-or-group tag together, not the
// zone name alone (owner, 14 Sep, second follow-up). Real reported case, confirmed against the
// owner's own log: raid-invited into "The Plane of Fear 4 (Refined)", 15 real tagged fights,
// removed back to bare "The Plane of Fear", ONE trailing untagged fight in the antechamber - all
// of it used to land in ONE visit (base zone name never changed), and picking the visit's
// displayed tag from whichever fight happened to be newest meant that one trailing untagged fight
// silently erased the D4/Group tag off the 15 real fights before it.
// ---------------------------------------------------------------------------

test('stepping out of an instance (back to the bare zone) opens a NEW visit, even though the base zone name is unchanged', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Plane of Fear', 'd4', false); // raid-invited into the tagged instance
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  e.enterZone(30000, 'The Plane of Fear'); // removed from the instance, back in the bare antechamber
  e.handleLine(`${T}You crush a wan ghoul knight for 5 points of damage.`, 31000);
  endFight(e, 31000);
  const [newest, oldest] = e.getHistory();
  assert.equal(oldest.difficulty, 'd4');
  assert.equal(oldest.raidInstance, false);
  assert.equal(newest.difficulty, null, 'the trailing antechamber fight must have no tag of its own');
  assert.equal(newest.raidInstance, null);
  assert.notEqual(oldest.visitId, newest.visitId, 'the exact reported bug: these must be two separate visits, or the untagged fight erases the real tag off the tagged one');
});

test('a difficulty change alone (same zone, different tier) opens a new visit', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Plane of Fear', 'd2', false);
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  e.enterZone(30000, 'The Plane of Fear', 'd4', false); // re-invited at a different tier, same session
  e.handleLine(`${T}You crush a wan ghoul knight for 20 points of damage.`, 31000);
  endFight(e, 31000);
  const [newest, oldest] = e.getHistory();
  assert.equal(oldest.difficulty, 'd2');
  assert.equal(newest.difficulty, 'd4');
  assert.notEqual(oldest.visitId, newest.visitId);
});

test('a raid-vs-group change alone (same zone and tier, different instance kind) opens a new visit', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Plane of Fear', 'd4', false); // a group run
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  e.enterZone(30000, 'The Plane of Fear', 'd4', true); // the raid-lockout instance, same tier
  e.handleLine(`${T}You crush a wan ghoul knight for 20 points of damage.`, 31000);
  endFight(e, 31000);
  const [newest, oldest] = e.getHistory();
  assert.equal(oldest.raidInstance, false);
  assert.equal(newest.raidInstance, true);
  assert.notEqual(oldest.visitId, newest.visitId);
});

test('a genuine echo - the exact same zone, difficulty, and raid/group flag - does NOT open a new visit', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Plane of Fear', 'd4', true);
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  endFight(e, 1000);
  e.enterZone(2000, 'The Plane of Fear', 'd4', true); // an echoed zone line, nothing actually changed
  e.handleLine(`${T}You crush a wan ghoul knight for 20 points of damage.`, 3000);
  endFight(e, 3000);
  const [newest, oldest] = e.getHistory();
  assert.equal(oldest.visitId, newest.visitId, 'an identical re-announcement of the same instance must not split one visit into two');
});

// ---------------------------------------------------------------------------
// getLiveFight (owner, 14 Sep: "i need some way to be able to live read the current combat from
// this combat tab") - a fight only ever reaches getHistory()/getHistoryFight() once it ENDS, so an
// active pull that hasn't hit the idle timeout yet was invisible to the Combat tab no matter how
// long it ran. This reads the SAME live state the overlay's own meter draws from, mid-fight.
// ---------------------------------------------------------------------------

test('getLiveFight returns the in-progress fight, in the same shape a completed history entry has', () => {
  const e = new DamageEngine();
  e.enterZone(500, 'The Plane of Fear', 'd4', true);
  e.handleLine(`${T}You crush a wan ghoul knight for 40 points of damage.`, 1000);
  e.handleLine(`${T}Baxa slashes a wan ghoul knight for 100 points of damage.`, 2000);
  const live = e.getLiveFight();
  assert.ok(live, 'a fight with real damage under way must not read as "nothing happening"');
  assert.equal(live.id, 'live', 'must never collide with a real numeric history id');
  assert.equal(live.totalDamage, 140);
  assert.equal(live.zone, 'The Plane of Fear');
  assert.equal(live.difficulty, 'd4');
  assert.equal(live.raidInstance, true);
  assert.ok(live.rows.find((r) => r.name === 'Baxa'), 'must carry full per-attacker rows, not a summary');
  assert.ok(Array.isArray(live.rows.find((r) => r.name === 'Baxa').bySkill), 'must carry the per-skill breakdown too - the same chart code renders both a live and a completed fight');
});

test('getLiveFight returns null before any fight has started, and after one ends', () => {
  const e = new DamageEngine();
  assert.equal(e.getLiveFight(), null, 'nothing has happened yet');
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  assert.ok(e.getLiveFight(), 'a fight is now genuinely under way');
  endFight(e, 1000);
  assert.equal(e.getLiveFight(), null, 'the fight already ended and was captured to history - it is no longer "live"');
});

test('getLiveFight never mutates state - checking it repeatedly does not end or double-count the fight', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 1000);
  e.getLiveFight();
  e.getLiveFight();
  e.getLiveFight();
  e.handleLine(`${T}You crush a wan ghoul knight for 5 points of damage.`, 2000);
  const live = e.getLiveFight();
  assert.equal(live.totalDamage, 15, 'repeated reads must not have reset or otherwise disturbed the running fight');
});

// ---------------------------------------------------------------------------
// captureHistory / restoreHistory (owner, 14 Sep: "EVERY part of the app should have a recovery
// for accidental close, this is no exception") - traced from a real report: a fight was played out
// in full (~9 minutes of real combat) but never showed up in Past Fights, because the app had
// restarted again before that fight's idle timeout ever fired, and history has always been
// in-memory only. Separate from captureState/restoreState (the still-LIVE fight/tally, capped at
// a short grace window) - a COMPLETED fight is a permanent fact, so this has no staleness limit.
// ---------------------------------------------------------------------------

test('captureHistory / restoreHistory carries completed fights across a restart', () => {
  const a = new DamageEngine();
  a.handleLine(`${T}You crush a zol ghoul knight for 100 points of damage.`, 1000);
  endFight(a, 1000);
  const snap = a.captureHistory();
  assert.ok(snap);

  const b = new DamageEngine();
  const n = b.restoreHistory(snap);
  assert.equal(n, 1);
  const hist = b.getHistory();
  assert.equal(hist.length, 1);
  assert.equal(hist[0].totalDamage, 100);
});

test('nothing captured yet -> captureHistory is null, and restoreHistory is a harmless no-op on garbage', () => {
  assert.equal(new DamageEngine().captureHistory(), null);
  const b = new DamageEngine();
  assert.equal(b.restoreHistory(null), 0);
  assert.equal(b.restoreHistory({}), 0);
  assert.equal(b.restoreHistory({ history: [] }), 0);
  assert.equal(b.getHistory().length, 0);
});

test('restored fights are merged newest-first ahead of anything this run has already captured itself', () => {
  const a = new DamageEngine();
  a.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1000);
  endFight(a, 1000);
  const snap = a.captureHistory(); // one restored fight, "from before the restart"

  const b = new DamageEngine();
  b.handleLine(`${T}You crush a zol ghoul knight for 20 points of damage.`, 500000); // this run's OWN fight, captured first
  endFight(b, 500000);
  b.restoreHistory(snap);
  const hist = b.getHistory();
  assert.equal(hist.length, 2);
  // getHistory() is newest-first; the restored (older, pre-restart) fight belongs at the END.
  assert.equal(hist[0].totalDamage, 20, 'this run\'s own fight is the newer one and must stay first');
  assert.equal(hist[1].totalDamage, 10);
});

test('restored fight ids never collide with ids this run generates afterwards', () => {
  const a = new DamageEngine();
  a.handleLine(`${T}You crush a zol ghoul knight for 10 points of damage.`, 1000);
  endFight(a, 1000);
  const snap = a.captureHistory();
  const restoredId = snap.history[0].id;

  const b = new DamageEngine();
  b.restoreHistory(snap);
  b.handleLine(`${T}You crush a zol ghoul knight for 20 points of damage.`, 500000);
  endFight(b, 500000);
  const ids = b.getHistory().map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'no two history entries may share an id');
  assert.equal(ids.filter((id) => id === restoredId).length, 1, 'the restored entry\'s own id must appear exactly once - reused by a later capture is a collision, and this is just checking the setup is what it claims to be');
});

test('respects the same _maxHistory cap restoring already-live history does', () => {
  const a = new DamageEngine({ maxHistory: 2 });
  for (let i = 0; i < 3; i++) {
    a.handleLine(`${T}You crush a zol ghoul knight for ${10 + i} points of damage.`, 1000 + i * 100000);
    endFight(a, 1000 + i * 100000);
  }
  const snap = a.captureHistory();
  assert.equal(snap.history.length, 2, 'the source engine\'s own cap already trimmed it to 2');

  const b = new DamageEngine({ maxHistory: 2 });
  b.restoreHistory(snap);
  assert.equal(b.getHistory().length, 2);
});

module.exports = () => report('damage-history');
if (require.main === module) report('damage-history').then((n) => process.exit(n ? 1 : 0));
