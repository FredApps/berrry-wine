'use strict';

// WebAssembly engines for micro-op programs (tools/toyvm/uop-opt.js).
//
// One lowering, several executions. A program's blocks are lowered to ENGINE
// OPS -- a fixed, closed set (EOPS below), each with its WAT body written once
// against four accessors: V(k) reads the vreg named by operand k, I(k) is
// operand k as an immediate, SET(k, e) writes vreg operand k, GOTO(k) moves
// control to the block named by operand k. Each engine only supplies those
// accessors:
//
//   E1        one function, a br_table dispatch loop over an encoded code
//             array; vregs live in memory and every operand is a load.
//   straight  the upper bound, NOT an engine: the same op bodies emitted per
//             program as one wasm function with every vreg a local, blocks as
//             a loop + br_table. It is what the µop program is worth with no
//             interpretation at all, and it is only ever built by the bench.
//
// No wasm is generated at runtime for the engines: E1's module depends on the
// op table alone, and a program is DATA written into memory.
//
// Ops outside the set (the lazy flag record and its readers, full-semantics
// memory, the variable-count shift helper) are cold by construction -- they
// live in the slow half and in deopt stubs -- so a block holding one is
// lowered to BAIL, and the JS reference interpreter (uop-ref.js) runs from
// that block until it reaches a native one again. The flags cross that edge
// as the materialized word, which is all the engine ever keeps: every native
// flag op is a forwarded bit (flagof), a bit of the word (getf) or a write of
// bits into it (wflags).
//
// Memory: the vm's memory is imported, and the engine's own data -- vreg file,
// out slots, code -- goes in the tail page past isa.DEC_END, which nothing
// else uses.
//
// Two vreg files. A RESIDENT program's (uop-opt.js finalize) starts at
// isa.REGFILE_BASE, so its guest vregs 0..13 are L1's registers and segment
// bases themselves and its temps run on past DEC_END; every other program's
// sits after that, clear of the registers.

const path = require('path');
const isa = require('./isa');
const { FBIT } = require('./uop-ir');
const { runRef, scribbles } = require('./uop-ref');
const { NREG, SEGV, FIRST_TEMP } = require('./uop-ir');
const { compileWat } = require(path.join(__dirname, '..', '..', 'lib', 'compile-wat.js'));

const TOP = isa.MEM_PAGES << 16;
const MAXV = 2048;
const VFILE = isa.REGFILE_BASE;              // resident vreg file
if (isa.REGFILE_SEGB !== VFILE + 4 * SEGV || SEGV !== NREG || FIRST_TEMP !== SEGV + 6) {
  throw new Error('uop-wasm: register file is not the guest-vreg prefix');
}
const VBASE = (VFILE + 4 * MAXV + 15) & ~15; // everyone else's
const OUT = VBASE + 4 * MAXV;                // steps, flags, ip / block id
const KMAX = 16;
const SLOTHOME = OUT + 16;                   // per local slot: the vreg address it stands for
const CALLSAVE = SLOTHOME + 4 * KMAX;         // loop-carried locals across a host call (callSafe)
const CODE = CALLSAVE + 4 * (8 + KMAX);
const CODE_END = CODE + 0x40000;             // the one-program page (makeEnter, e1Enter)
// The live arena (E1Arena): many resident programs at once. LASTP is the id
// of the program a chained run is in, written by `link` as it takes a chain.
const LASTP = CODE_END;
// 1 when the run ended at a straight-line exit (`exitl`/`linkl`): the middle
// of an L1 block, where L1 tests no budget.
const LINEX = LASTP + 4;
const ARENA = CODE_END + 16;
const ARENA_END = TOP;

const CCS = ['nz', 'z', 'eq', 'ne', 'ltu', 'leu', 'gtu', 'geu', 'lt', 'le', 'gt', 'ge', 's', 'ns', 'p', 'np'];
// Condition cc on operands a, b already shifted left by 32-w: an unsigned or
// signed compare of the shifted words is the compare of the low w bits.
function condWat(cc, a, b, sh) {
  const A = `(i32.shl ${a} ${sh})`, Bx = `(i32.shl ${b} ${sh})`;
  const par = `(i32.eqz (i32.and (i32.popcnt (i32.and ${a} (i32.const 255))) (i32.const 1)))`;
  switch (cc) {
    case 'nz': return `(i32.ne ${A} (i32.const 0))`;
    case 'z': return `(i32.eqz ${A})`;
    case 'eq': return `(i32.eqz (i32.shl (i32.xor ${a} ${b}) ${sh}))`;
    case 'ne': return `(i32.ne (i32.shl (i32.xor ${a} ${b}) ${sh}) (i32.const 0))`;
    case 'ltu': return `(i32.lt_u ${A} ${Bx})`;
    case 'leu': return `(i32.le_u ${A} ${Bx})`;
    case 'gtu': return `(i32.gt_u ${A} ${Bx})`;
    case 'geu': return `(i32.ge_u ${A} ${Bx})`;
    case 'lt': return `(i32.lt_s ${A} ${Bx})`;
    case 'le': return `(i32.le_s ${A} ${Bx})`;
    case 'gt': return `(i32.gt_s ${A} ${Bx})`;
    case 'ge': return `(i32.ge_s ${A} ${Bx})`;
    case 's': return `(i32.lt_s ${A} (i32.const 0))`;
    case 'ns': return `(i32.ge_s ${A} (i32.const 0))`;
    case 'p': return par;
    case 'np': return `(i32.eqz ${par})`;
    default: throw new Error(`cc ${cc}`);
  }
}

// Operand kinds: 'v' vreg, 'i' immediate, 't' block target.
// Bodies see: V(k), I(k), SET(k, e), GOTO(k), and the engine locals
// $steps $F $lm $vk $spm $shm $smc and scratch $x $y $l.
const EOPS = [];
const def = (name, ops, body) => EOPS.push({ name, ops, body });
const bin = (name, wop) => def(name, 'vvv', ({ V, SET }) => SET(0, `(${wop} ${V(1)} ${V(2)})`));
const imm = (name, wop) => def(name, 'vvi', ({ V, I, SET }) => SET(0, `(${wop} ${V(1)} ${I(2)})`));

def('movi', 'vi', ({ I, SET }) => SET(0, I(1)));
// A tier-up counter: one word in the program's arena space, bumped at every
// loop header (the fast head included), so it counts entries and iterations.
def('cnt', 'i', ({ I }) => `(i32.store ${I(0)} (i32.add (i32.load ${I(0)}) (i32.const 1)))`);
def('mov', 'vv', ({ V, SET }) => SET(0, V(1)));
bin('add', 'i32.add'); bin('sub', 'i32.sub'); bin('and', 'i32.and'); bin('or', 'i32.or');
bin('xor', 'i32.xor'); bin('mul', 'i32.mul');
// The upper half of a 32x32 product, and CF/OF of a two-operand IMUL.
def('mulhu', 'vvv', ({ V, SET }) => SET(0,
  `(i32.wrap_i64 (i64.shr_u (i64.mul (i64.extend_i32_u ${V(1)}) (i64.extend_i32_u ${V(2)})) (i64.const 32)))`));
def('mulhs', 'vvv', ({ V, SET }) => SET(0,
  `(i32.wrap_i64 (i64.shr_s (i64.mul (i64.extend_i32_s ${V(1)}) (i64.extend_i32_s ${V(2)})) (i64.const 32)))`));
def('imulov', 'vvv', ({ V, SET }) => `(local.set $q (i64.mul (i64.extend_i32_s ${V(1)}) (i64.extend_i32_s ${V(2)})))`
  + SET(0, '(i64.ne (i64.extend_i32_s (i32.wrap_i64 (local.get $q))) (local.get $q))'));
// DIV/IDIV of the dividend hi:lo (operands 0, 1) by operand 2. DCHK takes its
// target where L1 faults: a zero divisor, or a quotient that does not survive
// a round trip through the width (operand 3 is 64 - w). A signed divide by -1
// is a negation, so the one i64.div_s that traps (INT64_MIN / -1) never runs.
{
  const N = (V) => `(i64.or (i64.shl (i64.extend_i32_u ${V(0)}) (i64.const 32)) (i64.extend_i32_u ${V(1)}))`;
  const fits = (sh, sr) => `(i64.eq (${sr} (i64.shl (local.get $q) ${sh}) ${sh}) (local.get $q))`;
  def('dchku', 'vvvit', ({ V, I, GOTO }) => `(if (i32.eqz ${V(2)}) (then ${GOTO(4)}))`
    + `(local.set $q (i64.div_u ${N(V)} (i64.extend_i32_u ${V(2)})))`
    + `(if (i32.eqz ${fits(`(i64.extend_i32_u ${I(3)})`, 'i64.shr_u')}) (then ${GOTO(4)}))`);
  def('dchks', 'vvvit', ({ V, I, GOTO }) => `(if (i32.eqz ${V(2)}) (then ${GOTO(4)}))`
    + `(local.set $q (if (result i64) (i32.eq ${V(2)} (i32.const -1)) (then (i64.sub (i64.const 0) ${N(V)}))`
    + ` (else (i64.div_s ${N(V)} (i64.extend_i32_s ${V(2)})))))`
    + `(if (i32.eqz ${fits(`(i64.extend_i32_u ${I(3)})`, 'i64.shr_s')}) (then ${GOTO(4)}))`);
  // divq/divr: d hi lo divisor
  const N1 = (V) => N((k) => V(k + 1));
  def('divqu', 'vvvv', ({ V, SET }) => SET(0, `(i32.wrap_i64 (i64.div_u ${N1(V)} (i64.extend_i32_u ${V(3)})))`));
  def('divqs', 'vvvv', ({ V, SET }) => SET(0, `(i32.wrap_i64 (i64.div_s ${N1(V)} (i64.extend_i32_s ${V(3)})))`));
  def('divru', 'vvvv', ({ V, SET }) => SET(0, `(i32.wrap_i64 (i64.rem_u ${N1(V)} (i64.extend_i32_u ${V(3)})))`));
  def('divrs', 'vvvv', ({ V, SET }) => SET(0, `(i32.wrap_i64 (i64.rem_s ${N1(V)} (i64.extend_i32_s ${V(3)})))`));
}
def('eq', 'vvv', ({ V, SET }) => SET(0, `(i32.eq ${V(1)} ${V(2)})`));
def('ne', 'vvv', ({ V, SET }) => SET(0, `(i32.ne ${V(1)} ${V(2)})`));
imm('addi', 'i32.add'); imm('andi', 'i32.and'); imm('ori', 'i32.or'); imm('xori', 'i32.xor');
imm('shli', 'i32.shl'); imm('shri', 'i32.shr_u'); imm('sari', 'i32.shr_s');
// Narrow arithmetic with its mask (fuseMasks): a 16-bit ADD/SUB/INC or an SP
// adjust lowers naively to the sum and then an ANDI or AND with the SP mask.
def('addm', 'vvvi', ({ V, I, SET }) => SET(0, `(i32.and (i32.add ${V(1)} ${V(2)}) ${I(3)})`));
def('subm', 'vvvi', ({ V, I, SET }) => SET(0, `(i32.and (i32.sub ${V(1)} ${V(2)}) ${I(3)})`));
def('addim', 'vvii', ({ V, I, SET }) => SET(0, `(i32.and (i32.add ${V(1)} ${I(2)}) ${I(3)})`));
def('andspm', 'vv', ({ V, SET }) => SET(0, `(i32.and ${V(1)} (local.get $spm))`));
def('addispm', 'vvi', ({ V, I, SET }) => SET(0, `(i32.and (i32.add ${V(1)} ${I(2)}) (local.get $spm))`));
def('addi16', 'vvi', ({ V, I, SET }) => SET(0, `(i32.and (i32.add ${V(1)} ${I(2)}) (i32.const 65535))`));
def('addi8', 'vvi', ({ V, I, SET }) => SET(0, `(i32.and (i32.add ${V(1)} ${I(2)}) (i32.const 255))`));
def('sx8', 'vv', ({ V, SET }) => SET(0, `(i32.extend8_s ${V(1)})`));
def('sx16', 'vv', ({ V, SET }) => SET(0, `(i32.extend16_s ${V(1)})`));
def('merge16', 'vvv', ({ V, SET }) => SET(0,
  `(i32.or (i32.and ${V(1)} (i32.const -65536)) (i32.and ${V(2)} (i32.const 65535)))`));
def('merge8l', 'vvv', ({ V, SET }) => SET(0,
  `(i32.or (i32.and ${V(1)} (i32.const -256)) (i32.and ${V(2)} (i32.const 255)))`));
def('merge8h', 'vvv', ({ V, SET }) => SET(0,
  `(i32.or (i32.and ${V(1)} (i32.const -65281)) (i32.shl (i32.and ${V(2)} (i32.const 255)) (i32.const 8)))`));
def('ext8h', 'vv', ({ V, SET }) => SET(0, `(i32.and (i32.shr_u ${V(1)} (i32.const 8)) (i32.const 255))`));
for (const cc of CCS) {
  def(`cc_${cc}`, 'vvvi', ({ V, I, SET }) => SET(0, condWat(cc, V(1), V(2), I(3))));
}
// Constant shifts, count already normalized by the lowering.
def('shlw', 'vvii', ({ V, I, SET }) => SET(0, `(i32.and (i32.shl ${V(1)} ${I(2)}) ${I(3)})`));
def('shrw', 'vvii', ({ V, I, SET }) => SET(0, `(i32.shr_u (i32.and ${V(1)} ${I(3)}) ${I(2)})`));
def('sarw', 'vviii', ({ V, I, SET }) => SET(0,
  `(i32.and (i32.shr_s (i32.shr_s (i32.shl ${V(1)} ${I(4)}) ${I(4)}) ${I(2)}) ${I(3)})`));
