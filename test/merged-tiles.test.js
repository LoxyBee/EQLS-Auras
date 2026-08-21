'use strict';
/**
 * Note 8 - merging buffs that share a duration into one tile.
 *
 * The grouping logic is pure: it takes a list of buffs and returns a list of buffs. So it is
 * lifted out of overlay.js and RUN, rather than read as text - the same trick trade-ping.test.js
 * uses on its pattern and sound-only.test.js uses on the export warning. overlay.js as a whole
 * needs a DOM; these particular functions need nothing but their arguments.
 *
 * The parts that cannot be run are the ones where merging touches the rest of render(), and they
 * are the parts most likely to break quietly:
 *
 *   - The landing glow and the alert sounds are computed from RAW buff keys. A merged tile has a
 *     key of its own that no raw buff carries, so anything matching tile keys against raw keys
 *     silently stops glowing and beeping - no error, just an aura that has gone flat.
 *   - The count badge is written when the tile is built, so a count going from six to five has to
 *     register as a structural change or the badge keeps claiming six.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const mainSrc = read('src', 'main', 'main.js');
const storeSrc = read('src', 'main', 'widgetStore.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

/** Lifts the pure merging functions out of overlay.js and returns them, actually callable. */
function loadMerging() {
  const pick = (re, what) => {
    const m = overlaySrc.match(re);
    assert.ok(m, `${what} has been renamed or restructured - this suite cannot run`);
    return m[0];
  };
  const parts = [
    pick(/const BURST_TOLERANCE_SEC = \d+;/, 'BURST_TOLERANCE_SEC'),
    pick(/let mergeRule = '[a-z]+';/, 'mergeRule'),
    pick(/function keyFor\(buff\) \{[\s\S]*?\n\}/, 'keyFor'),
    pick(/function mergedKeyFor\(members\) \{[\s\S]*?\n\}/, 'mergedKeyFor'),
    pick(/function splitIntoBursts\(members\) \{[\s\S]*?\n\}/, 'splitIntoBursts'),
    pick(/function mergeByDuration\(buffs\) \{[\s\S]*?\n\}/, 'mergeByDuration'),
    pick(/function memberKeys\(buff\) \{[\s\S]*?\n\}/, 'memberKeys'),
    pick(/function anyMemberIn\(buff, set\) \{[\s\S]*?\n\}/, 'anyMemberIn'),
  ];
  // eslint-disable-next-line no-new-func
  return new Function(
    `${parts.join('\n\n')}
     return {
       keyFor, mergeByDuration, memberKeys, anyMemberIn,
       burstTolerance: BURST_TOLERANCE_SEC,
       setRule: (r) => { mergeRule = r; },
     };`
  )();
}

const M = loadMerging();

/** A buff shaped the way buffEngine actually hands them to the overlay. */
const buff = (name, durationSec, remainingSec, allyName) => ({
  name,
  durationSec,
  remainingSec,
  ...(allyName ? { allyName } : {}),
  showOnOverlay: true,
  iconUrl: null,
  isBardSong: false,
});

const byName = (list) => list.map((b) => b.name).sort();

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test('buffs with different durations are left alone', () => {
  M.setRule('duration');
  const out = M.mergeByDuration([buff('A', 600, 500), buff('B', 1440, 1400)]);
  assert.equal(out.length, 2);
  for (const b of out) {
    assert.equal(b.mergedCount, undefined, 'a group of one must come back completely untouched');
    assert.equal(b.mergedKey, undefined);
  }
});

test('buffs sharing a duration collapse into one tile with a count', () => {
  M.setRule('duration');
  const out = M.mergeByDuration([buff('A', 1440, 900), buff('B', 1440, 800), buff('C', 1440, 1000)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].mergedCount, 3);
  assert.deepEqual(out[0].mergedKeys.sort(), ['a', 'b', 'c']);
});

