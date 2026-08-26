'use strict';
/**
 * Zone names observed in the app owner's own logs - note 38.
 *
 * 66 distinct strings across 1,521,971 lines of play between 4 and 19 August 2026, read off the
 * only line that names a zone: "You have entered <Zone>."
 *
 * A SEED, not a list of every zone in the game. It exists because the alternative - learning
 * zones only as the player visits them - reads as broken for a long time: 21 of these 66 first
 * appeared on a single day, after two weeks of play. The zone picker offers these AND accepts
 * anything typed in, so a zone missing from here costs one line of typing rather than the
 * feature not working.
 *
 * Stored exactly as the game prints them, with no collapsing. "Befallen" and "Befallen 1
 * (Awakened)" are separate zones, and so are "The Plane of Fear" and "The Plane of Fear - Group"
 * - Shara, 22 August: "make them separate". They are genuinely different places.
 */

module.exports = [
  "Befallen",
  "Befallen 1 (Awakened)",
  "Befallen 3 (Fused)",
  "Befallen 4 (Refined)",
  "Blackburrow",
  "Blackburrow 1 (Awakened)",
  "Blackburrow 2 (Adaptive)",
  "Blackburrow 3 (Fused)",
  "Butcherblock Mountains",
  "Clan Crushbone",
  "Clan Crushbone 1 (Awakened)",
  "East Freeport",
  "Everfrost Peaks",
  "Halas",
  "Innothule Swamp",
  "Kerra Isle",
  "Nagafen's Lair",
  "Nagafen's Lair - Group 1 (Awakened)",
  "Nagafen's Lair 1 (Awakened)",
  "Nektulos Forest",
  "Northern Felwithe",
  "Paineel",
  "Permafrost Keep",
  "Qeynos Hills",
  "Solusek's Eye",
  "Southern Felwithe",
  "Surefall Glade",
  "Temple of Cazic-Thule",
  "Temple of Cazic-Thule 2 (Adaptive)",
  "Temple of Cazic-Thule 3 (Fused)",
  "Temple of Cazic-Thule 4 (Refined)",
  "The Castle of Mistmoore",
  "The Castle of Mistmoore 1 (Awakened)",
  "The Castle of Mistmoore 2 (Adaptive)",
  "The City of Guk",
  "The City of Guk 4 (Refined)",
  "The Feerrott",
  "The Greater Faydark",
  "The Lavastorm Mountains",
  "The Lesser Faydark",
  "The Northern Desert of Ro",
  "The Northern Plains of Karana",
  "The Oasis of Marr",
  "The Permafrost Caverns - Group",
  "The Plane of Fear",
  "The Plane of Fear - Group",
  "The Plane of Fear - Group 3 (Fused)",
  "The Plane of Fear 1 (Awakened)",
  "The Plane of Sky",
  "The Rathe Mountains",
  "The Rathe Mountains 3 (Fused)",
  "The Ruins of Old Guk",
  "The Ruins of Old Guk 1 (Awakened)",
  "The Ruins of Old Paineel",
  "The Ruins of Old Paineel - Group",
  "The Ruins of Old Paineel - Group 1 (Awakened)",
  "The Ruins of Old Paineel - Group 2 (Adaptive)",
  "The Ruins of Old Paineel - Group 3 (Fused)",
  "The Ruins of Old Paineel - Group 4 (Refined)",
  "The Ruins of Old Paineel 1 (Awakened)",
  "The Southern Desert of Ro",
  "The Steamfont Mountains",
  "The Stonebrunt Mountains",
  "The Western Plains of Karana",
  "Toxxulia Forest",
  "West Commonlands",
];
