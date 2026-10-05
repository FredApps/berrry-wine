#!/usr/bin/env node
//
// A cycle in the guest heap's free list must not be able to wedge the
// emulator, and freeing the same block twice must not create one.
//
// This is the shape WordPad hits on exit. Type into the document, close the
// window, answer its "Save changes to Document?" box, and MFC's teardown frees
// one block twice: free(B) while the list head is A, then free(A) again, which
// leaves A -> B -> A. $heap_alloc's free-list walk then follows guest-owned
// next pointers forever *inside a single WASM call*. Nothing rescues that --
// the block budget counts guest blocks and this loop retires none, no host
// import is called so no log line ever appears, --max-seconds is only checked
// between batches, and the process cannot even be SIGTERMed, because the
// signal handler is JS. The app looks frozen on its own modal.
//
// Two guarantees are pinned here:
//   1. $heap_free refuses to link a block that is already on the list, so the
//      cycle is never built in the first place.
//   2. $heap_alloc's walk is bounded and cuts the list when it trips, so a
//      cycle arriving by any other route (a use-after-free write into a free
//      block's next pointer, say) still terminates.
//
// A regression here HANGS rather than failing, so run it with a timeout.
'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "set_free_list") (param i32) (global.set $free_list (local.get 0)))
  (func (export "test_set_heap_arena") (param $base i32) (param $ptr i32)
    (global.set $image_base (i32.const 0))
    (global.set $heap_base (local.get $base))
    (global.set $heap_ptr (local.get $ptr))
    (global.set $heap_end (i32.add (local.get $ptr) (i32.const 0x10000)))
    (i32.atomic.store (global.get $HEAP_SHARED) (global.get $heap_end))
    (call $zero_memory (global.get $HEAP_ARENAS) (global.get $HEAP_ARENAS_SIZE))
    (global.set $heap_arena_record (call $heap_arena_register
      (local.get $base) (global.get $heap_end)))
    (i32.atomic.store offset=8 (global.get $heap_arena_record) (local.get $ptr))
    (global.set $free_list (i32.const 0)))
`;

function putBlock(wat, at, size, next) {
  for (let i = 0; i < 4; i++) {
    wat.guest_write8(at + i, (size >>> (i * 8)) & 0xff);
    wat.guest_write8(at + 4 + i, (next >>> (i * 8)) & 0xff);
  }
}

function readWord(wat, at) {
  let v = 0;
  for (let i = 3; i >= 0; i--) v = (v * 256) + (wat.guest_read8(at + i) & 0xff);
  return v >>> 0;
}

// Follow next pointers with our own bound so a still-cyclic list is reported
// as a failure instead of hanging the test too.
function chainLength(wat, head, cap = 4096) {
  let n = 0;
  let cur = head >>> 0;
  while (cur && n < cap) { cur = readWord(wat, cur + 4); n++; }
  return { n, terminated: cur === 0 };
}

(async () => {
  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });

  const BASE = 0x00100000;
  const TOP = 0x00110000;
  const A = 0x00108000;
  const B = 0x00108030;

  // --- 1. an existing cycle must not hang the allocator ---------------------
  // Both blocks are 0x30 bytes, so a 0x400 request fits neither and the walk
  // has no reason to stop on its own.
  wat.test_set_heap_arena(BASE, TOP);
  putBlock(wat, A, 0x30, B);
  putBlock(wat, B, 0x30, A);
  wat.set_free_list(A);

  const served = wat.guest_alloc(0x400) >>> 0;
  assert(served >= TOP,
    `a request no block in the cycle can satisfy bump-allocates instead of ` +
    `spinning (got 0x${served.toString(16)})`);
  console.log('PASS  heap_alloc terminates on a cyclic free list');

  const after = chainLength(wat, wat.get_free_list() >>> 0);
  assert(after.terminated,
    `and the list is cut on the way out, so the next allocation cannot walk ` +
    `back into the cycle (still looping after ${after.n} links)`);
  console.log('PASS  the cycle is cut, not merely survived');

  // The allocator must still be usable afterwards: the surviving prefix of the
  // list is fair game, and so is the bump arena.
  const again = wat.guest_alloc(0x20) >>> 0;
  assert(again >= BASE && again < TOP + 0x10000,
    `the heap keeps serving requests after the cut (got 0x${again.toString(16)})`);
  console.log('PASS  allocation still works after the cut');

  // --- 2. a double free must not build a cycle ------------------------------
  wat.test_set_heap_arena(BASE, TOP);
  putBlock(wat, A, 0x30, 0);
  putBlock(wat, B, 0x30, 0);

  wat.guest_free(A + 4);          // head: A
  wat.guest_free(B + 4);          // head: B -> A
  wat.guest_free(A + 4);          // the double free: must not relink A

  const list = chainLength(wat, wat.get_free_list() >>> 0);
  assert(list.terminated,
    `freeing the same block twice must leave an acyclic list ` +
    `(still looping after ${list.n} links)`);
  assert.strictEqual(list.n, 2,
    `and must not duplicate the block either (found ${list.n} entries)`);
  console.log('PASS  heap_free refuses to link a block already on the list');

  // The blocks are still allocatable, i.e. the guard dropped the duplicate
  // link rather than the block.
  wat.test_set_heap_arena(BASE, TOP);
  putBlock(wat, A, 0x30, 0);
  wat.guest_free(A + 4);
  wat.guest_free(A + 4);
  const reused = wat.guest_alloc(0x10) >>> 0;
  assert(reused >= A + 4 && reused < A + 0x30,
    `a doubly freed block is still served once (got 0x${reused.toString(16)})`);
  console.log('PASS  a doubly freed block is still recycled exactly once');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
