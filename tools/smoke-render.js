'use strict';

// Launch the real app and REPORT WHAT THE RENDERER SAID.
//
//   node tools/smoke-render.js
//
// `smoke-launch.js` answers "does the process stay up". This answers the question that has
// actually been costing time: "did the page work". No unit test in this project starts Electron,
// so a renderer that throws while loading - a missing element, a temporal dead zone, a mistyped
// event name - gives a blank panel and a completely green test suite. That failure has now been
// hit several times across two codebases in this ecosystem.
//
// It clicks NOTHING at the OS level. EverQuest runs on this machine and a stray synthetic click
// has landed in the game window before now. Everything here happens inside our own renderer via
// the app's own console output; the mouse is never touched.
//
// Exit code is 0 if the page loaded with no renderer errors, 1 otherwise.

const { spawn } = require('child_process');
const path = require('path');

const HOLD_MS = 22000;
const ROOT = path.join(__dirname, '..');
const electron = require(path.join(ROOT, 'node_modules', 'electron'));

const child = spawn(electron, [ROOT], {
  cwd: ROOT,
  env: { ...process.env, EQLS_SMOKE: process.env.EQLS_SMOKE || 'lockouts' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let err = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', (d) => { err += d.toString(); });

let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

setTimeout(() => {
  if (exited === null) child.kill();
  setTimeout(report, 700);
}, HOLD_MS);

function report() {
  const all = out + err;
  const rendererLines = all.split(/\r?\n/).filter((l) => l.startsWith('RENDERER'));

  // Electron's console-message levels: 0 verbose, 1 info, 2 warning, 3 error.
  const errors = rendererLines.filter((l) => /^RENDERER\[3\]/.test(l) || l.startsWith('RENDERER GONE'));
  const warnings = rendererLines.filter((l) => /^RENDERER\[2\]/.test(l));

  // Anything that looks like an unhandled failure, wherever it surfaced.
  const fatal = all
    .split(/\r?\n/)
    .filter((l) => /Uncaught|TypeError|ReferenceError|is not a function|Cannot read propert/i.test(l));

  console.log('=== renderer smoke test ===');
  console.log('  held for            :', HOLD_MS + 'ms');
  console.log('  process             :', exited === null ? 'still running when stopped' : `exited code=${exited.code}`);
  console.log('  renderer messages   :', rendererLines.length);
  console.log('  renderer ERRORS     :', errors.length);
  console.log('  renderer warnings   :', warnings.length);
  console.log('  fatal-looking lines :', fatal.length);

  const probes = rendererLines.filter((l) => l.includes('PROBE:'));
  for (const l of probes) console.log('  ', l.replace(/^RENDERER\[\d\] /, ''));

  for (const l of errors.slice(0, 12)) console.log('   !', l);
  for (const l of fatal.slice(0, 12)) console.log('   !', l.trim().slice(0, 200));

  if (!errors.length && !fatal.length) {
    console.log('  -> the page loaded and said nothing bad');
    process.exit(0);
  }
  console.log('  -> RENDERER PROBLEMS ABOVE. A green unit suite does not cover this.');
  process.exit(1);
}
