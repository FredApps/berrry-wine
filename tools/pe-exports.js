#!/usr/bin/env node
// ASCII tl;dr
//
//   a PE  --> export directory --> one row per export
//                                    ordinal, VA, name (or "(by ordinal)")
//
//   node tools/pe-exports.js <pe> [--ordinal=N,...] [--name=SUBSTR] [--json]
//
// Why this exists: tools/pe-imports.js prints an import as "ordinal 359" when
// the importer binds by ordinal, which is what Game.dll does for every call
// into War3Demo.exe -- 300-odd of them. Without the other half of that pair
// there is no way to turn a traced call site into a function address, and the
// alternative is re-deriving the export directory by hand in a throwaway
// script every time. Forwarded exports (a string inside the directory instead
// of code) are printed as "-> dll.Name" rather than as a bogus VA.
const { readPE } = require('../lib/pe');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node tools/pe-exports.js <pe> [--ordinal=N,..] [--name=SUBSTR] [--json]'); process.exit(2); }
const opt = n => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const wantOrd = (opt('ordinal') || '').split(',').filter(Boolean).map(Number);
const wantName = opt('name');
const asJson = args.includes('--json');

const pe = readPE(file);
const { buf, imageBase } = pe;
const peOff = buf.readUInt32LE(0x3c);
const magic = buf.readUInt16LE(peOff + 0x18);
const dirOff = peOff + 0x18 + (magic === 0x20b ? 112 : 96);
const expRva = buf.readUInt32LE(dirOff);
const expSize = buf.readUInt32LE(dirOff + 4);
if (!expRva) { console.error('no export directory'); process.exit(1); }

const at = rva => pe.va2off(imageBase + rva);
const d = at(expRva);
const ordinalBase = buf.readUInt32LE(d + 16);
const nFuncs = buf.readUInt32LE(d + 20);
const nNames = buf.readUInt32LE(d + 24);
const addrRva = buf.readUInt32LE(d + 28);
const nameRva = buf.readUInt32LE(d + 32);
const ordRva = buf.readUInt32LE(d + 36);

// name table -> ordinal index, so the by-ordinal rows can still carry a name
const byIndex = new Map();
for (let i = 0; i < nNames; i++) {
  const nrva = buf.readUInt32LE(at(nameRva) + i * 4);
  const idx = buf.readUInt16LE(at(ordRva) + i * 2);
  let p = at(nrva), s = '';
  while (buf[p]) s += String.fromCharCode(buf[p++]);
  byIndex.set(idx, s);
}

const rows = [];
for (let i = 0; i < nFuncs; i++) {
  const frva = buf.readUInt32LE(at(addrRva) + i * 4);
  if (!frva) continue;                       // hole in the ordinal space
  const ordinal = ordinalBase + i;
  // A forwarder's "address" points back inside the export directory itself.
  const forwarded = frva >= expRva && frva < expRva + expSize;
  let target = '';
  if (forwarded) { let p = at(frva); while (buf[p]) target += String.fromCharCode(buf[p++]); }
  rows.push({ ordinal, va: forwarded ? 0 : imageBase + frva, name: byIndex.get(i) || null, forward: forwarded ? target : null });
}

let out = rows;
if (wantOrd.length) out = out.filter(r => wantOrd.includes(r.ordinal));
if (wantName) out = out.filter(r => r.name && r.name.toLowerCase().includes(wantName.toLowerCase()));
if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const hex = v => '0x' + (v >>> 0).toString(16).padStart(8, '0');
console.log(`${file}  imageBase=${hex(imageBase)}  ${rows.length} exports (ordinal base ${ordinalBase})`);
for (const r of out) {
  console.log(`  ordinal ${String(r.ordinal).padStart(5)}  ${r.forward ? '-> ' + r.forward : hex(r.va)}  ${r.name || '(by ordinal)'}`);
}
