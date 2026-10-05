'use strict';

// A timer interrupt that fell due while the guest had interrupts disabled must
// be delivered at the guest's own IF-enable boundary, as an 8259 + CPU would,
// and at the SAME boundary in every execution arm.
//
// FAILING REGRESSION by design (2026-10-05). Under the v2 schedule contract an
// interrupt goes in only at a stop strictly past a date, so an IRQ that came
// due while IF=0 waits for the next STOP that finds IF=1 -- measured on
// BLIQ.EXE as 71,241 and 250,337 dispatches late while the guest had IF=1 at
// hundreds of intervening boundaries (ops/handoffs/claude-toyvm-brw-20261005/
// wav-validate/SLICE-DIAG-RESULT-20261005.md). HEAD fails the "delivered at X"
// assertions below; docs: IF-ENABLE-DESIGN.md beside this file.
//
// Architectural rules exercised (Intel SDM 325462-093; 80386 PRM 1986):
//   STI      with IF=0 inhibits maskable interrupts on the boundary right after
//            it, until the next instruction completes; STI;CLI recognizes none
//            (SDM Vol. 2B 4-674, Vol. 3A 7.8.1 p. 7-8; 386 PRM STI page).
//   MOV/POP SS  inhibits interrupts on the following boundary (SDM Vol. 2B
//            4-29, Vol. 3A 7.8.3 pp. 7-8/7-9; 386 PRM 9.2.4).
//   POPF, IRET  no maskable-interrupt shadow statement (SDM Vol. 2B 4-407ff,
//            Vol. 2A 3-490ff): the IF they load applies at the next boundary.
// STI immediately followed by MOV SS is stated by NEITHER source. The
// sti_movss case composes the two rules (no delivery after STI, none after
// MOV SS) and is INFORMATIONAL: reported, never counted as pass or fail,
// until a primary source or a reference machine confirms it.
//
// Every case: hook INT 8, then ROUNDS times { make a timer interrupt pending
// with IF=0 for longer than the timer interval; enable IF the case's way; X: }
// and assert from the --trace-irq "from cs:ip" field that
//   (1) the pending interrupt is delivered with its return address at X, once
//       per round (ROUNDS - 1 at least: the first round can race the hook);
//   (2) no interrupt is ever delivered at a boundary the rules forbid;
//   (3) every arm delivers at the same (dispatch count, ip) sequence.
//
// Usage: node test-toyvm-irq-if-enable.js [--emit=DIR] (DIR: write the .COM
// files and exit, for a static check with tools/toyvm/dos-disasm.js).
// TOYVM_TREE=<tree> runs that tree's run-dos.js (default: this repo's).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TREE = process.env.TOYVM_TREE || path.join(__dirname, '..');
const RUN = path.join(TREE, 'tools', 'toyvm', 'run-dos.js');
const ROUNDS = 8;
const T0 = Date.now();
const TOTAL_MS = Number(process.env.TOYVM_TEST_TOTAL_S || 170) * 1000;
const ARMS = {
  l1: [],
  region: ['--region-jit', '--region-jit-after=500k', '--region-jit-window=500k'],
  uop: ['--uop', '--uop-after=500k', '--uop-window=500k'],
  uopOnly: ['--uop-only'],
  fold: ['--tree-fold'],
};

// --- a two-pass assembler over byte arrays, labels and relative/absolute refs
const ORG = 0x100;
function assemble(items) {
  const size = (it) => (typeof it === 'number' ? 1 : it.label !== undefined ? 0 : it.rel8 ? 1 : 2);
  const at = {};
  let pc = ORG;
  for (const it of items) { if (it.label !== undefined) at[it.label] = pc; pc += size(it); }
  const out = [];
  pc = ORG;
  for (const it of items) {
    if (typeof it === 'number') { out.push(it & 0xFF); pc++; continue; }
    if (it.label !== undefined) continue;
    if (!(it.rel8 || it.rel16 || it.abs16) || at[it.rel8 || it.rel16 || it.abs16] === undefined) throw new Error(`label? ${JSON.stringify(it)}`);
    if (it.rel8) {
      const d = at[it.rel8] - (pc + 1);
      if (d < -128 || d > 127) throw new Error(`rel8 out of range to ${it.rel8}`);
      out.push(d & 0xFF); pc++;
    } else {
      const v = it.rel16 ? (at[it.rel16] - (pc + 2)) & 0xFFFF : at[it.abs16];
      out.push(v & 0xFF, (v >> 8) & 0xFF); pc += 2;
    }
  }
  return { bytes: Buffer.from(out), at };
}
const L = (label) => ({ label });
const w = (v) => [v & 0xFF, (v >> 8) & 0xFF];
const CLI = 0xFA, STI = 0xFB, NOP = 0x90, PUSHF = 0x9C, POPF = 0x9D, IRET = 0xCF, RET = 0xC3;
const CALL = (l) => [0xE8, { rel16: l }];