// rotate left by k within a w-bit field: operands k, w-k, mask
def('rolw', 'vviii', ({ V, I, SET }) => `(local.set $x (i32.and ${V(1)} ${I(4)}))`
  + SET(0, `(i32.and (i32.or (i32.shl (local.get $x) ${I(2)}) (i32.shr_u (local.get $x) ${I(3)})) ${I(4)})`));
// A shift by a count only known at run time (x86 SHL/SHR/SAR/ROL/ROR r/m, CL
// or an immediate without the guards pass): CALLH, uop-ref.js shiftHelper in
// closed form. The count is masked by the machine's $shm here, so no guard is
// needed; a masked count of 0 leaves the value and every flag alone.
// Otherwise CF and OF are written, and SF/ZF/PF too unless it rotates.
// $x the w-bit operand, $l the count, $y the result, $z CF.
for (const sh of ['shl', 'shr', 'sar', 'rol', 'ror']) {
  for (const w of [8, 16, 32]) {
    const m = w === 32 ? -1 : (1 << w) - 1;
    const c = (k) => `(i32.const ${k})`;
    const X = '(local.get $x)', L = '(local.get $l)', Y = '(local.get $y)', Z = '(local.get $z)';
    const bitOf = (v, k) => `(i32.and (i32.shr_u ${v} ${k}) ${c(1)})`;
    const msb = (v) => bitOf(v, c(w - 1));
    const sx = `(i32.shr_s (i32.shl ${X} ${c(32 - w)}) ${c(32 - w)})`;
    const min31 = (e) => `(select ${c(31)} ${e} (i32.gt_u ${e} ${c(31)}))`;
    const r = `(i32.and ${L} ${c(w - 1)})`;
    let val, cf, of;
    switch (sh) {
      case 'shl':
        val = `(select ${c(0)} (i32.and (i32.shl ${X} ${L}) ${c(m)}) (i32.ge_u ${L} ${c(w)}))`;
        cf = `(select ${c(0)} ${bitOf(X, `(i32.sub ${c(w)} ${L})`)} (i32.gt_u ${L} ${c(w)}))`;
        of = `(i32.xor ${Z} ${msb(Y)})`;
        break;
      case 'shr':
        val = `(select ${c(0)} (i32.shr_u ${X} ${L}) (i32.ge_u ${L} ${c(w)}))`;
        cf = `(select ${c(0)} ${bitOf(X, `(i32.sub ${L} ${c(1)})`)} (i32.gt_u ${L} ${c(w)}))`;
        of = msb(X);
        break;
      case 'sar':
        val = `(i32.and (i32.shr_s ${sx} ${min31(L)}) ${c(m)})`;
        cf = `(i32.and (i32.shr_s ${sx} ${min31(`(i32.sub ${L} ${c(1)})`)}) ${c(1)})`;
        of = c(0);
        break;
      case 'rol':
        val = `(i32.and (i32.or (i32.shl ${X} ${r}) (i32.shr_u ${X} (i32.sub ${c(w)} ${r}))) ${c(m)})`;
        if (w < 32) val = `(select ${X} ${val} (i32.eqz ${r}))`;
        cf = `(i32.and ${Y} ${c(1)})`;
        of = `(i32.xor ${Z} ${msb(Y)})`;
        break;
      case 'ror':
        val = `(i32.and (i32.or (i32.shr_u ${X} ${r}) (i32.shl ${X} (i32.sub ${c(w)} ${r}))) ${c(m)})`;
        if (w < 32) val = `(select ${X} ${val} (i32.eqz ${r}))`;
        cf = msb(Y);
        of = `(i32.xor ${msb(Y)} ${bitOf(Y, c(w - 2))})`;
        break;
    }
    const rotate = sh === 'rol' || sh === 'ror';
    const clear = (1 << FBIT.c) | (1 << FBIT.o) | (rotate ? 0 : (1 << FBIT.s) | (1 << FBIT.z) | (1 << FBIT.p));
    const szp = rotate ? c(0) : `(i32.or (i32.or (i32.shl ${msb(Y)} ${c(FBIT.s)}) (i32.shl (i32.eqz ${Y}) ${c(FBIT.z)}))`
      + ` (i32.shl (i32.eqz (i32.and (i32.popcnt (i32.and ${Y} ${c(255)})) ${c(1)})) ${c(FBIT.p)}))`;
    def(`shv_${sh}${w}`, 'vvv', ({ V, SET }) => `(local.set $x (i32.and ${V(1)} ${c(m)}))`
      + `(local.set $l (i32.and ${V(2)} (local.get $shm)))`
      + `(if (i32.eqz ${L}) (then (local.set $y ${V(1)})) (else`
      + ` (local.set $y ${val}) (local.set $z ${cf})`
      + ` (local.set $F (i32.or (i32.and (local.get $F) ${c(~clear)})`
      + ` (i32.or (i32.or ${Z} (i32.shl ${of} ${c(FBIT.o)})) ${szp})))))`
      + SET(0, Y));
  }
}
// RCL/RCR: through the carry, a bit at a time as L1's $sh_rcl<w> loops (the
// masked count is not reduced mod w+1). CF comes in from the word, and CF and
// OF go out; OF off the result, as L1 writes it for every count.
for (const sh of ['rcl', 'rcr']) {
  for (const w of [8, 16, 32]) {
    const m = w === 32 ? -1 : (1 << w) - 1;
    const c = (k) => `(i32.const ${k})`;
    const X = '(local.get $x)', Y = '(local.get $y)', Z = '(local.get $z)';
    const bitOf = (v, k) => `(i32.and (i32.shr_u ${v} ${c(k)}) ${c(1)})`;
    const one = sh === 'rcl'
      ? `(local.set $y ${bitOf(X, w - 1)}) (local.set $x (i32.or (i32.and (i32.shl ${X} ${c(1)}) ${c(m)}) ${Z}))`
      : `(local.set $y (i32.and ${X} ${c(1)})) (local.set $x (i32.or (i32.shr_u ${X} ${c(1)}) (i32.shl ${Z} ${c(w - 1)})))`;
    const of = sh === 'rcl' ? `(i32.xor ${Z} ${bitOf(Y, w - 1)})` : `(i32.xor ${bitOf(Y, w - 1)} ${bitOf(Y, w - 2)})`;
    const clear = (1 << FBIT.c) | (1 << FBIT.o);
    def(`shv_${sh}${w}`, 'vvv', ({ V, SET }) => `(local.set $x (i32.and ${V(1)} ${c(m)}))`
      + `(local.set $l (i32.and ${V(2)} (local.get $shm)))`
      + `(if (i32.eqz (local.get $l)) (then (local.set $y ${V(1)})) (else`
      + ` (local.set $z (i32.and (local.get $F) ${c(1 << FBIT.c)}))`
      + ` (loop $rc ${one} (local.set $z (local.get $y))`
      + `  (local.set $l (i32.sub (local.get $l) ${c(1)})) (br_if $rc (local.get $l)))`
      + ` (local.set $y ${X})`
      + ` (local.set $F (i32.or (i32.and (local.get $F) ${c(~clear)})`
      + ` (i32.or ${Z} (i32.shl ${of} ${c(FBIT.o)}))))))`
      + SET(0, Y));
  }
}
// CLC/STC/CMC (uop-ir.js 'flagop') as L1's handlers: CLC's mask is 16 bits
// wide, STC's OR and CMC's XOR leave the upper half alone.
def('shv_clc', 'vvv', ({ SET }) => `(local.set $F (i32.and (local.get $F) (i32.const 0xFFFE)))` + SET(0, '(i32.const 0)'));
def('shv_stc', 'vvv', ({ SET }) => `(local.set $F (i32.or (local.get $F) (i32.const 1)))` + SET(0, '(i32.const 0)'));
def('shv_cmc', 'vvv', ({ SET }) => `(local.set $F (i32.xor (local.get $F) (i32.const 1)))` + SET(0, '(i32.const 0)'));

// Registers and segment bases: operand 1 is the byte address.
def('getr32', 'vi', ({ I, SET }) => SET(0, `(i32.load ${I(1)})`));
def('getr16', 'vi', ({ I, SET }) => SET(0, `(i32.load16_u ${I(1)})`));
def('getr8', 'vi', ({ I, SET }) => SET(0, `(i32.load8_u ${I(1)})`));
def('putr32', 'iv', ({ V, I }) => `(i32.store ${I(0)} ${V(1)})`);
def('putr16', 'iv', ({ V, I }) => `(i32.store16 ${I(0)} ${V(1)})`);
def('putr8', 'iv', ({ V, I }) => `(i32.store8 ${I(0)} ${V(1)})`);
def('getm_spm', 'v', ({ SET }) => SET(0, '(local.get $spm)'));
def('getm_df', 'v', ({ SET }) => SET(0, '(i32.and (i32.shr_u (local.get $F) (i32.const 10)) (i32.const 1))'));
def('getm_shm', 'v', ({ SET }) => SET(0, '(local.get $shm)'));

// Guest memory. $l = linear address; the guard is uop-ref.js's plain().
const vga = '(i32.eq (i32.or (i32.and (local.get $l) (i32.const 0xFFF0000)) (i32.const 1)) (local.get $vk))';
const wrap = (n) => `(i32.or (i32.gt_u (i32.and (local.get $x) (i32.const 65535)) (i32.const ${0x10000 - n}))`
  + ` (i32.gt_u (i32.and (local.get $l) (i32.const 65535)) (i32.const ${0x10000 - n})))`;
const code = (n) => `(i32.and (i32.load16_u (i32.add (i32.const ${isa.CODE_BITMAP}) (i32.shr_u (local.get $l) (i32.const 3))))`
  + ` (i32.shl (i32.const ${(1 << n) - 1}) (i32.and (local.get $l) (i32.const 7))))`;
const LDW = { 8: 'i32.load8_u', 16: 'i32.load16_u', 32: 'i32.load' };
const STW = { 8: 'i32.store8', 16: 'i32.store16', 32: 'i32.store' };
for (const w of [8, 16, 32]) {
  const n = w >> 3;
  for (const form of ['a', 'g']) {
    // form a: off = (v[a] + i) & am ; form g: off = (v[a] + (v[c] << sc) + i) & am
    // ld operands: d s a [c sc] i am dx ; st operands: b s a [c sc] i am dx
    const offOf = (V, I) => (form === 'a'
      ? `(i32.and (i32.add ${V(2)} ${I(3)}) ${I(4)})`
      : `(i32.and (i32.add (i32.add ${V(2)} (i32.shl ${V(3)} ${I(4)})) ${I(5)}) ${I(6)})`);
    const dxk = form === 'a' ? 5 : 7;
    const kinds = form === 'a' ? 'vvvii' : 'vvvviii';
    const addr = (V, I) => `(local.set $x ${offOf(V, I)})`
      + `(local.set $l (i32.and (i32.add ${V(1)} (local.get $x)) (local.get $lm)))`;
    const bad = (store) => {
      let t = vga;
      if (n > 1) t = `(i32.or ${t} ${wrap(n)})`;
      if (store) t = `(i32.or ${t} (i32.ne ${code(n)} (i32.const 0)))`;
      return t;
    };
    def(`ld${w}${form}`, `${kinds}t`, ({ V, I, SET, GOTO }) => addr(V, I)
      + `(if ${bad(false)} (then ${GOTO(dxk)}))` + SET(0, `(${LDW[w]} (local.get $l))`));
    def(`st${w}${form}`, `${kinds}t`, ({ V, I, GOTO }) => addr(V, I)
      + `(if ${bad(true)} (then ${GOTO(dxk)}))` + `(${STW[w]} (local.get $l) ${V(0)})`);
    // Full L1 semantics (chk 'full', the slow half): the plain case inline;
    // anything else -- VGA, a 64K wrap, a store onto code -- hands this whole
    // block to the reference interpreter from its start (the last operand is
    // the block id). Only lowered where nothing before it in the block had an
    // effect, so running the block again from the top is exact.
    const bailTo = (I) => `(i32.store (i32.const ${OUT + 8}) ${I(dxk)})`
      + '(i32.store (i32.const ' + OUT + ') (local.get $steps)) (i32.store (i32.const ' + (OUT + 4) + ') (local.get $F))'
      + '(return (i32.const 1))';
    def(`ldf${w}${form}`, `${kinds}i`, ({ V, I, SET }) => addr(V, I)
      + `(if ${bad(false)} (then ${bailTo(I)}))` + SET(0, `(${LDW[w]} (local.get $l))`));
    def(`stf${w}${form}`, `${kinds}i`, ({ V, I }) => addr(V, I)
      + `(if ${bad(true)} (then ${bailTo(I)}))` + `(${STW[w]} (local.get $l) ${V(0)})`);
    // ...and the same with a planar VGA access done in place, byte by byte in
    // uop-ref's order, through L1's own vga_rd8/vga_wr8, instead of handing the
    // block back: only a 64K wrap (or a store onto code) still bails. Lowered
    // for the last full access of a block only, since a VGA access is an
    // effect (latches, the read/write counters) that a later bail would redo.
    const vgaRd = () => {
      let e = '(call $vga_rd8 (local.get $l))';
      for (let k = 1; k < n; k++) e = `(i32.or ${e} (i32.shl (call $vga_rd8 (i32.add (local.get $l) (i32.const ${k}))) (i32.const ${8 * k})))`;
      return e;
    };
    const vgaWr = (V) => Array.from({ length: n }, (_, k) => (k
      ? `(call $vga_wr8 (i32.add (local.get $l) (i32.const ${k})) (i32.shr_u ${V(0)} (i32.const ${8 * k})))`
      : `(call $vga_wr8 (local.get $l) ${V(0)})`)).join('');
    def(`ldfv${w}${form}`, `${kinds}i`, ({ V, I, SET }) => addr(V, I)
      + (n > 1 ? `(if ${wrap(n)} (then ${bailTo(I)}))` : '')
      + SET(0, `(if (result i32) ${vga} (then ${vgaRd()}) (else (${LDW[w]} (local.get $l))))`));
    def(`stfv${w}${form}`, `${kinds}i`, ({ V, I }) => addr(V, I)
      + (n > 1 ? `(if ${wrap(n)} (then ${bailTo(I)}))` : '')
      + `(if ${vga} (then ${vgaWr(V)}) (else`
      + ` (if (i32.ne ${code(n)} (i32.const 0)) (then ${bailTo(I)}))`
      + ` (${STW[w]} (local.get $l) ${V(0)})))`);
    // The fast half's form of the same, for an access predicted to be VGA
    // (op.vga): a wrap or a store onto code deopts like the guard does, and
    // VGA is done in place. Only where no later op of the same instruction
    // can deopt, or the slow half would do the VGA access again.
    def(`ldv${w}${form}`, `${kinds}t`, ({ V, I, SET, GOTO }) => addr(V, I)
      + (n > 1 ? `(if ${wrap(n)} (then ${GOTO(dxk)}))` : '')
      + SET(0, `(if (result i32) ${vga} (then ${vgaRd()}) (else (${LDW[w]} (local.get $l))))`));
    def(`stv${w}${form}`, `${kinds}t`, ({ V, I, GOTO }) => addr(V, I)
      + (n > 1 ? `(if ${wrap(n)} (then ${GOTO(dxk)}))` : '')
      + `(if ${vga} (then ${vgaWr(V)}) (else`
      + ` (if (i32.ne ${code(n)} (i32.const 0)) (then ${GOTO(dxk)}))`
      + ` (${STW[w]} (local.get $l) ${V(0)})))`);
    def(`ldn${w}${form}`, kinds, ({ V, I, SET }) => addr(V, I) + SET(0, `(${LDW[w]} (local.get $l))`));
    def(`stn${w}${form}`, kinds, ({ V, I }) => addr(V, I) + `(${STW[w]} (local.get $l) ${V(0)})`);
  }
}

