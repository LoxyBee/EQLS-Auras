'use strict';
/**
 * A custom timer that runs its duration and then rolls into a cooldown - note 10.
 *
 * The note's own summary was right: "much easier than it sounds on the engine side... the cost is
 * the form and the display: if the tile doesn't visibly say which phase it is in, the number on
 * screen is actively misleading." That is the real content of this feature. A cooldown counts down
 * to when you CAN use something; a duration counts down to when you can no longer rely on it.
 * Identical digits, opposite meanings.
 *
 * And the note named its own trap, which was real: handleLine overwrites an active entry whenever
 * the trigger text is seen again. During a COOLDOWN that is wrong twice - the ability is not
 * available, so the line cannot mean it was used, and restarting would hide a cooldown the player
 * is waiting on behind a fresh duration.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const engineSrc = read('src', 'main', 'customTimerEngine.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const mainSrc = read('src', 'main', 'main.js');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function setup(timers) {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.create('Test');
  for (const t of timers) store.addCustomTimer(widget.id, t);
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // these tests drive time themselves
  return { store, widget, engine };
}

const feed = (e, line) => e.handleLine(TS + line);
const shown = (e) => e.getActive().map((t) => `${t.name}:${t.phase}`);
// Reach past whatever is running rather than waiting real seconds.
const expireNow = (e) => {
  for (const t of e.activeTimers.values()) t.expiresAt = Date.now() - 1;
  e._tick();
};

// ---------------------------------------------------------------------------
// The two phases
// ---------------------------------------------------------------------------

test('a timer with a cooldown rolls from one into the other', () => {
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'you harvest', cooldownSec: 5 }]);
  feed(engine, 'you harvest');
  assert.deepEqual(shown(engine), ['Harvest:duration']);
  expireNow(engine);
  assert.deepEqual(shown(engine), ['Harvest:cooldown'], 'it ended instead of cooling down');
  expireNow(engine);
  assert.deepEqual(shown(engine), [], 'the cooldown never ends');
});

test('the cooldown counts its own length, not the duration again', () => {
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'go', cooldownSec: 60 }]);
  feed(engine, 'go');
  assert.equal(engine.getActive()[0].remainingSec, 3);
  expireNow(engine);
  assert.equal(engine.getActive()[0].remainingSec, 60);
});

test('a timer with no cooldown still just ends', () => {
  // Every timer that existed before this feature is one of these.
  const { engine } = setup([{ name: 'Plain', durationSec: 3, triggerText: 'go' }]);
  feed(engine, 'go');
  assert.deepEqual(shown(engine), ['Plain:duration']);
  expireNow(engine);
  assert.deepEqual(shown(engine), []);
});

test('a cooldown cannot roll into another cooldown', () => {
  // The transition is from 'duration' only. Without that a timer with a cooldown would never end.
  const fn = engineSrc.match(/_tick\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, '_tick has been restructured');
  assert.match(fn[1], /timer\.phase === 'duration' && timer\.cooldownSec > 0/);
});

// ---------------------------------------------------------------------------
// The trap the note named
// ---------------------------------------------------------------------------

test('the trigger line during a cooldown does NOT restart it', () => {
  // The note's Risk. Seeing the line again cannot mean the ability was used - it is on cooldown.
  // Restarting would replace a countdown the player is waiting on with a fresh duration.
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'you harvest', cooldownSec: 60 }]);
  feed(engine, 'you harvest');
  expireNow(engine);
  const before = engine.getActive()[0].remainingSec;
  feed(engine, 'you harvest');
  assert.deepEqual(shown(engine), ['Harvest:cooldown'], 'the cooldown was replaced by a new duration');
  assert.ok(engine.getActive()[0].remainingSec <= before, 'the cooldown was restarted');
});

test('the trigger line during the DURATION still restarts it, as before', () => {
  // Only the cooldown phase is protected. A plain re-trigger is the existing behaviour and a lot
  // of timers rely on it.
  const { engine } = setup([{ name: 'Harvest', durationSec: 30, triggerText: 'go', cooldownSec: 60 }]);
  feed(engine, 'go');
  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() + 5000;
  assert.equal(engine.getActive()[0].remainingSec, 5);
  feed(engine, 'go');
  assert.equal(engine.getActive()[0].remainingSec, 30, 'a re-trigger no longer restarts the duration');
});

// ---------------------------------------------------------------------------
// Saying which phase it is in
// ---------------------------------------------------------------------------

test('the phase reaches the overlay', () => {
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'go', cooldownSec: 5 }]);
  feed(engine, 'go');
  assert.equal(engine.getActive()[0].phase, 'duration');
  expireNow(engine);
  assert.equal(engine.getActive()[0].phase, 'cooldown');
});

test('rolling from duration into cooldown is not read as a renewal - the real cause of a land sound firing twice', () => {
  // Reported live: a 0s-duration/20s-cooldown trigger's land sound played a second time about a
  // second after the first, for one single trigger firing once. Root cause: remainingSec jumps UP
  // when 'duration' rolls into 'cooldown' (from ~0 to the cooldown length, see the test above this
  // one) - and overlay.js's own renewal-detection reads ANY upward jump in remainingSec as "cast
  // again" (that's genuinely correct for an auto-renewing bard song, whose duration resets). This
  // is not specific to a 0-second duration - any cooldown-timer with soundOnLand on would
  // double-fire the same way, just with the two beeps further apart (a normal duration is longer
  // than 200ms, so the earlier debounce fix couldn't have caught this either).
  const fn = overlaySrc.match(/for \(const b of buffs\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'the soundLandedRaw loop has been restructured');
  assert.match(
    fn[1],
    /if \(b\.phase !== 'cooldown' && \(prevRemaining === undefined \|\| b\.remainingSec > prevRemaining\)\) \{/,
    "the renewal check no longer excludes a 'cooldown'-phase buff - a duration-to-cooldown rollover will be misread as a recast again"
  );
});

test('the tile looks different while cooling down, and says so in words', () => {
  // The note: "if the tile doesn't visibly say which phase it is in, the number on screen is
  // actively misleading".
  assert.match(overlaySrc, /const cooling = buff\.phase === 'cooldown';/);
  assert.match(overlaySrc, /classList\.toggle\('cooldown-phase', cooling\)/);
  assert.match(overlaySrc, /cooling down, ready in/, 'nothing says in words which phase it is');
  assert.match(overlayCss, /\.cooldown-phase \{/, 'the class is set but never styled');
});

test('the cooldown styling does not collide with the two meanings colour already has', () => {
  // Colour on a tile already means spell category (note 37) and time running out (.low). A third
  // colour meaning would make all three unreadable, so this one is opacity and an outline.
  const block = overlayCss.match(/\.cooldown-phase \{([\s\S]*?)\}/)[1];
  assert.match(block, /opacity/);
  assert.doesNotMatch(block, /(^|[^-])color:/, 'the cooldown phase uses colour, which already means two other things');
  assert.doesNotMatch(block, /background/);
});

// ---------------------------------------------------------------------------
// Setting one up
// ---------------------------------------------------------------------------

test('the field exists and round-trips through the store', () => {
  const { store, widget } = setup([{ name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 30 }]);
  const t = () => store.getById(widget.id).customTimers[0];
  assert.equal(t().cooldownSec, 30);

  store.updateCustomTimer(widget.id, t().id, { name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 45 });
  assert.equal(t().cooldownSec, 45, 'editing the cooldown does not stick');

  // Emptying the box sends 0, which removes it rather than leaving the old value behind.
  store.updateCustomTimer(widget.id, t().id, { name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 0 });
  assert.equal(t().cooldownSec, undefined, 'clearing the box left the old cooldown in place');
});

test('a caller that has never heard of cooldowns does not wipe one', () => {
  // The first version rewrote this field unconditionally, so any code path not yet updated for it
  // silently erased it - the same shape as the castOf bug below. Saying nothing means no change;
  // only an explicit 0 clears.
  const { store, widget } = setup([{ name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 30 }]);
  const t = () => store.getById(widget.id).customTimers[0];
  store.updateCustomTimer(widget.id, t().id, { name: 'A', durationSec: 10, triggerText: 'go' });
  assert.equal(t().cooldownSec, 30, 'a caller omitting the field wiped it');
});

test('every trigger mode the engine understands survives being stored', () => {
  // A real bug, found by reading rather than by failing: addCustomTimer whitelisted only
  // 'contains', so a castOf timer routed through it was silently downgraded to exact whole-line
  // matching and would never have fired. The cooldown premade escaped only because it writes the
  // timer object directly. A mode missing from that whitelist is a mode that stops working.
  const { store, widget } = setup([]);
  for (const mode of ['contains', 'castOf']) {
    const w = store.addCustomTimer(widget.id, { name: mode, durationSec: 5, triggerText: 't', triggerMatch: mode });
    assert.equal(w.customTimers.at(-1).triggerMatch, mode, `${mode} was dropped on the way in`);
  }
  // And anything unrecognised still becomes plain exact matching rather than a mode that does not
  // exist.
  const w = store.addCustomTimer(widget.id, { name: 'bad', durationSec: 5, triggerText: 't', triggerMatch: 'sideways' });
  assert.equal(w.customTimers.at(-1).triggerMatch, undefined);

  // The whitelist must name every mode the engine branches on.
  const modes = [...engineSrc.matchAll(/timer\.triggerMatch === '([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.ok(modes.length >= 2, `only found ${modes.length} modes in the engine`);
  const storeSrc = read('src', 'main', 'widgetStore.js');
  const list = storeSrc.match(/const TRIGGER_MATCH_MODES = \[([^\]]*)\]/);
  assert.ok(list, 'TRIGGER_MATCH_MODES has been renamed');
  for (const m of modes) {
    assert.ok(list[1].includes(`'${m}'`), `the engine understands '${m}' but the store discards it`);
  }
});

test('a timer without one stays byte-identical to a pre-feature timer', () => {
  // undefined, not 0 - so nothing already saved changes shape just because the field now exists.
  const { store, widget } = setup([{ name: 'Plain', durationSec: 10, triggerText: 'go' }]);
  const t = store.getById(widget.id).customTimers[0];
  assert.equal(t.cooldownSec, undefined);
  assert.ok(!Object.values(t).includes(0), 'a zero crept in where undefined was meant');
});

test('it is wired from the form all the way to the store', () => {
  // The gap this actually had: the field was in the form, the store and the engine and still did
  // nothing, because the IPC handler destructures named fields and did not list it.
  assert.match(html, /id="widget-new-timer-cooldown"/, 'no field in the form');
  assert.match(rendererSrc, /cooldownSec: Number\(newTimerCooldownInput\.value\) \|\| 0/, 'the form never reads it');
  assert.match(rendererSrc, /newTimerCooldownInput\.value = timer\.cooldownSec \? String\(timer\.cooldownSec\) : ''/,
    'editing a timer does not show its cooldown');
  assert.match(rendererSrc, /newTimerCooldownInput\.value = '';/, 'the form is not cleared between timers');
  const add = mainSrc.match(/'widget:addCustomTimer',([\s\S]*?)\n\);/);
  assert.ok(add && /cooldownSec/.test(add[1]), 'the add handler drops cooldownSec');
  const upd = mainSrc.match(/'widget:updateCustomTimer',([\s\S]*?)\n\);/);
  assert.ok(upd && /cooldownSec/.test(upd[1]), 'the update handler drops cooldownSec');
});

test('a restart does not resurrect a cooldown as a running buff', () => {
  // The note's second Risk. The snapshot is the raw entry, so the phase rides along with it - but
  // only because getSnapshotState returns the entries themselves rather than a rebuilt view.
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'go', cooldownSec: 60 }]);
  feed(engine, 'go');
  expireNow(engine);
  const snap = engine.getSnapshotState();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].phase, 'cooldown', 'the phase is lost across a restart');
  assert.equal(snap[0].cooldownSec, 60, 'the cooldown length is lost across a restart');
});

test('the contains mode is reachable from the form at all', () => {
  // It existed in the engine and the store for a while and could only be reached by a premade -
  // the timer form never sent a mode, so every hand-built timer was exact whether or not that was
  // what the person wanted. A capability nobody can reach is not a capability.
  assert.match(html, /name="widget-new-timer-match" value="contains"/, 'no way to choose it');
  // Widened 25 Aug: the zone-trigger addition (mode === 'zone') sits in this same ternary chain
  // ahead of the 'raw' branch, pushing the real distance past the old 80-char window.
  assert.match(rendererSrc, /triggerMatch:[\s\S]{0,300}mode === 'raw'/, 'the form never sends a mode');
  assert.match(rendererSrc, /newTimerMatchRadios\.forEach\(\(r\) => \(r\.checked = r\.value === 'exact'\)\)/,
    'the form does not reset to exact between timers');
  const add = mainSrc.match(/'widget:addCustomTimer',([\s\S]*?)\n\);/);
  assert.ok(add && /triggerMatch/.test(add[1]), 'the add handler drops the mode');
});

test('a chat-built trigger is always exact', () => {
  // The chat builder composes a whole line itself. Matching part of a line the user never typed
  // would be matching part of this app's own guess at what the line looks like.
  const fn = rendererSrc.match(/function readTimerFormData\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'readTimerFormData has been restructured');
  assert.match(fn[1], /mode === 'raw' &&/);
});

test('the cooldown fields are out of the way until wanted', () => {
  // Shara, 23 August: "not a full sub panel, but just an auto expanding options menu toggle button
  // like other menu's so that the options are invisible when not used." Same .topic pattern as
  // every other collapsible section, so it behaves the way the rest of the app already does.
  assert.match(html, /<div class="topic" id="topic-timer-cooldown" data-topic>/);
  assert.match(html, /<span class="topic-title">Cooldown<\/span>/);
  // It must be a real topic, or initTopicToggles throws on the button inside it.
  const block = html.slice(html.indexOf('id="topic-timer-cooldown"'));
  assert.match(block.slice(0, 400), /class="topic-head" data-toggle/);
});

test('Cooldown sits at the bottom of the Add timer form, not right under Name/Duration', () => {
  // Reported live 24 Aug: this topic (then alongside the now-removed "Extra conditions" topic -
  // see the trigger-combine-mode test file for what replaced it) used to live inside
  // .timer-identity-fields, right after the Duration row - clutter ahead of the trigger fields
  // that matter for every timer, and the reason the icon picker (see the next test) ended up
  // appearing well below the fields it belongs to.
  const modalStart = html.indexOf('id="custom-timer-modal-backdrop"');
  const identityEnd = html.indexOf('</div>', html.indexOf('class="timer-identity-fields"'));
  const triggerHeading = html.indexOf('What starts it?');
  const cooldownTopic = html.indexOf('id="topic-timer-cooldown"');
  const modalActions = html.indexOf('class="modal-actions"');

  assert.ok(modalStart > -1 && identityEnd > modalStart, 'the identity row is missing or restructured');
  assert.ok(triggerHeading > identityEnd, '"What starts it?" must come right after the identity row');
  assert.ok(cooldownTopic > triggerHeading, 'Cooldown is still sitting above the trigger fields');
  assert.ok(modalActions > cooldownTopic, 'Cooldown must be the last thing before Add/Cancel');
});

test('the icon picker gallery sits right next to the name/duration fields, not below Cooldown', () => {
  // Reported live 24 Aug: "the icon picker needs to be next to the name and duration fields, it is
  // below it." It was always the very next element in the DOM after .timer-identity closed - what
  // pushed it visually far below was Cooldown (and, at the time, Extra conditions - since removed)
  // being nested INSIDE that same block above it. Pinning the actual DOM adjacency here, not just
  // their absence from timer-identity.
  const identityClose = html.indexOf('</div>', html.indexOf('class="timer-identity-fields"'));
  const between = html.slice(identityClose, html.indexOf('id="widget-new-timer-icon-picker"'));
  // Only the identity row's own closing tags and a comment may sit between them - not a whole
  // Cooldown section's worth of markup (which runs well over a thousand characters on its own).
  assert.ok(between.length < 1000, `too much markup between the fields and the icon picker: ${between.length} chars`);
  assert.doesNotMatch(between, /topic-timer-conditions|topic-timer-cooldown/);
});

test('a cooldown that is set is never hidden by the section being shut', () => {
  // The one way a collapsible section can actively mislead: a value set, the section closed, and
  // nothing on screen saying so. The summary carries it, and editing a timer that has one opens
  // the section.
  assert.match(html, /id="timer-cooldown-summary"/);
  assert.match(rendererSrc, /setTimerCooldownOpen\(!!timer\.cooldownSec\)/, 'editing hides an existing cooldown');
  assert.match(rendererSrc, /setTimerCooldownOpen\(false\)/, 'the section stays open for the next timer');
  const fn = rendererSrc.match(/function setTimerCooldownOpen\(open\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'setTimerCooldownOpen has been renamed');
  assert.match(fn[1], /summary\.textContent/, 'a closed section says nothing about what is set');
});

module.exports = () => report('cooldown-phase');
if (require.main === module) report('cooldown-phase').then((n) => process.exit(n ? 1 : 0));
