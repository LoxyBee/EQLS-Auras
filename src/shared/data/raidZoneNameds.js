'use strict';

// Backlog #33 - the named-kill board. When the player enters one of these zones, every named in
// the list starts "up"; a "<name> has been slain by ..." line greys that one out. If the zone
// `respawns` AND a named has a `respawnMinutes`, the greyed entry shows a countdown and comes back
// when it elapses.
//
// COVERS EVERY TRACKED ZONE, not just raids (backlog #33's actual scope - the raid-only naming
// below is historical). Two kinds:
//   - `respawns: false` - instanced (Voidling raids; the instanced dungeons). A fresh instance is
//     a fresh board, so a kill stays greyed until you re-enter. `respawnMinutes` are ignored.
//   - `respawns: true` - persistent open-world zones (Najena, Splitpaw, The Warrens). A greyed
//     named with a `respawnMinutes` counts down and comes back on its own.
//
// Zone keys are the BASE zone name. The tracker strips an instance-difficulty suffix
// ("The Plane of Hate - Group 3 (Fused)", "Nagafen's Lair 1 (Awakened)") before matching, so one
// entry covers every difficulty.
//
// Names: matching normalises case and one leading "a "/"an "/"the " (see bareName), so those don't
// have to be exact - but apostrophes MUST be the backtick the EQL client emits (confirmed from the
// owner's log: "Coercer T`vala", "Grandmaster R`tal", "Innoruuk`s Chosen"), hyphens exact
// ("Cazic-Thule"), and multi-word proper names exact. "boss" is the headline target(s), "mini" a
// lesser named, "lesser" trash-tier. The raid zones + Castle Mistmoore + Nagafen's Lair minis are
// checked against the owner's own slain-lines; the rest are from
// docs/research/eql-zones-and-nameds.md (eqlsource surveys) and an un-killed named there just
// never greys - harmless. Names flagged `unverified` in a comment still want a real slain-line.

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
  // ---- Voidling raid zones, remaining two (research §2) ----------------------------------------
  // "Master Yael" is confirmed from the owner's own log; the rest are eqlsource-surveyed.
  "The Ruins of Old Paineel": {
    shortName: 'hole',
    respawns: false,
    nameds: [
      { name: 'Master Yael', tier: 'boss' },
      { name: 'Nortlav the Scalekeeper', tier: 'boss' }, // "always up beside Master Yael" - part of the encounter
      { name: 'Mummy of Glohnor', tier: 'mini' },
      { name: 'Keeper of the Tombs', tier: 'mini' },
      { name: 'Caradon', tier: 'mini' },
      { name: 'Dartain the Lost', tier: 'mini' },
      { name: 'Slizik the Mighty', tier: 'mini' },
      { name: 'Schnozz the Flighty', tier: 'mini' },
      { name: 'Jaeil the Wretched', tier: 'mini' },
      { name: 'Jaeil the Insane', tier: 'lesser' },
      { name: 'Polzin Mrid', tier: 'mini' },
      { name: 'Kyrenna', tier: 'mini' },
      { name: 'Commander Yarik', tier: 'mini' },
      { name: 'Ulrik the Devout', tier: 'mini' },
      { name: 'Kejar the Mighty', tier: 'lesser' },
      { name: 'Initiate Sirlis', tier: 'lesser' },
      { name: 'High Scale Kirn', tier: 'lesser' },
      { name: 'Niltoth the Unholy', tier: 'lesser' },
      { name: 'Irslak the Wretched', tier: 'lesser' },
      { name: 'The Stone Caller', tier: 'lesser' },
    ],
  },
  "Kedge Keep": {
    shortName: 'kedge',
    respawns: false,
    nameds: [
      { name: 'Phinigel Autropos', tier: 'boss' }, // long-established raid boss name; not yet in a kill line here
      { name: 'Cauldronbubble', tier: 'lesser' },
      { name: 'Cauldronboil', tier: 'lesser' },
      { name: 'Coralyn Kelpmaiden', tier: 'lesser' },
      { name: 'Estrella of Gloomwater', tier: 'lesser' },
      { name: 'Ferocious Hammerhead', tier: 'lesser' },
      { name: 'Fierce Impaler', tier: 'lesser' },
      { name: 'Golden Haired Mermaid', tier: 'lesser' },
      { name: 'Seahorse Matriarch', tier: 'lesser' },
      { name: 'Seahorse Patriarch', tier: 'lesser' },
      { name: 'Shellara Ebbhunter', tier: 'lesser' },
      { name: 'Undertow', tier: 'lesser' },
    ],
  },

  // ---- Instanced dungeons (research §3) - fresh instance = fresh board, so respawns:false -------
  "The Castle of Mistmoore": {
    shortName: 'mistmoore',
    respawns: false,
    nameds: [
      { name: 'Ssynthi', tier: 'boss' },
      { name: 'Xicotl', tier: 'boss' },            // log-confirmed
      { name: 'Princess Cherista', tier: 'boss' }, // log-confirmed
      { name: 'an advisor', tier: 'boss' },        // on death spawns Black Dire
      { name: 'Black Dire', tier: 'boss' },
      { name: 'Dark Huntress', tier: 'boss' },
      { name: 'an avenging caitiff', tier: 'mini' },
      { name: 'an undead knight', tier: 'mini' },
      { name: 'a glyphed ghoul', tier: 'mini' },
      { name: 'Garton Viswin', tier: 'mini' },
      { name: 'a hemo enologist', tier: 'mini' },  // log-confirmed
      { name: 'a dark librarian', tier: 'mini' },  // log-confirmed
      { name: "a dark ass't librarian", tier: 'mini' }, // "ass't" per eqlsource - unverified literal
      { name: 'Lasna Cheroon', tier: 'mini' },     // log-confirmed
      { name: 'a cloaked dhampyre', tier: 'mini' },// log-confirmed
      { name: 'Mynthi Davissi', tier: 'mini' },    // log-confirmed
      { name: 'Maid Issis', tier: 'mini' },        // log-confirmed
      { name: 'a dark elf noble', tier: 'mini' },
      { name: 'Butler Syncall', tier: 'mini' },    // log-confirmed
      { name: 'an imp familiar', tier: 'lesser' },
      { name: 'a Fallen Noble', tier: 'lesser' },
      { name: 'Enynti', tier: 'lesser' },          // log-confirmed
    ],
  },
  "The Ruins of Old Guk": {
    shortName: 'gukbottom',
    respawns: false,
    nameds: [
      { name: 'the froglok king', tier: 'boss' },
      { name: 'the ghoul lord', tier: 'boss' },
      { name: 'Raster of Guk', tier: 'boss' },
      { name: 'the ghoul arch magi', tier: 'mini' },
      { name: 'a froglok tactician', tier: 'mini' },
      { name: 'a froglok herbalist', tier: 'mini' },
      { name: 'a froglok crusader', tier: 'mini' },
      { name: 'a froglok noble', tier: 'mini' },
      { name: 'a froglok yun priest', tier: 'mini' },
      { name: 'a huge water elemental', tier: 'mini' },
      { name: 'an evil eye', tier: 'mini' },
      { name: 'a minotaur patriarch', tier: 'mini' },
      { name: 'a minotaur elder', tier: 'mini' },
      { name: 'Slaythe the Slayer', tier: 'lesser' },
      { name: 'a ghoul sentinel', tier: 'mini' },
      { name: 'a frenzied ghoul', tier: 'mini' },
      { name: 'a reanimated hand', tier: 'mini' },
      { name: 'a ghoul sage', tier: 'mini' },
      { name: 'a ghoul cavalier', tier: 'mini' },
      { name: 'a ghoul supplier', tier: 'mini' },
      { name: 'a ghoul assassin', tier: 'mini' },
      { name: 'a ghoul executioner', tier: 'mini' },
      { name: 'a ghoul savant', tier: 'mini' },
      { name: 'a ghoul scribe', tier: 'mini' },
      { name: 'a ghoul ritualist', tier: 'mini' },
    ],
  },
  "Clan Crushbone": {
    shortName: 'crushbone',
    respawns: false,
    nameds: [
      { name: 'Emperor Crush', tier: 'boss' },
      { name: 'Ambassador DVinn', tier: 'boss' }, // eqlsource spelling; classic "D`Vinn" - VERIFY
      { name: 'Marrowbane', tier: 'mini' },
      { name: 'Chokehold', tier: 'mini' },
      { name: 'Bloodgurgler', tier: 'mini' },
      { name: 'Bonefire', tier: 'mini' },
      { name: 'The Prophet', tier: 'mini' },
      { name: 'Orc Warlord', tier: 'mini' },
      { name: 'Retlon Brenclog', tier: 'mini' },
      { name: 'Lord Darish', tier: 'mini' },
      { name: 'Orc Warden', tier: 'mini' },
      { name: 'Orc Emissary', tier: 'mini' },
      { name: 'Royal Guard', tier: 'mini' },
      { name: 'Orc oracle', tier: 'mini' },
      { name: 'Orc Trainer', tier: 'lesser' },
      { name: 'Orc Taskmaster', tier: 'lesser' },
      { name: 'Rondo Dunfire', tier: 'lesser' },
      { name: 'Kelynn', tier: 'lesser' },
      { name: 'Orc Scoutsman', tier: 'lesser' },
    ],
  },
  "Befallen": {
    shortName: 'befallen',
    respawns: false,
    nameds: [
      { name: 'Baron Telyx V`Zher', tier: 'boss' },
      { name: 'Cmdr Windstream', tier: 'boss' }, // "Cmdr" abbreviated per eqlsource - VERIFY literal
      { name: 'Boondin Babbinsbort', tier: 'mini' },
      { name: 'Skeleton L`rodd', tier: 'lesser' },
      { name: 'Gynok Moltor', tier: 'lesser' },
      { name: 'Asaka L`Rei', tier: 'lesser' },
      { name: 'Arisen Thaumaturgist', tier: 'lesser' },
      { name: 'The Thaumaturgist', tier: 'lesser' },
      { name: 'Priest Amiaz', tier: 'lesser' },
      { name: 'a Necro Theurgist', tier: 'lesser' },
      { name: 'Footman of V`Zher', tier: 'lesser' },
      { name: 'an Elf Skeleton', tier: 'lesser' },
      { name: 'Kahaptra Z`Taj', tier: 'lesser' },
      { name: 'Korven Nisere', tier: 'lesser' },
      { name: 'Soldier of V`Zher', tier: 'lesser' },
      { name: 'Knight V`Tal', tier: 'lesser' },
    ],
  },
  "Blackburrow": {
    shortName: 'blackburrow',
    respawns: false, // instanced on EQL
    nameds: [
      { name: 'Lord Elgnub', tier: 'boss', respawnMinutes: 22 },
      { name: 'Sabertooth Overseer', tier: 'mini', respawnMinutes: 22 },
      { name: 'Splitpaw Sharpshooter', tier: 'mini', respawnMinutes: 22 },
      { name: 'Master Brewer', tier: 'mini', respawnMinutes: 22 },
      { name: 'Splitpaw Explorer', tier: 'mini', respawnMinutes: 22 },
      { name: 'Mannan of the Sabertooth', tier: 'lesser', respawnMinutes: 22 },
      { name: 'the gnoll high shaman', tier: 'lesser', respawnMinutes: 22 },
      { name: 'Sabertooth Clan Necromancer', tier: 'lesser', respawnMinutes: 22 },
      { name: 'Splitpaw Commander', tier: 'lesser', respawnMinutes: 22 },
      { name: 'a gnoll commander', tier: 'lesser', respawnMinutes: 22 },
      { name: 'a Gnoll Tactician', tier: 'lesser', respawnMinutes: 22 },
      { name: 'Socho Darkpaw', tier: 'lesser', respawnMinutes: 22 },
      { name: 'Splitpaw Sentry', tier: 'lesser', respawnMinutes: 22 },
      { name: 'Tranixx Darkpaw', tier: 'lesser', respawnMinutes: 22 },
    ],
  },

  // ---- Persistent open-world zones (research §3) - respawns:true, per-named countdowns ----------
  "Najena": {
    shortName: 'najena',
    respawns: true,
    nameds: [
      { name: 'Najena', tier: 'boss', respawnMinutes: 19 },
      { name: 'The Widowmistress', tier: 'mini' },
      { name: 'Akksstaff', tier: 'mini' },
      { name: 'Rathyl', tier: 'mini', respawnMinutes: 19 },
      { name: 'Drelzna', tier: 'mini' },
      { name: 'The guard captain', tier: 'mini' },
      { name: 'The Blood Artist', tier: 'lesser' },
      { name: 'Ekeros', tier: 'lesser' },
      { name: 'A Visiting Priestess', tier: 'lesser' },
      { name: 'Lost Crusader', tier: 'lesser' },
      { name: 'Unbound Flame', tier: 'lesser' },
      { name: 'BoneCracker', tier: 'lesser' },
      { name: 'Officer Grush', tier: 'lesser' },
      { name: 'Trazdon', tier: 'lesser' },
      { name: 'The Tenderizer', tier: 'lesser' },
      { name: 'Moosh', tier: 'lesser' },
    ],
  },
  "The Lair of the Splitpaw": {
    shortName: 'paw',
    respawns: true,
    nameds: [
      { name: 'The Ishva Mal', tier: 'boss', respawnMinutes: 28 },
      { name: 'Tesch Val Deval`Nmak', tier: 'boss' },
      { name: "Rosch Val L'Vlor", tier: 'boss' }, // eqlsource renders this one with a straight apostrophe - VERIFY
      { name: 'Nisch Val Torash Mashk', tier: 'boss' },
      { name: 'Tesch Val Kadvem', tier: 'mini' },
      { name: 'a Nisch Val Guard', tier: 'mini' },
      { name: 'a one eyed gnoll', tier: 'mini' },
      { name: 'Verishe Mal Executioner', tier: 'mini' },
      { name: 'Verishe Mal Judge', tier: 'mini' },
      { name: 'a Rosch Mal Gnoll', tier: 'lesser' },
      { name: 'a gaduladian widemouth', tier: 'lesser' },
      { name: 'a Lteth Val Scribe', tier: 'lesser' },
      { name: 'Kurrpok Splitpaw', tier: 'lesser' },
      { name: 'Brother Hayle', tier: 'lesser' },
      { name: 'Brother Gruff', tier: 'lesser' },
    ],
  },
  "The Warrens": {
    shortName: 'warrens',
    respawns: true,
    nameds: [
      { name: 'King Gragnar', tier: 'boss', respawnMinutes: 48 },
      { name: 'The Muglwump', tier: 'boss', respawnMinutes: 35 },
      { name: 'Prince Bragnar', tier: 'mini', respawnMinutes: 57 },
      { name: 'Lorekeeper Roggik', tier: 'mini', respawnMinutes: 48 },
      { name: 'High Shaman Drogik', tier: 'mini', respawnMinutes: 48 },
      { name: 'Cave Bat Lord', tier: 'mini', respawnMinutes: 48 },
      { name: 'Huntmaster Furgrl', tier: 'mini', respawnMinutes: 48 },
      { name: 'Smithy Rrarrgin', tier: 'mini', respawnMinutes: 20 },
      { name: 'Foodmaster Rargnar', tier: 'mini', respawnMinutes: 20 },
      { name: 'Packmaster Dledsh', tier: 'mini', respawnMinutes: 16 },
      { name: 'Warlord Drrig', tier: 'mini' },
      { name: 'Krode the Diviner', tier: 'mini' },
      { name: 'Grodl Ripclaw', tier: 'mini' },
      { name: 'The Mighty Bear Paw', tier: 'mini' },
      { name: 'Trainer Daxgrr', tier: 'lesser', respawnMinutes: 20 },
      { name: 'Jailer Mkrarrg', tier: 'lesser' },
      { name: 'An Erudite Prisoner', tier: 'lesser' },
      { name: 'Aderius Rhenar', tier: 'lesser' },
      { name: 'Koajin', tier: 'lesser' },
    ],
  },
};

// EQL uses more than one zone string for Permafrost ("Permafrost Keep" and "The Permafrost
// Caverns" both appear in the owner's logs). Alias the second to the same board rather than
// duplicating the list.
RAID_ZONE_NAMEDS['The Permafrost Caverns'] = RAID_ZONE_NAMEDS['Permafrost Keep'];

module.exports = { RAID_ZONE_NAMEDS };
