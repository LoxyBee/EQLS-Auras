'use strict';
/**
 * The damage meter (note 19).
 *
 * WHAT IT SHOWS, and why these three answers.
 *
 * The note was marked needs-design because one line of it left three questions open, and any
 * estimate before they were answered would have been fiction. They are answered here, from the
 * owner's own logs rather than from what a damage meter usually does:
 *
 *  1. WHAT - one row per attacker for the CURRENT FIGHT, biggest first, each showing damage done
 *     and its share, with an optional leading Total row carrying the fight's damage and its rate.
 *     Not a lifetime total, which nobody reads mid-pull, and not a per-target breakdown, which
 *     needs more rows than a small overlay has.
 *
 *  2. WHEN A FIGHT STARTS AND ENDS - it starts on the first counted damage and ends after the
 *     timeout with none. This is the classic hard part of every EQ parser and the usual answer is
 *     a timeout, which is always somewhat wrong: a slow pull with a long pause in it reads as two
 *     fights. It is settable per aura rather than fixed, because the right number depends on what
 *     is being fought and the app cannot know that.
 *
 *  3. WHOSE DAMAGE COUNTS - everyone hitting the things you are fighting. That decision was made
 *     by measurement, not taste. Across 1,521,971 lines this character deals 2,567 lines of spell
 *     damage and 145 of melee, against roughly 346,000 lines from everyone else. A meter showing
 *     only your own damage would be, for this player, an almost empty box. There is a "just my
 *     row" switch for anyone who wants the small version, and it hides the other rows rather than
 *     stopping them being counted - so the percentage it shows you is still your share of the
 *     whole fight, which is the number worth knowing.
 *
 * HOW DIRECTION IS DECIDED WITHOUT GUESSING AT NAMES.
 *
 * Counting "everyone" needs a way to tell damage going out from damage coming in, or the meter
 * adds the monster hitting you to the same list as your healer. The usual approach is to judge
 * from the shape of a name, and it does not survive contact with these logs: "Fright" is a
 * monster with a one-word name, shaped exactly like a player's.
 *
 * So no name is ever judged. Direction is derived, from one seed and three rules that feed each
 * other:
 *
 *   SEED     - you are on your own side.
 *   RULE 1   - anything YOU damage is an enemy. The log's grammar says so outright: "You crush X"
 *              and "X has taken N damage from your Y" cannot mean anything else.
 *   RULE 2   - anyone damaging a known enemy is a friend. Their damage counts.
 *   RULE 3   - anyone damaging a known friend is an enemy. Their damage is incoming, and does not.
 *
 * Rules 2 and 3 feed each other, which is what makes this worth doing. Measured on one day of the
 * owner's log: rule 1 alone credited 22% of the damage lines, because her groupmate spends most of
 * the night fighting mobs she personally never touches. Adding rule 3 - the gargoyle hitting him
 * is an enemy, so everything he does to it counts - took that to 65%, with the remaining 35% being
 * incoming damage that is correctly left out. Neither rule ever looks at what a name looks like.
 *
 * Known limitations, stated rather than hidden:
 *   - A character who neither attacks nor debuffs anything never seeds the enemy set, and sees an
 *     empty meter. Enemies you have merely debuffed count too (see setKnownEnemiesFn), which
 *     covers most of that, but a pure healer in a group of strangers is the honest exception.
 *   - A charmed pet fights on your side while still being a monster, and will be classified by
 *     whichever rule reaches it first. It is rare enough to record here rather than guess at.
 *
 * The retro-credit buffer below is what stops the bootstrap losing the opening seconds of a pull:
 * a line that was unclassifiable when it arrived is re-examined every time the sets grow.
 *
 * HEALING (owner, 4 Sep) is tracked the exact same way, sharing this same `enemies`/`friends`
 * bootstrap rather than building a second one - see _classifyHeal and healLines.js. A per-aura
 * `damageTrackMode` (widgetStore.js) picks which of the two tallies a given meter shows; 'both' is
 * deliberately unimplemented for now.
 */

const EventEmitter = require('events');
const { parseDamageLine } = require('../shared/damageLines');
const { parseHealLine } = require('../shared/healLines');
const { matchCastBegin, matchOtherCastBegin, stripRankSuffix } = require('./buffParser');

// A delayed / "promised" heal fires later as "<Target> healed himself ... by <Base> Trigger <N>",
// which reads as the target's own heal even though the CASTER did it. Re-credited to whoever cast
// the base spell within this window (Promised Renewal etc. are ~9s delays but can sit for their
// whole duration; a minute and a half is comfortably clear of a stale earlier cast).
const TRIGGER_HEAL_ATTR_WINDOW_MS = 90000;
const {
  isPossessivePetName,
  petOwnerFromName,
  looksLikeGeneratedPetName,
  isArticlePrefixedMobName,
} = require('../shared/petNames');

// Seconds without counted damage before the fight is considered over. Ten is the conventional
// answer and is as arbitrary as everyone else's ten; it is the per-aura default, not a constant
// the user is stuck with.
const DEFAULT_FIGHT_TIMEOUT_SEC = 10;

// A pull usually opens with somebody else's attack, not yours - and until something has proved the
// mob is a mob, that line cannot be placed. Rather than drop those opening lines, they are held
// here and credited retroactively the moment either of their names is classified.
//
// Bounded by count as a memory guard, and by the fight timeout on the way out: anything older
// than a fight boundary cannot belong to the fight starting now, so crediting it would corrupt
// the total rather than complete it.
const MAX_PENDING = 400;

