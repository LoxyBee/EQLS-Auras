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
 */

const EventEmitter = require('events');
const { parseDamageLine } = require('../shared/damageLines');

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
    this.totalDamage = 0;
    // A second tally, spanning the whole time since the last zone line rather than one fight. It
    // exists so a meter has something to show between pulls and right after zoning: getActive falls
    // back to it whenever no fight is underway. Reset wholesale on enterZone(); the fight timeout
    // never touches it.
    this.sinceZoneByAttacker = new Map();
    this.sinceZoneTotal = 0;
    this.sinceZoneStartedAt = null;
    this.sinceZoneLastAt = null;
    // Lines awaiting proof of which way they point: { attacker, target, amount, kind, at }
    this.pending = [];
    this.timeoutSec = DEFAULT_FIGHT_TIMEOUT_SEC;
    // Enemies known from elsewhere - the mez/snare/slow targets buffEngine already tracks. Lets a
    // character who debuffs but does not attack still seed the set.
    this.knownEnemiesFn = () => [];
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
  _classify(hit) {
    const a = hit.attacker.toLowerCase();
    const t = hit.target.toLowerCase();

    // Rule 1. Unambiguous from grammar alone, so it is checked before anything that could have
    // learned wrong.
    if (hit.attacker === 'You') {
      this.enemies.add(t);
      return 'out';
    }

    const attackerEnemy = this._isEnemy(hit.attacker);
    const targetEnemy = this._isEnemy(hit.target);

    // Rule 2 - damaging a known enemy makes you a friend.
    if (targetEnemy && !attackerEnemy) {
      this.friends.add(a);
      return 'out';
    }
    // Rule 3 - damaging a known friend makes you an enemy.
    if (this.friends.has(t) && !this.friends.has(a)) {
      this.enemies.add(a);
      return 'in';
    }
    // Both sides already known. No new information, but the direction is still readable.
    if (this.friends.has(a) && targetEnemy) return 'out';
    if (attackerEnemy && this.friends.has(t)) return 'in';
    return null;
  }

  handleLine(line, now = Date.now()) {
    const hit = parseDamageLine(line);
    if (!hit) return;

    const dir = this._classify(hit);
    if (dir === null) {
      // Might still become classifiable a moment from now, once one of its two names turns up in
      // a line that can be read. Held, not dropped.
      this.pending.push({ ...hit, at: now });
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      return;
    }

    // Checked BEFORE crediting, so the line that opens a new fight is not swept away by the
    // expiry of the fight it just ended.
    this._expireIfIdle(now);
    // Whatever the sets just learned may have unlocked lines held earlier, and those belong to
    // this fight - credited first, so the opening seconds of a pull are not silently missing.
    this._flushPending(now);
    if (dir === 'out') this._credit(hit.attacker, hit.amount, now);
    this.emit('activeChanged', this.getActive(now));
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
        if (dir === 'out') this._credit(p.attacker, p.amount, p.at);
      }
      this.pending = keep;
      if (!resolvedAny) return;
    }
  }

  _credit(attacker, amount, at) {
    if (this.fightStartedAt === null) this.fightStartedAt = at;
    // A retro-credited line can predate the line that opened the fight.
    if (at < this.fightStartedAt) this.fightStartedAt = at;
    const row = this.byAttacker.get(attacker) || { damage: 0, hits: 0 };
    row.damage += amount;
    row.hits += 1;
    this.byAttacker.set(attacker, row);
    this.totalDamage += amount;
    this.lastDamageAt = Math.max(this.lastDamageAt || 0, at);

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

  // A zone line. The fight state is left alone - a zone line mid-fight is rare and the timeout
  // still ends that fight correctly - but the "since zone-in" tally starts over, because that is
  // exactly what it measures.
  enterZone(now = Date.now()) {
    this.sinceZoneByAttacker.clear();
    this.sinceZoneTotal = 0;
    this.sinceZoneStartedAt = null;
    this.sinceZoneLastAt = null;
    this.emit('activeChanged', this.getActive(now));
  }

  _expireIfIdle(now) {
    if (this.lastDamageAt === null) return false;
    if (now - this.lastDamageAt < this.timeoutSec * 1000) return false;
    this.reset();
    return true;
  }

  // A fight ending does NOT clear the friend and enemy sets. The same mobs and the same group are
  // usually still there on the next pull, and forgetting them would make every pull re-bootstrap
  // from your own first hit - losing exactly the opening seconds the bootstrap exists to keep.
  reset() {
    this.byAttacker.clear();
    this.totalDamage = 0;
    this.fightStartedAt = null;
    this.lastDamageAt = null;
    this.pending = [];
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

  /**
   * Overlay tiles, biggest first.
   *
   * Deliberately the same tile shape the buff auras use, with two optional fields the overlay
   * already understands: valueText replaces the countdown, barPercent replaces the depleting bar.
   * That is the whole integration - no second renderer, and every list setting an aura already has
   * (row size, text size, colours, anchor, drag, per-loadout visibility) works here for free.
   */
  getActive(now = Date.now()) {
    // A fight is underway - the current-fight rows, as always.
    if (this.fightStartedAt !== null && this.totalDamage > 0) {
      return this._tilesFrom(this.byAttacker, this.totalDamage, this.fightSeconds(now), false);
    }
    // No fight - fall back to the running tally since the last zone line, so the meter isn't blank
    // between pulls and right after zoning. The total row carries a `sinceZone` flag so the overlay
    // can mark that this isn't the last fight's number.
    if (this.sinceZoneStartedAt !== null && this.sinceZoneTotal > 0) {
      return this._tilesFrom(this.sinceZoneByAttacker, this.sinceZoneTotal, this.sinceZoneSeconds(), true);
    }
    return [];
  }

  _tilesFrom(byAttacker, totalDamage, secs, sinceZone) {
    const rows = [...byAttacker.entries()]
      .map(([name, r]) => ({ name, damage: r.damage, hits: r.hits }))
      .sort((a, b) => b.damage - a.damage);
    const top = rows.length ? rows[0].damage : 0;

    const tiles = rows.map((r) => ({
      name: r.name,
      // Two readings of the same row, so an aura can show either without a second engine (same
      // reasoning as showTotalRow - the choice is applied where the tile is drawn). `valueText` is
      // cumulative damage + share; `dpsText` is that attacker's own rate (their damage / the fight
      // length) + the same share.
      valueText: `${formatDamage(r.damage)}  ${Math.round((r.damage / totalDamage) * 100)}%`,
      dpsText: `${formatDamage(Math.round(r.damage / secs))}/s  ${Math.round((r.damage / totalDamage) * 100)}%`,
      // Against the BIGGEST row, not against the total. A bar measured against the total leaves
      // every bar short in a five-person group, with even the longest only a fifth of the way
      // across - which reads as everybody doing badly rather than as a comparison.
      barPercent: top > 0 ? Math.max(0, Math.min(100, (r.damage / top) * 100)) : 0,
      ...INERT_TIMER_FIELDS,
    }));

    // Always emitted, at the BOTTOM (owner's call). An aura that does not want it drops it when it
    // draws - see the overlay - which is what lets one meter show it and another not, from one
    // engine. `noBar` because the total is not a comparison against anything, so a full-width bar
    // just adds noise; it draws as a plain label + value line.
    tiles.push({
      name: 'Total',
      // `totalRow` is what the overlay's mine-only / hide-total filters key off, so the row keeps
      // being recognised as the total whatever its label reads. `sinceZone` marks the between-pulls
      // view.
      totalRow: true,
      sinceZone: !!sinceZone,
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