test('the tile shows the one about to run out, and names that one', () => {
  // The countdown and the name have to describe the same buff. A tile counting down to B while
  // saying "A" is worse than no tile.
  M.setRule('duration');
  const [merged] = M.mergeByDuration([buff('A', 1440, 900), buff('B', 1440, 42), buff('C', 1440, 1000)]);
  assert.equal(merged.remainingSec, 42);
  assert.equal(merged.name, 'B');
});

test('buffs on different people never merge', () => {
  // The tile names whose buffs these are; one covering two people could not.
  M.setRule('duration');
  const out = M.mergeByDuration([
    buff('Puma', 1440, 900, 'Avenrae'),
    buff('Puma', 1440, 880, 'Shara'),
    buff('Talisman', 1440, 870, 'Avenrae'),
  ]);
  assert.equal(out.length, 2, 'one merged tile for Avenrae, one lone tile for Shara');
  const merged = out.find((b) => b.mergedCount);
  assert.equal(merged.allyName, 'Avenrae');
  assert.equal(merged.mergedCount, 2);
});

test('self buffs, which have no ally name, still merge with each other', () => {
  M.setRule('duration');
  const out = M.mergeByDuration([buff('A', 600, 500), buff('B', 600, 400)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].mergedCount, 2);
  assert.equal(out[0].allyName, undefined);
});

// ---------------------------------------------------------------------------
// The two rules
// ---------------------------------------------------------------------------

test('"same length" merges regardless of when they landed', () => {
  M.setRule('duration');
  const out = M.mergeByDuration([buff('Old', 1440, 60), buff('New', 1440, 1430)]);
  assert.equal(out.length, 1, 'the simple rule deliberately merges unrelated buffs of equal length');
  assert.equal(out[0].mergedCount, 2);
});

test('"cast together" keeps unrelated buffs of the same length apart', () => {
  M.setRule('burst');
  const out = M.mergeByDuration([buff('Old', 1440, 60), buff('New', 1440, 1430)]);
  assert.equal(out.length, 2, 'this is the whole difference between the two rules');
  assert.equal(out[0].mergedCount, undefined);
});

test('"cast together" still merges a real group buff', () => {
  // Cast in one burst, so they tick down together - a second or two apart at most.
  M.setRule('burst');
  const out = M.mergeByDuration([
    buff('A', 1440, 1438),
    buff('B', 1440, 1437),
    buff('C', 1440, 1436),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].mergedCount, 3);
});

test('the burst window is measured from the first member, not its neighbour', () => {
  // Chained against the neighbour, a run of buffs one second apart would drift arbitrarily far
  // and end up as one group spanning minutes.
  M.setRule('burst');
  const spread = [];
  for (let i = 0; i < 12; i++) spread.push(buff(`B${i}`, 1440, 1400 - i * 2));
  const out = M.mergeByDuration(spread);
  assert.ok(out.length > 1, 'a slow drift must not collapse into a single group');
  for (const group of out) {
    if (!group.mergedCount) continue;
    assert.ok(group.mergedCount <= M.burstTolerance + 1, 'a group spans the tolerance, not more');
  }
});

