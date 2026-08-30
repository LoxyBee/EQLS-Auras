'use strict';
/**
 * eqtm zone-picker aliases - QOL #30.
 *
 * Two additions to the picker's plain display-name substring search, unioned with it:
 *   - a curated list of community nicknames and EQ-Legends raid-boss names (zoneAliases.js)
 *   - every zone's client shortName, auto-indexed from zoneGraph.js
 *
 * Match rule: exact, or prefix in either direction, with a >=2-char floor on the query side so a
 * single typed letter does not pull in every alias that starts with it. A multi-hit alias returns
 * all its zones and the picker shows them all.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { ZONE_ALIASES } = require('../src/shared/data/zoneAliases');
const { searchPickableZones, resolveZoneName, pickableZoneNames } = require('../src/shared/zoneRouting');
const { ZONES } = require('../src/shared/data/zoneGraph');

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

test('every alias points at real, pickable zones', () => {
  const bad = [];
  for (const e of ZONE_ALIASES) {
    if (!Array.isArray(e.z) || e.z.length === 0) bad.push(`${e.a}: no zones`);
    for (const z of e.z) {
      const canon = resolveZoneName(z);
      if (!canon) bad.push(`${e.a} -> ${z} (unknown zone)`);
      else if (ZONES[canon].isInstanceVariantOf) bad.push(`${e.a} -> ${z} (instance tier)`);
      else if (canon !== z) bad.push(`${e.a} -> "${z}" should be "${canon}"`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('the list is a real size and every k is z or b', () => {
  assert.ok(ZONE_ALIASES.length >= 150, `only ${ZONE_ALIASES.length} aliases`);
  assert.deepEqual([...new Set(ZONE_ALIASES.map((e) => e.k))].sort(), ['b', 'z']);
});

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

test('a nickname resolves to its zone', () => {
  assert.ok(searchPickableZones('naggy').includes("Nagafen's Lair"));
  assert.ok(searchPickableZones('phinny').includes('Kedge Keep'));
  assert.ok(searchPickableZones('tox').includes('Toxxulia Forest'));
});

test('a raid-boss name resolves to its zone', () => {
  assert.ok(searchPickableZones('eov').includes('The Plane of Sky'));
  assert.ok(searchPickableZones('master yael').includes('The Ruins of Old Paineel'));
  assert.ok(searchPickableZones('maestro of rancor').includes('The Plane of Hate'));
});

test('"inny" is the Plane of Hate (Innoruuk), never the swamp', () => {
  const r = searchPickableZones('inny');
  assert.ok(r.includes('The Plane of Hate'));
  assert.ok(!r.includes('Innothule Swamp'), '"inny" pulled in the swamp');
});

test('a multi-hit alias returns every zone it maps to', () => {
  const guk = searchPickableZones('guk');
  assert.ok(guk.includes('The City of Guk') && guk.includes('The Ruins of Old Guk'));
  const neriak = searchPickableZones('neriak');
  assert.ok(neriak.includes('Neriak - Commons') && neriak.includes('Neriak - 3rd Gate'));
});

test('client short names are matched too, auto-indexed', () => {
  // soldungb is Nagafen's Lair's shortName - not in the curated list, comes from zoneGraph.
  assert.ok(searchPickableZones('soldungb').includes("Nagafen's Lair"));
  assert.ok(!ZONE_ALIASES.some((e) => e.a === 'soldungb'), 'this one should come from the shortName index, not the list');
});

test('prefix matches in both directions', () => {
  assert.ok(searchPickableZones('nag').includes("Nagafen's Lair"), 'query is a prefix of the alias');
  assert.ok(searchPickableZones('naggydragon').includes("Nagafen's Lair"), 'alias is a prefix of the query');
});

test('a single letter does not explode the alias/shortname match', () => {
  // "a" still substring-matches every zone whose NAME contains an 'a' (unchanged behaviour), but
  // it must not additionally PREFIX-match aliases. "Kedge Keep" has no 'a' in its name and only
  // reaches the results via the boss alias "autropos" - so if 'a' prefix-matched aliases,
  // "autropos".startsWith('a') would drag Kedge Keep in. The >=2-char floor is what stops that.
  const forA = searchPickableZones('a');
  assert.ok(!forA.includes('Kedge Keep'), 'a single letter prefix-matched an alias');
  // A real 2-char query still works both ways.
  assert.ok(searchPickableZones('kk').includes('Kedge Keep'));
});

test('empty query returns the full pickable list', () => {
  assert.deepEqual(searchPickableZones(''), pickableZoneNames());
  assert.deepEqual(searchPickableZones('   '), pickableZoneNames());
});

test('the picker is wired to searchZones end to end', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  assert.match(R('src', 'main', 'main.js'), /ipcMain\.handle\('travel:searchZones'/);
  assert.match(R('src', 'preload', 'preload-zone-prompt.js'), /searchZones:/);
  assert.match(R('src', 'renderer', 'zone-prompt', 'zone-prompt.js'), /window\.eqZonePrompt\.searchZones\(query\)/);
});

module.exports = () => report('zone-aliases');
if (require.main === module) report('zone-aliases').then((n) => process.exit(n ? 1 : 0));
