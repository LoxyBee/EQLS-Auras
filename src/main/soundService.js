const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, protocol, shell } = require('electron');
const { loadJson, saveJson } = require('./store');

// Custom alert sounds (backlog #16) - lets the user pick a real audio file
// per alert type per widget, instead of only the synthesized beeps in
// overlay.js. Mirrors iconService.js's approach for the exact same reason:
// a sandboxed renderer (contextIsolation, no nodeIntegration) can't safely
// load an arbitrary local file path directly, so picked files are copied
// into userData and served back over a registered custom protocol.
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
const CONTENT_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

// Windows ships a real folder of short, actually-usable notification/UI
// sounds here - a genuine, zero-licensing-effort starting point for the
// picker (as opposed to wherever Explorer happened to open last, which is
// rarely anywhere useful for this). Only used the FIRST time, or if the
// remembered last-used folder (see lastPickerDir below) no longer exists -
// once the user has picked from their own folder once, that's almost
// certainly more relevant to them than this default going forward.
const WINDOWS_MEDIA_DIR = 'C:\\Windows\\Media';

// A real, plain folder that ships INSIDE the app's own install directory - not userData, not
// asar (asar is one opaque archive file; Explorer can't browse it and nothing can write into it).
// Requested directly: "a standalone sounds folder INSIDE the install itself that people would add
// to, with some pre added sounds." Seeded with a handful of synthesized starter sounds (see
// tools/generate-bundled-sounds.js - hand-rolled tones, no external audio, nothing to license) and
// shipped via electron-builder's `extraFiles` (package.json), which copies it next to the .exe
// rather than into app.asar.
//
// DELIBERATELY NOT where a picked sound is stored. That's still userData/customSounds (see
// soundsDir() below) - this project asked, then reversed itself, on moving SAVED data into the
// install folder specifically because Windows' uninstaller deletes the install directory, which
// would silently delete months of tuned settings. A bundled/seed sound is different: losing it on
// uninstall costs nothing (it ships with every install again next time), so there's no tension in
// using the install folder for this half while userData stays authoritative for everything saved.
//
// Path resolution differs packaged vs dev, because "the install folder" means different things in
// each: packaged, it's wherever electron-builder actually put the .exe (getPath('exe') is the only
// thing that reliably answers that - NOT getAppPath(), which points inside app.asar once packaged,
// a read-only archive extraFiles content is never placed in); in dev (`npm start`), getPath('exe')
// is electron.exe buried in node_modules, which isn't "the install" in any meaningful sense - the
// project root (getAppPath(), correct only while unpackaged) is the actual dev equivalent, and is
// exactly where this repo's own sounds/ folder already lives.
function bundledSoundsDir() {
  const base = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.join(base, 'sounds');
}

