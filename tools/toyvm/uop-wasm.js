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

const path = require('path');
const isa = require('./isa');
const { FBIT } = require('./uop-ir');
const { runRef } = require('./uop-ref');
const { compileWat } = require(path.join(__dirname, '..', '..', 'lib', 'compile-wat.js'));

const TOP = isa.MEM_PAGES << 16;
const OUT = (isa.DEC_END + 15) & ~15;       // steps, flags, ip / block id
const KMAX = 16;
const SLOTHOME = OUT + 16;                   // per local slot: the vreg address it stands for
const VBASE = SLOTHOME + 4 * KMAX;
const MAXV = 2048;
const CODE = VBASE + 4 * MAXV;
const CODE_END = TOP;

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
def('exit', 'ivi', ({ V, I }) => `(local.set $steps (i32.add (local.get $steps) ${I(0)}))`
  + `(i32.store (i32.const ${OUT + 8}) (i32.add ${V(1)} ${I(2)}))`
  + `(i32.store (i32.const ${OUT}) (local.get $steps)) (i32.store (i32.const ${OUT + 4}) (local.get $F))`
  + '(return (i32.const 0))');
// bail: block id; the reference interpreter runs it
def('bail', 'i', ({ I }) => `(i32.store (i32.const ${OUT + 8}) ${I(0)})`
  + `(i32.store (i32.const ${OUT}) (local.get $steps)) (i32.store (i32.const ${OUT + 4}) (local.get $F))`
  + '(return (i32.const 1))');

const EOP = new Map(EOPS.map((e, i) => [e.name, { ...e, id: i }]));
const isTerm = (name) => /^(jmp|jmpc|jmpx|bcc_|bccx_|exit|bail)/.test(name);

// ---------------------------------------------------------------------------
// Lowering: µop program -> per block, a list of { name, args } where an arg is
// { v: vreg } | { i: number } | { t: block id }.
// ---------------------------------------------------------------------------
class Unsupported extends Error {}

function lowerProgram(p) {
  const nv = p.nv;
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
  const opt = (x) => (x !== undefined && x >= 0 ? vr(x) : K(0));
  const mask = (w) => (w === 32 ? -1 : (1 << w) - 1);

  const lowerOp = (op, out) => {
    const E = (name, ...args) => out.push({ name, args });
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
        if (op.chk === 'full') throw new Unsupported('full memory');
        const guard = op.chk === 'guard';
        const general = op.c !== undefined && op.c >= 0;
        const am = op.am ? op.am | 0 : -1;
        const first = op.o === 'ld' ? vr(op.d) : vr(op.b);
        const addrArgs = general ? [opt(op.a), vr(op.c), im(op.sc | 0), im(op.i | 0), im(am)] : [opt(op.a), im(op.i | 0), im(am)];
        const name = `${op.o}${guard ? '' : 'n'}${op.w}${general ? 'g' : 'a'}`;
        return E(name, first, vr(op.s), ...addrArgs, ...(guard ? [tg(op.dx)] : []));
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
      return E('exit', im(t.adj | 0), t.ipv !== undefined && t.ipv >= 0 ? vr(t.ipv) : K(0),
        im(t.ipv !== undefined && t.ipv >= 0 ? 0 : t.ip));
    }
    throw new Unsupported(`term ${t.o}`);
  };

  const blocks = new Map();
  const why = new Map();
  for (const b of p.blocks) {
    if (!b || b.kind === 'dead' || !b.term) continue;
    const out = [];
    const E = (name, ...args) => out.push({ name, args });
    try {
      for (const op of b.ops) lowerOp(op, out);
      lowerTerm(b.term, E);
      blocks.set(b.id, { native: true, ops: out });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      why.set(e.message, (why.get(e.message) || 0) + 1);
      blocks.set(b.id, { native: false, why: e.message, ops: [{ name: 'bail', args: [im(b.id)] }] });
    }
  }
  return { blocks, nvTotal: next, consts, why, entry: p.entry };
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
        if (a.v !== undefined) words[k++] = VBASE + 4 * a.v;
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
    SET: (k, x) => (slot(k) >= 0 ? `(local.set $r${slot(k)} ${x})` : `(i32.store ${opnd(k)} ${x})`),
    GOTO: (k) => next(opnd(k)),
  };
  let body = e.body(A);
  if (!isTerm(name)) body += ` ${next(`(i32.add (local.get $pc) (i32.const ${len}))`)}`;
  if (K) body = body.split('(return (i32.const').join(`${flushSlots(K)} (return (i32.const`);
  if (mode !== 'loop') for (const g of MACHINE) body = body.split(`(local.get $${g})`).join(`(global.get $${g})`);
  return body;
}

