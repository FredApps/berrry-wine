#!/usr/bin/env node
'use strict';

// KERNEL.96 FreeLibrary must give a module's selector-arena slots back, and
// only when its last LoadLibrary reference goes. Civilization II loads and
// frees a resource DLL for every wonder video, throne room, advisor portrait
// and city view; with the slots never returned, a long campaign hit "selector
// arena exhausted" inside LoadLibrary and the process died.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = `
  (func (export "test_init")
    (global.set $WIN16_THUNK_SEL (call $win16_index_to_sel (i32.const 3)))
    (call $win16_seg_set (i32.const 1) (i32.const 0x100000) (i32.const 65536) (i32.const 0) (i32.const 1))
    (call $win16_seg_set (i32.const 2) (i32.const 0x110000) (i32.const 65536) (i32.const 1) (i32.const 2))
    (call $win16_seg_set (i32.const 3) (i32.const 0x120000) (i32.const 65536) (i32.const 0) (i32.const 3))
    (global.set $code16 (i32.const 1))
    (call $win16_set_sreg (i32.const 1) (call $win16_index_to_sel (i32.const 1)))
    (call $win16_set_sreg (i32.const 2) (call $win16_index_to_sel (i32.const 2)))
    (call $win16_next_seg_set (i32.const 40)))
  (func (export "test_staging") (param $id i32) (result i32) (call $win16_dll_staging (local.get $id)))
  (func (export "test_load") (param $id i32) (param $size i32) (result i32)
    (call $load_ne_dll_sized (local.get $id) (local.get $size)))
  (func (export "test_first_index") (param $id i32) (result i32)
    (i32.add (i32.load offset=4 (call $win16_dll_rec (local.get $id))) (i32.const 1)))
  (func (export "test_loaded") (param $id i32) (result i32) (call $win16_dll_loaded (local.get $id)))
  (func (export "test_set_refs") (param $id i32) (param $n i32)
    (i32.store (call $win16_dll_refs_ptr (local.get $id)) (local.get $n)))
  (func (export "test_next") (result i32) (call $win16_next_seg_get))
  (func (export "test_limit") (param $i i32) (result i32) (call $win16_seg_limit (local.get $i)))
  (func (export "test_slot_base") (param $i i32) (result i32) (call $win16_arena_slot_base (local.get $i)))
  (func (export "test_free_head") (param $i i32) (result i32)
    (if (result i32) (call $win16_arena_free_head (local.get $i))
      (then (call $win16_gseg_count (call $win16_gseg_field (local.get $i) (i32.const 12))))
      (else (i32.const 0))))
  (func (export "test_galloc") (param $bytes i32) (result i32)
    (call $win16_sel_to_index (call $win16_global_alloc (local.get $bytes))))
  (func (export "test_gfree") (param $i i32)
    (call $win16_global_free (call $win16_index_to_sel (local.get $i))))
  (func (export "test_free_library") (param $id i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0x110800))
    (call $gs16 (i32.const 0x110800) (i32.const 0x40))
    (call $gs16 (i32.const 0x110802) (i32.const 0x000f))
    (call $gs16 (i32.const 0x110804)
      (call $win16_h16 (i32.or (i32.const 0x00D10000) (local.get $id))))
    (call $win16_FreeLibrary))
  (func (export "test_sp") (result i32) (i32.load offset=16 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.test_init();
  const mem = () => new Uint8Array(memory.buffer);

  // A two-segment NE: segment 1 holds 16 bytes of code at file offset 0x100,
  // segment 2 is 0x80 bytes of zero-filled data. No relocations, no DGROUP.
  const ID = 13, SIZE = 0x200;
  function stage(marker) {
    const b = e.test_staging(ID), m = mem();
    m.fill(0, b, b + SIZE);
    const w16 = (o, v) => { m[b + o] = v & 255; m[b + o + 1] = v >>> 8; };
    w16(0, 0x5A4D); w16(0x3C, 0x40);
    const ne = 0x40;
    w16(ne, 0x454E);
    w16(ne + 0x1C, 2);        // segment count
    w16(ne + 0x22, 0x40);     // segment table, relative to the NE header
    w16(ne + 0x32, 4);        // alignment shift
    const st = ne + 0x40;
    w16(st + 0, 0x10); w16(st + 2, 0x10); w16(st + 4, 0); w16(st + 6, 0x100);
    w16(st + 8, 0);    w16(st + 10, 0);   w16(st + 12, 1); w16(st + 14, 0x80);
    m.fill(marker, b + 0x100, b + 0x110);
  }
  const RUN = 3;              // two segments and one metadata page

  stage(0xA1);
  assert.strictEqual(e.test_load(ID, SIZE), 1);
  const first = e.test_first_index(ID);
  assert.strictEqual(first, 40, 'the first load takes fresh slots at the cursor');
  assert.strictEqual(e.test_next(), 40 + RUN);
  assert.strictEqual(e.test_limit(first), 0x100);
  assert.strictEqual(e.guest_read8(e.test_slot_base(first)), 0xA1);

  // Two LoadLibrary references: the first FreeLibrary keeps it.
  e.test_set_refs(ID, 2);
  e.test_free_library(ID);
  assert.strictEqual(e.test_sp(), 0x110806, 'FreeLibrary pops its argument');
  assert.ok(e.test_loaded(ID), 'a module with a reference left stays loaded');
  assert.strictEqual(e.test_free_head(first), 0, 'and keeps its slots');

  e.test_free_library(ID);
  assert.strictEqual(e.test_loaded(ID), 0, 'the last reference unloads');
  assert.strictEqual(e.test_free_head(first), RUN, 'its whole run is one free block');
  assert.strictEqual(e.test_limit(first), 0x10000, 'with plain slot descriptors');

  // A global block reuses the front of the run and leaves the rest free.
  const g = e.test_galloc(0x10000);
  assert.strictEqual(g, first, 'GlobalAlloc takes the freed slots');
  assert.strictEqual(e.test_free_head(first + 1), RUN - 1);
  e.test_gfree(g);

  // Reloading joins the two free blocks back into one run and lands on it.
  stage(0xB2);
  assert.strictEqual(e.test_load(ID, SIZE), 1);
  assert.strictEqual(e.test_first_index(ID), first, 'a reload reuses the freed run');
  assert.strictEqual(e.test_next(), 40 + RUN, 'without advancing the cursor');
  assert.strictEqual(e.guest_read8(e.test_slot_base(first)), 0xB2, 'with the new image in place');
  assert.strictEqual(e.guest_read8(e.test_slot_base(first) + 0x10), 0, 'and the rest of the slot cleared');

  // Load and free many times: the cursor never moves again.
  for (let i = 0; i < 50; i++) {
    e.test_set_refs(ID, 1);
    e.test_free_library(ID);
    stage(i);
    assert.strictEqual(e.test_load(ID, SIZE), 1);
  }
  assert.strictEqual(e.test_first_index(ID), first);
  assert.strictEqual(e.test_next(), 40 + RUN, 'fifty load/free cycles cost no arena slots');

  console.log('PASS  Win16 FreeLibrary returns a module\'s arena slots after its last reference');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
