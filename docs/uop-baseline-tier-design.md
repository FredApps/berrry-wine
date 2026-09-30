# Baseline µop tier: compile everything fast, optimize what is hot

Status: **on toyvm, phase 0 measured and phase 1 steps 1-2 built** (§6: the E1 arena with
links, and the µop-only arm that runs every instruction through it). Nothing is in the
main emulator; it ports there (07d/07e) only if the toyvm gates pass.

## 1. The idea

Today both VMs run x86 in two tiers that do not share anything:

```
x86 --decode--> threaded code (L1 / $next)   every block, cheap, runs until hot
                   |  hot (sampled in toyvm; K block entries in the main emu)
                   v
x86 --decode AGAIN + 12 passes--> µop program (E1 / $uop_run)   loops and traces only
```

The two costs of this shape:
- **Hot code is decoded twice**, and the second decode runs a heavy analysis.
- **Every entry and exit crosses a boundary** between two execution models. Most
  regions end at a `call` or `ret`, so the crossings are frequent. For example,
  95–100% of StarCraft's and Diablo's block entries sit in no short loop
  (uop-tier-design §13 census).

The proposal is to make the µop engine the *only* execution model:

```
x86 --decode--> BASELINE µops (one linear pass, block-local)     every block
                   |  hot (per-program counter)
                   v
       REGION µops (today's optimizer: promote, flagfwd, flaglive, guards, licm, clock...)
threaded code stays only as the fallback for instructions the µop set cannot express
```

Tier-up rewrites programs that are already µops; there is no second x86 decode. The
existing optimizer does not change. It just gets a new input source.

## 2. Why the engine can afford this

These are toyvm measurements (memory note `project_toyvm_uop_tier`, uop-tier-design §1):

| engine | native instructions per transition (Ion, arm64 / x86_64) |
|---|---|
| E1 loop engine (one function, `br_table`) | 11 / 12 |
| threaded tail-call dispatch | 33 / 38 |

The ~25-instruction difference is function-entry bookkeeping: frame setup, signature
check, stack-limit check, the interrupt check, and the tail-call epilogue. Branch
prediction does not account for it; that has been measured three ways. So one E1
transition costs about a third of one threaded transition.

**The catch is the number of µops per x86 instruction.**
- The *naive* lowering (`tools/toyvm/uop-ir.js` `lower`) emits about 4.9 µops per x86
  instruction on ANARCHY's head: 121.4 per iteration.
- The full optimizer gets that down to 1.2: 29.9 per iteration.

Breakeven against threaded code is roughly 33/11 ≈ **3 µops per x86 instruction**. The
naive lowering is above that line, so it would lose; the baseline has to land clearly
below it. That is the central design constraint, and it is the first thing phase 0
measures.

## 3. The baseline lowering: one linear pass, block-local

Everything below is chosen to be one forward pass over one decoded block, with no CFG,
no fixpoint and no whole-region analysis. Each rule is the *local* version of a pass the
optimizer already has.

| concern | naive lowering today | baseline |
|---|---|---|
| guest registers | `GETR`/`PUTR` through the register file on every access | toyvm: promote **within the block** (load on first use, write back at block exit). Main emu: nothing, because vregs 0–7 already *are* the register file |
| addressing | separate add/shift temps | the memory op's own `[base + (idx << s) + disp]` form, filled in at decode (local addrfold) |
| flags | a `REC` per producer, a `GETCC` per consumer | producer→consumer forwarding inside the block (`cmp`+`jcc` → `bcc`). At block exit, **one** `rec` of the last producer, only if a consumer outside the block could read it. With no liveness information, assume it can |
| memory | full-semantics checked access (non-native in toyvm E1, so a BAIL) | a per-access native check: window test, then the slow path through the translator. No hoisted guards, because there is no loop to hoist to |
| clock | `STEP 1` per instruction, a budget test per transfer | one charge per block and one budget test at the block's exit, the same accounting the threaded path uses |
| unsupported instruction | declines the region | the block ends there and hands that one instruction to threaded code |

Target: **≤ 2 µops per x86 instruction** on the corpus's hot blocks. Phase 0 measures
what these rules actually reach.

## 4. Block chaining keeps execution inside the engine

A baseline program is one basic block. Every exit is a transfer to another guest
address. If each exit went back to the host dispatch loop, the design would recreate the
boundary cost it exists to remove. So:

- **Direct exits link.** `jmp`, `jcc` and fall-through exits target another baseline
  program. The exit op carries a patchable target word. On first use it looks the
  address up in the block cache and writes the program's address in, much like the main
  emulator's `$bx_hot` chaining. Later exits branch directly inside `$uop_run`.
- **Indirect exits look up.** `ret`, `jmp r/m` and `call r/m` do a cache lookup without
  leaving the engine; only a miss leaves.
- **Leaving the engine is rare.** It happens only for decode, an API thunk, an
  unsupported instruction, a budget stop or a guard failure.

Invalidation stays exactly as it is for threaded code today: self-modifying code retires
a block, and retiring a block also unlinks every target word that points at it. That
needs a back-edge list per program, or an epoch check on linked exits (§7, question 3).

## 5. Tier-up

- Every baseline program counts its own entries in one word in its header.
- At threshold K, the region former (loop, then trace, from uop-tier-design §13) takes
  the head and runs today's optimizer.
- The optimizer reads the **decoded instructions already recorded with each baseline
  program**, not the guest bytes. That is where the double decode goes away. A cheaper
  alternative is to keep the per-instruction decode records beside the program.
- The optimized program replaces the head. Linked predecessors are re-pointed to it
  through the same patchable words.

Where tier-up goes next: once calls stay inside the engine (§4), the region former can
follow `call`/`ret` pairs through linked baseline programs. That gives the inlining the
main emulator's §11.3 census asks for, without a separate call mechanism.

## 6. Plan on toyvm, with gates

toyvm is the right place to test this. It already has the pieces: the naive lowering
(`uop-ir.js`), the optimizer with per-pass switches (`uop-opt.js`, `ablationConfigs`),
the E1 engine (`uop-wasm.js`), the live installer (`uop-live.js`), a timing harness
(`uop-speed.js`) and a 199-program corpus whose frames and dispatch counts serve as an
exact oracle.

### Phase 0: measure before building (no new tier)

1. **µops per x86 instruction for the baseline rules.**
   - Build a `baseline` config in `uop-opt.js` from the block-local versions of promote,
     addrfold and flagfwd, with no liveness, guards, LICM or clock.
   - Report the µops per x86 instruction on every corpus head.
   - **Gate: median ≤ 2.5.**
2. **Speed per x86 instruction: baseline E1 against L1**, on the same snapshots, using
   `uop-speed.js`.
   - Use snapshots at *non-loop* blocks too, not only hot heads; `blk_mix`-style
     working sets.
   - **Gate: geomean ≤ 0.8× L1's ns per instruction, on both V8 and SpiderMonkey.**
3. **Compile cost.** Time the baseline lowering and encoding per x86 instruction against
   L1's `compile.js` per instruction on the same blocks.
   - **Gate: ≤ 3× L1.** Code that runs once pays this, so it bounds the boot and load
     regression.
4. **Size.** Compare the encoded bytes per x86 instruction for baseline µops and L1
   threaded words. This decides whether the arena holds a whole working set (§7,
   question 2).