// Common frame around a case body. The body must leave IF=1 at label X.
// opts.after names the IF=1 routine called at X (default `spin`, a 1-op
// `loop $`); opts.work appends `work` AFTER the handler, so every label the
// original six cases use keeps its address and their bytes are unchanged.
function program(body, opts = {}) {
  return assemble([
    CLI,
    0x31, 0xC0,                                   // xor ax,ax
    0x8E, 0xC0,                                   // mov es,ax
    0x26, 0xC7, 0x06, 0x20, 0x00, { abs16: 'handler' }, // mov word [es:0x20], handler
    0x26, 0x8C, 0x0E, 0x22, 0x00,                 // mov [es:0x22], cs
    0xBD, ...w(ROUNDS),                           // mov bp, ROUNDS
    L('round'),
    ...body,
    L('X'),
    ...CALL(opts.after || 'spin'),                // IF=1 for a while
    0x4D,                                         // dec bp
    0x74, 0x03,                                   // jz +3 (over the jmp)
    0xE9, { rel16: 'round' },                     // jmp round
    0xB8, 0x00, 0x4C, 0xCD, 0x21,                 // mov ax,4C00h ; int 21h
    // delay: ~5 x 65535 iterations with whatever IF the caller has (0 here).
    L('delay'), 0xBA, ...w(5), L('d1'), 0xB9, 0xFF, 0xFF, L('d2'), 0xE2, { rel8: 'd2' }, 0x4A, 0x75, { rel8: 'd1' }, RET,
    L('spin'), 0xBA, ...w(3), L('s1'), 0xB9, 0xFF, 0xFF, L('s2'), 0xE2, { rel8: 's2' }, 0x4A, 0x75, { rel8: 's1' }, RET,
    L('stiret'), STI, L('stiret_ret'), RET,
    L('handler'), 0x50, 0xB0, 0x20, 0xE6, 0x20, 0x58, IRET, // push ax; mov al,20h; out 20h,al; pop ax; iret
    // work: 3 x 65535 passes of a 5-op self-loop (add ax,bx; xor si,ax; inc bx;
    // dec cx; jnz) -- at the region JIT's and tree-fold's minOps (4) and above,
    // where the 1-op `loop $` spins are not, so those arms have a loop to take.
    ...(opts.work ? [L('work'), 0xBA, ...w(3), L('w0'), 0xB9, 0xFF, 0xFF,
      L('w1'), 0x01, 0xD8, 0x31, 0xC6, 0x43, 0x49, 0x75, { rel8: 'w1' }, 0x4A, 0x75, { rel8: 'w0' }, RET] : []),
  ]);
}

