'use strict';
/**
 * ModuleHost - the drop-in custom-aura module loader (feat/module-system). A module is one .js
 * file in userData/modules/ exporting { id, name, apiVersion, onLine, page?, hasAura? }. The host
 * scans + watches the folder, validates each against the v1 contract, keeps a registry, holds
 * per-module settings, and turns onLine() returns into overlay entries off the shared log stream.
 *
 * There is deliberately no user-facing error list - a bad file emits a 'moduleError' event that
 * main.js routes to the debug log. Driven with a real temp folder, no Electron.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { ModuleHost, validateModule, defaultFor, API_VERSION } = require('../src/main/moduleHost');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-modules-'));
const write = (dir, file, body) => fs.writeFileSync(path.join(dir, file), body);
// Seeds `enabledModuleIds: 'all'` so a loaded module is active - a discovered module is OFF by
// default in production (bundled ids only), and the 'disabled by default' test below builds its
// own bare store to check that.
const fakeStore = () => {
  const data = { enabledModuleIds: 'all' };
  return { data, loadJson: (k, f) => (k in data ? data[k] : f), saveJson: (k, v) => { data[k] = v; } };
};
const bareStore = () => {
  const data = {};
  return { data, loadJson: (k, f) => (k in data ? data[k] : f), saveJson: (k, v) => { data[k] = v; } };
};

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
  assert.deepEqual(r.module.page, []);
  assert.deepEqual(r.module.defaults, {});
  assert.equal(r.module.hasAura, false);
  // No aura -> nowhere to put an aura-panel, so settings fall back to a sidebar page.
  assert.equal(r.module.settingsUI, 'sidebar');
});

test('settingsUI defaults to "aura" for a module with an aura, and honours an explicit choice', () => {
  const base = { id: 'x', name: 'X', apiVersion: API_VERSION, onLine: () => null, hasAura: true };
  assert.equal(validateModule({ ...base }).module.settingsUI, 'aura');
  assert.equal(validateModule({ ...base, settingsUI: 'sidebar' }).module.settingsUI, 'sidebar');
  assert.equal(validateModule({ ...base, settingsUI: 'nonsense' }).module.settingsUI, 'aura');
  // asks for 'aura' but has no aura -> can't honour it, falls back to sidebar
  assert.equal(validateModule({ ...base, hasAura: false, settingsUI: 'aura' }).module.settingsUI, 'sidebar');
});

test('validateModule rejects the ways a module can be wrong', () => {
  const bad = [
    [{}, /id/],
    [{ id: 'Bad Id', name: 'x', apiVersion: 1, onLine: () => {} }, /lowercase/],
    [{ id: 'a', name: 'x', apiVersion: 99, onLine: () => {} }, /apiVersion/],
    [{ id: 'a', apiVersion: 1, onLine: () => {} }, /name is required/],
    [{ id: 'a', name: 'x', apiVersion: 1 }, /onLine/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, page: {} }, /page must be an array/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, page: [{ key: 'k', type: 'wat' }] }, /type must be one of/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, page: [{ key: 'k', type: 'select' }] }, /options array/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, page: [{ key: 'k', type: 'slider' }] }, /min and max/],
    [{ id: 'a', name: 'x', apiVersion: 1, onLine: () => {}, page: [{ section: '' }] }, /non-empty string/],
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

test('a page spec produces per-control defaults', () => {
  const r = validateModule({
    id: 'a', name: 'A', apiVersion: API_VERSION, onLine: () => {},
    page: [
      { section: 'S' },
      { key: 'n', type: 'slider', label: 'N', min: 5, max: 60 },
      { key: 'on', type: 'checkbox', label: 'On', default: true },
      { key: 'mode', type: 'select', label: 'M', options: ['x', 'y'] },
      { key: 'txt', type: 'text', label: 'T' },
    ],
  });
  assert.deepEqual(r.module.defaults, { n: 5, on: true, mode: 'x', txt: '' });
  assert.equal(defaultFor({ type: 'slider', min: 3 }), 3);
});

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

test('a good module loads; a bad one emits moduleError, not a crash', () => {
  const dir = tempDir();
  write(dir, 'good.js', GOOD);
  write(dir, 'bad.js', `module.exports = { id: 'nope' };`);
  write(dir, 'broken.js', `this is not valid javascript (`);
  const host = new ModuleHost(dir, fakeStore());
  host.stop();
  const errs = [];
  host.on('moduleError', (e) => errs.push(e));
  host.loadModules();

  // getRegistered() lists every discovered .js now (the Setup page shows failures too); the
  // loaded ones carry an id, the failures carry an error.
  const reg = host.getRegistered();
  const loaded = reg.filter((m) => m.id);
  const failed = reg.filter((m) => !m.id);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'test-mod');
  assert.equal(loaded[0].hasAura, true);
  assert.equal(failed.length, 2);
  assert.ok(failed.every((f) => f.file && f.error));

  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => e.id === 'bad.js' && /apiVersion|name/.test(e.error)));
  assert.ok(errs.some((e) => e.id === 'broken.js' && /failed to load/.test(e.error)));
});

test('a discovered module is INERT until enabled, and the first enable is the gate', () => {
  const dir = tempDir();
  write(dir, 'x.js', GOOD.replace("id: 'test-mod'", "id: 'x'"));
  const host = new ModuleHost(dir, bareStore()); // no enabledModuleIds -> bundled only, x is not bundled
  host.stop();
  host.loadModules();

  const [row] = host.getRegistered();
  assert.equal(row.id, 'x');
  assert.equal(row.enabled, false, 'off until the user turns it on');

  // Inert: onLine does not run, no entries.
  host.handleLine('PING');
  assert.equal(host.getEntries('x').length, 0, 'a disabled module must not process lines');

  // Enable it -> now active, and the choice is persisted (alongside the bundled default).
  host.setModuleEnabled('x', true);
  assert.equal(host.getRegistered()[0].enabled, true);
  assert.ok(host.store.data.enabledModuleIds.includes('x'), 'the enable was persisted');
  host.handleLine('PING');
  assert.equal(host.getEntries('x').length, 1, 'an enabled module processes lines');

  // Disable -> inert again, entries cleared.
  host.setModuleEnabled('x', false);
  assert.equal(host.getEntries('x').length, 0);
});

test('the bundled module (aggro-board) is enabled out of the box', () => {
  const { BUNDLED_MODULE_IDS } = require('../src/main/moduleHost');
  const dir = tempDir();
  write(dir, 'aggro-board.js', fs.readFileSync(path.join(__dirname, '..', 'modules', 'aggro-board.js'), 'utf8'));
  const host = new ModuleHost(dir, bareStore());
  host.stop();
  host.loadModules();
  assert.ok(BUNDLED_MODULE_IDS.includes('aggro-board'));
  assert.equal(host.getRegistered().find((m) => m.id === 'aggro-board').enabled, true);
});

test('a missing modules folder is created, not an error', () => {
  const dir = path.join(tempDir(), 'does-not-exist-yet');
  const host = new ModuleHost(dir, fakeStore());
  host.stop();
  const errs = [];
  host.on('moduleError', (e) => errs.push(e));
  host.loadModules();
  assert.deepEqual(errs, []);
  assert.ok(fs.existsSync(dir));
});

test('loadModules re-reads the folder from scratch', () => {
  const dir = tempDir();
  write(dir, 'good.js', GOOD);
  const host = new ModuleHost(dir, fakeStore());
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
// settings
// ---------------------------------------------------------------------------

test('settings are page defaults until overridden, then persisted', () => {
  const dir = tempDir();
  write(dir, 'm.js', `module.exports = {
    id: 'cfg', name: 'Cfg', apiVersion: ${API_VERSION},
    page: [{ key: 'threshold', type: 'slider', label: 'T', min: 0, max: 60, default: 30 }],
    onLine: () => null,
  };`);
  const store = fakeStore();
  const host = new ModuleHost(dir, store);
  host.stop();
  host.loadModules();

  assert.equal(host.getSettings('cfg').threshold, 30);
  host.setSetting('cfg', 'threshold', 15);
  assert.equal(host.getSettings('cfg').threshold, 15);
  assert.deepEqual(store.data.moduleSettings, { cfg: { threshold: 15 } });

  // a fresh host with the same store keeps the value
  const host2 = new ModuleHost(dir, store);
  host2.stop();
  host2.loadModules();
  assert.equal(host2.getSettings('cfg').threshold, 15);
});

test('onLine receives the live settings as its third argument', () => {
  const dir = tempDir();
  write(dir, 'm.js', `module.exports = {
    id: 's', name: 'S', apiVersion: ${API_VERSION},
    page: [{ key: 'word', type: 'text', label: 'W', default: 'ping' }],
    onLine(line, ctx, settings) {
      return line.includes(settings.word) ? { key: 'hit', name: 'Hit' } : null;
    },
  };`);
  const host = new ModuleHost(dir, fakeStore());
  host.stop();
  host.loadModules();

  host.handleLine('nothing');
  assert.equal(host.getEntries('s').length, 0);
  host.setSetting('s', 'word', 'boom');
  host.handleLine('a boom happened');
  assert.equal(host.getEntries('s').length, 1);
});

// ---------------------------------------------------------------------------
// the log bus
// ---------------------------------------------------------------------------

function loadedHost(source = GOOD) {
  const dir = tempDir();
  write(dir, 'm.js', source);
  const host = new ModuleHost(dir, fakeStore());
  host.stop();
  host.loadModules();
  return host;
}

test('onLine returns become live entries, shaped like a built-in feed', () => {
  const host = loadedHost();
  let emitted = null;
  host.on('entriesChanged', (all) => (emitted = all));

  host.handleLine('[ts] nothing here');
  assert.equal(emitted, null);

  host.handleLine('[ts] PING received');
  const entries = host.getEntries('test-mod');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Ping');
  assert.ok(entries[0].remainingSec > 0 && entries[0].remainingSec <= 10);
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
  host._tick();
  assert.deepEqual(host.getEntries('x').map((e) => e.key), ['f']);
});

test('a throwing module is caught and reported, and does not stop the others', () => {
  const dir = tempDir();
  write(dir, 'boom.js', `module.exports = { id: 'boom', name: 'Boom', apiVersion: ${API_VERSION}, onLine() { throw new Error('kaboom'); } };`);
  write(dir, 'fine.js', GOOD);
  const host = new ModuleHost(dir, fakeStore());
  host.stop();
  const errs = [];
  host.on('moduleError', (e) => errs.push(e));
  host.loadModules();

  host.handleLine('PING');
  assert.ok(errs.some((e) => e.id === 'boom' && /kaboom/.test(e.error)));
  assert.equal(host.getEntries('test-mod').length, 1);
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

test('{ key, clear: true } retracts an entry immediately', () => {
  const host = loadedHost(`module.exports = {
    id: 'c', name: 'C', apiVersion: ${API_VERSION},
    onLine(l) {
      if (l.includes('ON')) return { key: 'k', name: 'K', remainingSec: 999 };
      if (l.includes('OFF')) return { key: 'k', clear: true };
      return null;
    },
  };`);
  host.handleLine('ON');
  assert.equal(host.getEntries('c').length, 1);
  host.handleLine('OFF');
  assert.equal(host.getEntries('c').length, 0);
});

test('ctx.stripTimestamp removes the log prefix; line itself is raw', () => {
  const host = loadedHost(`module.exports = {
    id: 't', name: 'T', apiVersion: ${API_VERSION},
    onLine(line, ctx) {
      return { key: 'k', name: line.startsWith('[') + '|' + ctx.stripTimestamp(line) };
    },
  };`);
  host.handleLine('[Mon Sep 01 12:00:00 2026] You say hi');
  assert.equal(host.getEntries('t')[0].name, 'true|You say hi');
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

// ---------------------------------------------------------------------------
// the shipped example
// ---------------------------------------------------------------------------

test('docs/modules/pull-timer.js is a valid v1 module and its onLine works', () => {
  const example = require('../docs/modules/pull-timer.js');
  const r = validateModule(example);
  assert.equal(r.ok, true, r.error);

  const ctx = { stripTimestamp: (l) => l.replace(/^\[[^\]]+\]\s*/, ''), now: Date.now() };
  const s = { seconds: 8, startWord: 'pulling', cancelWord: 'hold' };
  assert.deepEqual(
    example.onLine("[ts] Baxa tells the group, 'pulling now'", ctx, s),
    { key: 'pull', name: 'Pull', durationSec: 8, remainingSec: 8 }
  );
  assert.deepEqual(example.onLine("[ts] Baxa tells the group, 'hold'", ctx, s), { key: 'pull', clear: true });
  assert.equal(example.onLine('[ts] a rat hits Baxa for 3 points of damage.', ctx, s), null);
});

