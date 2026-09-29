# Baseline µop tier: compile everything fast, optimize what is hot

Status: **design, not built.** It is checked on toyvm first (§6); it ports to the main
emulator (07d/07e) only if the toyvm gates pass.

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
