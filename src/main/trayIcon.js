// A tiny hand-drawn tray icon - no external asset, no new dependency to fetch or license, same
// reasoning as tools/generate-bundled-sounds.js's synthesized starter sounds.
// nativeImage.createFromBitmap takes a raw BGRA buffer directly, no PNG encoding needed.
//
// Design, picked directly by the owner: an "=" (EQLS reads as "equals") at the centre, with a
// soft radial glow behind it standing in for "aura" - not a hard ring or outline, since a crisp
// circle reads as a badge/logo rather than a glow. Both the bars and the glow are the same brass
// (--accent in main-window.css); only their alpha differs, so it stays one coherent colour rather
// than introducing a second one.
const { nativeImage } = require('electron');

const ACCENT = [0xcf, 0x9a, 0x4a]; // brass - matches --accent in main-window.css

function buildTrayIcon(size = 32) {
  const buffer = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxR = size / 2; // glow's own falloff radius - clamped to 0 past this, which is what
  // keeps the glow circular rather than filling the whole square canvas out to the corners.

  // Equals-sign geometry, proportional to size so this still reads correctly if buildTrayIcon is
  // ever asked for a different resolution (e.g. a 16px tray vs a 256px installer icon).
  const barW = size * 0.62;
  const barH = Math.max(2, size * 0.14);
  const gap = size * 0.16;
  const barLeft = cx - barW / 2;
  const barRight = cx + barW / 2;
  const bar1Top = cy - gap / 2 - barH;
  const bar1Bottom = cy - gap / 2;
  const bar2Top = cy + gap / 2;
  const bar2Bottom = cy + gap / 2 + barH;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // The aura: alpha fades smoothly from the centre out to 0 at maxR (squared, not linear, so
      // the falloff reads as a soft glow rather than a visible gradient band).
      const falloff = Math.max(0, 1 - dist / maxR);
      let alpha = Math.round(falloff * falloff * 130); // capped well under opaque

      const inBar1 = x >= barLeft && x <= barRight && y >= bar1Top && y <= bar1Bottom;
      const inBar2 = x >= barLeft && x <= barRight && y >= bar2Top && y <= bar2Bottom;
      if (inBar1 || inBar2) alpha = 255; // the "=" itself is fully solid, not part of the glow

      if (alpha === 0) continue; // buffer starts zeroed - stays fully transparent
      // nativeImage.createFromBitmap expects BGRA, not RGBA.
      buffer[i] = ACCENT[2];
      buffer[i + 1] = ACCENT[1];
      buffer[i + 2] = ACCENT[0];
      buffer[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

module.exports = { buildTrayIcon };
