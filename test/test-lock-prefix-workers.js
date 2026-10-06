#!/usr/bin/env node

'use strict';

// LOCK-prefixed x86 under real contention: two (or more) worker_threads, one
// WASM instance each, over ONE shared memory, all running the same guest loop
// at the same instant -- the shape of guest threads in browser Workers or
// test/run.js --threads. Each iteration does four things a lost update shows
// up in:
//
//   lock inc dword [C0]                      ; InterlockedIncrement, inline
//   lock xadd dword [C1], ecx (ecx = 1)      ; InterlockedExchangeAdd
//   cas: mov eax,[C2]; lea edx,[eax+1]
//        lock cmpxchg [C2], edx; jnz cas     ; a lock-free counter
//   spin: mov eax,1; xchg [L], eax           ; a spinlock (XCHG is locked
//         test eax,eax; jnz spin             ;   by definition, no prefix)
//         inc dword [C3]                     ; plain RMW, inside the lock
//         mov dword [L], 0                   ; plain release store
//
// With $LOCK_MODE 1 (07-decoder.wat $try_emit_locked) every counter must end
// at workers * iterations. The same loop with mode 0 -- the cooperative
// encoding, which ignores LOCK -- is run too and its counts are printed: they
// show the test is able to see the race (it is not asserted, since a run of
// a racy program is allowed to get lucky).
//
// Run: node test/test-lock-prefix-workers.js [--iterations=N] [--workers=N]

const path = require('path');
const fs = require('fs');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const RegionMap = require('../lib/region-map.generated.js');

const IMAGE_BASE = 0x400000;
const CODE = 0x00600000;
const C0 = 0x00700000, C1 = C0 + 8, C2 = C0 + 16, C3 = C0 + 24, LOCKW = C0 + 64;
const BARRIER = 0x00700100;
const STACK0 = 0x00800000;
const g2w = a => RegionMap.g2w(a, IMAGE_BASE);

async function bootInstance(wasmBytes, memory, tid) {
  const { createHostImports } = require('../lib/host-imports');
  const ctx = {
    getMemory: () => memory.buffer,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
    onExit: () => {},
  };
  const base = createHostImports(ctx);
  base.host.memory = memory;
  base.host.log = () => {};
  base.host.log_i32 = () => {};
  for (const stub of ['create_thread', 'exit_thread', 'terminate_thread', 'create_event', 'set_event',
    'reset_event', 'wait_single', 'wait_multiple']) base.host[stub] = () => 0;
  const { instance } = await WebAssembly.instantiate(wasmBytes, base);
  ctx.exports = instance.exports;
  instance.exports.init_thread(tid, IMAGE_BASE, 0, 0, 0, 0, 0);
  return instance;
}

// The guest loop, assembled here so the jump offsets are computed, not typed.
function assemble(iterations) {
  const le32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  const out = [];
  const label = {};
  const fix = [];
  const emit = (...b) => out.push(...b);
  const jnz = name => { emit(0x75, 0); fix.push([out.length - 1, name]); };
  emit(0xBE, ...le32(iterations));                    // mov esi, iterations
  label.top = out.length;
  emit(0xF0, 0xFF, 0x05, ...le32(C0));                // lock inc dword [C0]
  emit(0xB9, ...le32(1));                             // mov ecx, 1
  emit(0xF0, 0x0F, 0xC1, 0x0D, ...le32(C1));          // lock xadd [C1], ecx
  label.cas = out.length;
  emit(0xA1, ...le32(C2));                            // mov eax, [C2]
  emit(0x8D, 0x50, 0x01);                             // lea edx, [eax+1]
  emit(0xF0, 0x0F, 0xB1, 0x15, ...le32(C2));          // lock cmpxchg [C2], edx
  jnz('cas');
  label.spin = out.length;
  emit(0xB8, ...le32(1));                             // mov eax, 1
  emit(0x87, 0x05, ...le32(LOCKW));                   // xchg [L], eax
  emit(0x85, 0xC0);                                   // test eax, eax
  jnz('spin');
  emit(0xFF, 0x05, ...le32(C3));                      // inc dword [C3]
  emit(0xC7, 0x05, ...le32(LOCKW), ...le32(0));       // mov dword [L], 0
  emit(0x4E);                                         // dec esi
  jnz('top');
  emit(0xC3);                                         // ret
  for (const [at, name] of fix) {
    const rel = label[name] - (at + 1);
    if (rel < -128 || rel > 127) throw new Error('jump out of rel8 range');
    out[at] = rel & 0xFF;
  }
  return out;
}

