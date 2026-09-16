# Block chaining (round 15, alternative A)

`docs/block-executor-review-2026-09-15.md` §3 alternative (A), §5 round 15.

**One line:** when a block ends in a direct jump or a conditional branch, cache
the resolved threaded-code pointer of the edge's target *in the terminator's own
operand word*, so the next transfer over that edge skips `$branch_end`'s guard
chain and `$page_resolve` entirely.

Flag: `--block-chain`, **default OFF**, mutually exclusive with `--block-exec`,
propagated to worker instances through `INHERITED_WASM_GLOBALS`.

No runtime wasm generation is involved. Nothing is compiled, emitted or
`WebAssembly.compile`d; `$chain_end` is one fixed handler reading one word of
decode-time data.

---

## 1. Verdict

**The mechanism works and is correct. The round's ≥80% gate is NOT met.**

Chaining removes 47-66% of `$branch_end` entries on the review's windows, not
the ≥80% the review asked for, and the shortfall is not a tuning problem: it is
a census result. On RCT, **34% of all block transfers leave a block through a
terminator that carries no spare operand word** — `ret`, `call`, `loop`, and the
artificial `$th_block_end` the decoder emits at a page seam or a block-length
cap. Those cannot hold a chain slot without changing the threaded stream layout,
which is out of scope for this round (§7).

Everything else asked for holds: block decodes are unchanged to the digit,
every picture is byte-identical, and the transfer term the microbenchmark
isolates is cut by 64%.

---

## 2. Mechanism

### 2.1 Where the slot lives

The slot is the terminator's **existing** operand word. Nothing is added to the
stream, which is why "block decodes unchanged" holds by construction and why the
off arm's stream is byte-identical to `main`'s.

| terminator | stream | slot | shift |
|---|---|---|---|
| `$th_jmp` (H43) | `[fn][op][target]` | `op` — emitted as 0 at all three decoder sites and read by nothing | 0 |
| specialised `Jcc` (H307-H322) | `[fn][op][fall][target]` | `op` bits 31..2 — bits 1..0 are the adjacency/fell-through pair | 2 |

The word is addressed as `$ip - 8` (jmp) or `$ip - 12` (Jcc), i.e. the operand's
own address, and passed to `$chain_end` as `$patch_at`.

### 2.2 What the slot holds

Above the `shift`:

```
bits 29..17   epoch    13 bits, 0 = never patched
bits 16..1    delta    signed 16-bit, target - patch_at
bit  0        tag      which edge this slot is currently for (0 taken, 1 fell through)
```

**Delta, not a pointer.** A chunk grow relocates the whole chunk with one
`memory.copy` that preserves offsets, so a delta survives a relocation and an
absolute pointer would not. 16 signed bits is enough because the largest chunk
size class is 16 KB and both ends are inside the same chunk (§3.2).

**One slot, two edges.** A conditional branch has two edges and one word. The
tag says which edge the stored delta belongs to and the slot follows whichever
edge last missed. That is deliberately a thrash case for an alternating branch —
it costs a patch, never a wrong transfer, because the tag is compared before the
delta is used. The first cut chained only the taken edge and measured 39.4% on
caesar3; adding the fall-through edge took it to 66.2%, because the non-adjacent
fall-through is the *larger* of the two populations (caesar3: 3.29M `ftMissed`
against 0.66M taken).

### 2.3 The fast path

```
$chain_end(patch_at, chain, shift, tag):
  if (chain >>> 17) == $chain_epoch  &&  (chain & 1) == tag
     && !($dbg_any | $code16 | $yield_flag | $yield_reason | $bx_hot_on)
     && $block_budget > 0:
        $block_budget--
        $chain_hits++
        $dbg_prev2_eip = $dbg_prev_eip;  $dbg_prev_eip = $eip
        $ip = patch_at + sign16(delta)
        return_call $next
  $chain_slow++
  return_call $branch_end_at(patch_at, shift, tag)
```

One guard, one `return_call $next` — **no second dispatch**. Everything
`$branch_end` does per transfer is done here and in the same order: the same
guard OR, the same single `$block_budget` decrement, the same two `dbg_prev`
stores. `$eip` is already set by the terminator handler before either desk is
reached, so a crash log names the same instruction either way.

`$branch_end` is now a three-zero wrapper over `$branch_end_at(patch_at, shift,
tag)`; a terminator that reaches the desk with a non-zero `patch_at` gets its
slot written after `$page_resolve` succeeds, immediately before the budget
decrement.

---

## 3. Invariants

### 3.1 Validity is an epoch, not a flag

