const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, protocol } = require('electron');

// Custom alert sounds (backlog #16) - lets the user pick a real audio file
// per alert type per widget, instead of only the synthesized beeps in
// overlay.js. Mirrors iconService.js's approach for the exact same reason:
// a sandboxed renderer (contextIsolation, no nodeIntegration) can't safely
// load an arbitrary local file path directly, so picked files are copied
// into userData and served back over a registered custom protocol.
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
const CONTENT_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

function soundsDir() {
  const dir = path.join(app.getPath('userData'), 'customSounds');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function registryPath() {
  return path.join(soundsDir(), 'registry.json');
}

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveRegistry(registry) {
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2), 'utf8');
}

// Opens a native file picker restricted to audio files, copies the chosen
// file into userData/customSounds/ under a fresh id-based name - so the
// app's own reference keeps working even if the user later moves, renames,
// or deletes the original file - and records the original filename in a
// small registry so the settings UI can show something more meaningful
// than a random id. Returns null if the user cancelled, or picked
// something with an unrecognized extension (the dialog's own filter
// should already prevent this, but the source path isn't otherwise
// trusted, so it's checked again here too).
async function pickAndImportSound(browserWindow) {
  const result = await dialog.showOpenDialog(browserWindow, {
    title: 'Choose an alert sound',
    filters: [{ name: 'Audio files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;

  const id = crypto.randomUUID();
  const fileName = `${id}${ext}`;
  fs.copyFileSync(sourcePath, path.join(soundsDir(), fileName));

  const registry = loadRegistry();
  registry[id] = { fileName, originalName: path.basename(sourcePath) };
  saveRegistry(registry);

  return { id, originalName: registry[id].originalName };
}

// For the settings UI to show back which file is currently chosen - null
// if the id is falsy (no custom sound picked, using the default beep) or
// no longer in the registry (e.g. customSounds/ was cleared by hand).
function getSoundInfo(id) {
  if (!id) return null;
  return loadRegistry()[id] || null;
}

function registerProtocol() {
  protocol.handle('eqsound', (request) => {
    const id = new URL(request.url).pathname.split('/').filter(Boolean)[1] || '';
    const info = getSoundInfo(id);
    if (!info) return new Response(null, { status: 404 });
    const filePath = path.join(soundsDir(), info.fileName);
    try {
      const data = fs.readFileSync(filePath);
      const contentType = CONTENT_TYPES[path.extname(info.fileName).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': contentType } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

module.exports = { pickAndImportSound, getSoundInfo, registerProtocol };
