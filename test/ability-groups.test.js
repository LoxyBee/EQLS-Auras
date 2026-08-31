'use strict';
/**
 * Stance/invocation "active" tracking for Action Bar gems (abilityGroups.js). Confirmed directly
 * against the real log rather than guessed - see the module's own header comment for the exact
 * lines. Mutual exclusion (activating one puts every OTHER gem in the group on cooldown too) and
 * the green "active" border on the one actually matched are the two behaviours requested.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { AbilityGroupTracker } = require('../src/main/abilityGroups');

const TS = '[Wed Aug 26 12:56:41 2026] ';

function makeTracker(slots) {
  const tracker = new AbilityGroupTracker();
  tracker.setGetGroupSlotsFn((group) => slots.filter((s) => s.group === group));
  const changes = [];
  tracker.setOnChangeFn(() => changes.push(true));
  return { tracker, changes };
}

test('a confirmed stance line activates the matching gem and puts every OTHER stance gem on the fixed 6s cooldown too', () => {
  const slots = [
    { barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 },
    { barId: 'bar1', index: 1, group: 'stance', toggleName: 'Offensive Stance', toggleDurationSec: 6 },
  ];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  const states = tracker.getAllActiveStates();
  assert.equal(states.length, 2, 'both stance gems should be on cooldown, not just the matched one');
  const evasive = states.find((s) => s.index === 0);
  const offensive = states.find((s) => s.index === 1);
  assert.equal(evasive.isActive, true);
  assert.equal(offensive.isActive, false);
  assert.ok(evasive.remainingSec <= 6 && evasive.remainingSec > 5.9);
  assert.equal(evasive.durationSec, 6);
});

test('the precursor line ("You begin to change your stance.") does nothing - it never says which one was picked', () => {
  const slots = [{ barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 }];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You begin to change your stance.`);
  assert.equal(tracker.getAllActiveStates().length, 0);
});

test('an invocation activation uses the MATCHED gem\'s own configured duration, not a shared fixed number', () => {
  const slots = [
    { barId: 'bar1', index: 0, group: 'invocation', toggleName: 'Divine Invocation', toggleDurationSec: 20 },
    { barId: 'bar1', index: 1, group: 'invocation', toggleName: 'Overchannel Invocation', toggleDurationSec: 45 },
  ];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You begin reciting the divine invocation.`);
  const states = tracker.getAllActiveStates();
  const divine = states.find((s) => s.index === 0);
  const overchannel = states.find((s) => s.index === 1);
  // Every OTHER invocation gem goes on cooldown too (mutual exclusion), but each keeps ITS OWN
  // configured duration - the matched one's 20s does not spread to the other's 45s.
  assert.equal(divine.durationSec, 20);
  assert.equal(overchannel.durationSec, 45);
  assert.equal(divine.isActive, true);
  assert.equal(overchannel.isActive, false);
});

test('stances and invocations are completely separate groups - activating one never touches the other', () => {
  const slots = [
    { barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 },
    { barId: 'bar1', index: 1, group: 'invocation', toggleName: 'Divine Invocation', toggleDurationSec: 20 },
  ];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  const states = tracker.getAllActiveStates();
  assert.equal(states.length, 1);
  assert.equal(states[0].group, 'stance');
});

test('the article ("a" vs "an") does not matter - both are matched the same way', () => {
  const slots = [
    { barId: 'bar1', index: 0, group: 'stance', toggleName: 'Channeler Stance', toggleDurationSec: 6 },
    { barId: 'bar1', index: 1, group: 'stance', toggleName: 'Offensive Stance', toggleDurationSec: 6 },
  ];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You assume a channeler stance.`);
  assert.equal(tracker.getAllActiveStates().find((s) => s.index === 0).isActive, true);
});

test('activating a name with no configured gem still puts every gem in that group on cooldown (mutual exclusion still applies)', () => {
  const slots = [{ barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 }];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You assume a defensive stance.`); // not this gem's own name
  const states = tracker.getAllActiveStates();
  assert.equal(states.length, 1);
  assert.equal(states[0].isActive, false, 'nothing was actually matched, so nothing should show the green border');
});

test('activating a stance/invocation with no configured gems anywhere does nothing (no crash, no phantom state)', () => {
  const { tracker } = makeTracker([]);
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  assert.equal(tracker.getAllActiveStates().length, 0);
});

test('re-activating the SAME stance again refreshes every gem\'s cooldown rather than leaving stale timers', () => {
  const slots = [
    { barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 },
    { barId: 'bar1', index: 1, group: 'stance', toggleName: 'Offensive Stance', toggleDurationSec: 6 },
  ];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  const firstExpiry = tracker.cooldownByGroup.stance.get('bar1:1').expiresAt;
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  const secondExpiry = tracker.cooldownByGroup.stance.get('bar1:1').expiresAt;
  assert.ok(secondExpiry >= firstExpiry, 'the sibling gem\'s cooldown should reset too, not just the matched gem\'s');
});

test('the cooldown wipe/number expires and disappears, but the green "active" border survives it - "permanent till a swap"', () => {
  // Reported live after the first version tied the two together: "the green border goes away
  // after the cooldown, it needs to be permanent till a swap." The cooldown is real GCD lockout
  // time; "active" is a state that stays true until the game actually changes it.
  const slots = [{ barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 }];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  assert.equal(tracker.getAllActiveStates()[0].isActive, true);

  tracker.cooldownByGroup.stance.get('bar1:0').expiresAt = Date.now() - 1000;
  const states = tracker.getAllActiveStates();
  assert.equal(states.length, 1, 'the cooldown entry is gone, but the active gem still needs reporting');
  assert.equal(states[0].isActive, true);
  assert.equal(states[0].durationSec, null, 'no cooldown is running any more - only the active flag survives');
  assert.equal(states[0].remainingSec, null);
});

test('a later swap to a DIFFERENT stance clears the border off the old one, even though its own cooldown already ran out', () => {
  const slots = [
    { barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 },
    { barId: 'bar1', index: 1, group: 'stance', toggleName: 'Offensive Stance', toggleDurationSec: 6 },
  ];
  const { tracker } = makeTracker(slots);
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  tracker.cooldownByGroup.stance.get('bar1:0').expiresAt = Date.now() - 1000;
  tracker.cooldownByGroup.stance.get('bar1:1').expiresAt = Date.now() - 1000;
  assert.equal(tracker.getAllActiveStates().find((s) => s.index === 0).isActive, true);

  tracker.handleLine(`${TS}You assume an offensive stance.`);
  const states = tracker.getAllActiveStates();
  assert.equal(states.find((s) => s.index === 0).isActive, false, 'the old active gem loses the border on a real swap');
  assert.equal(states.find((s) => s.index === 1).isActive, true);
});

// QOL #16 - the active stance/invocation survives an app restart, the same way the current zone
// does (it is a character state the player is still in, not a timed buff that may have lapsed).
test('the active pick is persisted by name on every change', () => {
  const slots = [
    { barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 },
    { barId: 'bar1', index: 1, group: 'invocation', toggleName: 'Divine Invocation', toggleDurationSec: 20 },
  ];
  const { tracker } = makeTracker(slots);
  const saved = [];
  tracker.setPersistFn((s) => saved.push(s));
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  tracker.handleLine(`${TS}You begin reciting the divine invocation.`);
  assert.deepEqual(saved.at(-1), { stance: 'Evasive Stance', invocation: 'Divine Invocation' });
});

test('restore() lights the gem that now holds the persisted toggle, resolving by name not slot key', () => {
  // The bar was re-laid-out while the app was closed: Evasive Stance is on a different slot now.
  const slots = [
    { barId: 'bar2', index: 3, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 },
    { barId: 'bar2', index: 4, group: 'stance', toggleName: 'Offensive Stance', toggleDurationSec: 6 },
  ];
  const { tracker, changes } = makeTracker(slots);
  tracker.restore({ stance: 'Evasive Stance', invocation: null });
  const states = tracker.getAllActiveStates();
  assert.equal(states.length, 1);
  assert.equal(states[0].barId, 'bar2');
  assert.equal(states[0].index, 3);
  assert.equal(states[0].isActive, true);
  assert.equal(states[0].durationSec, null, 'restored as a state, not a running cooldown');
  assert.ok(changes.length > 0, 'restore should notify the renderer so the border draws immediately');
});

test('restore() with a persisted pick that has no configured gem lights nothing (and does not crash)', () => {
  const { tracker } = makeTracker([
    { barId: 'bar1', index: 0, group: 'stance', toggleName: 'Offensive Stance', toggleDurationSec: 6 },
  ]);
  tracker.restore({ stance: 'Channeler Stance', invocation: null });
  assert.equal(tracker.getAllActiveStates().length, 0);
});

test('restore() tolerates a missing / malformed saved blob', () => {
  const { tracker } = makeTracker([]);
  tracker.restore(null);
  tracker.restore({});
  tracker.restore({ stance: 42 });
  assert.equal(tracker.getAllActiveStates().length, 0);
});

test('a swap to a stance with no gem clears the persisted pick too, not just the border', () => {
  const slots = [{ barId: 'bar1', index: 0, group: 'stance', toggleName: 'Evasive Stance', toggleDurationSec: 6 }];
  const { tracker } = makeTracker(slots);
  const saved = [];
  tracker.setPersistFn((s) => saved.push(s));
  tracker.handleLine(`${TS}You assume an evasive stance.`);
  tracker.handleLine(`${TS}You assume a defensive stance.`); // no gem for this
  assert.equal(saved.at(-1).stance, null, 'a pick we cannot show a border for must not stay persisted');
});

module.exports = () => report('ability-groups');
if (require.main === module) report('ability-groups').then((n) => process.exit(n ? 1 : 0));
