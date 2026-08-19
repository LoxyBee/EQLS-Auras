const { getBardSongRecords } = require('./gameSpellData');

// Adds bard songs the roster's original mining filter dropped.
//
// The mining kept only spells whose duration field (field 12) is greater than
// zero. That is wrong for bard songs specifically: of the 1,550 bard-only
// spells in the game data, 386 carry a duration of 0 there and were therefore
// excluded wholesale - including real, castable, currently-sung songs like
// Cassindra's Chant of Clarity. Those spells still land, still show flavour
// text, and still need tracking.
//
// The damage from leaving them out isn't only "song missing from the list".
// A missing entry makes the app believe a landing text is UNIQUE when the
// game data says it is shared, which promotes a guess into the highest-
// confidence auto-confirm tier. Confirmed live: `Brilliance` and
// `Cassindra's Chant of Clarity` both land with "Your mind clears.", and with
// only Brilliance in the roster every sung Chant of Clarity was being
// confidently logged as Brilliance. Backfilling the song fixes that as a side
// effect, by making the text correctly ambiguous again.
//
// Deliberately scoped to bard songs, not the whole ~37k-entry roster gap: the
// duration question has a defensible answer here (see BARD_SONG_FALLBACK_SEC)
// and the set is bounded and checkable. The broader gap - non-song buffs like
// Armor of Protection that were dropped the same way - is still open and
// needs its own decision, since there is no safe blanket duration for it.
//
// Never overwrites an existing roster entry: a user may have corrected a
// duration or landing text by hand via the Known Buffs UI, and this runs on
// every launch.

// 828 of the 1,164 bard songs that DO carry a duration use 2 ticks (12s) -
// by far the modal value, and the right order of magnitude for a song that
// re-lands on every pulse while being sung. Used only for songs whose game
// data gives no duration at all; anything with a real duration keeps it.
const BARD_SONG_FALLBACK_SEC = 12;

// Returns how many entries were added (0 if none, null if the spell data
// couldn't be read). Saves at most once.
function backfillBardSongs(installRoot, buffStore) {
  const songs = getBardSongRecords(installRoot);
  if (!songs) return null;

  const existing = new Set(buffStore.buffs.map((b) => b.name.toLowerCase()));
  let added = 0;

  for (const song of songs) {
    // Exact name match only. Rank variants of a spell already in the roster
    // ARE added deliberately - they're real, separately-castable tiers and
    // the user wants them tracked. The ambiguity that creates (several ranks
    // sharing one landing text) is resolved in buffEngine by collapsing to
    // the lowest rank rather than by keeping them out of the roster.
    if (existing.has(song.name.toLowerCase())) continue;
    // Without landing text there is nothing for the engine to match on, so an
    // entry would be inert clutter in the Known Buffs list.
    if (!song.landingText) continue;

    buffStore.buffs.push({
      name: song.name,
      durationSec: song.durationSec > 0 ? song.durationSec : BARD_SONG_FALLBACK_SEC,
      landingText: song.landingText,
      endedText: song.endedText || undefined,
      iconId: song.iconId != null ? song.iconId : undefined,
      isBardSong: true,
      // Songs are opt-in on the overlay now (see the hideBardSongs default in
      // widgetStore.js), so these arriving en masse can't suddenly flood
      // anyone's Self Buffs list. showOnOverlay stays true so that ticking
      // "Show bard songs" actually surfaces them.
      showOnOverlay: true,
      // Marks these as machine-added so a future re-mine or cleanup can tell
      // them apart from entries the user created or edited by hand.
      autoSeeded: true,
    });
    existing.add(song.name.toLowerCase());
    added++;
  }

  if (added > 0) buffStore._save();
  return added;
}

module.exports = { backfillBardSongs };