// Forwarded flag bits.
def('fbit', 'vvi', ({ V, I, SET }) => SET(0, `(i32.and (i32.shr_u ${V(1)} ${I(2)}) (i32.const 1))`));
def('fz', 'vvi', ({ V, I, SET }) => SET(0, `(i32.eqz (i32.shl ${V(1)} ${I(2)}))`));
def('fp', 'vv', ({ V, SET }) => SET(0,
  `(i32.eqz (i32.and (i32.popcnt (i32.and ${V(1)} (i32.const 255))) (i32.const 1)))`));
def('fa', 'vvvv', ({ V, SET }) => SET(0,
  `(i32.and (i32.shr_u (i32.xor (i32.xor ${V(1)} ${V(2)}) ${V(3)}) (i32.const 4)) (i32.const 1))`));
def('foadd', 'vvvvi', ({ V, I, SET }) => `(local.set $x ${V(3)})` + SET(0,
  `(i32.and (i32.shr_u (i32.and (i32.xor ${V(1)} (local.get $x)) (i32.xor ${V(2)} (local.get $x))) ${I(4)}) (i32.const 1))`));
def('fosub', 'vvvvi', ({ V, I, SET }) => `(local.set $x ${V(1)})` + SET(0,
  `(i32.and (i32.shr_u (i32.and (i32.xor (local.get $x) ${V(2)}) (i32.xor (local.get $x) ${V(3)})) ${I(4)}) (i32.const 1))`));
def('fcadd32', 'vvvv', ({ V, SET }) => SET(0,
  `(select (i32.le_u ${V(1)} ${V(2)}) (i32.lt_u ${V(1)} ${V(2)}) ${V(3)})`));
def('fcsub32', 'vvvv', ({ V, SET }) => SET(0,
  `(select (i32.le_u ${V(1)} ${V(2)}) (i32.lt_u ${V(1)} ${V(2)}) ${V(3)})`));
def('fnz', 'vv', ({ V, SET }) => SET(0, `(i32.ne ${V(1)} (i32.const 0))`));
def('getf', 'vi', ({ I, SET }) => SET(0, `(i32.and (i32.shr_u (local.get $F) ${I(1)}) (i32.const 1))`));
def('getfw', 'v', ({ SET }) => SET(0, '(local.get $F)'));
// A condition code read off the materialized word, x86 cc order (uop-ir.js ccEval).
{
  const bit = (f) => `(i32.and (i32.shr_u (local.get $F) (i32.const ${FBIT[f]})) (i32.const 1))`;
  const base = [bit('o'), bit('c'), bit('z'), `(i32.or ${bit('c')} ${bit('z')})`, bit('s'), bit('p'),
    `(i32.xor ${bit('s')} ${bit('o')})`, `(i32.or ${bit('z')} (i32.xor ${bit('s')} ${bit('o')}))`];
  for (let cc = 0; cc < 16; cc++) {
    const v = base[cc >> 1];
    def(`getcc${cc}`, 'v', ({ SET }) => SET(0, cc & 1 ? `(i32.xor ${v} (i32.const 1))` : v));
  }
}
// wflags: operand 0 the mask of bits written, then c p a z s o (absent: zero slot)
def('wflags', 'ivvvvvv', ({ V, I }) => `(local.set $F (i32.or (i32.and (local.get $F) (i32.xor ${I(0)} (i32.const -1)))`
  + ` (i32.and ${I(0)} (i32.or (i32.or (i32.or (i32.and ${V(1)} (i32.const 1))`
  + ` (i32.shl (i32.and ${V(2)} (i32.const 1)) (i32.const 2)))`
  + ` (i32.or (i32.shl (i32.and ${V(3)} (i32.const 1)) (i32.const 4)) (i32.shl (i32.and ${V(4)} (i32.const 1)) (i32.const 6))))`
  + ` (i32.or (i32.shl (i32.and ${V(5)} (i32.const 1)) (i32.const 7)) (i32.shl (i32.and ${V(6)} (i32.const 1)) (i32.const 11)))))))`);

// A whole flag record in one µop: what lowerRec otherwise spends six flagof
// µops and a wflags on (seven dispatches for every live flag-setting
// instruction the naive tier runs). Each computes exactly the flags, from
// exactly the operands, that the unfused sequence does (lowerFlagof), and
// writes all six bits of $F.
{
  const bit = (x, n) => `(i32.and (i32.shr_u ${x} ${n}) (i32.const 1))`;
  const par = (x) => `(i32.eqz (i32.and (i32.popcnt (i32.and ${x} (i32.const 255))) (i32.const 1)))`;
  const six = (c, p, a, z, s, o) => '(local.set $F (i32.or (i32.and (local.get $F) (i32.const '
    + `${~((1 << FBIT.c) | (1 << FBIT.p) | (1 << FBIT.a) | (1 << FBIT.z) | (1 << FBIT.s) | (1 << FBIT.o))}))`
    + ` (i32.or (i32.or (i32.or ${c} (i32.shl ${p} (i32.const ${FBIT.p})))`
    + ` (i32.or (i32.shl ${a} (i32.const ${FBIT.a})) (i32.shl ${z} (i32.const ${FBIT.z}))))`
    + ` (i32.or (i32.shl ${s} (i32.const ${FBIT.s})) (i32.shl ${o} (i32.const ${FBIT.o}))))))`;
  const X = '(local.get $x)', Y = '(local.get $y)', Z = '(local.get $z)';
  const af = `${bit(`(i32.xor (i32.xor ${X} ${Y}) ${Z})`, '(i32.const 4)')}`;
  // 8/16-bit add and sub over A, B and the unmasked sum S: operands w, 32-w, w-1.
  for (const sub of [false, true]) {
    def(sub ? 'wfsubn' : 'wfaddn', 'vvviii', ({ V, I }) =>
      `(local.set $x ${V(0)}) (local.set $y ${V(1)}) (local.set $z ${V(2)})`
      + six(bit(Z, I(3)), par(Z), af, `(i32.eqz (i32.shl ${Z} ${I(4)}))`, bit(Z, I(5)),
        bit(sub ? `(i32.and (i32.xor ${X} ${Y}) (i32.xor ${X} ${Z}))`
          : `(i32.and (i32.xor ${X} ${Z}) (i32.xor ${Y} ${Z}))`, I(5))));
  }
  // 32-bit add and sub over A, B, the result R and the carry in.
  for (const sub of [false, true]) {
    def(sub ? 'wfsub32' : 'wfadd32', 'vvvv', ({ V }) =>
      `(local.set $x ${V(0)}) (local.set $y ${V(1)}) (local.set $z ${V(2)})`
      + six(sub ? `(select (i32.le_u ${X} ${Y}) (i32.lt_u ${X} ${Y}) ${V(3)})`
        : `(select (i32.le_u ${Z} ${X}) (i32.lt_u ${Z} ${X}) ${V(3)})`,
      par(Z), af, `(i32.eqz ${Z})`, bit(Z, '(i32.const 31)'),
      bit(sub ? `(i32.and (i32.xor ${X} ${Y}) (i32.xor ${X} ${Z}))`
        : `(i32.and (i32.xor ${X} ${Z}) (i32.xor ${Y} ${Z}))`, '(i32.const 31)')));
  }
  // A logic op over its (masked) result R: operand w-1. CF, AF, OF clear.
  def('wflogic', 'vi', ({ V, I }) => `(local.set $z ${V(0)})`
    + six('(i32.const 0)', par(Z), '(i32.const 0)', `(i32.eqz ${Z})`, bit(Z, I(1)), '(i32.const 0)'));
}

// A port read (uop-ir.js 'in'): L1's io_in at L1's clock -- operand 2 is the
// width, operand 3 the distance from this engine's $steps to L1's.
def('pin', 'vvii', ({ V, I, SET }) => SET(0,
  `(call $io_in (i32.and ${V(1)} (i32.const 65535)) ${I(2)} (i32.add (local.get $steps) ${I(3)}))`));

// A port write (uop-ir.js 'out'): L1's io_out at L1's clock, which hands
// back L1's $steps -- -1 when the write cut the slice. Then $steps becomes
// that less the distance, and POUTX leaves by its target (uop-opt.js
// deoptAfter); POUT, the slow half's, runs on to its own tests.
{
  const call = ({ V, I }) => `(local.set $x (i32.add (local.get $steps) ${I(3)}))`
    + `(local.set $y (call $io_out (i32.and ${V(0)} (i32.const 65535)) ${V(1)} ${I(2)} (local.get $x)))`
    // A write to the sequencer or graphics controller can turn planar mode
    // on or off, and $vk is what every plain access tests against.
    + `(local.set $vk (i32.load (i32.const ${isa.VGA_CTL_KEY})))`;
  const cut = ({ I }) => `(local.set $steps (i32.sub (local.get $y) ${I(3)}))`;
  def('pout', 'vvii', (a) => `${call(a)}(if (i32.ne (local.get $y) (local.get $x)) (then ${cut(a)}))`);
  def('poutx', 'vviit', (a) => `${call(a)}(if (i32.ne (local.get $y) (local.get $x)) (then ${cut(a)} ${a.GOTO(4)}))`);
}

// The clock and the guards.
def('step', 'i', ({ I }) => `(local.set $steps (i32.sub (local.get $steps) ${I(0)}))`);
def('check', 'it', ({ I, GOTO }) => `(if (i32.or (i32.lt_s (local.get $steps) ${I(0)}) (local.get $smc)) (then ${GOTO(1)}))`);
// Segment windows apart (uop-ref.js 'sdisj'): a b i=start delta n2 n1 dx.
def('sdisj', 'vviiit', ({ V, I, GOTO }) => `(local.set $x (i32.and (i32.add (i32.sub ${V(0)} ${V(1)}) ${I(2)}) (local.get $lm)))`
  + `(if (i32.or (i32.lt_u (local.get $x) ${I(3)})`
  + ` (i32.lt_u (i32.add (i32.sub (local.get $lm) (local.get $x)) (i32.const 1)) ${I(4)})) (then ${GOTO(5)}))`);
for (const g of ['spm', 'shm', 'df', 'smc']) {
  const val = g === 'df' ? '(i32.and (i32.shr_u (local.get $F) (i32.const 10)) (i32.const 1))' : `(local.get $${g})`;
  def(`guard_${g}`, 'it', ({ I, GOTO }) => `(if (i32.ne ${val} ${I(0)}) (then ${GOTO(1)}))`);
}

// Terminators. A charged transfer subtracts its steps; a checked one (x)
// takes its alternative when the budget is spent or code was written.
const due = '(i32.or (i32.ne (local.get $smc) (i32.const 0)) (i32.lt_s (local.get $steps) (i32.const 0)))';
def('jmp', 't', ({ GOTO }) => GOTO(0));
def('jmpc', 'it', ({ I, GOTO }) => `(local.set $steps (i32.sub (local.get $steps) ${I(0)}))${GOTO(1)}`);
def('jmpx', 'itt', ({ I, GOTO }) => `(local.set $steps (i32.sub (local.get $steps) ${I(0)}))`
  + `(if ${due} (then ${GOTO(1)}))${GOTO(2)}`);
