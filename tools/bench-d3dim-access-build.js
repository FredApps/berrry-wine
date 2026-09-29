#!/usr/bin/env node
'use strict';

// Diagnostic only: translation/scalar-access probes for DIB-backed surfaces.
// Not exhaustive: cached native pointers and direct WASM accesses can bypass
// these hooks. Pair the trace with disassembly; never use it as a safety gate.
// node tools/bench-d3dim-access-build.js [--out=build/d3dim-access.wasm]
// Then bench-d3dim-gameplay.js --frame-times --trace-locks --trace-access --wasm=...
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function instrumentClosure(closure) {
  const entries = [...closure.vfs].filter(([key]) => key.endsWith('03-registers.wat'));
  assert(entries.length > 0);
  const source = entries[0][1];
  assert(entries.every(([, value]) => value === source), 'closure aliases differ');
  let s = source;
  const marker = '  (func $g2w_slow (param $ga i32) (result i32)';
  assert(s.includes(marker));
  s = s.replace(marker, `
  (global $bench_access_start (mut i32) (i32.const 0))
  (global $bench_access_end (mut i32) (i32.const 0))
  (func (export "bench_access_range") (param $wa i32) (param $length i32)
    (global.set $bench_access_start (local.get $wa))
    (global.set $bench_access_end (i32.add (local.get $wa) (local.get $length))))
  (func $bench_access (param $ga i32) (param $kind i32)
    (local $wa i32)
    (local.set $wa (i32.add (global.get $DIB_BACKING_BASE)
      (i32.sub (local.get $ga) (global.get $DIB_GUEST_BASE))))
    (if (i32.and (i32.ge_u (local.get $wa) (global.get $bench_access_start))
                (i32.lt_u (local.get $wa) (global.get $bench_access_end))) (then
      (call $host_dx_trace (local.get $kind) (local.get $ga)
        (global.get $dbg_prev_eip) (global.get $eip)
        (i32.sub (local.get $wa) (global.get $bench_access_start))))))
` + marker);
  for (const [name, kind] of [['g2w_slow', 90], ['gl8', 91], ['gl16', 91],
    ['gl32', 91], ['gs8', 92], ['gs16', 92], ['gs32', 92]]) {
    const a = s.indexOf('  (func $' + name + ' '), b = s.indexOf('\n  (func ', a + 1);
    assert(a >= 0 && b > a, `missing probe seam: ${name}`);
    const lines = s.slice(a, b).split('\n');
    let i = 1;
    while (lines[i].trim().startsWith('(local ')) i++;
    lines.splice(i, 0, `    (call $bench_access (local.get $ga) (i32.const ${kind}))`);
    s = s.slice(0, a) + lines.join('\n') + s.slice(b);
  }
  for (const [key] of entries) closure.vfs.set(key, s);
}
module.exports = { instrumentClosure };

if (require.main === module) {
  const { watxSourceClosure, compileClosure } = require('./watx-closure');
  const closure = watxSourceClosure();
  instrumentClosure(closure);
  const r = compileClosure(closure, { tailCalls: true, nameSection: true });
  assert(r.success, JSON.stringify(r.error || r.message));
  const out = path.resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'build/d3dim-access.wasm');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(r.wasmBinary));
  console.log(out);
}
