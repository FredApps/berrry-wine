#!/usr/bin/env node
'use strict';

// The two stream-idiom folds of docs/loop-idiom-superops-design.md §20:
//
//   461  $th_smk_tree_walk -- the Smacker one-bit Huffman descent, copied
//        verbatim out of StarCraft's smackw32.dll at 0x1000efad. That body is
//        byte-identical five times in that DLL and appears in seven different
//        SMACKW32.DLLs in test/binaries; with its two arms the pair at
//        0x1000efad/0x1000eecd is 16.9% of the starcraft-loading window.
//
//   462  $th_pcx_run -- Quake II's PCX/WAL run expander, copied verbatim out
//        of ref_soft.dll at 0x1000580c. Its five blocks are 24.6% of the
//        quake2-loading window.
//
// The interpreter is the oracle throughout: every case runs twice over
// identical inputs, folded and unfolded, and the two must agree on memory and
// on every register the loop touches. A wrong fold cannot pass by agreeing
// with a wrong hand-written expectation. The cases that matter are the ones a
// closed-form executor is most likely to get wrong:
//
//   * bit-buffer state at EVERY exit -- MM0 after N single-bit shifts, the
//     8-bit counter that wraps rather than borrowing into its high bytes, and
//     the SIXTEEN-bit compare the guest's leaf handling reads flags from;
//   * a descent long enough to hit the iteration cap, and to run on past it
//     with the accumulator already empty (the arm that is never taken in a
//     healthy Smacker stream and is exactly where a cap bug would hide);
//   * run lengths 0, 1, a non-multiple of four and the 63-byte maximum, since
//     the fill is a `rep stosd` plus a `rep stosb` tail and only a length
//     with a remainder exercises both;
//   * a zero-length run, which jumps PAST the cursor reload -- the one path
//     where the folded and threaded cursors could silently diverge;
//   * DF set, because two `rep stos` read it and the fold cannot bail into
//     the threaded blocks it replaced (its descriptor IS the loop head).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');

const EXTRA_WAT = `
  (func (export "test_sf_zf") (result i32)
    (i32.or (call $get_zf) (i32.shl (call $get_sf) (i32.const 1))))
  (func (export "test_set_mm0") (param $v i64) (global.set $mm0 (local.get $v)))
  (func (export "test_get_mm0") (result i64) (global.get $mm0))
  (func (export "test_set_df") (param $v i32) (global.set $df (local.get $v)))
`;

// smackw32.dll+0x1000efad, 37 bytes. Both branches are rel8 inside the body,
// and the only immediates are the shift count, the mask and the sibling
// offset, so it may be planted at any address.
const SMK = Uint8Array.from([
  0xc1, 0xea, 0x0d,                    // head:    shr   edx, 0xd
  0xfe, 0xc8,                          //          dec   al
  0x81, 0xe2, 0xf8, 0xff, 0x0f, 0x00,  //          and   edx, 0xffff8
  0x0f, 0x7e, 0xc5,                    //          movd  ebp, mm0
  0x0f, 0x73, 0xd0, 0x01,              //          psrlq mm0, 1
  0xc1, 0xed, 0x01,                    //          shr   ebp, 1
  0x72, 0x05,                          //          jb    descend
  0xba, 0x04, 0x00, 0x00, 0x00,        //          mov   edx, 4
  0x03, 0xca,                          // descend: add   ecx, edx
  0x8b, 0x11,                          //          mov   edx, [ecx]
  0x66, 0x3b, 0xda,                    //          cmp   bx, dx
  0x74, 0xdb,                          //          jz    head
]);

// ref_soft.dll+0x1000580c, 108 bytes, matched by FNV-1a body hash.
const PCX = Uint8Array.from(Buffer.from(
  '33c08a02428bc88954241081e1c000000080f9c075108bc833c08a0283e13f42' +
  '89542410eb05b9010000008bf14985f67e2c8d3c2b8ad88d71018afb8bce8bc3' +
  '8bd1c1e010668bc38b5c2418c1e902f3ab8bca83e10303eef3aa8b5424108b4c' +
  '241433c0668b41083be87e94', 'hex'));

