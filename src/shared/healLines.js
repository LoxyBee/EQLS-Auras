'use strict';
/**
 * Reading a heal line out of the EverQuest log. Same reasoning as damageLines.js - mined from real
 * wordings across the owner's logs, not assumed - and the same principle: never guess at a name.
 *
 * Every heal line names both parties outright: "<Healer> healed <Target> for N (M) hit points by
 * <Spell>." - there is no possessive trap and no melee-shaped ambiguity to resolve, because a heal
 * line is never the "who is fighting whom" shape a damage line can be. Two wrinkles instead:
 *
 *  - A self-heal repeats a pronoun ("healed himself/herself/itself") instead of the caster's own
 *    name, and a maintained HoT tick on that same caster inserts "over time" before "for" (measured
 *    live: "Adhemar healed himself over time for 20 hit points by Regrowth."). Both are folded back
 *    to a plain target = healer by parseHealLine so nothing downstream has to special-case them.
 *  - EQ appends a parenthetical (M) on an overhealed cast - "Avenrae healed herself for 0 (6) hit
 *    points..." is someone at full HP absorbing a 6-point heal for 0 net effect. N, not M, is what
 *    actually applied and the number that belongs on a meter; M is discarded.
 *
 * One wording is deliberately NOT attributed: "<Target> has been healed over time for N hit points
 * by <Spell>." never names a healer at all (72 lines out of ~582,000 measured - a HoT tick relayed
 * without its caster). There is no name to credit it to, so it is dropped rather than guessed at -
 * the same "no evidence, no attribution" rule the rest of this project's detection follows.
 */

// A trailing " (Critical)" the game appends to some heal lines, same shape as damageLines' own
// CRIT_SUFFIX (1,209 of the "You healed" lines carry one, measured).
const CRIT_SUFFIX = /(?: \([A-Za-z ]+\))?/.source;

// Matches "<Target> has been healed over time for N (M) hit points by <Spell>." with no healer
// named at all. Checked BEFORE the general HEAL pattern below, which would otherwise misparse the
// leading "<Target> has been" as a nonsense "healer" name (both contain the word "healed").
const PASSIVE_HOT = new RegExp(
  `^(.+?) has been healed over time for ([0-9]+)(?: \\([0-9]+\\))? hit points(?: by (.+?))?\\.${CRIT_SUFFIX}$`
);

// "<Healer> healed <Target>[ over time] for N[ (M)] hit points[ by <Spell>]." - covers first person
// ("You healed ...") the same as third person, since "You" is just another name in this shape.
const HEAL = new RegExp(
  `^(.+?) healed (.+?)(?: over time)? for ([0-9]+)(?: \\([0-9]+\\))? hit points(?: by (.+?))?\\.${CRIT_SUFFIX}$`
);

// Same timestamp shape every other log-line parser in this project strips first.
const STAMP = /^\[\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4}\]\s*/;

/**
 * One heal line, or null.
 *
 * Returns { healer, target, amount, spell }. healer/target are the literal string 'You' for the
 * player, kept untranslated exactly like damageLines' 'attacker' field so nothing downstream needs
 * to know the character's name to find her row. A self-heal (pronoun target) resolves target back
 * to the healer's own name/'You'.
 */
function parseHealLine(line) {
  if (typeof line !== 'string') return null;
  const body = line.replace(STAMP, '');

  // No healer named - nothing to attribute this to. See the file header.
  if (PASSIVE_HOT.test(body)) return null;

  const m = HEAL.exec(body);
  if (!m) return null;
  const healer = m[1];
  let target = m[2];
  const lowerTarget = target.toLowerCase();
  if (lowerTarget === 'himself' || lowerTarget === 'herself' || lowerTarget === 'itself') {
    target = healer;
  } else if (lowerTarget === 'yourself' || lowerTarget === 'you') {
    target = 'You';
  }
  return { healer, target, amount: Number(m[3]), spell: m[4] || null };
}

module.exports = { parseHealLine };
