#!/usr/bin/env node
'use strict';

// Write (or --check) the browser/CLI media manifest for the SimCity 2000
// Network Edition trial (archive.org `2knetde`, see test/binaries/SOURCES.md).
//
// Same shape as tools/gen-simcity2000-manifest.js: the installed tree mounted
// at C:\ plus the registry its InstallShield setup writes. The client builds
// "<Paths\Home>\2kserver.exe" to launch its own server for Start New Game and
// finds the newspaper through Paths\Newspaper, so without the key both come
// out as paths off an empty string ("\2kserver.exe", "C:\\html\*.nws").
//
// The key names and values are the ones setup.ins writes (read out of the
// compiled script's string table), with TARGETDIR rewritten from
// "C:\Program Files\Maxis\SimCity 2000 Network Edition Trial" to the drive
// root the manifest mounts the tree at. Registration's strings are
// placeholders; the trial has no serial.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'test/binaries/candidates/simcity-2000-network-edition-demo');
const INSTALLED = path.join(APP, 'installed');
const MANIFEST = path.join(APP, '.wine-assembly-browser.json');
const EXE = '2kclient.exe'; // mounted by lib/apps.js `exe:`, not by the manifest
const CHECK = process.argv.includes('--check');

const SZ = 1; // REG_SZ
const KEY = 'HKCU\\Software\\Maxis\\SimCity 2000 Net';
const APP_PATHS = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths';

const REGISTRY = {
  'HKCU\\Software\\Maxis': {},
  [KEY]: {},
  [`${KEY}\\Registration`]: {
    'Player Name': [SZ, 'Mayor'],
    'Company Name': [SZ, 'SimCity 2000 Network Edition Trial'],
  },
  [`${KEY}\\Paths`]: {
    Home: [SZ, 'C:\\'],
    Newspaper: [SZ, 'C:\\html'],
    Goodies: [SZ, 'C:\\Goodies'],
  },
  [`${KEY}\\Localize`]: {
    Language: [SZ, 'USA'],
  },
  [`${APP_PATHS}\\2kclient.exe`]: {
    '': [SZ, 'C:\\2kclient.exe'],
    Path: [SZ, 'C:\\'],
  },
  [`${APP_PATHS}\\2kserver.exe`]: {
    '': [SZ, 'C:\\2kserver.exe'],
    Path: [SZ, 'C:\\'],
  },
};

// lib/storage.js stores one JSON string per key under a "reg:" prefix, and
// importStore() replays exactly that shape.
function registrySnapshot() {
  const out = {};
  for (const [keyPath, values] of Object.entries(REGISTRY)) {
    const entry = { values: {} };
    for (const [name, [type, data]] of Object.entries(values)) {
      entry.values[name] = { type, data };
    }
    out[`reg:${keyPath}`] = JSON.stringify(entry);
  }
  return out;
}

function walk(directory, relative = '', output = []) {
  const entries = fs.readdirSync(path.join(directory, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) walk(directory, name, output);
    else if (entry.isFile()) output.push(name.split(path.sep).join('/'));
  }
  return output;
}

if (!fs.existsSync(INSTALLED)) {
  throw new Error(`missing installed tree: ${path.relative(ROOT, INSTALLED)}`);
}

const files = walk(INSTALLED)
  .filter(rel => rel.toLowerCase() !== EXE)
  .map(rel => ({ url: `installed/${rel}`, vfsPath: 'c:\\' + rel.replace(/\//g, '\\') }));

const manifest = { schemaVersion: 1, files, registry: registrySnapshot() };
const text = JSON.stringify(manifest, null, 1) + '\n';

if (CHECK) {
  const have = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '';
  if (have !== text) {
    console.error(`${path.relative(ROOT, MANIFEST)} is stale; run node tools/gen-simcity2000-net-manifest.js`);
    process.exit(1);
  }
  console.log(`gen-simcity2000-net-manifest: up to date (${files.length} files)`);
} else {
  fs.writeFileSync(MANIFEST, text);
  console.log(`gen-simcity2000-net-manifest: ${files.length} files and ` +
    `${Object.keys(manifest.registry).length} registry keys -> ${path.relative(ROOT, MANIFEST)}`);
}
