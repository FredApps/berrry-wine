# Block chaining (round 15, alternative A)

`docs/block-executor-review-2026-09-15.md` §3 alternative (A), §5 round 15.

**One line:** when a block ends in a direct jump or a conditional branch, cache
the resolved threaded-code pointer of the edge's target *in the terminator's own
operand word*, so the next transfer over that edge skips `$branch_end`'s guard
chain and `$page_resolve` entirely.

Flag: `--block-chain`, **default OFF**, propagated to worker instances through
`INHERITED_WASM_GLOBALS`. It was mutually exclusive with `--block-exec` through
round 18; **round 19 (§10) removed that** — both flags may now be armed at
once, and the slot holds a chunk-relative offset rather than a self-relative
delta.

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

### 3.2 A slot may only point inside one of its page's two chunks

> Round 19 widened this from "its own chunk" to "either of the loaded page's
> two chunks". The bound, the reason for it and the capacity rule are unchanged.

`$chain_patch` refuses unless **both** `$t` and `$patch_at` fall inside
`[chunk, chunk + capacity)` for one of the current page's two chunks — its
stream chunk or its descriptor chunk — where `capacity` is
`$page_chunk_bytes(class)` read from the page descriptor — *not* the nominal
`$PAGE_CHUNK_BYTES`. Chunks are bump-allocated back to back, so a loose bound
would happily accept an address in the next chunk. This one test also rejects a
stream executing out of the emit scratch, and it is what bounds the offset to
12 bits of dword (§10.1).

### 3.3 The wrap cannot alias

The epoch is 13 bits. Past `$CHAIN_EPOCH_MAX` (0x1FFF) it is parked at **0x2000**
— a value no stored slot can hold, because a slot's epoch field is 13 bits wide
— and `$thread_flush_pending` is set. Chaining is then simply off (every slot
reads stale) until `$thread_arena_flush_if_safe` runs from `$run`'s loop head,
between blocks, clears the arena and restarts the epoch at 1. There is no point
at which an 8192-invalidations-old slot compares equal.

### 3.4 Mutual exclusion with `--block-exec` — REMOVED in round 19

Through round 18: the block executor copies threaded streams into descriptor
fallback pools, a delta is relative to the operand word's own address, so a
copied stream carried a delta pointing into the chunk it was copied *from*.
`set_block_chain` refused while the executor was armed, `set_block_exec`
cleared the chain flag, and `test/run.js` rejected the two flags together.

None of that is true any more. §10 replaces the delta with a chunk-relative
offset plus a chunk selector, so a copied terminator names its own chunk; both
setters are now independent in both orders and both flags on is a supported
configuration.

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

---

## 10. Round 19 — coexistence with the block executor

**One line:** the two flags were mutually exclusive because a chain slot held a
*self-relative* delta and the executor runs a block's terminator from a **copy**
in the page's descriptor chunk; the slot now holds a **chunk-relative offset
plus a one-bit chunk selector**, so a copied terminator names its own chunk and
both flags may be armed together.

**Verdict.** Coexistence is correct, and is *measured* correct: block decodes,
descriptor installs and descriptor entries are identical to the digit between
the `exec` and `both` arms on all four windows, every picture matches the
`exec` arm byte for byte at two budgets on four apps, and `staleRegs` — a slot
followed with the wrong page registers loaded — is **0** everywhere. What
coexistence is *not* is a straight win: on three of the four windows `both`
takes **more** desk trips per retired block than `chain` alone, because the
executor replaces chainable stream edges with descriptor tails that mostly end
in terminators no chain slot can reach. The round's stated gates are therefore
one PASS and two FAILs, reported below rather than re-scoped.

### 10.1 Why the delta could not simply be widened

A page owns two chunks (round 14): a **stream chunk** and a **descriptor
chunk**. They are bump-allocated out of the same ~3.9 MB per-thread arena at
different times and with independent size classes, so the distance between them
is unbounded in principle and routinely far past ±32 KB in practice. A 16-bit
signed self-relative delta cannot express a cross-chunk edge at all.

