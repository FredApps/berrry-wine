'use strict';

// Snapshots and the differential runner for the micro-op tier.
//
// A differential run is two ARMS started from one snapshot of a real program,
// taken with the guest standing at a loop head:
//
//   L1   the shipped interpreter, entering the head through the block cache.
//   µop  the same, except that whenever the host is about to enter the head
//        it runs the micro-op program there instead (the JS reference
//        interpreter, or a wasm engine), and the interpreter takes over at
//        whatever exit the program leaves by.
//
// Both arms get the same total budget and stop at the same kind of event:
// the budget spent (the first transfer with $steps < 0, exactly where L1's own
// slice would have ended), a guest interrupt reaching the host's stub, or a
// self-modify break. Nothing else of the host runs -- no IRQs, no interrupt
// service, no slice grid -- so the two arms see the identical machine and any
// difference in the final registers, flags, memory, gip or unspent budget is
// the program's.
//
// Flags are compared under a liveness mask read off the code at the final
// gip: L1 itself leaves dead flags uncomputed (its dead-flag elimination), so
// a flag nobody reads can legitimately differ between two correct arms.

const crypto = require('crypto');
const isa = require('./isa');
const { STATE, MACHINE_STATE } = require('./emit');
const { CodeCache } = require('./dos-loop');
const { STUB_SEG } = require('./dos');
const { discover, liveFlagsAt, FBIT } = require('./uop-ir');

// Harness globals that describe the ARENA or the run loop, not the guest.
const NOT_GUEST = new Set(['ip', 'steps', 'left', 'rtop', 'halt', 'exitwhy', 'intno', 'irqwant',
  'dosticks', 'curpsp', 'intfast', 'intfastn', 'mousex', 'mousey', 'mousebtn', 'mousereads',
  'edgelook', 'smclo', 'smchi']);

function envOf(vm) {
  const ex = vm.exports;
  const d32 = ex.get_d32() !== 0;
  const ip32 = d32 || ((ex.get_cr0() & 1) !== 0 && !ex.get_vm86());
  return { cs: vm.get('cs'), codeBase: ex.get_csb() >>> 0, mask: ex.get_linmask() >>> 0, d32, ip32 };
}

function snapshot(vm, extra = {}) {
  const s = { mem: vm.mem.slice(), regs: {}, machine: {}, env: envOf(vm), ...extra };
  for (const g of STATE) if (vm.exports[`get_${g}`]) s.regs[g] = vm.raw(g);
  for (const g of MACHINE_STATE) if (vm.exports[`mget_${g}`]) s.machine[g] = vm.exports[`mget_${g}`]();
  return s;
}

// Put the machine back exactly as the snapshot had it, with an empty code
// cache: the arena, the jump table and the shadow return stack are the
// profiling run's, and would link into blocks this arm never compiled.
function seed(vm, s, cacheOpts = {}) {
  vm.mem.set(s.mem);
  for (const [g, v] of Object.entries(s.machine)) vm.exports[`mset_${g}`](v);
  for (const [g, v] of Object.entries(s.regs)) {
    if (g === 'flags') continue;
    if (vm.exports[`set_${g}`]) vm.exports[`set_${g}`](v);
  }
  vm.exports.set_flags(s.regs.flags);
  const cache = new CodeCache(vm, cacheOpts);
  new Int32Array(vm.mem.buffer, isa.JTAB_BASE, isa.JTAB_SIZE >> 2).fill(0);
  vm.set('rtop', 0);
  vm.exports.set_smc(0);
  if (vm.exports.set_edgelook) vm.exports.set_edgelook(1);
  if (vm.exports.set_intfast) vm.exports.set_intfast(0);
  if (vm.exports.set_irqwant) vm.exports.set_irqwant(0);
  return cache;
}

