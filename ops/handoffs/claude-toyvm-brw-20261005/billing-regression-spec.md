# Spec: test/test-toyvm-region-install-billing.js (toyvm-only, expected to FAIL today)

Worker A, 2026-10-05. Written from the source only; **nothing below has been run.** Every
"expected" value is a prediction and has to be confirmed by the first run.

## What it pins down, and why it should fail today

The test asserts the interrupt schedule's own promise across arms. The interpreter (L1) and a
`--region-jit-sep` arm must:

- retire the same number of dispatches, and
- push every interrupt in front of the same instruction (same `at`, same `cs:ip`).

### Why it is NOT built around a per-install billing offset

The existing region-live programs already end 0 dispatches apart (runs-20261005i), so a test built
around that would pass today. See design.md, Summary.

### What it targets instead: T1 in design.md

1. A loop head is first reached by **straight-line fall-through** from its setup code.
2. Under L1, the decoder therefore copies the first iteration into the setup block
   (`compile.js:356-364, 503-517`). The first budget test after the setup is at the copy's `jz`
   (the traced not-taken edge, gip = the `jmp hot` instruction).
3. After the install, the region head is marked before decoding (`compile.js:365-373`). The
   recompiled setup block now ends in `jmp_syn hot`. Its `GO` tests `$steps < 0`
   (`emit.js:820-823, 622-623, 695-699`).
4. So every timer date that falls inside the setup span is delivered `from <cs>:HOT at=X` in the
   region arm, and `from <cs>:JMPIP at=X+6` under L1, with `di` = 0 vs 1.
5. The ISR folds `di` into memory, so the guest state diverges as well as the trace.

### Why the window is made large on purpose

The scratch draft `toyvm-brw/test-toyvm-irq-early-handback.draft.js` has the same
fall-through-into-head shape. Its setup is only 3 ops against a ~19-op × 0x200 inner loop, with
about 400 IRQs. That gives an expected **≈0.1** IRQs in the window, so it could never show T1.
(Its recorded failure was the "no early handback" precondition at its line 127. It is not recorded
whether its IRQ comparison was ever reached.)

Here the setup is 10 ops, the inner loop runs 7 iterations, and `irqEvery` is 2003:

- a period of ≈62 dispatches per call, so ≈16% of dates land in the window;
- ≈7,900 IRQs, ≈4,900 of them after the install at ≈6M;
- **≈790 expected differing deliveries.** Order-of-magnitude reasoning; unverified.

## Program (16-bit .COM, built with the label assembler copied from test-toyvm-region-live.js)

Add `addr(n)` to the helper (`return labels.get(n)`, valid after `done()`), so the test can name
HOT and JMPIP.

```js
const INNER = 7, ADD = 7, XOR = 0x5A5A, OUT_HI = 4, OUT_LO = 64000;  // 256,000 calls, ~16M dispatches
function program({ headIsCallTarget = false } = {}) {
  const a = asm(); const { w } = a;
  const lo = (n) => n & 0xFF, hi = (n) => (n >> 8) & 0xFF;
  const setup = () => {                    // 10 straight-line ops, no transfer, no store
    w(0x31, 0xFF);                         // xor di,di
    w(0x31, 0xD2);                         // xor dx,dx
    w(0x89, 0xF0);                         // mov ax,si
    w(0x25, 0x07, 0x00);                   // and ax,7
    w(0x01, 0xC2);                         // add dx,ax
    w(0x83, 0xC2, 0x11);                   // add dx,11h
    w(0xD1, 0xC2);                         // rol dx,1
    w(0x81, 0xF2, 0x01, 0x01);             // xor dx,0101h
    w(0x01, 0xF2);                         // add dx,si
    w(0x42);                               // inc dx
  };
  w(0xB8, 0x08, 0x25);                     // mov ax,2508h   hook INT 8 (dos.js timerVector
  w(0xBA); a.abs16('isr');                 // mov dx,isr      offers the timer only to a hooked
  w(0xCD, 0x21);                           // int 21h         vector, dos.js:2882-2895)
  w(0x31, 0xDB);                           // xor bx,bx
  w(0x31, 0xF6);                           // xor si,si
  w(0xBD, lo(OUT_HI), hi(OUT_HI));         // mov bp,OUT_HI
  a.label('outer2');
  w(0xB9, lo(OUT_LO), hi(OUT_LO));         // mov cx,OUT_LO
  a.label('outer1');
  if (headIsCallTarget) { setup(); w(0xE8); a.rel16('hot'); }   // NC1: head = call target
  else { w(0xE8); a.rel16('sub'); }                             // main: call sub
  w(0x01, 0xD3);                           // add bx,dx
  w(0xE2); a.rel8('outer1');               // loop outer1
  w(0x4D);                                 // dec bp
  w(0x75); a.rel8('outer2');               // jnz outer2
  w(0x8B, 0x3E); a.abs16('acc');           // mov di,[acc]    results in registers:
  w(0x8B, 0x2E); a.abs16('ticks');         // mov bp,[ticks]  bx si di bp
  w(0xB8, 0x00, 0x4C);                     // mov ax,4C00h
  w(0xCD, 0x21);                           // int 21h
  if (!headIsCallTarget) { a.label('sub'); setup(); }           // falls through into hot
  a.label('hot');                          // the region head (region-live's picked shape:
  w(0x83, 0xC2, ADD);                      // add dx,ADD       head = block head, the jz
  w(0x81, 0xF2, lo(XOR), hi(XOR));         // xor dx,XOR       leaves, the bottom jmp closes)
  w(0x46);                                 // inc si
  w(0x47);                                 // inc di
  w(0x83, 0xFF, INNER);                    // cmp di,INNER
  w(0x74); a.rel8('done');                 // jz done
  a.label('jmpip');
  w(0xEB); a.rel8('hot');                  // jmp hot
  a.label('done');
  w(0xC3);                                 // ret
  a.label('isr');                          // EOI + IRET, plus a guest-visible record of WHERE
  w(0x50);                                 // push ax          it interrupted
  w(0x01, 0x3E); a.abs16('acc');           // add [acc],di     DS == CS in a .COM; NO cs:
  w(0xFF, 0x06); a.abs16('ticks');         // inc word [ticks] override (that would add end_smc)
  w(0xB0, 0x20);                           // mov al,20h
  w(0xE6, 0x20);                           // out 20h,al
  w(0x58);                                 // pop ax
  w(0xCF);                                 // iret
  while ((a.at() & 15) !== 0) w(0x90);     // data two paragraphs clear of any code, so the
  for (let i = 0; i < 32; i++) w(0x90);    // ISR's stores can never raise $smc
  a.label('acc'); w(0, 0);
  a.label('ticks'); w(0, 0);
  return a.done();
}
```

