'use strict';
/**
 * Rebuilds src/shared/data/buffs.json from the current roster plus tools/roster-overrides.json,
 * with text/icon/timing enrichment and the game-wide shared-landing-text count taken from the
 * client's own spell files.
 *
 *   node tools/build-roster.js            # report only, writes nothing
 *   node tools/build-roster.js --write    # write the new roster
 *
 * buffs.json IS the roster of record. roster-overrides.json is the one place it is edited:
 *
 *   "<exact spell name>": { "why": "...", "set": { <fields to overwrite on an existing entry> } }
 *   "<exact spell name>": { "why": "...", "add": { <a brand-new entry> } }
 *
 * A rebuild re-applies every `set` and `add`, and re-derives `landingTextSharedBy` from the client
 * data. It never invents entries and never drops one that is not being replaced, so running it is
 * safe; the report (no --write) shows what a write would change.
 *
 * WHY THE ROSTER IS SMALL ON PURPOSE. Detection decides "is this landing text unique?" by counting
 * roster entries that claim it, so a spell the server does not have would still vote on ambiguity.
 * The roster is only the ~1,000 spells EQ Legends actually has. When a real one is missing, add it
 * via an `add` block - do not widen the roster with client data the server does not use.
 *
 * FIELD SOURCES (client data, indexed by spell name / id):
 *   landingText          spells_us_str.txt CASTEDMETXT    (field 3)
 *   othersLandingSuffix  spells_us_str.txt CASTEDOTHERTXT (field 4)
 *   endedText            spells_us_str.txt SPELLGONE      (field 5)
 *   iconId               spells_us.txt field 75
 *   castSec / reuseSec   spells_us.txt fields 8 and 10, milliseconds
 * Positions established empirically against the real file (Spirit of the Puma matched byte-for-byte
 * on all three string fields), per this project's rule never to trust an EQEmu schema doc for a
 * custom server.
 */

const fs = require('node:fs');
const path = require('node:path');
// Reuse the app's own rank-suffix rule so the roster and the engine agree on what a base name is.
const { stripRankSuffix } = require('../src/main/buffParser');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'shared', 'data', 'buffs.json');
const OVERRIDES = path.join(__dirname, 'roster-overrides.json');

const EQ_CANDIDATES = [
  'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends',
  'C:/Program Files/Daybreak Game Company/Installed Games/EverQuest Legends',
  'C:/Users/Public/Sony Online Entertainment/Installed Games/EverQuest Legends',
];

// spells_us.txt field positions.
const F_ID = 0;
const F_NAME = 1;
const F_CAST_MS = 8;
const F_RECAST_MS = 10;
const F_ICON = 75;

// spells_us_str.txt - the file names these itself in its header row.
const S_ID = 0;
const S_LANDED_ME = 3;
const S_LANDED_OTHER = 4;
const S_WORE_OFF = 5;

// Keys that are build directives inside an `add` block, not roster data.
const ADD_DIRECTIVES = new Set(['noGameLookup']);
const rosterFields = (obj) => {
  const out = {};
  for (const k of Object.keys(obj)) if (!ADD_DIRECTIVES.has(k)) out[k] = obj[k];
  return out;
};

function findEqInstall() {
  const fromEnv = process.env.EQ_INSTALL;
  const all = fromEnv ? [fromEnv, ...EQ_CANDIDATES] : EQ_CANDIDATES;
  for (const p of all) {
    if (fs.existsSync(path.join(p, 'spells_us.txt')) && fs.existsSync(path.join(p, 'spells_us_str.txt'))) return p;
  }
  return null;
}

