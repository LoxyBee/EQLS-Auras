'use strict';
/**
 * Note 20 - the shortest way from where you are to where you want to be.
 *
 * A breadth-first search over the zone graph, plus one extra move: a travel spell you have scribed
 * is an edge from ANYWHERE to the place it puts you. That is what makes a route with a spell in it
 * shorter than the same route on foot, and it is the whole reason the note wanted the spellbook
 * consulted rather than just a map.
 *
 * Breadth-first and not Dijkstra, deliberately. Weighting the edges would mean claiming that a
 * boat costs more than a zone line, or that a portal is cheaper than both, and there is no
 * measurement behind any of those numbers - only a feeling. Fewest hops is a claim the data
 * actually supports. Where two routes tie on hops the one using fewer spells wins, because a spell
 * you have to cast is a step you have to remember.
 *
 * The route is returned as legs rather than a list of zone names, because "how" is the useful half:
 * knowing you pass through Erudin does not tell you whether you walk, sail, or cast.
 */

const { ZONES, TRAVEL_SPELLS } = require('./data/zoneGraph');
const { ZONE_ALIASES } = require('./data/zoneAliases');

// Display names differ from the wikis and sometimes from each other, so every lookup goes through
// the same normaliser. Not a fuzzy match - just case and surrounding space, which is where the
// real mismatches are.
function normalize(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

const BY_NORMALIZED = new Map(Object.keys(ZONES).map((n) => [normalize(n), n]));

// The canonical display name for a zone, or null. Exported because callers building a dropdown
// need to know whether what the log gave them is a zone this graph has heard of.
function resolveZoneName(name) {
  return BY_NORMALIZED.get(normalize(name)) || null;
}

function allZoneNames() {
  return Object.keys(ZONES).sort((a, b) => a.localeCompare(b));
}

// Every zone EXCEPT the 27 instance-tier variants (" (Awakened)", " (Fused)", etc). For picking a
// destination or a current zone by hand - nobody stands in "Befallen 3 (Fused)" and needs to say
// so, they stand in Befallen and enter the tier from there (see the instance-tier routing note
// further down this file). `allZoneNames()` itself stays untouched and still returns every zone,
// tiers included - `findRoute` can route TO a specific tier, and `test/zone-routing.test.js`'s own
// "every zone" test pins that full count, so the filtering lives here as a second function rather
// than changing what the first one means.
function pickableZoneNames() {
  return allZoneNames().filter((n) => !ZONES[n].isInstanceVariantOf);
}

/**
 * The ordinary place an instance tier belongs to, or null if this is already one.
 *
 * Normally that is just isInstanceVariantOf. The fallback below exists for exactly one entry and
 * is written from the data rather than from a guess: "The Permafrost Caverns - Group" names a base
 * of "The Permafrost Caverns", which is not in the set - the research flagged this pair as
 * unverified, because the app's zone list carries both "Permafrost Keep" and "The Permafrost
 * Caverns - Group" while classic EverQuest has one zone, permafrost. Both entries here carry that
 * same short name, so matching on it finds the real place without anyone deciding which of the two
 * display names is correct.
 *
 * Without this, that one zone is reachable from nowhere - 103 dead routes out of 10,712.
 */
function baseZoneFor(zoneName) {
  const zone = ZONES[zoneName];
  if (!zone || !zone.isInstanceVariantOf) return null;
  if (ZONES[zone.isInstanceVariantOf]) return zone.isInstanceVariantOf;
  const sibling = Object.keys(ZONES).find(
    (n) => n !== zoneName && ZONES[n].shortName === zone.shortName && !ZONES[n].isInstanceVariantOf
  );
  return sibling || null;
}

/**
 * Travel spells that land you somewhere, filtered to the ones you actually know.
 *
 * scribedNames is what the spellbook holds. Passing null means "assume none", which is the honest
 * default: a route offering a spell the player does not have is worse than a longer walk, because
 * they will follow it and then be stuck.
 */
function usableTravelSpells(scribedNames) {
  if (!scribedNames || !scribedNames.length) return [];
  const known = new Set(scribedNames.map(normalize));
  return TRAVEL_SPELLS.filter((s) => known.has(normalize(s.spell))).filter((s) =>
    resolveZoneName(s.destination)
  );
}

/**
 * The shortest route from one zone to another.
 *
 * Returns { legs, hops, ok } where each leg is { from, to, via, spell? }. via is 'land', 'boat',
 * 'portal' or 'spell'. ok is false when there is no route at all - which the current dataset says
 * never happens between two known zones, but a graph edited later could easily make possible, and
 * a caller should not have to tell "nowhere to go" apart from "already there" by checking lengths.
 */
function findRoute(fromZone, toZone, { scribedSpells = null } = {}) {
  const from = resolveZoneName(fromZone);
  const requested = resolveZoneName(toZone);
  if (!from || !requested) return { ok: false, hops: 0, legs: [], reason: 'unknown-zone' };
  if (from === requested) return { ok: true, hops: 0, legs: [], reason: 'already-there' };

  /**
   * An instance tier is walked OUT of, never into.
   *
   * The data is right about that and it is not an oversight: "Befallen 3 (Fused)" lists a way out
   * to West Commonlands, and West Commonlands lists no way back in, because there is no zone line
   * into a particular tier - you enter through the instance system from the ordinary zone. All 27
   * variants are like this, which is why 2,079 routes INTO them find nothing.
   *
   * So the route is worked out to the ordinary place and the last step says to enter the instance
   * from there. That is what someone actually has to do, and it beats both the alternatives: a
   * fabricated zone line that does not exist, and a flat "no route" to a place that is plainly
   * reachable.
   */
  const base = baseZoneFor(requested);
  const enterLeg = base ? { to: requested, via: 'instance' } : null;
  const to = base || requested;
  if (from === to) {
    return { ok: true, hops: 1, legs: [{ from, ...enterLeg }], reason: null };
  }

  const spells = usableTravelSpells(scribedSpells);
  // Grouped by destination so the search takes the best spell to a place rather than queueing one
  // frontier entry per spell that happens to go there.
  const spellsTo = new Map();
  for (const s of spells) {
    const dest = resolveZoneName(s.destination);
    if (dest && !spellsTo.has(dest)) spellsTo.set(dest, s);
  }

  // Breadth-first, so the first time a zone is reached is by the fewest hops there are. The
  // tie-break on spell count is applied at insertion: a zone is only re-opened if the new way of
  // reaching it is the same length AND uses fewer spells.
  const best = new Map([[from, { hops: 0, spellCount: 0, leg: null, prev: null }]]);
  const queue = [from];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const state = best.get(current);
    if (current === to) break;

    const moves = [];
    for (const c of ZONES[current].connections) {
      const dest = resolveZoneName(c.to);
      if (dest) moves.push({ to: dest, via: c.via, spell: null });
    }
    // A spell can be cast from anywhere, so every destination is reachable from every zone. Only
    // worth queueing if it actually improves on what is already known.
    for (const [dest, s] of spellsTo) {
      if (dest !== current) moves.push({ to: dest, via: 'spell', spell: s.spell });
    }

    for (const move of moves) {
      const hops = state.hops + 1;
      const spellCount = state.spellCount + (move.via === 'spell' ? 1 : 0);
      const known = best.get(move.to);
      // TWO MECHANISMS AGREE HERE, and that is worth knowing before anyone simplifies it.
      //
      // The spellCount clause is the actual guarantee that a tie goes to the route with fewer
      // spells in it. The move ordering above - land connections generated before spell moves -
      // happens to produce the same answer, so measured across all 10,712 routes with every travel
      // spell scribed, deleting this clause changes nothing at all.
      //
      // It is kept because it is the mechanism that HOLDS the guarantee: reverse the move ordering
      // and the routes stay correct with this clause and go wrong without it. The ordering is an
      // accident of how the loops are written; this is the rule.
      const better =
        !known || hops < known.hops || (hops === known.hops && spellCount < known.spellCount);
      if (!better) continue;
      best.set(move.to, { hops, spellCount, leg: { from: current, ...move }, prev: current });
      // Re-queued on improvement. The graph is 104 nodes, so the cost of that is nothing, and it
      // is what makes the fewer-spells tie-break actually reach the answer rather than merely
      // being recorded on a node nobody expands again.
      queue.push(move.to);
    }
  }

  if (!best.has(to)) return { ok: false, hops: 0, legs: [], reason: 'no-route' };

  const legs = [];
  for (let at = to; at !== from; ) {
    const node = best.get(at);
    legs.unshift(node.leg);
    at = node.prev;
  }
  if (enterLeg) legs.push({ from: to, ...enterLeg });
  return { ok: true, hops: legs.length, legs, reason: null };
}

