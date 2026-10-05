#!/usr/bin/env node

'use strict';

// Two WASM instances over ONE shared memory must not give two windows the same
// sibling stacking rank.
//
// This is the shape of every guest thread under `--threads` and under the
// browser's Worker backend: thread-manager.js instantiates the same module
// again against the same WebAssembly.Memory. Memory is shared, but a WASM
// `(global (mut i32))` belongs to the INSTANCE — and the z-order sequence used
// to be one ($wnd_z_next). Both copies start at zero, so the first window a
// worker registers was handed rank 1024, which the main instance had already
// given to one of its own.
//
// That is a rendering bug, not a bookkeeping one: $wnd_z_is_above_sibling
// compares ranks with a strict i32.gt_s, so a tie reads as "not above". A
// popup, dialog or child created or raised on a secondary thread composites
// UNDER the sibling it is meant to cover, and nothing reports it.
//
// It is reachable from real apps, not just in principle: with `--threads`,
// icy_tower's ONLY CreateWindowExA and the ShowWindow that follows it are both
// made by guest thread T1 (`--trace-api` prints them as `[API T1]`), i.e. from
// a worker instance whose rank sequence had never been advanced.
//
// The fix keeps the sequence in the table that is already shared:
// $wnd_z_assign_top scans WND_Z_ORDER_TABLE for the current maximum under
// $LOCK_WND and stores max+1024. Nothing to replicate, so nothing to diverge.

const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');

let passed = 0;
let failed = 0;
function check(ok, label, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

// One module, N instances, one memory — exactly how a guest thread is born.
async function boot(count) {
  const wasmBytes = compileSrcWasm((file, source) => file === '13-exports.wat' ? source + `
    (func (export "test_raise_group") (param $h i32) (call $wnd_z_raise_owner_group (local.get $h)))
    (func (export "test_owner") (param $h i32) (param $owner i32)
      (call $wnd_set_owner (local.get $h) (local.get $owner)))
  ` : source);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const instances = [];
  for (let i = 0; i < count; i++) {
    const ctx = {
      getMemory: () => memory.buffer,
      resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} },
      onExit: () => {},
    };
    const base = createHostImports(ctx);
    base.host.memory = memory;
    for (const stub of ['create_thread', 'exit_thread', 'terminate_thread', 'create_event',
      'set_event', 'reset_event', 'wait_single', 'wait_multiple']) base.host[stub] = () => 0;
    const { instance } = await WebAssembly.instantiate(wasmBytes, base);
    ctx.exports = instance.exports;
    instances.push(instance.exports);
  }
  return instances;
}

(async () => {
  const [main, worker] = await boot(2);
  const WAT_WNDPROC = 0xFFFF0001;

  // Two windows from the UI thread's instance, then two from a guest thread's.
  const MAIN_A = 0x10001, MAIN_B = 0x10002;
  const WORK_A = 0x10003, WORK_B = 0x10004;
  main.wnd_table_set(MAIN_A, WAT_WNDPROC);
  main.wnd_table_set(MAIN_B, WAT_WNDPROC);
  worker.wnd_table_set(WORK_A, WAT_WNDPROC);
  worker.wnd_table_set(WORK_B, WAT_WNDPROC);

  const hwnds = [MAIN_A, MAIN_B, WORK_A, WORK_B];
  const ranks = hwnds.map(h => main.wnd_z_get(h));
  const ranksLabel = hwnds
    .map((h, i) => `0x${h.toString(16)}=${ranks[i]}`).join(' ');
  check(new Set(ranks).size === ranks.length,
    'four windows across two instances get four distinct z ranks', ranksLabel);
  check(ranks.every(r => r > 0), 'every registered window has a rank', ranksLabel);

  // The rank the worker's instance assigns must be above everything the main
  // instance already handed out — that is what the sequence is for.
  check(Math.min(ranks[2], ranks[3]) > Math.max(ranks[0], ranks[1]),
    'a window created on the worker instance outranks the earlier main ones',
    ranksLabel);

  // The consequence, read through the comparison the compositor actually uses.
  // All four are top-level (parent 0), so they are siblings. Note the argument
  // order: $wnd_z_is_above_sibling(hwnd, sibling) answers "is SIBLING above
  // hwnd", which is how the paint walk asks whether anything covers a window.
  const VISIBLE = 0x10000000;
  for (const h of hwnds) main.wnd_set_style_export(h, VISIBLE);
  check(main.wnd_z_is_above_sibling(MAIN_A, WORK_A) === 1,
    'the worker window reads as covering the main window it was stacked over');
  check(worker.wnd_z_is_above_sibling(WORK_A, MAIN_A) === 0,
    'and the main window does not read as covering it');

  // A raise from the worker instance must also clear every existing rank,
  // including ones only the main instance ever issued. HWND_TOP == 0.
  worker.wnd_z_set_after(MAIN_A, 0);
  const raised = main.wnd_z_get(MAIN_A);
  check(raised > Math.max(...hwnds.filter(h => h !== MAIN_A).map(h => main.wnd_z_get(h))),
    'a raise issued from the worker instance goes above every other window',
    `0x${MAIN_A.toString(16)}=${raised}`);
  check(main.wnd_z_is_above_sibling(WORK_B, MAIN_A) === 1,
    'and the raised window reads as covering the newest worker window');

  main.test_owner(MAIN_B, MAIN_A);
  worker.test_owner(WORK_A, MAIN_A);
  worker.test_owner(WORK_B, WORK_A);
  worker.test_raise_group(MAIN_A);
  const groupRanks = hwnds.map(h => main.wnd_z_get(h));
  check(groupRanks.every((rank, i) => !i || rank > groupRanks[i - 1]),
    'worker group raise keeps root, sibling palettes, then nested popup in order', groupRanks.join(','));
  check(hwnds.every((h, i) => worker.wnd_z_get(h) === groupRanks[i]),
    'both instances observe exactly the same group ranks');
  main.wnd_set_style_export(WORK_B, 0);
  const hiddenRank = main.wnd_z_get(WORK_B);
  main.test_raise_group(MAIN_A);
  check(worker.wnd_z_get(WORK_B) === hiddenRank,
    'hidden owned window retains its rank across a group raise');

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed) process.exit(1);
})().catch(err => { console.error(err); process.exit(1); });
