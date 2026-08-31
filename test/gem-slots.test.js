'use strict';
/**
 * Note 27's second half - what an aura watches, drawn as spell icons.
 *
 * Shara, 22 August: "go ahead and make the change, the gem slot look will be better than a raw
 * list. no one has any auras worth saving anyway."
 *
 * The second sentence gave permission for a migration. It turned out not to be needed, and that
 * is the main thing this suite pins.
 *
 * The note's own Risk says: "buffNames is the join between a widget's picked list and the
 * overlay's filter... Changing it from a flat name array into ordered slots with icons, without a
 * version-gated migration, would empty every custom aura anyone has already set up - the same
 * class of failure the userData pin exists to prevent."
 *
 * That risk only exists if the slots need storing. They do not. Slot order is array order, and a
 * spell's icon belongs to the spell, not to the slot it happens to sit in. So buffNames stays the
 * flat array of names it has always been, the gems are purely a rendering of it, and a share code
 * written before this change still imports. Permission to break things is not a reason to.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const css = read('src', 'renderer', 'main-window', 'main-window.css');
const storeSrc = read('src', 'main', 'widgetStore.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// conflictsWithPicked, reproduced. Pinned against the real one below.
const isDet = (b) => !!b && (b.kind === 'det' || b.scaleCategory === 'debuff' || b.scaleCategory === 'charm');
function clashes(picked, name) {
  if (!picked.length) return null;
  const known = roster.find((b) => b.name === name);
  if (!known) return null;
  for (const other of picked) {
    const existing = roster.find((b) => b.name === other);
    if (existing && isDet(existing) !== isDet(known)) return other;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The data model did not move
// ---------------------------------------------------------------------------

test('buffNames is still a flat array of names', () => {
  // The note's Risk, defused rather than migrated around. If this ever becomes an array of
  // objects, every aura anyone already has is emptied by widgetStore's own array coercion.
  const store = newStore();
  const w = store.create('Mine');
  store.update(w.id, { buffFilterMode: 'explicit', buffNames: ['Mesmerize', 'Charm'] });
  const saved = store.getById(w.id);
  assert.deepEqual(saved.buffNames, ['Mesmerize', 'Charm']);
  for (const n of saved.buffNames) assert.equal(typeof n, 'string', 'a gem object got persisted');
});

test('buffNames still has no migration of its own - the shape did not change', () => {
  // The store version is now 5 (v4->v5 added the CONTROLLED catch-all to existing Loss of control
  // auras - nothing to do with buffNames). If a version bump ever DOES coincide with a buffNames
  // shape change, that change needs its own migration and this comment is where to notice it. The
  // array coercion below is the only thing between an object-shaped buffNames and every aura being
  // silently emptied.
  assert.match(storeSrc, /version: 5, widgets: \[selfBuffs\]/, 'the store version moved again - if buffNames changed shape it needs its own migration');
  assert.match(
    storeSrc,
    /buffNames: Array\.isArray\(widget\.buffNames\) \? widget\.buffNames : \[\]/,
    'the array coercion is gone - a non-array now reaches the overlay'
  );
});

test('the overlay still reads it the same way', () => {
  assert.match(overlaySrc, /new Set\(\(currentConfig\.buffNames \|\| \[\]\)\.map\(\(n\) => n\.toLowerCase\(\)\)\)/);
});

test('an aura saved before this change still works', () => {
  // The concrete version of the above: a plain widget written by the old code, loaded now.
  const data = { widgets: { version: 2, widgets: [{ id: 'x', name: 'Old', kind: 'custom',
    buffFilterMode: 'explicit', buffNames: ['Mesmerize'] }] } };
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: () => {},
  });
  const w = store.getById('x');
  assert.ok(w, 'an aura written before the change no longer loads');
  assert.deepEqual(w.buffNames, ['Mesmerize'], 'its picked spells were lost');
});

// ---------------------------------------------------------------------------
// The gems
// ---------------------------------------------------------------------------

test('picked spells render as gem slots, not list rows', () => {
  assert.match(html, /<div id="widget-selected-buffs-list" class="gem-bar"><\/div>/, 'still a list element');
  assert.match(rendererSrc, /function buildGemSlot\(widget, name\) \{/);
  const fn = rendererSrc.match(/function buildGemSlot\(widget, name\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'buildGemSlot has been restructured');
  assert.match(fn[1], /slot\.className = 'gem-slot';/);
  assert.match(fn[1], /known\.iconUrl/, 'the gem does not show the spell icon');
});

test('a spell with no icon still shows something removable', () => {
  const fn = rendererSrc.match(/function buildGemSlot\(widget, name\) \{([\s\S]*?)\n {2}\}/)[1];
  assert.match(fn, /gem-initial/, 'a spell with no icon renders as an empty square');
  // And the gap is real, so the fallback is reachable.
  const noIcon = roster.filter((e) => e.iconId == null);
  assert.ok(noIcon.length > 0, 'every spell has an icon now - is the fallback still needed?');
});

test('clicking a gem opens the picker, rather than deleting the spell outright', () => {
  // Reversed at the owner's instruction, 2026-08-24: "the gem pickers ... cannot be edited, only
  // deleted." One click used to be an irreversible remove. It now opens the same modal the "+"
  // slot does, with this spell searched up - real removal still happens, by unchecking it there,
  // but it is no longer one misclick away with no way back.
  const fn = rendererSrc.match(/function buildGemSlot\(widget, name\) \{([\s\S]*?)\n {2}\}/)[1];
  assert.match(fn, /openBuffPickerModal\(name\)/);
  assert.doesNotMatch(fn, /toggleBuffFilterName\(widget, name, false\)/, 'a click still deletes outright');
  assert.match(fn, /slot\.title = /, 'no tooltip - an EQ icon alone does not say which spell it is');
});

test('there is a "+" slot, and it is the way in when nothing is picked', () => {
  const fn = rendererSrc.match(/function renderSelectedBuffsList\(widget\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderSelectedBuffsList has been restructured');
  assert.match(fn[1], /gem-slot gem-add/);
  assert.match(fn[1], /openBuffPickerModal\(''\)/, 'the + slot does not lead anywhere');
  // The section must NOT hide itself when empty any more, or the + is unreachable.
  assert.doesNotMatch(
    fn[1],
    /selectedBuffsSectionEl\.style\.display = names\.length/,
    'the row hides when empty, which hides the only way to add the first spell'
  );
});

test('the picker lives in a modal, not permanently on screen under the gems', () => {
  // The whole point of gems was to replace a long always-visible list with a compact row - a full
  // search box and list still sitting open underneath the row undid that entirely.
  assert.match(html, /id="buff-picker-modal-backdrop" class="modal-backdrop"/);
  assert.match(rendererSrc, /function openBuffPickerModal\(searchTerm\) \{/);
  assert.match(rendererSrc, /function closeBuffPickerModal\(\) \{/);
});

test('the + slot does not wear the danger hover that means "remove"', () => {
  // .gem-slot:not(.gem-empty):hover paints a red cross. The + is one click away from the gems in
  // the same row, and telling someone a plus destroys something is worse than no styling at all.
  assert.match(css, /\.gem-slot\.gem-add \{/);
  assert.match(css, /\.gem-slot\.gem-add:hover/);
  assert.match(css, /content: none/, 'the red cross still shows on the add slot');
});

// ---------------------------------------------------------------------------
// Buffs and debuffs never share an aura
// ---------------------------------------------------------------------------

test('a debuff cannot join an aura of buffs, or the other way round', () => {
  // Note 27 states this as a rule. Both directions, using real roster entries.
  assert.equal(clashes(['Spirit of Wolf'], 'Mesmerize'), 'Spirit of Wolf');
  assert.equal(clashes(['Mesmerize'], 'Spirit of Wolf'), 'Mesmerize');
  assert.equal(clashes(['Mesmerize'], 'Charm'), null, 'two debuffs were refused');
  assert.equal(clashes(['Spirit of Wolf'], 'Courage'), null, 'two buffs were refused');
  assert.equal(clashes([], 'Mesmerize'), null, 'the first pick was refused');
});

test('the split is real, not everything on one side', () => {
  const det = roster.filter(isDet).length;
  assert.ok(det > 200 && det < roster.length - 200, `${det} of ${roster.length} classed detrimental`);
});

test('the shared category rule is defined once, and used by both the filter and the refusal', () => {
  // isDetBuff used to be a copy living only inside conflictsWithPicked, which is how the picker
  // and the refusal it backs could ever disagree about what counts as a debuff. Reported directly:
  // "if they cannot be added, they should not be in the list at all" - a picker offering something
  // its own refusal then blocks is the bug, not a display preference.
  const fn = rendererSrc.match(/function isDetBuff\(b\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'isDetBuff has been renamed or restructured');
  assert.match(fn[1], /kind === 'det'/);
  assert.match(fn[1], /scaleCategory === 'charm'/, 'charm is not counted as detrimental');

  const conflicts = rendererSrc.match(/function conflictsWithPicked\(widget, name\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(conflicts, 'conflictsWithPicked has been renamed or restructured');
  assert.doesNotMatch(conflicts[1], /function isDet/, 'a second, local copy of the rule is back');
  // The comparison direction, pinned in the SOURCE. The checks above run against a reproduced
  // copy of the rule, which cannot notice the real one being inverted - and inverted, it refuses
  // every valid pick and allows every invalid one.
  assert.match(conflicts[1], /isDetBuff\(existing\) !== incoming/, 'the clash test compares the wrong way round');

  // Refused on add too, kept as a second layer (a share code can still add a name outside the
  // picker's own checkbox list) - not the only line of defence any more, but not removed either.
  assert.match(rendererSrc, /const clash = conflictsWithPicked\(widget, name\);/);
  assert.match(rendererSrc, /cannot share an aura/);
  assert.match(html, /id="widget-buff-filter-notice"/, 'nowhere to show the reason');
});

test('the picker itself only ever offers one category', () => {
  // The primary fix, not just the belt-and-suspenders refusal above: a debuff aura's picker must
  // never render a buff as a checkable option, and vice versa, or ticking it just walks straight
  // into the refusal above having looked like a real choice.
  const fn = rendererSrc.match(/function applyBuffFilterSearch\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'applyBuffFilterSearch has been restructured');
  assert.match(fn[1], /isDetBuff\(b\) === wantsDebuffs/, 'the pool is not filtered to one category before rendering');
  assert.match(
    fn[1],
    /wantsDebuffs = !!\(widget\.trackOnEnemies \|\| widget\.allyDebuffAlert\)/,
    'an ally-cast-alert aura (mez/charm) must count as wanting debuffs too, or its own picker offers buffs'
  );
});

test('the notice clears itself once something valid happens', () => {
  // Otherwise it sits there complaining about a pick the user already abandoned.
  assert.match(rendererSrc, /setBuffFilterNotice\(''\);/);
  const fn = rendererSrc.match(/function setBuffFilterNotice\(text\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'setBuffFilterNotice has been restructured');
  assert.match(fn[1], /el\.style\.display = text \? '' : 'none';/);
});

module.exports = () => report('gem-slots');
if (require.main === module) report('gem-slots').then((n) => process.exit(n ? 1 : 0));
