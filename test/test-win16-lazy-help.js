#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const extraWat = String.raw`
  (func (export "help16_begin")
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 3) (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 3))
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
    (global.set $code16 (i32.const 1))
    (call $win16_set_sreg (i32.const 1) (global.get $WIN16_THUNK_SEL))
    (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
    (call $win16_set_sreg (i32.const 3) (call $win16_index_to_sel (i32.const 2)))
    (global.set $eip (i32.const 0x120080))
    (i32.store (i32.add (global.get $WIN16_THUNK_TABLE) (i32.const 0x80)) (i32.const 0x000200ab))
    (global.set $esp (i32.const 0x110100))
    (call $gs16 (i32.const 0x110100) (i32.const 0x3456))
    (call $gs16 (i32.const 0x110102) (call $win16_index_to_sel (i32.const 1)))
    ;; WinHelp(hwnd, far filename, HELP_CONTENTS, numeric data), Pascal order.
    (call $gs32 (i32.const 0x110104) (i32.const 0))
    (call $gs16 (i32.const 0x110108) (i32.const 3))
    (call $gs16 (i32.const 0x11010a) (i32.const 0x400))
    (call $gs16 (i32.const 0x11010c) (call $win16_index_to_sel (i32.const 2)))
    (call $gs16 (i32.const 0x11010e) (i32.const 0)))
  (func (export "help16_resume")
    (global.set $yield_flag (i32.const 0)) (global.set $yield_reason (i32.const 0))
    (call $win16_dispatch (i32.const 0x80) (i32.const 0x103456)))
  (func (export "help16_cs") (result i32) (global.get $sreg_cs))
  (func (export "help16_cs_base") (result i32) (global.get $seg_base_cs))
  (func (export "help16_code16") (result i32) (global.get $code16))
`;
(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'all' });
  const e = h.exports, vfs = h.hostCtx.vfs;
  const bytes = fs.readFileSync(path.join(__dirname, 'binaries/help/sol.hlp'));
  const cnt = Buffer.from(':Title Lazy Solitaire\r\n:Base sol.hlp\r\n1 Overview\r\n2 Rules=SOL_RULES\r\n');
  function mount(name, data, fail = false) {
    vfs.setProviderFile(name, { provider: new ChunkCache({ size: data.length,
      async readRange(off, len) { if (fail) throw Error('removed help media'); return data.slice(off, off + len); },
    }, { chunkSize: 1024, readAhead: 0, budget: new ChunkCacheBudget({ maxBytes: 0 }) }) });
  }
  function begin(name) {
    e.help16_begin();
    [...name, '\0'].forEach((ch, i) => e.guest_write8(0x110400 + i, ch.charCodeAt(0)));
  }
  function frame() { return Array.from({ length: 16 }, (_, i) => e.guest_read8(0x110100 + i)); }
  function parked(original, cs) {
    assert.strictEqual(e.get_esp(), 0x110100);
    assert.strictEqual(e.get_eip(), 0x120080);
    assert.strictEqual(e.help16_cs(), cs);
    assert.strictEqual(e.help16_cs_base(), 0x120000);
    assert.strictEqual(e.help16_code16(), 1);
    assert.strictEqual(e.get_yield_reason(), 12);
    assert.strictEqual(e.get_eax(), 0);
    assert.deepStrictEqual(frame(), original);
  }
  function returned(value) {
    assert.strictEqual(e.get_eax(), value);
    assert.strictEqual(e.get_esp(), 0x110110, 'far return + twelve Pascal argument bytes');
    assert.strictEqual(e.get_eip(), 0x103456);
    assert.strictEqual(e.help16_cs_base(), 0x100000);
    assert.strictEqual(e.help16_code16(), 1);
  }
  mount('c:\\sol.hlp', bytes); mount('c:\\sol.cnt', cnt);
  begin('c:\\sol.hlp');
  const original = frame(), cs = e.help16_cs();
  e.help16_resume(); parked(original, cs);
  let waits = 0;
  while (e.get_yield_reason() === 12 && waits < 8) {
    const pending = vfs.pendingRead;
    assert(pending);
    // Reenter without completing IO: neither Pascal frame nor CS may unwind.
    e.help16_resume(); parked(original, cs);
    await vfs.fillPendingRead(pending);
    e.help16_resume(); waits++;
    if (e.get_yield_reason() === 12) parked(original, cs);
  }
  assert(waits >= 2 && waits < 8, `HLP and CNT each park once (waits=${waits})`);
  returned(1);
  assert(e.get_help_topic_count() > 0);
  assert(e.get_help_cnt_node_count() > 0);
  assert(vfs.files.get('c:\\sol.hlp')._provider);
  mount('c:\\missing-media.hlp', bytes, true);
  begin('c:\\missing-media.hlp');
  const failedFrame = frame();
  e.help16_resume(); parked(failedFrame, cs);
  await vfs.fillPendingRead(vfs.pendingRead);
  e.help16_resume(); returned(0);
  assert.strictEqual(e.get_yield_reason(), 0);
  console.log('PASS Win16 lazy WinHelp: zero-cache HLP/CNT, repeated resumes preserve Pascal stack/CS, exact far return, terminal failure');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
