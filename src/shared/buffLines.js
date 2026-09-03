'use strict';

// The buff-stacking model - see docs/BUFF-STACKING.md and src/shared/data/buff-lines.json.
//
// A "heading" is a slot: two buffs on the same heading are mutually exclusive, buffs on different
// headings stack. A "line" is an upgrade ladder that shares one (or more) headings; its `members`
// are ordered low->high tier. `blockedPairs` are directional ground-truth mined from real logs.
//
// This module is pure data + lookups. It knows nothing about the roster, the character, or what is
// castable - callers pass that in. It is the FIRST authority everywhere; anything it returns
// 'unknown' for falls back to the full ported EQEmu engine (src/main/stackingService.js) in the
// callers (buffPlanner, buffEngine).

let DATA = require('./data/buff-lines.json');
let cache = null;

// Tests only - swap in a hand-built { headings, lines, blockedPairs } and reset the index. Pass
// nothing to restore the shipped data.
function loadData(custom) {
  DATA = custom || require('./data/buff-lines.json');
  cache = null;
}

// "Yaulp III" / "Spirit of Puma Rk. II" -> "yaulp" / "spirit of puma". Trailing rank marker only.
function baseName(name) {
  return String(name || '')
    .replace(/\s+(?:Rk\.?\s*)?(?:[IVXLCDM]+|\d+)$/i, '')
    .trim()
    .toLowerCase();
}

function index() {
  if (cache) return cache;
  const lineById = new Map();
  const lineByMember = new Map(); // exact lowercase name -> line
  const lineByBase = new Map(); // rank-stripped lowercase -> line (fallback)
  for (const line of DATA.lines) {
    lineById.set(line.id, line);
    line.members.forEach((m, i) => {
      const lower = m.toLowerCase();
      lineByMember.set(lower, line);
      if (!lineByBase.has(baseName(m))) lineByBase.set(baseName(m), line);
    });
  }
  // directional: `${blocked}` is refused while `${by}` is up.
  const blockedBy = new Map(); // "blocked||by" (lowercase) -> true
  for (const p of DATA.blockedPairs) {
    blockedBy.set(`${p.blocked.toLowerCase()}||${p.by.toLowerCase()}`, true);
  }
  cache = { lineById, lineByMember, lineByBase, blockedBy };
  return cache;
}

function lineForName(name) {
  if (!name) return null;
  const { lineByMember, lineByBase } = index();
  return lineByMember.get(String(name).toLowerCase()) || lineByBase.get(baseName(name)) || null;
}

// Index of `name` within its line's members (its tier rank), or -1.
function tierOf(line, name) {
  if (!line) return -1;
  const lower = String(name).toLowerCase();
  let i = line.members.findIndex((m) => m.toLowerCase() === lower);
  if (i === -1) i = line.members.findIndex((m) => baseName(m) === baseName(name));
  return i;
}

function headingsForName(name) {
  const line = lineForName(name);
  return line ? line.headings.slice() : [];
}

// The highest-tier member of `line` for which canCast(name) is true. null if none.
function bestCastableMember(line, canCast) {
  if (!line) return null;
  for (let i = line.members.length - 1; i >= 0; i--) {
    if (canCast(line.members[i])) return line.members[i];
  }
  return null;
}