The closed form, IRQ-independent: the ISR preserves every register, and IRET restores the flags.

```js
function expected() {
  let bx = 0, si = 0;
  for (let c = 0; c < OUT_HI * OUT_LO; c++) {
    let dx = (si & 7) & 0xFFFF, di = 0;
    dx = (dx + 0x11) & 0xFFFF; dx = ((dx << 1) | (dx >>> 15)) & 0xFFFF;
    dx ^= 0x0101; dx = (dx + si) & 0xFFFF; dx = (dx + 1) & 0xFFFF;
    do { dx = (dx + ADD) & 0xFFFF; dx ^= XOR; si = (si + 1) & 0xFFFF; di++; } while (di !== INNER);
    bx = (bx + dx) & 0xFFFF;
  }
  return { bx, si };
}
```

## runDos options

Both arms take the same options except `regionJit`.

```js
const irqs = [];
const r = await runDos({
  exe: com, budget: BUDGET,                  // 60e6 (the program exits first) or the A2 date below
  slice: 5e4,                                // sampling rate, as in test-toyvm-region-live.js
  irqEvery: 2003,                            // timer date spacing (run-dos.js:283; pitClock off)
  traceIrq: true,                            // run-dos.js:585-589
  sliceLogFile: path.join(dir, `${arm}.slog`),   // diagnostics only: printed on failure
  log: (s) => {
    const m = /^\s*irq vec=(\w+) (\w+)\s+at=(\d+) hb=\d+ t=(\S+) from (\w+):(\w+)/.exec(s);
    if (m) irqs.push({ vec: m[1], src: m[2], at: +m[3], t: m[4], cs: m[5], ip: parseInt(m[6], 16) });
  },
  regionJit: jit ? {
    sampleAfter: 2e6, profileFor: 4e6, minOps: 2, gateAt: 0,
    backend: inlineBackend(), log: () => {}, sep: true,
  } : null,
});
```

Arms:

| Arm | Program | regionJit | Budget |
|---|---|---|---|
| L1 | main | null | 60e6 |
| RJ | main | sep | 60e6 |
| NC1-L1, NC1-RJ | `headIsCallTarget: true` | null / sep | 60e6 |
| NC2 | main, L1 only, `slice: 2e6` | null | 60e6 |
| A2 pair | main | null / sep | derived below |

Six or seven runs of about 16M dispatches each. That should be well under 60 s in total, but it is
unmeasured. Keep the test single-process and foreground.

## Assertions, in order

### Preconditions

If any of these fails, the test says nothing and must say so.

