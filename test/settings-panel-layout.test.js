'use strict';
/**
 * The shape of the aura settings panel - note 27, first half.
 *
 * Shara: "by buffs shown being its own category, I meant, categories such as display and size,
 * configuration, etc. currently buffs shown is a sub category under configuration. but it should
 * be a top level category/card the same as display and size."
 *
 * It is the control people change most often on that panel and it was three clicks down: open
 * Configuration, scroll past five topics, expand Buffs shown. Now it is a block of its own,
 * between Display & size and Configuration.
 *
 * Nothing guarded this panel's structure before, which is why the move needed a survey to do
 * safely. Two things it turned out to depend on are pinned here.
 *
 * The gem-slot half of note 27 is NOT built - it changes how an aura stores its picked spells,
 * which is the one change that could empty auras someone has already set up, and it is waiting on
 * Shara's go-ahead.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

// The settings panel only - the Log page has topics of its own that are none of this test's
// business.
const panel = html.slice(html.indexOf('id="widget-settings-panel"'), html.indexOf('id="page-setup"'));

// Top-level blocks in document order, by their caption. A block with no caption is unnamed and
// listed as such rather than skipped, so a missing caption cannot hide.
function blockCaptions(region) {
  return [...region.matchAll(/<div class="block"[^>]*>\s*(?:<p class="block-cap[^"]*">([^<]*)<\/p>)?/g)]
    .map((m) => (m[1] || '(no caption)').replace(/&amp;/g, '&').trim());
}

test('Buffs shown is a top-level block, not a topic', () => {
  assert.match(panel, /<div class="block" id="widget-buff-filter-card">/, 'it is not a block');
  assert.match(panel, /<div class="block" id="widget-buff-filter-card">\s*<p class="block-cap">Buffs shown<\/p>/);
  assert.doesNotMatch(panel, /<div class="topic[^"]*" id="widget-buff-filter-card"/, 'it is still a topic');
});

test('it sits between Display & size and Configuration', () => {
  const captions = blockCaptions(panel);
  const at = (c) => captions.indexOf(c);
  assert.ok(at('Display & size') >= 0, `no Display & size block - captions were: ${captions.join(' | ')}`);
  assert.ok(at('Buffs shown') >= 0, 'no Buffs shown block');
  assert.ok(at('Configuration') >= 0, 'no Configuration block');
  assert.ok(at('Display & size') < at('Buffs shown'), 'Buffs shown is above Display & size');
  assert.ok(at('Buffs shown') < at('Configuration'), 'Buffs shown is below Configuration');
});

test('it is no longer inside the Configuration block', () => {
  const cfgStart = panel.indexOf('<p class="block-cap">Configuration</p>');
  assert.notEqual(cfgStart, -1);
  assert.ok(
    panel.indexOf('id="widget-buff-filter-card"') < cfgStart,
    'the buff filter still lives after the Configuration caption'
  );
});

test('it has no collapse button left behind', () => {
  // initTopicToggles does btn.closest('.topic').classList.toggle(...) with no null guard, so a
  // data-toggle button that is no longer inside a .topic throws on click.
  const block = panel.slice(panel.indexOf('id="widget-buff-filter-card"'));
  const end = block.indexOf('<div class="block"');
  const own = block.slice(0, end === -1 ? undefined : end);
  assert.doesNotMatch(own, /data-toggle/, 'a collapse button survived the move and will throw');
  assert.doesNotMatch(own, /topic-head/);
});

test('every collapse button in the whole file still sits inside a topic', () => {
  // The general form of the check above, so this cannot be broken by the next move either.
  const lines = html.split('\n');
  const orphans = [];
  lines.forEach((line, i) => {
    if (!line.includes('data-toggle')) return;
    for (let k = i; k >= 0; k -= 1) {
      if (lines[k].includes('<div ')) {
        if (!lines[k].includes('class="topic')) orphans.push(i + 1);
        break;
      }
    }
  });
  assert.deepEqual(orphans, [], `data-toggle buttons outside a .topic, at lines ${orphans.join(', ')}`);
});

test('the panel markup balances', () => {
  // The move was a cut and paste of fifty lines. A dropped or doubled </div> silently reparents
  // everything below it, and no other test in the suite would notice.
  const opens = (html.match(/<div\b/g) || []).length;
  const closes = (html.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, 'unbalanced <div> tags in index.html');
});

test('nothing references the removed summary span', () => {
  assert.doesNotMatch(html, /topic-buffs-shown-summary/);
  assert.doesNotMatch(rendererSrc, /topic-buffs-shown-summary/);
});

test('the two things called "Buffs shown" are not both called that any more', () => {
  // Display & size has a row that picks whether an aura watches you, an ally, or text triggers.
  // It was labelled "Buffs shown:" - which would have been the second thing with that name on the
  // same screen once the block above took the title. It is a source picker, so it now says so.
  assert.doesNotMatch(panel, /<span class="label">Buffs shown:<\/span>/, 'two things named Buffs shown');
  assert.match(panel, /<span class="label">Watching:<\/span>/);
  // The id is unchanged - a test in text-aura.test.js depends on it.
  assert.match(panel, /id="widget-buff-source-row"/);
  assert.match(panel, /id="widget-buff-source-timer-label"/);
});

test('the controls inside it all survived the move', () => {
  // Every id the renderer looks up inside this block. renderer-wiring.test.js catches a lookup
  // with no markup; this catches markup silently dropped by a bad slice, which is the failure a
  // cut-and-paste actually produces.
  const block = panel.slice(panel.indexOf('id="widget-buff-filter-card"'));
  const own = block.slice(0, block.indexOf('<div class="block"'));
  for (const id of [
    'widget-buff-filter-hint',
    'widget-track-others-row',
    'widget-track-others-checkbox',
    'widget-self-buffs-filters',
    'widget-hide-bard-songs-checkbox',
    'widget-max-duration-slider',
    'widget-max-duration-value',
    'widget-selected-buffs-section',
    'widget-selected-buffs-list',
    'widget-buff-filter-search',
    'widget-buff-filter-list',
  ]) {
    assert.ok(own.includes(`id="${id}"`), `${id} was lost in the move`);
  }
});

module.exports = () => report('settings-panel-layout');
if (require.main === module) process.exit(report('settings-panel-layout') ? 1 : 0);
