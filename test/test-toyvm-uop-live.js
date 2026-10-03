'use strict';

// The µop tier (tools/toyvm/uop-live.js) installed into a program that is
// already running, dropped when the guest rewrites the loop it lowered, rebuilt
// from the new bytes, and -- the part that is easy to get wrong -- invisible on
// the dispatch clock.
//
// Eight programs -- four checked against a closed-form answer computed here, so
// two arms that agree on a wrong number cannot pass:
//
//   PATCH     a hot loop whose immediate is rewritten between two runs of it.
//             A program that stayed installed would keep adding the old
//             constant; the self-modify watch (CodeCache.watchUop) has to drop
//             it and uop-live has to rebuild from the new bytes.
//   SIDEEXIT  a hot loop with a second exit taken once every 65,536 iterations,
//             mid-loop, so the program's side exits are exercised far from the
//             window its head was profiled in.
//   FLAGS     a loop that consumes CF and the byte-register halves (adc after
//             add, setc after rol, xor ah), so the flag passes -- forwarding, liveness,
//             the materialized word -- have to be right about a flag that is
//             really read.
//   MULDIV    mul/imul/div/idiv at 8, 16 and 32 bits on the wasm engine, with
//             every CF/OF and remainder consumed.
//   SEGLOADS  les/lfs, mov/push/pop of es/ds/fs/gs, each followed by an access
//             through the segment it changed; compared against the
//             interpreter (every register and all of RAM), not a closed form.
//   DSHIFT    shld/shrd by constants at 16 and 32 bits, register and memory,
//             with CF/OF/ZF/PF read back; compared the same way.
//   SHIFTS    rol/ror/shl/shr/sar by CL (0..63) at 8, 16 and 32 bits, every
//             flag read back; compared the same way, with no bails allowed.
//   WRAPS     word/dword accesses that wrap ES's 64K segment, so the slow
//             half's full-semantics access hands its block to the reference
//             interpreter mid-block; compared the same way, and it must.
//
// And for every program the DISPATCH COUNT must be identical with the tier on:
// every timer, retrace and audio deadline in this emulator is a function of it,
// and a µop program charges the L1 cost of each block it retires (the `clock`
// pass moves the CHECK, not the charge). Exact equality, not a bound.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runDos } = require('../tools/toyvm/run-dos');
const isa = require('../tools/toyvm/isa');
const { segloads, dshift, shifts, memShifts, wraps } = require('./test-toyvm-uop');

function asm() {
  const b = [], labels = new Map(), fixups = [];
  const at = () => 0x100 + b.length;
  return {
    w: (...x) => { b.push(...x); },
    label(n) { labels.set(n, at()); },
    rel8(n) { fixups.push({ i: b.length, n, size: 1 }); b.push(0); },
    rel16(n) { fixups.push({ i: b.length, n, size: 2 }); b.push(0, 0); },
    abs16(n) { fixups.push({ i: b.length, n, size: 2, abs: true }); b.push(0, 0); },
    at,
    done() {
      for (const f of fixups) {
        const target = labels.get(f.n);
        assert.ok(target !== undefined, `no such label: ${f.n}`);
        const v = f.abs ? target : target - (0x100 + f.i + f.size);
        if (f.size === 1) {
          assert.ok(v >= -128 && v <= 127, `${f.n} is out of rel8 range (${v})`);
          b[f.i] = v & 0xFF;
        } else { b[f.i] = v & 0xFF; b[f.i + 1] = (v >> 8) & 0xFF; }
      }
      return Buffer.from(b);
    },
  };
}

const lo = (n) => n & 0xFF, hi = (n) => (n >> 8) & 0xFF;

// ax as four hex digits through INT 21h/2; clobbers ax, cx, dx, di.
function hexRoutine(a) {
  const { w } = a;
  a.label('hex');
  w(0x89, 0xC7);                           // mov di,ax
  w(0xB9, 0x04, 0x00);                     // mov cx,4
  a.label('hexloop');
  w(0xC1, 0xC7, 0x04);                     // rol di,4
  w(0x89, 0xF8);                           // mov ax,di
  w(0x24, 0x0F);                           // and al,0Fh
  w(0x04, 0x30);                           // add al,'0'
  w(0x3C, 0x39);                           // cmp al,'9'
  w(0x76, 0x02);                           // jbe +2
  w(0x04, 0x07);                           // add al,7
  w(0x88, 0xC2);                           // mov dl,al
  w(0xB4, 0x02);                           // mov ah,2
  w(0xCD, 0x21);                           // int 21h
  w(0xE2); a.rel8('hexloop');              // loop hexloop
  w(0xC3);                                 // ret
}

