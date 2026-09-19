#!/usr/bin/env node
'use strict';

// Semantic and lowering regression for the decoder's CMP + Jcc fusion (H469):
//   cmp r32,r32 / cmp r32,imm32 immediately followed by a short or near Jcc.
// Every condition code is driven through operand pairs that take and fall
// through, the published lazy flags are compared with the x86 CMP flags, and
// the self-loop back edge is checked to remain the unfused pair so the
// loop-idiom matcher still sees it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const EXTRA_WAT = `
  (func (export "test_cf") (result i32) (call $get_cf))
  (func (export "test_zf") (result i32) (call $get_zf))
  (func (export "test_sf") (result i32) (call $get_sf))
  (func (export "test_of") (result i32) (call $get_of))
`;

const H_CMP_R_I32 = 10, H_CMP_R_R = 19, H_JCC_NZ = 312, H_CMP_JCC = 469;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const bytes = new Uint8Array(memory.buffer);
  bytes.set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = ga => (ga - imageBase + guestBase) >>> 0;
  const codeBase = (imageBase + 0x2a00) >>> 0;
  const stack = (imageBase + 0xd00000) >>> 0;
  const view = new DataView(memory.buffer);
  let slot = 0;

  // hist=false leaves the handler histogram off: it counts as a debug
  // facility, and $jcc_end only takes the adjacent fall-through fast path
  // (the $page_ft counter) when none is armed.
  function run(code, regs, withHist = true) {
    const address = (codeBase + slot) >>> 0;
    slot += 0x100;
    bytes.set(Uint8Array.from(code), wa(address));
    view.setUint32(wa(stack), 0, true);
    e.set_eax(regs.eax >>> 0);
    e.set_edx(regs.edx >>> 0);
    e.set_ebx(regs.ebx >>> 0);
    e.set_ecx(0);
    e.set_esp(stack);
    e.reset_handler_hist();
    e.set_handler_hist_enabled(withHist ? 1 : 0);
    e.set_eip(address);
    const ft0 = e.get_page_ft() >>> 0;
    e.run(1000);
    e.set_handler_hist_enabled(0);
    assert.strictEqual(e.get_eip() >>> 0, 0, 'probe returns to sentinel');
    const hist = new Uint32Array(memory.buffer, e.get_handler_hist_base() >>> 0, e.get_handler_hist_count());
    return {
      ecx: e.get_ecx() >>> 0,
      // adjacent fall-throughs taken without a cache lookup ($jcc_end bit 0)
      pageFt: (e.get_page_ft() >>> 0) - ft0,
      cf: e.test_cf(), zf: e.test_zf(), sf: e.test_sf(), of: e.test_of(),
      fused: hist[H_CMP_JCC] >>> 0,
      cmpRI: hist[H_CMP_R_I32] >>> 0,
      cmpRR: hist[H_CMP_R_R] >>> 0,
      jnz: hist[H_JCC_NZ] >>> 0,
    };
  }

  const le32 = v => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  // Jcc taken -> ecx = 0x22222222, fallen through -> ecx = 0x11111111.
  const tail = [
    0xb9, 0x11, 0x11, 0x11, 0x11, // fall: mov ecx,11111111h
    0xeb, 0x05,                   // jmp done
    0xb9, 0x22, 0x22, 0x22, 0x22, // taken: mov ecx,22222222h
    0xc3,
  ];
  const shortJcc = cc => [0x70 | cc, 0x07];
  const nearJcc = cc => [0x0f, 0x80 | cc, 0x07, 0x00, 0x00, 0x00];

  function x86CmpFlags(a, b) {
    a >>>= 0; b >>>= 0;
    const r = (a - b) >>> 0;
    return {
      cf: a < b ? 1 : 0,
      zf: a === b ? 1 : 0,
      sf: r >>> 31,
      of: (((a ^ b) & (a ^ r)) >>> 31),
    };
  }
  function x86Taken(cc, a, b) {
    const f = x86CmpFlags(a, b);
    const pf = (() => { let v = (a - b) & 0xff, p = 1; while (v) { p ^= v & 1; v >>= 1; } return p; })();
    const base = [f.of, f.cf, f.zf, f.cf | f.zf, f.sf, pf, f.sf ^ f.of, f.zf | (f.sf ^ f.of)][cc >> 1];
    return (cc & 1) ? (base ? 0 : 1) : base;
  }

  // Operand pairs that make every condition both take and fall through.
  const pairs = [
    [5, 5], [5, 7], [7, 5], [0x80000000, 1], [1, 0x80000000],
    [0xffffffff, 0], [0, 0xffffffff], [0x7fffffff, 0xffffffff], [0x100, 0x1ff], [0x42, 0x42],
  ];
  let cases = 0;
  for (let cc = 0; cc < 16; cc++) {
    for (const [a, b] of pairs) {
      const forms = [
        { name: 'cmp eax,edx (39)', code: [0x39, 0xd0], regs: { eax: a, edx: b, ebx: 0 }, rr: true },
        { name: 'cmp eax,edx (3B)', code: [0x3b, 0xc2], regs: { eax: a, edx: b, ebx: 0 }, rr: true },
        { name: 'cmp eax,imm32 (3D)', code: [0x3d, ...le32(b)], regs: { eax: a, edx: 0, ebx: 0 }, rr: false },
        { name: 'cmp ebx,imm32 (81 /7)', code: [0x81, 0xfb, ...le32(b)], regs: { eax: 0, edx: 0, ebx: a }, rr: false },
      ];
      if ((b | 0) >= -128 && (b | 0) <= 127) {
        forms.push({ name: 'cmp edx,imm8 (83 /7)', code: [0x83, 0xfa, b & 0xff], regs: { eax: 0, edx: a, ebx: 0 }, rr: false });
      }
      for (const form of forms) {
        for (const [jname, jcc] of [['short', shortJcc(cc)], ['near', nearJcc(cc)]]) {
          const r = run([...form.code, ...jcc, ...tail], form.regs);
          const label = `${form.name} + ${jname} Jcc cc=${cc} a=${a.toString(16)} b=${b.toString(16)}`;
          assert.strictEqual(r.ecx, x86Taken(cc, a, b) ? 0x22222222 : 0x11111111, `branch outcome: ${label}`);
          assert.deepStrictEqual({ cf: r.cf, zf: r.zf, sf: r.sf, of: r.of }, x86CmpFlags(a, b), `flags after: ${label}`);
          assert.strictEqual(r.fused, 1, `lowers to H469: ${label}`);
          assert.strictEqual(r.cmpRI + r.cmpRR, 0, `no separate CMP handler: ${label}`);
          cases++;
        }
      }
    }
  }

  // The not-taken successor is the next x86 byte, so $decode_run chains it
  // and a fallen-through fused branch must ride $jcc_end's adjacent fast path
  // exactly as a plain Jcc does; a taken one must not. Both layouts (with and
  // without the imm32 word) put the control word where $decode_run marks it.
  for (const [name, code, regs] of [
    ['cmp eax,edx / jne fall', [0x39, 0xd0, ...shortJcc(5), ...tail], { eax: 5, edx: 5, ebx: 0 }],
    ['cmp eax,edx / jne taken', [0x39, 0xd0, ...shortJcc(5), ...tail], { eax: 5, edx: 6, ebx: 0 }],
    ['cmp ebx,imm32 / jl fall', [0x81, 0xfb, ...le32(9), ...nearJcc(0xc), ...tail], { eax: 0, edx: 0, ebx: 9 }],
    ['cmp ebx,imm32 / jl taken', [0x81, 0xfb, ...le32(9), ...nearJcc(0xc), ...tail], { eax: 0, edx: 0, ebx: 3 }],
  ]) {
    const r = run(code, regs, false);
    const taken = r.ecx === 0x22222222;
    assert.strictEqual(taken, /taken/.test(name), `outcome: ${name}`);
    assert.strictEqual(r.pageFt, taken ? 0 : 1, `adjacent fall-through fast path: ${name}`);
  }

  // A self-loop back edge stays the unfused pair: inc ecx / cmp eax,edx / jnz
  // back to the inc. eax == edx so it runs once and falls through.
  const selfLoop = [0x41, 0x39, 0xd0, 0x75, 0xfb, 0xc3];
  const r = run(selfLoop, { eax: 9, edx: 9, ebx: 0 });
  assert.strictEqual(r.ecx, 1, 'self-loop body ran once');
  assert.strictEqual(r.fused, 0, 'self-loop back edge is not fused');
  assert.strictEqual(r.cmpRR, 1, 'self-loop keeps the separate CMP r,r');
  assert.strictEqual(r.jnz, 1, 'self-loop keeps the separate JNZ');

  console.log(`PASS  CMP+Jcc fusion: ${cases} fused cases agree with x86 branch and flag semantics; self-loop back edge unfused`);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
