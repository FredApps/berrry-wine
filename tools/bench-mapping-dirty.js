#!/usr/bin/env node
'use strict';

// Isolated cost experiment, NOT a complete dirty-page implementation. Compiles
// a no-hook control and a scalar gs32 hook from the same source. No shipped
// WAT, generated artifact, or default execution mode is changed.
const assert = require('assert');
const os = require('os');
const { performance } = require('perf_hooks');
const { compileSrcWasm } = require('../test/compile-src');
const { createHostImports } = require('../lib/host-imports');

const iterations = Number(process.env.DIRTY_BENCH_ITERATIONS || 2000000);
const repetitions = Number(process.env.DIRTY_BENCH_REPETITIONS || 9);
const inlineGeneration = process.argv.includes('--generation-inline');
const generation = inlineGeneration || process.argv.includes('--generation');
assert(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 0x7fffffff);
assert(Number.isSafeInteger(repetitions) && repetitions >= 3);
const extra = `
  (global $bench_dirty_table (mut i32) (i32.const 0))
  (func (export "bench_setup") (param $table i32)
    (global.set $bench_dirty_table (local.get $table))
    (global.set $exe_size_of_image (i32.const 65536)))
  (func $bench_mark_dirty (param $ga i32)
    ;; Prototype only: direct-window test uses this fixture's known addresses.
    ;; One byte/page: TRACKED=1, DIRTY=2; atomic OR avoids losing peer writes.
    (local $cell i32)
    (if (i32.lt_u (local.get $ga) (i32.const 0x08000000)) (then (return)))
    (local.set $cell (i32.add (global.get $bench_dirty_table)
      (i32.shr_u (local.get $ga) (i32.const 12))))
    (if (i32.and (i32.atomic.load8_u (local.get $cell)) (i32.const 1))
      (then (drop (i32.atomic.rmw8.or_u (local.get $cell) (i32.const 2))))))
  (func (export "bench_stores") (param $ga i32) (param $n i32)
    (local $i i32)
    (loop $again
      (call $gs32 (local.get $ga) (local.get $i))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
`;

const generationWrapper = `
  ;; Cost prototype only: one DWORD per guest page; TRACKED=1, DIRTY=2,
  ;; generation in bits 2..31. No PE is loaded, so staging is scratch.
  ;; The benchmark writes aligned DWORDs within ONE page. Cross-page stores,
  ;; flush, wrap and retirement are not implemented by this wrapper.
  (func $gs32 (param $ga i32) (param $v i32)
    (local $cell i32) (local $stamp i32)
    (if (i32.lt_u (local.get $ga) (i32.const 0x08000000))
      (then (call $bench_original_gs32 (local.get $ga) (local.get $v)) (return)))
    (local.set $cell (i32.add (global.get $bench_dirty_table)
      (i32.shl (i32.shr_u (local.get $ga) (i32.const 12)) (i32.const 2))))
    (local.set $stamp (i32.atomic.load (local.get $cell)))
    (if (i32.eqz (i32.and (local.get $stamp) (i32.const 1)))
      (then (call $bench_original_gs32 (local.get $ga) (local.get $v)) (return)))
    (if (i32.eqz (i32.and (local.get $stamp) (i32.const 2)))
      (then (drop (i32.atomic.rmw.or (local.get $cell) (i32.const 2)))))
    (call $bench_original_gs32 (local.get $ga) (local.get $v))
    (if (i32.ne (i32.shr_u (local.get $stamp) (i32.const 2))
                (i32.shr_u (i32.atomic.load (local.get $cell)) (i32.const 2)))
      (then (drop (i32.atomic.rmw.or (local.get $cell) (i32.const 2))))))
`;

