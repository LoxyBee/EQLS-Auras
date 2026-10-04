'use strict';

// Backlog #3c - export / import the whole config as a portable bundle, so the app can be handed
// to someone else or moved between machines. Offline, local files only.
//
// A bundle is a FOLDER (not a single file): the config is a pile of small JSON files plus the
// customSounds / sounds folders, and a folder that someone can zip and send is simpler than
// base64-ing binary sound files into one JSON. Export writes one under userData/exports/; import
// reads one back (from exports/ or from a "Back up now" folder under backups/), after taking a
// safety backup first.
//
// Everything is walked by explicit EXCLUDE list rather than an include list, so a config file
// added later is carried automatically. What is excluded is the handful of things that are
// specific to THIS machine or are live state, never portable config.

const fs = require('fs');
const path = require('path');

// `.json` basenames that must NOT travel: this machine's screen layout, this machine's paths,
// and live per-session state.
const EXCLUDE_JSON = new Set([
  'config.json', // holds the EQ install path
  'mainWindowBounds.json', 'sidebarWidth.json', 'uiScale.json',
  'overlayPosition.json', 'ambiguousPopupPosition.json', 'zonePromptPopupPosition.json',
  'currentlyMemorized.json', 'currentlyMemorizedByProfile.json',
  'sessionRestore.json', 'sessionSnapshot.json', 'groupRoster.json', // live per-session engine state
  'splitProgress.json', 'lockoutLogTarget.json', 'lastSoundPickerDir.json',
  'loadoutLabelAutoOffered.json',
]);
// Non-JSON folders that DO travel. Module .js files no longer live here - they moved to the
// install's own `modules/` folder (owner's call, 1 Sep) and are shipped, so they come with the
// install rather than a config bundle. `moduleSettings.json` still rides along as an ordinary
// non-excluded .json, so a user's per-module tuning still moves between machines.
const EXTRA_DIRS = ['customSounds', 'sounds'];

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function copyInto(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) fs.cpSync(from, to, { recursive: true });
  else fs.copyFileSync(from, to);
}

// Which top-level entries of a userData-shaped folder count as portable config.
function portableEntries(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => {
    if (n.toLowerCase().endsWith('.json')) return !EXCLUDE_JSON.has(n);
    return EXTRA_DIRS.includes(n);
  });
}

// Write a bundle folder under <userData>/exports/. Returns { ok, path, items }.
function exportConfig(userDataDir) {
  try {
    const dest = path.join(userDataDir, 'exports', `eqls-config-${stamp()}`);
    fs.mkdirSync(dest, { recursive: true });
    let items = 0;
    for (const name of portableEntries(userDataDir)) {
      try { copyInto(path.join(userDataDir, name), path.join(dest, name)); items += 1; }
      catch { /* skip a locked/odd entry */ }
    }
    // A tiny marker so import can sanity-check it is looking at a real bundle.
    fs.writeFileSync(path.join(dest, 'eqls-bundle.json'), JSON.stringify({ kind: 'eqls-config', at: stamp() }, null, 2));
    return { ok: true, path: dest, items };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Folders that import can offer: the bundles under exports/, and the "Back up now" folders under
// backups/ (a backup is a superset of a bundle, and restoring one is a legitimate thing to want).
function listImportable(userDataDir) {
  const out = [];
  for (const [group, sub] of [['export', 'exports'], ['backup', 'backups']]) {
    const base = path.join(userDataDir, sub);
    let names;
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const name of names) {
      const full = path.join(base, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      // Must contain at least widgets.json or profiles.json to be worth offering.
      const has = ['widgets.json', 'profiles.json'].some((f) => fs.existsSync(path.join(full, f)));
      if (has) out.push({ group, name, path: full, mtime: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Safety-copies the current portable config into backups/pre-import-<stamp>/, same shape as an
// export. Shared by importConfig and importConfigText - both overwrite live config and both need
// the same "what was there before" net.
function backupCurrentPortable(userDataDir) {
  const backup = path.join(userDataDir, 'backups', `pre-import-${stamp()}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const name of portableEntries(userDataDir)) {
    try { copyInto(path.join(userDataDir, name), path.join(backup, name)); } catch { /* best effort */ }
  }
  return backup;
}

// Copy a bundle's portable entries over userData, after backing up what is there. Returns
// { ok, restart, backedUpTo }. The caller restarts the app - widgets.json / profiles.json are
// read once at startup and there is no safe hot-swap.
function importConfig(userDataDir, sourceDir) {
  try {
    if (!fs.existsSync(sourceDir)) return { ok: false, error: 'that bundle is gone' };
    const entries = portableEntries(sourceDir);
    if (!entries.length) return { ok: false, error: 'no config found in that folder' };

    const backup = backupCurrentPortable(userDataDir);

    let items = 0;
    for (const name of entries) {
      const to = path.join(userDataDir, name);
      try {
        fs.rmSync(to, { recursive: true, force: true });
        copyInto(path.join(sourceDir, name), to);
        items += 1;
      } catch { /* skip a locked/odd entry */ }
    }
    return { ok: true, restart: true, backedUpTo: backup, items };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Text-bundle counterpart to exportConfig/importConfig - same portable JSON scope, but inlined as
// one JSON string instead of a folder, so it can go on the clipboard and paste straight into
// another running copy of the app. No sounds/customSounds - those are files, not text; Export
// config still covers those. Returns { ok, text, items }.
function exportConfigText(userDataDir) {
  try {
    const data = {};
    let items = 0;
    for (const name of portableEntries(userDataDir)) {
      if (!name.toLowerCase().endsWith('.json')) continue;
      try {
        data[name] = JSON.parse(fs.readFileSync(path.join(userDataDir, name), 'utf8'));
        items += 1;
      } catch { /* skip an unreadable/corrupt file */ }
    }
    return { ok: true, text: JSON.stringify({ kind: 'eqls-config-text', at: stamp(), data }), items };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Reverse of exportConfigText. Returns the same shape importConfig does so the renderer can share
// one result-handling path.
function importConfigText(userDataDir, text) {
  let bundle;
  try { bundle = JSON.parse(text); } catch { bundle = null; }
  if (!bundle || bundle.kind !== 'eqls-config-text' || !bundle.data || typeof bundle.data !== 'object') {
    return { ok: false, error: "that doesn't look like a valid config - paste the whole copied text" };
  }
  // The pasted text is another person's input (same trust level as a chat share code): a key
  // like "..\\..\\x.json" would write outside userData, and Windows file names are
  // case-insensitive so "Config.json" must hit the deny-list too.
  const excludedLower = new Set([...EXCLUDE_JSON].map((n) => n.toLowerCase()));
  const names = Object.keys(bundle.data).filter(
    (n) => n.toLowerCase().endsWith('.json') && path.basename(n) === n && !n.includes('\\')
      && !excludedLower.has(n.toLowerCase())
  );
  if (!names.length) return { ok: false, error: 'no config found in that text' };
  try {
    const backup = backupCurrentPortable(userDataDir);
    let items = 0;
    for (const name of names) {
      try {
        fs.writeFileSync(path.join(userDataDir, name), JSON.stringify(bundle.data[name], null, 2));
        items += 1;
      } catch { /* skip a locked/odd entry */ }
    }
    return { ok: true, restart: true, backedUpTo: backup, items };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  exportConfig, listImportable, importConfig, exportConfigText, importConfigText,
  portableEntries, EXCLUDE_JSON,
};