if (!isMainThread) {
  (async () => {
    const { wasmBytes, memory, tid, workers, mode, codeAddr } = workerData;
    const ex = (await bootInstance(wasmBytes, memory, tid)).exports;
    ex.set_lock_atomic_mode(mode);
    const i32 = new Int32Array(memory.buffer);
    const stackTop = STACK0 + tid * 0x10000;
    ex.set_esp(stackTop);
    new DataView(memory.buffer).setUint32(g2w(stackTop), 0, true);
    ex.set_eip(codeAddr);
    // Start together, or the first worker finishes before the next exists.
    Atomics.add(i32, g2w(BARRIER) / 4, 1);
    while (Atomics.load(i32, g2w(BARRIER) / 4) < workers) Atomics.wait(i32, g2w(BARRIER) / 4, Atomics.load(i32, g2w(BARRIER) / 4), 20);
    // A wall-clock bound, not an error: under the cooperative encoding a
    // non-atomic XCHG can lose the spinlock's release, and then every other
    // thread spins forever. That outcome is reported, not hung on.
    const deadline = Date.now() + workerData.limitMs;
    while (ex.get_eip() !== 0) {
      ex.run(200000);
      if (Date.now() > deadline) { parentPort.postMessage({ tid, stuck: true }); return; }
    }
    parentPort.postMessage({ tid });
  })().catch(err => parentPort.postMessage({ error: String(err && err.stack || err) }));
  return;
}

(async () => {
  const arg = (name, d) => { const a = process.argv.find(s => s.startsWith(`--${name}=`)); return a ? +a.slice(name.length + 3) : d; };
  const iterations = arg('iterations', 300000);
  const workers = arg('workers', 2);
  const limitMs = arg('limit-ms', 20000);
  const ROOT = path.join(__dirname, '..');
  const wasmBytes = fs.readFileSync(process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm'));
  const code = assemble(iterations);

  let failed = 0;
  console.log(`LOCK prefix under contention: ${workers} worker_threads x ${iterations} iterations\n`);
  for (const mode of [1, 0]) {
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const u8 = new Uint8Array(memory.buffer);
    // A fresh code address per arm: blocks keep the encoding they were
    // decoded with, and each arm must decode its own.
    const codeAddr = CODE + mode * 0x1000;
    u8.set(code, g2w(codeAddr));
    const t0 = Date.now();
    const done = await Promise.all(Array.from({ length: workers }, (_, k) => new Promise((resolve, reject) => {
      // The cooperative arm usually wedges within a few iterations (a lost
      // release), so it gets a short leash; the atomic arm gets the full one.
      const w = new Worker(__filename, { workerData: { wasmBytes, memory, tid: k + 1, workers, mode, codeAddr,
        limitMs: mode ? limitMs : Math.min(limitMs, 3000) } });
      w.on('message', m => { if (m.error) reject(new Error(m.error)); else { resolve(m); w.terminate(); } });
      w.on('error', reject);
    })));
    const dv = new DataView(memory.buffer);
    const want = workers * iterations;
    const got = [C0, C1, C2, C3].map(a => dv.getUint32(g2w(a), true));
    const names = ['lock inc', 'lock xadd', 'lock cmpxchg loop', 'xchg spinlock + plain inc'];
    const stuck = done.filter(m => m.stuck).length;
    console.log(`mode ${mode} (${mode ? 'atomic, Worker threads' : 'cooperative encoding'}), ${Date.now() - t0} ms:`);
    if (stuck) {
      if (mode === 1) { console.log(`  FAIL ${stuck} thread(s) never finished`); failed++; }
      else console.log(`  info ${stuck} thread(s) stuck: a lost spinlock release (the race this fixes)`);
    }
    got.forEach((v, i) => {
      const ok = v === want;
      if (mode === 1) {
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${names[i]}: ${v} / ${want}`);
        if (!ok) failed++;
      } else {
        console.log(`  info ${names[i]}: ${v} / ${want}${ok ? '' : `  (${want - v} lost: the race this fixes)`}`);
      }
    });
    if (mode === 1 && dv.getUint32(g2w(LOCKW), true) !== 0) { console.log('  FAIL spinlock left held'); failed++; }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nPASS');
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
