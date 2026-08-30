const fs = require('fs');
const path = require('path');
const { stripRankSuffix } = require('./buffParser');

const RELOAD_INTERVAL_MS = 30000;

// The EQ client writes a per-character spellbook file in the install root,
// e.g. "Shara_rivervale-SHM-Spellbook.txt" (one "<slot><TAB><Spell Name>"
// line per scribed spell). Correlating that to the active eqlog file's
// character name lets us know exactly which spells THIS character actually
// knows - the single best signal for resolving an ambiguous landing
// message down to "this was almost certainly my own cast", since most
// ambiguous text is only shared among a handful of spells and a given
// character only has access to a few of them at most.
class SpellbookService {
  constructor() {
    this.installRoot = null;
    // Derived from the watched log file's name (eqlog_<base>.txt). The auto path.
    this.characterBaseName = null;
    // QOL #14 - a manual "<name>_<server>" the user typed on the Setup page, for when auto
    // detection picks the wrong character (multiple logs) or none. Takes priority when set.
    this.overrideBaseName = null;
    this.filePath = null;
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

  _effectiveBaseName() {
    return this.overrideBaseName || this.characterBaseName;
  }

  _resolveAndLoad() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.filePath = this._findFile();
    this._load();
    if (this.filePath) {
      this.timer = setInterval(() => this._load(), RELOAD_INTERVAL_MS);
    }
  }

  _findFile() {
    const base = this._effectiveBaseName();
    if (!this.installRoot || !base) return null;
    let entries;
    try {
      entries = fs.readdirSync(this.installRoot);
    } catch {
      return null;
    }
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}-.+-Spellbook\\.txt$`, 'i');
    const match = entries.find((name) => pattern.test(name));
    return match ? path.join(this.installRoot, match) : null;
  }

  _load() {
    if (!this.filePath) {
      this.spellNames = new Set();
      this.baseSpellNames = new Set();
      return;
    }
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      const names = new Set();
      const baseNames = new Set();
      for (const line of content.split(/\r?\n/)) {
        const name = (line.split('\t')[1] || '').trim();
        if (!name) continue;
        names.add(name.toLowerCase());
        baseNames.add(stripRankSuffix(name).toLowerCase());
      }
      this.spellNames = names;
      this.baseSpellNames = baseNames;
    } catch {
      this.spellNames = new Set();
      this.baseSpellNames = new Set();
    }
  }

  has(spellName) {
    const lower = spellName.toLowerCase();
    if (this.spellNames.has(lower)) return true;
    return this.baseSpellNames.has(stripRankSuffix(spellName).toLowerCase());
  }

  getFilePath() {
    return this.filePath;
  }

  getCount() {
    return this.spellNames.size;
  }

  /**
   * Where it looked and what it looked for, so the settings window can say something actionable
   * when the file is not there instead of promising it will turn up on its own.
   *
   * This is not a hypothetical. On the machine this was written on the file has never existed
   * across eight logged sessions, which means the spellbook check - the app's strongest tool for
   * deciding whether an ambiguous buff message is yours - has been contributing nothing, and
   * hundreds of landings per session were being ignored for want of it.
   */
  getExpectation() {
    const base = this._effectiveBaseName();
    return {
      folder: this.installRoot,
      fileNamePattern: base ? `${base}-<CLASS>-Spellbook.txt` : null,
      // True when the pattern is coming from the manually entered character rather than the log.
      manualCharacter: !!this.overrideBaseName,
    };
  }
}

module.exports = { SpellbookService };
