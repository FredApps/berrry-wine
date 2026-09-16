#!/usr/bin/env node
// Block chaining (--block-chain, src/04-cache.wat, docs/block-chaining-design.md)
// against the unchained interpreter, one control-flow shape at a time.
//
// What this file is FOR is the claim the design cannot argue its way to: that a
// transfer which skips $branch_end entirely lands in the same place, with the
// same state, as one that goes to the desk -- and, more importantly, that the
// stale-pointer cases all still lose. A chain slot is a cached pointer INTO a
// threaded-code chunk, and a chunk is reused, relocated, retired and thrown
// away underneath it. Every one of those events has a case here.
//
// Method, copied deliberately from test/test-block-exec.js: run identical x86
// twice in ONE instance at two different code addresses, with --block-chain
// armed for one of them. Two addresses because the slot is written at the first
// transfer through a terminator, so re-running the same address with the flag
// flipped would run code that is already patched; one instance because a second
// instance is also a second heap, a second chunk arena and a second set of
// lazy-flag globals -- three more ways for the arms to differ for reasons that
// are not chaining.
//
// Run: node test/test-block-chain.js

const fs = require('fs');
const path = require('path');
const { createHostImports } = require(path.join(__dirname, '..', 'lib/host-imports'));
const RegionMap = require('../lib/region-map.generated.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}

// ---- x86 encoders. Architectural register numbering.
const EAX = 0, ECX = 1, EDX = 2, EBX = 3, ESP = 4, EBP = 5, ESI = 6, EDI = 7;
const le32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
const movRI = (r, v) => [0xB8 + r, ...le32(v)];
const movRR = (d, s) => [0x89, 0xC0 | (s << 3) | d];
const aluRR = (opc, d, s) => [opc, 0xC0 | (s << 3) | d];
const ADD = 0x01, SUB = 0x29, XOR = 0x31, CMP = 0x39;
const aluRI = (digit, r, v) => [0x81, 0xC0 | (digit << 3) | r, ...le32(v)];
const cmpRI = (r, v) => aluRI(7, r, v);
const incR = r => [0x40 + r];
const decR = r => [0x48 + r];
const store32 = (s, base, disp) => [0x89, 0x80 | (s << 3) | base, ...le32(disp)];
const load32 = (d, base, disp) => [0x8B, 0x80 | (d << 3) | base, ...le32(disp)];
// Short branches. `rel` is measured from the END of the two-byte instruction,
// which is what makes a hand-built loop body's length the only thing to count.
const jmpRel8 = rel => [0xEB, rel & 0xFF];
const jzRel8 = rel => [0x74, rel & 0xFF];
const jnzRel8 = rel => [0x75, rel & 0xFF];
const PUSHFD = [0x9C];
const RET = [0xC3];
const NOP = [0x90];
const popR = r => [0x58 + r];

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

  if (typeof e.set_block_chain !== 'function') {
    console.log('FAIL: set_block_chain is not exported — the build predates block chaining');
    process.exit(1);
  }

  console.log('-- the flag itself --');
  // OFF in a fresh instance is the whole ship-safety claim, so it is asserted.
  check('chaining is OFF in a fresh instance', e.get_block_chain() === 0,
    `get_block_chain()=${e.get_block_chain()}`);
  e.set_block_chain(1);
  check('the flag arms', e.get_block_chain() === 1);
  // Mutual exclusion with the block executor, in BOTH orders. The executor
  // copies threaded streams into its descriptor pools, and a chain delta is
  // relative to the operand word's own address, so a copied stream carries a
  // delta that points into the chunk it was copied FROM.
  e.set_block_exec(1);
  check('arming the executor disarms chaining', e.get_block_chain() === 0,
    `get_block_chain()=${e.get_block_chain()}`);
  e.set_block_chain(1);
  check('chaining refuses to arm while the executor is on', e.get_block_chain() === 0,
    `get_block_chain()=${e.get_block_chain()}`);
  e.set_block_exec(0);
  e.set_block_chain(0);
  check('chaining is off again for the state cases', e.get_block_chain() === 0);

  const STACK_TOP = imageBase + 0xD00000;
  const DATA = imageBase + 0x900000;
  const DATA_LEN = 256;

  let codeOffset = 0;
  const nextCode = () => { const a = imageBase + 0x20000 + codeOffset; codeOffset += 512; return a; };

  const SEED = { eax: 0x1234ABCD, ecx: 0x0000000F, edx: 0x7FFFFFFF,
                 ebx: DATA, esi: 0x00000004, edi: 0xFFFFFFFE };

  function seedData() {
    for (let i = 0; i < DATA_LEN; i++) mem[g2w(DATA) + i] = (i * 7 + 3) & 0xFF;
  }

  // The lazy-flag globals survive between runs, so whatever ran last decides
  // the CF the next block's first `adc` reads. Every arm starts from the same
  // known join.
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

  function writeAt(addr, bytes) {
    const wa = g2w(addr);
    for (let i = 0; i < bytes.length; i++) mem[wa + i] = bytes[i];
  }

  function setRegs(seed) {
    const regs = Object.assign({}, SEED, seed || {});
    e.set_eax(regs.eax); e.set_ecx(regs.ecx); e.set_edx(regs.edx);
    e.set_ebx(regs.ebx); e.set_esi(regs.esi); e.set_edi(regs.edi);
    e.set_ebp(0);
    e.set_esp(STACK_TOP);
    dv.setUint32(g2w(STACK_TOP), 0, true);   // sentinel return address
  }

  function snapshot(addr) {
    return {
      eip: e.get_eip() >>> 0,
      eax: e.get_eax() >>> 0, ecx: e.get_ecx() >>> 0, edx: e.get_edx() >>> 0,
      ebx: e.get_ebx() >>> 0, esp: e.get_esp() >>> 0, ebp: e.get_ebp() >>> 0,
      esi: e.get_esi() >>> 0, edi: e.get_edi() >>> 0,
      data: Buffer.from(mem.subarray(g2w(DATA), g2w(DATA) + DATA_LEN)).toString('hex'),
      addr,
    };
  }

  const hexRegs = s => ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi']
    .map(k => `${k}=${s[k].toString(16).padStart(8, '0')}`).join(' ');

  // Run one arm. `chain` steers the FIRST transfer through a fresh address's
  // terminators, which is where a slot gets written, so the two arms are two
  // genuinely different histories of the same bytes.
  function arm(bytes, chain, seed) {
    const addr = nextCode();
    writeAt(addr, bytes);
    seedData();
    normalizeFlags();
    e.set_block_chain(chain ? 1 : 0);
    setRegs(seed);
    const hitsBefore = e.get_chain_hits();
    const slowBefore = e.get_chain_slow();
    const patchBefore = e.get_chain_patches();
    e.set_eip(addr);
    e.run(200000);
    const out = snapshot(addr);
    out.hits = Number(e.get_chain_hits() - hitsBefore);
    out.slow = Number(e.get_chain_slow() - slowBefore);
    out.patches = e.get_chain_patches() - patchBefore;
    e.set_block_chain(0);
    return out;
  }

  // Compare every architectural output. `addr` differs by construction and is
  // excluded; `eip` is not, because landing in the right place is the property
  // under test.
  function agree(name, a, b, extra) {
    const keys = ['eip', 'eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
    const same = keys.every(k => a[k] === b[k]) && a.data === b.data;
    check(name, same, same ? '' :
      `\n        off ${hexRegs(a)} eip=${a.eip.toString(16)}\n        on  ${hexRegs(b)} eip=${b.eip.toString(16)}`);
    if (extra) extra(a, b);
  }

  // A block always ends with the flags probe and the terminator, so EFLAGS is
  // compared as a value in EBP rather than inferred from a later branch.
  const tail = [...PUSHFD, ...popR(EBP), ...RET];

  console.log('\n-- the shapes a chain slot can hold --');

  {
    // A counted loop. The back edge is a TAKEN conditional whose target is the
    // block's own head, which is the single most common chainable edge in real
    // code and the one bench-loops.js prices.
    //   mov ecx,N / head: add eax,ecx / dec ecx / jnz head / tail
    const body = [...aluRR(ADD, EAX, ECX), ...decR(ECX)];
    const code = [...movRI(ECX, 40), ...body, ...jnzRel8(-(body.length + 2)), ...tail];
    const off = arm(code, false);
    const on = arm(code, true);
    agree('counted loop: the two arms agree', off, on);
    check('counted loop: the on arm actually chained', on.hits > 0,
      `hits=${on.hits} slow=${on.slow} patches=${on.patches}`);
    check('counted loop: the off arm chained nothing', off.hits === 0 && off.patches === 0,
      `hits=${off.hits} patches=${off.patches}`);
  }

  {
    // A direct jump. H43's operand word is emitted as 0 and read by nothing, so
    // this is the shape whose whole 32-bit slot is available.
    //   mov eax,1 / jmp fwd / (dead) / fwd: inc eax / tail
    const dead = [...movRI(EAX, 0xDEAD)];
    const code = [...movRI(EAX, 1), ...jmpRel8(dead.length), ...dead,
                  ...incR(EAX), ...tail];
    const off = arm(code, false);
    const on = arm(code, true);
    agree('forward jmp: the two arms agree', off, on);
    check('forward jmp: eax is 2, so the dead block really was skipped',
      off.eax === 2, `eax=${off.eax.toString(16)}`);
  }

  {
    // A conditional that FALLS THROUGH to a block that is not adjacent in the
    // chunk. This is the edge round 15 added over the taken-only first cut: the
    // decoder lays the taken target down first, so the fall-through successor
    // is somewhere else in the chunk and the adjacency bit is clear. Both edges
    // of one Jcc share one slot, and the slot follows whichever last missed --
    // so a loop that alternates is also the thrash case.
    //   head: inc edx / test-ish cmp / jz away / fall: add eax,ecx / jmp join
    //   away: sub eax,ecx / join: dec esi / jnz head / tail
    const away = [...aluRR(SUB, EAX, ECX)];
    const fall = [...aluRR(ADD, EAX, ECX)];
    const join = [...decR(ESI)];
    // Layout: [cmp][jz +len(fall)+2][fall][jmp +len(away)][away][join][jnz head][tail]
    const cmpPart = [...incR(EDX), ...cmpRI(EDX, 0)];
    const jzPart = jzRel8(fall.length + 2);
    const jmpPart = jmpRel8(away.length);
    const headLen = cmpPart.length + jzPart.length + fall.length + jmpPart.length
                  + away.length + join.length;
    const code = [...movRI(ESI, 24), ...cmpPart, ...jzPart, ...fall, ...jmpPart,
                  ...away, ...join, ...jnzRel8(-(headLen + 2)), ...tail];
    const off = arm(code, false);
    const on = arm(code, true);
    agree('alternating fall-through/taken: the two arms agree', off, on);
    check('alternating fall-through/taken: the on arm chained', on.hits > 0,
      `hits=${on.hits} slow=${on.slow} patches=${on.patches}`);
  }

  console.log('\n-- the stale-pointer cases --');

  {
    // Self-modifying code, the CHAINED-POINTER variant of the pattern in
    // test-block-exec.js. The loop runs long enough that its back edge is
    // patched, THEN the loop body's guest bytes are rewritten through a real
    // guest store, THEN it runs again. The rewrite retires the block and
    // recompiles it somewhere else in the chunk; a chain slot that survived
    // would send the second run into the retired stream.
    const mk = (delta) => {
      const body = [...aluRI(0, EAX, delta), ...decR(ECX)];
      return [...movRI(ECX, 30), ...movRI(EAX, 0), ...body,
              ...jnzRel8(-(body.length + 2)), ...tail];
    };
    const v1 = mk(3), v2 = mk(5);
    if (v1.length !== v2.length) throw new Error('the SMC pair must be the same length');

    const smc = (chain) => {
      const addr = nextCode();
      const runAt = () => {
        seedData();
        normalizeFlags();
        e.set_block_chain(chain ? 1 : 0);
        setRegs();
        e.set_eip(addr);
        e.run(200000);
        const r = `${(e.get_eax() >>> 0).toString(16)}/${(e.get_ecx() >>> 0).toString(16)}`;
        e.set_block_chain(0);
        return r;
      };
      writeAt(addr, v1);
      const first = runAt();
      const bumpsBefore = e.get_chain_bumps();
      // Write the new code through the GUEST store path, so the code-page
      // bitmap and the retirement walk are the ones a real app would trip.
      for (let i = 0; i < v2.length; i += 4) {
        const word = v2[i] | (v2[i + 1] << 8) | (v2[i + 2] << 16) | (v2[i + 3] << 24);
        const w = nextCode();
        writeAt(w, [...store32(EAX, EBX, i), ...RET]);
        normalizeFlags();
        setRegs({ eax: word >>> 0, ebx: addr });
        e.set_eip(w);
        e.run(1000);
      }
      const bumps = e.get_chain_bumps() - bumpsBefore;
      const second = runAt();
      return { first, second, bumps };
    };
    const soff = smc(false);
    const son = smc(true);
    check('SMC: the first run agrees', soff.first === son.first,
      `${soff.first} vs ${son.first}`);
    check('SMC: the rewritten loop is re-decoded and agrees',
      soff.second === son.second, `${soff.second} vs ${son.second}`);
    check('SMC: the rewrite actually changed the answer',
      soff.first !== soff.second, `${soff.first} == ${soff.second}`);
    check('SMC: retirement bumped the chain epoch', son.bumps > 0,
      `bumps=${son.bumps} — nothing invalidated the chains, so the case proved nothing`);
  }

  {
    // Wholesale page invalidation, which is the path a chunk RELOCATION and a
    // page drop both take. invalidate_code_range over a whole page is what
    // FlushInstructionCache and a large SMC write reach.
    const body = [...aluRI(0, EAX, 7), ...decR(ECX)];
    const code = [...movRI(ECX, 20), ...movRI(EAX, 0), ...body,
                  ...jnzRel8(-(body.length + 2)), ...tail];
    const addr = nextCode();
    writeAt(addr, code);
    const runAt = (chain) => {
      seedData(); normalizeFlags();
      e.set_block_chain(chain ? 1 : 0);
      setRegs();
      e.set_eip(addr);
      e.run(200000);
      const r = (e.get_eax() >>> 0).toString(16);
      e.set_block_chain(0);
      return r;
    };
    const before = runAt(true);
    const epochBefore = e.get_chain_epoch();
    e.invalidate_code_range(addr & ~0xFFF, 4096);
    const epochAfter = e.get_chain_epoch();
    const after = runAt(true);
    check('page invalidation: the answer survives it', before === after,
      `${before} vs ${after}`);
    check('page invalidation: it moved the epoch', epochAfter !== epochBefore,
      `epoch ${epochBefore} -> ${epochAfter} — an unmoved epoch leaves every slot live`);
  }

  {
    // The epoch is 13 bits. Past its maximum it parks at a value no stored slot
    // can hold, so every slot reads stale until a flush restarts it -- the
    // wrap must degrade to "always take the desk", never to "a slot from 8192
    // invalidations ago matches". Drive it there through the real path.
    const body = [...aluRI(0, EAX, 11), ...decR(ECX)];
    const code = [...movRI(ECX, 16), ...movRI(EAX, 0), ...body,
                  ...jnzRel8(-(body.length + 2)), ...tail];
    const addr = nextCode();
    writeAt(addr, code);
    const runAt = () => {
      seedData(); normalizeFlags();
      e.set_block_chain(1);
      setRegs();
      e.set_eip(addr);
      e.run(200000);
      const r = (e.get_eax() >>> 0).toString(16);
      e.set_block_chain(0);
      return r;
    };
    const want = runAt();
    // Driven through test_chain_bump, which IS the function every real
    // invalidation path calls -- the two cases above already prove that a guest
    // SMC write and invalidate_code_range reach it. Reaching 8192 of them the
    // long way costs hundreds of thousands of compile/run cycles, because a
    // page dir slot that is already free costs nothing to drop and bumps
    // nothing. What is under test here is the arithmetic at the wrap.
    let spun = 0;
    while (e.get_chain_epoch() <= 0x1FFF && spun < 20000) { e.test_chain_bump(); spun++; }
    const parked = e.get_chain_epoch();
    check('epoch wrap: the epoch is driveable past its maximum',
      parked > 0x1FFF, `epoch=${parked} after ${spun} invalidations`);
    const afterWrap = runAt();
    check('epoch wrap: the answer is unchanged with the epoch parked',
      want === afterWrap, `${want} vs ${afterWrap}`);
    // The park is only safe if it is temporary: the deferred arena flush
    // restarts the epoch at 1 between blocks from $run's loop head.
    e.set_block_chain(1);
    normalizeFlags();
    setRegs();
    e.set_eip(addr);
    e.run(200000);
    e.set_block_chain(0);
    check('epoch wrap: a run restarts the epoch', e.get_chain_epoch() <= 0x1FFF,
      `epoch=${e.get_chain_epoch()} — parked forever means chaining is off for good`);
    const afterFlush = runAt();
    check('epoch wrap: the answer is unchanged after the restart',
      want === afterFlush, `${want} vs ${afterFlush}`);
  }

  console.log('\n-- the debug facilities --');

  {
    // A breakpoint is checked at $run's loop head, and a chained transfer does
    // not go back to $run. So the ONLY thing keeping breakpoints working is
    // that $chain_end tests $dbg_any before it follows a slot -- and the slot
    // it would follow has already been written by then, which is what makes
    // this a real case rather than a restatement of the code.
    const body = [...aluRI(0, EAX, 2), ...decR(ECX)];
    const headLen = 0;
    const addr = nextCode();
    const code = [...movRI(ECX, 50), ...movRI(EAX, 0), ...body,
                  ...jnzRel8(-(body.length + 2)), ...tail];
    writeAt(addr, code);
    const loopHead = addr + movRI(ECX, 50).length + movRI(EAX, 0).length + headLen;
    // First, with no breakpoint, so the back edge gets a live chain slot.
    seedData(); normalizeFlags();
    e.set_block_chain(1);
    setRegs();
    e.set_eip(addr);
    e.run(200000);
    const chained = Number(e.get_chain_hits());
    check('breakpoint: the edge was chained before the bp was set', chained > 0,
      `hits=${chained}`);
    // Now arm the breakpoint on the CHAINED target and re-enter.
    e.set_bp(loopHead);
    seedData(); normalizeFlags();
    setRegs();
    e.set_eip(addr);
    e.run(200000);
    check('breakpoint: the run halts at the chained target',
      (e.get_eip() >>> 0) === loopHead && e.get_last_run_halt() === 5,
      `eip=${(e.get_eip() >>> 0).toString(16)} want=${loopHead.toString(16)} halt=${e.get_last_run_halt()}`);
    const hitsWhileDebugging = Number(e.get_chain_hits()) - chained;
    check('breakpoint: no transfer was chained while a bp was armed',
      hitsWhileDebugging === 0, `hits=${hitsWhileDebugging}`);
    e.clear_bp();
    e.set_block_chain(0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
