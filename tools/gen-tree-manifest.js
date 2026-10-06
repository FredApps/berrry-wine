#!/usr/bin/env node
'use strict';

// Write the local-media manifest (.wine-assembly-browser.json) for one
// installed game tree, the file lib/apps.js names as `localFileManifest`.
//
//   node tools/gen-tree-manifest.js <root> --exe=System/Game.exe
//        [--flatten=System] [--exclude=DIR] [--check]
//
// Every file under <root> is mounted at c:\<its path relative to root>, so an
// install laid out as root\System\Game.exe + root\Maps\... keeps the layout the
// game's own ..\Maps lookups expect. The exe itself is left out (the registry's
// `exe` mounts it), as are the manifest file and anything under Logs\ or
// --exclude=DIR (repeatable). --check fails instead of writing when the file on
// disk differs, so a tree that changed is noticed rather than silently stale.
// The per-corpus gen-*-manifest.js scripts do the same for their own lists;
// this one is for a single tree that needs nothing but the default mapping.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const root = args.find(arg => !arg.startsWith('--'));
const exeArg = (args.find(arg => arg.startsWith('--exe=')) || '').slice(6);
const excludes = ['logs', ...args.filter(arg => arg.startsWith('--exclude='))
  .map(arg => arg.slice(10).toLowerCase())];
const CHECK = args.includes('--check');
const MANIFEST = '.wine-assembly-browser.json';

if (!root || !exeArg) {
  console.error('usage: gen-tree-manifest.js <root> --exe=REL/PATH.exe [--flatten=DIR] [--exclude=DIR] [--check]');
  process.exit(2);
}
const exe = path.normalize(exeArg).toLowerCase();
if (!fs.existsSync(path.join(root, exeArg))) {
  console.error(`gen-tree-manifest: ${exeArg} not found under ${root}`);
  process.exit(2);
}

function walk(relative = '', output = []) {
  const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!excludes.includes(name.toLowerCase())) walk(name, output);
    } else if (entry.isFile() && entry.name !== MANIFEST) {
      output.push(name);
    }
  }
  return output;
}

// The exe mounts at c:\<its name>, and an Unreal-engine game then sets its
// current directory there and opens its INI relative to it while finding
// packages through ..\System. --flatten=DIR also mounts each file directly
// under DIR at c:\<name>, as the Unreal SE manifest does, so both lookups land.
const flatten = (args.find(arg => arg.startsWith('--flatten=')) || '').slice(10).toLowerCase();
const files = walk()
  .filter(relative => path.normalize(relative).toLowerCase() !== exe)
  .map(relative => {
    const url = relative.split(path.sep).join('/');
    const vfsPath = 'c:\\' + relative.split(path.sep).join('\\');
    // The byte length lets lib/app-files.js stream a large file without a
    // HEAD per file (loadMode 'lazy' mounts synchronously at a known size).
    const size = fs.statSync(path.join(root, relative)).size;
    const parts = relative.split(path.sep);
    if (flatten && parts.length === 2 && parts[0].toLowerCase() === flatten) {
      return { url, vfsPaths: ['c:\\' + parts[1], vfsPath], size };
    }
    return { url, vfsPath, size };
  });
const text = JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n';
const target = path.join(root, MANIFEST);

if (CHECK) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== text) {
    console.error(`gen-tree-manifest: ${target} is stale (${files.length} files expected)`);
    process.exit(1);
  }
  console.log(`gen-tree-manifest: ${target} up to date (${files.length} files)`);
} else {
  fs.writeFileSync(target, text);
  console.log(`gen-tree-manifest: wrote ${target} (${files.length} files)`);
}
