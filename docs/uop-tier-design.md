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
