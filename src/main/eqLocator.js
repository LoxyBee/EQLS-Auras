const fs = require('fs');
const path = require('path');

// Folder names EverQuest (and common private-server clients) are typically
// installed to on Windows. Not exhaustive - the user can always Browse to
// their actual folder if auto-detect misses it.
// EverQuest LEGENDS first, because that is the game this app is for and it installs nowhere near
// the classic paths below. Measured on a real EQL machine: the install sits under
// C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest Legends
// isValidEqFolder() accepts it happily and its Logs folder holds the eqlog files - it was simply
// never in this list, so autoDetectEqFolder() returned null and a fresh install watched nothing
// until the user found the folder picker in Setup for themselves.
//
// Additive and safe for anyone already running: logService.init() prefers a configured eqFolder
// and only falls back to this list, so a working install is never re-pointed by it.
const CANDIDATE_PATHS = [
  'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  'C:\\Program Files (x86)\\Sony\\EverQuest',
  'C:\\Program Files\\Sony\\EverQuest',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\EverQuest F2P',
  'C:\\Program Files\\Steam\\steamapps\\common\\EverQuest F2P',
  'C:\\Program Files (x86)\\EverQuest',
  'C:\\Program Files\\EverQuest',
  'C:\\EverQuest',
  'C:\\Games\\EverQuest',
];

function hasEqlogFilesDirectly(folderPath) {
  try {
    return fs.readdirSync(folderPath).some((name) => /^eqlog_.*\.txt$/i.test(name));
  } catch {
    return false;
  }
}

// A folder counts as valid if it's the game install folder (has the game
// executable, or a Logs subfolder), OR if the user pointed us straight at
// the Logs folder itself (easy mistake to make, so we accept it too).
function isValidEqFolder(folderPath) {
  try {
    if (!fs.statSync(folderPath).isDirectory()) return false;
  } catch {
    return false;
  }
  const hasExe = fs.existsSync(path.join(folderPath, 'eqgame.exe'));
  const hasLogsSubfolder = fs.existsSync(path.join(folderPath, 'Logs'));
  const isLogsFolderItself = path.basename(folderPath).toLowerCase() === 'logs';
  return hasExe || hasLogsSubfolder || isLogsFolderItself || hasEqlogFilesDirectly(folderPath);
}

// Given whatever folder the user picked (install folder OR the Logs folder
// itself), figure out the actual Logs folder to watch.
function resolveLogsFolder(folderPath) {
  const childLogs = path.join(folderPath, 'Logs');
  if (fs.existsSync(childLogs) && fs.statSync(childLogs).isDirectory()) {
    return childLogs;
  }
  if (path.basename(folderPath).toLowerCase() === 'logs' || hasEqlogFilesDirectly(folderPath)) {
    return folderPath;
  }
  return childLogs;
}

// Given whatever folder the user picked (install folder OR the Logs folder
// itself), figure out the actual install ROOT (where Textures/, spells_us.txt
// etc. live) - the inverse of resolveLogsFolder, needed for anything that
// reads game data files rather than the log.
function resolveInstallRoot(folderPath) {
  const looksLikeRoot = (p) =>
    fs.existsSync(path.join(p, 'Textures')) || fs.existsSync(path.join(p, 'spells_us.txt'));
  if (looksLikeRoot(folderPath)) return folderPath;
  const parent = path.dirname(folderPath);
  if (looksLikeRoot(parent)) return parent;
  return folderPath;
}

function autoDetectEqFolder() {
  for (const candidate of CANDIDATE_PATHS) {
    if (isValidEqFolder(candidate)) {
      return candidate;
    }
  }
  return null;
}

module.exports = {
  autoDetectEqFolder,
  isValidEqFolder,
  resolveLogsFolder,
  resolveInstallRoot,
  CANDIDATE_PATHS,
};
