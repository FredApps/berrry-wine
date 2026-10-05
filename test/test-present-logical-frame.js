#!/usr/bin/env node

'use strict';

// Pacing the present cap on the app's own game step ($th_logical_frame,
// handler 476, src/09a8-handlers-directx.wat).
//
// WHY THIS EXISTS
// Presents and message pumps both stand in for "a frame", and for StarCraft
// both are wrong: ~97 presents/s for ~17 displayed frames, and several pumps
// per game step. When lib/apps.js names the step (perf.logicalFrame.address),
// the decoder plants a marker as the first op of the block at that address and
// the cap paces there, once per step, and the pumps and frame ends of that
// thread stop pacing. The marker has to survive everything that makes code
// run without passing through $run: block chaining, and the micro-op tier,
// which iterates a hot loop inside one wasm function. The checks:
//
//  1. count-only (pace off): the marker counts every step, exactly, with the
//     step reached by a call, with chaining on, and with the step in the
//     middle of a loop the micro-op tier installed (the tier must exit there,
//     not run through it).
//  2. cap 60, paced on the step: one sleep per step, the step rate near 60
//     per guest second, and the three pumps and three frame ends issued per
//     step never sleep. Also with chaining, and inside a uop-installed loop.
//  3. the park is exact: the thread stops ON the step with nothing of the
//     step executed, and the re-run executes it once.
//  4. pace off (--present-at=pump) falls back to pump-bounded pacing: the
//     marker still counts, and a Fallout-shaped pump loop sleeps once a turn.
//  5. ownership lapses: a thread that stops stepping for over a second of
//     guest time is paced by its pumps again.
//  6. lib/present-frame-audit.js names the mode, and several presents per
//     step are not UNSAFE when the cap paces the step.
//  7. address 0 turns the marker off.
//
// The guest clock is supplied here and advances only by the sleeps the guest
// asks for, so the file is deterministic.

const path = require('path');
const fs = require('fs');
const RegionMap = require('../lib/region-map.generated.js');

const ROOT = path.join(__dirname, '..');
const WASM = process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');
const NOTEPAD = path.join(__dirname, 'binaries', 'notepad.exe');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

// ---- a tiny assembler: bytes, {label}, {jcc,to}, {jmp,to} (rel8), {call,to} ----
function asm(items) {
  const at = new Map();
  for (let pass2 = 0; pass2 < 2; pass2++) {
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
    if (pass2 === 1) return { bytes: out, at };
  }
}
const L = (label) => ({ label });
const J = (cc, to) => ({ jcc: cc, to });
const CALL = (to) => ({ call: true, to });
const NZ = 5;

// Shape A: a game loop that CALLS the step. The step is a function entry.
//   l: call step ; dec ecx ; jnz l ; ret
//   step: inc esi ; ret
const SHAPE_CALL = asm([L('l'), CALL('step'), 0x49, J(NZ, 'l'), 0xC3,
  L('step'), 0x46, 0xC3]);

// Shape B: the step is IN THE MIDDLE of a hot loop, reached one iteration in
// eight by falling through a branch. The micro-op tier installs the loop at
// `l`; its program must leave at `step` every time, and the decoder must end
// the block before `step` rather than run through it.
//   l: inc edi ; test cl,7 ; jnz skip ; step: inc esi ; skip: dec ecx ; jnz l ; ret
const SHAPE_MID = asm([L('l'), 0x47, [0xF6, 0xC1, 0x07], J(NZ, 'skip'),
  L('step'), 0x46, L('skip'), 0x49, J(NZ, 'l'), 0xC3]);

