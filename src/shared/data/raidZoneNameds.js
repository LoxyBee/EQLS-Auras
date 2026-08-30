'use strict';

// Backlog #33 - the named-kill board. When the player enters one of these zones, every named in
// the list starts "up"; a "<name> has been slain by ..." line greys that one out. If the zone
// `respawns` AND a named has a `respawnMinutes`, the greyed entry shows a countdown and comes back
// when it elapses. EQ Legends' raid targets are all instanced (Voidling entry, weekly Tuesday
// lockout - see docs/research/raid-named-respawn-data.md and CLAUDE.md), so `respawns` is false
// for every raid zone here: a kill stays greyed until you re-enter (a fresh instance = a fresh
// board). The respawnMinutes are kept for the non-instanced zones this will grow to cover.
//
// Zone keys are the BASE zone name. The tracker strips an instance-difficulty suffix
// ("The Plane of Hate - Group 3 (Fused)", "Nagafen's Lair 1 (Awakened)") before matching, so one
// entry covers every difficulty.
//
// The named lists are built from the owner's own real kill logs (17 days) cross-checked against
// eqlwiki / P99 - names are the EXACT in-game spelling ("Cazic-Thule" hyphenated, "Innoruuk, the
// Prince of Hate" in full, backtick apostrophes). "boss" is the zone's headline target(s); "mini"
// is a lesser named. Matching is case-insensitive and tolerates a leading "a "/"an "/"the ".
// This is a starter set for the zones the owner actually raids - extend it as more are visited.

const RAID_ZONE_NAMEDS = {
  "The Plane of Sky": {
    shortName: 'airplane',
    respawns: false,
    nameds: [
      { name: 'The Spiroc Lord', tier: 'boss' },
      { name: 'The Spiroc Guardian', tier: 'boss' },
      { name: 'Bazzt Zzzt', tier: 'boss' },
      { name: 'Gorgalosk', tier: 'boss' },
      { name: 'Noble Dojorn', tier: 'boss' },
      { name: 'Overlord Mraaka', tier: 'boss' },
      { name: 'Eye of Veeshan', tier: 'boss' },
      { name: 'Sister of the Spire', tier: 'mini' },
      { name: 'Keeper of Souls', tier: 'mini' },
      { name: 'The Hand of Veeshan', tier: 'mini' },
      { name: 'Overseer of Air', tier: 'mini' },
      { name: 'Protector of Sky', tier: 'mini' },
    ],
  },
  "The Plane of Hate": {
    shortName: 'hateplane',
    respawns: false,
    nameds: [
      { name: 'Innoruuk, the Prince of Hate', tier: 'boss' },
      { name: 'Maestro of Rancor', tier: 'boss' },
      { name: 'Hand of the Maestro', tier: 'mini' },
      { name: 'Mistress of Scorn', tier: 'mini' },
      { name: 'Lord of Loathing', tier: 'mini' },
      { name: 'Lord of Ire', tier: 'mini' },
      { name: 'Master of Spite', tier: 'mini' },
      { name: 'Grandmaster R`tal', tier: 'mini' },
      { name: 'Coercer T`vala', tier: 'mini' },
      { name: 'Magi P`tasa', tier: 'mini' },
      { name: 'High Priest M`kari', tier: 'mini' },
      { name: 'Ashenbone Broodmaster', tier: 'mini' },
      { name: 'Avatar of Abhorrence', tier: 'mini' },
      { name: 'Corrupter of Life', tier: 'mini' },
    ],
  },
  "The Plane of Fear": {
    shortName: 'fearplane',
    respawns: false,
    nameds: [
      { name: 'Cazic-Thule', tier: 'boss' },
      { name: 'Dread', tier: 'boss' },
      { name: 'Fright', tier: 'boss' },
      { name: 'Terror', tier: 'boss' },
      { name: 'A dracoliche', tier: 'boss' },
      { name: 'Phoboplasm', tier: 'mini' },
      { name: 'A broken golem', tier: 'mini' },
    ],
  },
  "Nagafen's Lair": {
    shortName: 'soldungb',
    respawns: false,
    nameds: [
      { name: 'Lord Nagafen', tier: 'boss' },
      { name: 'King Tranix', tier: 'mini' },
      { name: 'Warlord Skarlon', tier: 'mini' },
      { name: 'Magus Rokyl', tier: 'mini' },
      { name: 'Zordak Ragefire', tier: 'mini' },
    ],
  },
  "Permafrost Keep": {
    shortName: 'permafrost',
    respawns: false,
    nameds: [
      { name: 'Lady Vox', tier: 'boss' },
    ],
  },
};

// EQL uses more than one zone string for Permafrost ("Permafrost Keep" and "The Permafrost
// Caverns" both appear in the owner's logs). Alias the second to the same board rather than
// duplicating the list.
RAID_ZONE_NAMEDS['The Permafrost Caverns'] = RAID_ZONE_NAMEDS['Permafrost Keep'];

module.exports = { RAID_ZONE_NAMEDS };
