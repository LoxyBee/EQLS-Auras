'use strict';
/**
 * Offline log scanning for the Combat tab (owner, 13 Sep): "an option to back read your current
 * log, or upload a new log and parse out fights." Runs a whole log file - the live one, or any
 * Split/Archive file the owner picks - through a fresh DamageEngine exactly the way live play
 * does, one line at a time, so every fight it finds goes through the identical friend/enemy
 * bootstrap and reconciliation the overlay itself uses. No new detection logic here; this is
 * "replay the file main.js would have replayed if it had been running."
 *
 * The engine is UNCAPPED (`maxHistory: Infinity`) - a scan is explicitly enumerating a fixed past,
 * not a bounded live buffer - and is kept alive by the caller (main.js holds it in `importedScans`)
 * so getHistoryFight() still works on it after the scan finishes.
 */

const fs = require('fs');
const readline = require('readline');
const { DamageEngine } = require('./damageEngine');
const { matchZoneChange } = require('./buffParser');
const { extractTimestampMs } = require('./logSplitter');
const { INSTANCE_SUFFIX } = require('../shared/loadoutLockedZones');
const { difficultyLabel } = require('../shared/zoneDifficulty');

const baseZoneName = (z) => String(z || '').replace(INSTANCE_SUFFIX, '').trim();

/**
 * @param {string} filePath - a real log file (the live log, or a Split/Archive file).
 * @param {(linesRead: number) => void} [onProgress] - called periodically for a large file, so the
 *   caller can show something moving rather than a frozen dialog.
 * @returns {Promise<DamageEngine>} an engine holding every fight the file contains, zone-tagged.
 */
async function scanLogForFights(filePath, onProgress) {
  const engine = new DamageEngine({ maxHistory: Infinity });
  let lastMs = null;
  let count = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    count += 1;
    if (onProgress && count % 50000 === 0) onProgress(count);
    const ms = extractTimestampMs(line);
    if (ms === null) continue; // an unstamped line (rare - a wrapped/corrupted line) can't be placed in time
    lastMs = ms;
    const zone = matchZoneChange(line);
    if (zone) {
      engine.enterZone(ms, baseZoneName(zone), difficultyLabel(zone));
      continue; // a "You have entered X." line is never also a damage line
    }
    engine.handleLine(line, ms);
  }
  // The last fight in the file never gets a "next line" to trigger its own idle-timeout close -
  // force it past the timeout so it lands in history instead of silently vanishing.
  if (lastMs !== null) engine.tick(lastMs + engine.timeoutSec * 1000 + 1);
  return engine;
}

module.exports = { scanLogForFights };
