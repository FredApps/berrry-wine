#!/usr/bin/env node
'use strict';

// A decode that stops at an already-compiled entry keeps two blocks that share
// a suffix from retiring each other: $decode_block checks $page_probe at the
// top of every instruction. A fusion that consumes the NEXT instruction too
// skips that check for the instruction it swallowed. If that instruction is
// itself a compiled entry, publishing the outer block retires it, the next
// entry there decodes it again and retires the outer one, and the pair
// re-decodes each other for as long as the guest alternates -- with no guest
// write anywhere.
//
// Heroes III spends half its gameplay batches in exactly that: 143,437
// overlap retirements and 0 write retirements on the main instance, every top
// pair an entry sitting right after a `mov r32,[esp/ebp+d]` whose successor is
// another such load (the load-run fold, handler 408). The shapes below are
// the real bytes from heroes3 exe 0x472262 and 0x5a1d19.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

const extraWat = String.raw`
  (func (export "test_sparse_map_for_code") (param $guest i32) (param $size i32) (result i32)
    (call $virtual_map_commit (local.get $guest) (local.get $size)))
  (func (export "test_page_probe") (param $guest i32) (result i32)
    (call $page_probe (local.get $guest)))
  (func (export "test_alpha_runs") (result i32) (global.get $loop_rgb565_alpha_runs))
  (func (export "test_colorkey_runs") (result i32) (global.get $loop_rgb565_colorkey_runs))
  (func (export "test_seed_zf") (param $zero i32)
    (call $set_flags_sub (i32.const 1) (local.get $zero)
      (i32.sub (i32.const 1) (local.get $zero))))
  (func (export "test_uop_try") (param $head i32) (result i32)
    (call $uop_try (local.get $head)))
  (func (export "test_uop_program") (param $head i32) (result i32)
    (call $uop_map_get (local.get $head)))
`;

const le32 = value => [value, value >>> 8, value >>> 16, value >>> 24].map(v => v & 0xff);

const SHAPES = [
  {
    name: 'esp-relative load pair (heroes3 0x472262)',
    // mov ebp,[esp+0x20] / mov edx,[esp+0x48] / mov eax,imm / ret
    prefix: [0x8b, 0x6c, 0x24, 0x20],
    interior: [0x8b, 0x54, 0x24, 0x48],
  },
  {
    name: 'ebp-relative load pair (heroes3 0x5a1d19)',
    // mov ecx,[ebp-8] / mov esi,[ebp-0x10] / mov eax,imm / ret
    prefix: [0x8b, 0x4d, 0xf8],
    interior: [0x8b, 0x75, 0xf0],
  },
];