If gate 1 or 2 fails, stop and write down why. The baseline lowering is then the thing
to fix, not the plan.

### Phase 1: baseline tier live (`--uop-baseline`)

- Every block L1 would compile becomes a baseline program instead. Unsupported
  instructions end the block and fall back to L1.
- Add block chaining (§4) and E1-native flags and memory for the baseline op subset, so
  there are no BAILs to the JS reference interpreter on the hot path.
- L1's spin folds (PSPIN, generalPortSpin) and other superinstructions stay L1 blocks.
  They are already optimal, and replacing them would lose time invisibly (see the
  JULTRO lesson in the toyvm notes: a lost fold changes only time, never dispatch
  counts).
- **Correctness gate:** 199/199 frames *and* dispatch counts identical to pure L1.
- **Speed gate:** geomean over **all 199 programs**, not only the programs that
  install, because this tier exists for the 117 that never install. It must be faster
  than L1 on both engines, with a measured null band, on a quiet box.

### Phase 2: tier-up (`--uop-baseline --uop`)

- The optimizer takes its input from the baseline programs (§5), and optimized
  programs are linked in.
- **Gate:** the combination beats both of today's configurations, L1 alone and L1 plus
  the µop tier, on the corpus and on the ~80 programs that install today.

### Phase 3: main emulator

Port the design only if phases 1 and 2 pass.
- The main emulator is simpler on one axis: vregs 0–7 *are* the register file, so the
  baseline needs no promotion at all.
- It is harder on another: the threaded path there is heavily tuned. It has the
  replicated dispatch macro, the register file in memory, and folds. So toyvm's margin
  over L1 is an upper bound on what the main emulator can gain, and phase 0's
  measurements should be repeated on the real `$next`, using `bench-loops.js`
  `blk_mix512` and the `wasm-native.js` instruction counts.
- A/B uses `tools/uop-game-ab.js` with `--branch-clock`.

### Phase 0 results (2026-09-29, quiet box, not yet committed)

**Density (item 1): `tools/toyvm/uop-baseline-census.js`, 193 programs with
samples.** Every sampled L1 block is lowered as a straight line (`discover
{straight}`) and its path µops counted, weighted by samples (guest steps):

| | naive | baseline (`OPT.BASELINE`) | all passes | baseline, resident regs | all, resident |
|---|---|---|---|---|---|
| median µops / x86 insn | 7.62 | 4.59 | 3.59 | 3.66 | 2.62 |

L1 takes a median **0.97 dispatches per instruction**. **Gate 1 (≤ 2.5) fails for
every variant.** "Resident" drops the per-block `getr`/`putr` reloads, the model
where guest registers live in E1's value file permanently; it is the closest
(2.62). On a short block (median 5–6 instructions) the promote model's
entry/exit register traffic is most of the cost.

Coverage is **not** the obstacle it was assumed to be: of the sampled steps,
49% sit in L1 spin folds (nearly free in time already), 37% are whole straight
lines in the µop set, 12% run a prefix and stop at an unsupported instruction
(top stops: `movs`, `leave`, `out`, a self-patching `cs:` store, `call far`), and
only 2% cannot start.

**Speed (item 2): `uop-shell-bench.js --configs=all,baseline`, top live head of
each of the 67 installing programs, node and SpiderMonkey.** A loop region
compiled with only the baseline passes, i.e. block-local code quality with
perfect in-region chaining and a per-header clock, so an **upper bound** on a
real baseline tier:

- Without `guards`, blocks **bail** to the JS reference interpreter: NM2
  143,997 bails in one entry (x0.02), DREAM 32,000, RUNME2ND 870. Every
  catastrophic row is a bail row. (CORRECTION, 2026-09-29: this first said
  memory was the cause. `uop-shell-bench` now prints each bail row's top
  blocks and reasons, and every one of these was `callh`, a **shift**. E1
  had no native shift; `all` only escaped because `guards` lets flagfwd
  rewrite constant-count shifts inline. The fix and the rerun are below.)
- On the programs that ran natively with zero bails (7 node, 6 SM), the
  baseline beats L1 on every one: geomean **x2.33 node / x1.56 SM** against
  x2.97 / x2.16 for the full optimizer. It keeps ~70–80% of the win.
- 60 of 134 runs never reached their head at the capture budget, and most
  of the rest barely entered E1 (both arms within ±5% of L1), so the clean
  set is small. Fixing `capture` is the next harness step.

So far, on toyvm: density fails the proxy gate, but time on the clean set
passes, because an E1 µop is much cheaper than an L1 dispatch.

**E1 bails removed (2026-09-29).** There were two native gaps, both now
filled in `uop-wasm.js`:

- `shv_<kind><w>`: a shift or rotate by a count known only at run time
  (CL, or an immediate when `guards` is off). It is `shiftHelper` in closed
  form, with the count masked by the machine's `$shm`, so it needs no guard.
  A zero count leaves the value and every flag alone; otherwise CF/OF are
  written, plus SZP unless it rotates.
- `ldf`/`stf`: slow-half memory with full L1 semantics. A plain access runs
  inline. Anything else (VGA, a 64K wrap, a store onto code) hands the
  block to the reference interpreter from its start. That is lowered only
  where nothing before the access in its block had an effect, so rerunning
  from the top is exact; otherwise the block still bails whole. A shift does
  not count as an effect even though it writes flags before its store: it
  sets every flag bit it touches from its operands alone, so a rerun leaves
  the same flags. Without that rule, every slow-half `shl [mem],cl` bailed
  whole (MEMSHIFTS: 259 bails, now 0). WRAPS now also shifts through the
  wrapping address and requires every bail to be one of these native
  hand-overs, which it is (54, matching L1 exactly).

  What still reaches JS: ldf/stf's odd-memory hand-over, by design, and a
  memory access after a register or segment write in the same slow-half
  instruction. No instruction in the µop set has that order: `pop [mem]`
  would, but 8F is outside the set and ends the region instead. The
  remaining `Unsupported` throws are defensive, and a bench row names any
  that fires (`bail` lines). Before
  this, every slow-half block with a memory access bailed, which is what
  the budget CHECK's deopt lands in at the end of every entry.

In `test-toyvm-uop-live` the bails went from FLAGS 4512, MULDIV 8934,
SEGLOADS 178 and DSHIFT 73 to 0. Two new cases were added to
`test-toyvm-uop` (every config, via the reference interpreter) and
`test-toyvm-uop-live` (E1 against pure L1: registers, RAM and dispatch
count):

- SHIFTS: every kind and width by CL over 0..63, all flags read back. It
  must not bail.
- WRAPS: word/dword accesses wrapping ES's segment. It must reach the
  mid-block hand-over, and it does, 30 times.