// The folder "Choose sound..." browses, and where you drop your own audio files (backlog #39).
// Relocated from the install's own sounds/ folder to userData, so it survives an uninstall/
// reinstall the same way your auras and profiles do, and so ONE backup ("Open app data folder"
// on the Setup page) covers your sounds too. The install sounds/ folder is now only the SEED
// source - seedStarterSounds() copies the shipped starter tones in here on startup.
function starterSoundsDir() {
  const dir = path.join(app.getPath('userData'), 'sounds');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Copy the shipped starter tones from the install's sounds/ folder into userData/sounds/ once, so
// the picker has something to offer and a real, backed-up folder to keep your own files in.
// Idempotent: only copies a file that is not already there by name, so a starter you deleted on
// purpose stays deleted, and your own files are never touched. Called from main.js on startup.
function seedStarterSounds() {
  try {
    const from = bundledSoundsDir();
    if (!fs.existsSync(from)) return;
    const to = starterSoundsDir();
    for (const name of fs.readdirSync(from)) {
      if (!ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      const dest = path.join(to, name);
      if (fs.existsSync(dest)) continue;
      try { fs.copyFileSync(path.join(from, name), dest); } catch { /* skip a locked/odd file */ }
    }
  } catch { /* a missing or unreadable bundle is not fatal - the picker still works */ }
}

function defaultPickerDir() {
  const last = loadJson('lastSoundPickerDir', null);
  // Reported live: the sounds link kept opening C:\Windows\Media even after the bundled folder
  // shipped - because ANY prior pick remembers its own folder (see pickAndImportSound below), and
  // that remembered folder used to unconditionally win here. Anyone who picked a sound before this
  // feature existed had Windows Media saved as "last used" forever, permanently shadowing the new,
  // better default. Windows Media is excluded from the remembered-folder shortcut specifically -
  // it was never really a deliberate choice, just wherever the dialog happened to default to
  // before the bundled folder existed - so it's treated the same as "nothing remembered yet"
  // rather than as a real pick. Any OTHER remembered folder (the user's own Downloads, a custom
  // sounds folder, wherever) is still trusted as deliberate and still wins outright.
  if (last && last !== WINDOWS_MEDIA_DIR && fs.existsSync(last)) return last;
  // The userData sounds/ folder is the home now (#39). Fall back to the install seed folder only
  // if seeding has not run yet or left it empty (a first launch, or dev), then Windows Media.
  const hasFiles = (dir) => {
    try { return fs.readdirSync(dir).some((n) => ALLOWED_EXTENSIONS.has(path.extname(n).toLowerCase())); }
    catch { return false; }
  };
  const starter = starterSoundsDir();
  if (hasFiles(starter)) return starter;
  const bundled = bundledSoundsDir();
  if (hasFiles(bundled)) return bundled;
  if (fs.existsSync(WINDOWS_MEDIA_DIR)) return WINDOWS_MEDIA_DIR;
  return starter; // an empty but real folder beats the OS dialog's own arbitrary default
}

// Lets someone drop their own audio files straight into whichever folder
// "Choose Sound" will default to next time (see defaultPickerDir above) -
// without this, "add your own sound" meant navigating there by hand first.
// Falls back to the app's own customSounds storage folder (always exists,
// created on demand) if neither the remembered folder nor C:\Windows\Media
// exist, so this never has nothing to open.
function openPickerFolder() {
  const dir = defaultPickerDir() || soundsDir();
  return shell.openPath(dir);
}

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
    defaultPath: defaultPickerDir(),
    filters: [{ name: 'Audio files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;

  // Remembered for next time (see defaultPickerDir) - once the user has
  // picked from their own folder, re-opening in C:\Windows\Media every
  // time afterward would just be an extra click to navigate away from it.
  saveJson('lastSoundPickerDir', path.dirname(sourcePath));

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
    const id = new URL(request.url).pathname.split('/').filter(Boolean)[0] || '';
    const info = getSoundInfo(id);
    if (!info) return new Response(null, { status: 404 });
    const filePath = path.join(soundsDir(), info.fileName);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return new Response(null, { status: 404 });
    }
    const contentType = CONTENT_TYPES[path.extname(info.fileName).toLowerCase()] || 'application/octet-stream';

    // HTMLMediaElement (used both by the settings-panel preview button and
    // by overlay.js's real alert playback) always probes a local source
    // with an HTTP Range request before it'll accept it as playable media -
    // unlike a real static-file HTTP server, protocol.handle doesn't do
    // that negotiation for us, so without this Chromium rejects the whole
    // response as MEDIA_ERR_SRC_NOT_SUPPORTED even when the bytes and
    // content-type are both already correct (confirmed via debug logging:
    // the file was served in full with the right content-type and still
    // failed to decode until range support was added).
    const range = request.headers.get('range');
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(chunkSize);
      fs.readSync(fd, buffer, 0, chunkSize, start);
      fs.closeSync(fd);
      return new Response(buffer, {
        status: 206,
        headers: {
          'content-type': contentType,
          'content-length': String(chunkSize),
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'accept-ranges': 'bytes',
        },
      });
    }

    const data = fs.readFileSync(filePath);
    return new Response(data, {
      headers: {
        'content-type': contentType,
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
      },
    });
  });
}

module.exports = {
  pickAndImportSound,
  getSoundInfo,
  registerProtocol,
  openPickerFolder,
  bundledSoundsDir,
  starterSoundsDir,
  seedStarterSounds,
};