async function boot() {
  const { createHostImports } = require('../lib/host-imports');
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const clock = { now: 1000 };
  const ctx = {
    exports: null,
    getMemory: () => memory.buffer,
    guestNowMs: () => clock.now,
  };
  const h = createHostImports(ctx).host;
  h.memory = memory;
  h.exit = () => {};
  h.log = () => {};
  h.log_i32 = () => {};
  h.crash_unimplemented = () => {};
  h.wait_multiple = () => 0;
  h.shell_execute = () => 33;
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(WASM), { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const exe = fs.readFileSync(NOTEPAD);
  new Uint8Array(e.memory.buffer).set(exe, e.get_staging());
  e.load_pe(exe.length);
  const imageBase = e.get_image_base();
  return { e, clock, imageBase, g2w: (a) => RegionMap.g2w(a, imageBase) };
}

let codeCursor = 0;
function place(env, shape) {
  const addr = env.imageBase + 0x200000 + codeCursor;
  codeCursor += 0x1000;                      // fresh page: nothing decoded there yet
  const mem = new Uint8Array(env.e.memory.buffer);
  mem.set(shape.bytes, env.g2w(addr));
  return { addr, step: addr + shape.at.get('step'), loop: addr + shape.at.get('l') };
}

// Run the shape to its final `ret` (into a 0 sentinel). Between runs, handle
// what the host would: a pending sleep advances the guest clock by its length.
// `perRun` is called after every run() that stopped on a sleep.
function runShape(env, code, regs, perRun) {
  const { e, clock, imageBase, g2w } = env;
  const stackTop = imageBase + 0xF00000;
  new DataView(e.memory.buffer).setUint32(g2w(stackTop), 0, true);
  e.set_esp(stackTop);
  e.set_ecx(regs.ecx >>> 0);
  e.set_esi(0);
  e.set_edi(0);
  e.set_eip(code.addr);
  let sleeps = 0, sleptMs = 0, runs = 0;
  for (; runs < 200000; runs++) {
    e.run(0x7FFFFFFF);
    const slept = e.get_sleep_yielded();
    if (slept) {
      const ms = e.get_sleep_timeout() >>> 0;
      sleeps++; sleptMs += ms; clock.now += ms;
    }
    e.clear_yield();
    e.set_handler_set_eip(0);
    if (slept && perRun) perRun();
    if ((e.get_eip() >>> 0) === 0) break;
  }
  return { sleeps, sleptMs, runs, esi: e.get_esi() >>> 0 };
}

function reset(e, cap) {
  e.test_present_frame_reset();
  e.set_present_cap(cap);
  e.get_sleep_yielded();
  e.clear_yield();
}

async function main() {
  if (!fs.existsSync(NOTEPAD)) {
    console.log(`SKIP: ${NOTEPAD} not present (the x86 harness loads it for a process image)`);
    process.exit(0);
  }
  const env = await boot();
  const { e, clock } = env;
  check('set_logical_frame is exported', typeof e.set_logical_frame === 'function');

  // ---- 1. count-only ------------------------------------------------------
  const N = 2000;
  const countArm = (label, shape, setup, expect) => {
    const code = place(env, shape);
    reset(e, 0);
    e.set_block_chain(setup.chain ? 1 : 0);
    e.set_uop(setup.uop ? 1 : 0);
    e.set_logical_frame(code.step, 0);
    const before = e.get_logical_frame_count();
    const inst0 = e.uop_stats(2), ent0 = e.uop_stats(4);
    const r = runShape(env, code, { ecx: N });
    const n = e.get_logical_frame_count() - before;
    check(`1 ${label}: every step counted (${n}/${expect})`, n === expect && r.esi === expect,
      `count=${n} esi=${r.esi} expect=${expect}`);
    check(`1 ${label}: nothing slept`, r.sleeps === 0, `${r.sleeps} sleeps`);
    return { installs: e.uop_stats(2) - inst0, enters: e.uop_stats(4) - ent0 };
  };
  countArm('call, plain', SHAPE_CALL, {}, N);
  countArm('call, chained', SHAPE_CALL, { chain: 1 }, N);
  countArm('call, uop on', SHAPE_CALL, { uop: 1 }, N);
  countArm('mid-loop, plain', SHAPE_MID, {}, N / 8);
  countArm('mid-loop, chained', SHAPE_MID, { chain: 1 }, N / 8);
  const u = countArm('mid-loop, uop on', SHAPE_MID, { uop: 1 }, N / 8);
  check('1 mid-loop, uop on: the tier really installed and entered the loop',
    u.installs > 0 && u.enters > 0, `installs=${u.installs} enters=${u.enters}`);
  countArm('mid-loop, uop + chained', SHAPE_MID, { uop: 1, chain: 1 }, N / 8);

  // ---- 2. paced on the step at cap 60 --------------------------------------
  const pacedArm = (label, shape, setup, steps) => {
    const code = place(env, shape);
    reset(e, 60);
    e.set_block_chain(setup.chain ? 1 : 0);
    e.set_uop(setup.uop ? 1 : 0);
    e.set_logical_frame(code.step, 1);
    const c0 = e.get_logical_frame_count(), p0 = e.get_logical_frame_paced();
    const t0 = clock.now;
    let proxySleeps = 0;
    // Each time the thread parks on a step, the rest of that step's loop turn
    // (which this shape leaves out) would pump three times and present three
    // times. Issued here, on the same instance; none of them may sleep.
    const perRun = () => {
      for (let i = 0; i < 3; i++) {
        e.test_present_frame_end();
        if (e.test_present_pump()) proxySleeps++;
        if (e.get_sleep_yielded()) proxySleeps++;
        e.clear_yield();
        e.set_handler_set_eip(0);
      }
    };
    const r = runShape(env, code, { ecx: N }, perRun);
    const n = e.get_logical_frame_count() - c0;
    const paced = e.get_logical_frame_paced() - p0;
    const secs = (clock.now - t0) / 1000;
    const rate = n / secs;
    check(`2 ${label}: every step counted once (${n}/${steps})`, n === steps && r.esi === steps,
      `count=${n} esi=${r.esi}`);
    // The pacer's first frame arms its clock rather than sleeping.
    check(`2 ${label}: one sleep per step (${paced} paced, ${r.sleeps} slept)`,
      paced === r.sleeps && paced >= steps - 2 && paced <= steps, `paced=${paced} sleeps=${r.sleeps} steps=${steps}`);
    check(`2 ${label}: ~60 steps per guest second`, rate > 57 && rate < 63, `${rate.toFixed(2)}/s`);
    check(`2 ${label}: pumps and frame ends never slept`, proxySleeps === 0, `${proxySleeps}`);
    return { n, rate };
  };
  pacedArm('call, plain', SHAPE_CALL, {}, N);
  pacedArm('call, chained', SHAPE_CALL, { chain: 1 }, N);
  pacedArm('mid-loop, uop + chained', SHAPE_MID, { uop: 1, chain: 1 }, N / 8);

  // ---- 3. the park is exact ------------------------------------------------
  {
    const code = place(env, SHAPE_CALL);
    reset(e, 60);
    e.set_block_chain(1);
    e.set_uop(0);
    e.set_logical_frame(code.step, 1);
    const stackTop = env.imageBase + 0xF00000;
    new DataView(e.memory.buffer).setUint32(env.g2w(stackTop), 0, true);
    e.set_esp(stackTop); e.set_ecx(50); e.set_esi(0); e.set_eip(code.addr);
    // Two steps in: the first arms the pacer, the second sleeps.
    let parks = 0, eipAtPark = 0, esiAtPark = -1;
    for (let i = 0; i < 20 && parks < 2; i++) {
      e.run(0x7FFFFFFF);
      if (e.get_sleep_yielded()) {
        parks++;
        eipAtPark = e.get_eip() >>> 0;
        esiAtPark = e.get_esi() >>> 0;
        clock.now += e.get_sleep_timeout() >>> 0;
      }
      e.clear_yield();
    }
    check('3 park: stopped ON the step', eipAtPark === code.step,
      `eip=0x${eipAtPark.toString(16)} step=0x${code.step.toString(16)}`);
    check('3 park: nothing of the step ran yet', esiAtPark === parks, `esi=${esiAtPark} parks=${parks}`);
    const c = e.get_logical_frame_count();
    // Budget of one block: the re-run executes the step block and stops.
    e.run(1);
    check('3 park: the re-run executes the step once', (e.get_esi() >>> 0) === esiAtPark + 1,
      `esi=${e.get_esi() >>> 0}`);
    check('3 park: the re-run is not counted again', e.get_logical_frame_count() === c);
    check('3 park: the re-run does not sleep again', e.get_sleep_yielded() === 0);
  }

  // ---- 3b. a host that has not cleared the sleep flag yet ------------------
  // $sleep_yielded is read-and-cleared by the host, which may not have done
  // so before the next step. The marker must still park ON the step: whether
  // this pace slept is read off the pacer's own counter, not off the flag.
  {
    const code = place(env, SHAPE_CALL);
    reset(e, 60);
    e.set_block_chain(1);
    e.set_uop(0);
    e.set_logical_frame(code.step, 1);
    const stackTop = env.imageBase + 0xF00000;
    new DataView(e.memory.buffer).setUint32(env.g2w(stackTop), 0, true);
    e.set_esp(stackTop); e.set_ecx(40); e.set_esi(0); e.set_eip(code.addr);
    const p0 = e.get_logical_frame_paced();
    let parks = 0, offStep = 0, pacedPrev = e.get_present_paced_count() >>> 0;
    for (let i = 0; i < 400 && (e.get_eip() >>> 0) !== 0; i++) {
      e.run(0x7FFFFFFF);
      const paced = e.get_present_paced_count() >>> 0;
      if (paced !== pacedPrev) {
        parks++;
        if ((e.get_eip() >>> 0) !== code.step) offStep++;
        clock.now += e.get_sleep_timeout() >>> 0;
        pacedPrev = paced;
      }
      e.clear_yield();   // get_sleep_yielded() deliberately never called
      e.set_handler_set_eip(0);
    }
    check('3b stale flag: steps still park', parks > 30, `parks=${parks}`);
    check('3b stale flag: every park is ON the step', offStep === 0, `offStep=${offStep}`);
    check('3b stale flag: every sleep is attributed to the step',
      e.get_logical_frame_paced() - p0 === parks, `paced=${e.get_logical_frame_paced() - p0} parks=${parks}`);
    e.get_sleep_yielded();
  }

  // ---- 4. pace off falls back to pump pacing --------------------------------
  {
    const code = place(env, SHAPE_CALL);
    reset(e, 60);
    e.set_block_chain(1);
    e.set_uop(1);
    e.set_logical_frame(code.step, 0);
    const c0 = e.get_logical_frame_count();
    const r = runShape(env, code, { ecx: 500 });
    check('4 pace off: the step is still counted', e.get_logical_frame_count() - c0 === 500);
    check('4 pace off: the step never sleeps', r.sleeps === 0 && e.get_logical_frame_owns() === 0);
    // A Fallout-shaped turn: pump, 5 ms of work, three frame ends.
    const t0 = clock.now;
    let sleeps = 0;
    const TURNS = 120;
    for (let t = 0; t < TURNS; t++) {
      while (e.test_present_pump()) {
        if (e.get_sleep_yielded()) { sleeps++; clock.now += e.get_sleep_timeout() >>> 0; }
        e.clear_yield(); e.set_handler_set_eip(0);
      }
      clock.now += 5;
      for (let i = 0; i < 3; i++) {
        e.test_present_frame_end();
        if (e.get_sleep_yielded()) { sleeps++; clock.now += e.get_sleep_timeout() >>> 0; }
        e.clear_yield();
      }
    }
    const rate = TURNS / ((clock.now - t0) / 1000);
    check('4 pace off: pump-bounded pacing learned', e.get_present_pump_bounded() === 1);
    check('4 pace off: about one sleep per turn', sleeps >= TURNS - 4 && sleeps <= TURNS + 3, `${sleeps}/${TURNS}`);
    check('4 pace off: turns at the cap', rate > 55 && rate < 66, `${rate.toFixed(1)}/s`);
  }

  // ---- 5. ownership lapses after a second without a step --------------------
  {
    const code = place(env, SHAPE_CALL);
    reset(e, 60);
    e.set_block_chain(0);
    e.set_uop(0);
    e.set_logical_frame(code.step, 1);
    runShape(env, code, { ecx: 30 });
    check('5 owns right after stepping', e.get_logical_frame_owns() === 1);
    clock.now += 1500;
    check('5 lapses 1.5 s after the last step', e.get_logical_frame_owns() === 0);
    // Pumps pace again: learn the loop shape, then turns sleep.
    let sleeps = 0;
    for (let t = 0; t < 30; t++) {
      while (e.test_present_pump()) {
        if (e.get_sleep_yielded()) { sleeps++; clock.now += e.get_sleep_timeout() >>> 0; }
        e.clear_yield(); e.set_handler_set_eip(0);
      }
      clock.now += 2;
      e.test_present_frame_end();
      if (e.get_sleep_yielded()) { sleeps++; clock.now += e.get_sleep_timeout() >>> 0; }
      e.clear_yield();
    }
    check('5 pumps pace again once the step lapsed', sleeps >= 25, `${sleeps} of 30 turns slept`);
  }

  // ---- 6. the --present-frames report names the mode -------------------------
  {
    const audit = require('../lib/present-frame-audit');
    const row = (ends, pumps, steps, stepsPaced) => ({
      frameEnds: ends, pumpFrames: pumps, pumpBounded: 1, paced: stepsPaced, pacedMs: stepsPaced * 16,
      steps, stepsPaced });
    const snap = (ms, r) => ({ guestMs: ms, logical: r.steps, rows: { main: r } });
    const zero = snap(0, row(0, 0, 0, 0));
    // StarCraft-shaped: ~5.7 presents and several pumps per game step.
    const to = snap(10000, row(970, 700, 170, 168));
    const lg = audit.audit(zero, to, { cap: 60, logicalLabel: 'GAME', mode: 'logical' });
    check('6 audit: logical mode is named', lg.lines.some(l => /mode: cap paces once per GAME step/.test(l)),
      lg.lines.join(' | '));
    check('6 audit: the row says the step paces', lg.lines.some(l => /paces at the GAME step.*168 of them at the step/.test(l)),
      lg.lines.join(' | '));
    check('6 audit: several presents per step is not UNSAFE when paced per step',
      lg.verdict === 'MULTI-PRESENT (paced per game step)', lg.verdict);
    const pm = audit.audit(zero, to, { cap: 60, logicalLabel: 'GAME', mode: 'pump' });
    check('6 audit: pump mode is named', pm.lines.some(l => /--present-at=pump/.test(l)), pm.lines.join(' | '));
    check('6 audit: pump mode keeps the per-game-frame verdict', pm.verdict === 'UNSAFE', pm.verdict);
  }

  // ---- 7. switching off --------------------------------------------------------
  {
    e.set_logical_frame(0, 0);
    check('7 address 0 turns the marker off', e.get_logical_frame_addr() === 0 && e.get_logical_frame_owns() === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
