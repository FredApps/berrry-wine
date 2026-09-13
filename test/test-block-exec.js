#!/usr/bin/env node
// The per-block executor (H458, src/07c-block-exec.wat) against the threaded
// interpreter, one basic block at a time.
//
// docs/block-executor-design.md is the design. What this test is FOR is the
// one claim the design cannot argue its way to: that a block run with the
// eight GPRs in wasm locals ends in exactly the state the same block ends in
// when every op is dispatched through $next -- registers, EFLAGS, memory, EIP.
//
// Method: run identical x86 twice in ONE instance, at two different code
// addresses, with --block-exec on for one of them. Two addresses because the
// gate is read at DECODE time, so a flag flipped between two runs of the same
// address would not steer the second one; and one instance because a second
// instance would also be a second heap, a second cache and a second set of
// lazy-flag globals, which is three more ways for the arms to differ for
// reasons that are not the executor.
//
// Every snippet ends `pushfd ; pop ebp ; ret`. That is not decoration:
//   * `pushfd` is a FALLBACK op in this prototype, so every single case also
//     exercises the spill/call_indirect/reload path with a handler that reads
//     the lazy-flag globals -- which is the strongest available check that the
//     executor left them at the exact architectural join;
//   * it lands the whole of EFLAGS in EBP, so the snapshot compares flags as
//     a value instead of inferring them from a branch;
//   * `ret` is the block's terminator, which this design deliberately leaves
//     in the threaded stream.
//
// Run: node test/test-block-exec.js

