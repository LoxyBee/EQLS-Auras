'use strict';
/**
 * Guards the userData pin in src/main/main.js.
 *
 * WHY THIS IS THE FIRST TEST IN THE PROJECT
 * -----------------------------------------
 * Electron derives the userData folder from the app's display name, so renaming the product moves
 * it and every saved aura, loadout profile, buff correction and cached icon appears to vanish.
 * main.js pins it to the original "EQ Buff Tracker" folder so no rename ever touches real data.
 *
 * The pin must sit ABOVE every local require(). That is not a style preference:
 * widgetManager.js:7 constructs a WidgetStore at module-evaluation time - not inside a function -
 * so merely requiring it runs a store constructor. A require placed above the pin therefore reads
 * and writes widgets.json under the WRONG folder before the pin ever executes.
 *
 * This already happened once. main.js's own comment records an earlier version of the pin sitting
 * below the requires, which silently seeded a second, empty widgets.json under the new folder
 * while buffs, profiles and the spellbook stayed in the old one. A split brain, and nothing threw.
 *
 * The realistic way to reintroduce it is not editing the pin - nobody edits a line wrapped in
 * twenty lines of warning. It is adding one more `const { X } = require('./x')` at the top of the
 * require block, which is the most natural edit anyone ever makes to a main-process file.
 * That is what these tests are really for.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const MAIN_JS = path.join(ROOT, 'src', 'main', 'main.js');
const STORE_JS = path.join(ROOT, 'src', 'main', 'store.js');

const PINNED_FOLDER = 'EQ Buff Tracker'; // never change without a real, tested data migration

/**
 * Strip comments so we reason about CODE only.
 *
 * This matters more than it looks: main.js's comment block quotes `require('./widgetManager')` as
 * an example of what must not appear above the pin. A naive scan matches that comment and reports
 * the pin as mis-ordered when it is perfectly fine - a false alarm that has already been raised
 * once by a reviewer. String literals are preserved so the pinned folder name survives.
 */
function stripComments(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i++; continue; }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i++; continue; }
      if (c === "'" || c === '"' || c === '`') state = c;
      out += c;
      continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += '\n'; } else out += ' '; continue; }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out += '  '; i++; continue; }
      out += c === '\n' ? '\n' : ' ';
      continue;
    }
    // inside a string literal
    if (c === '\\') { out += c + (src[i + 1] || ''); i++; continue; }
    if (c === state) state = 'code';
    out += c;
  }
  return out;
}

const mainCode = stripComments(fs.readFileSync(MAIN_JS, 'utf8'));
const codeLines = mainCode.split(/\r?\n/);

