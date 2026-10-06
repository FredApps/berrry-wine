#!/usr/bin/env node
'use strict';
// Handlers 500/501: the MSVC CRT's assembly _stricmp, folded -- 501 a whole
// C-locale call at the function entry, 500 the compare loop alone (entered
// when a string outruns 501's per-dispatch cap).
//
// The function below is the real thing, byte for byte, from Comanche Gold's
// demo.exe (0x4e0be0, the static CRT; 51 of 54 copies in a test/binaries
// sample share its shape). It runs once with the folds and once without
// (--no-fold bit 0x100) on the same string pairs, through a driver that ends
// in pushfd, so every register, the flags and the stack below ESP must agree
// between the two arms -- and EAX with the C-locale definition. Its locale
// test (lea eax,[__lc_handle]; cmp [eax+8],0) is pointed at a word we own:
// zero selects the folded C-locale loop, nonzero the locale-aware path, which
// calls a helper at +0x90 that we supply as the identity (so that path is a
// plain case-sensitive compare, and must run unfolded in both arms).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require(path.join(__dirname, '..', 'lib/host-imports'));
const RegionMap = require('../lib/region-map.generated.js');

const STRICMP = Buffer.from(
  '558bec5756538b750c8b7d088d05e8754e0083780800753bb0ff8bc00ac0742e8a06468a2747' +
  '38c474f22c413c1a1ac980e12002c1044186e02c413c1a1ac980e12002c1044138e074d21ac0' +
  '1cff0fbec0eb34b8ff00000033db8bc00ac074278a06468a1f4738d874f25053e81f0000008b' +
  'd883c404e81500000083c40438c374da1bc083d8ff5b5e5fc9c3', 'hex');
const LC_IMM = 0x0e;   // lea eax,[imm32] -- the locale word's address
const HELPER = 0x90;   // both calls on the locale-aware path land here
const IDENTITY = [0x8B, 0x44, 0x24, 0x04, 0xC3];  // mov eax,[esp+4] / ret
const FLAGS = 0x8D5;   // CF PF AF ZF SF OF

// C-locale _stricmp: fold A-Z to a-z, compare bytes unsigned.
const fold = b => (b >= 0x41 && b <= 0x5a ? b + 0x20 : b);
function reference(a, b, f = fold) {
  for (let i = 0; ; i++) {
    const x = f(a[i] || 0), y = f(b[i] || 0);
    if (x !== y) return x < y ? -1 : 1;
    if (!x) return 0;
  }
}

