#!/usr/bin/env node
// tools/bench-loops.js — synthetic guest-loop microbenchmark harness.
//
// WHY THIS EXISTS
// ---------------
// docs/interpreter-dispatch-perf.md section "Timing: attempted four ways,
// resolved nothing" records that whole-app A/B timing on this box has a 24-42%
// noise floor against effects of 5-8%, and that one pass manufactured four fake
// 6-11% "speedups" purely from position in the round. Every interpreter change
// since has been stuck at "needs a timing run".
//
// The fix is not better statistics, it is a bigger effect. A synthetic loop that
// IS the workload turns a 2% whole-app change into a 40% microbenchmark change,
// and running both arms inside ONE process, alternating every rep, makes
// background drift common-mode instead of between-variant.
//
// WHAT IT MEASURES HONESTLY, AND WHAT IT DOES NOT
// ----------------------------------------------
// Trustworthy for the MEMORY path — $g2w, $invalidate_code_write, the page-cross
// test, bulk copies. That cost is straight-line work and reproduces here.
//
// NOT trustworthy for the DISPATCH path. A periodic short loop lets the BTB
// predict every call_indirect target perfectly, and the mispredict IS the ~23%
// $next cost in a real profile. This harness therefore UNDERSTATES dispatch cost
// systematically. A fusion that wins only on op count still needs a whole-app
// confirmation.
//
// And a shape winning here says nothing about whether it occurs in real code.
// tools/find-loops.js / match-loops.js / --handler-hist answer that; quote their
// number next to any result from this tool.
//
// CALIBRATION
// -----------
// Before believing anything new, the harness must reproduce a KNOWN sign. Two
// runtime fold toggles exist for exactly this (13-exports.wat):
//   --toggle=case_chain   handler 423, measured at ~0 on the real app
//   --toggle=rle_run      handler 424, measured at +7% batches on the real app
// A harness that cannot separate those two is measuring itself.
//
// CALIBRATION RESULT, 2026-08-24, box at load 3.5:
//   --shapes=cmp_ladder --toggle=case_chain   +57.4%, +57.8%  (two runs)
//   --shapes=cmp_ladder --toggle=rect_run     +0.7%,  -0.9%   (null control:
//                                             a toggle this shape cannot use)
// So the noise floor here is about +-1%, against 24-42% for the whole-app A/B.
// It TRACKS THE BOX: re-run at load 10.9 and the null control read -5.3% while
// the real toggle held at +58.6%. Run the null control in the same session as
// the real measurement and treat it as the threshold, never as a constant.
//
// AND THE FIRST THING IT FOUND IS THAT OP COUNT LIES ABOUT ITS OWN SIGN.
// On cmp_ladder the fold is +57% FASTER while printing 7.7% MORE handler ops.
// The op count is not what changed: block ENTRIES went 5.50 -> 2.00 per
// iteration, because every `jz` in the unfolded ladder ends a block. Time
// saved divided by entries removed puts a block entry at roughly 27ns here.
// Every fusion in this repo has been judged on the handler histogram, which
// cannot see that number at all. Hence blocks/iter in the output.
//
// USAGE
//   node tools/bench-loops.js --list
//   node tools/bench-loops.js                          # all shapes, 4MB set
//   node tools/bench-loops.js --shapes=lut,store_stream --bytes=16m
//   node tools/bench-loops.js --shapes=lut,store_stream --mapping=sparse
//   node tools/bench-loops.js --shapes=cmp_ladder --toggle=case_chain
//   node tools/bench-loops.js --shapes=blk_rld8,blk_memalu8 --toggle=block_exec_split
//   node tools/bench-loops.js --json
//
// A NOTE ON --toggle=block_exec_split. It is the only toggle here that is not
// a fold of its own: the decode-time load/op split exists only inside a block
// descriptor, so the toggle arms the executor in BOTH arms and varies only the
// pass. Point it at blk_rld8 (redundant loads) or blk_memalu8 (memory-source
// ALU, a FALLBACK per op until the split); every other shape is a null control
// for it in the sense the calibration note above means.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WASM_PATH = path.join(ROOT, 'build', 'wine-assembly.wasm');

// ---------------------------------------------------------------------------
// x86 encoding helpers. Hand-encoded on purpose: the whole point of a shape is
// that its exact op sequence is pinned, and an assembler would let it drift.
// ---------------------------------------------------------------------------
const le32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
const rel8 = n => [n & 0xFF];

// Close a loop: `body` runs, then dec ecx / jnz back to the top.
// Returns body ++ [49, 75, rel8]. The displacement counts from the byte AFTER
// the jnz, which is why it is -(len + 2).
function loopBack(body) {
  const withDec = body.concat([0x49]);            // dec ecx
  return withDec.concat([0x75], rel8(-(withDec.length + 2)));
}

// ---------------------------------------------------------------------------
// Shapes. Each is a loop the profiles actually name — see the table in the
// session notes. `emit` returns { code, iters, bytesTouched, setup }.
// `setup` runs OUTSIDE the timed region.
// ---------------------------------------------------------------------------
// The block-entry pair (see nop_chain / jmp_chain below). K filler ops per
// iteration, identical except that `jmp $+0` ends a block and `nop` does not.
const BLOCK_ENTRY_K = 8;

