'use strict';
/**
 * The player's own charmed pets, and everyone else's.
 *
 * A charmed pet is a monster fighting on your side. The damage meter already half-copes with that
 * through its friend/enemy bootstrap, but two things it cannot do without help:
 *
 *  - tell YOUR charmed pet from a groupmate's, or from a wild-charmed mob nobody owns. The charm
 *    landing line ("a spite golem has been charmed.") names no caster. The only tell that it is
 *    yours is that YOU cast a charm spell a moment earlier - so this pairs the landing with a
 *    preceding "You begin casting <charm spell>." inside a short arm window, exactly the way
 *    buffEngine pairs a cast with its landing text.
 *
 *  - keep two pets with the same mob name apart. "a spite golem" charmed, killed, and a second
 *    "a spite golem" charmed is a DIFFERENT pet and a different meter row. Each own pet gets a
 *    generation number (`name#gen`); the gen bumps on every fresh charm of that name.
 *
 * A pet instance is retired when its charm is seen to break (`Your <charm> spell has worn off of
 * <mob>.`), when the mob is slain, when it is re-charmed, or when it has gone stale (no charm/leader
 * line refreshing it for a long time - the fallback for a break the log did not spell out).
 *
 * Pure: fed only the line bus plus an explicit `now`, no fs, no clock of its own. `ownNameFn` and
 * `isCharmSpellFn` are injected so the roster stays the source of truth for the charm-spell list.
 */

const {
  matchCastBegin,
  matchCharmed,
  matchPetLeader,
  matchOthersWornOff,
  matchSlain,
  stripRankSuffix,
} = require('./buffParser');

// How long after "You begin casting <charm>." a "<mob> has been charmed." still counts as the
// result of that cast. Charm has a short cast time; a groupmate charming the same-named mob seconds
// later is the risk this bounds. Matches the spirit of buffEngine's own arm windows.
const ARM_WINDOW_MS = 8000;

// A pet with no charm/leader line refreshing it for this long is assumed gone (a break the log did
// not record). Long, because a controlled charm can genuinely last many minutes and the
// event-driven retirements above are the real mechanism - this is only a backstop.
const STALE_MS = 20 * 60 * 1000;

// Fallback charm-spell list (lowercased), used only until isCharmSpellFn is wired. Kept in sync
// with widgetStore.js's CHARM_SPELL_NAMES by hand - the same convention that list already uses.
const DEFAULT_CHARM_SPELLS = new Set(
  [
    'Allure', 'Allure of the Wild', 'Befriend Animal', 'Beguile', 'Beguile Animals',
    'Beguile Plants', 'Beguile Undead', 'Cajole Undead', 'Cajoling Whispers', 'Charm',
    'Charm Animals', 'Dominate Undead', "Solon's Bewitching Bravura", "Solon's Song of the Sirens",
  ].map((s) => s.toLowerCase())
);

class PetTracker {
  constructor() {
    this._armedUntil = 0;
    this._genByName = new Map(); // nameLower -> highest generation issued
    // nameLower -> { key: 'Name#gen', display: original-case name, gen, refreshedAt }
    this.ownPets = new Map();
    // nameLower -> { leader: nameLower|null, refreshedAt } - a charmed mob that is NOT ours
    this.otherPets = new Map();
    this._ownNameFn = () => null;
    this._isCharmSpellFn = null;
  }

  setOwnNameFn(fn) {
    if (typeof fn === 'function') this._ownNameFn = fn;
  }

  setCharmSpellCheck(fn) {
    if (typeof fn === 'function') this._isCharmSpellFn = fn;
  }

  _isCharmSpell(name) {
    const bare = stripRankSuffix(String(name || '')).trim();
    if (!bare) return false;
    if (this._isCharmSpellFn) {
      try {
        if (this._isCharmSpellFn(bare)) return true;
      } catch {
        /* fall through to the default list */
      }
    }
    return DEFAULT_CHARM_SPELLS.has(bare.toLowerCase());
  }

  _retire(nameLower) {
    this.ownPets.delete(nameLower);
    this.otherPets.delete(nameLower);
  }

  _bindOwn(displayName, now) {
    const key = displayName.toLowerCase();
    const gen = (this._genByName.get(key) || 0) + 1;
    this._genByName.set(key, gen);
    this.otherPets.delete(key);
    this.ownPets.set(key, { key: `${displayName}#${gen}`, display: displayName, gen, refreshedAt: now });
  }

  handleLine(line, now = Date.now()) {
    if (typeof line !== 'string') return;

    const cast = matchCastBegin(line);
    if (cast && this._isCharmSpell(cast)) {
      this._armedUntil = now + ARM_WINDOW_MS;
      return;
    }

    const charmed = matchCharmed(line);
    if (charmed) {
      if (now <= this._armedUntil) {
        this._bindOwn(charmed, now);
        this._armedUntil = 0;
      } else if (!this.ownPets.has(charmed.toLowerCase())) {
        this.otherPets.set(charmed.toLowerCase(), { leader: null, refreshedAt: now });
      }
      return;
    }

    const leader = matchPetLeader(line);
    if (leader) {
      const petKey = leader.petName.toLowerCase();
      const ownName = String(this._ownNameFn() || '').toLowerCase();
      if (ownName && leader.leaderName.toLowerCase() === ownName) {
        // The pet itself says it is ours - treat it exactly like an armed charm landing.
        if (!this.ownPets.has(petKey)) this._bindOwn(leader.petName, now);
        else this.ownPets.get(petKey).refreshedAt = now;
      } else if (this.otherPets.has(petKey)) {
        this.otherPets.set(petKey, { leader: leader.leaderName.toLowerCase(), refreshedAt: now });
      } else if (!this.ownPets.has(petKey)) {
        this.otherPets.set(petKey, { leader: leader.leaderName.toLowerCase(), refreshedAt: now });
      }
      return;
    }

    const wornOff = matchOthersWornOff(line);
    if (wornOff && this._isCharmSpell(wornOff.spellName)) {
      this._retire(wornOff.targetName.toLowerCase());
      return;
    }

    const slain = matchSlain(line);
    if (slain) {
      this._retire(slain.toLowerCase());
      return;
    }
  }

  // Drop anything that has gone quiet for too long - the backstop for an unrecorded break.
  tick(now = Date.now()) {
    for (const [k, v] of this.ownPets) if (now - v.refreshedAt > STALE_MS) this.ownPets.delete(k);
    for (const [k, v] of this.otherPets) if (now - v.refreshedAt > STALE_MS) this.otherPets.delete(k);
  }

  /**
   * What damageEngine needs to attribute a hit:
   *  - ownPetKeyByName: nameLower -> 'Name#gen', so an own pet's row stays distinct across re-charms
   *  - unknownPetNames: charmed mobs with no known owner - folded into one "Charmed pets" row
   *  - allyPetLeader:   charmed mobs owned by a named other player - counted in "group" scope only
   *                     when that player is admitted
   */
  snapshot() {
    const ownPetKeyByName = new Map();
    for (const [k, v] of this.ownPets) ownPetKeyByName.set(k, v.key);
    const unknownPetNames = new Set();
    const allyPetLeader = new Map();
    for (const [k, v] of this.otherPets) {
      if (v.leader) allyPetLeader.set(k, v.leader);
      else unknownPetNames.add(k);
    }
    return { ownPetKeyByName, unknownPetNames, allyPetLeader };
  }
}

module.exports = { PetTracker, ARM_WINDOW_MS, STALE_MS };
