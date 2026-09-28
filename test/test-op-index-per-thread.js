#!/usr/bin/env node
'use strict';

// OP_INDEX -- the decoder's list of op-start addresses for the block it just
// emitted -- is scratch that every loop matcher and every x87 fuser reads
// straight after $te fills it. Guest threads are separate wasm instances over
// ONE shared memory, and in worker mode they decode truly in parallel, so a
// single fixed OP_INDEX lets thread B's decoder overwrite thread A's list
// between A's $te and A's fuser. A's fuser then rewrites B's records (in B's
// own thread-cache partition) or packs a run length that spans records from
// two unrelated blocks. Warcraft III with ?x87-fold under --threads died that
// way in the Miles MP3 thread: an H451 island whose count ran past its real
// x87 records, fed a non-x87 record to $fpu_exec_reg, FPU_UNIMPL.
//
// The cooperative scheduler runs one instance at a time and can never show
// it, so this checks the invariant directly: two instances on one memory,
// each decoding and folding an x87 block, must not share a byte of OP_INDEX,
// and B's decode must leave A's list exactly as A's decoder wrote it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHostImports } = require('../lib/host-imports');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const wasm = compileSrcWasm((file, source) => file === '13-exports.wat' ? source + `
  (func (export "test_op_index_base") (result i32) (global.get $OP_INDEX))
  (func (export "test_op_index_n") (result i32) (global.get $op_index_n))
  (func (export "test_g2w") (param $guest i32) (result i32)
    (call $g2w (local.get $guest)))
` : source);
const exe = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'notepad.exe'));

const le32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

async function instantiate(memory) {
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const host = createHostImports(ctx).host;
  Object.assign(host, { memory, exit() {}, log() {}, log_i32() {},
    crash_unimplemented() { throw new Error('crash_unimplemented'); },
    wait_multiple: () => 0, shell_execute: () => 33 });
  const { instance } = await WebAssembly.instantiate(wasm, { host });
  ctx.exports = instance.exports;
  return instance.exports;
}

// An island-shaped straight-line x87 body: n pairs of `fld dword [esi+4k];
// fadd dword [esi+4k+4]; fstp dword [edi+4k]`, then RET through a zero.
function x87Body(pairs) {
  const out = [];
  for (let k = 0; k < pairs; k++) {
    out.push(0xD9, 0x46, 4 * k);          // fld  dword [esi+disp8]
    out.push(0xD8, 0x46, 4 * k + 4);      // fadd dword [esi+disp8]
    out.push(0xD9, 0x5F, 4 * k);          // fstp dword [edi+disp8]
  }
  out.push(0xC3);
  return out;
}

function runBlock(e, mem, dv, { code, data, output, stack, pairs }) {
  const g2w = ga => e.test_g2w(ga) >>> 0;
  for (let k = 0; k <= pairs; k++) dv.setFloat32(g2w(data + 4 * k), k + 0.5, true);
  mem.set(x87Body(pairs), g2w(code));
  dv.setUint32(g2w(stack), 0, true);
  e.set_x87_pipeline4_fusion(1);
  e.set_esi(data); e.set_edi(output); e.set_esp(stack); e.set_eip(code);
  e.run(100000);
  assert.strictEqual(e.get_eip() >>> 0, 0, 'x87 block must return');
  for (let k = 0; k < pairs; k++) {
    assert.strictEqual(dv.getFloat32(g2w(output + 4 * k), true), 2 * k + 2,
      `output[${k}] must be data[${k}] + data[${k + 1}]`);
  }
}

(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const mem = new Uint8Array(memory.buffer);
  const dv = new DataView(memory.buffer);

  const a = await instantiate(memory);
  mem.set(exe, a.get_staging());
  assert(a.load_pe(exe.length), 'fixture PE must load');
  const imageBase = a.get_image_base() >>> 0;

  const b = await instantiate(memory);
  b.init_thread(1, imageBase, a.get_code_start(), a.get_code_end(),
    a.get_thunk_base(), a.get_thunk_end(), a.get_num_thunks(),
    a.get_rsrc_rva ? a.get_rsrc_rva() : 0);

  const baseA = a.test_op_index_base() >>> 0;
  const baseB = b.test_op_index_base() >>> 0;
  const bytes = 0x2000;

  // Thread A decodes and folds a short block; thread B then decodes and
  // folds a longer one. A's list has to survive B's decode untouched.
  runBlock(a, mem, dv, { code: imageBase + 0x30000, data: imageBase + 0x50000,
    output: imageBase + 0x50800, stack: imageBase + 0xD00000, pairs: 3 });
  const nA = a.test_op_index_n() >>> 0;
  assert(nA > 0, 'thread A decoded a block');
  const before = Array.from(new Uint32Array(memory.buffer, baseA, nA));

  runBlock(b, mem, dv, { code: imageBase + 0x31000, data: imageBase + 0x51000,
    output: imageBase + 0x51800, stack: imageBase + 0xC00000, pairs: 12 });
  assert(b.test_op_index_n() >>> 0 > nA, 'thread B decoded a longer block');
  const after = Array.from(new Uint32Array(memory.buffer, baseA, nA));
  assert.deepStrictEqual(after, before,
    "thread B's decode must not rewrite thread A's OP_INDEX");
  assert(baseA + bytes <= baseB || baseB + bytes <= baseA,
    `OP_INDEX must be per thread: tid0 0x${baseA.toString(16)} tid1 0x${baseB.toString(16)}`);

  // Every worker slot the thread cache is carved for gets its own list.
  const seen = [];
  for (let tid = 0; tid < 16; tid++) {
    const e = await instantiate(memory);
    e.init_thread(tid, imageBase, a.get_code_start(), a.get_code_end(),
      a.get_thunk_base(), a.get_thunk_end(), a.get_num_thunks(), 0);
    const base = e.test_op_index_base() >>> 0;
    for (const other of seen) {
      assert(base + bytes <= other || other + bytes <= base,
        `tid ${tid} OP_INDEX 0x${base.toString(16)} overlaps 0x${other.toString(16)}`);
    }
    seen.push(base);
  }
  console.log('PASS test-op-index-per-thread: OP_INDEX is per instance; no cross-thread overwrite');
})().catch(err => { console.error(err); process.exit(1); });
