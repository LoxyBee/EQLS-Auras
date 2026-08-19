const { getBardOnlyNames } = require('./gameSpellData');

// Tags the buff roster's `isBardSong` flags straight from the game's own
// spell data, instead of waiting to observe a "You begin singing X." line
// for each song individually.
//
// Why this exists: `buffStore.markBardSong()` only ever fires from that
// singing-verb cast line, one spell at a time, for spells the player
// personally sings while the app is running. That left the live roster with
// literally 1 of 11,337 entries tagged - so "Hide bard songs" looked broken
// (it filtered correctly, there was just nothing tagged to filter). The game
// data knows the answer for all ~1,549 of them up front.
//
// Detection rule (a spell only the Bard class can cast) and the field
// positions it depends on live in gameSpellData.js, which owns the single
// shared parse of spells_us.txt. Verified empirically against the user's own
// file before being wired in: Selo's Accelerating Chorus / Vilia's Verses of
// Celerity / Amplification / Selo's Accelerando all came back bard-only,
// while Talisman of Altuna (Shm/Bst) and Resolution (Clr/Pal) correctly did
// not.
//
// Deliberately additive-only, mirroring markBardSong: this never sets a flag
// back to false. The Known Buffs list has a manual two-way override
// (`buffStore.setBardSong`) and a user's explicit correction there shouldn't
// be silently reverted every launch by this.

// Returns how many roster entries were newly tagged (0 if nothing changed,
// null if the spell data couldn't be read at all). Saves at most once.
function tagBardSongs(installRoot, buffStore) {
  const songNames = getBardOnlyNames(installRoot);
  if (!songNames) return null;

  let tagged = 0;
  for (const entry of buffStore.buffs) {
    if (entry.isBardSong) continue;
    if (songNames.has(entry.name.toLowerCase())) {
      entry.isBardSong = true;
      tagged++;
    }
  }
  if (tagged > 0) buffStore._save();
  return tagged;
}

module.exports = { tagBardSongs };