Widening the delta field was not available either. The narrowest host is the
specialised `Jcc` (H307–H322), whose operand word gives up its low two bits to
the adjacency pair, leaving 30 usable bits — and round 15 already spent all 30
on 13 bits of epoch, 16 of delta and 1 of edge tag.

So the encoding changed shape instead of size, and came out **three bits
cheaper**:

```
bits 26..14  epoch, 1..$CHAIN_EPOCH_MAX; 0 means unpatched
bit  13      chunk: 0 = stream chunk, 1 = descriptor chunk
bits 12..1   the target's DWORD offset inside that chunk, 0..4095
bit  0       edge tag: 0 taken, 1 fall-through
```

12 bits of dword index covers 16 KB, which is `$PAGE_CHUNK_BYTES` exactly, so
the field bounds the largest chunk class by construction rather than by
convention. Every threaded word is 4-byte aligned (`$te`/`$te_raw` are the only
writers and both bump by multiples of 4), which is what makes the two dropped
low bits free.

### 10.2 The hazard the offset introduces, and the test that closes it

An offset is only meaningful against a base, and the base comes from the page
registers `$cur_page_chunk` / `$cur_page_desc`. A chained transfer never calls
`$page_resolve`, so those registers are **not** refreshed and can describe a
different page entirely — a nested synchronous dispatch is enough to do it.
Round 15's delta needed no base and so had no such hazard.

The closing test is *anchor membership*, and it is the same test the patch
guard already performs, done again at read time. `$chain_chunk_of($patch_at)`
asks which of the two chunks the registers currently name contains the operand
word being read. Chunks are disjoint, so a hit **proves** the registers
describe the page that owns the anchor — which is the same page `$chain_patch`
measured the offset against. It also gives the counters their split for free:
selector 1 is a descriptor-chunk anchor, i.e. a block-executor tail.

Two globals carry the capacities, because a base without its real allocated
size is a loose bound: `$cur_page_chunk_cap` and `$cur_page_desc_cap`, both
maintained wherever a base is (`$page_dir_reset`, `$page_dir_drop_mode`,
`$page_create`, `$page_enter`, `$page_publish`, `$page_publish_desc`), both 0
whenever the matching base is 0. A third, cheap check re-tests the decoded
offset against the selected chunk's capacity before the jump, so a slot that
somehow survived is a desk trip and never a wild jump.

### 10.3 Epoch events — enumerated from the code, not from memory

The brief asked for every descriptor-chunk event that can free or move a pool
copy to bump `$chain_epoch`. **No new bump sites were required**, and the
enumeration is why:

| what can happen to a descriptor chunk | how it gets there | bump |
|---|---|---|
| chunk freed to a class free list | `$page_chunk_put` | yes, directly |
| chunk freed late | `$page_chunk_put_if_safe`, `$page_chunk_reclaim_deferred` | via `$page_chunk_put` |
| chunk grown to a bigger class | `$page_publish` / `$page_publish_desc` grow paths | via `$page_chunk_put` on the old chunk |
| both chunks dropped with the page | `$page_dir_drop_mode` | directly, and via `$page_chunk_put` for each chunk |
| page dir slot reused | `$page_index_alloc` eviction → `$page_dir_drop` | via `$page_dir_drop_mode` |
| descriptor retired (SMC, `invalidate_code_range`) | `$page_retire_at` | yes, directly |
| descriptor taken back for a walk | `$bx_raw_want` → `$page_retire_ga` → `$page_retire_at` | yes |
| whole directory thrown away | `$page_dir_reset` | yes |
| an address becomes an SBH candidate | `$sbh_note_candidate` | yes |

Thrash and memo tables (`$bx_memo_note`, the thrash ratchet) were checked and
deliberately *not* added: they are refusal counters that free no bytes and move
no code.

