'use strict';
/**
 * The aura visibility precedence model - notes 4 and 31, built as one change because separately
 * they fight over which override wins.
 *
 * Three rules decide what happens to an aura, and they are easy to state and easy to get subtly
 * wrong:
 *   - loadout profile membership is the ON/OFF switch;
 *   - "Hide all auras" and auto-hide-while-EverQuest-is-unfocused CLEAR THE SCREEN;
 *   - unlocking one aura by hand overrides both, because you cannot drag what you cannot see.
 * Plus the sound-only exemption: an aura that draws nothing has nothing to clear off the screen.
 *
 * HOW THIS RUNS. widgetManager.js requires Electron at module load, which a plain Node process
 * does not have - so Electron is replaced in the require cache with a small fake before the
 * module is pulled in. Be clear about what that does and does not prove: it proves THIS APP's
 * decision logic, and it proves nothing whatsoever about how a real BrowserWindow behaves. The
 * fake records which windows were shown, hidden and made click-through, and the tests assert on
 * those records.
 *
 * The fake also redirects app.getPath('userData') into a fresh temp directory, so running this
 * suite can never touch a real install's saved auras.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');

// --- the fake Electron, installed BEFORE widgetManager is required -----------------------------

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-visibility-test-'));

/** Records every call the manager makes, so a decision can be asserted on rather than inferred. */
class FakeWindow {
  constructor(opts) {
    this.opts = opts;
    this.shown = false;
    this.destroyed = false;
    this.ignoresMouse = null;
    this.sent = [];
    this.handlers = {};
  }
  setAlwaysOnTop() {}
  setOpacity() {}
  loadFile() {}
  setBounds() {}
  setPosition() {}
  close() { this.destroyed = true; }
  getPosition() { return [0, 0]; }
  getSize() { return [this.opts.width || 220, this.opts.height || 300]; }
  isDestroyed() { return this.destroyed; }
  showInactive() { this.shown = true; }
  hide() { this.shown = false; }
  setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
  once(event, fn) { this.handlers[event] = fn; }
  on(event, fn) { this.handlers[event] = fn; }
  get webContents() {
    return { send: (channel, payload) => this.sent.push({ channel, payload }) };
  }
  /** Stands in for Electron firing ready-to-show once the page has loaded. */
  ready() { if (this.handlers['ready-to-show']) this.handlers['ready-to-show'](); }
}

const created = [];
const fakeElectron = {
  app: { getPath: () => USER_DATA },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  BrowserWindow: class {
    constructor(opts) {
      const win = new FakeWindow(opts);
      created.push(win);
      return win;
    }
  },
};
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: fakeElectron, children: [], paths: [] };

const wm = require('../src/main/widgetManager');

// --- a two-profile world -----------------------------------------------------------------------

const PROFILE_A = 'default';
const PROFILE_B = 'profile-b';
let activeProfile = PROFILE_A;
wm.setActiveProfileIdFn(() => activeProfile);

// The manager does not stamp an id onto its BrowserWindow options, so windows are matched by
// creation order instead: each helper below records how many existed before it acted.
function createdDuring(fn) {
  const before = created.length;
  const result = fn();
  return { result, windows: created.slice(before) };
}

function makeAura(name, overrides = {}) {
  const { result } = createdDuring(() => wm.createCustomWidget(name));
  const config = result;
  if (Object.keys(overrides).length) {
    // Applied through the store the same way the settings window would.
    for (const [k, v] of Object.entries(overrides)) config[k] = v;
  }
  return config;
}

// --- the on/off rule ---------------------------------------------------------------------------

test('an aura on the current profile is on screen; one switched off for it is not', () => {
  const aura = makeAura('Plain');
  assert.equal(wm.shouldBeOnScreen(aura), true);

  aura.activeProfileIds = [PROFILE_B];
  assert.equal(wm.shouldBeOnScreen(aura), false, 'profile membership is the app on/off switch');

  aura.activeProfileIds = [];
  assert.equal(wm.shouldBeOnScreen(aura), false, 'no profiles at all means hidden everywhere');
});

test('an aura switched off for the current profile is SILENT, not merely invisible', () => {
  // The bug this exists for: hiding a window does not stop it making noise. A hidden overlay
  // keeps receiving the engine broadcasts and keeps running render(), which is where the alert
  // sounds fire. Invisible and silent were the same thing until an aura could be nothing but
  // sound, and then they were not.
  const aura = makeAura('Noisy');
  assert.equal(wm.shouldBeAudible(aura), true);

  aura.activeProfileIds = [PROFILE_B];
  assert.equal(wm.shouldBeAudible(aura), false, 'off must mean silent as well as invisible');
});