// "Sail to Butcherblock Mountains" - one leg in words. Kept beside the routing rather than in the
// renderer so the overlay and the settings page cannot drift into describing the same leg
// differently.
const VIA_VERBS = { land: 'Go to', boat: 'Sail to', portal: 'Portal to', spell: 'Cast' };

function describeLeg(leg) {
  if (!leg) return '';
  if (leg.via === 'spell') return `Cast ${leg.spell}`;
  // Deliberately vague about HOW, because the app does not know: instance tiers are entered
  // through the game's own interface and nothing in the log describes that step.
  if (leg.via === 'instance') return `Enter ${leg.to}`;
  return `${VIA_VERBS[leg.via] || 'Go to'} ${leg.to}`;
}

/**
 * Note 20, as Shara specified it on 23 August: the destination is set by typing "/tell qeynos" in
 * game, which the server answers with "Qeynos is not online at this time." - and that reply is the
 * command. It is a neat trick, because a /tell name is one word with no spaces and the game echoes
 * it back reliably, so nothing has to be typed into the app at all while playing.
 *
 * The catch is that one word is not a zone name. "qeynos" is not a zone; South Qeynos, North
 * Qeynos, Qeynos Hills and The Qeynos Aqueduct System are. So resolution runs in a fixed order of
 * decreasing certainty, and STOPS rather than guessing when several zones fit:
 *
 *   1. an exact display name              "rivervale"  -> Rivervale
 *   2. an exact client short name         "qeynos"     -> South Qeynos
 *   3. a unique match on part of a name   "faydark"    -> ambiguous, two of them
 *
 * Step 2 is what makes the common cases work, and it is not arbitrary: the short name IS what the
 * game itself calls the zone, so it is the spelling a player already half-knows. Of the 107
 * distinct words in these zone names, 61 are unique and 46 are not, which is why step 3 has to be
 * able to fail.
 *
 * Returns { zone } | { ambiguous: [names] } | null.
 */