// --- PATCH ------------------------------------------------------------------
const P_INNER = 0x3FFF, P_REPS1 = 400, P_REPS2 = 300, P_ADD1 = 7, P_ADD2 = 9, P_XOR = 0x5A5A;

function patchProgram() {
  const a = asm();
  const { w } = a;
  w(0xB9, lo(P_REPS1), hi(P_REPS1));       // mov cx,REPS1
  w(0x31, 0xDB);                           // xor bx,bx
  w(0x31, 0xF6);                           // xor si,si
  a.label('o1');
  w(0x31, 0xFF);                           // xor di,di
  w(0x31, 0xD2);                           // xor dx,dx
  w(0xE8); a.rel16('hot');                 // call hot
  w(0x01, 0xD3);                           // add bx,dx
  w(0xE2); a.rel8('o1');                   // loop o1
  w(0xB0, P_ADD2);                         // mov al,ADD2
  w(0x2E, 0xA2); a.abs16('imm');           // mov cs:[imm],al   <- the patch
  w(0xB9, lo(P_REPS2), hi(P_REPS2));       // mov cx,REPS2
  a.label('o2');
  w(0x31, 0xFF);                           // xor di,di
  w(0x31, 0xD2);                           // xor dx,dx
  w(0xE8); a.rel16('hot');                 // call hot
  w(0x01, 0xD3);                           // add bx,dx
  w(0xE2); a.rel8('o2');                   // loop o2
  w(0x89, 0xD8);                           // mov ax,bx
  w(0xE8); a.rel16('hex');                 // call hex
  w(0x89, 0xF0);                           // mov ax,si
  w(0xE8); a.rel16('hex');                 // call hex
  w(0xB8, 0x00, 0x4C);                     // mov ax,4C00h
  w(0xCD, 0x21);                           // int 21h
  hexRoutine(a);
  // Head is the block head, the conditional leaves, the bottom jmp closes it.
  a.label('hot');
  w(0x83, 0xC2); a.label('imm'); w(P_ADD1); // add dx,ADD1   (imm byte is the patch target)
  w(0x81, 0xF2, lo(P_XOR), hi(P_XOR));     // xor dx,XOR
  w(0x46);                                 // inc si
  w(0x47);                                 // inc di
  w(0x81, 0xFF, lo(P_INNER), hi(P_INNER)); // cmp di,INNER
  w(0x74, 0x02);                           // jz +2
  w(0xEB); a.rel8('hot');                  // jmp hot
  w(0xC3);                                 // ret
  return a.done();
}

function patchExpected() {
  let bx = 0, si = 0;
  for (const [reps, add] of [[P_REPS1, P_ADD1], [P_REPS2, P_ADD2]]) {
    for (let r = 0; r < reps; r++) {
      let dx = 0;
      for (let i = 0; i < P_INNER; i++) {
        dx = ((dx + add) & 0xFFFF) ^ P_XOR;
        si = (si + 1) & 0xFFFF;
      }
      bx = (bx + dx) & 0xFFFF;
    }
  }
  return { bx, si };
}

// --- SIDEEXIT ---------------------------------------------------------------
const S_INNER = 0x0FFF, S_REPS = 3000, S_ADD = 5, S_XOR = 0x3C3C, S_RARE = 0x5001;

