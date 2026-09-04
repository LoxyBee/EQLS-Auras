const fs = require('fs');
const path = require('path');
const { stripRankSuffix } = require('./buffParser');

const RELOAD_INTERVAL_MS = 30000;
const SPELLBOOK_RE = /^(.+)-(.+)-Spellbook\.txt$/i;

// The EQ client writes a per-character spellbook file in the install root,
// e.g. "Vaela_rivervale-SHM-Spellbook.txt" (one "<slot><TAB><Spell Name>"
// line per scribed spell). Correlating that to the active eqlog file's
// character name lets us know exactly which spells THIS character actually
// knows - the single best signal for resolving an ambiguous landing
// message down to "this was almost certainly my own cast", since most
// ambiguous text is only shared among a handful of spells and a given
// character only has access to a few of them at most.
//
// The class segment in the filename is NEVER used to find or filter - the
// match is `<base>-<anything>-Spellbook.txt`, case-insensitive. A multiclass
// character (see profileStore.js / the loadout mechanic) has one spellbook
// file per class it has run `/outputfile spellbook` on, and readdirSync
// order is arbitrary, so all matching files are read and their spell lists
// UNIONed. Semantics: "scribed in ANY loadout". Live gem-state tracking
// (buffEngine's currentlyMemorized) narrows that back to the active loadout
// on top, which is the layer that actually needs to be loadout-accurate.
class SpellbookService {
  constructor() {
    this.installRoot = null;
    // Derived from the watched log file's name (eqlog_<base>.txt). The auto path.
    this.characterBaseName = null;
    // QOL #14 - a manual "<name>_<server>" the user typed on the Setup page, for when auto
    // detection picks the wrong character (multiple logs) or none. Beats the log-derived name.
    this.overrideBaseName = null;
    // An explicit file the user picked from "Change spellbook file..." - an absolute path. Beats
    // both name paths: a safety valve for a machine with more than one character's spellbooks.
    this.fileOverride = null;
    // [{ path, className, count }] for whatever is currently loaded - drives the Setup status line.
    this.loadedFiles = [];
    this.spellNames = new Set(); // lowercased, exact
    this.baseSpellNames = new Set(); // lowercased, rank suffix stripped
    this.timer = null;
  }

  setInstallRoot(root) {
    this.installRoot = root || null;
    this._resolveAndLoad();
  }

  setCharacterBaseName(name) {
    if (this.characterBaseName === name) return;
    this.characterBaseName = name || null;
    this._resolveAndLoad();
  }

  // QOL #14. The manual override; null/'' clears it and detection falls back to the log-derived
  // name. Called from main.js on startup (persisted value) and on every edit of the Setup fields.
  setCharacterOverride(name) {
    const next = name || null;
    if (this.overrideBaseName === next) return;
    this.overrideBaseName = next;
    this._resolveAndLoad();
  }

  // An absolute path to a specific *-Spellbook.txt, or null to go back to name-based detection.
  // Persisted by main.js under its own key.
  setFileOverride(filePath) {
    const next = filePath || null;
    if (this.fileOverride === next) return;
    this.fileOverride = next;
    this._resolveAndLoad();
  }

  _effectiveBaseName() {
    return this.overrideBaseName || this.characterBaseName;
  }

  // 'file' - a hand-picked file; 'manual' - the typed name/server; 'auto' - the log-derived name;
  // 'none' - nothing to go on yet.
  _mode() {
    if (this.fileOverride) return 'file';
    if (this.overrideBaseName) return 'manual';
    if (this.characterBaseName) return 'auto';
    return 'none';
  }

