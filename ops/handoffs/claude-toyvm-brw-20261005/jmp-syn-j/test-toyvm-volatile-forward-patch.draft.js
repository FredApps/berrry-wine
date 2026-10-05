'use strict';

// A STORE INTO AN INSTRUCTION AHEAD OF IT, IN THE SAME STRAIGHT LINE, MUST BE
// SEEN BY THAT INSTRUCTION -- also once its paragraph has gone volatile.
//
// dos-loop.js compiles a paragraph that has taken VOLATILE_AFTER self-modify
// breaks uncached, once per entry, and when that program has no loop and no
// call it takes the code bits DOWN ("pure"), on the assumption that "a
// straight line that never comes back has nothing to protect: its stores land
// behind the program counter". A forward patch breaks that: the decoder has
// already baked the old byte into the words for the instruction ahead, the
// store raises nothing because the bits are down, and the stale byte runs.
//
// BRW.EXE (toyvm long-run fixture) is the witness: its texture-span routine
// (8:c179..c37x) writes the immediates of the inner loop it is about to run,
// and from 330,588,088 the interpreter ran those spans with the previous
// span's immediates while a region-JIT arm (whose installs moved the block
// starts) took the breaks and computed what an x86 computes. See
// ops/handoffs/claude-toyvm-brw-20261005/jmp-syn-j/v4-vol-20261005/summary.md.
//
// The program: SUB stores AL into the imm8 of `add dl, imm8` two bytes ahead
// and returns. It is entered fresh every call, so a volatile compile of it is
// a straight line to `ret` with no back edge and no call -- the pure path.
// The caller passes AL = 1..N and the correct DL is their sum; a stale imm8
// adds the PREVIOUS call's value instead. The early calls take breaks (the
// bits are up), which is what promotes the paragraph; the assertion is about
// the calls after that.
//
// Expected to FAIL on HEAD (2683a6e3) and to pass once the pure path keeps the
// bits of bytes a forward store can reach. Draft: not yet run.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDos } = require('../tools/toyvm/run-dos');

const N = 200;   // calls; VOLATILE_AFTER is 8, so ~190 of them run volatile

function program() {
  const b = [];
  const w = (...x) => b.push(...x);
  w(0x31, 0xD2);                   // 0100 xor dx,dx
  w(0xB9, N & 0xFF, N >> 8);       // 0102 mov cx,N
  w(0xB0, 0x00);                   // 0105 mov al,0
  // 0107 outer:
  w(0xFE, 0xC0);                   // 0107 inc al
  w(0xE8, 0x00, 0x00);             // 0109 call SUB (rel16 patched below)
  w(0xE2, 0xF9);                   // 010C loop 0107
  w(0x88, 0xD0);                   // 010E mov al,dl  (result in al/dl)
  w(0xB4, 0x4C);                   // 0110 mov ah,4Ch
  w(0xCD, 0x21);                   // 0112 int 21h
  while (b.length < 0x20) w(0x90); // pad to 0120 (SUB starts a fresh paragraph)
  // The patched instruction sits one TRANSFER after the store, as in BRW (the
  // store at 8:c314 patches the loop at 8:c34b): $smc is tested at a block
  // transfer, so a store into the SAME block's later bytes is a separate,
  // wider limitation (only a CS-override store ends the block, end_smc).
  const sub = 0x100 + b.length;    // 0120 SUB:
  w(0xA2, 0x27, 0x01);             // 0120 mov [0127],al   -> imm8 of the add below
  w(0xEB, 0x00);                   // 0123 jmp 0125        (block transfer)
  w(0x80, 0xC2, 0x00);             // 0125 add dl,imm8      (imm8 at 0127)
  w(0xC3);                         // 0128 ret
  const rel = sub - (0x109 + 3);
  b[0x0A] = rel & 0xFF; b[0x0B] = (rel >> 8) & 0xFF;
  return Buffer.from(b);
}

function expected() {
  let dl = 0;
  for (let i = 1; i <= N; i++) dl = (dl + (i & 0xFF)) & 0xFF;
  return dl;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-volfwd-'));
  const com = path.join(dir, 'VOLFWD.COM');
  fs.writeFileSync(com, program());
  try {
    const run = async (opts) => {
      const r = await runDos({ exe: com, budget: 5e6, log: () => {}, ...opts });
      return { dl: r.vm.get('dx') & 0xFF, smc: r.smcBreaks, dispatched: r.dispatched };
    };
    const want = expected();
    const cached = await run({});
    const flushed = await run({ smcFlush: true });
    // The control: flushing the whole cache on every detected write.
    assert.strictEqual(flushed.dl, want, `smcFlush control: dl ${flushed.dl} != ${want}`);
    assert.strictEqual(cached.dl, want,
      `cached interpreter ran a stale forward-patched imm8: dl ${cached.dl} != ${want}`
      + ` (smc breaks ${cached.smc}, smcFlush ${flushed.smc})`);
    console.log(`PASS test-toyvm-volatile-forward-patch: dl ${cached.dl} == ${want} over ${N} self-patching calls`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
