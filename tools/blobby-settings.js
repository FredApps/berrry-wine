#!/usr/bin/env node
// Read and write Blobby Volley's settings.dat.
//
//   node tools/blobby-settings.js <file>                    # print it
//   node tools/blobby-settings.js <file> --control=0,2 --keys2=A,D,W --out=F
//
// The format is not documented anywhere; it was read off volley.exe's own
// reader (0x00446420) and writer (0x004469fe), which are field-for-field
// mirrors. docs/re-notes/blobby-volley.md has the full map and the commands
// that produced it. This tool exists so that map lives in code rather than in
// a hexdump somebody has to re-derive: the shipped
// packages/freeware/blobby-volley/settings.dat is produced by it.
//
// Two things the game's own reader does that matter here:
//
//   - It reads incrementally and re-checks Position < Size before four of the
//     groups, so a SHORT file is legal and every field past the cut keeps the
//     compiled-in default. --truncate writes only through the control field.
//   - Its fallback path (0x0044667a) writes control {2, 1} — player one
//     "computer", player two mouse. That is the default a missing file gets,
//     and it is why an unconfigured host's keys look dead.
//
// Control values, read off the per-frame input path:
//   0 keyboard  (0x00444392 -> key-state table at 0x97ce35)
//   1 mouse     (0x004443e3 -> cursor x vs [0x97d220] shr 1)
//   2 computer  (the fallback default above)
//   4 exists and is tested against a coordinate; not identified.

'use strict';

const fs = require('fs');

const SIZE = 117;
const OFF = {
  keys: 0x00,        // 6 dwords: p1 left/right/jump, then p2
  unknown18: 0x18,   // dword
  control: 0x1c,     // 2 dwords, one per player
  unknown24: 0x24,   // byte
  name1: 0x25,       // ShortString[12]
  name2: 0x32,       // ShortString[12]
  unknown3f: 0x3f,   // 4 bytes, written via 0x43e83c([this+0x30])
  unknown43: 0x43,   // ShortString[12]
  unknown50: 0x50,   // dword
  unknown54: 0x54,   // ShortString[30]
  colour1: 0x73,     // byte, index into the 8-entry table at 0x44a2ee
  colour2: 0x74,
};
// The cut after the control field: everything the game will then default.
const TRUNCATED_SIZE = 0x25;

const CONTROL = { keyboard: 0, mouse: 1, computer: 2 };
const COLOUR = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'pink'];

// A VK the game stores for a direction. Letters are their own VK; the arrows
// and a few names are spelled out so a command line stays readable.
const NAMED_VK = {
  LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28,
  SPACE: 0x20, ENTER: 0x0d, SHIFT: 0x10, CTRL: 0x11,
};
function parseVk(text) {
  const s = String(text).trim().toUpperCase().replace(/^VK_/, '');
  if (/^0X[0-9A-F]+$/.test(s)) return parseInt(s, 16);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s in NAMED_VK) return NAMED_VK[s];
  if (/^[A-Z0-9]$/.test(s)) return s.charCodeAt(0);
  throw new Error(`unknown key ${JSON.stringify(text)} — a letter, VK_LEFT, or 0x25`);
}
const vkName = (vk) => {
  for (const [k, v] of Object.entries(NAMED_VK)) if (v === vk) return k;
  if (vk >= 0x30 && vk <= 0x5a) return String.fromCharCode(vk);
  return '0x' + vk.toString(16);
};

// Delphi ShortString: one length byte, then the characters, then padding out
// to the field width. The game writes the whole fixed-width field every time.
function readShortString(buf, off, width) {
  const len = Math.min(buf[off], width - 1);
  return buf.toString('latin1', off + 1, off + 1 + len);
}
function writeShortString(buf, off, width, text) {
  const bytes = Buffer.from(String(text), 'latin1').subarray(0, width - 1);
  buf.fill(0, off, off + width);
  buf[off] = bytes.length;
  bytes.copy(buf, off + 1);
}

function parse(buf) {
  const keys = [];
  for (let i = 0; i < 6; i++) keys.push(buf.readUInt32LE(OFF.keys + i * 4));
  return {
    size: buf.length,
    keys1: keys.slice(0, 3),
    keys2: keys.slice(3, 6),
    unknown18: buf.readUInt32LE(OFF.unknown18),
    control: [buf.readUInt32LE(OFF.control), buf.readUInt32LE(OFF.control + 4)],
    unknown24: buf[OFF.unknown24],
    // Past here the game's reader may have stopped; so may this one.
    name1: buf.length > OFF.name1 ? readShortString(buf, OFF.name1, 13) : null,
    name2: buf.length > OFF.name2 ? readShortString(buf, OFF.name2, 13) : null,
    colour1: buf.length > OFF.colour1 ? buf[OFF.colour1] : null,
    colour2: buf.length > OFF.colour2 ? buf[OFF.colour2] : null,
  };
}

