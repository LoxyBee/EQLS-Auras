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

// Content-type classification for the "Raid"/"Group" aura filters, alongside the specific-zone
// list. Same signal raidNamedTracker.js uses for its own raid-lockout-instance call (see that
// file's GROUP_INSTANCE_RE comment, 13 Sep - confirmed against a full week of real logs): a zone
// name carrying " - Group" IS the raid-lockout instance, authoritative in both directions; a bare
// instance-tier suffix like "1 (Awakened)" with no "- Group" is an ordinary dungeon/group run, not
// raid content. No live "did she just hail the Voidling" state is needed - an earlier version of
// raidNamedTracker tried that and got both directions wrong (someone else forming the raid and
// inviting her in, or a reconnect landing back inside one, produced no hail of her own either
// time). Duplicated here rather than imported, same as loadoutLockedZones.js's own copy of the
// instance-suffix regex - this module stays dependency-free on purpose (see the header comment).
// Keep the regex shape in sync across all three if the log format ever changes.
const RAID_INSTANCE_RE = / - Group(?:\s|$)/;
const ANY_INSTANCE_SUFFIX_RE = / (?:- Group(?: \d+ \([^)]+\))?|\d+ \([^)]+\))\s*$/;

function isRaidContentZone(rawZone) {
  return RAID_INSTANCE_RE.test(String(rawZone || ''));
}

function isGroupContentZone(rawZone) {
  const z = String(rawZone || '');
  return ANY_INSTANCE_SUFFIX_RE.test(z) && !RAID_INSTANCE_RE.test(z);
}

/**
 * @param {string[]} visibleInZones  zone names the aura is limited to. EMPTY MEANS EVERYWHERE.
 * @param {string|null} currentZone  where the player is, or null if the app has not been told.
 * @param {{visibleInRaid?: boolean, visibleInGroup?: boolean}} [contentFilter]  additional
 *   content-type gates - an aura is visible if EITHER the exact zone list matches OR one of these
 *   does, same "shows in any of them" rule the zone list already follows on its own.
 */
function isVisibleInZone(visibleInZones, currentZone, contentFilter) {
  const zones = visibleInZones || [];
  const wantsRaid = !!(contentFilter && contentFilter.visibleInRaid);
  const wantsGroup = !!(contentFilter && contentFilter.visibleInGroup);

  // Not gated at all. Checked first so an ordinary aura never consults the zone for any reason.
  if (!zones.length && !wantsRaid && !wantsGroup) return true;

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
  if (zones.includes(currentZone)) return true;

  if (wantsRaid && isRaidContentZone(currentZone)) return true;
  if (wantsGroup && isGroupContentZone(currentZone)) return true;
  return false;
}

module.exports = { isVisibleInZone, isRaidContentZone, isGroupContentZone };
