#!/usr/bin/env node
'use strict';

// Install the June 1997 public Atomic Bomberman demo (BM95DEMO.EXE) from the
// archive.org item BOMBDEMO. The package is an InstallShield 3 setup whose
// payload, DATA.Z, is unpacked host-side with tools/is3-extract.js; the setup
// only copies files, so nothing the guest installer does is lost.
//
//   node tools/install-atomic-bomberman-demo.js [--zip=ATOMDEMO.zip]
//
// The licence (LEGAL.TXT) allows personal copies only, so the tree and its
// browser manifest stay under the gitignored test/binaries and never deploy.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readArchive } = require('./is3-extract');
const { explode } = require('./mpq');

const ROOT = path.join(__dirname, '..');
const PACKAGE = path.join(ROOT, 'test/binaries/win98-games-a-d', 'Atomic Bomberman Demo-archive');
const OUTPUT = path.join(PACKAGE, 'installed');
const URL = 'https://archive.org/download/BOMBDEMO/ATOMDEMO.zip';
const ZIP_SHA256 = 'ed5f2fd64e2b935ad4523a3183ebbbb23216cc56108eec1d13acc8a796110055';
const EXE_SHA256 = '6133d5aa74df524373501028548fa3e9b28798c118bfa379dc3ad3afba1eba71';
const PAYLOAD_FILES = 173;
const PAYLOAD_BYTES = 25468862;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function main() {
  const zipArg = process.argv.slice(2).find(a => a.startsWith('--zip='));
  const zip = zipArg ? zipArg.slice(6) : path.join(PACKAGE, 'ATOMDEMO.zip');
  if (!fs.existsSync(zip)) {
    fs.mkdirSync(path.dirname(zip), { recursive: true });
    console.log(`fetching ${URL}`);
    execFileSync('curl', ['-sSfL', '-o', zip, URL], { stdio: 'inherit' });
  }
  assert.strictEqual(sha256(fs.readFileSync(zip)), ZIP_SHA256, 'ATOMDEMO.zip hash mismatch');
  const data = execFileSync('unzip', ['-p', zip, 'DATA.Z'], { maxBuffer: 64 << 20 });
  const { files } = readArchive(data);
  assert.strictEqual(files.length, PAYLOAD_FILES);

  const manifest = { schemaVersion: 1, files: [] };
  let total = 0;
  for (const f of files) {
    const bytes = Buffer.from(explode(data.subarray(f.offset, f.offset + f.csize)));
    assert.strictEqual(bytes.length, f.size, `${f.path}: size mismatch`);
    total += bytes.length;
    const rel = f.path.split('\\').join('/');
    const dest = path.join(OUTPUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    manifest.files.push({ url: rel, vfsPath: 'c:\\' + f.path });
  }
  assert.strictEqual(total, PAYLOAD_BYTES);
  assert.strictEqual(sha256(fs.readFileSync(path.join(OUTPUT, 'BM95DEMO.EXE'))), EXE_SHA256);
  fs.writeFileSync(path.join(OUTPUT, '.wine-assembly-browser.json'),
    JSON.stringify(manifest, null, 2) + '\n');
  console.log(`installed ${files.length} files (${total} bytes) to ${path.relative(ROOT, OUTPUT)}`);
}

main();
