'use strict';
/**
 * ModuleHost - the drop-in custom-aura module loader (feat/module-system). A module is one .js
 * file in userData/modules/ exporting { id, name, apiVersion, onLine, ... }. The host scans the
 * folder, validates each against the v1 contract, keeps a registry, and turns onLine() returns
 * into overlay entries off the shared log-line stream.
 *
 * Driven with a real temp folder and real files, no Electron.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { ModuleHost, validateModule, API_VERSION } = require('../src/main/moduleHost');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-modules-'));
}
function write(dir, file, body) {
  fs.writeFileSync(path.join(dir, file), body);
}

// A minimal valid module as source text.
const GOOD = `module.exports = {
  id: 'test-mod', name: 'Test Module', apiVersion: ${API_VERSION},
  hasAura: true,
  onLine(line) {
    if (line.includes('PING')) return [{ key: 'ping', name: 'Ping', remainingSec: 10 }];
    return null;
  },
};`;

// ---------------------------------------------------------------------------
// validateModule (pure)
// ---------------------------------------------------------------------------

test('validateModule accepts a minimal good module and normalises optionals', () => {
  const r = validateModule({ id: 'a', name: 'A', apiVersion: API_VERSION, onLine: () => null });
  assert.equal(r.ok, true);
  assert.equal(r.module.group, 'standalone');
  assert.deepEqual(r.module.defaultConfig, {});
  assert.deepEqual(r.module.settingsSchema, []);
  assert.equal(r.module.hasAura, false);
});

test('validateModule rejects the ways a module can be wrong', () => {
  const bad = [
    [{}, /id/],
    [{ id: 'Bad Id', name: 'x', apiVersion: 1, onLine: () => {} }, /lowercase/],
    [{ id: 'a', name: 'x', apiVersion: 99, onLine: () => {} }, /apiVersion/],
    [{ id: 'a', apiVersion: 1, onLine: () => {} }, /name is required/],
    [{ id: 'a', name: 'x', apiVersion: 1 }, /onLine/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, defaultConfig: [] }, /defaultConfig/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, settingsSchema: [{ key: 'k', type: 'wat' }] }, /type must be one of/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, settingsSchema: [{ key: 'k', type: 'select' }] }, /options array/],
  ];
  for (const [raw, re] of bad) {
    const r = validateModule(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.match(r.error, re);
  }
});

test('validateModule rejects a duplicate id', () => {
  const r = validateModule({ id: 'dup', name: 'x', apiVersion: API_VERSION, onLine: () => {} }, { knownIds: new Set(['dup']) });
  assert.equal(r.ok, false);
  assert.match(r.error, /already used/);
});

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

test('a good module loads and shows up in the registry; a bad one becomes a load error, not a crash', () => {
  const dir = tempDir();
  write(dir, 'good.js', GOOD);
  write(dir, 'bad.js', `module.exports = { id: 'nope' };`);
  write(dir, 'broken.js', `this is not valid javascript (`);
  const host = new ModuleHost(dir);
  host.stop();
  host.loadModules();

  const reg = host.getRegistered();
  assert.equal(reg.length, 1);
  assert.equal(reg[0].id, 'test-mod');
  assert.equal(reg[0].hasAura, true);

  const errs = host.getLoadErrors();
  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => e.file === 'bad.js' && /apiVersion|name/.test(e.error)));
  assert.ok(errs.some((e) => e.file === 'broken.js' && /failed to load/.test(e.error)));
});

test('a missing modules folder is created, not an error', () => {
  const dir = path.join(tempDir(), 'does-not-exist-yet');
  const host = new ModuleHost(dir);
  host.stop();
  host.loadModules();
  assert.deepEqual(host.getLoadErrors(), []);
  assert.ok(fs.existsSync(dir));
});

test('loadModules is also "reload" - it re-reads the folder from scratch', () => {
  const dir = tempDir();
  write(dir, 'good.js', GOOD);
  const host = new ModuleHost(dir);
  host.stop();
  host.loadModules();
  assert.equal(host.getRegistered().length, 1);

  fs.rmSync(path.join(dir, 'good.js'));
  write(dir, 'other.js', GOOD.replace('test-mod', 'other-mod').replace('Test Module', 'Other'));
  host.loadModules();
  const reg = host.getRegistered();
  assert.equal(reg.length, 1);
  assert.equal(reg[0].id, 'other-mod');
});

// ---------------------------------------------------------------------------
// the log bus
// ---------------------------------------------------------------------------

function loadedHost(source = GOOD, file = 'm.js') {
  const dir = tempDir();
  write(dir, file, source);
  const host = new ModuleHost(dir);
  host.stop();
  host.loadModules();
  return host;
}

test('onLine returns become live entries, shaped like a built-in feed', () => {
  const host = loadedHost();
  let emitted = null;
  host.on('entriesChanged', (all) => (emitted = all));

  host.handleLine('[ts] nothing here');
  assert.equal(emitted, null, 'a non-matching line changes nothing');

  host.handleLine('[ts] PING received');
  const entries = host.getEntries('test-mod');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Ping');
  assert.ok(entries[0].remainingSec > 0 && entries[0].remainingSec <= 10);
  assert.equal(entries[0].infinite, false);
  assert.ok(emitted && emitted['test-mod'].length === 1);
});

test('an entry with no duration is infinite; the 1s sweep expires a finite one', () => {
  const host = loadedHost(`module.exports = {
    id: 'x', name: 'X', apiVersion: ${API_VERSION},
    onLine(l) {
      if (l.includes('FOREVER')) return { key: 'f', name: 'Forever' };
      if (l.includes('BRIEF')) return { key: 'b', name: 'Brief', remainingSec: 0 };
      return null;
    },
  };`);
  host.handleLine('FOREVER');
  host.handleLine('BRIEF');
  assert.equal(host.getEntries('x').find((e) => e.key === 'f').infinite, true);
  host._tick(); // BRIEF's expiresAt was now+0, so the very next sweep drops it
  const keys = host.getEntries('x').map((e) => e.key);
  assert.deepEqual(keys, ['f']);
});

test('a throwing module is caught and reported, and does not stop the others', () => {
  const dir = tempDir();
  write(dir, 'boom.js', `module.exports = { id: 'boom', name: 'Boom', apiVersion: ${API_VERSION}, onLine() { throw new Error('kaboom'); } };`);
  write(dir, 'fine.js', GOOD);
  const host = new ModuleHost(dir);
  host.stop();
  host.loadModules();
  const errs = [];
  host.on('moduleError', (e) => errs.push(e));

  host.handleLine('PING');
  assert.ok(errs.some((e) => e.id === 'boom' && /kaboom/.test(e.error)));
  assert.equal(host.getEntries('test-mod').length, 1, 'the good module still ran');
});

test('a persistently slow module is disabled for the session', () => {
  const host = loadedHost(`module.exports = {
    id: 'slow', name: 'Slow', apiVersion: ${API_VERSION},
    onLine() { const t = Date.now(); while (Date.now() - t < 60) {} return null; },
  };`);
  const errs = [];
  host.on('moduleError', (e) => errs.push(e));
  for (let i = 0; i < 25; i++) host.handleLine('tick');
  assert.ok(errs.some((e) => e.id === 'slow' && /too slow/.test(e.error)));
  assert.equal(host.getRegistered()[0].disabled, true);
});

test('ctx carries the injected zone / group / icon accessors', () => {
  const host = loadedHost(`module.exports = {
    id: 'ctx', name: 'Ctx', apiVersion: ${API_VERSION},
    onLine(line, ctx) {
      return { key: 'k', name: ctx.currentZone + '|' + ctx.groupMembers.join(',') + '|' + ctx.iconUrlForSpell('Spirit of Wolf') };
    },
  };`);
  host.setCurrentZoneFn(() => 'Rivervale');
  host.setGroupMembersFn(() => ['Baxa', 'Avenrae']);
  host.setIconUrlForSpellFn((n) => `eqicon://${n}`);
  host.handleLine('go');
  assert.equal(host.getEntries('ctx')[0].name, 'Rivervale|Baxa,Avenrae|eqicon://Spirit of Wolf');
});

module.exports = () => report('module-host');
if (require.main === module) report('module-host').then((n) => process.exit(n ? 1 : 0));