// "`incoming` just landed while `active` is already up - what happens to `active`?"
//   'overwrites' - active is replaced / downgraded (drop the active tile, or drop it as a planner candidate)
//   'blocked'    - incoming could not land; active stays (planner should not have placed incoming)
//   'coexist'    - different headings, both stay
//   'unknown'    - no line data for one or both; caller falls back to the ported stacking engine
//                  (src/main/stackingService.js)
function stackDecision(incomingName, activeName) {
  if (!incomingName || !activeName) return 'unknown';
  if (incomingName.toLowerCase() === activeName.toLowerCase()) return 'overwrites'; // a recast/refresh

  const { blockedBy } = index();
  if (blockedBy.get(`${incomingName.toLowerCase()}||${activeName.toLowerCase()}`)) return 'blocked';
  if (blockedBy.get(`${activeName.toLowerCase()}||${incomingName.toLowerCase()}`)) return 'overwrites';

  const iL = lineForName(incomingName);
  const aL = lineForName(activeName);
  if (!iL || !aL) return 'unknown';

  if (iL.id === aL.id) return 'overwrites'; // same line = same heading, the new cast holds it

  // Combination buffs block the individual lines they subsume, in whichever direction.
  if (iL.combination && (iL.blocks || []).includes(aL.id)) return 'overwrites';
  if (aL.combination && (aL.blocks || []).includes(iL.id)) return 'blocked';

  // Explicitly recorded stacks (Frenzy line + Strength line, Infusion + individual stats, ...).
  if ((iL.stacksWith || []).includes(aL.id) || (aL.stacksWith || []).includes(iL.id)) return 'coexist';

  // Explicitly recorded cross-class conflict, or a shared heading.
  const shareHeading = iL.headings.some((h) => aL.headings.includes(h));
  if (shareHeading) return 'overwrites';
  if ((iL.conflictsWith || []).includes(aL.id) || (aL.conflictsWith || []).includes(iL.id)) return 'overwrites';

  return 'coexist';
}

function headingLabel(id) {
  return DATA.headings[id] || id;
}

// The REASON behind a non-'coexist' stackDecision, for the planner's "why was this dropped"
// tooltip. One of: 'blocked-pair' (a real "did not take hold (Blocked by X)" log line),
// 'same-line' (an upgrade tier of the same buff), 'combination' (a combo buff subsumes the other),
// 'shared-slot' (two lines that occupy the same heading), 'cross-class' (an explicit conflictsWith),
// or null when they coexist / it's unknown.
function stackReason(incomingName, activeName) {
  if (!incomingName || !activeName) return null;
  const i = incomingName.toLowerCase();
  const a = activeName.toLowerCase();
  if (i === a) return 'same-line';
  const { blockedBy } = index();
  if (blockedBy.get(`${i}||${a}`) || blockedBy.get(`${a}||${i}`)) return 'blocked-pair';
  const iL = lineForName(incomingName);
  const aL = lineForName(activeName);
  if (!iL || !aL) return null;
  if (iL.id === aL.id) return 'same-line';
  if ((iL.combination && (iL.blocks || []).includes(aL.id)) || (aL.combination && (aL.blocks || []).includes(iL.id))) {
    return 'combination';
  }
  if ((iL.stacksWith || []).includes(aL.id) || (aL.stacksWith || []).includes(iL.id)) return null;
  if (iL.headings.some((h) => aL.headings.includes(h))) return 'shared-slot';
  if ((iL.conflictsWith || []).includes(aL.id) || (aL.conflictsWith || []).includes(iL.id)) return 'cross-class';
  return null;
}

// True only when the two lines carry an EXPLICIT `stacksWith` link - a deliberate "these coexist"
// declaration (bard haste songs + spell haste, Frenzy line + Strength line, ...). A plain 'coexist'
// from stackDecision can also just mean "no shared heading and no recorded conflict" - i.e. an
// absence of evidence, which the full ported engine is allowed to overrule. This tells the two
// apart so the engine only ever vetoes the weak kind.
function stacksExplicitly(nameA, nameB) {
  const a = lineForName(nameA);
  const b = lineForName(nameB);
  if (!a || !b) return false;
  return (a.stacksWith || []).includes(b.id) || (b.stacksWith || []).includes(a.id);
}

function resetCache() {
  cache = null;
}

module.exports = {
  lineForName,
  tierOf,
  headingsForName,
  bestCastableMember,
  stackDecision,
  stackReason,
  stacksExplicitly,
  headingLabel,
  loadData,
  resetCache,
  get data() {
    return DATA;
  },
};
