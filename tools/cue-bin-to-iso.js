#!/usr/bin/env node
// Convert a raw CD image (.bin, MODE1/2352 or MODE2/2352 data track) to a
// plain 2048-byte-sector .iso that 7z and hdiutil can read.
//
//   node tools/cue-bin-to-iso.js <image.cue|image.bin> [out.iso]
//
// Archive.org cover discs are often dumped raw: every sector is 2352 bytes of
// sync + header (+ subheader) + user data + EDC/ECC. Only the first data track
// is converted; audio tracks after it are ignored. With a .cue, the track mode
// is read from it; with a bare .bin, MODE1 is assumed and verified against the
// sector sync pattern.
'use strict';
const fs = require('fs');
const path = require('path');

const RAW = 2352;
const USER = 2048;
const SYNC = Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);

function parseCue(cuePath) {
  const text = fs.readFileSync(cuePath, 'latin1');
  const file = /FILE\s+"([^"]+)"/i.exec(text);
  const track = /TRACK\s+\d+\s+(MODE[12])\/(\d+)/i.exec(text);
  if (!file || !track) throw new Error(`${cuePath}: no FILE/data TRACK line`);
  if (Number(track[2]) !== RAW) throw new Error(`${cuePath}: sector size ${track[2]} is not ${RAW}`);
  return { bin: path.resolve(path.dirname(cuePath), file[1]), mode: track[1].toUpperCase() };
}

function main() {
  const [input, outArg] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node tools/cue-bin-to-iso.js <image.cue|image.bin> [out.iso]');
    process.exit(2);
  }
  const { bin, mode } = /\.cue$/i.test(input) ? parseCue(input) : { bin: input, mode: 'MODE1' };
  const out = outArg || bin.replace(/\.[^.]+$/, '') + '.iso';
  const size = fs.statSync(bin).size;
  if (size % RAW) throw new Error(`${bin}: size ${size} is not a multiple of ${RAW}`);
  const sectors = size / RAW;
  const offset = mode === 'MODE1' ? 16 : 24; // MODE2 form 1 has an 8-byte subheader

  const fdIn = fs.openSync(bin, 'r');
  const fdOut = fs.openSync(out, 'w');
  const CHUNK = 512;
  const raw = Buffer.alloc(RAW * CHUNK);
  const user = Buffer.alloc(USER * CHUNK);
  let badSync = 0;
  for (let s = 0; s < sectors; s += CHUNK) {
    const n = Math.min(CHUNK, sectors - s);
    fs.readSync(fdIn, raw, 0, n * RAW, s * RAW);
    for (let i = 0; i < n; i++) {
      const base = i * RAW;
      if (!raw.subarray(base, base + 12).equals(SYNC)) badSync++;
      raw.copy(user, i * USER, base + offset, base + offset + USER);
    }
    fs.writeSync(fdOut, user, 0, n * USER);
  }
  fs.closeSync(fdIn);
  fs.closeSync(fdOut);
  console.log(`${out}: ${sectors} sectors (${mode}), ${badSync} without sector sync`);
  if (badSync) process.exitCode = 1;
}

main();