for (const cc of CCS) {
  def(`bcc_${cc}`, 'vviitt', ({ V, I, GOTO }) => `(if ${condWat(cc, V(0), V(1), I(2))} (then ${GOTO(3)}))${GOTO(4)}`);
  // general: a b sh sT sF T F tx fx (tx/fx: -1 = none, encoded as the plain target)
  def(`bccx_${cc}`, 'vviiitttt', ({ V, I, GOTO }) => `(if ${condWat(cc, V(0), V(1), I(2))} (then`
    + ` (local.set $steps (i32.sub (local.get $steps) ${I(3)}))`
    + ` (if ${due} (then ${GOTO(7)})) ${GOTO(5)}))`
    + `(local.set $steps (i32.sub (local.get $steps) ${I(4)}))`
    + `(if ${due} (then ${GOTO(8)}))${GOTO(6)}`);
}
// exit: adj, ip vreg (zero slot when static), static ip
for (const [nm, line] of [['exit', 0], ['exitl', 1]]) {
  def(nm, 'ivi', ({ V, I }) => `(local.set $steps (i32.add (local.get $steps) ${I(0)}))`
    + `(i32.store (i32.const ${OUT + 8}) (i32.add ${V(1)} ${I(2)}))`
    + `(i32.store (i32.const ${LINEX}) (i32.const ${line}))`
    + `(i32.store (i32.const ${OUT}) (local.get $steps)) (i32.store (i32.const ${OUT + 4}) (local.get $F))`
    + '(return (i32.const 0))');
}
// link: an exit to a static ip that another program in the arena may start
// at. adj, ip, target (patched: 0 = none, else that program's entry address),
// the target's program id. Taken like L1's GO through the jump table -- only
// when the budget is not spent and no code was written -- and otherwise it
// is exactly `exit` at that ip.
// linkl is the straight-line form: no transfer, so no budget test -- only a
// store into code stops it, as it stops L1's straight line (`CONT`).
for (const [nm, line] of [['link', 0], ['linkl', 1]]) {
  const stop = line ? '(i32.ne (local.get $smc) (i32.const 0))' : due;
  def(nm, 'iiii', ({ I, GOTO }) => `(local.set $steps (i32.add (local.get $steps) ${I(0)}))`
    + `(if (i32.and (i32.ne ${I(2)} (i32.const 0)) (i32.eqz ${stop}))`
    + ` (then (i32.store (i32.const ${LASTP}) ${I(3)}) ${GOTO(2)}))`
    + `(i32.store (i32.const ${OUT + 8}) ${I(1)})`
    + `(i32.store (i32.const ${LINEX}) (i32.const ${line}))`
    + `(i32.store (i32.const ${OUT}) (local.get $steps)) (i32.store (i32.const ${OUT + 4}) (local.get $F))`
    + '(return (i32.const 0))');
}
// bail: block id; the reference interpreter runs it
def('bail', 'i', ({ I }) => `(i32.store (i32.const ${OUT + 8}) ${I(0)})`
  + `(i32.store (i32.const ${OUT}) (local.get $steps)) (i32.store (i32.const ${OUT + 4}) (local.get $F))`
  + '(return (i32.const 1))');

// Narrow-destination forms, for a resident program's writes to a register it
// keeps at 16 or 8 bits: the op's result stored as its low half or low byte,
// leaving the register's upper bits where they are. `mov.hi` is AH/CH/DH/BH.
// A resident register's partial write needs no merge at all this way -- the
// store IS the merge, the way L1's own rset16/rset8 do it.
for (const e of [...EOPS]) {
  let sets = false;
  const spy = { V: () => '', I: () => '', GOTO: () => '', SET: (k) => { if (k === 0) sets = true; return ''; } };
  e.body(spy);
  if (!sets || e.ops[0] !== 'v') continue;
  EOPS.push({ ...e, name: `${e.name}.h`, dw: 16 }, { ...e, name: `${e.name}.b`, dw: 8 },
    { ...e, name: `${e.name}.hf`, dw: 16, full: true }, { ...e, name: `${e.name}.bf`, dw: 8, full: true });
}
{
  const mov = EOPS.find(e => e.name === 'mov');
  EOPS.push({ ...mov, name: 'mov.hi', dw: 9 }, { ...mov, name: 'mov.hif', dw: 9, full: true });
}
// The store a narrow write makes. `full` (resident: 'full', the ...RF configs)
// is the same merge done as a 32-bit load-merge-store, so the register's next
// full-width load never meets a narrower store it cannot forward from.
const DWST = { 16: 'i32.store16', 8: 'i32.store8', 9: 'i32.store8 offset=1' };
const DWKEEP = { 16: -65536, 8: -256, 9: -65281 };
const dwPut = (dw, x) => (dw === 9 ? `(i32.shl (i32.and ${x} (i32.const 255)) (i32.const 8))`
  : `(i32.and ${x} (i32.const ${dw === 16 ? 65535 : 255}))`);
const dwStore = (e, at, x) => (!e.full ? `(${DWST[e.dw]} ${at} ${x})`
  : `(local.set $y ${x}) (local.set $z ${at})`
    + ` (i32.store (local.get $z) (i32.or (i32.and (i32.load (local.get $z)) (i32.const ${DWKEEP[e.dw]})) ${dwPut(e.dw, '(local.get $y)')}))`);

// A `step` fused into the op before it: `X_s` is X, then $steps less its last
// operand. The naive lowering ends every x86 instruction with a step, and
// 58% of them follow a putr (op-pair census, TOYVM_E1HIST=1), the rest mostly
// a flag write or a getcc. An X that leaves early (a bail) skips the step
// exactly as X then step would. Not pout/pin: they read $steps.
const STEP_FUSE = globalThis.TOYVM_STEPFUSE !== '0'
  && (typeof process === 'undefined' || !process.env || process.env.TOYVM_STEPFUSE !== '0');
for (const e of [...EOPS]) {
  if (!/^(putr(8|16|32)|getcc\d+|wf(addn|subn|add32|sub32|logic)|wflags|stfv\d+\w*)$/.test(e.name)) continue;
  const n = e.ops.length;
  EOPS.push({ ...e, name: `${e.name}_s`, ops: `${e.ops}i`,
    body: (A) => `${e.body(A)} (local.set $steps (i32.sub (local.get $steps) ${A.I(n)}))` });
}
const EOP = new Map(EOPS.map((e, i) => [e.name, { ...e, id: i }]));
const isTerm = (name) => /^(jmp|jmpc|jmpx|bcc_|bccx_|exit|link|bail)/.test(name);
// Ops whose effect outlives the vreg they define: after one of these, a block
// can no longer be handed to the reference interpreter from its start (ldf/stf).
// A shift (callh) is not one, although it writes flags: every flag bit it
// touches is set from its operands alone (shv_*, a count of 0 touches none),
// so running it twice from the same operands leaves the flags it left once.
// That is what lets `shl [mem],cl` store after its flags are out.
// ...unless it reads the carry it writes (RCL/RCR/CMC): run twice, it is not
// run once, so it is an effect like any other.
const CF_READERS = new Set(['rcl', 'rcr', 'cmc']);
const EFFECT = new Set(['st', 'putr', 'puts', 'putsel', 'rec', 'wrec', 'wflags', 'step',
  'fvset', 'check', 'dchk', 'guard', 'pin', 'pout']);

// ---------------------------------------------------------------------------
// Lowering: µop program -> per block, a list of { name, args } where an arg is
// { v: vreg } | { i: number } | { t: block id }.
// ---------------------------------------------------------------------------
class Unsupported extends Error {}

