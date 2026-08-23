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

module.exports = {
  findRoute,
  describeLeg,
  resolveZoneName,
  allZoneNames,
  usableTravelSpells,
};
