'use strict';
/**
 * UI cleanup workstream B - the aura settings panel's "Display & size" block, once a flat ~240-line
 * run of every control, split into `.topic` accordions (Position / This aura / Size / Text /
 * Layout). applySettingsPanelShape() still toggles the individual rows; hideEmptyPanelTopics()
 * then hides a whole topic when every row it holds is hidden for the current shape.
 *
 * Structural (text, no DOM): the topics exist, every mapped row lives inside its claimed topic,
 * the hide-empty pass is wired, and the collapse is class-driven (never topic-body display - that
 * is the child-of-display:none trap).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src', 'renderer', 'main-window');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'main-window.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'main-window.css'), 'utf8');

const TOPICS = ['topic-panel-position', 'topic-panel-this-aura', 'topic-panel-size', 'topic-panel-text', 'topic-panel-layout'];

/** The markup slice of one topic, from its id to the matching close of its .topic div. */
function topicBlock(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `topic ${id} not found`);
  // its .topic-body is the next block; the topic ends at the next topic, or the block's close.
  const nextTopic = TOPICS.map((t) => html.indexOf(`id="${t}"`, start + 1)).filter((i) => i > 0).sort((a, b) => a - b)[0];
  return html.slice(start, nextTopic || html.indexOf('</div>\n\n            <!-- Moved OUT', start));
}

test('all five Display & size topics exist and are collapsible', () => {
  for (const id of TOPICS) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at !== -1, `${id} is missing`);
    assert.match(html.slice(at - 40, at + 60), new RegExp(`class="topic( open)?" id="${id}" data-topic`));
    assert.ok(html.slice(at, at + 300).includes('class="topic-head" data-toggle'), `${id} has no toggle head`);
  }
});

test('Position and This aura default open; Text and Layout default collapsed', () => {
  assert.match(html, /class="topic open" id="topic-panel-position"/);
  assert.match(html, /class="topic open" id="topic-panel-this-aura"/);
  assert.match(html, /class="topic open" id="topic-panel-size"/);
  assert.match(html, /class="topic" id="topic-panel-text"/);
  assert.match(html, /class="topic" id="topic-panel-layout"/);
});

test('every row hideEmptyPanelTopics checks lives inside the topic it is mapped to', () => {
  // pull the panelTopicMembers map straight out of the source
  const mapSrc = js.match(/const panelTopicMembers = \{[\s\S]*?\n {2}\};/);
  assert.ok(mapSrc, 'panelTopicMembers map not found - was it renamed?');
  const entries = [...mapSrc[0].matchAll(/'(topic-panel-[a-z-]+)':\s*\[([^\]]*)\]/g)];
  assert.ok(entries.length >= 4, 'expected mappings for at least this-aura/size/text/layout');
  for (const [, topicId, list] of entries) {
    const block = topicBlock(topicId);
    for (const rowId of [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])) {
      assert.ok(block.includes(`id="${rowId}"`), `${rowId} is mapped to ${topicId} but is not inside it`);
    }
  }
});

test('the mapped rows are gone from wherever they used to sit loose - each appears exactly once', () => {
  for (const rowId of ['widget-display-mode-row', 'widget-opacity-row', 'widget-text-size-row', 'widget-merge-row', 'widget-list-only-settings', 'widget-icon-only-settings']) {
    const count = (html.match(new RegExp(`id="${rowId}"`, 'g')) || []).length;
    assert.equal(count, 1, `${rowId} appears ${count} times - a move left a copy behind`);
  }
});

test('applySettingsPanelShape calls hideEmptyPanelTopics after setting the row displays', () => {
  const fn = js.match(/function applySettingsPanelShape\(widget\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fn, 'applySettingsPanelShape not found');
  const body = fn[0];
  assert.ok(body.includes('hideEmptyPanelTopics()'), 'the hide-empty pass is not called');
  assert.ok(
    body.indexOf('hideEmptyPanelTopics()') > body.indexOf("positionRowEl.style.display"),
    'hideEmptyPanelTopics must run AFTER the individual row displays are set'
  );
});

test('the collapse is class-driven, never topic-body display (the child-of-display:none trap)', () => {
  const fn = js.match(/function hideEmptyPanelTopics\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fn, 'hideEmptyPanelTopics not found');
  assert.match(fn[0], /classList\.toggle\('topic-empty'/);
  assert.doesNotMatch(fn[0], /topic-body[^]*\.style\.display/, 'must not touch .topic-body display');
  assert.match(css, /\.topic\.topic-empty \{\s*display: none;/);
});

test('every getElementById the panel-topic map names actually exists in index.html', () => {
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const mapSrc = js.match(/const panelTopicMembers = \{[\s\S]*?\n {2}\};/)[0];
  for (const id of [...mapSrc.matchAll(/'(widget-[a-z-]+)'/g)].map((m) => m[1])) {
    assert.ok(htmlIds.has(id), `panelTopicMembers references #${id} which is not in the markup`);
  }
});

module.exports = () => report('aura-panel-topics');
if (require.main === module) report('aura-panel-topics').then((n) => process.exit(n ? 1 : 0));