Correctness does not rest on this table being complete, which is the point of
doing it this way round. The anchor-membership test is an independent proof
that the registers name the anchor's own page, so a missed bump degrades to
"followed a slot into a chunk that has not moved" rather than to a wild jump.

### 10.4 The discovery gate, which was the other half of the exclusion

Round 15 also put `$bx_hot_on` in `$chain_end`'s guard set, so "the executor is
armed" meant "nothing chains" even after the encoding was fixed. That guard is
gone; the gate is **performed** on the chained path instead. `$bx_hot_bump`
counts entries into a head and is what triggers a CFG walk, and a transfer that
skips the desk is still an entry — skipping it would silently stop hot heads
from being discovered, and the round would then be measuring a different
executor.

`$chain_hot_ok` does the bump **last**, after every other test has passed, and
re-tests its two side effects: an epoch that moved (something was retired or
freed) or an anchor that changed chunk (the registers moved) sends the transfer
to the desk, where `$page_resolve` hands it the descriptor the walk just
installed. The bump must happen **exactly once per transfer** or the walk
probes land at different entries than they do with chaining off, so
`$chain_hot_bumped` carries the one case where both `$chain_end` and
`$branch_end_at` would otherwise fire. That this is right is not argued: the
`both` and `exec` arms below agree to the digit on decodes, installs and
descriptor entries on all four windows.

### 10.5 A chained edge into an executor-installed target

`$page_resolve` returns the descriptor base for a `$PAGE_INDEX_DESC` entry, and
the descriptor opens with `[BX_HANDLER][rawoff]` written by `$te`. So a chained
edge whose target is executor-installed lands on that stream head, `$next`
performs **one** dispatch into `$th_block_exec`, and nothing re-resolves — the
handler reads `$ip` as its own `$tp`. Confirmed in the code, and the test file's
`leaf loop` case runs it.

### 10.6 Counters

`chain:` grew a second line, printed under `--block-chain` or `--verbose`, once
per wasm instance:

```
chain: M  pool hits 45987 slow 115 patches 5412 tailExits 247893 tailChained% 18.55
          chainableTails 46102 ofChainable% 99.75 poolDesk 201906
          refuseTgt 0 refuseAnc 620566 staleRegs 0
```

* `pool hits` / `slow` / `patches` — the `hits`/`slow`/`patches` populations
  restricted to a **descriptor-chunk anchor**. A threaded op executing out of a
  descriptor chunk can only be an executor tail, so `pool hits` *is* "executor
  exits that chained".
* `tailExits` — every executor exit through a copied terminator
  (`$block_exec_tail_exit_count`, bumped in H458's tail-exit path and in both
  leaves).
* `chainableTails` — the subset of those whose copied terminator is a handler
  that **has** a chain slot: H43 `$th_jmp` and the specialised `Jcc` H307–H322.
  Everything else (`ret`, `call`, the generic `$th_jcc` whose operand word is
  its condition code, `$th_block_end`, `loop`/`jecxz`, an indirect jump)
  reaches the desk with `$patch_at` 0 and cannot be chained by *any* widening
  of the anchor rule. Round 18's `term_kind 10` exists precisely to admit
  blocks ending in the unmodelled terminators, so an executor arm's tails are
  biased towards the unchainable kinds by construction.
* `poolDesk` — the same population counted from the desk side
  (`$branch_end_pool`), and a superset of `pool slow`.
* `refuseTgt` / `refuseAnc` — patches refused because the target, or the
  anchor, was in neither of the loaded page's chunks. `refuseAnc` is large and
  is **not** new: it is the ordinary cross-page transfer, and it is within 1.5%
  of the `chain`-alone arm on every window.
* `staleRegs` — live-looking slots dropped by the §10.2 membership test. **0 on
  every window measured.**

### 10.7 Windows — four arms, fixed batches

`docs/block-executor-design/collect-round19-windows.sh` +
`read-round19.js` (2026-09-15; `/tmp/r19-windows`). Retired blocks are measured,
not assumed: `$block_budget` is spent by an entry to `$branch_end`, a chained
transfer and an adjacent fall-through, so their sum is the block count the run
retired.

