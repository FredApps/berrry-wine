#!/usr/bin/env node
'use strict';

// build/ is where tests, captures and sweeps write their PNGs and logs, so the
// deploy must not walk it: the 2026-10-05 deploy published
// test-web-direct-launch's screenshots that way. Check that build/ is not a
// walked directory, that every build/ file the shipped page code names is in
// BUILD_OUTPUTS or reaches the deploy through the app registry, and that a
// stray file dropped into build/ is not picked up.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BINARY_DIRS, BUILD_OUTPUTS, desktopAssetPaths } = require('../tools/deploy-berrry');

const ROOT = path.join(__dirname, '..');

assert(!BINARY_DIRS.includes('build'), 'build/ must not be walked by the deploy');
assert(BUILD_OUTPUTS.every(p => p.startsWith('build/')), 'BUILD_OUTPUTS are build/ paths');
assert(BUILD_OUTPUTS.includes('build/wine-assembly.wasm'), 'the module ships');
assert(BUILD_OUTPUTS.includes('build/wine-assembly.compat.wasm'), 'the compat module ships');

// Every build/<file> literal in the code a visitor's browser runs must be
// shippable. Prose in comments counts too, which only errs towards asking.
const shipped = ['index.html', 'host.js', 'sw-coi.js']
  .concat(fs.readdirSync(path.join(ROOT, 'lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f))
  .filter(f => fs.existsSync(path.join(ROOT, f)));
const named = new Set();
for (const f of shipped) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of text.matchAll(/\bbuild\/([A-Za-z0-9_.-]+\.(?:wasm|json|png|bin|dat))\b/g)) named.add('build/' + m[1]);
}
const registry = desktopAssetPaths();
const unshipped = [...named].filter(p => !BUILD_OUTPUTS.includes(p) && !registry.has(p));
assert.deepStrictEqual(unshipped, [], 'page code names build/ files the deploy would not ship');

// A test artifact left in build/ is invisible to the deploy.
assert(![...registry].some(p => p.startsWith('build/direct-launch-web/')),
  'test captures must not reach the deploy through the registry');

console.log(`PASS  deploy ships ${BUILD_OUTPUTS.length} build outputs; ${named.size} build/ names in page code all covered`);
