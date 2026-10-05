#!/usr/bin/env node
'use strict';

// A refused guest allocation names its caller.
//
// The size is the whole diagnosis of a bad allocation, and the size was
// computed by the caller -- but by the time the CRT allocator asks the host for
// memory, every register that could say where it came from is gone. B&W2 is the
// case this exists for: it asks for 430,571,520 bytes in one call, gets NULL,
// throws std::bad_alloc and exits, and the only thing in the log was the size.
// A number that large is essentially never a program that wanted the memory; it
// is a count or a pointer difference that went wrong several frames up.
//
// So the OOM report walks the EBP chain, the same walk --trace-stack does. This
// pins that it fires, that it reports the frames in caller order, and that it
// stays silent about frames rather than throwing when there is no chain to
// walk -- a diagnostic that crashes the run it is diagnosing is worse than no
// diagnostic at all.
//
// Run: node test/test-heap-oom-stack.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHostImports } = require(path.join(__dirname, '..', 'lib/host-imports'));
const RegionMap = require('../lib/region-map.generated.js');

async function main() {
  const ROOT = path.join(__dirname, '..');
  const WASM_PATH = process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const exeBytes = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const h = createHostImports(ctx).host;
  h.memory = memory;
  h.exit = () => {};
  h.crash_unimplemented = () => {};

  const lines = [];
  const realLog = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };

  let instance;
  try {
    ({ instance } = await WebAssembly.instantiate(wasmBytes, { host: h }));
    ctx.exports = instance.exports;
    const e = instance.exports;
    const dv = new DataView(e.memory.buffer);
    new Uint8Array(e.memory.buffer).set(exeBytes, e.get_staging());
    e.load_pe(exeBytes.length);

    const imageBase = e.get_image_base();
    const g2w = a => RegionMap.g2w(a, imageBase);
    const poke = (addr, v) => dv.setUint32(g2w(addr), v >>> 0, true);

    // Three stacked frames, innermost first. Each frame is {savedEbp, retAddr},
    // and walkFrames stops when the next EBP is not above the current one, so
    // the chain has to climb.
    const F1 = imageBase + 0x9000, F2 = imageBase + 0x9100, F3 = imageBase + 0x9200;
    poke(F1 + 0, F2);          poke(F1 + 4, 0x00ad5652);
    poke(F2 + 0, F3);          poke(F2 + 4, 0x009d5440);
    poke(F3 + 0, 0);           poke(F3 + 4, 0x009e3a20);
    e.set_ebp(F1);
    e.set_eip(0x00ad561b);

    // reason 2 is the one B&W2 hit: the sparse arena had no address space left.
    h.heap_oom_trace(0x19aa0000, 2);

    const out = lines.join('\n');
    assert.ok(/\[heap\] OOM: 430571520 bytes \(0x19aa0000\)/.test(out),
      `the size line must still be reported verbatim:\n${out}`);
    assert.ok(/sparse arena: no guest address space left to reserve/.test(out),
      `the refusal reason must survive:\n${out}`);
    assert.ok(/requested from eip=0x00ad561b/.test(out),
      `the faulting EIP must be named:\n${out}`);
    assert.ok(/frames=\[0x00ad5652 <- 0x009d5440 <- 0x009e3a20\]/.test(out),
      `the EBP chain must be reported innermost-first:\n${out}`);

    // A caller compiled without a frame pointer leaves EBP holding data, not a
    // chain. That must degrade to a note, never to a throw.
    lines.length = 0;
    e.set_ebp(0);
    h.heap_oom_trace(0x1000, 1);
    const out2 = lines.join('\n');
    assert.ok(/\[heap\] OOM: 4096 bytes/.test(out2), `still reports the size:\n${out2}`);
    assert.ok(/no EBP chain/.test(out2), `must say why there are no frames:\n${out2}`);
  } finally {
    console.log = realLog;
  }

  console.log('PASS heap OOM reports the requesting EIP and the EBP caller chain, '
    + 'and degrades cleanly when there is no chain');
}

main().catch(err => { console.error(err); process.exit(1); });
