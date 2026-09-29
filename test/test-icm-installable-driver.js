#!/usr/bin/env node
'use strict';
// A Video for Windows installable codec driver, loaded and driven the way
// Windows does it -- with a synthetic driver, so nothing licensed is needed.
//
// For a fourcc no built-in decoder claims, ICOpen goes to SYSTEM.INI
// [drivers32] VIDC.XXXX, loads that DLL, and talks to its exported
// DriverProc as nested guest calls (src/09a7g-video-icm.wat). This builds two
// tiny PEs in a temp dir:
//
//   xtst32.dll  DriverProc(id, hdrv, msg, p1, p2): logs every msg into a
//               table in the EXE's data, answers DRV_OPEN only for an ICOPEN
//               that names vidc/XTST, fills ICINFO for ICM_GETINFO, returns
//               p1+p2+id for a private 0x7001, and tail-jumps DefDriverProc
//               for anything else (DRV_CONFIGURE here);
//   xtest.exe   ICInfo, ICOpen, ICGetInfo, ICSendMessage x2, ICClose,
//               storing each result, then ExitProcess(0);
//
// mounts the DLL and a SYSTEM.INI naming it through an --overlay-dir, runs the
// EXE, and reads both the results and the driver's message log back out with
// --dump. The message order is the Windows one: DRV_LOAD, DRV_ENABLE,
// DRV_OPEN, the ICM traffic, DRV_CLOSE, then DRV_DISABLE and DRV_FREE on the
// last close.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');

const fcc = (s) => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | ((s.charCodeAt(3) << 24) >>> 0);
const d32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
const VIDC = fcc('vidc');
const XTST = fcc('XTST');
const DRV_ID = 0xD1D0;

