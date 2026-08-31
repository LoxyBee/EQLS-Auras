'use strict';
/**
 * Note 26: whether one self-buff overwrites another, computed from the game's own effect-slot
 * data instead of guessed. See src/main/spellStacking.js's header comment for the full story - the
 * short version is EQ never prints a line for a buff overwritten on the player's OWN self (only
 * for one on someone else), and some spells share their fade text (Nimble/Agility both say "Your
 * agility fades."), so the app can't tell which of two active buffs a shared fade line meant
 * without this.
 *
 * The rows below are copied VERBATIM from the owner's real EQ Legends install's spells_us.txt (25
 * Aug) - not synthesized - so this test is pinned to real data, the same way detection.test.js
 * pins behaviour against the real roster. A tiny fixture file rather than requiring the real
 * install to be present, so this runs on any machine.
 *
 * Ground truth, all confirmed the same day directly from the owner's own logs and spell file:
 *   - Five real "X did not take hold. (Blocked by Y.)" lines: Strength, Dexterity, Infusion of
 *     Spirit and Talisman of Altuna all blocked while Harnessing of Spirit was up; Armor of
 *     Protection blocked while Talisman of Altuna was up.
 *   - Nimble and Agility both carry SPA 6 (AGI) in slot 1 - Agility's cap is higher, so it should
 *     win over Nimble but not the reverse.
 *   - Spirit of the Puma and Clarity share no effect ID with anything above - negative controls.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { stackVerdict, checkOverwrite } = require('../src/main/spellStacking');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

// id^name^...^ (170 filler fields aren't needed - only the id, name, and the pipe-tail matter to
// this module) ^<lastCaretField>|<effect tail>
const ROWS = [
  '160^Nimble^0^^100^0^0^0^5000^1500^1500^3^540^0^80^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^25^5^0^0^0^255^255^255^255^255^255^255^255^255^31^255^255^255^255^255^255^43^0^0^7^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^9^303^0^0^0^1^0^0^0^0^160^95^2^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^5^101^47^3^540^0^0^0^0^0^50^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^52^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^14105^0^-1^-1^-1^-1^0^1|6|16|0|101|36',
  '154^Agility^0^^100^0^0^0^5000^1500^1500^3^630^0^100^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^5^5^0^0^0^255^255^255^255^255^255^255^255^255^41^255^255^255^255^255^255^43^0^0^7^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^9^303^0^0^0^1^0^0^0^0^154^95^2^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^5^101^52^3^630^0^0^0^0^0^50^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^52^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^14105^0^-1^-1^-1^-1^0^1|6|21|0|101|45',
  '2525^Harnessing of Spirit^0^^100^0^0^0^10000^1500^7500^3^720^0^425^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^5^5^0^0^0^255^255^255^255^255^255^255^255^255^46^255^255^255^255^255^255^43^0^0^2^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^130^304^0^0^0^1^0^0^0^0^2525^45^87^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^-42^133^-57^3^720^0^0^0^0^3^498^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^3^0^0^1^1^1^0^0^0^0^1^32^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^100100090^0^-1^-1^-1^-1^0^1|69|151|0|103|251$2|79|151|0|103|251$3|10|0|0|100|0$4|4|42|0|101|67$5|5|1|0|102|50$6|149|4|1|100|67$7|149|5|1|100|50$8|148|4|1|100|1067$9|148|5|1|100|1050',
  '157^Dexterity^0^^100^0^0^0^5000^1500^1500^3^630^0^100^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^0^5^0^0^0^255^255^255^255^255^255^255^255^255^48^255^255^255^255^57^255^43^0^0^7^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^8^303^0^0^0^1^0^0^0^0^157^95^24^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^-42^133^-57^3^630^0^0^0^0^0^50^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^52^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^14115^0^-1^-1^-1^-1^0^1|5|1|0|102|50',
  '159^Strength^0^^100^0^0^0^5000^1500^1500^3^630^0^100^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^0^5^0^0^0^255^255^255^255^255^255^255^255^255^46^255^255^255^255^255^255^43^0^0^7^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^6^219^0^0^0^1^0^0^0^0^159^95^96^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^-42^133^-57^3^630^0^0^0^0^0^50^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^52^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^14118^0^-1^-1^-1^-1^0^1|4|42|0|101|67',
  '3454^Infusion of Spirit^0^^100^0^0^0^10000^1500^1500^3^720^0^200^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^5^5^0^0^0^255^255^255^255^255^255^255^255^255^49^255^255^255^255^61^255^43^0^0^2^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^130^304^0^0^0^0^0^0^0^0^3454^45^96^94^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^-42^133^-57^3^720^0^0^0^0^0^50^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^5^0^0^1^1^1^-1^0^0^0^1^52^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^14995^0^-1^-1^-1^-1^0^1|10|0|0|100|0$2|10|0|0|100|0$3|10|0|0|100|0$4|4|50|0|100|50$5|5|55|0|100|55$6|7|45|0|100|45',
  '168^Talisman of Altuna^0^^100^0^0^0^8000^1500^7500^3^720^0^250^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^5^5^0^0^0^255^255^255^255^255^255^255^255^255^40^255^255^255^255^58^255^43^0^0^2^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^130^304^0^0^0^1^0^0^0^0^168^45^87^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^5^101^52^3^720^0^0^0^0^3^323^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^0^0^0^0^1^32^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^14104^0^-1^-1^-1^-1^0^1|69|150|0|103|250$2|79|150|0|103|250',
  '1445^Armor of Protection^0^^100^0^0^0^3500^1500^1500^50^0^0^110^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^6^20^4^0^0^0^255^34^255^255^255^255^255^255^255^255^255^255^255^255^255^255^42^27^0^2^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^132^313^0^0^0^0^0^0^0^0^1445^45^87^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^5^101^47^3^1440^0^0^0^0^3^184^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^0^0^0^0^1^32^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^4026^0^-1^-1^-1^-1^0^1|69|100|0|104|225$2|1|50|0|100|50$3|79|100|0|104|225',
  '6906^Spirit of the Puma^0^^100^0^0^0^3000^1500^1500^3^0^0^212^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^0^5^0^0^0^255^255^255^255^255^255^255^255^255^255^255^255^255^255^255^255^43^0^0^7^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^9^303^0^0^0^1^0^0^0^0^6906^95^2^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^52^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^0^0^-1^-1^-1^-1^0^1|10|0|0|100|0$2|10|0|0|100|0$3|10|0|0|100|0$4|10|0|0|100|0$5|85|6908|400|100|0',
  '174^Clarity^0^^200^0^0^0^3100^1500^1500^3^270^0^75^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^25^5^0^0^0^255^255^255^255^255^255^255^255^255^255^255^255^255^26^255^255^44^0^0^6^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^21^256^0^0^0^1^0^0^0^0^174^79^59^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^5^101^24^3^270^0^0^0^0^0^50^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^36^64892^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^100140100^0^-1^-1^-1^-1^0^1|10|0|0|100|0$2|15|1|0|109|9',
  // Fix 3 (bard-song stacking): the exact SPA-1 (AC) collision from the owner's 30 Aug log -
  // Elemental Rhythms (a bard resist song, slot 4 AC base 5) and Shield of Words (a cleric AC line,
  // slot 4 AC base 105). Copied verbatim from her real spells_us.txt. The slot-by-slot heuristic
  // says Shield of Words overwrites Elemental Rhythms (105 > 5); the engine must NOT act on that,
  // because on EQL the song and the AC spell coexist (see docs/research/bard-song-stacking.md).
  '710^Elemental Rhythms^0^^0^50^0^0^3000^0^0^5^2^0^0^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^41^15^70^0^0^0^255^255^255^255^255^255^255^9^255^255^255^255^255^255^255^255^39^0^0^6^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^148^336^0^0^0^1^0^0^0^1^710^95^80^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^5^101^14^5^3^0^0^1^0^0^50^0^0^0^0^0^0^0^0^0^0^0^1^0^320^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^1^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^70^0^-1^-1^-1^-1^0^1|50|5|0|101|50$2|47|5|0|101|50$3|46|5|0|101|50$4|1|5|0|109|0',
  '20^Shield of Words^0^^100^0^0^0^8000^1500^1500^3^720^0^300^-1^-1^-1^-1^1^1^1^1^-1^-1^-1^-1^0^1^0^51^0^4^0^0^0^255^45^60^255^255^255^255^255^255^255^255^255^255^255^255^255^42^0^0^2^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^100^151^313^0^0^0^1^0^0^0^0^20^95^6^0^0^0^0^0^100^0^0^0^0^0^0^0^0^0^0^-42^133^-57^3^720^0^0^0^0^0^50^0^0^0^0^0^0^0^0^0^0^1^1^0^0^0^0^0^-1^0^0^0^1^0^0^1^1^1^-1^0^0^0^1^1^-1^0^1^0^0^1^0^1^0^0^0^0^0^0^0^0^0^100020040^0^-1^-1^-1^-1^0^1|10|0|0|100|0$2|10|0|0|100|0$3|10|0|0|100|0$4|1|105|0|100|0',
];

const NIMBLE = 160, AGILITY = 154, HARNESSING = 2525, DEXTERITY = 157, STRENGTH = 159;
const INFUSION = 3454, TALISMAN = 168, ARMOR = 1445, PUMA = 6906, CLARITY = 174;
const ELEMENTAL_RHYTHMS = 710, SHIELD_OF_WORDS = 20;

let installRoot;
function setup() {
  installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-spell-stacking-'));
  fs.writeFileSync(path.join(installRoot, 'spells_us.txt'), ROWS.join('\n'), 'utf8');
}
setup();

test('five confirmed real blocks: the incoming spell does NOT overwrite while Harnessing/Talisman is up', () => {
  for (const [activeId, incomingId, label] of [
    [HARNESSING, STRENGTH, 'Strength vs Harnessing'],
    [HARNESSING, DEXTERITY, 'Dexterity vs Harnessing'],
    [HARNESSING, INFUSION, 'Infusion of Spirit vs Harnessing'],
    [HARNESSING, TALISMAN, 'Talisman of Altuna vs Harnessing'],
    [TALISMAN, ARMOR, 'Armor of Protection vs Talisman'],
  ]) {
    const v = checkOverwrite(installRoot, activeId, incomingId);
    assert.equal(v, null, `${label}: expected no overwrite (this was a real "did not take hold" line)`);
  }
});

test('Agility overwrites Nimble (higher cap on the same AGI slot), not the reverse', () => {
  const forward = checkOverwrite(installRoot, NIMBLE, AGILITY);
  assert.ok(forward && forward.overwrites, 'Agility should overwrite an active Nimble');
  assert.match(forward.why, /SPA 6/);

  const reverse = checkOverwrite(installRoot, AGILITY, NIMBLE);
  assert.equal(reverse, null, 'the weaker Nimble must not overwrite an active Agility');
});

test('stackVerdict only reports a verdict when both directions agree', () => {
  const v = stackVerdict(installRoot, NIMBLE, AGILITY);
  assert.ok(v && v.overwrites);
  const none = stackVerdict(installRoot, AGILITY, NIMBLE);
  assert.equal(none, null);
});

test('stackVerdict suppresses a genuine disagreement (each direction claims to overwrite the other)', () => {
  // Synthetic, not real spell data - none of the confirmed real pairs happen to disagree in both
  // directions, so this constructs the one case that would: two spells whose SPA_OVERWRITE (149)
  // commands each target the other's matching slot at a threshold both satisfy. checkOverwrite
  // alone would say "yes" both ways; stackVerdict's job is to refuse to pick a side.
  // Both spells: slot 1 is a real SPA 999 effect (base 50), slot 2 is a StackingCommand_Overwrite
  // targeting "SPA 999 in the other spell's slot 1, under threshold 100" - identical structure on
  // both sides, so each one's command is satisfied by the other's slot 1 either way round.
  const mutualRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-spell-stacking-mutual-'));
  const A = '90001^Mutual A^1|999|50|0|100|0$2|149|999|1|100|100';
  const B = '90002^Mutual B^1|999|50|0|100|0$2|149|999|1|100|100';
  fs.writeFileSync(path.join(mutualRoot, 'spells_us.txt'), [A, B].join('\n'), 'utf8');
  const forwardOnly = checkOverwrite(mutualRoot, 90002, 90001); // B active, A incoming
  const reverseOnly = checkOverwrite(mutualRoot, 90001, 90002); // A active, B incoming
  assert.ok(forwardOnly && forwardOnly.overwrites, 'setup check: A should look like it overwrites B on its own');
  assert.ok(reverseOnly && reverseOnly.overwrites, 'setup check: B should look like it overwrites A on its own');
  assert.equal(stackVerdict(mutualRoot, 90002, 90001), null, 'a genuine two-way disagreement must not be resolved either way');
});

test('unrelated spells never conflict, either direction', () => {
  for (const [a, b] of [[PUMA, CLARITY], [STRENGTH, PUMA], [NIMBLE, CLARITY]]) {
    assert.equal(checkOverwrite(installRoot, a, b), null);
    assert.equal(checkOverwrite(installRoot, b, a), null);
  }
});

test('a spell overwriting itself (a recast) is not this module\'s job - always null', () => {
  assert.equal(checkOverwrite(installRoot, NIMBLE, NIMBLE), null);
});

test('a missing install root or unknown spell id fails closed (no verdict), not open', () => {
  assert.equal(checkOverwrite(installRoot, 999999, AGILITY), null);
  assert.equal(checkOverwrite('/does/not/exist', NIMBLE, AGILITY), null);
});

// ---------------------------------------------------------------------------
// buffEngine.js integration - note 26's actual fix, not just the standalone module
// ---------------------------------------------------------------------------

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  engine.setStackVerdictFn((activeId, incomingId) => stackVerdict(installRoot, activeId, incomingId));
  return { engine, buffStore, log };
}
const names = (engine) => engine.getActiveBuffs().map((b) => b.name).sort();

test('legacy (toggle off): casting Agility over an active Nimble leaves BOTH stuck active - pins the bug', () => {
  const { engine } = makeEngine();
  engine.handleLine('You feel nimble.'); // Nimble lands (unique text)
  engine.handleLine('You feel agile.');  // Agility lands (unique text) - no removal wired without the toggle
  assert.deepEqual(names(engine), ['Agility', 'Nimble'], 'legacy behaviour changed - this pins the OLD (buggy) outcome');
});

test('toggle on: casting Agility over an active Nimble removes the stale Nimble entry immediately', () => {
  const { engine, log } = makeEngine();
  engine.setUseStackingModel(true);
  engine.handleLine('You feel nimble.');
  assert.deepEqual(names(engine), ['Nimble']);
  engine.handleLine('You feel agile.');
  assert.deepEqual(names(engine), ['Agility'], 'Nimble should have been removed the moment Agility landed');
  assert.ok(log.some((m) => m.includes('ENDED "Nimble"') && m.includes('overwritten by "Agility"')));
});

test('toggle on: the reverse does NOT happen - casting Nimble while Agility is up does not remove Agility', () => {
  const { engine } = makeEngine();
  engine.setUseStackingModel(true);
  engine.handleLine('You feel agile.');
  engine.handleLine('You feel nimble.');
  assert.deepEqual(names(engine), ['Agility', 'Nimble'], 'Nimble is weaker and should not overwrite the active Agility');
});

// Fix 3 (docs/research/bard-song-stacking.md): the effect-slot heuristic must never rule across
// the bard-song boundary. On EQL a bard resist/AC song and a caster resist/AC spell coexist - every
// cross-boundary "overwrite" the heuristic logged (26-31 Aug) was a song being wrongly killed, and
// its ~6s re-pulse then re-killed it every cycle (the "pops up then vanishes" the owner reported).
// The real song exclusions (bard haste vs Alacrity, Selo's vs SoW) are decided by the heading model
// before the heuristic and never reach it.
test('toggle on: a bard song is never removed by the effect-slot heuristic', () => {
  const { engine, buffStore, log } = makeEngine();
  engine.setUseStackingModel(true);
  buffStore.setBardSong('Nimble', true); // stand-in: the heuristic WOULD say Agility overwrites it
  engine.handleLine('You feel nimble.');
  engine.handleLine('You feel agile.');
  assert.deepEqual(names(engine), ['Agility', 'Nimble'], 'the song was killed across the boundary');
  assert.ok(!log.some((m) => m.includes('ENDED "Nimble"')), 'no ENDED line should have fired for the song');
});

test('toggle on: a spell is not removed by the heuristic when the INCOMING buff is a bard song', () => {
  const { engine, buffStore } = makeEngine();
  engine.setUseStackingModel(true);
  buffStore.setBardSong('Agility', true); // the stronger buff, now a song
  engine.handleLine('You feel nimble.');
  engine.handleLine('You feel agile.');
  assert.deepEqual(names(engine), ['Agility', 'Nimble'], 'the spell was killed by an incoming song');
});

test('toggle on: recasting the SAME buff is unaffected - no self-removal', () => {
  const { engine } = makeEngine();
  engine.setUseStackingModel(true);
  engine.handleLine('You feel agile.');
  engine.handleLine('You feel agile.');
  assert.deepEqual(names(engine), ['Agility']);
});

test('Fixture B: the heuristic WOULD kill Elemental Rhythms with Shield of Words (slot 4 SPA 1, 105 vs 5)', () => {
  // The precise collision from the owner's real log. This asserts the heuristic's raw verdict -
  // the point of the engine test below is that the bard-song guard stops the engine acting on it.
  const v = checkOverwrite(installRoot, ELEMENTAL_RHYTHMS, SHIELD_OF_WORDS);
  assert.ok(v && v.overwrites, 'expected the slot-by-slot heuristic to claim an overwrite here');
  assert.match(v.why, /SPA 1/);
});

test('Fixture B: the engine does NOT drop Elemental Rhythms when Shield of Words lands (real rows)', () => {
  const { engine, buffStore, log } = makeEngine();
  engine.setUseStackingModel(true);
  const er = buffStore.getByName('Elemental Rhythms');
  const sow = buffStore.getByName('Shield of Words');
  assert.ok(er && er.spellId === ELEMENTAL_RHYTHMS && sow && sow.spellId === SHIELD_OF_WORDS,
    'roster spellIds drifted from the fixture - update the fixture rows');
  buffStore.setBardSong('Elemental Rhythms', true);
  engine._land(er);
  engine._land(sow);
  const active = new Set(engine.getActiveBuffs().map((b) => b.name));
  assert.ok(active.has('Elemental Rhythms'), 'the song was killed across the boundary by the real SPA-1 collision');
  assert.ok(active.has('Shield of Words'));
  assert.ok(!log.some((m) => m.includes('ENDED "Elemental Rhythms"')));
});

// The real symptom, real names: the owner's 30 Aug 18:48-18:51 window where Elemental Rhythms,
// Guardian Rhythms, all four Psalms and the caster resist spells pulsed together for three minutes
// with nothing ending anything. Driven through _land() with the real roster and the real heading
// model wired (buffLines.stackDecision), plus a stackVerdictFn that says "overwrites" to
// EVERYTHING - the worst case the heuristic could produce. Every buff must still be standing.
test('the 18:48 window: bard resist songs + caster resist spells all coexist, nothing drops', () => {
  const buffLines = require('../src/shared/buffLines');
  const { engine, buffStore, log } = makeEngine();
  engine.setUseStackingModel(true);
  engine.setLineStackFn((incoming, active) => buffLines.stackDecision(incoming, active));
  engine.setStackVerdictFn(() => ({ overwrites: true, why: 'test: worst case' }));

  const songs = ['Elemental Rhythms', 'Guardian Rhythms', 'Psalm of Warmth', 'Psalm of Cooling',
    'Psalm of Purity', 'Psalm of Vitality'];
  for (const s of songs) buffStore.setBardSong(s, true);

  // One resist spell only - Endure Magic and Resist Magic are the same resist LINE (a real
  // upgrade), so casting both would legitimately drop the weaker. The point here is song vs spell.
  const cast = [...songs, 'Endure Magic', 'Resolution', 'Shield of Words'];
  for (const name of cast) {
    const entry = buffStore.getByName(name);
    if (entry) engine._land(entry);
  }
  const active = new Set(engine.getActiveBuffs().map((b) => b.name));
  for (const name of cast) {
    if (buffStore.getByName(name)) assert.ok(active.has(name), `"${name}" was wrongly dropped`);
  }
  assert.ok(
    !log.some((m) => /ENDED "(Elemental Rhythms|Guardian Rhythms|Psalm of)/.test(m)),
    'a bard resist song was ended by the stacking logic'
  );
});

module.exports = () => report('spell-stacking');
if (require.main === module) report('spell-stacking').then((n) => process.exit(n ? 1 : 0));