class DamageEngine extends EventEmitter {
  constructor() {
    super();
    // Lowercased names proven to be things you are fighting. Lowercased because the log is
    // inconsistent about the leading article's case - "A pledge familiar" and "a zol ghoul knight"
    // appear in the same file - and two spellings of one mob would split its fight in half.
    this.enemies = new Set();
    // The other side of the same coin - see rules 2 and 3 in the header. Seeded with the log's two
    // words for you: "You" when you are the subject of a line, "YOU" when you are the object of
    // one ("A flouting gargoyle hits YOU for 31 points of damage."). The game shouts the second
    // one, and treating it as a different person would make every mob attacking you unclassifiable.
    this.friends = new Set(['you']);
    // attacker -> { damage, hits }
    this.byAttacker = new Map();
    this.fightStartedAt = null;
    this.lastDamageAt = null;
    // Owner, 5 Sep: a maintained DoT / `/melody` song ticking on a straggler must not hold the
    // meter's fight open on its own. The fight-end timer keys off the last REAL hit - a melee swing
    // or a directly-cast nuke - not off every damage line. `lastDamageAt` still tracks any damage,
    // as a fallback for a fight that had only DoT ticks (a pure-DoT kill) so it still closes.
    this.lastRealHitAt = null;
    this.totalDamage = 0;
    // A second tally, spanning the whole time since the last zone line rather than one fight. It
    // exists so a meter has something to show between pulls and right after zoning: getActive falls
    // back to it whenever no fight is underway. Reset wholesale on enterZone(); the fight timeout
    // never touches it.
    this.sinceZoneByAttacker = new Map();
    this.sinceZoneTotal = 0;
    this.sinceZoneStartedAt = null;
    this.sinceZoneLastAt = null;
    // Owner, 3 Sep: "i want all the damage separated on the backend, so that when something happens
    // that can retroactively split this ... it still collects all the correct data and it isn't
    // lost." Every parsed damage line's ATTACKER is tallied here regardless of classification -
    // one map per fight (cleared with byAttacker on reset), one per zone (cleared with
    // sinceZoneByAttacker on enterZone). getActive reconciles: a name that is a confirmed friend
    // NOW gets the larger of its classified total and this raw total, so a groupmate whose early
    // hits landed before the bootstrap could place them - or before the group roster learned them -
    // shows their full damage the moment they're recognised, instead of that stretch being lost to
    // the pending-buffer age cutoff or a fight reset.
    this.rawFightByName = new Map(); // rawName -> { damage, hits }
    this.rawZoneByName = new Map();
    // Lines awaiting proof of which way they point: { attacker, target, amount, kind, at }
    this.pending = [];
    this.timeoutSec = DEFAULT_FIGHT_TIMEOUT_SEC;

    // Healing, tracked by the exact same collect/hold/collapse method as damage above, sharing the
    // SAME `enemies`/`friends` sets - "who's on my side" is one fact, not a separate one per meter.
    // See _classifyHeal for how a heal line (which always names both parties, unlike a melee line)
    // still needs the same hold-until-provable treatment as damage before it can be credited.
    this.byHealer = new Map();
    this.lastHealAt = null;
    this.totalHealing = 0;
    this.sinceZoneByHealer = new Map();
    this.sinceZoneHealTotal = 0;
    this.sinceZoneHealStartedAt = null;
    this.sinceZoneHealLastAt = null;
    this.rawHealFightByName = new Map();
    this.rawHealZoneByName = new Map();
    this.healPending = [];
    // base-spell-name (lowercased, rank stripped) -> { caster, at } for re-crediting a delayed
    // "... by <Base> Trigger <N>" heal to whoever actually cast <Base> (see TRIGGER_HEAL_ATTR_WINDOW_MS).
    this.recentHealCasts = new Map();
    // Enemies known from elsewhere - the mez/snare/slow targets buffEngine already tracks. Lets a
    // character who debuffs but does not attack still seed the set.
    this.knownEnemiesFn = () => [];
    // The "group" damage scope filters on this - lowercased names of everyone admitted to the
    // player's group this session (see groupRoster.js). Empty array => no roster known yet, and the
    // group scope quietly falls back to showing the whole fight.
    this.groupFn = () => [];
    // Charmed-pet facts (see petTracker.js): own pets keyed name#gen, unknown-owner pets folded
    // into one row, ally pets counted in group scope when their owner is admitted. null => none.
    this.petsFn = () => null;
  }

  setGroupFn(fn) {
    if (typeof fn === 'function') this.groupFn = fn;
  }

  setPetsFn(fn) {
    if (typeof fn === 'function') this.petsFn = fn;
  }

  setKnownEnemiesFn(fn) {
    if (typeof fn === 'function') this.knownEnemiesFn = fn;
  }

  /**
   * The fight timeout, pushed from the aura configs on change rather than read per line.
   *
   * There is ONE engine and there can be several damage auras, so when they disagree the LONGEST
   * timeout wins. That direction is deliberate: too long merely joins two fights that a shorter
   * setting would have split, and both auras still show a real number. Too short would end the
   * fight underneath an aura that asked to keep counting, and it would have no way to get those
   * numbers back.
   *
   * Everything else about a damage aura - whether it shows only your row, whether it shows the
   * total line - is applied where the tiles are drawn instead of here, precisely so that two
   * meters can differ on it without needing two engines.
   */
  setOptions({ fightTimeoutSec } = {}) {
    if (typeof fightTimeoutSec === 'number' && Number.isFinite(fightTimeoutSec)) {
      this.timeoutSec = Math.min(600, Math.max(1, Math.round(fightTimeoutSec)));
    }
  }

  // An EXPLICIT enemy signal - the player mezzed/snared this exact name - is trusted directly, even
  // if the bootstrap has the name as a friend (a genuine same-name charmed-pet/enemy collision, the
  // case the collision guard in _classify exists for). Only the bootstrap's OWN inferences go
  // through the _learnFriend/_learnEnemy "first side wins" guards.
  _isEnemy(name) {
    const key = name.toLowerCase();
    if (this.enemies.has(key)) return true;
    // Consulted live rather than copied in, so a mob mezzed a moment ago counts immediately.
    for (const known of this.knownEnemiesFn() || []) {
      if (typeof known === 'string' && known.toLowerCase() === key) {
        this.enemies.add(key);
        return true;
      }
    }
    return false;
  }

  // petTracker's verdict on an article-prefixed name ("a spite golem", "an ice bones"): a pet you
  // own, an ally's pet, or a wild charm with a real "has been charmed." line behind it. Anything
  // else that merely LOOKS like a mob and has drifted onto the friend side is charm-war bootstrap
  // pollution (gotcha #40), not a pet - used to keep such a name off the heal meter.
  _petVouchesFor(key) {
    const pets = (this.petsFn && this.petsFn()) || null;
    if (!pets) return false;
    return !!(
      (pets.ownPetKeyByName && pets.ownPetKeyByName.has(key)) ||
      (pets.unknownPetNames && pets.unknownPetNames.has(key)) ||
      (pets.allyPetLeader && pets.allyPetLeader.has(key))
    );
  }

  // The friend counterpart. A confirmed group member (groupRoster - live join lines + the startup
  // log-tail scan) is a friend for classification, full stop, no bootstrap needed. This is what
  // stops a groupmate dropping off the CURRENT fight after a restart: their hits on a mob you never
  // personally touched now classify as outgoing immediately, instead of sitting unclassifiable
  // until your own first attack seeds the enemy set. The learned `friends` set still grows the
  // usual way for everyone else (charmed pets, a stranger helping on a pull).
  _isFriend(name) {
    const key = name.toLowerCase();
    if (this.friends.has(key)) return true;
    if (this._isGroupMember(key)) {
      this.friends.add(key);
      return true;
    }
    return false;
  }

  // Strictly the group roster - a real person confirmed by a join line or the startup log scan.
  // Distinct from _isFriend, which also covers bootstrap-learned friends like charmed pets.
  _isGroupMember(name) {
    const key = name.toLowerCase();
    if (key === 'you' || key === 'yourself') return true;
    for (const g of this.groupFn() || []) {
      if (typeof g === 'string' && g.toLowerCase() === key) return true;
    }
    return false;
  }

  /**
   * Which way a single hit points, or null if it is not yet possible to say.
   *
   * 'out' - a friend damaging an enemy. Counts.
   * 'in'  - an enemy damaging a friend. Real, and deliberately not counted; this is a damage
   *         meter, not a combat log, and mixing the two puts the monster hitting you in the same
   *         list as your healer.
   * null  - neither side is known yet. The caller holds the line rather than dropping it.
   *
   * Classifying also TEACHES: every resolved line names one side, which by rules 2 and 3 proves
   * the other. That is the whole bootstrap.
   */
  // A friend and an enemy are learned, never un-learned - except that a name must never sit on
  // both sides at once (the collision guard would then drop every line it appears in). So the two
  // adders refuse to cross a name that the other set already holds: the first classification of a
  // name wins, and a later contradiction is treated as noise rather than allowed to poison the set.
  // 'you' is a friend from the constructor and can never become an enemy.
  _learnFriend(key) {
    if (this.enemies.has(key)) return;
    this.friends.add(key);
  }
  _learnEnemy(key) {
    if (this.friends.has(key)) return;
    this.enemies.add(key);
  }

