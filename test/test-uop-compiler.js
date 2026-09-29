#!/usr/bin/env node
'use strict';
// The x86 -> micro-op lowering (src/07e-uop-compiler.wat) against the threaded
// interpreter, on hand-assembled loops.
//
// Every case runs twice on one instance, at two fresh code addresses: once
// with the tier off, once with it on (the loop gets hot after 256 entries and
// the rest of it runs as a program). Registers, EIP, the five observable
// flags and the whole working buffer must come out identical. A third arm
// installs the program before the first iteration, so the lowering also runs
// from the loop's very first entry (the entry flag state is whatever the setup
// left). A case that declines or never enters is a failure too: a lowering
// that bails on everything is trivially exact.

const path = require('path');
const ROOT = path.join(__dirname, '..');
const bench = require(path.join(ROOT, 'tools', 'bench-loops.js'));

// ---- a tiny assembler: bytes, {label}, {jcc, to}, {jmp, to} (rel8) ----
function asm(items) {
  const at = new Map();
  for (let pass = 0; pass < 2; pass++) {
    let pc = 0;
    const out = [];
    for (const it of items) {
      if (typeof it === 'number') { out.push(it); pc++; continue; }
      if (Array.isArray(it)) { out.push(...it); pc += it.length; continue; }
      if (it.label) { at.set(it.label, pc); continue; }
      const t = at.get(it.to) ?? pc;
      if (it.call) {
        const r = t - (pc + 5);
        out.push(0xE8, r & 0xFF, (r >>> 8) & 0xFF, (r >>> 16) & 0xFF, (r >>> 24) & 0xFF);
        pc += 5;
        continue;
      }
      const rel = t - (pc + 2);
      out.push(it.jmp ? 0xEB : 0x70 | it.jcc, rel & 0xFF);
      pc += 2;
    }
    if (pass === 1) { out.labels = at; return out; }
  }
}
const J = (cc, to) => ({ jcc: cc, to });
const JMP = (to) => ({ jmp: true, to });
const L = (label) => ({ label });
const CALL = (to) => ({ call: true, to });
const d32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
const cc = { O: 0, NO: 1, B: 2, AE: 3, Z: 4, NZ: 5, BE: 6, A: 7, S: 8, NS: 9, L: 12, GE: 13, LE: 14, G: 15 };

