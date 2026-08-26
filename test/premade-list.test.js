'use strict';
/**
 * The Add Aura list - the built premades and the "Not built yet" roadmap below them.
 *
 * These are two separate arrays in the renderer, and building a premade means adding an entry to
 * one and remembering to remove it from the other. That was forgotten twice: "Buff timer" sat in
 * both lists from the day it was built, and "Debuff on an enemy" joined it. The Add Aura list
 * showed each of them twice - once working, once greyed out as unbuilt - which reads as the app
 * being broken rather than as a bookkeeping slip.
 *
 * renderPremadeList now filters the planned list by what has been built, so the app is right
 * either way. This suite is what stops the filter being deleted as redundant.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
// Line endings normalised on the way in. The repo is CRLF, and a pattern written with \n that
// silently never matches is the worst kind of test: it passes, and it proves nothing.
const rendererSrc = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8')
  .replace(/\r\n/g, '\n');

// Pulls the name: strings out of one array literal without executing the renderer, which needs a
// DOM and an Electron bridge that do not exist here.
function namesIn(arrayName) {
  const start = rendererSrc.indexOf(`const ${arrayName} = [`);
  assert.notEqual(start, -1, `${arrayName} has been renamed or restructured`);
  // Scan to the matching close bracket rather than regex-ing to the first "];", which would stop
  // at any nested array inside an entry.
  let depth = 0;
  let end = -1;
  for (let i = rendererSrc.indexOf('[', start); i < rendererSrc.length; i += 1) {
    const c = rendererSrc[i];
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `could not find the end of ${arrayName}`);
  const body = rendererSrc.slice(start, end);
  return [...body.matchAll(/^\s*name: '([^']+)',$/gm)].map((m) => m[1]);
}

// The text of each entry in one array literal, using the same bracket scan.
function entriesIn(arrayName) {
  const start = rendererSrc.indexOf(`const ${arrayName} = [`);
  assert.notEqual(start, -1, `${arrayName} has been renamed or restructured`);
  let depth = 0;
  let end = -1;
  for (let i = rendererSrc.indexOf('[', start); i < rendererSrc.length; i += 1) {
    if (rendererSrc[i] === '[') depth += 1;
    else if (rendererSrc[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  // Split on an entry-opening brace at the array's own indent, so a nested object inside an entry
  // does not read as a new entry.
  return rendererSrc.slice(start, end).split(/\n {4}\{\n/).slice(1);
}

test('both lists are found and neither is empty', () => {
  // If either lookup silently returned nothing, every check below would pass vacuously. namesIn
  // already asserts the array itself was found, so this is guarding against a bracket scan that
  // finds the array and then extracts no names from it.
  assert.ok(namesIn('PREMADE_WIDGETS').length >= 4, 'no built premades found');
  // Deliberately 1 and not a larger floor. The roadmap SHRINKS as things get built - Damage parser
  // and Travel guide both left it on 23 August, taking it from five entries to three - so any
  // number above one is a countdown to a test that fails for the good reason that the work got
  // done. If it ever reaches zero, delete this line rather than raising the floor: an empty
  // roadmap is a real state, and the vacuous-pass risk it guards is handled by namesIn's own
  // assertion that the array exists.
  assert.ok(namesIn('PLANNED_PREMADE_WIDGETS').length >= 1, 'no planned premades found');
});

test('nothing appears in both the built list and the roadmap', () => {
  const built = new Set(namesIn('PREMADE_WIDGETS'));
  const overlap = namesIn('PLANNED_PREMADE_WIDGETS').filter((n) => built.has(n));
  assert.deepEqual(
    overlap,
    [],
    `these are offered twice in Add Aura - once working, once as "Not built yet": ${overlap.join(', ')}`
  );
});

test('the roadmap is filtered by what has been built', () => {
  // Belt and braces for the check above: even if someone adds an overlapping entry without
  // running the tests, the list on screen must not show it twice.
  assert.match(rendererSrc, /const builtNames = new Set\(PREMADE_WIDGETS\.map\(\(p\) => p\.name\)\);/);
  assert.match(rendererSrc, /PLANNED_PREMADE_WIDGETS\.filter\(\(p\) => !builtNames\.has\(p\.name\)\)/);
});

test('no premade name is duplicated within its own list', () => {
  for (const arrayName of ['PREMADE_WIDGETS', 'PLANNED_PREMADE_WIDGETS']) {
    const names = namesIn(arrayName);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dupes, [], `${arrayName} lists ${dupes.join(', ')} more than once`);
  }
});

test('every roadmap entry says it is not built', () => {
  // The greyed-out styling carries the meaning on screen; the words have to carry it too, or a
  // roadmap entry reads as a feature that is simply not working.
  const entries = entriesIn('PLANNED_PREMADE_WIDGETS');
  // Same reasoning as the floor above - the roadmap shrinks as the roadmap gets built.
  assert.ok(entries.length >= 1, `only split the roadmap into ${entries.length} entries`);
  assert.equal(
    entries.length,
    namesIn('PLANNED_PREMADE_WIDGETS').length,
    'the split does not line up with the names - one entry per name, or this proves nothing'
  );
  for (const entry of entries) {
    const name = (entry.match(/name: '([^']+)'/) || [])[1] || '(unnamed)';
    // Two reasons an entry sits here, greyed out and unclickable, and each has to say which:
    // never built ("not built yet"), or built and then deliberately taken back off the list
    // ("Locked") - Travel guide and Damage parser, 2026-08-24, both built but shipping the wrong
    // settings-panel shape for a standalone-tool aura. Either way the words have to carry the
    // meaning the greyed-out styling only implies, or the entry reads as a feature that is simply
    // broken rather than one that is not offered right now.
    assert.match(entry, /not built yet|Not built yet|Locked/, `roadmap entry "${name}" does not say why it can't be picked`);
  }
});

// ---------------------------------------------------------------------------
// Timers / Event alerts / Standalone tools - "what kind of thing is this"
// ---------------------------------------------------------------------------

// Every entry's own `group:` field, read the same bracket-scoped way entriesIn() does, so this
// stays correct if entries are reordered or the array grows.
function groupsIn(arrayName) {
  return entriesIn(arrayName).map((entry) => {
    const name = (entry.match(/name: '([^']+)'/) || [])[1] || '(unnamed)';
    const group = (entry.match(/group: '([^']+)'/) || [])[1];
    return { name, group };
  });
}

test('every entry in both lists has a group, and it is one of the three real ones', () => {
  const known = new Set(['timers', 'event-alerts', 'standalone']);
  for (const arrayName of ['PREMADE_WIDGETS', 'PLANNED_PREMADE_WIDGETS']) {
    for (const { name, group } of groupsIn(arrayName)) {
      assert.ok(group, `"${name}" in ${arrayName} has no group - it would be silently dropped from the list`);
      assert.ok(known.has(group), `"${name}" in ${arrayName} has an unrecognised group "${group}"`);
    }
  }
});

test('Ally Buffs and Bard Songs are grouped with the standalone tools, not the timers/alerts', () => {
  // Reported live 25 Aug: "it is not a shortcut, it's a custom, and needs to be recatagorised" -
  // buffFilterMode:'all' (watch every ally buff, not an explicit picked list) is set once at
  // construction by defaultAllyBuffsWidget(), and nothing in the settings panel ever calls
  // setWidgetBuffFilter with anything but 'explicit' for an ordinary custom aura - there is no
  // sequence of clicks in the custom flow that reaches it. Bard Songs is the same shape.
  const groups = groupsIn('PREMADE_WIDGETS');
  for (const name of ['Ally Buffs', 'Bard Songs']) {
    const entry = groups.find((g) => g.name === name);
    assert.ok(entry, `"${name}" is missing from PREMADE_WIDGETS`);
    assert.equal(entry.group, 'standalone', `"${name}" is not classed as a standalone tool`);
  }
});

test('Buff timer, Cooldown timer, and Debuff on an enemy are all grouped as timers', () => {
  const groups = groupsIn('PREMADE_WIDGETS');
  for (const name of ['Buff timer', 'Cooldown timer', 'Debuff on an enemy']) {
    const entry = groups.find((g) => g.name === name);
    assert.ok(entry, `"${name}" is missing from PREMADE_WIDGETS`);
    assert.equal(entry.group, 'timers', `"${name}" is not classed as a timer`);
  }
});

test('Resist flash and Dispelled are both grouped as event alerts', () => {
  const groups = groupsIn('PREMADE_WIDGETS');
  for (const name of ['Resist flash', 'You Have Been Dispelled']) {
    const entry = groups.find((g) => g.name === name);
    assert.ok(entry, `"${name}" is missing from PREMADE_WIDGETS`);
    assert.equal(entry.group, 'event-alerts', `"${name}" is not classed as an event alert`);
  }
});

test('standalone tools render last - PREMADE_GROUPS lists it after timers and event-alerts', () => {
  const fn = rendererSrc.match(/const PREMADE_GROUPS = \[([\s\S]*?)\n {2}\];/);
  assert.ok(fn, 'PREMADE_GROUPS has been restructured');
  const ids = [...fn[1].matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['timers', 'event-alerts', 'standalone'], 'group render order has changed - standalone must stay last');
});

test('planned entries render inline in their own group, not a separate "Not built yet" section', () => {
  // The old renderPlannedPremades() rendered a whole separate heading; that function - and the
  // "Not built yet" heading string that only it produced - must be gone, or a planned entry could
  // still end up sitting apart from the built ones it belongs beside.
  assert.doesNotMatch(rendererSrc, /function renderPlannedPremades/, 'renderPlannedPremades still exists as a separate render path');
  assert.doesNotMatch(rendererSrc, /'Not built yet'/, 'the old standalone "Not built yet" section heading is still being built somewhere');
});

// ---------------------------------------------------------------------------
// Add Aura modal's "back" navigation
// ---------------------------------------------------------------------------

test('the buff-timer panel\'s own Back button returns to the premade list, not all the way to Choices', () => {
  // Reported live 25 Aug: "when on this menu and hitting back, it sends you two screens back
  // instead of 1." Every .add-widget-back button used to call the same showAddWidgetChoices() no
  // matter which panel it lived in - correct for a panel reached directly from Choices (import,
  // chat, the premade list, custom), but the buff-timer panel (Buff timer/Cooldown timer/Debuff on
  // an enemy) is reached FROM the premade list, one screen further in, so its own Back button has
  // to land one screen back too, not skip past it to Choices.
  assert.match(rendererSrc, /function showAddWidgetPremadePanel\(\) \{/, 'the one-step-back-to-premade-list function is missing');
  const fn = rendererSrc.match(/const buffTimerBackBtn = document\.querySelector\('#add-widget-buff-timer-panel \.add-widget-back'\);[\s\S]*?\n {2}\}\);/);
  assert.ok(fn, 'the buff-timer panel\'s back button is no longer singled out from the rest');
  assert.match(fn[0], /showAddWidgetPremadePanel\(\)/, 'the buff-timer panel\'s back button does not call the premade-list function');
  assert.match(fn[0], /showAddWidgetChoices\(\)/, 'every other panel\'s back button should still go to Choices');
});

module.exports = () => report('premade-list');
if (require.main === module) process.exit(report('premade-list') ? 1 : 0);