async function main() {
  const bytes = compileSrcWasm((filename, source) =>
    filename === '13-exports.wat' ? `${source}\n${extraWat}\n` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const context = { exports: null, getMemory: () => memory.buffer };
  const imports = createHostImports(context);
  imports.host.memory = memory;
  imports.host.exit = () => {};
  imports.host.log = () => {};
  imports.host.log_i32 = () => {};
  imports.host.crash_unimplemented = () => {};
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  context.exports = instance.exports;
  const e = instance.exports;

  const exe = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  new Uint8Array(memory.buffer).set(exe, e.get_staging());
  e.load_pe(exe.length);
  const stack = (e.get_image_base() + 0xd00000) >>> 0;

  let page = 0x4ff80000;
  for (const shape of SHAPES) {
    const code = page;
    page += 0x1000;
    assert.strictEqual(e.test_sparse_map_for_code(code, 0x1000) >>> 0, code);
    const marker = 0x13572468;
    [...shape.prefix, ...shape.interior, 0xb8, ...le32(marker), 0xc3]
      .forEach((byte, i) => e.guest_write8(code + i, byte));
    const interior = code + shape.prefix.length;

    const execute = entry => {
      e.set_esp(stack);
      e.guest_write32(stack, 0);
      e.set_ebp(stack + 0x40);
      e.set_eip(entry);
      e.run(1000);
      assert.strictEqual(e.get_eip() >>> 0, 0, `${shape.name}: returns to the sentinel`);
      assert.strictEqual(e.get_eax() >>> 0, marker, `${shape.name}: runs to the end`);
    };

    // Interior first, as a game does: the loop body is compiled before the
    // entry that falls into it from above.
    execute(interior);
    execute(code);
    const retires0 = e.get_page_retires() >>> 0;
    for (let i = 0; i < 8; i++) {
      execute(interior);
      execute(code);
    }
    assert.strictEqual(e.test_page_probe(code), 1, `${shape.name}: outer entry stays compiled`);
    assert.strictEqual(e.test_page_probe(interior), 1, `${shape.name}: interior entry stays compiled`);
    assert.strictEqual((e.get_page_retires() >>> 0) - retires0, 0,
      `${shape.name}: alternating entries must not retire each other`);
  }
  // Authentic MW3 RGB565 loop (0x528064): micro-op side exits can enter its
  // opaque or blended store independently of the native whole-loop fold.
  const alphaLoop = Buffer.from(
    '8b4d0c8a0980f9030f868500000080f9fc7209668b0c38668908eb77' +
    '0fbf300fbf14388bf98bca8bc681e100f800002500f800008bde2bc88bc2' +
    '25e007000081e3e007000081e7ff0000002bc30fafc70fafcfc1f808c1f908' +
    '24e081e100f8ffffa90000008074040c20eb0224df03f183e21f8bce8b5df4' +
    '83e11f2bd10fafd78b7de4c1fa0803d08b45e003f28b55ec668930' +
    '8b750c8b4de883c00246498945e089750c894de80f8553ffffff', 'hex');
  assert.strictEqual(alphaLoop.length, 0xad);
  e.set_loop_copy_emit(1);
  for (const offset of [0x17, 0x90]) {
    const code = page;
    page += 0x1000;
    assert.strictEqual(e.test_sparse_map_for_code(code, 0x1000) >>> 0, code);
    [...alphaLoop, 0xc3].forEach((byte, i) => e.guest_write8(code + i, byte));
    const bp = stack + 0x100, dst = stack + 0x200, src = stack + 0x220, alpha = stack + 0x240;
    const execute = entry => {
      e.set_esp(stack); e.guest_write32(stack, 0); e.set_ebp(bp);
      e.set_eax(dst); e.set_ecx(0x5aa5); e.set_esi(0x5aa5); e.set_edi(src - dst);
      e.guest_write32(bp - 0x20, dst); e.guest_write32(bp + 12, alpha);
      e.guest_write32(bp - 0x18, 1); e.guest_write32(bp - 0x1c, src - dst);
      e.guest_write32(src, 0x5aa5); e.guest_write32(dst, 0); e.guest_write8(alpha, 255);
      e.set_eip(entry); e.run(1000);
      assert.strictEqual(e.get_eip() >>> 0, 0, 'alpha row returns');
      assert.strictEqual(new DataView(memory.buffer).getUint16(e.guest_to_wasm(dst), true), 0x5aa5,
        'whole-loop and interior-store entries produce the same pixel');
    };
    const runs = e.test_alpha_runs();
    execute(code);
    assert(e.test_alpha_runs() > runs, 'cold row still uses the native alpha fold');
    execute(code + offset);
    execute(code);
    for (let n = 0; n < 16; n++) { execute(code + offset); execute(code); }
    const retires = e.get_page_retires();
    const stores = e.get_cache_stores();
    for (let n = 0; n < 12; n++) { execute(code + offset); execute(code); }
    assert.strictEqual(e.test_page_probe(code), 1, 'alpha head stays compiled');
    assert.strictEqual(e.test_page_probe(code + offset), 1, 'alpha interior stays compiled');
    assert.strictEqual(e.get_page_retires() - retires, 0, 'alpha entries must not repeatedly retire each other');
    assert.strictEqual(e.get_cache_stores() - stores, 0, 'warmed alpha entries must not be re-decoded');
  }
  // MW3's color-key row has the same conflict at its conditional store and
  // induction tail. Cover every interior instruction boundary, relocated.
  const keyLoop = Buffer.from('668b08663b4d0c740466890c1883c0024e75ed', 'hex');
  for (const offset of [3, 7, 9, 13, 16, 17]) {
    const code = page + 2;
    assert.strictEqual(e.test_sparse_map_for_code(page, 0x1000) >>> 0, page);
    page += 0x1000;
    e.guest_write8(code - 2, 0x90); e.guest_write8(code - 1, 0x90);
    [...keyLoop, 0xc3].forEach((byte, i) => e.guest_write8(code + i, byte));
    const bp = stack + 0x100, dst = stack + 0x200, src = stack + 0x220;
    const execute = entry => {
      e.set_esp(stack); e.guest_write32(stack, 0); e.set_ebp(bp);
      e.set_eax(src); e.set_ebx(dst - src); e.set_ecx(0x5aa5); e.set_esi(1);
      e.guest_write32(bp + 12, 0x7bef);
      e.guest_write32(src, 0x5aa5); e.guest_write32(dst, 0);
      // Entering past the store represents a pixel already copied. The DEC
      // and JNZ entries additionally need the preceding instruction's state.
      const interior = entry > code;
      if (interior && offset >= 13) e.guest_write32(dst, 0x5aa5);
      if (interior && offset >= 16) e.set_eax(src + 2);
      if (interior && offset === 17) e.set_esi(0);
      e.test_seed_zf(interior && offset === 17 ? 1 : 0);
      e.set_eip(entry); e.run(1000);
      assert.strictEqual(e.get_eip() >>> 0, 0, 'color-key row returns');
      assert.strictEqual(new DataView(memory.buffer).getUint16(e.guest_to_wasm(dst), true),
        0x5aa5, 'color-key head and interior preserve copied pixel');
    };
    const runs = e.test_colorkey_runs();
    execute(code - 2);
    assert(e.test_colorkey_runs() > runs, 'predecessor falls into a separate native color-key row');
    e.test_uop_try(code);
    assert.strictEqual(e.test_uop_program(code), 0, 'native row is not replaced by a micro-op program');
    for (let n = 0; n < 16; n++) { execute(code + offset); execute(code); }
    const retires = e.get_page_retires(), stores = e.get_cache_stores();
    for (let n = 0; n < 12; n++) { execute(code + offset); execute(code); }
    assert.strictEqual(e.test_page_probe(code + offset), 1, 'color-key interior stays compiled');
    assert.strictEqual(e.get_page_retires() - retires, 0, 'color-key entries must not retire each other');
    assert.strictEqual(e.get_cache_stores() - stores, 0, 'color-key entries must not be re-decoded');
  }
  console.log('PASS  load, alpha and color-key folds preserve independently compiled interior entries');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