const N = 3000;
const BATCH = +(process.env.UOP_BATCH || 37);
const CASES = [
  {
    name: 'lut8', regs: { ecx: N },
    code: [L('l'), [0x0F, 0xB6, 0x06], [0x8A, 0x04, 0x03], [0x88, 0x07], 0x46, 0x47, 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // poke: a key byte early, so both paths are taken (and threaded code has
    // split its blocks at both) long before the batches are compared.
    name: 'colorkey', regs: { ecx: N },
    poke: (mem, src) => { mem[src + 3] = 0xFF; },
    code: [L('l'), [0x8A, 0x06], [0x3C, 0xFF], J(cc.Z, 's'), [0x88, 0x07], L('s'), 0x46, 0x47, 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    name: 'sum16-cmp-jb', regs: { ecx: 0, ebp: N, eax: 5 },
    code: [L('l'), [0x0F, 0xB7, 0x14, 0x4E], [0x01, 0xD0], 0x41, [0x39, 0xE9], J(cc.B, 'l'), 0xC3],
  },
  {
    name: 'signed-diamond', regs: { ecx: N },
    code: [L('l'), [0x8B, 0x16], [0x83, 0xEA, 0x64], J(cc.L, 'n'), [0x01, 0xD0], JMP('x'),
           L('n'), [0x29, 0xD0], L('x'), [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    name: 'shift-imul-8bit', regs: { ecx: N, edx: 0x12345 },
    code: [L('l'), [0x8B, 0x06], [0xC1, 0xE8, 0x03], [0x6B, 0xC0, 0x07], [0x30, 0xE0],
           [0x25, 0xFF, 0xFF, 0x00, 0x00], [0x01, 0x07], [0xD1, 0xE2], [0x83, 0xC6, 0x04],
           [0x83, 0xC7, 0x04], [0x83, 0xE9, 0x01], J(cc.NZ, 'l'), 0xC3],
  },
  {
    // dec leaves CF alone: the exit flags carry the add's carry.
    name: 'incdec-keeps-cf', regs: { ecx: N, eax: 0xFFFF0000 },
    code: [L('l'), [0x03, 0x06], 0x43, [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // add sets CF, inc keeps it, jb/jae reads it: the CF-through-inc path.
    name: 'cf-across-inc', regs: { ecx: N, eax: 0x7FFFFFF0 },
    code: [L('l'), [0x03, 0x06], 0x43, J(cc.AE, 'k'), 0x47, L('k'), [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // leaves the loop through a taken branch on a test.
    name: 'test-exit', regs: { ecx: N }, find: true,
    code: [L('l'), [0xF6, 0x06, 0x80], J(cc.NZ, 'f'), 0x46, 0x49, J(cc.NZ, 'l'), 0xC3, L('f'), 0xC3],
  },
  {
    name: 'word-neg-not', regs: { edi: 'end16' },
    code: [L('l'), [0x66, 0x8B, 0x06], [0x66, 0xF7, 0xD8], [0x66, 0xF7, 0xD2], [0x66, 0x01, 0xC2],
           [0x83, 0xC6, 0x02], [0x39, 0xFE], J(cc.NZ, 'l'), 0xC3],
  },
  {
    name: 'dec-jg', regs: { ecx: N },
    code: [L('l'), [0x03, 0x06], [0x83, 0xC6, 0x04], 0x49, J(cc.G, 'l'), 0xC3],
  },
  {
    name: 'abs-cdq-sar', regs: { edi: 'end32' },
    code: [L('l'), [0x8B, 0x06], [0xC1, 0xF8, 0x02], 0x99, [0x31, 0xD0], [0x29, 0xD0], [0x01, 0xC3],
           [0x83, 0xC6, 0x04], [0x39, 0xFE], J(cc.B, 'l'), 0xC3],
  },
  {
    name: 'byte-rmw', regs: { ecx: N },
    code: [L('l'), [0x8A, 0x06], [0x00, 0xD8], [0xFE, 0x07], [0x28, 0x07], 0x46, 0x47, 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // flags at exit come from a cmp whose operand register changes later.
    name: 'cmp-then-clobber', regs: { ecx: N },
    code: [L('l'), [0x8B, 0x06], [0x39, 0xD0], J(cc.A, 'k'), [0x89, 0xC2], L('k'), [0x83, 0xC6, 0x04],
           [0x8D, 0x04, 0x49], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // mov to/from an absolute address (A0-A3, with and without 66): an
    // accumulator kept in memory, a byte copied, a word stored.
    name: 'moffs-accum', regs: { ecx: N },
    code: (a) => {
      const D = a.buf + 0x10100;
      return [L('l'), [0xA1, ...d32(D)], [0x03, 0x06], [0xA3, ...d32(D)],
              [0xA0, ...d32(a.buf + 0x200)], [0xA2, ...d32(D + 8)], [0x66, 0xA3, ...d32(D + 12)],
              [0x66, 0xA1, ...d32(D + 4)], [0x01, 0xC3],
              [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3];
    },
  },
  {
    // rol/ror by an immediate and by 1, at 32, 16 and 8 bits, with CF read
    // by jb after ror and SF after an 8-bit rol (both taken about half the
    // time, so threaded code has split its blocks at both targets early),
    // and `cmp al,0x10 / ror eax,0x10 / jz` -- Indeo 4's VLC reader, where
    // the jz tests the cmp because a rotate leaves ZF/SF/PF alone. The
    // compiler declines rotates (its flag record cannot carry preserved
    // flags), so this pins that it declines and that the tier-on run still
    // matches threaded code.
    name: 'rotate-imm', regs: { ecx: N }, declines: true,
    code: [L('l'), [0x8B, 0x06], [0xC1, 0xC0, 0x05], [0x01, 0xC3], [0xC0, 0xCA, 0x03], [0xD1, 0xC8],
           J(cc.B, 'k'), 0x45, L('k'), [0x66, 0xC1, 0xC2, 0x07], [0xC0, 0xC7, 0x03], J(cc.S, 'm'), 0x47, L('m'),
           [0x3C, 0x10], [0xC1, 0xC8, 0x10], J(cc.Z, 'n'), 0x43, L('n'),
           [0x01, 0xC2], [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // shl/shr/sar by CL with a random count: 0 (flags untouched) and, at
    // 8/16 bits, counts >= the width both deopt; CF and ZF are consumed.
    name: 'shift-cl-raw', regs: { ebp: N },
    code: [L('l'), [0x8B, 0x06], [0x8A, 0x4E, 0x04], [0xD3, 0xE0], J(cc.B, 'k'), 0x43, L('k'),
           [0xD3, 0xEA], [0x01, 0xC2], [0xD2, 0xFF], J(cc.Z, 'z'), 0x47, L('z'),
           [0x66, 0xD3, 0xE2], J(cc.AE, 'y'), 0x43, L('y'), [0xD3, 0x26], [0xD3, 0x3E],
           [0x83, 0xC6, 0x04], 0x4D, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // 32-bit only: count 0 keeps the incoming flags, read by the jb after.
    name: 'shift-cl-32', regs: { ebp: N },
    code: [L('l'), [0x8B, 0x06], [0x8A, 0x4E, 0x04], [0x39, 0xD0], [0xD3, 0xE0], J(cc.B, 'k'), 0x43, L('k'),
           [0xD3, 0xFA], J(cc.Z, 'z'), 0x47, L('z'), [0x01, 0xC2], [0xD3, 0x2E],
           [0x83, 0xC6, 0x04], 0x4D, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // the same with the count in 0..7, so the lowered path is the common one.
    name: 'shift-cl-small', regs: { ebp: N },
    code: [L('l'), [0x8B, 0x06], [0x8A, 0x4E, 0x04], [0x80, 0xE1, 0x07], [0xD3, 0xE8], J(cc.B, 'k'), 0x43, L('k'),
           [0xD2, 0xE2], J(cc.AE, 'j'), 0x47, L('j'), [0xD3, 0xF8], [0x01, 0xC2], [0xD3, 0x26],
           [0x83, 0xC6, 0x04], 0x4D, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // setcc after a 32-bit cmp (its B operand overwritten between two reads),
    // an 8-bit cmp, a test, a sub and an inc, into low and high byte registers
    // and memory; setp/seto/setb-after-inc go through the record.
    name: 'setcc-forms', regs: { ecx: N },
    code: [L('l'), [0x8B, 0x06], [0x8B, 0x56, 0x04], [0x39, 0xD0],
           [0x0F, 0x92, 0xC3], [0x0F, 0x9E, 0xC7], [0x0F, 0x9F, 0x07], [0x0F, 0x95, 0xC2], [0x0F, 0x97, 0xC6],
           [0x01, 0xD8], [0x38, 0xD0], [0x0F, 0x9C, 0xC4], [0x0F, 0x93, 0x47, 0x01],
           [0x85, 0xD0], [0x0F, 0x98, 0xC3], [0x0F, 0x9D, 0xC7], [0x0F, 0x97, 0xC2], [0x0F, 0x9E, 0xC6],
           [0x0F, 0x92, 0x47, 0x02], [0x0F, 0x9A, 0xC4],
           [0x01, 0xD3], [0x29, 0xC3], [0x0F, 0x98, 0xC0], [0x0F, 0x94, 0x47, 0x03], [0x0F, 0x90, 0xC2],
           0x43, [0x0F, 0x95, 0xC4], [0x0F, 0x92, 0xC6],
           [0x01, 0xC5], [0x01, 0xD5], [0x83, 0xC6, 0x04], [0x83, 0xC7, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // sbb r,r (the sbb eax,eax idiom), r/m,r, r,imm8, r,m, m,r, m,imm32,
    // eax,imm32, and sbb ebx,-1 whose b+CF wraps when CF is set (the
    // handlers' flag_a 0 / flag_b 1 fix-up), with CF and SF^OF read after.
    name: 'sbb-forms', regs: { ecx: N },
    code: [L('l'), [0x8B, 0x06], [0x8B, 0x56, 0x04], [0x39, 0xD0], [0x1B, 0xC0], [0x19, 0xD3],
           [0x83, 0xDD, 0x05], [0x1B, 0x56, 0x08], [0x19, 0x07], [0x81, 0x1F, ...d32(0x12345678)],
           [0x1D, ...d32(0x7FFFFFFF)], J(cc.B, 'k'), 0x43, L('k'), [0x83, 0xDB, 0xFF], J(cc.L, 'm'), 0x45, L('m'),
           [0x01, 0xC5], [0x83, 0xC6, 0x04], [0x83, 0xC7, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  // ---- the stack (07e kinds 21-24) ----
  {
    // push r / imm32 / imm8 / esp, read back through [esp+N], popped into
    // other registers: every value and the final ESP must agree.
    name: 'push-pop-forms', regs: { ecx: N },
    code: [L('l'), 0x56, [0x68, ...d32(0x12345678)], [0x6A, 0xFD], 0x54, [0x8B, 0x44, 0x24, 0x08],
           [0x01, 0xC3], 0x58, [0x29, 0xC3], 0x5A, [0x01, 0xD3], 0x58, [0x31, 0xC3], 0x5D, [0x01, 0xEB],
           [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // a leaf call with an argument: the callee's ret goes back into the loop.
    name: 'call-leaf', regs: { ecx: N },
    code: [L('l'), 0x51, CALL('f'), [0x83, 0xC4, 0x04], [0x01, 0xC3], [0x83, 0xC6, 0x04], 0x49,
           J(cc.NZ, 'l'), 0xC3,
           L('f'), [0x8B, 0x44, 0x24, 0x04], [0x03, 0x06], 0xC3],
  },
  {
    // stdcall (ret 8), a prologue/epilogue, and flags set in the callee and
    // read after it returns.
    name: 'call-stdcall', regs: { ecx: N },
    code: [L('l'), 0x56, 0x51, CALL('f'), J(cc.S, 'k'), 0x43, L('k'), [0x01, 0xC3], [0x83, 0xC6, 0x04], 0x49,
           J(cc.NZ, 'l'), 0xC3,
           // eax = [arg1] ^ (arg2 << 31): the sign alternates with ecx, so
           // threaded code takes both sides of the js before the install.
           L('f'), 0x55, [0x89, 0xE5], [0x8B, 0x45, 0x0C], [0x8B, 0x00], [0x8B, 0x55, 0x08], [0xC1, 0xE2, 0x1F],
           [0x31, 0xD0], 0x5D, [0xC2, 0x08, 0x00]],
  },
  {
    // one helper called from two sites: its ret has two candidates.
    name: 'call-two-sites', regs: { ecx: N },
    code: [L('l'), [0x8B, 0x06], CALL('f'), [0x01, 0xC3], [0x8B, 0x46, 0x04], CALL('f'), [0x31, 0xC3],
           [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3,
           L('f'), [0xC1, 0xE0, 0x03], [0x83, 0xC0, 0x07], 0xC3],
  },
  {
    // a nested call, the inner callee reached from inside the outer one.
    name: 'call-nested', regs: { ecx: N },
    code: [L('l'), [0x8B, 0x06], CALL('f'), [0x01, 0xC3], [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3,
           L('f'), 0x50, CALL('g'), 0x5A, [0x01, 0xD0], 0xC3,
           L('g'), [0xD1, 0xE0], 0x40, 0xC3],
  },
  {
    // A rare call into a callee too big to scan (620 nops): following the
    // call hits the scan limit, so the head is compiled again with the call
    // as the region's edge -- the loop that compiled before calls were
    // followed must still compile.
    name: 'call-big-callee', regs: { ecx: N },
    code: [L('l'), [0x03, 0x06], [0x83, 0xC6, 0x04], [0xF6, 0xC1, 0x3F], J(cc.NZ, 's'), CALL('f'), L('s'), 0x49,
           J(cc.NZ, 'l'), 0xC3, L('f'), new Array(620).fill(0x90), 0xC3],
  },
  {
    // the callee returns 2 bytes past its return address (skipping an inc)
    // every other iteration: that ret's pop never matches its candidate, so
    // it must deopt to the threaded ret each time it differs.
    // The bumped return lands on ret+2, an entry threaded code splits at and
    // the compiler cannot know statically (the ret's check misses and exits
    // there), so the block-clock charge is history-dependent like a fold's;
    // state and the branch clock must still match.
    name: 'ret-mismatch', regs: { ecx: N }, dynamicEntry: true,
    code: [L('l'), [0x8B, 0x06], CALL('f'), [0x43, 0x43], 0x47, [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3,
           L('f'), [0xA8, 0x01], J(cc.Z, 'r'), [0x83, 0x04, 0x24, 0x02], L('r'), 0xC3],
  },
];

// ---- --uop-trace-heads (07e $uc_form_trace) ----
// A head with no back edge: the loop around it runs an instruction the tier
// does not lower (bsr), so no head in it has a loop to compile, and without
// traces every one declines no-backedge. Each case runs with trace heads on in
// the hot and pre arms; `head` names the label the pre arm compiles at. `lf`
// marks a label as the logical-frame step ($th_logical_frame): the marker
// block must run threaded every time, so its count must match threaded code's.
const TRACE_F = [L('f'), [0x8B, 0x16], [0x01, 0xD3], [0x89, 0xD0], [0xC1, 0xE8, 0x05], [0x31, 0xC3],
  [0x81, 0xFA, ...d32(0x40000000)], J(cc.L, 'n'), [0x83, 0xF3, 0x55], JMP('x'), L('n'), [0x83, 0xEB, 0x03],
  L('x'), [0x83, 0xC6, 0x04], 0xC3];
const TRACE_MAIN = [L('main'), CALL('f'), [0x0F, 0xBD, 0xD3], 0x49, J(cc.NZ, 'main'), 0xC3];
CASES.push(
  { name: 'trace-callee', regs: { ecx: N }, trace: true, head: 'f', code: [JMP('main'), ...TRACE_F, ...TRACE_MAIN] },
  { name: 'trace-main', regs: { ecx: N }, trace: true, head: 'main', code: [JMP('main'), ...TRACE_F, ...TRACE_MAIN] },
  {
    // a call and its ret inside the trace (g's ret has f's call as candidate)
    name: 'trace-callchain', regs: { ecx: N }, trace: true, head: 'f',
    code: [JMP('main'), L('f'), 0x53, [0x8B, 0x1E], CALL('g'), [0x01, 0xD8], 0x5B, [0x83, 0xC6, 0x04], [0x01, 0xC3], 0xC3,
           L('g'), [0x89, 0xDA], [0xC1, 0xE2, 0x03], [0x31, 0xD0], [0x03, 0x46, 0x08], 0xC3, ...TRACE_MAIN],
  },
  { name: 'trace-logical', regs: { ecx: N }, trace: true, head: 'f', lf: 'x', lfEvery: true, code: [JMP('main'), ...TRACE_F, ...TRACE_MAIN] },
  {
    // control: a LOOP whose exit falls through into the marker block
    name: 'loop-logical', regs: { ecx: N }, head: 'top', lf: 'x',
    code: [L('top'), [0x8B, 0x16], [0x01, 0xD3], [0x83, 0xC6, 0x04], [0x81, 0xFA, ...d32(0x40000000)], J(cc.L, 'n'),
           0x49, J(cc.NZ, 'top'), 0xC3, L('n'), [0x83, 0xEB, 0x03], L('x'), [0x83, 0xF3, 0x55], 0x49, J(cc.NZ, 'top'), 0xC3],
  },
);

// ---- --aggressive-stack (07e $uc_sp_block) ----
// Each runs with the tier's aggressive stack elision on (hot and pre arms)
// against plain threaded code, and `sp` pins what the one pre-arm compile
// must count ($uop_cstat 6+i, SP_NAMES): the elision has to happen where it
// may and must not where it may not, or exactness proves nothing.
const SP_NAMES = ['pushes', 'matched', 'elided', 'plain', 'rescued', 'resc-other', 'resc-fwd-ld', 'resc-fwd-st',
  'fwd-ld', 'fwd-st', '-', 'k-unknown', 'k-ebp', 'k-partial', 'k-esp', 'k-release', 'k-callret', 'k-full',
  'unmatched', 'spills'];
const PAD = (n) => new Array(n).fill(0x90);
const AGGR_CASES = [
  {
    // rule 1, exact: reads of both open slots are forwarded from the temps
    name: 'sp-fwd-load', regs: { ecx: N }, aggr: { elided: 2, 'fwd-ld': 2, 'resc-fwd-ld': 2, 'k-unknown': 0 },
    code: [L('l'), [0x8B, 0x06], 0x50, 0x53, [0x8B, 0x54, 0x24, 0x04], [0x03, 0x14, 0x24], 0x5B, 0x58,
           [0x01, 0xD3], [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // rule 1/3, no overlap: a read and a write of locals beside the slot
    name: 'sp-nonoverlap', regs: { ecx: N }, head: 18, aggr: { elided: 1, 'resc-other': 1, 'fwd-ld': 0 },
    code: [[0x83, 0xEC, 0x08], [0xC7, 0x04, 0x24, ...d32(5)], [0xC7, 0x44, 0x24, 0x04, ...d32(7)],
           L('l'), 0x56, [0x8B, 0x54, 0x24, 0x04], [0x01, 0xCA], [0x89, 0x54, 0x24, 0x08], 0x5F, [0x03, 0x1F],
           [0x01, 0xD3], [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), [0x83, 0xC4, 0x08], 0xC3],
  },
  {
    // rule 3, exact: mov [esp], edx overwrites the pushed value in the temp,
    // the read after it and the pop both see the new value
    name: 'sp-fwd-store', regs: { ecx: N }, aggr: { elided: 1, 'fwd-st': 1, 'fwd-ld': 1 },
    code: [L('l'), [0x8B, 0x06], [0x89, 0xCA], 0x50, [0x89, 0x14, 0x24], [0x03, 0x04, 0x24], 0x5A,
           [0x31, 0xC3], [0x01, 0xD3], [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // partial overlap (movzx a byte of the slot) and a read-modify-write
    // (add [esp], ecx): both pushes materialize
    name: 'sp-partial-rmw', regs: { ecx: N }, aggr: { matched: 2, elided: 0, 'k-partial': 2 },
    code: [L('l'), [0x8B, 0x06], 0x50, [0x0F, 0xB6, 0x54, 0x24, 0x01], 0x58, [0x01, 0xD3],
           0x52, [0x01, 0x0C, 0x24], 0x5A, [0x01, 0xD3], [0x01, 0xC3],
           [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // rule 2: a load and a store through registers that could point
    // anywhere materialize the open push, and so does an escaped address
    // written through (lea edx,[esp]; mov [edx],ecx: the pop must see ecx)
    name: 'sp-unknown-escape', regs: { ecx: N }, aggr: { matched: 3, elided: 0, 'k-unknown': 3 },
    code: [L('l'), [0x8B, 0x06], 0x50, [0x03, 0x1E], 0x58, 0x50, [0x89, 0x1F], 0x5A, [0x01, 0xD3],
           0x50, [0x8D, 0x14, 0x24], [0x89, 0x0A], 0x58, [0x01, 0xC3],
           [0x83, 0xC6, 0x04], [0x83, 0xC7, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // add esp releases the top slot (no pop can take it), the one under it
    // still pairs; `mov esp, edx` (ESP written, same value) materializes the
    // open push, and its pop then has nothing to match
    name: 'sp-release-espw', regs: { ecx: N }, aggr: { elided: 1, unmatched: 1, 'k-esp': 0 },
    code: [L('l'), [0x8B, 0x06], 0x50, 0x52, [0x83, 0xC4, 0x04], 0x5A, [0x01, 0xD3],
           0x50, [0x89, 0xE2], [0x89, 0xD4], 0x58, [0x01, 0xC3],
           [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
  },
  {
    // EBP from `mov ebp, esp` in the same block: [ebp+8] (the argument) is
    // another slot, [ebp-4] is exactly `push edi`'s -- forwarded store, then
    // a forwarded read through [esp]; push ebp / pop ebp pair around it all
    name: 'sp-ebp-frame', regs: { ecx: N }, aggr: { elided: 2, 'fwd-st': 1, 'fwd-ld': 1, 'k-ebp': 0 },
    code: [L('l'), 0x56, CALL('f'), [0x83, 0xC4, 0x04], [0x01, 0xC3], [0x01, 0xFB], [0x83, 0xC6, 0x04], 0x49,
           J(cc.NZ, 'l'), 0xC3,
           L('f'), 0x55, [0x89, 0xE5], 0x57, [0x8B, 0x7D, 0x08], [0x8D, 0x04, 0x7F], [0x89, 0x45, 0xFC],
           [0x8B, 0x04, 0x24], 0x5F, 0x5D, 0xC3],
  },
  {
    // a page seam between push and pop: with the budget gone the seam's
    // stub leaves to threaded code there, which reads both slots from
    // memory -- so the stub must spill the temps first
    name: 'sp-seam-spill', regs: { ecx: N }, pages: 2, aggr: { elided: 2, 'spills@0': 4, 'spills@1': 0 },
    code: [PAD(0xFF8), L('l'), [0x8B, 0x06], 0x50, 0x53, [0x8B, 0x54, 0x24, 0x04], [0x03, 0x14, 0x24], 0x5B, 0x58,
           [0x01, 0xD3], [0x83, 0xC6, 0x04], 0x49, J(cc.NZ, 'l'), 0xC3],
    head: 0xFF8,
  },
];
// the exact tier's stack cases again, with the aggressive tier on
for (const c of CASES.filter((x) => /^(push-pop|call-|ret-)/.test(x.name))) AGGR_CASES.push({ ...c, name: c.name + '+A', aggr: {} });
CASES.push(...AGGR_CASES);

// Real code: Heroes III's clipped RLE sprite row blitter (h3demo.exe
// 0x4708a6..0x4709a2, docs/re-notes), fed random sprites. It is the first
// program whose lowering diverged in a real run, so it stays as a fuzz case.
// Frame: [esp+10] sprite (its [+44] = data base), [+18] clip-left, [+20] width,
// [+24] row-offset cursor, [+28] rows, [+2c] run colour, [+3c] pitch,
// [+40] palette (16-bit entries at +1c), [+44] dest, [+48] "skip fills".
// A run is (colour, count-1); colour == the key byte at [0x5fa1a0] means a
// literal run whose indices follow it.
const H3_EXE = path.join(ROOT, 'test/binaries/candidates/heroes-3-demo-installer/installed-extracted/Program_Files/h3demo.exe');
function h3Cases() {
  const fs = require('fs');
  if (!fs.existsSync(H3_EXE)) return [];
  const pe = require(path.join(ROOT, 'lib', 'pe.js')).readPE(H3_EXE);
  const lo = 0x4708a6, hi = 0x4709a2;
  const code = [...pe.buf.subarray(pe.va2off(lo), pe.va2off(hi))];
  code.push(0x83, 0xC4, 0x60, 0xC3);                 // add esp,0x60 ; ret
  const out = [];
  // Its palette loop alone, which LUT_RUN folds: the fold must spend the
  // guest clock the unfolded loop spends.
  for (const cnt of [2, 5, 36, 37, 38, 100]) {
    out.push({
      name: `h3-lut-${cnt}`, regs: { esi: cnt, ecx: 0 }, bytes: [...pe.buf.subarray(pe.va2off(0x470925), pe.va2off(0x47093b)), 0xC3],
      setup(mem, g2w, a) {
        const dv = new DataView(mem.buffer);
        for (let k = 0; k < 256; k++) dv.setUint16(g2w(a.buf + 0x8000 + 0x1c + 2 * k), k * 3, true);
      },
      init: (a) => ({ eax: a.buf, ebp: a.buf + 0x8000, edi: a.buf + 0x10000 }),
      foldCheck: 'loop_lut',
    });
  }
  // COPY_RUN's byte form, which MW3/MCM routes enable with --copy-superops.
  for (const cnt of [1, 5, 37, 38, 300]) {
    out.push({
      name: `copy-run-${cnt}`, regs: { ecx: cnt }, foldCheck: 'loop_copy',
      bytes: [0x8A, 0x06, 0x88, 0x07, 0x46, 0x47, 0x49, 0x75, 0xF7, 0xC3],
    });
  }
  for (let n = 0; n < (+process.env.UOP_H3_N || 12); n++) {
    let x = (n + 1) * 0x9E3779B1 >>> 0;
    const rnd = (m) => { x = (Math.imul(x ^ (x >>> 15), 0x2C1B3C6D) + 0x6D2B79F5) >>> 0; return x % m; };
    const key = 0xFF - rnd(2) * 0x7F, W = 8 + rnd(120), clip = rnd(40), rows = 4 + rnd(40);
    const skipFill = rnd(3) === 0 ? 1 : 0;
    const seed0 = x;
    out.push({
      name: `h3-rle-${n}`, regs: {}, frame: 0x60, bytes: code, mayStayCold: true, folds: true,
      setup(mem, g2w, a) {
        x = seed0;
        const dv = new DataView(mem.buffer);
        const w32 = (ga, v) => dv.setUint32(g2w(ga), v >>> 0, true);
        const B = a.buf, sprite = B + 0x100, data = B + 0x1000, pal = B + 0x8000, dst = B + 0x10000;
        mem[g2w(0x5fa1a0)] = key;
        w32(sprite + 0x44, data);
        let off = 0;
        for (let r = 0; r < rows; r++) {
          w32(B + 4 * r, off);
          for (let len = 0; len < clip + W + 1;) {
            const lit = rnd(3) === 0;
            const cnt = 1 + rnd(lit ? 12 : 30);
            let col = rnd(256); if (!lit && col === key) col ^= 1;
            mem[g2w(data + off++)] = lit ? key : col;
            mem[g2w(data + off++)] = cnt - 1;
            if (lit) for (let k = 0; k < cnt; k++) mem[g2w(data + off++)] = rnd(256);
            len += cnt;
          }
        }
        for (let k = 0; k < 256; k++) dv.setUint16(g2w(pal + 0x1c + 2 * k), Math.imul(k, 0x9E37) & 0xFFFF, true);
        const sp = a.stackTop - 0x60;
        for (let k = 0; k < 0x60; k += 4) w32(sp + k, 0);
        w32(sp + 0x10, sprite); w32(sp + 0x18, clip); w32(sp + 0x20, W); w32(sp + 0x24, B);
        w32(sp + 0x28, rows); w32(sp + 0x3c, 2 * W + 6); w32(sp + 0x40, pal);
        w32(sp + 0x44, dst); dv.setUint8(g2w(sp + 0x48), skipFill);
      },
    });
  }
  return out;
}
CASES.push(...h3Cases());

const REGS = ['eax', 'ecx', 'edx', 'ebx', 'ebp', 'esi', 'edi'];

function seed(mem, g2w, a) {
  let x = 0x1234567;
  const src = g2w(a.buf);
  for (let k = 0; k < 0x10000; k++) {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    mem[src + k] = (x >>> 16) & 0xFF;
  }
  mem[src + 2000] = 0x80 | mem[src + 2000];
  for (let k = 0; k < 1999; k++) mem[src + k] &= 0x7F;
  mem.fill(0x11, g2w(a.buf + 0x10000), g2w(a.buf + 0x10000) + 0x10000);
  const lut = g2w(a.lut);
  for (let k = 0; k < 256; k++) mem[lut + k] = (k * 7 + 3) & 0xFF;
}

function hash(mem, g2w, a) {
  let h = 0x811C9DC5;
  const s = g2w(a.buf);
  for (let k = 0; k < 0x20000; k++) h = Math.imul(h ^ mem[s + k], 16777619);
  return h >>> 0;
}

function runCase(inst, c, a, codeAddr, mode) {
  const { e, mem, g2w } = inst;
  seed(mem, g2w, a);
  if (c.poke) c.poke(mem, g2w(a.buf));
  const bytes = c.bytes || asm(typeof c.code === 'function' ? c.code(a) : c.code);
  mem.set(bytes, g2w(codeAddr));
  const labelAt = (x) => (typeof x === 'string' ? bytes.labels.get(x) : x || 0);
  // Explicit either way: trace heads are the instance default now, and a
  // loop case must keep testing the loop tier alone.
  e.set_uop_trace_heads(c.trace && mode !== 'off' ? 1 : 0);
  if (c.lf) e.set_logical_frame(codeAddr + labelAt(c.lf), 0);
  const lf0 = e.get_logical_frame_count();
  if (c.setup) c.setup(mem, g2w, a);
  const init = { eax: 0, ecx: 0, edx: 0, ebx: 0, ebp: 0, esi: a.buf, edi: a.buf + 0x10000 };
  if (c.init) Object.assign(init, c.init(a));
  for (const [k, v] of Object.entries(c.regs)) {
    init[k] = v === 'end16' ? a.buf + 2 * N : v === 'end32' ? a.buf + 4 * N : v;
  }
  if (c.name === 'lut8') init.ebx = a.lut;
  for (const r of REGS) e['set_' + r](init[r] >>> 0);
  // A known flag state on entry: a sub that sets CF.
  e.set_uop(mode === 'off' ? 0 : 1);
  if (c.aggr) e.set_aggressive_stack(mode === 'off' ? 0 : 1);
  const before = { installs: e.uop_stats(2), enters: e.uop_stats(4), blocks: e.uop_stats(5), traces: e.uop_cstat(26) };
  let sp = null;
  if (mode === 'pre') {
    const head = codeAddr + labelAt(c.head);
    const declines = WAT_REASONS.map((_, k) => k && e.uop_decline_count(k));
    const d0 = e.uop_cstat(1);
    const s0 = SP_NAMES.map((_, k) => e.uop_cstat(6 + k));
    const pc = e.uop_compile(head);
    if (!pc) {
      if (c.aggr) e.set_aggressive_stack(0);
      if (c.trace) e.set_uop_trace_heads(0);
      if (c.lf) e.set_logical_frame(0, 0);
      const why = WAT_REASONS.findIndex((_, k) => k && e.uop_decline_count(k) !== declines[k]);
      return { err: 'pre-compile declined: ' + (e.uop_cstat(1) > d0 ? WAT_REASONS[why] : 'limit') };
    }
    sp = {};
    SP_NAMES.forEach((n, k) => { sp[n] = e.uop_cstat(6 + k) - s0[k]; });
    e.uop_install(head, pc);
  }
  // Small batches, recording where each one stops: the tier must end every
  // batch on the same guest instruction as threaded code (the guest clock is
  // batches), not merely reach the same final state.
  e.set_esp(a.stackTop - (c.frame || 0));
  new DataView(e.memory.buffer).setUint32(g2w(a.stackTop), 0, true);
  e.set_eip(codeAddr);
  const stops = [];
  let ok = false;
  for (let k = 0; k < 20000; k++) {
    e.run(BATCH);
    const eip = e.get_eip() >>> 0;
    if (process.env.UOP_STOPS) console.log(mode, k, (eip - codeAddr).toString(16), 'blocks', e.get_last_run_blocks(), 'ecx', e.get_ecx());
    if (eip === 0) { ok = true; break; }
    stops.push(eip - codeAddr);
  }
  const st = {
    ok, eip: e.get_eip() >>> 0, stops: stops.join(','), nstops: stops.length, flags: e.uop_flags(), mem: hash(mem, g2w, a),
    regs: REGS.map((r) => e['get_' + r]() >>> 0),
    installs: e.uop_stats(2) - before.installs, enters: e.uop_stats(4) - before.enters,
    blocks: e.uop_stats(5) - before.blocks, sp, lf: e.get_logical_frame_count() - lf0,
    traces: e.uop_cstat(26) - before.traces,
  };
  e.set_uop(0);
  if (c.aggr) e.set_aggressive_stack(0);
  if (c.trace) e.set_uop_trace_heads(0);
  if (c.lf) e.set_logical_frame(0, 0);
  return st;
}


function callAt(inst, a, addr, regs) {
  const { e, g2w } = inst;
  for (const r of REGS) e['set_' + r]((regs[r] ?? 0) >>> 0);
  e.set_esp(a.stackTop);
  new DataView(e.memory.buffer).setUint32(g2w(a.stackTop), 0, true);
  e.set_eip(addr);
  for (let k = 0; k < 20000; k++) {
    e.run(BATCH);
    if ((e.get_eip() >>> 0) === 0) return true;
  }
  return false;
}

// Windows outlive a run (07d): a program re-entered with nothing changed keeps
// the windows its last run proved, and anything that could make one wrong in
// between re-poisons them. Here a page turns into code under a store window
// the program already proved: its next store there must leave the program and
// go through threaded code, which retires the decoded block it overwrote. A
// kept window would let the store straight through and R would still answer
// its old immediate -- as would a store window that never checked for code.
function windowCase(inst, a, nextCode) {
  const { e, mem, g2w } = inst;
  const P = nextCode(), Lc = nextCode();
  mem.set([0xB8, 0x11, 0x11, 0x11, 0x11, 0xC3], g2w(P));                 // mov eax,0x11111111 ; ret
  mem.set(asm([L('l'), [0x88, 0x07], 0x47, 0x49, J(cc.NZ, 'l'), 0xC3]), g2w(Lc)); // mov [edi],al; inc edi; dec ecx; jnz; ret
  e.set_uop(1);
  const errs = [];
  try {
    const pc = e.uop_compile(Lc);
    if (!pc) return ['store loop declined'];
    e.uop_install(Lc, pc);
    const kept0 = e.uop_stats(9), reset0 = e.uop_stats(10), enters0 = e.uop_stats(4);
    for (let i = 0; i < 8; i++) {
      if (!callAt(inst, a, Lc, { ecx: 64, edi: P + 0x800, eax: 0x40 + i })) errs.push('store loop did not return');
    }
    const kept = e.uop_stats(9) - kept0, enters = e.uop_stats(4) - enters0;
    if (!enters) errs.push('never entered');
    if (!kept) errs.push(`no entry kept its windows (enters=${enters} resets=${e.uop_stats(10) - reset0})`);
    if (mem[g2w(P + 0x800 + 63)] !== 0x47) errs.push('store loop wrote the wrong bytes');
    callAt(inst, a, P, {});
    if ((e.get_eax() >>> 0) !== 0x11111111) errs.push(`R before: eax ${(e.get_eax() >>> 0).toString(16)}`);
    const reset1 = e.uop_stats(10), enters1 = e.uop_stats(4);
    callAt(inst, a, Lc, { ecx: 4, edi: P + 1, eax: 0x22 });
    if (e.uop_stats(4) === enters1) errs.push('rewrite never entered the program');
    if (e.uop_stats(10) === reset1) errs.push('page turned to code but the windows were kept');
    callAt(inst, a, P, {});
    if ((e.get_eax() >>> 0) !== 0x22222222) errs.push(`R after rewrite: eax ${(e.get_eax() >>> 0).toString(16)} (stale decoded block)`);
    // Keep storing into that code page: every entry now exits at the head
    // having spent no block, which is pure overhead, so the program must be
    // retired as poor rather than entered forever (StarCraft's 0x4b4417).
    const poor0 = e.uop_stats(7);
    let calls = 0;
    for (; calls < 600 && e.uop_stats(7) === poor0; calls++) {
      callAt(inst, a, Lc, { ecx: 1, edi: P + 1, eax: 0x30 + (calls & 7) });
    }
    if (e.uop_stats(7) === poor0) errs.push('a program that never gets past its head was never retired');
    const enters2 = e.uop_stats(4);
    callAt(inst, a, Lc, { ecx: 1, edi: P + 1, eax: 0x33 });
    if (e.uop_stats(4) !== enters2) errs.push('retired program still entered');
    if (mem[g2w(P + 1)] !== 0x33) errs.push('threaded store after retirement lost');
    if (!errs.length) console.log(`window-keep        ok (enters=${enters} kept=${kept}, retired after ${calls} head exits)`);
  } finally {
    e.set_uop(0);
  }
  return errs;
}

// The code-write filter in front of $uop_code_write (07d). A store to a page
// that has held code reaches the uop tier; the filter must let through every
// store that overlaps a live program's bytes (kill) and may skip the rest.
// uop_stats: 3 kills, 11 filter skips, 12 scans, 13 rebuilds.
function codeWriteCase(inst, a, nextCode) {
  const { e, mem, g2w } = inst;
  const C = nextCode(), W = nextCode(), Lc = nextCode(), Lk = nextCode();
  mem.set([0xC3], g2w(C));                                                  // ret: makes C a code page
  mem.set([0x88, 0x07, 0xC3], g2w(W));                                      // mov [edi],al ; ret
  const loop = asm([L('l'), [0x88, 0x07], 0x47, 0x49, J(cc.NZ, 'l'), 0xC3]);
  mem.set(loop, g2w(Lc));
  mem.set(loop, g2w(Lk));
  const errs = [];
  const st = (k) => e.uop_stats(k) >>> 0;
  const store = (addr) => {
    // Store the byte already there, so program bytes never actually change.
    if (!callAt(inst, a, W, { edi: addr, eax: mem[g2w(addr)] })) errs.push(`store to ${addr.toString(16)} did not return`);
  };
  e.set_uop(1);
  try {
    callAt(inst, a, C, {});
    const pc = e.uop_compile(Lc);
    if (!pc) return ['store loop declined'];
    e.uop_install(Lc, pc);
    // A second program that stays live throughout: with no ranges at all the
    // tier is not consulted, and steps 4-5 need it consulted.
    const pk = e.uop_compile(Lk);
    if (!pk) return ['second store loop declined'];
    e.uop_install(Lk, pk);
    // 1. A code page no program was lowered from: skipped, no scan.
    let s0 = st(11), n0 = st(12), k0 = st(3);
    store(C + 0x800);
    if (st(11) === s0) errs.push('store to a program-free code page was not skipped');
    if (st(12) !== n0) errs.push('store to a program-free code page was scanned');
    // 2. The program's own page, a line it does not cover: skipped too.
    s0 = st(11); n0 = st(12);
    store(Lc + 0x800);
    if (st(11) === s0 || st(12) !== n0) errs.push('store to an uncovered line of the program page was not skipped');
    if (st(3) !== k0) errs.push('an uncovered store killed the program');
    // 3. A byte of the program: scanned, and the program dies.
    n0 = st(12);
    store(Lc + 1);
    if (st(12) === n0) errs.push('store into the program was not scanned');
    if (st(3) !== k0 + 1) errs.push(`store into the program did not kill it (kills ${st(3) - k0})`);
    // 4. Its bits are stale now: the next store there scans, finds nothing,
    //    rebuilds; the one after that is skipped.
    const r0 = st(13);
    store(Lc + 2);
    if (st(13) !== r0 + 1) errs.push('stale filter was not rebuilt after a false hit');
    s0 = st(11);
    store(Lc + 2);
    if (st(11) === s0) errs.push('rebuilt filter still holds the dead program');
    // 5. A reinstall is caught again.
    const pc2 = e.uop_compile(Lc);
    if (!pc2) errs.push('recompile declined');
    else {
      e.uop_install(Lc, pc2);
      k0 = st(3);
      store(Lc + 3);
      if (st(3) !== k0 + 1) errs.push('reinstalled program not killed by a store into it');
    }
    if (!errs.length) console.log(`code-write-gate    ok (skipped=${st(11)} scans=${st(12)} rebuilds=${st(13)})`);
  } finally {
    e.set_uop(0);
  }
  return errs;
}

// A re-guard widens its window to the 64KB-aligned block around the missing
// page ($uop_reguard_wide, 07d) while the backing stays affine and, for a
// store window, no page holds code. Two properties: a store sweep that walks
// from a data page into an adjacent code page of the same block must still
// leave the program at that page and retire the decoded block it overwrote
// (the widened window must stop short of the code page), and a pure data
// sweep must prove far fewer windows than the one-page re-guard
// (--uop-reguard-span=4096) while ending in the same state.
// uop_stats: 1 reguards, 4 enters, 14 pages the widening added.
function reguardWidenCase(inst, a, nextCode) {
  const { e, mem, g2w } = inst;
  const loop = asm([L('l'), [0x88, 0x07], 0x47, 0x49, J(cc.NZ, 'l'), 0xC3]); // mov [edi],al; inc edi; dec ecx; jnz; ret
  const errs = [];
  const st = (k) => e.uop_stats(k) >>> 0;
  const install = (Lc) => {
    const pc = e.uop_compile(Lc);
    if (!pc) { errs.push('store loop declined'); return false; }
    e.uop_install(Lc, pc);
    return true;
  };
  const arm = (span) => {
    // Fresh pages per arm: the previous arm left its code page rewritten.
    let D = nextCode(), P = nextCode();
    while ((D >>> 16) !== (P >>> 16)) { D = P; P = nextCode(); }
    const Lc = nextCode();
    mem.set(loop, g2w(Lc));
    e.set_uop_reguard_span(span);
    e.set_uop(1);
    if (!install(Lc)) return null;
    // 1. A pure data sweep over 16 pages of the buffer, four times.
    mem.fill(0, g2w(a.buf), g2w(a.buf) + 0x10000);
    const rg0 = st(1), wp0 = st(14), en1 = st(4);
    for (let i = 0; i < 4; i++) {
      if (!callAt(inst, a, Lc, { ecx: 0x10000, edi: a.buf, eax: 0x40 + i })) errs.push(`span ${span}: data sweep did not return`);
    }
    if (st(4) === en1) errs.push(`span ${span}: data sweep never entered`);
    let h = 0x811C9DC5;
    for (let k = 0; k < 0x10000; k++) h = Math.imul(h ^ mem[g2w(a.buf) + k], 16777619);
    const out = { reguards: st(1) - rg0, widened: st(14) - wp0, hash: h >>> 0 };
    // 2. From a data page into the code page after it, same 64KB block.
    mem.set([0xB8, 0x11, 0x11, 0x11, 0x11, 0xC3], g2w(P + 0x800));           // mov eax,0x11111111 ; ret
    callAt(inst, a, P + 0x800, {});
    if ((e.get_eax() >>> 0) !== 0x11111111) errs.push(`span ${span}: R before: eax ${(e.get_eax() >>> 0).toString(16)}`);
    const en0 = st(4);
    if (!callAt(inst, a, Lc, { ecx: 0x1005, edi: D + 0x800, eax: 0xB8 })) errs.push(`span ${span}: sweep into code did not return`);
    if (st(4) === en0) errs.push(`span ${span}: sweep into code never entered`);
    callAt(inst, a, P + 0x800, {});
    if ((e.get_eax() >>> 0) !== 0xB8B8B8B8) errs.push(`span ${span}: R after sweep: eax ${(e.get_eax() >>> 0).toString(16)} (stale decoded block)`);
    e.set_uop(0);
    return out;
  };
  try {
    const narrow = arm(0x1000);
    const wide = arm(0x10000);
    if (narrow && wide) {
      if (narrow.hash !== wide.hash) errs.push('data sweep: wide and narrow re-guards left different memory');
      if (narrow.widened) errs.push(`one-page re-guard widened ${narrow.widened} pages`);
      if (!wide.widened) errs.push('wide re-guard never widened');
      if (!(wide.reguards * 4 <= narrow.reguards)) errs.push(`wide re-guards ${wide.reguards} not well under narrow ${narrow.reguards}`);
      if (!errs.length) console.log(`reguard-widen      ok (data sweep re-guards: ${narrow.reguards} one-page, ${wide.reguards} widened, +${wide.widened} pages; code page still exits)`);
    }
  } finally {
    e.set_uop(0);
    e.set_uop_reguard_span(0x10000);
  }
  return errs;
}

// --handler-hist must measure the program with the tier running; --trace-eip
// (and --break/--watch/--count) must still hold it off, since they observe
// every block. 13-exports.wat $dbg_recompute: $dbg_tier_guard.
function histCase(inst, a, nextCode) {
  const c = CASES.find((x) => x.name === 'lut8');
  const errs = [];
  const off = runCase(inst, c, a, nextCode(), 'off');
  inst.e.set_handler_hist_enabled(1);
  try {
    const on = runCase(inst, c, a, nextCode(), 'hot');
    if (!on.enters) errs.push('handler histogram held the tier off');
    if (on.mem !== off.mem || JSON.stringify(on.regs) !== JSON.stringify(off.regs)) errs.push('tier under histogram diverged');
    inst.e.set_trace_eip_range(1, 0xFFFFFFF0, 0xFFFFFFFF);
    const tr = runCase(inst, c, a, nextCode(), 'hot');
    if (tr.enters) errs.push(`tier entered with --trace-eip armed (enters=${tr.enters})`);
    inst.e.set_trace_eip_range(0, 0, 0);
    if (!errs.length) console.log(`hist-keeps-tier    ok (enters=${on.enters} under --handler-hist, 0 under --trace-eip)`);
  } finally {
    inst.e.set_trace_eip_range(0, 0, 0);
    inst.e.set_handler_hist_enabled(0);
  }
  return errs;
}

// A loop whose head the tier declines (rdtsc is not lowered): the verdict
// settles, the page index marks the head no-bump (01-header PAGE_INDEX_NOBUMP),
// and later transfers into it skip the hot bump -- counted by
// get_uop_nobump_skips. With set_uop_nobump(0) nothing is marked, and both
// runs end in the same state as the tier off.
function nobumpCase(inst, a, nextCode) {
  const { e } = inst;
  const c = { name: 'nobump', regs: { ecx: 4096 },
    code: [L('l'), [0x0F, 0x31], 0x49, J(cc.NZ, 'l'), 0xC3] };
  const errs = [];
  const off = runCase(inst, c, a, nextCode(), 'off');
  const d0 = e.uop_cstat(1), s0 = e.get_uop_nobump_skips() >>> 0;
  const on = runCase(inst, c, a, nextCode(), 'hot');
  const skips = (e.get_uop_nobump_skips() >>> 0) - s0;
  if (e.uop_cstat(1) === d0) errs.push('head was not declined');
  if (skips < 1000) errs.push(`only ${skips} transfers skipped the bump`);
  e.set_uop_nobump(0);
  try {
    const s1 = e.get_uop_nobump_skips() >>> 0;
    const plain = runCase(inst, c, a, nextCode(), 'hot');
    if ((e.get_uop_nobump_skips() >>> 0) !== s1) errs.push('skips counted with the mark off');
    for (const [name, st] of [['on', on], ['mark off', plain]]) {
      if (!st.ok || st.regs[1] !== off.regs[1] || st.mem !== off.mem) errs.push(`${name} diverged from threaded`);
    }
  } finally {
    e.set_uop_nobump(1);
  }
  if (!errs.length) console.log(`nobump-mark        ok (${skips} of 4096 back edges skipped the bump)`);
  return errs;
}

// 07e-uop-compiler.wat's decline reasons, by code ($uop_decline_count).
const WAT_REASONS = [null, 'scan-limit', 'overlap', 'head-unsupported', 'no-backedge', 'loop-too-big',
  'seam-ambiguous', 'long-block', 'unreached-block', 'demand-no-fixpoint', 'branch-mid-block',
  'dead-flags-consumed', 'dead-cf', 'cf-no-recipe', 'cf-kind', 'dead-flags-rec', 'rec-no-recipe', 'rec-kind',
  'dead-flags-jcc', 'kind', 'too-many-windows', 'label', 'arg', 'too-many-temps', 'program-too-big',
  'ranges-full', 'scratch-overflow'];

async function main() {
  bench.ensureBuilt();
  const inst = await bench.newInstance();
  const { e } = inst;
  const a = bench.layout(inst.imageBase, 0x20000);
  if (process.env.UOP_NOFOLD) for (const f of process.env.UOP_NOFOLD.split(",")) e["set_" + f + "_emit"](0);
  let slot = 0;
  let fails = 0;
  const only = process.env.UOP_CASE;
  const clocks = process.env.UOP_CLOCK ? [+process.env.UOP_CLOCK] : [0, 1];
  for (const clock of clocks) {
  e.set_branch_clock(clock);
  console.log(clock ? '-- branch clock (a block = an executed x86 branch)' : '-- block clock (threaded cuts charge)');
  for (const c of CASES) {
    if (only && c.name !== only) continue;
    const at = () => { const x = a.code + 0x1000 * slot; slot += c.pages || 1; return x; };
    const off = runCase(inst, c, a, at(), 'off');
    if (c.foldCheck) {
      // Threaded code with and without the loop fold: same state, same clock.
      // `off` above ran with the family's default; run both explicitly.
      const set = (v) => e[`set_${c.foldCheck}_emit`](v);
      const dflt = c.foldCheck === 'loop_lut' ? 1 : 0;
      set(1);
      const m0 = e.get_loop_matched_blocks();
      const fo = runCase(inst, c, a, a.code + 0x1000 * slot++, 'off');
      set(0);
      const nf = runCase(inst, c, a, a.code + 0x1000 * slot++, 'off');
      set(dflt);
      if (e.get_loop_matched_blocks() === m0) { fails++; console.log(`${c.name.padEnd(18)} FAIL: the loop was never folded`); continue; }
      const bad = [...(clock ? ['stops'] : []), 'mem', 'eip', 'flags'].filter((k) => nf[k] !== fo[k]);
      if (JSON.stringify(nf.regs) !== JSON.stringify(fo.regs)) bad.push('regs');
      if (bad.length) fails++;
      console.log(`${c.name.padEnd(18)} fold vs unfolded: ${bad.length ? 'FAIL ' + bad.join(',') + ` (${fo.stops} vs ${nf.stops})` : 'ok'}`);
      continue;
    }
    const results = [];
    for (const mode of ['hot', 'pre']) {
      const st = runCase(inst, c, a, at(), mode);
      if (st.err && c.declines) { results.push(`${mode}: ok (${st.err})`); continue; }
      if (st.err) { results.push(`${mode}: ${st.err}`); fails++; continue; }
      if (c.declines && st.enters) { results.push(`${mode}: FAIL entered a case that must decline`); fails++; continue; }
      const diffs = [];
      if (st.sp && c.aggr) {
        for (const [kk, v] of Object.entries(c.aggr)) { const [k, ck] = kk.split('@'); if (ck !== undefined && +ck !== clock) continue; if (st.sp[k] !== v) diffs.push(`${k}=${st.sp[k]} want ${v}`); }
        if (process.env.UOP_SP) console.log(c.name, JSON.stringify(st.sp));
      }
      if (!st.ok) diffs.push('did not return');
      if (c.trace && !st.traces) diffs.push('no trace was formed');
      if (c.lf && (st.lf !== off.lf || !off.lf || (c.lfEvery && off.lf !== N))) diffs.push(`logical frames ${st.lf} vs ${off.lf}`);
      if (st.eip !== off.eip) diffs.push(`eip ${st.eip.toString(16)} vs ${off.eip.toString(16)}`);
      if (st.flags !== off.flags) diffs.push(`flags ${st.flags.toString(2)} vs ${off.flags.toString(2)}`);
      if (st.mem !== off.mem) diffs.push('memory differs');
      // Batch stops. Under the block clock the program charges the cuts
      // threaded code makes once it has split at every in-loop entry (steady
      // state); "pre" installs before threaded code has taken every path, so
      // during warmup threaded runs unsplit blocks and the stops legitimately
      // differ there. A case with a loop threaded code FOLDS is one block per
      // fold run on the block clock, which a program charging trips cannot
      // match. The branch clock has no history, so both must match.
      if (((mode === 'hot' && !c.folds && !c.dynamicEntry) || clock) && st.stops !== off.stops) {
        const x = st.stops.split(','), y = off.stops.split(',');
        let k = 0; while (k < x.length && x[k] === y[k]) k++;
        diffs.push(`batch ${k} stops at +0x${(+x[k]).toString(16)} vs +0x${(+y[k]).toString(16)} (${st.nstops} vs ${off.nstops} batches)`);
      }
      REGS.forEach((r, k) => { if (st.regs[k] !== off.regs[k]) diffs.push(`${r} ${st.regs[k].toString(16)} vs ${off.regs[k].toString(16)}`); });
      if (!st.enters && !c.declines && !(c.mayStayCold && mode === 'hot')) diffs.push('never entered');
      if (diffs.length) fails++;
      results.push(`${mode}: ${diffs.length ? 'FAIL ' + diffs.join(', ') : 'ok'} (enters=${st.enters} blocks=${st.blocks})`);
    }
    console.log(`${c.name.padEnd(18)} ${results.join(' | ')}`);
  }
  }
  e.set_branch_clock(0);
  if (!only || only === 'window-keep') {
    const errs = windowCase(inst, a, () => a.code + 0x1000 * slot++);
    if (errs.length) { fails++; console.log(`window-keep        FAIL ${errs.join(', ')}`); }
  }
  if (!only || only === 'code-write-gate') {
    const errs = codeWriteCase(inst, a, () => a.code + 0x1000 * slot++);
    if (errs.length) { fails++; console.log(`code-write-gate    FAIL ${errs.join(', ')}`); }
  }
  if (!only || only === 'reguard-widen') {
    const errs = reguardWidenCase(inst, a, () => a.code + 0x1000 * slot++);
    if (errs.length) { fails++; console.log(`reguard-widen      FAIL ${errs.join(', ')}`); }
  }
  if (!only || only === 'hist-keeps-tier') {
    const errs = histCase(inst, a, () => a.code + 0x1000 * slot++);
    if (errs.length) { fails++; console.log(`hist-keeps-tier    FAIL ${errs.join(', ')}`); }
  }
  if (!only || only === 'nobump-mark') {
    const errs = nobumpCase(inst, a, () => a.code + 0x1000 * slot++);
    if (errs.length) { fails++; console.log(`nobump-mark        FAIL ${errs.join(', ')}`); }
  }
  const cs = (k) => e.uop_cstat(k);
  const why = WAT_REASONS.map((n, k) => [n, k && e.uop_decline_count(k)]).filter(([, n]) => n).map(([k, n]) => `${k}=${n}`).join(' ');
  console.log(`uop compiler: compiled=${cs(0)} declined=${cs(1)} insns=${cs(2)} uops=${cs(3)} flushes=${cs(4)}${why ? '\n  declines: ' + why : ''}`);
  console.log(`reguards=${e.uop_stats(1)} guard-fails=${e.uop_stats(0)} kills=${e.uop_stats(3)}`);
  if (fails) { console.log(`FAIL: ${fails}`); process.exit(1); }
  console.log('PASS');
}

main().catch((err) => { console.error(err.stack || String(err)); process.exit(1); });