test('an unknown rule behaves like the simple one', () => {
  // Whatever arrives, the aura has to keep drawing something explicable.
  M.setRule('sideways');
  const out = M.mergeByDuration([buff('Old', 1440, 60), buff('New', 1440, 1430)]);
  assert.equal(out.length, 1);
  M.setRule('duration');
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('a merged tile keeps the same identity as the clock ticks', () => {
  // warnedAt and tileRefs are keyed by it. An identity that churned every tick would rebuild the
  // tile constantly and re-fire the pre-expiry warning sound.
  M.setRule('duration');
  const first = M.mergeByDuration([buff('A', 1440, 900), buff('B', 1440, 800)])[0];
  const later = M.mergeByDuration([buff('A', 1440, 890), buff('B', 1440, 790)])[0];
  assert.equal(first.mergedKey, later.mergedKey);
});

test('a merged tile keeps its identity when a member other than the anchor drops', () => {
  M.setRule('duration');
  const three = M.mergeByDuration([buff('A', 1440, 900), buff('B', 1440, 800), buff('C', 1440, 700)])[0];
  const two = M.mergeByDuration([buff('A', 1440, 890), buff('B', 1440, 790)])[0];
  assert.equal(three.mergedKey, two.mergedKey, 'losing C must not look like a brand-new tile');
  assert.equal(two.mergedCount, 2);
});

test('two merged groups on the same person get different identities', () => {
  M.setRule('burst');
  const out = M.mergeByDuration([
    buff('A', 1440, 1430, 'Avenrae'),
    buff('B', 1440, 1429, 'Avenrae'),
    buff('C', 1440, 40, 'Avenrae'),
    buff('D', 1440, 39, 'Avenrae'),
  ]);
  const keys = out.map((b) => b.mergedKey);
  assert.equal(out.length, 2);
  assert.notEqual(keys[0], keys[1], 'two bursts on one ally must not collide');
});

test('keyFor prefers the merged identity over the ally or timer identity it inherited', () => {
  // A merged tile is built by spreading its lead member, so it still carries that member's
  // allyName and id. Falling through to either would make two different merged groups collide,
  // or give a merged custom timer its lead timer's identity.
  assert.equal(M.keyFor({ mergedKey: 'merged::x', allyName: 'Avenrae', name: 'A', id: 't1' }), 'merged::x');
  assert.equal(M.keyFor({ allyName: 'Avenrae', name: 'A' }), 'avenrae::a');
  assert.equal(M.keyFor({ id: 't1', name: 'A' }), 'id::t1');
  assert.equal(M.keyFor({ name: 'A' }), 'a');
});

test('a tile reports the raw buffs it stands for', () => {
  M.setRule('duration');
  const [merged] = M.mergeByDuration([buff('A', 600, 500), buff('B', 600, 400)]);
  assert.deepEqual(M.memberKeys(merged).sort(), ['a', 'b']);
  assert.deepEqual(M.memberKeys(buff('C', 600, 300)), ['c']);

  assert.equal(M.anyMemberIn(merged, new Set(['b'])), true, 'one member landing lights the tile');
  assert.equal(M.anyMemberIn(merged, new Set(['z'])), false);
  assert.equal(M.anyMemberIn(buff('C', 600, 300), new Set(['c'])), true);
});

// ---------------------------------------------------------------------------
// Where merging meets the rest of render()
// ---------------------------------------------------------------------------

test('glow and sound are matched against members, never against the tile key', () => {
  // The quiet failure this exists for: a merged tile's key is one no raw buff carries, so
  // matching tile keys against raw keys leaves a merged aura that never glows and never beeps.
  assert.match(
    overlaySrc, /const visibleSet = new Set\(visible\.flatMap\(memberKeys\)\)/,
    'visibleSet must name the raw buffs on screen, not the tiles'
  );
  const glows = overlaySrc.match(/landingGlowEnabled !== false && [^)]+\)/g) || [];
  assert.equal(glows.length, 2, 'there should be exactly two glow sites - grouped and ungrouped');
  for (const site of glows) {
    assert.match(site, /anyMemberIn\(buff, newlyLanded\)/, `a glow site still matches tile keys: ${site}`);
  }
});

test('a changing count forces the tile to be rebuilt', () => {
  // The badge is written at build time, so six-to-five has to count as a structural change.
  assert.match(overlaySrc, /const mergeKey = visible\.map\(\(b\) => b\.mergedCount \|\| 0\)\.join\(','\)/);
  const check = overlaySrc.match(/const structureChanged =[\s\S]*?;\r?\n/);
  assert.ok(check, 'the structural-change check has been restructured');
  assert.match(check[0], /listEl\.dataset\.mergeKey !== mergeKey/);
  assert.match(overlaySrc, /listEl\.dataset\.mergeKey = mergeKey;/, 'the signature is never stored');
});

