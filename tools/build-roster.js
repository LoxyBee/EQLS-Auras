'use strict';
/**
 * Rebuilds src/shared/data/buffs.json from the curated EQL spreadsheet plus the game's own
 * data files.
 *
 *   node tools/build-roster.js            # report only, writes nothing
 *   node tools/build-roster.js --write    # archive the old roster, then write the new one
 *
 * WHY THE ROSTER IS BEING REPLACED RATHER THAN EXTENDED
 * -----------------------------------------------------
 * The old roster held 11,337 entries mined from the generic EverQuest client. EQ Legends has
 * about a tenth of that, so most of it was spells the server does not have. That is not merely
 * wasteful: detection decides "is this landing text unique?" by counting how many roster entries
 * claim it, so every spell that does not exist on this server still votes. Text that is unique in
 * practice looked ambiguous, and the app asked the user to disambiguate things that had only one
 * possible answer. Shrinking the roster to what the server actually has is a detection fix, not
 * housekeeping.
 *
 * WHERE EACH FIELD COMES FROM
 * ---------------------------
 * The spreadsheet is authoritative for what EXISTS and for durations - it is curated against the
 * live server. The game files are authoritative for TEXT, because detection is exact-string
 * matching and the strings must be byte-identical to what the client prints.
 *
 *   name                 spreadsheet, run[0] of the Name cell (run[1] is a category tag)
 *   durationSec          spreadsheet Duration column; game ticks x 6 only as a fallback
 *   landingText          spells_us_str.txt CASTEDMETXT   (field 3)
 *   othersLandingSuffix  spells_us_str.txt CASTEDOTHERTXT (field 4)
 *   endedText            spells_us_str.txt SPELLGONE      (field 5)
 *   iconId               spells_us.txt field 75
 *   castSec / reuseSec   spells_us.txt fields 8 and 10, milliseconds
 *   kind/category/...    spreadsheet
 *
 * Those three string-field positions were confirmed against a spell the old roster already had:
 * Spirit of the Puma matched byte-for-byte on all three. The file also carries a header row
 * naming its own columns, so this is not guesswork.
 *
 * ANYTHING THE SPREADSHEET AND THE GAME DISAGREE ABOUT IS REPORTED, NEVER SILENTLY PICKED.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readWorkbook } = require('./lib/xlsx');
// Reuse the app's own rank-suffix rule so the roster and the engine agree on what a base name is.
const { stripRankSuffix } = require('../src/main/buffParser');

const ROOT = path.join(__dirname, '..');
const SHEET = path.join(ROOT, 'new spell roster to be added.xlsx');
const OUT = path.join(ROOT, 'src', 'shared', 'data', 'buffs.json');
const ARCHIVE_DIR = path.join(ROOT, 'src', 'shared', 'data', 'archive');
const OVERRIDES = path.join(__dirname, 'roster-overrides.json');

const EQ_CANDIDATES = [
  'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends',
  'C:/Program Files/Daybreak Game Company/Installed Games/EverQuest Legends',
  'C:/Users/Public/Sony Online Entertainment/Installed Games/EverQuest Legends',
];

// spells_us.txt field positions. Established empirically against the real file, per this
// project's standing rule never to trust an EQEmu schema doc for a custom server.
const F_ID = 0;
const F_NAME = 1;
const F_CAST_MS = 8;
const F_RECAST_MS = 10;
const F_DURATION_TICKS = 12;
const F_ICON = 75;
const SECONDS_PER_TICK = 6;

// spells_us_str.txt - the file names these itself in its header row.
const S_ID = 0;
const S_LANDED_ME = 3;
const S_LANDED_OTHER = 4;
const S_WORE_OFF = 5;

function findEqInstall() {
  const fromEnv = process.env.EQ_INSTALL;
  const all = fromEnv ? [fromEnv, ...EQ_CANDIDATES] : EQ_CANDIDATES;
  for (const p of all) {
    if (fs.existsSync(path.join(p, 'spells_us.txt')) && fs.existsSync(path.join(p, 'spells_us_str.txt'))) return p;
  }
  return null;
}

/** "12s" / "6m" / "3m54s" / "—" -> seconds or null. */
function parseDuration(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === '—' || s === '-') return null;
  const m = /^(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

/**
 * Map the spreadsheet's 109 fine-grained categories onto the eight scaling categories its own
 * second sheet defines. Only used to record how a spell's duration behaves per upgrade tier;
 * it deliberately does not change any runtime behaviour yet.
 */
function scaleCategory(category, kind) {
  const c = String(category || '').toLowerCase();
  if (c === 'delayed') return 'none';           // a fuse before a heal fires, not a buff duration
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

function main() {
  const write = process.argv.includes('--write');
  const eq = findEqInstall();
  if (!eq) {
    console.error('Could not find an EverQuest Legends install with spells_us.txt and');
    console.error('spells_us_str.txt. Set EQ_INSTALL to the install folder and re-run.');
    process.exit(2);
  }
  console.log(`game data : ${eq}`);

  // ---- game data, indexed by lowercase name
  // nameById must be built from EVERY row, not from spellByName: that map keeps only the first
  // row per name, so using it here would leave most spell ids unnamed and silently undercount
  // how many spells share a landing line - which is the whole point of the count below.
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

  const strById = new Map();
  // How many spells IN THE WHOLE GAME print each landed-on-you line.
  //
  // This is the number that decides whether a landing line identifies a spell, and it is not the
  // same as counting the roster. The roster only holds castable EQL spells; the game also has
  // potions, clicky items and AAs that print the identical line. "Your mind begins to clear." is
  // one castable spell and 66 Elixir of Clarity ranks. Judge uniqueness against the roster and
  // clicking an elixir gets confidently mislabelled as a bard song.
  //
  // Shrinking the roster therefore does NOT reduce ambiguity - it hides it, turning "ask the
  // user" into "confidently wrong". Measured on this rebuild: all 50 landing texts that became
  // roster-unique are still shared in the game's own data. Not one was a genuine win.
  //
  // So the count is taken from the game and carried on the entry, and buffStore's landing index
  // honours it. That is strictly better than the old behaviour, because the old 11,337-entry
  // roster was itself only a subset of the game's 66,436 spells and so under-counted too.
  // Counted as DISTINCT BASE NAMES, not raw spell rows, because most sharing is between ranks of
  // one spell and those are not ambiguous in any way that matters - the engine already collapses
  // rank variants, and every rank of Promised Renewal is still Promised Renewal. Counting rows
  // instead makes 53 Cannibalize ranks look like 53 rival spells and prompts the user to choose
  // between a spell and itself. Measured on this data: "Your body aches as your mind clears." is
  // 53 rows but 5 base names, and "You are promised a divine renewal." is 4 rows but exactly 1 -
  // genuinely unambiguous, and it would have prompted forever under a row count.
  const gameBasesByText = new Map();
  for (const line of fs.readFileSync(path.join(eq, 'spells_us_str.txt'), 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const f = line.split('^');
    if (!/^\d+$/.test(f[S_ID] || '')) continue;
    strById.set(f[S_ID], f);
    const t = (f[S_LANDED_ME] || '').trim();
    if (!t) continue;
    const nm = nameById.get(f[S_ID]);
    if (!nm) continue;
    if (!gameBasesByText.has(t)) gameBasesByText.set(t, new Set());
    gameBasesByText.get(t).add(stripRankSuffix(nm));
  }
  const gameSharedByText = new Map();
  for (const [t, set] of gameBasesByText) gameSharedByText.set(t, set.size);
  console.log(`          : ${spellByName.size} spells, ${strById.size} string rows`);

  // ---- spreadsheet
  const wb = readWorkbook(SHEET);
  const flat = wb.sheet('spells');
  const runs = wb.sheetRuns('spells');

  const overrides = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {};

  const roster = [];
  const problems = { noGameData: [], noText: [], durationMismatch: [], noIcon: [] };

  for (let i = 1; i < runs.length; i++) {
    const rr = runs[i];
    const fr = flat[i];
    if (!rr || !Object.keys(rr).length) continue;

    // run[0] is the bare name; run[1] is a grey category tag that must not reach the lookup.
    const name = ((rr.C && rr.C[0]) || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const kind = (((rr.C && rr.C[1]) || '').trim() || (fr.D || '').trim() || '').toLowerCase();

    const g = spellByName.get(name.toLowerCase());
    if (!g) { problems.noGameData.push(name); continue; }

    const s = strById.get(g[F_ID]) || [];
    const landingText = (s[S_LANDED_ME] || '').trim() || null;
    const othersLandingSuffix = s[S_LANDED_OTHER] || null; // leading space is significant
    const endedText = (s[S_WORE_OFF] || '').trim() || null;

    const sheetDur = parseDuration(fr.N);
    const gameTicks = Number(g[F_DURATION_TICKS] || 0);
    const gameDur = Number.isFinite(gameTicks) && gameTicks > 0 ? gameTicks * SECONDS_PER_TICK : null;
    if (sheetDur != null && gameDur != null && sheetDur !== gameDur) {
      problems.durationMismatch.push({ name, sheet: sheetDur, game: gameDur });
    }

    const entry = {
      name,
      spellId: Number(g[F_ID]),
      kind: kind || null,
      durationSec: sheetDur != null ? sheetDur : gameDur,
      landingText,
      endedText,
      iconId: Number(g[F_ICON]) || null,
      othersLandingSuffix,
      category: (fr.F || '').trim() || null,
      scaleCategory: scaleCategory(fr.F, kind),
      classes: (fr.E || '').trim() || null,
      level: fr.A != null ? Number(fr.A) : null,
      manaCost: fr.H != null ? Number(fr.H) : null,
      castSec: Number(g[F_CAST_MS] || 0) / 1000 || null,
      reuseSec: Number(g[F_RECAST_MS] || 0) / 1000 || null,
      targets: (fr.O || '').trim() || null,
      // >1 means this line does not identify a spell on its own, even if only one roster entry
      // claims it. See the comment where this is counted.
      landingTextSharedBy: landingText ? (gameSharedByText.get(landingText) || 1) : null,
    };
    if (entry.landingTextSharedBy != null && entry.landingTextSharedBy < 2) entry.landingTextSharedBy = null;

    const ov = overrides[name];
    if (ov) Object.assign(entry, ov.set || {});

    // Drop nulls so the file stays close to the old schema and small on disk.
    for (const k of Object.keys(entry)) if (entry[k] == null) delete entry[k];

    if (entry.durationSec != null && !entry.landingText) problems.noText.push(name);
    if (!entry.iconId) problems.noIcon.push(name);

    roster.push(entry);
  }

  roster.sort((a, b) => a.name.localeCompare(b.name));

  // ---- report
  const withDur = roster.filter((e) => e.durationSec != null);
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
  console.log('');
  const byKind = {};
  for (const e of roster) byKind[e.kind || '(none)'] = (byKind[e.kind || '(none)'] || 0) + 1;
  console.log(`by kind            : ${JSON.stringify(byKind)}`);
  const byScale = {};
  for (const e of withDur) byScale[e.scaleCategory] = (byScale[e.scaleCategory] || 0) + 1;
  console.log(`duration-bearing   : ${JSON.stringify(byScale)}`);

  if (problems.noGameData.length) {
    console.log(`\nNOT FOUND in game data (${problems.noGameData.length}):`);
    for (const n of problems.noGameData.slice(0, 20)) console.log(`  - ${n}`);
  }
  if (problems.noText.length) {
    console.log(`\nHave a duration but no landing text (${problems.noText.length}) - these cannot be detected:`);
    for (const n of problems.noText.slice(0, 20)) console.log(`  - ${n}`);
  }
  if (problems.durationMismatch.length) {
    console.log(`\nSpreadsheet and game data disagree on duration (${problems.durationMismatch.length}) - spreadsheet wins:`);
    for (const d of problems.durationMismatch.slice(0, 20)) {
      console.log(`  - ${d.name}: sheet ${d.sheet}s, game ${d.game}s`);
    }
  }

  if (!write) {
    console.log('\n(report only - pass --write to archive the old roster and write the new one)');
    return;
  }

  // ---- archive, then write
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  if (fs.existsSync(OUT)) {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    // Only the hand-mined legacy roster is worth archiving. A roster this script produced is
    // reproducible by re-running it, and archiving one on every rebuild would bury the original
    // under near-identical copies - the first re-run already created a pointless
    // "buffs-legacy-1052.json" before this guard existed.
    const isGenerated = old.length > 0 && old[0] && old[0].spellId != null;
    const dest = path.join(ARCHIVE_DIR, `buffs-legacy-${old.length}.json`);
    if (isGenerated) {
      console.log('\ncurrent roster was generated by this script - not archiving a copy of it');
    } else if (!fs.existsSync(dest)) {
      fs.copyFileSync(OUT, dest);
      console.log(`\narchived old roster -> ${path.relative(ROOT, dest)} (${old.length} entries)`);
    } else {
      console.log(`\narchive already exists, left alone -> ${path.relative(ROOT, dest)}`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(roster, null, 1) + '\n', 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT)} (${roster.length} entries)`);
  console.log('\nNow run: npm test   - the roster baseline WILL fail, and its message lists exactly');
  console.log('what changed. Read it, then accept it with: node test/roster.test.js --update');
}

main();
