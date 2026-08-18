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

function saveJson(name, data) {
  const filePath = path.join(app.getPath('userData'), `${name}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { loadJson, saveJson };