// ---- a one-section PE writer ------------------------------------------
// Everything lives in one RWX section at RVA 0x1000 (file offset 0x200).
// `imports` is [[dll, [names...]], ...]; returns the IAT slot RVA per name.
function buildPe({ dll, imageBase, entryRva, code, codeRva = 0x1000, imports = [], exportName = null,
                   exportRva = 0, extra = [] }) {
  const SECT = 0x1000, RAW = 0x200, VSIZE = 0x3000;
  const img = Buffer.alloc(RAW + 0x1000);
  const at = (rva) => RAW + (rva - SECT);
  const iat = {};
  // Imports at RVA 0x1400: descriptors, then per-DLL OFT/IAT/names.
  let impDir = 0, impSize = 0;
  if (imports.length) {
    impDir = 0x1400;
    impSize = (imports.length + 1) * 20;
    let p = impDir + impSize;
    const desc = [];
    for (const [name, funcs] of imports) {
      const oft = p; p += (funcs.length + 1) * 4;
      const ft = p; p += (funcs.length + 1) * 4;
      desc.push({ name, funcs, oft, ft });
    }
    for (const d of desc) {
      d.nameRva = p; img.write(d.name + '\0', at(p), 'ascii'); p += d.name.length + 1;
      d.funcs.forEach((f, i) => {
        p = (p + 1) & ~1;
        img.writeUInt16LE(0, at(p));
        img.write(f + '\0', at(p) + 2, 'ascii');
        img.writeUInt32LE(p, at(d.oft) + i * 4);
        img.writeUInt32LE(p, at(d.ft) + i * 4);
        iat[f] = d.ft + i * 4;
        p += 2 + f.length + 1;
      });
    }
    desc.forEach((d, i) => {
      const o = at(impDir) + i * 20;
      img.writeUInt32LE(d.oft, o);
      img.writeUInt32LE(d.nameRva, o + 12);
      img.writeUInt32LE(d.ft, o + 16);
    });
    assert(p < 0x1600, 'import tables overflow');
  }
  // Export directory at RVA 0x1600: one named function.
  let expDir = 0, expSize = 0;
  if (exportName) {
    expDir = 0x1600; expSize = 0x80;
    const e = at(expDir);
    img.writeUInt32LE(expDir + 0x40, e + 12);       // Name
    img.writeUInt32LE(1, e + 16);                    // Base
    img.writeUInt32LE(1, e + 20);                    // NumberOfFunctions
    img.writeUInt32LE(1, e + 24);                    // NumberOfNames
    img.writeUInt32LE(expDir + 0x28, e + 28);        // AddressOfFunctions
    img.writeUInt32LE(expDir + 0x2C, e + 32);        // AddressOfNames
    img.writeUInt32LE(expDir + 0x30, e + 36);        // AddressOfNameOrdinals
    img.writeUInt32LE(exportRva, e + 0x28);
    img.writeUInt32LE(expDir + 0x50, e + 0x2C);
    img.writeUInt16LE(0, e + 0x30);
    img.write(dll + '\0', e + 0x40, 'ascii');
    img.write(exportName + '\0', e + 0x50, 'ascii');
  }
  const bytes = typeof code === 'function' ? code(iat) : code;
  Buffer.from(bytes).copy(img, at(codeRva));
  for (const [rva, b] of extra) Buffer.from(b).copy(img, at(rva));

  const pe = 0x80, opt = pe + 24, sec = opt + 0xE0;
  img.writeUInt16LE(0x5A4D, 0);
  img.writeUInt32LE(pe, 0x3C);
  img.writeUInt32LE(0x00004550, pe);
  img.writeUInt16LE(0x014C, pe + 4);
  img.writeUInt16LE(1, pe + 6);
  img.writeUInt16LE(0xE0, pe + 20);
  img.writeUInt16LE(exportName ? 0x2102 : 0x0102, pe + 22);   // EXECUTABLE | 32BIT (| DLL)
  img.writeUInt16LE(0x010B, opt);
  img.writeUInt32LE(0x1000, opt + 4);
  img.writeUInt32LE(entryRva, opt + 16);
  img.writeUInt32LE(SECT, opt + 20);
  img.writeUInt32LE(imageBase, opt + 28);
  img.writeUInt32LE(0x1000, opt + 32);
  img.writeUInt32LE(0x200, opt + 36);
  img.writeUInt16LE(4, opt + 40);
  img.writeUInt16LE(4, opt + 48);
  img.writeUInt32LE(SECT + VSIZE, opt + 56);
  img.writeUInt32LE(RAW, opt + 60);
  img.writeUInt16LE(2, opt + 68);                               // GUI
  img.writeUInt32LE(0x100000, opt + 72);
  img.writeUInt32LE(0x1000, opt + 76);
  img.writeUInt32LE(0x100000, opt + 80);
  img.writeUInt32LE(0x1000, opt + 84);
  img.writeUInt32LE(16, opt + 92);
  img.writeUInt32LE(expDir, opt + 96);
  img.writeUInt32LE(expSize, opt + 100);
  img.writeUInt32LE(impDir, opt + 104);
  img.writeUInt32LE(impSize, opt + 108);
  img.write('.text\0\0\0', sec, 'ascii');
  img.writeUInt32LE(VSIZE, sec + 8);
  img.writeUInt32LE(SECT, sec + 12);
  img.writeUInt32LE(0x1000, sec + 16);
  img.writeUInt32LE(RAW, sec + 20);
  img.writeUInt32LE(0xE0000060, sec + 36);
  return { img, iat };
}

// ---- a tiny assembler: bytes, {label}, {j: 0x74, to} (rel8) --------------
function asm(items, originRva) {
  const at = new Map();
  let out;
  for (let pass = 0; pass < 2; pass++) {
    out = [];
    for (const it of items) {
      if (typeof it === 'number') { out.push(it); continue; }
      if (Array.isArray(it)) { out.push(...it); continue; }
      if (it.label) { at.set(it.label, out.length); continue; }
      if (it.here) { at.set(it.here, out.length); continue; }
      if (it.j) { const t = at.get(it.to) ?? out.length; out.push(it.j, (t - (out.length + 2)) & 0xFF); continue; }
      if (it.disp) { const v = it.disp(at, originRva); out.push(...d32(v)); continue; }
    }
  }
  return out;
}

// EXE data (image base 0x400000): results from 0x401800, the driver's message
// log count at 0x4018FC and entries from 0x401900, ICINFO buffers at 0x402000
// (ICInfo) and 0x402400 (ICGetInfo).
const RES = 0x401800, LOGN = 0x4018FC, LOG = 0x401900, INFO1 = 0x402000, INFO2 = 0x402400;

