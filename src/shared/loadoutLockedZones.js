'use strict';

// Where a full EQ Legends LOADOUT SWAP is not possible. Owner, 4 Sep:
//
//   "assume that is all dungeons and all raid/group zones ... anything memmed/unmemmed inside them
//    can be considered truth, but must IMMEDIATELY be considered weak evidence as soon as a person
//    exits that area. when a person re-enters, it should not reinstate the old evidence, it should
//    generate new ones, because there can be a situation where a person steps out of an instance,
//    swaps loadout, and then goes back in."
//
// The engine normally distrusts `currentlyMemorized` because a loadout swap changes every gem at
// once and prints NOTHING (see buffEngine.js gotcha #9 / #16). Inside a locked zone that can't
// happen - a gem only leaves the bar on an explicit "You forget X." the app also sees - so a
// memorize seen while locked is trustworthy. See buffEngine.setLoadoutLocked / `_gemVerified`.
//
// BASELINE, not the whole list. "there are others" (owner) - add them to LOADOUT_LOCKED_EXTRA as
// they surface. The named-board zones (raidZoneNameds.js keys) are the known dungeons + raid/group
// zones; any zone string carrying a private-instance difficulty suffix is locked regardless.

const { RAID_ZONE_NAMEDS } = require('./data/raidZoneNameds');

// A private instance always carries one of these: "- Group", "- Group 4 (Refined)",
// "1 (Awakened)". Kept in sync with raidNamedTracker.js's INSTANCE_SUFFIX.
const INSTANCE_SUFFIX = / (?:- Group(?: \d+ \([^)]+\))?|\d+ \([^)]+\))\s*$/;

const LOADOUT_LOCKED_EXTRA = new Set([
  // e.g. "Lower Guk", "The Estate of Unrest" - add as confirmed
]);

/** `rawZone` is the zone name exactly as "You have entered X." gave it, suffix and all. */
function isLoadoutLockedZone(rawZone) {
  const z = String(rawZone || '').trim();
  if (!z) return false;
  if (INSTANCE_SUFFIX.test(z)) return true;
  const base = z.replace(INSTANCE_SUFFIX, '').trim();
  return Object.prototype.hasOwnProperty.call(RAID_ZONE_NAMEDS, base) || LOADOUT_LOCKED_EXTRA.has(base);
}

module.exports = { isLoadoutLockedZone, LOADOUT_LOCKED_EXTRA, INSTANCE_SUFFIX };