  _classify(hit) {
    const a = hit.attacker.toLowerCase();
    const t = hit.target.toLowerCase();

    // A damage-shield hit ("Avenrae is burned by Footman of V`Zher's flames") is pure retaliation:
    // whoever hit the shield-holder took its damage back. It NEVER teaches a side that the hit
    // which triggered it did not already teach, and in a charm-war zone (necro pets, charmed mobs,
    // enemy mobs that share a name with the charmed ones) DS crossfire is the single biggest source
    // of contradictory facts - measured live, it collapsed the whole bootstrap: the group ended up
    // tagged as enemies and the mobs as friends. So a shield line is still given a DIRECTION when
    // both sides are already known (real DS damage on a real enemy still counts), but it is never
    // allowed to ADD to either set.
    const teach = hit.kind !== 'shield';

    // Rule 1. The damage itself is unambiguous - it happened, it was yours, credit it - but WHO
    // it proves the target to be is not, quite: a real log has friendly fire in it ("You crush
    // Zorrick for 37 points of damage." - measured, a real groupmate, not a mob). Blindly adding
    // the target to `enemies` on a name that is ALREADY an established friend poisons the set for
    // every future line from that person - the collision guard below would then start dropping
    // their own outgoing damage for the rest of the session, which is a far worse loss than one
    // stray hit being counted as an enemy would have been. So: credit the hit always, but only
    // teach `enemies` when the target isn't already known as a person.
    if (hit.attacker === 'You') {
      if (teach && !this._isFriend(t)) this._learnEnemy(t);
      return 'out';
    }

    // Rule 1, generalised to a CONFIRMED group member. "You crush X" proves X is an enemy; so does
    // "Bobarafius crushes X" when Bobarafius is in the group roster - a groupmate does not melee a
    // friend, and this is the fix for the owner's report that a groupmate fighting mobs she never
    // personally touched dropped off the current fight after a restart (her own attacks, as a bard,
    // seed the enemy set too slowly). Scoped to a roster-confirmed member, never a bootstrap-learned
    // friend (a charmed pet is a "friend" that DOES fight other friends). A DS line never teaches.
    if (teach && this._isGroupMember(a) && !this._isFriend(t)) {
      this._learnEnemy(t);
      return 'out';
    }

    // Name-collision guard. A name that has ended up in BOTH sets - most often a charmed pet whose
    // mob name matches a live hostile of the same name you are also fighting - gives contradictory
    // answers below. There is no honest way to say which hit this is, so drop it rather than credit
    // it to whichever rule fires first. Rare; a wrong credit is worse than a missing one.
    if (this.enemies.has(a) && this.friends.has(a)) return 'drop';

    const attackerEnemy = this._isEnemy(hit.attacker);
    const targetEnemy = this._isEnemy(hit.target);
    const attackerFriend = this._isFriend(hit.attacker);
    const targetFriend = this._isFriend(hit.target);

    // Rule 2 - damaging a known enemy makes you a friend.
    if (targetEnemy && !attackerEnemy) {
      if (teach) this._learnFriend(a);
      return 'out';
    }
    // Rule 3 - damaging a known friend makes you an enemy.
    if (targetFriend && !attackerFriend) {
      if (teach) this._learnEnemy(a);
      return 'in';
    }
    // Both sides already known. No new information, but the direction is still readable.
    if (attackerFriend && targetEnemy) return 'out';
    if (attackerEnemy && targetFriend) return 'in';
    return null;
  }

  /**
   * The heal counterpart of _classify. A heal line is a different shape from a damage line in one
   * important way: it always names BOTH parties outright ("<Healer> healed <Target> for N hit
   * points...") - there is no melee-shaped ambiguity to resolve. What's still unknown is whether
   * either of them is actually on your side, and either name can be the one that settles it first -
   * unlike damage, where only the target's status matters (rules 2/3), a heal is symmetric: nobody
   * heals an enemy, and nothing heals FOR an enemy either, so a known status on EITHER side proves
   * the other. Shares the exact same `enemies`/`friends` sets as damage - a name proven friend by a
   * damage line (or the reverse) is already settled here, no separate heal-side bootstrap needed.
   *
   * 'out'  - credit it: one side is a known friend, which proves the other.
   * 'drop' - one side is a known enemy (a mob healing another mob, or a friend/enemy mismatch that
   *          can only be a name collision) - not ours, never credited, but it still teaches the
   *          other side when the mismatch was a plain enemy healing an enemy.
   * null   - neither side known yet. Held, exactly like an unresolved damage line.
   */
  _classifyHeal(hit) {
    const h = hit.healer.toLowerCase();
    const t = hit.target.toLowerCase();

    // Name-collision guard, same reasoning as _classify's own.
    if (this.enemies.has(h) && this.friends.has(h)) return 'drop';
    if (this.enemies.has(t) && this.friends.has(t)) return 'drop';

    // A heal touching an article-prefixed mob name ("a ghoul healed itself", "an ice bones healed
    // a greater mummy") is charm-war crossfire - the same poison a damage-shield line is to
    // _classify (gotcha #40). In a zone full of necro pets and charmed mobs, hostiles self-heal
    // and heal each other constantly, and if one of those names has drifted onto the friend side
    // through the bootstrap the heal gets credited to your group's "Charmed pets" row (reported
    // live 7 Sep, Befallen: a phantom "Charmed pets" healer). Unless petTracker actually vouches
    // for the name as a pet, a heal like this never teaches a side and is never credited.
    if (
      (isArticlePrefixedMobName(hit.healer) && !this._petVouchesFor(h)) ||
      (isArticlePrefixedMobName(hit.target) && !this._petVouchesFor(t))
    ) {
      return 'drop';
    }

    const healerFriend = this._isFriend(hit.healer);
    const healerEnemy = this._isEnemy(hit.healer);
    const targetFriend = this._isFriend(hit.target);
    const targetEnemy = this._isEnemy(hit.target);

    // A known friend "healing" a known enemy (or the reverse) is a contradiction - the same kind of
    // collision the guard above exists for - so it drops without teaching either name anything.
    if (healerFriend && targetEnemy) return 'drop';
    if (healerEnemy && targetFriend) return 'drop';

    if (healerFriend) {
      this._learnFriend(t);
      return 'out';
    }
    if (healerEnemy) {
      this._learnEnemy(t);
      return 'drop';
    }
    if (targetFriend) {
      this._learnFriend(h);
      return 'out';
    }
    if (targetEnemy) {
      this._learnEnemy(h);
      return 'drop';
    }
    return null;
  }