function buildDriver() {
  const code = (iat) => asm([
    // DllMain: TRUE
    0xB8, ...d32(1), 0xC2, 0x0C, 0x00,
    ...new Array(8).fill(0x90),
    { label: 'proc' },                                      // RVA 0x1010
    0x8B, 0x44, 0x24, 0x0C,                                 // mov eax,[esp+12]  msg
    0x8B, 0x0D, ...d32(LOGN),                               // mov ecx,[LOGN]
    0x89, 0x04, 0x8D, ...d32(LOG),                          // mov [ecx*4+LOG],eax
    0x41,                                                   // inc ecx
    0x89, 0x0D, ...d32(LOGN),                               // mov [LOGN],ecx
    0x3D, ...d32(3), { j: 0x74, to: 'open' },
    0x3D, ...d32(0x5002), { j: 0x74, to: 'getinfo' },
    0x3D, ...d32(0x7001), { j: 0x74, to: 'custom' },
    0x83, 0xF8, 0x06, { j: 0x76, to: 'one' },               // DRV_LOAD..DRV_FREE
    // Anything else: DefDriverProc, reached position-independently.
    0xE8, ...d32(0),                                        // call $+5
    { here: 'pop' }, 0x5A,                                  // pop edx
    0xFF, 0xA2, { disp: (at, org) => iat.DefDriverProc - (org + at.get('pop')) }, // jmp [edx+disp]
    { label: 'one' }, 0xB8, ...d32(1), 0xC2, 0x14, 0x00,
    { label: 'open' },
    0x8B, 0x44, 0x24, 0x14,                                 // mov eax,[esp+20]  ICOPEN*
    0x81, 0x78, 0x04, ...d32(VIDC), { j: 0x75, to: 'zero' },
    0x81, 0x78, 0x08, ...d32(XTST), { j: 0x75, to: 'zero' },
    0xB8, ...d32(DRV_ID), 0xC2, 0x14, 0x00,
    { label: 'zero' }, 0x31, 0xC0, 0xC2, 0x14, 0x00,
    { label: 'getinfo' },
    0x81, 0x7C, 0x24, 0x04, ...d32(DRV_ID), { j: 0x75, to: 'zero' },   // the instance id came back
    0x8B, 0x44, 0x24, 0x10,                                 // mov eax,[esp+16]  ICINFO*
    0xC7, 0x00, ...d32(568),
    0xC7, 0x40, 0x04, ...d32(VIDC),
    0xC7, 0x40, 0x08, ...d32(XTST),
    0xB8, ...d32(568), 0xC2, 0x14, 0x00,
    { label: 'custom' },
    0x8B, 0x44, 0x24, 0x10, 0x03, 0x44, 0x24, 0x14, 0x03, 0x44, 0x24, 0x04,   // p1 + p2 + id
    0xC2, 0x14, 0x00,
  ], 0x1000);
  return buildPe({ dll: 'xtst32.dll', imageBase: 0x10000000, entryRva: 0x1000, code,
    imports: [['winmm.dll', ['DefDriverProc']]], exportName: 'DriverProc', exportRva: 0x1010 }).img;
}

function buildExe() {
  const call = (iat, f) => [0xFF, 0x15, ...d32(0x400000 + iat[f])];
  const store = (k) => [0xA3, ...d32(RES + 4 * k)];
  const pushHic = [0xFF, 0x35, ...d32(RES + 4)];
  const code = (iat) => [
    0x68, ...d32(INFO1), 0x68, ...d32(XTST), 0x68, ...d32(VIDC), ...call(iat, 'ICInfo'), ...store(0),
    0x6A, 0x02, 0x68, ...d32(XTST), 0x68, ...d32(VIDC), ...call(iat, 'ICOpen'), ...store(1),
    0x68, ...d32(568), 0x68, ...d32(INFO2), ...pushHic, ...call(iat, 'ICGetInfo'), ...store(2),
    0x68, ...d32(0x5678), 0x68, ...d32(0x1234), 0x68, ...d32(0x7001), ...pushHic, ...call(iat, 'ICSendMessage'), ...store(3),
    0x6A, 0x00, 0x6A, 0x00, 0x6A, 0x07, ...pushHic, ...call(iat, 'ICSendMessage'), ...store(4),
    ...pushHic, ...call(iat, 'ICClose'), ...store(5),
    0x6A, 0x00, ...call(iat, 'ExitProcess'),
  ];
  return buildPe({ imageBase: 0x400000, entryRva: 0x1000, code,
    imports: [['msvfw32.dll', ['ICInfo', 'ICOpen', 'ICGetInfo', 'ICSendMessage', 'ICClose']],
              ['kernel32.dll', ['ExitProcess']]] }).img;
}

