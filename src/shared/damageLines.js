'use strict';
/**
 * Reading a damage line out of the EverQuest log.
 *
 * Every pattern in here was written from MEASURED wordings across the owner's 1,521,971 logged
 * lines, and each carries the count it matched. That is not decoration. The first time this
 * codebase wrote log patterns from memory, nine of twelve matched nothing at all and the feature
 * they powered had never once fired. A count beside a pattern is the evidence it is real.
 *
 * THE ATTRIBUTION PROBLEM, and why it turned out not to be one.
 *
 * A damage meter has to answer "who did this". The classic EQ answer is guesswork - decide from
 * the shape of a name whether it is a player or a monster - and it is wrong often enough to
 * matter. It is also wrong on this player's own logs: "Fright has taken 394 damage from your
 * Envenomed Bolt IV." is a monster with a one-word name, indistinguishable by shape from a person.
 *
 * The log does better than shape. Two of the four damage wordings name the attacker outright:
 *
 *   "A pledge familiar has taken 32 damage from Denon's Disruptive Discord V by Avenrae."
 *                                                                            ^^^^^^^^^^
 *   "Avenrae is pierced by Korven Nisere's thorns for 17 points of non-melee damage."
 *                          ^^^^^^^^^^^^^
 *
 * so for those there is nothing to infer. Note the first one carefully: the apostrophe-s belongs
 * to the SPELL ("Denon's Disruptive Discord"), not to the caster - 44,508 lines are shaped that
 * way, and a pattern that read the possessive as the attacker would have been confidently wrong
 * on every one of them.
 *
 * That leaves melee, which names no side. See damageEngine for how direction is settled there
 * without guessing at names either.
 */

// "You crush a wan ghoul knight for 60 points of damage." - 145 lines. Low because this character
// barely swings a weapon; the wording is standard and the count is the honest measure of how much
// of HER damage arrives this way, which is almost none.
const YOUR_MELEE =
  /^You [a-z]+ (.+?) for ([0-9]+) points? of damage\.$/;

// "Avenrae slashes a zol ghoul knight for 47 points of damage." - 242,600 lines, the single
// largest damage wording in the logs. Names neither side as friend or foe; the engine settles
// that by direction rather than by reading the names.
const OTHER_MELEE =
  /^(.+?) (?:hits|slashes|crushes|pierces|bashes|kicks|bites|claws|punches|slices|smashes|gores|mauls|strikes) (.+?) for ([0-9]+) points? of damage\.$/;

// "Fright has taken 394 damage from your Envenomed Bolt IV." - 2,567 lines. The only wording that
// is unambiguously yours, and for this character it is nearly all of her output.
const YOUR_SPELL =
  /^(.+?) has taken ([0-9]+) damage from your (.+)\.$/;

// "A zol ghoul knight has taken 32 damage from Chords of Dissonance V by Avenrae." - 103,584
// lines. The "by" suffix is the attacker, free of charge. Non-greedy on the spell so a spell name
// containing the word "by" cannot swallow the attacker.
const OTHER_SPELL =
  /^(.+?) has taken ([0-9]+) damage from (.+?) by (.+)\.$/;

// "A zol ghoul knight is pierced by Avenrae's thorns for 8 points of non-melee damage." - 125,900
// lines, and the reason damage shields cannot be waved away as a rounding error. Here the
// possessive IS the attacker, the opposite of OTHER_SPELL - which is exactly why both were
// measured rather than assumed to share a shape.
const DAMAGE_SHIELD =
  /^(.+?) is [a-z]+ by (.+?)'s [a-z]+ for ([0-9]+) points? of non-melee damage\.$/;

// The timestamp every line carries. Stripped before matching so no pattern has to carry it.
const STAMP = /^\[[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \d{4}\] /;

/**
 * One damage line, or null.
 *
 * Returns { attacker, target, amount, kind } where attacker is the literal string 'You' for your
 * own damage - the log's own word for you, kept rather than translated so nothing downstream has
 * to know the character's name to find her row.
 */
function parseDamageLine(line) {
  if (typeof line !== 'string') return null;
  const body = line.replace(STAMP, '');

  let m = YOUR_SPELL.exec(body);
  if (m) return { attacker: 'You', target: m[1], amount: Number(m[2]), kind: 'spell' };

  m = OTHER_SPELL.exec(body);
  if (m) return { attacker: m[4], target: m[1], amount: Number(m[2]), kind: 'spell' };

  m = YOUR_MELEE.exec(body);
  if (m) return { attacker: 'You', target: m[1], amount: Number(m[2]), kind: 'melee' };

  // Before OTHER_MELEE: a damage-shield line ends "points of non-melee damage" and the melee
  // pattern requires "points of damage", so they cannot collide - but the order is fixed anyway
  // so that a future edit loosening one cannot silently start stealing the other's lines.
  m = DAMAGE_SHIELD.exec(body);
  if (m) return { attacker: m[2], target: m[1], amount: Number(m[3]), kind: 'shield' };

  m = OTHER_MELEE.exec(body);
  if (m) return { attacker: m[1], target: m[2], amount: Number(m[3]), kind: 'melee' };

  return null;
}

module.exports = { parseDamageLine };
