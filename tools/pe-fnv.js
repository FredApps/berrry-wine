#!/usr/bin/env node
// FNV-1a of a byte range of a PE, for the exact-body matchers in
// src/07-decoder.wat.
//
//   node tools/pe-fnv.js <pe> 0xVA <len> [--words] [--bytes]
//
// WHY THIS EXISTS: a fold that replaces a long straight-line body with
// hardcoded arithmetic has to prove every byte of that body, and the way this
// codebase does it ($try_emit_aoe_span_prefix; the retired MW3 alpha row did
// the same) is a few sampled structural
// checks plus an FNV-1a over the whole range. That hash is a magic constant
// which has to come from somewhere, and until now it came from nowhere -- so
// it was either copied by hand or the check was skipped. This prints it.
//
// --words additionally prints the range as the i32 constants $gl32 would read
// at each offset, which is what the sampled structural checks are written
// against; --bytes prints a JS array literal, for a test fixture that wants
// the same bytes verbatim.
//
// The hash is the same FNV-1a the WAT computes: offset basis 0x811c9dc5,
// prime 0x01000193, one byte at a time, result as unsigned i32.

'use strict';

const { readPE } = require('../lib/pe');

const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('--'));
const pos = argv.filter(a => !a.startsWith('--'));
if (pos.length < 3) {
  console.error('usage: pe-fnv.js <pe> 0xVA <len> [--words] [--bytes]');
  process.exit(2);
}
const [file, vaArg, lenArg] = pos;
const va = Number(vaArg);
const len = Number(lenArg);

const pe = readPE(file);
const info = pe.va2offInfo ? pe.va2offInfo(va) : null;
const off = pe.va2off(va);
if (off < 0 || (info && info.hasRaw === false)) {
  console.error(`0x${va.toString(16)} has no raw bytes in ${file} ` +
    '(BSS, or outside every section)');
  process.exit(1);
}
const bytes = pe.buf.subarray(off, off + len);
if (bytes.length !== len) {
  console.error(`only ${bytes.length} of ${len} bytes available at ` +
    `0x${va.toString(16)}`);
  process.exit(1);
}

// Math.imul, or the multiply overflows the double and the low bits are lost.
let hash = 0x811c9dc5 | 0;
for (const b of bytes) hash = Math.imul(hash ^ b, 0x01000193);
hash >>>= 0;

console.log(`${file}`);
console.log(`  range   0x${va.toString(16)} .. 0x${(va + len).toString(16)}` +
  `  (${len} bytes, raw=0x${off.toString(16)})`);
console.log(`  fnv1a   0x${hash.toString(16).padStart(8, '0')}`);

if (flags.includes('--words')) {
  console.log('');
  console.log('  i32 words as $gl32 reads them (offset: value):');
  for (let i = 0; i + 4 <= len; i += 4) {
    console.log(`    +0x${i.toString(16).padStart(3, '0')}  ` +
      `0x${bytes.readUInt32LE(i).toString(16).padStart(8, '0')}`);
  }
  const rem = len % 4;
  if (rem) {
    console.log(`    (+0x${(len - rem).toString(16)}: ${rem} trailing byte(s), ` +
      `use $gl16/$gl8)`);
  }
}

if (flags.includes('--bytes')) {
  console.log('');
  const rows = [];
  for (let i = 0; i < len; i += 12) {
    rows.push('  ' + [...bytes.subarray(i, i + 12)]
      .map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ') + ',');
  }
  console.log(rows.join('\n'));
}