function sideExitProgram() {
  const a = asm();
  const { w } = a;
  w(0xB9, lo(S_REPS), hi(S_REPS));         // mov cx,REPS
  w(0x31, 0xDB);                           // xor bx,bx
  w(0x31, 0xF6);                           // xor si,si
  w(0x31, 0xED);                           // xor bp,bp
  a.label('outer');
  w(0x31, 0xFF);                           // xor di,di
  w(0x31, 0xD2);                           // xor dx,dx
  w(0xE8); a.rel16('hot');                 // call hot
  w(0x01, 0xD3);                           // add bx,dx
  w(0xE2); a.rel8('outer');                // loop outer
  w(0x89, 0xD8);                           // mov ax,bx
  w(0xE8); a.rel16('hex');                 // call hex
  w(0x89, 0xE8);                           // mov ax,bp
  w(0xE8); a.rel16('hex');                 // call hex
  w(0xB8, 0x00, 0x4C);                     // mov ax,4C00h
  w(0xCD, 0x21);                           // int 21h
  hexRoutine(a);
  a.label('hot');
  w(0x83, 0xC2, S_ADD);                    // add dx,ADD
  w(0x81, 0xF2, lo(S_XOR), hi(S_XOR));     // xor dx,XOR
  w(0x46);                                 // inc si
  w(0x47);                                 // inc di
  w(0x81, 0xFF, lo(S_INNER), hi(S_INNER)); // cmp di,INNER
  w(0x74); a.rel8('done');                 // jz done
  w(0x81, 0xFE, lo(S_RARE), hi(S_RARE));   // cmp si,RARE
  w(0x74); a.rel8('rare');                 // jz rare
  w(0xEB); a.rel8('hot');                  // jmp hot
  a.label('rare');
  w(0x45);                                 // inc bp
  w(0xC3);                                 // ret
  a.label('done');
  w(0xC3);                                 // ret
  return a.done();
}

function sideExitExpected() {
  let bx = 0, si = 0, bp = 0;
  for (let r = 0; r < S_REPS; r++) {
    let dx = 0, di = 0;
    for (;;) {
      dx = ((dx + S_ADD) & 0xFFFF) ^ S_XOR;
      si = (si + 1) & 0xFFFF;
      di = (di + 1) & 0xFFFF;
      if (di === S_INNER) break;
      if (si === S_RARE) { bp = (bp + 1) & 0xFFFF; break; }
    }
    bx = (bx + dx) & 0xFFFF;
  }
  return { bx, si, bp };
}

// --- FLAGS ------------------------------------------------------------------
// A 32-bit-wide add carried through two 16-bit halves (add/adc), a rotate
// whose carry-out is live, and CF read back into a register through setc -- every one of
// them a flag the next instruction really consumes.
const F_ITERS = 0xF000, F_REPS = 199;   // ~110M dispatches, inside the 200M budget

function flagsProgram() {
  const a = asm();
  const { w } = a;
  w(0xB9, lo(F_REPS), hi(F_REPS));         // mov cx,REPS
  w(0x31, 0xDB);                           // xor bx,bx     (lo accumulator)
  w(0x31, 0xED);                           // xor bp,bp     (hi accumulator)
  w(0x31, 0xF6);                           // xor si,si     (carry count)
  w(0xBA, 0x35, 0x12);                     // mov dx,1235h  (rotating word)
  a.label('outer');
  w(0x51);                                 // push cx
  w(0xB9, lo(F_ITERS), hi(F_ITERS));       // mov cx,ITERS
  w(0xE8); a.rel16('hot');                 // call hot
  w(0x59);                                 // pop cx
  w(0xE2); a.rel8('outer');                // loop outer
  w(0x89, 0xD8);                           // mov ax,bx
  w(0xE8); a.rel16('hex');                 // call hex
  w(0x89, 0xE8);                           // mov ax,bp
  w(0xE8); a.rel16('hex');                 // call hex
  w(0x89, 0xF0);                           // mov ax,si
  w(0xE8); a.rel16('hex');                 // call hex
  w(0xB8, 0x00, 0x4C);                     // mov ax,4C00h
  w(0xCD, 0x21);                           // int 21h
  hexRoutine(a);
  a.label('hot');
  w(0x01, 0xD3);                           // add bx,dx
  w(0x83, 0xD5, 0x00);                     // adc bp,0
  w(0xD1, 0xC2);                           // rol dx,1      (CF = the bit rotated out)
  w(0x0F, 0x92, 0xC0);                     // setc al
  w(0x30, 0xE4);                           // xor ah,ah
  w(0x01, 0xC6);                           // add si,ax
  w(0x49);                                 // dec cx
  w(0x74, 0x02);                           // jz +2
  w(0xEB); a.rel8('hot');                  // jmp hot
  w(0xC3);                                 // ret
  return a.done();
}

