const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_PER_SHEET = 36;
const ICON_SIZE = 40;
const GRID_COLS = 6;

function readTGA(filePath) {
  const b = fs.readFileSync(filePath);
  const w = b.readUInt16LE(12);
  const h = b.readUInt16LE(14);
  const desc = b[17];
  const off = 18 + b[0];
  return { w, h, desc, px: b.subarray(off) };
}

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

// Minimal from-scratch PNG encoder (just IHDR/IDAT/IEND, no filtering beyond
// "none") - avoids pulling in an image library for one small job.
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// EQ ships several icon art sets under Textures/Alternate N/ (different UI
// skins) - same grid layout and icon IDs, different artwork. Confirmed by
// direct comparison: same iconId produces visually distinct icons per set.
const ICON_SETS = ['Alternate 1', 'Alternate 2', 'Alternate 3'];
const DEFAULT_ICON_SET = 'Alternate 1';

// Reads one 40x40 spell icon out of the game's own icon sprite sheets
// (Textures/<iconSet>/SpellsNN.tga, a 6x6 grid of 36 icons per sheet) and
// returns it as a PNG buffer. This reads the user's own legally-installed
// game files, locally, for this personal desktop tool - nothing is bundled
// with the app or sent anywhere.
function extractIconPng(eqFolder, iconId, iconSet = DEFAULT_ICON_SET) {
  const sheetNum = Math.floor(iconId / ICONS_PER_SHEET) + 1;
  const idxInSheet = iconId % ICONS_PER_SHEET;
  const row = Math.floor(idxInSheet / GRID_COLS);
  const col = idxInSheet % GRID_COLS;

  const sheetPath = path.join(
    eqFolder,
    'Textures',
    iconSet,
    `Spells${String(sheetNum).padStart(2, '0')}.tga`
  );
  const tga = readTGA(sheetPath);

  const out = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const sx = col * ICON_SIZE + x;
      const sy = row * ICON_SIZE + y;
      const srcY = tga.desc & 0x20 ? sy : tga.h - 1 - sy;
      const srcOffset = (srcY * tga.w + sx) * 4;
      const dstOffset = (y * ICON_SIZE + x) * 4;
      // TGA pixel data is BGRA - swap to RGBA for PNG.
      out[dstOffset] = tga.px[srcOffset + 2];
      out[dstOffset + 1] = tga.px[srcOffset + 1];
      out[dstOffset + 2] = tga.px[srcOffset];
      out[dstOffset + 3] = 255;
    }
  }
  return encodePng(ICON_SIZE, ICON_SIZE, out);
}

// Counts how many icon sheets actually exist for a given set, so a manual
// icon picker knows the real valid iconId range instead of guessing or
// showing broken thumbnails past the end. Assumes sequential numbering
// with no gaps, which holds for the game's own shipped sheets. Compares
// filenames case-insensitively - confirmed some installs ship inconsistent
// casing within the same set (e.g. "spells01.tga" alongside "Spells08.tga"),
// which a case-sensitive check would misread as a missing sheet and stop
// counting after the first one.
function countIconSheets(eqFolder, iconSet = DEFAULT_ICON_SET) {
  const dir = path.join(eqFolder, 'Textures', iconSet);
  let count = 0;
  try {
    const files = new Set(fs.readdirSync(dir).map((name) => name.toLowerCase()));
    while (files.has(`spells${String(count + 1).padStart(2, '0')}.tga`)) count++;
  } catch {
    return 0;
  }
  return count;
}

module.exports = { extractIconPng, countIconSheets, ICONS_PER_SHEET, ICON_SETS, DEFAULT_ICON_SET };
