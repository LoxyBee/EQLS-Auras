'use strict';

// The raid-lockout aura's row builder. Turns lockoutService.getProjection() into the flat row
// list the overlay draws: per character, the raid zones that still have something owed this
// lockout week, and under each zone the difficulty tiers that have NOT been cleared - "d1 · Normal",
// "d2 · Awakened" ... A tier the player has completed this period is dropped; a zone with nothing
// left owed is dropped entirely. Owner's spec, 2 Sep 2026.
//
// This is the ONLY place the "which tiers are owed" rule lives, so a test imports it rather than
// re-deriving it (the mistake zoneVisibility.js was extracted to stop). Pure - no clock, no fs,
// no electron. The projection is passed in.
//
// It is deliberately NOT the raid-named board (raidNamedTracker.js): that one tracks per-boss
// kills inside the CURRENT zone instance and greys a name as it dies. This one is the weekly
// instance-lockout picture across every raid zone at once, and it only ever shows what is still
// available to run - a "what's left this week" checklist, not a live kill feed.

// A cleared tier is one the game/model says is done for this period. Everything else - open
// (inferred not-done), not_looked (never engaged), conditional (a kill on the reset day itself),
// uncertain - counts as still owed: the player can still go do it, which is the question the aura
// answers.
const CLEARED_STATES = new Set(['completed']);

// difficulty is 0-based in the grid (0 = Normal). The client and the community both count from 1
// ("d1".."d5"), which is what the owner asked to see.
function tierTag(difficulty) {
  return Number.isInteger(difficulty) && difficulty >= 0 ? `d${difficulty + 1}` : '';
}

// projection: the object from lockoutService.getProjection().
// opts.character: restrict to one character name (case-sensitive, as the log writes it). When
//   omitted, every character in the projection is included, each under its own header row.
//
// Returns a flat list of rows, in draw order:
//   { kind: 'character', label }   - only emitted when >1 character is shown
//   { kind: 'zone', label }        - a raid zone with >=1 owed tier
//   { kind: 'tier', label, tierTag, difficultyLabel, state }  - one owed tier under the zone above
// plus, when nothing at all is owed:
//   { kind: 'empty', label: 'All raids cleared this week' }
function lockoutBoardRows(projection, opts = {}) {
  const chars = (projection && Array.isArray(projection.characters) ? projection.characters : [])
    .filter((c) => !opts.character || c.character === opts.character);

  const rows = [];
  let owedAnywhere = false;

  const multi = chars.length > 1;
  for (const c of chars) {
    const cells = (c.grid && Array.isArray(c.grid.cells)) ? c.grid.cells : [];

    // group owed tiers by zone, keeping first-seen zone order and difficulty order
    const byZone = new Map();
    for (const cell of cells) {
      if (CLEARED_STATES.has(cell.state)) continue;
      const zone = cell.label || cell.raid || 'Unknown zone';
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone).push(cell);
    }
    for (const list of byZone.values()) {
      list.sort((a, b) => (a.difficulty ?? 99) - (b.difficulty ?? 99));
    }

    if (byZone.size === 0) continue;
    owedAnywhere = true;

    if (multi) rows.push({ kind: 'character', label: c.character });
    for (const [zone, list] of byZone) {
      rows.push({ kind: 'zone', label: zone });
      for (const cell of list) {
        rows.push({
          kind: 'tier',
          tierTag: tierTag(cell.difficulty),
          difficultyLabel: cell.difficultyLabel || '',
          label: [tierTag(cell.difficulty), cell.difficultyLabel].filter(Boolean).join(' · '),
          state: cell.state || 'unknown',
        });
      }
    }
  }

  if (!owedAnywhere) {
    return [{ kind: 'empty', label: chars.length ? 'All raids cleared this week' : 'No lockout data yet' }];
  }
  return rows;
}

module.exports = { lockoutBoardRows, tierTag, CLEARED_STATES };
