'use strict';

// The decode-time expression-tree fold (tools/toyvm/tree-fold.js, `--tree-fold`)
// runs the same program, and folds exactly what it says it folds.
//
// Six hand-assembled .COM programs, each one shape:
//
//   dot       straight-line full-width arithmetic, 12 ops -- MUST fold
//   addrloop  a `loop`-terminated body that walks a pointer  -- MUST fold
//   incloop   an `inc si / cmp si,N / jne` loop              -- MUST fold
//   partial   an 8-bit write in the middle                   -- MUST fold
//   bytelut   a byte LUT loop: 8-bit load, 8-bit store       -- MUST fold
//   ahal      AH and AL written apart, AX read whole         -- MUST fold
//   narrowmem 8-bit absolute loads and stores in one run     -- MUST fold
//   narrowrot an 8-bit `rol`, narrow AND not in the fold set -- MUST NOT fold
//   alias     a store followed by a load                     -- MUST NOT fold
//   flagcons  an `adc` in the middle                         -- MUST fold
//   adcchain  a 32-bit add out of two 16-bit halves          -- MUST fold
//   sbbchain  the same with the borrow                       -- MUST fold
//   setcc     a mid-run `cmp` and two `setcc`s reading it    -- MUST fold
//   cmploop   a loop with an `adc` inside and a `dec`/`jnz` out -- MUST fold
//   flagsword a `lahf` in the middle                         -- MUST NOT fold
//   strmovs   a lodsw/stosw copy loop                        -- MUST fold
//   strdf     the same walked backwards under `std`          -- MUST fold
//   strscan   a `scasw` loop whose `jne` reads its compare    -- MUST fold
//   strseg    a `lodsw` with an `es:` override                -- MUST fold
//   repmovs   a `rep movsw` down the widened path             -- MUST fold
//   repmovsdown  the same under `std`, so the byte loop runs  -- MUST fold
//   repstos   a `rep stosw` fill                              -- MUST fold
//   repscan   a `repne scasw` that exits on the match         -- MUST fold
//   repscanmiss  the same with the count run out              -- MUST fold
//   repcmps   a `rep cmpsw` that exits on the difference      -- MUST fold
//   shiftcl   shl/shr/sar by CL, one count past the width     -- MUST fold
//   shiftcl0  a count of ZERO, which must write no flags      -- MUST fold
//   shiftcarry rcl/rcr/rol/ror, immediate and CL              -- MUST fold
//   divmul    div/idiv/mul, and NOT into a loop tree          -- MUST fold
//   divzero   a divide by zero mid-tree, regs read at the trap -- MUST fold
//
// The five flag cases are the other half of the DOS fit. Flags here are LAZY --
// a producer records its inputs, a consumer materializes the field it wants --
// so a flag consumer inside a run needs no new machinery either: the `$rec_*`
// and `$get_*` calls are kept verbatim in source order, and the flag globals
// are left out of the register promotion so the per-field last-writer state at
// the run's end is what an unfolded compile would have left. `flagsword` is the
// boundary: `lahf` wants the architectural FLAGS byte including AF, which the
// record does not carry as a value.
//
// The four partial-register cases are the DOS half of the suite. 16-bit real
// mode is written in AL/AH/BL/DH and in 8-bit loads and stores, and the exact
// rule set refused every one of them -- `partial-reg` was one of the two
// biggest decline buckets in every program measured. What makes them foldable
// is not a new model of the register file: AL really is bits 0-7 of the
// promoted AX local, because emit.js's `$rget8`/`$rset8` already spell an 8-bit
// access as an extract and a mask-and-or insert and the lowering already folds
// those to the register's own global. `narrowrot` is the boundary: `rol` is not
// in the fold set at ANY width, so being narrow is not on its own a licence.
//
// Every one runs its body two thousand times inside an outer loop, prints AX,
// BX, CX, DX, SI, DI and the arithmetic bits of FLAGS, and is run twice: once
// plain, once `--tree-fold`. THE PRINTED LINE MUST BE IDENTICAL. That is the
// whole claim the fold makes -- it charges the dispatches it removes and
// materializes the flags the terminator reads, so a folded run and an unfolded
// one are the same computation and not merely the same picture.
//
// The FLAGS word is in the comparison on purpose and is the part a naive fold
// gets wrong. Flags are lazy: an op records its inputs and the bits are
// computed only when something asks. A fold that hoisted the whole run into
// wasm locals and wrote the register file back at the end would leave the
// recorder holding the FIRST op's inputs rather than the last writer's, and
// nothing about the registers would show it -- the picture would be right and
// `pushf` would be wrong. Printing the six arithmetic bits is what makes that
// visible.
//
// And the three negative cases are not decoration. Each is a rule that costs
// real folds (the decline histogram on ACCIDENT is thousands of `partial-reg`
// and hundreds of `alias`), so each is a rule somebody will eventually want to
// relax -- and relaxing one without noticing it also fires HERE is how a fold
// starts computing something else.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
// The relaxation names, from the fold itself rather than a copy: a `needs` arm
// has to run with every OTHER relaxation on, and a list that went stale here
// would silently start testing something weaker.
const { RELAXATIONS } = require('../tools/toyvm/tree-fold');

const ITER = 2000;              // outer-loop trips, in a memory counter
const COUNTER = 0x500;          // where that counter lives
const SNAP = 0x300;             // where the seven printed words are stashed
const TABLE = 0x200;            // addrloop's data
const DEST = 0x280;             // bytelut's output

// --- a two-pass assembler, just big enough --------------------------------
//
// Bytes plus named labels, with one rel16 (`call phex`) and rel8 backward
// branches resolved by hand. Two passes because the print helper sits after
// the body and the body has to call forward into it.
function asm(build) {
  let labels = {};
  let out = null;
  for (let pass = 0; pass < 2; pass++) {
    const b = [];
    const w = (...x) => b.push(...x);
    const here = () => 0x100 + b.length;
    const label = (n) => { labels[n] = here(); };
    // Displacements are measured from the END of the instruction, and `here()`
    // is its FIRST byte -- the argument is evaluated before `w` pushes
    // anything. So a 2-byte rel8 branch is `target - (here() + 2)` and a 3-byte
    // rel16 call is `target - (here() + 3)`. Getting the rel8 wrong by one puts
    // the loop back one byte into the middle of its own first instruction,
    // which does not crash: it runs forever at a plausible-looking address.
    const rel8 = (n) => ((labels[n] === undefined ? here() + 2 : labels[n]) - (here() + 2)) & 0xFF;
    const rel16 = (n) => {
      const d = ((labels[n] === undefined ? here() + 3 : labels[n]) - (here() + 3)) & 0xFFFF;
      return [d & 0xFF, d >> 8];
    };
    build({ w, here, label, rel8, rel16, at: (n) => labels[n] });
    out = Buffer.from(b);
  }
  return out;
}

// The seven-word snapshot, each store separated by a `nop`.
//
// The nops are load-bearing and not padding. A `nop` classifies as an
// unsupported op and therefore ENDS a run, which keeps the snapshot's own
// seven perfectly foldable stores from forming a fold of their own -- without
// them the three negative cases fold their snapshot and the test asserts
// nothing. The one before the first store is the same guard against the case
// body's tail joining it.
function snapshot(w) {
  const st = (bytes) => { w(0x90); w(...bytes); };
  w(0x90);
  st([0xA3, SNAP & 0xFF, SNAP >> 8]);                   // mov [SNAP+0],ax
  st([0x89, 0x1E, (SNAP + 2) & 0xFF, (SNAP + 2) >> 8]); // mov [SNAP+2],bx
  st([0x89, 0x0E, (SNAP + 4) & 0xFF, (SNAP + 4) >> 8]); // mov [SNAP+4],cx
  st([0x89, 0x16, (SNAP + 6) & 0xFF, (SNAP + 6) >> 8]); // mov [SNAP+6],dx
  st([0x89, 0x36, (SNAP + 8) & 0xFF, (SNAP + 8) >> 8]); // mov [SNAP+8],si
  st([0x89, 0x3E, (SNAP + 10) & 0xFF, (SNAP + 10) >> 8]); // mov [SNAP+10],di
  // ...and the flags the terminator's own compare left behind, masked to the
  // six arithmetic bits (CF PF AF ZF SF OF). The rest of the word is IF/DF and
  // the reserved bits, which say nothing about the arithmetic.
  w(0x90, 0x9C, 0x58, 0x25, 0xD5, 0x08);                // nop / pushf / pop ax / and ax,08D5h
  w(0x90); w(0xA3, (SNAP + 12) & 0xFF, (SNAP + 12) >> 8);
}

