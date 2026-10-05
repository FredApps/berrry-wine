#!/usr/bin/env node
// Microsoft's KWAJ compressed-file form: the *.DL_/*.DR_ files on Video for
// Windows 1.1 setup media (Civilization II's VFW_INST\IR41.DL_), the sibling
// of the SZDD form tools/szdd.js expands.
//
//   node tools/kwaj.js <in.XX_> <out> [--size=N]   expand one file
//   node tools/kwaj.js <in.XX_>                    print the header
//
// Importable: require('./kwaj').expandKwaj(buffer, {size, label}) -> Buffer.
//
// Header: "KWAJ" 88 F0 27 D1, u16 method, u16 data offset, u16 flags, then the
// optional fields the flags name (bit 0: u32 expanded length; bit 1: u16;
// bit 2: u16 n + n bytes; bit 3: NUL-terminated name; bit 4: extension;
// bit 5: u16 n + n bytes of text). The data starts at the stated offset.
//
// Methods: 0 stored, 1 XOR 0xFF, 2 SZDD's LZSS, 3 "LZ+Huffman" (below), 4
// MSZIP (not implemented: nothing in the corpus uses it).
//
// Method 3, as libmspack's kwajd.c decodes it. Bits are read MSB first. Six
// 4-bit table-encoding types come first (the sixth only pads to a byte),
// then five canonical Huffman tables: MATCHLEN1 (16), MATCHLEN2 (16),
// LITLEN (32), OFFSET (64), LITERAL (256). The stream is a sequence of
// matches and literal runs over a 4 KiB window filled with spaces:
//
//   len = huff(litRun ? MATCHLEN2 : MATCHLEN1)
//   len > 0: a match of len+2 bytes at distance huff(OFFSET)<<6 | bits(6)
//   len = 0: a run of huff(LITLEN)+1 literals, each huff(LITERAL); a run of
//            32 may be followed by another run, anything shorter by a match
//
// The stream has no end marker. It ends where the input does, so the
// expanded length comes from the header when flag bit 0 carries it, and
// otherwise from the caller (--size=N; VfW's SETUP.INF lists every size).
'use strict';

const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from([0x4B, 0x57, 0x41, 0x4A, 0x88, 0xF0, 0x27, 0xD1]);

function parseKwajHeader(input, label = 'input') {
  if (input.length < 14 || !input.subarray(0, 8).equals(MAGIC)) {
    throw new Error(`${label} is not a KWAJ stream`);
  }
  const method = input.readUInt16LE(8);
  const dataOffset = input.readUInt16LE(10);
  const flags = input.readUInt16LE(12);
  let p = 14;
  let length = null;
  let name = '';
  if (flags & 0x01) { length = input.readUInt32LE(p); p += 4; }
  if (flags & 0x02) p += 2;
  if (flags & 0x04) p += 2 + input.readUInt16LE(p);
  if (flags & 0x08) { while (p < input.length && input[p]) name += String.fromCharCode(input[p++]); p++; }
  if (flags & 0x10) {
    let ext = '';
    while (p < input.length && input[p]) ext += String.fromCharCode(input[p++]);
    p++;
    if (ext) name += '.' + ext;
  }
  if (dataOffset > input.length) throw new Error(`${label} has a KWAJ data offset past its end`);
  return { method, dataOffset, flags, length, name };
}

// MSB-first bit reader. Past the end it yields zero bits and says so, the
// way kwajd.c pads one zero byte and then stops.
class BitReader {
  constructor(buf, pos) { this.buf = buf; this.pos = pos; this.acc = 0; this.n = 0; this.overrun = 0; }
  bits(count) {
    while (this.n < count) {
      let byte = 0;
      if (this.pos < this.buf.length) byte = this.buf[this.pos++];
      else this.overrun++;
      this.acc = ((this.acc << 8) | byte) >>> 0;
      this.n += 8;
    }
    const value = (this.acc >>> (this.n - count)) & ((1 << count) - 1);
    this.n -= count;
    this.acc &= (1 << this.n) - 1;
    return value;
  }
  get exhausted() { return this.overrun > 0; }
}

function readLengths(br, type, count) {
  const lens = new Uint8Array(count);
  if (type === 0) {
    lens.fill(count === 16 ? 4 : count === 32 ? 5 : count === 64 ? 6 : 8);
  } else if (type === 1) {
    let c = br.bits(4);
    lens[0] = c;
    for (let i = 1; i < count; i++) {
      if (br.bits(1) === 0) lens[i] = c;
      else if (br.bits(1) === 0) lens[i] = ++c;
      else { c = br.bits(4); lens[i] = c; }
    }
  } else if (type === 2) {
    let c = br.bits(4);
    lens[0] = c;
    for (let i = 1; i < count; i++) {
      const sel = br.bits(2);
      if (sel === 3) c = br.bits(4);
      else c = (c + sel - 1) & 0xFF;
      lens[i] = c;
    }
  } else if (type === 3) {
    for (let i = 0; i < count; i++) lens[i] = br.bits(4);
  } else {
    throw new Error(`KWAJ: unknown Huffman table encoding ${type}`);
  }
  return lens;
}