There is one global `$chain_epoch` per wasm instance. Every event that can make
a chunk pointer mean something else calls `$chain_bump`, which increments it and
so invalidates **every** slot in the instance at once:

| call site | event |
|---|---|
| `$page_chunk_put` | a chunk goes back on a free list and will be handed to another page |
| `$page_retire_at` | a block is retired (SMC, `invalidate_code_range`) |
| `$page_dir_reset` | the whole directory is thrown away |
| `$page_dir_drop_mode` | one page dir slot is dropped |
| `$sbh_note_candidate` | an address becomes an SBH candidate (§4) |

A single counter rather than per-page generations because a chain crosses pages
(the target block need not live on the source block's page), so a per-page
generation would have to be checked at both ends.

### 3.2 A slot may only point inside its own chunk

`$chain_patch` refuses unless **both** `$t` and `$patch_at` fall inside
`[chunk, chunk + capacity)` for the current page's chunk, where `capacity` is
`$page_chunk_bytes(class)` read from the page descriptor — *not* the nominal
`$PAGE_CHUNK_BYTES`. Chunks are bump-allocated back to back, so a loose bound
would happily accept an address in the next chunk. This one test also rejects a
stream executing out of the emit scratch and a target in the descriptor chunk,
and it is what bounds the delta to 16 signed bits.

### 3.3 The wrap cannot alias

The epoch is 13 bits. Past `$CHAIN_EPOCH_MAX` (0x1FFF) it is parked at **0x2000**
— a value no stored slot can hold, because a slot's epoch field is 13 bits wide
— and `$thread_flush_pending` is set. Chaining is then simply off (every slot
reads stale) until `$thread_arena_flush_if_safe` runs from `$run`'s loop head,
between blocks, clears the arena and restarts the epoch at 1. There is no point
at which an 8192-invalidations-old slot compares equal.

### 3.4 Mutual exclusion with `--block-exec`

The block executor copies threaded streams into descriptor fallback pools. A
delta is relative to the operand word's own address, so a copied stream carries
a delta pointing into the chunk it was copied *from*. `set_block_chain` refuses
while the executor is armed and `set_block_exec` clears the chain flag, so the
two orders behave the same; `test/run.js` rejects the two flags together
outright.

---

## 4. What the fast path deliberately does not repeat

`$branch_end` tests `$eip` against `$sbh_eip_a`/`$sbh_eip_b` (the small-block
helper recognizer in `src/10-helpers.wat`). The chained path does not — that is
two compares on the hottest path in the interpreter for a pattern that is
recognised once.

It is safe because the check moved to patch time from two directions: an SBH
address returns from `$branch_end_at` *before* `$page_resolve`, so no slot is
ever written for one; and `$sbh_note_candidate` calls `$chain_bump` when it
first records an address, so any slot written before recognition is dead.

---

## 5. Debug facilities

`--break`, `--trace`, `--count`, `--watch`, `--trace-at` and `--handler-hist`
all arm `$dbg_any` through `$dbg_recompute`. The chained path tests `$dbg_any`
first, so **chaining is inert whenever any of them is on**.

This matters more than it sounds: the breakpoint test lives at `$run`'s loop
head, and a chained transfer does not go back to `$run`. `$dbg_any` is the only
thing keeping breakpoints working, and `test/test-block-chain.js` proves it the
hard way — it chains a loop's back edge with no breakpoint set, *then* arms a
breakpoint on the already-chained target and checks the run halts there.

It also means the "`--handler-hist` per-handler totals identical between arms"
gate is **structurally guaranteed rather than evidence**: with the histogram
armed, the on arm chains nothing (measured: `hits 0 patches 0`). The gate was
run and is green (121 rows byte-identical, caesar3) and is reported here as what
it is.

---

## 6. Measurements

Box load 2.4-5.7 throughout. Every app number below is a **deterministic
counter**, not a time.

### 6.1 The gate: `$branch_end` entries

`chain:` line, printed in both arms (the off arm's `branchEnd` is the
denominator). `hits` are transfers that never reached the desk at all.

| window | branchEnd off | branchEnd on | reduction | chained% | decodes off/on |
|---|---|---|---|---|---|
| caesar3-loading, 300 batches | 11,597,689 | 3,920,451 | **−66.2%** | 66.19 | 1527 / 1527 |
| rct-gameplay, 6000 batches | 772,991,272 | 298,944,800 | **−61.3%** | 61.32 | 325,433 / 325,433 |
| heroes2, 1400 batches | 13,339,031 | 6,980,531 | **−47.7%** | 47.66 | 17,593 / 17,593 |
| quake2 soft, 2600 batches | 43,193,095 | 22,793,101 | **−47.2%** | 47.22 | 110,112 / 110,112 |
| diablo_shareware worker T1, 2500 batches | 4,274,461 | 2,787,756 | −34.8% | 34.78 | 56,109 / 56,109 |

**≥80% gate: NOT MET on either named window.**

### 6.2 Why: the terminator census

caesar3-loading, every block transfer in the window (15,000,227 of them):

| population | count | share |
|---|---|---|
| chainable (`jmp` + specialised `Jcc`) | 12,667,720 | 84.5% |
| — of those, adjacent fall-through (never reaches any desk) | 3,402,537 | 22.7% |
| — of those, entered `$chain_end` | 8,024,011 | 53.5% |
| — — followed a live slot (`hits`) | 7,677,238 | 51.2% |
| — — took the desk (`slow`: unpatched, stale epoch, wrong tag, guard) | 346,773 | 2.3% |
| not chainable — reached `$branch_end` directly | 3,573,678 | **23.8%** |

The floor is that last row. Its composition on rct-gameplay, from
`--handler-hist --handler-hist-top=400` (the histogram's default 24 rows cannot
answer this question — a block-ending handler can be a large share of the
*transfers* while being far down a per-op histogram, which is why
`--handler-hist-top=N` was added):

| handler | count | spare operand word? |
|---|---|---|
| H45 `$th_block_end` (page seam / 256-instruction cap) | 101,079,563 | no — operand *is* the target eip |
| H41 `$th_ret` | 54,395,598 | n/a — dynamic target, not chainable at all |
| H39 `$th_call_rel` | 50,805,317 | no — operand is the return address |
| H46 `$th_loop` | 29,142,546 | no — operand is the condition code |
| H125 `$th_jmp_ind` | 8,903,230 | n/a — dynamic target |
| H40/H140 `$th_call_ind*` | 4,321,995 | n/a — dynamic target |
| H404/H407 fused `test`/`alu` + `Jcc` | 2,923,153 | no |

So on rct, of the 265M transfers that still reach the desk, ~63M are genuinely
unchainable (dynamic targets) and ~181M are chainable *in principle* but have
nowhere to put the slot.

caesar3's own remainder is the same story in different proportions: 1.83M
`$th_block_end`, ~1.24M `$th_case_chain` (a fold whose target is one of *k*
cases, so a one-slot cache is the wrong shape for it), ~0.5M `ret`/`call`/fused.

### 6.3 The transfer term, in-process

`node tools/bench-loops.js --shapes=nop_chain,jmp_chain --toggle=block_chain`,
9 and 15 interleaved reps, minima, one process. `jmp_chain` runs 8 more block
ends per iteration than `nop_chain` with dispatch count held equal by
construction, so the difference divided by 8 is one transfer.

| | nop_chain | jmp_chain | difference | per transfer |
|---|---|---|---|---|
| chaining off | 74.4 ms | 153.0 ms | 78.6 ms | **9.8 ns** |
| chaining on | 68.3 ms | 96.2 ms | 27.9 ms | **3.5 ns** |

**−64%: the transfer term is more than halved.** The 9.8 ns off-arm figure
independently reproduces the ~9 ns block-transfer cost
`docs/interpreter-dispatch-perf.md` and `tools/bench-loops.js`'s own header
quote.

One trap worth recording: **`nop_chain` is not a null control for this toggle.**
It moved 8.3% (reproducibly, to the tenth of a percent, across two runs) because
its own loop back edge is a conditional branch and therefore chainable. A toggle
that moves the "control" is usually noise; here it is the measurement leaking
into the control, and the subtraction above is unaffected because both shapes
carry exactly one such edge.

### 6.4 Pictures

`tools/png-diff.js`, two budgets each, off vs on at the same budget:

| app | budgets | diff | decodes off/on |
|---|---|---|---|
| caesar3_demo | 300, 400 | 0 / 480,000 px, max delta 0 | 1527 / 1527 both |
| rct | 1000, 1500 | 0 / 307,200 px, max delta 0 | 16,088 and 24,361, equal |
| heroes2_demo | 700, 1400 | 0 / 307,200 px, max delta 0 | 8,367 and 17,593, equal |
| quake2_demo (soft) | 1300, 2600 | 0 / 76,800 px, max delta 0 | 33,288 and 110,112, equal |
| diablo_shareware (2 instances) | 2500 | 0 / 307,200 px, max delta 0 | 56,109 / 56,109 |

**Block decodes are unchanged to the digit in all nine pairs**, and so are
`adjacent`, `ftMissed`, `epochBumps` and (on diablo) the API call count.

A methodology note that cost a measurement here: diablo_shareware was first run
under `--max-seconds` rather than a fixed batch count, and the two arms retired
3,315 and 3,338 batches. The pictures then differed by 6.88% — and the off arm
differed from *itself* by 6.93%. A wall-clock-capped run of a thread-scheduled
app is not an A/B. Fix the batch count, not the duration.

---

## 7. What a ≥80% round would have to do

Everything in §6.2's table needs a slot, and none of those terminators has a
spare word. The shape of the fix is the same for all three of the chainable
ones — append one word to the terminator's emit and address it at `$ip`:

* `$th_block_end` → `[45][chain][eip]`, exactly `$th_jmp`'s shape. Blocked on
  the retirement stamp: `$page_retire_at` overwrites a retired block's first 8
  bytes with H45, and a 12-byte H45 could overrun an 8-byte block (`ret` blocks
  are 8 bytes). Needs a separate handler index for the stamp, which
  `src/07c-block-exec.wat`'s terminator scan also has to learn.
* `$th_call_rel` → `[39][retaddr][target][chain]`.
* `$th_loop` → `[46][cc][target][fall][chain]`.

Estimated ceiling from the census: caesar3 82%, rct ~85%. `ret` and the indirect
forms (63M on rct) stay at the desk in any version of this design — a one-slot
delta cache cannot hold a dynamic target — so 100% is not reachable by
chaining at all, and the honest headroom above ~85% belongs to a different
mechanism (an EIP→pointer L1 in front of `$page_resolve`, which would serve
`ret` too but does not remove the `$branch_end` entry the gate counts).

This round did not attempt any of it: it changes the threaded stream layout in
the decoder, the retirement stamp and the block executor's scanner, and
`src/04-cache.wat`'s chunk/admission code was being edited concurrently.

---

## 8. Tests

`test/test-block-chain.js`, 25 cases, all green. Same method as
`test/test-block-exec.js`: one instance, two code addresses, full architectural
snapshot compared (eight GPRs, EFLAGS via `pushfd`/`pop ebp`, EIP, 256 bytes of
scratch data).

* the flag is off in a fresh instance; both orders of the `--block-exec`
  exclusion
* a counted loop (taken back edge), a forward `jmp`, and an alternating
  fall-through/taken conditional — arms agree, on arm demonstrably chained, off
  arm demonstrably did not
* **SMC**: a loop is run long enough to patch its back edge, its bytes are then
  rewritten *through a real guest `store32` block*, and it is re-run — both arms
  agree, the answer actually changed, and the retirement is shown to have bumped
  the epoch
* **page invalidation**: `invalidate_code_range` over a whole page; the answer
  survives and the epoch moved
* **epoch wrap**: driven past `$CHAIN_EPOCH_MAX`, answer unchanged with the
  epoch parked, a later `run()` restarts it, answer unchanged after the restart
* **breakpoint on a chained target**: chain the edge first, then arm the bp and
  check the run halts at it, and that nothing chained while it was armed

Driving 8192 real page drops for the wrap case costs hundreds of thousands of
compile/run cycles (a page dir slot that is already free costs nothing to drop
and bumps nothing), so the wrap case uses a `test_chain_bump` export that calls
the same `$chain_bump` every real path calls. The paths *to* it are covered by
the two cases above it, not by that export.

Also green after the change: `test-block-exec` (308), `test-stream-fold`,
`test-tree-fold`, `test-worker-wasm-globals` (41 setters), 
`test-x87-pipeline4-fusion`, and `test-x86-ops` (145).

---

## 9. Reading the `chain:` line

```
chain: M  armed yes hits 7677238 slow 346773 branchEnd 3920451 chained% 66.19
          patches 183113 epochBumps 58 epoch 59 adjacent 3402537 ftMissed 3290279
```

Printed in **both** arms (`--block-chain` or `--verbose`), once per wasm
instance, so a worker's counters are never folded into main's.

* `hits` — transfers that followed a live slot and never reached any desk
* `slow` — entries to `$branch_end` that came from a *chainable* terminator.
  This is what tells "not chained yet" apart from "not chainable": a low
  `chained%` with a low `slow` means the desk population is terminators this
  design cannot reach, which is exactly §6.2.
* `branchEnd` — every entry to `$branch_end`, chainable or not. The off arm's
  value is the gate's denominator.
* `adjacent` / `ftMissed` — the third population: a conditional whose
  fall-through block is the next thing in the chunk never reaches either desk
  (`adjacent`), and one whose fall-through is elsewhere does (`ftMissed`). Both
  are identical between arms in every run above, which is a useful cheap check
  that the two arms did the same work.