// name -> { body, forbid: labels whose address must never be a delivery's return ip, expect: label }
const CASES = {
  // STI's shadow: not after STI (at the NOP), but after the NOP (at X).
  sti_nop: { body: [CLI, ...CALL('delay'), STI, L('f_nop'), NOP], forbid: ['f_nop'], expect: 'X' },
  // STI; RET -- the SDM's own example: the RET executes first, then the
  // interrupt, whose return address is the caller's continuation (X).
  sti_ret: { body: [CLI, ...CALL('delay'), ...CALL('stiret')], forbid: ['stiret_ret'], expect: 'X' },
  // STI; CLI recognises nothing; the later STI; NOP does.
  sti_cli: { body: [CLI, ...CALL('delay'), STI, L('f_cli'), CLI, L('f_after_cli'), NOP, STI, L('f_nop2'), NOP],
    forbid: ['f_cli', 'f_after_cli', 'f_nop2'], expect: 'X' },
  // POPF loading IF=1: no shadow, delivered right after POPF.
  popf: { body: [STI, PUSHF, CLI, ...CALL('delay'), POPF], forbid: [], expect: 'X' },
  // IRET to X with IF=1 in the popped FLAGS: delivered at X.
  iret: { body: [STI, PUSHF, CLI, ...CALL('delay'), 0x0E, 0x68, { abs16: 'X' }, IRET], forbid: [], expect: 'X' },
  // STI then MOV SS (its own shadow) then MOV SP: first boundary is X.
  // ARM COVERAGE (added after the first candidate PASS, 18b17779, where the
  // region JIT declined "no self-loop region found" and tree-fold built no
  // folds -- every hot loop here was a 1-op `loop $`, below their minOps of 4).
  // sti_nop's IF-enable sequence, with the IF=1 phase in `work`, a 5-op
  // self-loop the region JIT and tree-fold can take. The boundary itself stays
  // OUTSIDE any region; what this exercises is deliveries at stops inside a
  // compiled loop, and that the arms then engage at all (read the raw lines).
  region_coexist: { body: [CLI, ...CALL('delay'), STI, L('f_nop'), NOP], forbid: ['f_nop'], expect: 'X',
    opts: { after: 'work', work: true } },
  // The IF-enable sequence INSIDE a hot 6-op loop: each pass makes IF=1 for one
  // follower (STI; NOP), then clears it (CLI). The pending IRQ is owed at the
  // boundary after the NOP (label Y), never after the STI. The region JIT should
  // DECLINE this loop ("contains sti (IF-enable boundary)", the candidate's
  // buildRegion decline) -- read its raw line; that decline is the arm's
  // expected behaviour here, not an engagement failure.
  sti_in_loop: { body: [CLI, ...CALL('delay'), 0xB9, ...w(0x2000),
    L('L'), STI, L('f_loopnop'), NOP, L('Y'), CLI, 0x01, 0xD8, 0x49, 0x75, { rel8: 'L' }, STI],
  // X is forbidden too: the trailing STI follows the loop's CLI (IF=0), so the
  // boundary right after it (X) is inside that STI's shadow.
  forbid: ['f_loopnop', 'X'], expect: 'Y', opts: { work: false } },
  // INFORMATIONAL (composed oracle, see the header).
  sti_movss: { body: [CLI, ...CALL('delay'), 0x8C, 0xD0, 0x89, 0xE3, STI, L('f_movss'), 0x8E, 0xD0, L('f_movsp'), 0x89, 0xDC],
    forbid: ['f_movss', 'f_movsp'], expect: 'X', informational: true },
};

function deliveries(out) {
  return out.split('\n').map((l) => l.match(/^\s*irq vec=08 \S+\s+at=(\d+) .* from [0-9a-f]+:([0-9a-f]+)/))
    .filter(Boolean).map((m) => ({ at: Number(m[1]), ip: parseInt(m[2], 16) }));
}

// What did the arm do in this run? LIMITED EVIDENCE by construction: parity
// with l1 is trivially true for an arm that never installed or ran compiled
// code, so each arm's OWN report line (run-dos.js, printed after every run) is
// found first, parsed only within itself, and printed RAW beside the verdict.
// Two levels are kept apart:
//   installed/compiled  region installs, uop heads, uop-only programs, folds
//   executed            uop entries/steps, uop-only entries and step share
// The region JIT's execution counters (--step-audit, --exit-census) and the
// fold's per-tree entry counts are NOT printed without instrumentation flags
// that change the arm under test, so those arms report installed-only. And
// no whole-run count shows that compiled code ran THROUGH the IRQ boundary
// under test. An arm with nothing installed is "parity NOT EVIDENTIAL"; it is
// reported, not failed (engagement is about the evidence, not the property).
// Line formats: run-dos.js (base 2683a6e3) region jit ~1555, uop ~1540,
// uop-only ~1530, and the handbacks summary line carrying "N tree folds" ~1626.
const ARM_LINE = {
  region: /^ {2}region jit \([^)\n]*\): [^\n]*$/m,
  uop: /^ {2}uop: [^\n]*$/m,
  uopOnly: /^ {2}uop-only: [^\n]*$/m,
  fold: /^ {2}\d+ handbacks, \d+ interrupts[^\n]*$/m,
};
function engagement(arm, out) {
  if (arm === 'l1') return { installed: true, executed: true, summary: 'reference', raw: '' };
  const raw = (out.match(ARM_LINE[arm]) || [''])[0];
  const num = (re) => { const m = raw.match(re); return m ? Number(m[1]) : 0; };
  let installed = 0, executed = null, summary;
  if (arm === 'region') {
    installed = num(/ (\d+) install\(s\)/);
    summary = `installed ${installed}; executed: not reported without --step-audit`;
  } else if (arm === 'uop') {
    installed = num(/ (\d+) head\(s\)/); executed = num(/ entries=(\d+)/);
    summary = `installed ${installed} head(s); executed ${executed} entries, ${num(/ steps=(\d+)/)} steps`;
  } else if (arm === 'uopOnly') {
    installed = num(/ programs=(\d+)/); executed = num(/ entries=(\d+)/);
    summary = `compiled ${installed} program(s); executed ${executed} entries`;
  } else if (arm === 'fold') {
    installed = num(/, (\d+) tree folds/);
    summary = `installed ${installed} tree fold(s); executed: not reported without a histogram`;
  }
  if (!raw) summary = `NO REPORT LINE FOUND (${summary})`;
  return { installed: installed > 0, executed: executed === null ? null : executed > 0, summary, raw };
}

