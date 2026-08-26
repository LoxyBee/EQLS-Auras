'use strict';
/**
 * Note 20 - which zones connect to which, and which spells land you where.
 *
 * The note was BLOCKED on exactly this: "a zone-connectivity map plus a table of which travel
 * spell lands you in which zone. Neither exists in the app, in buffs.json, or in the new
 * spreadsheet." Shara's answer was "set a research task with another agent, all this data is
 * available online, just go find it." It was, and this is it.
 *
 * WHERE IT CAME FROM, and how much of it is corroborated. EverQuest Legends is a custom server, so
 * the live-EQ zone layout cannot be assumed - which is why the primary source is EQL-specific:
 *
 *   - lab1702/eql-maps (data/zones.json) - a connection graph for EQL specifically: 77 launch
 *     zones, 84 undirected edges, each typed land, boat or portal. Single-author, so cross-checked.
 *   - ZlizEQMap's ZoneConnections.txt - keyed on CLIENT ZONE SHORT NAMES, which is the granularity
 *     the wikis lose (felwithea vs felwitheb, guktop vs gukbottom). 79 of the 84 edges confirmed.
 *   - eqlwiki.com and wiki.project1999.com, harvested through the MediaWiki API.
 *
 * One honesty note kept from the research rather than dropped: eqlwiki is largely a P99 fork -
 * identical prose, markup and typos, and it still carries Kunark and Velious pages EQL does not
 * have. "Both wikis agree" is therefore ONE source, not two, and the edges resting only on them
 * are marked so.
 *
 * THE JOIN KEY IS shortName, NOT the display string. The app's zone strings are EQL's in-game
 * wording and differ from every wiki: "The City of Guk" is Upper Guk, "The Ruins of Old Paineel"
 * is The Hole, "The Ruins of Old Guk" is Lower Guk, "Kerra Isle" is Kerra Island.
 *
 * 38 of the 104 entries have an INFERRED display name, flagged nameConfidence on
 * each. The player has never entered those zones, so their exact EQL string is a guess - usually
 * about a leading "The". They are not padding: Faydwer to Antonica routes through the Ocean of
 * Tears boat, and dropping unvisited zones would break real routes. Anything putting one of these
 * names in front of the user should expect it to be slightly wrong.
 *
 * Generated once from the research deliverable. Nothing regenerates it, so edits belong here.
 */