function flagsExpected() {
  let bx = 0, bp = 0, si = 0, dx = 0x1235, cf = 0;
  for (let r = 0; r < F_REPS; r++) {
    for (let i = 0; i < F_ITERS; i++) {
      let s = bx + dx; bx = s & 0xFFFF; cf = s >> 16;       // add bx,dx
      s = bp + cf; bp = s & 0xFFFF; cf = s >> 16;           // adc bp,0
      cf = (dx >> 15) & 1; dx = ((dx << 1) | cf) & 0xFFFF;  // rol dx,1
      si = (si + cf) & 0xFFFF;                              // setc/add; xor ah and add si,ax leave cf
      // `add si,ax` writes CF, but nothing reads it before the next `add bx,dx`
      // overwrites it.
    }
  }
  return { bx, bp, si };
}

// --- MULDIV -----------------------------------------------------------------
// mul/imul/div/idiv at 8, 16 and 32 bits in one hot loop, every product's
// CF/OF and every remainder consumed. Operands are shaped so no divide ever
// faults: the divisor is cx|1 (nonzero; 0xFFFF unreachable, so no -32768/-1),
// its 8-bit twin is (cl&7Fh)|1 (positive, so -128/-1 cannot happen), and each
// unsigned dividend's high half is below its divisor.
const M_ITERS = 0xF000, M_REPS = 28;    // ~57 dispatches/iter, ~98M total

function muldivProgram() {
  const a = asm();
  const { w } = a;
  w(0xB9, lo(M_REPS), hi(M_REPS));         // mov cx,REPS
  w(0x31, 0xDB);                           // xor bx,bx
  w(0x31, 0xED);                           // xor bp,bp
  w(0x31, 0xF6);                           // xor si,si
  a.label('outer');
  w(0x51);                                 // push cx
  w(0xB9, lo(M_ITERS), hi(M_ITERS));       // mov cx,ITERS
  w(0xE8); a.rel16('hot');                 // call hot
  w(0x59);                                 // pop cx
  w(0xE2); a.rel8('outer');                // loop outer
  w(0x89, 0xD8);                           // mov ax,bx
  w(0xE8); a.rel16('hex');                 // call hex
  w(0x89, 0xE8);                           // mov ax,bp
  w(0xE8); a.rel16('hex');                 // call hex
  w(0x89, 0xF0);                           // mov ax,si
  w(0xE8); a.rel16('hex');                 // call hex
  w(0xB8, 0x00, 0x4C);                     // mov ax,4C00h
  w(0xCD, 0x21);                           // int 21h
  hexRoutine(a);
  a.label('hot');
  w(0x89, 0xCF);                           // mov di,cx
  w(0x83, 0xCF, 0x01);                     // or di,1
  // 16-bit
  w(0x89, 0xF8);                           // mov ax,di
  w(0xF7, 0xE7);                           // mul di
  w(0x01, 0xC3);                           // add bx,ax
  w(0x11, 0xD5);                           // adc bp,dx
  w(0x89, 0xD8);                           // mov ax,bx
  w(0xF7, 0xEF);                           // imul di       (CF=OF: product left 16 bits)
  w(0x11, 0xD6);                           // adc si,dx
  w(0x89, 0xE8);                           // mov ax,bp
  w(0x31, 0xD2);                           // xor dx,dx
  w(0xF7, 0xF7);                           // div di
  w(0x01, 0xC6);                           // add si,ax
  w(0x31, 0xD3);                           // xor bx,dx
  w(0x89, 0xF0);                           // mov ax,si
  w(0x99);                                 // cwd
  w(0xF7, 0xFF);                           // idiv di
  w(0x01, 0xC5);                           // add bp,ax
  // 8-bit
  w(0x88, 0xD8);                           // mov al,bl
  w(0xF6, 0xE1);                           // mul cl         (CF: AH nonzero)
  w(0x11, 0xC3);                           // adc bx,ax
  w(0x88, 0xCA);                           // mov dl,cl
  w(0x80, 0xE2, 0x7F);                     // and dl,7Fh
  w(0x80, 0xCA, 0x01);                     // or dl,1
  w(0x88, 0xF8);                           // mov al,bh
  w(0x30, 0xE4);                           // xor ah,ah
  w(0xF6, 0xF2);                           // div dl
  w(0x01, 0xC6);                           // add si,ax
  w(0x88, 0xD8);                           // mov al,bl
  w(0x98);                                 // cbw
  w(0xF6, 0xFA);                           // idiv dl
  w(0x31, 0xC5);                           // xor bp,ax
  w(0x88, 0xD8);                           // mov al,bl
  w(0xF6, 0xEA);                           // imul dl
  w(0x83, 0xD5, 0x00);                     // adc bp,0
  // 32-bit
  w(0x66, 0x0F, 0xB7, 0xC3);               // movzx eax,bx
  w(0x66, 0xC1, 0xE0, 0x10);               // shl eax,16
  w(0x89, 0xF0);                           // mov ax,si
  w(0x66, 0x0F, 0xB7, 0xFF);               // movzx edi,di
  w(0x66, 0xF7, 0xE7);                     // mul edi
  w(0x01, 0xC6);                           // add si,ax
  w(0x11, 0xD5);                           // adc bp,dx
  w(0x66, 0x83, 0xC0, 0x07);               // add eax,7
  w(0x66, 0xF7, 0xF7);                     // div edi       (EDX < EDI, so it fits)
  w(0x01, 0xC6);                           // add si,ax
  w(0x31, 0xD3);                           // xor bx,dx
  w(0x66, 0x0F, 0xBF, 0xC5);               // movsx eax,bp
  w(0x66, 0x99);                           // cdq
  w(0x66, 0xF7, 0xFF);                     // idiv edi
  w(0x01, 0xC3);                           // add bx,ax
  w(0x66, 0x0F, 0xBF, 0xC3);               // movsx eax,bx
  w(0x66, 0xC1, 0xE0, 0x08);               // shl eax,8
  w(0x66, 0xF7, 0xEF);                     // imul edi      (CF=OF: product left 32 bits)
  w(0x11, 0xD6);                           // adc si,dx
  w(0x49);                                 // dec cx
  w(0x74, 0x03);                           // jz +3
  w(0xE9); a.rel16('hot');                 // jmp hot       (too far for rel8)
  w(0xC3);                                 // ret
  return a.done();
}

