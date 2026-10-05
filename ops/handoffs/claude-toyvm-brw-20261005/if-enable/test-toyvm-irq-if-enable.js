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
// Architectural rules exercised (Intel SDM instruction reference):
//   STI      "If IF = 0, maskable hardware interrupts remain inhibited on the
//            instruction boundary following an execution of STI" -- so the
//            interrupt goes in after the NEXT instruction, not after STI.
//            "No interrupts can be recognized if an execution of CLI
//            immediately follow such an execution of STI."
//   MOV/POP SS  "inhibits interrupts on the following instruction boundary".
//   POPF, IRET  no maskable-interrupt shadow: the IF they load takes effect at
//            the very next boundary.
// STI immediately followed by MOV SS is not spelled out in those pages; this
// test takes both rules literally (no delivery after STI, none after MOV SS,
// so the first boundary is after the instruction following MOV SS) and says so.
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

const assert = require('assert');
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
function program(body) {
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
    ...CALL('spin'),                              // IF=1 for a while
    0x4D,                                         // dec bp
    0x74, 0x03,                                   // jz +3 (over the jmp)
    0xE9, { rel16: 'round' },                     // jmp round
    0xB8, 0x00, 0x4C, 0xCD, 0x21,                 // mov ax,4C00h ; int 21h
    // delay: ~5 x 65535 iterations with whatever IF the caller has (0 here).
    L('delay'), 0xBA, ...w(5), L('d1'), 0xB9, 0xFF, 0xFF, L('d2'), 0xE2, { rel8: 'd2' }, 0x4A, 0x75, { rel8: 'd1' }, RET,
    L('spin'), 0xBA, ...w(3), L('s1'), 0xB9, 0xFF, 0xFF, L('s2'), 0xE2, { rel8: 's2' }, 0x4A, 0x75, { rel8: 's1' }, RET,
    L('stiret'), STI, L('stiret_ret'), RET,
    L('handler'), 0x50, 0xB0, 0x20, 0xE6, 0x20, 0x58, IRET, // push ax; mov al,20h; out 20h,al; pop ax; iret
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
  sti_movss: { body: [CLI, ...CALL('delay'), 0x8C, 0xD0, 0x89, 0xE3, STI, L('f_movss'), 0x8E, 0xD0, L('f_movsp'), 0x89, 0xDC],
    forbid: ['f_movss', 'f_movsp'], expect: 'X' },
};

function deliveries(out) {
  return out.split('\n').map((l) => l.match(/^\s*irq vec=08 \S+\s+at=(\d+) .* from [0-9a-f]+:([0-9a-f]+)/))
    .filter(Boolean).map((m) => ({ at: Number(m[1]), ip: parseInt(m[2], 16) }));
}

const emit = (process.argv.find((a) => a.startsWith('--emit=')) || '').slice(7);
const dir = emit || fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-ifen-'));
let failed = 0;
for (const [name, c] of Object.entries(CASES)) {
  const { bytes, at } = program(c.body);
  const file = path.join(dir, `${name}.com`);
  fs.writeFileSync(file, bytes);
  if (emit) { console.log(`${file}  X=0x${at.X.toString(16)}  ${c.forbid.map((f) => `${f}=0x${at[f].toString(16)}`).join(' ')}`); continue; }
  const runs = {};
  for (const [arm, flags] of Object.entries(ARMS)) {
    // One total bound for the whole test (TOYVM_TEST_TOTAL_S, default 170 s):
    // each run gets only what is left, and none starts once it is spent.
    const left = TOTAL_MS - (Date.now() - T0);
    if (left <= 1000) { console.log(`STOP total bound ${TOTAL_MS / 1000}s reached before ${name}/${arm}`); process.exit(5); }
    const out = execFileSync('node', [RUN, file, '--dispatches=6m', '--trace-irq', ...flags],
      { encoding: 'utf8', maxBuffer: 1 << 26, timeout: left, killSignal: 'SIGKILL' });
    runs[arm] = deliveries(out);
  }
  try {
    for (const [arm, d] of Object.entries(runs)) {
      const atX = d.filter((x) => x.ip === at[c.expect]).length;
      assert.ok(atX >= ROUNDS - 1, `${name}/${arm}: ${atX} deliveries at X=0x${at[c.expect].toString(16)}, want >= ${ROUNDS - 1}`
        + ` (first return ips: ${d.slice(0, 6).map((x) => '0x' + x.ip.toString(16)).join(' ')})`);
      for (const f of c.forbid) assert.ok(!d.some((x) => x.ip === at[f]), `${name}/${arm}: delivered inside a shadow at ${f}=0x${at[f].toString(16)}`);
    }
    const ref = JSON.stringify(runs.l1);
    for (const [arm, d] of Object.entries(runs)) assert.strictEqual(JSON.stringify(d), ref, `${name}: arm ${arm} delivers at a different (dispatch, ip) sequence than l1`);
    console.log(`ok   ${name}`);
  } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}
if (!emit) { fs.rmSync(dir, { recursive: true, force: true }); console.log(failed ? `${failed} case(s) failed` : 'all passed'); }
process.exit(failed ? 1 : 0);
