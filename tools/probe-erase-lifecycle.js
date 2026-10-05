#!/usr/bin/env node
'use strict';

// Diagnostic-only builds; never modifies src/ or the shipping artifact.
// Usage: node tools/probe-erase-lifecycle.js <test/run.js args>
// The former BeginPaint candidate is now integrated; trace current sources.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compileSrcWasm } = require('../test/compile-src');
const imports = require('../lib/host-imports');
const args = process.argv.slice(2);
if (args.some(a => /^--wasm(?:=|$)/.test(a))) {
  throw Error('This probe owns --wasm; pass ordinary app/input/budget arguments only.');
}
if (args.includes('--threads')) throw Error('Use cooperative mode: real Worker imports are not instrumented by this probe.');
if (args.includes('--candidate')) throw Error('BeginPaint callbacks are now integrated; omit --candidate.');

function replaceOnce(source, from, to, label) {
  if (source.split(from).length !== 2) throw Error(`ambiguous/missing probe anchor: ${label}`);
  return source.replace(from, to);
}

function instrument(file, source) {
  if (file === '10-helpers.wat') {
    for (const [name, event, store] of [
      ['set', -1001, '(i32.store (local.get $addr) (i32.or (local.get $old) (local.get $bits)))'],
      ['clear', -1002, '(i32.store (local.get $addr) (local.get $new))'],
    ]) {
      const start = source.indexOf(`(func $nc_flags_${name} `);
      const end = source.indexOf('\n  (func ', start + 1);
      const body = source.slice(start, end);
      const trace = `(if (i32.and (local.get $bits) (i32.const 2))
      (then (call $host_erase_trace (local.get $hwnd) (local.get $bits)
        (i32.const ${event}) (local.get $old))))\n    `;
      source = source.slice(0, start) + replaceOnce(body, store, trace + store, name) + source.slice(end);
    }
    const start = source.indexOf('(func $nc_flags_scan ');
    const end = source.indexOf('\n  (func ', start + 1);
    const body = source.slice(start, end);
    const store = '(i32.store (local.get $ptr) (local.get $new))';
    const trace = `(if (i32.and (local.get $mask) (i32.const 2))
                (then (call $host_erase_trace (local.get $hwnd) (local.get $mask)
                  (i32.const -1005) (local.get $flags))))\n              `;
    source = source.slice(0, start) + replaceOnce(body, store, trace + store, 'hidden scan') + source.slice(end);
  }
  if (file === '09a-handlers2-runtime.wat') {
    const start = source.indexOf('(func $begin_paint_core ');
    const end = source.indexOf('\n  ;; 243: BeginPaint', start);
    if (start < 0 || end < 0) throw Error('missing BeginPaint core');
    let body = source.slice(start, end);
    body = replaceOnce(body, '    ;; Fill PAINTSTRUCT:',
      `    (call $host_erase_trace (local.get $arg0) (call $wnd_get_bg_brush (local.get $arg0))
      (i32.const -1003) (call $nc_flags_test (local.get $arg0)))
    ;; Fill PAINTSTRUCT:`, 'begin entry');
    const trace = `(call $host_erase_trace (local.get $arg0)
      (call $gl32 (i32.add (local.get $arg1) (i32.const 4)))
      (i32.const -1004) (call $nc_flags_test (local.get $arg0)))`;
    body = replaceOnce(body, '    (local.get $hdc))', `    ${trace}\n    (local.get $hdc))`, 'begin result');
    body = replaceOnce(body, '(return (local.get $hdc))))',
      `${trace}\n        (return (local.get $hdc))))`, 'Win32 result');
    source = source.slice(0, start) + body + source.slice(end);
  }
  if (file === '09e-win16-api.wat') {
    const start = source.indexOf('(func $win16_beginpaint_finish ');
    const end = source.indexOf('\n  (func ', start + 1);
    const body = source.slice(start, end);
    source = source.slice(0, start) + replaceOnce(body, '(call $win16_cont_resume)',
      `(call $host_erase_trace (local.get $hwnd) (i32.eqz (local.get $handled))
        (i32.const -1006) (call $nc_flags_test (local.get $hwnd)))
      (call $win16_cont_resume)`, 'far BeginPaint result') + source.slice(end);
  }
  return source;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-erase-lifecycle-'));
const wasm = path.join(dir, 'probe.wasm');
fs.writeFileSync(wasm, compileSrcWasm(instrument));
console.log(`[erase-state] artifact=${wasm}`);
console.log('[erase-state] value=set/clear mask, begin brush, result fErase; flags=pre-transition NC_FLAGS');
const create = imports.createHostImports;
imports.createHostImports = ctx => {
  const result = create(ctx), ordinary = result.host.erase_trace;
  result.host.erase_trace = (hwnd, value, event, flags) => {
    const names = { '-1001': 'set', '-1002': 'clear', '-1003': 'begin', '-1004': 'result', '-1005': 'hidden-scan', '-1006': 'far-result' };
    const name = names[event];
    if (!name) return ordinary(hwnd, value, event, flags);
    const e = ctx.exports || ctx.instance?.exports;
    const hex = n => '0x' + (n >>> 0).toString(16);
    const sp = e?.get_esp?.() || 0;
    console.log(`[erase-state] ${name} hwnd=${hex(hwnd)} value=${hex(value)} flags=${hex(flags)}`
      + ` eip=${hex(e?.get_eip?.() || 0)} caller=${hex(sp ? e.guest_read32(sp) : 0)}`);
  };
  return result;
};
process.argv = [process.argv[0], require.resolve('../test/run'),
  ...args, '--no-build', `--wasm=${wasm}`, '--quiet-api', '--quiet-blocks'];
require('../test/run');