// Scaling category for a hand-added entry that carries no per-tier duration behaviour of its own.
// "none" means no per-mote / AA duration scaling - the safe default for anything added by hand.
function scaleCategory(category, kind) {
  const c = String(category || '').toLowerCase();
  if (c === 'delayed') return 'none';
  if (c.includes('dot')) return 'dot';
  if (c.includes('duration heal') || c.includes('regen')) return 'hot';
  if (c === 'heals') return 'heal';
  if (c.includes('charm') || c.includes('mez') || c.includes('lull')) return 'charm';
  if (/\bdd\b/.test(c) || c.includes('lifetap')) return 'nuke';
  if (c.startsWith('sum:') || kind === 'pet') return 'pet';
  if (kind === 'det') return 'debuff';
  if (kind === 'buff') return 'buff';
  return 'none';
}

/**
 * Brand-new entries from roster-overrides.json `add` blocks - real EQ Legends spells not yet in
 * the roster. The client spell files supply landingText / endedText / iconId / castSec when the
 * spell exists there (it usually does); anything in `add` overrides that, so a spell absent from
 * the client data entirely can still be fully hand-specified. `noGameLookup: true` skips the
 * client match for a name that coincidentally collides with an unrelated spell.
 *
 * Pure - the client lookups are passed in, so a test can exercise this with fixtures.
 */
function buildAddedEntries(overrides, { spellByName, strById }, existingNames = new Set()) {
  const added = [];
  for (const [name, ov] of Object.entries(overrides)) {
    if (name.startsWith('_') || !ov || !ov.add) continue;
    if (existingNames.has(name.toLowerCase())) continue; // already an entry - `set` covers that
    const g = ov.add.noGameLookup ? null : spellByName.get(name.toLowerCase());
    const s = g ? strById.get(g[F_ID]) || [] : [];
    const entry = {
      name,
      spellId: g ? Number(g[F_ID]) : null,
      landingText: (s[S_LANDED_ME] || '').trim() || null,
      othersLandingSuffix: s[S_LANDED_OTHER] || null, // leading space is significant
      endedText: (s[S_WORE_OFF] || '').trim() || null,
      iconId: g ? Number(g[F_ICON]) || null : null,
      castSec: g ? Number(g[F_CAST_MS] || 0) / 1000 || null : null,
      reuseSec: g ? Number(g[F_RECAST_MS] || 0) / 1000 || null : null,
      scaleCategory: 'none',
      ...rosterFields(ov.add),
    };
    if (!entry.scaleCategory) entry.scaleCategory = scaleCategory(entry.category, entry.kind);
    for (const k of Object.keys(entry)) if (entry[k] == null) delete entry[k];
    added.push(entry);
  }
  return added;
}

