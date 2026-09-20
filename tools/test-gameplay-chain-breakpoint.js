'use strict';
const assert = require('assert');
const fs = require('fs');
const { createHostImports } = require('../lib/host-imports');
const RegionMap = require('../lib/region-map.generated');
(async () => {
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const { host } = createHostImports(ctx);
  Object.assign(host, { memory, log: () => {}, log_i32: () => {}, exit: () => {} });
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('build/wine-assembly.wasm'), { host });
  const e = ctx.exports = instance.exports;
  const bytes = new Uint8Array(memory.buffer);
  const pe = fs.readFileSync('test/binaries/notepad.exe');
  bytes.set(pe, e.get_staging()); e.load_pe(pe.length);
  const base = e.get_image_base(), pc = base + 0x1000;
  // outer: inc eax; mov ecx,100; inner: inc edx; dec ecx; jnz inner; jmp outer
  // Two blocks per inner iteration; cannot be replaced by a counted-copy fold.
  bytes.set([0x40, 0xb9,100,0,0,0, 0x42,0x49,0x75,0xfc, 0xeb,0xf4], RegionMap.g2w(pc, base));
  e.set_eax(0); e.set_edx(0); e.set_eip(pc); e.set_bp(pc);
  function boundary(n) {
    e.run(100000);
    assert.strictEqual(e.get_eip(), pc);
    assert.strictEqual(e.get_last_run_halt(), 5);
    assert.strictEqual(e.get_eax(), n);
    assert.strictEqual(e.get_edx(), n * 100);
  }
  boundary(0); boundary(1); boundary(2);
  const transfers = () => BigInt(e.get_page_fast() >>> 0) + e.get_chain_hits();
  assert.strictEqual(transfers(), 0n, 'ordinary debugger disables chains');
  e.set_benchmark_chain_bp(1);
  boundary(3); boundary(4); boundary(5);
  assert(transfers() > 0n, 'benchmark actually chains');
  const beforeWatch = transfers();
  e.set_watchpoint(base + 0x2000);
  boundary(6); boundary(7);
  assert.strictEqual(transfers(), beforeWatch, 'watchpoint still disables chains');
  e.set_watchpoint(0);
  boundary(8);
  assert(transfers() > beforeWatch, 'clearing watch restores chains');
  e.set_benchmark_chain_bp(0);
  const beforeNormal = transfers();
  boundary(9); boundary(10);
  assert.strictEqual(transfers(), beforeNormal, 'normal debugger restored');
  e.set_block_chain(1); e.set_loop_aoe_fill_emit(0); e.set_benchmark_chain_bp(1);
  boundary(11); boundary(12); boundary(13);
  assert(e.get_chain_hits() > 0n, 'cached chain slots also preserve breakpoint');
  console.log('PASS exact breakpoint/resume, chain hits, watchpoint guard, mode reset');
})().catch(error => { console.error(error); process.exitCode = 1; });
