// Generates a handful of the starter alert sounds shipped in the install's own `sounds/` folder
// (see soundService.js's bundledSoundsDir()). Synthesized, hand-rolled PCM/WAV - no external audio
// files, no licensing question to ever answer, same "no deps, hand-rolled" convention
// iconExtractor.js already uses for the game's own icon art. Run with:
//
//   node tools/generate-bundled-sounds.js
//
// Idempotent and safe to re-run - it only ever writes the fixed set of files below, so it's safe
// alongside the other files in sounds/ (a curated CC0 selection from Kenney's Interface Sounds
// pack - see sounds/LICENSE.txt for provenance). Not run automatically by anything; the output is
// committed to the repo (sounds/) like any other bundled asset, so nobody who clones the repo or
// builds the installer needs Node audio tooling.

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUT_DIR = path.join(__dirname, '..', 'sounds');

// A short linear fade in/out (in samples) so every tone starts and ends at zero crossing - without
// this every generated tone clicks audibly at its edges, which is the one thing that would make a
// synthesized "starter sound" sound obviously synthetic and cheap.
function fadeEnvelope(i, total, fadeSamples) {
  if (i < fadeSamples) return i / fadeSamples;
  if (i > total - fadeSamples) return (total - i) / fadeSamples;
  return 1;
}

// One sine tone, `decay` optionally applying an exponential amplitude falloff (a bell/chime reads
// as "struck" rather than "held" once it decays across its own duration instead of sustaining flat).
function tone(freqHz, durationSec, { decay = 0, amplitude = 0.5 } = {}) {
  const total = Math.round(SAMPLE_RATE * durationSec);
  const fadeSamples = Math.min(200, Math.floor(total / 8));
  const samples = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    let a = amplitude * Math.sin(2 * Math.PI * freqHz * t);
    if (decay > 0) a *= Math.exp(-decay * t);
    a *= fadeEnvelope(i, total, fadeSamples);
    samples[i] = a;
  }
  return samples;
}

function silence(durationSec) {
  return new Float64Array(Math.round(SAMPLE_RATE * durationSec));
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float64Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

// Hand-rolled 16-bit PCM mono WAV encoder - the same shape as iconExtractor.js's PNG encoder:
// write the handful of chunks a WAV file actually needs, nothing pulled in for it.
function encodeWav(samples) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate (mono, 16-bit)
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

// Five short, clearly distinct starter sounds - enough variety to tell apart by ear across the
// three alert types (land/expire/warning) without trying to cover every taste. Every duration is
// under a second: these are alert stingers, not music, and a long default would be the first thing
// anyone with several auras firing at once wants to replace.
const SOUNDS = {
  'Chime.wav': () => concat(tone(880, 0.12, { amplitude: 0.45 }), silence(0.03), tone(1174, 0.16, { amplitude: 0.45 })),
  'Soft Ping.wav': () => tone(660, 0.22, { amplitude: 0.35, decay: 4 }),
  'Alert.wav': () => concat(tone(1000, 0.09, { amplitude: 0.5 }), silence(0.06), tone(1000, 0.09, { amplitude: 0.5 })),
  'Bell.wav': () => tone(1200, 0.5, { amplitude: 0.4, decay: 6 }),
  'Klaxon.wav': () => concat(tone(300, 0.12, { amplitude: 0.5 }), silence(0.04), tone(300, 0.12, { amplitude: 0.5 }), silence(0.04), tone(300, 0.12, { amplitude: 0.5 })),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [fileName, build] of Object.entries(SOUNDS)) {
  fs.writeFileSync(path.join(OUT_DIR, fileName), encodeWav(build()));
  console.log(`wrote ${fileName}`);
}
console.log(`\n${Object.keys(SOUNDS).length} starter sounds written to ${OUT_DIR}`);