test('merging happens after filtering and before sorting', () => {
  // After filtering, or an excluded buff would still be counted in a badge. Before sorting, so
  // the tile takes its place in the order by the time it actually shows.
  const fn = overlaySrc.match(/function visibleBuffs\(buffs\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'visibleBuffs has been restructured');
  const body = fn[1];
  assert.ok(body.indexOf('excludedBuffNames') < body.indexOf('mergeByDuration'));
  assert.ok(body.indexOf('mergeByDuration') < body.indexOf('sortBuffs'));
});

test('the count badge is built in exactly one place', () => {
  // Note 12 wants the identical badge on a different kind of merged tile. Two copies of a thing
  // described as "the same badge" is how they stop being the same badge.
  assert.equal((overlaySrc.match(/function buildCountBadge\(/g) || []).length, 1);
  assert.equal((overlaySrc.match(/buildCountBadge\(buff\.mergedCount\)/g) || []).length, 2,
    'both list rows and icon tiles should use it');
  assert.match(overlayCss, /\.count-badge \{/);
  assert.match(overlayCss, /\.buff-tile \.count-badge \{/, 'icon mode needs its own placement');
});

// ---------------------------------------------------------------------------
// Settings, per-aura and app-wide
// ---------------------------------------------------------------------------

test('the per-aura toggle is stored, shared, and off by default', () => {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.create('Group buffs');
  assert.equal(w.mergeSameDuration, false, 'it must not switch itself on for existing auras');
  assert.equal(store.getById('self-buffs').mergeSameDuration, false);

  store.update(w.id, { mergeSameDuration: true });
  const imported = store.importCode(store.exportCode(w.id));
  assert.equal(imported.mergeSameDuration, true, 'it should travel in a share code');

  assert.match(storeSrc, /mergeSameDuration: !!widget\.mergeSameDuration/, 'not coerced on load');
});

test('the app-wide rule is validated on the way in and pushed to every aura', () => {
  assert.match(mainSrc, /const MERGE_RULES = \['duration', 'burst'\]/);
  const norm = mainSrc.match(/const normalizeMergeRule = [^;]+;/);
  assert.ok(norm, 'normalizeMergeRule has been restructured');
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${mainSrc.match(/const MERGE_RULES = [^;]+;/)[0]}\n${norm[0]}\nreturn normalizeMergeRule;`)();
  assert.equal(fn('burst'), 'burst');
  assert.equal(fn('duration'), 'duration');
  assert.equal(fn('sideways'), 'duration', 'anything else has to land on the simpler rule');
  assert.equal(fn(undefined), 'duration');

  // App-wide means every overlay, not just the focused one - an aura still using the old rule
  // until the next restart would look like the setting had not worked.
  assert.match(mainSrc, /broadcast\('ui:mergeRuleChanged', value\)/);
  assert.match(overlaySrc, /window\.eqOverlay\.onMergeRuleChanged\(/);
  assert.match(overlaySrc, /window\.eqOverlay\.getMergeRule\(\)/, 'never read at boot');
});

test('both settings are reachable in the app', () => {
  assert.match(html, /id="widget-merge-checkbox"/, 'the per-aura toggle has no control');
  const values = [...html.matchAll(/name="merge-rule" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['duration', 'burst']);
  assert.match(rendererSrc, /mergeCheckbox\.checked = !!widget\.mergeSameDuration/, 'never populated');
  assert.match(rendererSrc, /function initMergeRule\(\)/);
  assert.match(rendererSrc, /\n  initMergeRule\(\);/, 'initMergeRule is never called');
  // A sound-only aura draws no tiles, so there is nothing to merge.
  assert.match(rendererSrc, /mergeRowEl\.style\.display = isSoundOnly \? 'none' : ''/);
});

module.exports = () => report('merged-tiles');
if (require.main === module) process.exit(report('merged-tiles') ? 1 : 0);