// Canonical code: ordered by length, then by symbol. Decoded one bit at a
// time against per-length first-code/offset tables (16-bit codes at most).
function buildHuffman(lens, label) {
  const counts = new Uint16Array(17);
  for (const l of lens) if (l) counts[l]++;
  const symbols = [];
  for (let l = 1; l <= 16; l++) for (let s = 0; s < lens.length; s++) if (lens[s] === l) symbols.push(s);
  if (!symbols.length) throw new Error(`KWAJ: empty Huffman table (${label})`);
  const first = new Int32Array(17);
  const index = new Int32Array(17);
  let code = 0;
  let idx = 0;
  for (let l = 1; l <= 16; l++) {
    code <<= 1;
    first[l] = code;
    index[l] = idx;
    code += counts[l];
    idx += counts[l];
    if (code > (1 << l)) throw new Error(`KWAJ: oversubscribed Huffman table (${label})`);
  }
  return (br) => {
    let c = 0;
    for (let l = 1; l <= 16; l++) {
      c = (c << 1) | br.bits(1);
      const off = c - first[l];
      if (off >= 0 && off < counts[l]) return symbols[index[l] + off];
    }
    throw new Error(`KWAJ: invalid Huffman code (${label})`);
  };
}

function expandLzh(input, start, size, label) {
  const br = new BitReader(input, start);
  const types = [];
  for (let i = 0; i < 6; i++) types.push(br.bits(4));
  const MATCHLEN1 = buildHuffman(readLengths(br, types[0], 16), `${label} MATCHLEN1`);
  const MATCHLEN2 = buildHuffman(readLengths(br, types[1], 16), `${label} MATCHLEN2`);
  const LITLEN = buildHuffman(readLengths(br, types[2], 32), `${label} LITLEN`);
  const OFFSET = buildHuffman(readLengths(br, types[3], 64), `${label} OFFSET`);
  const LITERAL = buildHuffman(readLengths(br, types[4], 256), `${label} LITERAL`);
  const window = new Uint8Array(4096).fill(0x20);
  const out = [];
  let chunk = Buffer.allocUnsafe(65536);
  let n = 0;
  let total = 0;
  const put = (b) => {
    if (n === chunk.length) { out.push(chunk); chunk = Buffer.allocUnsafe(65536); n = 0; }
    chunk[n++] = b;
    total++;
  };
  let pos = 0;
  let litRun = false;
  const limit = size == null ? Infinity : size;
  while (!br.exhausted && total < limit) {
    let len = (litRun ? MATCHLEN2 : MATCHLEN1)(br);
    if (len > 0) {
      len += 2;
      litRun = false;
      const offset = (OFFSET(br) << 6) | br.bits(6);
      while (len-- > 0) {
        const b = window[(pos + 4096 - offset) & 4095];
        window[pos] = b;
        put(b);
        pos = (pos + 1) & 4095;
      }
    } else {
      len = LITLEN(br) + 1;
      litRun = len !== 32;
      while (len-- > 0) {
        const b = LITERAL(br);
        window[pos] = b;
        put(b);
        pos = (pos + 1) & 4095;
      }
    }
  }
  out.push(chunk.subarray(0, n));
  const all = Buffer.concat(out);
  if (size != null) {
    if (all.length < size) throw new Error(`${label}: KWAJ stream ended at ${all.length} of ${size} bytes`);
    return all.subarray(0, size);
  }
  return all;
}

function expandSzddLz(input, start, size, label) {
  const window = Buffer.alloc(4096, 0x20);
  let wpos = 4096 - 18;
  let p = start;
  const out = [];
  while (p < input.length && (size == null || out.length < size)) {
    const flags = input[p++];
    for (let bit = 0; bit < 8 && p < input.length; bit++) {
      if (flags & (1 << bit)) {
        const b = input[p++];
        out.push(b); window[wpos] = b; wpos = (wpos + 1) & 4095;
      } else {
        if (p + 1 >= input.length) break;
        const lo = input[p++];
        const hi = input[p++];
        let m = lo | ((hi & 0xF0) << 4);
        for (let i = 0; i < (hi & 0x0F) + 3; i++) {
          const b = window[m]; m = (m + 1) & 4095;
          out.push(b); window[wpos] = b; wpos = (wpos + 1) & 4095;
        }
      }
    }
  }
  const buf = Buffer.from(out);
  return size == null ? buf : buf.subarray(0, size);
}

function expandKwaj(input, opts = {}) {
  const label = opts.label || 'input';
  const h = parseKwajHeader(input, label);
  const size = h.length != null ? h.length : (opts.size != null ? opts.size : null);
  const data = input.subarray(h.dataOffset);
  switch (h.method) {
    case 0: return Buffer.from(size == null ? data : data.subarray(0, size));
    case 1: return Buffer.from((size == null ? data : data.subarray(0, size)).map(b => b ^ 0xFF));
    case 2: return expandSzddLz(input, h.dataOffset, size, label);
    case 3: return expandLzh(input, h.dataOffset, size, label);
    default: throw new Error(`${label}: KWAJ method ${h.method} is not supported`);
  }
}

function expandKwajFile(source, destination, opts = {}) {
  const output = expandKwaj(fs.readFileSync(source), { ...opts, label: source });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, output);
  return output.length;
}

module.exports = { expandKwaj, expandKwajFile, parseKwajHeader };

if (require.main === module) {
  const args = process.argv.slice(2);
  const sizeArg = args.find(a => a.startsWith('--size='));
  const [src, dst] = args.filter(a => !a.startsWith('--'));
  if (!src) {
    console.error('usage: node tools/kwaj.js <in.XX_> [out] [--size=N]');
    process.exit(2);
  }
  const size = sizeArg ? Number(sizeArg.slice(7)) : undefined;
  if (dst) {
    console.log(`${dst}: ${expandKwajFile(src, dst, { size })} bytes`);
  } else {
    const h = parseKwajHeader(fs.readFileSync(src), src);
    console.log(`${src}: KWAJ method ${h.method}, data at ${h.dataOffset}, flags 0x${h.flags.toString(16)}` +
      `${h.length != null ? `, ${h.length} bytes expanded` : ', no stored length'}${h.name ? `, name ${h.name}` : ''}`);
  }
}