  handleLine(line, now = Date.now()) {
    const hit = parseDamageLine(line);
    if (hit) {
      // Raw tally FIRST, before any classification can drop the line - see the field comment.
      this._recordRaw(hit);

      const dir = this._classify(hit);
      if (dir === null) {
        // Might still become classifiable a moment from now, once one of its two names turns up in
        // a line that can be read. Held, not dropped.
        this.pending.push({ ...hit, at: now });
        if (this.pending.length > MAX_PENDING) this.pending.shift();
        return;
      }
      // The collision guard on THIS side never teaches, but a resolved line still might have (rules
      // 2/3) - and since the heal side reads the SAME friend/enemy sets, whatever this line just
      // taught can unblock a heal that was held on the exact same name. So both queues are flushed
      // here, not only this one's own.
      this._expireIfIdle(now);
      this._flushPending(now);
      this._flushHealPending(now);
      if (dir === 'out') this._credit(hit.attacker, hit.amount, now, hit.kind === 'melee' || !!hit.direct);
      if (dir !== 'drop') this.emit('activeChanged', this.getActive(now));
      return;
    }

    // Track who casts what, so a delayed "... by <Base> Trigger" heal can be credited to the real
    // caster rather than the target it lands on.
    const ownCast = matchCastBegin(line);
    const otherCast = ownCast ? null : matchOtherCastBegin(line);
    if (ownCast) this.recentHealCasts.set(stripRankSuffix(ownCast).toLowerCase(), { caster: 'You', at: now });
    else if (otherCast) {
      this.recentHealCasts.set(stripRankSuffix(otherCast.spellName).toLowerCase(), { caster: otherCast.casterName, at: now });
    }

    const heal = parseHealLine(line);
    if (!heal) return;

    // "<Target> healed himself ... by Promised Renewal Trigger I" - a delayed heal that reads as a
    // self-heal but was cast BY someone else (reported live 5 Sep: the player's Promised Renewal
    // healing was being credited to the tank it landed on). Re-credit to whoever cast the base
    // spell recently; the target stays as the line's stated healer. Self-heals and lifetaps DO
    // count as healing - the owner's call - so nothing is dropped here.
    const trig = /^(.+?) Trigger(?: [IVXLCDM]+)?$/i.exec(heal.spell || '');
    if (trig) {
      const cast = this.recentHealCasts.get(stripRankSuffix(trig[1]).toLowerCase());
      if (cast && now - cast.at <= TRIGGER_HEAL_ATTR_WINDOW_MS) heal.healer = cast.caster;
    }

    this._recordRawHeal(heal);
    const dir = this._classifyHeal(heal);
    if (dir === null) {
      this.healPending.push({ ...heal, at: now });
      if (this.healPending.length > MAX_PENDING) this.healPending.shift();
      return;
    }
    // Symmetric to the damage branch above - a heal's collision guard never teaches, but its
    // enemy-target case does (_classifyHeal calls _learnEnemy before returning 'drop' there), so
    // both queues are flushed here too rather than only healPending.
    this._expireIfIdle(now);
    this._flushPending(now);
    this._flushHealPending(now);
    if (dir === 'out') this._creditHeal(heal.healer, heal.amount, now);
    if (dir !== 'drop') this.emit('activeChanged', this.getActive(now));
  }

  // Re-examines everything held. Loops until a pass learns nothing new, because one freed line can
  // name a side that frees another - a chain that a single pass would leave half-resolved.
  _flushPending(now) {
    const cutoff = now - this.timeoutSec * 1000;
    for (;;) {
      const keep = [];
      let resolvedAny = false;
      for (const p of this.pending) {
        if (p.at < cutoff) continue; // too old to belong to this fight
        const dir = this._classify(p);
        if (dir === null) {
          keep.push(p);
          continue;
        }
        resolvedAny = true;
        if (dir === 'out') this._credit(p.attacker, p.amount, p.at, p.kind === 'melee' || !!p.direct);
      }
      this.pending = keep;
      if (!resolvedAny) return;
    }
  }

  // The heal counterpart of _flushPending.
  _flushHealPending(now) {
    const cutoff = now - this.timeoutSec * 1000;
    for (;;) {
      const keep = [];
      let resolvedAny = false;
      for (const p of this.healPending) {
        if (p.at < cutoff) continue;
        const dir = this._classifyHeal(p);
        if (dir === null) {
          keep.push(p);
          continue;
        }
        resolvedAny = true;
        if (dir === 'out') this._creditHeal(p.healer, p.amount, p.at);
      }
      this.healPending = keep;
      if (!resolvedAny) return;
    }
  }

  _recordRaw(hit) {
    const bump = (map) => {
      const r = map.get(hit.attacker) || { damage: 0, hits: 0 };
      r.damage += hit.amount;
      r.hits += 1;
      map.set(hit.attacker, r);
    };
    bump(this.rawFightByName);
    bump(this.rawZoneByName);
  }

  _credit(attacker, amount, at, isRealHit) {
    if (this.fightStartedAt === null) this.fightStartedAt = at;
    // A retro-credited line can predate the line that opened the fight.
    if (at < this.fightStartedAt) this.fightStartedAt = at;
    const row = this.byAttacker.get(attacker) || { damage: 0, hits: 0 };
    row.damage += amount;
    row.hits += 1;
    this.byAttacker.set(attacker, row);
    this.totalDamage += amount;
    this.lastDamageAt = Math.max(this.lastDamageAt || 0, at);
    if (isRealHit) this.lastRealHitAt = Math.max(this.lastRealHitAt || 0, at);

    // Same credit, into the tally that outlives the fight. Never expired here - only enterZone()
    // clears it.
    if (this.sinceZoneStartedAt === null) this.sinceZoneStartedAt = at;
    if (at < this.sinceZoneStartedAt) this.sinceZoneStartedAt = at;
    const zrow = this.sinceZoneByAttacker.get(attacker) || { damage: 0, hits: 0 };
    zrow.damage += amount;
    zrow.hits += 1;
    this.sinceZoneByAttacker.set(attacker, zrow);
    this.sinceZoneTotal += amount;
    this.sinceZoneLastAt = Math.max(this.sinceZoneLastAt || 0, at);
  }

  // The heal counterpart of _recordRaw - reuses the identical {damage, hits} map shape so
  // _tilesFrom (below) works unmodified on heal data; "damage" there just means "the amount".
  _recordRawHeal(hit) {
    const bump = (map) => {
      const r = map.get(hit.healer) || { damage: 0, hits: 0 };
      r.damage += hit.amount;
      r.hits += 1;
      map.set(hit.healer, r);
    };
    bump(this.rawHealFightByName);
    bump(this.rawHealZoneByName);
  }

  // The heal counterpart of _credit. Deliberately does NOT touch `fightStartedAt` or drive the
  // idle-timeout - a fight is defined by DAMAGE, and a heal-over-time bard song (Cantata, Chorus of
  // Marr, ...) ticks a "healed" line every ~6s for as long as it plays. Letting that keep the
  // fight alive left the meter stuck on the current-fight view minutes after combat ended
  // (reported live 5 Sep). Heals land in the fight tally while a damage fight is underway, and in
  // the since-zone tally always; when the damage fight times out, reset() clears the heal fight
  // tally with it.
  _creditHeal(healer, amount, at) {
    const row = this.byHealer.get(healer) || { damage: 0, hits: 0 };
    row.damage += amount;
    row.hits += 1;
    this.byHealer.set(healer, row);
    this.totalHealing += amount;
    this.lastHealAt = Math.max(this.lastHealAt || 0, at);

    if (this.sinceZoneHealStartedAt === null) this.sinceZoneHealStartedAt = at;
    if (at < this.sinceZoneHealStartedAt) this.sinceZoneHealStartedAt = at;
    const zrow = this.sinceZoneByHealer.get(healer) || { damage: 0, hits: 0 };
    zrow.damage += amount;
    zrow.hits += 1;
    this.sinceZoneByHealer.set(healer, zrow);
    this.sinceZoneHealTotal += amount;
    this.sinceZoneHealLastAt = Math.max(this.sinceZoneHealLastAt || 0, at);
  }

  // A zone line. The fight state is left alone - a zone line mid-fight is rare and the timeout
  // still ends that fight correctly - but the "since zone-in" tally starts over, because that is
  // exactly what it measures.
  enterZone(now = Date.now()) {
    this.sinceZoneByAttacker.clear();
    this.rawZoneByName.clear();
    this.sinceZoneTotal = 0;
    this.sinceZoneStartedAt = null;
    this.sinceZoneLastAt = null;
    this.sinceZoneByHealer.clear();
    this.rawHealZoneByName.clear();
    this.sinceZoneHealTotal = 0;
    this.sinceZoneHealStartedAt = null;
    this.sinceZoneHealLastAt = null;
    this.emit('activeChanged', this.getActive(now));
  }