(async () => {
  const ROOT = path.join(__dirname, '..');
  const wasmBytes = fs.readFileSync(process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm'));
  const exeBytes = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const h = createHostImports(ctx).host;
  Object.assign(h, { memory, exit() {}, log() {}, log_i32() {}, crash_unimplemented() {}, wait_multiple: () => 0 });
  const { instance } = await WebAssembly.instantiate(wasmBytes, { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const mem = new Uint8Array(e.memory.buffer);
  mem.set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);
  const base = e.get_image_base();
  const wa = a => RegionMap.g2w(a, base);
  const dv = () => new DataView(e.memory.buffer);
  const w32 = (a, v) => dv().setUint32(wa(a), v >>> 0, true);
  const r32 = a => dv().getUint32(wa(a), true);
  const imm = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

  const lcWord = base + 0x3f00;           // [lcWord+8]: 0 = the C locale
  const s1 = base + 0x5000, s2 = base + 0x9000; // 16 KB apart: room for 9000-byte cases
  // A copy of the CRT plus a driver: push s2 / push s1 / call fn / add esp,8 /
  // pushfd / pop edx / ret. Distinct copies, so each arm decodes its own blocks.
  const copyAt = (addr, variant) => {
    const fn = addr + 0x40;
    for (let i = 0; i < STRICMP.length; i++) mem[wa(fn) + i] = STRICMP[i];
    if (variant === 'movedi') mem[wa(fn) + 0x1b] = 0xFF;   // mov edi,edi
    w32(fn + LC_IMM, lcWord);
    for (let i = 0; i < IDENTITY.length; i++) mem[wa(fn + HELPER) + i] = IDENTITY[i];
    const drv = [0x68, ...imm(s2), 0x68, ...imm(s1), 0xE8, ...imm(fn - (addr + 15)),
      0x83, 0xC4, 0x08, 0x9C, 0x5A, 0xC3];
    for (let i = 0; i < drv.length; i++) mem[wa(addr) + i] = drv[i];
    return addr;
  };
  const arms = {
    folded: copyAt(base + 0x3000), plain: copyAt(base + 0x3200),
    foldedEdi: copyAt(base + 0x3400, 'movedi'), plainEdi: copyAt(base + 0x3600, 'movedi'),
  };
  const stackTop = base + 0xD00000;
  const call = (drv, a, b) => {
    mem.set(Uint8Array.from([...a, 0]), wa(s1));
    mem.set(Uint8Array.from([...b, 0]), wa(s2));
    for (let i = -64; i < 0; i += 4) w32(stackTop + i, 0xDEAD0000 + i);
    e.set_esp(stackTop - 4);
    w32(stackTop - 4, 0);                 // the driver returns to 0: the run stops there
    e.set_eax(0x11112222); e.set_ecx(0x3333AA44); e.set_ebx(0x55556666);
    e.set_esi(0x77778888); e.set_edi(0x9999BBBB); e.set_ebp(0xCCCCDDDD);
    e.set_eip(drv);
    e.run(2000000);
    assert.strictEqual(e.get_eip(), 0, 'the call returns');
    const below = [];
    // Return addresses differ per copy; name them by offset in the copy.
    for (let i = -48; i < -4; i += 4) {
      const v = r32(stackTop + i);
      below.push(v >= drv && v < drv + 0x200 ? `code+${(v - drv).toString(16)}` : v);
    }
    return {
      eax: e.get_eax() | 0, ecx: e.get_ecx() >>> 0, ebx: e.get_ebx() >>> 0,
      esi: e.get_esi() >>> 0, edi: e.get_edi() >>> 0, ebp: e.get_ebp() >>> 0,
      esp: e.get_esp() >>> 0, flags: (e.get_edx() & FLAGS) >>> 0, below: below.join(','),
    };
  };

  const ascii = s => Array.from(s, c => c.charCodeAt(0));
  const long = n => Array.from({ length: n }, (_, i) => 0x61 + (i % 26));
  const cases = [
    ['', ''], ['a', ''], ['', 'a'], ['abc', 'abc'], ['ABC', 'abc'], ['abc', 'ABD'],
    ['Zebra', 'zEBRA'], ['apple', 'Apples'], ['@', '`'], ['[', 'a'], ['_', 'Z'],
    ['A', '['], ['data\\cgold.pff', 'DATA\\CGOLD.PFF'], ['MAP01.VOX', 'map02.vox'],
  ].map(([a, b]) => [ascii(a), ascii(b)]);
  cases.push([[0x80, 0x41], [0x80, 0x61]], [[0xff], [0x41]], [[0x41], [0xff]], [[0xc9], [0xe9]]);
  // Longer than one dispatch's 4096-byte cap: 501 hands over to 500 at the head.
  cases.push([long(9000), long(9000)], [long(9000), [...long(8999), 0x41]],
             [[...long(5000), 0x5a], [...long(5000), 0x7b]]);

  const label = (a, b) => `${JSON.stringify(Buffer.from(a).toString('latin1').slice(0, 16))} vs ` +
    `${JSON.stringify(Buffer.from(b).toString('latin1').slice(0, 16))} (len ${a.length}/${b.length})`;
  const both = (onDrv, offDrv, a, b, want, what) => {
    e.set_fold_off_mask(0);
    const f = call(onDrv, a, b);
    e.set_fold_off_mask(0x100);
    const p = call(offDrv, a, b);
    assert.strictEqual(p.eax, want, `unfolded CRT agrees with the reference (${what}): ${label(a, b)}`);
    assert.deepStrictEqual(f, p, `folded state == unfolded state (${what}): ${label(a, b)}`);
  };

  w32(lcWord + 8, 0);
  for (const [a, b] of cases) both(arms.folded, arms.plain, a, b, reference(a, b), 'C locale');
  for (const [a, b] of cases.slice(0, 14)) both(arms.foldedEdi, arms.plainEdi, a, b, reference(a, b), 'mov edi,edi');
  const callsC = e.get_crt_stricmp_calls();
  assert.ok(callsC >= 14 + 14 + 3, `501 folded whole calls (${callsC})`);
  assert.ok(e.get_crt_stricmp_runs() > callsC, '500 ran too: the long cases resumed at the head');

  // A set LC_CTYPE: the fold runs the prologue only and leaves for the
  // locale-aware path, which (with our identity helper) compares exactly.
  w32(lcWord + 8, 1);
  for (const [a, b] of cases.slice(0, 18)) both(arms.folded, arms.plain, a, b, reference(a, b, x => x), 'locale set');
  assert.strictEqual(e.get_crt_stricmp_calls(), callsC, 'no whole-call fold under a set locale');

  console.log(`ok: ${cases.length} pairs in the C locale, 14 with mov edi,edi, 18 under a set locale; ` +
    `folded == unfolded in every register, flag and stack slot (${callsC} whole calls folded, ` +
    `${e.get_crt_stricmp_matches()} matches)`);
  console.log('PASS test-crt-stricmp-fold');
})().catch(err => { console.error(err); process.exit(1); });