const emit = (process.argv.find((a) => a.startsWith('--emit=')) || '').slice(7);
const dir = emit || fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-ifen-'));
let failed = 0;
for (const [name, c] of Object.entries(CASES)) {
  const { bytes, at } = program(c.body, c.opts);
  const file = path.join(dir, `${name}.com`);
  fs.writeFileSync(file, bytes);
  if (emit) { console.log(`${file}  X=0x${at.X.toString(16)}  ${c.forbid.map((f) => `${f}=0x${at[f].toString(16)}`).join(' ')}`); continue; }
  const runs = {}, engaged = {};
  for (const [arm, flags] of Object.entries(ARMS)) {
    // One total bound for the whole test (TOYVM_TEST_TOTAL_S, default 170 s):
    // each run gets only what is left, and none starts once it is spent.
    const left = TOTAL_MS - (Date.now() - T0);
    if (left <= 1000) { console.log(`STOP total bound ${TOTAL_MS / 1000}s reached before ${name}/${arm}`); process.exit(5); }
    const out = execFileSync('node', [RUN, file, '--dispatches=6m', '--trace-irq', ...flags],
      { encoding: 'utf8', maxBuffer: 1 << 26, timeout: left, killSignal: 'SIGKILL' });
    runs[arm] = deliveries(out);
    engaged[arm] = engagement(arm, out);
  }
  // Evaluate EVERY assertion on EVERY arm before deciding, and print each one:
  // the 8db463eb version threw on the first failure, so a HEAD run reported
  // assertion 1 on arm l1 only and never evaluated shadows or arm parity.
  const problems = [];
  const ref = JSON.stringify(runs.l1);
  for (const [arm, d] of Object.entries(runs)) {
    const atX = d.filter((x) => x.ip === at[c.expect]).length;
    const inShadow = c.forbid.filter((f) => d.some((x) => x.ip === at[f]));
    const same = JSON.stringify(d) === ref;
    const e = engaged[arm];
    console.log(`  ${name}/${arm}: ${d.length} deliveries, ${atX} at X=0x${at[c.expect].toString(16)} (want >= ${ROUNDS - 1}), `
      + `in shadow: ${inShadow.length ? inShadow.join(',') : 'none'}, same (dispatch, ip) sequence as l1: ${same}`
      + `${arm === 'l1' ? '' : ` [engagement, limited evidence: ${e.summary}${e.installed ? '' : ' -> parity NOT EVIDENTIAL for this arm'}]`}, `
      + `first return ips: ${d.slice(0, 6).map((x) => '0x' + x.ip.toString(16)).join(' ')}`);
    if (e.raw) console.log(`    raw ${arm}: ${e.raw.trim()}`);
    if (atX < ROUNDS - 1) problems.push(`[1] ${arm}: ${atX} at X`);
    for (const f of inShadow) problems.push(`[2] ${arm}: delivered inside a shadow at ${f}=0x${at[f].toString(16)}`);
    if (!same) problems.push(`[3] ${arm}: (dispatch, ip) sequence differs from l1`);
  }
  if (!problems.length) console.log(`${c.informational ? 'info ' : 'ok   '}${name}${c.informational ? ': composed oracle held (not counted)' : ''}`);
  else if (c.informational) console.log(`info ${name}: composed oracle did not hold (not counted): ${problems.join('; ')}`);
  else { failed++; console.log(`FAIL ${name}: ${problems.join('; ')}`); }
}
if (!emit) { fs.rmSync(dir, { recursive: true, force: true }); console.log(failed ? `${failed} case(s) failed` : 'all passed'); }
process.exit(failed ? 1 : 0);
