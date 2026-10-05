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
  // MW3's RGB565 alpha and color-key row folds had sections here; both folds
  // are retired to the uop tier (docs/uop-tier-design.md section 18).
  console.log('PASS  load-run folds preserve independently compiled interior entries');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