// Print the seven words as hex, then exit. `phex` prints BX and returns.
function printAndExit(a) {
  const { w, label, rel8, rel16 } = a;
  w(0xBE, SNAP & 0xFF, SNAP >> 8);       // mov si,SNAP
  w(0xB9, 0x07, 0x00);                   // mov cx,7
  label('L1');
  w(0x51);                               // push cx
  w(0xAD);                               // lodsw
  w(0x89, 0xC3);                         // mov bx,ax
  w(0xE8, ...rel16('phex'));             // call phex
  w(0x59);                               // pop cx
  w(0xE2, rel8('L1'));                   // loop L1
  w(0xB8, 0x00, 0x4C, 0xCD, 0x21);       // mov ax,4C00h / int 21h
  label('phex');
  w(0xB9, 0x04, 0x00);                   // mov cx,4
  label('L2');
  w(0xC1, 0xC3, 0x04);                   // rol bx,4
  // ...and a `nop`, for the reason the ones in `snapshot` and `program` are
  // there: this routine is SCAFFOLDING, and the three negative cases assert
  // that the whole program folded nothing at all. Once the `shifts` relaxation
  // landed, `rol bx,4 / mov al,bl / and al,0Fh / add al,'0'` became four
  // consecutive foldable ops and the hex printer started folding in every
  // program, which failed `narrowrot` with a fold that had nothing to do with
  // `narrowrot`. The barrier keeps the scaffolding out of the measurement.
  w(0x90);                               // nop: end the run
  w(0x88, 0xD8);                         // mov al,bl
  w(0x24, 0x0F);                         // and al,0Fh
  w(0x04, 0x30);                         // add al,'0'
  w(0x3C, 0x39);                         // cmp al,'9'
  w(0x76, 0x02);                         // jbe +2
  w(0x04, 0x07);                         // add al,7
  w(0x88, 0xC2);                         // mov dl,al
  w(0xB4, 0x02);                         // mov ah,2
  w(0xCD, 0x21);                         // int 21h
  w(0xE2, rel8('L2'));                   // loop L2
  w(0xC3);                               // ret
}

// One case: prologue, then `body` inside an outer loop counted in memory, then
// the snapshot and the print. The outer counter lives in memory rather than a
// register so no case has to give one up, and so that re-entering the body
// after an install exercises the FOLDED handler rather than only compiling it.
// `pre` is a straight-line run laid down BEFORE the loop, so it executes
// exactly once: the hotness gate's cold case, in the same program as its hot
// one. `iter` overrides the trip count, which the gate cases raise so the
// profile window has room to close while the program is still running.
function program(body, { tail = [], pre = null, iter = ITER } = {}) {
  return asm((a) => {
    const { w, label, rel8 } = a;
    if (pre) { pre(a); w(0x90); }
    w(0xC7, 0x06, COUNTER & 0xFF, COUNTER >> 8, iter & 0xFF, iter >> 8);
    // ...and a `nop` after it, for the same reason as the ones in `snapshot`.
    // `mov word [mem],imm16` is itself a foldable store, and the first trip
    // through the loop falls into the body from here -- so without this it
    // joins the body's first three ops and folds `alias` at exactly four.
    w(0x90);
    label('outer');
    body(a);
    w(0x90);                                                   // nop: end the run
    w(0xFF, 0x0E, COUNTER & 0xFF, COUNTER >> 8);               // dec word [COUNTER]
    w(0x75, rel8('outer'));                                    // jnz outer
    snapshot(w);
    printAndExit(a);
    for (const t of tail) w(...t);
  });
}

// Pad to `off` and lay bytes there.
function withData(buf, off, bytes) {
  const b = Buffer.alloc(Math.max(buf.length, off - 0x100 + bytes.length), 0);
  buf.copy(b);
  Buffer.from(bytes).copy(b, off - 0x100);
  return b;
}