const fs = require('fs');
const path = require('path');
const { createHostImports } = require(path.join(__dirname, '..', 'lib/host-imports'));
const RegionMap = require('../lib/region-map.generated.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}

// ---- x86 encoders. Register numbering is the architectural one:
// 0=eax 1=ecx 2=edx 3=ebx 4=esp 5=ebp 6=esi 7=edi.
const EAX = 0, ECX = 1, EDX = 2, EBX = 3, ESP = 4, EBP = 5, ESI = 6, EDI = 7;
const le32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
const movRI = (r, v) => [0xB8 + r, ...le32(v)];
const movRR = (d, s) => [0x89, 0xC0 | (s << 3) | d];
const aluRR = (opc, d, s) => [opc, 0xC0 | (s << 3) | d];
const ADD = 0x01, OR = 0x09, ADC = 0x11, SBB = 0x19, AND = 0x21, SUB = 0x29,
      XOR = 0x31, CMP = 0x39;
// 81 /digit  -- digit is the ALU index: 0 add 1 or 2 adc 3 sbb 4 and 5 sub 6 xor 7 cmp
const aluRI = (digit, r, v) => [0x81, 0xC0 | (digit << 3) | r, ...le32(v)];
const leaRO = (d, base, disp) => [0x8D, 0x80 | (d << 3) | base, ...le32(disp)];
const incR = r => [0x40 + r];
const decR = r => [0x48 + r];
const negR = r => [0xF7, 0xD8 | r];
const notR = r => [0xF7, 0xD0 | r];
const shlRI = (r, n) => [0xC1, 0xE0 | r, n & 0xFF];
const shrRI = (r, n) => [0xC1, 0xE8 | r, n & 0xFF];
const sarRI = (r, n) => [0xC1, 0xF8 | r, n & 0xFF];
const load32 = (d, base, disp) => [0x8B, 0x80 | (d << 3) | base, ...le32(disp)];
const store32 = (s, base, disp) => [0x89, 0x80 | (s << 3) | base, ...le32(disp)];
const load32abs = (d, abs) => [0x8B, 0x05 | (d << 3), ...le32(abs)];
const store32abs = (s, abs) => [0x89, 0x05 | (s << 3), ...le32(abs)];
const movR8R8 = (d, s) => [0x88, 0xC0 | (s << 3) | d];
const aluR8I8 = (digit, r8, v) => [0x80, 0xC0 | (digit << 3) | r8, v & 0xFF];
const load8 = (d8, base, disp) => [0x8A, 0x80 | (d8 << 3) | base, ...le32(disp)];
const store8 = (s8, base, disp) => [0x88, 0x80 | (s8 << 3) | base, ...le32(disp)];
const movzx8 = (d, base, disp) => [0x0F, 0xB6, 0x80 | (d << 3) | base, ...le32(disp)];
const movsx8 = (d, base, disp) => [0x0F, 0xBE, 0x80 | (d << 3) | base, ...le32(disp)];
// mod=10 rm=100 -> SIB follows, then disp32. scale is the shift amount 0..3.
const sib = (scale, idx, base) => (scale << 6) | (idx << 3) | base;
const leaSib = (d, base, idx, sc, disp) =>
  [0x8D, 0x84 | (d << 3), sib(sc, idx, base), ...le32(disp)];
const load32sib = (d, base, idx, sc, disp) =>
  [0x8B, 0x84 | (d << 3), sib(sc, idx, base), ...le32(disp)];
const store32sib = (s, base, idx, sc, disp) =>
  [0x89, 0x84 | (s << 3), sib(sc, idx, base), ...le32(disp)];
const movsx8sib = (d, base, idx, sc, disp) =>
  [0x0F, 0xBE, 0x84 | (d << 3), sib(sc, idx, base), ...le32(disp)];
const store8sib = (s8, base, idx, sc, disp) =>
  [0x88, 0x84 | (s8 << 3), sib(sc, idx, base), ...le32(disp)];
const load16 = (d, base, disp) => [0x66, 0x8B, 0x80 | (d << 3) | base, ...le32(disp)];
const store16 = (s, base, disp) => [0x66, 0x89, 0x80 | (s << 3) | base, ...le32(disp)];
const load16abs = (d, abs) => [0x66, 0x8B, 0x05 | (d << 3), ...le32(abs)];
const pushR = r => [0x50 + r];
const popR = r => [0x58 + r];
const pushI = v => [0x68, ...le32(v)];
const PUSHFD = [0x9C];
const RET = [0xC3];
const NOP = [0x90];

async function main() {
  const ROOT = path.join(__dirname, '..');
  const WASM_PATH = process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const exeBytes = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const base = createHostImports(ctx);
  const h = base.host;
  h.memory = memory;
  h.exit = () => {};
  h.log = () => {};
  h.log_i32 = () => {};
  h.crash_unimplemented = () => {};
  h.wait_multiple = () => 0;
  h.shell_execute = () => 33;

  const { instance } = await WebAssembly.instantiate(wasmBytes, { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const mem = new Uint8Array(e.memory.buffer);
  const dv = new DataView(e.memory.buffer);
  mem.set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);

  const imageBase = e.get_image_base();
  const g2w = a => RegionMap.g2w(a, imageBase);

  if (typeof e.set_block_exec !== 'function') {
    console.log('FAIL: set_block_exec is not exported — the build predates 07c-block-exec.wat');
    process.exit(1);
  }
  // The gate must be OFF in a fresh instance. This is the whole ship-safety
  // claim, so it is asserted rather than assumed.
  check('the executor is OFF in a fresh instance', e.get_block_exec() === 0,
    `get_block_exec()=${e.get_block_exec()}`);

  const STACK_TOP = imageBase + 0xD00000;
  const DATA = imageBase + 0x900000;   // scratch the snippets read and write
  const DATA_LEN = 256;

  let codeOffset = 0;
  const nextCode = () => { const a = imageBase + 0x20000 + codeOffset; codeOffset += 512; return a; };

  // The seven registers a snippet may set up. ESP is excluded (the harness
  // owns it) and EBP is the EFLAGS sink.
  const SEED = { eax: 0x1234ABCD, ecx: 0x0000000F, edx: 0x7FFFFFFF,
                 ebx: DATA, esi: 0x00000004, edi: 0xFFFFFFFE };

  function seedData() {
    for (let i = 0; i < DATA_LEN; i++) mem[g2w(DATA) + i] = (i * 7 + 3) & 0xFF;
  }

  // The lazy-flag globals survive between runs, so whatever ran last decides
  // the CF an `adc` at the top of the next block adds in. That is not a
  // property of the executor and it made the arms differ by one. Every arm
  // therefore runs this first: `xor ebp,ebp` leaves CF=0 OF=0 ZF=1 SF=0 from a
  // known join, and `ret` returns to the sentinel.
  const flagsInitAddr = nextCode();
  {
    const b = [...aluRR(XOR, EBP, EBP), ...RET];
    for (let i = 0; i < b.length; i++) mem[g2w(flagsInitAddr) + i] = b[i];
  }
  function normalizeFlags() {
    e.set_esp(STACK_TOP);
    dv.setUint32(g2w(STACK_TOP), 0, true);
    e.set_eip(flagsInitAddr);
    e.run(100);
  }

  // Run one arm. `blockExec` steers the DECODE of a fresh address, so the two
  // arms are genuinely two different compilations of the same bytes.
  function arm(bytes, blockExec, seed) {
    const addr = nextCode();
    const wa = g2w(addr);
    for (let i = 0; i < bytes.length; i++) mem[wa + i] = bytes[i];
    seedData();
    normalizeFlags();
    // The shipped floor is 12 micro-ops -- the measured crossover where a
    // descriptor starts paying for its entry/exit cost (see the note on
    // $block_exec_min_uops). Every case here is a hand-written block of two to
    // a dozen ops chosen to isolate ONE micro-op kind, so at the shipped floor
    // they would all decline and each arm would silently run the same threaded
    // code twice. Coverage is the point of this file, so it drops the floor to
    // the minimum a descriptor can express; the throughput question is
    // tools/bench-loops.js's and fold-ab's, not this file's.
    e.set_block_exec_min_uops(2);
    e.set_block_exec(blockExec ? 1 : 0);
    const regs = Object.assign({}, SEED, seed || {});
    e.set_eax(regs.eax); e.set_ecx(regs.ecx); e.set_edx(regs.edx);
    e.set_ebx(regs.ebx); e.set_esi(regs.esi); e.set_edi(regs.edi);
    e.set_ebp(0);
    e.set_esp(STACK_TOP);
    dv.setUint32(g2w(STACK_TOP), 0, true);   // sentinel return address
    const installsBefore = e.get_block_exec_installs();
    const fbBefore = e.get_block_exec_fallback_ops();
    const natBefore = e.get_block_exec_native_ops();
    e.set_eip(addr);
    e.run(100000);
    const out = {
      addr,
      eip: e.get_eip() >>> 0,
      eax: e.get_eax() >>> 0, ecx: e.get_ecx() >>> 0, edx: e.get_edx() >>> 0,
      ebx: e.get_ebx() >>> 0, esp: e.get_esp() >>> 0, ebp: e.get_ebp() >>> 0,
      esi: e.get_esi() >>> 0, edi: e.get_edi() >>> 0,
      data: Buffer.from(mem.subarray(g2w(DATA), g2w(DATA) + DATA_LEN)).toString('hex'),
      installs: e.get_block_exec_installs() - installsBefore,
      declWhy: e.get_block_exec_decl_why(),
      lastFallbackFn: e.get_block_exec_last_fallback_fn(),
      fallbacks: Number(e.get_block_exec_fallback_ops() - fbBefore),
      natives: Number(e.get_block_exec_native_ops() - natBefore),
    };
    e.set_block_exec(0);
    return out;
  }

  const hexRegs = s => ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi']
    .map(k => `${k}=${s[k].toString(16).padStart(8, '0')}`).join(' ');

  // A block always ends with the flags probe and the terminator.
  const block = body => [...body, ...PUSHFD, ...popR(EBP), ...RET];

  let totalNative = 0, totalFallback = 0, totalInstalls = 0;

  function equiv(name, body, seed, opts) {
    const bytes = block(body);
    const off = arm(bytes, false, seed);
    const on = arm(bytes, true, seed);
    totalNative += on.natives; totalFallback += on.fallbacks; totalInstalls += on.installs;
    const regsOk = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi']
      .every(k => off[k] === on[k]);
    const memOk = off.data === on.data;
    const eipOk = off.eip === on.eip;
    let why = '';
    if (!regsOk) why = `\n         off ${hexRegs(off)}\n         on  ${hexRegs(on)}`;
    else if (!memOk) why = ' (guest memory differs)';
    else if (!eipOk) why = ` (eip ${off.eip.toString(16)} vs ${on.eip.toString(16)})`;
    check(name, regsOk && memOk && eipOk, why);
    // A "pass" from a block the executor declined proves nothing about the
    // executor, so installation is asserted separately unless the case is
    // explicitly ABOUT a decline.
    if (!(opts && opts.mayDecline)) {
      check(`  ${name}: installed`, on.installs >= 1,
        `installs=${on.installs} declWhy=${on.declWhy} — declined, so the two ` +
        `arms just ran the same threaded code twice and the pass above is empty`);
    }
    return { off, on };
  }

  console.log('\n-- every implemented micro-op kind, against threaded --');

  equiv('MOV_RR / MOV_RI',
    [...movRI(EAX, 0xDEADBEEF), ...movRR(ECX, EAX), ...movRR(EDX, ECX)]);
  equiv('LEA_RO',
    [...leaRO(EAX, EBX, 0x40), ...leaRO(ECX, EAX, -0x10), ...movRR(EDX, ECX)]);
  equiv('ADD/SUB r,r and r,imm',
    [...aluRR(ADD, EAX, ECX), ...aluRI(0, EAX, 0x7FFFFFF0),
     ...aluRR(SUB, EDX, ECX), ...aluRI(5, EDX, 0x00010000)]);
  equiv('AND/OR/XOR r,r and r,imm',
    [...aluRR(AND, EAX, EDX), ...aluRI(4, EAX, 0x0F0F0F0F),
     ...aluRR(OR, ECX, EAX), ...aluRI(1, ECX, 0x80000000),
     ...aluRR(XOR, EDX, ECX), ...aluRI(6, EDX, 0xFFFFFFFF)]);
  equiv('CMP r,r and CMP r,imm write flags and no register',
    [...movRI(EAX, 5), ...movRI(ECX, 5), ...aluRR(CMP, EAX, ECX),
     ...aluRI(7, EAX, 6)]);
  equiv('INC / DEC preserve CF',
    [...aluRI(0, EAX, 1), ...incR(ECX), ...decR(EDX), ...incR(EDI)]);
  equiv('NEG / NOT',
    [...negR(EAX), ...notR(ECX), ...negR(EDX), ...notR(EDI)]);
  equiv('SHL / SHR / SAR by imm8',
    [...shlRI(EAX, 5), ...shrRI(ECX, 3), ...sarRI(EDX, 9), ...shlRI(EDI, 1)]);
  equiv('SHL by 0 writes no flags at all',
    [...aluRR(CMP, EAX, EAX), ...shlRI(ECX, 0), ...movRR(EDX, ECX)]);
  equiv('LOAD32 / STORE32 base+disp',
    [...load32(EAX, EBX, 0x10), ...load32(ECX, EBX, 0x14),
     ...aluRR(ADD, EAX, ECX), ...store32(EAX, EBX, 0x20)]);
  equiv('LOAD32_ABS / STORE32_ABS',
    [...load32abs(EAX, DATA + 0x30), ...aluRI(6, EAX, 0x5A5A5A5A),
     ...store32abs(EAX, DATA + 0x34), ...load32abs(ECX, DATA + 0x34)]);
  equiv('MOV_SUB_RR (mov r8,r8) and the AH..BH lanes',
    [...movR8R8(0, 3), ...movR8R8(5, 0), ...movR8R8(2, 7), ...movR8R8(4, 1)]);
  equiv('ALU_SUB_RI (byte ALU r8,imm8)',
    [...aluR8I8(0, 0, 0x7F), ...aluR8I8(5, 1, 0x01),
     ...aluR8I8(4, 4, 0x0F), ...aluR8I8(7, 3, 0x10)]);
  equiv('LOAD8_RO / STORE8_RO with a high-byte lane',
    [...load8(0, EBX, 0x08), ...load8(4, EBX, 0x09),
     ...store8(0, EBX, 0x40), ...store8(4, EBX, 0x41)]);
  equiv('MOVZX8 / MOVSX8 base+disp write the whole destination',
    [...movzx8(EAX, EBX, 0x11), ...movsx8(ECX, EBX, 0x12),
     ...movzx8(EDX, EBX, 0x13), ...movsx8(EDI, EBX, 0x14)]);
  equiv('LEA_SIB / LOAD32_SIB / STORE32_SIB',
    [...leaSib(EAX, EBX, ESI, 2, 0x10), ...load32sib(ECX, EBX, ESI, 2, 0x10),
     ...aluRI(0, ECX, 1), ...store32sib(ECX, EBX, ESI, 2, 0x30)]);
  // Split one instruction per case: a byte SIB store carries its data
  // register, its lane and its address in three different fields of the same
  // encoding, and a combined case that fails names none of them.
  equiv('MOVSX8_SIB, scale 1',
    [...movsx8sib(EAX, EBX, ESI, 0, 0x18), ...movRR(ECX, EAX), ...incR(EDX)]);
  equiv('MOVSX8_SIB, scale 2',
    [...movsx8sib(EAX, EBX, ESI, 1, 0x18), ...movRR(ECX, EAX), ...incR(EDX)]);
  equiv('STORE8_SIB, low lane (AL)',
    [...movRI(EAX, 0x000000A7), ...store8sib(0, EBX, ESI, 0, 0x50), ...incR(EDX)]);
  equiv('STORE8_SIB, high lane (AH)',
    [...movRI(EAX, 0x0000B900), ...store8sib(4, EBX, ESI, 0, 0x51), ...incR(EDX)]);
  equiv('STORE8_SIB, high lane of another container (CH)',
    [...movRI(ECX, 0x00007300), ...store8sib(5, EBX, ESI, 0, 0x52), ...incR(EDX)]);
  equiv('MOVSX8_SIB then STORE8_SIB through the same base',
    [...movsx8sib(EAX, EBX, ESI, 0, 0x18), ...movsx8sib(ECX, EBX, ESI, 1, 0x18),
     ...store8sib(0, EBX, ESI, 0, 0x50), ...store8sib(4, EBX, ESI, 0, 0x51)]);
  equiv('LOAD16 / STORE16 / LOAD16_ABS keep the container top half',
    [...load16(EAX, EBX, 0x20), ...load16abs(ECX, DATA + 0x24),
     ...store16(EAX, EBX, 0x60), ...load16(EDX, EBX, 0x60)]);
  equiv('PUSH_R / POP_R move ESP through a local',
    [...pushR(EAX), ...pushR(ECX), ...popR(EDX), ...popR(EDI)]);
  equiv('PUSH_I',
    [...pushI(0x11223344), ...pushI(0xFFFFFFFF), ...popR(EAX), ...popR(ECX)]);
  equiv('a long straight-line block, 24 ops',
    Array.from({ length: 6 }, (_, i) => [
      ...aluRI(0, EAX, i + 1), ...aluRR(XOR, ECX, EAX),
      ...shlRI(EDX, 1), ...incR(EDI),
    ]).flat());

  console.log('\n-- the fallback path --');

  // ADC/SBB are deliberately NOT in the executor's vocabulary, so each of
  // these is a spill / call_indirect / reload in the middle of a block whose
  // other ops stayed in locals. If the reload were wrong, the ops AFTER it
  // would diverge -- which is why each case has native work on both sides.
  const adc = equiv('ADC r,r mid-block (a fallback between native ops)',
    [...aluRI(0, EAX, 0x80000000), ...aluRR(ADC, ECX, EDX),
     ...aluRR(XOR, EDI, ECX), ...incR(EAX)]);
  check('  ADC really took the fallback', adc.on.fallbacks >= 2,
    `fallbacks=${adc.on.fallbacks} (pushfd is one; ADC should be the other)`);
  equiv('SBB r,imm mid-block',
    [...aluRR(CMP, EAX, EDX), ...aluRI(3, ECX, 0x1000),
     ...aluRR(SUB, EDI, ECX), ...decR(EDX)]);
  equiv('IMUL r,r mid-block (a fallback that writes a register)',
    [...movRI(EAX, 0x00010001), ...movRI(ECX, 0x00000101),
     [0x0F, 0xAF, 0xC1], ...aluRR(ADD, EDX, EAX)].flat());
  equiv('two fallbacks back to back',
    [...aluRR(ADC, EAX, ECX), ...aluRR(SBB, EDX, EDI),
     ...aluRR(XOR, ESI, EAX), ...incR(ECX)]);
  equiv('a fallback as the FIRST body op',
    [...aluRR(ADC, EAX, ECX), ...movRR(EDX, EAX),
     ...shlRI(EDX, 2), ...aluRI(0, EDI, 7)]);

  console.log('\n-- a fault mid-block --');

  // $g2w has no mapping for guest 0, so the miss lands on NULL_SENTINEL: the
  // read returns 0 and the write goes nowhere. The point is not that it
  // faults loudly, it is that BOTH arms absorb it identically and that the
  // ops after it see the same register file -- a mid-block miss is exactly
  // where an executor holding registers in locals could diverge and then look
  // like a decoder bug thousands of instructions later.
  const flt = equiv('a load from an unmapped address, mid-block',
    [...movRI(EAX, 0x55), ...load32abs(ECX, 0), ...aluRR(ADD, EAX, ECX),
     ...store32abs(EAX, 0), ...load32(EDX, EBX, 0x10)]);
  check('  the faulting arm still finished the block', flt.on.eip === 0,
    `eip=0x${flt.on.eip.toString(16)}`);
  equiv('a store through a null base register, mid-block',
    [...movRI(EDI, 0), ...store32(EAX, EDI, 0x24),
     ...load32(ECX, EDI, 0x24), ...aluRR(OR, EDX, ECX)]);

  console.log('\n-- self-modifying code after decode --');

  {
    // Decode the block, run it, then overwrite the guest bytes and run again.
    // The second run must see the NEW code in both arms. This is the existing
    // page-invalidation machinery ($invalidate_code_write ->
    // $page_retire_at), and it keeps working only because the executor's H458
    // op is the block's FIRST op and the retirement stamp is 8 bytes wide.
    const v1 = block([...movRI(EAX, 0x1111), ...aluRI(0, EAX, 1),
                      ...movRR(ECX, EAX), ...incR(EDX)]);
    const v2 = block([...movRI(EAX, 0x2222), ...aluRI(0, EAX, 2),
                      ...movRR(ECX, EAX), ...decR(EDX)]);
    if (v1.length !== v2.length) throw new Error('the SMC pair must be the same length');

    const smc = (blockExec) => {
      const addr = nextCode();
      const wa = g2w(addr);
      const runAt = () => {
        seedData();
        e.set_eax(SEED.eax); e.set_ecx(SEED.ecx); e.set_edx(SEED.edx);
        e.set_ebx(SEED.ebx); e.set_esi(SEED.esi); e.set_edi(SEED.edi);
        e.set_ebp(0); e.set_esp(STACK_TOP);
        dv.setUint32(g2w(STACK_TOP), 0, true);
        e.set_eip(addr);
        e.run(100000);
        return `${(e.get_eax() >>> 0).toString(16)}/${(e.get_ecx() >>> 0).toString(16)}/${(e.get_edx() >>> 0).toString(16)}`;
      };
      e.set_block_exec_min_uops(2);
      e.set_block_exec(blockExec ? 1 : 0);
      for (let i = 0; i < v1.length; i++) mem[wa + i] = v1[i];
      const first = runAt();
      // Write the new code through the GUEST store path, so the code-page
      // bitmap and the retirement walk are the ones the app would trip.
      e.set_ebx(addr);
      for (let i = 0; i < v2.length; i += 4) {
        const word = v2[i] | (v2[i + 1] << 8) | (v2[i + 2] << 16) | (v2[i + 3] << 24);
        e.set_eax(word >>> 0);
        const w = nextCode();
        const ww = g2w(w);
        const st = [...store32(EAX, EBX, i), ...RET];
        for (let k = 0; k < st.length; k++) mem[ww + k] = st[k];
        e.set_esp(STACK_TOP); dv.setUint32(g2w(STACK_TOP), 0, true);
        e.set_eip(w); e.run(1000);
      }
      const second = runAt();
      e.set_block_exec(0);
      return { first, second };
    };
    const soff = smc(false);
    const son = smc(true);
    check('SMC: the first run agrees', soff.first === son.first,
      `${soff.first} vs ${son.first}`);
    check('SMC: the rewritten block is re-decoded and agrees',
      soff.second === son.second, `${soff.second} vs ${son.second}`);
    check('SMC: the rewrite actually changed the answer',
      soff.first !== soff.second, `${soff.first} == ${soff.second}`);
  }

  console.log('\n-- breakpoints --');

  {
    // Breakpoints are a $run-loop-head facility, so they are BLOCK ENTRY only
    // in the threaded interpreter too. The contract this test pins is not
    // "a mid-block breakpoint fires" (it never did) but "the two arms agree
    // about which breakpoints fire and about the state at the stop".
    const body = [...movRI(EAX, 0x1000), ...aluRI(0, EAX, 1),
                  ...movRR(ECX, EAX), ...incR(EDX), ...movRR(EDI, ECX)];
    const bytes = block(body);
    // $bp_skip_once alternates: a halt at an address arms a skip so the very
    // next entry runs the block instead of halting again. That latch is a
    // process global and survives between arms, so a naive off-then-on pair
    // measures the LATCH, not the executor -- the first arm halted, the second
    // did not, and the two disagreed for a reason that has nothing to do with
    // block-exec. Each arm therefore drives the latch to a known state first,
    // then records two consecutive entries: the documented behaviour is
    // "skipped, then halted".
    const at = (blockExec, bpDelta) => {
      const addr = nextCode();
      const wa = g2w(addr);
      for (let i = 0; i < bytes.length; i++) mem[wa + i] = bytes[i];
      e.set_bp(bpDelta === null ? 0 : addr + bpDelta);
      const once = () => {
        seedData();
        normalizeFlags();
        e.set_block_exec_min_uops(2);
      e.set_block_exec(blockExec ? 1 : 0);
        e.set_eax(SEED.eax); e.set_ecx(SEED.ecx); e.set_edx(SEED.edx);
        e.set_ebx(SEED.ebx); e.set_esi(SEED.esi); e.set_edi(SEED.edi);
        e.set_ebp(0); e.set_esp(STACK_TOP);
        dv.setUint32(g2w(STACK_TOP), 0, true);
        e.set_eip(addr);
        e.run(100000);
        const eip = e.get_eip() >>> 0;
        const where = eip === 0 ? 'ran' : (eip === addr ? 'halted@entry' : `halted@+${eip - addr}`);
        return `${where}|${(e.get_eax() >>> 0).toString(16)}|` +
               `${(e.get_ecx() >>> 0).toString(16)}|${(e.get_edx() >>> 0).toString(16)}`;
      };
      // Prime: keep entering until one entry halts, so the latch is armed.
      let guard = 0;
      while (bpDelta !== null && !once().startsWith('halted') && ++guard < 4) { /* prime */ }
      const first = once(), second = once();
      e.set_bp(0);
      e.set_block_exec(0);
      return `${first} THEN ${second}`;
    };
    // 5 is inside the block: `mov eax,imm32` is five bytes, so this is the
    // second instruction's address and never a block entry -- in the threaded
    // interpreter either, which is why the contract asserted here is that the
    // two arms AGREE, not that a mid-block breakpoint fires.
    const midOff = at(false, 5), midOn = at(true, 5);
    check('a mid-block breakpoint behaves identically in both arms',
      midOff === midOn, `${midOff}  vs  ${midOn}`);
    check('  and a mid-block breakpoint fires in neither',
      !midOff.includes('halted'), midOff);
    const entryOff = at(false, 0), entryOn = at(true, 0);
    check('an entry breakpoint stops in both arms, at the same state',
      entryOff === entryOn, `${entryOff}  vs  ${entryOn}`);
    check('  and it really stopped at the entry, with the block not yet run',
      entryOff.includes('halted@entry|1234abcd'), entryOff);
  }

  console.log('\n-- declines --');

  {
    // Below $block_exec_min_uops the H458 dispatch is not repaid, so the
    // matcher must refuse rather than install a losing descriptor. This one
    // cannot use the standard flags probe, since `pushfd ; pop ebp` is two
    // more body ops and would carry any block over the threshold.
    const bare = [...incR(EAX), ...RET];
    const tinyOff = arm(bare, false);
    const tinyOn = arm(bare, true);
    check('a one-body-op block is declined', tinyOn.installs === 0,
      `installs=${tinyOn.installs}`);
    check('  and it still executes correctly', tinyOff.eax === tinyOn.eax,
      `${tinyOff.eax.toString(16)} vs ${tinyOn.eax.toString(16)}`);
    check('  for the "too short" reason', tinyOn.declWhy === 1,
      `declWhy=${tinyOn.declWhy}`);
    // --fault-null=stop would let a native memory op trap with the register
    // file still in locals, so the whole family stands down while it is armed.
    e.set_fault_unmapped(2);
    const armed = equiv('nothing installs while --fault-null is armed',
      [...aluRI(0, EAX, 1), ...aluRR(XOR, ECX, EAX), ...incR(EDX), ...decR(EDI)],
      null, { mayDecline: true });
    check('  the fault-null decline held', armed.on.installs === 0,
      `installs=${armed.on.installs}`);
    e.set_fault_unmapped(0);
  }

  console.log('\n-- coverage of this run --');
  const tot = totalNative + totalFallback;
  console.log(`  ${totalInstalls} blocks installed, ${totalNative} ops native, ` +
    `${totalFallback} fallback (${tot ? (100 * totalNative / tot).toFixed(1) : '-'}% native)`);
  check('the executor actually ran natively for most ops',
    tot > 0 && totalNative / tot > 0.6,
    `native share ${tot ? (100 * totalNative / tot).toFixed(1) : 0}%`);
  check('the gate is left OFF', e.get_block_exec() === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