  _resolveAndLoad() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // A setter is a deliberate target change - apply whatever it finds, even nothing (switching to
    // a character with no file, or pinning a missing file, really does mean "no spellbook now").
    this._load(this._findFiles(), { targetChanged: true });
    // Always poll, even when that first load came up empty. A transient failure - readdirSync
    // throwing under an AV lock, installRoot or the log-derived character name momentarily null
    // during a startup / file-roll race - would otherwise leave the spellbook signal dead for the
    // whole session (confirmed 31 Aug: it went dead after a restart and only twice recovered all
    // day). With the timer always running it self-heals within 30s.
    this.timer = setInterval(() => this._load(this._findFiles()), RELOAD_INTERVAL_MS);
  }

  // Every spellbook file the current mode points at (absolute paths). A file override is just
  // that one file; a name (typed or log-derived) is every `<base>-*-Spellbook.txt` in the root.
  _findFiles() {
    if (this.fileOverride) {
      return fs.existsSync(this.fileOverride) ? [this.fileOverride] : [];
    }
    const base = this._effectiveBaseName();
    if (!this.installRoot || !base) return [];
    let entries;
    try {
      entries = fs.readdirSync(this.installRoot);
    } catch {
      return [];
    }
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}-.+-Spellbook\\.txt$`, 'i');
    return entries
      .filter((name) => pattern.test(name))
      .sort()
      .map((name) => path.join(this.installRoot, name));
  }

  // Class segment out of a spellbook filename, or '?'.
  _classOf(filePath) {
    const m = SPELLBOOK_RE.exec(path.basename(filePath));
    return m ? m[2].toUpperCase() : '?';
  }

  _readOne(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const names = [];
      for (const line of content.split(/\r?\n/)) {
        const [level, name] = line.split('\t').map((s) => (s || '').trim());
        if (!name) continue;
        // The first column is the level the character's class scribes it at; 255 is EQ's "no class
        // of this character can ever cast this" sentinel (same value gameSpellData reads for
        // per-class castability - see gotcha #14). A multiclass character's spellbook dump lists
        // those rows anyway, and counting them as "scribed" made an ambiguous landing narrow to a
        // spell she can't cast: reported live, a raid enchanter's Clarity ("A cool breeze slips
        // through your mind.") landed on her own Self Buffs because "255  Clarity" was in the file.
        if (level === '255') continue;
        names.push(name);
      }
      return names;
    } catch {
      return null;
    }
  }

  _load(files, { targetChanged = false } = {}) {
    const names = new Set();
    const baseNames = new Set();
    const loaded = [];
    let anyRead = false;
    for (const filePath of files) {
      const spells = this._readOne(filePath);
      if (spells === null) continue;
      anyRead = true;
      for (const name of spells) {
        names.add(name.toLowerCase());
        baseNames.add(stripRankSuffix(name).toLowerCase());
      }
      loaded.push({ path: filePath, className: this._classOf(filePath), count: spells.length });
    }
    // The 30-second poll must never blank a loaded spellbook because a single reload read nothing.
    // `files` is empty on a transient `_findFiles()` failure (readdir throwing under an AV lock,
    // installRoot/base-name momentarily null), and `_readOne` returns null on a locked file - the
    // player's actual spellbook has not changed. This blanking silently killed the app's strongest
    // ambiguous-landing signal for a whole session (31 Aug), re-failing every 30s. A deliberate
    // target change (a setter, `targetChanged`) is still allowed to clear it.
    if (!anyRead && !targetChanged && this.spellNames.size > 0) return;
    this.spellNames = names;
    this.baseSpellNames = baseNames;
    this.loadedFiles = loaded;
  }

  has(spellName) {
    const lower = spellName.toLowerCase();
    if (this.spellNames.has(lower)) return true;
    return this.baseSpellNames.has(stripRankSuffix(spellName).toLowerCase());
  }

  // First loaded file, kept for callers that predate multi-file. Prefer getLoadedFiles().
  getFilePath() {
    return this.loadedFiles.length ? this.loadedFiles[0].path : null;
  }

  getLoadedFiles() {
    return this.loadedFiles.map((f) => ({ ...f }));
  }

  // Total across every loaded file (the union) - so a two-class character sees one honest number.
  getCount() {
    return this.spellNames.size;
  }

  // Every `*-Spellbook.txt` in the install root, for the "Change spellbook file..." picker -
  // regardless of which character or class. Each with the character + class parsed from the name
  // and its scribed-spell count. Empty when the root is unknown or unreadable.
  listCandidates() {
    if (!this.installRoot) return [];
    let entries;
    try {
      entries = fs.readdirSync(this.installRoot);
    } catch {
      return [];
    }
    return entries
      .filter((name) => SPELLBOOK_RE.test(name))
      .sort()
      .map((name) => {
        const full = path.join(this.installRoot, name);
        const m = SPELLBOOK_RE.exec(name);
        const spells = this._readOne(full);
        return {
          path: full,
          fileName: name,
          character: m ? m[1] : name,
          className: m ? m[2].toUpperCase() : '?',
          count: spells ? spells.length : 0,
        };
      });
  }

  /**
   * Where it looked and what it looked for, so the settings window can say something actionable
   * when the file is not there instead of promising it will turn up on its own.
   *
   * This is not a hypothetical. On the machine this was written on the file had never existed
   * across eight logged sessions, which means the spellbook check - the app's strongest tool for
   * deciding whether an ambiguous buff message is yours - had been contributing nothing, and
   * hundreds of landings per session were being ignored for want of it.
   */
  // The player's own character name as best the app knows it (manual override, else the log-derived
  // name), or null. petTracker uses it to spot a "<pet> says, 'My leader is <me>.'" line.
  getCharacterName() {
    return this._effectiveBaseName() || null;
  }

  getExpectation() {
    const base = this._effectiveBaseName();
    return {
      folder: this.installRoot,
      mode: this._mode(),
      // The class segment is a wildcard - any file named `<base>-<anything>-Spellbook.txt` counts.
      fileNamePattern: base ? `${base}-<class>-Spellbook.txt` : null,
      // Deprecated alias of `mode === 'manual'`, kept for callers not yet updated.
      manualCharacter: this._mode() === 'manual',
      // What is actually loaded right now: [{ path, className, count }].
      files: this.getLoadedFiles(),
    };
  }
}

module.exports = { SpellbookService };