const controlName = (v) =>
  (Object.entries(CONTROL).find(([, n]) => n === v) || [`unknown(${v})`])[0];

function print(file, buf) {
  const s = parse(buf);
  const keyRow = (ks) => ks.map(vkName).join(' ');
  console.log(`${file}  (${s.size} bytes${s.size === SIZE ? '' : ', TRUNCATED'})`);
  console.log(`  player 1   keys ${keyRow(s.keys1).padEnd(14)} control ${controlName(s.control[0])}`
    + `${s.colour1 === null ? '' : `  colour ${COLOUR[s.colour1] || s.colour1}`}`
    + `${s.name1 === null ? '' : `  name ${JSON.stringify(s.name1)}`}`);
  console.log(`  player 2   keys ${keyRow(s.keys2).padEnd(14)} control ${controlName(s.control[1])}`
    + `${s.colour2 === null ? '' : `  colour ${COLOUR[s.colour2] || s.colour2}`}`
    + `${s.name2 === null ? '' : `  name ${JSON.stringify(s.name2)}`}`);
  console.log(`  unidentified: +0x18=${s.unknown18} +0x24=${s.unknown24}`);
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('usage: blobby-settings.js <settings.dat> [--keys1=A,D,W] '
      + '[--keys2=LEFT,RIGHT,UP] [--control=keyboard,computer] [--colour=0,3] '
      + '[--name1=TEXT] [--name2=TEXT] [--truncate] [--out=FILE]');
    return 2;
  }
  const opt = (name) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit === undefined ? null : hit.slice(name.length + 3);
  };

  let buf = fs.readFileSync(file);
  if (buf.length < TRUNCATED_SIZE) {
    console.error(`${file}: ${buf.length} bytes — too short to hold even the `
      + `control field (needs ${TRUNCATED_SIZE})`);
    return 1;
  }
  buf = Buffer.from(buf);   // a copy; never edit the mapped read in place

  const setKeys = (which, text) => {
    const parts = text.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length !== 3) throw new Error(`--keys${which} needs exactly 3 keys `
      + `(left,right,jump), got ${parts.length}`);
    parts.forEach((p, i) => buf.writeUInt32LE(parseVk(p), OFF.keys + ((which - 1) * 3 + i) * 4));
  };
  if (opt('keys1') !== null) setKeys(1, opt('keys1'));
  if (opt('keys2') !== null) setKeys(2, opt('keys2'));

  if (opt('control') !== null) {
    const parts = opt('control').split(',').map(s => s.trim());
    if (parts.length !== 2) throw new Error('--control needs two values, one per player');
    parts.forEach((p, i) => {
      const v = (p.toLowerCase() in CONTROL) ? CONTROL[p.toLowerCase()] : Number(p);
      if (!Number.isInteger(v)) throw new Error(`bad control ${JSON.stringify(p)}`);
      buf.writeUInt32LE(v, OFF.control + i * 4);
    });
  }
  if (opt('colour') !== null) {
    const parts = opt('colour').split(',').map(s => s.trim());
    if (parts.length !== 2) throw new Error('--colour needs two values, one per player');
    parts.forEach((p, i) => {
      const v = COLOUR.indexOf(p.toLowerCase()) >= 0 ? COLOUR.indexOf(p.toLowerCase()) : Number(p);
      if (!Number.isInteger(v) || v < 0 || v > 7) throw new Error(`bad colour ${JSON.stringify(p)}`);
      buf[(i === 0 ? OFF.colour1 : OFF.colour2)] = v;
    });
  }
  if (opt('name1') !== null) writeShortString(buf, OFF.name1, 13, opt('name1'));
  if (opt('name2') !== null) writeShortString(buf, OFF.name2, 13, opt('name2'));

  const out = opt('out');
  if (out) {
    const written = args.includes('--truncate') ? buf.subarray(0, TRUNCATED_SIZE) : buf;
    fs.writeFileSync(out, written);
    console.log(`wrote ${out} (${written.length} bytes)`);
    print(out, written);
  } else {
    print(file, buf);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv));
  } catch (err) {
    console.error(String(err && err.message || err));
    process.exit(1);
  }
}

module.exports = { parse, OFF, CONTROL, COLOUR, SIZE, TRUNCATED_SIZE };