function muldivExpected() {
  const sx8 = (v) => (v << 24) >> 24, sx16 = (v) => (v << 16) >> 16;
  const M16 = 0xFFFF, B32 = 1n << 32n;
  let bx = 0, bp = 0, si = 0, s, p, q, r, n, cf;
  for (let rep = 0; rep < M_REPS; rep++) {
    for (let cx = M_ITERS; cx > 0; cx--) {
      const di = cx | 1;
      p = di * di;                                                   // mul di
      s = bx + (p & M16); bx = s & M16; bp = (bp + (p >>> 16) + (s >> 16)) & M16;
      p = sx16(bx) * sx16(di);                                       // imul di
      cf = sx16(p & M16) !== p ? 1 : 0;
      si = (si + ((p >> 16) & M16) + cf) & M16;
      q = Math.floor(bp / di); r = bp % di;                          // div di
      si = (si + q) & M16; bx ^= r;
      q = Math.trunc(sx16(si) / sx16(di));                           // idiv di
      bp = (bp + q) & M16;
      p = (bx & 0xFF) * (cx & 0xFF);                                 // mul cl
      bx = (bx + p + (p >> 8 ? 1 : 0)) & M16;
      const dl = (cx & 0x7F) | 1;
      q = Math.floor((bx >> 8) / dl); r = (bx >> 8) % dl;            // div dl
      si = (si + (q | (r << 8))) & M16;
      n = sx8(bx & 0xFF); q = Math.trunc(n / dl); r = n - q * dl;    // idiv dl
      bp ^= (q & 0xFF) | ((r & 0xFF) << 8);
      p = sx8(bx & 0xFF) * dl;                                       // imul dl
      bp = (bp + (sx8(p & 0xFF) !== p ? 1 : 0)) & M16;
      let eax = BigInt(((bx << 16) | si) >>> 0);                     // mul edi
      p = eax * BigInt(di);
      let edx = p >> 32n; eax = p & (B32 - 1n);
      s = si + Number(eax & 0xFFFFn); si = s & M16;
      bp = (bp + Number(edx & 0xFFFFn) + (s >> 16)) & M16;
      eax = (eax + 7n) & (B32 - 1n);                                 // add eax,7; div edi
      n = (edx << 32n) | eax;
      si = (si + Number((n / BigInt(di)) & 0xFFFFn)) & M16;
      bx ^= Number((n % BigInt(di)) & 0xFFFFn);
      q = Math.trunc(sx16(bp) / di);                                 // idiv edi
      bx = (bx + (q & M16)) & M16;
      p = BigInt(sx16(bx) << 8) * BigInt(di);                        // imul edi
      cf = BigInt.asIntN(32, p) !== p ? 1 : 0;
      si = (si + Number(BigInt.asUintN(64, p) >> 32n & 0xFFFFn) + cf) & M16;
    }
  }
  return { bx, bp, si };
}