  // --- session restore (see sessionRestore.js) ------------------------------------------------
  // A quick restart mid-fight otherwise blanks the meter until the next hit re-bootstraps from
  // your own first attack, losing the opening of the pull. Captured: the friend/enemy sets (the
  // valuable bootstrap - the same mobs and group are still there a minute later), both tallies,
  // and their absolute timestamps. Nothing here needs clock math on the way back: a fight whose
  // last hit is now older than the timeout is dropped by _expireIfIdle, exactly as it would be
  // mid-session, and the since-zone tally (which has no timeout) carries the meter until the next
  // real fight. The registry only offers this back within a short window (2 min) - a damage total
  // minutes out of date reads as current in a way an empty meter doesn't.
  captureState() {
    const hasHeal = this.totalHealing > 0 || this.sinceZoneHealTotal > 0;
    if (this.totalDamage === 0 && this.sinceZoneTotal === 0 && !hasHeal) return null;
    return {
      enemies: [...this.enemies],
      friends: [...this.friends],
      byAttacker: [...this.byAttacker],
      rawFightByName: [...this.rawFightByName],
      rawZoneByName: [...this.rawZoneByName],
      fightStartedAt: this.fightStartedAt,
      lastDamageAt: this.lastDamageAt,
      lastRealHitAt: this.lastRealHitAt,
      totalDamage: this.totalDamage,
      sinceZoneByAttacker: [...this.sinceZoneByAttacker],
      sinceZoneTotal: this.sinceZoneTotal,
      sinceZoneStartedAt: this.sinceZoneStartedAt,
      sinceZoneLastAt: this.sinceZoneLastAt,
      byHealer: [...this.byHealer],
      rawHealFightByName: [...this.rawHealFightByName],
      rawHealZoneByName: [...this.rawHealZoneByName],
      lastHealAt: this.lastHealAt,
      totalHealing: this.totalHealing,
      sinceZoneByHealer: [...this.sinceZoneByHealer],
      sinceZoneHealTotal: this.sinceZoneHealTotal,
      sinceZoneHealStartedAt: this.sinceZoneHealStartedAt,
      sinceZoneHealLastAt: this.sinceZoneHealLastAt,
    };
  }

  restoreState(s, _gapMs, now = Date.now()) {
    if (!s || typeof s !== 'object') return 0;
    for (const n of Array.isArray(s.enemies) ? s.enemies : []) this.enemies.add(n);
    for (const n of Array.isArray(s.friends) ? s.friends : []) this.friends.add(n);
    // A snapshot taken while the bootstrap was mid-collapse (charm-war zone - see _classify) can
    // carry a name on BOTH sides. The collision guard would then drop every line that name appears
    // in for the rest of the session. Forget any such name entirely and let the live bootstrap
    // re-learn it cleanly - a restored contradiction is worse than a restored blank.
    for (const n of [...this.enemies]) {
      if (this.friends.has(n)) {
        this.enemies.delete(n);
        this.friends.delete(n);
      }
    }
    for (const pair of Array.isArray(s.byAttacker) ? s.byAttacker : []) {
      if (Array.isArray(pair)) this.byAttacker.set(pair[0], pair[1]);
    }
    for (const pair of Array.isArray(s.sinceZoneByAttacker) ? s.sinceZoneByAttacker : []) {
      if (Array.isArray(pair)) this.sinceZoneByAttacker.set(pair[0], pair[1]);
    }
    for (const pair of Array.isArray(s.rawFightByName) ? s.rawFightByName : []) {
      if (Array.isArray(pair)) this.rawFightByName.set(pair[0], pair[1]);
    }
    for (const pair of Array.isArray(s.rawZoneByName) ? s.rawZoneByName : []) {
      if (Array.isArray(pair)) this.rawZoneByName.set(pair[0], pair[1]);
    }
    for (const pair of Array.isArray(s.byHealer) ? s.byHealer : []) {
      if (Array.isArray(pair)) this.byHealer.set(pair[0], pair[1]);
    }
    for (const pair of Array.isArray(s.sinceZoneByHealer) ? s.sinceZoneByHealer : []) {
      if (Array.isArray(pair)) this.sinceZoneByHealer.set(pair[0], pair[1]);
    }
    for (const pair of Array.isArray(s.rawHealFightByName) ? s.rawHealFightByName : []) {
      if (Array.isArray(pair)) this.rawHealFightByName.set(pair[0], pair[1]);
    }
    for (const pair of Array.isArray(s.rawHealZoneByName) ? s.rawHealZoneByName : []) {
      if (Array.isArray(pair)) this.rawHealZoneByName.set(pair[0], pair[1]);
    }
    if (typeof s.fightStartedAt === 'number') this.fightStartedAt = s.fightStartedAt;
    if (typeof s.lastDamageAt === 'number') this.lastDamageAt = s.lastDamageAt;
    if (typeof s.lastRealHitAt === 'number') this.lastRealHitAt = s.lastRealHitAt;
    if (typeof s.totalDamage === 'number') this.totalDamage = s.totalDamage;
    if (typeof s.sinceZoneStartedAt === 'number') this.sinceZoneStartedAt = s.sinceZoneStartedAt;
    if (typeof s.sinceZoneLastAt === 'number') this.sinceZoneLastAt = s.sinceZoneLastAt;
    if (typeof s.sinceZoneTotal === 'number') this.sinceZoneTotal = s.sinceZoneTotal;
    if (typeof s.lastHealAt === 'number') this.lastHealAt = s.lastHealAt;
    if (typeof s.totalHealing === 'number') this.totalHealing = s.totalHealing;
    if (typeof s.sinceZoneHealStartedAt === 'number') this.sinceZoneHealStartedAt = s.sinceZoneHealStartedAt;
    if (typeof s.sinceZoneHealLastAt === 'number') this.sinceZoneHealLastAt = s.sinceZoneHealLastAt;
    if (typeof s.sinceZoneHealTotal === 'number') this.sinceZoneHealTotal = s.sinceZoneHealTotal;
    this._expireIfIdle(now); // a fight that timed out during the gap ends here, sets kept
    const rows = this.byAttacker.size + this.sinceZoneByAttacker.size + this.byHealer.size + this.sinceZoneByHealer.size;
    if (rows) this.emit('activeChanged', this.getActive(now));
    return rows;
  }

  // A fight ends after a stretch with no counted DAMAGE - heals are not consulted (see _creditHeal
  // on why). reset() then clears the heal fight tally alongside the damage one.
  _expireIfIdle(now) {
    // The fight ends timeoutSec after the last REAL hit (a melee swing or a directly-cast nuke).
    // A maintained DoT / `/melody` song ticking on a straggler is still credited but does NOT hold
    // the fight open on its own (owner, 5 Sep). `lastDamageAt` is the fallback anchor for a fight
    // that never had a real hit (a pure-DoT kill), so that still closes on the same timeout.
    const anchor = this.lastRealHitAt != null ? this.lastRealHitAt : this.lastDamageAt;
    if (anchor === null) return false;
    if (now - anchor < this.timeoutSec * 1000) return false;
    this.reset();
    return true;
  }

  // A fight ending does NOT clear the friend and enemy sets. The same mobs and the same group are
  // usually still there on the next pull, and forgetting them would make every pull re-bootstrap
  // from your own first hit - losing exactly the opening seconds the bootstrap exists to keep.
  reset() {
    this.byAttacker.clear();
    this.rawFightByName.clear();
    this.totalDamage = 0;
    this.fightStartedAt = null;
    this.lastDamageAt = null;
    this.lastRealHitAt = null;
    this.pending = [];
    this.byHealer.clear();
    this.rawHealFightByName.clear();
    this.totalHealing = 0;
    this.lastHealAt = null;
    this.healPending = [];
  }

  // Called on a timer as well as on each line, so the meter clears itself when a fight ends in
  // silence rather than hanging on screen until the next pull happens to notice.
  tick(now = Date.now()) {
    if (this._expireIfIdle(now)) this.emit('activeChanged', this.getActive(now));
  }