const CASES = {
  // Twelve consecutive full-width ops: mov/shl/add/xor/sub/lea/not/neg, every
  // one in the census's fold set, no memory at all. The simplest thing the
  // fold can possibly be asked to do.
  dot: {
    folds: true,
    body: ({ w }) => {
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xBB, 0x78, 0x56);       // mov bx,5678h
      w(0x89, 0xC1);             // mov cx,ax
      w(0xC1, 0xE1, 0x03);       // shl cx,3
      w(0x01, 0xD9);             // add cx,bx
      w(0x31, 0xC1);             // xor cx,ax
      w(0x89, 0xCA);             // mov dx,cx
      w(0x29, 0xDA);             // sub dx,bx
      w(0x8D, 0x77, 0x09);       // lea si,[bx+9]
      w(0x89, 0xF7);             // mov di,si
      w(0xF7, 0xD7);             // not di
      w(0xF7, 0xDE);             // neg si
    },
  },
  // A `loop`-terminated body walking a pointer through a table: the fold's
  // real target, with memory reads inside the run. Loads only, so the alias
  // rule never fires and the whole body is one run.
  addrloop: {
    folds: true, loop: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => i)],
    body: ({ w, label, rel8 }) => {
      w(0xBE, TABLE & 0xFF, TABLE >> 8);   // mov si,TABLE
      w(0x31, 0xDB);                       // xor bx,bx
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      label('inner');
      w(0x8B, 0x04);                       // mov ax,[si]
      w(0x01, 0xC3);                       // add bx,ax
      w(0x8D, 0x74, 0x02);                 // lea si,[si+2]
      w(0x89, 0xDA);                       // mov dx,bx
      w(0xD1, 0xE2);                       // shl dx,1
      w(0x31, 0xD3);                       // xor bx,dx
      w(0xE2, rel8('inner'));              // loop inner
    },
  },
  // The other loop shape: an explicit induction variable and a compare. `inc`
  // is in the fold set, so the run reaches all the way to the `cmp` that the
  // branch reads -- which is exactly the case where a fold has to get the
  // flags right, because the terminator's compare is the FIRST thing after it.
  incloop: {
    folds: true, loop: true,
    body: ({ w, label, rel8 }) => {
      w(0x31, 0xDB);             // xor bx,bx
      w(0x31, 0xF6);             // xor si,si
      label('inner');
      w(0x89, 0xF0);             // mov ax,si
      w(0xC1, 0xE0, 0x02);       // shl ax,2
      w(0x01, 0xC3);             // add bx,ax
      w(0x31, 0xF3);             // xor bx,si
      w(0x89, 0xDA);             // mov dx,bx
      w(0x46);                   // inc si
      w(0x81, 0xFE, 0x10, 0x00); // cmp si,16
      w(0x75, rel8('inner'));    // jne inner
    },
  },
  // AL and AH are subfields of AX in the register file. The `partial`
  // relaxation models an 8-bit write as an INSERT into the full-width value and
  // an 8-bit read as an EXTRACT out of it, so this run of five folds whole --
  // and the printed AX is the case: `1237` is `1234` with AL incremented by 3,
  // which is only right if the insert left AH alone.
  partial: {
    folds: true, relaxed: true,
    body: ({ w }) => {
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xB3, 0xAA);             // mov bl,0AAh     <- 8-bit insert
      w(0x04, 0x03);             // add al,3        <- 8-bit extract + insert
      w(0x89, 0xC1);             // mov cx,ax
      w(0x31, 0xD9);             // xor cx,bx
    },
  },
  // The shape 16-bit real-mode code is actually made of: a byte fetched through
  // a pointer, transformed in AL, and stored a byte at a time. Eight-bit loads
  // and stores keep their `$rd8`/`$wr8` calls in source order like every other
  // memory op, so they fault and segment exactly as the per-op handlers do --
  // the relaxation is about the REGISTER halves, not about memory width.
  bytelut: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w, label, rel8 }) => {
      w(0xBE, TABLE & 0xFF, TABLE >> 8);   // mov si,TABLE
      w(0xBF, DEST & 0xFF, DEST >> 8);     // mov di,DEST
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      w(0xB6, 0x07);                       // mov dh,7
      label('lut');
      w(0x89, 0xF3);                       // mov bx,si
      w(0x8A, 0x07);                       // mov al,[bx]     <- 8-bit load
      w(0x00, 0xF0);                       // add al,dh       <- two 8-bit reads
      w(0x34, 0x5A);                       // xor al,5Ah
      w(0x88, 0x05);                       // mov [di],al     <- 8-bit store
      w(0x46);                             // inc si
      w(0x47);                             // inc di
      w(0xE2, rel8('lut'));                // loop lut
    },
  },
  // The two halves of one register written apart and read together. A fold that
  // kept AL and AH in separate locals, or that wrote one back over the other,
  // gets a plausible-looking AX here and the wrong one: the answer is 3213h and
  // both halves have to survive the other's write to reach it.
  ahal: {
    folds: true, relaxed: true,
    body: ({ w }) => {
      w(0xB9, 0x0F, 0x00);       // mov cx,15
      w(0xB8, 0x00, 0x00);       // mov ax,0
      w(0xB0, 0x12);             // mov al,12h
      w(0xB4, 0x34);             // mov ah,34h
      w(0x04, 0x01);             // add al,1
      w(0x80, 0xEC, 0x02);       // sub ah,2
      w(0x89, 0xC3);             // mov bx,ax
      w(0x31, 0xCB);             // xor bx,cx
      w(0x88, 0xE2);             // mov dl,ah
    },
  },
  // Narrow MEMORY: two 8-bit absolute loads, arithmetic between the halves of
  // one register, two 8-bit absolute stores. Loads first, so the alias rule --
  // which the partial relaxation does not touch -- never fires and the whole
  // run is one tree.
  narrowmem: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 11) & 0xFF)],
    body: ({ w }) => {
      w(0xA0, TABLE & 0xFF, TABLE >> 8);           // mov al,[TABLE]
      w(0x8A, 0x26, (TABLE + 1) & 0xFF, (TABLE + 1) >> 8); // mov ah,[TABLE+1]
      w(0x00, 0xE0);                               // add al,ah
      w(0x34, 0x5A);                               // xor al,5Ah
      w(0xA2, DEST & 0xFF, DEST >> 8);             // mov [DEST],al
      w(0x88, 0x26, (DEST + 1) & 0xFF, (DEST + 1) >> 8);   // mov [DEST+1],ah
      w(0xBB, 0x34, 0x12);                         // mov bx,1234h
      w(0x89, 0xDE);                               // mov si,bx
    },
  },
  // The boundary the relaxation must NOT cross. `rol` is not in the census's
  // fold set at any width -- it is a carry-producing rotate, not an insert --
  // so being narrow does not make it eligible. It splits this into runs of two
  // and two, and nothing folds.
  narrowrot: {
    folds: false,
    body: ({ w }) => {
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xB3, 0xAA);             // mov bl,0AAh
      w(0xD0, 0xC3);             // rol bl,1        <- not in the fold set
      w(0x89, 0xC1);             // mov cx,ax
      w(0x31, 0xD9);             // xor cx,bx
    },
  },
  // A load after a store, with no proof they miss each other. The fold keeps
  // memory in source order but will not reorder a load across a store, so the
  // run ends at the load: 3 ops either side and neither reaches four.
  alias: {
    folds: false,
    body: ({ w }) => {
      w(0xB8, 0x34, 0x12);                 // mov ax,1234h
      w(0xBB, 0x78, 0x56);                 // mov bx,5678h
      w(0xA3, 0x00, 0x04);                 // mov [0400h],ax   <- store
      w(0x8B, 0x0E, 0x02, 0x04);           // mov cx,[0402h]   <- possibly aliasing load
      w(0x89, 0xCA);                       // mov dx,cx
      w(0x31, 0xC2);                       // xor dx,ax
    },
  },
  // `adc` READS the carry the previous op left. Under the `flags` relaxation
  // that is not a barrier but the ordinary case: the producer's `$rec_*` and
  // the consumer's `$get_cf` are both kept verbatim in source order inside the
  // handler, so the `adc` reads the record the `mov` in front of it left --
  // which, since `mov` writes no flags, is still the one the block was entered
  // with. The printed word is the check.
  flagcons: {
    folds: true, relaxed: true,
    body: ({ w }) => {
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xBB, 0x78, 0x56);       // mov bx,5678h
      w(0x89, 0xC1);             // mov cx,ax
      w(0x11, 0xD9);             // adc cx,bx       <- reads CF
      w(0x89, 0xCA);             // mov dx,cx
      w(0x31, 0xC2);             // xor dx,ax
      w(0x01, 0xDA);             // add dx,bx
    },
  },
  // The shape `adc` exists for: a 32-bit add out of two 16-bit halves, where
  // the carry crosses from one op to the next INSIDE the run. AX ends at 0002h
  // and DX at 0002h only if the `adc` saw the carry the `add` produced; a fold
  // that materialized flags at the run's END instead would print DX=0001h and
  // every register around it would still look right.
  adcchain: {
    folds: true, relaxed: true,
    body: ({ w }) => {
      w(0xB8, 0xFF, 0xFF);       // mov ax,0FFFFh
      w(0xBA, 0x01, 0x00);       // mov dx,1
      w(0x01, 0xC0);             // add ax,ax      -> carry out
      w(0x11, 0xD2);             // adc dx,dx      <- reads that carry
      w(0x01, 0xC0);             // add ax,ax
      w(0x11, 0xD2);             // adc dx,dx
      w(0x01, 0xC0);             // add ax,ax
      w(0x11, 0xD2);             // adc dx,dx      DX=000Fh, AX=0FFF8h
    },
  },
  // ...and its subtractive twin, because CF means BORROW here and the record
  // `$rec_sub` leaves is not the one `$rec_add` leaves. Two `sbb`s, the second
  // reading the first's borrow.
  sbbchain: {
    folds: true, relaxed: true,
    body: ({ w }) => {
      w(0xB8, 0x00, 0x00);       // mov ax,0
      w(0xBB, 0x05, 0x00);       // mov bx,5
      w(0x29, 0xD8);             // sub ax,bx      -> borrow out (AX=0FFFBh)
      w(0x19, 0xDB);             // sbb bx,bx      <- reads that borrow (BX=0FFFFh)
      w(0x19, 0xC9);             // sbb cx,cx      <- and the one sbb left
      w(0x19, 0xD2);             // sbb dx,dx
    },
  },
  // A `cmp` in the middle of a run and two `setcc`s reading it. `setcc` is a
  // flag read with an 8-bit register destination, so this case needs BOTH
  // relaxations at once -- which is the ordinary state of 16-bit code and the
  // reason they were not worth doing one at a time.
  setcc: {
    folds: true, relaxed: true,
    body: ({ w }) => {
      w(0xB8, 0x05, 0x00);       // mov ax,5
      w(0xBB, 0x07, 0x00);       // mov bx,7
      w(0x39, 0xD8);             // cmp ax,bx       <- mid-run flag write
      w(0x0F, 0x9C, 0xC1);       // setl cl         <- flag read -> 8-bit write
      w(0x0F, 0x94, 0xC5);       // setz ch
      w(0x31, 0xD2);             // xor dx,dx
      w(0x88, 0xCA);             // mov dl,cl
    },
  },
  // THE CASE THE RELAXATION IS REALLY FOR: a counted loop that both CONSUMES a
  // flag inside the body (the `adc` reads the bit the `shl` in front of it shifted
  // out) and leaves the flags its terminator reads (the `dec`). Under the exact
  // rules the `adc` split the four-op body into a two and a one and nothing
  // folded; under the relaxation the whole body is one handler, so the `shl`'s
  // record has to reach the `adc` INSIDE it and the `dec`'s record has to reach
  // the `jnz` OUTSIDE it, on all eight turns of the loop. A fold that got either
  // end wrong prints a different BX.
  cmploop: {
    folds: true, relaxed: true, loop: true,
    body: ({ w, label, rel8 }) => {
      w(0x31, 0xDB);             // xor bx,bx
      w(0xBE, 0x08, 0x00);       // mov si,8
      // The jump is what makes the loop body its own block: decoding runs to a
      // terminator, so without it the setup and the first two body ops share a
      // block and fold as a four-op run under the EXACT rules too, which would
      // make the exact-arm assertion below fail for a reason that is not the
      // loop.
      w(0xEB, rel8('cmpl'));     // jmp cmpl
      label('cmpl');
      w(0x89, 0xF0);             // mov ax,si
      w(0xC1, 0xE0, 0x02);       // shl ax,2        -> CF is the bit shifted out
      w(0x11, 0xC3);             // adc bx,ax       <- reads that CF, mid-run
      w(0x89, 0xDA);             // mov dx,bx
      // `dec`+`jnz` FUSE into one terminator op, so they count as one, not two:
      // without the `mov` above the body would be three ops and too short.
      w(0x4E);                   // dec si          <- the flags the jnz reads
      w(0x75, rel8('cmpl'));     // jnz cmpl
    },
  },
  // The boundary on the flag side. `lahf` wants the architectural FLAGS byte,
  // including AF, which the lazy record does not carry as a value -- so it is
  // a barrier under the relaxation as much as without it, and splits this into
  // runs of three and three.
  flagsword: {
    folds: false,
    body: ({ w }) => {
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xBB, 0x78, 0x56);       // mov bx,5678h
      w(0x01, 0xD8);             // add ax,bx
      w(0x9F);                   // lahf            <- the whole FLAGS byte
      w(0x89, 0xC1);             // mov cx,ax
      w(0x31, 0xD9);             // xor cx,bx
      w(0x89, 0xCA);             // mov dx,cx
    },
  },

  // --- the string group ---------------------------------------------------
  //
  // `movs`/`stos`/`lods`/`scas`/`cmps` were the top decline bucket in every
  // program measured, and each of the four cases below is one thing that has
  // to survive the fold: the SI/DI step, its DIRECTION, the flags a compare
  // leaves, and the SEGMENT the access goes through. All four are `relaxed`,
  // so the `--tree-fold-relax=none` arm proves the string relaxation is what
  // caused the fold and not some other rule quietly widening.

  // A copy loop written the way 16-bit code writes one: `lodsw`, arithmetic,
  // `stosw`, with SI and DI stepping themselves. The printed SI and DI are the
  // case -- both must land 16 bytes on from where they started, which is only
  // true if each string op applied its own +2 inside the tree.
  strmovs: {
    folds: true, relaxed: true, loop: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w, label, rel8 }) => {
      w(0xBE, TABLE & 0xFF, TABLE >> 8);   // mov si,TABLE
      w(0xBF, DEST & 0xFF, DEST >> 8);     // mov di,DEST
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      w(0xFC);                             // cld
      w(0x31, 0xDB);                       // xor bx,bx
      w(0x31, 0xD2);                       // xor dx,dx
      label('copy');
      w(0xAD);                             // lodsw   ax<-[si], si+=2
      w(0x01, 0xD0);                       // add ax,dx
      w(0xAB);                             // stosw   [di]<-ax, di+=2
      w(0x31, 0xC3);                       // xor bx,ax
      w(0x42);                             // inc dx
      w(0xE2, rel8('copy'));               // loop copy
    },
  },
  // THE DIRECTION. DF is read live off the flags global, which the fold does
  // not promote into a local, so a `std` outside the run reaches every string
  // op inside it. This walks the same data BACKWARDS; a fold that baked the
  // +2 in at generation time prints a different SI and a different BX.
  strdf: {
    folds: true, relaxed: true, loop: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w, label, rel8 }) => {
      w(0xBE, (TABLE + 14) & 0xFF, (TABLE + 14) >> 8); // mov si,TABLE+14
      w(0xBF, (DEST + 14) & 0xFF, (DEST + 14) >> 8);   // mov di,DEST+14
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      w(0xFD);                             // std      <- backwards
      w(0x31, 0xDB);                       // xor bx,bx
      label('back');
      w(0xAD);                             // lodsw    si-=2
      w(0x01, 0xC3);                       // add bx,ax
      w(0xAB);                             // stosw    di-=2
      w(0x31, 0xF3);                       // xor bx,si
      w(0xE2, rel8('back'));               // loop back
      // ...and put it back, because `printAndExit` walks the snapshot with
      // `lodsw` and would read it backwards off the end of the buffer.
      w(0xFC);                             // cld
    },
  },
  // `scas` is a compare: it leaves the lazy-flag record, and the loop's own
  // terminator is the `jne` that reads it. So this is the string op and the
  // flag-as-a-value contract in one block -- the run stops when the word is
  // found, and a fold that materialized the compare anywhere but where the
  // interpreter does scans a different number of times.
  strscan: {
    folds: true, relaxed: true, loop: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w, label, rel8 }) => {
      w(0xBF, TABLE & 0xFF, TABLE >> 8);   // mov di,TABLE
      // bytes 6 and 7 of the table are 42 and 49: the word 312Ah, four
      // compares in.
      w(0xB8, 0x2A, 0x31);                 // mov ax,312Ah
      w(0xB9, 0x20, 0x00);                 // mov cx,32
      w(0xFC);                             // cld
      w(0x31, 0xDB);                       // xor bx,bx
      label('scan');
      w(0xAF);                             // scasw   cmp ax,[es:di]; di+=2
      w(0x89, 0xFA);                       // mov dx,di
      w(0x89, 0xD6);                       // mov si,dx
      w(0x75, rel8('scan'));               // jne scan
    },
  },
  // THE SEGMENT. `lods` reads DS:SI and the prefix overrides it, so the fold
  // has to keep the operand word the decoder wrote rather than the default.
  // ES is put one paragraph-and-a-bit above DS, and the two reads are aimed at
  // the SAME linear word through the two different segments: BX ends at zero
  // if and only if the override survived. Without it the second read lands in
  // the program's own code and BX is some other number entirely.
  strseg: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w }) => {
      w(0x8C, 0xC8);                       // mov ax,cs
      w(0x05, 0x10, 0x00);                 // add ax,10h        (+100h bytes)
      w(0x8E, 0xC0);                       // mov es,ax
      w(0x90);                             // nop: end that run
      w(0xBE, TABLE & 0xFF, TABLE >> 8);   // mov si,TABLE      (DS:0200h)
      w(0xAD);                             // lodsw             DS:SI
      w(0x89, 0xC3);                       // mov bx,ax
      w(0xBE, 0x00, 0x01);                 // mov si,0100h      (ES:0100h == DS:0200h)
      w(0x26, 0xAD);                       // es: lodsw         ES:SI
      w(0x31, 0xC3);                       // xor bx,ax         -> 0
      w(0x89, 0xF2);                       // mov dx,si
      w(0x89, 0xD9);                       // mov cx,bx
    },
  },

  // --- the REP forms ------------------------------------------------------
  //
  // A `rep` is already a super-op: one dispatch runs the whole count, widened
  // to `memory.copy`/`memory.fill` when the hoisted guards allow it and falling
  // back to a byte loop when they do not. Folding one must change NOTHING about
  // that -- the guards, the fallback and the CX/SI/DI/ZF state on every exit
  // are the handler's, taken verbatim. What it buys is the dispatch on either
  // side, which is the whole point: before this a `rep` split a DOS inner loop
  // into two runs too short to fold.

  // `rep movsw` down the WIDENED path (DF clear, span inside the guest, nothing
  // compiled in it), with foldable work either side of it so the run is a tree
  // rather than a lone op. CX must come out zero and SI/DI must have advanced
  // by the whole byte count, which is the widened path's own bookkeeping.
  repmovs: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w }) => {
      w(0xBE, TABLE & 0xFF, TABLE >> 8);   // mov si,TABLE
      w(0xBF, DEST & 0xFF, DEST >> 8);     // mov di,DEST
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      w(0xFC);                             // cld
      w(0x90);                             // nop: `cld` is a barrier; start here
      w(0x89, 0xF3);                       // mov bx,si
      w(0x01, 0xFB);                       // add bx,di
      w(0xF3, 0xA5);                       // rep movsw     <- 8 words
      w(0x89, 0xCA);                       // mov dx,cx     (0)
      w(0x31, 0xDA);                       // xor dx,bx
      w(0x89, 0xD8);                       // mov ax,bx
    },
  },
  // THE SLOW PATH, in the same shape. `std` is one of the conditions the
  // widened path declines on (`$rep_decl(1)`), so this one runs the byte loop
  // inside the tree -- the interpreter's own fallback, charging `$steps` per
  // element instead of once for the run. Both arms must still print the same
  // seven words, which is what says the two paths agree about where SI, DI and
  // CX end up.
  repmovsdown: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w }) => {
      w(0xBE, (TABLE + 14) & 0xFF, (TABLE + 14) >> 8); // mov si,TABLE+14
      w(0xBF, (DEST + 14) & 0xFF, (DEST + 14) >> 8);   // mov di,DEST+14
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      w(0xFD);                             // std            <- declines the widening
      w(0x90);                             // nop
      w(0x89, 0xF3);                       // mov bx,si
      w(0x01, 0xFB);                       // add bx,di
      w(0xF3, 0xA5);                       // rep movsw
      w(0x89, 0xCA);                       // mov dx,cx
      w(0x31, 0xDA);                       // xor dx,bx
      w(0x89, 0xD8);                       // mov ax,bx
      w(0xFC);                             // cld: `printAndExit` walks with lodsw
    },
  },
  // `rep stosw` -- the fill twin, and the one whose widened path is a
  // `memory.fill`/store loop rather than a copy.
  repstos: {
    folds: true, relaxed: true,
    body: ({ w }) => {
      w(0xBF, DEST & 0xFF, DEST >> 8);     // mov di,DEST
      w(0xB8, 0x5A, 0xA5);                 // mov ax,0A55Ah
      w(0xB9, 0x10, 0x00);                 // mov cx,16
      w(0xFC);                             // cld
      w(0x90);                             // nop
      w(0x89, 0xFB);                       // mov bx,di
      w(0x01, 0xC3);                       // add bx,ax
      w(0xF3, 0xAB);                       // rep stosw     <- 16 words
      w(0x89, 0xCA);                       // mov dx,cx
      w(0x31, 0xDA);                       // xor dx,bx
      w(0x89, 0xDE);                       // mov si,bx
    },
  },
  // THE SCAN, AND ITS THREE EXITS. `repne scasw` stops on a match, on the count
  // running out, or not at all -- and the contract is that CX, DI and ZF are
  // left exactly where the interpreter leaves them in each case. This one hits
  // the MATCH exit: 312Ah is the word four compares in, so CX must come out at
  // 32-4 = 28 and DI at TABLE+8, with ZF set. A fold that ran the scan to
  // exhaustion prints a different CX and the same picture everywhere else.
  repscan: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w }) => {
      w(0xBF, TABLE & 0xFF, TABLE >> 8);   // mov di,TABLE
      w(0xB8, 0x2A, 0x31);                 // mov ax,312Ah
      w(0xB9, 0x20, 0x00);                 // mov cx,32
      w(0xFC);                             // cld
      w(0x90);                             // nop
      w(0x89, 0xFB);                       // mov bx,di
      w(0x8D, 0x77, 0x02);                 // lea si,[bx+2]
      w(0xF2, 0xAF);                       // repne scasw   <- stops on the match
      w(0x89, 0xCA);                       // mov dx,cx     (28)
      w(0x89, 0xFB);                       // mov bx,di     (TABLE+8)
      // ZF is the other half of the exit state and CX alone cannot show it when
      // a scan matches on its LAST element. `pushf` is a hard barrier, so this
      // sits outside the run on purpose -- it reads the flags the folded rep
      // left, from outside the handler that left them.
      w(0x9C, 0x5E, 0x81, 0xE6, 0x40, 0x00); // pushf / pop si / and si,40h
    },
  },
  // ...and the EXHAUSTED exit, in the same shape: a value that is not in the
  // table at all, so the scan runs the count out and CX comes back zero with ZF
  // clear. Same handler, other end.
  repscanmiss: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w }) => {
      w(0xBF, TABLE & 0xFF, TABLE >> 8);   // mov di,TABLE
      w(0xB8, 0x37, 0x13);                 // mov ax,1337h  <- not in the table
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      w(0xFC);                             // cld
      w(0x90);                             // nop
      w(0x89, 0xFB);                       // mov bx,di
      w(0x8D, 0x77, 0x02);                 // lea si,[bx+2]
      w(0xF2, 0xAF);                       // repne scasw
      w(0x89, 0xCA);                       // mov dx,cx     (0)
      w(0x89, 0xFB);                       // mov bx,di     (TABLE+16)
      w(0x9C, 0x5E, 0x81, 0xE6, 0x40, 0x00); // pushf / pop si / and si,40h -> 0
    },
  },
  // `rep cmpsw`: two streams, and the exit is on the first DIFFERENCE. The two
  // halves of the table differ at the very first word, so this stops after one
  // compare with CX at 7 -- and SI and DI have both stepped exactly once.
  repcmps: {
    folds: true, relaxed: true,
    data: [TABLE, Array.from({ length: 64 }, (_, i) => (i * 7) & 0xFF)],
    body: ({ w }) => {
      w(0xBE, TABLE & 0xFF, TABLE >> 8);           // mov si,TABLE
      w(0xBF, (TABLE + 16) & 0xFF, (TABLE + 16) >> 8); // mov di,TABLE+16
      w(0xB9, 0x08, 0x00);                 // mov cx,8
      w(0xFC);                             // cld
      w(0x90);                             // nop
      w(0x89, 0xF3);                       // mov bx,si
      w(0x01, 0xFB);                       // add bx,di
      w(0xF3, 0xA7);                       // rep cmpsw     <- stops on difference
      w(0x89, 0xCA);                       // mov dx,cx
      w(0x89, 0xC3);                       // mov bx,ax
      w(0x89, 0xD8);                       // mov ax,bx
      w(0x9C, 0x58, 0x25, 0x40, 0x00);     // pushf / pop ax / and ax,40h -> 0
    },
  },

  // --- the shift group, the rest of it -------------------------------------
  //
  // A shift whose count comes from CL. The census declines these because IT
  // cannot say what the flags come out as when the count is not known at
  // compile time; the tree does not have to say, because `$sh_<kind><w>` goes
  // into the run verbatim and does the masking, the zero-count early return and
  // the carry read itself. `needs: 'shifts'` is what proves that is the reason
  // this folds: with every OTHER relaxation on it must not.
  shiftcl: {
    folds: true, relaxed: true, needs: 'shifts',
    body: ({ w }) => {
      w(0xB9, 0x04, 0x00);       // mov cx,4
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xD3, 0xE0);             // shl ax,cl
      w(0x89, 0xC3);             // mov bx,ax
      w(0xB9, 0x14, 0x00);       // mov cx,20      <- past the width: the mask decides
      w(0xD3, 0xEB);             // shr bx,cl
      w(0xBA, 0x0F, 0xF0);       // mov dx,0F00Fh
      w(0xB9, 0x03, 0x00);       // mov cx,3
      w(0xD3, 0xFA);             // sar dx,cl
      w(0x89, 0xD6);             // mov si,dx
      w(0x31, 0xC6);             // xor si,ax
      w(0x89, 0xF7);             // mov di,si
    },
  },
  // A COUNT OF ZERO, which is the case the whole group turns on. `$sh_*` masks
  // the count and returns the value untouched without writing a single flag, so
  // the ZF the `cmp` in front of it set has to still be there afterwards. The
  // `pushf` is a barrier and therefore sits OUTSIDE the run on purpose: it reads
  // the flags the folded shift left, from outside the handler that left them.
  // A fold that materialized the shift's flags unconditionally prints 0000 here
  // and every register around it still looks right.
  shiftcl0: {
    folds: true, relaxed: true, needs: 'shifts',
    body: ({ w }) => {
      w(0xB9, 0x00, 0x00);       // mov cx,0        <- first, so only three ops
      w(0xB8, 0x55, 0xAA);       // mov ax,0AA55h      precede the shift and the
      w(0x3D, 0x55, 0xAA);       // cmp ax,0AA55h      `needs` arm has no run of four
      w(0xD3, 0xE0);             // shl ax,cl       <- masked count 0: no flag write
      w(0x89, 0xC2);             // mov dx,ax
      w(0xD3, 0xC2);             // rol dx,cl       <- and a rotate, same
      w(0x9C);                   // pushf           <- barrier: ends the run
      w(0x5B);                   // pop bx
      w(0x81, 0xE3, 0xC5, 0x00); // and bx,0C5h     <- CF PF AF ZF SF -> 44h
    },
  },
  // `rol`/`ror`/`rcl`/`rcr`, immediate and CL. The rotates were never in the
  // fold set at any width and `rcl`/`rcr` read the INCOMING carry through
  // `$get_cf`, which under lazy flags may still be owed by something outside
  // the run -- here the `stc` in front of it, which is a flag barrier and so is
  // outside by construction. AX ends one bit left of 1234h with a 1 shifted in
  // only if that carry reached the fold.
  shiftcarry: {
    folds: true, relaxed: true, needs: 'shifts',
    body: ({ w }) => {
      w(0xF9);                   // stc             <- barrier, CF=1
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xD1, 0xD0);             // rcl ax,1        <- reads CF
      w(0xB9, 0x03, 0x00);       // mov cx,3
      w(0xBB, 0x0F, 0xF0);       // mov bx,0F00Fh
      w(0xD3, 0xDB);             // rcr bx,cl
      w(0x89, 0xDA);             // mov dx,bx
      w(0xD3, 0xC2);             // rol dx,cl
      w(0x89, 0xD6);             // mov si,dx
      w(0xD1, 0xCE);             // ror si,1
      w(0x89, 0xF7);             // mov di,si
      w(0x31, 0xC7);             // xor di,ax
    },
  },

  // --- multiply and divide --------------------------------------------------
  //
  // `mul`/`imul`/`div`/`idiv`, the one-operand forms with the implicit AX/DX
  // pair. The gaps between them are three ops each, so with `muldiv` off there
  // is no run of four anywhere in the body and `needs` bites.
  divmul: {
    folds: true, relaxed: true, needs: 'muldiv', noLoop: true,
    body: ({ w }) => {
      w(0xB8, 0x34, 0x12);       // mov ax,1234h
      w(0xBA, 0x00, 0x00);       // mov dx,0
      w(0xBB, 0x07, 0x00);       // mov bx,7
      w(0xF7, 0xF3);             // div bx          -> ax=029Bh dx=0003h
      w(0x89, 0xC1);             // mov cx,ax
      w(0xB8, 0xF0, 0xFF);       // mov ax,0FFF0h
      w(0xBA, 0xFF, 0xFF);       // mov dx,0FFFFh   <- DX:AX = -16
      w(0xF7, 0xFB);             // idiv bx         -> ax=-2 dx=-2
      w(0x89, 0xC6);             // mov si,ax
      w(0xB8, 0x05, 0x00);       // mov ax,5
      w(0xBB, 0x2C, 0x01);       // mov bx,012Ch
      w(0xF7, 0xE3);             // mul bx          -> ax=05DCh dx=0
      w(0x89, 0xC7);             // mov di,ax
    },
  },
  // A FAULT IN THE MIDDLE OF A TREE, which is the whole of what `muldiv` had to
  // get right and the one thing no other case here can reach.
  //
  // Five registers are written, then a divide by zero traps to INT 0. The
  // vector points at a handler laid down by `pre` which writes all five to
  // memory and IRETs, and the body then loads them back and prints them. So the
  // printed line IS the register file as it stood at the instant of the fault,
  // read by guest code from outside the handler that was executing.
  //
  // That is a sharp check and not a formality. All five are promoted into wasm
  // locals for the length of the tree, and `$fault0` is on trace-jit's
  // `SAFE_CALLS` so the promotion is not declined -- so without the epilogue
  // `buildTree` splices in front of the call, the globals behind them are the
  // values they held on ENTRY to the run and the handler prints those instead.
  // The fold would still compute the right answer everywhere the fault does not
  // fire, which is exactly why this needs a test of its own.
  //
  // The two `nop`s are load-bearing in the same way the ones in `snapshot`
  // are: without them the setup ops and the read-back ops are each a foldable
  // run of their own, the exact and `needs` arms fold those, and the case stops
  // testing anything. With them the only run that reaches four ops is the one
  // the divide is INSIDE.
  divzero: {
    folds: true, relaxed: true, needs: 'muldiv',
    pre: ({ w, label, rel16, at }) => {
      w(0xE9, ...rel16('after0'));                 // jmp after0
      label('div0');
      // ...with a `nop` between every store, for the reason `snapshot` has
      // them: five consecutive stores are a foldable run, and the handler is
      // scaffolding. Without these the exact arm folds the HANDLER and the
      // case stops saying anything about the divide.
      w(0x89, 0x36, 0x10, 0x05); w(0x90);          // mov [0510h],si
      w(0x89, 0x3E, 0x12, 0x05); w(0x90);          // mov [0512h],di
      w(0x89, 0x0E, 0x14, 0x05); w(0x90);          // mov [0514h],cx
      w(0xA3, 0x16, 0x05); w(0x90);                // mov [0516h],ax
      w(0x89, 0x16, 0x18, 0x05); w(0x90);          // mov [0518h],dx
      w(0xCF);                                     // iret  -> resumes AFTER the div
      label('after0');
      const d0 = at('div0') || 0x0100;
      w(0x31, 0xC0);                               // xor ax,ax
      w(0x8E, 0xC0);                               // mov es,ax
      w(0x26, 0xC7, 0x06, 0x00, 0x00, d0 & 0xFF, d0 >> 8);  // mov word es:[0],div0
      w(0x26, 0x8C, 0x0E, 0x02, 0x00);             // mov es:[2],cs
    },
    body: ({ w }) => {
      w(0xBE, 0x11, 0x11);       // mov si,1111h
      w(0xBF, 0x22, 0x22);       // mov di,2222h
      w(0x90);                   // nop: end the run
      w(0xB8, 0x30, 0x00);       // mov ax,0030h    <- these three are INSIDE the
      w(0xBA, 0x44, 0x00);       // mov dx,0044h       tree and promoted, so they
      w(0xB9, 0x00, 0x00);       // mov cx,0           are the sharp part
      w(0xF7, 0xF1);             // div cx          <- #DE, mid-tree
      w(0xA1, 0x10, 0x05);       // mov ax,[0510h]  <- si at the fault -> 1111h
      w(0x8B, 0x1E, 0x12, 0x05); // mov bx,[0512h]  <- di             -> 2222h
      w(0x8B, 0x0E, 0x14, 0x05); // mov cx,[0514h]  <- cx             -> 0000h
      w(0x90);                   // nop: end the run
      w(0x8B, 0x16, 0x16, 0x05); // mov dx,[0516h]  <- ax             -> 0030h
      w(0x8B, 0x36, 0x18, 0x05); // mov si,[0518h]  <- dx             -> 0044h
      w(0x89, 0xF7);             // mov di,si
    },
  },
};