test('modules load from the install folder, not userData, and ship in the installer', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /const MODULES_DIR = app\.isPackaged\s*\n?\s*\? path\.join\(path\.dirname\(app\.getPath\('exe'\)\), 'modules'\)/);
  assert.doesNotMatch(main, /new ModuleHost\(path\.join\(app\.getPath\('userData'\), 'modules'\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.extraFiles.some((e) => e.from === 'modules' && e.to === 'modules'), 'modules/ is not shipped');
  // the shipped folder has aggro-board and NOT pull-timer (pull-timer is disabled, docs-only)
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'modules', 'aggro-board.js')));
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'modules', 'pull-timer.js')));
});

test('modules/aggro-board.js (shipped) is a valid v1 module, key-exclusive, self-clears on slain', () => {
  const mod = require('../modules/aggro-board.js');
  assert.equal(validateModule(mod).ok, true, validateModule(mod).error);
  // Its two options live on the aura panel, not a sidebar page.
  assert.equal(validateModule(mod).module.settingsUI, 'aura');

  const ctx = { stripTimestamp: (l) => l.replace(/^\[[^\]]+\]\s*/, ''), now: Date.now() };
  const s = { showMargin: true, staleSeconds: 12 };

  // a mob swinging at someone -> the holder tile, other two keys cleared
  const out = mod.onLine('[ts] a vis ghoul knight hits Baxa for 40 points of damage.', ctx, s);
  const holder = out.find((e) => e.key === 'aggro-holder');
  assert.ok(holder && holder.name.includes('Baxa') && holder.durationSec === 0);
  assert.deepEqual(out.filter((e) => e.clear).map((e) => e.key).sort(), ['aggro-quiet', 'aggro-stale']);

  // the mob dies -> back to the "nothing swinging" tile
  const dead = mod.onLine('[ts] a vis ghoul knight has been slain by Baxa!', ctx, s);
  assert.equal(dead.find((e) => !e.clear).key, 'aggro-quiet');

  // an unrelated line is ignored
  assert.equal(mod.onLine('[ts] You gain experience!', ctx, s), null);
});