  // At least one second, so the very first hit of a fight does not divide by a zero-length window
  // and report a rate of Infinity.
  fightSeconds(now = Date.now()) {
    if (this.fightStartedAt === null) return 0;
    const end = Math.max(this.lastDamageAt || 0, this.fightStartedAt);
    return Math.max(1, (end - this.fightStartedAt) / 1000);
  }

  // First counted hit to last counted hit since zone-in - same shape as fightSeconds, so the rate
  // it feeds means the same thing (damage over the span damage was actually happening, not over
  // every idle minute spent standing in the zone).
  sinceZoneSeconds() {
    if (this.sinceZoneStartedAt === null) return 0;
    const end = Math.max(this.sinceZoneLastAt || 0, this.sinceZoneStartedAt);
    return Math.max(1, (end - this.sinceZoneStartedAt) / 1000);
  }

  // The heal counterpart of fightSeconds - same shared fightStartedAt, its own last-activity clock.
  healFightSeconds(now = Date.now()) {
    if (this.fightStartedAt === null) return 0;
    const end = Math.max(this.lastHealAt || 0, this.fightStartedAt);
    return Math.max(1, (end - this.fightStartedAt) / 1000);
  }

  // The heal counterpart of sinceZoneSeconds.
  sinceZoneHealSeconds() {
    if (this.sinceZoneHealStartedAt === null) return 0;
    const end = Math.max(this.sinceZoneHealLastAt || 0, this.sinceZoneHealStartedAt);
    return Math.max(1, (end - this.sinceZoneHealStartedAt) / 1000);
  }

  /**
   * Overlay tiles, biggest first.
   *
   * Deliberately the same tile shape the buff auras use, with two optional fields the overlay
   * already understands: valueText replaces the countdown, barPercent replaces the depleting bar.
   * That is the whole integration - no second renderer, and every list setting an aura already has
   * (row size, text size, colours, anchor, drag, per-loadout visibility) works here for free.
   *
   * @param mode 'damage' (default), 'healing', or 'both' - which of the collect/hold/collapse
   *   tallies to render. 'both' merges the damage and healing rows for each player into one row
   *   with a two-colour split bar - see _bothTilesFrom.
   */
  getActive(now = Date.now(), scope = 'all', mode = 'damage') {
    const pets = (this.petsFn && this.petsFn()) || null;
    // A fight is "underway" when fightStartedAt is set and something has been credited. But the
    // fight rows for THIS scope can still be empty - a scope:'mine' meter during a stretch of a
    // pull where only groupmates have acted, say. When that happens, fall through to the
    // since-zone tally rather than blanking the meter mid-fight (reported live 4 Sep for a
    // scope:'mine' Both meter that "only shows zone total, not fight total then zone total").
    const inFight = this.fightStartedAt !== null;
    if (mode === 'both') {
      if (inFight && (this.totalDamage > 0 || this.totalHealing > 0)) {
        const t = this._bothTilesFrom(
          this.byAttacker, this.rawFightByName, this.fightSeconds(now),
          this.byHealer, this.rawHealFightByName, this.healFightSeconds(now),
          false, scope, pets
        );
        if (t.length) return t;
      }
      if (this.sinceZoneTotal > 0 || this.sinceZoneHealTotal > 0) {
        return this._bothTilesFrom(
          this.sinceZoneByAttacker, this.rawZoneByName, this.sinceZoneSeconds(),
          this.sinceZoneByHealer, this.rawHealZoneByName, this.sinceZoneHealSeconds(),
          true, scope, pets
        );
      }
      return [];
    }
    if (mode === 'healing') {
      if (inFight && this.totalHealing > 0) {
        const t = this._tilesFrom(this.byHealer, this.healFightSeconds(now), false, scope, pets, this.rawHealFightByName, 'heal');
        if (t.length) return t;
      }
      if (this.sinceZoneHealStartedAt !== null && this.sinceZoneHealTotal > 0) {
        return this._tilesFrom(this.sinceZoneByHealer, this.sinceZoneHealSeconds(), true, scope, pets, this.rawHealZoneByName, 'heal');
      }
      return [];
    }
    // A fight is underway - the current-fight rows, as always.
    if (inFight && this.totalDamage > 0) {
      const t = this._tilesFrom(this.byAttacker, this.fightSeconds(now), false, scope, pets, this.rawFightByName);
      if (t.length) return t;
    }
    // No fight (or nothing this scope shows in it) - fall back to the running tally since the last
    // zone line, so the meter isn't blank between pulls and right after zoning. The total row
    // carries a `sinceZone` flag so the overlay can mark that this isn't the last fight's number.
    if (this.sinceZoneStartedAt !== null && this.sinceZoneTotal > 0) {
      return this._tilesFrom(this.sinceZoneByAttacker, this.sinceZoneSeconds(), true, scope, pets, this.rawZoneByName);
    }
    return [];
  }