function lowerProgram(p, lo = {}) {
  const nv = p.nv;
  const resident = !!p.resident;
  const F = p.resident === 'full' ? 'f' : '';
  let next = nv;
  const ZERO = next++;
  const consts = new Map([[0, ZERO]]);
  const K = (x) => {
    x |= 0;
    if (!consts.has(x)) consts.set(x, next++);
    return { v: consts.get(x) };
  };
  const scratch = [next++, next++];
  const vr = (x) => ({ v: x });
  const im = (x) => ({ i: x | 0 });
  const tg = (x) => ({ t: x });
  // A block id the engine hands back to JS (bail, ldf/stf): an arena encodes
  // it as a handle, the program's own id range plus the id.
  const bidArg = (x) => ({ i: x | 0, bid: true });
  const opt = (x) => (x !== undefined && x >= 0 ? vr(x) : K(0));
  const mask = (w) => (w === 32 ? -1 : (1 << w) - 1);

  const dwTemp = next++;
  const DWS = { 16: `.h${F}`, 8: `.b${F}` };
  // A resident register written narrow: the op aimed at a temp, then retargeted
  // at the register as its store-narrow form when it lowered to one op that
  // has one, else a narrow mov from the temp.
  const lowerNarrow = (op, out) => {
    const tmp = [];
    lowerOp({ ...op, d: dwTemp, dw: undefined }, tmp);
    const suf = DWS[op.dw];
    const last = tmp[tmp.length - 1];
    if (tmp.length === 1 && last.args[0].v === dwTemp && EOP.has(last.name + suf)) {
      out.push({ name: last.name + suf, args: [vr(op.d), ...last.args.slice(1)] });
    } else {
      out.push(...tmp);
      out.push({ name: `mov${suf}`, args: [vr(op.d), vr(dwTemp)] });
    }
  };
  const lowerOp = (op, out) => {
    const E = (name, ...args) => out.push({ name, args });
    if (resident) {
      // A partial-register merge into the register itself is a narrow store.
      const MS = { merge16: `mov.h${F}`, merge8l: `mov.b${F}`, merge8h: `mov.hi${F}` };
      if (MS[op.o] && op.d === op.a && op.d < NREG) return E(MS[op.o], vr(op.d), vr(op.b));
      if (op.dw) return lowerNarrow(op, out);
    }
    switch (op.o) {
      case 'movi': return E('movi', vr(op.d), im(op.i));
      case 'mov': return E('mov', vr(op.d), vr(op.a));
      case 'add': case 'sub': case 'and': case 'or': case 'xor': case 'mul': case 'eq': case 'ne':
      case 'mulhu': case 'mulhs': case 'imulov':
        return E(op.o, vr(op.d), vr(op.a), vr(op.b));
      case 'dchk': return E(op.sg ? 'dchks' : 'dchku', vr(op.a), vr(op.b), vr(op.c), im(64 - op.w), tg(op.dx));
      case 'divq': case 'divr': return E(`${op.o}${op.sg ? 's' : 'u'}`, vr(op.d), vr(op.a), vr(op.b), vr(op.c));
      case 'addi': case 'andi': case 'ori': case 'xori': case 'shli': case 'shri': case 'sari':
      case 'addi16': case 'addi8':
        return E(op.o, vr(op.d), vr(op.a), im(op.i));
      case 'subi': return E('addi', vr(op.d), vr(op.a), im(-op.i));
      case 'sx8': case 'sx16': case 'ext8h': return E(op.o, vr(op.d), vr(op.a));
      case 'merge16': case 'merge8l': case 'merge8h': return E(op.o, vr(op.d), vr(op.a), vr(op.b));
      case 'cc': {
        const w = op.w || 32;
        return E(`cc_${op.cc}`, vr(op.d), vr(op.a), op.b !== undefined && op.b >= 0 ? vr(op.b) : K(op.i), im(32 - w));
      }
      case 'getr': {
        const at = isa.REGFILE_BASE + 4 * op.r;
        if (op.w === 32) return E('getr32', vr(op.d), im(at));
        if (op.w === 16) return E('getr16', vr(op.d), im(at));
        if (op.w === 8) return E('getr8', vr(op.d), im(at));
        if (op.w === 9) return E('getr8', vr(op.d), im(at + 1));
        throw new Unsupported(`getr w${op.w}`);
      }
      case 'putr': {
        const at = isa.REGFILE_BASE + 4 * op.r;
        if (op.w === 32) return E('putr32', im(at), vr(op.a));
        if (op.w === 16) return E('putr16', im(at), vr(op.a));
        if (op.w === 8) return E('putr8', im(at), vr(op.a));
        if (op.w === 9) return E('putr8', im(at + 1), vr(op.a));
        throw new Unsupported(`putr w${op.w}`);
      }
      case 'gets': return E('getr32', vr(op.d), im(isa.REGFILE_SEGB + 4 * op.s));
      case 'puts': return E('putr32', im(isa.REGFILE_SEGB + 4 * op.s), vr(op.a));
      case 'getsel': return E('getr32', vr(op.d), im(isa.REGFILE_SEL + 4 * op.s));
      case 'putsel': return E('putr32', im(isa.REGFILE_SEL + 4 * op.s), vr(op.a));
      case 'getm':
        if (op.g === 'spm') return E('getm_spm', vr(op.d));
        if (op.g === 'df') return E('getm_df', vr(op.d));
        if (op.g === 'shmask') return E('getm_shm', vr(op.d));
        return E('movi', vr(op.d), im(0));
      case 'ld': case 'st': {
        const full = op.chk === 'full';
        if (full && effected) throw new Unsupported('full memory after an effect');
        const guard = op.chk === 'guard';
        const general = op.c !== undefined && op.c >= 0;
        const am = op.am ? op.am | 0 : -1;
        const first = op.o === 'ld' ? vr(op.d) : vr(op.b);
        const addrArgs = general ? [opt(op.a), vr(op.c), im(op.sc | 0), im(op.i | 0), im(am)] : [opt(op.a), im(op.i | 0), im(am)];
        const name = `${op.o}${full ? (op === lastFull ? 'fv' : 'f') : guard ? (vgaOk.has(op) ? 'v' : '') : 'n'}${op.w}${general ? 'g' : 'a'}`;
        return E(name, first, vr(op.s), ...addrArgs, ...(guard ? [tg(op.dx)] : full ? [bidArg(curBlock)] : []));
      }
      case 'callh':
      {
        const nm = op.w ? `shv_${op.sh}${op.w}` : `shv_${op.sh}`;
        if (!op.sh || !EOP.has(nm)) throw new Unsupported(`callh ${op.fn}`);
        return E(nm, vr(op.d), vr(op.a), vr(op.b));
      }
      case 'flagof': return lowerFlagof(op, E);
      case 'rec': case 'wrec': return lowerRec(op, E);
      case 'getf': return E('getf', vr(op.d), im(FBIT[op.f]));
      case 'getfw': return E('getfw', vr(op.d));
      case 'getcc': return E(`getcc${op.cc & 15}`, vr(op.d));
      case 'wflags': {
        let m = 0;
        const a = [];
        for (const f of ['c', 'p', 'a', 'z', 's', 'o']) {
          const x = op[`f${f}`];
          if (x !== undefined && x >= 0) { m |= 1 << FBIT[f]; a.push(vr(x)); } else a.push(K(0));
        }
        return E('wflags', im(m), ...a);
      }
      case 'shift': return lowerShift(op, E);
      case 'step': return E('step', im(op.i));
      case 'pin': return E('pin', vr(op.d), vr(op.a), im(op.w), im(op.adj));
      case 'pout': return op.dx >= 0 ? E('poutx', vr(op.a), vr(op.b), im(op.w), im(op.adj), tg(op.dx))
        : E('pout', vr(op.a), vr(op.b), im(op.w), im(op.adj));
      case 'guard': {
        const g = { spm: 'spm', shmask: 'shm', df: 'df', smc: 'smc' }[op.g];
        if (!g) throw new Unsupported(`guard ${op.g}`);
        return E(`guard_${g}`, im(op.v), tg(op.dx));
      }
      case 'check': return E('check', im(op.m), tg(op.dx));
      case 'sdisj': return E('sdisj', vr(op.a), vr(op.b), im(op.i), im(op.n2), im(op.n1), tg(op.dx));
      default: throw new Unsupported(op.o);
    }
  };

  // A flag record, applied to the materialized word: the engine keeps no lazy
  // record, so a REC (and a WREC, L1's record rewritten at an exit) is each
  // flag it defines computed as a flagof, then one wflags. Which flags, per
  // uop-ref.js record() / LazyFlags: an inc/dec keeps CF (a WREC hands the one
  // it keeps in `fcf`; -2 is dead, and the reference writes 0), a mul writes
  // CF and OF, a shift by n writes nothing at n = 0 and CF, OF (and SZP but
  // not AF unless a rotate) otherwise; everything else writes all six.
  const recTemps = [next++, next++, next++, next++, next++, next++];
  const SIX = ['c', 'p', 'a', 'z', 's', 'o'];
  const lowerRec = (op, E) => {
    const k = op.k;
    const incdec = ['inc', 'dec', 'inc32', 'dec32'].includes(k);
    let set;
    if (k === 'mul') set = ['c', 'o'];
    else if (k === 'shift') {
      const n = op.i >>> 0;
      set = n === 0 ? [] : (op.sh === 'rol' || op.sh === 'ror' ? ['c', 'o'] : ['c', 'p', 'z', 's', 'o']);
    } else if (k === 'dsh') set = ['c', 'p', 'z', 's', 'o'];
    else if (incdec && op.o === 'rec') set = ['p', 'a', 'z', 's', 'o'];
    else set = SIX;
    if (!set.length) return undefined;
    // The six-flag records with a fused µop, over the operands lowerFlagof reads.
    if (set === SIX && !incdec) {
      const w = ['add32', 'sub32'].includes(k) ? 32 : op.w;
      if ((k === 'add' || k === 'sub') && w < 32) {
        return E(k === 'sub' ? 'wfsubn' : 'wfaddn', opt(op.a), opt(op.b), opt(op.s), im(w), im(32 - w), im(w - 1));
      }
      if (k === 'add32' || k === 'sub32') return E(`wf${k}`, opt(op.a), opt(op.b), opt(op.r), opt(op.cin));
      if (k === 'logic') return E('wflogic', opt(op.r), im(w - 1));
    }
    const args = [];
    let m = 0;
    SIX.forEach((f, j) => {
      if (!set.includes(f)) { args.push(K(0)); return; }
      m |= 1 << FBIT[f];
      const t = recTemps[j];
      if (incdec && f === 'c') {
        if (op.fcf !== undefined && op.fcf >= 0) E('andi', vr(t), vr(op.fcf), im(1));
        else E('movi', vr(t), im(0));
      } else lowerFlagof({ ...op, o: 'flagof', f, d: t }, E);
      args.push(vr(t));
    });
    return E('wflags', im(m), ...args);
  };

  // A producer's operands as the record would read them (uop-ref.js record()).
  const lowerFlagof = (op, E) => {
    const k = op.k;
    const d = vr(op.d);
    const has = (f) => op[f] !== undefined && op[f] >= 0;
    if (k === 'mul') return E('fnz', d, vr(op.nz));
    if (k === 'shift') return lowerShiftFlag(op, E);
    if (k === 'dsh') {
      // SHLD/SHRD by n in 1..w-1 (uop-ref.js dshFlags): a the destination
      // before, r after.
      const w = op.w, n = op.i >>> 0, R = vr(op.r), A = vr(op.a);
      switch (op.f) {
        case 'c': return E('fbit', d, A, im(op.sh === 'shld' ? w - n : n - 1));
        case 'z': return E('fz', d, R, im(0));
        case 's': return E('fbit', d, R, im(w - 1));
        case 'p': return E('fp', d, R);
        case 'o': { const t = vr(scratch[0]); E('fbit', t, A, im(w - 1)); E('fbit', d, R, im(w - 1)); return E('xor', d, d, t); }
        default: return E('movi', d, im(0));
      }
    }
    const incdec = ['inc', 'dec', 'inc32', 'dec32'].includes(k);
    const inc = k === 'inc' || k === 'inc32';
    const w = ['add32', 'sub32', 'inc32', 'dec32'].includes(k) ? 32 : op.w;
    if (['add', 'sub', 'inc', 'dec'].includes(k) && w === 32) throw new Unsupported(`${k} w32`);
    if (incdec && op.f === 'c') return E('movi', d, im(0));
    let A = opt(op.a), S = opt(op.s);
    if (incdec && !has('a')) {
      A = vr(scratch[0]);
      if (has('s')) E('addi', A, vr(op.s), im(inc ? -1 : 1));
      else if (w === 32) E('addi', A, opt(op.r), im(inc ? -1 : 1));
      else { E('addi', A, opt(op.r), im(inc ? -1 : 1)); E('andi', A, A, im(mask(w))); }
    }
    if (incdec && !has('s') && w !== 32) { S = vr(scratch[1]); E('addi', S, A, im(inc ? 1 : -1)); }
    const Bv = incdec ? K(1) : opt(op.b);
    const f = op.f;
    if (k === 'logic') {
      const R = opt(op.r);
      if (f === 'z') return E('fz', d, R, im(0));
      if (f === 's') return E('fbit', d, R, im(w - 1));
      if (f === 'p') return E('fp', d, R);
      return E('movi', d, im(0));
    }
    const subLike = k === 'sub' || k === 'dec' || k === 'sub32' || k === 'dec32';
    if (w === 32) {
      const R = opt(op.r);
      if (f === 'z') return E('fz', d, R, im(0));
      if (f === 's') return E('fbit', d, R, im(31));
      if (f === 'p') return E('fp', d, R);
      if (f === 'a') return E('fa', d, A, Bv, R);
      if (f === 'o') return E(subLike ? 'fosub' : 'foadd', d, A, Bv, R, im(31));
      if (f === 'c') {
        const cin = incdec ? K(0) : opt(op.cin);
        return subLike ? E('fcsub32', d, A, Bv, cin) : E('fcadd32', d, R, A, cin);
      }
    } else {
      if (f === 'c') return E('fbit', d, S, im(w));
      if (f === 'z') return E('fz', d, S, im(32 - w));
      if (f === 's') return E('fbit', d, S, im(w - 1));
      if (f === 'p') return E('fp', d, S);
      if (f === 'a') return E('fa', d, A, Bv, S);
      if (f === 'o') return E(subLike ? 'fosub' : 'foadd', d, A, Bv, S, im(w - 1));
    }
    throw new Unsupported(`flagof ${k}.${f}`);
  };

  // One flag of a constant-count shift, in closed form over the (masked)
  // operand: what shiftHelper's bit loop leaves in a fresh record.
  const lowerShiftFlag = (op, E) => {
    const w = op.w, n = op.i >>> 0, f = op.f, sh = op.sh;
    const d = vr(op.d), a = vr(op.a);
    if (n === 0 || f === 'a') return E('movi', d, im(0));
    const v = vr(scratch[0]), t = vr(scratch[1]);
    lowerShift({ o: 'shift', d: scratch[0], a: op.a, sh, w, i: n }, E);
    const rotate = sh === 'rol' || sh === 'ror';
    if (f === 'z' || f === 's' || f === 'p') {
      if (rotate) return E('movi', d, im(0));
      if (f === 'z') return E('fz', d, v, im(0));
      if (f === 's') return E('fbit', d, v, im(w - 1));
      return E('fp', d, v);
    }
    const carry = (into) => {
      switch (sh) {
        case 'shl': return n > w ? E('movi', into, im(0)) : E('fbit', into, a, im(w - n));
        case 'shr': return E('fbit', into, a, im(n - 1));
        case 'sar': E('sarw', into, a, im(n - 1), im(mask(w)), im(32 - w)); return E('andi', into, into, im(1));
        case 'rol': return E('fbit', into, v, im(0));
        case 'ror': return E('fbit', into, v, im(w - 1));
        default: throw new Unsupported(`shift ${sh}`);
      }
    };
    if (f === 'c') return carry(d);
    if (f === 'o') {
      switch (sh) {
        case 'shl': case 'rol': carry(t); E('fbit', d, v, im(w - 1)); return E('xor', d, d, t);
        case 'shr': return E('fbit', d, a, im(w - 1));
        case 'sar': return E('movi', d, im(0));
        case 'ror': E('fbit', t, v, im(w - 2)); E('fbit', d, v, im(w - 1)); return E('xor', d, d, t);
        default: throw new Unsupported(`shift ${sh}`);
      }
    }
    throw new Unsupported(`flagof shift.${f}`);
  };

  // Value of a constant-count shift (uop-ref.js shiftHelper, value only).
  const lowerShift = (op, E) => {
    const w = op.w, m = mask(w), n = op.i >>> 0;
    const d = vr(op.d), a = vr(op.a);
    if (n === 0) return E('mov', d, a);
    switch (op.sh) {
      case 'shl': return n >= w ? E('movi', d, im(0)) : E('shlw', d, a, im(n), im(m));
      case 'shr': return n >= w ? E('movi', d, im(0)) : E('shrw', d, a, im(n), im(m));
      case 'sar': return E('sarw', d, a, im(Math.min(n, 31)), im(m), im(32 - w));
      case 'rol': case 'ror': {
        let r = n % w;
        if (op.sh === 'ror') r = (w - r) % w;
        if (r === 0) return E('andi', d, a, im(m));
        return E('rolw', d, a, im(r), im(w - r), im(m));
      }
      default: throw new Unsupported(`shift ${op.sh}`);
    }
  };

  const lowerTerm = (t, E) => {
    if (t.o === 'br') {
      if (t.tx >= 0) return E('jmpx', im(t.st | 0), tg(t.tx), tg(t.t));
      if (t.st) return E('jmpc', im(t.st), tg(t.t));
      return E('jmp', tg(t.t));
    }
    if (t.o === 'bcc') {
      const w = t.w || 32;
      const b = t.b !== undefined && t.b >= 0 ? vr(t.b) : K(t.i | 0);
      if (!(t.tx >= 0) && !(t.fx >= 0) && !t.sT && !t.sF) {
        return E(`bcc_${t.cc}`, vr(t.a), b, im(32 - w), tg(t.t), tg(t.f));
      }
      return E(`bccx_${t.cc}`, vr(t.a), b, im(32 - w), im(t.sT | 0), im(t.sF | 0),
        tg(t.t), tg(t.f), tg(t.tx >= 0 ? t.tx : t.t), tg(t.fx >= 0 ? t.fx : t.f));
    }
    if (t.o === 'exit') {
      // A static exit in an arena program can chain to the program at its ip.
      const line = t.why === 'line' ? 'l' : '';
      if (lo.link && !(t.ipv !== undefined && t.ipv >= 0)) return E(`link${line}`, im(t.adj | 0), im(t.ip), { i: 0, link: t.ip, cb: t.cb }, im(0));
      return E(`exit${line}`, im(t.adj | 0), t.ipv !== undefined && t.ipv >= 0 ? vr(t.ipv) : K(0),
        im(t.ipv !== undefined && t.ipv >= 0 ? 0 : t.ip));
    }
    throw new Unsupported(`term ${t.o}`);
  };

  // once(v): an IR temp defined once and read once, so the op that reads it
  // may absorb the op that makes it. Every numeric field but `d` counts as a
  // read -- an immediate that happens to equal v only over-counts, which is
  // the safe direction.
  const nDef = new Map(), nRd = new Map();
  if (MASK_FUSE) {
    const bump = (m, v) => m.set(v, (m.get(v) || 0) + 1);
    const reads = (o, top = true) => {
      for (const k in o) {
        if (top && k === 'd') continue;
        if (typeof o[k] === 'number') bump(nRd, o[k]);
        else if (o[k] && typeof o[k] === 'object') reads(o[k], false);
      }
    };
    for (const b of p.blocks) {
      if (!b || b.kind === 'dead') continue;
      for (const op of b.ops) {
        reads(op);
        if (op.d !== undefined && op.d >= 0) bump(nDef, op.d);
      }
      if (b.term) reads(b.term);
    }
  }
  const once = (v) => v >= FIRST_TEMP && v < nv && nDef.get(v) === 1 && nRd.get(v) === 1;

  const blocks = new Map();
  const why = new Map();
  let curBlock = -1, effected = false, lastFull = null, vgaOk = new Set();
  for (const b of p.blocks) {
    if (!b || b.kind === 'dead' || !b.term) continue;
    const out = [];
    const E = (name, ...args) => out.push({ name, args });
    try {
      curBlock = b.id; effected = false;
      lastFull = null;
      if (lo.count && b.header) out.push({ name: 'cnt', args: [im(lo.count)] });
      for (const op of b.ops) if ((op.o === 'ld' || op.o === 'st') && op.chk === 'full') lastFull = op;
      // A predicted-VGA access in place: only with nothing after it in its
      // own instruction that can still deopt (and so run it again).
      vgaOk = new Set();
      const seen = new Set();
      for (let i = b.ops.length - 1; i >= 0; i--) {
        const op = b.ops[i];
        if (op.vga && op.chk === 'guard' && !seen.has(op.node)) vgaOk.add(op);
        if (op.dx !== undefined && op.dx >= 0) seen.add(op.node);
      }
      for (const op of b.ops) {
        lowerOp(op, out);
        if (EFFECT.has(op.o) || (op.o === 'callh' && CF_READERS.has(op.sh))) effected = true;
      }
      lowerTerm(b.term, E);
      const fused = MASK_FUSE ? fuseMasks(out, once) : out;
      blocks.set(b.id, { native: true, ops: STEP_FUSE ? fuseSteps(fused) : fused });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      why.set(e.message, (why.get(e.message) || 0) + 1);
      blocks.set(b.id, { native: false, why: e.message, ops: [{ name: 'bail', args: [bidArg(b.id)] }] });
    }
  }
  return { blocks: lo.fallthrough ? fallThrough(blocks, p.entry) : blocks,
    nvTotal: next, consts, why, entry: p.entry, resident, vbase: resident ? VFILE : VBASE };
}

