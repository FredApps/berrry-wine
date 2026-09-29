# A toyvm-style micro-op tier for the main emulator

Status: design + phase-0 prototype, 2026-09-26. Off by default; nothing ships
from this document until phase 0 says the engine is worth building.

## 1. Why the block executor did not pay, measured in machine code

The H454/H458 block executor (`src/07c-block-exec.wat`, `--block-exec`) was
timed on the quiet box for the first time in September 2026:

| app | executor off → on | native share |
|---|---|---|
| Heroes III gameplay | 13.52 → 13.10 ms/batch (−3%), boot +9%, total user CPU +7% | 97.6% |
| MechWarrior 3 gameplay | 553.8 → 519.1 ms/batch (inside a ~9% null band) | 99.87% |
| MCM race | 2.345 → 2.462 s (+5%) | 95.6% |
| Diablo II to Act I load | 21.99 → 23.01 s (+4.6%) | — |

Coverage was not the problem: 95–99.9% of ops ran natively. So the question is
what each native op costs, and `tools/wasm-native.js --func='$th_block_exec'`
(SpiderMonkey Ion, arm64) answers it directly.

- **The per-op prefix is ~100–120 instructions and 3–4 indirect jumps before
  the kind `br_table` is even reached.** It covers:
  - the handler-hist test;
  - the six descriptor fields stored to frame slots;
  - three 15-arm register `br_table`s (d, `TU_B_SRC0`, a);
  - the lane/width/no-flags/EA decode;
  - the SIB range test.
- **The arm then does real work plus overhead.** Most arms *call*
  `$set_flags_*` (`mov sp` / `bl` / restore around each call), and a writeback
  `br_table` follows.
- **The "registers in wasm locals" are not in registers.** The function is 11 KB
  and 2789 instructions. Ion spilled `r0..r14` to stack slots
  (`ldr w16,[x20,#192..220]`), so every register read is a jump-table jump to a
  stack load.

A threaded handler is ~150 Ion instructions including its dispatch. The
executor removed that dispatch and paid the same amount back in its own
prefix. That is why it measured flat.

toyvm's E1 engine (`tools/toyvm/uop-wasm.js`) pays **11 instructions per
transition** on the same compiler. It has the same one-function `br_table`
shape, but:

- An operand is the vreg's byte address, so `V(k) = load(load(pc + 4k))`: two
  loads, no jump.
- No op makes a call.
- No op writes lazy-flag globals; the optimizer forwarded them.
- The function has a handful of locals, so nothing spills.

toyvm measured the full effect at ns per x86 instruction (V8/SM):

| engine | ns / x86 insn |
|---|---|
| L1 interpreter | 3.71 / 2.82 |
| E1 loop engine | 0.64 / 0.92 |
| straight wasm (not an engine, upper bound) | 0.23 / 0.20 |

**Engine shape and the optimizer passes are the lever, not op coverage.**
(Memories: `project_block_exec_native_cost`, `project_toyvm_uop_tier`.)

## 2. Constraints this design keeps

- **No runtime wasm codegen.** The engine is one fixed function compiled with
  the build. A program is data in linear memory, as with E1.
- **Exactness.** Every exit leaves the machine exactly as the threaded path
  would. That means:
  - guest registers;
  - the five lazy-flag globals, when live;
  - EIP;
  - memory, including SMC retirement.
- **Threads.** Every guest thread is its own wasm instance, and a program bakes
  its instance's `$reg_base`, temps and windows, so each instance has its own
  arena: the main thread uses `$UOP_ARENA`, worker `tid` uses slot `tid-1` of
  `$UOP_THREAD_ARENAS` (15 x 256 KB, paid for by shrinking each
  `$THREAD_CACHE_BASE` partition from 1 MB to 768 KB). `init_thread` points the
  instance at its slot with `$uop_set_arena`, which empties the map. The
  compiler's scratch `$UOP_CSCRATCH` stays shared and is taken with an atomic
  try-lock; a thread that finds it held skips the compile (answer 1, "busy")
  and retries at the head's next hot bump rather than marking it dead.
  `set_uop` and `set_branch_clock` are in `INHERITED_WASM_GLOBALS`, so both
  `--threads` workers and cooperative threads inherit the switch.
- **Fail-soft.** Anything the lowering does not model ends the program with an
  exit to the threaded interpreter at that instruction. That is never a crash
  and never an approximation.

## 3. The engine (E1 shape)

One function, `$uop_run(pc) -> exit code`: a `loop` over one `br_table` on
`i32.load(pc)`.

**Vregs live in memory.**
- **Vregs 0–7 are the guest registers themselves** (`$reg_base` + 4r). Entry
  and exit need no GETR/PUTR, and falling back to threaded code needs no spill.
  This is the main emulator's advantage over toyvm, whose guest registers are
  separate.
- Vregs 8+ are temporaries in a per-thread scratch page.
- An operand word is the vreg's absolute byte address, pre-scaled at lowering
  time, so reading or writing an operand is one load of the operand word plus
  one load or store of the vreg.

**Ops are a small RISC set, all 32-bit, each doing only its own work:**

| family | ops |
|---|---|
| move | `movi`, `mov` |
| ALU | `add sub and or xor` + immediate forms, `shli shri sari`, `mul`, `sx8 sx16 zx8 zx16`, `merge8l merge8h merge16`, `ext8h` |
| branch | compare-and-branch `bcc cc,a,b,w,target` (flag-forwarded cmp/test + jcc) and `bccf` (test one materialized flag bit) |
| memory | `ld{8,16,32}{s,u}` and `st{8,16,32}`, addressed as window-relative `base + (index << s) + disp` |
| guard | `guard w, base, lo, hi, rw, exit` |
| flags | `rec op,a,b,res,shift`: writes the five lazy globals; emitted only on exit paths where flags are live |
| control | `jmp`, `clock n, exit` (one per loop header), `exit eip` |

