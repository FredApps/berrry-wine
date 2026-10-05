#!/usr/bin/env node
'use strict';
// GetSystemTime / GetLocalTime (16-byte SYSTEMTIME) and GetSystemTimeAsFileTime
// (8-byte FILETIME) write into the guest's buffer. The host's wall_clock import
// writes one contiguous record, so handing it a raw $g2w of the guest pointer
// spills the tail of a record that straddles two sparse guest pages into
// whatever WASM memory follows the first page. This maps two sparse pages that
// are NOT adjacent in WASM memory and walks the record across every split,
// through the real lib/host-imports.js wall_clock on a pinned clock.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e, hostCtx } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (func (export "map_time_page") (param $ga i32) (result i32)
      (call $virtual_map_commit (local.get $ga) (i32.const 4096)))
    (func (export "call_time") (param $which i32) (param $out i32)
      (i32.store offset=16 (global.get $reg_base) (i32.const 0x074ff000))
      (if (i32.eq (local.get $which) (i32.const 0))
        (then (call $handle_GetSystemTime (local.get $out)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
      (if (i32.eq (local.get $which) (i32.const 1))
        (then (call $handle_GetLocalTime (local.get $out)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
      (if (i32.eq (local.get $which) (i32.const 2))
        (then (call $handle_GetSystemTimeAsFileTime (local.get $out)
          (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))))
  ` });

  // 1999-06-01T12:34:56.789Z, a Tuesday. Every SYSTEMTIME field is nonzero.
  const NOW = Date.UTC(1999, 5, 1, 12, 34, 56, 789);
  hostCtx.wallNowMs = () => NOW;

  const le16 = v => [v & 0xff, (v >> 8) & 0xff];
  const systemtime = (d, local) => {
    const g = n => d[`${local ? 'get' : 'getUTC'}${n}`]();
    return [g('FullYear'), g('Month') + 1, g('Day'), g('Date'),
      g('Hours'), g('Minutes'), g('Seconds'), g('Milliseconds')].flatMap(le16);
  };
  const ft = 116444736000000000n + BigInt(NOW) * 10000n;
  const filetime = Array.from({ length: 8 }, (_, i) => Number((ft >> BigInt(8 * i)) & 0xffn));
  const expected = [
    systemtime(new Date(NOW), false),
    systemtime(new Date(NOW), true),
    filetime,
  ];
  assert.deepStrictEqual(expected[0], [1999, 6, 2, 1, 12, 34, 56, 789].flatMap(le16));

  const page = 0x30000000, unrelated = 0x28000000;
  for (const ga of [page, unrelated, page + 4096]) {
    assert.strictEqual(e.map_time_page(ga) >>> 0, ga);
  }
  assert.notStrictEqual(e.guest_to_wasm(page + 4096), e.guest_to_wasm(page) + 4096,
    'the two pages must not be adjacent in WASM memory, or the test proves nothing');
  const read = (ga, n) => Array.from({ length: n }, (_, i) => e.guest_read8(ga + i));
  for (let i = 0; i < 4096; i++) e.guest_write8(unrelated + i, 0xa5);
  // Whatever sits right after the first page in WASM memory: a spilled tail
  // lands here.
  const spillWA = e.guest_to_wasm(page) + 4096;
  const mem = () => new Uint8Array(hostCtx.getMemory());
  const spillBefore = Array.from(mem().subarray(spillWA, spillWA + 16));

  let crossings = 0;
  for (let which = 0; which < 3; which++) {
    const len = which === 2 ? 8 : 16;
    for (let split = 0; split <= len; split++) {
      const out = page + 4096 - split;
      for (let i = -1; i <= len; i++) e.guest_write8(out + i, 0xcc);
      e.call_time(which, out);
      assert.deepStrictEqual(read(out - 1, len + 2), [0xcc, ...expected[which], 0xcc],
        `api=${which} split=${split}`);
      assert.strictEqual(e.get_esp() >>> 0, 0x074ff008, 'stdcall, one argument');
      if (split > 0 && split < len) crossings++;
    }
  }
  assert.deepStrictEqual(Array.from(mem().subarray(spillWA, spillWA + 16)), spillBefore,
    'nothing spilled past the first page in WASM memory');
  assert.deepStrictEqual(read(unrelated, 4096), new Array(4096).fill(0xa5));

  // NULL: no span, the host writes nothing, the stack is still cleaned up.
  for (let which = 0; which < 3; which++) {
    e.call_time(which, 0);
    assert.strictEqual(e.get_esp() >>> 0, 0x074ff008);
  }
  console.log(`PASS GetSystemTime/GetLocalTime/GetSystemTimeAsFileTime: ${crossings} sparse crossings, real host wall_clock, spill and canary checks, NULL, stdcall`);
})().catch(error => { console.error(error); process.exitCode = 1; });