Rerun on the box (bt5, quiet, `--configs=all,all,baseline,allRP`; the
second `all` is the run's own null band), 34 clean programs, **zero bail
rows anywhere**:

| | node | SM |
|---|---|---|
| null band (`all#2`/`all`, geomean) | x1.000 | x0.998 |
| all over L1 | x1.274 | x1.164 |
| baseline over L1 | x1.153 | x1.052 |
| baseline time / all | x1.105 | x1.107 |
| allRP time / all | x0.999 | x0.988 |

NM2 baseline went x0.03 → x2.10 (node) and RUNME2ND x0.02 → x2.17. The
baseline passes keep most of the loop tier's win but not 70–80%: they are
10% slower than `all` in time. Gate 2 (≤ 0.8× L1's ns, i.e. ≥ x1.25) fails
on this set, which is still dominated by heads that barely enter E1 (21 of
34 within ±5% of L1).

**Capture ladder (bt6).** In bt5, 27 of the 67 corpus heads "never reached"
the loop head at a flat 20M-step capture. `uop-speed` now tries a ladder of
budgets around it (B, B/2, B/4, B/8, 2B, 4B), each from a fresh run, and
stands at the head from the first budget it recurs after. Only 2 heads
still miss (B-STEEL, BAZIRRE), and the set grows to 48 programs (node) / 47
(SM), still with zero bail rows. The bt5 conclusions hold: all x1.302 /
x1.193 over L1, baseline x1.138 / x1.027, allRP x1.003 / x0.990 of all,
null band x0.996 / x0.997.

The ladder also exposed a toyvm cache bug, not a tier one. A new
`CodeCache` restarts its arena but kept the previous session's jump table
and return stack. Capture opens a second session on a warm VM, which then
dispatched into overwritten arena words: "table index is out of bounds" on
DINO, ANSWER, ALCHMSB, CONTAGIO, DENTROCF and ACME-VIC. The fix is in
`dos-loop.js`: the constructor now clears both. Programs whose window ends
on SMC or an int after a few thousand steps (ANSWER, DOPE, POLLY) are too
short to time and should be read as no data.

**What resident is worth to a chained tier (bt7).** Phase 1 would chain
per-block programs, which is exactly where the promoted model pays a
reload at every block entry and a flush at every exit. The `baselineBF`
proxy puts those loads and stores on every fast body block of an
otherwise-`baselineRF` region: the same µops plus the block-boundary
traffic.

| | node (48) | SM (47) |
|---|---|---|
| null band (all#2/all, geo; p90) | x1.003; 2.1% | x0.998; 2.4% |
| baselineRF over L1 | x1.138 | x1.024 |
| baselineBF over L1 | x1.062 | x0.956 |
| **BF time / RF** (geo) | **x1.071** | **x1.071** |
| BF time / RF, p90 | x1.324 | x1.263 |
| BF > 5% slower | 17 of 48 | 15 of 47 |

Per-block reload and flush cost 7% of E1 time on both engines. That is
three times the null band's p90, and on SM it pushes the baseline below L1.
It is also a lower bound: `mergeStraight` has already fused straight-line
runs, so the proxy has fewer boundaries than a per-L1-block tier would.
**Resident is the register model for phase 1.**

### Resident guest registers (2026-09-29, measured)

Idea: make guest registers the first vregs, so a block never reloads or writes
them back. L1's register block was reordered (`isa.js`: selectors first, then
the 8 registers and 6 segment bases as one run of 14 dwords). A program built
with `resident` (`OPT.ablationConfigs` `allR`/`baselineR`) puts its vreg file
at `REGFILE_BASE` (`uop-wasm.js VFILE`), so vregs 0..13 **are** the registers,
and `finalize` drops every RELOAD and FLUSH. A register that mergesink keeps
narrow must keep its real upper bits now, so every write to it is tagged `dw`.
The reference interpreter merges it, and E1 lowers it to a store-narrow op
variant (`add.h`, `mov.hi` = AH). A partial merge into the register itself
becomes one `mov.h`/`mov.b`/`mov.hi`.

**Density: it works.** Census, 193 programs, median **E1 ops** per x86
instruction (the census now counts lowered engine ops, not only optimizer
µops, and those differ: flag materialization in exit stubs expands):

| | baseline | baselineR | all | allR |
|---|---|---|---|---|
| E1 ops / insn | 6.00 | 4.79 | 4.09 | **2.93** |

**Time: narrow stores lose, full-width merges break even.** `uop-shell-bench`,
same 67 heads, clean rows (no bails), time relative to `all` (<1 = faster):

| | node (n=35) | SM (n=34) |
|---|---|---|
| allR (narrow `i32.store16/8`) | **x1.084** | **x1.077** |
| allRF (32-bit load-merge-store) | x0.998 | x1.005 |

The narrow store is the problem. The register's next read is a 32-bit load of
the same slot, and a wider load cannot forward from a narrower in-flight
store: it is the partial-register stall moved into memory. DIZZY_FI and anarchy
go from x2.9 to x1.5 over L1 (node), and from x1.46 to x0.84 (SM). With the
merge done as a full-width RMW (`resident: 'full'`, `allRF`) those recover
completely, and the geomean is flat.

Flat, not faster, because these heads are **loops**: one entry and one exit
per thousands of iterations, so the reload and flush it removes were never
on the hot path. Inside the loop, the promoted model keeps a narrow register
in a vreg with garbage upper bits and pays nothing. The resident model pays a
load-merge-store per write (RUNME2ND x5.14 → x3.99). Where resident should
pay is the case the census prices: short blocks entered and left constantly,
i.e. a baseline tier with block chaining. Loops can't show that, so it
waits for phase 1. First verdict (superseded below): keep `resident: 'full'` as the
baseline tier's register model, never use narrow stores into a slot that is
read full-width, and keep the loop tier on the promoted model.

**One register model: resident, plus per-region promotion of narrow writes
(`resident: 'promote'`, `allRP`).** Two register models aren't needed. The only
thing promotion still buys a loop is full-width writes to a register
mergesink keeps narrow. So `finalize` keeps the register file as every
register's home and renames only those registers (narrow and written in the
region) to a temp: `t = mov r` at FASTENTER, `merge16/merge8l r, t` (one
`mov.hf`/`mov.bf`) at each exit and deopt. Everything else stays resident.
The baseline tier needs none of this: a block compiles each operand to its
slot.

Rerun on a quiet box (load 0.0; the `allR`/`allRF` table above ran while
another agent held the box, so treat it as indicative). Same 67 heads, all
clean, time relative to `all`:

| | node (n=35) | SM (n=34) |
|---|---|---|
| allRF | x0.999 | x1.007 |
| allRP | x0.992 | x1.009 |

This run has no `all`-vs-`all` repeat, so there is no measured null band.
Per-program swings of ±10% show up in both directions for all three
configs (ASYLUM, NM2, ANARCHY), so read them as noise. The narrow-write heads
return to `all` under `allRP`: on SM RUNME2ND is x2.603 / x2.266 / x2.603
(all / allRF / allRP) and anarchy x1.35 / x1.46 / x1.353; on node RUNME2ND is
x3.80 / x4.01 / x3.86. Verdict: `allRP` matches the promoted model on loops,
and it is a single register model that a baseline tier can share. Tests:
test-toyvm-uop (2904 differential runs) and test-toyvm-uop-live under `allRP`.

### Phase 1, step 1: the arena and links (2026-09-29, 4738fc82)

The mechanism §4 needs now exists (`uop-wasm.js` `E1Arena`, `uop-live.js`
`chain`, CLI `--uop-chain`):

- Many resident programs live in the engine at once, in a 3.7 MB arena
  behind the one-program page. `isa.UOP_TAIL_SIZE` reserves it, which is 64
  more pages of memory.
- Temporaries are shared, since they are dead at an exit. Each program's
  constants sit in a pool behind its own code.
- Block ids handed back to JS (`bail`, `ldf`/`stf`) are arena-wide handles.
- A static exit lowers to `link`: a patchable target word plus the target's
  program id, both 0 when unlinked. When the budget is not spent and no code
  was written, the link is taken inside the engine, as L1's GO goes through
  its jump table. Otherwise it is exactly `exit`.
- `setHead` and `dropHead` patch and unpatch links. At each entry, the chain's
  closure is guarded as one unit and checked against its bytes; a program
  whose bytes changed is unlinked until its own head rebuilds it.
- The live suite runs a fourth time in this mode and is exact: frames,
  registers, RAM and dispatch counts, including PATCH's rebuilds and WRAPS's
  54 handle bails.

**It links nothing, and that is the finding.** Six demos were run for 60M
dispatches with `--uop-chain` and an exit census (`exitsAt`):

| program | early exits / all exits | where the early ones go |
|---|---|---|
| RUNME2ND | 87 / 2707 | a 1-instruction line |
| DREAM | 100 / 1683 | 1-instruction lines |
| NM2 | 64 / 2578 | a 6-instruction line |
| AUTUMN | 1 / 1563 | a 1-instruction line |

96-99.9% of loop-program exits are the **end of the slice** (budget spent).
They are not a transfer a chain could continue. Chaining between loop
programs has nothing to gain, for a structural reason: discovery explores
everything reachable from a head. So a loop program's static exits land only
where exploration was cut, at an unsupported instruction or the node cap, and
never at another program's head.

The time the loop tier misses (DREAM 44%, AUTUMN 45%) is in heads it
**declines**: functions ending in `ret`, straight lines, `in al,dx`. The
reason is that a non-loop head costs a JS round trip per entry. That is
§4's argument, now measured from the other side: the links pay off only once
there are per-block programs to link to. The next steps are:

1. Lazy link fill: a miss returns to the arena loop, not the session, which
   builds the target and patches the word.
2. An L1 fallback that hands back after the unsupported instruction. Phase 0's
   12% "cut" share (`movs`, `leave`, `out`, far `call`) goes through it on
   every execution.

### Phase 1, step 2: the µop-only arm (2026-09-29, 4738fc82, fe26bbfb, 00306e68)

Both next steps now exist in one place, `tools/toyvm/uop-only.js` (run-dos
`uopOnly`, CLI `--uop-only`, arm-bench arm `only`). It is the far end of
this design: **every** instruction the guest runs goes through a µop program
on E1. It is a fourth arm beside `l1`, `uop` (L1 + the loop tier) and `jit`,
not a replacement for any of them. L1 is still the oracle: same guest, same
dispatch clock, same frame.

- **At a handback** the session asks for the site at (code key, mask, ip).
  A new site is built from the current bytes: the loop nest through the ip,
  else the straight line from it (capped at 32 instructions). The program
  goes into the arena and its head is registered, so every static exit to
  that ip is linked.
- **An unbuilt target** is built inline, inside the drive loop. It is not
  handed back to the session (see the bugs below for why).
- **A fallback** covers any instruction the µop set lacks. L1 runs exactly
  that one instruction (`compile.js` `oneInsn`, the block TF single-stepping
  runs), then the loop carries on. The one exception is an L1 spin block
  (below).
- **SMC**: a program's bytes carry code bits for as long as it lives, so a
  store into them breaks the slice exactly as a store into L1's code does.

**Results** (100M dispatches, 12 demos, load ~11 so the times are rough;
checksums exact):

| arm | CPU vs l1, geomean | p10 | p50 | p90 |
|---|---|---|---|---|
| uop | x1.40 | x1.12 | x1.39 | x1.62 |
| jit | x1.40 | x1.09 | x1.27 | x1.99 |
| only | x5.63 | x3.63 | x6.37 | x8.34 |

11 of 12 programs are exact in every arm. The µop share is 86-100% per
program. Most of the `only` gap is build time, not execution: BRW spent 148s
building in a 110s run, ACCIDENT 13.7s of 17.4s. The engine is fast enough
once built; building everything is what costs.

**Bugs it found while becoming exact:**

1. A handback for an unbuilt site re-cut the slice. Each handback
   re-derives the Sound Blaster block-end cut, so an extra one with budget
   left moves every later IRQ date (BRW). Fix: build inline.
2. The continue rule could run past an `endSlice` cut made by a port write.
   Fix: the drive loop checks `machine.sliceCut`.
3. A program over an L1 spin loop left the loop after as many iterations as
   the port took to change. L1 charges the rest of the slice in whole
   iterations, so the handback landed on a different dispatch (BRW's SB poll,
   3 dispatches early). Fix: where L1 compiles a spin op (lone self-branch,
   3DAh poll, general port poll), the site is that one L1 block with every
   other head a handback. This is the spin answer for this arm: exact and at
   L1 speed. A µop spin terminator would buy nothing here, so none was built.
4. A region that fails with too many vregs (> 2047) paid a ~1s failed build
   on every SMC rebuild. Fix: `lineCap` remembers the line length that worked
   (BRW 30M builds: 34.6s to 17.6s).
5. `resident: true` computes wrong values in this arm. ACCIDENT exits to DOS
   at 1.2M dispatches, on E1 and on the reference alike, so the program is
   wrong, not its lowering. The arm now refuses anything but `'promote'`.
   `baselineRP` (baseline passes, promote) is exact and is arm `only-bl`.
   (Fixed in step 7 below: narrow reads now see the slot's upper bits
   masked off; arms `only-R` and `only-RF`.)

**BRW still disagrees, and it is a retiming, not a wrong computation.** L1
marks code bits over everything `compileProgram` compiled, i.e. the whole
reachable program including code never executed. The µop arm marks only what
its sites cover. BRW's self-patching extender (110:18f..1b1) stores into
bytes L1 has compiled and this arm has not, so L1 breaks the slice there and
charges a dispatch the µop arm does not. The same computation lands one
dispatch apart, and IRQ dates follow.

**Where build time goes** (`OPT.build(reg, { timing })`, BRW 15M, 788
builds):

| pass | share |
|---|---|
| constprop | 34% |
| forwardFlags | 16% |
| sinkDeoptDefs | 14% |
| mergeStraight | 10% |
| forwardMemory | 6% |

No pass is superlinear. A 12-instruction line replays in 18-30ms. The
150-500ms outliers were GC and box load, and a replay of the same build
spiked to 193ms once. It is a fixed per-program price paid for every site,
and most of BRW's builds are **distinct sites, not rebuilds**:
- A byte-exact program cache hits 81 of 786. Its key is the site, shape,
  machine snapshot and segment bases, checked against every byte discover or
  the optimizer read.
- The baseline passes on lines (`only-bl`) do not change that picture.

So the lever for this arm is building less, not optimizing faster: tier
cold lines, or share programs across sites.

**Fallback coverage** (00306e68): RCL/RCR (register destination), CLC/STC/CMC
and LEAVE are now µops, exact to L1's handlers. A new differential shape
(`rotcarry`) covers every width and count form. The flag helpers go through
`callh`, which can now *read* a flag: the carry is materialized ahead of it,
and E1 treats a CF-reading helper as an effect. At 30M, CMA_SHRT's
clc/stc (1.8M per 100M before), DTM2's leave and rcl, CYCLE's rcl/rcr (620K)
and B-STEEL's rcr are gone, and all four stay exact.

What is left, and why it was not done yet:
- **Far `call`/`ret` (9a/ca/cb, DTM2 and ACCIDENT's largest).** The target
  is another code key. Lowering it only to exit and hand back saves one
  fallback entry and no more. The win needs cross-key links.
- **PUSHF/POPF.** POPF opens an interrupt window, so L1 ends its block there.
  PUSHF needs a full-word flag consumer in the forwarding pass.
- **REP MOVS/STOS.** The count is large, but each fallback is a whole L1
  string loop, so the entry cost is already amortized.

### Phase 1, step 3: a cheap cold tier and tier-up (2026-09-29, 21f4c54e + this)

**A cheap build is a pass set, not a new lowering.** The earlier worry was
that OPT.build's fixed structure (fast and slow halves, cfg, mergeStraight,
finalize) was the floor, since a no-pass build cannot be resident. It isn't
the floor. With promote alone, the arena accepts every program. A replay of
ACCIDENT's 2001 captured builds (same inputs, configs alternated) prices them:

| config | ms per build | static µops per insn |
|---|---|---|
| allRP | 2.3-2.9 | 15.5 |
| baselineRP | 3.0 | 19.3 |
| promoteLiveRP | 0.73 | 17.7 |
| promoteRP | 0.55-0.66 | 18.5 |

The cold tier is **promoteLiveRP** (promote + flaglive), not promoteRP.
Without flaglive, a program materializes flags L1 leaves stale because
nothing reads them. PMENTRY's last `xor dx,cx` leaves DX=0, so ZF=1 by the
architecture, but L1 and allRP both skip the dead record. That is correct,
and it still differs from the oracle.

**Planar VGA in place** (21f4c54e). A full-checked access that hit planar
VGA used to hand its whole block to the JS reference interpreter. That was
1.1M hand-backs on DREAM, and runRef + enter made up 38% of the run.
`ldfv`/`stfv` now call L1's own `uop_vga_rd8/wr8`, imported into E1. DREAM
went from x14.4 to x4.4 of L1.

The fast half still deopts at every planar access. On DREAM, 65% of the hot
program's blocks run in the slow half, so optimizing that loop buys
nothing. That is the next VGA lever: predict planar from the segment base at
build time, and make the op a barrier to forwarding.

**Tier-up** (`tier: { passes, after }`, arms `only-tK`):
- Each cold program's first arena word is a counter, bumped by a `cnt` op at
  every loop header (fast head included), so it counts entries and iterations
  alike. Chained entries never return to JS (ACCIDENT: 151K chains against
  172K entries), so the count has to be kept in wasm.
- drive() scans the cold list at the start of each call. A site at K is
  rebuilt on allRP and its rec is swapped in place (setHead re-points every
  inbound link).
- A failed hot build keeps the cold program and counts the reason.
- Exact on all fourteen test shapes after 4 counts, and on the twelve demos.

Results, cpu against l1, exact everywhere:

| dispatches | only (allRP) | only-min | only-t1k | only-t10k |
|---|---|---|---|---|
| 10M, 12 programs | x12.3 | **x6.6** | x8.9 | |
| 100M, DTM2 / B-STEEL / CMA_SHRT | x5.0 | x3.7 | x3.7 | **x3.5** |

allRP code does run faster. In B-STEEL's profile, its E1 time is 0.09s
against promoteLiveRP's 0.19s. But E1 execution is a sliver of a 10M run,
and a hot site is a big region, so its allRP rebuild costs ~12ms. The garbage
from those builds is also billed to `cpuSecs` through the concurrent GC
threads, which `buildSecs` never sees. At 10M, tier-up cannot amortize. At
100M it breaks even (CMA_SHRT gains, x2.85 to x2.38).

So the gap to L1 at long runs is no longer builds. DTM2 on only-min spends
2.9s outside builds against L1's 0.74s total, with 608K one-instruction L1
fallbacks and every program entry a JS round trip. What's next:
- cross-key links, so far call/ret stops being a fallback;
- VGA prediction in the fast half;
- only then a K sweep that means something.

### Phase 1, step 4: far call and return as µops, linked across segments (2026-09-29)

In real and V86 mode, `call ptr16:16`, `retf` and `retf imm16` now decode
(`uop-x86.js` kinds `callf`/`retf`), with L1's exact semantics. `call_far`
reads its immediates from the code again when it runs, as L1's handler does:
FARCALL patches its own selector from the straight line that contains the
call. The 32-bit and protected-mode forms stay in L1.

- **The program ends at the far transfer.** Its exit carries the target
  segment's code base (`cb`). The arena link key becomes `${cb}|mask:ip`
  instead of the program's own key, so a chain crosses segments inside wasm.
- **Exits are only as static as their immediates.** A far call takes the
  static link only while the re-read immediates equal the decoded ones.
  Otherwise it leaves through the dynamic exit.
- **Far exits count as dynamic for flag liveness.** This applies both in the
  `flush` and in `liveFlagsAt`. The next code is in another segment, so the
  walk cannot see it.
- **`drive()` always re-reads CS.** It used to assume only a fallback could
  change it.

Every run agreed with l1 on dispatches and frame:

| run | only (allRP) | only-min | only-t1k | only-t10k |
|---|---|---|---|---|
| 10M, 12 programs | x11.7 (was x12.3) | x6.4 (x6.6) | x8.1 (x8.9) | |
| 100M, DTM2 | x6.9 | x4.7 | | x4.8 |

DTM2's fallback entries at 100M fell from ~600K to 8,278. The top fallback is
now `spin`, 40.9M of its 100M steps: its retrace wait runs in L1, and L1
folds it cheaply. The remaining fallbacks are `pushf`/`popf`, `cli`/`sti`,
and `movs`/`stos` with `rep`.

### Phase 1, step 5: planar VGA predicted at build time (2026-09-29)

Before this step, any fast-half access that hit planar VGA deoptimized. Its
whole loop then ran in the slow half, whose `ldf`/`stf` bail to the reference
interpreter. DREAM ran 65% of its hot blocks that way.

`makeFast` now predicts planar accesses:

- **The prediction.** An access is marked `op.vga` when VGA planar mode is on
  at build time and the access's own `gets` segment has a base in the planar
  window. The test is the engine's own: `((base & 0xFFF0000) | 1) === key`.
- **How a marked access lowers.** It becomes `ldv`/`stv`, which does the VGA
  access in place through L1's `vga_rd8`/`vga_wr8`. Only a 64K wrap, or a
  store onto code, still deoptimizes.
- **When it lowers that way.** Only when no later op of the same instruction
  can deopt; otherwise the slow half would repeat the VGA effect.
- **The passes treat it as an effect.** A marked load is not pure,
  forwarding skips marked accesses, and a marked store clears what forwarding
  had available.
- **It is only a prediction.** An unmarked access that turns out to be VGA
  still deopts, and a marked access that turns out not to be VGA runs as a
  plain access.

Result: DREAM's slow half went from 65% of its hot blocks to 0. All 12
programs are still exact at 10M (only x11.9, only-min x6.4, only-t1k x8.3, at
load 20-30).

**A bug the new test found (VGAPLANAR, `test-toyvm-uop-only.js`).** The bug
was older than prediction. Both entry loops (`enterOver` and
`E1Arena.enter`) read the VGA key once, when they were entered. Consider a
program that enables planar mode with an `out` and then bails to the
reference interpreter. When wasm resumed, it got the key from before the
`out`. It then treated A000:xxxx as plain memory: a read-modify-write lost
every VGA effect after its first iteration. The key is now read on every
entry into wasm.

### Phase 1, step 6: the tier-up K sweep (2026-09-29, 6fe267f7)

Arms `only-tK` for K = 64, 1k, 10k and 100k, against `only` (allRP) and
`only-min` (promoteLiveRP). Every run was exact. The box was at load 6-14, so
treat the timings as rough.

cpu x vs l1 (lower is better):

| run | only | only-min | t64 | t1k | t10k | t100k |
|---|---|---|---|---|---|---|
| 10M, 6 programs, geomean | x14.7 | x7.5 | x11.3 | x10.1 | x8.6 | x7.5 |
| 100M, B-STEEL | x6.5 | x4.3 | | x5.4 | x4.5 | **x4.0** |
| 100M, CMA_SHRT | x2.6 | **x2.1** | | x2.2 | x3.0 (noisy) | x2.8 |
| 100M, DTM2 | x8.2 | x5.2 | | x5.8 | x5.4 | **x4.9** |

**Build cost decides the ranking, not code quality.** allRP code is much
faster once it is built. Net of build time, on B-STEEL it runs 0.09s against
promoteLiveRP's 0.96s; on DTM2, 0.84s against 1.67s. But a single allRP build
costs as much as L1's whole 100M run (0.4-2s), which is not enough time to
pay it back.

- **A larger K is better throughout.** It rebuilds fewer programs: DTM2 tiers
  up 80 programs at t1k and 11 at t100k.
- **t100k is about the same as only-min at these lengths.** The default stays
  promoteLiveRP with K = 100k.
- **Even allRP execution is slower than L1 on branchy code.** On DTM2 it is
  0.84s against 0.54s: about 9-12 fast µops per x86 instruction, with a step
  per instruction.

So, for this arm, the next lever after tiering is build cost and µops per
instruction, not a better K.

### Phase 1, step 7: resident: true fixed; arms only-R and only-RF (2026-09-30)

**The bug.** It was in the program, not the lowering. `promote` lets
mergesink keep a register narrow: 8 bits if a program touches only cl, 16 if
it touches only cx. The passes then assume the promoted model, in which the
register's vreg holds a clean, zero-extended value.

- **allRP keeps that promise.** It gives each narrow register a zero-extended
  temp for the region's lifetime (step 3's hold).
