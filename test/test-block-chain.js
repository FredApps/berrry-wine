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
  // ROUND 19 (docs/block-chaining-design.md section 8): the two flags are
  // INDEPENDENT. Round 15 made them mutually exclusive because a chain slot
  // held a self-relative delta, and the executor copies a block's terminator
  // into its descriptor chunk, so a copied word carried a delta measured
  // against the chunk it was copied FROM. The slot now holds a chunk-relative
  // offset plus a one-bit chunk selector, so a pool copy names its own chunk
  // and both flags may be on at once. Asserted in both orders, because a
  // one-way clamp would leave the other order silently disarmed.
  e.set_block_exec(1);
  check('arming the executor leaves chaining armed', e.get_block_chain() === 1,
    `get_block_chain()=${e.get_block_chain()}`);
  check('the executor is armed', e.get_block_exec() === 1,
    `get_block_exec()=${e.get_block_exec()}`);
  e.set_block_chain(0);
  e.set_block_chain(1);
  check('chaining arms while the executor is on', e.get_block_chain() === 1,
    `get_block_chain()=${e.get_block_chain()}`);
  check('arming chaining left the executor alone', e.get_block_exec() === 1,
    `get_block_exec()=${e.get_block_exec()}`);
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

  console.log('\n-- chaining and the block executor, both armed --');

  // ROUND 19. What these cases are FOR is the one thing round 15 could not
  // express: an edge whose ANCHOR is a pool copy. When the executor installs a
  // descriptor it copies the block's terminator into the page's DESCRIPTOR
  // chunk and leaves $tail_ip pointing at that copy, so the terminator that
  // actually runs -- and therefore the operand word a chain patch lands in --
  // is not the one in the stream chunk. $chain_hits_pool counts exactly those,
  // so "the pool anchor chained" is measured, never inferred from a total.
  //
  // Discovery is hotness-gated; these snippets run tens of iterations, not the
  // thousands production waits for, so the gate drops to its floor here for the
  // same reason test/test-block-exec.js drops it.
  e.set_block_exec_walk_k(2);

  function bxCounters() {
    return {
      hits: e.get_chain_hits(), slow: e.get_chain_slow(),
      poolHits: e.get_chain_hits_pool(), poolSlow: e.get_chain_slow_pool(),
      patches: e.get_chain_patches(), poolPatches: e.get_chain_patches_pool(),
      refuseTgt: e.get_chain_refuse_target(), refuseAnc: e.get_chain_refuse_anchor(),
      staleRegs: e.get_chain_stale_regs(), branchEndPool: e.get_branch_end_pool(),
      tailExits: e.get_block_exec_tail_exit_count(),
      leafRuns: e.get_block_exec_leaf_runs(), leafFbRuns: e.get_block_exec_leaf_fb_runs(),
      installs: e.get_block_exec_installs(),
      regionInstalls: e.get_block_exec_region_installs(),
      bumps: e.get_chain_bumps(),
      desk: e.get_branch_end_calls(),
    };
  }
  function bxDelta(a, b) {
    const out = {};
    for (const k of Object.keys(a)) out[k] = Number(b[k] - a[k]);
    return out;
  }

  // One arm of the four-way matrix. `mode` is 'off' | 'chain' | 'exec' | 'both'
  // -- four genuinely different histories of the same bytes at four different
  // addresses, because a slot is written on the first transfer through a
  // terminator and a descriptor is installed on the first hot entry.
  function bxArm(bytes, mode, seed, opts) {
    const addr = (opts && opts.addr) || nextCode();
    writeAt(addr, bytes);
    seedData();
    normalizeFlags();
    // The shipped 12-uop floor would decline every hand-written snippet here
    // and silently run four identical threaded arms, so it drops to the
    // minimum a descriptor can express (the same reasoning as test-block-exec).
    e.set_block_exec_min_uops((opts && opts.minUops) || 2);
    e.set_block_exec_leaf(opts && opts.leaf === false ? 0 : 1);
    e.set_block_exec_leaf_fb(opts && opts.leafFb === false ? 0 : 1);
    e.set_block_exec_tail_exits(opts && opts.tailExits === false ? 0 : 1);
    e.set_block_exec(mode === 'exec' || mode === 'both' ? 1 : 0);
    e.set_block_chain(mode === 'chain' || mode === 'both' ? 1 : 0);
    setRegs(seed);
    const before = bxCounters();
    e.set_eip(addr);
    e.run(200000);
    const out = snapshot(addr);
    out.mode = mode;
    out.d = bxDelta(before, bxCounters());
    e.set_block_chain(0);
    e.set_block_exec(0);
    return out;
  }

  // Run all four arms and assert every one of them agrees with the plain
  // interpreter. Three A/Bs in one, and the one that matters is `both`.
  function matrix(name, bytes, seed, opts) {
    const arms = ['off', 'chain', 'exec', 'both'].map(m => bxArm(bytes, m, seed, opts));
    const base = arms[0];
    for (const a of arms.slice(1)) agree(`${name}: ${a.mode} agrees with the interpreter`, base, a);
    return { off: arms[0], chain: arms[1], exec: arms[2], both: arms[3] };
  }

  {
    // A counted loop whose single block the executor installs as a LEAF (H463
    // or H464). The leaf's exit is `$ip <- tail_ip; return_call $next`, so the
    // back edge's anchor is the pool copy of the terminator and nothing else
    // in the system can chain it.
    const body = [...aluRR(ADD, EAX, ECX), ...decR(ECX)];
    const code = [...movRI(ECX, 60), ...movRI(EAX, 0), ...body,
                  ...jnzRel8(-(body.length + 2)), ...tail];
    const m = matrix('leaf loop', code);
    check('leaf loop: the executor installed a leaf in the exec arms',
      m.exec.d.leafRuns + m.exec.d.leafFbRuns > 0 &&
      m.both.d.leafRuns + m.both.d.leafFbRuns > 0,
      `exec leaf=${m.exec.d.leafRuns}/${m.exec.d.leafFbRuns} ` +
      `both leaf=${m.both.d.leafRuns}/${m.both.d.leafFbRuns} — no leaf ran, so the case proves nothing`);
    check('leaf loop: the leaf tail exits were chained in the both arm',
      m.both.d.poolHits > 0,
      `poolHits=${m.both.d.poolHits} tailExits=${m.both.d.tailExits} ` +
      `poolPatches=${m.both.d.poolPatches} slowPool=${m.both.d.poolSlow} ` +
      `refuseTgt=${m.both.d.refuseTgt} refuseAnc=${m.both.d.refuseAnc}`);
    check('leaf loop: the exec-alone arm chained nothing',
      m.exec.d.hits === 0 && m.exec.d.poolHits === 0,
      `hits=${m.exec.d.hits} poolHits=${m.exec.d.poolHits}`);
    check('leaf loop: the chain-alone arm chained no POOL anchor',
      m.chain.d.hits > 0 && m.chain.d.poolHits === 0,
      `hits=${m.chain.d.hits} poolHits=${m.chain.d.poolHits} — a pool hit with the executor off means $chain_chunk_of misreads a chunk`);
    check('leaf loop: no patch was refused for an out-of-chunk address',
      m.both.d.refuseTgt === 0 && m.both.d.refuseAnc === 0,
      `refuseTgt=${m.both.d.refuseTgt} refuseAnc=${m.both.d.refuseAnc}`);
    check('leaf loop: no slot was followed with the wrong page registers loaded',
      m.both.d.staleRegs === 0, `staleRegs=${m.both.d.staleRegs}`);
  }

  {
    // The same loop with the leaf handlers disarmed, so every install goes
    // through the GENERAL region handler (H458) and the exit is its
    // `tail_exit` path instead. Different handler, same anchor question.
    const body = [...aluRR(ADD, EAX, ECX), ...decR(ECX)];
    const code = [...movRI(ECX, 60), ...movRI(EAX, 0), ...body,
                  ...jnzRel8(-(body.length + 2)), ...tail];
    const m = matrix('general-handler loop', code, undefined, { leaf: false, leafFb: false });
    check('general-handler loop: an install ran with no leaf',
      m.both.d.installs > 0 && m.both.d.leafRuns === 0 && m.both.d.leafFbRuns === 0,
      `installs=${m.both.d.installs} leaf=${m.both.d.leafRuns}/${m.both.d.leafFbRuns}`);
    check('general-handler loop: its tail exits chained',
      m.both.d.poolHits > 0,
      `poolHits=${m.both.d.poolHits} tailExits=${m.both.d.tailExits} slowPool=${m.both.d.poolSlow}`);
  }

  {
    // A multi-block region: a head that branches, a fall-through body and a
    // join, all under ONE descriptor. Its internal edges never reach a chain
    // slot at all (the descriptor resolves them), so what is under test is the
    // region's EXIT -- including the per-member tail of round 18's kind-10
    // terminator, which lives at its own byte offset inside the fallback pool
    // rather than at the descriptor's end.
    const away = [...aluRR(SUB, EAX, ECX)];
    const fall = [...aluRR(ADD, EAX, ECX)];
    const join = [...decR(ESI)];
    const cmpPart = [...incR(EDX), ...cmpRI(EDX, 0)];
    const jzPart = jzRel8(fall.length + 2);
    const jmpPart = jmpRel8(away.length);
    const headLen = cmpPart.length + jzPart.length + fall.length + jmpPart.length
                  + away.length + join.length;
    const code = [...movRI(ESI, 40), ...cmpPart, ...jzPart, ...fall, ...jmpPart,
                  ...away, ...join, ...jnzRel8(-(headLen + 2)), ...tail];
    const m = matrix('multi-block region', code);
    check('multi-block region: a region installed in the both arm',
      m.both.d.regionInstalls > 0 || m.both.d.installs > 0,
      `regionInstalls=${m.both.d.regionInstalls} installs=${m.both.d.installs}`);
    // NOT "it chained as much as chaining alone": a region resolves its own
    // internal edges inside the descriptor, so the back edge that chaining
    // alone patches 113 times does not reach a chain slot here at all. The
    // property the round is actually claiming is the one stated on desk trips
    // -- both flags together must not send MORE transfers to $branch_end than
    // either flag alone does.
    check('multi-block region: both arms together take no more desk trips than either alone',
      m.both.d.desk <= Math.min(m.chain.d.desk, m.exec.d.desk),
      `both=${m.both.d.desk} chain=${m.chain.d.desk} exec=${m.exec.d.desk} ` +
      `(off=${m.off.d.desk})`);
    check('multi-block region: no refusals and no stale-register follows',
      m.both.d.refuseTgt === 0 && m.both.d.refuseAnc === 0 && m.both.d.staleRegs === 0,
      `refuseTgt=${m.both.d.refuseTgt} refuseAnc=${m.both.d.refuseAnc} staleRegs=${m.both.d.staleRegs}`);
  }

  {
    // Self-modifying code against a POOL anchor. The loop runs long enough to
    // be installed as a descriptor AND to have its pool-copied terminator
    // patched, then its guest bytes are rewritten through a real guest store.
    // The rewrite must retire the descriptor and bump the epoch; a pool patch
    // that survived would send the second run into a freed descriptor chunk.
    const mk = (delta) => {
      const body = [...aluRI(0, EAX, delta), ...decR(ECX)];
      return [...movRI(ECX, 40), ...movRI(EAX, 0), ...body,
              ...jnzRel8(-(body.length + 2)), ...tail];
    };
    const v1 = mk(3), v2 = mk(5);
    if (v1.length !== v2.length) throw new Error('the SMC pair must be the same length');

    const smcBoth = (mode) => {
      const addr = nextCode();
      const runAt = () => {
        const r = bxArm(v1, mode, undefined, { addr });
        return { s: `${r.eax.toString(16)}/${r.ecx.toString(16)}`, d: r.d };
      };
      writeAt(addr, v1);
      const first = runAt();
      const bumpsBefore = e.get_chain_bumps();
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
      writeAt(addr, v2);          // bxArm re-writes its bytes; keep them v2
      const r2 = bxArm(v2, mode, undefined, { addr });
      return { first: first.s, firstD: first.d, second: `${r2.eax.toString(16)}/${r2.ecx.toString(16)}`,
               secondD: r2.d, bumps };
    };
    const soff = smcBoth('off');
    const son = smcBoth('both');
    check('pool SMC: the first run agrees', soff.first === son.first,
      `${soff.first} vs ${son.first}`);
    check('pool SMC: a pool anchor really was chained before the rewrite',
      son.firstD.poolHits > 0,
      `poolHits=${son.firstD.poolHits} installs=${son.firstD.installs} — nothing pool-chained, so the case proves nothing`);
    check('pool SMC: the rewritten loop agrees after the rewrite',
      soff.second === son.second, `${soff.second} vs ${son.second}`);
    check('pool SMC: the rewrite actually changed the answer',
      soff.first !== soff.second, `${soff.first} == ${soff.second}`);
    check('pool SMC: retiring the descriptor bumped the chain epoch', son.bumps > 0,
      `bumps=${son.bumps} — nothing invalidated the pool chains`);
    check('pool SMC: no slot was followed into a freed chunk',
      son.secondD.staleRegs === 0, `staleRegs=${son.secondD.staleRegs}`);
  }

  {
    // Wholesale page invalidation with both flags on: the path a descriptor
    // RETIRE and a chunk drop both take. The descriptor chunk is freed here,
    // so every pool anchor and every pool target dies at once.
    const body = [...aluRI(0, EAX, 9), ...decR(ECX)];
    const code = [...movRI(ECX, 40), ...movRI(EAX, 0), ...body,
                  ...jnzRel8(-(body.length + 2)), ...tail];
    const addr = nextCode();
    const runAt = () => bxArm(code, 'both', undefined, { addr });
    const before = runAt();
    check('descriptor retire: a pool anchor was chained first',
      before.d.poolHits > 0, `poolHits=${before.d.poolHits}`);
    const epochBefore = e.get_chain_epoch();
    e.invalidate_code_range(addr & ~0xFFF, 4096);
    const epochAfter = e.get_chain_epoch();
    const after = runAt();
    check('descriptor retire: the answer survives it',
      before.eax === after.eax && before.ecx === after.ecx,
      `${before.eax.toString(16)}/${before.ecx.toString(16)} vs ${after.eax.toString(16)}/${after.ecx.toString(16)}`);
    check('descriptor retire: it moved the epoch', epochAfter !== epochBefore,
      `epoch ${epochBefore} -> ${epochAfter} — an unmoved epoch leaves every pool slot live`);
    check('descriptor retire: no stale-register follow after it',
      after.d.staleRegs === 0, `staleRegs=${after.d.staleRegs}`);
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
