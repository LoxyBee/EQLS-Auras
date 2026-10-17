#!/usr/bin/env node
'use strict';

// MANDATORY version bump (owner, 16 Oct: "any change must first have its version pushed ... this
// is mandatory every single time"). Fails unless package.json's version is HIGHER than the base
// branch's. Run by the PR check in .github/workflows/test.yml, and runnable locally before a push:
//
//   node tools/check-version-bump.js            # compares against origin/master
//   node tools/check-version-bump.js <git-ref>  # compares against another ref
//
// Bump with:  npm version patch --no-git-tag-version   (or minor / major)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}

// a > b ?
function isHigher(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

function main() {
  const baseRef = process.argv[2] || 'origin/master';
  const head = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  let base;
  try {
    base = JSON.parse(execSync(`git show ${baseRef}:package.json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).version;
  } catch (err) {
    console.error(`Could not read package.json at ${baseRef} - fetch it first (git fetch origin master).`);
    process.exit(2);
  }
  if (!parse(head)) {
    console.error(`package.json version "${head}" is not MAJOR.MINOR.PATCH.`);
    process.exit(1);
  }
  if (!isHigher(head, base)) {
    console.error(
      `VERSION NOT BUMPED: package.json is ${head}, ${baseRef} is ${base}.\n` +
        'Every change must raise the version before it is pushed - this is mandatory (see CLAUDE.md).\n' +
        'Run: npm version patch --no-git-tag-version   (minor for a new feature)'
    );
    process.exit(1);
  }
  console.log(`Version bumped: ${base} -> ${head}`);
}

if (require.main === module) main();

module.exports = { isHigher, parse };