  /**
   * 'both' mode - one row per player, damage and healing merged. Runs the exact same _aggregate()
   * collapsing pass twice (once per metric, so a player is bucketed identically either way - a
   * charmed pet is "Pets" on both sides, an outsider is "Other" on both), then merges the two
   * result maps by display name. A player who only appears on one side (a pure DPS with no heals,
   * or a pure healer who never landed a hit) still gets a row - their absent side is just 0.
   *
   * The bar is one length (total = damage + heal, scaled against the biggest COMBINED total, same
   * "against the biggest row" reasoning _tilesFrom uses) with `barSplit` marking what fraction of
   * that length is the damage portion - the overlay draws the two colours as one hard-edged
   * gradient inside a single bar rather than two separate elements.
   */
  _bothTilesFrom(byAttacker, rawDmgByName, dmgSecs, byHealer, rawHealByName, healSecs, sinceZone, scope, pets) {
    const dmgAgg = this._aggregate(byAttacker, scope, pets, rawDmgByName, 'damage');
    const healAgg = this._aggregate(byHealer, scope, pets, rawHealByName, 'heal');
    // Both passes are given the SAME requested scope, so a 'group' fallback (empty roster) happens
    // identically on both sides - agg.scope/fellBack from either is representative of both.

    const merged = new Map(); // name -> { damage, heal, hits, isPet, unknownPets, isOther }
    const fold = (map, key) => {
      for (const [name, r] of map) {
        const cur = merged.get(name) || { damage: 0, heal: 0, hits: 0, isPet: false, unknownPets: false, isOther: false };
        cur[key] += r.damage; // r.damage is just "the amount" here regardless of which pass it came from
        cur.hits += r.hits;
        cur.isPet = cur.isPet || !!r.isPet;
        cur.unknownPets = cur.unknownPets || !!r.unknownPets;
        cur.isOther = cur.isOther || !!r.isOther;
        merged.set(name, cur);
      }
    };
    fold(dmgAgg.agg, 'damage');
    fold(healAgg.agg, 'heal');

    const grandDamage = [...merged.values()].reduce((s, r) => s + r.damage, 0);
    const grandHeal = [...merged.values()].reduce((s, r) => s + r.heal, 0);
    const grandTotal = grandDamage + grandHeal;
    if (grandTotal <= 0) return [];

    const rows = [...merged.entries()]
      .map(([name, r]) => ({ name, damage: r.damage, heal: r.heal, total: r.damage + r.heal, isPet: r.isPet, unknownPets: r.unknownPets, isOther: r.isOther }))
      .sort((a, b) => {
        const aSummary = a.name === 'Pets' || a.name === 'Other';
        const bSummary = b.name === 'Pets' || b.name === 'Other';
        if (aSummary !== bSummary) return aSummary ? 1 : -1;
        return b.total - a.total;
      });
    const top = rows.length ? rows[0].total : 0;

    const dmgRate = (v) => `${formatDamage(dmgSecs > 0 ? Math.round(v / dmgSecs) : 0)}/s`;
    const healRate = (v) => `${formatDamage(healSecs > 0 ? Math.round(v / healSecs) : 0)}/s`;

    const tiles = rows.map((r) => {
      // Each number's share is of its OWN grand total (this row's damage against everyone's
      // damage, this row's healing against everyone's healing) - not one combined %, since a
      // player who only heals would otherwise show a meaningless "share of damage+healing" figure
      // next to their damage number. See the value-text fields below.
      const dmgPct = grandDamage > 0 ? Math.round((r.damage / grandDamage) * 100) : 0;
      const healPct = grandHeal > 0 ? Math.round((r.heal / grandHeal) * 100) : 0;
      const dmg = formatDamage(r.damage);
      const heal = formatDamage(r.heal);
      // Three readings of each of the two numbers (cumulative / rate / "cumulative (rate)"),
      // mirroring _tilesFrom - the overlay picks. The share % rides its own right-aligned column
      // (damagePctText / healPctText, owner 5 Sep), never inline.
      const damageValueText = dmg;
      const healValueText = heal;
      const damageDpsText = dmgRate(r.damage);
      const healDpsText = healRate(r.heal);
      const damageBothText = `${dmg} (${dmgRate(r.damage)})`;
      const healBothText = `${heal} (${healRate(r.heal)})`;
      return {
        name: r.name,
        // Combined fallback strings for any consumer that only understands one value string.
        valueText: `${damageValueText}  /  ${healValueText}`,
        dpsText: `${damageDpsText}  /  ${healValueText}`,
        bothText: `${damageBothText}  /  ${healValueText}`,
        // The two pieces the overlay draws separately, each anchored to (coloured the same as) its
        // own bar segment - see barSplit below and overlay.js's updateRef.
        damageValueText,
        healValueText,
        damageDpsText,
        healDpsText,
        damageBothText,
        healBothText,
        damagePctText: `${dmgPct}%`,
        healPctText: `${healPct}%`,
        barPercent: top > 0 ? Math.max(0, Math.min(100, (r.total / top) * 100)) : 0,
        // What fraction of THIS row's own bar length is the damage portion - the overlay paints a
        // hard-edged two-colour gradient at this split rather than drawing two separate bar
        // elements. 0 when the row is healing-only, 1 when it's damage-only.
        barSplit: r.total > 0 ? r.damage / r.total : 0,
        isPet: r.isPet,
        unknownPets: r.unknownPets,
        isOther: r.isOther,
        ...INERT_TIMER_FIELDS,
      };
    });

    tiles.push({
      name: 'Total',
      totalRow: true,
      sinceZone: !!sinceZone,
      scope: dmgAgg.scope,
      scopeFellBack: dmgAgg.fellBack,
      // Static (non-cycling) Both mode: the Total shows the full picture on its one line.
      valueText:
        `${formatDamage(grandDamage)} dmg (${dmgRate(grandDamage)}) / ` +
        `${formatDamage(grandHeal)} heal (${healRate(grandHeal)})`,
      // Cycling Both mode: the Total flips between these two on the same interval as the rows
      // (owner, 5 Sep). No share % - a total is always 100% of itself.
      damageTotalText: `${formatDamage(grandDamage)} (${dmgRate(grandDamage)})`,
      healTotalText: `${formatDamage(grandHeal)} (${healRate(grandHeal)})`,
      barPercent: null,
      noBar: true,
      ...INERT_TIMER_FIELDS,
    });

    return tiles;
  }

  /**
   * The collapsing step alone - raw per-name amounts folded into the display buckets one scope
   * allows (self / own pets / "Pets" / "Charmed pets" / "Other" / plain named rows), with the
   * raw-tally reconciliation for a late-recognised friend. Split out of _tilesFrom so the SAME
   * collapsing method can be run twice (once for damage, once for healing) and merged into one
   * combined row set for 'both' mode, rather than reimplementing any of this a second time.
   *
   * @param scope 'all' (everyone in the fight, today's behaviour), 'group' (you + anyone admitted
   *   to your group this session + your charmed pets + a groupmate's charmed pet), or 'mine' (you +
   *   your charmed pets only). For 'group'/'mine' the total and every share % are recomputed over
   *   ONLY the rows the scope keeps - non-scope damage is not counted at all, not merely hidden.
   *   An empty group roster makes 'group' fall back to 'all', flagged on the total row.
   * @returns { agg: Map<displayName, {damage, hits, isPet, unknownPets, isOther}>, scope, fellBack }
   *   `scope` is the EFFECTIVE scope actually applied (may differ from the requested one - see
   *   `fellBack` below).
   */
  _aggregate(byAttacker, scope = 'all', pets = null, rawByName = null, metric = 'damage') {
    // Reconcile the classified tally with the raw one (see the rawFightByName / rawZoneByName field
    // comment). For a name that is a CONFIRMED friend right now - the player, someone in the group
    // roster, or a name the bootstrap already added to `friends` - its outgoing damage is fully in
    // the raw tally, so use whichever figure is larger. This is what makes the split retroactive: a
    // groupmate credited to "Other" (or not credited at all) while unrecognised gets their complete
    // damage the moment they're recognised, rather than only what landed after. Enemies and
    // still-unknown names are untouched - raw is not consulted for them.
    const effective = new Map(byAttacker);
    if (rawByName) {
      for (const [rawName, r] of rawByName) {
        const key = rawName.toLowerCase();
        const confirmedFriend =
          key === 'you' || key === 'yourself' || this.friends.has(key) || this._isGroupMember(key);
        if (!confirmedFriend) continue;
        // On the heal side, a name shaped like a mob that petTracker can't vouch for is never
        // topped up from the raw tally - it only reached `friends` through charm-war bootstrap
        // pollution, and its self-heals are not your group's healing (gotcha #40).
        if (metric === 'heal' && isArticlePrefixedMobName(rawName) && !this._petVouchesFor(key)) continue;
        const cur = effective.get(rawName) || { damage: 0, hits: 0 };
        if (r.damage > cur.damage) effective.set(rawName, { damage: r.damage, hits: Math.max(r.hits, cur.hits) });
      }
    }
    byAttacker = effective;
    const admittedList = (() => {
      try {
        return (this.groupFn() || []).map((n) => String(n).toLowerCase());
      } catch {
        return [];
      }
    })();
    let fellBack = false;
    if (scope === 'group' && admittedList.length === 0) {
      scope = 'all';
      fellBack = true;
    }
    const admits = (nameLower) => admittedList.includes(nameLower);
    const ownPetKey = pets ? pets.ownPetKeyByName : new Map();
    const unknownPets = pets ? pets.unknownPetNames : new Set();
    const allyPetLeader = pets ? pets.allyPetLeader : new Map();

    // Fold raw attacker rows into the display buckets the scope allows. Anything the scope excludes
    // never enters `agg`, so `totalDamage` and the shares below are its own denominator.
    const agg = new Map(); // displayName -> { damage, hits, isPet, unknownPets }
    const bump = (name, r, extra) => {
      const cur = agg.get(name) || { damage: 0, hits: 0 };
      cur.damage += r.damage;
      cur.hits += r.hits;
      agg.set(name, Object.assign(cur, extra || {}));
    };

    for (const [rawName, r] of byAttacker) {
      const key = rawName.toLowerCase();
      const isSelf = rawName === 'You' || key === 'you' || key === 'yourself';
      const petKey = ownPetKey.get(key);
      const allyLeader = allyPetLeader.get(key);

      if (unknownPets.has(key)) {
        // Never attributed to a person - one combined row, and not shown in 'mine'.
        if (scope !== 'mine') bump('Charmed pets', r, { unknownPets: true });
        continue;
      }
      if (isSelf) {
        bump('You', r);
        continue;
      }
      if (petKey) {
        // Own pet: kept distinct across re-charms by the #gen in its key.
        bump(petKey, r, { isPet: true });
        continue;
      }
      // A possessive-named pet ("Chrysaetos`s pet") is unambiguously a pet whoever owns it - fold
      // every one into a single "Pets" row, in every scope that shows other people at all. (Owner,
      // 1-2 Sep: her + her group get their own rows; identifiable pets share a "Pets" row.)
      if (isPossessivePetName(rawName)) {
        if (scope === 'mine') continue;
        const owner = (petOwnerFromName(rawName) || '').toLowerCase();
        if (scope === 'group' && !admits(owner)) continue;
        bump('Pets', r, { isPet: true });
        continue;
      }

      // An article-prefixed name ("a Teir`Dal rogue", "an ancient sarnak") that has been classified
      // as a friendly attacker is a charmed monster fighting on your side - no player is named this
      // way (gotcha #20). petTracker catches the ones with a visible charm line (handled above via
      // unknownPets); this is the fallback for a charm cast before launch, or by someone else
      // off-log, or a wild charm. Fold into the one "Charmed pets" row rather than letting a
      // monster name sit next to the players. Safe even with an empty group roster - it can never
      // be the "outsider vs groupmate" ambiguity the admittedList.length===0 fallback exists for.
      if (isArticlePrefixedMobName(rawName)) {
        // Damage: a wild charm with no "has been charmed." line still fought on your side - show
        // its contribution in the one combined row (the fallback gotcha #40 describes). Healing:
        // there is nothing real to show - an unvouched mob "healing" is charm-war crossfire, not
        // your group - so it is dropped rather than inflating a phantom "Charmed pets" heal row.
        if (metric !== 'heal' && scope !== 'mine') bump('Charmed pets', r, { unknownPets: true });
        continue;
      }

      if (scope === 'mine') continue;
      if (scope === 'group') {
        if (allyLeader && admits(allyLeader)) bump(rawName, r, { isPet: true });
        else if (admits(key)) bump(rawName, r);
        continue;
      }

      // scope 'all'. Her + anyone the group roster has admitted this session get their own row.
      // Everyone else: a summoned-pet-shaped name (corroboration only - the roster is primary, so
      // this only fires for a name the roster does NOT vouch for) goes to "Pets"; any other
      // outsider goes to "Other". If the roster is empty (grouped before launch, or a restart) we
      // can't tell an outsider from a groupmate, so everyone keeps their own row - the pre-existing
      // behaviour - and only possessive pets (handled above, roster-independent) still fold.
      if (admittedList.length === 0 || admits(key)) {
        bump(rawName, r);
      } else if (looksLikeGeneratedPetName(rawName)) {
        bump('Pets', r, { isPet: true });
      } else {
        bump('Other', r, { isOther: true });
      }
    }

    return { agg, scope, fellBack };
  }

