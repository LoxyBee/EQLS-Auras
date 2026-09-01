'use strict';
/**
 * Who is in the player's group, and who has been.
 *
 * The damage meter's "just my group" scope needs a name list to filter against, and the owner's
 * requirement is specific: a row is counted ONLY if it is the player or someone who has been in the
 * group this session - non-group damage is not "picked up" at all, not merely hidden. So two sets:
 *
 *   members  - in the group RIGHT NOW. Kept because it is real information, but the filter does not
 *              use it: someone who steps out for a fight and comes back should not blink off the
 *              meter mid-pull.
 *   admitted - anyone who has been in the group since the last time the PLAYER joined or left one.
 *              This is what the "group" scope filters on. It survives a member leaving; it is wiped
 *              only when the player themselves joins a fresh group or is removed from theirs.
 *
 * Fed off the same line bus as everything else. It reuses buffParser's group matchers rather than
 * re-deriving the wordings (gotcha #7 has the confirmed shapes and the reason matchGroupJoinAccepted
 * exists at all - joining a group that already has members produces no per-member "joined" line, so
 * the one name the log does give us, the inviter's, is the best available).
 *
 * Names are stored lowercased because the damage lines they are matched against are (damageEngine
 * lowercases every attacker for the same article-casing reason).
 */

const {
  matchGroupMemberJoined,
  matchGroupMemberLeft,
  matchGroupJoinAccepted,
  isPartyChangeLine,
  stripTimestamp,
} = require('./buffParser');

const SELF_JOINED = /^You have joined the group\.$/;
const SELF_REMOVED = /^You have been removed from the group\.$/;

class GroupRoster {
  constructor() {
    this.members = new Set(); // lowercased, in group now
    this.admitted = new Set(); // lowercased, in group at some point this membership
  }

  // Wiped when the PLAYER's own membership changes - a new group is a new roster.
  _reset() {
    this.members.clear();
    this.admitted.clear();
  }

  _add(name) {
    if (!name) return;
    const key = String(name).toLowerCase();
    this.members.add(key);
    this.admitted.add(key);
  }

  handleLine(line) {
    if (typeof line !== 'string') return;
    const stripped = stripTimestamp(line);

    if (SELF_JOINED.test(stripped) || SELF_REMOVED.test(stripped)) {
      this._reset();
      return;
    }

    // "You notify <Name> that you agree to join the group." - the one line naming a member when the
    // player joins a group that already had members. It is NOT one of isPartyChangeLine's shapes,
    // so it is checked before that gate. Its wording ("You notify ...") cannot be produced by
    // ordinary chat about someone else.
    const accepted = matchGroupJoinAccepted(line);
    if (accepted) {
      this._add(accepted);
      return;
    }

    // Only touch the sets for lines that are actually party changes - keeps an ordinary chat line
    // that happens to end "has joined the group." (quoted in /tell, say, ...) from seeding a name.
    if (!isPartyChangeLine(line)) return;

    const joined = matchGroupMemberJoined(line);
    if (joined) {
      this._add(joined);
      return;
    }
    const left = matchGroupMemberLeft(line);
    if (left) {
      this.members.delete(String(left).toLowerCase());
      // Deliberately NOT removed from `admitted` - their damage from earlier in the session still
      // counts, and the owner wants someone who rejoins not to have vanished in between.
      return;
    }
  }

  // The name list the "group" damage scope filters on. Always includes 'you'/'yourself' shapes via
  // damageEngine's own friend seed, so callers only need to check membership of a non-self name.
  isAdmitted(name) {
    return this.admitted.has(String(name || '').toLowerCase());
  }

  getMembers() {
    return [...this.members];
  }

  getAdmitted() {
    return [...this.admitted];
  }
}

module.exports = { GroupRoster };