// Masks fused into the op that makes their operand, on adjacent pairs whose
// middle vreg is `once` (lowerProgram). Measured on four corpus programs
// (TOYVM_E1HIST): addi/add/sub then andi, getm_spm then and, and andi then a
// narrow putr -- whose mask is dead, the store keeps only the low bits.
//   getm_spm s ; and d,x,s        -> andspm d,x
//   addi t,x,i ; andspm d,t       -> addispm d,x,i
//   addi t,x,i ; andi d,t,m       -> addim d,x,i,m
//   add|sub t,x,y ; andi d,t,m    -> addm|subm d,x,y,m
//   movi t,k ; andi d,t,m         -> movi d,k&m
//   X e,.. masked m ; putrN at,e  -> X unmasked, when m keeps every stored bit
const MASK_FUSE = globalThis.TOYVM_MASKFUSE !== '0'
  && (typeof process === 'undefined' || !process.env || process.env.TOYVM_MASKFUSE !== '0');
const UNMASK = { addm: 'add', subm: 'sub', addim: 'addi' };
function fuseMask2(a, b, once) {
  const d0 = (o) => o.args[0].v;
  const V = (o, k) => o.args[k].v;
  if (b.name === 'and' && a.name === 'getm_spm' && once(d0(a))) {
    const s = d0(a);
    if (V(b, 2) === s && V(b, 1) !== s) return [{ name: 'andspm', args: [b.args[0], b.args[1]] }];
    if (V(b, 1) === s && V(b, 2) !== s) return [{ name: 'andspm', args: [b.args[0], b.args[2]] }];
    return null;
  }
  if (b.name === 'andspm' && a.name === 'addi' && V(b, 1) === d0(a) && once(d0(a))) {
    return [{ name: 'addispm', args: [b.args[0], a.args[1], a.args[2]] }];
  }
  if (b.name === 'andi' && V(b, 1) === d0(a) && once(d0(a))) {
    const m = b.args[2];
    if (a.name === 'addi') return [{ name: 'addim', args: [b.args[0], a.args[1], a.args[2], m] }];
    if (a.name === 'add' || a.name === 'sub') return [{ name: `${a.name}m`, args: [b.args[0], a.args[1], a.args[2], m] }];
    if (a.name === 'movi') return [{ name: 'movi', args: [b.args[0], { i: (a.args[1].i & m.i) | 0 }] }];
    return null;
  }
  const keep = { putr16: 0xFFFF, putr8: 0xFF }[b.name];
  if (keep && V(b, 1) === d0(a) && once(d0(a))) {
    const m = a.name === 'andi' ? a.args[2].i : UNMASK[a.name] ? a.args[a.args.length - 1].i : null;
    if (m === null || (m & keep) !== keep) return null;
    if (a.name === 'andi') return [{ name: b.name, args: [b.args[0], a.args[1]] }];
    return [{ name: UNMASK[a.name], args: a.args.slice(0, -1) }, b];
  }
  return null;
}
function fuseMasks(ops, once) {
  const out = [];
  for (const o of ops) {
    out.push(o);
    while (out.length >= 2) {
      const f = fuseMask2(out[out.length - 2], out[out.length - 1], once);
      if (!f) break;
      out.splice(out.length - 2, 2, ...f);
      if (f.length === 2) break;
    }
  }
  return out;
}

// X, step -> X_s wherever X has a fused form (STEP_FUSE above).
function fuseSteps(ops) {
  const out = [];
  for (const o of ops) {
    const prev = out[out.length - 1];
    if (o.name === 'step' && prev && EOP.has(`${prev.name}_s`)) {
      out[out.length - 1] = { name: `${prev.name}_s`, args: [...prev.args, o.args[0]] };
    } else out.push(o);
  }
  return out;
}