function resolveDestinationName(text) {
  const wanted = normalize(text);
  if (!wanted) return null;

  const exact = BY_NORMALIZED.get(wanted);
  if (exact) return { zone: exact };

  // Instance tiers share their base's short name - 27 of them do - so a short-name match prefers
  // the ordinary place. Nobody typing "qeynos" means the Awakened tier of it.
  const byShort = Object.keys(ZONES).filter(
    (n) => ZONES[n].shortName === wanted && !ZONES[n].isInstanceVariantOf
  );
  if (byShort.length === 1) return { zone: byShort[0] };

  const partial = Object.keys(ZONES).filter(
    (n) => !ZONES[n].isInstanceVariantOf && n.toLowerCase().includes(wanted)
  );
  if (partial.length === 1) return { zone: partial[0] };
  // Sorted so the list a person reads is stable between attempts, and capped because a very short
  // query can match a dozen zones and a wall of them is not an answer.
  if (partial.length > 1) return { ambiguous: partial.sort((a, b) => a.localeCompare(b)).slice(0, 6) };
  return null;
}

// shortName -> [pickable zone display names], built once. A few short names are shared (an
// instance base and nothing else, mostly), so it is a list, not a single value.
const BY_SHORTNAME = (() => {
  const m = new Map();
  for (const name of pickableZoneNames()) {
    const sn = ZONES[name].shortName;
    if (!sn) continue;
    if (!m.has(sn)) m.set(sn, []);
    m.get(sn).push(name);
  }
  return m;
})();

// The eqtm zone picker's search (QOL #30). Three sources, unioned and de-duplicated:
//   1. the plain display-name substring match (what the picker did before)
//   2. community nicknames + EQL raid-boss names (src/shared/data/zoneAliases.js)
//   3. every zone's client shortName, auto-indexed - zero-maintenance, new zones covered for free
// For 2 and 3 the match is exact-or-prefix in EITHER direction (alias === q, alias.startsWith(q),
// or q.startsWith(alias)), never a free substring - so "nag" finds "naggy" but "a" does not pull
// in every alias that happens to contain an 'a'. A multi-hit alias contributes all its zones and
// the picker shows them all, exactly like an ambiguous substring match already does.
function searchPickableZones(query) {
  const q = normalize(query);
  if (!q) return pickableZoneNames();
  const out = new Set(pickableZoneNames().filter((n) => n.toLowerCase().includes(q)));
  // Exact-or-prefix, either direction, but a prefix needs >=2 chars on the query side so a single
  // typed letter does not pull in every alias / short name that starts with it.
  const hit = (key) =>
    key === q || (q.length >= 2 && key.startsWith(q)) || (key.length >= 2 && q.startsWith(key));
  for (const entry of ZONE_ALIASES) {
    if (hit(entry.a)) for (const z of entry.z) {
      const canon = resolveZoneName(z);
      if (canon && !ZONES[canon].isInstanceVariantOf) out.add(canon);
    }
  }
  for (const [sn, names] of BY_SHORTNAME) {
    if (hit(sn)) for (const n of names) out.add(n);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

module.exports = {
  resolveDestinationName,
  findRoute,
  describeLeg,
  resolveZoneName,
  allZoneNames,
  pickableZoneNames,
  searchPickableZones,
  usableTravelSpells,
};
