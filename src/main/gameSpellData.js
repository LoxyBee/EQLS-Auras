const fs = require('fs');
const path = require('path');

// Single parse of the game's own spells_us.txt, shared by everything that
// needs facts about spells the app's own roster doesn't have. The roster
// (buffStore) only contains *trackable buffs* - it deliberately excludes
// nukes, heals, and anything the mining filter dropped - but several features
// need to say something sensible about a spell that isn't in it (which gem
// icon a memorized nuke uses, whether an arbitrary spell is a bard song).
//
// Parsed lazily and cached per install root: the file is ~66k lines, so this
// is worth doing exactly once, but doing it at require-time would slow every
// launch even when nothing ends up asking.
//
// Field positions in this server's schema, all established empirically
// against the user's real file rather than assumed from EQEmu docs:
//   1      - spell name
//   36..51 - the 16 per-class required levels, 255 = class can never cast it
//   75     - icon id (verified: matched the roster's own iconId on 40/40
//            sampled buffs; no other field matched more than 2)
//   12     - duration in ticks; multiply by 6 for seconds (verified: matched
//            the roster's own durationSec/6 on 397 of 400 sampled buffs)
//   75     - icon id
// And from the sibling spells_us_str.txt, keyed by spell id:
//   3      - CASTEDMETXT, the "it landed on you" flavour line
//   5      - SPELLGONE, the "it wore off" line
const SPELL_ID_FIELD = 0;
const NAME_FIELD = 1;
const DURATION_TICKS_FIELD = 12;
const CLASS_LEVEL_FIRST_FIELD = 36;
const CLASS_COUNT = 16;
const BARD_OFFSET = 7; // War, Clr, Pal, Rng, SHD, Dru, Mnk, Brd, ...
const NEVER_CASTABLE = 255;
const ICON_FIELD = 75;
const STR_LANDED_ON_ME = 3;
const STR_WORE_OFF = 5;
const SECONDS_PER_TICK = 6;

let cache = null; // { installRoot, bardOnlyNames, iconIdByName, bardSongs }

function parse(installRoot) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(installRoot, 'spells_us.txt'), 'utf8');
  } catch {
    // No spell data reachable (unusual install layout, or the folder moved).
    // Callers all degrade gracefully rather than treating this as fatal.
    return null;
  }

  // Flavour text lives in a separate file keyed by spell id. Missing is fine -
  // callers that need text just get nothing and skip.
  const strById = new Map();
  try {
    for (const line of fs.readFileSync(path.join(installRoot, 'spells_us_str.txt'), 'utf8').split(/\r\n|\n/)) {
      if (!line || line.startsWith('#')) continue;
      const f = line.split('^');
      strById.set(f[0], f);
    }
  } catch {
    // no-op - strById stays empty
  }

  const bardOnlyNames = new Set();
  const iconIdByName = new Map();
  const bardSongs = []; // full records, only for bard-only spells

  for (const line of raw.split(/\r\n|\n/)) {
    if (!line) continue;
    const fields = line.split('^');
    if (fields.length <= ICON_FIELD) continue;

    const name = fields[NAME_FIELD];
    if (!name) continue;
    const lower = name.toLowerCase();

    // First entry wins - a name can repeat across rank variants, and the
    // lowest/base one comes first in file order.
    const icon = Number(fields[ICON_FIELD]);
    const hasIcon = Number.isFinite(icon) && icon >= 0;
    if (hasIcon && !iconIdByName.has(lower)) iconIdByName.set(lower, icon);

    let bardCanCast = false;
    let anyOtherCanCast = false;
    for (let i = 0; i < CLASS_COUNT; i++) {
      const level = Number(fields[CLASS_LEVEL_FIRST_FIELD + i]);
      if (!Number.isFinite(level) || level >= NEVER_CASTABLE) continue;
      if (i === BARD_OFFSET) bardCanCast = true;
      else anyOtherCanCast = true;
    }
    if (!bardCanCast || anyOtherCanCast) continue;

    if (bardOnlyNames.has(lower)) continue; // first entry wins here too
    bardOnlyNames.add(lower);

    const str = strById.get(fields[SPELL_ID_FIELD]);
    const ticks = Number(fields[DURATION_TICKS_FIELD]);
    bardSongs.push({
      name,
      durationSec: Number.isFinite(ticks) && ticks > 0 ? ticks * SECONDS_PER_TICK : 0,
      landingText: (str && str[STR_LANDED_ON_ME]) || '',
      endedText: (str && str[STR_WORE_OFF]) || '',
      iconId: hasIcon ? icon : null,
    });
  }

  return { installRoot, bardOnlyNames, iconIdByName, bardSongs };
}

function load(installRoot) {
  if (!installRoot) return null;
  if (cache && cache.installRoot === installRoot) return cache;
  cache = parse(installRoot);
  return cache;
}

// Every spell only the Bard class can cast - see bardSongTagger.js.
function getBardOnlyNames(installRoot) {
  return load(installRoot)?.bardOnlyNames || null;
}

// Icon id for any spell in the game data, whether or not it's a tracked buff.
// null when unknown.
function getIconId(installRoot, name) {
  const data = load(installRoot);
  if (!data) return null;
  const icon = data.iconIdByName.get(name.toLowerCase());
  return icon === undefined ? null : icon;
}

// Full records for every bard-only spell - name, duration, landing/ended
// text, icon. Used to backfill songs the roster's mining filter dropped, see
// rosterBackfill.js.
function getBardSongRecords(installRoot) {
  return load(installRoot)?.bardSongs || null;
}

module.exports = { getBardOnlyNames, getIconId, getBardSongRecords };