function writeOverlay(dir, files) {
  fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true });
  const records = files.map(([guest, bytes], i) => {
    const blob = `f${i}.bin`;
    fs.writeFileSync(path.join(dir, 'blobs', blob), bytes);
    return { path: guest, kind: 'file', attrs: 128, size: bytes.length,
             creationTime: null, lastAccessTime: null, lastWriteTime: null, blob };
  });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, records }));
}

function parseDump(out) {
  const mem = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s+0x([0-9a-f]+)\s+((?:[0-9a-f]{2} )+)/i.exec(line);
    if (!m) continue;
    const base = parseInt(m[1], 16);
    m[2].trim().split(/\s+/).forEach((b, i) => mem.set(base + i, parseInt(b, 16)));
  }
  return (a) => ((mem.get(a) | (mem.get(a + 1) << 8) | (mem.get(a + 2) << 16) | (mem.get(a + 3) << 24)) >>> 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-driver-'));
try {
  const exe = path.join(tmp, 'xtest.exe');
  fs.writeFileSync(exe, buildExe());
  const ovl = path.join(tmp, 'overlay');
  writeOverlay(ovl, [
    ['c:\\windows\\system\\xtst32.dll', buildDriver()],
    ['c:\\windows\\system.ini', Buffer.from('[drivers32]\r\nVIDC.XTST=xtst32.dll\r\n', 'ascii')],
  ]);
  let out;
  try {
    out = execFileSync('node', [RUN, `--exe=${exe}`, `--overlay-dir=${ovl}`, '--no-build', '--quiet-api',
      '--max-batches=400', '--max-seconds=40',
      `--dump=0x${RES.toString(16)}:512,0x${(INFO1 + 312).toString(16)}:32,0x${INFO2.toString(16)}:16`],
      { cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    out = String(err.stdout || '') + String(err.stderr || '');
    console.log(out.split('\n').slice(-40).join('\n'));
    throw new Error('run.js failed');
  }
  const rd = parseDump(out);
  const fail = (msg) => { console.log(out.split('\n').filter((l) => !/^\[\d+\] EIP/.test(l)).slice(-30).join('\n')); assert.fail(msg); };
  if (!/\[Exit\] code=0/.test(out)) fail('the program did not reach ExitProcess(0)');

  const r = (k) => rd(RES + 4 * k);
  const hex = (v) => '0x' + (v >>> 0).toString(16);
  if (r(0) !== 1) fail(`ICInfo from the SYSTEM.INI registration returned ${hex(r(0))}`);
  const drvName = Buffer.from([...Array(20).keys()].map((i) => rd(INFO1 + 312 + (i & ~3)) >>> (8 * (i & 3)) & 0xFF))
    .toString('utf16le').replace(/\0.*$/, '');
  if (drvName.toLowerCase() !== 'xtst32.dll') fail(`ICInfo szDriver is "${drvName}"`);
  if (!r(1)) fail('ICOpen through the installed driver returned no HIC');
  if (r(2) !== 568) fail(`ICGetInfo returned ${hex(r(2))}, want the driver's 568`);
  if (rd(INFO2 + 8) !== XTST) fail('ICGetInfo did not reach the driver\'s ICINFO fill');
  if (r(3) !== 0x1234 + 0x5678 + DRV_ID) fail(`ICSendMessage 0x7001 returned ${hex(r(3))}: args or instance id lost`);
  if (r(4) !== 1) fail(`DRV_CONFIGURE through DefDriverProc returned ${hex(r(4))}, want DRVCNF_OK`);
  if (r(5) !== 0) fail(`ICClose returned ${hex(r(5))}`);

  const n = rd(LOGN);
  const log = [...Array(n).keys()].map((i) => rd(LOG + 4 * i));
  const want = [1, 2, 3, 0x5002, 0x7001, 7, 4, 5, 6];
  assert.deepStrictEqual(log.map(hex), want.map(hex), 'DriverProc message order');
  console.log(`PASS  installable ICM driver: LoadLibrary via SYSTEM.INI, DriverProc ${log.map(hex).join(' ')}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
