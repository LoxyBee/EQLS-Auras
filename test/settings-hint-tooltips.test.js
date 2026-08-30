'use strict';
/**
 * UI cleanup workstream A - inline `<p class="hint">` prose on the Buff Tracker and Setup pages
 * moved into `title=` tooltips, per the standing rule (feedback_toggle_explanations_hover_only)
 * and the Alerts & Sounds topic, which was already the reference implementation.
 *
 * Structural, not visual: every card that lost its explanatory paragraph must carry the same
 * information in a `title=` on its heading or a control, so nothing is just deleted.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'index.html'),
  'utf8'
);

/** The slice of index.html between two anchors, so a test scopes to one card. */
function between(startNeedle, endNeedle) {
  const a = html.indexOf(startNeedle);
  const b = html.indexOf(endNeedle, a + 1);
  assert.ok(a !== -1 && b !== -1, `anchors not found: ${startNeedle} .. ${endNeedle}`);
  return html.slice(a, b);
}

// A `title=` with real content (not empty, not one word).
const hasRealTitle = (s) => /title="[^"]{25,}"/.test(s);

test('the Buff Tracker cards carry their explanation in a title=, not a paragraph', () => {
  const page = between('id="page-tracker"', 'id="page-overlay"');
  for (const card of ['Ambiguous casts', 'Unknown casts', 'Custom buffs', 'Known buffs', 'What the app thinks you have memorized']) {
    const at = page.indexOf(card);
    assert.ok(at !== -1, `card "${card}" is gone`);
    // the heading opening (with its title=) sits before the heading text; the control after it.
    assert.ok(hasRealTitle(page.slice(at - 500, at + 400)), `"${card}" lost its explanation entirely`);
  }
  // the multi-line memorized wall is gone - only the one-line pointer with the About link remains
  assert.doesNotMatch(page, /Built from "You forget X\."/);
  assert.match(page, /id="memorized-hint"[^>]*>[^<]{0,140}<a href="#" data-page="page-about"/);
});

test('the load-bearing hints keep their action + cost (spellbook), just in the title', () => {
  const block = between('id="spellbook-missing-hint"', 'id="spellbook-missing-where"');
  assert.match(block, /ignores them|thrown away/i, 'the cost of a missing spellbook is gone');
  assert.match(block, /does not write this file on its own/i, 'the "it is manual" fact is gone');
  assert.match(html, /<code id="spellbook-command">\/outputfile spellbook<\/code>/, 'the command itself must stay visible');
});

test('the fullscreen warning line is NOT treated as a hint - it stays put', () => {
  assert.match(html, /id="fullscreen-warning-line"[^>]*hidden/);
  assert.match(html, /id="log-activity-line"/);
});

test('workstream D - the Buff library folded into one collapsed topic below the live state', () => {
  const page = between('id="page-tracker"', 'id="page-overlay"');
  // it is a topic (collapsible, closed by default - no `open` class), not two open cards
  const at = page.indexOf('id="topic-buff-library"');
  assert.ok(at !== -1, 'the Buff library topic is gone');
  assert.match(page.slice(at - 60, at + 60), /class="topic" id="topic-buff-library" data-topic/, 'not a collapsible topic, or starts open');
  // both launchers moved inside it, ids unchanged (JS wires by id)
  const body = page.slice(at, page.indexOf('</section>', at));
  for (const id of ['open-add-buff-modal-btn', 'open-custom-buffs-modal-btn', 'open-known-buffs-modal-btn']) {
    assert.ok(body.includes(id), `${id} did not move into the library topic`);
  }
  // Detection status / Needs your attention stay as prominent section headers above it
  assert.ok(page.indexOf('Detection status') < at && page.indexOf('Needs your attention') < at);
  assert.doesNotMatch(page, /settings-page-section-title">Buff library/, 'the old always-open Buff library section header is still there');
});

test('Setup cards moved their prose to title= (AA setup, Icon set, Merged tiles, App text size, Sounds, App data)', () => {
  const page = between('id="page-settings"', 'id="page-log"');
  for (const anchor of ['AA setup', 'Icon set:', 'Treat as the same:', 'App text size', 'Open sounds folder', 'Back up now']) {
    const at = page.indexOf(anchor);
    assert.ok(at !== -1, `"${anchor}" is gone from Setup`);
    assert.ok(hasRealTitle(page.slice(at - 400, at + 300)), `"${anchor}" lost its explanation`);
  }
  // the big walls of prose that used to sit under these are gone from the VISIBLE markup - the
  // phrases can still live inside a title= (that is the whole point), just not as a <p class="hint">.
  const paragraphs = page.match(/<p class="hint"[^>]*>([\s\S]*?)<\/p>/g) || [];
  for (const p of paragraphs) {
    const text = p.replace(/<[^>]+>/g, '').trim();
    assert.ok(text.length < 160, `a paragraph hint over 160 chars is still on the Setup page:\n${text}`);
  }
});

test('index.html has meaningfully fewer class="hint" blocks than before the pass', () => {
  const count = (html.match(/class="hint"/g) || []).length;
  // was 98 pre-pass; A on BT + Setup should take a solid chunk out. Guard against regression
  // (a future edit re-adding paragraph hints on these pages) and against over-deletion.
  assert.ok(count < 90, `expected the hint count to drop below 90, got ${count}`);
  assert.ok(count > 40, `hint count ${count} is suspiciously low - dynamic hints may have been deleted`);
});

test('the card/block heading styles were merged to one rule', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.css'), 'utf8');
  assert.match(css, /\.block h3,\s*\n\s*\.card h3 \{/, 'the two identical heading rules were not merged');
});

module.exports = () => report('settings-hint-tooltips');
if (require.main === module) report('settings-hint-tooltips').then((n) => process.exit(n ? 1 : 0));
