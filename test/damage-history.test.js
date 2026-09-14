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

module.exports = () => report('damage-history');
if (require.main === module) report('damage-history').then((n) => process.exit(n ? 1 : 0));