function inlineGenerationStore(source) {
  const start = source.indexOf('  (func $gs32 ');
  const end = source.indexOf('  (func $gs64 ', start);
  assert(start >= 0 && end > start, 'gs32 boundaries changed');
  let body = source.slice(start, end);
  const locals = '(local $wa i32) (local $end_wa i32)';
  assert(body.includes(locals), 'gs32 locals changed');
  body = body.replace(locals, locals + ' (local $cell i32) (local $stamp i32)');
  const store = '(then (i32.store (local.get $wa) (local.get $v)) (return))';
  assert(body.includes(store), 'gs32 same-page store changed');
  // Replace only the first, same-page store branch. Cross-page tracking is
  // deliberately outside this cost fixture, not silently claimed as covered.
  body = body.replace(store, `(then
      (if (i32.lt_u (local.get $ga) (i32.const 0x08000000))
        (then (i32.store (local.get $wa) (local.get $v)) (return)))
      (local.set $cell (i32.add (global.get $bench_dirty_table)
        (i32.shl (i32.shr_u (local.get $ga) (i32.const 12)) (i32.const 2))))
      (local.set $stamp (i32.atomic.load (local.get $cell)))
      (if (i32.eq (i32.and (local.get $stamp) (i32.const 3)) (i32.const 1))
        (then (drop (i32.atomic.rmw.or (local.get $cell) (i32.const 2)))))
      (i32.store (local.get $wa) (local.get $v))
      (if (i32.and (local.get $stamp) (i32.const 1))
        (then
          (if (i32.ne (i32.shr_u (local.get $stamp) (i32.const 2))
                      (i32.shr_u (i32.atomic.load (local.get $cell)) (i32.const 2)))
            (then (drop (i32.atomic.rmw.or (local.get $cell) (i32.const 2)))))))
      (return))`);
  return source.slice(0, start) + body + source.slice(end);
}

async function arm(hook) {
  let injected = false;
  const bytes = compileSrcWasm((file, source) => {
    if (hook && file === '03-registers.wat') {
      const pattern = /(\(func \$gs32 \(param \$ga i32\) \(param \$v i32\)\s*\(local \$wa i32\) \(local \$end_wa i32\))/;
      assert(pattern.test(source), 'gs32 seam changed');
      source = inlineGeneration ? inlineGenerationStore(source) : generation
        ? source.replace('(func $gs32 ', '(func $bench_original_gs32 ')
        : source.replace(pattern, '$1\n    (call $bench_mark_dirty (local.get $ga))');
      injected = true;
    }
    return file === '13-exports.wat'
      ? source + extra + (hook && generation && !inlineGeneration ? generationWrapper : '') : source;
  });
  assert.strictEqual(injected, hook);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer, exports: null };
  const imports = createHostImports(ctx);
  imports.host.memory = memory;
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  const e = ctx.exports = instance.exports;
  // No PE is loaded: its staging allocation is unused benchmark scratch, not
  // guest backing and not an invented address in the allocated region map.
  const table = e.get_staging();
  const flags = generation ? new Uint32Array(memory.buffer, table, 1 << 20)
    : new Uint8Array(memory.buffer, table, 1 << 20);
  flags.fill(0);
  e.bench_setup(table);
  const sparse = e.guest_section_reserve(4096) >>> 0;
  assert(sparse && e.guest_section_commit(sparse, 0, 4096, 4));
  return { e, memory, flags, sparse, hook };
}

async function main() {
  const beforeLoad = os.loadavg();
  const controlOnly = process.argv.includes('--control-only');
  const control = await arm(false), candidate = await arm(!controlOnly);
  const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const results = [];
  for (const kind of ['direct', 'sparse-untracked', 'sparse-tracked']) {
    const samples = { control: [], candidate: [] };
    const run = (a, n) => {
      const ga = kind === 'direct' ? 0x00500000 : a.sparse;
      a.flags[ga >>> 12] = kind === 'sparse-tracked' ? 1 : 0;
      const start = performance.now();
      a.e.bench_stores(ga, n);
      const elapsed = performance.now() - start;
      const wa = a.e.guest_to_wasm(ga) >>> 0;
      assert.strictEqual(new DataView(a.memory.buffer).getUint32(wa, true), n - 1);
      assert.strictEqual(a.flags[ga >>> 12],
        kind === 'sparse-tracked' ? (a.hook ? 3 : 1) : 0, 'tracking activation');
      return elapsed;
    };
    for (let warm = 0; warm < 3; warm++) { run(control, iterations); run(candidate, iterations); }
    for (let i = 0; i < repetitions; i++) {
      for (const name of (i & 1 ? ['candidate', 'control'] : ['control', 'candidate'])) {
        samples[name].push(run(name === 'control' ? control : candidate, iterations));
      }
    }
    const controlMs = median(samples.control), candidateMs = median(samples.candidate);
    results.push({ kind, controlMs, candidateMs, changePercent: (candidateMs / controlMs - 1) * 100, samples });
  }
  console.log(JSON.stringify({ node: process.version, arch: process.arch, iterations, repetitions,
    controlOnly, candidate: inlineGeneration ? 'generation-inline' : generation ? 'generation-wrapper' : 'naive-premark',
    beforeLoad, afterLoad: os.loadavg(), scope: 'gs32 microbenchmark only; incomplete tracking coverage', results }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
