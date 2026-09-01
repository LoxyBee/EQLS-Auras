const fs = require('fs');
const path = require('path');
const { app, protocol } = require('electron');
const { extractIconPng, countIconSheets, ICONS_PER_SHEET, ICON_SETS, DEFAULT_ICON_SET } = require('./iconExtractor');
const { loadJson, saveJson } = require('./store');

// Serves spell icons to renderers as eqicon://icon/<iconSet>/<iconId>,
// extracting from the user's own EQ install on first request and caching
// the PNG in userData so it's a plain file read after that. The icon set is
// encoded in the URL (not just tracked as internal state) so that switching
// sets in the UI actually changes what loads - if the URL didn't change,
// the renderer's HTTP cache would keep serving the old art for a URL it's
// already fetched once.
class IconService {
  constructor() {
    this.eqFolder = null;
    this.iconSet = loadJson('iconSettings', {}).iconSet || DEFAULT_ICON_SET;
    this.cacheDir = path.join(app.getPath('userData'), 'icons');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  setEqFolder(folder) {
    this.eqFolder = folder || null;
  }

  setIconSet(iconSet) {
    if (!ICON_SETS.includes(iconSet)) return;
    this.iconSet = iconSet;
    saveJson('iconSettings', { iconSet });
  }

  getIconSet() {
    return this.iconSet;
  }

  buildIconUrl(iconId) {
    return `eqicon://icon/${encodeURIComponent(this.iconSet)}/${iconId}`;
  }

  // How many valid icon IDs exist for the current set - lets a manual icon
  // picker show exactly the real range instead of guessing or rendering
  // broken thumbnails past the end.
  getIconCount() {
    if (!this.eqFolder) return 0;
    return countIconSheets(this.eqFolder, this.iconSet) * ICONS_PER_SHEET;
  }

  registerProtocol() {
    protocol.handle('eqicon', (request) => {
      const parts = new URL(request.url).pathname.split('/').filter(Boolean);
      const [iconSet, iconId] = [decodeURIComponent(parts[0] || ''), parts[1] || ''];

      // Both halves of the URL end up in a filesystem path (the cache key below, and Textures/<set>
      // inside extractIconPng), and a renderer can put anything it likes in an <img src>. Constrain
      // both to exactly what a real request carries: one of the known set names, and a plain
      // non-negative integer. A "../.." set name or a slashed id is rejected outright rather than
      // sanitised - there is no legitimate request it would break.
      if (!ICON_SETS.includes(iconSet) || !/^[0-9]+$/.test(iconId)) {
        return new Response(null, { status: 404 });
      }
      const cacheKey = `${iconSet.replace(/\s+/g, '_')}_${iconId}`;
      const cachedPath = path.join(this.cacheDir, `${cacheKey}.png`);
      // Belt-and-suspenders: the two checks above already make traversal impossible, but assert the
      // resolved path never leaves the cache dir so a future edit to the key format can't reopen it.
      if (path.resolve(cachedPath) !== path.join(path.resolve(this.cacheDir), `${cacheKey}.png`)) {
        return new Response(null, { status: 404 });
      }

      if (!fs.existsSync(cachedPath)) {
        if (!this.eqFolder) return new Response(null, { status: 404 });
        try {
          const png = extractIconPng(this.eqFolder, parseInt(iconId, 10), iconSet);
          fs.writeFileSync(cachedPath, png);
        } catch {
          return new Response(null, { status: 404 });
        }
      }

      const data = fs.readFileSync(cachedPath);
      return new Response(data, { headers: { 'content-type': 'image/png' } });
    });
  }
}

module.exports = { IconService };