// The folder watcher raises 'error' asynchronously on Windows (EPERM) when the watched dir moves
// under it - a git branch switch while the dev app runs. An FSWatcher is an EventEmitter, so an
// unhandled 'error' throws and, with no process-level handler, hard-crashed the main process with
// a raw dialog. The watcher must handle its own 'error': close, forget, don't throw.
test('a watcher error is handled - it does not throw, and the watch is dropped', () => {
  const dir = tempDir();
  const host = new ModuleHost(dir, fakeStore());
  host.watchFolder();
  assert.ok(host._watcher, 'expected a live watcher');
  let emittedModuleError = null;
  host.on('moduleError', (e) => { emittedModuleError = e; });

  // Exactly the shape Node delivers on the real EPERM.
  assert.doesNotThrow(() => host._watcher.emit('error', Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })));

  assert.equal(host._watcher, null, 'the dead watcher was forgotten');
  assert.ok(emittedModuleError && /folder watch stopped/.test(emittedModuleError.error), 'surfaced as a moduleError, not a crash');
  host.stop();
});

test('main.js has a last-resort uncaughtException / unhandledRejection net', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /process\.on\('uncaughtException'/, 'no uncaughtException handler - a stray async error would show a raw crash dialog');
  assert.match(main, /process\.on\('unhandledRejection'/);
  assert.match(main, /crash\.log/, 'the handler should write somewhere findable regardless of the debug-log setting');
});

module.exports = () => report('module-host');
if (require.main === module) report('module-host').then((n) => process.exit(n ? 1 : 0));