// Internal nodes carry the marker in their low half and the bit==1 child
// offset in bits 13 and up: (off << 13) | marker, with `and 0xffff8` keeping
// the offset a multiple of eight. A leaf is anything whose low half is not
// the marker.
const MARKER = 0x1234;
const INTERNAL = ((8 << 13) | MARKER) >>> 0;   // >> 13 & 0xffff8 == 8
const LEAF = 0x99990042 >>> 0;

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ extraWat: EXTRA_WAT, fonts: 'none' });
  const fixture = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  new Uint8Array(memory.buffer).set(fixture, e.get_staging());
  assert(e.load_pe(fixture.length), 'fixture PE loads');

  const imageBase = e.get_image_base() >>> 0;
  const guestBase = e.get_guest_base() >>> 0;
  const wa = ga => (ga - imageBase + guestBase) >>> 0;

  const arena = e.guest_alloc(0x8000) >>> 0;
  const nodes = arena;             // 0x2000 bytes of Huffman tree
  const stack = arena + 0x2000;    // the PCX frame
  const srcBuf = arena + 0x3000;
  const dstBuf = arena + 0x4000;
  const hdrBuf = arena + 0x5000;

  let codeCursor = (imageBase + 0x2800) >>> 0;
  const nextCode = () => { const at = codeCursor; codeCursor = (at + 0x200) >>> 0; return at; };

  // Plant a body and park a self-jump immediately after it. The loop's own
  // fall-through target has to be decodable x86: `driveTo` stops the moment
  // EIP arrives there, but the decoder gets to it first, and the fixture's
  // own bytes at that address are not an instruction stream.
  const plant = (at, bytes) => {
    const m8 = new Uint8Array(memory.buffer);
    m8.set(bytes, wa(at));
    m8.set([0xeb, 0xfe], wa(at) + bytes.length);   // jmp $
  };

  // Drive until EIP leaves the body. A fold bills every block it swallowed
  // against $block_budget, so one e.run() is not guaranteed to finish a row.
  const driveTo = (exitEip, limit = 4096) => {
    for (let i = 0; i < limit && (e.get_eip() >>> 0) !== (exitEip >>> 0); i++) e.run(1);
    assert.strictEqual(e.get_eip() >>> 0, exitEip >>> 0, 'the loop reached its exit');
  };

  // ---------------------------------------------------------------- 461 ----
  assert.strictEqual(e.get_smk_tree(), 1, 'the tree fold is on by default');

  // leafAt is a byte offset from `nodes`; every other dword is internal, so a
  // walk terminates exactly when its cursor lands on that one.
  const plantTree = leafAt => {
    const dv = new DataView(memory.buffer);
    for (let off = 0; off < 0x2000; off += 4) dv.setUint32(wa(nodes + off), INTERNAL, true);
    dv.setUint32(wa(nodes + leafAt), LEAF, true);
  };

  const EAX_SMK = 0xdead5540;   // AL = 0x40, and the other three bytes must not move
  const EBX_SMK = (0x55550000 | MARKER) >>> 0;

  const runWalk = (at, leafAt, mm0) => {
    plantTree(leafAt);
    plant(at, SMK);
    e.set_eip(at);
    e.set_ecx(nodes);
    e.set_edx(INTERNAL);
    e.set_ebx(EBX_SMK);
    e.set_eax(EAX_SMK);
    e.set_ebp(0xbeef0000);
    e.test_set_mm0(mm0);
    driveTo((at + SMK.length) >>> 0);
    return {
      ecx: e.get_ecx() >>> 0, edx: e.get_edx() >>> 0, ebp: e.get_ebp() >>> 0,
      eax: e.get_eax() >>> 0, ebx: e.get_ebx() >>> 0,
      mm0: e.test_get_mm0(), fl: e.test_sf_zf(),
    };
  };

  const walkCase = (name, leafAt, mm0, checks) => {
    const m0 = e.get_smk_tree_matches();
    const lv0 = e.get_smk_tree_levels();
    const folded = runWalk(nextCode(), leafAt, mm0);
    assert.strictEqual(e.get_smk_tree_matches(), m0 + 1, `${name}: the grammar matched`);
    const levels = Number(e.get_smk_tree_levels() - lv0);

    e.set_smk_tree(0);
    const plain = runWalk(nextCode(), leafAt, mm0);
    assert.strictEqual(e.get_smk_tree_matches(), m0 + 1, `${name}: the switch really is off`);
    e.set_smk_tree(1);

    for (const k of ['ecx', 'edx', 'ebp', 'eax', 'ebx', 'fl']) {
      assert.strictEqual(folded[k], plain[k], `${name}: ${k} matches the interpreter`);
    }
    assert.strictEqual(folded.mm0, plain.mm0,
      `${name}: MM0 matches the interpreter -- the bit buffer is the state`);
    checks(folded, levels);
  };

  // Three levels: bits 1,0,1 out of 0b101 walk +8, +4, +8 and land on 20.
  walkCase('a three-level descent', 20, 0x5n, (r, levels) => {
    assert.strictEqual(levels, 3, 'exactly three levels were walked');
    assert.strictEqual(r.ecx, (nodes + 20) >>> 0, 'the cursor stopped on the leaf');
    assert.strictEqual(r.edx, LEAF, 'the leaf value is what the walk carried out');
    assert.strictEqual(r.eax & 0xff, 0x40 - 3, 'AL lost exactly one bit a level');
    assert.strictEqual(r.eax >>> 8, EAX_SMK >>> 8,
      'the other three bytes of EAX never moved -- this is an 8-bit dec');
    assert.strictEqual(r.mm0, 0x5n >> 3n, 'MM0 was shifted once a level');
    assert.strictEqual(r.fl & 1, 0, 'the 16-bit compare cleared ZF at the leaf');
  });

  // One level. The body is a do-while, so even an immediate leaf costs a bit.
  walkCase('an immediate leaf', 8, 0x1n, (r, levels) => {
    assert.strictEqual(levels, 1, 'one level');
    assert.strictEqual(r.ecx, (nodes + 8) >>> 0, 'one bit==1 step of eight');
    assert.strictEqual(r.eax & 0xff, 0x3f, 'AL decremented once');
  });

  // The bit==0 arm on its own: the fixed sibling offset of four.
  walkCase('the bit==0 arm', 4, 0x0n, (r, levels) => {
    assert.strictEqual(levels, 1, 'one level');
    assert.strictEqual(r.ecx, (nodes + 4) >>> 0,
      'a zero bit takes the fixed offset, not the one the node encodes');
  });

  // Past the iteration cap, and past the end of the accumulator with it: 64
  // bits of ones walk 64 steps of eight, the cap fires, the fold re-enters at
  // the head, and every later level reads a zero bit out of an empty buffer
  // and takes the four-byte arm. 512 + 22*4 == 600.
  walkCase('a descent that outruns the cap and the accumulator', 600,
    0xffffffffffffffffn, (r, levels) => {
      assert.strictEqual(levels, 86,
        '64 eight-byte levels, then 22 four-byte ones on an empty accumulator');
      assert.strictEqual(r.ecx, (nodes + 600) >>> 0, 'the cursor reached the leaf');
      assert.strictEqual(r.mm0, 0n, 'the accumulator was shifted dry');
      assert.strictEqual(r.eax & 0xff, (0x40 - 86) & 0xff,
        'AL wrapped through zero rather than borrowing into AH');
      assert(e.get_smk_tree_runs() >= 2,
        'a capped descent re-entered the super-op rather than spinning');
    });

  // ---- 461 near misses ---------------------------------------------------
  const nearMiss = (name, bytes) => {
    const at = nextCode();
    plantTree(20);
    plant(at, bytes);
    e.set_eip(at);
    e.set_ecx(nodes); e.set_edx(INTERNAL); e.set_ebx(EBX_SMK); e.set_eax(EAX_SMK);
    e.test_set_mm0(0x5n);
    const before = e.get_smk_tree_matches();
    e.run(1);
    assert.strictEqual(e.get_smk_tree_matches(), before, name);
  };
  const patched = (i, ...v) => { const b = Uint8Array.from(SMK); b.set(v, i); return b; };
  // A psrlq of two is not GETBITS(1): the scalar copy would see a bit the MMX
  // register no longer holds.
  nearMiss('a two-bit psrlq remains ordinary x86', patched(17, 0x02));
  // The bit==0 arm loading a different register than the one the walk adds.
  nearMiss('a mismatched sibling-offset register remains ordinary x86', patched(23, 0xb9));
  // A back edge that does not return to the head is a different loop.
  nearMiss('a broken back edge remains ordinary x86', patched(36, 0xdc));

  // ---------------------------------------------------------------- 462 ----
  assert.strictEqual(e.get_pcx_run(), 1, 'the PCX fold is on by default');

  const DST_FILL = 0x77;
  const DST_ORIGIN = 0x100;   // room below for the DF=1 arm to write backwards

  const runPcx = (at, tokens, limit, df) => {
    const m8 = new Uint8Array(memory.buffer);
    const dv = new DataView(memory.buffer);
    m8.fill(DST_FILL, wa(dstBuf), wa(dstBuf) + 0x400);
    m8.fill(0, wa(srcBuf), wa(srcBuf) + 0x400);
    m8.set(tokens, wa(srcBuf));
    dv.setUint32(wa(hdrBuf + 8), limit, true);          // (u16)hdr[8] is the bound
    const base = (dstBuf + DST_ORIGIN) >>> 0;
    dv.setUint32(wa(stack + 0x10), srcBuf, true);       // spilled cursor
    dv.setUint32(wa(stack + 0x14), hdrBuf, true);       // header
    dv.setUint32(wa(stack + 0x18), base, true);         // destination base
    plant(at, PCX);
    e.set_eip(at);
    e.set_esp(stack);
    e.set_edx(srcBuf);
    e.set_ebx(base);
    e.set_ebp(0);
    e.set_eax(0x11223344); e.set_ecx(0x55667788);
    e.set_esi(0x99aabbcc); e.set_edi(0xddeeff00);
    e.test_set_df(df ? 1 : 0);
    driveTo((at + PCX.length) >>> 0);
    e.test_set_df(0);
    return {
      dst: Array.from(new Uint8Array(memory.buffer, wa(dstBuf), 0x400)),
      eax: e.get_eax() >>> 0, ecx: e.get_ecx() >>> 0, edx: e.get_edx() >>> 0,
      ebx: e.get_ebx() >>> 0, ebp: e.get_ebp() >>> 0, esi: e.get_esi() >>> 0,
      edi: e.get_edi() >>> 0, fl: e.test_sf_zf(),
      spill: new DataView(memory.buffer).getUint32(wa(stack + 0x10), true),
    };
  };

  const pcxCase = (name, tokens, limit, df, checks) => {
    const m0 = e.get_pcx_run_matches();
    const t0 = e.get_pcx_run_tokens();
    const folded = runPcx(nextCode(), tokens, limit, df);
    assert.strictEqual(e.get_pcx_run_matches(), m0 + 1, `${name}: the body hash matched`);
    const tokensRun = Number(e.get_pcx_run_tokens() - t0);

    e.set_pcx_run(0);
    const plain = runPcx(nextCode(), tokens, limit, df);
    assert.strictEqual(e.get_pcx_run_matches(), m0 + 1, `${name}: the switch really is off`);
    e.set_pcx_run(1);

    assert.deepStrictEqual(folded.dst, plain.dst,
      `${name}: the expanded bytes match the interpreter, byte for byte`);
    for (const k of ['eax', 'ecx', 'edx', 'ebx', 'ebp', 'esi', 'edi', 'fl', 'spill']) {
      assert.strictEqual(folded[k], plain[k], `${name}: ${k} matches the interpreter`);
    }
    checks(folded, tokensRun);
  };

  const at = (r, i) => r.dst[DST_ORIGIN + i];

  // One of every token shape in one stream: a literal, a run with a
  // remainder, a ZERO-length run, a run of three, another literal, and a run
  // that carries the offset past the bound.
  pcxCase('a mixed token stream',
    [0x41, 0xc5, 0x22, 0xc0, 0x33, 0xc3, 0x44, 0x55, 0xc7, 0x66], 16, false,
    (r, tokens) => {
      assert.strictEqual(tokens, 6, 'six tokens took the offset past the bound');
      assert.strictEqual(r.ebp, 17, '1 + 5 + 0 + 3 + 1 + 7');
      assert.strictEqual(at(r, 0), 0x41, 'the literal byte went through unchanged');
      assert.strictEqual(at(r, 1), 0x22, 'and the five-byte run after it');
      assert.strictEqual(at(r, 5), 0x22, 'to its last byte');
      assert.strictEqual(at(r, 6), 0x44,
        'the zero-length run consumed its value byte and wrote nothing');
      assert.strictEqual(at(r, 9), 0x55, 'the second literal');
      assert.strictEqual(at(r, 16), 0x66, 'the last run reached the bound');
      assert.strictEqual(at(r, 17), DST_FILL, 'and not one byte past it');
      assert.strictEqual(r.esi, 7, 'ESI carries the LAST run length out');
    });

  // The 63-byte maximum, which is 15 dwords plus a three-byte `rep stosb`
  // tail -- the only length that exercises both arms of the fill at once.
  pcxCase('the maximum run length', [0xff, 0x11, 0xff, 0x22], 100, false,
    (r, tokens) => {
      assert.strictEqual(tokens, 2, 'two 63-byte runs clear a bound of 100');
      assert.strictEqual(r.ebp, 126, '63 + 63');
      assert.strictEqual(at(r, 62), 0x11, 'the first run filled all 63 bytes');
      assert.strictEqual(at(r, 63), 0x22, 'and the second started at 63');
      assert.strictEqual(at(r, 125), 0x22, 'to its last byte');
      assert.strictEqual(at(r, 126), DST_FILL, 'and no further');
    });

  // Thirty-two zero-length runs before anything is written at all. A run of
  // zero jumps PAST the cursor reload, so this is the shape that would catch
  // a fold whose cursor came back from the wrong place -- and with the bound
  // untouched for 64 source bytes, it is also the one that would spin. The
  // rest of the (zeroed) source is literal zeroes, which do advance, so the
  // loop still ends the way the guest's own code would end it.
  pcxCase('thirty-two zero-length runs before the first byte',
    Array.from({ length: 64 }, (_, i) => (i & 1) ? 0x00 : 0xc0), 4, false,
    (r, tokens) => {
      assert.strictEqual(tokens, 37, '32 empty runs, then 5 literals to clear a bound of 4');
      assert.strictEqual(r.ebp, 5, 'only the literals moved the output offset');
      assert.strictEqual(at(r, 0), 0x00, 'the first literal landed at the base');
      assert.strictEqual(at(r, 4), 0x00, 'and the last one at the bound');
      assert.strictEqual(at(r, 5), DST_FILL, 'and nothing past it');
    });

  // DF set. Two `rep stos` read it, and the fold cannot fall back into the
  // blocks it replaced, so it has to run backwards itself.
  pcxCase('DF set makes the fill run backwards', [0xc5, 0x22, 0x41], 4, true,
    (r) => {
      assert.strictEqual(r.ebp, 5, 'the five-byte run cleared the bound on its own');
      assert.strictEqual(at(r, 0), 0x22, 'the first stored byte is still at the base');
      assert.strictEqual(r.dst[DST_ORIGIN - 4], 0x22,
        'and the rest went DOWN from it, as a set DF says they must');
    });

  // ---- 462 near misses ---------------------------------------------------
  const pcxMiss = (name, bytes) => {
    const to = nextCode();
    plant(to, bytes);
    e.set_eip(to);
    e.set_esp(stack); e.set_edx(srcBuf); e.set_ebx(dstBuf); e.set_ebp(0);
    const before = e.get_pcx_run_matches();
    e.run(1);
    assert.strictEqual(e.get_pcx_run_matches(), before, name);
  };
  const pcxPatched = (i, ...v) => { const b = Uint8Array.from(PCX); b.set(v, i); return b; };
  // The run-vs-literal threshold is part of the format, not of the fold.
  pcxMiss('a different token mask remains ordinary x86', pcxPatched(0x13, 0x80));
  // A body whose anchors still hold but whose middle differs: the hash is
  // what authorizes the closed-form arithmetic, and it has to notice.
  pcxMiss('a body that differs only in the middle remains ordinary x86',
    pcxPatched(0x40, 0x90));

  console.log('PASS stream-idiom superinstructions (461 SMK_TREE, 462 PCX_RUN)');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