| window | arm | desk (`branchEnd`) | retired blocks | desk/block | decodes | installs |
|---|---|---|---|---|---|---|
| caesar3-loading (1400 b) | off | 59,509,040 | 69,920,307 | 0.8511 | 2721 | 0 |
| | chain | 29,739,299 | 69,920,308 | **0.4253** | 2720 | 0 |
| | exec | 59,284,455 | 69,675,911 | 0.8509 | 2717 | 54 |
| | both | 29,718,894 | 69,675,911 | 0.4265 | 2717 | 54 |
| heroes2-gameplay (1400 b) | off | 13,339,031 | 15,653,699 | 0.8521 | 17593 | 0 |
| | chain | 6,980,531 | 15,653,699 | **0.4459** | 17593 | 0 |
| | exec | 13,058,305 | 15,298,489 | 0.8536 | 14825 | 782 |
| | both | 7,594,956 | 15,298,489 | 0.4965 | 14825 | 782 |
| quake2-gameplay (600 b) | off | 10,628,793 | 11,433,956 | 0.9296 | 32494 | 0 |
| | chain | 6,099,178 | 11,433,956 | **0.5334** | 32494 | 0 |
| | exec | 9,584,051 | 10,200,426 | 0.9396 | 32457 | 506 |
| | both | 5,756,907 | 10,200,426 | 0.5644 | 32457 | 506 |
| rct-gameplay (1200 b) | off | 165,052,449 | 226,304,030 | 0.7293 | 17751 | 0 |
| | chain | 103,146,819 | 226,304,030 | 0.4558 | 17751 | 0 |
| | exec | 162,577,276 | 224,639,692 | 0.7237 | 17742 | 103 |
| | both | 101,319,283 | 224,639,692 | **0.4510** | 17742 | 103 |

**Gate 1 — `$branch_end` per retired block, `both` ≤ min(`chain`, `exec`) on
every window: FAIL** (rct PASS, caesar3 +0.3%, quake2 +5.8%, heroes2 +11.3%).

**Gate 2 — block decodes identical between `both` and `exec`: PASS**, and
exactly, on all four windows; installs and descriptor entries match too.

The executor exits:

| window | tails | of which chainable | chained | % of tails | % of chainable |
|---|---|---|---|---|---|
| caesar3-loading | 247,893 | 46,102 | 45,987 | 18.6% | **99.8%** |
| heroes2-gameplay | 300,809 | 261,646 | 255,628 | 85.0% | **97.7%** |
| quake2-gameplay | 104,635 | 13,125 | 11,137 | 10.6% | **84.9%** |
| rct-gameplay | 85,170 | 4,420 | 3,189 | 3.7% | **72.2%** |

**Gate 3 — executor exits chained > 50% of executor exits: FAIL on three of
four** (heroes2 85.0%; caesar3 18.6%, quake2 10.6%, rct 3.7%). Against the only
denominator the mechanism can address it is 72–100%. The gap between the two
columns is the same census result §1 reports for the round as a whole: most
exits leave through a terminator with no spare operand word, and on the
executor that bias is by construction, not by accident.

Why `both` can be worse than `chain` alone on desk trips, which is the round's
real finding: the executor *converts* chainable stream edges into descriptor
tails. A region's internal edges stop reaching a chain slot (good — the
descriptor resolves them for free), but its **exits** mostly land on terminator
kinds chaining cannot reach, and its modelled side exits set `$eip` and go
straight to `$branch_end` with no threaded tail at all. On heroes2 that trade
costs 900k chained transfers to save 281k transfers outright. Desk trips are
not the only currency — that arm also runs 95% of its ops natively — but on
this axis the two optimizations overlap rather than compose.

### 10.8 Pictures

`docs/block-executor-design/check-round19-png.sh`, three arms × two budgets ×
four apps, fixed batches.