function run(com, extra) {
  const args = [path.join(__dirname, '..', 'tools', 'toyvm', 'run-dos.js'), com,
    '--dispatches=8000000', '--text',
    // A small slice on purpose. `pump` installs BETWEEN slices, so a program
    // that runs its whole loop inside one slice never gets an install at all
    // and the folded arm would be the unfolded arm with extra bookkeeping.
    '--slice=20000', ...extra];
  return execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 24 });
}

const screen = (log) => (log.match(/^  \|(.*)$/gm) || []).map((s) => s.slice(3).trim()).join('');
const folds = (log) => +(/, (\d+) tree folds/.exec(log) || [0, 0])[1];
const trees = (log) => +(/tree fold: (\d+) handler/.exec(log) || [0, 0])[1];
// How many of those handlers absorbed their block's terminator and turn the
// loop inside themselves (`--tree-fold` item 3). Zero unless a self-loop block
// was folded whole, which is a different claim from "something folded".
const loops = (log) => +(/(\d+) loop handler\(s\)/.exec(log) || [0, 0])[1];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-tree-fold-'));
const summary = [];
for (const [name, c] of Object.entries(CASES)) {
  const com = path.join(dir, `${name.toUpperCase()}.COM`);
  let buf = program(c.body, c.pre ? { pre: c.pre } : {});
  if (c.data) buf = withData(buf, c.data[0], c.data[1]);
  fs.writeFileSync(com, buf);

  const off = run(com, []);
  // `--tree-fold-batch=1` installs the first tree the moment one is wanted.
  // The production default batches (a module build per tree costs more than
  // the fold saves -- see docs/toyvm-tree-fold.md), but a test wants the
  // install to have happened by the time the program ends.
  const on = run(com, ['--tree-fold', '--tree-fold-batch=1']);

  assert.ok(/exited=true/.test(off), `${name}: the plain arm did not exit:\n${off}`);
  assert.ok(/exited=true/.test(on), `${name}: the folded arm did not exit:\n${on}`);
  const a = screen(off), b = screen(on);
  assert.ok(a.length === 28, `${name}: expected seven words, got "${a}"`);
  assert.strictEqual(b, a,
    `${name}: the fold computed something else\n  plain  ${a}\n  folded ${b}`);

  const n = folds(on);
  if (c.folds) {
    assert.ok(n > 0, `${name}: nothing folded, but this shape must fold:\n${on}`);
    assert.ok(trees(on) > 0, `${name}: ${n} substitution(s) but no handler generated:\n${on}`);
  } else {
    assert.strictEqual(n, 0,
      `${name}: folded ${n} run(s), but this shape must not fold at all:\n${on}`);
  }
  // ...and the fold must never fire with the flag off, whatever else changes.
  assert.strictEqual(folds(off), 0, `${name}: the plain arm folded ${folds(off)} run(s)`);

  // A case that only folds because of a relaxation has to STOP folding when the
  // relaxation is turned off. Without this the four partial cases would pass on
  // a build where the exact rule set had quietly started accepting narrow ops
  // for some other reason, and the relaxation would be credited with a fold it
  // did not cause.
  let exact = '';
  if (c.relaxed) {
    const ex = run(com, ['--tree-fold', '--tree-fold-batch=1', '--tree-fold-relax=none']);
    assert.ok(/exited=true/.test(ex), `${name}: the exact arm did not exit:\n${ex}`);
    assert.strictEqual(screen(ex), a,
      `${name}: the exact arm computed something else\n  plain ${a}\n  exact ${screen(ex)}`);
    assert.strictEqual(folds(ex), 0,
      `${name}: folded ${folds(ex)} run(s) with the relaxations off, so this case `
      + `is not testing the relaxation:\n${ex}`);
    exact = ' (exact: none)';
  }

  // ...and the sharper form of the same question. `relaxed` only says SOME
  // relaxation is doing the work; `needs` names which one and runs the arm with
  // every OTHER relaxation on, so a case credited to `shifts` that actually
  // folds because of `partial` fails here instead of passing quietly. Worth the
  // extra arm only on the cases whose relaxation is new; the older ones predate
  // it and their bodies were not written to make the distinction clean.
  if (c.needs) {
    const others = RELAXATIONS.filter((r) => r !== c.needs);
    const wo = run(com, ['--tree-fold', '--tree-fold-batch=1',
      `--tree-fold-relax=${others.join(',')}`]);
    assert.ok(/exited=true/.test(wo), `${name}: the without-${c.needs} arm did not exit:\n${wo}`);
    assert.strictEqual(screen(wo), a,
      `${name}: the without-${c.needs} arm computed something else\n`
      + `  plain ${a}\n  without ${screen(wo)}`);
    assert.strictEqual(folds(wo), 0,
      `${name}: folded ${folds(wo)} run(s) with every relaxation EXCEPT `
      + `'${c.needs}', so this case is not testing '${c.needs}':\n${wo}`);
    exact = ` (needs: ${c.needs})`;
  }

  // THE TERMINATOR FOLD. A case marked `loop: true` has a self-loop block whose
  // whole body is foldable, so the tree must absorb the branch and run the
  // iterations inside itself. The screen assertion above is what makes this
  // safe to want: a loop that ran a different number of times, or left the
  // slice at a different instruction, does not print the same seven words.
  //
  // The A/B arm is `--no-tree-fold-loops`, and it has to agree with the plain
  // arm too -- that is what says the loop fold is the only thing that changed.
  let loopNote = '';
  // The other side of that claim. A `div` cannot be absorbed into a LOOP tree:
  // the fault leaves through a `(return)`, which inside region-jit's region
  // would skip the epilogue that publishes where the guest goes next. The loop
  // path asks for `allowFault: false` and this is what says it still does --
  // the body IS a self-loop whose every other op folds, so a regression here
  // shows up as a loop handler appearing rather than as anything going wrong.
  if (c.noLoop) {
    assert.strictEqual(loops(on), 0,
      `${name}: a divide was absorbed into a loop tree, which cannot publish `
      + `$gip on the fault path:\n${on}`);
    assert.ok(/div \(loop tree\)/.test(on),
      `${name}: expected the histogram to name the loop-tree refusal:\n${on}`);
    loopNote = ' (no loop tree)';
  }
  if (c.loop) {
    assert.ok(loops(on) > 0,
      `${name}: this shape has a foldable self-loop block, but no loop handler `
      + `was built:\n${on}`);
    const nl = run(com, ['--tree-fold', '--tree-fold-batch=1', '--no-tree-fold-loops']);
    assert.strictEqual(screen(nl), a,
      `${name}: the no-loops arm computed something else\n  plain ${a}\n  no-loops ${screen(nl)}`);
    assert.strictEqual(loops(nl), 0,
      `${name}: --no-tree-fold-loops still built ${loops(nl)} loop handler(s):\n${nl}`);
    loopNote = ` (${loops(on)} loop)`;
  }

  summary.push(`${name} ${a} ${c.folds ? `${n} fold(s)/${trees(on)} tree(s)` : 'no fold'}${loopNote}${exact}`);
}
// --- the hotness gate ------------------------------------------------------
//
// `--tree-fold-hot=N` compiles a run only after the arena word it starts at has
// been dispatched N times, so a block the program enters once never costs a
// handler. One program answers all three questions the gate has to answer,
// because it contains BOTH shapes:
//
//   pre    five straight-line ops before the loop -- entered exactly ONCE
//   body   the `dot` run inside a 60,000-trip loop -- entered 60,000 times
//
// and it is run at three settings:
//
//   hot=64      the loop is folded, the once-only run is refused as cold
//   hot=50000   NOTHING is folded: at the window's close the loop has been
//               entered ~20,000 times, which is under the bar. This is the
//               case that separates a gate from a delay -- a fold that merely
//               waited would still fire here, eventually.
//   plain       the baseline the other two must reproduce exactly
//
// The window is closed at 300,000 dispatches (`--tree-fold-warm`) while the
// program has ~600,000 still to run, so the third question -- is the picture
// the same on either side of the install -- is asked of a program that spends
// most of its life AFTER the swap. The printed snapshot is seven words of
// registers and flags, and it has to be identical in all three.
const GATE_ITER = 60000;
const GATE_WARM = 300000;
const GATE_COM = path.join(dir, 'GATE.COM');
fs.writeFileSync(GATE_COM, program(CASES.dot.body, {
  iter: GATE_ITER,
  // Five foldable full-width ops, run once. Long enough to be a candidate --
  // under four it would be declined as `too short` and would never reach the
  // gate at all, which would make this case prove nothing.
  pre: ({ w }) => {
    w(0xB8, 0x11, 0x11);       // mov ax,1111h
    w(0xBB, 0x22, 0x22);       // mov bx,2222h
    w(0x01, 0xD8);             // add ax,bx
    w(0xC1, 0xE0, 0x02);       // shl ax,2
    w(0x31, 0xD8);             // xor ax,bx
  },
}));