// The pass set every µop run builds with: null is uop-live.js's default
// ('all'); main() runs the whole suite again with 'allR', 'allRF' and 'allRP', the
// guest vregs resident in L1's register file (uop-opt.js finalize), narrow
// writes as narrow stores and as full-width merges, because that is the
// only place the wasm engine's narrow stores and its missing reload/flush
// meet a real program.
let PASSES = null;
// chain: the programs live in one E1 arena and link to each other (uop-live.js).
let CHAIN = false;
const OPT = require('../tools/toyvm/uop-opt');

async function run(com, uop, sched = { sampleAfter: 1e6, profileFor: 2e6, every: 4e6 }) {
  const r = await runDos({
    exe: com,
    budget: 200e6,
    slice: 5e4,
    log: () => {},
    uop: uop ? { ...sched, passes: PASSES, chain: CHAIN } : null,
  });
  const regs = r.vm.getAll();
  const ram = crypto.createHash('sha256')
    .update(Buffer.from(r.vm.mem.buffer, 0, isa.GUEST_RAM_SIZE)).digest('hex');
  return { ...regs, ram, frame: r.frame, cells: r.text.cells,
    written: r.machine.con.written, dispatched: r.dispatched, uop: r.uop };
}

async function check(name, bytes, want, keys) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-uop-live-'));
  const com = path.join(dir, `${name}.COM`);
  fs.writeFileSync(com, bytes);
  const off = await run(com, false);
  const on = await run(com, true);
  for (const k of keys) {
    assert.ok(want[k] !== 0, `${name}: the closed form degenerated to zero in ${k}`);
    assert.strictEqual(off[k], want[k], `${name}: interpreter ${k} = ${off[k]}, want ${want[k]}`);
    assert.strictEqual(on[k], want[k], `${name}: µop ${k} = ${on[k]}, want ${want[k]}`);
  }
  const u = on.uop;
  assert.ok(u && u.installs >= 1, `${name}: no µop program installed (${JSON.stringify(u && u.declined)})`);
  assert.ok(u.steps > 0.3 * on.dispatched,
    `${name}: the µop tier ran only ${u.steps} of ${on.dispatched} dispatches`);
  assert.strictEqual(on.frame, off.frame, `${name}: the frame differs with the µop tier on`);
  assert.strictEqual(on.cells, off.cells, `${name}: the text screen differs`);
  assert.strictEqual(on.written, off.written, `${name}: a different number of characters was printed`);
  assert.strictEqual(on.dispatched, off.dispatched,
    `${name}: the dispatch clock moved: ${on.dispatched} with the µop tier vs ${off.dispatched}`);
  console.log(`${name}: ok  ${off.dispatched} dispatches, ${(100 * u.steps / on.dispatched).toFixed(1)}% in µop, `
    + `installs ${u.installs} entries ${u.entries} rebuilds ${u.rebuilds} bails ${u.bails}`
    + (CHAIN ? ` chains ${u.chains}` : ''));
  return on;
}

