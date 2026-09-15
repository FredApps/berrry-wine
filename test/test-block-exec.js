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
// Memory-SOURCE ALU: `op r32, [base+disp32]` and `op r32, [abs]`. These are the
// forms round 11's split takes apart, and nothing else in this file emits one.
// The opcode is the register-destination direction (0x03 add, 0x0B or, 0x23
// and, 0x2B sub, 0x33 xor, 0x3B cmp) — one higher than the r/m-destination
// opcode the aluRR encoder above uses.
const ADD_RM = 0x03, OR_RM = 0x0B, AND_RM = 0x23, SUB_RM = 0x2B,
      XOR_RM = 0x33, CMP_RM = 0x3B;
const aluRM = (opc, d, base, disp) => [opc, 0x80 | (d << 3) | base, ...le32(disp)];
const aluRAbs = (opc, d, abs) => [opc, 0x05 | (d << 3), ...le32(abs)];
const imulRM = (d, base, disp) => [0x0F, 0xAF, 0x80 | (d << 3) | base, ...le32(disp)];
const CDQ = [0x99];
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

  // Multi-block discovery is hotness-gated in production: a head must be
  // branched to K times before the CFG walk is attempted at all, so the walk
  // is paid once per hot head instead of once per decode. A snippet in this
  // file runs a handful of iterations and would never reach the shipped K, so
  // the gate is dropped to the first entry here — this file is about what the
  // matcher builds, not about how long it waits before building it. The gate
  // and the budget have cases of their own further down, which set these back.
  //
  // Two, not one: the FIRST branch into a head is the edge that compiles it,
  // and a walk needs the head already compiled (see $bx_walk_try). At the
  // shipped K that is invisible — by the 24th entry every real head has been
  // compiled for a long time — so one is the only value that would behave
  // differently from production here.
  e.set_block_exec_walk_k(2);

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
    // Round 11's decode-time pass keeps its own meters. Capturing them per arm
    // is what lets a case assert that a transform FIRED or, more often, that
    // it correctly did not — a "the two arms agree" check cannot tell a sound
    // rewrite from no rewrite at all.
    const passBefore = {
      split: e.get_bx_pass_split(), rle: e.get_bx_pass_rle(),
      movelim: e.get_bx_pass_movelim(), immfold: e.get_bx_pass_immfold(),
      stlf: e.get_bx_pass_stlf(),
    };
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
      pass: {
        split: Number(e.get_bx_pass_split() - passBefore.split),
        rle: Number(e.get_bx_pass_rle() - passBefore.rle),
        movelim: Number(e.get_bx_pass_movelim() - passBefore.movelim),
        immfold: Number(e.get_bx_pass_immfold() - passBefore.immfold),
        stlf: Number(e.get_bx_pass_stlf() - passBefore.stlf),
      },
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

  // ADC/SBB used to be outside the executor's vocabulary and this case existed
  // to exercise the spill / call_indirect / reload path through them. The merge
  // with H454 brought its ADC/SBB micro-ops in, so they are native now and this
  // case is a plain correctness case again -- the fallback path is covered by
  // the pushfd below it and by the explicit fallback cases further down.
  const adc = equiv('ADC r,r mid-block (now a native carry-in op)',
    [...aluRI(0, EAX, 0x80000000), ...aluRR(ADC, ECX, EDX),
     ...aluRR(XOR, EDI, ECX), ...incR(EAX)]);
  check('  ADC is native after the H454 merge', adc.on.fallbacks <= 1,
    `fallbacks=${adc.on.fallbacks} (pushfd is the only one left)`);
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

  console.log('\n-- multi-block regions --');

  // A region is several basic blocks under ONE descriptor, so every case below
  // needs real control flow inside the snippet. These are the encodings the
  // single-block cases above never needed.
  const JZ = 4, JNZ = 5, JB = 2, JAE = 3, JL = 0xC, JGE = 0xD;
  const jccRel32 = (cc, rel) => [0x0F, 0x80 | cc, ...le32(rel)];
  const jmpRel32 = rel => [0xE9, ...le32(rel)];

  // A two-pass assembler, because a multi-block snippet's displacements are
  // not knowable until every block's length is. A piece is a byte array, a
  // `{label}` marker, or a `{j, cc, to}` jump naming a label; jumps are always
  // the rel32 form so pass one's size estimate is exact.
  function asm(pieces) {
    const at = new Map();
    let off = 0;
    for (const p of pieces) {
      if (p.label !== undefined) { at.set(p.label, off); continue; }
      off += p.j !== undefined ? (p.j === 'jmp' ? 5 : 6) : p.length;
    }
    const out = [];
    for (const p of pieces) {
      if (p.label !== undefined) continue;
      if (p.j === undefined) { out.push(...p); continue; }
      const size = p.j === 'jmp' ? 5 : 6;
      const rel = at.get(p.to) - (out.length + size);
      out.push(...(p.j === 'jmp' ? jmpRel32(rel) : jccRel32(p.cc, rel)));
    }
    return out;
  }

  // The flags probe the single-block cases append cannot be used here: it
  // would land in whichever block happens to be last rather than on the path
  // the case is about. These snippets end in `pushfd; pop ebp; ret` written
  // explicitly at the join.
  const JOIN = [...PUSHFD, ...popR(EBP), ...RET];

  let regionInstalls = 0, regionEntries = 0;

  // Same differential contract as `equiv`, plus the assertion that makes the
  // case mean anything: a descriptor of at least two blocks was installed.
  // Without it a pass says only that two identical threaded compilations agree.
  function region(name, bytes, seed, opts) {
    const off = arm(bytes, false, seed);
    const riBefore = e.get_block_exec_region_installs();
    const probesBefore = e.get_block_exec_walk_probes();
    const attemptsBefore = e.get_block_exec_walk_attempts();
    const nofitBefore = [];
    for (let r = 1; r <= 9; r += 1) nofitBefore.push(e.get_block_exec_region_nofit(r));
    const entBefore = [];
    for (let n = 2; n <= 16; n += 1) entBefore.push(e.get_block_exec_entries_by_n(n));
    const on = arm(bytes, true, seed);
    const installs = e.get_block_exec_region_installs() - riBefore;
    let entries = 0;
    for (let n = 2; n <= 16; n += 1) {
      entries += e.get_block_exec_entries_by_n(n) - entBefore[n - 2];
    }
    regionInstalls += installs; regionEntries += entries;
    const regsOk = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi']
      .every(k => off[k] === on[k]);
    const ok = regsOk && off.data === on.data && off.eip === on.eip;
    check(name, ok, ok ? '' :
      `\n         off ${hexRegs(off)}\n         on  ${hexRegs(on)}` +
      `\n         eip ${off.eip.toString(16)} vs ${on.eip.toString(16)}` +
      (off.data === on.data ? '' : '\n         guest memory differs'));
    if (!(opts && opts.mayDecline)) {
      check(`  ${name}: a multi-block region installed and ran`,
        installs >= 1 && entries >= 1,
        `regionInstalls=${installs} multiBlockEntries=${entries} ` +
        `why=${e.get_block_exec_region_why()} ` +
        // Which half failed: no attempt at all means no head was ever branched
        // to (discovery never started), an attempt with no install means the
        // walk ran and the closure was refused.
        `hotProbes=${e.get_block_exec_walk_probes() - probesBefore} ` +
        `walkAttempts=${e.get_block_exec_walk_attempts() - attemptsBefore} ` +
        // $bx_region_why keeps only the LAST reason, and "the closure came out
        // shorter than two blocks" overwrites the per-member refusal that made
        // it short. The classify histogram is where that survives.
        `nofit=[${nofitBefore.map((b, i) =>
          `${i + 1}:${e.get_block_exec_region_nofit(i + 1) - b}`)
          .filter(t => !t.endsWith(':0')).join(' ')}]` +
        ` — declined, so this case proves nothing`);
    }
    return { off, on, installs, entries };
  }

  {
    // Two blocks and a back edge: the loop head tests and branches, the body
    // falls through to it. The back edge is INTERNAL -- it resolves to a
    // member, not an exit -- which is the property that makes a loop worth
    // folding at all.
    region('2-block if/else loop', asm([
      [...movRI(ECX, 6), ...movRI(EAX, 0)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],                       // cmp ecx,0
      { j: 'jcc', cc: JZ, to: 'out' },
      [...aluRR(ADD, EAX, ECX), ...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]));

    // A diamond: one test, two arms, one join. Both arms are members and the
    // join is a member too, so the whole shape is one descriptor and neither
    // arm costs a transfer.
    //
    // The leading `jmp` is not decoration. Discovery starts at heads the guest
    // BRANCHES to, which is what makes the walk cost once per hot head rather
    // than once per decode; a diamond with no back edge and no branch into its
    // test block is never a head at all. In a real binary that entry edge is
    // the call or the branch that reaches the function; here it has to be
    // written down.
    // Six iterations, not two. Discovery is hotness-gated, so a region is
    // installed a couple of entries INTO the loop and only the iterations
    // after that one enter it; a snippet that stops as soon as the descriptor
    // exists installs it and proves nothing about running it.
    region('diamond (both arms and the join in one region)', asm([
      [...movRI(ECX, 6)],
      { label: 'top' },
      [...aluRI(7, ESI, 4)],                       // cmp esi,4
      { j: 'jcc', cc: JB, to: 'low' },
      [...movRI(EAX, 0x1111), ...aluRR(ADD, EAX, ESI)],
      { j: 'jmp', to: 'join' },
      { label: 'low' },
      [...movRI(EAX, 0x2222), ...aluRR(SUB, EAX, ESI)],
      { label: 'join' },
      [...movRR(EDX, EAX), ...incR(EDX), ...decR(ESI), ...decR(ECX)],
      { j: 'jcc', cc: JNZ, to: 'top' },
      JOIN,
    ]));

    // A three-state machine driven off guest memory: several blocks, several
    // internal edges and one exit. This is the shape the census counted as
    // 5-16 block, in miniature.
    region('state machine over guest memory', asm([
      [...movRI(ECX, 8), ...movRI(EAX, 0)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      // `test edx,1` here; the `and edx,1` twin, which writes a register as
      // well as the flags, is a terminator producer too since round 10 and has
      // its own case below.
      [...load32(EDX, EBX, 0x40), 0xF7, 0xC0 | EDX, ...le32(1)],
      { j: 'jcc', cc: JZ, to: 'even' },
      [...aluRI(0, EAX, 0x10), ...store32(EAX, EBX, 0x44)],
      { j: 'jmp', to: 'step' },
      { label: 'even' },
      [...aluRI(5, EAX, 3), ...store32(EAX, EBX, 0x48)],
      { label: 'step' },
      [...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]));

    // The head reached by a TAKEN Jcc, going forward. Round 9's discovery
    // walked $decode_run's fall-through chain, so a region whose head is a
    // branch target was invisible to it however hot it got; this is the case
    // that was measured at ~0% coverage and is the reason the walk exists.
    region('a region whose head is a forward Jcc target', asm([
      [...movRI(ECX, 6), ...movRI(EAX, 0)],
      [...aluRI(7, ESI, 0)],                       // cmp esi,0 (seeded 4)
      { j: 'jcc', cc: JNZ, to: 'top' },
      [...movRI(EAX, 0xDEAD)],                     // never runs
      { j: 'jmp', to: 'out' },
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...aluRR(ADD, EAX, ECX), ...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]));

    // The head reached ONLY by a back edge: the first entry falls through into
    // it, so the one branch that ever targets it is the loop's own `jmp` at
    // the bottom. Three blocks, so the region is not the degenerate two.
    region('a region entered from a loop back edge', asm([
      [...movRI(ECX, 6), ...movRI(EAX, 0)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...load32(EDX, EBX, 0x50), ...aluRI(4, EDX, 1)],   // and edx,1
      { j: 'jcc', cc: JZ, to: 'even' },
      [...aluRI(0, EAX, 5)],
      { label: 'even' },
      [...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]));

    // `and r,imm` as the terminator's flag producer -- term_kind 9. Round 9
    // declined this shape 1.8M times on Diablo alone (`noFlagProducer`), which
    // is what item 2 of round 10 is about. The `and` writes EDX as well as the
    // flags, so a wrong fold shows up in the register compare, not only in the
    // branch.
    region('ALU r,imm as the terminator flag producer', asm([
      [...movRI(ECX, 6), ...movRI(EAX, 0)],
      { label: 'top' },
      [...movRR(EDX, ECX), ...aluRI(4, EDX, 3)],   // and edx,3
      { j: 'jcc', cc: JZ, to: 'four' },
      [...aluRI(0, EAX, 0x11)],
      { j: 'jmp', to: 'step' },
      { label: 'four' },
      [...aluRI(5, EAX, 7)],
      { label: 'step' },
      [...decR(ECX)],
      { j: 'jcc', cc: JNZ, to: 'top' },
      { label: 'out' },
      JOIN,
    ]));

    // `sub r,r` as the producer -- term_kind 8, the register-register half of
    // the same widening.
    region('ALU r,r as the terminator flag producer', asm([
      [...movRI(ECX, 6), ...movRI(EAX, 0)],
      { label: 'top' },
      [...movRR(EDX, ECX), ...aluRR(SUB, EDX, ESI)],   // sub edx,esi
      { j: 'jcc', cc: JZ, to: 'hit' },
      [...aluRI(0, EAX, 0x11)],
      { j: 'jmp', to: 'step' },
      { label: 'hit' },
      [...aluRI(5, EAX, 7)],
      { label: 'step' },
      [...decR(ECX)],
      { j: 'jcc', cc: JNZ, to: 'top' },
      { label: 'out' },
      JOIN,
    ]));
  }

  {
    // The two cost bounds on discovery, checked by forcing them rather than by
    // reading the code: a budget too small to reach the closure must DECLINE
    // (not install a truncated region), and a head that keeps declining must
    // stop being attempted at all.
    const wide = asm([
      [...movRI(ECX, 40), ...movRI(EAX, 0)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...load32(EDX, EBX, 0x50), ...aluRI(4, EDX, 1)],
      { j: 'jcc', cc: JZ, to: 'even' },
      [...aluRI(0, EAX, 5)],
      { j: 'jmp', to: 'step' },
      { label: 'even' },
      [...aluRI(5, EAX, 3)],
      { label: 'step' },
      [...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]);

    e.set_block_exec_walk_budget(1);
    const whyAll = [];
    for (let w = 1; w <= 9; w += 1) whyAll.push(e.get_block_exec_region_why_n(w));
    const whyBefore = e.get_block_exec_region_why_n(8);
    const insBefore = e.get_block_exec_region_installs();
    const attBefore = e.get_block_exec_walk_attempts();
    const probeBefore = e.get_block_exec_walk_probes();
    const budgetOff = arm(wide, false);
    const budgetOn = arm(wide, true);
    const budgetDeclines = e.get_block_exec_region_why_n(8) - whyBefore;
    const declinesAny = whyAll.reduce(
      (n, b, i) => n + (e.get_block_exec_region_why_n(i + 1) - b), 0);
    const budgetInstalls = e.get_block_exec_region_installs() - insBefore;
    const attempts = e.get_block_exec_walk_attempts() - attBefore;
    const probes = e.get_block_exec_walk_probes() - probeBefore;

    // "Cleanly" is the claim: nothing installs, the decline is recorded, and
    // the guest gets the same answer either way. Which reason is recorded is
    // not fixed — a budget of one stops the walk before the head's successors
    // are ever classified, so the closure comes out short (reason 6) rather
    // than over budget (reason 8); either is a refusal, and neither truncates.
    check('a budget too small to reach the closure declines',
      declinesAny >= 1 && budgetInstalls === 0,
      `walkBudget declines=${budgetDeclines} installs=${budgetInstalls} ` +
      `attempts=${attempts} probes=${probes} ` +
      `why=[${whyAll.map((b, i) => `${i + 1}:${e.get_block_exec_region_why_n(i + 1) - b}`)
        .filter(t => !t.endsWith(':0')).join(' ')}]`);
    check('  and the block still runs correctly',
      ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi']
        .every(k => budgetOff[k] === budgetOn[k]) &&
      budgetOff.data === budgetOn.data && budgetOff.eip === budgetOn.eip,
      `off ${hexRegs(budgetOff)}\n         on  ${hexRegs(budgetOn)}`);
    // 40 iterations at K=2 is about twenty gate firings on the loop head. The
    // memo caps what those cost: a head that has declined its limit is never
    // walked again, so attempts stop while probes keep arriving.
    check('  a head that keeps declining stops being attempted',
      attempts < probes && attempts <= 12,
      `attempts=${attempts} probes=${probes}`);
    check('    and the memo is what stopped them',
      e.get_block_exec_walk_memo() > 0,
      `memoRefusals=${e.get_block_exec_walk_memo()}`);
    e.set_block_exec_walk_budget(24);
  }

  {
    // Entry from OUTSIDE into a member. The region publishes over its whole
    // guest extent, so the interior address is not in the index as a block of
    // its own; jumping there must decode it on its own terms and produce the
    // same answer as the threaded build, not run the region from its head.
    const pieces = asm([
      [...movRI(EAX, 0x100)],
      { label: 'mid' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...aluRI(0, EAX, 7), ...decR(ECX)],
      { j: 'jmp', to: 'mid' },
      { label: 'out' },
      JOIN,
    ]);
    // Where `mid` lands: after the 5-byte `mov eax,imm32`.
    const MID = 5;
    const inner = (blockExec) => {
      const addr = nextCode();
      const wa = g2w(addr);
      for (let i = 0; i < pieces.length; i++) mem[wa + i] = pieces[i];
      e.set_block_exec_min_uops(2);
      e.set_block_exec(blockExec ? 1 : 0);
      const go = (from) => {
        seedData();
        normalizeFlags();
        e.set_block_exec_min_uops(2);
        e.set_block_exec(blockExec ? 1 : 0);
        e.set_eax(0); e.set_ecx(4); e.set_edx(0); e.set_ebx(DATA);
        e.set_esi(SEED.esi); e.set_edi(SEED.edi); e.set_ebp(0);
        e.set_esp(STACK_TOP);
        dv.setUint32(g2w(STACK_TOP), 0, true);
        e.set_eip(from);
        e.run(100000);
        return `${(e.get_eax() >>> 0).toString(16)}/${(e.get_ecx() >>> 0).toString(16)}`;
      };
      const head = go(addr);          // builds the region
      const mid = go(addr + MID);     // enters a member from outside
      const again = go(addr);         // and the head still works afterwards
      e.set_block_exec(0);
      return `${head} ${mid} ${again}`;
    };
    const eoff = inner(false), eon = inner(true);
    check('a jump into the middle of a region agrees with threaded',
      eoff === eon, `${eoff}  vs  ${eon}`);
  }

  {
    // SMC of a MEMBER, not of the head. The region covers the member's bytes,
    // so the ordinary per-page cover marks have to retire the whole region --
    // if they only retired a block that no longer exists in the index, the
    // stale region would keep running the old code.
    const mk = (delta) => asm([
      [...movRI(EAX, 0), ...movRI(ECX, 3)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...aluRI(0, EAX, delta), ...decR(ECX)],     // <- the member that is rewritten
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]);
    const v1 = mk(0x11), v2 = mk(0x22);
    if (v1.length !== v2.length) throw new Error('the member-SMC pair must be the same length');
    const memberSmc = (blockExec) => {
      const addr = nextCode();
      const wa = g2w(addr);
      for (let i = 0; i < v1.length; i++) mem[wa + i] = v1[i];
      const runAt = () => {
        seedData();
        normalizeFlags();
        e.set_block_exec_min_uops(2);
        e.set_block_exec(blockExec ? 1 : 0);
        e.set_eax(0); e.set_ecx(0); e.set_edx(0); e.set_ebx(DATA);
        e.set_esi(SEED.esi); e.set_edi(SEED.edi); e.set_ebp(0);
        e.set_esp(STACK_TOP);
        dv.setUint32(g2w(STACK_TOP), 0, true);
        e.set_eip(addr);
        e.run(100000);
        return (e.get_eax() >>> 0).toString(16);
      };
      e.set_block_exec_min_uops(2);
      e.set_block_exec(blockExec ? 1 : 0);
      const first = runAt();
      // Rewrite through the guest store path, as the head-SMC case does.
      for (let i = 0; i < v2.length; i += 4) {
        if (v1[i] === v2[i] && v1[i + 1] === v2[i + 1]
            && v1[i + 2] === v2[i + 2] && v1[i + 3] === v2[i + 3]) continue;
        const word = v2[i] | (v2[i + 1] << 8) | (v2[i + 2] << 16) | (v2[i + 3] << 24);
        const w = nextCode();
        const ww = g2w(w);
        const st = [...store32(EAX, EBX, i), ...RET];
        for (let k = 0; k < st.length; k++) mem[ww + k] = st[k];
        e.set_eax(word >>> 0); e.set_ebx(addr);
        e.set_esp(STACK_TOP); dv.setUint32(g2w(STACK_TOP), 0, true);
        e.set_eip(w); e.run(1000);
      }
      const second = runAt();
      e.set_block_exec(0);
      return { first, second };
    };
    const moff = memberSmc(false), mon = memberSmc(true);
    check('SMC of a region member: the first run agrees',
      moff.first === mon.first, `${moff.first} vs ${mon.first}`);
    check('SMC of a region member: the rewrite is seen',
      moff.second === mon.second, `${moff.second} vs ${mon.second}`);
    check('SMC of a region member: the rewrite changed the answer',
      moff.first !== moff.second, `${moff.first} == ${moff.second}`);
  }

  {
    // A fault inside a region. With --fault-null unarmed an unmapped access
    // reads the NULL sentinel and writes nowhere; the contract is that a
    // region absorbs it exactly as threaded code does, from a member block
    // rather than from the head.
    region('an unmapped access from a member matches threaded', asm([
      [...movRI(ECX, 2), ...movRI(EAX, 0)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...load32abs(EDX, 0x7F000000), ...aluRR(ADD, EAX, EDX), ...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]));
  }

  {
    // Budget expiry mid-region. `run(3)` cannot finish the loop, so the region
    // must side-exit at a block edge with every register published and resume
    // from a real basic-block entry. Driving both arms in the same small
    // slices is the only way to see that the stop points agree.
    const bytes = asm([
      [...movRI(ECX, 12), ...movRI(EAX, 0)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...aluRI(0, EAX, 5), ...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]);
    const sliced = (blockExec) => {
      const addr = nextCode();
      const wa = g2w(addr);
      for (let i = 0; i < bytes.length; i++) mem[wa + i] = bytes[i];
      seedData();
      normalizeFlags();
      e.set_block_exec_min_uops(2);
      e.set_block_exec(blockExec ? 1 : 0);
      e.set_eax(0); e.set_ecx(0); e.set_edx(0); e.set_ebx(DATA);
      e.set_esi(SEED.esi); e.set_edi(SEED.edi); e.set_ebp(0);
      e.set_esp(STACK_TOP);
      dv.setUint32(g2w(STACK_TOP), 0, true);
      e.set_eip(addr);
      const trace = [];
      for (let i = 0; i < 200 && (e.get_eip() >>> 0) !== 0; i += 1) {
        e.run(3);
        const eip = e.get_eip() >>> 0;
        trace.push(`${eip === 0 ? 'ran' : eip - addr}:${(e.get_eax() >>> 0).toString(16)}` +
                   `/${(e.get_ecx() >>> 0).toString(16)}`);
      }
      e.set_block_exec(0);
      return trace.join(' ');
    };
    const boff = sliced(false), bon = sliced(true);
    check('a region interrupted by the block budget resumes identically',
      boff === bon,
      `\n         off ${boff.slice(0, 200)}\n         on  ${bon.slice(0, 200)}`);
    check('  and it really was interrupted', boff.split(' ').length > 3,
      `${boff.split(' ').length} slices`);
  }

  {
    // A breakpoint on a member's entry. Breakpoints are a $run-loop-head
    // facility, so the contract is the same one the single-block case pins:
    // the two arms agree about which entries halt and about the state there.
    const bytes = asm([
      [...movRI(ECX, 3), ...movRI(EAX, 0)],
      { label: 'top' },
      [...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...aluRI(0, EAX, 9), ...decR(ECX)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]);
    const TOP = 10;   // two 5-byte `mov r,imm32`
    const withBp = (blockExec) => {
      const addr = nextCode();
      const wa = g2w(addr);
      for (let i = 0; i < bytes.length; i++) mem[wa + i] = bytes[i];
      e.set_bp(addr + TOP);
      const once = () => {
        seedData();
        normalizeFlags();
        e.set_block_exec_min_uops(2);
        e.set_block_exec(blockExec ? 1 : 0);
        e.set_eax(0); e.set_ecx(0); e.set_edx(0); e.set_ebx(DATA);
        e.set_esi(SEED.esi); e.set_edi(SEED.edi); e.set_ebp(0);
        e.set_esp(STACK_TOP);
        dv.setUint32(g2w(STACK_TOP), 0, true);
        e.set_eip(addr);
        e.run(100000);
        const eip = e.get_eip() >>> 0;
        return `${eip === 0 ? 'ran' : `@+${eip - addr}`}|` +
               `${(e.get_eax() >>> 0).toString(16)}/${(e.get_ecx() >>> 0).toString(16)}`;
      };
      let guard = 0;
      while (!once().startsWith('@') && ++guard < 4) { /* prime the skip latch */ }
      const r = `${once()} THEN ${once()}`;
      e.set_bp(0);
      e.set_block_exec(0);
      return r;
    };
    const pOff = withBp(false), pOn = withBp(true);
    check('a breakpoint inside a region behaves identically in both arms',
      pOff === pOn, `${pOff}  vs  ${pOn}`);
  }

  console.log(`  ${regionInstalls} multi-block regions installed, ` +
    `${regionEntries} entries into one`);
  check('the multi-block matcher installed something in this run',
    regionInstalls >= 3, `regionInstalls=${regionInstalls}`);

  console.log('\n-- declines --');

  console.log('\n-- round 11: the decode-time load/op split --');

  // Everything below is differential in the same way as the rest of this file,
  // but a differential pass is NOT the assertion that matters here. A pass
  // that never fires also produces two identical arms, so each case asserts
  // the meter as well: `rle >= 1` for the ones where a load really is
  // redundant, and `rle === 0` for the ones where the alias rule must refuse.
  // The negatives are the point — §16.2's rule is only worth writing down if
  // something checks that it is obeyed.
  const store8abs = (s8, abs) => [0x88, 0x05 | (s8 << 3), ...le32(abs)];

  const splitCase = (name, body, want, seed) => {
    const r = equiv(name, body, seed);
    const p = r.on.pass;
    for (const k of Object.keys(want)) {
      const [op, n] = want[k];
      const got = p[k];
      check(`  ${name}: ${k} ${op} ${n}`,
        op === '>=' ? got >= n : got === n,
        `${k}=${got} (split=${p.split} rle=${p.rle} movelim=${p.movelim} ` +
        `immfold=${p.immfold} stlf=${p.stlf})`);
    }
    return r;
  };

  // (b) redundant-load elimination, the positive. Two dword reads of one
  // absolute address with nothing between them that the rule kills, so the
  // second becomes a register move off the first.
  splitCase('two loads of one address: the second is eliminated',
    [...load32abs(EAX, DATA + 0x30), ...aluRR(XOR, ECX, ECX),
     ...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EDX, ECX)],
    { rle: ['>=', 1] });

  // The alias rule, clause by clause. Each of these would be a correctness bug
  // if the load were eliminated, and each is a *shape* the rule names rather
  // than a value it computed, because nothing at decode time knows the values.
  splitCase('an aliasing store between two loads blocks elimination',
    [...load32abs(EAX, DATA + 0x30), ...store32abs(ECX, DATA + 0x30),
     ...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EDX, EAX)],
    { rle: ['==', 0] });

  splitCase('a DISJOINT store between two loads does not block it',
    [...load32abs(EAX, DATA + 0x30), ...store32abs(ECX, DATA + 0x40),
     ...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EDX, EAX)],
    { rle: ['>=', 1] });

  // Partial-width overlap: one byte inside the dword. The ranges intersect, so
  // the fact dies even though the widths differ — this is the case a
  // same-width-only comparison would get wrong.
  splitCase('a byte store INSIDE the loaded dword blocks elimination',
    [...load32abs(EAX, DATA + 0x30), ...store8abs(ECX, DATA + 0x31),
     ...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EDX, EAX)],
    { rle: ['==', 0] });

  splitCase('a byte store one past the dword does not block it',
    [...load32abs(EAX, DATA + 0x30), ...store8abs(ECX, DATA + 0x34),
     ...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EDX, EAX)],
    { rle: ['>=', 1] });

  // The base register written between the two loads: same displacement, two
  // different addresses.
  splitCase('a write to the base register between two loads blocks it',
    [...load32(EAX, EBX, 0x30), ...incR(EBX),
     ...load32(EDX, EBX, 0x30), ...aluRR(ADD, EDX, EAX)],
    { rle: ['==', 0] });

  // An op the classifier does not model — `cdq` is a FALLBACK here — stands in
  // for every opaque thing a block can contain, a call included: the pass
  // cannot see what it touched, so every fact dies.
  splitCase('an unmodelled op between two loads blocks it',
    [...load32abs(EAX, DATA + 0x30), ...CDQ,
     ...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EDX, EAX)],
    { rle: ['==', 0] });

  // push/pop move ESP and write memory the pass does not model as a store.
  splitCase('a push/pop pair between two loads blocks it',
    [...load32abs(EAX, DATA + 0x30), ...pushR(ECX), ...popR(ECX),
     ...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EDX, EAX)],
    { rle: ['==', 0] });

  // (a) the split itself: `op r32,[mem]` is one micro-op today only as a
  // FALLBACK, so taking it apart into a load into a temp lane plus the
  // register form is what converts it to native. The differential is the whole
  // assertion for correctness; `split >= 1` says it actually happened.
  splitCase('add r32,[base+disp] is split into a load and a register add',
    [...aluRM(ADD_RM, EAX, EBX, 0x10), ...aluRR(XOR, ECX, ECX),
     ...aluRM(SUB_RM, EDX, EBX, 0x14), ...aluRR(ADD, EDX, ECX)],
    { split: ['>=', 1] });

  splitCase('and/or/xor/cmp r32,[abs] split the same way',
    [...aluRAbs(AND_RM, EAX, DATA + 0x20), ...aluRAbs(OR_RM, ECX, DATA + 0x24),
     ...aluRAbs(XOR_RM, EDX, DATA + 0x28), ...aluRAbs(CMP_RM, EBX, DATA + 0x2C)],
    { split: ['>=', 1] });

  splitCase('imul r32,[base+disp] splits',
    [...imulRM(EAX, EBX, 0x18), ...aluRR(XOR, ECX, ECX),
     ...imulRM(EDX, EBX, 0x1C), ...aluRR(ADD, EDX, ECX)],
    { split: ['>=', 1] });

  // A split load feeding a second op at the SAME address: the temp lane the
  // first split wrote is itself a fact, so the second split's load is
  // redundant. This is the compound case the two transforms only reach
  // together, and the one that would break loudly if the lane allocator
  // reused a live lane.
  splitCase('two memory-source ops on one address share the loaded lane',
    [...aluRM(ADD_RM, EAX, EBX, 0x10), ...aluRM(SUB_RM, EDX, EBX, 0x10),
     ...aluRR(XOR, ECX, ECX), ...aluRR(ADD, ECX, EAX)],
    { split: ['>=', 2], rle: ['>=', 1] });

  // (d) register-move elimination and (e) immediate folding. Both are about a
  // micro-op disappearing rather than a memory access, so the meter is the
  // only way to see them at all.
  // The source here is a LOAD, not an immediate, on purpose: a move off a
  // known constant is folded by (e) instead and the move never reaches (d),
  // which is exactly what the first draft of this case measured by accident.
  // And the consumer must REDEFINE the moved register — `mov ecx,eax ; add
  // edx,ecx` is not a move-elimination shape at all, because ecx stays live.
  splitCase('a move feeding the next op that redefines it is removed',
    [...load32abs(EAX, DATA + 0x30), ...movRR(ECX, EAX), ...aluRR(ADD, ECX, ESI),
     ...aluRR(XOR, EDI, ECX)],
    { movelim: ['>=', 1] });

  splitCase('a move the next op simply overwrites is removed',
    [...load32abs(EAX, DATA + 0x30), ...movRR(ECX, EAX), ...movRR(ECX, EDX),
     ...aluRR(XOR, EDI, ECX)],
    { movelim: ['>=', 1] });

  splitCase('a move off a known constant folds to an immediate',
    [...movRI(EAX, 0x0000BEEF), ...movRR(ECX, EAX), ...aluRR(ADD, EDX, ECX),
     ...aluRR(XOR, EDI, EDX)],
    { immfold: ['>=', 1] });

  // Store-to-load forwarding is REMOVED, not merely unused: the $g2w NULL
  // sentinel discards a store to an unmapped address and returns 0 for the
  // load, so a forwarded value and the real one differ with nothing to say so.
  // This asserts the meter stays at zero, which is what stops the transform
  // being reintroduced under the same name without the sentinel being fixed.
  const stlfProbe = splitCase('store-to-load forwarding never fires',
    [...movRI(EAX, 0x1234ABCD), ...store32abs(EAX, DATA + 0x30),
     ...load32abs(EDX, DATA + 0x30), ...aluRR(XOR, ECX, EDX)],
    { stlf: ['==', 0] });
  check('  a store still kills the fact rather than seeding one',
    stlfProbe.on.pass.rle === 0, `rle=${stlfProbe.on.pass.rle}`);

  // And the case that caught it: a store through a register holding an
  // unmapped address, followed by a read back. The threaded arm reads 0.
  splitCase('a store through a null base register, then a read back',
    [...movRI(EBX, 0), ...movRI(EAX, 0x1234ABCD), ...store32(EAX, EBX, 0x40),
     ...load32(ECX, EBX, 0x40), ...aluRR(XOR, EDX, ECX)],
    { stlf: ['==', 0] });

  {
    // (§16.4) Across a block boundary inside a region, nothing is carried. The
    // pass runs per member block, so the same address loaded either side of a
    // Jcc is loaded twice — the conservative end of the rule, asserted here so
    // that a future edge-carrying version has to change this case deliberately
    // rather than by accident.
    const r = region('facts do not cross a block boundary in a region', asm([
      [...movRI(ECX, 6), ...movRI(EAX, 0)],
      { label: 'top' },
      [...load32abs(EDX, DATA + 0x30), ...aluRR(ADD, EAX, EDX),
       ...decR(ECX), ...aluRI(7, ECX, 0)],
      { j: 'jcc', cc: JZ, to: 'out' },
      [...load32abs(EDI, DATA + 0x30), ...aluRR(ADD, EAX, EDI),
       ...aluRR(XOR, ESI, ESI)],
      { j: 'jmp', to: 'top' },
      { label: 'out' },
      JOIN,
    ]));
    check('  no elimination carried across the edge',
      r.on.pass.rle === 0, `rle=${r.on.pass.rle}`);
  }

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
