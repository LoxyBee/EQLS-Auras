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
function saveJson(name, data) {
  const filePath = path.join(app.getPath('userData'), `${name}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

module.exports = { loadJson, saveJson };
