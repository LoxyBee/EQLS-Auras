'use strict';
/**
 * zoneGraph.js is a hand-maintained MUD map - 104 zones, their connections, and ~61 travel
 * spells. It is edited by hand and nothing regenerates it, so a mistyped connection target or a
 * travel spell pointing at a zone name that does not exist would silently produce a broken route
 * with nothing to catch it. These assertions only check that every reference points at something
 * real - they deliberately do NOT check that edges are bidirectional or that every zone has an
 * outbound connection, because the data has purpose-built one-way sinks (The Hole, Plane of Hate)
 * and 27 one-way instance-tier variants. See CLAUDE.md gotchas #22/#23 and the zoneGraph.js
 * caveat comment.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { ZONES, TRAVEL_SPELLS } = require('../src/shared/data/zoneGraph');
const { resolveZoneName } = require('../src/shared/zoneRouting');

const zoneNames = Object.keys(ZONES);

// ---------------------------------------------------------------------------
// References point at something real
// ---------------------------------------------------------------------------

test('every connection target is a real zone key', () => {
  const dangling = [];
  for (const [name, zone] of Object.entries(ZONES)) {
    for (const c of zone.connections) {
      if (!Object.prototype.hasOwnProperty.call(ZONES, c.to)) {
        dangling.push(`${name} -> ${c.to}`);
      }
    }
  }
  assert.deepEqual(dangling, [], `connection targets with no matching zone: ${dangling.join('; ')}`);
});

test('every travel spell destination resolves to a real zone', () => {
  const lost = [];
  for (const s of TRAVEL_SPELLS) {
    if (!resolveZoneName(s.destination)) lost.push(`${s.spell} -> ${s.destination}`);
  }
  assert.deepEqual(lost, [], `travel spells landing nowhere the router knows: ${lost.join('; ')}`);
});

test('every isInstanceVariantOf points at a real zone key', () => {
  // Not routing-critical (baseZoneFor has a short-name fallback for the one known exception,
  // "The Permafrost Caverns"), but a typo here would still be a silent data bug.
  const bad = [];
  for (const [name, zone] of Object.entries(ZONES)) {
    if (!zone.isInstanceVariantOf) continue;
    if (
      !Object.prototype.hasOwnProperty.call(ZONES, zone.isInstanceVariantOf) &&
      zone.isInstanceVariantOf !== 'The Permafrost Caverns'
    ) {
      bad.push(`${name} -> ${zone.isInstanceVariantOf}`);
    }
  }
  assert.deepEqual(bad, [], `instance variants naming a base zone that does not exist: ${bad.join('; ')}`);
});

// ---------------------------------------------------------------------------
// Uniqueness / completeness of the small fixed fields
// ---------------------------------------------------------------------------

test('every travel spell name is unique', () => {
  const seen = new Set();
  const dupes = [];
  for (const s of TRAVEL_SPELLS) {
    if (seen.has(s.spell)) dupes.push(s.spell);
    seen.add(s.spell);
  }
  assert.deepEqual(dupes, [], `duplicate travel spell names: ${dupes.join(', ')}`);
});

test('every travel spell has a destination and a spell name', () => {
  const bad = TRAVEL_SPELLS.filter((s) => !s.spell || !s.destination).map((s) => JSON.stringify(s));
  assert.deepEqual(bad, []);
});

test('every zone key is a non-empty display name and carries a shortName', () => {
  const badName = zoneNames.filter((n) => typeof n !== 'string' || !n.trim());
  assert.deepEqual(badName, [], 'a zone is keyed by an empty/blank display name');
  const noShort = zoneNames.filter((n) => !ZONES[n].shortName || !String(ZONES[n].shortName).trim());
  assert.deepEqual(noShort, [], `zones with no shortName: ${noShort.join(', ')}`);
});

test('every connection carries a recognised via', () => {
  const allowed = new Set(['land', 'boat', 'portal']);
  const bad = [];
  for (const [name, zone] of Object.entries(ZONES)) {
    for (const c of zone.connections) {
      if (!allowed.has(c.via)) bad.push(`${name} -> ${c.to} (via ${c.via})`);
    }
  }
  assert.deepEqual(bad, [], `connections with an unexpected via: ${bad.join('; ')}`);
});

// ---------------------------------------------------------------------------
// Sanity floor - a gutted file must fail loudly
// ---------------------------------------------------------------------------

test('the graph still has its full size', () => {
  assert.ok(zoneNames.length > 90, `only ${zoneNames.length} zones`);
  assert.ok(TRAVEL_SPELLS.length > 40, `only ${TRAVEL_SPELLS.length} travel spells`);
});

module.exports = () => report('zone-graph-integrity');
if (require.main === module) report('zone-graph-integrity').then((n) => process.exit(n ? 1 : 0));
