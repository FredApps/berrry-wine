# Deterministic pending-IRQ eligibility at the guest's IF-enable boundary (toyvm)

Source-only design and failing-regression preparation, 2026-10-05.

This answers root's request after a1d20501 (`wav-validate/SLICE-DIAG-RESULT-20261005.md`). That
result showed that under the v2 schedule contract a timer IRQ that comes due while IF=0 waits for
the next STOP that finds IF=1. BLIQ #48 and #70 were 71,241 and 250,337 dispatches late, while the
guest had IF=1 at 291/435 and 1,041/1,553 intervening early handbacks. No runtime has been used
for this note.

## 1. Architectural rules (Intel SDM instruction reference, as quoted by felixcloutier.com)

| instruction | rule | consequence for delivery |
|---|---|---|
| STI | "If IF = 0, maskable hardware interrupts remain inhibited on the instruction boundary following an execution of STI." The inhibition ends at "delivery of another event (e.g., exception) or the execution of the next instruction." "If an STI instruction is followed by an RET instruction, the RET instruction is allowed to execute before external interrupts are recognized." "No interrupts can be recognized if an execution of CLI immediately follow such an execution of STI." | first eligible boundary = after the instruction FOLLOWING STI; only when IF was 0 before STI; a following CLI cancels |
| MOV SS / POP SS | "inhibits interrupts on the following instruction boundary. (The inhibition ends after delivery of an exception or the execution of the next instruction.)" | never deliver between an SS load and the next instruction |
| POPF | no shadow statement; IF changes only at sufficient privilege ("altered only when executing at a level at least as privileged as the IOPL") | eligible at the boundary right after POPF |
| IRET | no maskable-interrupt shadow statement (only NMI unblocking) | eligible at the boundary right after IRET (its target) |

- **Not covered by those pages: STI immediately followed by MOV SS.** The design and the test take
  both rules literally: no delivery after STI, none after MOV SS. So the first boundary is after
  the instruction that follows MOV SS. Marked as derived, not quoted.
- **Not every IF 0→1 means immediate delivery.** STI is one boundary late by rule. POPF/IRET at
  insufficient IOPL in V86 mode do not change IF; toyvm's V86 handling decides that, and this
  design only acts on the IF value the VM actually holds afterwards. A pending interrupt is
  delivered only if the IRQ is still owed when that boundary is reached.

## 2. What toyvm does today (source, base 2683a6e3 plus the v2/v3 stack)

- **STI and CLI only write IF.** `sti` and `cli` (emit.js) never hand back, and nothing in toyvm
  models an interrupt shadow: every "shadow" in the sources is the shadow return stack.
- **POPF hands back only when TF is set** (`EXIT_WHY.popf`).
- **IRET already hands back when `$irqwant` is set and the popped IF is 1** (`EXIT_WHY.iret`).
  - `$irqwant` is set by the host before each slice, but only for a Sound Blaster line armed by a
    port write (`machine.sbForced()`, dos-loop.js).
  - The host's timer, keyboard and retrace rungs fire only `atStop`, so even that IRET handback
    cannot deliver a scheduled timer IRQ.
- **HLT is `end` + `endsBlock`,** so it hands back after itself.
- **Every block transfer already tests `CONT` = `$smc | ($steps < 0)`** (`GO`, `GO_LOOKUP`), and
  the region JIT tests `$halt`/`$smc` at its boundaries. A refusal there is the existing, budget-
  and arm-independent way to stop at an exact block boundary.
- **Shadows can be violated today, in principle.** A delivery can land between STI or an SS load
  and the next instruction if a stop falls exactly there, i.e. when that instruction ends a block.
  Not observed; noted for the test.

## 3. Proposed contract (candidate, not implemented)

A **pending IRQ** is one whose rung condition held at a real stop except for IF=0. For the first
cut that means timer only; keyboard, retrace and GUS would follow the same pattern. It stays
pending until delivered.

While anything is pending, the host sets `$irqwant` (as it already does for the SB case). Each of
these guest boundaries is then an **eligible delivery instant**, provided IF=1 there:

- (a) after the instruction following an STI that found IF=0, unless that instruction is CLI
  (IF=0 again) or an SS load (then one more instruction);
- (b) after a POPF;
- (c) after an IRET (already exists);
- (d) after HLT (already a handback).

At an eligible instant the host delivers the pending IRQ exactly as at a stop:
- `clockAt` is the boundary's own dispatch count;
- `lastIrq` advances on the interval grid as now, so every later date is unchanged;
- no audio render is added, because renders stay on stops.

**Why it is deterministic.** Each instant is a guest instruction boundary at a dispatch count that
every arm reaches identically. It's the same argument the contract already accepts for a Sound
Blaster port-write cut (`cut >= 0` keeps `>=`). Nothing depends on a cached side exit: the decoder
puts the boundary at a block transfer, and every arm already honours `CONT` there for the budget.

**Mechanism (minimal):**

1. **decode.js.** An STI ends its block after the NEXT instruction (`endsBlock` deferred by one).
   That puts a block transfer at exactly the eligible boundary, including STI; RET (whose own
   transfer is that boundary) and STI; JMP. A CLI or SS load as the next instruction defers the
   end once more, or cancels it for CLI.