test('clearing the screen does NOT silence anything', () => {
  // Deliberate and the opposite of the rule above. Hearing that a buff is about to drop while
  // you are tabbed out is most of the reason to have a sound at all.
  const aura = makeAura('Still audible');
  wm.setForegroundHidden(true);
  assert.equal(wm.shouldBeOnScreen(aura), false, 'auto-hide should take it off screen');
  assert.equal(wm.shouldBeAudible(aura), true, 'auto-hide must not silence it');
  wm.setForegroundHidden(false);

  wm.setMasterHidden(true);
  assert.equal(wm.shouldBeOnScreen(aura), false);
  assert.equal(wm.shouldBeAudible(aura), true, 'master hide must not silence it either');
  wm.setMasterHidden(false);
});

// --- note 31: unlocking beats profile-off ------------------------------------------------------

test('unlocking one aura by hand puts it on screen even when its profile has it switched off', () => {
  const aura = makeAura('Off-profile');
  aura.activeProfileIds = [PROFILE_B];
  assert.equal(wm.shouldBeOnScreen(aura), false);

  wm.setLocked(aura.id, false);
  assert.equal(
    wm.shouldBeOnScreen(aura), true,
    'you cannot reposition an aura you cannot see - this is the whole of note 31'
  );

  wm.setLocked(aura.id, true);
  assert.equal(wm.shouldBeOnScreen(aura), false, 're-locking must hand it back to the normal rules');
});

test('unlocking an aura that has no window at all creates one', () => {
  // The other half of note 31, and the half that is easy to miss. An aura the active profile has
  // switched off is never given a window at launch - initWidgets only builds windows for auras
  // the current profile shows. The old setLocked only acted when a window already existed, so
  // unlocking one of those did nothing whatsoever and read as a broken button.
  //
  // Getting the manager into that state from here means starting from an aura that DOES have a
  // window and then firing its own 'closed' handler, which is what Electron would call when a
  // window goes away - the manager drops it from its window map and its lock map, leaving
  // exactly the state a never-created aura is in.
  const { result: aura, windows } = createdDuring(() => wm.createCustomWidget('Windowless'));
  assert.equal(windows.length, 1);
  windows[0].handlers.closed();
  aura.activeProfileIds = [PROFILE_B]; // and switched off, so nothing else will make one

  const { windows: made } = createdDuring(() => wm.setLocked(aura.id, false));
  assert.equal(made.length, 1, 'unlocking an aura with no window must create one to unlock');
  made[0].ready();
  assert.equal(made[0].shown, true, 'and it must actually appear');

  wm.setLocked(aura.id, true);
});

test('a window created on demand by unlocking does not immediately re-lock itself', () => {
  // createWidgetWindow locks every new window, because every aura starts locked on launch
  // whatever it was left as. A window created BY an unlock is the one exception, and overwriting
  // the unlock there put the button straight back to doing nothing.
  const { result: aura, windows } = createdDuring(() => wm.createCustomWidget('Fresh unlock'));
  windows[0].handlers.closed();
  aura.activeProfileIds = [PROFILE_B];

  const { windows: made } = createdDuring(() => wm.setLocked(aura.id, false));
  assert.equal(made.length, 1, 'the setup for this test no longer creates a window');
  assert.equal(wm.isLocked(aura.id), false, 'the unlock must survive its own window being created');
  assert.equal(made[0].ignoresMouse, false, 'and the new window must actually accept clicks');

  wm.setLocked(aura.id, true);
});

test('"Unlock all auras" does NOT drag every switched-off aura onto the screen', () => {
  // Per-aura unlock forces visibility; the master toggle deliberately does not, or unlocking
  // everything dumps every aura you own onto the screen at once.
  const aura = makeAura('Hidden by profile');
  aura.activeProfileIds = [PROFILE_B];

  wm.setAllUnlocked(true);
  assert.equal(wm.isLocked(aura.id), false, 'it should still be unlocked by the master toggle');
  assert.equal(
    wm.shouldBeOnScreen(aura), false,
    'but unlocking everything must not override profile membership'
  );
  wm.setAllUnlocked(false);
});

// --- note 4: master hide -----------------------------------------------------------------------

