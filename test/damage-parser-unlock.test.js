'use strict';
/**
 * Damage parser, unlocked (1 Sep). It was built and wired since note 19 but held out of the Add
 * Aura list because its settings panel had the buff-aura shape - a "Buffs shown" source + spell
 * picker that mean nothing for a list of attacker rows. Now it has its own shape (only what a list
 * of non-spell rows can use) and a clickable premade, the same treatment Travel guide got 26 Aug.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const engineSrc = read('src', 'main', 'damageEngine.js');

function store() {
  let saved;
  return {
    loadJson: (k, f) => (k === 'widgets' ? saved || f : f),
    saveJson: (k, v) => { if (k === 'widgets') saved = JSON.parse(JSON.stringify(v)); },
  };
}

test('the damage shape drops every buff-tile control and keeps only what a row of numbers uses', () => {
  const m = rendererSrc.match(/'damage':\s*\[([^\]]*)\]/);
  assert.ok(m, 'SHAPE_FIELDS.damage not found');
  const fields = m[1];
  for (const gone of ['sort', 'merge', 'borders', 'alerts', 'buff-picker', 'buff-source', 'display-choice']) {
    assert.ok(!fields.includes(`'${gone}'`), `damage shape must not offer "${gone}"`);
  }
  for (const kept of ['list-format', 'timer-text', 'opacity', 'position', 'damage-settings']) {
    assert.ok(fields.includes(`'${kept}'`), `damage shape should have "${kept}"`);
  }
});

test('Damage parser is a real clickable premade, not a locked roadmap entry', () => {
  const built = rendererSrc.match(/const PREMADE_WIDGETS = \[([\s\S]*?)\n {2}\];/);
  const planned = rendererSrc.match(/const PLANNED_PREMADE_WIDGETS = \[([\s\S]*?)\n {2}\];/);
  assert.ok(built && planned);
  assert.match(built[1], /id: 'damage-parser'/);
  assert.match(built[1], /createDamageMeterWidget\(name, false\)/);
  assert.match(built[1], /group: 'standalone'/);
  assert.ok(!/name: 'Damage parser'/.test(planned[1]), 'Damage parser must not still be in the roadmap list');
});

test('createDamageMeter builds a list-mode damage aura with the row-scrambling guards, and a premadeOrigin', () => {
  const w = new WidgetStore(store()).createDamageMeter('DPS', {});
  assert.equal(w.buffSource, 'damage');
  assert.equal(w.displayMode, 'list');
  assert.equal(w.sortOrder, 'default', 'rows arrive pre-sorted; any sort would scramble them');
  assert.equal(w.landingGlowEnabled, false);
  assert.equal(w.listWidth, 260);
  assert.deepEqual(w.premadeOrigin, { kind: 'damage', mineOnly: false });
});

test('resetToDefault rebuilds a damage aura, keeping id / position / name', () => {
  const s = store();
  const ws = new WidgetStore(s);
  const w = ws.createDamageMeter('DPS', { mineOnly: true });
  ws.savePosition(w.id, { x: 111, y: 222 });
  ws.update(w.id, { sortOrder: 'alphabetical', listWidth: 999 }); // user messed with it

  assert.equal(ws.resetToDefault(w.id), true);
  const fresh = new WidgetStore(s).getById(w.id);
  assert.equal(fresh.id, w.id);
  assert.equal(fresh.name, 'DPS');
  assert.deepEqual(fresh.position, { x: 111, y: 222 });
  assert.equal(fresh.sortOrder, 'default', 'reset restored the row order guard');
  assert.equal(fresh.listWidth, 260);
  assert.equal(fresh.mineOnly, true, 'the origin remembered "just my row"');
});

test('the Total row is emitted last and bar-less', () => {
  const { DamageEngine } = require('../src/main/damageEngine');
  const e = new DamageEngine();
  e.handleLine('[Wed Aug 19 21:14:02 2026] You crush a kobold for 100 points of damage.', 1000);
  e.handleLine('[Wed Aug 19 21:14:02 2026] Groupmate hits a kobold for 40 points of damage.', 1500);
  const tiles = e.getActive(1600);
  assert.equal(tiles[tiles.length - 1].name, 'Total', 'total is the last row');
  assert.equal(tiles[tiles.length - 1].noBar, true, 'total draws without a bar');
  assert.ok(!engineSrc.includes('tiles.unshift'), 'the total must no longer be unshifted to the top');
});

test('with no fight underway the meter shows the running total since zone-in, relabelled', () => {
  const { DamageEngine } = require('../src/main/damageEngine');
  const e = new DamageEngine();
  e.setOptions({ fightTimeoutSec: 5 });
  e.handleLine('[Wed Aug 19 21:14:02 2026] You crush a kobold for 100 points of damage.', 1000);
  e.handleLine('[Wed Aug 19 21:14:02 2026] Groupmate hits a kobold for 40 points of damage.', 1200);
  // fight ends in silence
  e.tick(1000 + 6000);
  const tiles = e.getActive(1000 + 6000);
  assert.ok(tiles.length >= 2, 'the between-pulls meter is not empty');
  assert.equal(tiles[tiles.length - 1].name, 'Total');
  assert.equal(tiles[tiles.length - 1].sinceZone, true);
  assert.equal(tiles[0].name, 'You', 'still biggest-first');
  // a zone line wipes it
  e.enterZone(1000 + 7000);
  assert.deepEqual(e.getActive(1000 + 7000), []);
});

test('the overlay hides the bar for a noBar row and colours per-attacker bars only on a damage meter', () => {
  assert.match(overlaySrc, /if \(buff\.noBar\) \{\s*\n\s*ref\.barEl\.style\.display = 'none';/);
  assert.match(overlaySrc, /currentConfig\.buffSource === 'damage'/);
  assert.match(overlaySrc, /function damageBarColor\(kind, barPercent\)/);
  // Rank colours (owner, 5 Sep): the player picks a hex per metric, that IS the #1 row, and rows
  // below fade toward grey in proportion to how far they trail the leader (barPercent).
  assert.match(overlaySrc, /const picked = kind === 'heal' \? currentConfig\.healColor : currentConfig\.damageColor/);
  assert.match(overlaySrc, /s: s \* \(0\.28 \+ 0\.72 \* t\)/);
  // 'both' mode draws one bar as a hard-stop two-colour gradient rather than two DOM elements.
  assert.match(overlaySrc, /typeof buff\.barSplit === 'number'/);
  assert.match(overlaySrc, /linear-gradient\(\$\{dir\}/);
});

test("'both' mode shows two separately-coloured numbers, not one combined string", () => {
  // A second, hidden-by-default value span sitting right after the first (owner, 4 Sep: "two bits
  // of text not 1"), each coloured to match the bar segment it belongs to.
  assert.match(overlaySrc, /healValue\.className = 'time time-heal'/);
  // Side-by-side: damage number by damageValueMode, heal number plain cumulative + %.
  assert.match(overlaySrc, /dmgPiece =\s*\n?\s*bMode === 'dps' \? buff\.damageDpsText : bMode === 'both' \? buff\.damageBothText : buff\.damageValueText/);
  assert.match(overlaySrc, /ref\.healValueEl\.textContent = buff\.healValueText/);
  // Cycling: one metric at a time, chosen by the wall-clock phase.
  assert.match(overlaySrc, /function bothCyclePhase\(\)/);
  assert.match(overlaySrc, /const show = cyclePhase === 'heal' \? healPiece : dmgPiece/);
  assert.match(overlaySrc, /function damageTextColor\(kind, barPercent\)/);
  const css = read('src', 'renderer', 'overlay', 'overlay.css');
  assert.match(css, /\.buff-row-content \.time-heal/);
});

test('the share % rides its own right-aligned column, not inline with the number', () => {
  // owner, 5 Sep. The engine's value texts carry no % - it's a separate pctText field / column.
  const engine = read('src', 'main', 'damageEngine.js');
  assert.match(engine, /valueText: dmg,\s*\n\s*dpsText: rate,\s*\n\s*bothText: `\$\{dmg\} \(\$\{rate\}\)`,\s*\n\s*pctText: pct,/);
  assert.match(engine, /damagePctText: `\$\{dmgPct\}%`,\s*\n\s*healPctText: `\$\{healPct\}%`,/);
  assert.match(overlaySrc, /pctColEl\.className = 'row-pct'/);
  assert.match(overlaySrc, /ref\.pctEl\.textContent = pctText/);
  assert.match(overlaySrc, /pctText = \(cyclePhase === 'heal' \? buff\.healPctText : buff\.damagePctText\)/);
  assert.match(overlaySrc, /pctText = `\$\{buff\.damagePctText \|\| ''\} \/ \$\{buff\.healPctText \|\| ''\}`/);
  // The dark plate is a wrapper (.buff-row-box); pctColEl is that wrapper's sibling with a gap
  // between, so the coloured bar (clipped to the box) never reaches it.
  assert.match(overlaySrc, /box\.className = 'buff-row-box'/);
  assert.match(overlaySrc, /box\.append\(iconWrap, content\)/);
  assert.match(overlaySrc, /root\.append\(box, pctColEl\)/);
  const css2 = read('src', 'renderer', 'overlay', 'overlay.css');
  assert.match(css2, /\.buff-row-box \{[\s\S]*?overflow: hidden;[\s\S]*?background:/);
  assert.match(css2, /\.buff-row > \.row-pct \{/);
  assert.match(css2, /\.buff-row \{[\s\S]*?gap: 6px;/);
});

test('the two damage/rate checkboxes (both = "damage (rate)") are wired end to end', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  const manager = read('src', 'main', 'widgetManager.js');
  assert.match(html, /id="widget-damage-show-damage"/);
  assert.match(html, /id="widget-damage-show-rate"/);
  // both on -> 'both', rate only -> 'dps', else 'total'; at least one stays on
  assert.match(rendererSrc, /const mode = d && r \? 'both' : r \? 'dps' : 'total'/);
  assert.match(rendererSrc, /if \(!damageShowDamageCb\.checked && !damageShowRateCb\.checked\) justToggled\.checked = true/);
  assert.match(rendererSrc, /setWidgetDamageOptions\(selectedId, \{ valueMode: mode \}\)/);
  assert.match(manager, /DAMAGE_VALUE_MODES\.includes\(valueMode\)/);
  assert.match(read('src', 'main', 'widgetStore.js'), /'damageValueMode'/);
  // old boolean still migrates
  assert.match(read('src', 'main', 'widgetStore.js'), /damageShowDps \? 'dps' : 'total'/);
  // the overlay picks the string the mode names, honouring the old boolean as a fallback
  assert.match(overlaySrc, /currentConfig\.damageValueMode \|\| \(currentConfig\.damageShowDps \? 'dps' : 'total'\)/);
  assert.match(overlaySrc, /mode === 'both' && buff\.bothText != null/);
});

module.exports = () => report('damage-parser-unlock');
if (require.main === module) report('damage-parser-unlock').then((n) => process.exit(n ? 1 : 0));