function loopWat(keys, K) {
  const cases = keys.map(k => variantBody(k, K, 'loop'));
  let text = '(loop $L\n' + keys.map((_, i) => `(block $c${keys.length - 1 - i}`).join('') + '\n';
  text += `(br_table ${keys.map((_, i) => `$c${i}`).join(' ')} (i32.load (local.get $pc)))`;
  for (let i = 0; i < keys.length; i++) text += `)\n;; ${keys[i]}\n${cases[i]}`;
  text += '\n)\n(unreachable)';
  const slotLocals = slotRange(K).map(j => `(local $r${j} i32)`).join(' ');
  return `(module
(import "host" "memory" (memory ${isa.MEM_PAGES} ${isa.MEM_PAGES}))
(func $run (export "run") ${PARAMS} (local $x i32) (local $l i32) (local $q i64) ${slotLocals}
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
(type $h (func (param i32 i32 i32 ${sp.map(() => 'i32').join(' ')}) (result i32)))
${MACHINE.map(g => `(global $${g} (mut i32) (i32.const 0))`).join('\n')}
(table $tb ${keys.length} funcref)
(elem (i32.const 0) ${keys.map((_, i) => `$h${i}`).join(' ')})
`;
  keys.forEach((k, i) => {
    s += `;; ${k}\n(func $h${i} (type $h) ${hParams} (result i32) (local $x i32) (local $l i32) (local $q i64)\n${variantBody(k, K, 'thread')}\n(unreachable))\n`;
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
        SET: (k, x) => `(local.set $v${o.args[k].v} ${x})`,
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
  for (let v = 0; v < low.nvTotal; v++) if (!constOf.has(v)) init.push(`(local.set $v${v} (i32.load (i32.const ${VBASE + 4 * v})))`);
  const flush = [];
  for (let v = 0; v < low.nvTotal; v++) if (!constOf.has(v)) flush.push(`(i32.store (i32.const ${VBASE + 4 * v}) (local.get $v${v}))`);
  // bail/exit must leave the vreg file in memory for the reference interpreter
  text = text.replace(/\(return \(i32\.const ([01])\)\)/g, `(block ${flush.join(' ')}) (return (i32.const $1))`);
  return { wat: `(module
(import "host" "memory" (memory ${isa.MEM_PAGES} ${isa.MEM_PAGES}))
(func $run (export "run") ${PARAMS} ${LOCALS} ${locals.join(' ')}
${init.join('\n')}
${text}
)
)`, index: idx };
}

const LOCALS = '(local $x i32) (local $l i32) (local $q i64)';

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
  const inst = await WebAssembly.instantiate(mod, { host: { memory: vm.memory } });
  const { words, addr } = encode(low, (o) => index.get(variantKey(o, slots)));
  const homes = new Int32Array(KMAX).fill(OUT + 12);
  for (const [v, j] of slots) homes[j] = VBASE + 4 * v;
  const install = () => {
    new Int32Array(vm.memory.buffer, CODE, words.length).set(words);
    new Int32Array(vm.memory.buffer, SLOTHOME, KMAX).set(homes);
    const vf = new Int32Array(vm.memory.buffer, VBASE, low.nvTotal);
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
    const inst = await WebAssembly.instantiate(await engineModule('uop-straight', wat), { host: { memory: vm.memory } });
    install = () => {
      const vf = new Int32Array(vm.memory.buffer, VBASE, low.nvTotal);
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
  return (await WebAssembly.instantiate(mod, { host: { memory: vm.memory } })).exports.run;
}
function e1Enter(vm, p, run, stats = null) {
  const low = lowerProgram(p);
  const { words, addr } = encodeE1(low);
  const install = () => {
    new Int32Array(vm.memory.buffer, CODE, words.length).set(words);
    const vf = new Int32Array(vm.memory.buffer, VBASE, low.nvTotal);
    for (const [x, v] of low.consts) vf[v] = x;
  };
  return enterOver(vm, p, low, { run, target: (bid) => addr.get(bid), install }, stats);
}

function enterOver(vm, p, low, { run, target, install }, stats) {
  const native = new Set([...low.blocks].filter(([, b]) => b.native).map(([id]) => id));
  const token = {};
  const put = () => { install(); resident.set(vm.memory, token); };
  put();
  if (stats) { stats.install = put; stats.low = low; stats.prog = p; stats.native = native; stats.bails = 0; stats.bailAt = new Map(); }
  const vfile = new Int32Array(vm.memory.buffer, VBASE, low.nvTotal);
  const outv = new Int32Array(vm.memory.buffer, OUT, 4);
  // Made once, like the two views above. The memory never grows (dos-loop
  // creates it with initial === maximum), so the buffer this is bound to is
  // the one every entry reads -- and a `new DataView` per entry is an
  // allocation on the entry path, which is the path this tier is trying to
  // make cheap.
  const dv = new DataView(vm.memory.buffer);
  const ex = vm.exports;
  return (vm2, left) => {
    if (resident.get(vm.memory) !== token) put();
    ex.set_steps(left);
    let steps = left | 0;
    let F = ex.get_flags() >>> 0;
    const lm = ex.mget_linmask() | 0, vk = dv.getInt32(isa.VGA_CTL_KEY, true);
    const spm = ex.mget_spm() | 0, shm = ex.mget_shmask() | 0;
    let bid = low.entry;
    for (;;) {
      if (native.has(bid)) {
        const code = run(target(bid), steps, F, lm, vk, spm, shm, ex.get_smc() | 0);
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

module.exports = { EOPS, lowerProgram, encode, encodeE1, e1Runner, e1Enter, e1Wat, loopWat, threadWat, assignSlots, straightWat, makeEnter, VBASE, CODE };