const gatePlain = run(GATE_COM, []);
// `--tree-fold-batch=1` for the same reason the six cases above pass it: the
// SECOND install -- the one that carries the trees the hot blocks recompiled
// into -- otherwise waits for a batch to fill or for the batch to stop growing,
// and this program only takes about forty-five slices in total. On the corpus
// that wait is a hundred handbacks out of thousands; here it is longer than the
// program.
const gateHot = run(GATE_COM,
  ['--tree-fold', '--tree-fold-hot=64', `--tree-fold-warm=${GATE_WARM}`, '--tree-fold-batch=1']);
const gateCold = run(GATE_COM,
  ['--tree-fold', '--tree-fold-hot=50000', `--tree-fold-warm=${GATE_WARM}`, '--tree-fold-batch=1']);

for (const [n, log] of [['plain', gatePlain], ['hot=64', gateHot], ['hot=50000', gateCold]]) {
  assert.ok(/exited=true/.test(log), `gate ${n}: did not exit:\n${log}`);
}
const gateBar = (log) => +(/(\d+) hot block\(s\)/.exec(log) || [0, -1])[1];
const gateCounts = (log) => ({
  hot: gateBar(log),
  folds: folds(log),
  trees: trees(log),
  cold: +(/(\d+) cold,/.exec(log) || [0, -1])[1],
});

