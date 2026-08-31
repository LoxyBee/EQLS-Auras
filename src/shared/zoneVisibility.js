'use strict';
/**
 * Whether an aura is allowed to be on screen in the zone the player is in - note 38.
 *
 * IN ITS OWN MODULE, with no Electron in it, so a test can call THIS FUNCTION rather than a copy
 * of it. Four times in this project a suite has been written against a reproduced copy of a rule
 * living inside widgetManager, and four times the copy passed while the real one was broken -
 * inverted comparisons and flipped defaults that no test noticed. The rule here is three lines and
 * carries the whole safety argument, so it is the last one that should be tested by lookalike.
 */

/**
 * @param {string[]} visibleInZones  zone names the aura is limited to. EMPTY MEANS EVERYWHERE.
 * @param {string|null} currentZone  where the player is, or null if the app has not been told.
 */
function isVisibleInZone(visibleInZones, currentZone) {
  const zones = visibleInZones || [];

  // Not gated at all. Checked first so an ordinary aura never consults the zone for any reason.
  if (!zones.length) return true;

  // The app does not know where the player is, and that is the NORMAL state after a restart: the
  // only line naming a zone is the one printed on a zone change. Measured across the owner's logs,
  // the expected wait for that line from a random start is about 55 minutes of active play, with a
  // five-hour case.
  //
  // So unknown means SHOW. The two errors are not symmetric. Showing an aura in a zone she did not
  // ask for is visible, attributable, and fixes itself the moment she zones. Hiding one she did
  // ask for is invisible, lasts a session, and the app cannot even explain it, because it does not
  // know where she is. Silent invisibility is this project's recurring failure; loud wrongness is
  // not.
  if (!currentZone) return true;

  // Exact string match, no collapsing. the owner, 22 August: "make them separate". "Befallen" and
  // "Befallen 1 (Awakened)" are different places, and so are "The Plane of Fear" and "The Plane of
  // Fear - Group". A prefix or base-name match here would quietly merge all four Befallens.
  return zones.includes(currentZone);
}

module.exports = { isVisibleInZone };