// No closed form: the segment-load loop from test-toyvm-uop.js, run long
// enough to install, must leave every register and all of guest RAM exactly
// as the interpreter does. It is the only place the wasm engine runs the
// segment micro-ops (getsel/putsel/puts).
async function checkSame(name, bytes, sched, { noBails = false, bails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-uop-live-'));
  const com = path.join(dir, `${name}.COM`);
  fs.writeFileSync(com, bytes);
  const off = await run(com, false, sched);
  const on = await run(com, true, sched);
  const u = on.uop;
  assert.ok(u && u.installs >= 1, `${name}: no µop program installed (${JSON.stringify(u && u.declined)})`);
  assert.ok(u.steps > 0.3 * on.dispatched,
    `${name}: the µop tier ran only ${u.steps} of ${on.dispatched} dispatches`);
  // A bail runs the block on the reference interpreter: still exact, but then
  // this case is not testing the wasm engine at all.
  if (noBails) assert.strictEqual(u.bails, 0, `${name}: ${u.bails} bails to the reference interpreter: `
    + JSON.stringify((u.heads || []).map((h) => h.bailAt)));
  // ...and a case written to reach the hand-over has to actually reach it.
  if (bails) assert.ok(u.bails > 0, `${name}: never handed a block to the reference interpreter`);
  // ...from a NATIVE block (ldf/stf's own hand-over), not one that failed to lower.
  if (bails) for (const h of u.heads || []) for (const s of h.bailAt || []) {
    assert.ok(/ native$/.test(s), `${name}: a block with no native form bailed: ${s}`);
  }
  for (const k of Object.keys(off)) {
    if (k === 'uop') continue;
    assert.strictEqual(on[k], off[k], `${name}: ${k} differs with the µop tier on`);
  }
  console.log(`${name}: ok  ${off.dispatched} dispatches, ${(100 * u.steps / on.dispatched).toFixed(1)}% in µop, `
    + `installs ${u.installs} entries ${u.entries} rebuilds ${u.rebuilds} bails ${u.bails}`
    + (CHAIN ? ` chains ${u.chains}` : '')
    + (bails ? ` ${JSON.stringify((u.heads || []).map((h) => h.bailAt))}` : ''));
}

async function suite() {
  const p = await check('PATCH', patchProgram(), patchExpected(), ['bx', 'si']);
  // The patch lands inside the program's own bytes: it must have been dropped
  // and rebuilt from the rewritten loop (or given up), never kept.
  assert.ok(p.uop.rebuilds + p.uop.gaveUp >= 1,
    `PATCH: the µop program survived the guest rewriting its loop (rebuilds ${p.uop.rebuilds})`);
  const s = await check('SIDEEXIT', sideExitProgram(), sideExitExpected(), ['bx', 'si', 'bp']);
  assert.ok(sideExitExpected().bp > 0, 'SIDEEXIT: the rare exit is never reached');
  void s;
  await check('FLAGS', flagsProgram(), flagsExpected(), ['bx', 'bp', 'si']);
  await check('MULDIV', muldivProgram(), muldivExpected(), ['bx', 'bp', 'si']);
  await checkSame('SEGLOADS', segloads(255).com, { sampleAfter: 1e5, profileFor: 2e5, every: 4e5 });
  await checkSame('DSHIFT', dshift(255).com, { sampleAfter: 1e5, profileFor: 2e5, every: 4e5 });
  await checkSame('SHIFTS', shifts(40).com, { sampleAfter: 1e5, profileFor: 2e5, every: 4e5 }, { noBails: true });
  await checkSame('MEMSHIFTS', memShifts(60).com, { sampleAfter: 1e5, profileFor: 2e5, every: 4e5 }, { noBails: true });
  await checkSame('WRAPS', wraps(250).com, { sampleAfter: 1e5, profileFor: 2e5, every: 4e5 }, { bails: true });
}

async function main() {
  await suite();
  for (const name of ['allR', 'allRF', 'allRP']) {
    PASSES = OPT.ablationConfigs().find(([n]) => n === name)[1];
    console.log(`-- resident (${name}):`);
    await suite();
  }
  PASSES = null;
  CHAIN = true;
  console.log('-- chained arena (allRP):');
  await suite();
  console.log('test-toyvm-uop-live: ok');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
else module.exports = { patchProgram, sideExitProgram, flagsProgram, muldivProgram };