// 1. A COLD BLOCK NEVER FOLDS. At hot=64 the loop is over the bar and the
//    once-only run is not, so the gate has to report at least one refusal --
//    a gate that promoted everything would fold and pass every other check
//    here while being no gate at all.
const g64 = gateCounts(gateHot);
assert.ok(g64.folds > 0, `gate hot=64: nothing folded:\n${gateHot}`);
assert.ok(g64.trees > 0, `gate hot=64: folded but generated no handler:\n${gateHot}`);
assert.ok(g64.cold > 0, `gate hot=64: no candidate was refused as cold, so the `
  + `once-per-run block was folded too:\n${gateHot}`);

// 2. A BLOCK FOLDS ONLY AFTER N ENTRIES. Same program, same window, a bar the
//    loop has not cleared by the time the window closes: nothing at all.
const gHi = gateCounts(gateCold);
assert.strictEqual(gHi.folds, 0,
  `gate hot=50000: folded ${gHi.folds} run(s) below the threshold:\n${gateCold}`);
assert.strictEqual(gHi.hot, 0,
  `gate hot=50000: promoted ${gHi.hot} block(s) below the threshold:\n${gateCold}`);

// 3. THE INSTALL IS INVISIBLE. Most of this program runs after the swap, and
//    all three arms have to print the same seven words.
const gp = screen(gatePlain);
assert.ok(gp.length === 28, `gate: expected seven words, got "${gp}"`);
assert.strictEqual(screen(gateHot), gp,
  `gate hot=64: the fold computed something else\n  plain  ${gp}\n  folded ${screen(gateHot)}`);
