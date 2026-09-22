#!/usr/bin/env node
'use strict';

// Unpack an InstallShield 3 "DATA.Z" archive (signature 0x8C655D13) — the
// payload of 1996-97 installers such as the Atomic Bomberman demo. 7z and
// unshield (InstallShield 5+ .cab) both refuse this format.
//
//   node tools/is3-extract.js DATA.Z [--list] [--out=DIR]
//
// Layout: a 255-byte header, then each file's PKWARE DCL "implode" stream, then
// a directory table and a file table, each entry sized by its own chunk-size
// field. Decompression reuses the explode in tools/mpq.js.

const fs = require('fs');
const path = require('path');
const { explode } = require('./mpq');

function readArchive(buf) {
  if (buf.readUInt32LE(0) !== 0x8C655D13) throw new Error('not an InstallShield 3 archive');
  const fileCount = buf.readUInt16LE(12);
  const archiveSize = buf.readUInt32LE(18);
  const tocAddress = buf.readUInt32LE(41);
  const dirCount = buf.readUInt16LE(49);
  if (archiveSize !== buf.length) {
    console.error(`warning: header says ${archiveSize} bytes, file has ${buf.length} (multi-volume?)`);
  }
  const dirs = [];
  let p = tocAddress;
  for (let i = 0; i < dirCount; i++) {
    const count = buf.readUInt16LE(p);
    const chunk = buf.readUInt16LE(p + 2);
    const nameLen = buf.readUInt16LE(p + 4);
    dirs.push({ count, name: buf.toString('latin1', p + 6, p + 6 + nameLen) });
    p += chunk;
  }
  const files = [];
  for (let i = 0; i < fileCount; i++) {
    const nameLen = buf[p + 29];
    files.push({
      dir: buf.readUInt16LE(p + 1),
      size: buf.readUInt32LE(p + 3),
      csize: buf.readUInt32LE(p + 7),
      offset: buf.readUInt32LE(p + 11),
      dosTime: buf.readUInt32LE(p + 15),
      attrib: buf.readUInt32LE(p + 25),
      name: buf.toString('latin1', p + 30, p + 30 + nameLen),
    });
    p += buf.readUInt16LE(p + 23);
  }
  for (const f of files) {
    const d = dirs[f.dir];
    if (!d) throw new Error(`${f.name}: directory index ${f.dir} out of range`);
    f.path = d.name ? d.name + '\\' + f.name : f.name;
  }
  return { dirs, files };
}

// DOS date in the low word, time in the high word.
function dosDate(v) {
  const date = v & 0xFFFF, time = v >>> 16;
  return new Date(Date.UTC(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31,
    time >> 11, (time >> 5) & 63, (time & 31) * 2));
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  if (!input) {
    console.error('usage: node tools/is3-extract.js DATA.Z [--list] [--out=DIR]');
    process.exit(2);
  }
  const outArg = args.find(a => a.startsWith('--out='));
  const list = args.includes('--list') || !outArg;
  const buf = fs.readFileSync(input);
  const { files } = readArchive(buf);
  let bad = 0;
  for (const f of files) {
    const when = dosDate(f.dosTime).toISOString().slice(0, 16).replace('T', ' ');
    if (list) console.log(`${String(f.size).padStart(10)} ${when}  ${f.path}`);
    if (!outArg) continue;
    let data;
    try {
      data = Buffer.from(explode(buf.subarray(f.offset, f.offset + f.csize)));
    } catch (e) {
      console.error(`${f.path}: ${e.message}`);
      bad++;
      continue;
    }
    if (data.length !== f.size) {
      console.error(`${f.path}: expanded to ${data.length}, table says ${f.size}`);
      bad++;
    }
    const dest = path.join(outArg.slice(6), ...f.path.split('\\'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    fs.utimesSync(dest, dosDate(f.dosTime), dosDate(f.dosTime));
  }
  console.error(`${files.length} files${outArg ? `, ${bad} failed` : ''}`);
  process.exit(bad ? 1 : 0);
}

if (require.main === module) main();

module.exports = { readArchive, dosDate };