**Memory: the hoisted range guard (the user's rule).** Guest virtual mappings do
not change between iterations of a loop that makes no calls out of the program.
So translation is proved once per *window*, not once per access:

- **`guard` at the preheader** calls `$g2w_affine_span(lo, hi - lo)`. That
  function already proves a whole span shares one guest→wasm delta (direct
  window, DIB window, or a contiguous sparse run).
  - For a written window, `guard` also tests the code-page bitmap
    (`$code_write_is_code`) for each page in the span.
  - On success it stores `delta` and `[lo, hi)` in window slot `w`. On failure
    it takes `exit`, before any instruction has had an effect.
- **An access** computes the guest address `ga` and then does
  `if (ga - lo) >u (span - size) → slow; else load/store at ga + delta`.
  That is one subtract and one compare: no call, no bitmap, no page-cross test.
- **Choosing `[lo, hi)`.** When the lowering can bound the address range from
  induction variables and a trip count, the guard covers it exactly. When it
  cannot, the guard covers the page the stream *starts* in. The user's
  heuristic is that a fast start means the stream is almost always fast
  throughout.
- **The slow path** re-guards on the page of `ga`. It calls `$g2w_affine_span`
  on that page and refreshes slot `w`; if that fails too, it exits at the
  instruction. So a stream that walks off its first page costs one re-guard per
  page crossed, not per access.

What the window proves, and for how long:

- A window is valid only **within one `$uop_run` call**. Every entry
  re-establishes it, so a mapping change between batches is always seen.
- Nothing inside a program can change a mapping, because calls to APIs are
  exits.
- A decode of new code into a written window by *another* guest thread
  mid-slice is the one gap. x86 requires software serialization for
  cross-modifying code (SDM 8.1.3), so a program relying on it without a lock
  is already undefined there. This is documented rather than guarded.

**Flags.** The lowering starts naive, like toyvm: every flag producer is a
`rec`. Two passes then work on it:

- flag forwarding turns `cmp/test/sub/dec + jcc` into `bcc`;
- flag liveness over the loop deletes every `rec` whose flags die before an
  exit.

Surviving `rec`s sit on exit stubs, so the steady-state loop writes no flag
globals at all.

**Clock.** The threaded path charges `$steps` per block transfer. The program
keeps the same accounting exactly: `clock n` at each loop header subtracts the
iteration's block transfers, and exits with a precise EIP when the budget runs
out.

## 4. The lowering and the passes

Input is the region the H458 machinery already discovers, a loop nest of
decoded blocks. But the lowering reads the *x86 instruction*, not the handler
index, for the reason `tools/toyvm/uop-x86.js` gives: a handler index hides its
operands. The main emulator's decoder already decodes ModRM and SIB; the
lowering calls into that decode rather than copying it.

Passes are ported from `tools/toyvm/uop-opt.js`, first those that toyvm
measured as paying:

1. promote: guest regs stay in their vregs; temps coalesce.
2. constprop + addrfold: `[esi+4]` becomes one address expression.
3. forwardFlags + flagLiveness: `bcc`, dead `rec` removal.
4. guard hoisting: the per-access window checks above.
5. licm: loop-invariant loads (`[esp+0x40]`, a LUT base).
6. clock: one check per header.
7. dce.

Later, if the census says so: inlined call/ret (toyvm's call contexts), and
load forwarding (toyvm measured it as nearly free: `project_toyvm_uop_tier`).

**Where the optimizer runs: in WAT** (`src/07e-uop-compiler.wat`, since
2026-09-27). It started as `lib/uop-compiler.js` behind a synchronous host
import, which was the quickest route to a first measurement, and was ported so
browser workers and every host get it without an RPC and without a host call
per hot head. `$uop_try` (07d) calls `$uop_compile` directly; the compiler
decodes the guest bytes, forms the loop, lowers it and writes the encoded
program into `$UOP_ARENA`. That is data, not code, so the no-codegen rule
holds. Its working memory is the `$UOP_CSCRATCH` region; nothing in it
outlives one compile.

The port was checked word for word against the JS reference before the JS was
deleted: every instruction address of every `test-uop-compiler.js` case under
both clocks, and every head MW3, MCM, D2 and Heroes III compiled on their
benchmark routes, produced identical programs (or the same decline reason).

Exports: `uop_compile(eip)` (what `$uop_try` calls; answers the program, 1
when another thread holds the scratch, or 0), `uop_cstat(k)` (compiled,
declined, instructions, uops, flushes, words), `uop_decline_count(reason)`.

## 5. Phases and the numbers that gate them

**Phase 0: price the engine, not the compiler.** Add the `$uop_run` engine plus
a `bench-loops.js` arm that runs a hand-lowered program for existing shapes
(`lut`, `blk_mix512`, and a Heroes III RLE-run shape) next to the threaded and
block-executor arms, in one process with alternating reps. Hand-lowered means
written the way the optimizer is expected to emit it, so phase 0 is toyvm's
"what is the engine worth on this loop" before any compiler work.
- **Gate:** the uop arm is at least 2x faster than threaded per x86
  instruction on the non-periodic shape (`blk_mix512`).
- **Also:** `wasm-native.js` shows ≤ 20 instructions per transition for a
  register op, with no spills.

**Phase 1: JS lowering + passes on real regions (CLI).** Install on the loops
H458 would install on, and compare final state against threaded code.
- **Correctness gate:** equal registers, flags and memory hash on every
  installed program across the `block-exec-sweep.js` app list.
- **Speed gate:** box A/B with user CPU plus `--slice-split` on Heroes III, MW3,
  MCM and D2, with interleaved reps and a null band.

**Phase 2: move the lowering into WAT; browser and worker coverage.**

**Phase 3: calls.** Inline short leaf calls, so regions stop ending at every
`call`. The H458 census shows `shortChain` and `unsafeOp` as the biggest
decline rows, and MW3's regions are almost all one block because of calls.

## 6. What phase 0 does NOT prove

- A periodic microbench loop predicts every branch. `blk_mix512` exists to
  remove that bias, but the real apps' hot code (Heroes III RLE runs,
  `COMPLEX`/`DIAMOND` classes) is branchier than any synthetic shape.
- The lowering and passes have to reach the hand-lowered program's quality on
  real code. That is phase 1's question, and toyvm's coverage census says it
  is usually the harder one: 117/191 programs never installed.

## 7. Phase 0 results (2026-09-26)

**Engine code (Ion, arm64, `tools/wasm-native.js --func='$uop_run'`).**
`$uop_run` is 2992 bytes of Ion code, against 11 KB for `$th_block_exec`.
- Dispatch costs about 11 instructions: interrupt check, op load, bounds check,
  table load, `br`.
- A register ADD arm is 13 more instructions, including a `pc` spill to the
  frame.
- So a register op costs **~24 instructions and one indirect jump**, against
  ~110 for 07c's prefix alone before its arm even starts.

**Timing** (`node tools/uop-engine-bench.js --bytes=4m --reps=7`, laptop at
load ~5.5, V8). Every rep of every arm had identical registers, CF/ZF/SF/OF,
EIP and destination hash; no guard failed.

| shape | threaded ns/insn | block-exec | uop ns/insn | uop vs threaded |
|---|---|---|---|---|
| `lut` (byte LUT blit) | 12.50 | x0.96 | 3.28 | **x3.81** |
| `ckey` (colour-key diamond) | 12.71 | x0.93 | 3.60 | **x3.53** |
| `h3shadow` (Heroes III `0x471da6`, 16-bit) | 11.97 | x0.96 | 3.19 | **x3.75** |

How to read it:
- **Block-exec is x0.93–0.96 on the same code.** That matches the whole-app
  timings in section 1 and the native-code explanation of them.
- **The uop engine is ~3.7x.** That is in line with toyvm's E1 against its L1,
  as the shape argument predicts.
- **The `folds` arm matched threaded** (not in the table): LUT_RUN did not fire
  on this encoding, so it is not a fold-vs-engine comparison.
- **Re-guards fired once per 4 KB page per stream,** because the windows were
  guarded at their start byte only (the user's "fast start → fast whole" rule),
  and cost nothing measurable.

**Not yet shown:**
- A non-periodic block working set (`blk_mix512`-style).
- Deopt stubs that restore exact flags (here they only exit and never fire).
- Any real lowering. The programs are hand-written at the quality section 4's
  passes must reach: forwarded `cmp/test/dec+jcc`, flags materialized only on
  the exit path, one CLOCK per iteration.

Phase 1 is the question now.

## 8. Games, and the call-free engine (2026-09-27)

**Games** (`node tools/uop-game-ab.js`, each game's own gameplay route, both
arms `--branch-clock`, laptop at load ~2-4). Frames first: every game's final
frame matches off vs uop, or differs by no more than off vs off.

| game | frames | whole-run user CPU | gameplay phase |
|---|---|---|---|
| Heroes III | identical | -7.7% | **-41%** |
| Diablo (shareware) | identical | -6.2% | **-34%** |
| StarCraft | 1.48%, null band 1.43-1.51% | ~-5.5% | -- |
| Warcraft III (menu, software GL) | identical | -3.4% | flat (GL-bound) |
| Warcraft III **gameplay** (`wc3g`, headless GL) | identical | -8.8% | **-20%** (4.4 -> 3.5s); map load -7% |
| Warcraft III gameplay, software GL | identical | -5.7 to -7.5% | 0% and +13% in two concurrent pairs (noise; GL-bound) |
| Heroes II, Diablo demo menu | identical | flat | flat |
| Diablo II | nondeterministic off vs off too | -3.5% | -- |

**The call-free split.** With any call inside the dispatch loop, Ion kept
`$pc` and `$budget` in stack slots: 110 `[x20,#28]` references in the old
`$uop_run`, a store after every op and a reload on the pc chain every op
depends on. The loop called `$uop_reguard` from 16 memory ops plus
`$uop_window_set`, `$get_cf` (x2) and `$eval_cc`. Now `$uop_fast` makes no
call at all and hands any op that needs one back to `$uop_run` (a window
miss, GUARD, SAVECF, GETCF, BCC). A missed op is re-run from scratch after
the re-guard; nothing in it changed before its window check. Result: pc lives
in `w0` with **zero** stack references in the loop, and a register MOV is 7
instructions plus an 8-instruction dispatch.

What it bought is small, and the reason is the finding:
- Microbench: h3shadow -6%, lut -3%, ckey +1%.
- Heroes III, Diablo and StarCraft gameplay: flat against the pre-split
  engine (`--ref-wasm=`), with identical frames.
- A `--cpu-prof` of the Heroes III uop arm shows why. `$uop_fast` is 6.8% of
  self time. The whole enter/re-guard path (`$th_uop_enter`, with
  `$uop_run`/`$uop_reguard`/`$uop_window_set` inlined into it) is 0.6%.
  `$g2w_affine_span` is 0.0%. The x87 handlers (`$th_fpu_mem_ro`,
  `$fpu_exec_mem`, `$th_fpu_reg`, `$fpu_exec_reg`) are ~18%.

So windows that survive across entries (an epoch bumped on every mapping
change and code-page mark, shared across Worker instances) would buy under 1%
of Heroes III. That is not worth a stale-window SMC hole. The remaining lever
is **coverage**: the declines are `no-backedge` and `head-unsupported`, and
Heroes III's hot threaded time is FPU code the tier does not lower.

(Section 9 built those windows anyway. The epoch closes the stale-window hole
within a thread. Building them also found a real SMC hole in store windows.)

**Where that FPU time is, measured (2026-09-28).** It is not on the thread the
tier works on. `--handler-hist` per guest thread over gameplay batches
4100-4300 (`--handler-hist-thread=1,3,2`; the main thread over 4100-5101):

| thread | x87 dispatches | share of that thread's dispatches |
|---|---|---|
| T0 (game) | 585 of 1.19G | 0.00% |
| T1 (start `0x8414a0`) | 66.6M of 141M | **47%** |
| T2, T3 | 0 | 0% |

So the ~18% x87 CPU in the profile is all T1, and "x87 in uops" would be
aimed at the wrong thread. The existing semantic x87 folds (`--x87-fusion`:
pipeline4, island, affine) already reach it. On T1 they cut unfused x87
dispatches from 66.6M to 14.1M (plus 4.2M fused: H449 pipeline4 3.08M and
H451 1.13M). That is **79% of x87 dispatches absorbed**, and T1's total
dispatches fall from 141M to 93M. With `--uop` as well, T1 reads 15.3M raw
and 4.6M fused, so the fold and the tier compose: the tier is on T0, the fold
on T1. The remainder is mostly `$th_fpu_mem_ro` (8.4M).

The fold is **off** for Heroes III: `x87Fusion: true` is set only for
`ut2003_demo` in `lib/apps.js`. Fewer dispatches is not a time win by itself
(on MCM the fold was flat until the x87 file moved to memory; see
`project_x87_fusion_mcm`), so the time A/B is the `fold` / `uopfold` arms of
`tools/uop-game-ab.js`.

**Bench box, 2026-09-28** (x86_64 V8, node 20, Ryzen 9 9950X, 4 vCPU, idle,
serial arms, HEAD 84e79bb4). `gameplay` is the `--slice-split` main-thread
guest slice, so guest-thread (T1) work shows only in user CPU.

| game | frames | uop vs off: gameplay | uop vs off: user CPU | null band (user / gameplay) |
|---|---|---|---|---|
| Heroes III | identical | -52.9% | -5.2% | 1.8% / 3.3% |
| Diablo shareware | identical | -43.2% | -4.1% | 0.2% / 0% |
| Warcraft III, software GL (wc3g)* | identical | -13.0% | -6.0% | 0.3% / 0% |
| StarCraft | nondeterministic (off~off2 differ too) | -5.9% (0.1 s resolution) | -2.3% | 0.9% / 0% |

\*wc3g needs the then-uncommitted Game.dll ordinal-import linking from the
working tree; on bare HEAD, Game.dll's DllMain stops at `KERNEL32.#00001`.

Heroes III x87 fold, same box, frames identical in every pair:
`uopfold` vs `uop` user CPU **-4.3%** (86.58/86.53 s vs 90.46/90.49 s, null
band 0.03%), gameplay slice 0.0%. `fold` vs `off` is -5.3% (null 0.9%). All
of the saving is guest-thread time, as the dispatch counts predicted.

Moorhuhn, same box. These ran on the working tree as of 2026-09-28 morning;
routes are `mh1`/`mh2`/`mhw`/`mh3` in `tools/uop-game-ab.js`, and every final
frame was looked at and shows a live round:

| game | frames | uop vs off: gameplay | uop vs off: user CPU | null band (user) |
|---|---|---|---|---|
| Moorhuhn | nondeterministic (off~off2 1.4%) | -14.3% | -30.0% | 1.2% |
| Moorhuhn 2 | identical | -4.5% (0.1 s resolution) | -14.0% | 0.5% |
| Moorhuhn Winter | nondeterministic (off~off2 17.6%) | -13.2% | -13.9% | 1.1% |
| Moorhuhn 3 | nondeterministic (off~off2 67%) | -25.3% | -32.4% | 0.2-2.5% |

On Moorhuhn 3 the x87 fold (`uopfold` vs `uop`) is inside its 3.5% null band,
so it has no measurable effect, even though an FPU MP3 filter is its hottest
gameplay block.

## 9. Entry cost: chaining measured, windows kept (2026-09-28)

**Chaining** would let a program exit that lands on another installed
program's head jump straight into that program. It was measured before
anything was built, with `uop-game-ab.js --arms=uop` on the gameplay routes
under `--branch-clock`:

| game | enters | exit lands on a live head | same program as the last entry |
|---|---|---|---|
| Heroes III | 7.81M | 2,188 (0.03%) | 83% |
| Diablo | 115.4M | 3,779 (0.003%) | 70% |
| StarCraft | 3.52M | 12,295 (0.36%) | 68% |

Programs exit into threaded code that is not another loop head, so chaining
would remove at most 0.36% of entries. It was not built.

**Where an entry's cost went.** Every entry poisoned all of its windows,
2.1 to 3.7 per entry on average. The first access through each window then
missed and paid `$uop_run` → `$uop_reguard` → `$uop_window_set` →
`$g2w_affine_span`, plus the code-page walk for a written window. These
first touches after poisoning, rather than streams walking off a page, were:

| game | first-touch re-guards | share of all re-guards | per entry |
|---|---|---|---|
| Heroes III | 20.5M | 90% | 2.6 |
| Diablo | 168.8M of 256.6M | 66% | 1.5 |
| StarCraft | 7.9M | 86% | 2.3 |

**Windows now outlive a run.** Header +28 holds the `$UOP_WIN_EPOCH` under
which the windows were last poisoned. The enter op poisons only when the
shared epoch has moved since then. The epoch is bumped atomically, after the
change, in four places:

- `$guest_page_publish_range` or `$guest_page_clear_range`, when a present
  PTE is replaced or removed;
- `$code_page_mark`, when a page first becomes code;
- `$code_note_decode`, when it widens the sparse generated-code span.

Each program now owns its window slots, placed after its code, instead of
all programs sharing one set. Interleaved programs therefore keep their
windows too.

**The SMC hole this closed.** It predates this change:

- The poison loop wrote `rw = 0` into every slot, and nothing ever set it
  back to 1.
- So a re-guard of a *store* window never asked `$code_write_is_code`.
- A program's store into a page holding decoded code therefore went straight
  to memory. It did not retire the blocks it overwrote, and it did not kill
  a program lowered from those bytes.

The fix:

- Slots carry `rw` from compile time. `$uc_encode_write` marks the windows of
  store ops, and poisoning leaves `rw` alone.
- A failed `$uop_window_set` now leaves the slot poisoned instead of at
  span 0. For a 4-byte access, span 0 reads as "hit everything", which
  mattered only while a slot could outlive its run.

**What the fix cost, and the retirement that pays for it.** With `rw`
honoured, StarCraft's head exits went from 283 to about 770K. Four programs
(`0x4b4417`, `0x4c789f`, `0x4b57a1`, `0x4b43f6`) store into pages that hold
decoded code on their first access. Each entry therefore exited at its own
head with zero blocks run: 720K entries that did no work at all. The
poor-retirement check only ran on non-head exits, so these programs were
never retired. It now also runs on a head exit that spent no block. Such an
exit made no progress, so the same `enters >= 256 && blocks < 2*enters`
rule applies to it unchanged. After the change, StarCraft has 2,891 head
exits and 35 programs retired as poor (15 before).

`test-uop-compiler.js` `window-keep` covers all three parts:

- A program proves a store window on a page.
- The page then gets decoded code. The program's next store there must exit,
  so that threaded code invalidates the block. A build without the
  `$code_page_mark` bump fails here with the stale immediate.
- Further stores into that page must get the program retired. It retires
  after 236 head exits, is not entered again, and the threaded store it
  leaves behind still lands.

**Measured** with `uop-game-ab.js --arms=off,off2,uop,refuop`, where `refuop`
is the base build. Load was 9-19, so timings are noisy.

| game | frames off~uop | re-guards base → new | windows kept | gameplay phase uop vs refuop | null band (off2/off) |
|---|---|---|---|---|---|
| Heroes III | IDENTICAL | 22.76M → 5.51M (-76%) | 7,807,899 of 7,808,452 | 15.2s vs 15.4s | 1.2% |
| Diablo | IDENTICAL | 256.6M → 147.3M (-43%) | 115,365,124 of 115,365,490 | 6.3s vs 6.4s | 0.0% |
| StarCraft | 0.94% (off~off2 1.41%) | 8.87M → 2.08M (-77%) | 3,609,198 of 3,689,426 | 1.7s vs 1.6s | 5.6% |

For Heroes III, enters, blocks and installs are identical between the two
builds. Diablo differs by a few installs, and the base build alone varies
by that much from run to run (179, then 177). StarCraft has 7.7% more
enters. Those are programs whose stores now correctly exit partway through
a trip on a code page.

The re-guard counters fall a great deal, but the time saved is inside the
noise: -1.3% on Heroes III gameplay against a 1.2% band, and -0.9% on
Diablo's whole-run user CPU. The per-entry saving is real but small next to
what an entry already costs. It needs the quiet box to price.

**What remains unguarded** is the cross-thread case §3 already documents:
another instance decoding or remapping *during* this instance's run. Between
runs the epoch catches that case too, because the epoch is shared.
## 10. Coverage: what declined scans actually stop on (2026-09-28)

`--uop-census` now also records the instructions that end each declined scan:
kind-9 records, keyed by an opcode signature. `tools/uop-census.js` prints them
as "unsupported instructions in declined scans, by form", weighted by the
threaded block entries at the declined head in the histogram window. Before
this change, the top non-FPU forms were:

| game | top unsupported forms (weight = block entries at head) |
|---|---|
| StarCraft | `mov eax,moffs` 14.5M, `sbb` 8.6M, `push imm8` 7.5M, `call` 6.1M, `setcc` 5.3M, `shr r,cl` 4.3M |
| Diablo | `mov eax,moffs` 67M, `mov al,moffs` 32M, `setcc` 16M, `mov moffs,eax` 12M |

New lowerings in `07e`, all without any call on the fast path:

- **`A0-A3` moffs.** A kind-5 move with a disp32-only memory operand.
- **`rol`/`ror r/m, imm`.** Kind 11, ops 3 and 4.
- **Shift by CL (kind 18).** The flag effect depends on the runtime count, and
  a zero count leaves the flags untouched. The lowering therefore leaves the
  record in the globals (state G): `BNZL` (64, free) skips the flag write on a
  zero count, and `SETSS` (65, free) stores the sign shift. Exits need nothing
  extra.
- **`setcc` (kind 19, cc at R+20).** `$uc_setv` forwards cmp/sub, logic/test
  and inc/dec/add recipes into SLTU/SLT/EQ forms. Every other case
  materializes the record and runs `GETCC` (66), a service op that calls
  `$eval_cc`, so the result is bit-exact with the threaded path.
- **32-bit `sbb` (kind 20).** Covers the ALU `18-1D` forms and group
  `80/81/83 /3`, and writes flag_a/flag_b exactly as the threaded
  `$set_flags_sub(a, b+CF, r)` does. `adc` and the 8/16-bit forms are still
  declined.

Results. hu = `head-unsupported`, nb = `no-backedge`. Each census is one run of
the game's route. The hot-window share is the share of threaded entries the
tier did not take, by verdict.

| game | installs before → after | declines before → after | hot-window verdicts after |
|---|---|---|---|
| StarCraft | 578 → 711 | nb 1111 → 899, hu 248 → 205 | nb 15.4% → 3.9%, hu 6.2% → 1.2%, poor 4.3% → 0.2% |
| Heroes III | 290 → 432 | nb 1370 → 1205, hu 418 → 364 | unchanged (its hot code is x87) |
| Diablo | 249 → 254 | nb 835 → 804, hu 1663 → 1535 | hu 26.1% → 22.1% |

Every targeted form is gone from all three censuses. What still stops a scan
is almost entirely stack and control transfer: `push r`, `call`, `push imm`,
`pop r`, `ret`, `ret imm`, `loop`, `jmp` (as a head). After those come `div`,
`rep movsd`/`rep cmpsb` and `lodsb`. Push, pop and call cover the most
weight, well ahead of everything else. That is the next coverage step:
straight-line stack traffic, and possibly inlining a callee that returns.
The FPU is a separate step.

**Speed (bench box, 2026-09-28).** Candidate = 38144a80 + this section's
lowerings; reference = 38144a80. `uop-game-ab.js --arms=uop,refuop,uop2,refuop2
--ref-wasm`, serial, idle box (load 0.0), mean of two repeats per arm.

| game | frames | user CPU, candidate vs main | gameplay slice | null band (user) |
|---|---|---|---|---|
| StarCraft | nondeterministic (repeats of one build differ 1.2-1.5%) | 19.66 vs 31.46 s, **-37.5%** | 1.2 vs 1.75 s | 0.1% / 0.8% |
| Diablo shareware | identical | 195.5 vs 198.2 s, **-1.35%** | 5.15 vs 5.3 s | 0.4% / 0.5% |
| Heroes III | identical | 80.2 vs 85.0 s, **-5.6%** | 5.65 vs 5.7 s | 1.3% / 0.4% |
| Warcraft III, software GL | identical | 114.1 vs 137.7 s, **-17.2%** | 1.8 vs 2.0 s | 0.1% / 0.1% |

Most of the win is guest-thread time, which the main-thread gameplay slice
does not see: StarCraft's thread 1 runs 340M blocks in the tier against 84M,
and Warcraft III's Miles audio thread 432M against 90M (the moffs forms were
what kept its mixer loop out). Installs rise on every game (StarCraft 344 ->
425, Warcraft III 743 -> 791); StarCraft's `head-unsupported` declines fall
from 841 to 206.

## 11. Remaining bottlenecks (2026-09-28)

§8 and §9 asked whether the tier pays. This section asks the next question:
with the tier and the x87 fold both on by default (89c6890c), where does
gameplay CPU go now, and what should be built next? Every number is from the
gameplay window of a `tools/uop-game-ab.js` route (batches `split..max-1`), not
the whole run.

### 11.1 Method, and a tooling bug that invalidated earlier histograms

- **Box.** The quiet bench box (4 vCPU, load 0-1 throughout), worktree
  `~/prof` at 60a24244, which has the same tree as main 38144a80. Runs were
  serial, one at a time.
- **CPU.** `--cpu-prof-window=SPLIT:END` with `--cpu-window` user CPU. It
  covers the main instance and every cooperative guest-thread instance.
  wasm-function indices were named with `tools/wasm-func-name.js --dump` and
  bucketed by subsystem. **`--slice-split`'s "guest slice" is not the right
  denominator for a threaded game.** On WC3g the main slice is 2.6s of a 26.4s
  window, and the rest is guest threads.
- **Coverage and loads.** `--uop --uop-census --handler-hist-thread=N
  --hist-json --hot-block-dump --batch-stats --decode-stats`. A local
  measurement-only `--input=B:uop-stats` action snapshots the `uop_stats`
  counters of every instance at SPLIT and END. The tier's share of block
  entries is (uop blocks) / (uop blocks + threaded block hits) over the same
  window. None of these patches are committed.
- **The bug: `--handler-hist` turns the tier off on the thread it profiles.**
  `$handler_hist_enabled` raises `$dbg_any`, which raises `$dbg_chain_guard`.
  `$th_uop_enter` (07d) and the `$branch_end_at` fast path both bail on
  `$dbg_chain_guard`. So every histogram window measured the tier-off state,
  including §8's per-thread histograms and any `uop-census.js --hist` coverage
  figure. The box runs here patch the `$th_uop_enter` guard to
  `(i32.and $dbg_chain_guard (i32.eqz $handler_hist_enabled))`. **This belongs
  in main.** Until it lands, a histogram taken with `--uop` silently describes
  a different program.
  **Fixed since:** `$th_uop_enter` now tests `$dbg_tier_guard`, which is
  `$dbg_chain_guard` without the histogram (13-exports.wat
  `$dbg_recompute`). The transfer fast paths still take the desk under
  `--handler-hist`, because `$hot_block_hist_record` runs there; that costs
  time, not coverage. `--break`/`--watch`/`--count`/`--trace-*` still hold
  the tier off. test-uop-compiler `hist-keeps-tier` checks both halves.
- **Uncovered: guest-thread verdicts.** `--uop-census` records from guest
  threads are not in the log. `uop-census.js --thread=N` finds no `[i32 TN]`
  records, so the verdicts for WC3's audio thread below are inferred from its
  disassembly, not observed.
  **Cause, since fixed:** cooperative threads' records were in the log all
  along, tagged `[i32 T<tid>]`; the `uop[thread 0x…]` summary names the
  thread HANDLE, and `--thread=` wants the tid. The summary now prints
  `tid=N`, and `uop-census.js --thread=0xHANDLE` maps through it. `--threads`
  workers now forward their log under `--uop-census` too (they have no exit
  dump, so only live events appear).

### 11.2 Where the time goes, per game

Share of window user CPU, by self time, grouped by subsystem:

| group | H3 | Diablo | SC | MH3 | WC3g |
|---|---|---|---|---|---|
| window user CPU | 12.6s | 45.8s | 14.7s | 6.9s | 26.4s |
| threaded dispatch/handlers | 30.9% | 34.7% | 49.9% | 16.5% | 43.4% |
| uop tier (`$uop_fast`…) | 19.3% | 6.1% | 20.4%¹ | 8.4% | 4.1% |
| x87 (fold + handlers) | 21.3% | ~0 | ~0 | 0.3% | 13.3% |
| wasm other (`$read_thread_word`, `$bx_hot_bump`, paint scans…) | 10% | 26% | 15.1% | — | 16.6% |
| memory translation (`$g2w`/`$gl32`/`$gs32`) | 8.4% | 8.1% | 7.3% | — | 12.4% |
| decode/cache (`$page_*`, `$code_page_test`, decode) | 5.2% | 13.9% | 6.1% | — | 8.3% |
| DirectDraw handler | — | — | — | **60.1%** | — |
| JS (harness canvas + `h.log`) | 4.7% | 7.1% | — | — | — |

¹ SC's uop group is dominated by `$uop_code_write` (14.5%). `$uop_fast`
itself is 5.0%.

Named hot spots (self time unless marked incl):

- **H3.**
  - `$uop_fast` 18.3%.
  - `$th_x87_island` 14.0% incl, pipeline4 3.4% incl, `$th_fpu_mem_ro` 3.7% incl.
  - `$branch_end_at` 7.1% incl.
  - `$read_thread_word` 4.3%, `$g2w` 4.0%.
  - `$decode_block` 3.4% incl, `$invalidate_code_write` 2.0% incl, `$bx_hot_bump` 1.3%.
- **Diablo.**
  - `$win32_dispatch` 27.3% incl, of which `$handle_PeekMessageA` 16.1% incl.
    The paint and non-client scans under `PeekMessageA_fetch` cost:
    `$paint_flag_mine` 6.4% + `$nc_flags_scan` 3.1% +
    `$paint_select_next_dirty` 2.2% + `$paint_drain_native_control_paints` 2.1%
    = **13.8% self**.
  - Block transfer: `$branch_end_at` 6.3% (19.9% incl), `$page_resolve` 3.4%,
    `$page_enter` 3.2%.
  - Stack handlers: `$th_push_r` 3.8%. `$gs32` is 8.0% incl, of which the SMC
    check `$invalidate_code_write` is 5.3% incl, mostly from push/call.
  - `$code_page_test` 3.1%, `$gl32` 2.9%, `$bx_hot_bump` 2.6%.
  - The run makes 424M API calls.
- **SC.**
  - **`$uop_code_write` 14.5%**, reached through `$invalidate_code_range` ←
    `$gs8` ← `$th_store8_ro`. `$invalidate_code_write` is 16.2% incl.
  - The cache counted 6.95M page invalidations in the window, and only 18,301
    of them dropped a block.
  - `$read_thread_word` 7.0%, `$branch_end_at` 6.7% (17.2% incl),
    `$uop_fast` 5.0%, `$bx_hot_bump` 3.0%.
- **MH3.** **`$handle_IDirectDrawSurface_BltFast` 60.1% self** (61.4% incl via
  `$win32_dispatch`). Its SRCCOLORKEY path is a scalar per-pixel loop. It
  branches on bytes-per-pixel inside the loop and recomputes `row*pitch` per
  pixel.
- **WC3g.**
  - `$th_x87_island` 10.1% incl.
  - `$g2w` 4.6%, `$gl32` 3.7%, `$guest_page_translate` 1.2%.
  - `$read_thread_word` 4.8%, `$branch_end_at` 10.5% incl, `$bx_hot_bump` 2.8%.
  - GL is 0.2%.
  - The time is on the Miles audio thread. See the next table.

Tier coverage and the threaded remainder (load-immune counts, window only):

| | tier share of block entries | threaded ops/block | threaded remainder by handler class |
|---|---|---|---|
| H3 main | **77.1%** (81M uop vs 24.1M) | 9.74 | alu/mov 40.9%, mem 39.7%, branch 6.9%, stack/call 5.3% |
| H3 T1 (audio) | 35.2% | — | mem 31.8%, alu 26%, **x87 24.7%** |
| Diablo main | 28.4% (732M threaded entries) | 2.86 | **stack/call/ret 43.4%** (push_r 14.1, pop_r 9.3, call_rel 5.9, call_ind 4.3, ret 4.0, push_i32 3.9, ret_imm 2.0), alu 17.9%, mem 16.9%, branch 16.8% |
| SC main | 36.3% (T0xe1001 adds 37.8M uop blocks) | — | alu 39.3%, mem 27.1%, branch 13.3%, stack 6.6% |
| MH3 main | 66.5% | — | mem 30.5%, stack/call 25.4%, alu 21.9% |
| WC3g main | 47.0% (79.5M vs 89.7M) | 7.46 | alu 40.2%, mem 25.7%, stack/call 16.2% |
| WC3g audio thread (h=0xe1006) | **~5%** (≈3.1M uop vs 60.4M per ⅓ window) | 7.11 | alu 46.3%, mem 31.1%, branch 13.8%, x87 4.1% |

The WC3g audio thread runs **~1.29G threaded dispatches** over the window,
about twice the main thread's 669M. Two blocks make up **54% of its block
entries**: Mss32.dll `0x2113c300`/`0x2113c334`, the Miles resampling mixer
(`mov eax,[moffs]; … imul; add [edi],eax; …; add edx,[moffs]; jnb head`). The
MP3 decoder in mp3dec.dll (`+0x38f6` and neighbours) is most of the rest.

Why the untaken entries were not taken (share of threaded entries, by the
block's verdict as a head):

| | no-backedge | head-unsupported | no-verdict (of which in a shared hot slot) | poor | live |
|---|---|---|---|---|---|
| H3 T0 | 41.5% | 14.2% | 15% | 15% | 10.9% |
| H3 T1 | 74% | — | — | — | — |
| Diablo | 37.6% | 36.0% | 22.1% (13.7%) | 0.1% | 3.9% |
| SC | 25.9% | 9.5% | 31.9% (18%) | 14.7% | — |
| MH3 | 44.4% | — | 39.8% (30.4%) | — | — |
| WC3g main | 31.4% | 10.6% | 12.9% (7.3%) | 0.8% | 0.7% |

Notes on the verdicts:

- **H3's biggest head-unsupported case** is one switch loop,
  `jmp [0x472a9c+ecx*4]` at exe+0x47227c. Its case blocks 0x472266, 0x472283,
  0x47229d and 0x472320 are each 6.17% of threaded entries, about 31% of
  T0's remainder.
- **SC's poor heads.** storm.dll+0x1502508b is poor (5.7%). exe+0x4b43ea and
  0x4b43f6 (4.1% each) are poor only because their stores land on a code page.
- **Diablo's remainder** is short storm.dll functions whose heads are
  `mov eax,[esp+4]`, `push eax` and `ret` (2.2% each). That is call-heavy
  straight-line code with no back edge for the tier to key on.
- **Hot-table churn.** The 512-slot table saw 51.9M (H3), 73.0M (Diablo),
  11.2M (SC), 25.7M (MH3) and 120.6M (WC3g) slot takeovers in the run.

Decode is not a lever any more. Gameplay decodes in the window were:

| game | decodes |
|---|---|
| H3 | 5,033 (93.9% of batches decode-free) |
| Diablo | 858 |
| SC | 1,851 |
| MH3 | 306 |
| WC3g | 34,572 (`$decode_block` 1.3%) |

Batches overwhelmingly stop on "budget spent".

Machine-code sizes (SpiderMonkey Ion, arm64, `tools/wasm-native.js`) that
bear on the ideas below:

| function | instructions | notes |
|---|---|---|
| `$uop_fast` | 1146 | |
| `$th_uop_enter` | 280 | 2 indirect tail calls |
| `$fpu_exec_reg` | 1415 | 10 indirect calls |
| `$fpu_exec_mem` | 594 | |
| `$x87_island_body` | 111 | a compare chain into the two above, per op |
| `$branch_end_at` | 226 | |
| `$bx_hot_bump` | 82 | |
| `$read_thread_word` | 12 | not inlined, 237 call sites |
| `$uop_code_write` | 111 | a linear scan over `$uop_nranges` |
| `$handle_IDirectDrawSurface_BltFast` | 487 | |

### 11.3 Ranked ideas

Saving = measured share × plausible speedup of that share, per game. Shares
are self time unless marked incl.

1. **BltFast colour-key blit: specialise and vectorise.**
   - What: hoist the bytes-per-pixel switch out of the pixel loop, keep row
     pointers, and do the key compare and select with v128 (`i8x16.eq` /
     `v128.bitselect` on 8bpp, `i16x8` on 16bpp).
   - Games: MH3, plus every DirectDraw sprite game that blits with a colour
     key (unmeasured).
   - Share: 60.1% of MH3.
   - Saving: **−45-50% MH3 CPU** (at 4-6x on the blit).
   - Cost/risk: low. One handler, and its output is checkable
     pixel-for-pixel against the scalar path.
   - Evidence: MH3 cpu-prof, `$handle_IDirectDrawSurface_BltFast` 60.1% self.
2. **Stop `$uop_code_write` scanning every uop range on every code-page
   store.**
   - What: gate it on a per-page "has uop range" bit, set at install and
     cleared at flush, or at least on a hull test over all ranges.
   - Games: SC, and any game that writes data on pages it also executes.
   - Share: 14.5% of SC.
   - Saving: **−13-14% SC**.
   - Cost/risk: low. The check must stay conservative, and
     test-uop-compiler's SMC cases cover it.
   - Evidence: SC cpu-prof, `$uop_code_write` ← `$invalidate_code_range` ←
     `$gs8` ← `$th_store8_ro`.
3. **Make PeekMessage's empty-queue path O(1).**
   - What: keep dirty/non-client counts, or a summary bit, so
     `$paint_flag_first`/`any`/`select_next_dirty` and `$nc_flags_scan` do
     not walk MAX_WINDOWS per poll when nothing is pending.
   - Games: Diablo, and every PeekMessage-polling game loop.
   - Share: 13.8% self in Diablo (16.1% incl under `$handle_PeekMessageA`).
   - Saving: **−12% Diablo**.
   - Cost/risk: low-medium. The counters must stay exact, and the paint-order
     tests guard it.
   - Evidence: Diablo cpu-prof.
4. **uop compiler: accept `mov eax,[moffs32]` / `mov [moffs32],eax` (A1/A3).**
   - What: 07e decodes the 88-8B forms but not the moffs encodings, so any
     loop whose body uses them is declined.
   - Games: WC3g. Miles is also used by H3 and others, but not verified
     there.
   - Share: WC3's Miles mixer head `0x2113c300` has one in its second
     instruction and another in its tail. Its two blocks are 54% of the audio
     thread's block entries. The audio thread is ~⅔ of WC3g's threaded
     dispatches, and threaded is 43% of WC3g CPU, so the loop is **≈15% of
     WC3g CPU**.
   - Saving: **−7-10% WC3g** at the tier's 2-3x.
   - Cost/risk: trivial. It is a disp32 memory operand with no base.
   - Evidence: WC3g guest-thread hist (`e07300`/`e07334` = 27.1% each) plus
     disassembly. The verdict itself was not observed (§11.1).
5. **Cheaper x87 island body.**
   - What: `$x87_island_body` dispatches each op through a compare chain into
     `$fpu_exec_mem` (594) or `$fpu_exec_reg` (1415 instructions, 10
     indirect calls). Pre-decode each island op to a direct small handler
     index at fold time, and keep ST(0)/ST(1) in locals across the island.
     Alternatively, give the uop tier an f64 register class for pure x87
     islands inside loops.
   - Games: H3, WC3g, and H3's MP3 thread.
   - Share: H3 `$th_x87_island` 14.0% incl; WC3g 10.1% incl.
   - Saving: **−6-7% H3, −4-5% WC3g** at 2x.
   - Cost/risk: medium. The fold's results must stay bit-exact, which
     test-x86-ops' x87 cases check.
   - Evidence: H3 and WC3g cpu-prof, plus Ion sizes.
   - **Done (2026-09-28, `$x87_island_fast` in 07b):** ST(0), TOP and the two
     tag bytes in locals, one `br_table` per op, write-back once; unmodelled
     forms publish and call `$fpu_exec_*`. No fold-time rewrite, so the
     records and the 07c walkers are unchanged. `--no-x87-island-predecode`
     is the A/B partner; `test/test-x87-island-predecode.js` fuzzes it
     bit-for-bit against the old walk and the unfused handlers. Box2, same
     build, interleaved, frames identical in every pair: **H3 −5.8% user**
     (68.0/68.7s vs 72.9/72.2s; main 73.1/72.6s; null band <1%), **WC3g
     −5.9%** (101.1/101.0s vs 107.9/107.0s; band 0.8%). Island incl time:
     H3 14.0% → 8.5%, WC3g 11.5% → 6.5% (`cpuprof-top.js --incl=x87_island`).
     Ion: 2248 instructions, one 17-way table, 69 direct calls (29 of them
     `$fpu_set_exc` on cold paths) against the old per-op call into
     `$fpu_exec_reg` (1415 insns, 10 indirect calls) / `$fpu_exec_mem`.
6. **Inline `$read_thread_word`.**
   - What: make it a `defmacro`, as dispatch-next is. It is 12 instructions,
     called from 237 sites, and V8 does not inline it.
   - Games: all.
   - Share: H3 4.3%, Diablo 3.5%, SC 7.0%, WC3g 4.8%.
   - Saving: **−2-3.5%** everywhere, taking call overhead as about half of it.
   - Cost/risk: trivial. The body grows, measured at the §8 dispatch-macro
     scale.
   - Evidence: all five cpu-profs.
7. **push/pop/call/ret in the tier, with shallow callee inlining.**
   - What: the lowering §7-§8 deferred. The tier still keys on back edges,
     so on its own this converts loops that call leaves, not Diablo's loopless
     call chains. The Diablo win needs call-inlined traces (a trace head at
     a hot call target).
   - Games: Diablo; also MH3 (stack/call 25% of remainder) and WC3g main
     (16%).
   - Share: Diablo stack/call/ret is 43.4% of threaded dispatches, the
     threaded group is 34.7% of CPU, and 72% of Diablo's entries are untaken.
   - Saving: **−10-20% Diablo** if half the call chains convert; −3-5% MH3
     and WC3g.
   - Cost/risk: high. It needs ESP-relative guest stores under the SMC
     guard, and exact exceptions at every push.
   - Evidence: Diablo census (no-backedge 37.6% + head-unsupported 36.0%,
     storm.dll leaf functions).
8. **Sub-page code-write granularity.**
   - What: split `$code_page_test` into 64-256 B code bits, or a
     per-page "code range" hull, so a data store beside code is not an
     invalidation.
   - Games: SC, Diablo.
   - Share: SC's 6.95M invalidations dropped a block 0.26% of the time, and
     two heads (8.1% of untaken entries) are "poor" only because of
     same-page stores. Diablo's `$invalidate_code_write` is 5.3% incl from
     stack pushes, and `$code_page_test` is 3.1%.
   - Saving: **−2-4% SC** (beyond idea 2, plus un-poored heads); **−3-4%
     Diablo**.
   - Cost/risk: medium. Correctness is central (a missed SMC is silent), and
     `--trace-code-writes` is the check.
   - Evidence: SC and Diablo cpu-prof, SC cache counters, SC census.
   - **Status 2026-09-28 (built, page-granular, not sub-page):** SC's
     storm was not same-page stores at all. The old filter OR'd the page
     bitmap with a *min..max span* over sparse generated code
     (0x7c6d0000..0x7ef81000 on SC), so every store to the data pages
     inside that span (0x7e07x000, writer exe+0x4b43f6) walked. The
     bitmap is now indexed by `(ga>>12 ^ ga>>28) & 0xFFFF` (identity
     below 0x10000000, conservative aliasing above), the span is no
     longer a filter, and `$gs8/16/32/64` test the bit inline and call
     `$code_write_hit` only on a flagged page (so stack stores make no
     call). `--code-write-legacy` restores the span filter for A/B.
     box3, uop arms vs ae31f419, two reps each, user CPU:
     SC −7.0% (null 1.4%; frames differ 1.36% vs the app's own 1.46%),
     walks 7.41M→22-32K with blocks dropped unchanged (~18.2K), misses
     7,546,085→17,822, uop kills 35→15; Diablo −4.8% (null 0.3%,
     frames IDENTICAL), walks 536K→496K; H3 −3.1% (null 0.8%, IDENTICAL),
     walks unchanged, so its win is the inline test alone. Same build
     with `--code-write-legacy` on SC: +8.8% and 7.8M walks again.
     Remaining: Diablo's 473K misses are real same-page stores into code
     page 0x00e60000 — the sub-page case, not built.
9. **Multiway branch in the tier (`jmp [tbl+r*4]`).**
   - What: lower an in-image jump table as a guarded br_table over its
     in-loop targets, and exit on any other target.
   - Games: H3 (other switch loops unmeasured).
   - Share: about 31% of H3 T0's untaken entries, with H3 main already at
     77% coverage, is ≈6% of H3 CPU.
   - Saving: **−3% H3**.
   - Cost/risk: medium. Table bounds are read from guest memory, so there
     is SMC and table-write exposure.
   - Evidence: H3 census, switch loop at exe+0x47227c.
10. **A bigger, or 2-way, hot table.**
    - What: grow the 512-slot table so hot heads stop evicting each other.
    - Games: SC, MH3, Diablo.
    - Share: no-verdict entries in a shared slot are 18% (SC), 30.4% (MH3)
      and 13.7% (Diablo) of untaken entries.
    - Saving: **−1-3%**. Many of those blocks are bodies, not heads, so this
      is an upper bound.
    - Cost/risk: trivial (a region size). Try it first, because it is
      cheapest to price.
    - Evidence: census hot-table lines, with takeovers in the tens of
      millions.
11. **Skip `$bx_hot_bump` for blocks that already have a verdict or an
    installed program.**
    - Games: all five.
    - Share: 1.3-3.0% self.
    - Saving: −1-2%.
    - Cost/risk: trivial.
12. **Headless only: the per-API `log` + `log_api_exit` host calls.**
    - What: two host calls per Win32 call even under `--quiet-api` (88M of
      each in one H3 run). The browser no-ops them, so this is benchmark
      hygiene rather than product speed. `--quiet-api-fast` exists and should
      become what `--quiet-api` does.
    - Share: Diablo `h.log` is 2.3%.

Not recommended:

- **Exit chaining of uop windows.** It takes <0.4% of entries (§9), and
  block chaining priced +1.4% *slower* on the box
  (docs/block-chaining-design.md §11.1). Block transfer
  (`$branch_end_at` + `$page_resolve` + `$page_enter`) is 13% of Diablo self
  time, but that time is paid on call/ret transfers, which idea 7 removes
  and chaining would not.
- **Decode or cache work.** Decode rates are low on every game (the table
  above).
- **String ops, adc, setcc in the tier.** None shows as a measurable share
  of any threaded remainder in these windows.

**Order of work:**

1. Build ideas 1, 2, 3, 4 and 6. Each is a day or less, with a large,
   single-game-proven share.
2. Fix the handler-hist guard (§11.1).
3. Then idea 5.
4. Idea 7 is the large project, and the only one that moves Diablo's
   remaining two thirds.

## 12. Aggressive stack tier: `--aggressive-stack` (opt-in, 2026-09-28)

The exact tier lowers `push`/`pop`/`call`/`ret` to real stores and loads
(`$uc_insn` kinds 21-24). The aggressive tier drops the memory traffic of a
push when its value never needs to be in memory. It is **off by default**.
You turn it on with `--aggressive-stack` (run.js, via
`test/runner-experiments.js`), `aggressiveStack: true` on an app in
`lib/apps.js`, `?aggressive-stack` in the page, or the `aggr` arm of
`tools/uop-game-ab.js`. Worker and cooperative thread instances inherit it
(`set_aggressive_stack` in `lib/worker-imports.js`). The setter flushes
every program, because the choice is made at compile time.

**Mechanism.** `$uc_sp_analyze` runs once per compile, just before
emission. It calls `$uc_sp_block`, which walks each block twice.

- **Pass 1** tracks ESP as an offset from the block's entry. It keeps an
  open list of pushes and matches each pop against the top entry (LIFO,
  with the same slot).
- **Pass 2** marks the pairs that are still elidable. It also marks the
  accesses that are forwarded.

An elided push becomes `MOV temp(20, push address), value`, and its pop
becomes `MOV reg, temp`. ESP still moves by 4 each time, so registers and
flags are exact.

The rules for what happens between an elided push and its pop:

| Access | Result |
|---|---|
| `[esp+d]`, or `[ebp+d]` where EBP comes from a tracked `mov ebp, esp` in the same block, not overlapping the slot | the pair stays elided |
| same address kinds, an exact 32-bit read (`mov`/`alu`/`test`/`cmp`/`imul`/`sbb` source, or a `cmp`/`test` destination) | forwarded: reads the temp |
| same address kinds, a pure 32-bit write (`mov` destination) | forwarded: writes the temp |
| partial overlap, narrower access, or read-modify-write (`add [esp], r`) | that push materializes (it is a real store) |
| any other address (register base other than ESP, EBP unknown, absolute address, index register) | every open push materializes |
| ESP written other than by `add`/`sub esp, imm` | every open push materializes, and tracking restarts |
| `call`/`ret` | every open push materializes, so return addresses are never elided |
| `add esp, imm` released a slot | that push stays materialized (its pop never comes) |

- **Rule 2 (unknown addresses).** The runtime guard, a range check of the
  address against the open slots, is **not built**. An unknown address
  always materializes. The report counts how often it did, so the guard's
  value can be read off: `unknown-addr` below.
- **Escapes.** An escaping `lea r, [esp+d]` needs no rule of its own. The
  only way to reach the slot through `r` is to dereference `r`, and that is
  an unknown address.
- **Exits.** A stub that leaves the program between an elided push and its
  pop first spills the temps to their slots, using the new `SPILL s base
  disp` op (op 67, a service op calling `$gs32`). `$uc_flush_stubs` calls
  `$uc_spill_at` for every exit or deopt stub (kind 0 or 1). The page-seam
  CHK stub is the one that matters in practice.
  `test/test-uop-compiler.js` `sp-seam-spill` has a pair straddling a
  page; with the spill disabled that case fails with wrong `edx`/`ebx`.

**Observable differences from the exact tier.** This is why it is opt-in.

1. **Memory below ESP after a pop.** On real hardware the popped value is
   still at `[esp-4]`. With the pair elided, that slot holds whatever was
   there before. Code that reads below ESP after a pop sees a different
   value. That is legal but rare, and the tracker does not model it,
   because a closed pair leaves the open list.
2. **Other observers during the pair.** While a pair is open, its slot is
   not in guest memory. Nothing inside the block can see this: every
   access is either proven disjoint, forwarded or materialized. What can
   see it:
   - another guest thread reading this thread's stack;
   - a host-side `--watch` or `dump-mem` on the stack;
   - a `--threads` worker sampling it.
3. **Stack faults.** An elided push does not touch its page. A push into
   a guard page, which on Windows grows the stack, does not happen, so
   the fault or the growth happens at the next real access instead.
   Guest stacks here are preallocated, so no app is known to depend on
   this.
4. **Where a spill writes.** The spill happens at the stub, at the exit
   EIP, not at the push's EIP. A memory fault it raises would name the
   wrong instruction. The stack is always mapped, so this is not expected.
5. **What does not change.** Registers, flags, EIP, batch stops (under
   both clocks, checked per batch), and every memory byte the block itself
   can observe. Return addresses are never elided.

**Tests** (`test/test-uop-compiler.js`, the `sp-*` cases). Each case runs
threaded against hot and pre-installed tier runs with the aggressive tier
on, and pins the compile counters.

| Case | Covers | Pinned counters |
|---|---|---|
| `sp-fwd-load` | rule 1, exact read | 2 elided, 2 forwarded reads |
| `sp-nonoverlap` | rule 1 / 3, disjoint locals | 1 elided, rescued past another slot |
| `sp-fwd-store` | rule 3, exact write, then read | 1 forwarded write, 1 forwarded read |
| `sp-partial-rmw` | movzx of a byte of the slot; `add [esp], ecx` | 2 materialized, partial |
| `sp-unknown-escape` | `add ebx,[esi]`; `mov [edi],ebx`; `lea edx,[esp]` + `mov [edx],ecx` | 3 materialized, unknown address |
| `sp-release-espw` | `add esp, 4` releases a slot; `mov esp, edx` | 1 elided, 1 unmatched pop |
| `sp-ebp-frame` | `push ebp; mov ebp, esp; push edi; mov [ebp-4], eax; mov eax, [esp]` in a called function | 2 elided, 1 forwarded write, 1 forwarded read |
| `sp-seam-spill` | a pair across a page seam | 4 spills under the block clock |

All of the exact tier's `push-pop`, `call-*` and `ret-*` cases are also
re-run with the aggressive tier on (`+A`).

**Counters.** `$uop_cstat 6..25` hold the totals over kept programs. The
run.js report prints them as the `uop stack:` line.

| Counter | Meaning |
|---|---|
| `pushes` | pushes seen |
| `matched` | push/pop pairs matched |
| `elided` | pairs elided |
| `plain` | elided pairs with no memory access between; the conservative "any stack access blocks" rule would have elided these |
| `rescued` | elided pairs with some access between (= elided - plain); broken down as `other-slot`, `fwd-read`, `fwd-write` |
| `unknown-addr` … `list-full` | matched pairs that were materialized, by reason |

## 13. Trace heads: `--uop-trace-heads` (opt-in, 2026-09-28)

**What it is.** This is §11.3 idea A. A hot head with no back edge used to
decline as `no-backedge`. With `--uop-trace-heads` (or `?uop-trace-heads`,
or `set_uop_trace_heads(1)`), `$uc_form_loop` instead calls
`$uc_form_trace` (07e). That function works in three steps.

1. **BFS.** It walks the supported successors from the head, up to
   `$uc_trace_max` (160) instructions.
2. **Trim.** It drops every non-branch member whose successor is outside
   the trace, repeating until nothing changes. A trace therefore leaves
   only through a branch, exactly like a loop.
3. **Minimum size.** It keeps the trace only if at least `$uc_trace_min` (8)
   instructions remain.

The trim step is what keeps a trace off `$logical_frame_addr`.

- A fall-through into the marker block ends a threaded block, because
  `$fuse_stop` cuts it there.
- A trace that ran through that seam put the block clock out of step (the
  `trace-logical` case). The same case also showed that the marker is
  always reached threaded.

The remaining pieces:

- `$uc_is_trace` is recorded in the census event, and `tools/uop-census.js`
  prints `(traces: N)`.
- `uop_cstat 26` counts the traces formed.
- `set_uop_trace_limits(min,max)` tunes both limits.

**Enter path.** `$th_uop_enter` also got cheaper.

- The window epoch is read with a plain load instead of an atomic. Only the
  owning thread bumps it.
- The poor check now runs on side exits only once a program has 256 enters
  with fewer than 2 blocks per enter.

SpiderMonkey Ion, before and after:

| | bytes | instructions | `dmb` | `bl` |
|---|---|---|---|---|
| before | 1120 | 280 | 1 | 3 |
| after | 1144 | 286 | 0 | 2 |

`$uop_run`, `$uop_fast` and `$uop_poor_check` did not change.

**Tests.** `test/test-uop-compiler.js` adds five cases:

- `trace-callee`, `trace-main` and `trace-callchain`: call/ret regions with
  a diamond and a `bsr`.
- `trace-logical`: a marker inside the traced path. It checks that every
  iteration counts one logical frame.
- `loop-logical`: a control loop whose exit falls into the marker.

### A/B

Box8, `tools/uop-game-ab.js`, `--jobs=2`, user CPU, interleaved.
Each figure is the mean of two runs.

**Base 40c1c484** (before G/H/code-write/x87-predecode):

| game | off / off2 | uop / uop2 | trace / trace2 | trace vs uop | K=16 trace | frames |
|---|---|---|---|---|---|---|
| sc | 28.10 / 27.97 | 16.75 / 16.98 | 16.36 / 16.59 | **−2.3%** (uop band 1.4%) | 17.83 (+8%) | not assessable: off~off2 differ 1.14% |
| diablo | 129.72 / 129.65 | 119.45 / 118.76 | 112.99 / 113.07 | **−5.1%** (band 0.6%) | 114.95 | identical |
| h3 | 83.16 / 82.34 | 73.36 / 73.06 | 63.53 / 63.80 | **−13.0%** (band 0.4%) | 64.49 | identical |
| wc3g | 148.01 / 148.57 | 108.41 / 109.06 | 101.96 / 100.80 | **−6.8%** (band 1.1%) | 113.54 (+12%) | identical |

**Gameplay phase** (uop → trace):

| game | uop | trace |
|---|---|---|
| sc | 0.9 s | 0.9 s |
| diablo | 4.6 s | 4.3 s |
| h3 | 5.05 s | 3.95 s |
| wc3g | 1.65 s | 1.5 s |

`refuop` (the base wasm) matched `uop` to within 1% everywhere, so the
cheaper enter op on its own is neutral.

**Rebased on eca2b53a** (after G no-bump and H quiet-api):

| game | off / off2 | uop / uop2 | trace / trace2 | trace vs uop | gameplay uop → trace | frames |
|---|---|---|---|---|---|---|
| h3 | 73.80 / 73.16 | 61.93 / 61.58 | 55.75 / 55.00 | **−10.3%** (band 1.4%) | 4.7 → 4.55 s | identical |
| diablo | 117.47 / 117.40 | 102.52 / 101.24 | 98.51 / 98.24 | **−3.4%** (band 1.3%) | 4.1 → 3.9 s | identical |

Most of the whole-run win now lands in boot and loading. After G, H3's
gameplay gain dropped from −22% to −3%.

### Counters

**Declines, uop → trace (base run):**

| game | no-backedge | head-unsupported |
|---|---|---|
| diablo | 892 → 480 | – |
| h3 | 1210 → 595 | – |
| wc3g | 8375 → 1978 | 685 → 1398 |

In WC3g, trace heads now reach more heads that open on a call or ret.

**Installs, kills and flushes, uop → trace:**

| game | installs | kills | flushes |
|---|---|---|---|
| sc | 406 → 867 | 36 → 143 | 1 → 3 |
| diablo | 184 → 3371 | 10 → 2491 | 0 → 13 |
| h3 | 236 → 661 | 29 → 60 | 0 → 2 |
| wc3g | 1126 → 3857 | 67 → 255 | 3 → 14 |

Diablo's kills are mostly arena flushes. Its traces are many and short.

**Game-thread instances**, uop → trace:

| game | installs | enters | blocks |
|---|---|---|---|
| sc | 177 → 1205 | 2.44M → 19.5M | 342M → 410M |
| h3 main | 26 → 927 | 9.8M → 33M | 131M → 190M |

**K sweep.** `--block-exec-walk-k=16` (the `tracek16` arm) is worse than
the default everywhere.

- WC3g: 152,400 installs and 590 flushes. Its gameplay phase is back to the
  off arm's 2.3 s.
- SC: 70 flushes.

A lower threshold compiles cold traces, which thrash the arena. K=4 and K=8
would only be worse, and K=64 was not run.

### Verdict

Trace heads win on every game where frames reproduce, and frames are
identical there. SC is the one exception: its −2.3% sits just above its
1.4% band, and its frames do not reproduce even off vs off2.

The feature stays **opt-in** for now, for three reasons:

- The post-G gameplay gain is small.
- Diablo's arena churn (13 flushes) is a cost the next arena-size change
  could turn around.
- Flipping the default is a one-line change (`$uc_trace` initial value) for
  whoever merges.

The recommended next step is to flip the default once one browser
spot-check agrees.

### Default-on decision (post-g2w-fast, 2026-09-28)

This round re-ran the A/B on main 754d307e, which includes the `$g2w`
fast-path inline. It weighted each run toward gameplay, and it added a
correctness sweep and a browser check.

**Method.**

- Tool: `tools/uop-game-ab.js`. Arms `uop` (tier on, trace heads off) and
  `trace` (`--uop-trace-heads`), 3 reps each, interleaved. Each game ran on
  one quiet bench box, one job at a time.
- The **band** is an arm's own (max−min)/mean over its 3 reps; that is the
  same-build null band.
- `--extend=GAME:N` (new) runs N more batches past the route's end and adds
  a `--slice-split` at that end. The route's own `--slice-split` stays, so
  the phases are:
  - phase 0: boot through the route's split;
  - phase 1: the rest of the route;
  - phase 2: the extension (SC, H3 and Diablo have a separate extension
    phase).

  "Gameplay" is the guest-slice seconds of every phase after phase 0.
  Guest seconds are printed to 0.1 s, so a 1.3 s phase cannot resolve
  anything under 8%.
- **user** is the whole run's user CPU.
- **Frames** compare every arm's final PNG against the `uop` arm's.

| game (box, extension) | user uop (band) | user trace (band) | Δ user | gameplay uop (band) | gameplay trace (band) | Δ gameplay | frames |
|---|---|---|---|---|---|---|---|
| sc (box9, +20000) | 50.46 (0.9%) | 50.59 (2.7%) | +0.3% | 5.57 (1.8%) | 5.77 (3.5%) | **+3.6%** | nondeterministic (uop~uop2 1.8%) |
| h3 (box9, +6000) | 109.91 (2.2%) | 101.49 (1.0%) | **−7.7%** | 29.77 (3.4%) | 28.73 (1.4%) | −3.5% | IDENTICAL |
| diablo (box8, +8000) | 274.52 (1.8%) | 268.58 (7.3%) | −2.2% | 34.93 (2.3%) | 32.90 (9.4%) | −5.8% | IDENTICAL |
| diablo (box9, +8000, 2nd set) | 271.28 (1.7%) | 257.95 (1.5%) | **−4.9%** | 34.57 (3.8%) | 31.90 (6.0%) | −7.7% | IDENTICAL |
| wc3g (box8, +40000) | 170.04 (0.4%) | 161.91 (2.8%) | **−4.8%** | 4.50 (0.0%) | 4.37 (4.6%) | −3.0% | IDENTICAL |
| wc3 menu (box9) | | | −3.2% (bands 0.8/0.5%) | 1.97 | 1.90 | −3.6% | IDENTICAL |
| mh3 (box9) | | | −4.6% (bands 0.6/1.2%) | 2.63 | 2.20 | −16.5% | nondeterministic (uop~uop2 ~68%) |
| mh1 (box1) | 10.71 (0.6%) | 10.17 (0.4%) | **−5.1%** | 1.30 (0.0%) | 1.20 (0.0%) | −7.7% | nondeterministic (uop~uop2 0.9%) |
| mh2 (box1) | 30.68 (0.7%) | 30.79 (6.9%) | +0.4% | 3.53 (2.8%) | 3.60 (8.3%) | +1.9% | IDENTICAL |
| mhw (box1) | 9.87 (0.4%) | 9.38 (1.2%) | **−5.0%** | 1.37 (7.3%) | 1.10 (0.0%) | −19.5% | nondeterministic (uop~uop2 18%) |
| h2 (box1) | 2.15 (0.9%) | 2.02 (2.0%) | **−5.7%** | 0.70 | 0.60 | (too short) | IDENTICAL |
| diablo_demo (box1) | 17.34 (7.4%) | 16.34 (1.3%) | −5.7% | 0.77 (boot) | 0.50 (boot) | (no gameplay phase) | IDENTICAL |
| d2 (box1) | 30.56 (4.6%) | 30.59 (0.9%) | +0.1% | — | — | — | 06-rogue-encampment differs in every arm, uop~uop2 included |

The bold Δ user values are outside both arms' bands. Diablo has two sets
on two boxes. The box8 set has a wide trace band because trace3 was an
outlier at 279.67 s; the box9 set is tight. Its numbers are never compared
across boxes.

**What the table says.**

- Trace heads cost whole-run CPU on no game. Ten of thirteen rows are
  faster, and eight of those by more than both bands. The three that are
  not faster are
  sc (+0.3%), mh2 (+0.4%) and d2 (+0.1%), all inside their bands.
- **SC gameplay is the one out-of-band loss** (+3.6%): uop 5.5–5.6 s,
  trace 5.7–5.9 s. SC frames are nondeterministic headless, even uop vs
  uop2, so it has no frame check. Its census shows 70 code-write kills in
  the trace arm (`0x7c6000de` ×36, `0x7ef60858`/`898` ×13), 3 flushes and
  389 traces.

**Churn (Diablo).** Only the trace arm churns.

| arm | compiles | kills | flushes |
|---|---|---|---|
| trace | 3353 | 2415 | 13 |
| uop | 212 | 14 | 0 |

The `--uop-census` kind-3 records (code-write kills) show why:

- 2364 of the kills fall on 19 heads at `0xc374ec..0xc3764c` (`0xc374ec`
  ×957, `0xc375fc` ×536, `0xc3763c` ×211) and `0x7ec687e8` ×297.
- Every one of those writes lands on the same byte, `0xc376ed`. That is a
  blitter which patches an operand in its own code before each call.
- Each killed trace ran about 60 times before the next write killed it, so
  71.5% of all compiles are recompiles of a head that was just killed.
- This is **boot/menu only**. The unextended run already has 2491 kills,
  and the gameplay extension has 2 decodes in total, so the churn stops
  before gameplay.
- The loop-only tier never compiles those heads at all (no back edge), and
  so it never churns.

**Knob tried: `--uop-cw-dead=N` (not committed).**

- What it does: when a code write kills a program that had run fewer than
  N times, the head also gets a dead mark in the verdict map, so it is not
  compiled again.
- Result on box9 at N=256, 3 reps interleaved with the arms above:
  - It set 14 marks and cut Diablo's churn to 574 compiles, 73 kills and
    1 flush.
  - CPU did not move: user 257.66 s (band 1.0%) vs trace 257.95 s (−0.1%);
    gameplay 31.33 s vs 31.90 s (−1.8%, inside trace's 6.0% band).
  - Frames were identical.
- So the churn is cheap. The recompiles cost less than the noise, and the
  trace arm still wins over uop. The knob was not committed.

**Correctness sweep.**

- Setup: `tools/block-exec-sweep.js --flag=uop-trace-heads
  --stats-flag=branch-clock --budgets=1000,2000 --batch-size=50000
  --control` over 59 apps, on box1.
  - The apps: aoe1, atomic_bomberman_june_demo, blobby_volley, bricks,
    caesar3_demo, calc, captain_claw_demo, cave_story, civ2_mge, cruel,
    darkstone_demo, dx_boids, dx_ddex3, dx_donut, dx_globe, dx_stretch,
    dxball, elasto_mania, fallout_demo, far_manager_170, fourstones,
    freecell, funtris, golf, gta2_demo, heroes2_demo, icewind_dale_demo,
    icy_tower, jardinains, jazz2_demo, little_fighter_2, mirc59, moorhuhn,
    moorhuhn_2, mspaint, nethack_win32, notepad, peaks, pegged,
    pocket_tanks, rct, reversi, scr_architec, scr_geometry, scr_scifi,
    simgolf_demo, ski32, snake, sol, sol16, taipei, tetravex, tictac,
    wep16_chess, winamp, winamp_mod, winmine, winrar_310, worms2_demo.
  - The tier is on in both arms. The only difference between them is
    trace heads.
- Result: **57 IDENTICAL, 1 DIFFERENT, 1 NOPIC, 0 CRASH, 0 NONDET.**
  Many rows formed hundreds of traces: darkstone 483, jardinains 454,
  fallout 316, captain_claw 315.
- **The sweep needs `--branch-clock`.** An earlier pass without it (budgets
  400/800) reported dx_boids, dx_globe, fallout, heroes2 and scr_geometry
  as DIFFERENT. All five were clock artifacts: a tier config changes block
  counts, and the block count is the clock.
- **captain_claw_demo (DIFFERENT)** is not caused by trace heads.
  - Its off-vs-off control is identical, and trace vs trace2 is identical.
  - With the uop tier off (`--no-uop`), the frame also differs from the
    tier-on frame: 1305 px at 100 batches and 4973 px at 1000.
  - The API call count at batch 100 differs between the three
    configurations: 128173 no-uop, 128061 uop, 126866 trace.
  - So the app takes a different path under any change to how its blocks
    are grouped. The difference was there before trace heads, and each
    configuration is deterministic on its own.
  - Repro: `node test/run.js --app=captain_claw_demo --batch-size=50000
    --max-batches=1000 --branch-clock --wall-clock-ms=1789000000000
    --quiet-api --no-close --png=a.png [--no-uop | --uop-trace-heads]`.
- civ2_mge's NOPIC happens in both arms: it has no picture on this box.

**Browser.** On box3, with headless Chrome 152,
`WA_QUERY='?uop-trace-heads' node test/test-diablo-shareware-browser-web.js`
reached all six stages: intro, title, menu, character select, loading and
gameplay. The HUD orbs were present (`red:1641, blue:228`), and the test
printed PASS. The test's new `WA_QUERY` variable appends a query string to
the page URL.

**Verdict: flip the default on.**

- Trace heads lower whole-run CPU on ten of thirteen rows, and on no route
  do they raise it outside the band.
- Every frame that reproduces is identical.
- The 59-app sweep found no trace-specific difference.
- Diablo's churn is real but is limited to boot, and the gameplay phase
  still gains.
- The one cost is SC's gameplay phase, +3.6% just outside its band. That is
  a lead for the next round (its 70 code-write kills and 3 flushes), not a
  reason to hold back gains of 3–8% elsewhere.

The off switches are `--no-uop-trace-heads` and `?no-uop-trace-heads`.
`uop-game-ab.js`'s new `notrace` arm uses the CLI switch.

## 14. Windows and VirtualAlloc contiguity: measured, then widened (2026-09-28)

The question was whether guaranteeing each VirtualAlloc reservation's backing
as one contiguous wasm run (or compacting the pool now and then) would speed
the tier up. `--uop-win-census` (test/runner-win-census.js) counts every
window proof by memory class and failure reason, classifies each re-guard
against its slot's previous window, counts sparse `$g2w_affine_span`
fallbacks, and reads VIRTUAL_MAP_TABLE / VIRTUAL_RESERVE_TABLE at exit. One
run per game on the bench box, `tools/uop-game-ab.js` routes, main instance.

**What it found.** The GUARD op never fires in these games; every window is a
one-page `$uop_reguard`, so non-adjacent backing causes *zero* window
failures or exits. Bulk-path non-adjacent fallbacks: StarCraft 105 of 2.24M,
Warcraft III 5,006 of 5.17M, none elsewhere.

| game | re-guards | per enter | direct / DIB / sparse | in previous window's affine run | only if backing were contiguous |
|---|---|---|---|---|---|
| StarCraft | 3.36M | 1.8 | 55% / 0.03% / 44.5% | direct 87%, sparse 54.7% | 221K (6.6% of all) |
| Heroes III | 13.5M | 2.4 | 56% / 22.5% / 21% | DIB 100%, direct 70%, sparse 16.7% | 0.3% of sparse |
| Moorhuhn 3 | 23.8M | 4.9 | 98.9% / - / 1% | direct 99% | - |
| Diablo | 147M | 1.46 | 5% / - / 95% | sparse 99.98% | 0.007% |
| Warcraft III | 32.4M | 2.0 | 35% / - / 63% | direct 94.6%, sparse 24% | 2.45M (7.6% of all) |

The allocator is not fragmented: every commit is one contiguous extent
(best-fit hole, else bump, else gap scan, then the extension window, then
64KB-granule splits); non-adjacency inside a reservation comes only from
separate commits interleaved with other allocations (StarCraft commits 4KB
~13,700 times; Warcraft III has 64KB reservations committed as sixteen 4KB
records). At exit 61-62% of committed reservations are one affine run, but
the pool is nearly all wilderness: StarCraft 24MB used, 291.8MB largest free
run, no holes; Warcraft III 88.7MB used, 227.2 of 227.3MB free in one run.

So the lever is window width, not contiguity. `$uop_reguard` now widens a
re-guard to the 64KB-aligned block around the missed page
(`$uop_reguard_wide`; `--uop-reguard-span=N` sets the block, 4096 restores
one page): the whole block in one `$g2w_affine_span` plus one 16-bit load of
the code-page bitmap (the block's sixteen slots are one aligned group), else
page-by-page growth that stops at a non-adjacent/unmapped page or, for a
store window, a code page. Every page it covers is proved as
`$uop_window_set` proves one, so the epoch rules are unchanged.
`uop_stats` 14/15 are pages the widening proved and growth stops at a
non-adjacent page.

| game | re-guards one-page -> widened | user CPU widened vs one-page (2 x 2 interleaved, box2) |
|---|---|---|
| Diablo | 147.2M -> 1.46M | -2.1% (null 0.45%); rerun -3.4% (null 2-4%) |
| Moorhuhn 3 | 23.8M -> 5.6M | -1.3% (null 0.9%) |
| Heroes III | 13.5M -> 5.9M | -0.6% (null 1.3%) |
| StarCraft | 3.36M -> 1.36M | +0.3% (null 1.4%) |
| Warcraft III | 32.4M -> 21.5M | 0.0% (null 1.8%) |

Frames identical on Diablo, Heroes III and Warcraft III; StarCraft and
Moorhuhn 3 differ between two runs of the same arm by as much as between
arms. A first version that grew page by page for every re-guard was +1.1%
on Warcraft III and +2.2% on Moorhuhn 3 (87.7M page proofs replacing 23.8M
re-guards); the block fast path is what made it neutral there.

**Verdict on contiguity.** Only after widening does contiguity reach
anything, and then only Warcraft III's growth stops at non-adjacent pages
(8.97M) and StarCraft's (138K). Warcraft III's 34% re-guard cut from
widening moved its CPU by 0.0%, so the smaller cut contiguity could add is
below the null band. A contiguous-commit guarantee is not worth building,
and a compacting defragmenter less so: moving backing at a safe point would
have to cover every holder of a raw wasm address into sparse backing --
uop windows (covered: the move rewrites PTEs, which bumps
`$UOP_WIN_EPOCH`); native shader allocations and the software D3D raster,
which retain wasm pointers (`$w2g_sparse` exists to map them back); GL/DX
client arrays and locked buffers and the audio mixer reading guest PCM
between batches; JS-side typed-array views and cached offsets; the D3DIM
render worker and every guest thread's Worker running concurrently on the
shared memory (no stop-the-world protocol exists, so a main-thread safe
point does not cover them); and in-flight host calls/thread RPCs carrying a
wasm pointer. None of those has a relocation hook today.

## 15. Call forms by runtime weight: no inline-cache ceiling (2026-09-29)

The static census (`tools/call-form-census.js`) said jgl.dll is 48% vtable
calls, Game.dll 11%, H3 3.7%. That is reach. The question for a better
vtable inline cache (vptr guard hoisted out of the loop, call out into
threaded code on a miss instead of exiting, 2-4 entry polymorphic cache) is
how much *execution* sits at those sites, so it was measured by weight:
`test/run.js --handler-hist --handler-hist-thread=0,0,0 --edge-hist
--hist-json=F --hist-json-blocks=0 --uop-census`, read with
`tools/call-form-weighted.js <windows> --exe= --pe-dir= --log=`.
`--edge-hist` (new) records every (previous block, next block) transfer in the
window into the borrowed 1MB handler-pair matrix, which is what counts an
indirect site's distinct targets. The tool decodes each hot block's exit
instruction, splits indirect exits into host API and guest targets (IAT import
DLL, else the edge successor), and weights uop-census verdicts by block entries.
All percentages below are of **all** block entries, threaded plus inside uop
programs. There are three windows per app, and they agree to within 0.1pp
unless a range is shown.

| app (window) | in uop programs | guest-target indirect | of which vtable/reg calls | sites with 2-4 targets | loops declined for call-indirect: head / whole loop body |
|---|---|---|---|---|---|
| SimGolf gameplay (2500..4000, golfers walking) | 74.2% | 0.21% | 0.19% | 0 | 0.04% / 0.41-0.51% |
| WC3 Prologue HUD (19170..21530, wc3g route) | 58.3-60.2% | 0.95-0.98% | 0.61-0.64% | 0.21-0.24% | 0.42-0.49% / 2.9-3.6% |
| Heroes III adventure map (4100..5101, h3 route) | 87.2-89.7% | 0.00-0.01% | 0.00-0.01% | ~0.005% (0x58cd32, 6 targets) | 0.03% / 0.05-0.07% |

Every indirect guest site hot enough to list is monomorphic, apart from a few
exceptions:

- WC3 `game.dll+0x6f203b33 call eax`, 0.06%, 4 targets split 46/23/23/8.
- WC3 `game.dll+0x6f082159 call [edx+0x20]`, 0.03%, 90% one target.
- WC3 `game.dll+0x6f4278fc jmp [abs]`, 0.04%. It hit 61-72 targets because it
  is an import stub, a tail call.
- H3's known `0x58cd32`, 0.01%, 6 targets.

The largest single WC3 guest vtable call is 0.05% of entries.

SimGolf's jgl.dll is 48% vtable calls statically, but only 0.19% of block
entries end at one at runtime. Its hot code is per-pixel loops with no calls
in them.

**Verdict.** None of the three reaches the 3% bar:

- **(a) Guard and hoist.** At most 0.64% of entries (WC3) end at a guest
  vtable or register call. Hoisting helps only the fraction of those that sit
  inside a uop loop.
- **(b) Call-out on a miss.** The loops a call-out would let the tier keep
  are 2.9-3.6% of WC3's entries, measured as the head's SCC in the edge
  graph within +-4KB, which is an upper bound. That is the only
  near-threshold number, and `--uop-icall` already ran WC3g's 40 guarded
  sites (2.64M passes) with a neutral A/B. SimGolf's figure is 0.5% and H3's
  is 0.07%.
- **(c) Polymorphic cache.** It could add at most 0.24% of entries over a
  monomorphic guard.

So indirect calls are not where the threaded remainder lives. By verdict
share of all entries it lives in:

- WC3: blocks that never became a head (no-verdict, 24-26%: call-return
  landings and fallthroughs inside called functions) and `no-backedge`
  (5.5-6.5%).
- SimGolf: one loop the tier cannot enter (below).
- H3: `poor` programs (2.9-3.6%) and `head-unsupported` (1.4-1.7%).

H3's biggest threaded exit is a switch, not a call:
`exe+0x47227c jmp [0x472a9c+ecx*4]` is 1.3% of all entries and always takes
the same arm.

**SimGolf: the gap is `adc r32,[m32]`, not calls.** 79.5% of SimGolf's
*threaded* block entries, which is 20% of all its entries, are one loop:
jgl.dll's scaled colour-key/shadow blitter at `0x100180df..0x1001811a`. Its
step is `add dx,bx` / `adc esi,[0x10062e58]`, a 16.16 fixed-point source
advance. The scan stops at `adc` (form 0x13, `adc r32, r/m32`):

- `0x10018108` declines `no-backedge` behind it, weight 28.5M entries in one
  500-batch window.
- The head `0x100180df` installs a program that exits at `0x10018108` every
  pixel, 1.5 blocks per entry, and is retired `poor`.

Supporting `adc r32,m32` with the carry from an o16 add is the next SimGolf
lever. It lives in the uop compiler, not the call path.

### 15.1 adc/sbb lowered, with memory operands (2026-09-29)

**What lowers now.** Kind 20 used to be sbb only. It is now adc and sbb,
32-bit, in every form the decoder has:

- `11/13/19/1B` r/m forms, with memory on either side;
- `15/1D` eAX,imm;
- `81/83 /2 /3` with a register or memory destination.

8- and 16-bit adc/sbb still decline. The 16-bit `add dx,bx` before the
blitter's adc was already supported, and `$uc_cf_into` has a recipe for its
carry.

**Flags.** The record matches `$do_alu32` and the `th_adc_*`/`th_sbb_*`
handlers bit for bit:

- adc records `set_flags_add(a, b+CF, r)`. When `b+CF` wraps, it uses raw
  mode instead: `flag_op` 8, `flag_a` 1, `flag_b` 0, `flag_res` r. That is a
  different op, so it takes two RECs behind a BNZL/GOTO layout branch.
- sbb records `set_flags_sub` with the `flag_a` 0 / `flag_b` 1 fix-up, done
  arithmetically.

**Store before the record.** A memory destination is now stored *before*
the REC. A store that deopts re-executes the instruction threaded from its
entry state. With CF coming from the globals ('G'), a record that was already
written would hand that re-execution the wrong carry. The old sbb code wrote
the record first, so this was a latent bug.

**Tests.** New `test/test-uop-compiler.js` cases, each checked against the
threaded path:

- `adc-forms`: carry-in 0 and 1, carry-out and OF via jb/jl.
- `adc-sbb-chain`: 64-bit style chains through a memory destination.
- `adc-scale-blit`: SimGolf's `add dx,bx / adc esi,[abs]` step.
- `adc-guard-fail`: an `adc [edi],eax` sweep whose written window runs onto
  the code page. The re-guard refuses it, and the deopt path must leave
  memory, registers and flags identical to the threaded run.

**The record skip, and a Heroes III regression it caused.** The first cut
skipped the kind-20 REC whenever `$uc_live_out` said the flags were dead,
as kinds 18 and 25 already do. That broke Heroes III under `--branch-clock`:

- the uop frame came out 99.97% off the reference;
- the game made a NULL call at batch 3651 (`dbg_prev_eip=0x0059a7b2`) and
  ran only 3652 of 5101 batches.

It was deterministic across uop/uop2. Bisected on box 3:

| variant | H3 frame vs reference |
|---|---|
| adc rejected, sbb still skipping | DIFF, same crash |
| adc accepted, record always written | IDENTICAL, uop counters equal to the reference to the unit |

So the culprit is the *sbb* skip. H3 compiles no program containing an adc:
its counters with adc accepted equal the reference exactly. Some
observer of the globals is not a consumer in `$uc_liveness`, and a 'G'
producer is the only kind whose skipped record nothing re-materializes. It
was not found.

A narrower skip was tried next (ab66e8b3): skip only when the single
successor is an in-loop register alu/test/neg with no branch, seam or cut.
It broke H3 identically, with the same counters to the unit. So even "the
next instruction overwrites every flag and cannot exit first" is observable
somewhere. The kind-20 record is now written **every** time (856774d5). This
is the configuration shown identical to the reference.

**Open:**

- Whatever reads those globals. It is not an exit that `$uc_liveness`
  counts, and not a flag consumer between the sbb and its successor.
- Kinds 18 (shift by CL) and 25 (mul) still skip on `$uc_live_out` and may
  share the gap.

**SimGolf.** Census window 2500..4000, box 3. Counts are load-immune.

| | base e4dddd7d | adc (856774d5) |
|---|---|---|
| uop share of all block entries | 77.05 / 74.23 / 74.32% | **94.30 / 94.60 / 94.65%** |
| threaded block entries per 500 batches | 46.7M / 52.5M / 52.4M | 11.6M / 11.0M / 10.9M |

- The blitter head `jgl+0x100180df` is now a live 31-insn program: 4710 blocks
  per entry, 158.9M blocks in the window.
- `jgl+0x10018108` is live too, at 3117 blocks per entry.
- Before the change, the head was retired poor with an exit at `0x10018108`
  every pixel, and `0x10018108` itself declined no-backedge.
- The largest decline left is `mul8` at `jgl+0x100153ed`: 0.3M entries, or
  0.15%.
- Otherwise the remaining threaded entries are exe call/ret chains, with no
  verdict or declined `no-backedge`.

#### A/B timing (box 3, load ~1, build 856774d5, `tools/uop-game-ab.js --branch-clock --jobs=1`)

Reference arms run the e4dddd7d wasm (`--ref-wasm`), which has no adc
lowering. Each build is run twice (uop/uop2, refuop/refuop2), and that
repeat is the null band.

| game | frames | uop / uop2 user | refuop / refuop2 user | gameplay phase (uop vs ref) |
|---|---|---|---|---|
| sg (SimGolf, split 2500) | IDENTICAL x4 | 20.85 / 21.53s | 23.10 / 23.56s | 1.3 / 1.4s vs 1.9 / 2.0s |
| h3 | IDENTICAL x4 | 54.93 / 54.59s | 55.74 / 55.85s | 4.8 / 4.8s vs 4.9 / 5.0s |
| wc3g, run 1 | IDENTICAL x4 | 100.68 / 96.11s | 93.62 / 93.01s | 1.9 / 1.7s vs 1.7 / 1.6s |
| wc3g, run 2 (arm order reversed) | IDENTICAL x4 | 92.98 / 93.63s | 92.46 / 93.52s | 1.7 / 1.6s vs 1.7 / 1.7s |

- **SimGolf wins.** Whole-run user CPU is **−10.8%**, against a null band of
  about 3% (uop vs uop2) and 2% (ref vs ref2). The 2500..4000 gameplay phase
  goes from about 1.95s to 1.35s. This is the same window where the uop
  share rose from 74–77% to 94.3–94.65%.
- **H3 is neutral.** It moves −1.5%, within the band, and its counters match
  the reference exactly.
- **WC3g is neutral.** Run 1 showed uop +5% slower, but its uop/uop2 pair
  spread 4.6% on its own. The repeat with the arm order reversed came out
  +0.6% whole-run and 0.0% in the gameplay phase. So run 1 was noise. WC3g
  never executes the new lowering in its hot loops; its install counters
  differ by 3 heads (4154 vs 4157).

The lowering is pure coverage and has no flag. It is on whenever the uop tier
is on (`--no-uop` still turns off the whole tier).