function main() {
  const write = process.argv.includes('--write');
  const eq = findEqInstall();
  if (!eq) {
    console.error('Could not find an EverQuest Legends install with spells_us.txt and');
    console.error('spells_us_str.txt. Set EQ_INSTALL to the install folder and re-run.');
    process.exit(2);
  }
  console.log(`client data : ${eq}`);

  // ---- client data, indexed by lowercase name and by id
  const spellByName = new Map();
  const nameById = new Map();
  for (const line of fs.readFileSync(path.join(eq, 'spells_us.txt'), 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const f = line.split('^');
    if (f.length < 80) continue;
    const n = (f[F_NAME] || '').trim();
    if (!n) continue;
    nameById.set(f[F_ID], n);
    if (!spellByName.has(n.toLowerCase())) spellByName.set(n.toLowerCase(), f);
  }

  // How many spells IN THE WHOLE CLIENT print each landed-on-you line. This is what decides whether
  // a landing text identifies a spell - the roster only holds castable EQL spells, but the client
  // also has potions, clickies and AAs that print the identical line. Counted as DISTINCT BASE
  // NAMES (rank variants collapsed), because 53 Cannibalize ranks are not 53 rival spells.
  const strById = new Map();
  const clientBasesByText = new Map();
  for (const line of fs.readFileSync(path.join(eq, 'spells_us_str.txt'), 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const f = line.split('^');
    if (!/^\d+$/.test(f[S_ID] || '')) continue;
    strById.set(f[S_ID], f);
    const t = (f[S_LANDED_ME] || '').trim();
    if (!t) continue;
    const nm = nameById.get(f[S_ID]);
    if (!nm) continue;
    if (!clientBasesByText.has(t)) clientBasesByText.set(t, new Set());
    clientBasesByText.get(t).add(stripRankSuffix(nm));
  }
  const sharedByText = new Map();
  for (const [t, set] of clientBasesByText) sharedByText.set(t, set.size);
  console.log(`            : ${spellByName.size} spells, ${strById.size} string rows`);

  const overrides = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {};

  // ---- current roster + overrides
  console.log('\nrebuilding from the current roster + roster-overrides.json (set + add)\n');
  const roster = [];
  for (const e of JSON.parse(fs.readFileSync(OUT, 'utf8'))) {
    const ov = overrides[e.name];
    // `set` and `add` both just overwrite fields on an entry that already exists - re-applying
    // `add` here is what lets you edit an addition's block and re-run to pick up the change.
    if (ov) Object.assign(e, ov.set || {}, ov.add ? rosterFields(ov.add) : {});
    // Keep the shared-landing-text count current with the client data.
    if (e.landingText) {
      const n = sharedByText.get(e.landingText) || 1;
      if (n >= 2) e.landingTextSharedBy = n;
      else delete e.landingTextSharedBy;
    }
    for (const k of Object.keys(e)) if (e[k] == null) delete e[k];
    roster.push(e);
  }

  const added = buildAddedEntries(overrides, { spellByName, strById }, new Set(roster.map((e) => e.name.toLowerCase())));
  for (const e of added) {
    if (e.landingText) {
      const n = sharedByText.get(e.landingText) || 1;
      if (n >= 2) e.landingTextSharedBy = n;
    }
    roster.push(e);
  }
  if (added.length) console.log(`added (${added.length}): ${added.map((e) => e.name).join(', ')}`);

  roster.sort((a, b) => a.name.localeCompare(b.name));

  // ---- report
  const withDur = roster.filter((e) => e.durationSec != null);
  const noText = roster.filter((e) => e.durationSec != null && !e.landingText).map((e) => e.name);
  const land = new Map();
  for (const e of roster) if (e.landingText) land.set(e.landingText, (land.get(e.landingText) || 0) + 1);
  const uniqueLanding = [...land.values()].filter((v) => v === 1).length;

  console.log('');
  console.log(`entries            : ${roster.length}`);
  console.log(`  with duration    : ${withDur.length}`);
  console.log(`  with landingText : ${roster.filter((e) => e.landingText).length}`);
  console.log(`  with others text : ${roster.filter((e) => e.othersLandingSuffix).length}`);
  console.log(`  with endedText   : ${roster.filter((e) => e.endedText).length}`);
  console.log(`  with iconId      : ${roster.filter((e) => e.iconId).length}`);
  console.log(`  distinct landing : ${land.size}  (unique-owner: ${uniqueLanding})`);
  const byKind = {};
  for (const e of roster) byKind[e.kind || '(none)'] = (byKind[e.kind || '(none)'] || 0) + 1;
  console.log(`by kind            : ${JSON.stringify(byKind)}`);

  if (noText.length) {
    console.log(`\nHave a duration but no landing text (${noText.length}) - these cannot be detected:`);
    for (const n of noText.slice(0, 20)) console.log(`  - ${n}`);
  }

  if (!write) {
    console.log('\n(report only - pass --write to write the new roster)');
    return;
  }

  fs.writeFileSync(OUT, JSON.stringify(roster, null, 1) + '\n', 'utf8');
  console.log(`\nwrote ${path.relative(ROOT, OUT)} (${roster.length} entries)`);
  console.log('\nIf the roster baseline test fails, its message lists what changed. Read it, then');
  console.log('accept it with: node test/roster.test.js --update');
}

if (require.main === module) main();

module.exports = { buildAddedEntries, scaleCategory, rosterFields };
