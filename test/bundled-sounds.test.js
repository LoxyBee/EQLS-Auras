'use strict';
/**
 * The install's own bundled sounds/ folder (soundService.js's bundledSoundsDir()) - requested
 * directly: "a standalone sounds folder INSIDE the install itself that people would add to, with
 * some pre added sounds." Ships via package.json's extraFiles (next to the .exe, not inside
 * app.asar - a real folder Explorer can browse and someone can drop files into), pre-seeded by
 * tools/generate-bundled-sounds.js.
 *
 * The one thing worth a real test: "the install folder" resolves DIFFERENTLY packaged vs dev, and
 * getting that wrong silently means either the picker defaults to a folder that will never exist
 * on a real install (electron.exe's own directory inside node_modules), or - the more dangerous
 * direction - a packaged build resolving into app.asar, which extraFiles content is never placed
 * in, so the bundled sounds would never be found at all despite genuinely being on disk one level
 * up. Both failure modes are silent: defaultPickerDir() just falls through to the next candidate,
 * so a wrong path here doesn't throw, it quietly stops offering the starter sounds.
 *
 * Same require-stub convention as pin.test.js/visibility.test.js - Electron isn't available in a
 * plain Node test run, so it's replaced in the require cache with a small fake before
 * soundService.js is pulled in.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const SOUND_SERVICE_JS = path.join(ROOT, 'src', 'main', 'soundService.js');
const STORE_JS = path.join(ROOT, 'src', 'main', 'store.js');

function withStubbedElectron(appStub, fn, { openPath } = {}) {
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') {
      return {
        app: appStub,
        dialog: {},
        protocol: { handle: () => {} },
        shell: { openPath: openPath || (() => Promise.resolve('')) },
      };
    }
    return orig.call(this, request, ...rest);
  };
  delete require.cache[require.resolve(SOUND_SERVICE_JS)];
  delete require.cache[require.resolve(STORE_JS)];
  try {
    return fn();
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(SOUND_SERVICE_JS)];
    delete require.cache[require.resolve(STORE_JS)];
  }
}

function makeAppStub({ isPackaged, exePath, appPath, userDataDir }) {
  return {
    isPackaged,
    getPath(name) {
      if (name === 'exe') return exePath;
      if (name === 'userData') return userDataDir;
      throw new Error(`unexpected getPath(${name})`);
    },
    getAppPath() {
      return appPath;
    },
  };
}

test('dev (unpackaged): bundled sounds dir is the project root\'s sounds/ folder, not electron.exe\'s own directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auras-sounds-'));
  try {
    const app = makeAppStub({
      isPackaged: false,
      exePath: path.join(tmp, 'node_modules', 'electron', 'dist', 'electron.exe'),
      appPath: path.join(tmp, 'project-root'),
      userDataDir: path.join(tmp, 'userData'),
    });
    const dir = withStubbedElectron(app, () => require(SOUND_SERVICE_JS).bundledSoundsDir());
    assert.equal(dir, path.join(tmp, 'project-root', 'sounds'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('packaged: bundled sounds dir sits beside the .exe, not inside app.asar', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auras-sounds-'));
  try {
    const installDir = path.join(tmp, 'EQLS Auras');
    const app = makeAppStub({
      isPackaged: true,
      exePath: path.join(installDir, 'EQLS Auras.exe'),
      // getAppPath() would point inside resources/app.asar once packaged - deliberately different
      // from installDir here, so the test fails if bundledSoundsDir() ever reads from this instead.
      appPath: path.join(installDir, 'resources', 'app.asar'),
      userDataDir: path.join(tmp, 'userData'),
    });
    const dir = withStubbedElectron(app, () => require(SOUND_SERVICE_JS).bundledSoundsDir());
    assert.equal(dir, path.join(installDir, 'sounds'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the picker defaults to the bundled sounds folder when it exists and nothing is remembered yet', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auras-sounds-'));
  try {
    const installDir = path.join(tmp, 'EQLS Auras');
    const soundsDir = path.join(installDir, 'sounds');
    fs.mkdirSync(soundsDir, { recursive: true });
    fs.writeFileSync(path.join(soundsDir, 'Chime.wav'), Buffer.from('x'));

    const userDataDir = path.join(tmp, 'userData');
    fs.mkdirSync(userDataDir, { recursive: true });

    const app = makeAppStub({
      isPackaged: true,
      exePath: path.join(installDir, 'EQLS Auras.exe'),
      appPath: path.join(installDir, 'resources', 'app.asar'),
      userDataDir,
    });
    // defaultPickerDir() isn't exported (it's only ever used internally) - openPickerFolder() is
    // the real, exported consumer, and it falls back to exactly defaultPickerDir()'s answer.
    // Redirect shell.openPath to capture what it was asked to open instead of actually opening it.
    let openedPath = null;
    withStubbedElectron(
      app,
      () => require(SOUND_SERVICE_JS).openPickerFolder(),
      { openPath: (p) => { openedPath = p; return Promise.resolve(''); } }
    );
    assert.equal(openedPath, soundsDir, 'should have opened the bundled sounds folder, not userData/customSounds or Windows Media');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reported live: a sound picked from Windows Media before the bundled folder existed must not shadow it forever', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auras-sounds-'));
  try {
    const installDir = path.join(tmp, 'EQLS Auras');
    const soundsDir = path.join(installDir, 'sounds');
    fs.mkdirSync(soundsDir, { recursive: true });
    fs.writeFileSync(path.join(soundsDir, 'Chime.wav'), Buffer.from('x'));

    const userDataDir = path.join(tmp, 'userData');
    fs.mkdirSync(userDataDir, { recursive: true });
    // Exactly what an install that used "Choose sound..." before this feature shipped has saved -
    // a real prior pick, remembered as any other pick would be, that happens to be the app's own
    // pre-bundled-folder fallback rather than something the user actually navigated to.
    fs.writeFileSync(path.join(userDataDir, 'lastSoundPickerDir.json'), JSON.stringify('C:\\Windows\\Media'), 'utf8');

    const app = makeAppStub({
      isPackaged: true,
      exePath: path.join(installDir, 'EQLS Auras.exe'),
      appPath: path.join(installDir, 'resources', 'app.asar'),
      userDataDir,
    });
    let openedPath = null;
    withStubbedElectron(
      app,
      () => require(SOUND_SERVICE_JS).openPickerFolder(),
      { openPath: (p) => { openedPath = p; return Promise.resolve(''); } }
    );
    assert.equal(openedPath, soundsDir, 'a remembered Windows Media pick must not outrank the bundled folder');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a remembered folder that is NOT Windows Media still wins outright over the bundled folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auras-sounds-'));
  try {
    const installDir = path.join(tmp, 'EQLS Auras');
    const soundsDir = path.join(installDir, 'sounds');
    fs.mkdirSync(soundsDir, { recursive: true });

    const ownFolder = path.join(tmp, 'my-own-sounds');
    fs.mkdirSync(ownFolder, { recursive: true });

    const userDataDir = path.join(tmp, 'userData');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'lastSoundPickerDir.json'), JSON.stringify(ownFolder), 'utf8');

    const app = makeAppStub({
      isPackaged: true,
      exePath: path.join(installDir, 'EQLS Auras.exe'),
      appPath: path.join(installDir, 'resources', 'app.asar'),
      userDataDir,
    });
    let openedPath = null;
    withStubbedElectron(
      app,
      () => require(SOUND_SERVICE_JS).openPickerFolder(),
      { openPath: (p) => { openedPath = p; return Promise.resolve(''); } }
    );
    assert.equal(openedPath, ownFolder, 'a genuinely chosen folder must still be respected, not overridden by the bundled default');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

module.exports = () => report('bundled-sounds');
if (require.main === module) process.exit(report('bundled-sounds') ? 1 : 0);
