#!/usr/bin/env node
'use strict';
// Reproduce build/operand-fetch-gated.wasm from parent e5e6b71a plus the
// operand-fetch call-site conversion. Run on commit e68e96bd, then build.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
for (const name of ['05-alu.wat', '05c-seg16-ops.wat', '06-fpu.wat',
  '06b-core-handlers.wat', '07b-loop-match.wat']) {
  const file = path.join(root, 'src', name);
  const source = fs.readFileSync(file, 'utf8');
  const changed = source.replace(/\(local \$operand_word i32\) /g, '');
  if (changed === source) throw new Error(`no operand locals found in ${name}`);
  fs.writeFileSync(file, changed);
}
const cache = path.join(root, 'src', '04-cache.wat');
let source = fs.readFileSync(cache, 'utf8');
const pure = `  (defmacro (read-thread-word)
    (block (result i32)
      (local.set $operand_word (i32.load (global.get $ip)))
      (global.set $ip (i32.add (global.get $ip) (i32.const 4)))
      (local.get $operand_word)))`;
const gated = `  (global $bench_operand_fetch_value (mut i32) (i32.const 0))
  (defmacro (read-thread-word)
    (if (result i32) (global.get $bench_operand_fetch_inline)
      (then
        (global.set $bench_operand_fetch_value (i32.load (global.get $ip)))
        (global.set $ip (i32.add (global.get $ip) (i32.const 4)))
        (global.get $bench_operand_fetch_value))
      (else (call $read_thread_word))))`;
if (!source.includes(pure)) throw new Error('pure operand macro not found');
fs.writeFileSync(cache, source.replace(pure, gated));