// Every zone, keyed by display name. Connections carry how you get there and who says so.
//   via     - 'land' | 'boat' | 'portal'
//   sources - which of the four agreed
//   coarse  - corroborated only at wiki granularity, never confirmed against a short name
const ZONES = {
  'Befallen': {
    shortName: 'befallen',
    connections: [
      { to: 'West Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Befallen 1 (Awakened)': {
    shortName: 'befallen',
    isInstanceVariantOf: 'Befallen',
    connections: [
      { to: 'West Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Befallen 3 (Fused)': {
    shortName: 'befallen',
    isInstanceVariantOf: 'Befallen',
    connections: [
      { to: 'West Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Befallen 4 (Refined)': {
    shortName: 'befallen',
    isInstanceVariantOf: 'Befallen',
    connections: [
      { to: 'West Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Blackburrow': {
    shortName: 'blackburrow',
    connections: [
      { to: 'Everfrost Peaks', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Qeynos Hills', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Blackburrow 1 (Awakened)': {
    shortName: 'blackburrow',
    isInstanceVariantOf: 'Blackburrow',
    connections: [
      { to: 'Everfrost Peaks', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Qeynos Hills', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Blackburrow 2 (Adaptive)': {
    shortName: 'blackburrow',
    isInstanceVariantOf: 'Blackburrow',
    connections: [
      { to: 'Everfrost Peaks', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Qeynos Hills', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Blackburrow 3 (Fused)': {
    shortName: 'blackburrow',
    isInstanceVariantOf: 'Blackburrow',
    connections: [
      { to: 'Everfrost Peaks', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Qeynos Hills', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Butcherblock Mountains': {
    shortName: 'butcher',
    connections: [
      { to: 'Dagnor\'s Cauldron', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'South Kaladim', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Greater Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Ocean of Tears', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Clan Crushbone': {
    shortName: 'crushbone',
    connections: [
      { to: 'The Greater Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Clan Crushbone 1 (Awakened)': {
    shortName: 'crushbone',
    isInstanceVariantOf: 'Clan Crushbone',
    connections: [
      { to: 'The Greater Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'East Freeport': {
    shortName: 'freporte',
    connections: [
      { to: 'North Freeport', via: 'land', sources: ['eql-maps only'] },
      { to: 'The Northern Desert of Ro', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Ocean of Tears', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Plane of Sky', via: 'portal', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'West Freeport', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'Everfrost Peaks': {
    shortName: 'everfrost',
    connections: [
      { to: 'Blackburrow', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Halas', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Permafrost Keep', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Halas': {
    shortName: 'halas',
    connections: [
      { to: 'Everfrost Peaks', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Innothule Swamp': {
    shortName: 'innothule',
    connections: [
      { to: 'Grobb', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The City of Guk', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Southern Desert of Ro', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Kerra Isle': {
    shortName: 'kerraridge',
    connections: [
      { to: 'Toxxulia Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Nagafen\'s Lair': {
    shortName: 'soldungb',
    connections: [
      { to: 'Solusek\'s Eye', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lavastorm Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Nagafen\'s Lair - Group 1 (Awakened)': {
    shortName: 'soldungb',
    isInstanceVariantOf: 'Nagafen\'s Lair',
    connections: [
      { to: 'Solusek\'s Eye', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lavastorm Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Nagafen\'s Lair 1 (Awakened)': {
    shortName: 'soldungb',
    isInstanceVariantOf: 'Nagafen\'s Lair',
    connections: [
      { to: 'Solusek\'s Eye', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lavastorm Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Nektulos Forest': {
    shortName: 'nektulos',
    connections: [
      { to: 'East Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Neriak - Foreign Quarter', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lavastorm Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Northern Felwithe': {
    shortName: 'felwithea',
    connections: [
      { to: 'Southern Felwithe', via: 'land', sources: ['zlizeqmap'] },
      { to: 'The Greater Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Paineel': {
    shortName: 'paineel',
    connections: [
      { to: 'The Ruins of Old Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Warrens', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Toxxulia Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Permafrost Keep': {
    shortName: 'permafrost',
    connections: [
      { to: 'Everfrost Peaks', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Qeynos Hills': {
    shortName: 'qeytoqrg',
    connections: [
      { to: 'Blackburrow', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'North Qeynos', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Surefall Glade', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Western Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Solusek\'s Eye': {
    shortName: 'soldunga',
    connections: [
      { to: 'Nagafen\'s Lair', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lavastorm Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Southern Felwithe': {
    shortName: 'felwitheb',
    connections: [
      { to: 'Northern Felwithe', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'Surefall Glade': {
    shortName: 'qrg',
    connections: [
      { to: 'Qeynos Hills', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Temple of Cazic-Thule': {
    shortName: 'cazicthule',
    connections: [
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Temple of Cazic-Thule 2 (Adaptive)': {
    shortName: 'cazicthule',
    isInstanceVariantOf: 'Temple of Cazic-Thule',
    connections: [
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Temple of Cazic-Thule 3 (Fused)': {
    shortName: 'cazicthule',
    isInstanceVariantOf: 'Temple of Cazic-Thule',
    connections: [
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Temple of Cazic-Thule 4 (Refined)': {
    shortName: 'cazicthule',
    isInstanceVariantOf: 'Temple of Cazic-Thule',
    connections: [
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Castle of Mistmoore': {
    shortName: 'mistmoore',
    connections: [
      { to: 'The Lesser Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Castle of Mistmoore 1 (Awakened)': {
    shortName: 'mistmoore',
    isInstanceVariantOf: 'The Castle of Mistmoore',
    connections: [
      { to: 'The Lesser Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Castle of Mistmoore 2 (Adaptive)': {
    shortName: 'mistmoore',
    isInstanceVariantOf: 'The Castle of Mistmoore',
    connections: [
      { to: 'The Lesser Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The City of Guk': {
    shortName: 'guktop',
    connections: [
      { to: 'Innothule Swamp', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Ruins of Old Guk', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The City of Guk 4 (Refined)': {
    shortName: 'guktop',
    isInstanceVariantOf: 'The City of Guk',
    connections: [
      { to: 'Innothule Swamp', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Ruins of Old Guk', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Feerrott': {
    shortName: 'feerrott',
    connections: [
      { to: 'Innothule Swamp', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Oggok', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Temple of Cazic-Thule', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Plane of Fear', via: 'portal', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Rathe Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Greater Faydark': {
    shortName: 'gfaydark',
    connections: [
      { to: 'Butcherblock Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Clan Crushbone', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Northern Felwithe', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lesser Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Lavastorm Mountains': {
    shortName: 'lavastorm',
    connections: [
      { to: 'Nagafen\'s Lair', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Najena', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Nektulos Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Solusek\'s Eye', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Temple of Solusek Ro', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Lesser Faydark': {
    shortName: 'lfaydark',
    connections: [
      { to: 'The Castle of Mistmoore', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Greater Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Steamfont Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Northern Desert of Ro': {
    shortName: 'nro',
    connections: [
      { to: 'East Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'East Freeport', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'New Sebilis Expedition', via: 'land', sources: ['eqlwiki'] },
      { to: 'The Oasis of Marr', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Northern Plains of Karana': {
    shortName: 'northkarana',
    connections: [
      { to: 'The Eastern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Southern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Western Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Oasis of Marr': {
    shortName: 'oasis',
    connections: [
      { to: 'The Northern Desert of Ro', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Plane of Hate', via: 'portal', sources: ['eqlwiki'] },
      { to: 'The Southern Desert of Ro', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Permafrost Caverns - Group': {
    shortName: 'permafrost',
    isInstanceVariantOf: 'The Permafrost Caverns',
    connections: [
      { to: 'Everfrost Peaks', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Plane of Fear': {
    shortName: 'fearplane',
    connections: [
      { to: 'The Feerrott', via: 'portal', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Plane of Fear - Group': {
    shortName: 'fearplane',
    isInstanceVariantOf: 'The Plane of Fear',
    connections: [
      { to: 'The Feerrott', via: 'portal', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Plane of Fear - Group 3 (Fused)': {
    shortName: 'fearplane',
    isInstanceVariantOf: 'The Plane of Fear',
    connections: [
      { to: 'The Feerrott', via: 'portal', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Plane of Fear 1 (Awakened)': {
    shortName: 'fearplane',
    isInstanceVariantOf: 'The Plane of Fear',
    connections: [
      { to: 'The Feerrott', via: 'portal', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Plane of Sky': {
    shortName: 'airplane',
    connections: [
      { to: 'East Freeport', via: 'portal', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Rathe Mountains': {
    shortName: 'rathemtn',
    connections: [
      { to: 'Lake Rathetear', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Rathe Mountains 3 (Fused)': {
    shortName: 'rathemtn',
    isInstanceVariantOf: 'The Rathe Mountains',
    connections: [
      { to: 'Lake Rathetear', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Guk': {
    shortName: 'gukbottom',
    connections: [
      { to: 'The City of Guk', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Guk 1 (Awakened)': {
    shortName: 'gukbottom',
    isInstanceVariantOf: 'The Ruins of Old Guk',
    connections: [
      { to: 'The City of Guk', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Paineel': {
    shortName: 'hole',
    connections: [
      { to: 'Erudin', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Neriak - 3rd Gate', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Paineel - Group': {
    shortName: 'hole',
    isInstanceVariantOf: 'The Ruins of Old Paineel',
    connections: [
      { to: 'Erudin', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Neriak - 3rd Gate', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Paineel - Group 1 (Awakened)': {
    shortName: 'hole',
    isInstanceVariantOf: 'The Ruins of Old Paineel',
    connections: [
      { to: 'Erudin', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Neriak - 3rd Gate', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Paineel - Group 2 (Adaptive)': {
    shortName: 'hole',
    isInstanceVariantOf: 'The Ruins of Old Paineel',
    connections: [
      { to: 'Erudin', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Neriak - 3rd Gate', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Paineel - Group 3 (Fused)': {
    shortName: 'hole',
    isInstanceVariantOf: 'The Ruins of Old Paineel',
    connections: [
      { to: 'Erudin', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Neriak - 3rd Gate', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Paineel - Group 4 (Refined)': {
    shortName: 'hole',
    isInstanceVariantOf: 'The Ruins of Old Paineel',
    connections: [
      { to: 'Erudin', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Neriak - 3rd Gate', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ruins of Old Paineel 1 (Awakened)': {
    shortName: 'hole',
    isInstanceVariantOf: 'The Ruins of Old Paineel',
    connections: [
      { to: 'Erudin', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Neriak - 3rd Gate', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Southern Desert of Ro': {
    shortName: 'sro',
    connections: [
      { to: 'Innothule Swamp', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Oasis of Marr', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Steamfont Mountains': {
    shortName: 'steamfont',
    connections: [
      { to: 'Ak\'Anon', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lesser Faydark', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Stonebrunt Mountains': {
    shortName: 'stonebrunt',
    connections: [
      { to: 'The Warrens', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Western Plains of Karana': {
    shortName: 'qey2hh1',
    connections: [
      { to: 'Qeynos Hills', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Northern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Toxxulia Forest': {
    shortName: 'toxxulia',
    connections: [
      { to: 'Erudin', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Kerra Isle', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'West Commonlands': {
    shortName: 'commons',
    connections: [
      { to: 'Befallen', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'East Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Kithicor Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'New Sebilis Expedition': {
    shortName: '__eql_newsebilis',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Northern Desert of Ro', via: 'land', sources: ['eqlwiki'] },
    ],
  },
  'Ak\'Anon': {
    shortName: 'akanon',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Steamfont Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Arena': {
    shortName: 'arena',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Lake Rathetear', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Gorge of King Xorbb': {
    shortName: 'beholder',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Clan RunnyEye', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Eastern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Dagnor\'s Cauldron': {
    shortName: 'cauldron',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Butcherblock Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Kedge Keep', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Estate of Unrest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Eastern Plains of Karana': {
    shortName: 'eastkarana',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Gorge of King Xorbb', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Highpass Hold', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Northern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'East Commonlands': {
    shortName: 'ecommons',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Nektulos Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Northern Desert of Ro', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'West Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'West Freeport', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Erudin Palace': {
    shortName: 'erudint',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Erudin', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'Erudin': {
    shortName: 'erudnext',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Erud\'s Crossing', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Erudin Palace', via: 'land', sources: ['zlizeqmap'] },
      { to: 'The Ruins of Old Paineel', via: 'portal', sources: ['eqlwiki', 'p99wiki'] },
      { to: 'Toxxulia Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Erud\'s Crossing': {
    shortName: 'erudsxing',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Erudin', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'South Qeynos', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'North Freeport': {
    shortName: 'freportn',
    nameConfidence: 'inferred',
    connections: [
      { to: 'East Freeport', via: 'land', sources: ['eql-maps only'] },
      { to: 'West Freeport', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'West Freeport': {
    shortName: 'freportw',
    nameConfidence: 'inferred',
    connections: [
      { to: 'East Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'East Freeport', via: 'land', sources: ['zlizeqmap'] },
      { to: 'North Freeport', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'Grobb': {
    shortName: 'grobb',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Innothule Swamp', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Plane of Hate': {
    shortName: 'hateplane',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Oasis of Marr', via: 'portal', sources: ['eqlwiki'] },
    ],
  },
  'High Keep': {
    shortName: 'highkeep',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Highpass Hold', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Highpass Hold': {
    shortName: 'highpass',
    nameConfidence: 'inferred',
    connections: [
      { to: 'High Keep', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Kithicor Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Eastern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'South Kaladim': {
    shortName: 'kaladima',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Butcherblock Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'North Kaladim', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'North Kaladim': {
    shortName: 'kaladimb',
    nameConfidence: 'inferred',
    connections: [
      { to: 'South Kaladim', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'Kedge Keep': {
    shortName: 'kedge',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Dagnor\'s Cauldron', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Kithicor Forest': {
    shortName: 'kithicor',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Highpass Hold', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Rivervale', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'West Commonlands', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Lake Rathetear': {
    shortName: 'lakerathe',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Arena', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Rathe Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Southern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Misty Thicket': {
    shortName: 'misty',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Clan RunnyEye', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Rivervale', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Najena': {
    shortName: 'najena',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Lavastorm Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Neriak - Foreign Quarter': {
    shortName: 'neriaka',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Nektulos Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Neriak - Commons', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'Neriak - Commons': {
    shortName: 'neriakb',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Neriak - 3rd Gate', via: 'land', sources: ['zlizeqmap'] },
      { to: 'Neriak - Foreign Quarter', via: 'land', sources: ['zlizeqmap'] },
    ],
  },
  'Neriak - 3rd Gate': {
    shortName: 'neriakc',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Neriak - Commons', via: 'land', sources: ['zlizeqmap'] },
      { to: 'The Ruins of Old Paineel', via: 'portal', sources: ['eqlwiki', 'p99wiki'], coarse: true },
    ],
  },
  'Oggok': {
    shortName: 'oggok',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Feerrott', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Ocean of Tears': {
    shortName: 'oot',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Butcherblock Mountains', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'East Freeport', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Lair of the Splitpaw': {
    shortName: 'paw',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Southern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Qeynos Aqueduct System': {
    shortName: 'qcat',
    nameConfidence: 'inferred',
    connections: [
      { to: 'North Qeynos', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'South Qeynos', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'South Qeynos': {
    shortName: 'qeynos',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Erud\'s Crossing', via: 'boat', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'North Qeynos', via: 'land', sources: ['zlizeqmap'] },
      { to: 'The Qeynos Aqueduct System', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'North Qeynos': {
    shortName: 'qeynos2',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Qeynos Hills', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'South Qeynos', via: 'land', sources: ['zlizeqmap'] },
      { to: 'The Qeynos Aqueduct System', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Rivervale': {
    shortName: 'rivervale',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Kithicor Forest', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Misty Thicket', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'Clan RunnyEye': {
    shortName: 'runnyeye',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Gorge of King Xorbb', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'Misty Thicket', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Temple of Solusek Ro': {
    shortName: 'soltemple',
    nameConfidence: 'inferred',
    connections: [
      { to: 'The Lavastorm Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Southern Plains of Karana': {
    shortName: 'southkarana',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Lake Rathetear', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Lair of the Splitpaw', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Northern Plains of Karana', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Estate of Unrest': {
    shortName: 'unrest',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Dagnor\'s Cauldron', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
  'The Warrens': {
    shortName: 'warrens',
    nameConfidence: 'inferred',
    connections: [
      { to: 'Paineel', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
      { to: 'The Stonebrunt Mountains', via: 'land', sources: ['zlizeqmap', 'eqlwiki', 'p99wiki'] },
    ],
  },
};

/**
 * Spells that move you to a NAMED place. Druid "Ring of X" and "Circle of X", wizard "X Gate",
 * "X Portal" and "Translocate: X", and the "Succor:" / "Evacuate: X" group teleports - the last
 * verified from per-spell effect slots, where "Succor: North Karana" reads "Evacuate group to
 * -2706,-1494,-4 in North Karana".
 */
const TRAVEL_SPELLS = [
  { spell: 'Alter Plane: Sky', destination: 'The Plane of Sky', targets: 'Group', classes: 'WIZ 46' },
  { spell: 'Circle of Butcherblock', destination: 'Butcherblock Mountains', targets: 'Group', classes: 'DRU 25' },
  { spell: 'Ring of Butcherblock', destination: 'Butcherblock Mountains', targets: 'Self', classes: 'DRU 16' },
  { spell: 'Succor: Butcherblock', destination: 'Butcherblock Mountains', targets: 'Group', classes: 'DRU 32' },
  { spell: 'Cazic Temple Gate', destination: 'Temple of Cazic-Thule', targets: 'Self', classes: 'WIZ 23' },
  { spell: 'Cazic Temple Portal', destination: 'Temple of Cazic-Thule', targets: 'Group', classes: 'WIZ 33' },
  { spell: 'Translocate: Cazic Temple', destination: 'Temple of Cazic-Thule', targets: 'Single', classes: 'WIZ 44' },
  { spell: 'Circle of West Commons', destination: 'West Commonlands', targets: 'Group', classes: 'DRU 27' },
  { spell: 'Ring of West Commons', destination: 'West Commonlands', targets: 'Self', classes: 'DRU 17' },
  { spell: 'Translocate: West Commons', destination: 'West Commonlands', targets: 'Single', classes: 'WIZ 40' },
  { spell: 'West Commons Gate', destination: 'West Commonlands', targets: 'Self', classes: 'WIZ 21' },
  { spell: 'West Commons Portal', destination: 'West Commonlands', targets: 'Group', classes: 'WIZ 35' },
  { spell: 'Succor: East Karana', destination: 'The Eastern Plains of Karana', targets: 'Group', classes: 'DRU 26' },
  { spell: 'Circle of Feerrott', destination: 'The Feerrott', targets: 'Group', classes: 'DRU 32' },
  { spell: 'Ring of Feerrott', destination: 'The Feerrott', targets: 'Self', classes: 'DRU 22' },
  { spell: 'Evacuate: Greater Faydark', destination: 'The Greater Faydark', targets: 'Group', classes: 'WIZ 32' },
  { spell: 'Greater Faydark Gate', destination: 'The Greater Faydark', targets: 'Self', classes: 'WIZ 20' },
  { spell: 'Greater Faydark Portal', destination: 'The Greater Faydark', targets: 'Group', classes: 'WIZ 27' },
  { spell: 'Translocate: Greater Faydark', destination: 'The Greater Faydark', targets: 'Single', classes: 'WIZ 36' },
  { spell: 'Alter Plane: Hate', destination: 'The Plane of Hate', targets: 'Group', classes: 'WIZ 46' },
  { spell: 'Circle of Lavastorm', destination: 'The Lavastorm Mountains', targets: 'Group', classes: 'DRU 30' },
  { spell: 'Ring of Lavastorm', destination: 'The Lavastorm Mountains', targets: 'Self', classes: 'DRU 22' },
  { spell: 'Succor: Lavastorm', destination: 'The Lavastorm Mountains', targets: 'Group', classes: 'DRU 41' },
  { spell: 'Circle of Misty Thicket', destination: 'Misty Thicket', targets: 'Group', classes: 'DRU 36' },
  { spell: 'Ring of Misty Thicket', destination: 'Misty Thicket', targets: 'Self', classes: 'DRU 25' },
  { spell: 'Evacuate: Nektulos', destination: 'Nektulos Forest', targets: 'Group', classes: 'WIZ 42' },
  { spell: 'Nektulos Gate', destination: 'Nektulos Forest', targets: 'Self', classes: 'WIZ 22' },
  { spell: 'Nektulos Portal', destination: 'Nektulos Forest', targets: 'Group', classes: 'WIZ 32' },
  { spell: 'Translocate: Nektulos', destination: 'Nektulos Forest', targets: 'Single', classes: 'WIZ 41' },
  { spell: 'Circle of North Karana', destination: 'The Northern Plains of Karana', targets: 'Group', classes: 'DRU 25' },
  { spell: 'Evacuate: North Karana', destination: 'The Northern Plains of Karana', targets: 'Group', classes: 'WIZ 26' },
  { spell: 'North Karana Gate', destination: 'The Northern Plains of Karana', targets: 'Self', classes: 'WIZ 18' },
  { spell: 'North Karana Portal', destination: 'The Northern Plains of Karana', targets: 'Group', classes: 'WIZ 25' },
  { spell: 'Ring of North Karana', destination: 'The Northern Plains of Karana', targets: 'Self', classes: 'DRU 15' },
  { spell: 'Succor: North Karana', destination: 'The Northern Plains of Karana', targets: 'Group', classes: 'DRU 46' },
  { spell: 'Translocate: North Karana', destination: 'The Northern Plains of Karana', targets: 'Single', classes: 'WIZ 35' },
  { spell: 'North Ro Gate', destination: 'The Northern Desert of Ro', targets: 'Self', classes: 'WIZ 22' },
  { spell: 'North Ro Portal', destination: 'The Northern Desert of Ro', targets: 'Group', classes: 'WIZ 36' },
  { spell: 'Translocate: North Ro', destination: 'The Northern Desert of Ro', targets: 'Single', classes: 'WIZ 43' },
  { spell: 'Evacuate: West Karana', destination: 'The Western Plains of Karana', targets: 'Group', classes: 'WIZ 47' },
  { spell: 'Translocate: West Karana', destination: 'The Western Plains of Karana', targets: 'Single', classes: 'WIZ 42' },
  { spell: 'West Karana Gate', destination: 'The Western Plains of Karana', targets: 'Self', classes: 'WIZ 23' },
  { spell: 'West Karana Portal', destination: 'The Western Plains of Karana', targets: 'Group', classes: 'WIZ 37' },
  { spell: 'Circle of Surefall Glade', destination: 'Surefall Glade', targets: 'Group', classes: 'DRU 26' },
  { spell: 'Ring of Surefall Glade', destination: 'Surefall Glade', targets: 'Self', classes: 'DRU 15' },
  { spell: 'Circle of South Ro', destination: 'The Southern Desert of Ro', targets: 'Group', classes: 'DRU 32' },
  { spell: 'Evacuate: South Ro', destination: 'The Southern Desert of Ro', targets: 'Group', classes: 'WIZ 38' },
  { spell: 'Ring of South Ro', destination: 'The Southern Desert of Ro', targets: 'Self', classes: 'DRU 20' },
  { spell: 'Succor: South Ro', destination: 'The Southern Desert of Ro', targets: 'Group', classes: 'DRU 38' },
  { spell: 'Circle of Steamfont', destination: 'The Steamfont Mountains', targets: 'Group', classes: 'DRU 31' },
  { spell: 'Ring of Steamfont', destination: 'The Steamfont Mountains', targets: 'Self', classes: 'DRU 21' },
  { spell: 'Circle of Stonebrunt', destination: 'The Stonebrunt Mountains', targets: 'Group', classes: 'DRU 28' },
  { spell: 'Ring of Stonebrunt', destination: 'The Stonebrunt Mountains', targets: 'Self', classes: 'DRU 20' },
  { spell: 'Stonebrunt Gate', destination: 'The Stonebrunt Mountains', targets: 'Self', classes: 'WIZ 21' },
  { spell: 'Stonebrunt Portal', destination: 'The Stonebrunt Mountains', targets: 'Group', classes: 'WIZ 27' },
  { spell: 'Translocate: Stonebrunt', destination: 'The Stonebrunt Mountains', targets: 'Single', classes: 'WIZ 35' },
  { spell: 'Circle of Toxxulia', destination: 'Toxxulia Forest', targets: 'Group', classes: 'DRU 25' },
  { spell: 'Ring of Toxxulia', destination: 'Toxxulia Forest', targets: 'Self', classes: 'DRU 17' },
  { spell: 'Toxxulia Gate', destination: 'Toxxulia Forest', targets: 'Self', classes: 'WIZ 19' },
  { spell: 'Toxxulia Portal', destination: 'Toxxulia Forest', targets: 'Group', classes: 'WIZ 28' },
  { spell: 'Translocate: Toxxulia', destination: 'Toxxulia Forest', targets: 'Single', classes: 'WIZ 37' },
];

// Four spells that LOOK like travel and are not, listed so nobody adds them back. The first two
// only move you within the zone you are already in; the last two go to your own bind point, which
// is per-character and in no dataset anywhere.
const NOT_TRAVEL_SPELLS = {
  'Lesser Succor': 'DRU 18 - group to a safe spot in the CURRENT zone. Not inter-zone travel.',
  'Lesser Evacuate': 'WIZ 18 - group to a safe spot in the CURRENT zone. Not inter-zone travel.',
  'Gate': 'All casters - self to own bind point. Destination is per-character, not a fixed zone.',
  'Translocate': 'WIZ 50 - single target to THEIR bind point. Destination is per-character.',
};

/**
 * Known caveats, carried from the research rather than quietly dropped:
 *   - 'Permafrost Keep' and 'The Permafrost Caverns - Group' are both mapped to zone short name 'permafrost'. They may be one place under two labels in EQL, or two. Unverified.
 *   - East Freeport <-> North Freeport is the single edge no independent source corroborates. ZlizEQMap lists North Freeport as connecting only to West Freeport. Plausible but unconfirmed.
 *   - Oasis of Marr -> Plane of Hate is an EverQuest Legends change. In classic EQ / P99 the Plane of Hate has no ground connection at all (wizard Alter Plane: Hate only). Direction is one-way in, per eqlwiki; modelled here as undirected. Verify before routing OUT of Plane of Hate.
 *   - The Hole <-> Erudin and The Hole <-> Neriak 3rd Gate are teleporters listed by both wikis but absent from ZlizEQMap's table.
 *   - Names for the 37 zones the player has never entered are inferred classic long names, not observed EQL strings. Do not display them as authoritative.
 */

module.exports = { ZONES, TRAVEL_SPELLS, NOT_TRAVEL_SPELLS };