assert.strictEqual(screen(gateCold), gp,
  `gate hot=50000: the gated arm computed something else\n  plain  ${gp}\n  gated  ${screen(gateCold)}`);

// ...and the dispatch clock with it. The fold charges the dispatches it
// removes and the arena keeps its shape, so a gated run retires exactly the
// dispatches a plain one does -- the install is a host-side event and must not
// show up on the guest's clock.
const disp = (log) => +(/([\d.]+)M dispatches/.exec(log) || [0, -1])[1];
assert.strictEqual(disp(gateHot), disp(gatePlain),
  `gate hot=64: ${disp(gateHot)}M dispatches against ${disp(gatePlain)}M plain:\n${gateHot}`);

summary.push(`gate ${gp} hot=64:${g64.folds} fold(s)/${g64.trees} tree(s)/${g64.cold} cold, `
  + `hot=50000: no fold`);

// --- coexisting with the region JIT ----------------------------------------
//
// The two folds append handlers to the same table, and for as long as each
// numbered its own from zero they could not both be on: a tree word would
// dispatch into a region, and whichever module was built last carried only its
// own side's handlers. `--tree-fold --region-jit` was refused outright, which
// is not a position the fold can ship from -- the page's default IS the region
// JIT, so a fold that cannot stack on it never runs for anybody.
//
// One allocator owns the tail now (tools/toyvm/extras.js). What this checks is
// the thing that breaks when it does not: the program still computes the same
// seven words with both on. The region JIT is asked to profile early so it has
// a real chance to install here rather than declining past the whole question,
// and the run is required to fold trees either way -- an arm where nothing was
// appended would prove nothing about who owns the ordinals.
const bothProg = GATE_COM;
const both = run(bothProg, [
  '--tree-fold', '--tree-fold-batch=1',
  '--region-jit', '--region-jit-after=100k', '--region-jit-window=100k',
]);
assert.ok(/exited=true/.test(both), `both: the two-fold arm did not exit:\n${both}`);
assert.strictEqual(screen(both), gp,
  `both: --tree-fold --region-jit computed something else\n  plain ${gp}\n  both  ${screen(both)}`);
assert.ok(folds(both) > 0,
  `both: nothing folded, so this arm says nothing about shared ordinals:\n${both}`);
const jitSaid = (/region jit \(inline\): ([a-z]+)/.exec(both) || [0, 'absent'])[1];
summary.push(`both ${screen(both)} ${folds(both)} fold(s)/${trees(both)} tree(s), region jit ${jitSaid}`);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`PASS test-toyvm-tree-fold: ${summary.join('; ')}`);
