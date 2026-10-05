#!/usr/bin/env node
'use strict';

// tools/kwaj.js expands Microsoft's KWAJ-compressed setup files. Methods 0-2
// are checked against streams built here; method 3 (LZ+Huffman) against the
// one real file it exists for, Civilization II's VFW_INST\IR41.DL_ -- Intel's
// 16-bit Indeo 4 driver -- when the disc's files are present.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { expandKwaj, parseKwajHeader } = require('../tools/kwaj');

const MAGIC = [0x4B, 0x57, 0x41, 0x4A, 0x88, 0xF0, 0x27, 0xD1];

function kwaj(method, data, { length } = {}) {
  const flags = length == null ? 0 : 1;
  const header = Buffer.alloc(14 + (length == null ? 0 : 4));
  Buffer.from(MAGIC).copy(header, 0);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(header.length, 10);
  header.writeUInt16LE(flags, 12);
  if (length != null) header.writeUInt32LE(length, 14);
  return Buffer.concat([header, Buffer.from(data)]);
}

const text = Buffer.from('Indeo Video Interactive');

// Method 0: stored. The header's length field trims the data.
assert.deepStrictEqual(expandKwaj(kwaj(0, Buffer.concat([text, Buffer.from('xx')]),
  { length: text.length })), text);
assert.strictEqual(parseKwajHeader(kwaj(0, text, { length: 7 })).length, 7);

// Method 1: every byte XOR FFh.
assert.deepStrictEqual(expandKwaj(kwaj(1, text.map(b => b ^ 0xFF))), text);

// Method 2: SZDD's LZSS over a space-filled 4 KiB window. One flag byte of
// literals, then a match that copies from the window's initial spaces.
const lit = Buffer.from('ABCDEFGH');
const lzss = Buffer.concat([Buffer.from([0xFF]), lit,
  Buffer.from([0x00, 0x00, 0x00])]);   // match at 0, length 3
assert.deepStrictEqual(expandKwaj(kwaj(2, lzss), { size: 11 }),
  Buffer.concat([lit, Buffer.from('   ')]));

assert.throws(() => expandKwaj(Buffer.from('SZDD not KWAJ')), /not a KWAJ stream/);
assert.throws(() => expandKwaj(kwaj(4, text)), /method 4 is not supported/);

const IR41 = path.join(__dirname, 'binaries', 'candidates', 'civilization-2-win16',
  'cd', 'VFW_INST', 'IR41.DL_');
if (fs.existsSync(IR41)) {
  // SETUP.INF lists the expanded size; the stream has no end marker.
  const out = expandKwaj(fs.readFileSync(IR41), { size: 774960 });
  assert.strictEqual(out.subarray(0, 2).toString(), 'MZ');
  assert.strictEqual(crypto.createHash('sha256').update(out).digest('hex'),
    '88f156f524064007fb6a5b9e6d71ed47de7caad9033f3fe439c24c8886d99721',
    'IR41.DL_ expands to the Indeo 4 driver byte for byte');
  console.log('PASS KWAJ method 3 expands Civilization II\'s IR41.DL_');
} else {
  console.log('SKIP IR41.DL_ not present');
}
console.log('PASS KWAJ methods 0-2 and header parsing');
