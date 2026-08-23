'use strict';
/**
 * Note 20 - the travel guide's routing.
 *
 * The note was blocked on data that did not exist anywhere in the app, in buffs.json, or in the
 * spreadsheet. It exists now, sourced and cross-checked, and these tests are about the two things
 * that could quietly go wrong with it: a graph that looks complete and is not, and a route that
 * looks shortest and is not.
 *
 * Everything imports the real modules. The graph itself is asserted against rather than described,
 * because a test that restates the data it is checking proves only that copy-and-paste works.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { ZONES, TRAVEL_SPELLS, NOT_TRAVEL_SPELLS } = require('../src/shared/data/zoneGraph');
const { findRoute, describeLeg, resolveZoneName, allZoneNames, usableTravelSpells } =
  require('../src/shared/zoneRouting');

const zoneNames = () => Object.keys(ZONES);
const baseZones = () => zoneNames().filter((n) => !ZONES[n].isInstanceVariantOf);

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

test('the graph covers every zone the app has ever seen', () => {
  // src/shared/data/zones.js is the list built from zone lines in the owner's own logs. A router
  // that cannot name a zone she has actually stood in is not usable.
  const observed = require('../src/shared/data/zones');
  const list = Array.isArray(observed) ? observed : observed.ZONES || observed.zones;
  assert.ok(Array.isArray(list) && list.length, 'the observed zone list has changed shape');
  const missing = list.filter((z) => !resolveZoneName(z));
  assert.deepEqual(missing, [], `zones the router cannot find: ${missing.join(', ')}`);
});

test('every connection points at a zone that exists', () => {
  const dangling = [];
  for (const [name, zone] of Object.entries(ZONES)) {
    for (const c of zone.connections) if (!ZONES[c.to]) dangling.push(`${name} -> ${c.to}`);
  }
  assert.deepEqual(dangling, []);
});

test('no zone is cut off from the rest', () => {
  const stranded = zoneNames().filter((n) => !ZONES[n].connections.length);
  assert.deepEqual(stranded, []);
});

// The research claim this rests on, checked here rather than taken on trust: every pair among the
// 77 real places is routable, which is 5,852 ordered pairs.
test('every ordinary place can reach every other ordinary place', () => {
  const places = baseZones();
  assert.equal(places.length, 77, 'the set of real places has changed size');
  const broken = [];
  for (const a of places) {
    for (const b of places) {
      if (a !== b && !findRoute(a, b).ok) broken.push(`${a} -> ${b}`);
    }
  }
  assert.deepEqual(broken.slice(0, 5), [], `${broken.length} unroutable pairs`);
});

// Instance tiers are the interesting case, and they are one-way in the data ON PURPOSE - see
// baseZoneFor. Routing INTO one has to work anyway, or picking one from the list says "no route"
// about somewhere plainly reachable.
test('every instance tier is reachable, even though nothing walks into one', () => {
  const variants = zoneNames().filter((n) => ZONES[n].isInstanceVariantOf);
  assert.ok(variants.length >= 20, 'the instance variants have gone missing');
  const broken = variants.filter((v) => !findRoute('Rivervale', v).ok);
  assert.deepEqual(broken, []);
});

// The one entry whose named base is not in the set. Left unverified by the research, handled by
// matching on the client short name instead of on either display name.
test('the Permafrost pair resolves despite its base zone not existing under that name', () => {
  assert.equal(ZONES['The Permafrost Caverns - Group'].isInstanceVariantOf, 'The Permafrost Caverns');
  assert.equal(ZONES['The Permafrost Caverns'], undefined, 'the caveat has been resolved upstream');
  const r = findRoute('Everfrost Peaks', 'The Permafrost Caverns - Group');
  assert.ok(r.ok, 'this was 103 dead routes before the short-name fallback');
  assert.equal(describeLeg(r.legs[r.legs.length - 1]), 'Enter The Permafrost Caverns - Group');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a neighbouring zone is one step', () => {
  const r = findRoute('Befallen', 'West Commonlands');
  assert.equal(r.hops, 1);
  assert.equal(describeLeg(r.legs[0]), 'Go to West Commonlands');
});

test('being there already is not a route', () => {
  const r = findRoute('Rivervale', 'Rivervale');
  assert.ok(r.ok);
  assert.equal(r.hops, 0);
  assert.equal(r.reason, 'already-there');
});

test('a zone nobody has heard of is refused rather than guessed at', () => {
  const r = findRoute('Rivervale', 'Somewhere Made Up');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown-zone');
});

test('zone names are matched without case or stray spacing mattering', () => {
  assert.equal(resolveZoneName('  rIvErVaLe '), 'Rivervale');
  assert.equal(findRoute('  rivervale', 'MISTY THICKET').hops, 1);
});

test('the legs join up end to end', () => {
  const r = findRoute('Rivervale', 'The Greater Faydark');
  assert.ok(r.hops > 3, 'this is meant to be a long walk');
  assert.equal(r.legs[0].from, 'Rivervale');
  for (let i = 1; i < r.legs.length; i += 1) {
    assert.equal(r.legs[i].from, r.legs[i - 1].to, 'a leg starts somewhere the last one did not end');
  }
  assert.equal(r.legs[r.legs.length - 1].to, 'The Greater Faydark');
});

test('a boat is called a boat and a portal a portal', () => {
  const r = findRoute('Rivervale', 'The Greater Faydark');
  const boat = r.legs.find((l) => l.via === 'boat');
  assert.ok(boat, 'Faydwer is across the sea; something has gone wrong if there is no boat');
  assert.match(describeLeg(boat), /^Sail to /);
});

// ---------------------------------------------------------------------------
// Travel spells
// ---------------------------------------------------------------------------

// The whole reason the note wanted the spellbook read rather than just a map.
test('a scribed travel spell collapses a long walk into one step', () => {
  const onFoot = findRoute('Rivervale', 'The Greater Faydark');
  assert.ok(onFoot.hops >= 5, 'the walk should be long enough for this to be worth testing');
  const withSpell = findRoute('Rivervale', 'The Greater Faydark', {
    scribedSpells: ['Greater Faydark Portal'],
  });
  assert.equal(withSpell.hops, 1);
  assert.equal(describeLeg(withSpell.legs[0]), 'Cast Greater Faydark Portal');
});

// A route offering a spell you do not have is worse than a longer walk, because you will follow it
// and then be stuck.
test('a spell you have not scribed is never offered', () => {
  const r = findRoute('Rivervale', 'The Greater Faydark', { scribedSpells: [] });
  assert.ok(r.legs.every((l) => l.via !== 'spell'));
  const none = findRoute('Rivervale', 'The Greater Faydark', { scribedSpells: null });
  assert.ok(none.legs.every((l) => l.via !== 'spell'));
});

test('a spell is only used when it actually helps', () => {
  // Somewhere one step away, holding a spell to the far side of the world.
  const r = findRoute('Rivervale', 'Misty Thicket', { scribedSpells: ['Greater Faydark Portal'] });
  assert.equal(r.hops, 1);
  assert.equal(r.legs[0].via, 'land');
});

test('every travel spell lands somewhere the router knows', () => {
  const lost = TRAVEL_SPELLS.filter((s) => !resolveZoneName(s.destination));
  assert.deepEqual(lost.map((s) => `${s.spell} -> ${s.destination}`), []);
});

test('the four spells that only look like travel are kept out', () => {
  const names = new Set(TRAVEL_SPELLS.map((s) => s.spell));
  for (const fake of Object.keys(NOT_TRAVEL_SPELLS)) {
    assert.equal(names.has(fake), false, `${fake} does not take you to a named place`);
  }
  // Gate and Translocate go to a bind point, which is per-character and in no dataset anywhere.
  assert.ok(NOT_TRAVEL_SPELLS.Gate, 'the record of WHY these are excluded has been dropped');
});

test('the spellbook filter matches by name, not by hope', () => {
  assert.equal(usableTravelSpells(['Greater Faydark Portal']).length, 1);
  assert.equal(usableTravelSpells(['greater faydark portal']).length, 1, 'casing must not matter');
  assert.equal(usableTravelSpells(['Not A Spell']).length, 0);
  assert.equal(usableTravelSpells([]).length, 0);
  assert.equal(usableTravelSpells(null).length, 0);
});

// ---------------------------------------------------------------------------
// Shortest, and the tie-break
// ---------------------------------------------------------------------------

test('the route found is the shortest one, checked against a plain search', () => {
  // An independent breadth-first count over the same graph, ignoring spells. If the router ever
  // starts returning a route that merely works, this catches it.
  const shortestHops = (from, to) => {
    const seen = new Set([from]);
    let frontier = [from];
    for (let d = 1; d <= 30; d += 1) {
      const next = [];
      for (const at of frontier) {
        for (const c of ZONES[at].connections) {
          if (c.to === to) return d;
          if (seen.has(c.to)) continue;
          seen.add(c.to);
          next.push(c.to);
        }
      }
      if (!next.length) return null;
      frontier = next;
    }
    return null;
  };
  for (const [a, b] of [
    ['Rivervale', 'The Greater Faydark'],
    ['Halas', "Ak'Anon"],
    ['Befallen', 'Qeynos Hills'],
    ['Erudin', 'Neriak Third Gate'],
  ]) {
    const expected = shortestHops(a, b);
    if (expected === null) continue;
    assert.equal(findRoute(a, b).hops, expected, `${a} -> ${b}`);
  }
});

// Two routes of equal length, one of which makes you cast something. The one that does not is less
// to remember, so it wins.
//
// The first version of this test looked for a spell to Misty Thicket, found none, and RETURNED -
// so it passed while proving nothing, and mutation testing caught it doing so. Butcherblock is a
// real tie: one land step from the Greater Faydark, and also the destination of Circle of
// Butcherblock. There are 206 such pairs in the data, so this is a case that genuinely arises.
//
// Worth recording: mutation testing cannot kill the tie-break clause on its own, because the move
// ordering in findRoute produces the same answer and covers for it. Reversing that ordering shows
// which one is real - the routes stay correct with the clause and break without it. So this test
// pins the BEHAVIOUR, and the code comment explains why the two mechanisms are not redundant.
test('where two routes tie on length, the one with fewer spells wins', () => {
  const r = findRoute('The Greater Faydark', 'Butcherblock Mountains', {
    scribedSpells: ['Circle of Butcherblock'],
  });
  assert.equal(r.hops, 1);
  assert.equal(r.legs[0].via, 'land', 'walking one zone beats casting to get there');
});

// The other thing mutation testing found missing. Every spell test above uses a spell that goes
// straight to the destination, so a search that refused to carry on walking AFTER a cast passed
// all of them. Halas to Butcherblock is 14 zones on foot; casting to the Plane of Sky and taking
// the portal and two boats from there is 4. Getting that wrong would not break any route - it
// would just quietly stop finding the good ones.
test('a route can cast partway and then keep going', () => {
  const onFoot = findRoute('Halas', 'Butcherblock Mountains');
  const withSpell = findRoute('Halas', 'Butcherblock Mountains', {
    scribedSpells: ['Alter Plane: Sky'],
  });
  assert.equal(onFoot.hops, 14);
  assert.equal(withSpell.hops, 4);
  assert.equal(withSpell.legs[0].via, 'spell');
  assert.ok(
    withSpell.legs.slice(1).every((l) => l.via !== 'spell'),
    'the rest of the way is travelled, not cast'
  );
  assert.equal(withSpell.legs[withSpell.legs.length - 1].to, 'Butcherblock Mountains');
});

// ---------------------------------------------------------------------------
// The list the user picks from
// ---------------------------------------------------------------------------

test('the destination list is every zone, sorted, with no duplicates', () => {
  const list = allZoneNames();
  assert.equal(list.length, zoneNames().length);
  assert.equal(new Set(list).size, list.length);
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b)));
});

// 38 of the 104 display names are inferred, because the player has never entered those zones. They
// are load-bearing rather than padding - the Faydwer route goes through one - so this pins that
// they are both present and marked, since anything showing one to the user should expect it to be
// slightly wrong.
test('inferred zone names are kept and flagged rather than dropped', () => {
  const inferred = zoneNames().filter((n) => ZONES[n].nameConfidence === 'inferred');
  assert.ok(inferred.length >= 30, `only ${inferred.length} marked inferred`);
  assert.ok(
    findRoute('Rivervale', 'The Greater Faydark').legs.some((l) => ZONES[l.to]?.nameConfidence === 'inferred'),
    'the Faydwer route runs through an inferred name, so dropping them would break real routes'
  );
});

module.exports = () => report('zone-routing');
if (require.main === module) process.exit(report('zone-routing') ? 1 : 0);