- **resident: true and 'full' did not.** Their vreg *is* the register-file
  slot, so every read also saw the architectural upper bits.
- **The failing case.** In ACCIDENT, a program at 0xEDC keeps ecx at 8 bits
  (it only reads cl), while ch is nonzero. Its `add dl,cl` / `adc dh,al`
  forwards the carry as bit 8 of `dl + ecx`, which is ch's low bit. ACCIDENT
  left for DOS at 1.2M dispatches.

**How it was found.** Three steps, with scratch probes:

1. Bisect program start ips: the ip-0 programs.
2. Keep masks for one consumer kind at a time: only `add` needed them.
3. Bisect `add` sites: one site, head 0xEDC.

**The fix.** In finalize, for resident true and 'full' only, each narrow
register read is of a zero-extended copy (`andi`). The copy is made once per
block and made again after the register is written. Writes were already
narrow stores (`dw`). On the wraps loop this is +4 µops per iteration (allR
43 against allRP's 39).

**Tests.** `test-toyvm-uop-only.js` NARROWHI is ch=1 set by an earlier
program, then a cl-only loop of `add dl,cl` / `adc bh,0`. Without the masks,
allR gives bx=2C00h; L1 gives 0. NARROWHI, DSHIFT, SHIFTS and FLAGS now also
run on allR and allRF. uop-only accepts any resident model.

**Results.** arm-bench arms `only-R` (allR) and `only-RF` (allRF): all 12
programs are exact at 10M, ACCIDENT included. The three resident models are
within noise of each other at load 12-19:

| 10M geomean | only (allRP) | only-R | only-RF |
|---|---|---|---|
| programs 1-6 | x14.5 | x14.0 | x13.8 |
| programs 7-12 | x10.3 | x9.9 | x10.1 |

The 10M runs are build-bound (step 6), so this says nothing about the three
models' execution speed. That question stays with the resident-registers
section above.

### Phase 1, step 8: the naive lowering as the cold tier (2026-09-30)

**Why a first build cost more than L1's whole compile.** Measured with a
phase probe and an optimizer replay over captured regions:

| cost per x86 instruction | |
|---|---|
| L1 `compileProgram` (decode, emit words) | ~3 µs |
| µop optimizer, promoteRP (cheapest set) | ~54 µs |
| µop optimizer, baselineRP | ~405 µs |
| µop optimizer, allRP | ~680 µs |

That is before discover, `IR.lower`, `lowerProgram` and encode, and
spinBlock's own L1 compile. The optimizer copies the region into a fast half,
then walks every op 10-20 times: constprop alone runs up to five times, each
up to 12 rounds. After two fixes (54555207, output-identical: mergeStraight
was quadratic, and each op was cloned through JSON) no function stands out.
GC is 12-14%, and the rest is spread thin.

**The cold tier needs no passes.** The naive lowering (`IR.lower`) is already
valid in any machine state: every register is a GETR/PUTR of L1's register
file, every flag a REC into L1's lazy-flag globals, every access the full
accessor, and the budget is tested at every transfer. It names no guest vreg,
so resident changes nothing in it but where its temporaries live. Pass set
`naiveR` (uop-opt.js `naiveResident`) installs it as an arena program:

- Its loop headers are the back-edge targets and the head, marked so a
  counting arena bumps the tier-up counter there.
- Dead flag records go the way L1 drops them: the flaglive rule, run on the
  naive CFG, with each exit reading what `liveFlagsAt` says is live at its
  target. Without it PMENTRY left ZF set where L1 leaves it stale-clear.
  That is 84 µops per wraps iteration, against naive's 88.

**Arms.** `only-naive` (naiveR everywhere) and `only-nK` (naiveR cold,
rebuilt on allRP after K header counts). Tests: test-toyvm-uop runs naiveR
as its 28th configuration (5040 differential runs agree), and
test-toyvm-uop-only runs every program on `naive` and on `naive-tier`
(tier after 4).

**Results.** All 12 programs are exact at 10M in every arm, load 13-20:

| 10M geomean vs l1 | only (allRP) | only-min | only-naive | only-n100k |
|---|---|---|---|---|
| programs 1-6 | x15.6 | x8.1 | x6.9 | x6.7 |
| programs 7-12 | x9.3 | x5.1 | x4.3 | x4.8 |

A naive build is about 5-10x cheaper than the old one. At this run length the
unoptimized program beats every optimized one outright: the optimizer never
earns its build back. What is left, x4-7 of L1, is no longer build time.
DTM2 builds for 0.07s of a 0.63s run, against L1's 0.08s total, so the next
lever is the arm's execution and handback overhead.

### Phase 1, step 9: no reference-interpreter blocks, and what Ion makes of E1

**Bails.** Profiling only-naive showed arena blocks the lowering refuses,
all for one reason: *full memory after an effect*. A full-checked load or
store can hand back, which reruns the block from its start, so it must not
follow a side effect in the same block. Naive blocks are one instruction but
still hit it (`push` stores after a register write; `movsw` does both). Those
blocks ran on `runRef`, the JS reference interpreter: DTM2 93,144 in 10M,
DEMO5 138,706, ACCIDENT 31,997. `splitFullAfterEffect` (uop-opt.js) cuts a
body block at each such access, and `br` joins the two halves. Non-native
blocks are now zero on every probed program. The remaining hand-backs are
runtime ones: 0-135 per 10M.

| 10M geomean vs l1, all 12 exact, load 16-28 | only-naive | only-n100k | only-min |
|---|---|---|---|
| after the split | x4.61 | x5.00 | x5.97 |

That is down from about x5.4 for only-naive (step 8's two halves combined).
Spin fallback is still large: DREAM hands L1 2.9M spin dispatches of 10M,
RUNDEMO 6.2M, CYCLE 0.5M. Those run at L1 speed and cost this arm nothing.
So the x4.6 is the arena's own per-µop cost.

**What SpiderMonkey Ion makes of `$run`.** Measured with `tools/wasm-native.js`
on the E1 engine, with arms named through Ion's jump table. `$run` is one
function: 785 br_table arms, 128 KB of arm64 for 68 KB of wasm. The dispatch
head costs 10 instructions and 4 memory operations per µop:

```
ldr  w16,[x23,#56] ; cbnz        interrupt check, every µop
ldr  w0,[x20,#60]                $pc reloaded from a stack slot
ldr  w2,[x21,x0]                 opcode
cmp  w1,#0x311 ; b.cs            br_table bounds check
ldr  x3,=table ; ldr x16,[x3,x1,lsl#3] ; br x16
```

Every arm ends with `ldr w6,[x20,#36]` (the $shm param, reloaded),
`str w0,[x20,#60]` ($pc spilled) and `b head`. The loop-carried locals live
in memory, not registers: $pc makes a store-to-load round trip through the
stack on every µop, on the critical path. Each operand costs two instructions
(`add x16,x0,#k; ldr w,[x21,x16]`), because arm64 has no base+index+offset
mode.

| arm (naive-hot) | insns | loads/stores |
|---|---|---|
| mov | 10 | 6 |
| getr32 / putr32 / getr16 / putr16 | 13 | 8 |
| add / sub / and / xor | 14 | 8 |
| step | 10 | 5 |
| link | 34 | 12 |
| exit | 39 | 14 |
| ldf16a | 41 | 14 |
| stf16a | 52 | 15 |
| all 785 arms: median / p90 / max | 28 / 72 / 2304 | |

So a register copy µop costs 20 native instructions with the head, and 10
memory operations, of which 2 are the work. The levers, in order:

1. **Fewer µops per x86 instruction.** This is the naive tier's own lever:
   84 µops per wraps iteration against allRP's 39. Fused naive shapes
   (getr+op+putr as one µop) remove heads without any pass.
2. **Keep $pc in a register.** This is an Ion register-allocation outcome,
   not something the WAT can request directly. The candidate test is a smaller
   `$run`, with cold arms moved out to callees: if $pc stays in a register in
   a 50-arm engine, arm count is the cause.
3. **The interrupt check.** Ion inserts it at the loop head. A loop that exits
   through `$budget` does not need it per µop, but wasm has no way to say so.

### Phase 1, step 10: the $pc spill is Ion's, and it comes from the host calls

**Cause.** Rebuilding `$run` from a subset of arms (the first N in EOPS
order) shows where the spill starts:
- Up to 92 arms, Ion keeps `$pc` and `$steps` in registers. `getr16` is 8
  instructions, `step` 5, and nothing touches the stack.
- From 94 arms on, every arm stores `$pc` and the head reloads it.

No single arm added to the first 90 triggers it. Arms 92-93 are `ldfv8a` and
`stfv8a`, the first two arms that call a host import (`$vga_rd8`/`$vga_wr8`).
One call site is fine. From two on, Ion stops splitting the loop-carried
ranges around the calls and gives them stack slots everywhere. E1 has 175
call sites in 79 arms.

**Fix: `callSafe` (uop-wasm.js).** In the loop engine, every host call is
wrapped so the loop-carried locals are stored to CALLSAFE before it and
reloaded after it: `$pc $steps $F` plus the machine params and the slot
registers. None of them is live across a call any more.

Ion, full 785-arm engine:
- The head keeps `$pc` in `w19` and no longer reloads it.
- getr/putr go from 13 instructions and 8 memory ops to 10 and 4.
- link goes from 12 memory ops to 5, and step from 5 to 1.
- The call arms grow, because they pay the saves: `ldfv8a` goes from 52 to
  111 instructions.

**V8 is different.** `tools/wasm-native.js --engine=v8` reads TurboFan's code
out of d8's `--perf-prof` jitdump. TurboFan keeps `$pc` in `w0` in BOTH
builds, and the hot naive arms are already tight without the change:
`getr16` is 8 instructions with 4 memory ops, `step` 6, no stack use.
callSafe still reduces V8's stack use elsewhere: arms touching `sp` go from
440 to 81, and stack ops from 3,019 to 1,597, mostly in cold shift and move
arms.

**Timing.** Nothing on this box resolves it.
- **Node:** arm-bench in one run gives only-naive x4.84 with callSafe against
  x4.67 on the old engine (`only-naive@spill`), and uop x2.29 against x2.15
  (slice time x0.92 against x1.02). The two only-naive numbers are within
  noise of each other, as the V8 code predicts.
- **SpiderMonkey** (`shell-bench --mode=only --arms=sm,sm@spill`) ran at load
  20-63. Per-program ratios spread from x0.58 to x2.33, which says nothing.
- **`--counters`** (instructions retired and cycles per process, via
  `/usr/bin/time -l`) did not settle it either. The per-dispatch slope
  between 2M and 12M spread from x0.87 to x1.40, because the counts include
  Ion's off-thread compiles and GC helper threads.

callSafe stays on by default: it is correct everywhere (test-toyvm-uop,
-uop-only and -uop-live all pass), and structurally it removes memory ops on
both engines. `TOYVM_CALLSAFE=0` and the `@spill` arms keep the old engine
for the A/B on a quiet box.

### Phase 1, step 11: fewer naive µops (fall-through layout, fused flags)

**Census.** `TOYVM_E1HIST=1` makes the loop engine call a `host.hist` import
before every dispatch. `e1Hist()` returns the op and op-pair counts. It is
off by default and costs nothing then. Run over DTM2, DHADREN, B-STEEL and
CMA_SHRT at 3M dispatches each with naiveR, the naive program executed
**59.5M µops**, about 5.7 per x86 instruction:
- `step` plus the `jmp` joining every one-instruction block: 23%.
- Eager flag chains, 6 `flagof` µops plus `wflags`: about 13%.

**Fall-through layout** (`fallThrough` in uop-wasm.js). Blocks are re-laid
greedily along jmp chains from the entry. A trailing `jmp` to the next block
is dropped. Arena and single programs use it; `straightWat` does not.
The census fell to 53.2M (-10.6%).

**Fused flag µops.** A full six-flag `rec` from add/sub/add32/sub32/logic is
one µop instead of seven:
- `wfaddn`/`wfsubn` for 8 and 16 bit;
- `wfadd32`/`wfsub32`, which take the carry-in;
- `wflogic`.
Each computes C P A Z S O from A, B and the result, and merges them into `$F`
under the six-flag mask. inc/dec and partial sets keep the old chain.
The census fell to **46.9M (-21% from the start)**, about 4.5 µops per x86
instruction.

**Checks.** test-toyvm-uop (all 28 configs agree), -uop-only and -uop-live
pass. arm-bench (12 programs, 10M dispatches, load ~8, every program exact):

| arm | cpu vs l1 | slice time vs l1 |
|---|---|---|
| only-naive, this step | x4.62 | x3.78 |
| only-naive, step 10 (load 20-60) | x4.61-4.84 | x5.1-5.9 |

The slice-time drop matches the µop cut, but the earlier runs were at a far
higher load, so it is not a clean A/B. The cpu number includes the builds
(up to 0.4s per program) and the L1 fallback, which this step does not touch.

**Where the naive µops go now:**
- `step` 15.7%. 58% of steps follow a `putr`, so a putr+step fusion is the
  next lever.
- `getr16`/`getr32`/`putr16`/`putr32`: 28%.
- `andi` 8.2%, mostly the width mask after a 16-bit `addi` or `add`, so
  masked narrow arithmetic.
- `getm_spm` + `and`: the stack-pointer mask.

### Phase 1, step 12: step fused into its predecessor

`X_s` is X followed by `$steps -= i`, for X in putr8/16/32, getcc*, the
fused flag writers, wflags and stfv*. `fuseSteps` rewrites `X, step` into
`X_s` in every lowered block. Not pout/pin, which read `$steps`. A bail inside
X skips the step either way. `TOYVM_STEPFUSE=0`, or an arm-bench
`ARM@nofuse` arm, turns it off.

- **Census** (same 4 programs, 3M each): 46.9M -> **40.1M µops (-14.5%)**,
  about 3.8 µops per x86 instruction. `step` fell from 15.7% to 1.4%.
  Cumulatively, the naive tier is down 33% from step 10's 59.5M.
- **Time: inside the noise.**
  - 10M, load ~3: only-naive x4.96 against x5.11 for @nofuse (cpu), slice
    x4.23 against x4.29.
  - 30M, with a second only-naive copy as the null band: x3.56, x3.55 @nofuse
    and x3.39 for the copy.
  - At 10M, build time is most of the slice (29-475ms per program against
    ~100-200ms of execution). So the cpu number is bounded by build, and a 15%
    cut in executed µops is not visible above a ±5% band.

**BRW.EXE disagrees at 30M in every uop-only arm.** It is older than steps
11-12 (the step-10 engine does it too), and `uop` and `jit` agree with l1.
- With `only: []`, where no µop program runs at all, it still diverges. So
  the cause is uop-only's fallback/drive path, not a program or its lowering.
- Dense slice logs (`--slice=1 --slice-log-regs`) agree in state up to
  1,379,094. There the guest leaves protected mode for real mode and goes
  back (cs 8 -> 20 -> 110 -> 20), and uop-only reaches 20:21e three
  dispatches earlier than L1.
- That billing gap moves the first IRQ (7,440,737 vs 7,440,734). The timer
  IRQ then lands at a different ip, and the frames part at ~26.6M.

### Phase 1, step 13: BRW.EXE fixed, three clock leaks (2026-09-30)

There were three causes, and all three were handbacks or dispatches that
depend on how the code is cut rather than on the guest.

1. **L1 billed its own volatile cut.**
   - compile.js ends a straight line with `end` where it runs into bytes the
     host has learned are volatile, or where it runs out of words.
   - `end` is a dispatch, so it cost a step. So 110:18f..1b1 cost 6 once
     110:1b1 was volatile, against 5 before, and 5 in uop-only.
   - `end_cut` is `end` that gives the step back. It is the same argument as
     `jmp_syn`. This is an L1 clock change, and all 28 toyvm tests still pass.
2. **A µop line exit handed back mid-block.**
   - A naive program whose straight line stops at a fallback instruction
     (`cli` here) is in the middle of an L1 block. L1 tests no budget there.
   - Its exit is now `why: 'line'`, lowered to `exitl`/`linkl`. `linkl`
     chains without the budget test and stops only on smc.
   - The driver carries on past a spent budget, as it already did for a
     fallback's `end`.
3. **An `iret` fallback always handed back.**
   - L1's `iret` hands back only when it owes the host something: TF, or an
     IRQ held for IF. Otherwise it resolves the return through its block
     cache.
   - uop-only compiles nothing L1 can find, so the lookup always missed.
   - That extra handback in BRW's SB handler at 7.44M re-cut the slice. The
     SB transfer's first render landed 42 dispatches early (7,440,757
     against 7,440,799). 17M dispatches later, `in al,2` (the DMA position)
     read `f1` where L1 read `f4`.
   - The drive loop now stays on an `iret` exit unless the window is owed.

How it was found:
- Slice logs with registers compared at equal dispatch counts, with slice=1
  only across the window, by a hook on `DosSession.step`. The slice-log ip is
  the block head, so two arms' ips differ even when their states agree.
- A dump of every audio render (`audioAt`, DMA address and count), diffed
  between the two arms.
- Port traces with exact stamps.

Result: arm-bench, 12 programs at 30M, l1 against only-naive: **12 of 12
clean**. Geomean x3.44 cpu and x2.97 slice, at load ~3.8.

## 7. Open questions, each with how phase 0 or phase 1 answers it

1. **Local flags without liveness.** Materializing a `rec` at every block exit may cost
   more than it saves in branch-dense code. Measure how many exit `rec`s are actually
   read. The alternative is an eager flags word, as toyvm E1 already models it
   (`flagof`/`getf`/`wflags`).
2. **Arena capacity.** A baseline tier stores *all* executed code, not just hot loops.
   The main emulator's churn with trace heads (Diablo: 2,491 kills) shows what an
   undersized arena does. Phase 0 item 4 gives the bytes per instruction. The arena
   must hold the working set or evict cold baseline programs only (LRU by entry count),
   and optimized programs must never be evicted for baseline ones.
3. **Unlinking on invalidation.** Choose between a back-edge list per program and an
   epoch word checked by each linked exit. The epoch costs one load per chained exit but
   needs no bookkeeping. Measure both in phase 1.
4. **Blocks that only ever run once.** If compile cost per instruction exceeds gate 3,
   compile on the *second* execution instead of the first, and let L1 run the first.
   That is a K=2 threshold for baseline, the cheapest possible tiering.
5. **Correctness surface.** The baseline lowering is new code that runs *everything*,
   unlike the optimizer, which runs only hot loops. The corpus dispatch-count oracle in
   phase 1 is the check. Any divergence stops the phase.

## 8. What this is not

- It is not runtime wasm generation. Programs are data interpreted by one fixed engine
  function, so the Win98 no-codegen rule (memory note `feedback_no_runtime_wasm_codegen`)
  holds.
- It is not per-program wasm slots. Toyvm decided against those: they gave +14–22% for
  a compile per program shape (`project_toyvm_uop_tier`).
- It does not replace the optimizer. It gives the optimizer a better input and removes
  the boundary around it.
