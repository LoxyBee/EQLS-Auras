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
 *   "A pledge familiar has taken 32 damage from Denon's Disruptive Discord V by Baxa."
 *                                                                            ^^^^^^^^^^
 *   "Baxa is pierced by Korven Nisere's thorns for 17 points of non-melee damage."
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

// A trailing " (Critical)" (or "(Riposte)", "(Strikethrough)", ...) that the game appends to
// several wordings. 1,710 of the direct-spell lines below carry one; ~421 of the "has taken"
// wordings do too. Every pattern here tolerates it rather than dropping the hit.
const CRIT_SUFFIX = /(?: \([A-Za-z ]+\))?/.source;

// "You crush a wan ghoul knight for 60 points of damage." - 145 lines. Low because this character
// barely swings a weapon; the wording is standard and the count is the honest measure of how much
// of HER damage arrives this way, which is almost none.
const YOUR_MELEE =
  new RegExp(`^You [a-z]+ (.+?) for ([0-9]+) points? of damage\\.${CRIT_SUFFIX}$`);

// "Baxa slashes a zol ghoul knight for 47 points of damage." - 242,600 lines, the single
// largest damage wording in the logs. Names neither side as friend or foe; the engine settles
// that by direction rather than by reading the names.
//
// The verb list was 14; cross-checking against known EQ melee wordings found 12 missing, and two
// of them are common: `cleaves` (warrior) and `frenzies on` (berserker/monk) - together an
// estimated ~5% of all melee, silently uncounted. The rest
// (smites, stings, backstabs, shoots, reaves, slams, rends, gnaws, lashes, flurries) are rarer but
// real. "frenzies on" carries its "on" as part of the verb.
const OTHER_MELEE =
  new RegExp(`^(.+?) (?:hits|slashes|crushes|pierces|bashes|kicks|bites|claws|punches|slices|smashes|gores|mauls|strikes|cleaves|smites|stings|backstabs|shoots|reaves|slams|rends|gnaws|lashes|flurries|frenzies on) (.+?) for ([0-9]+) points? of damage\\.${CRIT_SUFFIX}$`);

// "Fright has taken 394 damage from your Envenomed Bolt IV." - 2,567 lines. A DoT tick or a proc
// that names you only as "your". Distinct from the direct nuke wording below ("You hit X ... by").
const YOUR_SPELL =
  new RegExp(`^(.+?) has taken ([0-9]+) damage from your (.+?)\\.${CRIT_SUFFIX}$`);

// "A zol ghoul knight has taken 32 damage from Chords of Dissonance V by Baxa." - 103,584
// lines. The "by" suffix is the attacker, free of charge. Non-greedy on the spell so a spell name
// containing the word "by" cannot swallow the attacker.
const OTHER_SPELL =
  new RegExp(`^(.+?) has taken ([0-9]+) damage from (.+?) by (.+?)\\.${CRIT_SUFFIX}$`);

// "You hit a greater kobold for 943 points of magic damage by Energy Storm. (Critical)" - 1,888
// first-person lines. "Gebektik hit Guard Xyxax for 42 points of magic damage by Lifebite." -
// 19,453 third-person. The caster's DIRECT nuke (magic / fire / cold / unresistable / ...),
// the wording the whole meter was missing for a nuking loadout. "hit" is SINGULAR for everyone,
// first and third person, unlike OTHER_MELEE's plural verbs. "You hit yourself ... by
// Cannibalization" (67 lines, the HP->mana self-cost) is excluded in parseDamageLine so the
// bootstrap does not tag "yourself" as an enemy.
const DIRECT_SPELL =
  new RegExp(`^(.+?) hit (.+?) for ([0-9]+) points? of [a-z]+ damage by (.+?)\\.${CRIT_SUFFIX}$`);

// "A zol ghoul knight is pierced by Baxa's thorns for 8 points of non-melee damage." - 125,900
// lines, and the reason damage shields cannot be waved away as a rounding error. Here the
// possessive IS the attacker, the opposite of OTHER_SPELL - which is exactly why both were
// measured rather than assumed to share a shape.
//
// When the PLAYER holds the shield, EQ writes "YOUR" instead of a possessive:
// "A rock golem is pierced by YOUR thorns for 5 points of non-melee damage." - almost every DS
// line where the player holds the shield is this form, so the old `(.+?)'s` matched ~1 in 20. The DS
// skill name is `(.+?)` non-greedy now, not one lowercase word, so a multi-word or capitalised
// shield name still parses.
const DAMAGE_SHIELD =
  /^(.+?) is [a-z]+ by (YOUR|.+?'s) (.+?) for ([0-9]+) points? of non-melee damage\.$/;

// The timestamp every line carries. Stripped before matching so no pattern has to carry it.
// EQ space-pads a single-digit day ("[Fri Aug  1 21:00:00 2026]" - two spaces, one digit), so this
// must allow \s+ and \d{1,2}, matching buffParser.js - the old `\d{2}` + single space broke every
// damage line on days 1-9 of a month.
const STAMP = /^\[\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4}\]\s*/;

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

  m = DIRECT_SPELL.exec(body);
  if (m) {
    // "You hit yourself for 1864 ... by Cannibalization" is an HP->mana self-cost, not outgoing
    // damage - let it fall through to null so the bootstrap never sees "yourself" as an enemy.
    if (m[2].toLowerCase() !== 'yourself') {
      return { attacker: m[1], target: m[2], amount: Number(m[3]), kind: 'spell' };
    }
  }

  m = YOUR_MELEE.exec(body);
  if (m) return { attacker: 'You', target: m[1], amount: Number(m[2]), kind: 'melee' };

  // Before OTHER_MELEE: a damage-shield line ends "points of non-melee damage" and the melee
  // pattern requires "points of damage", so they cannot collide - but the order is fixed anyway
  // so that a future edit loosening one cannot silently start stealing the other's lines.
  m = DAMAGE_SHIELD.exec(body);
  if (m) {
    const attacker = m[2] === 'YOUR' ? 'You' : m[2].replace(/'s$/, '');
    return { attacker, target: m[1], amount: Number(m[4]), kind: 'shield' };
  }

  m = OTHER_MELEE.exec(body);
  if (m) return { attacker: m[1], target: m[2], amount: Number(m[3]), kind: 'melee' };

  return null;
}

module.exports = { parseDamageLine };