function blockEntryShape(a, useJmp) {
  const n = a.iterOverride || 1_000_000;
  const filler = [];
  for (let i = 0; i < BLOCK_ENTRY_K; i++) {
    // One dispatch each — that is the invariant that has to hold. The byte
    // counts differ (2 vs 1) but bytes only cost decode, which is once per rep.
    if (useJmp) filler.push(0xEB, 0x00);   // jmp $+0 — falls through, ends a block
    else filler.push(0x90);                // nop — same dispatch, no block end
  }
  return {
    iters: n,
    bytesTouched: 0,
    code: loopBack(filler),
    setup(e) { e.set_ecx(n); },
    verify(e) {
      return e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`;
    },
  };
}

const SHAPES = {
  sparse_scatter: {
    describe: 'cyclic dword loads across independent sparse mappings (--scatter-pages)',
    real: 'fragmented VirtualAlloc heaps; upper bound for replacing record scans, not an app-speed claim',
    prepare(inst, a) {
      const pages = [];
      for (let i = 0; i < a.scatterPageCount; i++) {
        // One page in each successive 1MB directory slot prevents adjacent
        // commits from coalescing into the same affine map record.
        const guest = 0x20000000 + i * 0x00100000;
        const got = inst.e.test_virtual_map_commit(guest, 0x1000) >>> 0;
        if (got !== guest) throw new Error(`sparse_scatter: commit 0x${guest.toString(16)} failed`);
        pages.push(guest);
      }
      a.scatterPages = pages;
    },
    emit(a) {
      const n = Math.floor(a.bufBytes / 4);
      const pointers = a.buf;
      return {
        iters: n,
        bytesTouched: n * 8,
        code: loopBack([
          0x8B, 0x06,             // mov eax, [esi]  — direct pointer table
          0x8B, 0x10,             // mov edx, [eax]  — scattered sparse page
          0x01, 0xD3,             // add ebx, edx
          0x83, 0xC6, 0x04,       // add esi, 4
        ]),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < a.scatterPages.length; i++) {
            dv.setUint32(g2w(a.scatterPages[i]), i + 1, true);
          }
          const tableWa = g2w(pointers);
          for (let i = 0; i < n; i++) {
            dv.setUint32(tableWa + i * 4,
              a.scatterPages[i % a.scatterPages.length], true);
          }
          e.set_esi(pointers); e.set_ecx(n); e.set_ebx(0); e.set_eax(0); e.set_edx(0);
        },
        verify(e) {
          const pages = a.scatterPages.length;
          const rounds = Math.floor(n / pages);
          const tail = n % pages;
          let want = rounds * (pages * (pages + 1) / 2);
          for (let i = 0; i < tail; i++) want += i + 1;
          if ((e.get_ebx() >>> 0) !== (want >>> 0)) {
            return `sum=0x${(e.get_ebx() >>> 0).toString(16)} want 0x${(want >>> 0).toString(16)}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },

  lut: {
    describe: 'dst[i] = lut[src[i]] byte loop (Heroes II ICN 0x004c755d, ~9 dispatches/pixel)',
    real: 'Heroes II sprite blitter; the LUT_RUN candidate in docs/loop-idiom-superops-design.md',
    emit(a) {
      const n = Math.floor(a.bufBytes / 2);
      const src = a.buf, dst = a.buf + n, lut = a.lut;
      return {
        iters: n,
        bytesTouched: n * 3,
        code: loopBack([
          0x0F, 0xB6, 0x06,       // movzx eax, byte [esi]
          0x8A, 0x04, 0x03,       // mov   al, [ebx+eax*1]
          0x88, 0x07,             // mov   [edi], al
          0x46,                   // inc   esi
          0x47,                   // inc   edi
        ]),
        setup(e, mem, g2w) {
          // +13 so no index maps to itself and, critically, so lut[0] != 0 —
          // otherwise verifying dst[0]==0 passes on a loop that never ran.
          for (let i = 0; i < 256; i++) mem[g2w(lut) + i] = (i * 7 + 13) & 0xFF;
          for (let i = 0; i < n; i++) mem[g2w(src) + i] = i & 0xFF;
          mem[g2w(dst)] = 0; mem[g2w(dst) + n - 1] = 0;
          e.set_esi(src); e.set_edi(dst); e.set_ebx(lut); e.set_ecx(n); e.set_eax(0);
        },
        verify(e, mem, g2w) {
          for (const i of [0, 1, n >> 1, n - 1]) {
            const want = ((i & 0xFF) * 7 + 13) & 0xFF;
            if (mem[g2w(dst) + i] !== want) return `dst[${i}]=${mem[g2w(dst) + i]} want ${want}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },

  lut16_h3: {
    describe: 'dst16[i] = lut16[src8[i]] (Heroes III 0x44b7ef exact loop shape)',
    real: 'Heroes III 16bpp sprite expansion; nine static LUT_RUN candidates',
    emit(a) {
      const n = Math.floor(a.bufBytes / 3);
      const src = a.buf, dst = src + n, lut = a.lut;
      const body = [
        0x31, 0xC9,                   // xor ecx, ecx
        0x8A, 0x0A,                   // mov cl, [edx]
        0x83, 0xC0, 0x02,             // add eax, 2
        0x42,                         // inc edx
        0x4D,                         // dec ebp
        0x66, 0x8B, 0x4C, 0x4F, 0x50, // mov cx, [edi+ecx*2+0x50]
        0x66, 0x89, 0x48, 0xFE,       // mov [eax-2], cx
      ];
      return {
        iters: n,
        bytesTouched: n * 3,
        code: body.concat([0x75], rel8(-(body.length + 2))),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < 256; i++) {
            dv.setUint16(g2w(lut + 0x50) + i * 2,
              (((i * 17) & 0xF800) | ((i * 29) & 0x07E0) | ((i * 7) & 0x001F)) ^ 0x39E7,
              true);
          }
          for (let i = 0; i < n; i++) mem[g2w(src) + i] = (i * 43 + 11) & 0xFF;
          dv.setUint16(g2w(dst), 0, true);
          dv.setUint16(g2w(dst) + (n - 1) * 2, 0, true);
          e.set_edx(src); e.set_eax(dst); e.set_edi(lut); e.set_ebp(n); e.set_ecx(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const index = (i * 43 + 11) & 0xFF;
            const want = ((((index * 17) & 0xF800) | ((index * 29) & 0x07E0) |
              ((index * 7) & 0x001F)) ^ 0x39E7) & 0xFFFF;
            const got = dv.getUint16(g2w(dst) + i * 2, true);
            if (got !== want) return `dst16[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
          }
          if (e.get_ebp() !== 0) return `ebp=${e.get_ebp()}, expected 0`;
          if (e.get_edx() !== src + n || e.get_eax() !== dst + n * 2) {
            return 'source/destination cursors did not finish';
          }
          return null;
        },
      };
    },
  },

  lut16_h3_stack: {
    describe: 'stack-loaded table + dst16[i] = lut16[src8[i]] (Heroes III 0x4714bc)',
    real: 'Largest measured Heroes III adventure-map RGB565 loop; table pointer reloads from [esp+0x40]',
    emit(a) {
      const n = Math.floor(a.bufBytes / 3);
      const src = a.buf, dst = src + n, lut = a.lut;
      const body = [
        0x8B, 0x4C, 0x24, 0x40,       // mov ecx, [esp+0x40]
        0x31, 0xC0,                   // xor eax, eax
        0x8A, 0x02,                   // mov al, [edx]
        0x83, 0xC5, 0x02,             // add ebp, 2
        0x42,                         // inc edx
        0x4E,                         // dec esi
        0x66, 0x8B, 0x44, 0x41, 0x1C, // mov ax, [ecx+eax*2+0x1c]
        0x66, 0x89, 0x45, 0xFE,       // mov [ebp-2], ax
      ];
      return {
        iters: n,
        bytesTouched: n * 3,
        code: body.concat([0x75], rel8(-(body.length + 2))),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < 256; i++) {
            dv.setUint16(g2w(lut + 0x1C) + i * 2,
              (((i * 17) & 0xF800) | ((i * 29) & 0x07E0) | ((i * 7) & 0x001F)) ^ 0x39E7,
              true);
          }
          for (let i = 0; i < n; i++) mem[g2w(src) + i] = (i * 43 + 11) & 0xFF;
          dv.setUint16(g2w(dst), 0, true);
          dv.setUint16(g2w(dst) + (n - 1) * 2, 0, true);
          dv.setUint32(g2w(a.stackTop) + 0x40, lut, true);
          e.set_edx(src); e.set_ebp(dst); e.set_esi(n);
          e.set_ecx(0xCCCCCCCC); e.set_eax(0xAAAAAAAA);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const index = (i * 43 + 11) & 0xFF;
            const want = ((((index * 17) & 0xF800) | ((index * 29) & 0x07E0) |
              ((index * 7) & 0x001F)) ^ 0x39E7) & 0xFFFF;
            const got = dv.getUint16(g2w(dst) + i * 2, true);
            if (got !== want) return `dst16[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
          }
          if (e.get_esi() !== 0) return `esi=${e.get_esi()}, expected 0`;
          if (e.get_edx() !== src + n || e.get_ebp() !== dst + n * 2) {
            return 'source/destination cursors did not finish';
          }
          if ((e.get_ecx() >>> 0) !== (lut >>> 0)) return 'stack-loaded table register not published';
          return null;
        },
      };
    },
  },

  store_stream: {
    describe: 'mov [edi+edx*1+disp], eax x4 (93% of all Caesar III SIB effective addresses)',
    real: 'Caesar III; the bind-once-store-many candidate',
    emit(a) {
      const n = Math.floor(a.bufBytes / 16);
      return {
        iters: n,
        bytesTouched: n * 16,
        code: loopBack([
          0x89, 0x04, 0x17,             // mov [edi+edx*1], eax
          0x89, 0x44, 0x17, 0x04,       // mov [edi+edx*1+4], eax
          0x89, 0x44, 0x17, 0x08,       // mov [edi+edx*1+8], eax
          0x89, 0x44, 0x17, 0x0C,       // mov [edi+edx*1+12], eax
          0x83, 0xC2, 0x10,             // add edx, 16
        ]),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          dv.setUint32(g2w(a.buf), 0, true);
          dv.setUint32(g2w(a.buf) + n * 16 - 4, 0, true);
          e.set_edi(a.buf); e.set_edx(0); e.set_ecx(n); e.set_eax(0xA5A5A5A5 | 0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const off of [0, 4, (n * 16) >> 1, n * 16 - 4]) {
            const got = dv.getUint32(g2w(a.buf) + off, true);
            if (got !== 0xA5A5A5A5) return `[buf+0x${off.toString(16)}]=0x${got.toString(16)} want 0xa5a5a5a5`;
          }
          if (e.get_edx() !== n * 16) return `edx=${e.get_edx()}, expected ${n * 16}`;
          return null;
        },
      };
    },
  },

  stack_traffic: {
    describe: 'push/pop + [ebp-x] spills — the store path on a region that is never code',
    real: 'ubiquitous; the region-typed-store candidate',
    emit(a) {
      const n = a.iterOverride || 2_000_000;
      return {
        iters: n,
        bytesTouched: 0,
        code: loopBack([
          0x50,                   // push eax
          0x53,                   // push ebx
          0x89, 0x45, 0xFC,       // mov [ebp-4], eax
          0x89, 0x5D, 0xF8,       // mov [ebp-8], ebx
          0x5B,                   // pop ebx
          0x58,                   // pop eax
        ]),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          // Clear the spill slots, or verify passes on the previous rep's data.
          dv.setUint32(g2w(a.stackTop - 0x100) - 4, 0, true);
          dv.setUint32(g2w(a.stackTop - 0x100) - 8, 0, true);
          e.set_ebp(a.stackTop - 0x100);
          e.set_ecx(n); e.set_eax(1); e.set_ebx(2);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          // The push/pop pairs must balance and the spills must have landed.
          if (e.get_eax() !== 1 || e.get_ebx() !== 2) return `eax=${e.get_eax()} ebx=${e.get_ebx()}, expected 1/2`;
          if (dv.getUint32(g2w(a.stackTop - 0x100) - 4, true) !== 1) return '[ebp-4] never written';
          if (dv.getUint32(g2w(a.stackTop - 0x100) - 8, true) !== 2) return '[ebp-8] never written';
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },

  cmp_ladder: {
    describe: 'cmp al,imm8 / jz ladder, 8 cases — CASE_CHAIN NEGATIVE CONTROL (real app: ~0)',
    real: 'Caesar III 0x40f71c token dispatch; folded by handler 423, which measured <=2%',
    emit(a) {
      const CASES = 8;
      const head = [0x8A, 0x06];                    // mov al, [esi]
      const ladder = [];
      // tail sits right after the ladder; each jz reaches it.
      const tailOff = head.length + CASES * 4;
      for (let i = 0; i < CASES; i++) {
        const nextOff = head.length + i * 4 + 4;
        ladder.push(0x3C, i, 0x74, (tailOff - nextOff) & 0xFF);
      }
      const n = Math.floor(a.bufBytes);
      return {
        iters: n,
        bytesTouched: n,
        code: loopBack(head.concat(ladder, [0x46])), // ... inc esi
        setup(e, mem, g2w) {
          for (let i = 0; i < n; i++) mem[g2w(a.buf) + i] = i % CASES;
          e.set_esi(a.buf); e.set_ecx(n); e.set_eax(0);
        },
        verify(e) {
          // The ladder has no memory effect, so the proof it ran is that the
          // cursor walked the whole buffer and AL holds the last token.
          if (e.get_esi() !== a.buf + n) return `esi=0x${e.get_esi().toString(16)}, expected 0x${(a.buf + n).toString(16)}`;
          if ((e.get_eax() & 0xFF) !== (n - 1) % CASES) return `al=${e.get_eax() & 0xFF}, expected ${(n - 1) % CASES}`;
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },

  // --- the block-entry pair -------------------------------------------------
  // These two exist only to be subtracted from each other. Both run K filler
  // ops per iteration and are otherwise identical; the filler is a NOP in one
  // and a `jmp $+0` in the other. A NOP is one dispatch. A `jmp $+0` is one
  // dispatch AND one block end, so it costs an eip store, a cache lookup and a
  // trip round $run's loop on top.
  //
  //   (jmp_chain - nop_chain) / K  =  what a block entry costs
  //
  // Needed because the obvious way to price a block entry -- diff the two arms
  // of cmp_ladder -- is confounded: the unfolded arm runs ~7 MORE real
  // dispatches per iteration as well as 3.5 more block entries, so charging the
  // whole delta to entries overstates them. This pair holds dispatch count
  // equal by construction.
  nop_chain: {
    describe: 'K nops per iteration — the dispatch-only half of the block-entry pair',
    real: 'subtract from jmp_chain to price one block entry',
    emit: a => blockEntryShape(a, false),
  },
  jmp_chain: {
    describe: 'K jmp $+0 per iteration — same dispatches as nop_chain plus K block ends',
    real: 'subtract nop_chain to price one block entry',
    emit: a => blockEntryShape(a, true),
  },

  rep_movsd: {
    describe: 'rep movsd — already lowered to memory.copy; the FLOOR for a bulk copy',
    real: 'every blitter; shows what the store path costs when it is absent entirely',
    emit(a) {
      const n = Math.floor(a.bufBytes / 2 / 4);
      const src = a.buf, dst = a.buf + n * 4;
      return {
        iters: n,
        bytesTouched: n * 8,
        code: [0xF3, 0xA5],           // rep movsd
        setup(e, mem, g2w) {
          // The source MUST carry a pattern. Left zeroed, this shape copies
          // zeros onto zeros and a memory.copy that never ran is byte-identical
          // to one that did — the benchmark would report DRAM bandwidth for
          // doing nothing. `verify` below is what makes that impossible.
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < n; i++) dv.setUint32(g2w(src) + i * 4, i ^ 0x5A5A0000, true);
          dv.setUint32(g2w(dst), 0, true);
          dv.setUint32(g2w(dst) + (n - 1) * 4, 0, true);
          e.set_esi(src); e.set_edi(dst); e.set_ecx(n);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const got = dv.getUint32(g2w(dst) + i * 4, true);
            const want = (i ^ 0x5A5A0000) >>> 0;
            if (got !== want) return `dst[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },

  // ------------------------------------------------------------ TREE_FOLD --
  // Three whole-block integer expressions, one per census shape. Unlike the
  // LUT/COPY families these have no single memory idiom to lower to; what the
  // fold removes is the per-op dispatch and the register-global traffic, so
  // the number to read is blocks/iter (1 -> 1/iters) and the paired ratio.
  tree_span: {
    describe: 'mov/add/shr/and/or/store dword interleave (quake2 ref_soft 0x12570 shape)',
    real: 'quake2_demo span coordinate interleave — the hottest block in the census',
    emit(a) {
      const n = Math.floor(a.bufBytes / 4);
      const dst = a.buf, step = 0x00030007, start = 0x11110000;
      return {
        iters: n,
        bytesTouched: n * 4,
        code: loopBack([
          0x89, 0xD0,                          // mov  eax, edx
          0x01, 0xDA,                          // add  edx, ebx
          0xC1, 0xE8, 0x10,                    // shr  eax, 16
          0x89, 0xD6,                          // mov  esi, edx
          0x01, 0xDA,                          // add  edx, ebx
          0x81, 0xE6, 0x00, 0x00, 0xFF, 0xFF,  // and  esi, 0xffff0000
          0x09, 0xF0,                          // or   eax, esi
          0x89, 0x07,                          // mov  [edi], eax
          0x83, 0xC7, 0x04,                    // add  edi, 4
        ]),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          dv.setUint32(g2w(dst), 0, true);
          dv.setUint32(g2w(dst) + (n - 1) * 4, 0, true);
          e.set_edi(dst); e.set_edx(start); e.set_ebx(step); e.set_ecx(n);
          e.set_eax(0); e.set_esi(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const d = (start + 2 * i * step) >>> 0;
            const want = ((d >>> 16) | (((d + step) >>> 0) & 0xFFFF0000)) >>> 0;
            const got = dv.getUint32(g2w(dst) + i * 4, true);
            if (got !== want) return `dst[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },

  tree_dot: {
    describe: 'load/imul/add/sar/store with two pointer bumps (fixed-point scale)',
    real: 'the fixed-point scale-and-store the census names in caesar3 and quake2',
    emit(a) {
      const n = Math.floor(a.bufBytes / 8);
      const src = a.buf, dst = a.buf + n * 4, bias = 0x00004000;
      return {
        iters: n,
        bytesTouched: n * 8,
        code: loopBack([
          0x8B, 0x06,             // mov  eax, [esi]
          0x6B, 0xC0, 0x03,       // imul eax, eax, 3
          0x01, 0xD8,             // add  eax, ebx
          0xC1, 0xF8, 0x08,       // sar  eax, 8
          0x89, 0x07,             // mov  [edi], eax
          0x83, 0xC6, 0x04,       // add  esi, 4
          0x83, 0xC7, 0x04,       // add  edi, 4
        ]),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < n; i++) dv.setInt32(g2w(src) + i * 4, (i * 2654435761) | 0, true);
          dv.setUint32(g2w(dst), 0, true);
          dv.setUint32(g2w(dst) + (n - 1) * 4, 0, true);
          e.set_esi(src); e.set_edi(dst); e.set_ebx(bias); e.set_ecx(n); e.set_eax(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const want = ((((i * 2654435761) | 0) * 3 | 0) + bias) >> 8;
            const got = dv.getInt32(g2w(dst) + i * 4, true);
            if (got !== want) return `dst[${i}]=${got} want ${want}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },

  tree_chain: {
    describe: 'in-place load/xor/add/not/store, cmp/jb terminator (self-aliasing)',
    real: 'the in-place transform chain; also the proof the fold keeps store->load order',
    emit(a) {
      const n = Math.floor(a.bufBytes / 4);
      const buf = a.buf;
      const body = [
        0x8B, 0x06,                    // mov  eax, [esi]
        0x31, 0xD0,                    // xor  eax, edx
        0x05, 0x34, 0x12, 0x00, 0x00,  // add  eax, 0x1234
        0xF7, 0xD0,                    // not  eax
        0x89, 0x06,                    // mov  [esi], eax
        0x83, 0xC6, 0x04,              // add  esi, 4
        0x3B, 0xF7,                    // cmp  esi, edi
      ];
      const key = 0x5A17C0DE;
      return {
        iters: n,
        bytesTouched: n * 8,
        // jb back — the cmp/jcc terminator, not the dec/jnz one.
        code: body.concat([0x72], rel8(-(body.length + 2))),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < n; i++) dv.setUint32(g2w(buf) + i * 4, (i * 40503 + 7) >>> 0, true);
          e.set_esi(buf); e.set_edi(buf + n * 4); e.set_edx(key); e.set_eax(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const want = (~(((((i * 40503 + 7) >>> 0) ^ key) >>> 0) + 0x1234)) >>> 0;
            const got = dv.getUint32(g2w(buf) + i * 4, true);
            if (got !== want) return `buf[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
          }
          const end = (buf + n * 4) >>> 0;
          if (e.get_esi() >>> 0 !== end) return `esi=0x${e.get_esi().toString(16)}, expected 0x${end.toString(16)}`;
          return null;
        },
      };
    },
  },

  tree_x87: {
    describe: 'fld/fmul/fstp float scale with two pointer bumps (quake2 0x004129b0 shape)',
    real: 'quake2 ref_soft mixed loops — 78k block entries; the x87 micro-ops in §13',
    emit(a) {
      const n = Math.floor(a.bufBytes / 8);
      const src = a.buf, dst = a.buf + n * 4;
      return {
        iters: n,
        bytesTouched: n * 12,
        code: loopBack([
          0xD9, 0x06,             // fld   dword [esi]
          0xD8, 0x0F,             // fmul  dword [edi]
          0xD9, 0x1F,             // fstp  dword [edi]
          0x83, 0xC6, 0x04,       // add   esi, 4
          0x83, 0xC7, 0x04,       // add   edi, 4
        ]),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          // Finite, exactly representable values on both sides: the point is
          // to price the dispatch, not to time the denormal slow path.
          for (let i = 0; i < n; i++) {
            dv.setFloat32(g2w(src) + i * 4, 1.5 + (i % 64) * 0.25, true);
            dv.setFloat32(g2w(dst) + i * 4, 0.5 + (i % 7) * 0.125, true);
          }
          e.set_esi(src); e.set_edi(dst); e.set_ecx(n);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const want = Math.fround(Math.fround(1.5 + (i % 64) * 0.25)
                                   * Math.fround(0.5 + (i % 7) * 0.125));
            const got = dv.getFloat32(g2w(dst) + i * 4, true);
            if (got !== want) return `dst[${i}]=${got} want ${want}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  },
};

// -- tree_len<N>: the same loop at six interior lengths -----------------------
//
// The fold's win is one block transfer per iteration (~9ns, per the
// nop_chain/jmp_chain pair) minus whatever the generic walker costs per
// micro-op on top of a per-op handler. The first term is fixed per iteration;
// the second scales with the body. So there is a length past which the fold
// stops paying, and the 24 the family shipped with -- and the 64 it was raised
// to for mw3 -- were both guesses. This family measures it.
//
// One shape, six lengths, so nothing but the body length varies: load, then
// (N-4) `add eax,ebx`, then store and two pointer bumps. Every op is a
// micro-op the walker already handles, and the ALU chain is serially
// dependent, which is the honest case -- an independent chain would let the
// host CPU hide the walker's overhead behind ILP the real blend does not have.
function treeLen(nInterior) {
  const adds = nInterior - 4;
  if (adds < 0) throw new Error(`tree_len${nInterior}: need at least 4 interior ops`);
  return {
    describe: `load + ${adds} x add + store, ${nInterior} interior ops`,
    real: 'the body-length sweep that sets the default interior cap',
    emit(a) {
      const n = Math.floor(a.bufBytes / 8);
      const src = a.buf, dst = a.buf + n * 4, step = 0x01010101;
      const body = [0x8B, 0x06];                       // mov eax, [esi]
      for (let i = 0; i < adds; i++) body.push(0x01, 0xD8);  // add eax, ebx
      body.push(0x89, 0x07);                           // mov [edi], eax
      body.push(0x83, 0xC6, 0x04);                     // add esi, 4
      body.push(0x83, 0xC7, 0x04);                     // add edi, 4
      body.push(0x49);                                 // dec ecx
      // Past ~60 interior ops the back edge no longer fits in a rel8, and a
      // displacement of -133 wraps to +123 -- the decoder then reads whatever
      // follows as an instruction stream and traps on the first byte that
      // looks like a prefix (0x67 here). Widen to the near form instead.
      const back = body.length + 2 <= 128
        ? [0x75].concat(rel8(-(body.length + 2)))
        : [0x0F, 0x85, ...[-(body.length + 6)].flatMap(d =>
            [d & 0xFF, (d >> 8) & 0xFF, (d >> 16) & 0xFF, (d >> 24) & 0xFF])];
      return {
        iters: n,
        bytesTouched: n * 8,
        code: body.concat(back),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < n; i++) dv.setUint32(g2w(src) + i * 4, (i * 2654435761) >>> 0, true);
          dv.setUint32(g2w(dst), 0, true);
          dv.setUint32(g2w(dst) + (n - 1) * 4, 0, true);
          e.set_esi(src); e.set_edi(dst); e.set_ebx(step); e.set_ecx(n); e.set_eax(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const want = (((i * 2654435761) >>> 0) + adds * step) >>> 0;
            const got = dv.getUint32(g2w(dst) + i * 4, true);
            if (got !== want) return `dst[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  };
}
for (const n of [8, 16, 24, 32, 48, 64, 96, 128, 160]) SHAPES[`tree_len${n}`] = treeLen(n);

// The control the length sweep needs. tree_len's interior is register ALU,
// which is the fold's BEST case by construction: every `add eax,ebx` becomes a
// wasm local add with no $get_reg/$set_reg either side, so the walker's
// per-op overhead is compared against the widest possible per-op saving. A
// memory interior is the other extreme -- the scalar handler and the tree arm
// both pay $g2w and a real load/store, so the only thing left to win is the
// dispatch. If the fold still leads here at 96 ops, no body length inside the
// descriptor's structural limit is a reason to decline.
function treeMem(nInterior) {
  const pairs = Math.floor((nInterior - 4) / 2);
  if (pairs < 1) throw new Error(`tree_mem${nInterior}: too short`);
  return {
    describe: `${pairs} x (load + read-modify-write), ${2 * pairs + 4} interior ops`,
    real: 'the memory-interior control for the body-length sweep',
    emit(a) {
      const n = Math.floor(a.bufBytes / 8);
      const src = a.buf, dst = a.buf + n * 4;
      const body = [];
      for (let i = 0; i < pairs; i++) {
        body.push(0x8B, 0x06);   // mov eax, [esi]
        body.push(0x01, 0x07);   // add [edi], eax
      }
      body.push(0x83, 0xC6, 0x04);                     // add esi, 4
      body.push(0x83, 0xC7, 0x04);                     // add edi, 4
      body.push(0x49);                                 // dec ecx
      const back = body.length + 2 <= 128
        ? [0x75].concat(rel8(-(body.length + 2)))
        : [0x0F, 0x85, ...[-(body.length + 6)].flatMap(d =>
            [d & 0xFF, (d >> 8) & 0xFF, (d >> 16) & 0xFF, (d >> 24) & 0xFF])];
      return {
        iters: n,
        bytesTouched: n * 8,
        code: body.concat(back),
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < n; i++) {
            dv.setUint32(g2w(src) + i * 4, (i * 2654435761) >>> 0, true);
            dv.setUint32(g2w(dst) + i * 4, 0, true);
          }
          e.set_esi(src); e.set_edi(dst); e.set_ecx(n); e.set_eax(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (const i of [0, 1, n >> 1, n - 1]) {
            const want = (((i * 2654435761) >>> 0) * pairs) >>> 0;
            const got = dv.getUint32(g2w(dst) + i * 4, true);
            if (got !== want) return `dst[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
          }
          if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
          return null;
        },
      };
    },
  };
}
for (const n of [16, 32, 96]) SHAPES[`tree_mem${n}`] = treeMem(n);

// Colour-keyed LUT16 blit — SimGolf's jgl.dll 0x10016eee, byte for byte. This
// is the shape docs/loop-idiom-superops-design.md §19 says no recognizer can
// see: the sentinel test splits one pixel across four basic blocks, and
// $loop_match_block only ever runs on a block that branches to ITSELF, so the
// keyed loop is declined as `multi-branch` before any predicate is tried.
//
// It exists to price the structure against `lut16_h3`, which is the same
// per-pixel work (one source byte, one 16-bit table read, one 16-bit store)
// written as a single self-loop that LUT_RUN folds today. Run them together
// under --toggle=lut_superops: the h3 arm measures what the fold buys, the
// keyed arm is the null control that should not move at all.
//
// `tEvery`/`sEvery` set the pixel mix (0 = never). 0xff is the transparent
// key and skips the store; 0xf8 selects the DEST-indexed shadow table
// (`dst = shadow[dst]`, 65536 entries — the extent the wide16 executor's
// 512-byte table proof cannot cover); everything else is an ordinary
// source-indexed lookup.
function ckLut16(tEvery, sEvery) {
  const srcByte = i => {
    if (tEvery && i % tEvery === 0) return 0xFF;
    if (sEvery && i % sEvery === 4) return 0xF8;
    return (i * 43 + 11) % 0xF8;
  };
  const dstPattern = i => (i * 37 + 5) & 0xFFFF;
  const srcLutAt = j => ((((j * 17) & 0xF800) | ((j * 29) & 0x07E0) |
    ((j * 7) & 0x001F)) ^ 0x39E7) & 0xFFFF;
  const expected = i => {
    const b = srcByte(i);
    if (b === 0xFF) return dstPattern(i);              // key: store skipped
    if (b === 0xF8) return dstPattern(i) ^ 0x5A5A;     // shadow[dst]
    return srcLutAt(b);                                 // table[src]
  };
  const mix = tEvery
    ? `${(100 / tEvery).toFixed(0)}% keyed, ${(100 / sEvery).toFixed(0)}% shadow`
    : 'every pixel opaque';
  return {
    describe: `colour-keyed dst16[i] = lut16[src8[i]] with a skip arm (SimGolf jgl 0x10016eee, ${mix})`,
    real: 'SimGolf sprite blitter, 73% of all block entries; §19 CK_LUT16, unmatchable today',
    emit(a) {
      const n = Math.floor(a.bufBytes / 3);
      const src = a.buf, dst = src + n, srcLut = a.lut, shadow = a.lut + 0x1000;
      // Exactly the bytes at jgl+0x10016eee. The two forward displacements and
      // the -39 back edge are the DLL's own, so the block structure the
      // decoder sees here is the block structure it sees in the app.
      const code = [
        0x80, 0x3E, 0xFF,             // cmp byte [esi], 0xff
        0x73, 0x1B,                   // jnb  skip
        0x80, 0x3E, 0xF8,             // cmp byte [esi], 0xf8
        0x75, 0x0D,                   // jnz  normal
        0x66, 0x8B, 0x1F,             // mov  bx, [edi]
        0x66, 0x8B, 0x5C, 0x5D, 0x00, // mov  bx, [ebp+ebx*2+0x0]
        0x66, 0x89, 0x1F,             // mov  [edi], bx
        0xEB, 0x09,                   // jmp  skip
        0x8A, 0x06,                   // normal: mov al, [esi]
        0x66, 0x8B, 0x1C, 0x41,       // mov  bx, [ecx+eax*2]
        0x66, 0x89, 0x1F,             // mov  [edi], bx
        0x46,                         // skip: inc esi
        0x83, 0xC7, 0x02,             // add  edi, 2
        0x4A,                         // dec  edx
        0x75, 0xD9,                   // jnz  back
      ];
      return {
        iters: n,
        // Same accounting as lut16_h3 so the two are directly comparable, even
        // though a keyed pixel reads the table and writes the destination.
        bytesTouched: n * 3,
        code,
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let j = 0; j < 256; j++) dv.setUint16(g2w(srcLut) + j * 2, srcLutAt(j), true);
          for (let w = 0; w < 0x10000; w++) dv.setUint16(g2w(shadow) + w * 2, w ^ 0x5A5A, true);
          for (let i = 0; i < n; i++) mem[g2w(src) + i] = srcByte(i);
          // The destination must be seeded: a keyed pixel leaves it alone and
          // a shadow pixel reads it, so a zeroed buffer would verify a loop
          // that skipped every store.
          for (let i = 0; i < n; i++) dv.setUint16(g2w(dst) + i * 2, dstPattern(i), true);
          e.set_esi(src); e.set_edi(dst); e.set_ecx(srcLut); e.set_ebp(shadow);
          e.set_edx(n); e.set_eax(0); e.set_ebx(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          // One index of each arm, plus both ends — a mix-dependent sample,
          // because "all three arms ran" is the property under test.
          const probes = new Set([0, 1, 4, 5, n >> 1, n - 1]);
          for (const i of probes) {
            const want = expected(i);
            const got = dv.getUint16(g2w(dst) + i * 2, true);
            if (got !== want) {
              return `dst16[${i}]=0x${got.toString(16)} want 0x${want.toString(16)} ` +
                `(src=0x${srcByte(i).toString(16)})`;
            }
          }
          if (e.get_edx() !== 0) return `edx=${e.get_edx()}, expected 0`;
          if (e.get_esi() !== src + n || e.get_edi() !== dst + n * 2) {
            return 'source/destination cursors did not finish';
          }
          return null;
        },
      };
    },
  };
}
SHAPES.ck_lut16 = ckLut16(8, 8);
SHAPES.ck_lut16_opaque = ckLut16(0, 0);

// ---- SimGolf's real hot loop -------------------------------------------
// jgl.dll+0x100153a5, verbatim: the 210 bytes between the head and the far
// end of its `jnz`, copied out with `node tools/dump_va.js jgl.dll
// 0x100153a5 210`. Every branch in it is self-relative within that range, so
// it relocates anywhere.
//
// THIS IS THE LOOP THAT OWNS THE FRAME. tools/hot-loop-census.js measured it
// at 51.6% / 49.5% / 53.8% of all block entries across three independent
// browser windows -- spread 4.3pp, i.e. it is hot no matter what is on
// screen, which is exactly what nothing else in jgl is. It is transcribed
// rather than hand-written because a hand-written approximation of a
// 45-operation blend is an approximation of the thing being priced.
//
//   head:    cmp byte [esi],0xff / jnb advance        colour sentinel
//            cmp byte [ebx],0xff / jnb advance        ALPHA sentinel (2nd cursor)
//            xor eax,eax / xor ebp,ebp
//            mov al,[ebx] / cmp al,0 / jz opaque
//   blend:   ~45 ops, channel-wise RGB565, three x (shr/and 0xf8, mul cl,
//            shr 8, add, shr 3, shl, or dx,ax), through push ecx/push edx
//   opaque:  mov al,[esi] / mov ax,[ecx+eax*2] / mov [edi],ax
//   advance: inc esi / inc ebx / add edi,2 / dec edx / jnz head
const CK_BLEND16 = [
  0x80, 0x3e, 0xff, 0x0f, 0x83, 0xbd, 0x00, 0x00, 0x00, 0x80, 0x3b, 0xff,
  0x0f, 0x83, 0xb4, 0x00, 0x00, 0x00, 0x33, 0xc0, 0x33, 0xed, 0x8a, 0x03,
  0x3c, 0x00, 0x0f, 0x84, 0x9d, 0x00, 0x00, 0x00, 0x8a, 0x06, 0x66, 0x8b,
  0x2c, 0x41, 0x66, 0x8b, 0x07, 0x51, 0x52, 0x66, 0x8b, 0xd5, 0xc1, 0xe2,
  0x10, 0x66, 0x8b, 0xc8, 0xc1, 0xe1, 0x10, 0x8a, 0x0b, 0x66, 0xc1, 0xed,
  0x07, 0x66, 0x81, 0xe5, 0xf8, 0x00, 0x66, 0xc1, 0xe8, 0x07, 0x24, 0xf8,
  0xf6, 0xe1, 0x66, 0xc1, 0xe8, 0x08, 0x66, 0x03, 0xc5, 0x66, 0xc1, 0xe8,
  0x03, 0x66, 0xc1, 0xe0, 0x0a, 0x66, 0x0b, 0xd0, 0x8b, 0xc1, 0xc1, 0xe8,
  0x10, 0x8b, 0xea, 0xc1, 0xed, 0x10, 0x66, 0xc1, 0xed, 0x02, 0x66, 0x81,
  0xe5, 0xf8, 0x00, 0x66, 0xc1, 0xe8, 0x02, 0x66, 0x25, 0xf8, 0x00, 0xf6,
  0xe1, 0x66, 0xc1, 0xe8, 0x08, 0x66, 0x03, 0xc5, 0x66, 0xc1, 0xe8, 0x03,
  0x66, 0xc1, 0xe0, 0x05, 0x66, 0x0b, 0xd0, 0x8b, 0xc1, 0xc1, 0xe8, 0x10,
  0x8b, 0xea, 0xc1, 0xed, 0x10, 0x66, 0xc1, 0xe5, 0x03, 0x66, 0x81, 0xe5,
  0xf8, 0x00, 0x66, 0xc1, 0xe0, 0x03, 0x66, 0x25, 0xf8, 0x00, 0xf6, 0xe1,
  0x66, 0xc1, 0xe8, 0x08, 0x66, 0x03, 0xc5, 0x66, 0xc1, 0xe8, 0x03, 0x66,
  0x0b, 0xd0, 0x66, 0x89, 0x17, 0x5a, 0x59, 0xeb, 0x09, 0x8a, 0x06, 0x66,
  0x8b, 0x04, 0x41, 0x66, 0x89, 0x07, 0x46, 0x43, 0x83, 0xc7, 0x02, 0x4a,
  0x0f, 0x85, 0x2e, 0xff, 0xff, 0xff,
];

// The guest's own arithmetic, re-executed in JS so `verify` can check a blend
// pixel rather than only the two easy arms. Written instruction for
// instruction against the disassembly -- the odd-looking shifts (`shr bp,7`
// for red, `and al,0xf8` 8-bit for red but `and ax,0xf8` 16-bit for green)
// are what the binary does, not a tidied version of it.
function ckBlendPixel(srcColour, dstColour, alpha) {
  const lo16 = v => v & 0xFFFF;
  let bp = lo16(srcColour), ax = lo16(dstColour), dx = 0;
  // red: bp/ax >> 7, mask, scale by alpha, recombine, land at bit 10
  bp = lo16(bp >>> 7) & 0xf8;
  ax = lo16(ax >>> 7);
  ax = (ax & 0xFF00) | ((ax & 0xFF) & 0xf8);   // and al,0xf8
  ax = lo16((ax & 0xFF) * alpha);              // mul cl -> AX = AL*CL
  ax = lo16(ax >>> 8);
  ax = lo16(ax + bp);
  ax = lo16(ax >>> 3);
  dx = lo16(dx | lo16(ax << 10));
  // green
  bp = lo16(srcColour) >>> 2 & 0xf8;
  ax = lo16(lo16(dstColour) >>> 2) & 0xf8;
  ax = lo16((ax & 0xFF) * alpha);
  ax = lo16(ax >>> 8);
  ax = lo16(ax + bp);
  ax = lo16(ax >>> 3);
  dx = lo16(dx | lo16(ax << 5));
  // blue
  bp = lo16(lo16(srcColour) << 3) & 0xf8;
  ax = lo16(lo16(dstColour) << 3) & 0xf8;
  ax = lo16((ax & 0xFF) * alpha);
  ax = lo16(ax >>> 8);
  ax = lo16(ax + bp);
  ax = lo16(ax >>> 3);
  return lo16(dx | ax);
}

// transparentPct / blendPct are the measured per-pixel mix. The defaults come
// from the block-entry shares of the loop's own five blocks in a real browser
// window (head 14.52%, alpha cmp 8.43%, third block 8.18%, opaque 7.72%),
// which is the only honest place to get them: a fold's value depends entirely
// on how often the arm it declines is taken.
function ckBlend16(transparentPct, blendPct) {
  const srcByte = i => (i % 100) < transparentPct ? 0xFF : ((i * 43 + 11) % 0xFF);
  const alphaByte = i => {
    if ((i % 100) < transparentPct) return 0x00;
    return (i % 100) < (100 - blendPct) ? 0x00 : (1 + (i * 29) % 0xFE);
  };
  const lutAt = j => ((((j * 17) & 0xF800) | ((j * 29) & 0x07E0) |
    ((j * 7) & 0x001F)) ^ 0x39E7) & 0xFFFF;
  const dst0 = i => (i * 37 + 5) & 0xFFFF;
  return {
    describe: `jgl+0x100153a5 verbatim: alpha-guarded RGB565 blend ` +
      `(${transparentPct}% transparent, ${blendPct}% blend, rest plain LUT16)`,
    real: 'SimGolf: 49.5-53.8% of ALL block entries across three browser windows',
    emit(a) {
      const n = Math.floor(a.bufBytes / 4);
      const src = a.buf, alpha = src + n, dst = alpha + n, lut = a.lut;
      return {
        iters: n,
        bytesTouched: n * 4,
        code: CK_BLEND16,
        setup(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          for (let i = 0; i < 256; i++) dv.setUint16(g2w(lut) + i * 2, lutAt(i), true);
          for (let i = 0; i < n; i++) {
            mem[g2w(src) + i] = srcByte(i);
            mem[g2w(alpha) + i] = alphaByte(i);
            dv.setUint16(g2w(dst) + i * 2, dst0(i), true);
          }
          e.set_esi(src); e.set_ebx(alpha); e.set_edi(dst); e.set_ecx(lut);
          e.set_edx(n); e.set_eax(0); e.set_ebp(0);
        },
        verify(e, mem, g2w) {
          const dv = new DataView(mem.buffer);
          // One index of each arm, so a transcription error in the blend
          // cannot hide behind two arms that happen to be right.
          const arms = { transparent: -1, opaque: -1, blend: -1 };
          for (let i = 0; i < Math.min(n, 400); i++) {
            const s = srcByte(i), al = alphaByte(i);
            const arm = (s === 0xFF || al === 0xFF) ? 'transparent'
              : (al === 0 ? 'opaque' : 'blend');
            if (arms[arm] < 0) arms[arm] = i;
          }
          // The degenerate mixes deliberately omit arms, so check the arms
          // this mix actually produces and require that at least one existed.
          if (Object.values(arms).every(i => i < 0)) return 'no pixels classified';
          for (const [arm, i] of Object.entries(arms)) {
            if (i < 0) continue;
            const got = dv.getUint16(g2w(dst) + i * 2, true);
            const want = arm === 'transparent' ? dst0(i)
              : arm === 'opaque' ? lutAt(srcByte(i))
              : ckBlendPixel(lutAt(srcByte(i)), dst0(i), alphaByte(i));
            if (got !== want) {
              return `${arm} dst16[${i}]=0x${got.toString(16)} want 0x${want.toString(16)}`;
            }
          }
          if (e.get_edx() !== 0) return `edx=${e.get_edx()}, expected 0`;
          if (e.get_esi() !== src + n || e.get_ebx() !== alpha + n ||
              e.get_edi() !== dst + n * 2) {
            return 'source/alpha/destination cursors did not finish';
          }
          return null;
        },
      };
    },
  };
}
// The measured mix, and the two degenerate ends for contrast: what the loop
// costs when every pixel takes the cheap arm, and when every pixel blends.
SHAPES.ck_blend16 = ckBlend16(42, 3);
SHAPES.ck_blend16_opaque = ckBlend16(0, 0);
SHAPES.ck_blend16_allblend = ckBlend16(0, 100);

// ---------------------------------------------------------------------------
// REGION descriptor shapes (--toggle=region)
// ---------------------------------------------------------------------------
// H454's descriptor is a graph; the shipped self-loop fold is its one-block
// case. These shapes hand the decoder a HAND-BUILT descriptor for a specific
// entry EIP through set_region_spec, because there is no multi-block matcher
// yet -- whether one is worth writing is exactly what this measures. The x86
// and the descriptor are written side by side here and the two arms are
// checksum-compared on every rep, so a descriptor that does not agree with the
// bytes fails the run instead of producing a fast wrong answer.
//
// Register file order is the emulator's: 0 eax, 1 ecx, 2 edx, 3 ebx, 4 esp,
// 5 ebp, 6 esi, 7 edi.
const RG = { eax: 0, ecx: 1, edx: 2, ebx: 3, esp: 4, ebp: 5, esi: 6, edi: 7 };
const M = r => 1 << r;

// Micro-op kinds, mirroring the $TU_* globals in src/07b-loop-match.wat.
const TU = {
  MOV_RI: 1, ADD_RR: 3, ADD_RI: 4, SUB_RR: 5, SUB_RI: 6, AND_RI: 8,
  XOR_RR: 11, INC: 13, LOAD32: 20, STORE32: 21, MOVZX8_RO: 32,
};
// Original handler indices, so the histogram keeps counting folded work with
// the same names an unfolded build would use (H454 re-records them).
const FN = {
  mov_ri: 2, add_ri: 3, and_ri: 7, sub_ri: 8, add_rr: 12, sub_rr: 17,
  xor_rr: 18, load_ro: 26, store_ro: 27, inc: 64, movzx8_ro: 143,
};
// Terminator kinds and the x86 condition-code nibble $eval_cc takes.
const TK = { DECINC: 0, CMP_RR: 1, CMP_RI: 2, CMP_RM: 3, NONE: 4 };
const CC = { b: 2, ae: 3, z: 4, nz: 5 };

const REGION_BLOCK_WORDS = 13;

// [kind, dst, src, imm, original handler, extra] -- the six words of one
// micro-op, in $TREE_UOP_WORDS order.
const uop = (kind, d, a, imm, fn, b = 0) => [kind, d, a, imm | 0, fn, b | 0];

// Serialize a region descriptor exactly as $th_tree_fold reads it back.
function regionWords(blocks, exits) {
  if (blocks.length > 16) throw new Error(`region: ${blocks.length} blocks over the 16 cap`);
  if (exits.length > 8) throw new Error(`region: ${exits.length} exits over the 8 cap`);
  const uopsTotal = blocks.reduce((n, b) => n + b.uops.length, 0);
  const words = [blocks.length, exits.length, uopsTotal, 0];
  let off = 0;
  for (const b of blocks) {
    const t = b.term;
    const pos = t.kind === TK.NONE ? -1 : (t.pos === undefined ? b.uops.length : t.pos);
    words.push(off, b.uops.length, pos, t.kind,
      t.a | 0, t.b | 0, t.uop | 0, t.imm | 0, t.cc | 0,
      b.cost, b.succT, b.succF, b.eip | 0);
    if (words.length % 1 !== 0) throw new Error('impossible');
    off += b.uops.length;
  }
  if ((words.length - 4) !== blocks.length * REGION_BLOCK_WORDS) {
    throw new Error('region: block record width drifted from $REGION_BLOCK_WORDS');
  }
  for (const x of exits) words.push(x.eip | 0, x.liveOut);
  for (const b of blocks) for (const u of b.uops) words.push(...u);
  return words;
}

// Write the descriptor where $region_try_install will copy it from, and arm
// the install for this entry EIP. Called from a shape's setup(), i.e. OUTSIDE
// the timed region, and harmless on the off arm because $region_try_install
// returns immediately when $region_fold_enabled is 0.
function armRegion(e, g2w, a, entryEip, words) {
  if (words.length * 4 + 8 > 4096) {
    throw new Error(`region: ${words.length} words exceeds $decode_block's 4096-byte slack`);
  }
  const dv = new DataView(e.memory.buffer);
  const wa = g2w(a.spec);
  for (let i = 0; i < words.length; i++) dv.setInt32(wa + i * 4, words[i], true);
  e.set_region_spec(entryEip, a.spec, words.length);
}

const REGS8 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const regSnapshot = e => REGS8.filter(r => r !== 'esp')
  .map(r => `${r}=${(e[`get_${r}`]() >>> 0).toString(16)}`).join(' ');

// modrm for a two-byte `op r32, r/m32` in register form.
const rr = (op, reg, rm) => [op, 0xC0 | (reg << 3) | rm];

// --- STEP 1: one straight-line block, entered and left every iteration ------
// K reg-reg ALU ops, then `jmp $+0` to END THE BLOCK, then a separate
// dec/jnz block. The region therefore covers two blocks and is re-entered
// every trip, which is the case that applies to 100% of code -- unlike the
// self-loop fold, whose entry cost amortizes over the whole loop.
//
// r4 and r8 run the SAME x86 and differ only in the published live-out mask
// (four written registers vs all eight). Publishing a register the block did
// not change is semantically a no-op, so the pair isolates exactly one cost:
// what exit publication charges per register.
const BLK_CHAIN4 = [
  { code: rr(0x03, RG.eax, RG.esi), uop: uop(TU.ADD_RR, RG.eax, RG.esi, 0, FN.add_rr) },
  { code: rr(0x33, RG.edx, RG.eax), uop: uop(TU.XOR_RR, RG.edx, RG.eax, 0, FN.xor_rr) },
  { code: rr(0x03, RG.ebx, RG.edx), uop: uop(TU.ADD_RR, RG.ebx, RG.edx, 0, FN.add_rr) },
  { code: rr(0x03, RG.esi, RG.ebx), uop: uop(TU.ADD_RR, RG.esi, RG.ebx, 0, FN.add_rr) },
];
const BLK_CHAIN6 = BLK_CHAIN4.slice(0, 3).concat([
  { code: rr(0x03, RG.esi, RG.edi), uop: uop(TU.ADD_RR, RG.esi, RG.edi, 0, FN.add_rr) },
  { code: rr(0x33, RG.edi, RG.ebp), uop: uop(TU.XOR_RR, RG.edi, RG.ebp, 0, FN.xor_rr) },
  { code: rr(0x03, RG.ebp, RG.ebx), uop: uop(TU.ADD_RR, RG.ebp, RG.ebx, 0, FN.add_rr) },
]);

function regionBlockShape(k, wide) {
  const chain = wide ? BLK_CHAIN6 : BLK_CHAIN4;
  const liveOut = wide ? 0xFF
    : M(RG.eax) | M(RG.edx) | M(RG.ebx) | M(RG.esi) | M(RG.ecx);
  return {
    describe: `one ${k}-op straight-line block re-entered every trip, ` +
      `${wide ? '8' : '4'}-register live-out`,
    real: 'every basic block in every app; the per-block entry/exit cost of a region descriptor',
    emit(a) {
      const n = Math.max(20000, Math.floor(2_000_000 / k));
      const body = [];
      const uops = [];
      for (let i = 0; i < k; i++) {
        body.push(...chain[i % chain.length].code);
        uops.push(chain[i % chain.length].uop);
      }
      const bodyLen = body.length;                 // 2 bytes per op
      const code = body.concat([0xEB, 0x00],       // jmp $+0 — ends the block
        [0x49], [0x75], rel8(-(bodyLen + 5)));     // dec ecx / jnz top
      const base = a.codeAddr;
      const blocks = [
        { uops, term: { kind: TK.NONE }, cost: k + 1, succT: 0, succF: 1, eip: base },
        { uops: [], cost: 2, succT: 0, succF: -1, eip: base + bodyLen + 2,
          term: { kind: TK.DECINC, a: RG.ecx, uop: 0, cc: CC.nz, pos: 0 } },
      ];
      const exits = [{ eip: base + bodyLen + 5, liveOut }];
      const words = regionWords(blocks, exits);
      return {
        iters: n, bytesTouched: 0, code,
        setup(e, mem, g2w) {
          e.set_eax(1); e.set_edx(2); e.set_ebx(3);
          e.set_esi(5); e.set_edi(7); e.set_ebp(11);
          e.set_ecx(n);
          armRegion(e, g2w, a, base, words);
        },
        checksum: regSnapshot,
        verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
      };
    },
  };
}

for (const k of [2, 4, 8, 16, 32]) {
  SHAPES[`region_blk${k}_r4`] = regionBlockShape(k, false);
  SHAPES[`region_blk${k}_r8`] = regionBlockShape(k, true);
}

// --- the same block, but the descriptor is BUILT BY THE DECODER -------------
// `blk{k}` is `region_blk{k}_r8`'s x86 with no hand-written region spec, for
// --toggle=block_exec (H458, src/07c-block-exec.wat). The distinction matters:
// region_blk* measures the *mechanism* with a descriptor an operator wrote by
// hand for one entry EIP, and can therefore be armed for a shape no matcher
// would ever install. These measure what an app actually gets, because the
// only thing standing between the x86 and the executor is
// $block_exec_try_install. A `blk8` win that region_blk8_r8 does not show, or
// the reverse, is a matcher question and not an executor one.
//
// Both blocks of the loop are covered here where the region shape covers them
// as one descriptor: H458 installs per block, so the k-op straight-line block
// gets a descriptor and the two-op `dec ecx / jnz` block is below
// $block_exec_min_uops and stays threaded. That asymmetry is the honest
// picture of the fold, not a defect of the shape.
function blockExecShape(k) {
  const chain = BLK_CHAIN6;
  return {
    describe: `one ${k}-op straight-line block re-entered every trip, ` +
      `descriptor installed by the decoder (H458)`,
    real: 'every basic block in every app; what --block-exec actually collects',
    emit(a) {
      const n = Math.max(20000, Math.floor(2_000_000 / k));
      const body = [];
      for (let i = 0; i < k; i++) body.push(...chain[i % chain.length].code);
      const bodyLen = body.length;                 // 2 bytes per op
      const code = body.concat([0xEB, 0x00],       // jmp $+0 — ends the block
        [0x49], [0x75], rel8(-(bodyLen + 5)));     // dec ecx / jnz top
      return {
        iters: n, bytesTouched: 0, code,
        setup(e) {
          e.set_eax(1); e.set_edx(2); e.set_ebx(3);
          e.set_esi(5); e.set_edi(7); e.set_ebp(11);
          e.set_ecx(n);
        },
        checksum: regSnapshot,
        verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
      };
    },
  };
}
for (const k of [2, 4, 8, 16, 32]) SHAPES[`blk${k}`] = blockExecShape(k);

// A block whose ops go to MEMORY rather than staying in registers, and one
// with a deliberate hole in the executor's vocabulary in the middle of it.
// Together they bracket the two ways a real block differs from `blk8`: the
// register file is not the only cost, and a single unimplemented opcode drags
// its whole block through spill/call/reload.
SHAPES.blk_mem8 = {
  describe: '8-op block of base+disp dword loads/stores re-entered every trip',
  real: 'the memory half of an ordinary block; $g2w is not what H458 removes',
  emit(a) {
    const n = 250000;
    const body = [];
    for (let i = 0; i < 4; i++) {
      body.push(0x8B, 0x46, i * 4);                // mov eax, [esi+i*4]
      body.push(0x89, 0x47, i * 4);                // mov [edi+i*4], eax
    }
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: n * 32, code,
      setup(e) {
        e.set_esi(a.buf); e.set_edi(a.buf + 0x1000); e.set_ecx(n);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};
SHAPES.blk_fb8 = {
  describe: '8-op block with one ADC in the middle (a fallback inside the descriptor)',
  real: 'the cost of one unimplemented opcode: spill 8, call the handler, reload 8',
  emit(a) {
    const n = 250000;
    const body = [];
    for (let i = 0; i < 4; i++) body.push(...BLK_CHAIN6[i % BLK_CHAIN6.length].code);
    body.push(0x11, 0xC3);                          // adc ebx, eax — not implemented
    for (let i = 4; i < 7; i++) body.push(...BLK_CHAIN6[i % BLK_CHAIN6.length].code);
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: 0, code,
      setup(e) {
        e.set_eax(1); e.set_edx(2); e.set_ebx(3);
        e.set_esi(5); e.set_edi(7); e.set_ebp(11);
        e.set_ecx(n);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// --- ROUND 11: the shapes --toggle=block_exec_split is about ----------------
// Neither of these is interesting under --toggle=block_exec; both are chosen so
// that turning the PASS off inside an already-armed executor changes the
// descriptor. Run them as `--shapes=blk_rld8,blk_memalu8 --toggle=block_exec_split`.
//
// blk_rld8: four dword reads of TWO addresses, alternating, with only register
// work between them. The alias rule holds across all of it (no store, no push,
// no unmodelled op, and the base register is never written), so two of the four
// loads are redundant and become register moves. This is the upper bound on
// what redundant-load elimination is worth: real blocks interleave stores.
SHAPES.blk_rld8 = {
  describe: '8-op block, four dword loads of two addresses with two repeats',
  real: 'the re-read of one struct field a few instructions apart',
  emit(a) {
    const n = 250000;
    const body = [
      0x8B, 0x46, 0x00,                   // mov eax,[esi+0]
      0x8B, 0x5E, 0x10,                   // mov ebx,[esi+0x10]
      0x31, 0xC0 | (RG.eax << 3) | RG.edx, // xor edx,eax
      0x8B, 0x6E, 0x00,                   // mov ebp,[esi+0]     <- redundant
      0x31, 0xC0 | (RG.ebx << 3) | RG.edi, // xor edi,ebx
      0x8B, 0x7E, 0x10,                   // mov edi,[esi+0x10]  <- redundant
      0x31, 0xC0 | (RG.ebp << 3) | RG.edx, // xor edx,ebp
    ];
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: n * 8, code,
      setup(e) {
        e.set_esi(a.buf); e.set_eax(1); e.set_ebx(3); e.set_edx(2);
        e.set_ebp(11); e.set_edi(7); e.set_ecx(n);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// blk_memalu8: six `op r32,[esi+disp]` instructions. Without the split each is
// a FALLBACK — spill 8 registers, call_indirect, reload 8 — so this shape is
// the one where the pass changes the KIND of work rather than the amount of
// it. Expect the largest effect here and treat it as an upper bound for the
// same reason as above: it is six fallbacks in a row and no real block is.
SHAPES.blk_memalu8 = {
  describe: '6-op block of `op r32,[esi+disp]` memory-source ALU',
  real: 'accumulate-from-memory code; a FALLBACK per op until the split',
  emit(a) {
    const n = 250000;
    const body = [
      0x03, 0x46, 0x00,   // add eax,[esi+0]
      0x2B, 0x5E, 0x04,   // sub ebx,[esi+4]
      0x23, 0x56, 0x08,   // and edx,[esi+8]
      0x0B, 0x6E, 0x0C,   // or  ebp,[esi+0xc]
      0x33, 0x7E, 0x10,   // xor edi,[esi+0x10]
      0x03, 0x46, 0x14,   // add eax,[esi+0x14]
    ];
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: n * 24, code,
      setup(e) {
        e.set_esi(a.buf); e.set_eax(1); e.set_ebx(3); e.set_edx(0xFFFF);
        e.set_ebp(11); e.set_edi(7); e.set_ecx(n);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// --- ROUND 12: the shapes levers A and C are about -------------------------
//
// blk_x87mix: an integer block with ONE x87 memory pair sitting in the middle
// of it. This is §4c's "an integer op interleaved inside the x87 run" seen from
// the other side, and it is the block round 11 declined outright. The store
// that plants the operand is inside the loop on purpose: it makes the block
// self-contained (nothing depends on what the buffer happened to hold) and it
// is a fact-killing store, which is what a real x87-carrying block has too.
//
// ROUND 15 CORRECTION -- the store was `mov dword [esi+8],imm32`, and THAT
// form is itself a TU_FALLBACK. So every one of these three shapes was paying
// one spill-eight / call_indirect / reload-eight per iteration that had
// nothing to do with x87, and the fallback dominated the arm: the counters
// read 250,000 fallbacks in a 250,000-iteration run. It is now
// `mov [esi+8],ebp` with ebp preloaded to 1.0f -- same fact-killing store,
// same bytes written, but a modelled kind, so the ON arm runs 100% native
// (fallback=0) and the delta is the x87 handling and the descriptor, which is
// what these shapes were supposed to be measuring.
// Run as `--shapes=blk_x87mix --toggle=block_exec_x87`.
SHAPES.blk_x87mix = {
  describe: '5-op block: an fld/fstp pair between integer ops',
  real: 'scalar float shuffling inside otherwise integer code',
  emit(a) {
    const n = 250000;
    const body = [
      0x89, 0x6E, 0x08,                           // mov [esi+8],ebp   (ebp = 1.0f)
      0xD9, 0x46, 0x08,                           // fld  dword [esi+8]
      0xD9, 0x5E, 0x10,                           // fstp dword [esi+0x10]
      0x03, 0x46, 0x00,                           // add eax,[esi+0]
      0x31, 0xC0 | (RG.eax << 3) | RG.edx,        // xor edx,eax
    ];
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: n * 16, code,
      setup(e) {
        e.set_esi(a.buf); e.set_eax(1); e.set_edx(2); e.set_ecx(n);
        e.set_ebp(0x3F800000);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// --- ROUND 15: two more x87 shapes, for the TU_X87RUN price -----------------
//
// blk_x87mix prices the lever on a block that is MOSTLY x87 -- two x87 ops
// against three integer ones. That is the shape the cost model is meant to
// decline, so on its own it cannot say whether the cheap kind made the x87
// micro-op cheaper; it can only say the whole block got faster or slower.
// These two isolate the other two questions.
//
// blk_x87long: the same fld/fstp pair with a LONG integer body around it --
// twelve integer ops to two x87 ones. This is §4c's actual claim (an x87 op
// sitting inside integer code, not the other way round) and it is the block
// the round is for: the integer half is what becomes reachable.
// Run as `--shapes=blk_x87long --toggle=block_exec_x87`.
SHAPES.blk_x87long = {
  describe: '14-op block: one fld/fstp pair inside a long integer body',
  real: 'an x87 op stranded in otherwise integer code (quake2 +0x10011cd1)',
  emit(a) {
    const n = 250000;
    const body = [
      0x89, 0x6E, 0x08,                           // mov [esi+8],ebp   (ebp = 1.0f)
      0x03, 0x46, 0x00,                           // add eax,[esi+0]
      0x33, 0x5E, 0x04,                           // xor ebx,[esi+4]
      0x8B, 0x7E, 0x0C,                           // mov edi,[esi+0xc]
      0x01, 0xF8,                                 // add eax,edi
      0x8D, 0x5C, 0x1B, 0x03,                     // lea ebx,[ebx+ebx+3]
      0xD9, 0x46, 0x08,                           // fld  dword [esi+8]
      0xD9, 0x5E, 0x10,                           // fstp dword [esi+0x10]
      0x31, 0xD8,                                 // xor eax,ebx
      0x8B, 0x56, 0x14,                           // mov edx,[esi+0x14]
      0x01, 0xC2,                                 // add edx,eax
      0x8D, 0x7C, 0x3F, 0x01,                     // lea edi,[edi+edi+1]
      0x29, 0xFA,                                 // sub edx,edi
      0x21, 0xD3,                                 // and ebx,edx
    ];
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: n * 24, code,
      setup(e) {
        e.set_esi(a.buf); e.set_eax(1); e.set_ebx(3); e.set_edx(2);
        e.set_edi(7); e.set_ecx(n); e.set_ebp(0x3F800000);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// blk_x87sw: fld / fcomp / fnstsw ax / integer. FNSTSW AX is the one x87
// instruction that WRITES a general register, so this is the shape where the
// round-15 partial publish has to be wrong if it is wrong: the bare-op path
// classifies it as TU_X87_SW_AX, which publishes EAX, calls, and reloads EAX
// alone. Correctness is test-block-exec.js's job; this is here for the price,
// because that kind pays two global accesses no other x87 kind does.
// Run as `--shapes=blk_x87sw --toggle=block_exec_x87`.
SHAPES.blk_x87sw = {
  describe: '7-op block: fld / fcomp / fnstsw ax, then integer work',
  real: 'the pre-P6 float compare: fcom / fnstsw ax / test ah,imm',
  emit(a) {
    const n = 250000;
    const body = [
      0x89, 0x6E, 0x08,                           // mov [esi+8],ebp   (ebp = 1.0f)
      0xD9, 0x46, 0x08,                           // fld  dword [esi+8]
      0xD8, 0x5E, 0x08,                           // fcomp dword [esi+8]
      0xDF, 0xE0,                                 // fnstsw ax
      0x25, 0x00, 0x47, 0x00, 0x00,               // and eax,0x4700
      0x03, 0x5E, 0x00,                           // add ebx,[esi+0]
      0x31, 0xC3,                                 // xor ebx,eax
    ];
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: n * 12, code,
      setup(e) {
        e.set_esi(a.buf); e.set_eax(1); e.set_ebx(3); e.set_ecx(n);
        e.set_ebp(0x3F800000);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// blk_rmw8: six read-modify-write memory forms in a row. Until lever C each was
// a whole-instruction FALLBACK — spill eight, call_indirect, reload eight — so
// like blk_memalu8 this shape changes the KIND of work rather than its amount,
// and like it, it is an upper bound: no real block is six RMWs in a row.
// Run as `--shapes=blk_rmw8 --toggle=block_exec_rmw`.
SHAPES.blk_rmw8 = {
  describe: '6-op block of read-modify-write memory forms',
  real: 'in-place counters and accumulators; a FALLBACK per op until the split',
  emit(a) {
    const n = 250000;
    const body = [
      0x01, 0x46, 0x00,               // add [esi+0],eax
      0x29, 0x5E, 0x04,               // sub [esi+4],ebx
      0x31, 0x7E, 0x08,               // xor [esi+8],edi
      0x81, 0x46, 0x0C, 1, 0, 0, 0,   // add dword [esi+0xc],1
      0xFF, 0x46, 0x10,               // inc dword [esi+0x10]
      0xF7, 0x5E, 0x14,               // neg dword [esi+0x14]
    ];
    const bodyLen = body.length;
    const code = body.concat([0xEB, 0x00], [0x49], [0x75], rel8(-(bodyLen + 5)));
    return {
      iters: n, bytesTouched: n * 48, code,
      setup(e) {
        e.set_esi(a.buf); e.set_eax(1); e.set_ebx(3); e.set_edi(7);
        e.set_ecx(n);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// --- STEP 2 (a): 2-block if/else loop --------------------------------------
// while (esi < edx) { ebx += *esi; esi += 4; }  — a guard block and a body
// block. The guard's taken edge is the loop exit, which is the one shape a
// self-loop matcher can never see.
SHAPES.region_if2 = {
  describe: '2-block guarded accumulate loop (guard block + body block)',
  real: 'the `cmp cursor,end / jae done` head every bounded scan compiles to',
  emit(a) {
    const n = Math.min(1_000_000, Math.floor(a.bufBytes / 4));
    const base = a.codeAddr;
    const code = [
      0x3B, 0xC0 | (RG.esi << 3) | RG.edx,        // +0  cmp esi, edx
      0x73, 9,                                     // +2  jae DONE(+13)
      0x8B, 0x00 | (RG.eax << 3) | RG.esi,        // +4  mov eax,[esi]
      0x03, 0xC0 | (RG.ebx << 3) | RG.eax,        // +6  add ebx,eax
      0x83, 0xC0 | RG.esi, 4,                      // +8  add esi,4
      0xEB, (-13) & 0xFF,                          // +11 jmp +0
    ];                                             // +13 DONE
    const blocks = [
      { uops: [], cost: 2, succT: -1, succF: 1, eip: base,
        term: { kind: TK.CMP_RR, a: RG.esi, b: RG.edx, cc: CC.ae, pos: 0 } },
      { uops: [
          uop(TU.LOAD32, RG.eax, RG.esi, 0, FN.load_ro),
          uop(TU.ADD_RR, RG.ebx, RG.eax, 0, FN.add_rr),
          uop(TU.ADD_RI, RG.esi, RG.esi, 4, FN.add_ri),
        ], term: { kind: TK.NONE }, cost: 4, succT: 0, succF: 0, eip: base + 4 },
    ];
    const exits = [{ eip: base + 13,
      liveOut: M(RG.eax) | M(RG.ebx) | M(RG.esi) }];
    const words = regionWords(blocks, exits);
    return {
      iters: n, bytesTouched: n * 4, code,
      setup(e, mem, g2w) {
        const dv = new DataView(e.memory.buffer);
        const wa = g2w(a.buf);
        for (let i = 0; i < n; i++) dv.setUint32(wa + i * 4, (i * 2654435761) >>> 0, true);
        e.set_ebx(0); e.set_eax(0);
        e.set_esi(a.buf); e.set_edx(a.buf + n * 4);
        armRegion(e, g2w, a, base, words);
      },
      checksum: regSnapshot,
      verify: e => (e.get_esi() >>> 0) === ((a.buf + n * 4) >>> 0)
        ? null : `esi=0x${(e.get_esi() >>> 0).toString(16)}, expected 0x${(a.buf + n * 4).toString(16)}`,
    };
  },
};

// --- STEP 2 (b): 4-block diamond loop --------------------------------------
SHAPES.region_diamond4 = {
  describe: '4-block diamond loop (head, two arms, tail)',
  real: 'the data-dependent if/else inside a per-element loop; match-loops.js calls it multi-branch',
  emit(a) {
    const n = Math.min(500_000, Math.floor(a.bufBytes / 4));
    const base = a.codeAddr;
    const THR = 0x40000000;
    const code = [
      0x8B, 0x00 | (RG.eax << 3) | RG.esi,        // +0  mov eax,[esi]
      0x83, 0xC0 | RG.esi, 4,                      // +2  add esi,4
      0x3D, ...le32(THR),                          // +5  cmp eax, THR
      0x72, 4,                                     // +10 jb ELSE(+16)
      0x03, 0xC0 | (RG.ebx << 3) | RG.eax,        // +12 add ebx,eax
      0xEB, 4,                                     // +14 jmp TAIL(+20)
      0x2B, 0xC0 | (RG.ebx << 3) | RG.eax,        // +16 sub ebx,eax
      0xEB, 0,                                     // +18 jmp TAIL(+20)
      0x49,                                        // +20 dec ecx
      0x75, (-23) & 0xFF,                          // +21 jnz +0
    ];                                             // +23 END
    const blocks = [
      { uops: [
          uop(TU.LOAD32, RG.eax, RG.esi, 0, FN.load_ro),
          uop(TU.ADD_RI, RG.esi, RG.esi, 4, FN.add_ri),
        ], cost: 4, succT: 2, succF: 1, eip: base,
        term: { kind: TK.CMP_RI, a: RG.eax, b: THR, cc: CC.b, pos: 2 } },
      { uops: [uop(TU.ADD_RR, RG.ebx, RG.eax, 0, FN.add_rr)],
        term: { kind: TK.NONE }, cost: 2, succT: 3, succF: 3, eip: base + 12 },
      { uops: [uop(TU.SUB_RR, RG.ebx, RG.eax, 0, FN.sub_rr)],
        term: { kind: TK.NONE }, cost: 2, succT: 3, succF: 3, eip: base + 16 },
      { uops: [], cost: 2, succT: 0, succF: -1, eip: base + 20,
        term: { kind: TK.DECINC, a: RG.ecx, uop: 0, cc: CC.nz, pos: 0 } },
    ];
    const exits = [{ eip: base + 23,
      liveOut: M(RG.eax) | M(RG.ecx) | M(RG.ebx) | M(RG.esi) }];
    const words = regionWords(blocks, exits);
    return {
      iters: n, bytesTouched: n * 4, code,
      setup(e, mem, g2w) {
        const dv = new DataView(e.memory.buffer);
        const wa = g2w(a.buf);
        for (let i = 0; i < n; i++) dv.setUint32(wa + i * 4, (i * 2654435761) >>> 0, true);
        e.set_ebx(0); e.set_eax(0); e.set_ecx(n); e.set_esi(a.buf);
        armRegion(e, g2w, a, base, words);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// --- STEP 2 (c): 6-block state machine loop --------------------------------
SHAPES.region_state6 = {
  describe: '6-block state-machine loop (two-rung dispatch, three arms, tail)',
  real: 'a token loop whose head is a compare chain — the shape match-loops.js declines as multi-branch',
  emit(a) {
    const n = Math.min(500_000, Math.floor(a.bufBytes / 4));
    const base = a.codeAddr;
    const code = [
      0x8B, 0x00 | (RG.eax << 3) | RG.esi,        // +0  mov eax,[esi]
      0x83, 0xC0 | RG.esi, 4,                      // +2  add esi,4
      0x83, 0xE0, 3,                               // +5  and eax,3
      0x83, 0xF8, 1,                               // +8  cmp eax,1
      0x72, 9,                                     // +11 jb A0(+22)
      0x83, 0xF8, 2,                               // +13 cmp eax,2
      0x72, 8,                                     // +16 jb A1(+26)
      0x33, 0xC0 | (RG.ebx << 3) | RG.eax,        // +18 A2: xor ebx,eax
      0xEB, 8,                                     // +20 jmp TAIL(+30)
      0x03, 0xC0 | (RG.ebx << 3) | RG.eax,        // +22 A0: add ebx,eax
      0xEB, 4,                                     // +24 jmp TAIL(+30)
      0x2B, 0xC0 | (RG.ebx << 3) | RG.eax,        // +26 A1: sub ebx,eax
      0xEB, 0,                                     // +28 jmp TAIL(+30)
      0x49,                                        // +30 dec ecx
      0x75, (-33) & 0xFF,                          // +31 jnz +0
    ];                                             // +33 END
    const arm = (op, fn, at, succ) => ({
      uops: [uop(op, RG.ebx, RG.eax, 0, fn)],
      term: { kind: TK.NONE }, cost: 2, succT: succ, succF: succ, eip: base + at });
    const blocks = [
      { uops: [
          uop(TU.LOAD32, RG.eax, RG.esi, 0, FN.load_ro),
          uop(TU.ADD_RI, RG.esi, RG.esi, 4, FN.add_ri),
          uop(TU.AND_RI, RG.eax, RG.eax, 3, FN.and_ri),
        ], cost: 5, succT: 3, succF: 1, eip: base,
        term: { kind: TK.CMP_RI, a: RG.eax, b: 1, cc: CC.b, pos: 3 } },
      { uops: [], cost: 2, succT: 4, succF: 2, eip: base + 13,
        term: { kind: TK.CMP_RI, a: RG.eax, b: 2, cc: CC.b, pos: 0 } },
      arm(TU.XOR_RR, FN.xor_rr, 18, 5),
      arm(TU.ADD_RR, FN.add_rr, 22, 5),
      arm(TU.SUB_RR, FN.sub_rr, 26, 5),
      { uops: [], cost: 2, succT: 0, succF: -1, eip: base + 30,
        term: { kind: TK.DECINC, a: RG.ecx, uop: 0, cc: CC.nz, pos: 0 } },
    ];
    const exits = [{ eip: base + 33,
      liveOut: M(RG.eax) | M(RG.ecx) | M(RG.ebx) | M(RG.esi) }];
    const words = regionWords(blocks, exits);
    return {
      iters: n, bytesTouched: n * 4, code,
      setup(e, mem, g2w) {
        const dv = new DataView(e.memory.buffer);
        const wa = g2w(a.buf);
        for (let i = 0; i < n; i++) dv.setUint32(wa + i * 4, (i * 2654435761) >>> 0, true);
        e.set_ebx(0); e.set_eax(0); e.set_ecx(n); e.set_esi(a.buf);
        armRegion(e, g2w, a, base, words);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// --- STEP 2 (d): the Caesar RLE compare ladder, 5 cases --------------------
SHAPES.region_ladder5 = {
  describe: '10-block RLE token ladder (4 compare rungs, 5 case bodies, tail)',
  real: "Caesar III's 0x40f71c sprite blitter — the nest tools/find-rle-nests.js finds",
  emit(a) {
    const n = Math.min(400_000, Math.floor(a.bufBytes / 6));
    const dst = a.buf + ((n + 15) & ~15);
    const base = a.codeAddr;
    const addEdi4 = [0x83, 0xC0 | RG.edi, 4];
    const code = [
      0x0F, 0xB6, 0x00 | (RG.eax << 3) | RG.esi,  // +0  movzx eax, byte [esi]
      0x46,                                        // +3  inc esi
      0x83, 0xF8, 0,                               // +4  cmp eax,0
      0x74, 22,                                    // +7  je C0(+31)
      0x83, 0xF8, 1,                               // +9  cmp eax,1
      0x74, 22,                                    // +12 je C1(+36)
      0x83, 0xF8, 2,                               // +14 cmp eax,2
      0x74, 24,                                    // +17 je C2(+43)
      0x83, 0xF8, 3,                               // +19 cmp eax,3
      0x74, 26,                                    // +22 je C3(+50)
      0x33, 0xC0 | (RG.ebx << 3) | RG.eax,        // +24 C4: xor ebx,eax
      ...addEdi4,                                  // +26
      0xEB, 26,                                    // +29 jmp TAIL(+57)
      ...addEdi4,                                  // +31 C0
      0xEB, 21,                                    // +34 jmp TAIL
      0x89, 0x00 | (RG.eax << 3) | RG.edi,        // +36 C1: mov [edi],eax
      ...addEdi4,                                  // +38
      0xEB, 14,                                    // +41 jmp TAIL
      0x89, 0x00 | (RG.ebx << 3) | RG.edi,        // +43 C2: mov [edi],ebx
      ...addEdi4,                                  // +45
      0xEB, 7,                                     // +48 jmp TAIL
      0x03, 0xC0 | (RG.ebx << 3) | RG.eax,        // +50 C3: add ebx,eax
      ...addEdi4,                                  // +52
      0xEB, 0,                                     // +55 jmp TAIL(+57)
      0x49,                                        // +57 dec ecx
      0x75, (-60) & 0xFF,                          // +58 jnz +0
    ];                                             // +60 END
    const bump = uop(TU.ADD_RI, RG.edi, RG.edi, 4, FN.add_ri);
    const rung = (imm, at, taken, fall) => ({
      uops: [], cost: 2, succT: taken, succF: fall, eip: base + at,
      term: { kind: TK.CMP_RI, a: RG.eax, b: imm, cc: CC.z, pos: 0 } });
    const body = (uops, at) => ({
      uops: uops.concat([bump]), term: { kind: TK.NONE },
      cost: uops.length + 2, succT: 9, succF: 9, eip: base + at });
    const blocks = [
      { uops: [
          uop(TU.MOVZX8_RO, RG.eax, RG.esi, 0, FN.movzx8_ro),
          uop(TU.INC, RG.esi, RG.esi, 0, FN.inc),
        ], cost: 4, succT: 5, succF: 1, eip: base,
        term: { kind: TK.CMP_RI, a: RG.eax, b: 0, cc: CC.z, pos: 2 } },
      rung(1, 9, 6, 2),
      rung(2, 14, 7, 3),
      rung(3, 19, 8, 4),
      body([uop(TU.XOR_RR, RG.ebx, RG.eax, 0, FN.xor_rr)], 24),   // 4: C4
      body([], 31),                                               // 5: C0
      body([uop(TU.STORE32, RG.eax, RG.edi, 0, FN.store_ro)], 36),// 6: C1
      body([uop(TU.STORE32, RG.ebx, RG.edi, 0, FN.store_ro)], 43),// 7: C2
      body([uop(TU.ADD_RR, RG.ebx, RG.eax, 0, FN.add_rr)], 50),   // 8: C3
      { uops: [], cost: 2, succT: 0, succF: -1, eip: base + 57,
        term: { kind: TK.DECINC, a: RG.ecx, uop: 0, cc: CC.nz, pos: 0 } },
    ];
    const exits = [{ eip: base + 60,
      liveOut: M(RG.eax) | M(RG.ecx) | M(RG.ebx) | M(RG.esi) | M(RG.edi) }];
    const words = regionWords(blocks, exits);
    return {
      iters: n, bytesTouched: n * 5, code,
      setup(e, mem, g2w) {
        const wa = g2w(a.buf);
        // Token stream: every case exercised, none of them in a predictable
        // period short enough for the host branch predictor to memorize.
        for (let i = 0; i < n; i++) mem[wa + i] = (i * 7 + (i >> 3)) % 5;
        e.set_ebx(1); e.set_eax(0); e.set_ecx(n);
        e.set_esi(a.buf); e.set_edi(dst);
        armRegion(e, g2w, a, base, words);
      },
      checksum: regSnapshot,
      verify: e => e.get_ecx() === 0 ? null : `ecx=${e.get_ecx()}, expected 0`,
    };
  },
};

// --- STEP 2 (e): a call-free leaf, frame stores KEPT ------------------------
// The callee body is inlined but the call frame is not elided: the return
// address is still materialized, still pushed on a shadow stack, and still
// popped. That is what a region descriptor could honestly do to a leaf call --
// it makes the control transfer static without pretending the stores away.
SHAPES.region_call1 = {
  describe: '3-block inlined leaf call with the frame stores kept',
  real: 'a per-element helper call; `call` is 30% of every match-loops.js decline histogram',
  emit(a) {
    const n = Math.min(500_000, Math.floor(a.bufBytes / 8));
    const shadow = a.buf + Math.floor(a.bufBytes / 2);
    const base = a.codeAddr;
    // A FIXED sentinel, not `base + 28`. The value is only stored and reloaded
    // — the return is static because the callee is inlined — and the real
    // return address moves with the fresh code page every rep, which would
    // make the cross-arm checksum differ for a reason that has nothing to do
    // with the fold.
    const ret = 0x00CA11ED;
    const code = [
      0x8B, 0x00 | (RG.eax << 3) | RG.esi,        // +0  mov eax,[esi]
      0x83, 0xC0 | RG.esi, 4,                      // +2  add esi,4
      0xB8 + RG.edx, ...le32(ret),                 // +5  mov edx, RETADDR
      0x83, 0xE8 | RG.edi, 4,                      // +10 sub edi,4
      0x89, 0x00 | (RG.edx << 3) | RG.edi,        // +13 mov [edi],edx
      0xEB, 0,                                     // +15 jmp CALLEE(+17)
      0x03, 0xC0 | (RG.ebx << 3) | RG.eax,        // +17 add ebx,eax
      0x33, 0xC0 | (RG.ebx << 3) | RG.edx,        // +19 xor ebx,edx
      0x8B, 0x00 | (RG.edx << 3) | RG.edi,        // +21 mov edx,[edi]
      0x83, 0xC0 | RG.edi, 4,                      // +23 add edi,4
      0xEB, 0,                                     // +26 jmp RET(+28)
      0x49,                                        // +28 dec ecx
      0x75, (-31) & 0xFF,                          // +29 jnz +0
    ];                                             // +31 END
    const blocks = [
      { uops: [
          uop(TU.LOAD32, RG.eax, RG.esi, 0, FN.load_ro),
          uop(TU.ADD_RI, RG.esi, RG.esi, 4, FN.add_ri),
          uop(TU.MOV_RI, RG.edx, RG.edx, ret, FN.mov_ri),
          uop(TU.SUB_RI, RG.edi, RG.edi, 4, FN.sub_ri),
          uop(TU.STORE32, RG.edx, RG.edi, 0, FN.store_ro),
        ], term: { kind: TK.NONE }, cost: 6, succT: 1, succF: 1, eip: base },
      { uops: [
          uop(TU.ADD_RR, RG.ebx, RG.eax, 0, FN.add_rr),
          uop(TU.XOR_RR, RG.ebx, RG.edx, 0, FN.xor_rr),
          uop(TU.LOAD32, RG.edx, RG.edi, 0, FN.load_ro),
          uop(TU.ADD_RI, RG.edi, RG.edi, 4, FN.add_ri),
        ], term: { kind: TK.NONE }, cost: 5, succT: 2, succF: 2, eip: base + 17 },
      { uops: [], cost: 2, succT: 0, succF: -1, eip: base + 28,
        term: { kind: TK.DECINC, a: RG.ecx, uop: 0, cc: CC.nz, pos: 0 } },
    ];
    const exits = [{ eip: base + 31,
      liveOut: M(RG.eax) | M(RG.ecx) | M(RG.edx) | M(RG.ebx) | M(RG.esi) | M(RG.edi) }];
    const words = regionWords(blocks, exits);
    return {
      iters: n, bytesTouched: n * 12, code,
      setup(e, mem, g2w) {
        const dv = new DataView(e.memory.buffer);
        const wa = g2w(a.buf);
        for (let i = 0; i < n; i++) dv.setUint32(wa + i * 4, (i * 2654435761) >>> 0, true);
        e.set_ebx(0); e.set_eax(0); e.set_edx(0); e.set_ecx(n);
        e.set_esi(a.buf); e.set_edi(shadow);
        armRegion(e, g2w, a, base, words);
      },
      checksum: regSnapshot,
      verify(e) {
        if (e.get_ecx() !== 0) return `ecx=${e.get_ecx()}, expected 0`;
        return (e.get_edi() >>> 0) === (shadow >>> 0)
          ? null : `edi=0x${(e.get_edi() >>> 0).toString(16)}, shadow stack unbalanced`;
      },
    };
  },
};

// --- NULL control -----------------------------------------------------------
// Byte-identical work in both arms: the spec is armed for an EIP the guest
// never reaches, so nothing installs whatever the toggle says. Whatever this
// prints is the harness's own floor for the session.
SHAPES.region_null = {
  describe: 'NULL control — the diamond shape with the region spec armed at an unreachable EIP',
  real: 'nothing; this is the noise floor both arms of every region shape share',
  emit(a) {
    const inner = SHAPES.region_diamond4.emit(a);
    const setup = inner.setup;
    return Object.assign({}, inner, {
      setup(e, mem, g2w) { setup(e, mem, g2w); e.set_region_spec(0, 0, 0); },
    });
  },
};

const TOGGLES = {
  region: 'set_region_fold',
  tree_fold: 'set_tree_fold',
  lut_superops: 'set_loop_lut_emit',
  lut16_stack: 'set_loop_lut16_stack_emit',
  case_chain: 'set_case_chain',
  rle_run: 'set_rle_run',
  rect_run: 'set_rect_run',
  ck_lut16: 'set_ck_lut16',
  ck_blend16: 'set_ck_blend16',
  ck_shadow16: 'set_ck_shadow16',
  block_exec: 'set_block_exec',
  // Round 11's decode-time load/op split. It is not a fold of its own: it only
  // exists inside a descriptor, so BOTH arms must have the executor armed and
  // only the pass may differ. A plain setter name cannot express that, so a
  // toggle may also be a function of (exports, armValue).
  // The explicit uop floor is set too, and that is not a thumb on the scale:
  // with min_uops at its default 0 the executor uses its cost model, and the
  // model declines every shape in this file (declWhy 1) because a synthetic
  // 6-8 op block does not repay one descriptor entry. Both arms then run the
  // ordinary interpreter and the measurement is of nothing. A floor of 2 makes
  // the descriptor install in BOTH arms, which is the only configuration in
  // which the split is the one thing that differs.
  block_exec_split: (e, v) => {
    e.set_block_exec(1);
    e.set_block_exec_min_uops(2);
    e.set_block_exec_split(v);
  },
  // Round 12's three levers, all with the same shape of contract as
  // block_exec_split: the executor is armed in BOTH arms and only the lever
  // varies, so what is timed is the lever and not the executor.
  //
  // block_exec_x87 is the one whose OFF arm runs no descriptor at all: round
  // 11 declined any block holding an x87 op outright, so `off` here is the
  // plain interpreter and `on` is a descriptor with one fallback in it. That
  // is the real comparison the lever makes and not a rigged one -- but it does
  // mean the delta includes the whole descriptor, not just the x87 handling.
  block_exec_x87: (e, v) => {
    e.set_block_exec(1);
    e.set_block_exec_min_uops(2);
    e.set_block_exec_x87(v);
  },
  block_exec_carry: (e, v) => {
    e.set_block_exec(1);
    e.set_block_exec_min_uops(2);
    e.set_block_exec_carry(v);
  },
  block_exec_rmw: (e, v) => {
    e.set_block_exec(1);
    e.set_block_exec_min_uops(2);
    e.set_block_exec_rmw(v);
  },
};
const applyToggle = (e, name, v) => {
  const t = TOGGLES[name];
  if (typeof t === 'function') t(e, v); else e[t](v);
};

// ---------------------------------------------------------------------------
// Instance management
// ---------------------------------------------------------------------------
let TOP_N = 6;

function ensureBuilt() {
  let wasmTime = 0;
  try { wasmTime = fs.statSync(WASM_PATH).mtimeMs; } catch (_) {}
  const srcDir = path.join(ROOT, 'src');
  const stale = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.wat'))
    .some(f => fs.statSync(path.join(srcDir, f)).mtimeMs > wasmTime);
  if (stale) {
    console.error('Building...');
    execSync('bash tools/build.sh', { cwd: ROOT, stdio: 'inherit' });
  }
}

async function newInstance() {
  const { createHostImports } = require(path.join(ROOT, 'lib/host-imports'));
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const exeBytes = fs.readFileSync(path.join(ROOT, 'test', 'binaries', 'notepad.exe'));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const h = createHostImports(ctx).host;
  h.memory = memory;
  h.exit = () => {};
  h.log = () => {};
  h.log_i32 = process.env.BENCH_TRACE_LOOP
    ? v => console.log(`[i32] 0x${(v >>> 0).toString(16)}`)
    : () => {};
  h.crash_unimplemented = () => {};
  h.wait_multiple = () => 0;
  h.shell_execute = () => 33;

  const { instance } = await WebAssembly.instantiate(wasmBytes, { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const mem = new Uint8Array(e.memory.buffer);
  mem.set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);

  const imageBase = e.get_image_base();
  // Use the module's translator so the same setup/verification code works for
  // both ordinary direct addresses and demand-backed sparse guest mappings.
  const g2w = ga => e.guest_to_wasm(ga >>> 0) >>> 0;
  return { e, mem, g2w, imageBase };
}

// Guest-address layout for a shape run. Everything sits inside the direct g2w
// window (wa < 0x8000000) and below the guest stack at imageBase+0x3C00000, so
// no sparse mapping or DIB range is involved. That is deliberate for --cold:
// it prices the g2w FAST path. Exercising the sparse and code-marked paths is
// what warm mode (boot a real app, then inject) is for — see the notes at the
// bottom of this file.
// Guest addresses are laid out so the working buffer sits ABOVE the scratch
// stack, not below it: with the buffer first, a --bytes large enough to be
// interesting ran straight over the stack and the shape trapped on its own
// return address. The whole point of this tool is large working sets, so the
// layout has to make that the safe direction.
function layout(imageBase, bufBytes) {
  const a = {
    code: imageBase + 0x040000,   // fresh page per rep, bumped by the caller
    lut: imageBase + 0x100000,    // 256 bytes
    // Scratch a region shape writes its descriptor into for
    // $region_try_install to copy. One page; the descriptor cannot exceed
    // $decode_block's 4096-byte slack anyway.
    spec: imageBase + 0x140000,
    stackTop: imageBase + 0x800000,
    buf: imageBase + 0x1000000,
    bufBytes,
  };
  // g2w's direct window is wa < 0x8000000, i.e. ga - imageBase < ~0x7FEE000.
  // Past that a guest address falls through to the sparse scan and finally to
  // NULL_SENTINEL, which silently turns the whole benchmark into a no-op
  // against a 4-byte sink rather than failing.
  const top = a.buf + bufBytes;
  if (top - imageBase >= 0x7000000) {
    throw new Error(`--bytes=${bufBytes} puts the working set at 0x${(top - imageBase).toString(16)} ` +
      `past the image base, outside g2w's direct window (limit ~112MB)`);
  }
  return a;
}

function runToCompletion(e, codeAddr, stackTop) {
  e.set_esp(stackTop);
  // Sentinel return address: the final `ret` pops 0 into EIP, which is how
  // $run's loop learns the shape finished.
  new DataView(e.memory.buffer).setUint32(stackTop - e.get_image_base() + 0x12000, 0, true);
  e.set_eip(codeAddr);
  for (let i = 0; i < 4096; i++) {
    e.run(0x7FFFFFFF);
    if (e.get_eip() === 0) return true;
  }
  return false;
}

// One measured rep. The code is re-emitted at a FRESH address every time so the
// block is decoded fresh — that is what makes a decode-time fold toggle take
// effect without a clear_cache export, and it keeps both A/B arms paying the
// same decode cost.
function oneRep({ e, mem, g2w }, shape, a, repIndex) {
  const codeAddr = a.code + repIndex * 0x1000;
  // Shapes that build a decode-time descriptor need the address the code will
  // actually live at, because the descriptor names entry EIPs.
  a.codeAddr = codeAddr;
  const built = shape.emit(a);
  const bytes = built.code.concat([0xC3]);           // ret to the 0 sentinel
  mem.set(bytes, g2w(codeAddr));
  built.setup(e, mem, g2w);
  if (process.env.BENCH_TRACE_LOOP && e.set_loop_trace) e.set_loop_trace(1, codeAddr);
  const t0 = process.hrtime.bigint();
  const ok = runToCompletion(e, codeAddr, a.stackTop);
  const t1 = process.hrtime.bigint();
  if (!ok) throw new Error(`${shape.name}: guest loop did not return (EIP=0x${e.get_eip().toString(16)})`);
  // Every rep is verified, outside the timed region and unconditionally. A
  // shape that silently does nothing reports the machine's memory bandwidth
  // for doing nothing, which reads exactly like a spectacular result — this is
  // how rep_movsd shipped copying zeros onto zeros.
  if (built.verify) {
    const why = built.verify(e, mem, g2w);
    if (why) throw new Error(`${shape.name}: shape did not do its work — ${why}`);
  }
  // A fold that produces the wrong ANSWER is faster for free, and `verify`
  // only checks the loop terminated. `checksum` is the whole visible guest
  // state after the shape, compared across arms by the caller — that is what
  // makes a hand-built region descriptor evidence rather than a hypothesis.
  const check = built.checksum ? built.checksum(e, mem, g2w) : null;
  return { ns: Number(t1 - t0), built, check };
}

function countOps(inst, shape, a, repIndex) {
  const { e, mem } = inst;
  const lutRuns0 = e.get_loop_lut_runs ? e.get_loop_lut_runs() : 0;
  const lutBytes0 = e.get_loop_lut_bytes ? e.get_loop_lut_bytes() : 0n;
  const lut16Runs0 = e.get_loop_lut16_runs ? e.get_loop_lut16_runs() : 0;
  const lut16Bytes0 = e.get_loop_lut16_bytes ? e.get_loop_lut16_bytes() : 0n;
  const lut16Matches0 = e.get_loop_lut16_matches ? e.get_loop_lut16_matches() : 0;
  const matched0 = e.get_loop_matched_blocks ? e.get_loop_matched_blocks() : 0;
  // The block executor's own meters. Without these a `blk*` shape whose
  // descriptor never installed — too few micro-ops, an unsafe op, the classify
  // scratch full — looks exactly like one that installed and did not help,
  // because the handler histogram is deliberately blind to the difference (a
  // native micro-op re-records the handler index it replaced). `fbOps` is the
  // one that answers "did round 11's split actually convert anything": a
  // memory-form ALU op is a FALLBACK until it is split and a native micro-op
  // afterwards, and nothing else in this output moves when it does.
  const bxNat0 = e.get_block_exec_native_ops ? e.get_block_exec_native_ops() : 0n;
  const bxFb0 = e.get_block_exec_fallback_ops ? e.get_block_exec_fallback_ops() : 0n;
  e.set_handler_hist_enabled(1);
  e.reset_handler_hist();
  oneRep(inst, shape, a, repIndex);
  e.set_handler_hist_enabled(0);
  const base = e.get_handler_hist_base();
  const slots = e.get_handler_hist_slots();
  const dv = new DataView(e.memory.buffer);
  let total = 0;
  const perHandler = [];
  for (let i = 0; i < slots; i++) {
    const c = dv.getUint32(base + i * 4, true);
    if (c) { total += c; perHandler.push([i, c]); }
  }
  perHandler.sort((x, y) => y[1] - x[1]);

  // Block ENTRIES, from the same gate (13-exports.wat:181 records the hot-block
  // histogram whenever handler_hist is on, and reset_handler_hist clears it).
  //
  // This is not a nicety. A block entry costs an eip store, a cache lookup and
  // a trip round $run's loop, and NONE of that is a handler dispatch — so the
  // handler histogram, which is what every fusion in this repo has been judged
  // on, is structurally blind to it. Every `jz` in an unfolded switch ladder
  // ends a block; folding the ladder deletes those entries while leaving the
  // dispatch count almost unchanged. Measure both or you cannot see the fold.
  const hbBase = e.get_hot_block_hist_base();
  const hbCount = e.get_hot_block_hist_count();
  let blockEntries = 0;
  for (let i = 0; i < hbCount; i++) {
    if (dv.getUint32(hbBase + i * 8, true) !== 0) {
      blockEntries += dv.getUint32(hbBase + i * 8 + 4, true);
    }
  }
  // The hot-block histogram is a 4-way bucket, and $hot_block_hist_record
  // (04-cache.wat:727) bumps the collision counter exactly once per entry it
  // could not place. So recorded + collisions is the EXACT entry count, not an
  // estimate — and the recorded half alone can be wildly short. jmp_chain
  // records 5.00 blocks/iter against a true 9.00, which put this tool's first
  // block-entry price at 25ns instead of 11.5ns.
  const blockCollisions = e.get_hot_block_hist_collisions();
  blockEntries += blockCollisions;
  return {
    total, blockEntries, blockCollisions,
    // Installs are CUMULATIVE, not a delta: a descriptor is built once at
    // decode and every later rep re-enters the same cached block, so the delta
    // over one rep is zero on a shape that is running entirely inside the
    // executor. The question this answers is "did it ever install", and the
    // per-rep work is the op counters below.
    bxInstalls: e.get_block_exec_installs ? e.get_block_exec_installs() : 0,
    // Why the LAST candidate block was declined, when nothing installed. A
    // zero install count with no reason means the decoder never even offered a
    // block, which is a different bug from "offered and refused".
    bxDeclWhy: e.get_block_exec_decl_why ? e.get_block_exec_decl_why() : -1,
    bxNativeOps: e.get_block_exec_native_ops
      ? Number(e.get_block_exec_native_ops() - bxNat0) : 0,
    bxFallbackOps: e.get_block_exec_fallback_ops
      ? Number(e.get_block_exec_fallback_ops() - bxFb0) : 0,
    // Cumulative for the same reason as installs: the passes run at decode.
    bxSplit: e.get_bx_pass_split ? Number(e.get_bx_pass_split()) : 0,
    bxRle: e.get_bx_pass_rle ? Number(e.get_bx_pass_rle()) : 0,
    bxMovelim: e.get_bx_pass_movelim ? Number(e.get_bx_pass_movelim()) : 0,
    // Round 15 (section 24): x87 descriptor entries, split into the CHEAP
    // fused kind (TU_X87RUN), the bare ops that became one of 07b's native
    // x87 micro-ops, and -- by subtraction -- the residue still on the
    // trampoline. Cumulative like the pass counters: they are install-time.
    bxX87: e.get_bx_x87_uops ? Number(e.get_bx_x87_uops()) : 0,
    bxX87Run: e.get_bx_x87run_uops ? Number(e.get_bx_x87run_uops()) : 0,
    bxX87Native: e.get_bx_x87_native_uops ? Number(e.get_bx_x87_native_uops()) : 0,
    top: perHandler.slice(0, TOP_N), all: perHandler,
    lutRuns: e.get_loop_lut_runs ? e.get_loop_lut_runs() - lutRuns0 : 0,
    lutBytes: e.get_loop_lut_bytes ? e.get_loop_lut_bytes() - lutBytes0 : 0n,
    lut16Runs: e.get_loop_lut16_runs ? e.get_loop_lut16_runs() - lut16Runs0 : 0,
    lut16Bytes: e.get_loop_lut16_bytes ? e.get_loop_lut16_bytes() - lut16Bytes0 : 0n,
    lut16Matches: e.get_loop_lut16_matches ? e.get_loop_lut16_matches() - lut16Matches0 : 0,
    matched: e.get_loop_matched_blocks ? e.get_loop_matched_blocks() - matched0 : 0,
  };
}

// ---------------------------------------------------------------------------
function parseBytes(s) {
  const m = /^(\d+)([kmg]?)$/i.exec(String(s));
  if (!m) throw new Error(`bad --bytes: ${s}`);
  const mult = { '': 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }[m[2].toLowerCase()];
  return Number(m[1]) * mult;
}

function fmt(n) { return n.toLocaleString('en-US'); }

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const hit = argv.find(x => x.startsWith(`--${name}=`));
    return hit === undefined ? dflt : hit.slice(name.length + 3);
  };
  const has = name => argv.includes(`--${name}`);

  if (has('list')) {
    for (const [name, s] of Object.entries(SHAPES)) {
      console.log(`${name.padEnd(14)} ${s.describe}`);
      console.log(`${' '.repeat(14)} real: ${s.real}`);
    }
    return;
  }

  const bufBytes = parseBytes(arg('bytes', '4m'));
  const reps = Number(arg('reps', 9));
  const toggle = arg('toggle', null);
  const wantJson = has('json');
  const mapping = arg('mapping', 'direct');
  const scatterPageCount = Number(arg('scatter-pages', 64));
  TOP_N = Number(arg('top', 6));
  const names = String(arg('shapes', Object.keys(SHAPES).join(','))).split(',').filter(Boolean);

  for (const n of names) if (!SHAPES[n]) throw new Error(`unknown shape: ${n} (try --list)`);
  if (toggle && !TOGGLES[toggle]) throw new Error(`unknown toggle: ${toggle} (${Object.keys(TOGGLES).join(', ')})`);
  if (!['direct', 'sparse'].includes(mapping)) {
    throw new Error(`unknown --mapping=${mapping} (expected direct or sparse)`);
  }
  if (!Number.isInteger(scatterPageCount) || scatterPageCount < 1 || scatterPageCount > 256) {
    throw new Error(`bad --scatter-pages=${scatterPageCount} (expected integer 1..256)`);
  }

  ensureBuilt();

  const loadBefore = require('os').loadavg().map(x => x.toFixed(2)).join(' ');
  const results = [];
  for (const name of names) {
    const shape = { ...SHAPES[name], name };
    // A fresh instance per shape: a block cache and code-page bitmap carried
    // over from the previous shape would make this one's numbers depend on run
    // order, which is the exact failure mode that wrecked the whole-app A/Bs.
    const inst = await newInstance();
    const a = layout(inst.imageBase, bufBytes);
    a.scatterPageCount = scatterPageCount;
    if (mapping === 'sparse') {
      const sparse = inst.e.guest_map_alloc(bufBytes) >>> 0;
      if (!sparse) throw new Error(`${name}: could not allocate ${bufBytes} sparse guest bytes`);
      a.buf = sparse;
    }
    if (shape.prepare) shape.prepare(inst, a);


    const arms = toggle
      ? String(arg('arms', '1,0')).split(',').map(Number)
      : [null];
    const armNs = new Map(arms.map(v => [v, []]));
    const armOps = new Map();
    const armCheck = new Map();

    let repIndex = 0;
    for (const v of arms) {
      if (v !== null) applyToggle(inst.e, toggle, v);
      armOps.set(v, countOps(inst, shape, a, repIndex++));
    }
    // Interleave the arms rep by rep. Background load drifts on the scale of
    // seconds; alternating at millisecond granularity makes it common-mode.
    //
    // And ROTATE the order within each rep. docs/interpreter-dispatch-perf.md
    // pass 3 gave every variant a fixed slot in the round and manufactured four
    // 6-11% "speedups" out of slot position alone; pass 4, same binaries with
    // the order rotated, flipped one of them from -7.3% to +17.5%. Interleaving
    // removes drift between variants but not between positions.
    for (let r = 0; r < reps; r++) {
      // Rotate every arm through every slot. Reversing is sufficient for two
      // arms, but leaves the middle arm permanently in slot 2 for three arms.
      const shift = r % arms.length;
      const order = arms.slice(shift).concat(arms.slice(0, shift));
      for (const v of order) {
        if (v !== null) applyToggle(inst.e, toggle, v);
        const { ns, built, check } = oneRep(inst, shape, a, repIndex++);
        armNs.get(v).push(ns);
        a.lastBuilt = built;
        if (check !== null) {
          if (armCheck.has(v)) {
            if (armCheck.get(v) !== check) {
              throw new Error(`${name}: arm ${v} is not deterministic\n  ${armCheck.get(v)}\n  ${check}`);
            }
          } else {
            armCheck.set(v, check);
          }
        }
      }
    }
    // Every arm must leave the same guest state. Without this a region
    // descriptor that disagrees with its own x86 just reports a speedup.
    if (armCheck.size > 1) {
      const [[refArm, ref]] = [...armCheck];
      for (const [v, c] of armCheck) {
        if (c !== ref) {
          throw new Error(`${name}: arms disagree on the result\n  ${toggle}=${refArm}: ${ref}\n  ${toggle}=${v}: ${c}`);
        }
      }
    }

    const built = a.lastBuilt;
    const row = {
      shape: name,
      iters: built.iters,
      bytesTouched: built.bytesTouched,
      arms: arms.map(v => {
        const ns = armNs.get(v).slice().sort((x, y) => x - y);
        const ops = armOps.get(v);
        // Minima, not means: contention is one-sided, it only ever adds time.
        const min = ns[0];
        const median = ns[Math.floor(ns.length / 2)];
        return {
          arm: v === null ? 'base' : `${toggle}=${v}`,
          minMs: min / 1e6,
          medianMs: median / 1e6,
          nsPerIter: min / built.iters,
          opsTotal: ops.total,
          opsPerIter: ops.total / built.iters,
          nsPerOp: ops.total ? min / ops.total : 0,
          bytesPerIter: built.bytesTouched / built.iters,
          blockEntries: ops.blockEntries,
          blocksPerIter: ops.blockEntries / built.iters,
          blockCollisions: ops.blockCollisions,
          // Handlers 420-424 deliberately re-record the ops they replaced into
          // the histogram so totals stay comparable with a fold-off build (see
          // $th_case_chain in 06b-core-handlers.wat). When one of them is live,
          // opsTotal is NOT the dispatch count — it is the unfolded-equivalent
          // count plus the fold's own dispatch. Read blocksPerIter instead.
          // 454 (TREE_FOLD) re-records the handler indices it replaced too, so
          // its ops/iter is likewise the unfolded-equivalent, not the real one.
          foldsLive: ops.all.filter(([i]) => (i >= 420 && i <= 424) || i === 454)
            .map(([i]) => `H${i}`),
          lutRuns: ops.lutRuns,
          lutBytes: Number(ops.lutBytes),
          lut16Matches: ops.lut16Matches,
          lut16Runs: ops.lut16Runs,
          lut16Bytes: Number(ops.lut16Bytes),
          matched: ops.matched,
          bxInstalls: ops.bxInstalls,
          bxDeclWhy: ops.bxDeclWhy,
          bxNativeOps: ops.bxNativeOps,
          bxFallbackOps: ops.bxFallbackOps,
          bxSplit: ops.bxSplit,
          bxRle: ops.bxRle,
          bxMovelim: ops.bxMovelim,
          bxX87: ops.bxX87,
          bxX87Run: ops.bxX87Run,
          bxX87Native: ops.bxX87Native,
          topHandlers: ops.top,
          guestMBps: built.bytesTouched ? (built.bytesTouched / (min / 1e9)) / (1024 * 1024) : null,
        };
      }),
    };
    if (arms.length > 1) {
      const baseline = armNs.get(arms[arms.length - 1]);
      row.paired = arms.slice(0, -1).map(v => {
        const ratios = armNs.get(v).map((ns, i) =>
          (baseline[i] - ns) / baseline[i] * 100).sort((x, y) => x - y);
        return { arm: `${toggle}=${v}`, vs: `${toggle}=${arms[arms.length - 1]}`,
          medianPct: ratios[Math.floor(ratios.length / 2)] };
      });
    }
    if (arms.length === 2) {
      const [on, off] = row.arms;
      row.delta = {
        timePct: (off.minMs - on.minMs) / off.minMs * 100,
        opsPct: (off.opsTotal - on.opsTotal) / off.opsTotal * 100,
        blocksPct: (off.blockEntries - on.blockEntries) / off.blockEntries * 100,
      };
    }
    results.push(row);
  }

  if (wantJson) { console.log(JSON.stringify({ bufBytes, reps, mapping, toggle, results }, null, 2)); return; }

  // This box regularly sits at load 20-40 with other agents sweeping. The
  // interleave makes drift common-mode but it cannot make a saturated machine
  // quiet, so print what the machine was doing at both ends of the run and let
  // the reader discount accordingly.
  const load = () => require('os').loadavg().map(x => x.toFixed(2)).join(' ');
  console.log(`\nloadavg ${loadBefore} at start, ${load()} at end` +
    (Number(loadBefore.split(' ')[0]) > 4 ? '  <-- LOADED, treat single percentages as noise' : ''));
  console.log(`working set ${fmt(bufBytes)} bytes (${mapping} guest mapping), ${reps} interleaved reps, minima quoted`);
  if (toggle) console.log(`A/B toggle: ${toggle} (on vs off, same process, alternating)`);
  console.log('');
  for (const r of results) {
    console.log(`${r.shape}  —  ${SHAPES[r.shape].describe}`);
    console.log(`  ${fmt(r.iters)} iterations, ${fmt(r.bytesTouched)} guest bytes touched`);
    for (const arm of r.arms) {
      // MB/s is bytes/time, and the shapes move 1, 3 and 16 bytes per
      // iteration — so it is NOT comparable ACROSS shapes, only between two
      // arms of one shape, or between two shapes moving the same bytes by
      // different routes (store_stream vs rep_movsd is the one that matters).
      // ns/op is the cross-shape number: it says what one interpreted x86
      // instruction of this kind costs.
      const mb = arm.guestMBps === null ? '' : `  ${arm.guestMBps.toFixed(0)} MB/s(same-shape only)`;
      console.log(`    ${arm.arm.padEnd(16)} min ${arm.minMs.toFixed(1)}ms  med ${arm.medianMs.toFixed(1)}ms  ` +
        // A REP is one op for the whole range, so per-op cost is not a
        // per-instruction number there and printing it invites nonsense.
        `${arm.nsPerIter.toFixed(1)} ns/iter  ${arm.opsPerIter >= 1 ? `${arm.nsPerOp.toFixed(1)} ns/op` : '(bulk op)'}  ` +
        `${arm.opsPerIter.toFixed(2)} ops/iter  ${arm.bytesPerIter} B/iter  ` +
        `${arm.blocksPerIter.toFixed(2)} blocks/iter${mb}`);
      console.log(`    ${' '.repeat(16)} top handlers: ${arm.topHandlers.map(([i, c]) => `H${i}:${fmt(c)}`).join('  ')}`);
      console.log(`    ${' '.repeat(16)} LUT matches/runs/bytes: ${fmt(arm.matched)}/${fmt(arm.lutRuns)}/${fmt(arm.lutBytes)}`);
      if (toggle && toggle.startsWith('block_exec')) {
        // installs=0 means the descriptor never took, and every other number on
        // this line is then about a shape the block executor did not run at all.
        // fallback is the one round 11 moves: a memory-form ALU op is a FALLBACK
        // until the split converts it, and a native micro-op afterwards.
        console.log(`    ${' '.repeat(16)} block-exec installs/native/fallback: ` +
          `${fmt(arm.bxInstalls)}/${fmt(arm.bxNativeOps)}/${fmt(arm.bxFallbackOps)}  ` +
          `pass split/rle/movelim: ${fmt(arm.bxSplit)}/${fmt(arm.bxRle)}/${fmt(arm.bxMovelim)}` +
          (arm.bxInstalls ? '' : `  declWhy ${arm.bxDeclWhy}`));
        if (arm.bxX87 || arm.bxX87Native) {
          console.log(`    ${' '.repeat(16)} x87 entries: ${fmt(arm.bxX87)} ` +
            `(cheap ${fmt(arm.bxX87Run)}, trampoline ${fmt(arm.bxX87 - arm.bxX87Run)})  ` +
            `bare-native ${fmt(arm.bxX87Native)}`);
        }
      }
      if (arm.lut16Matches || arm.lut16Runs) {
        console.log(`    ${' '.repeat(16)} RGB565 matches/runs/pixels: ` +
          `${fmt(arm.lut16Matches)}/${fmt(arm.lut16Runs)}/${fmt(arm.lut16Bytes)}`);
      }
      if (arm.blockCollisions) {
        console.log(`    ${' '.repeat(16)} (${fmt(arm.blockCollisions)} of those entries came from the collision counter, ` +
          `not the bucket)`);
      }
      if (arm.foldsLive.length) {
        console.log(`    ${' '.repeat(16)} NOTE: ${arm.foldsLive.join(',')} live — ops/iter is the unfolded-equivalent`);
        console.log(`    ${' '.repeat(16)}       count, not the dispatch count, so ns/op is understated too.`);
        console.log(`    ${' '.repeat(16)}       Compare blocks/iter and time.`);
      }
    }
    if (r.delta) {
      const sign = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
      console.log(`    => fold is worth ${sign(r.delta.timePct)} time, ` +
        `${sign(r.delta.opsPct)} ops, ${sign(r.delta.blocksPct)} block entries`);
    }
    if (r.paired) {
      for (const p of r.paired) {
        console.log(`    => paired median ${p.arm} vs ${p.vs}: ${p.medianPct >= 0 ? '+' : ''}${p.medianPct.toFixed(1)}%`);
      }
    }
    console.log('');
  }
  console.log('Reminder: this harness understates dispatch cost (a periodic loop is');
  console.log('perfectly BTB-predicted) and says nothing about whether a shape occurs in');
  console.log('real code. Pair every result with --handler-hist / tools/match-loops.js.');
}

// The region descriptor layout has exactly one JS encoder, and
// test/test-tree-fold.js builds its descriptors with it too: a bench and a
// correctness test that disagree about the layout would each look right on its
// own while proving nothing together.
module.exports = { regionWords, uop, RG, TU, TK, CC, FN, REGION_BLOCK_WORDS };

if (require.main === module) {
  main().catch(err => { console.error(err.stack || String(err)); process.exit(1); });
}
