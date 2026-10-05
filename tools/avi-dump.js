#!/usr/bin/env node
// Dump the structure of a RIFF AVI: the chunk tree down to the movi list,
// each stream's strh/strf, and an idx1 census per stream id.
//
//   node tools/avi-dump.js <file.avi> [--chunks=N] [--index=N]
//
// --chunks=N prints the first N chunks inside movi (default 12), --index=N the
// first N idx1 entries (default 8). This is the host-side ground truth for
// what the Win16 AVIFILE in src/09e-win16-api.wat must parse.
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = (name, def) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
if (!file) { console.error('usage: node tools/avi-dump.js <file.avi> [--chunks=N] [--index=N]'); process.exit(2); }
const buf = fs.readFileSync(file);
const fcc = (o) => buf.toString('latin1', o, o + 4);
const hex = (v) => '0x' + (v >>> 0).toString(16);

if (fcc(0) !== 'RIFF' || fcc(8) !== 'AVI ') { console.error(`${file}: not a RIFF AVI`); process.exit(1); }
console.log(`${file}: ${buf.length} bytes, RIFF size ${buf.readUInt32LE(4)}`);

function strh(o) {
  return {
    type: fcc(o), handler: fcc(o + 4), flags: hex(buf.readUInt32LE(o + 8)),
    initialFrames: buf.readUInt32LE(o + 16), scale: buf.readUInt32LE(o + 20),
    rate: buf.readUInt32LE(o + 24), start: buf.readUInt32LE(o + 28),
    length: buf.readUInt32LE(o + 32), suggestedBuffer: buf.readUInt32LE(o + 36),
    sampleSize: buf.readUInt32LE(o + 44),
  };
}
function strf(o, size, type) {
  if (type === 'auds') {
    return `wFormatTag=${buf.readUInt16LE(o)} ch=${buf.readUInt16LE(o + 2)} rate=${buf.readUInt32LE(o + 4)} ` +
      `avgBytes=${buf.readUInt32LE(o + 8)} blockAlign=${buf.readUInt16LE(o + 12)} bits=${buf.readUInt16LE(o + 14)} (${size} bytes)`;
  }
  if (type === 'vids') {
    return `${buf.readInt32LE(o + 4)}x${buf.readInt32LE(o + 8)} bpp=${buf.readUInt16LE(o + 14)} ` +
      `compression=${fcc(o + 16)} sizeImage=${buf.readUInt32LE(o + 20)} (${size} bytes)`;
  }
  return `${size} bytes`;
}

let streamNo = 0;
let moviData = -1;
function walk(start, end, depth) {
  let p = start;
  while (p + 8 <= end) {
    const id = fcc(p);
    const size = buf.readUInt32LE(p + 4);
    const pad = '  '.repeat(depth);
    if (id === 'LIST') {
      const kind = fcc(p + 8);
      console.log(`${pad}LIST ${kind} @${hex(p)} size=${size}`);
      if (kind === 'movi') {
        moviData = p + 8;
        let q = p + 12, n = 0;
        const counts = {};
        while (q + 8 <= p + 8 + size) {
          const cid = fcc(q), cs = buf.readUInt32LE(q + 4);
          counts[cid] = (counts[cid] || 0) + 1;
          if (n < opt('chunks', 12)) console.log(`${pad}  ${cid} @${hex(q)} size=${cs}`);
          n++;
          q += 8 + ((cs + 1) & ~1);
        }
        console.log(`${pad}  ${n} chunks: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      } else {
        walk(p + 12, p + 8 + size, depth + 1);
      }
    } else if (id === 'avih') {
      console.log(`${pad}avih usPerFrame=${buf.readUInt32LE(p + 8)} flags=${hex(buf.readUInt32LE(p + 20))} ` +
        `frames=${buf.readUInt32LE(p + 24)} streams=${buf.readUInt32LE(p + 32)} ` +
        `${buf.readUInt32LE(p + 40)}x${buf.readUInt32LE(p + 44)}`);
    } else if (id === 'strh') {
      const h = strh(p + 8);
      walk.lastType = h.type;
      console.log(`${pad}strh #${streamNo++} ${JSON.stringify(h)}`);
    } else if (id === 'strf') {
      console.log(`${pad}strf ${strf(p + 8, size, walk.lastType)}`);
    } else if (id === 'idx1') {
      const n = size / 16;
      console.log(`${pad}idx1 @${hex(p)} ${n} entries`);
      const counts = {};
      let absolute = null;
      for (let i = 0; i < n; i++) {
        const e = p + 8 + i * 16;
        const cid = fcc(e);
        counts[cid] = (counts[cid] || 0) + 1;
        const off = buf.readUInt32LE(e + 8);
        if (absolute === null && moviData >= 0) absolute = off >= moviData;
        if (i < opt('index', 8)) {
          console.log(`${pad}  ${cid} flags=${hex(buf.readUInt32LE(e + 4))} off=${hex(off)} size=${buf.readUInt32LE(e + 12)}`);
        }
      }
      console.log(`${pad}  per id: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}; offsets ${absolute ? 'absolute' : 'movi-relative'}`);
    } else {
      console.log(`${pad}${id} @${hex(p)} size=${size}`);
    }
    p += 8 + ((size + 1) & ~1);
  }
}
walk(12, Math.min(buf.length, 8 + buf.readUInt32LE(4)), 0);