2. **emit.js.**
   - `sti`: if IF was 0 and `$irqwant`, set `$ifarm = 1`. One branch, on a rare instruction.
   - `CONT` gains `| $ifarm`, so the transfer at the boundary refuses and hands back with
     `$gip` = the boundary. A new `EXIT_WHY.ifen` names it.
   - `popf`/`popf32` add `(irqwant && IF)` to their existing TF check, exactly as `iret` does.
3. **dos-loop.js.**
   - A stop where a rung was blocked only by IF marks it pending and sets `irqwant`.
   - A handback with `exitwhy` ifen/popf/iret (or `$ifarm`) and IF=1 delivers it with
     `clockAt = dispatched`, then clears `$ifarm`.
4. **Arms.**
   - The region JIT inlines `GO`/`CONT`, so it inherits the refusal. It must not fuse across the
     STI block's end; the deferred `endsBlock` makes that a block boundary.
   - The µop tier exits to the interpreter on anything outside its subset.
   - tree-fold reads effects from handler bodies, and `sti` now writes a control global.
   - Each must be checked in the patch; the test's arm-parity assertion is the check.

**Cost.**
- `CONT` gains one `global.get` and `i32.or` on every block transfer. This is the one hot-path
  change, and it must be measured on fixed work with V8 + SpiderMonkey disassembly, like J.
- The alternative is carrying `$ifarm` as a high bit of `$smc`: zero extra instructions, but it
  overloads a flag the host repairs code on. Not recommended without measurement.

## 4. Failing regression (prepared, not run)

`test-toyvm-irq-if-enable.js`, beside this note. It hand-assembles six real-mode .COM programs;
each hooks INT 8, then 8 times makes a timer IRQ pending with IF=0 for about 327k dispatches
(timer interval 100k), enables IF its own way, and reaches label X. It asserts, from `--trace-irq`
"from cs:ip":

1. at least 7 deliveries return to X;
2. none returns to a boundary the rules forbid;
3. all five arms (l1, region JIT, µop, µop-only, tree-fold) give the identical (dispatch, ip)
   sequence.

| case | sequence | forbidden return ips |
|---|---|---|
| sti_nop | STI; NOP; X | after STI |
| sti_ret | CALL s; X … s: STI; RET | after STI (at the RET) |
| sti_cli | STI; CLI; NOP; STI; NOP; X | after STI, after CLI, after the 2nd STI |
| popf | STI; PUSHF; CLI; delay; POPF; X | — |
| iret | STI; PUSHF; CLI; delay; PUSH CS; PUSH X; IRET | — |
| sti_movss | MOV AX,SS; MOV BX,SP; STI; MOV SS,AX; MOV SP,BX; X | after STI, after MOV SS |

- **Expected on HEAD:** assertion 1 fails in every case. Delivery waits for a stop, which lands
  inside `spin`, not at X. Assertions 2 and 3 are expected to hold.
- **Expected on the candidate:** all three hold.
- **Static check done:** `--emit=DIR` writes the programs, and `tools/toyvm/dos-disasm.js`
  disassembles them as intended (STI/MOV SS/IRET frame/STI;RET at the listed addresses, handler
  0x143/0x149 matching the vector-8 write).
- **Landing.** It lives in the handoff tree, not `test/`. Moving it there needs the test-tier
  manifest entry, and its `TREE` default assumes `test/`.

## 5. Bounded next runtime request

One serialized slot of **at most 300 s total**, one process at a time:

    node if-enable/build-tree.js --out=<new>/stack --tree=stack   # prints dos-loop 74f94f3e, emit e07d99db
    TOYVM_TREE=<new>/stack TOYVM_TEST_TOTAL_S=140 node if-enable/test-toyvm-irq-if-enable.js > <new>/stack.txt
    node if-enable/build-tree.js --out=<new>/head --tree=head      # prints dos-loop ebe0eb30, emit 7a4f57fd
    TOYVM_TREE=<new>/head TOYVM_TEST_TOTAL_S=140 node if-enable/test-toyvm-irq-if-enable.js > <new>/head.txt
    # then delete <new>/stack and <new>/head (about 3 MB each); keep the two .txt files

The test enforces its own total bound: each run gets only the time left (SIGKILL on expiry), none
starts after it is spent, and it exits 5 if the bound is hit.

- **Size:** 6 cases × 5 arms = 30 runs of at most 6M dispatches each. P3's 80M-dispatch runs took
  about 3 s, so the estimate is about 30–60 s. Output is stdout only; temp .COM files are deleted.
  Capture to `scratch/.../if-enable/head-fail-<ts>.txt`.
- **Purpose:** record that HEAD+stack fails assertion 1 (and whether 2/3 hold) before any candidate
  exists, so the candidate's pass is evidence.
- **A second slot later** (same bound) runs the candidate, followed by the corpus A/B and the
  performance gate for the `CONT` change.

## 6. Still open (unchanged, no user gate)

- The J jmp_syn overshoot bound is unproven.
- No J/stack performance evidence, and none for this `CONT` change.
- No µop-arm or SMC-fix-specific evidence.
- CAVEIRA's IF state is unrecorded, so whether its cascade is the same IF-blocked wait is
  unknown.