  // Single-metric tiles (damage-only or healing-only), built from one _aggregate() pass. See
  // _aggregate's own comment for the collapsing rules and the scope parameter.
  _tilesFrom(byAttacker, secs, sinceZone, scope = 'all', pets = null, rawByName = null, metric = 'damage') {
    const agg1 = this._aggregate(byAttacker, scope, pets, rawByName, metric);
    const agg = agg1.agg;
    scope = agg1.scope;
    const fellBack = agg1.fellBack;

    const totalDamage = [...agg.values()].reduce((s, r) => s + r.damage, 0);
    const rows = [...agg.entries()]
      .map(([name, r]) => ({ name, damage: r.damage, hits: r.hits, isPet: !!r.isPet, unknownPets: !!r.unknownPets, isOther: !!r.isOther }))
      // biggest first, but the "Pets" and "Other" summary rows always sink to the bottom above the
      // total, regardless of how much damage they carry.
      .sort((a, b) => {
        const aSummary = a.name === 'Pets' || a.name === 'Other';
        const bSummary = b.name === 'Pets' || b.name === 'Other';
        if (aSummary !== bSummary) return aSummary ? 1 : -1;
        return b.damage - a.damage;
      });
    const top = rows.length ? rows[0].damage : 0;
    if (totalDamage <= 0) return [];

    const tiles = rows.map((r) => {
      const pct = `${Math.round((r.damage / totalDamage) * 100)}%`;
      const dmg = formatDamage(r.damage);
      const rate = `${formatDamage(Math.round(r.damage / secs))}/s`;
      return {
        name: r.name,
        // Three readings of the same value - the aura picks one where the tile is drawn (see
        // damageValueMode). The share % is NOT in these any more - it rides its own right-aligned
        // column (pctText, owner 5 Sep), so the numbers line up.
        valueText: dmg,
        dpsText: rate,
        bothText: `${dmg} (${rate})`,
        pctText: pct,
        // Against the BIGGEST row, not against the total. A bar measured against the total leaves
        // every bar short in a five-person group, with even the longest only a fifth of the way
        // across - which reads as everybody doing badly rather than as a comparison.
        barPercent: top > 0 ? Math.max(0, Math.min(100, (r.damage / top) * 100)) : 0,
        // `isPet` - a charmed pet you or a groupmate own (own pets carry a #gen in the name).
        // `unknownPets` - the combined "Charmed pets" row for owner-unknown charms. Both are
        // display hints for the overlay; nothing downstream needs them.
        isPet: r.isPet,
        unknownPets: r.unknownPets,
        isOther: r.isOther,
        ...INERT_TIMER_FIELDS,
      };
    });

    // Always emitted, at the BOTTOM (owner's call). An aura that does not want it drops it when it
    // draws - see the overlay - which is what lets one meter show it and another not, from one
    // engine. `noBar` because the total is not a comparison against anything, so a full-width bar
    // just adds noise; it draws as a plain label + value line.
    tiles.push({
      name: 'Total',
      // `totalRow` is what the overlay's mine-only / hide-total filters key off, so the row keeps
      // being recognised as the total whatever its label reads. `sinceZone` marks the between-pulls
      // view. The Total is the fight summary and always shows both its damage and its rate,
      // whatever damageValueMode the attacker rows are set to - it carries only `valueText`, so the
      // overlay's mode switch leaves it alone.
      totalRow: true,
      sinceZone: !!sinceZone,
      // `scope` is what this row set was actually built for; `scopeFellBack` is set when a 'group'
      // request had no roster to filter on and quietly became 'all'.
      scope,
      scopeFellBack: fellBack,
      valueText: `${formatDamage(totalDamage)}  ${formatDamage(Math.round(totalDamage / secs))}/s`,
      barPercent: null,
      noBar: true,
      ...INERT_TIMER_FIELDS,
    });

    return tiles;
  }
}

// The fields that tell every existing code path this tile is not a timer, so nothing downstream
// counts it down, sorts it by time remaining, or beeps when it "expires". Spread into every row
// rather than repeated, so a row can never accidentally carry half of them.
const INERT_TIMER_FIELDS = {
  remainingSec: null,
  durationSec: 0,
  infinite: true,
  instant: false,
  landedAt: null,
  showOnOverlay: true,
  iconUrl: null,
  isBardSong: false,
  spellCategory: null,
};

// 1,234 reads as 1.2k on a tile the width of a name. Under 10,000 the exact number still fits and
// is more use than a rounded one.
function formatDamage(n) {
  if (n < 10000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(2)}m`;
}

module.exports = { DamageEngine, formatDamage, DEFAULT_FIGHT_TIMEOUT_SEC };
