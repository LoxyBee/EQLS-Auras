// Starts the real app, holds it for a few seconds, and reports whether it survived.
//
//   node tools/smoke-launch.js [ms]
//
// WHY THIS EXISTS. Every unit test in this repo runs in plain Node. None of them starts Electron,
// so none of them can see a failure that only happens in a real app process. One shipped that
// way: main.js registered the global hotkey as 'Pause', which Electron does not accept - it
// THROWS rather than returning false, so the graceful fallback beside it never ran, the hotkey
// never once worked, and the top bar said "or press Pause" the whole time. 27 green suites and
// 396 passing cases did not notice. Nine seconds of actually launching it did.
//
// It does NOT click anything, deliberately: EverQuest runs on the owner's machine and a stray
// synthetic click has landed in the game window before. This only watches startup.
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const electron = require('electron');
const HOLD_MS = Number(process.argv[2] || 9000);

const out = [];
const child = spawn(electron, ['.'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => out.push(['out', String(d)]));
child.stderr.on('data', (d) => out.push(['err', String(d)]));

let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

setTimeout(() => {
  const text = out.map(([s, t]) => t).join('');
  // Electron writes a lot of harmless noise to stderr. These are the lines that mean something.
  const fatal = text
    .split(/\r?\n/)
    .filter((l) => /Error|error:|Cannot find module|Unhandled|EACCES|ENOENT|Failed to load|is not a function|is not defined/i.test(l))
    // Known-harmless Chromium/GPU chatter on Windows.
    .filter((l) => !/GPU|gpu_|dxdiag|d3d|Vulkan|cache|DevTools|Autofill|registry|gles|ANGLE|swiftshader/i.test(l));

  console.log('=== app smoke test ===');
  console.log('  held for            :', HOLD_MS + 'ms');
  console.log('  still running       :', exited === null ? 'YES' : `no - exited code=${exited.code} signal=${exited.signal}`);
  console.log('  output lines        :', out.length);
  console.log('  lines that look bad :', fatal.length);
  if (fatal.length) fatal.slice(0, 25).forEach((l) => console.log('    ' + l.trim().slice(0, 160)));
  if (!fatal.length && exited === null) console.log('  -> started clean and stayed up');

  if (exited === null) {
    child.kill();
    // Electron can leave the helper processes behind if the parent is killed too fast.
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } process.exit(0); }, 1500);
  } else {
    process.exit(0);
  }
}, HOLD_MS);