// Lay blocks out so each `jmp` target follows its block wherever it can, and
// drop that `jmp`: in a loop engine (E1, the arena, E3's threaded tail
// calls) a block with no terminator runs on into the next block's words.
// The naive lowering is one block per x86 instruction, joined by `jmp`, so
// this removes most of its jmps (10.7% of the µops only-naive ran). Not for
// straightWat, which compiles each block separately and needs every
// terminator. Greedy and linear: follow jmp chains from the entry, park
// every other target on a stack, then place whatever is left in its old
// order.
function fallThrough(blocks, entry) {
  const order = [], placed = new Set(), st = [entry], rest = [...blocks.keys()];
  let ri = 0;
  while (order.length < blocks.size) {
    let id = st.length ? st.pop() : rest[ri++];
    while (id !== undefined && blocks.has(id) && !placed.has(id)) {
      placed.add(id);
      order.push(id);
      const ops = blocks.get(id).ops, last = ops[ops.length - 1];
      for (const a of last.args) if (a.t !== undefined) st.push(a.t);
      id = last.name === 'jmp' ? last.args[0].t : undefined;
    }
  }
  const out = new Map();
  order.forEach((id, k) => {
    const b = blocks.get(id), last = b.ops[b.ops.length - 1];
    if (last.name === 'jmp' && last.args[0].t === order[k + 1]) b.ops.pop();
    out.set(id, b);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Interpreted engines: encoding, variants and the two dispatch shapes.
//
// A VARIANT is an engine op with some of its vreg operands bound to wasm
// locals $r0..$r<K-1> -- the program's hottest vregs -- instead of the memory
// file. Its key is `op:pattern`, one character per operand: a slot digit, or
// 'm' (memory, or not a vreg at all). Encoded operand words stay where they
// are either way; a slot-bound operand's word is simply never read.
//
//   E1  loop, K = 0: the all-memory variant of every op and nothing else, so
//       its module is the same for every program.
//   E2  loop, K > 0: the base set plus the variants a CENSUS of programs used.
//   E3  threaded: every variant its own function, pc / steps / flags / slots
//       carried as parameters from one to the next by return_call_indirect.
//
// A slot's home -- the vreg it stands for -- is data (SLOTHOME), not code: the
// engine loads the slots from their homes on entry and stores them back
// before every return, which is what keeps BAIL's hand-over to the reference
// interpreter and EXIT's write-back exact.
// ---------------------------------------------------------------------------
const SLOTCH = '0123456789abcdef';
function patternOf(o, slots) {
  const e = EOP.get(o.name);
  let s = '';
  for (let k = 0; k < e.ops.length; k++) {
    const a = o.args[k];
    s += (e.ops[k] === 'v' && slots && slots.has(a.v)) ? SLOTCH[slots.get(a.v)] : 'm';
  }
  return s;
}
const variantKey = (o, slots) => `${o.name}:${patternOf(o, slots)}`;
const baseVariants = () => EOPS.map(e => `${e.name}:${'m'.repeat(e.ops.length)}`);

// The K hottest vregs by static use, a native fast body block (the loop the
// passes worked on) weighing HOT times anything else. Constants are vregs and
// qualify like any other.
function assignSlots(low, p, K, HOT = 16) {
  const n = new Map();
  for (const [id, b] of low.blocks) {
    if (!b.native) continue;
    const pb = p.blocks[id];
    const wgt = pb && pb.fast && pb.kind === 'body' ? HOT : 1;
    for (const o of b.ops) {
      const e = EOP.get(o.name);
      o.args.forEach((a, k) => { if (e.ops[k] === 'v') n.set(a.v, (n.get(a.v) || 0) + wgt); });
    }
  }
  const top = [...n].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, K).map(([v]) => v);
  return new Map(top.map((v, j) => [v, j]));
}

function encode(low, idOf) {
  if (low.nvTotal > MAXV - 1) throw new Error(`uop-wasm: ${low.nvTotal} vregs > ${MAXV - 1}`);
  const addr = new Map();
  let at = CODE;
  for (const [id, b] of low.blocks) {
    addr.set(id, at);
    for (const o of b.ops) at += 4 * (1 + o.args.length);
  }
  if (at > CODE_END) throw new Error(`uop-wasm: code ${at - CODE} bytes does not fit`);
  const words = new Int32Array((at - CODE) >> 2);
  let k = 0;
  for (const [, b] of low.blocks) {
    for (const o of b.ops) {
      words[k++] = idOf(o);
      for (const a of o.args) {
        if (a.v !== undefined) words[k++] = low.vbase + 4 * a.v;
        else if (a.t !== undefined) {
          if (!addr.has(a.t)) throw new Error(`uop-wasm: target B${a.t} not lowered`);
          words[k++] = addr.get(a.t);
        } else words[k++] = a.i;
      }
    }
  }
  return { words, addr };
}

const PARAMS = '(param $pc i32) (param $steps i32) (param $F i32) (param $lm i32) (param $vk i32)'
  + ' (param $spm i32) (param $shm i32) (param $smc i32) (result i32)';
const MACHINE = ['lm', 'vk', 'spm', 'shm', 'smc'];
const slotRange = (K) => Array.from({ length: K }, (_, j) => j);
const loadSlots = (K) => slotRange(K)
  .map(j => `(local.set $r${j} (i32.load (i32.load (i32.const ${SLOTHOME + 4 * j}))))`).join('\n');
const flushSlots = (K) => slotRange(K)
  .map(j => `(i32.store (i32.load (i32.const ${SLOTHOME + 4 * j})) (local.get $r${j}))`).join(' ');

// A loop engine's host calls, with every loop-carried local stored before the
// call and reloaded after it, so none of them is live across a call. The
// loop's locals are live around the whole loop, and a host call clobbers
// every register. Measured with SpiderMonkey Ion on arm64: once $run has two
// call sites (E1 has 175, in 79 VGA and port arms), the allocator stops
// splitting those ranges around the calls and keeps $pc and the machine
// params on the stack in EVERY arm. That is a $pc store and reload per µop,
// plus a param reload in each arm. A reload costs the call arms, which are
// already paying for a call.
// TOYVM_CALLSAFE=0 (or, in an engine shell, globalThis.TOYVM_CALLSAFE = '0')
// builds the old engine, for an A/B: arm-bench's and shell-bench's `@spill`.
const CALL_SAFE = globalThis.TOYVM_CALLSAFE !== '0'
  && (typeof process === 'undefined' || !process.env || process.env.TOYVM_CALLSAFE !== '0');
const CARRIED = ['pc', 'steps', 'F', ...MACHINE];
function callSafe(body, K) {
  if (!CALL_SAFE) return body;
  const vars = CARRIED.concat(slotRange(K).map((j) => `r${j}`));
  const save = vars.map((v, i) => `(i32.store (i32.const ${CALLSAVE + 4 * i}) (local.get $${v}))`).join(' ');
  const load = vars.map((v, i) => `(local.set $${v} (i32.load (i32.const ${CALLSAVE + 4 * i})))`).join(' ');
  let out = '', i = 0;
  for (let at; (at = body.indexOf('(call $', i)) >= 0;) {
    let d = 0, e = at;
    for (; e < body.length; e++) { if (body[e] === '(') d++; else if (body[e] === ')' && --d === 0) break; }
    const call = body.slice(at, e + 1);
    const fn = /^\(call \$(\w+)/.exec(call)[1];
    out += body.slice(i, at) + (fn === 'vga_wr8'
      ? `(block ${save} ${call} ${load})`
      : `(block (result i32) ${save} (local.set $cr ${call}) ${load} (local.get $cr))`);
    i = e + 1;
  }
  return out + body.slice(i);
}

// One variant's body, for a loop engine (`mode` 'loop') or a threaded one.
function variantBody(key, K, mode) {
  const [name, pat] = key.split(':');
  const e = EOP.get(name);
  const len = 4 * (1 + e.ops.length);
  const opnd = (k) => `(i32.load offset=${4 * (k + 1)} (local.get $pc))`;
  const slot = (k) => (pat[k] !== 'm' ? SLOTCH.indexOf(pat[k]) : -1);
  const slotArgs = slotRange(K).map(j => `(local.get $r${j})`).join(' ');
  const next = (pcExpr) => (mode === 'loop'
    ? `(local.set $pc ${pcExpr}) (br $L)`
    : `(local.set $pc ${pcExpr}) (return_call_indirect $tb (type $h) (local.get $pc) (local.get $steps)`
      + ` (local.get $F) ${slotArgs} (i32.load (local.get $pc)))`);
  const A = {
    V: (k) => (slot(k) >= 0 ? `(local.get $r${slot(k)})` : `(i32.load ${opnd(k)})`),
    I: (k) => opnd(k),
    SET: (k, x) => (slot(k) >= 0 ? `(local.set $r${slot(k)} ${x})`
      : k === 0 && e.dw ? dwStore(e, opnd(k), x) : `(i32.store ${opnd(k)} ${x})`),
    GOTO: (k) => next(opnd(k)),
  };
  if (e.dw && slot(0) >= 0) throw new Error(`uop-wasm: narrow ${name} into a slot`);
  let body = e.body(A);
  if (!isTerm(name)) body += ` ${next(`(i32.add (local.get $pc) (i32.const ${len}))`)}`;
  if (K) body = body.split('(return (i32.const').join(`${flushSlots(K)} (return (i32.const`);
  if (mode === 'loop') body = callSafe(body, K);
  if (mode !== 'loop') {
    for (const g of MACHINE) {
      body = body.split(`(local.get $${g})`).join(`(global.get $${g})`).split(`(local.set $${g} `).join(`(global.set $${g} `);
    }
  }
  return body;
}

function loopWat(keys, K) {
  const cases = keys.map(k => variantBody(k, K, 'loop'));
  let text = '(loop $L\n' + keys.map((_, i) => `(block $c${keys.length - 1 - i}`).join('') + '\n';
  if (E1_HIST) text += '(call $hist (i32.load (local.get $pc)))\n';
  text += `(br_table ${keys.map((_, i) => `$c${i}`).join(' ')} (i32.load (local.get $pc)))`;
  for (let i = 0; i < keys.length; i++) text += `)\n;; ${keys[i]}\n${cases[i]}`;
  text += '\n)\n(unreachable)';
  const slotLocals = slotRange(K).map(j => `(local $r${j} i32)`).join(' ');
  return `(module
(import "host" "memory" (memory ${isa.MEM_PAGES} ${isa.MEM_PAGES}))
${IO_IMPORT}
${E1_HIST ? '(import "host" "hist" (func $hist (param i32)))' : ''}
(func $run (export "run") ${PARAMS} (local $x i32) (local $l i32) (local $q i64) (local $y i32) (local $z i32) (local $cr i32) ${slotLocals}
${loadSlots(K)}
${text}
)
)`;
}

function threadWat(keys, K) {
  const sp = slotRange(K);
  const hParams = `(param $pc i32) (param $steps i32) (param $F i32) ${sp.map(j => `(param $r${j} i32)`).join(' ')}`;
  let s = `(module
(import "host" "memory" (memory ${isa.MEM_PAGES} ${isa.MEM_PAGES}))
${IO_IMPORT}
(type $h (func (param i32 i32 i32 ${sp.map(() => 'i32').join(' ')}) (result i32)))
${MACHINE.map(g => `(global $${g} (mut i32) (i32.const 0))`).join('\n')}
(table $tb ${keys.length} funcref)
(elem (i32.const 0) ${keys.map((_, i) => `$h${i}`).join(' ')})
`;
  keys.forEach((k, i) => {
    s += `;; ${k}\n(func $h${i} (type $h) ${hParams} (result i32) (local $x i32) (local $l i32) (local $q i64) (local $y i32) (local $z i32)\n${variantBody(k, K, 'thread')}\n(unreachable))\n`;
  });
  s += `(func $run (export "run") ${PARAMS} ${sp.map(j => `(local $r${j} i32)`).join(' ')}
${MACHINE.map(g => `(global.set $${g} (local.get $${g}))`).join('\n')}
${loadSlots(K)}
(call_indirect $tb (type $h) (local.get $pc) (local.get $steps) (local.get $F) ${sp.map(j => `(local.get $r${j})`).join(' ')} (i32.load (local.get $pc))))
)`;
  return s;
}


// ---------------------------------------------------------------------------
// Straight wasm: one function for one program (the bench's upper bound).
// ---------------------------------------------------------------------------
function straightWat(low) {
  const ids = [...low.blocks.keys()];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const constOf = new Map([...low.consts].map(([x, v]) => [v, x]));
  const V = (a) => (constOf.has(a.v) ? `(i32.const ${constOf.get(a.v)})` : `(local.get $v${a.v})`);
  let text = `(loop $L\n${ids.map((_, i) => `(block $c${ids.length - 1 - i}`).join('')}\n`;
  text += `(br_table ${ids.map((_, i) => `$c${i}`).join(' ')} (local.get $pc))`;
  for (const id of ids) {
    const b = low.blocks.get(id);
    text += `)\n;; B${id}\n`;
    for (const o of b.ops) {
      const e = EOP.get(o.name);
      const A = {
        V: (k) => V(o.args[k]),
        I: (k) => `(i32.const ${o.args[k].i})`,
        SET: (k, x) => {
          const L = `$v${o.args[k].v}`;
          if (k !== 0 || !e.dw) return `(local.set ${L} ${x})`;
          return `(local.set ${L} (i32.or (i32.and (local.get ${L}) (i32.const ${DWKEEP[e.dw]})) ${dwPut(e.dw, x)}))`;
        },
        GOTO: (k) => `(local.set $pc (i32.const ${idx.get(o.args[k].t)})) (br $L)`,
      };
      text += e.body(A) + '\n';
    }
  }
  text += ')\n(unreachable)';
  const locals = [];
  for (let v = 0; v < low.nvTotal; v++) if (!constOf.has(v)) locals.push(`(local $v${v} i32)`);
  // vregs start from the memory file (the E1 layout) so both arms share entry state
  const init = [];
  for (let v = 0; v < low.nvTotal; v++) if (!constOf.has(v)) init.push(`(local.set $v${v} (i32.load (i32.const ${low.vbase + 4 * v})))`);
  const flush = [];
  for (let v = 0; v < low.nvTotal; v++) if (!constOf.has(v)) flush.push(`(i32.store (i32.const ${low.vbase + 4 * v}) (local.get $v${v}))`);
  // bail/exit must leave the vreg file in memory for the reference interpreter
  text = text.replace(/\(return \(i32\.const ([01])\)\)/g, `(block ${flush.join(' ')}) (return (i32.const $1))`);
  return { wat: `(module
(import "host" "memory" (memory ${isa.MEM_PAGES} ${isa.MEM_PAGES}))
${IO_IMPORT}
(func $run (export "run") ${PARAMS} ${LOCALS} ${locals.join(' ')}
${init.join('\n')}
${text}
)
)`, index: idx };
}

// The engines' imports: the vm's memory, and L1's port read for PIN (a vm
// built without it -- a unit harness -- fails the first PIN, never silently).
const IO_IMPORT = '(import "host" "io_in" (func $io_in (param i32 i32 i32) (result i32)))'
  + '\n(import "host" "io_out" (func $io_out (param i32 i32 i32 i32) (result i32)))'
  + '\n(import "host" "vga_rd8" (func $vga_rd8 (param i32) (result i32)))'
  + '\n(import "host" "vga_wr8" (func $vga_wr8 (param i32 i32)))';
// TOYVM_E1HIST=1: a DYNAMIC µop census. Every loop engine calls `hist` with
// the op it is about to dispatch, and e1Hist() returns how often each op and
// each op->op pair ran: the fusion candidates, weighted by execution rather
// than by how often a pattern appears in programs. The call per µop makes the
// engine slow and changes its register allocation, so a counting run is never
// a timing run. Off, the engine's WAT does not change.
const E1_HIST = typeof process !== 'undefined' && !!process.env && process.env.TOYVM_E1HIST === '1';
const HIST_N = 1024;
const hist = { ops: new Float64Array(HIST_N), pairs: new Float64Array(HIST_N * HIST_N), prev: 0 };
function histNote(op) {
  hist.ops[op]++;
  hist.pairs[hist.prev * HIST_N + op]++;
  hist.prev = op;
}
// The census so far, with op ids named as E1's base variants.
function e1Hist() {
  const name = (i) => (EOPS[i] ? EOPS[i].name : `#${i}`);
  const ops = [], pairs = [];
  for (let i = 0; i < HIST_N; i++) if (hist.ops[i]) ops.push([name(i), hist.ops[i]]);
  for (let i = 0; i < HIST_N * HIST_N; i++) if (hist.pairs[i]) pairs.push([`${name(Math.floor(i / HIST_N))} ${name(i % HIST_N)}`, hist.pairs[i]]);
  return { ops: ops.sort((a, b) => b[1] - a[1]), pairs: pairs.sort((a, b) => b[1] - a[1]) };
}
const hostOf = (vm) => ({
  ...(E1_HIST ? { hist: histNote } : {}),
  memory: vm.memory,
  io_in: vm.exports.io_in || (() => { throw new Error('uop-wasm: this vm has no io_in'); }),
  io_out: vm.exports.io_out || (() => { throw new Error('uop-wasm: this vm has no io_out'); }),
  vga_rd8: vm.exports.uop_vga_rd8 || (() => { throw new Error('uop-wasm: this vm has no uop_vga_rd8'); }),
  vga_wr8: vm.exports.uop_vga_wr8 || (() => { throw new Error('uop-wasm: this vm has no uop_vga_wr8'); }),
});

const LOCALS = '(local $x i32) (local $l i32) (local $q i64) (local $y i32) (local $z i32)';

async function compile(name, wat) {
  const file = `${name}.wat`;
  const bytes = await compileWat((f) => { if (f !== file) throw new Error(`unexpected ${f}`); return wat; },
    { files: [file], cacheKey: `uop-wasm:${name}:${require('crypto').createHash('sha256').update(wat).digest('hex').slice(0, 16)}` });
  return bytes;
}

// Compiled engine modules by their WAT text: E1's is one module for every
// program, E2/E3 are one per variant set.
const modules = new Map();
async function engineModule(name, wat) {
  let m = modules.get(wat);
  if (!m) { m = WebAssembly.compile(await compile(name, wat)); modules.set(wat, m); }
  return m;
}

function e1Wat() { return loopWat(baseVariants(), 0); }
function encodeE1(low) { return encode(low, (o) => EOP.get(o.name).id); }

// An interpreted engine for program p: 'e1' (loop, no slots), 'e2' (loop with
// K slots), 'e3' (threaded with K slots). The variant set is the base set plus
// whatever this program's slot assignment uses -- a census of one program.
async function interpEngine(vm, low, p, kind, K) {
  if (kind === 'e1') K = 0;
  if (K > KMAX) throw new Error(`uop-wasm: K ${K} > ${KMAX}`);
  if (K && low.resident) throw new Error('uop-wasm: slots over a resident vreg file are not implemented');
  const slots = K ? assignSlots(low, p, K) : new Map();
  const keys = baseVariants();
  const index = new Map(keys.map((k, i) => [k, i]));
  if (K) {
    for (const [, b] of low.blocks) {
      if (!b.native) continue;
      for (const o of b.ops) {
        const k = variantKey(o, slots);
        if (!index.has(k)) { index.set(k, keys.length); keys.push(k); }
      }
    }
  }
  const wat = kind === 'e3' ? threadWat(keys, K) : loopWat(keys, K);
  const mod = await engineModule(`uop-${kind}`, wat);
  const inst = await WebAssembly.instantiate(mod, { host: hostOf(vm) });
  const { words, addr } = encode(low, (o) => index.get(variantKey(o, slots)));
  const homes = new Int32Array(KMAX).fill(OUT + 12);
  for (const [v, j] of slots) homes[j] = low.vbase + 4 * v;
  const install = () => {
    new Int32Array(vm.memory.buffer, CODE, words.length).set(words);
    new Int32Array(vm.memory.buffer, SLOTHOME, KMAX).set(homes);
    const vf = new Int32Array(vm.memory.buffer, low.vbase, low.nvTotal);
    for (const [x, v] of low.consts) vf[v] = x;
  };
  return { run: inst.exports.run, target: (bid) => addr.get(bid), install,
    info: { K, slots: slots.size, variants: keys.length, wasmBytes: 0 } };
}

// Which program's code and constants are in the engine page of each memory
// right now. The page holds one program at a time, so a live run with several
// installs a program again only when the one it is entering is not the last.
const resident = new WeakMap();

// An `enter(vm, left)` for uop-harness.js runArm and the live session: runs
// program p with the chosen engine, handing BAIL blocks to the reference
// interpreter.
async function makeEnter(vm, p, kind = 'e1', stats = null, o = {}) {
  const low = lowerProgram(p);
  let run, target, install;
  // 'e2' / 'e3' take 8 slots; 'e2k4' names the slot count
  const km = /^(e[123])(?:k(\d+))?$/.exec(kind);
  if (km) {
    const K = km[2] !== undefined ? Number(km[2]) : (o.K === undefined ? 8 : o.K);
    const eng = await interpEngine(vm, low, p, km[1], K);
    ({ run, target, install } = eng);
    if (stats) stats.info = eng.info;
  } else if (kind === 'straight') {
    const { wat, index } = straightWat(low);
    const inst = await WebAssembly.instantiate(await engineModule('uop-straight', wat), { host: hostOf(vm) });
    install = () => {
      const vf = new Int32Array(vm.memory.buffer, low.vbase, low.nvTotal);
      for (const [x, v] of low.consts) vf[v] = x;
    };
    run = inst.exports.run;
    target = (bid) => index.get(bid);
  } else throw new Error(`uop-wasm: engine ${kind}`);
  return enterOver(vm, p, low, { run, target, install }, stats);
}

// E1 for a live run. Its module depends on the op table alone, so it is
// compiled and instantiated ONCE, up front; after that a program is data --
// lowered, encoded and written into the engine page -- and nothing about
// installing one more is asynchronous or generates wasm.
async function e1Runner(vm) {
  const mod = await engineModule('uop-e1', e1Wat());
  return (await WebAssembly.instantiate(mod, { host: hostOf(vm) })).exports.run;
}
function e1Enter(vm, p, run, stats = null) {
  const low = lowerProgram(p, { fallthrough: true });
  const { words, addr } = encodeE1(low);
  const install = () => {
    new Int32Array(vm.memory.buffer, CODE, words.length).set(words);
    const vf = new Int32Array(vm.memory.buffer, low.vbase, low.nvTotal);
    for (const [x, v] of low.consts) vf[v] = x;
  };
  return enterOver(vm, p, low, { run, target: (bid) => addr.get(bid), install }, stats);
}

function enterOver(vm, p, low, { run, target, install }, stats) {
  const native = new Set([...low.blocks].filter(([, b]) => b.native).map(([id]) => id));
  const token = {};
  let seen = scribbles();
  const put = () => { install(); resident.set(vm.memory, token); seen = scribbles(); };
  put();
  if (stats) { stats.install = put; stats.low = low; stats.prog = p; stats.native = native; stats.bails = 0; stats.bailAt = new Map(); }
  const vfile = new Int32Array(vm.memory.buffer, low.vbase, low.nvTotal);
  const outv = new Int32Array(vm.memory.buffer, OUT, 4);
  // Made once, like the two views above. The memory never grows (dos-loop
  // creates it with initial === maximum), so the buffer this is bound to is
  // the one every entry reads -- and a `new DataView` per entry is an
  // allocation on the entry path, which is the path this tier is trying to
  // make cheap.
  const dv = new DataView(vm.memory.buffer);
  const ex = vm.exports;
  return (vm2, left) => {
    if (resident.get(vm.memory) !== token || (low.resident && scribbles() !== seen)) put();
    ex.set_steps(left);
    let steps = left | 0;
    let F = ex.get_flags() >>> 0;
    const lm = ex.mget_linmask() | 0;
    const spm = ex.mget_spm() | 0, shm = ex.mget_shmask() | 0;
    let bid = low.entry;
    for (;;) {
      if (native.has(bid)) {
        // The key is read at every entry, not once: a port write in the part
        // of the run just done (by E1 or by a bail's reference run) can have
        // turned planar mode on, and a stale key makes VGA plain memory.
        const code = run(target(bid), steps, F, lm, dv.getInt32(isa.VGA_CTL_KEY, true), spm, shm, ex.get_smc() | 0);
        steps = outv[0]; F = outv[1] >>> 0;
        if (code === 0) {
          ex.set_steps(steps);
          ex.set_flags(F);
          ex.set_gip(outv[2] >>> 0);
          return steps;
        }
        bid = outv[2];
      }
      if (stats) { stats.bails++; if (stats.bailAt) stats.bailAt.set(bid, (stats.bailAt.get(bid) || 0) + 1); }
      const r = runRef(vm2, p, { start: bid, v: vfile, steps, flags: F, stopAt: native });
      if (r.exit === 'go') return r.steps;
      bid = r.bid; steps = r.steps; F = r.flags >>> 0;
    }
  };
}

// ---------------------------------------------------------------------------
// E1 arena: many resident programs in the engine at once, chained.
// ---------------------------------------------------------------------------
// The one-program page (e1Enter) is written again every time a live run
// enters a different head, and every program exit goes back through JS and
// the session before the next program can start. The arena keeps every
// installed program's code at its own address for as long as it lives, and
// lowers a program's static exits as `link`s: a word that names the program
// installed at that ip, patched when one is (setHead) or goes away (dropHead).
// A chain is taken inside the engine, as L1 takes a GO through its jump table.
//
// Resident programs only: a chain carries no vreg state but the guest's
// registers, and those are L1's register file itself. Temporaries are shared
// (dead across an exit, which is the only place a chain happens); a program's
// constants go in a pool behind its code, so no program overwrites another's.
// The reference interpreter reads constants from the vreg file, so a bail
// writes the bailing program's there first.
//
// Block ids handed back to JS (bail, ldf/stf) are handles: each program owns
// the range [base, base + blocks) and `owner` maps a handle back to it.
class E1Arena {
  constructor(vm, run) {
    this.vm = vm;
    this.run = run;
    this.at = ARENA;
    this.progs = [];
    this.nextHandle = 1;
    this.owner = [];
    this.heads = new Map();      // link key -> program installed there
    this.inbound = new Map();    // link key -> [{ from, t, id }]
    this.epoch = 0;              // bumped whenever a link word changes
    this.w = new Int32Array(vm.memory.buffer);
    this.outv = new Int32Array(vm.memory.buffer, OUT, 4);
    this.dv = new DataView(vm.memory.buffer);
    this.chains = 0;
    this.last = null;
    this.dueExits = 0;
    this.exits = new Map();      // `${program id}:${gip}` -> times a run left there
    // uop-live reads `exits` to find its next head; uop-only never does, and
    // the string key per exit is a real share of a µop-only run.
    this.noteExits = true;
  }

  // Only an exit with budget left and no code written is a place a run could
  // have gone on; the rest end the slice wherever they are.
  noteExit(rec, gip, steps) {
    if (steps < 0 || (this.vm.exports.get_smc() | 0)) { this.dueExits++; return; }
    const k = `${rec.id}:${gip}`;
    this.exits.set(k, (this.exits.get(k) || 0) + 1);
  }

  room() { return ARENA_END - this.at; }

  // Lower and encode p (resident, built for `key` -- a head key with its
  // linear mask) into the arena. Throws when it does not fit.
  // With `count`, the program's first word is a counter its loop headers
  // bump (rec.cnt), for a tier-up to read.
  add(p, key, stats = null, { count = false } = {}) {
    const start = this.at + (count ? 16 : 0);
    const low = lowerProgram(p, { link: true, count: count ? this.at : 0, fallthrough: true });
    if (!low.resident) throw new Error('uop-wasm: an arena program is resident');
    if (low.nvTotal > MAXV - 1) throw new Error(`uop-wasm: ${low.nvTotal} vregs > ${MAXV - 1}`);
    const constOf = new Map([...low.consts].map(([x, v]) => [v, x]));
    const addr = new Map();
    let at = start, nb = 0;
    for (const [id, b] of low.blocks) {
      addr.set(id, at);
      nb = Math.max(nb, id + 1);
      for (const o of b.ops) at += 4 * (1 + o.args.length);
    }
    const pool = at;
    const poolAt = new Map();
    for (const v of constOf.keys()) { poolAt.set(v, at); at += 4; }
    if (at > ARENA_END) throw new Error(`uop-wasm: arena full (${at - ARENA} bytes)`);
    const id = this.progs.length, base = this.nextHandle;
    const rec = { id, p, low, key, base, addr, native: new Set(), links: [], live: true, stats,
      entry: 0, codeFrom: this.at, codeTo: at, h: null, cnt: count ? this.at : 0 };
    const w = this.w;
    if (count) w[this.at >> 2] = 0;
    let k = start >> 2;
    for (const [bid, b] of low.blocks) {
      if (b.native) rec.native.add(bid);
      for (const o of b.ops) {
        w[k++] = EOP.get(o.name).id;
        for (const a of o.args) {
          if (a.v !== undefined) w[k++] = constOf.has(a.v) ? poolAt.get(a.v) : VFILE + 4 * a.v;
          else if (a.t !== undefined) {
            if (!addr.has(a.t)) throw new Error(`uop-wasm: target B${a.t} not lowered`);
            w[k++] = addr.get(a.t);
          } else if (a.link !== undefined) {
            // A far exit's link names the other segment's key: its code base
            // under this one's mask (real/V86 keys are `base|mask`).
            const lk = a.cb === undefined ? `${key}:${a.link}` : `${a.cb}${key.slice(key.indexOf('|'))}:${a.link}`;
            rec.links.push({ from: rec, lk, t: k, id: k + 1 });
            w[k++] = 0;
          } else w[k++] = a.bid ? base + a.i : a.i;
        }
      }
    }
    for (const [v, x] of constOf) w[poolAt.get(v) >> 2] = x;
    this.at = (at + 15) & ~15;
    this.nextHandle += nb;
    for (let hd = base; hd < base + nb; hd++) this.owner[hd] = id;
    this.progs.push(rec);
    rec.entry = rec.native.has(low.entry) ? addr.get(low.entry) : 0;
    for (const L of rec.links) {
      let list = this.inbound.get(L.lk);
      if (!list) this.inbound.set(L.lk, list = []);
      list.push(L);
      const to = this.heads.get(L.lk);
      if (to) this.patch(L, to);
    }
    if (stats) { stats.low = low; stats.prog = p; stats.native = rec.native; stats.bails = 0; stats.bailAt = new Map(); }
    return rec;
  }

  patch(L, to) {
    const t = to && to.live && to.entry ? to.entry : 0;
    if (this.w[L.t] === t) return;
    this.w[L.t] = t;
    this.w[L.id] = t ? to.id : 0;
    this.epoch++;
  }

  // rec is the program at its head ip: every link to that ip now goes there.
  setHead(rec, ip) {
    const lk = `${rec.key}:${ip}`;
    this.heads.set(lk, rec);
    for (const L of this.inbound.get(lk) || []) if (L.from.live) this.patch(L, rec);
  }

  // The program at this head is gone (demoted, rebuilt, bytes changed): no
  // link may enter it. Its own code stays where it is, unreachable, and its
  // outbound links leave the index.
  dropHead(rec, ip, dead = true) {
    const lk = `${rec.key}:${ip}`;
    if (this.heads.get(lk) === rec) this.heads.delete(lk);
    for (const L of this.inbound.get(lk) || []) if (this.w[L.t] === rec.entry) this.patch(L, null);
    if (!dead) return;
    rec.live = false;
    for (const L of rec.links) {
      const list = this.inbound.get(L.lk);
      if (list) this.inbound.set(L.lk, list.filter((x) => x.from !== rec));
    }
  }

  // Every program a run entered at rec can reach through taken links.
  closure(rec) {
    if (rec.closureAt === this.epoch) return rec.closureSet;
    const seen = new Set([rec]), st = [rec];
    while (st.length) {
      const r = st.pop();
      for (const L of r.links) {
        if (!this.w[L.t]) continue;
        const to = this.progs[this.w[L.id]];
        if (!seen.has(to)) { seen.add(to); st.push(to); }
      }
    }
    rec.closureAt = this.epoch;
    rec.closureSet = [...seen];
    return rec.closureSet;
  }

  // Run the slice from rec's entry. Returns the steps left, like enterOver;
  // this.last is the program the run left from.
  enter(rec, left) {
    const vm = this.vm, ex = vm.exports, w = this.w, outv = this.outv;
    ex.set_steps(left);
    this.lineExit = false;
    let steps = left | 0;
    let F = ex.get_flags() >>> 0;
    const lm = ex.mget_linmask() | 0, dv = this.dv;
    const spm = ex.mget_spm() | 0, shm = ex.mget_shmask() | 0;
    let cur = rec, pc = rec.entry, handle = rec.base + rec.low.entry;
    for (;;) {
      if (pc) {
        w[LASTP >> 2] = cur.id;
        // The VGA key is read at every entry (see enterOver).
        const code = this.run(pc, steps, F, lm, dv.getInt32(isa.VGA_CTL_KEY, true), spm, shm, ex.get_smc() | 0);
        steps = outv[0]; F = outv[1] >>> 0;
        const lastId = w[LASTP >> 2];
        if (lastId !== cur.id) { this.chains++; cur = this.progs[lastId]; }
        if (code === 0) {
          ex.set_steps(steps);
          ex.set_flags(F);
          ex.set_gip(outv[2] >>> 0);
          this.last = cur;
          this.lineExit = w[LINEX >> 2] === 1;
          if (this.noteExits) this.noteExit(cur, outv[2] >>> 0, steps);
          return steps;
        }
        handle = outv[2];
      }
      cur = this.progs[this.owner[handle]];
      const bid = handle - cur.base;
      const st = cur.stats;
      if (st) { st.bails++; st.bailAt.set(bid, (st.bailAt.get(bid) || 0) + 1); }
      const vfile = new Int32Array(vm.memory.buffer, VFILE, cur.low.nvTotal);
      for (const [x, v] of cur.low.consts) vfile[v] = x;
      const r = runRef(vm, cur.p, { start: bid, v: vfile, steps, flags: F, stopAt: cur.native });
      if (r.exit === 'go') { this.last = cur; this.lineExit = r.why === 'line'; if (this.noteExits) this.noteExit(cur, r.ip, r.steps); return r.steps; }
      pc = cur.addr.get(r.bid); steps = r.steps; F = r.flags >>> 0;
    }
  }
}


module.exports = { e1Hist, EFFECT, CF_READERS, EOPS, lowerProgram, encode, encodeE1, e1Runner, e1Enter, e1Wat, loopWat, threadWat, assignSlots, straightWat, makeEnter, VBASE, CODE, E1Arena };