test('master hide clears the screen and beats an unlocked aura', () => {
  // The one clause that had to be decided rather than inherited. Master hide is for clearing the
  // screen while doing other UI work, so "Hide all auras" appearing to do nothing because
  // something happened to be unlocked is exactly what would make the button useless.
  const aura = makeAura('Unlocked');
  wm.setLocked(aura.id, false);
  assert.equal(wm.shouldBeOnScreen(aura), true);

  wm.setMasterHidden(true);
  assert.equal(wm.shouldBeOnScreen(aura), false, 'master hide must beat unlock, deliberately');

  wm.setMasterHidden(false);
  assert.equal(wm.shouldBeOnScreen(aura), true, 'and give it straight back');
  wm.setLocked(aura.id, true);
});

test('master hide is a toggle that reports its own state, and starts off', () => {
  assert.equal(wm.isMasterHidden(), false, 'it must never start on - it is not persisted');
  wm.setMasterHidden(true);
  assert.equal(wm.isMasterHidden(), true);
  wm.setMasterHidden(false);
  assert.equal(wm.isMasterHidden(), false);
});

test('master hide actually hides and re-shows the windows, not just the answer', () => {
  const { result: aura, windows } = createdDuring(() => wm.createCustomWidget('Watched'));
  windows[0].ready();
  assert.equal(windows[0].shown, true);

  wm.setMasterHidden(true);
  assert.equal(windows[0].shown, false);
  wm.setMasterHidden(false);
  assert.equal(windows[0].shown, true);
  assert.ok(aura.id);
});

// --- the sound-only exemption ------------------------------------------------------------------

test('a sound-only aura is exempt from both screen-clearing rules', () => {
  const aura = makeAura('Silent watcher');
  aura.displayMode = 'sound-only';

  wm.setForegroundHidden(true);
  assert.equal(wm.shouldBeOnScreen(aura), true, 'auto-hide has nothing of this aura to clear');
  wm.setForegroundHidden(false);

  wm.setMasterHidden(true);
  assert.equal(wm.shouldBeOnScreen(aura), true, 'nor does master hide');
  wm.setMasterHidden(false);
});

test('a sound-only aura is NOT exempt from its profile', () => {
  // The exemption sits below the profile check for a reason: an aura that kept beeping after
  // being switched off would be untraceable, because there is nothing on screen to point at.
  const aura = makeAura('Silent watcher two');
  aura.displayMode = 'sound-only';
  aura.activeProfileIds = [PROFILE_B];
  assert.equal(wm.shouldBeOnScreen(aura), false);
  assert.equal(wm.shouldBeAudible(aura), false);
});

test('a sound-only aura stays click-through even when unlocked', () => {
  // Unlocked, it would otherwise be an INVISIBLE rectangle sitting over the game and swallowing
  // clicks, with nothing on screen to explain where they had gone.
  const plain = makeAura('Clickable');
  const silent = makeAura('Not clickable');
  silent.displayMode = 'sound-only';

  assert.equal(wm.shouldIgnoreMouse(plain), true, 'a locked aura is click-through');
  wm.setLocked(plain.id, false);
  assert.equal(wm.shouldIgnoreMouse(plain), false, 'an unlocked ordinary aura catches clicks');
  wm.setLocked(plain.id, true);

  wm.setLocked(silent.id, false);
  assert.equal(wm.shouldIgnoreMouse(silent), true, 'a sound-only aura must never catch clicks');
  wm.setLocked(silent.id, true);
});

// --- the order itself --------------------------------------------------------------------------

test('the four clauses of shouldBeOnScreen are in the order the notes require', () => {
  // The behavioural tests above cover each rule; this one covers the shape, so that a future
  // rule added in the wrong place is caught even if no existing test happens to exercise it.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'widgetManager.js'), 'utf8');
  const body = src.match(/function shouldBeOnScreen\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(body, 'shouldBeOnScreen has been renamed or restructured');
  const b = body[1];
  const at = (needle) => {
    const i = b.indexOf(needle);
    assert.ok(i >= 0, `missing clause: ${needle}`);
    return i;
  };
  assert.ok(at('isVisibleForActiveProfile') < at('isSoundOnly(config)'));
  assert.ok(at('isSoundOnly(config)') < at('masterHidden'));
  assert.ok(at('masterHidden') < at('foregroundHidden'));
});

process.on('exit', () => {
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is not worth failing a test run over.
  }
});

module.exports = () => report('visibility');
if (require.main === module) process.exit(report('visibility') ? 1 : 0);
