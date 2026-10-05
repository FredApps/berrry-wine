#!/usr/bin/env node
// test/watx-compiler-macro-body.test.js -- a multi-form macro expanded INSIDE a
// function body must contribute every one of its forms.
//
// WHY THIS SUITE EXISTS (2026-09-19). `expandForm` returned a multi-form macro
// expansion as one `_isBegin`-tagged array, and `expandModule` spliced that
// array only at module level. Anywhere below -- a function body, a `then` arm,
// a `block` -- the parent's child loop pushed the whole array as a single bogus
// child, and the encoder dropped it without a word. The module validated, the
// function ran, and the macro's instructions were simply not there. That is
// exactly how `(dispatch-next)` in src/04-cache.wat, the emulator's whole
// dispatch step, vanished: every handler "ran", every app started, and zero
// x86 ops executed. A single-form body never hit it, which is why 400 other
// macros in the tree were fine. `(begin ...)` bodies had a second copy of the
// same bug in `substitute`, which returned the spliced forms untagged.
//
// A compile-only check would pass on the broken compiler (it did validate), so
// every case here instantiates the module and CALLS the function, and the
// three spellings -- bare multi-form, `(begin ...)`, and single form -- must all
// compute the same number from the same call sites.
'use strict';
const assert = require('assert');
const path = require('path');
const { compile } = require(path.join(__dirname, '..', 'tools', 'watx.js'));

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); console.log('  PASS  ' + msg); }

function run(macro) {
  const src = [
    '(global $g (mut i32) (i32.const 0))',
    macro,
    '(func $f (export "f") (result i32) (effects)',
    '  (if (i32.eqz (global.get $g)) (then (bump)))', // nested position: then-arm
    '  (block (bump))',                              // nested position: block
    '  (bump)',                                       // function-body position
    '  (global.get $g))',
  ].join('\n');
  const r = compile(src, new Map(), { mode: 'production' });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(r.wasmBinary), {});
  return inst.exports.f();
}

// Each (bump) adds 11; three sites → 33.
const EXPECT = 33;
const cases = {
  'bare two-form body':   '(defmacro (bump) (global.set $g (i32.add (global.get $g) (i32.const 1))) (global.set $g (i32.add (global.get $g) (i32.const 10))))',
  '(begin ...) body':     '(defmacro (bump) (begin (global.set $g (i32.add (global.get $g) (i32.const 1))) (global.set $g (i32.add (global.get $g) (i32.const 10)))))',
  'single-form body':     '(defmacro (bump) (global.set $g (i32.add (global.get $g) (i32.const 11))))',
  'nested multi-form macro inside a multi-form macro':
    '(defmacro (one) (global.set $g (i32.add (global.get $g) (i32.const 1))) (global.set $g (i32.add (global.get $g) (i32.const 2))))\n' +
    '(defmacro (bump) (one) (global.set $g (i32.add (global.get $g) (i32.const 8))))',
};
for (const [name, macro] of Object.entries(cases)) {
  const got = run(macro);
  ok(got === EXPECT, `${name}: f() = ${got} (expected ${EXPECT})`);
}

// A macro whose body is spliced must not disturb the forms around it: the
// sibling AFTER the expansion has to survive too (a splice that replaced the
// tail would still pass the sum above if it dropped nothing but reordered).
{
  const src = [
    '(global $g (mut i32) (i32.const 0))',
    '(defmacro (twice) (global.set $g (i32.mul (global.get $g) (i32.const 2))) (global.set $g (i32.mul (global.get $g) (i32.const 2))))',
    '(func $f (export "f") (result i32) (effects)',
    '  (global.set $g (i32.const 1))',
    '  (twice)',
    '  (global.set $g (i32.add (global.get $g) (i32.const 1)))', // (1*4)+1 = 5
    '  (global.get $g))',
  ].join('\n');
  const r = compile(src, new Map(), { mode: 'production' });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(r.wasmBinary), {});
  const got = inst.exports.f();
  ok(got === 5, `forms after a spliced expansion survive in order: f() = ${got} (expected 5)`);
}

console.log(`\n${checks} checks, all PASS`);