**`both` vs `exec`: IDENTICAL, 8 of 8.** `both` vs `chain`: identical 7 of 8;
the exception is rct @1200, which differs by 15,794 of 307,200 pixels — and the
**control** (`chain` vs `exec`, neither arm touching anything this round
changed) differs by *exactly the same* 15,794 pixels with the same max channel
delta of 44. That is the executor reaching a different phase of a clock-paced
animation, which round 18's sweep already characterises; it is not this round.

### 10.9 Microbenchmark

`tools/bench-loops.js`, shape `blk_mix512` (512 distinct blocks, each ending in
a `jmp rel8`, each installed as a one-block descriptor — so every tail is a
copied H43 in the descriptor chunk, which is exactly the anchor this round
added), 7 interleaved reps, minima, one process per pair:

| pair | off arm | on arm | delta |
|---|---|---|---|
| `--toggle=block_chain` (executor off in both) | 45.7 ms | 43.8 ms | **+4.3%** |
| `--toggle=chain_exec` (executor armed in both) | 44.8 ms | 44.3 ms | **+1.2%** |

Chaining is worth about a quarter as much on top of the executor as it is on
its own, which is §10.7's finding priced instead of counted. Region shapes as a
regression check under `--toggle=chain_exec`: `region_blk4_r8` −0.2%,
`region_blk2_r4` +0.1% — both inside the harness's ±1% noise floor.

`chain_exec` is a toggle and not a new shape: `blk_mix512` already *is* "a mixed
working set of executor-installed blocks connected by direct edges", and adding
a byte-identical copy of it under another name would have been a second thing
to keep in step with no second measurement in it.

### 10.10 Tests

`test/test-block-chain.js` grew a `-- chaining and the block executor, both
armed --` section (57 cases total, was 25). Round 15's two mutual-exclusion
assertions are rewritten as their opposite: both flags arm independently, in
both orders. The new cases each run **four arms** of the same bytes at four
addresses in one instance (off / chain / exec / both) and require all four to
agree with the plain interpreter:

* **leaf loop** — a one-block loop installed as H463/H464, so the back edge's
  anchor is the leaf's pool copy. Asserts a leaf actually ran, that the pool
  anchor chained, that the `exec`-alone arm chained nothing, that the
  `chain`-alone arm chained **no pool anchor** (a pool hit with the executor
  off would mean `$chain_chunk_of` misreads a chunk), and that nothing was
  refused or followed with stale registers.
* **general-handler loop** — the same loop with both leaves disarmed, so the
  install goes through H458 and the exit is its `tail_exit` path.
* **multi-block region** — a head, a fall-through body and a join under one
  descriptor. Its internal edges never reach a chain slot, so the assertion is
  on desk trips, not on hits.
* **pool SMC** — a loop installed *and* pool-chained, then rewritten through a
  real guest store. Asserts the pool anchor was chained first (or the case
  proves nothing), that the answer changes and still agrees, that the epoch
  moved, and that nothing was followed into the freed chunk.
* **descriptor retire** — `invalidate_code_range` over the page with both flags
  on, which frees the descriptor chunk and kills every pool anchor at once.

Green on this build: `test-block-chain` 57/57, `test-block-exec` 368/368,
`test-stream-fold`, `test-tree-fold`, `test-worker-wasm-globals` (44 inherited
setters), `test-x87-pipeline4-fusion`, `test-x86-ops` 145/145.

### 10.11 What is still open

* Gates 1 and 3 fail as stated, and §10.7 says why. The mechanism that would
  move either is the one §7 already names — giving `ret`, `call`,
  `$th_block_end` and the generic `$th_jcc` a slot — which needs a stream
  layout change and is a round of its own.
* Nothing here has been measured in worker mode. The new globals are per-run
  counters and one transient flag, so none of them belongs in
  `INHERITED_WASM_GLOBALS`, and the two setters that do were already there.
* No wall-clock app A/B was run. The box sat at loadavg 3–6 throughout, and
  every number above is a deterministic counter, a picture or an in-process
  interleaved microbenchmark minimum.
