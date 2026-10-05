#!/usr/bin/env node
'use strict';

// Write (or --check) the browser/CLI media manifest for the SimCity 2000
// Win95 interactive demo candidate.
//
// SimCity 2000 is the first candidate that cannot be mounted as files alone:
// its main window refuses to open with
//
//   "Sim City 2000 has not been properly registered with the system.
//    Please re-install the game."
//
// unless HKCU\Software\Maxis\SimCity 2000 Win95 Demo exists, and it then finds
// every asset through that key's Paths subkey rather than through its own
// directory. So the manifest carries the registry its InstallShield setup
// wrote (both hosts importStore() a manifest's `registry` block at launch --
// test/run.js and lib/browser-shell.js), with the Paths rewritten from the
// installer's "C:\Program Files\Maxis\SimCity 2000 Demo" to the drive root the
// manifest actually mounts the tree at.
//
// The values are the ones a real install produced here, captured with
// `test/run.js --reg-export` after running the two-stage setup; only the HKCU
// subtree the game reads is kept. Registration's strings are the demo's own
// placeholder mayor/company, not a serial number.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'test/binaries/candidates/simcity-2000-demo');
const INSTALLED = path.join(APP, 'installed');
const MANIFEST = path.join(APP, '.wine-assembly-browser.json');
const EXE = 'simdemo.exe'; // mounted by lib/apps.js `exe:`, not by the manifest
const CHECK = process.argv.includes('--check');

const SZ = 1; // REG_SZ
const DW = 4; // REG_DWORD

const REGISTRY = {
  'HKCU\\Software\\Maxis': {},
  'HKCU\\Software\\Maxis\\SimCity 2000 Win95 Demo': {},
  'HKCU\\Software\\Maxis\\SimCity 2000 Win95 Demo\\Registration': {
    'Mayor Name': [SZ, 'SimCity 2000\u00ae for Windows\u00ae 95'],
    'Company Name': [SZ, 'Interactive Demo'],
  },
  'HKCU\\Software\\Maxis\\SimCity 2000 Win95 Demo\\Version': {
    'SimCity 2000': [DW, 256],
  },
  'HKCU\\Software\\Maxis\\SimCity 2000 Win95 Demo\\Paths': {
    Home: [SZ, 'C:\\'],
    Graphics: [SZ, 'C:\\Bitmaps'],
    Music: [SZ, 'C:\\Sounds'],
    Data: [SZ, 'C:\\Data'],
    Goodies: [SZ, 'C:\\Goodies'],
    Cities: [SZ, 'C:\\Cities'],
    SaveGame: [SZ, 'C:\\Cities'],
    TileSets: [SZ, 'C:\\ScurkArt'],
    Scenarios: [SZ, 'C:\\Scenario'],
  },
  'HKCU\\Software\\Maxis\\SimCity 2000 Win95 Demo\\Localize': {
    Language: [SZ, 'USA'],
  },
  'HKCU\\Software\\Maxis\\SimCity 2000 Win95 Demo\\Windows': {
    Display: [SZ, '8 1'],
    'Color Check': [DW, 0],
  },
  'HKCU\\Software\\Maxis\\SimCity 2000 Win95 Demo\\Options': {
    Speed: [DW, 1],
    Sound: [DW, 1],
    Music: [DW, 1],
    AutoGoto: [DW, 1],
    AutoBudget: [DW, 0],
    Disasters: [DW, 1],
    AutoSave: [DW, 0],
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
    console.error(`${path.relative(ROOT, MANIFEST)} is stale; run node tools/gen-simcity2000-manifest.js`);
    process.exit(1);
  }
  console.log(`gen-simcity2000-manifest: up to date (${files.length} files)`);
} else {
  fs.writeFileSync(MANIFEST, text);
  console.log(`gen-simcity2000-manifest: ${files.length} files and ` +
    `${Object.keys(manifest.registry).length} registry keys -> ${path.relative(ROOT, MANIFEST)}`);
}
