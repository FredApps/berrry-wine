#!/usr/bin/env node

'use strict';

// AVIFILE.163 AVIStreamFindSample(pavi, lPos, lFlags) on the Win16 AVIFILE.
//
// Civilization II's Win16 movie player calls it with FIND_NEXT|FIND_KEY to
// pick the frame to resume from once decoding falls behind the clock, which in
// a browser is most of the time. The ordinal was missing, so the intro trapped
// a few frames in.
//
// The file block, its stream and the chunk index are laid down directly in
// two arena segments in the layout src/09e-win16-api.wat documents (see
// "AVIFILE / MSVIDEO"): an index record is {stream | AVIIF_KEYFRAME<<4,
// file offset, size}. Stream 1's chunks are interleaved between stream 0's,
// the way an audio track is, and must not be counted as stream 0's samples.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (global $tfs_file (mut i32) (i32.const 0))

  ;; File block in one segment, index in another; returns the stream's far ptr.
  (func (export "tfs_setup") (param $start i32) (param $samplesize i32) (result i32)
    (local $fsel i32) (local $isel i32) (local $b i32) (local $ib i32) (local $n i32)
    (call $win16_next_seg_set (i32.const 1))
    (local.set $fsel (call $win16_index_to_sel (call $win16_alloc_segment)))
    (local.set $isel (call $win16_index_to_sel (call $win16_alloc_segment)))
    (local.set $b (call $win16_far_to_guest (local.get $fsel) (i32.const 0)))
    (local.set $ib (call $win16_far_to_guest (local.get $isel) (i32.const 0)))
    (call $gs32 (local.get $b) (i32.const 0x46495641))                    ;; 'AVIF'
    (call $gs32 (i32.add (local.get $b) (i32.const 8)) (i32.const 2))     ;; streams
    (call $gs32 (i32.add (local.get $b) (i32.const 0x100)) (i32.const 0x53495641))
    (call $gs32 (i32.add (local.get $b) (i32.const 0x300)) (i32.const 0x53495641))
    (call $gs32 (i32.add (local.get $b) (i32.const 0x124)) (local.get $start))
    (call $gs32 (i32.add (local.get $b) (i32.const 0x128)) (i32.const 6)) ;; dwLength
    (call $gs32 (i32.add (local.get $b) (i32.const 0x134)) (local.get $samplesize))
    (call $gs32 (i32.add (local.get $b) (i32.const 0x54)) (local.get $isel))
    ;; Stream 0: k0 key, k1, k2, k3 key, k4 empty (a dropped frame), k5.
    ;; A keyed stream-1 chunk sits between each.
    (call $tfs_rec (local.get $ib) (i32.const 0) (i32.const 0x100) (i32.const 64))
    (call $tfs_rec (local.get $ib) (i32.const 1) (i32.const 0x101) (i32.const 32))
    (call $tfs_rec (local.get $ib) (i32.const 2) (i32.const 0x000) (i32.const 64))
    (call $tfs_rec (local.get $ib) (i32.const 3) (i32.const 0x101) (i32.const 32))
    (call $tfs_rec (local.get $ib) (i32.const 4) (i32.const 0x000) (i32.const 64))
    (call $tfs_rec (local.get $ib) (i32.const 5) (i32.const 0x101) (i32.const 32))
    (call $tfs_rec (local.get $ib) (i32.const 6) (i32.const 0x100) (i32.const 64))
    (call $tfs_rec (local.get $ib) (i32.const 7) (i32.const 0x000) (i32.const 0))
    (call $tfs_rec (local.get $ib) (i32.const 8) (i32.const 0x101) (i32.const 32))
    (call $tfs_rec (local.get $ib) (i32.const 9) (i32.const 0x000) (i32.const 64))
    (call $gs32 (i32.add (local.get $b) (i32.const 0x58)) (i32.const 10))
    (global.set $tfs_file (local.get $fsel))
    (i32.or (i32.shl (local.get $fsel) (i32.const 16)) (i32.const 0x100)))

  (func $tfs_rec (param $ib i32) (param $i i32) (param $w i32) (param $size i32)
    (local $e i32)
    (local.set $e (i32.add (local.get $ib) (i32.mul (local.get $i) (i32.const 12))))
    (call $gs32 (local.get $e) (local.get $w))
    (call $gs32 (i32.add (local.get $e) (i32.const 4)) (i32.mul (local.get $i) (i32.const 100)))
    (call $gs32 (i32.add (local.get $e) (i32.const 8)) (local.get $size)))

  ;; FindSample(pavi, lPos, lFlags) with a Pascal frame on the file segment's
  ;; own top; returns DX:AX.
  (func (export "tfs_find") (param $pavi i32) (param $pos i32) (param $flags i32) (result i32)
    (local $esp i32)
    (local.set $esp (i32.add (call $win16_far_to_guest (global.get $tfs_file) (i32.const 0))
                             (i32.const 0xF000)))
    (i32.store offset=16 (global.get $reg_base) (local.get $esp))
    (call $gs16 (local.get $esp) (i32.const 0x100))
    (call $gs16 (i32.add (local.get $esp) (i32.const 2)) (global.get $tfs_file))
    (call $gs32 (i32.add (local.get $esp) (i32.const 4)) (local.get $flags))
    (call $gs32 (i32.add (local.get $esp) (i32.const 8)) (local.get $pos))
    (call $gs32 (i32.add (local.get $esp) (i32.const 12)) (local.get $pavi))
    (call $win16_AVIStreamFindSample)
    (i32.or (i32.and (i32.load offset=0 (global.get $reg_base)) (i32.const 0xFFFF))
            (i32.shl (i32.load offset=8 (global.get $reg_base)) (i32.const 16))))
`;

(async () => {
  const { exports: e } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const NEXT = 1, PREV = 4, FROM_START = 8, KEY = 0x10, ANY = 0x20;

  const pavi = e.tfs_setup(2, 0) >>> 0;   // samples 2..7
  const find = (pos, flags) => e.tfs_find(pavi, pos, flags) | 0;

  assert.strictEqual(find(2, NEXT | KEY), 2, 'a key frame is its own next key');
  assert.strictEqual(find(3, NEXT | KEY), 5, 'next key skips non-key frames');
  assert.strictEqual(find(3, KEY), 5, 'FIND_NEXT is the default direction');
  assert.strictEqual(find(4, PREV | KEY), 2, 'previous key');
  assert.strictEqual(find(7, PREV | KEY), 5, 'previous key from the last frame');
  assert.strictEqual(find(6, NEXT | KEY), -1, 'no key after the last one');
  assert.strictEqual(find(100, FROM_START | KEY), 2, 'FIND_FROM_START ignores lPos');
  assert.strictEqual(find(6, NEXT | ANY), 7, 'FIND_ANY skips an empty chunk');
  assert.strictEqual(find(4, NEXT | ANY), 4, 'FIND_ANY takes any chunk with data');

  const audio = e.tfs_setup(2, 4) >>> 0;  // fixed-size samples
  assert.strictEqual(e.tfs_find(audio, 4, NEXT | KEY) | 0, 4, 'fixed-size samples are all key');
  assert.strictEqual(e.tfs_find(audio, 9, NEXT | KEY) | 0, -1, 'past the stream is -1');

  console.log('PASS  Win16 AVIStreamFindSample finds key and non-empty samples per stream');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
