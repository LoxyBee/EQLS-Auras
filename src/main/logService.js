const fs = require('fs');
const path = require('path');
const { dialog, shell, BrowserWindow } = require('electron');
const { loadJson, saveJson } = require('./store');
const { autoDetectEqFolder, isValidEqFolder, resolveLogsFolder } = require('./eqLocator');
const { LogWatcher } = require('./logWatcher');
const { LogSplitter } = require('./logSplitter');

const ARCHIVE_PROMPT_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50MB

// Ties together config persistence, EQ folder detection, the log watcher,
// and the day-by-day log splitter, and pushes updates out to every open
// renderer window.
class LogService {
  constructor() {
    this.watcher = new LogWatcher();
    this.splitter = new LogSplitter({ loadJson, saveJson });
    this.config = loadJson('config', {});
    this.lastError = null;

    this.watcher.on('status', (status) => {
      if (status.currentFilePath) {
        this.splitter.attachToFile(status.currentFilePath);
      }
      this._broadcast('log:status', this.getState());
    });
    this.watcher.on('line', (line) => this._broadcast('log:line', line));
    this.watcher.on('error', (message) => {
      this.lastError = message;
      this._broadcast('log:error', message);
    });
  }

  init() {
    let folder = this.config.eqFolder;
    if (!folder || !isValidEqFolder(folder)) {
      folder = autoDetectEqFolder();
      if (folder) {
        this.config.eqFolder = folder;
        saveJson('config', this.config);
      }
    }
    if (folder) {
      this.watcher.start(resolveLogsFolder(folder));
    }
  }

  getState() {
    const status = this.watcher.getStatus();
    let fileSizeBytes = null;
    if (status.currentFilePath) {
      try {
        fileSizeBytes = fs.statSync(status.currentFilePath).size;
      } catch {
        fileSizeBytes = null;
      }
    }
    return {
      ...status,
      eqFolder: this.config.eqFolder || null,
      lastError: this.lastError,
      split: this.splitter.getSettings(),
      fileSizeBytes,
      shouldPromptArchive: fileSizeBytes !== null && fileSizeBytes > ARCHIVE_PROMPT_THRESHOLD_BYTES,
    };
  }

  openLogFolder() {
    const folder = this.watcher.getStatus().logsFolder;
    if (folder) shell.openPath(folder);
  }

  archiveNow() {
    const currentPath = this.watcher.getStatus().currentFilePath;
    if (!currentPath) {
      return { ok: false, error: 'No active log file to archive.' };
    }
    try {
      const archiveDir = path.join(path.dirname(currentPath), 'Archive');
      fs.mkdirSync(archiveDir, { recursive: true });
      const baseName = path.basename(currentPath, path.extname(currentPath));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = path.join(archiveDir, `${baseName}_archived_${stamp}.txt`);

      fs.copyFileSync(currentPath, archivePath);
      fs.truncateSync(currentPath, 0);

      return { ok: true, archivePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  setSplitEnabled(enabled) {
    this.splitter.setEnabled(enabled);
    this._broadcast('log:status', this.getState());
    return this.getState();
  }

  setSplitOnGap(splitOnGap) {
    this.splitter.setSplitOnGap(splitOnGap);
    this._broadcast('log:status', this.getState());
    return this.getState();
  }

  async chooseSplitFolder() {
    const win = BrowserWindow.getFocusedWindow();
    const current = this.splitter.getSettings().outputDir;
    const result = await dialog.showOpenDialog(win, {
      title: 'Select a folder for split log output',
      defaultPath: current || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      this.splitter.setOutputDir(result.filePaths[0]);
      this._broadcast('log:status', this.getState());
    }
    return this.getState();
  }

  resetSplitFolder() {
    this.splitter.setOutputDir(null);
    this._broadcast('log:status', this.getState());
    return this.getState();
  }

  async chooseFolder() {
    const win = BrowserWindow.getFocusedWindow();
    const defaultPath = this.config.eqFolder ? path.dirname(this.config.eqFolder) : 'C:\\';
    const result = await dialog.showOpenDialog(win, {
      title: 'Select your EverQuest install folder (or its Logs folder)',
      defaultPath,
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return this.getState();
    }
    const chosen = result.filePaths[0];
    if (!isValidEqFolder(chosen)) {
      this.lastError =
        "That folder doesn't look like an EverQuest install (no eqgame.exe, Logs folder, or log files found in it).";
      this._broadcast('log:error', this.lastError);
      return this.getState();
    }
    this.lastError = null;
    this.config.eqFolder = chosen;
    saveJson('config', this.config);
    this.watcher.start(resolveLogsFolder(chosen));
    return this.getState();
  }

  _broadcast(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload);
    }
  }
}

module.exports = { LogService };
