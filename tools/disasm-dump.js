#!/usr/bin/env node
// Disassemble guest memory captured by a run.js hexdump.
//
//   node tools/disasm-dump.js <run.js log> [--addr=0xVA] [--nth=N] [--count=N] [--list]
//
// Unpacked, decrypted or runtime-generated code exists only in the emulator's
// memory, so tools/disasm_fn.js (which reads the PE on disk) shows ciphertext
// for it. Capture the bytes with `--input=B:dump-mem:0xVA:LEN` (or `--dump=`)
// and point this at the log: every `Hexdump 0x… (N bytes):` region is decoded
// from its own base address, so branch targets print as real guest VAs.
//
// --addr   start inside a region at this VA instead of at its base
// --nth    which dump of that region to use when a log holds several (default: last)
// --count  instruction limit per region (default: until the bytes run out)
// --list   print the regions found and stop

const fs = require('fs');
const { disasmAt } = require('./disasm');

const args = process.argv.slice(2);
const usage = msg => {
  if (msg) console.error(`disasm-dump: ${msg}`);
  console.error('usage: node tools/disasm-dump.js <run.js log> [--addr=0xVA] [--nth=N] [--count=N] [--list]');
  process.exit(2);
};
const opt = name => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
};

const file = args.find(a => !a.startsWith('--'));
if (!file) usage('no input file');
if (!fs.existsSync(file)) usage(`no such file: ${file}`);

// Same region grammar tools/dump2png.js parses: the banner, then indented
// `  0xADDR  xx xx …` rows until the first line that is not one.
function parseRegions(text) {
  const regions = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const banner = /^Hexdump (0x[0-9a-fA-F]+) \((\d+) bytes\):/.exec(line);
    if (banner) {
      cur = { addr: parseInt(banner[1], 16) >>> 0, bytes: [] };
      regions.push(cur);
      continue;
    }
    if (!cur) continue;
    const row = /^\s{2}0x[0-9a-fA-F]+\s{2}((?:[0-9a-fA-F]{2} )+)/.exec(line);
    if (!row) { cur = null; continue; }
    for (const b of row[1].trim().split(/\s+/)) cur.bytes.push(parseInt(b, 16));
  }
  return regions;
}

const regions = parseRegions(fs.readFileSync(file, 'utf8'));
if (!regions.length) usage(`no "Hexdump 0x… (N bytes):" region in ${file}`);
const hex = v => '0x' + (v >>> 0).toString(16);

if (args.includes('--list')) {
  for (const r of regions) console.log(`${hex(r.addr)}  ${r.bytes.length} bytes`);
  process.exit(0);
}

const addr = opt('addr') !== undefined ? parseInt(opt('addr'), 16) >>> 0 : undefined;
const count = opt('count') !== undefined ? +opt('count') : Infinity;

let chosen = regions;
if (addr !== undefined) {
  chosen = regions.filter(r => addr >= r.addr && addr < r.addr + r.bytes.length);
  if (!chosen.length) usage(`no dumped region contains ${hex(addr)}`);
  const nth = opt('nth') !== undefined ? +opt('nth') : chosen.length - 1;
  if (!(nth >= 0 && nth < chosen.length)) usage(`--nth=${nth} but ${chosen.length} dump(s) contain ${hex(addr)}`);
  chosen = [chosen[nth]];
}

for (const r of chosen) {
  const buf = Buffer.from(r.bytes);
  const start = addr !== undefined ? addr - r.addr : 0;
  console.log(`--- ${hex(r.addr + start)} (${r.bytes.length - start} bytes dumped) ---`);
  let off = start;
  let n = 0;
  // disasmAt decodes a fixed count and cannot report how far it read, so walk
  // one instruction at a time and take each length from the next line's VA.
  while (off < buf.length && n < count) {
    let line;
    try {
      line = disasmAt(buf, off, r.addr + off, 2)[0];
      const next = disasmAt(buf, off, r.addr + off, 2)[1];
      const len = next ? (parseInt(next, 16) - (r.addr + off)) : buf.length - off;
      if (!(len > 0) || off + len > buf.length) { console.log(line + '    ; (runs past the dump)'); break; }
      console.log(line);
      off += len;
    } catch (e) {
      console.log(`${(r.addr + off).toString(16).padStart(8, '0')}  ; decode stopped: bytes ran out`);
      break;
    }
    n++;
  }
}
