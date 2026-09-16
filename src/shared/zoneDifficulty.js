'use strict';

// Extracts a raid/group instance's difficulty tier from the raw zone string EQ gives on entry,
// for DISPLAY purposes (owner, 14 Sep: "let's make all raid entries include their difficulty
// level (d0, d4, etc etc)"). Confirmed against the owner's own real logs - "The Permafrost
// Caverns" alone has FIVE distinct instance strings: "- Group" (the base tier), "- Group 1
// (Awakened)", "- Group 2 (Adaptive)", "- Group 3 (Fused)", "- Group 4 (Refined)" - five real,
// different instances, not five accidental splits of the same one; without a label they were
// indistinguishable in the Combat tab's fight list.
//
// Same suffix shapes INSTANCE_SUFFIX (loadoutLockedZones.js) already recognises structurally
// (kept in sync with it); this one pulls out the actual tier NUMBER instead of just detecting
// that an instance suffix exists at all. A bare "- Group" (or a bare "<zone> (<name>)" with no
// digit) is the base tier, d0. A zone with no instance suffix at all (not a private instance) has
// no difficulty - returns null, so an ordinary open-world zone never grows a "(d0)" it doesn't
// need.
const DIFFICULTY_SUFFIX = / (?:- Group(?: (\d+) \([^)]+\))?|(\d+) \([^)]+\))\s*$/;

function difficultyLabel(rawZone) {
  const z = String(rawZone || '');
  const m = DIFFICULTY_SUFFIX.exec(z);
  if (!m) return null;
  const n = m[1] || m[2];
  return `d${n || 0}`;
}

// Owner, 14 Sep: "there needs to be an identifier for (group) /raid instance" - a difficulty tier
// alone doesn't say whether that visit was the raid-lockout instance or an ordinary group run of
// the SAME zone; per raidNamedTracker.js's own confirmed-against-a-full-week-of-real-logs finding,
// the raw zone string's OWN suffix shape is the tell: a " - Group" suffix IS the raid-lockout
// instance, a bare "N (Name)" suffix with no "- Group" prefix is a plain group run. Mirrors
// raidNamedTracker.js's `isGroupInstance`/`GROUP_INSTANCE_RE` (kept in sync with it rather than
// imported from it - `shared/` must not depend on `main/`). Returns null (not false) when the
// zone has no instance suffix at all, matching `difficultyLabel`'s own "not an instance" null.
const RAID_INSTANCE_RE = / - Group(?:\s|$)/;
const BARE_TIER_RE = / \d+ \([^)]+\)\s*$/;

function isRaidInstance(rawZone) {
  const z = String(rawZone || '');
  if (RAID_INSTANCE_RE.test(z)) return true;
  if (BARE_TIER_RE.test(z)) return false;
  return null;
}

module.exports = { difficultyLabel, isRaidInstance };