const PIN_RE = /app\s*\.\s*setPath\s*\(\s*['"]userData['"]/;
const LOCAL_REQUIRE_RE = /require\s*\(\s*['"]\.\.?\//;

test('main.js pins userData to the original folder name', () => {
  const m = mainCode.match(
    /app\s*\.\s*setPath\s*\(\s*['"]userData['"]\s*,\s*path\s*\.\s*join\s*\(\s*app\s*\.\s*getPath\s*\(\s*['"]appData['"]\s*\)\s*,\s*['"]([^'"]+)['"]/
  );
  assert.ok(m, "no app.setPath('userData', path.join(app.getPath('appData'), ...)) found in main.js");
  assert.equal(
    m[1], PINNED_FOLDER,
    `userData is pinned to "${m[1]}" but must stay "${PINNED_FOLDER}" - changing it orphans every existing user's saved data`
  );
});

test('NO local require() sits above the pin', () => {
  const pin = codeLines.findIndex((l) => PIN_RE.test(l));
  assert.notEqual(pin, -1, 'pin not found in main.js');
  const offenders = [];
  for (let i = 0; i < pin; i++) {
    if (LOCAL_REQUIRE_RE.test(codeLines[i])) offenders.push(`line ${i + 1}: ${codeLines[i].trim()}`);
  }
  assert.deepEqual(
    offenders, [],
    'A local module is required ABOVE the userData pin. widgetManager.js builds its WidgetStore at ' +
    'module-evaluation time, so this reads/writes widgets.json under the WRONG folder before the ' +
    'pin runs, splitting saved state in two:\n  ' + offenders.join('\n  ')
  );
});

test('the pin runs before any local require', () => {
  const pin = codeLines.findIndex((l) => PIN_RE.test(l));
  const first = codeLines.findIndex((l) => LOCAL_REQUIRE_RE.test(l));
  assert.notEqual(first, -1, 'no local require() found - has main.js been restructured?');
  assert.ok(pin < first, `pin is on code line ${pin + 1} but a local require appears on line ${first + 1}`);
});

test('nothing else in the app repoints userData', () => {
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const code = stripComments(fs.readFileSync(p, 'utf8'));
        if (/setPath\s*\(\s*['"]userData['"]/.test(code) && path.resolve(p) !== path.resolve(MAIN_JS)) hits.push(p);
      }
    }
  })(path.join(ROOT, 'src'));
  assert.deepEqual(hits, [], `userData is repointed outside main.js, which can defeat the pin: ${hits.join(', ')}`);
});

test('widgetManager still builds its store at module-evaluation time', () => {
  // If this ever stops being true the ordering rule relaxes - but until then it is the reason
  // the rule exists, so the test states it out loud rather than leaving it as folklore.
  const wm = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'main', 'widgetManager.js'), 'utf8'));
  const lines = wm.split(/\r?\n/);
  const idx = lines.findIndex((l) => /new\s+WidgetStore\s*\(/.test(l));
  assert.notEqual(idx, -1, 'no `new WidgetStore(` found in widgetManager.js');
  const indented = /^\s/.test(lines[idx]);
  assert.ok(
    !indented,
    'WidgetStore is no longer constructed at module scope. That is fine, but it means the ' +
    'require-ordering hazard has changed shape - re-read the comment at the top of main.js.'
  );
});

// -------------------------------------------------------------- behavioural

function withStubbedElectron(appStub, fn) {
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { app: appStub };
    return orig.call(this, request, ...rest);
  };
  delete require.cache[require.resolve(STORE_JS)];
  try { return fn(); } finally {
    Module._load = orig;
    delete require.cache[require.resolve(STORE_JS)];
  }
}

/** Mimics Electron: userData defaults to <appData>/<productName> until setPath overrides it. */
function makeAppStub(appDataDir, productName) {
  let userData = path.join(appDataDir, productName);
  return {
    getPath(name) {
      if (name === 'appData') return appDataDir;
      if (name === 'userData') return userData;
      throw new Error(`unexpected getPath(${name})`);
    },
    setPath(name, value) {
      if (name !== 'userData') throw new Error(`unexpected setPath(${name})`);
      userData = value;
    },
  };
}

const productName = require(path.join(ROOT, 'package.json')).productName;

test('state saved under the old folder still loads after a rename', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auras-pin-'));
  try {
    const legacy = path.join(tmp, PINNED_FOLDER);
    fs.mkdirSync(legacy, { recursive: true });
    const saved = { version: 1, widgets: [{ id: 'w1', kind: 'self-buffs' }] };
    fs.writeFileSync(path.join(legacy, 'widgets.json'), JSON.stringify(saved), 'utf8');

    const app = makeAppStub(tmp, productName);
    app.setPath('userData', path.join(app.getPath('appData'), PINNED_FOLDER)); // the pin

    const loaded = withStubbedElectron(app, () => require(STORE_JS).loadJson('widgets', null));
    assert.deepEqual(loaded, saved, 'existing widgets.json was not read back - saved state would appear lost');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a stale folder named after the current product does not win', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auras-pin-'));
  try {
    const legacy = path.join(tmp, PINNED_FOLDER);
    const decoy = path.join(tmp, productName);
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(decoy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'widgets.json'), JSON.stringify({ from: 'legacy' }), 'utf8');
    fs.writeFileSync(path.join(decoy, 'widgets.json'), JSON.stringify({ from: 'decoy' }), 'utf8');

    const app = makeAppStub(tmp, productName);
    app.setPath('userData', path.join(app.getPath('appData'), PINNED_FOLDER));

    const loaded = withStubbedElectron(app, () => require(STORE_JS).loadJson('widgets', null));
    assert.deepEqual(loaded, { from: 'legacy' }, 'the empty split-brain folder won - this is the exact bug the pin prevents');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

module.exports = () => report('pin');
if (require.main === module) report('pin').then((n) => process.exit(n ? 1 : 0));
