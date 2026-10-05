#!/usr/bin/env node
// Microsoft Compress's SZDD form is the format used by Win3.x setup media for
// files named *.DL_, *.EX_, and similar. It is a 4 KiB LZSS window with flag
// bits consumed least-significant first.
//
//   node tools/szdd.js <in.DL_> <out.DLL>   expand one file
//   node tools/szdd.js <in.DL_>             print the stored name hint and size
//
// Importable: require('./szdd').expandSzdd(buffer, label) -> Buffer.
'use strict';
const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from([0x53, 0x5A, 0x44, 0x44, 0x88, 0xF0, 0x27, 0x33]);

function expandSzdd(input, label = 'input') {
  if (input.length < 14 || !input.subarray(0, 8).equals(MAGIC) || input[8] !== 0x41) {
    throw new Error(`${label} is not an SZDD mode-A stream`);
  }
  const expected = input.readUInt32LE(10);
  if (!expected || expected > 0x7FFFFFFF) throw new Error(`${label} has an invalid SZDD size`);
  const output = Buffer.allocUnsafe(expected);
  const window = Buffer.alloc(4096, 0x20);
  let windowPos = 0xFF0;
  let inPos = 14;
  let outPos = 0;
  while (outPos < expected) {
    if (inPos >= input.length) throw new Error(`${label} has a truncated SZDD flag byte`);
    const flags = input[inPos++];
    for (let bit = 0; bit < 8 && outPos < expected; bit++) {
      if (flags & (1 << bit)) {
        if (inPos >= input.length) throw new Error(`${label} has a truncated SZDD literal`);
        const value = input[inPos++];
        output[outPos++] = value;
        window[windowPos] = value;
        windowPos = (windowPos + 1) & 0xFFF;
      } else {
        if (inPos + 1 >= input.length) throw new Error(`${label} has a truncated SZDD match`);
        const low = input[inPos++];
        const packed = input[inPos++];
        const match = low | ((packed & 0xF0) << 4);
        const length = (packed & 0x0F) + 3;
        for (let i = 0; i < length && outPos < expected; i++) {
          const value = window[(match + i) & 0xFFF];
          output[outPos++] = value;
          window[windowPos] = value;
          windowPos = (windowPos + 1) & 0xFFF;
        }
      }
    }
  }
  return output;
}

function expandSzddFile(source, destination) {
  const output = expandSzdd(fs.readFileSync(source), source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, output);
  return output.length;
}

module.exports = { expandSzdd, expandSzddFile };

if (require.main === module) {
  const [src, dst] = process.argv.slice(2);
  if (!src) {
    console.error('usage: node tools/szdd.js <in.XX_> [out]');
    process.exit(2);
  }
  if (dst) {
    console.log(`${dst}: ${expandSzddFile(src, dst)} bytes`);
  } else {
    const input = fs.readFileSync(src);
    if (!input.subarray(0, 8).equals(MAGIC)) { console.error(`${src}: not SZDD`); process.exit(1); }
    const hint = input[9] ? String.fromCharCode(input[9]) : '(none)';
    console.log(`${src}: SZDD mode ${String.fromCharCode(input[8])}, last char ${hint}, ${input.readUInt32LE(10)} bytes expanded`);
  }
}