- **P1:** L1's `bx`/`si` equal `expected()`, and `bx != 0`.
- **P2:** `RJ.jit.installs >= 1`, and `RJ.jit.at` contains `addr('hot')`. Report `phase`/`declined`
  otherwise. Pitfall: the region JIT declined loops with fill/fade sub-loops ("no self-loop region
  found"). This program has none, but the setup block takes about a quarter of the samples. If the
  pick lands on `sub`, raise INNER (an odd value, e.g. 11). That shrinks the window but keeps it
  far above the draft's.
- **P3:** L1 delivered ≥ 2000 `vec=08` IRQs, and L1's `bp` (ISR tick count) equals that number,
  which shows the ISR ran once per delivery.
- **P4:** NC2's IRQ lines equal L1's, field for field except `hb`. The schedule is clock-anchored,
  so comparing lines between arms is meaningful (docs/toyvm-irq-schedule.md, "The fix").

### The test proper

- **A5 (correctness, expected PASS):** RJ's `bx`/`si` equal `expected()`.
- **A1 (billing guard, expected PASS today):** `RJ.dispatched === L1.dispatched` at program exit.
  INT 21h/4C is an exact instruction boundary, so this is the cumulative bill with no overshoot.
  - If A1 fails while A3 passes, that is a genuine billing offset: B1, B2 or a new one.
  - A3 failing can knock A1 off by one ISR length (7) through a different IRQ count by exit.
    Report the Δ either way.
- **A3 (expected FAIL today):** `RJ.irqs` and `L1.irqs` are equal in length and equal line by line
  on `(vec, src, at, t, cs, ip)`. The message names the index of the first difference and both
  lines.
  - **Predicted first difference** (shortly after install, about 6M):
    `L1 08 timer at=X+6 from <cs>:JMPIP` vs `RJ 08 timer at=X from <cs>:HOT`.
  - That is the BRW 115.06M signature (region arm earlier, at the head). Here L1's stop is at the
    copy's `jz` fall edge rather than at the head, because this loop tests twice per iteration
    where BRW's tests once.
- **A4 (expected FAIL today):** `RJ.di === L1.di`. That is the ISR's accumulated `di`: 0 vs 1 at
  each moved delivery.
- **A2 (expected FAIL today):** run both arms again with `budget = X − 1`, where X is RJ's `at` from
  A3's first difference. The date then lies inside the setup span. Assert `dispatched` equal.
  Predicted: RJ ends at X (on the `jmp_syn`) and L1 at X+6.
  - Skip with a note if A3 passed.
  - Deterministic: `endAt` only adds the final date (`dos-loop.js:1699`, `due(this.endAt)`).

### Negative controls

- **NC1** (head is a call target in both arms, so `GO` tests at HOT in both): P2 holds, and A1, A3,
  A4 and A5 all **pass today**. If NC1 fails, the divergence is not T1, and the message must say so.
- **NC3 (after the fix lands):** the main program with the old `jmp_syn` budget test restored
  (`--jmp-syn-budget-test`) must reproduce the A3 failure. The handler tables are built once per
  process (`emit.js:4068-4071`), so run this in a **child process**, not with
  `process.argv.push` as `test-toyvm-region-install-clock.js` does for a region-live-only flag.

## Why each expected FAIL holds today, and what would falsify it

The prediction depends on three unverified decode-order facts:

1. **The first iteration is copied.** L1's first compile decodes `sub`'s straight line through
   `hot` before `hot` is a head, so the first iteration is copied into the `sub` block, and `hot`
   becomes a block only through the `jmp hot` fixup (`compile.js:503-517`, `:614-638`).
2. **The setup block loses its copy.** The install drops the program containing that copy
   (`region-live.js:566-606`; the guard bytes lie in the copy's paragraphs). The precompile
   (`:620-631`) then rebuilds `sub` as `[setup, jmp_syn hot]`, because the region head is marked
   and compiled first (`compile.js:365-373`, LIFO `pending`).
3. **The window is entered.** Timer dates fall in the 10-op setup span often enough.

| Outcome | What it means |
|---|---|
| Main arm and NC1 both PASS | Fact 1 or 2 is wrong. T1 is not reachable as modelled, and BRW 115.06M needs the date-chain log instead (design.md §5.2). |
| NC1 FAILS | Something other than T1 moves deliveries. Read the slice logs for the stop kind: a `left 0` stop at a date is the v2 class (dos-loop v2 is not in the tree). |

Early handbacks are deliberately absent. 16-bit region exits re-link through `$jlook` (`jz → done`
hits; IRET resumes through a lookup), so this test does not depend on the v2 early-handback class.
Print both arms' `handbacks` anyway.

## Wiring

- Tier: toyvm-only, `test/test-toyvm-*.js`. Register it wherever the test-tier membership gate
  expects new tests. That is the coordinator's call: CLAUDE.md lists "complete test-tier
  membership" among the build gates.
- On failure, print the two slice-log lines around the first differing `at`, so the stop kind is
  visible without a rerun.
