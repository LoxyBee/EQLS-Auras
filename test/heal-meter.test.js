'use strict';
/**
 * Healing tracking, added to the damage meter's own engine at the owner's explicit request: "it
 * should use the same method. collect all data, hold it, then collapse into the correct players
 * based on the same method as the dps meter." Two things worth testing separately, the same split
 * damage-parser.test.js uses:
 *
 * FIRST, that healLines.js's pattern matches the real wordings (see that file's header for the
 * measurement this was built from - 898,041 of 898,182 real "healed ... hit points" lines matched,
 * the rest being the one wording that names no healer at all and is correctly dropped).
 *
 * SECOND, that DamageEngine's heal side reuses the SAME friend/enemy bootstrap and the SAME
 * collect/hold/collapse (_tilesFrom) method the damage side already had - not a parallel
 * reimplementation of either.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { parseHealLine } = require('../src/shared/healLines');
const { DamageEngine } = require('../src/main/damageEngine');

const T = '[Wed Aug 19 21:14:02 2026] ';

// ---------------------------------------------------------------------------
// The line pattern
// ---------------------------------------------------------------------------

test('a first-person heal names You as the healer', () => {
  const h = parseHealLine(`${T}You healed Accurately for 116 hit points.`);
  assert.deepEqual(h, { healer: 'You', target: 'Accurately', amount: 116, spell: null });
});

test('a third-person heal names both parties and the spell', () => {
  const h = parseHealLine(`${T}Accurately healed you for 20 hit points by Minor Healing.`);
  assert.deepEqual(h, { healer: 'Accurately', target: 'You', amount: 20, spell: 'Minor Healing' });
});

test('a self-heal pronoun resolves the target back to the healer', () => {
  const h = parseHealLine(`${T}Belle healed herself for 20 hit points by Inner Fire.`);
  assert.deepEqual(h, { healer: 'Belle', target: 'Belle', amount: 20, spell: 'Inner Fire' });
});

test('an overhealed cast uses the applied amount, not the parenthetical raw value', () => {
  const h = parseHealLine(`${T}Avenrae healed herself for 0 (6) hit points by Blessing of the Lord Commander.`);
  assert.equal(h.amount, 0, 'fully overhealed - 0 actually applied, 6 discarded');
});

test('a maintained HoT tick on a self-cast still resolves the "over time" pronoun', () => {
  const h = parseHealLine(`${T}Adhemar healed himself over time for 20 hit points by Regrowth.`);
  assert.deepEqual(h, { healer: 'Adhemar', target: 'Adhemar', amount: 20, spell: 'Regrowth' });
});

test('a HoT tick on someone else still names the real healer, not a pronoun', () => {
  const h = parseHealLine(`${T}You healed Avenrae over time for 368 hit points by Celestial Healing.`);
  assert.deepEqual(h, { healer: 'You', target: 'Avenrae', amount: 368, spell: 'Celestial Healing' });
});

test('a trailing (Critical) is tolerated like damageLines\' own CRIT_SUFFIX', () => {
  const h = parseHealLine(`${T}You healed Avenrae for 2056 hit points by Healing Light. (Critical)`);
  assert.deepEqual(h, { healer: 'You', target: 'Avenrae', amount: 2056, spell: 'Healing Light' });
});

// The one wording with no healer named at all - dropped, not guessed at (see the file header).
test('a passive "has been healed over time" line names no healer and is dropped', () => {
  const h = parseHealLine(`${T}Accurately has been healed over time for 184 hit points by Celestial Healing.`);
  assert.equal(h, null);
});

test('a non-heal line is not matched', () => {
  assert.equal(parseHealLine(`${T}You crush a wan ghoul knight for 60 points of damage.`), null);
});

// ---------------------------------------------------------------------------
// The engine - shares the bootstrap and the collapsing method, doesn't duplicate either
// ---------------------------------------------------------------------------

test('healing someone proven a friend by DAMAGE is credited with no separate heal-side bootstrap', () => {
  const e = new DamageEngine();
  // Seed an enemy, then prove Baxa a friend via rule 2 on the damage side (damaging a known enemy).
  e.handleLine(`${T}You crush a flouting gargoyle for 60 points of damage.`, 1000);
  e.handleLine(`${T}Baxa slashes a flouting gargoyle for 40 points of damage.`, 1000);
  assert.ok(e.friends.has('baxa'));
  // Someone else's heal on Baxa should now credit immediately - the friend set is shared.
  e.handleLine(`${T}Chouder healed Baxa for 100 hit points by Superior Healing.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  const chouder = rows.find((r) => r.name === 'Chouder');
  assert.ok(chouder, 'Chouder\'s heal on a known friend was credited');
});

test('your own heal on an unrecognised name proves them a friend and credits it', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You healed Doraleous for 500 hit points by Complete Heal.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  const you = rows.find((r) => r.name === 'You');
  assert.ok(you, 'your own heal always credits - nobody heals an enemy');
});

test('a heal landing on a name of unknown allegiance is held, not credited, until proven', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}Fenn healed Graznthok for 100 hit points by Healing.`, 1000);
  assert.deepEqual(e.getActive(1000, 'all', 'healing'), [], 'neither name is known yet - held');
  // Fenn now proven a friend via rule 2 on the damage side - the held heal should flush.
  e.handleLine(`${T}You crush a wan ghoul knight for 60 points of damage.`, 1000);
  e.handleLine(`${T}Fenn slashes a wan ghoul knight for 20 points of damage.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  assert.ok(rows.some((r) => r.name === 'Fenn'), 'the held heal was flushed once Fenn was provable');
});

test('a mob "healing" another mob is dropped, not shown on the meter', () => {
  const e = new DamageEngine();
  // Seed a known enemy the ordinary way.
  e.handleLine(`${T}You crush a zol ghoul knight for 60 points of damage.`, 1000);
  e.handleLine(`${T}a zol ghoul knight healed itself for 50 hit points by Regrowth.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  assert.equal(rows.find((r) => r.name === 'a zol ghoul knight'), undefined);
});

// Reported live 7 Sep, Befallen: a "Charmed pets" row on the HEAL meter healing ~1.1k, with no
// charm anywhere in the session. Cause: in a charm-war zone a hostile mob's name drifts onto the
// friend side through the bootstrap, and once it has, its constant self-heals get credited to the
// group's "Charmed pets" heal row. An article-prefixed name petTracker never saw a charm line for
// contributes damage (a possible wild charm) but never healing.
test('a leaked hostile mob\'s self-heals never reach the "Charmed pets" heal row', () => {
  const e = new DamageEngine();
  // "an ice bones" leaks onto the friend side by hitting a mob the player tagged (rule 2).
  e.handleLine(`${T}You crush a greater mummy for 60 points of damage.`, 1000);
  e.handleLine(`${T}an ice bones hits a greater mummy for 20 points of damage.`, 1000);
  // ...then it self-heals, the way hostiles do all fight.
  e.handleLine(`${T}an ice bones healed itself for 300 hit points by Symbol of Ryltan.`, 1000);
  e.handleLine(`${T}an ice bones healed itself for 300 hit points by Symbol of Ryltan.`, 1000);
  const heal = e.getActive(1000, 'all', 'healing');
  assert.equal(heal.find((r) => r.name === 'Charmed pets'), undefined, 'no phantom Charmed pets heal row');
  // Its DAMAGE still folds into Charmed pets - that could be a real wild charm (gotcha #40).
  const dmg = e.getActive(1000, 'all', 'damage');
  assert.ok(dmg.find((r) => r.name === 'Charmed pets'), 'damage side is unchanged');
});

test('a wild charm petTracker DID see a charm line for still shows its healing', () => {
  const e = new DamageEngine();
  e.setPetsFn(() => ({
    ownPetKeyByName: new Map(),
    unknownPetNames: new Set(['a spite golem']),
    allyPetLeader: new Map(),
  }));
  e.handleLine(`${T}You crush a greater mummy for 60 points of damage.`, 1000);
  e.handleLine(`${T}a spite golem hits a greater mummy for 20 points of damage.`, 1000);
  e.handleLine(`${T}a spite golem healed itself for 120 hit points by Regrowth.`, 1000);
  const heal = e.getActive(1000, 'all', 'healing');
  const charmed = heal.find((r) => r.name === 'Charmed pets');
  assert.ok(charmed && /120/.test(charmed.valueText), 'a vouched charmed pet\'s heal is still counted');
});

test('damage and healing are tallied completely separately', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 100 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}You healed Baxa for 300 hit points by Complete Heal.`, 1000);
  const dmg = e.getActive(1000, 'all', 'damage');
  const heal = e.getActive(1000, 'all', 'healing');
  assert.equal(dmg.find((r) => r.name === 'You').valueText.split(' ')[0], '100');
  assert.equal(heal.find((r) => r.name === 'You').valueText.split(' ')[0], '300');
});

test('an unset mode defaults to the plain damage view', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 100 damage from your Frost Bolt.`, 1000);
  assert.deepEqual(e.getActive(1000, 'all'), e.getActive(1000, 'all', 'damage'));
});

// ---------------------------------------------------------------------------
// 'both' mode - one row per player, damage and healing merged into a split bar
// ---------------------------------------------------------------------------

test("'both' merges one player's damage and healing into a single row", () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 100 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}You healed Baxa for 300 hit points by Complete Heal.`, 1000);
  const rows = e.getActive(1000, 'all', 'both');
  assert.equal(rows.filter((r) => r.name === 'You').length, 1, 'one row for You, not two');
  const you = rows.find((r) => r.name === 'You');
  assert.ok(you.valueText.includes('100') && you.valueText.includes('300'), 'both amounts on the one row');
});

test("'both' row's barSplit is the damage share of that row's own bar", () => {
  const e = new DamageEngine();
  // You: 300 damage, 100 healing -> 75% of your own bar should be the damage segment.
  e.handleLine(`${T}A flouting gargoyle has taken 300 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}You healed Baxa for 100 hit points by Complete Heal.`, 1000);
  const you = e.getActive(1000, 'all', 'both').find((r) => r.name === 'You');
  assert.equal(you.barSplit, 0.75);
});

test("a healing-only player in 'both' mode gets barSplit 0 (an all-heal-coloured bar)", () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 100 damage from your Frost Bolt.`, 1000);
  // Chouder only heals - proven a friend by healing You (a known friend).
  e.handleLine(`${T}Chouder healed you for 50 hit points by Superior Healing.`, 1000);
  const chouder = e.getActive(1000, 'all', 'both').find((r) => r.name === 'Chouder');
  assert.ok(chouder);
  assert.equal(chouder.barSplit, 0);
});

test("'both' bar length is scaled against the biggest COMBINED total, not damage or healing alone", () => {
  const e = new DamageEngine();
  // You: 100 damage only. Chouder: 90 healing only. Chouder's combined total (90) is the biggest.
  e.handleLine(`${T}A flouting gargoyle has taken 100 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}Chouder healed you for 90 hit points by Superior Healing.`, 1000);
  const rows = e.getActive(1000, 'all', 'both');
  const you = rows.find((r) => r.name === 'You');
  const chouder = rows.find((r) => r.name === 'Chouder');
  assert.equal(you.barPercent, 100, 'You has the biggest combined total (100), so a full bar');
  assert.equal(chouder.barPercent, 90, "Chouder's 90 is 90% of You's 100");
});

test("'both' row: each metric's share % is of its OWN grand total, carried in its own field", () => {
  const e = new DamageEngine();
  // You: 300 damage (of 400 grand damage - 75%). Chouder: 100 damage (25%).
  e.handleLine(`${T}A flouting gargoyle has taken 300 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}Chouder slashes a flouting gargoyle for 100 points of damage.`, 1000);
  // You: 50 healing (of 200 grand healing - 25%). Chouder: 150 (75%).
  e.handleLine(`${T}You healed Baxa for 50 hit points by Complete Heal.`, 1000);
  e.handleLine(`${T}Chouder healed Baxa for 150 hit points by Superior Healing.`, 1000);
  const rows = e.getActive(1000, 'all', 'both');
  const you = rows.find((r) => r.name === 'You');
  const chouder = rows.find((r) => r.name === 'Chouder');
  assert.equal(you.damageValueText, '300', 'the number has no % inline any more');
  assert.equal(you.damagePctText, '75%', "You's damage share is of the DAMAGE total, not combined");
  assert.equal(you.healValueText, '50');
  assert.equal(you.healPctText, '25%', "You's heal share is of the HEAL total, not combined");
  assert.equal(chouder.damagePctText, '25%');
  assert.equal(chouder.healPctText, '75%');
});

test("'both' row carries all three readings of BOTH numbers (for side-by-side and cycling)", () => {
  // 5 Sep: side-by-side Both shows the damage number by damageValueMode + a plain heal total;
  // cycling Both (damageBothCycleSec > 0) shows one metric at a time at full detail, so the heal
  // rate readings are earned back. The engine emits every reading; the overlay picks.
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 30000 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}A flouting gargoyle has taken 30000 damage from your Frost Bolt.`, 7000); // 6s -> 10k/s
  e.handleLine(`${T}You healed Baxa for 30000 hit points by Complete Heal.`, 7000);
  const you = e.getActive(7000, 'all', 'both').find((r) => r.name === 'You');
  assert.equal(you.damageValueText, '60.0k');
  assert.ok(/^[\d.]+k?\/s$/.test(you.damageDpsText), you.damageDpsText);
  assert.ok(/^60\.0k \([\d.]+k?\/s\)$/.test(you.damageBothText), you.damageBothText);
  assert.equal(you.healValueText, '30.0k');
  assert.ok(/^[\d.]+k?\/s$/.test(you.healDpsText), you.healDpsText);
  assert.ok(/^30\.0k \([\d.]+k?\/s\)$/.test(you.healBothText), you.healBothText);
  assert.equal(you.damagePctText, '100%');
  assert.equal(you.healPctText, '100%');
});

test("a scope:'mine' Both meter falls through to the zone tally when the fight has nothing of yours yet", () => {
  // Reported live 4 Sep: a scope:'mine' Both meter "only shows zone total, not fight total then
  // zone total". Cause: mid-pull, before you've acted, the fight branch's scoped view is empty and
  // getActive returned []. Now it falls through to the since-zone view instead of blanking.
  const e = new DamageEngine();
  e.setGroupFn(() => ['avenrae']);
  e.handleLine(`${T}You healed Baxa for 40 hit points by Complete Heal.`, 1000); // seeds your since-zone heal
  e.enterZone(1000); // ...actually clears it - redo after the zone line
  e.handleLine(`${T}You healed Baxa for 40 hit points by Complete Heal.`, 2000);
  // A fresh fight where only a groupmate acts.
  e.handleLine(`${T}You crush a wan ghoul knight for 10 points of damage.`, 60000); // your tiny hit seeds the fight + enemy
  e.handleLine(`${T}Avenrae slashes a wan ghoul knight for 500 points of damage.`, 60000);
  e.handleLine(`${T}Avenrae healed Avenrae for 300 hit points by Superior Healing.`, 60000);
  const rows = e.getActive(60000, 'mine', 'both');
  assert.ok(rows.length > 0, 'not blank mid-fight');
  assert.ok(rows.some((r) => r.name === 'You'), 'your own row still shows (from the zone tally)');
});

test("'both' Total row sums damage and healing separately, not into one number", () => {
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 100 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}You healed Baxa for 300 hit points by Complete Heal.`, 1000);
  const total = e.getActive(1000, 'all', 'both').find((r) => r.totalRow);
  assert.ok(total.valueText.includes('100'));
  assert.ok(total.valueText.includes('300'));
  assert.equal(total.noBar, true);
});

test('healing with no damage shows the since-zone tally, never a "current fight"', () => {
  // A fight is defined by DAMAGE. Healing alone (out of combat, or a heal-only stretch) is the
  // zone tally, marked as such.
  const e = new DamageEngine();
  e.handleLine(`${T}You healed Baxa for 300 hit points by Complete Heal.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  assert.equal(rows.length, 2, 'Total + You');
  assert.equal(rows[rows.length - 1].sinceZone, true, 'not a current-fight total - there was no fight');
  e.enterZone(21000);
  assert.deepEqual(e.getActive(21000, 'all', 'healing'), []);
});

test('a heal-over-time ticking after combat does NOT keep the fight alive', () => {
  // Reported live 5 Sep: minutes after a Mistmoore pull the meter still showed "Total" (the
  // current-fight view) not "Total (since zone)". Cause: a regen bard song (Cantata, Chorus of
  // Marr) ticks a "healed" line every ~6s forever, and healing had been wired into the fight's
  // idle-timeout - so the fight never ended. Healing must not touch the fight clock.
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 500 damage from your Frost Bolt.`, 1000); // a real fight
  assert.equal(e.getActive(1000, 'all', 'both').find((r) => r.totalRow).sinceZone, false, 'mid-fight');
  // Combat ends. Cantata keeps ticking heals every 6s for the next two minutes.
  for (let t = 7000; t <= 127000; t += 6000) {
    e.handleLine(`${T}You healed Baxa for 40 hit points by Cantata of Soothing.`, t);
    e.tick(t);
  }
  const total = e.getActive(127000, 'all', 'both').find((r) => r.totalRow);
  assert.equal(total.sinceZone, true, 'the fight timed out ~10s after the last hit, despite the heal ticks');
});

test('a friendly self-heal / lifetap IS counted as healing (owner: self-healing counts)', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a flouting gargoyle for 60 points of damage.`, 1000); // seed enemy
  e.handleLine(`${T}Avenrae slashes a flouting gargoyle for 40 points of damage.`, 1000); // Avenrae -> friend
  e.handleLine(`${T}Avenrae healed herself for 4000 hit points by Blessing of the Knight.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  assert.ok(rows.some((r) => r.name === 'Avenrae'), 'Avenrae\'s self-heal shows');
});

test('an ENEMY self-heal is still not friendly healing', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a zol ghoul knight for 60 points of damage.`, 1000); // known enemy
  e.handleLine(`${T}a zol ghoul knight healed itself for 200 hit points by Blooming Heal.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  assert.ok(!rows.some((r) => /ghoul/.test(r.name)), 'an enemy healing itself is not on the group heal meter');
});

test('a delayed "... by <Base> Trigger" heal is credited to the caster, not the target', () => {
  // Reported live 5 Sep: the player casts Promised Renewal on the tank; it triggers later as
  // "Avenrae healed herself ... by Promised Renewal Trigger I" - which was crediting the tank.
  const e = new DamageEngine();
  e.handleLine(`${T}A flouting gargoyle has taken 100 damage from your Frost Bolt.`, 1000);
  e.handleLine(`${T}You begin casting Promised Renewal IX.`, 1000);
  e.handleLine(`${T}Avenrae healed herself for 5000 hit points by Promised Renewal Trigger I.`, 10000);
  const rows = e.getActive(10000, 'all', 'healing');
  const you = rows.find((r) => r.name === 'You');
  assert.ok(you && /5000|5\.0k/.test(you.valueText), `the Promised Renewal heal is credited to You: ${you && you.valueText}`);
  assert.ok(!rows.some((r) => r.name === 'Avenrae'), 'not to Avenrae, and not dropped as a self-heal');
});

test('a Trigger heal with no matching recent cast stays as read', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You crush a flouting gargoyle for 60 points of damage.`, 1000);
  e.handleLine(`${T}Avenrae slashes a flouting gargoyle for 40 points of damage.`, 1000); // Avenrae -> friend
  // No "begins casting Foo" seen - so "by Foo Trigger" is not re-credited.
  e.handleLine(`${T}Avenrae healed herself for 200 hit points by Foo Trigger I.`, 1000);
  const rows = e.getActive(1000, 'all', 'healing');
  assert.ok(rows.some((r) => r.name === 'Avenrae'), 'stays credited to Avenrae');
});

test('healing survives capture/restore the same way damage does', () => {
  const e = new DamageEngine();
  e.handleLine(`${T}You healed Baxa for 300 hit points by Complete Heal.`, 1000);
  const snap = e.captureState();
  assert.ok(snap, 'a session with only healing still captures state');
  const e2 = new DamageEngine();
  e2.restoreState(snap, 0, 2000);
  const rows = e2.getActive(2000, 'all', 'healing');
  assert.ok(rows.some((r) => r.name === 'You' && r.valueText.startsWith('300')));
});

module.exports = () => report('heal-meter');
if (require.main === module) report('heal-meter').then((n) => process.exit(n ? 1 : 0));
