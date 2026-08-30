'use strict';

// Finds the owner's real EverQuest logs on THIS machine, for the replay-log regression tool and
// the couple of tests that cross-check a pattern against a real line.
//
// The old approach was a hardcoded list of absolute Desktop paths under a Windows account this
// machine no longer has, so everything just silently "skipped". This reads the app's own
// configured EQ folder instead, then falls back to the standard install location.

const fs = require('fs');
const path = require('path');
const os = require('os');

function appDataDir() {
  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

// The EQ Logs folder the app is pointed at (config.json's eqFolder), or the standard EQ Legends
// install location, or null.
function configuredLogsFolder() {
  try {
    const cfgPath = path.join(appDataDir(), 'EQ Buff Tracker', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.eqFolder && fs.existsSync(cfg.eqFolder)) return cfg.eqFolder;
  } catch { /* no config yet, or unreadable */ }
  for (const base of [
    'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/Logs',
    'C:/Users/Public/Sony Online Entertainment/Installed Games/EverQuest Legends/Logs',
  ]) {
    if (fs.existsSync(base)) return base;
  }
  return null;
}

const IS_LOG = /^eqlog_.+\.txt$/i;
function logsIn(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => IS_LOG.test(n)).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/**
 * The most complete NON-OVERLAPPING set of the owner's logs for a replay.
 *
 * Prefers the per-day Split/ folder: it is a continuous copy of the log, one file per calendar
 * day, and the days do not overlap each other. Falls back to Archive/ + the live log when there
 * is no Split folder (those two can overlap - Split is what fed Archive - so this is the weaker
 * option, taken only when it is the only one).
 */
function findOwnerLogs() {
  const logsDir = configuredLogsFolder();
  if (!logsDir) return [];
  const split = logsIn(path.join(logsDir, 'Split'));
  if (split.length) return split.sort();
  return [...logsIn(path.join(logsDir, 'Archive')), ...logsIn(logsDir)].sort();
}

// The single most recent log, for a test that only needs one real line to grep.
function newestOwnerLog() {
  const all = findOwnerLogs();
  if (!all.length) return null;
  return all
    .map((p) => ({ p, m: (() => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } })() }))
    .sort((a, b) => b.m - a.m)[0].p;
}

module.exports = { findOwnerLogs, newestOwnerLog, configuredLogsFolder };
