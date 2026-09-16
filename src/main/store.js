const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Simple JSON-file-backed persistent store. Each "name" maps to its own
// file under Electron's per-user data directory, e.g.:
//   Windows: C:\Users\<you>\AppData\Roaming\EQ Buff Tracker\<name>.json
// That folder name is pinned in main.js (app.setPath('userData', ...)) to
// the app's original "EQ Buff Tracker" name regardless of current branding
// (now "EQLS Auras") - see the comment there for why.
function loadJson(name, fallback) {
  const filePath = path.join(app.getPath('userData'), `${name}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

// Write through a temp file then rename, so a crash mid-write can never leave a
// half-written (unparseable) JSON file - loadJson would then silently fall back
// to its default and lose everything the file held. rename is atomic on the same
// volume, which the temp file always is.
//
// `pretty: false` skips the indentation - every other file this app writes is small enough that a
// human being able to open and read it is worth the space, but a large, frequently-rewritten file
// (sessionRestore.json, which can hold tens of MB of scanned Combat-tab history) pays for that
// indentation on every single write: pretty-printed nesting measured at roughly 3x the byte count
// of the same data compact, which on a file rewritten every couple of seconds is real, sustained
// disk I/O for no benefit - nobody reads that file by hand.
function saveJson(name, data, { pretty = true } = {}) {
  const filePath = path.join(app.getPath('userData'), `${name}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, filePath);
}

module.exports = { loadJson, saveJson };
