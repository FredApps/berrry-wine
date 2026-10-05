#!/usr/bin/env node
'use strict';

// Moorhuhn (1) is published on the desktop from its local file manifest; its
// sequels and siblings live in neighbouring candidates/moorhuhn-* directories
// and stay local-only. Check the deploy ships exactly the exe, the manifest and
// the files it mounts, and that no sibling's directory rides along on the
// shared name prefix.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DESKTOP_APPS, LOCAL_CANDIDATE_APPS, APPS } = require('../lib/apps');
const { desktopAssetPaths } = require('../tools/deploy-berrry');
const iconManifest = require('../lib/app-icon-manifest.json');

const ROOT = path.join(__dirname, '..');
const id = 'moorhuhn';
const app = APPS[id];

assert(DESKTOP_APPS.some(([name]) => name === id), 'Moorhuhn must appear on the desktop');
assert(!LOCAL_CANDIDATE_APPS.some(([name]) => name === id), 'Moorhuhn is listed twice');
assert(iconManifest.icons.includes(id), 'Moorhuhn must have a desktop icon');
assert(fs.existsSync(path.join(ROOT, 'icons', 'apps', `${id}.png`)), 'Moorhuhn icon is missing');
assert(app.localFileManifest, 'Moorhuhn mounts through its local file manifest');

const manifestPath = path.join(ROOT, app.localFileManifest);
if (!fs.existsSync(manifestPath)) {
  console.log('SKIP  Moorhuhn assets are not installed in this tree');
  process.exit(0);
}

const deployed = desktopAssetPaths();
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const dir = path.posix.dirname(app.localFileManifest);
const mounted = new Set([app.exe, app.localFileManifest,
  ...manifest.files.map(f => path.posix.normalize(path.posix.join(dir, f.url)))]);

for (const file of mounted) assert(deployed.has(file), `deploy is missing ${file}`);
const extra = [...deployed].filter(p => p.startsWith(dir + '/') && !mounted.has(p));
assert.deepStrictEqual(extra, [], 'deploy ships Moorhuhn files the game does not mount');

const siblings = [...deployed].filter(p => p.startsWith('test/binaries/candidates/moorhuhn-') ||
  p.startsWith('test/binaries/candidates/gallinelle'));
assert.deepStrictEqual(siblings, [], 'deploy ships a local-only Moorhuhn sibling');

console.log(`PASS  Moorhuhn desktop entry, icon and ${mounted.size} manifest assets ship; siblings do not`);