// Run one arm for `budget` dispatches. `enter(vm)` -- when given -- is called
// whenever the host stands at the program's head, and returns the budget left
// after the program exits (it leaves $gip and the machine at the exit).
function runArm(vm, cache, budget, { head = null, enter = null, maxHandbacks = 200000 } = {}) {
  let left = budget;
  let handbacks = 0, entries = 0, why = 'budget';
  for (;;) {
    if (left < 0) { why = 'budget'; break; }
    const cs = vm.get('cs');
    if (cs === STUB_SEG) { why = 'int'; break; }
    if (vm.exports.get_smc()) { why = 'smc'; break; }
    const env = envOf(vm);
    const ip = vm.raw('gip') >>> 0;
    if (enter && head && env.codeBase === head.codeBase && ip === head.ip) {
      left = enter(vm, left);
      entries++;
      continue;
    }
    const entry = cache.entryFor(cs, ip, env.codeBase, env.mask, env.d32, env.ip32);
    vm.exports.run(entry, left);
    left = vm.raw('left') | 0;
    if (++handbacks > maxHandbacks) { why = 'handbacks'; break; }
  }
  return { left, handbacks, entries, why };
}

function memHash(vm) {
  return crypto.createHash('sha256')
    .update(Buffer.from(vm.mem.buffer, 0, isa.GUEST_RAM_SIZE)).digest('hex').slice(0, 16);
}

// The guest-visible state after a run, with the flags word masked to what the
// code at the final gip can read.
function guestState(vm, arm) {
  const o = {};
  for (const g of STATE) {
    if (NOT_GUEST.has(g) || !vm.exports[`get_${g}`]) continue;
    o[g] = vm.raw(g) >>> 0;
  }
  // The segment registers live in the register file, outside guest RAM, so
  // memHash does not see them.
  const dv = new DataView(vm.mem.buffer);
  ['es', 'cs', 'ss', 'ds', 'fs', 'gs'].forEach((r, i) => {
    o[`sel_${r}`] = dv.getUint32(isa.REGFILE_SEL + 4 * i, true);
    o[`base_${r}`] = dv.getUint32(isa.REGFILE_SEGB + 4 * i, true);
  });
  const env = envOf(vm);
  const live = liveFlagsAt((lin) => vm.mem[lin], env, vm.raw('gip') >>> 0);
  let m = ~0x8D5 >>> 0;   // everything but the six arithmetic bits
  for (const f of live) m |= 1 << FBIT[f];
  o.flags = (vm.exports.get_flags() & m) >>> 0;
  o.liveFlags = [...live].sort().join('');
  o.left = arm.left;
  o.why = arm.why;
  o.mem = memHash(vm);
  return o;
}

function diffStates(a, b) {
  const out = [];
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) out.push(`${k}: ${typeof a[k] === 'number' ? a[k].toString(16) : a[k]} vs ${typeof b[k] === 'number' ? b[k].toString(16) : b[k]}`);
  }
  return out;
}

// Step a program, a few instructions at a time, until the guest stands at
// `ip` in the code segment keyed by `codeBase`. Returns true when it got there.
function stepTo(vm, cacheOpts, codeBase, ip, maxSlices = 400000, machine = null) {
  if (machine) {
    // Through a real session, so the interrupts the program takes on the way
    // are serviced rather than stopping the walk.
    const { DosSession } = require('./dos-loop');
    const s = new DosSession(vm, machine, { slice: 1, ...cacheOpts });
    for (let i = 0; i < maxSlices; i++) {
      const env = envOf(vm);
      if (env.codeBase === codeBase && (vm.raw('gip') >>> 0) === ip && vm.get('cs') !== STUB_SEG) return true;
      const r = s.step();
      if (r === 'done' || r === 'badselector') return false;
    }
    return false;
  }
  const cache = new CodeCache(vm, cacheOpts);
  new Int32Array(vm.mem.buffer, isa.JTAB_BASE, isa.JTAB_SIZE >> 2).fill(0);
  vm.set('rtop', 0);
  if (vm.exports.set_edgelook) vm.exports.set_edgelook(0);
  if (vm.exports.set_intfast) vm.exports.set_intfast(0);
  for (let i = 0; i < maxSlices; i++) {
    const env = envOf(vm);
    const g = vm.raw('gip') >>> 0;
    if (env.codeBase === codeBase && g === ip) return true;
    if (vm.get('cs') === STUB_SEG) return false;
    vm.exports.set_smc(0);
    const entry = cache.entryFor(env.cs, g, env.codeBase, env.mask, env.d32, env.ip32);
    vm.exports.run(entry, 0);
  }
  return false;
}

module.exports = { envOf, snapshot, seed, runArm, guestState, diffStates, memHash, stepTo, discover };
