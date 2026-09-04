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
// "<Name> tells the group, '...'" (or the raid / party). Joining a group that already has members
// produces NO per-member "has joined" line for the ones already there (gotcha #7), and
// matchGroupJoinAccepted only names the ONE person you notified - so an existing member who never
// says anything is invisible. A member talking in group chat is unambiguous current membership.
// Reported live: Avenrae and Nocturis, in the group when Shara joined, never got their own damage
// meter rows - folded into "Other" - because nothing ever added them here. A single alphabetic
// word before the phrase, so quoted chat about the group can't seed a name.
const GROUP_TELL = /^([A-Za-z]+) tells the (?:group|raid|party), /;

// After a restart, a restored roster older than this is dropped rather than trusted - the app
// can't see what happened while it was closed (regroup, camp, relog).
const RESTORE_GRACE_MS = 20 * 60 * 1000;

class GroupRoster {
  constructor() {
    this.members = new Set(); // lowercased, in group now
    this.admitted = new Set(); // lowercased, in group at some point this membership
    this._persistFn = null;
    this._lastChangeAt = 0;
  }

  // Persist on every change so a mid-session restart doesn't blank the roster (the app never
  // replays log history, so a groupmate who joined before the restart would otherwise be treated
  // as an outsider on the damage meter). Same shape as abilityGroupTracker.
  setPersistFn(fn) {
    this._persistFn = typeof fn === 'function' ? fn : null;
  }

  _save() {
    this._lastChangeAt = Date.now();
    if (this._persistFn) {
      this._persistFn({ members: [...this.members], admitted: [...this.admitted], at: this._lastChangeAt });
    }
  }

  // For the session-restore registry (sessionRestore.js). Returns null when there's nothing worth
  // saving so the snapshot stays small.
  capture() {
    if (!this.members.size && !this.admitted.size) return null;
    return { members: [...this.members], admitted: [...this.admitted], at: this._lastChangeAt || Date.now() };
  }

  // Restore at startup. A stale snapshot (older than the grace window, or a backwards clock) is
  // ignored - better a blank roster the first group line refills than a wrong one. The registry
  // also gates on RESTORE_GRACE_MS; this internal check stays as the authority.
  restore(snap, now = Date.now()) {
    if (!snap || typeof snap !== 'object') return;
    const at = Number(snap.at) || 0;
    if (at <= 0 || at > now || now - at > RESTORE_GRACE_MS) return;
    for (const n of Array.isArray(snap.members) ? snap.members : []) this.members.add(String(n).toLowerCase());
    for (const n of Array.isArray(snap.admitted) ? snap.admitted : []) this.admitted.add(String(n).toLowerCase());
    this._lastChangeAt = at;
  }

  // Seed from a backward log scan (logGroupPeek) at startup, when the session-restore snapshot did
  // not supply a roster. Merges rather than replaces - if a live join line has already come in
  // since launch, it stays. Only meaningful before the first real group line; callers gate on
  // getAdmitted().length being 0.
  seed({ members, admitted } = {}) {
    let changed = false;
    for (const n of Array.isArray(members) ? members : []) {
      if (!this.members.has(String(n).toLowerCase())) { this.members.add(String(n).toLowerCase()); changed = true; }
    }
    for (const n of Array.isArray(admitted) ? admitted : []) {
      if (!this.admitted.has(String(n).toLowerCase())) { this.admitted.add(String(n).toLowerCase()); changed = true; }
    }
    if (changed) this._save();
    return changed;
  }

  // Wiped when the PLAYER's own membership changes - a new group is a new roster.
  _reset() {
    this.members.clear();
    this.admitted.clear();
    this._save();
  }

  _add(name) {
    if (!name) return;
    const key = String(name).toLowerCase();
    const before = this.members.size + this.admitted.size;
    this.members.add(key);
    this.admitted.add(key);
    if (this.members.size + this.admitted.size !== before) this._save();
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

    // "<Name> tells the group/raid, '...'" - a current member talking. Not one of isPartyChangeLine's
    // shapes, so checked before that gate. See GROUP_TELL's comment.
    const tell = GROUP_TELL.exec(stripped);
    if (tell) {
      this._add(tell[1]);
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
      if (this.members.delete(String(left).toLowerCase())) this._save();
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

module.exports = { GroupRoster, RESTORE_GRACE_MS };
