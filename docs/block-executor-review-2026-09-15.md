# Block executor: design review after round 13 (2026-09-15)

Read-only review of [block-executor-design.md](block-executor-design.md) (rounds
6-13), [hot-loop-vocabulary-2026-09.md](hot-loop-vocabulary-2026-09.md),
[dispatch-attribution-2026-09.md](dispatch-attribution-2026-09.md),
[region-census-2026-09.md](region-census-2026-09.md),
[loop-idiom-superops-design.md](loop-idiom-superops-design.md) §§14-19,
[interpreter-dispatch-perf.md](interpreter-dispatch-perf.md), and the mechanisms
in `src/07c-block-exec.wat` and `src/04-cache.wat`. Nothing was built or run.
The constraint is taken as given: no runtime wasm codegen; every fold is a fixed
build-time handler over decode-time data.

**Verdict in one line:** the executor is the right *mechanism* for multi-block
loops and the wrong *lever* for the corpus; keep it as the region/self-loop fold
it was in round 6, stop developing it as a universal per-block executor, and
spend the next three rounds on levers that have 100% coverage by construction.

## 1. Is the executor the right lever under no-codegen?

No, not as "one generic function for every basic block". Three facts from the
documents, taken together, cap it:

1. **The ceiling is 19-23% times coverage, and coverage is capped by block
   length.** Attribution puts dispatch at 18-19% and accessors at 8-12%
   (dispatch-attribution, side-by-side table). The executor only collects that
   for ops it runs, and the shipped cost model (`$BX_C_ENTRY` 190 /
   `$BX_C_UOP` 16, `src/07c-block-exec.wat:315-318`) breaks even at ~12 native
   micro-ops — measured, §13.5, and correctly so. The corpus's blocks are 3.5
   (caesar3), 4.3 (heroes2) and 7.0 (quake2) ops. So by construction the
   1-block executor sees only the long tail, and the multi-block matcher that
   was meant to fix that reaches 0.05-3.25% of ops (§15.5). Twenty percent of
   three percent is 0.6%. That is not a measurement problem; it is arithmetic.

2. **The single-block microbench win is already gone.** blk16 went +22.0% pre-merge
   → +4.8% post-merge (§13.5) → **+0.4%** paired by round 10 (§15.6); blk32
   +36.2% → +16.0% → +0.9%. Only the region shapes (`region_if2/diamond4/state6`)
   still hold +37-40% (§14.4), and those save *block transfers*, not per-op
   dispatch. The design's own numbers say the per-op residency win evaporated
   as the function grew, and the fix named in §13.7 (split a small 1-block leaf
   off the region loop) was not attempted in rounds 10, 11, 12 or 13.

3. **The executor does not remove indirect branches per op; it rearranges them.**
   interpreter-dispatch-perf's central finding is that the cost is the
   mispredicted `call_indirect`, not the call frame. Read the body loop
   (`07c-block-exec.wat:3855-4045, 4520-4540`): every micro-op pays a 15-way
   `br_table` to read R[d], another to read R[a], a 60-way `br_table` on kind,
   and a 15-way `br_table` to write back — plus SRC0 and SIB-index tables when
   set. Four to six data-dependent indirect jumps per micro-op, all at *one*
   site each (the classic switch-dispatch pattern that direct threading exists
   to avoid). The threaded path pays one `call_indirect` plus at most two
   accessor `br_table`s, and the base-specialised handlers that dominate
   caesar3 (H344/H352, 30% of its ops, §10) pay one. The "22 ns vs 37 ns per
   op" was measured on `bench-loops.js`, which "understates dispatch cost by
   construction" because a periodic loop is perfectly predicted (CLAUDE.md);
   in a 2000-block working set the same shape has nothing to say.

What the executor *is* good for is exactly what H454 was for: a hot loop of
2-16 blocks, entered many times, where one entry amortises the 190 ns and the
saved transfers (`$branch_end` is 17.1% of caesar3's wasm time) are the prize.
Keep that. The rest of this review is about where the other 95% of ops go.

## 2. Why the per-op win does not show at app scale — ranked

**#1 Coverage: the cost model cannot admit the blocks the corpus runs.**
Cause: block length vs a 12-uop breakeven (above). Evidence already in hand:
§13.4 in-region 1.0-1.4% on calc/notepad/caesar3, §15.5 opsMulti 0.05-3.25%,
and the hot-loop study's finding that gameplay is "generic C with
memory-resident induction variables" in 3-5 op blocks (rct 57% in a 2-block
memset, §4b). Cheapest confirming experiment, deterministic: run
`tools/code-region-census.js --reuse` over the thirteen existing hot-block
dumps and bucket dynamic x86 ops by *static instruction count of the block*
(hits × count is what the census already computes). Print the CDF at 4, 8, 12,
16. Kill criterion: if ops in blocks of ≥12 instructions are under 15% of every
gameplay window, the 1-block executor is capped at ~3% app CPU on this corpus
even if its per-op win were fully real, and no further round on it is
justified. Second counter, one line of WAT: sum `$cost` at executor exit
(`nsteps`, already a local) into a global and export it, so the share of x86
instructions retired inside the executor can be printed against the run's
`$steps` consumption — the number §17.3 says does not exist yet.

**#2 The merged executor is too big to be a leaf, so entry costs ~24 dispatches.**
190 ns of entry at ~8 ns per dispatch is the whole per-op saving of a 12-op
block. The function holds ~70 locals, the region block table, seven temp
lanes, the fallback pool and the breakpoint side-exit; V8 tiers and
register-allocates it as one unit, which is what §13.5 measured as a 17-20
point loss on the 1-block shapes and §15.6 as their disappearance. Experiment:
build `$th_block_exec_leaf` — 1 block, `term_kind 5` only, no lanes, no
fallback pool, no region tables, all-eight live-out — and run
`bench-loops.js --shapes=blk4,blk8,blk16 --toggle=block_exec` in-process,
which is the one timing harness on this box with a ±1% floor. Success: blk8
positive and the fitted breakeven ≤6 uops. Deterministic follow-on: recalibrate
`$BX_C_ENTRY` from that fit and re-read installs and the #1 share counter.

**#3 The per-op figure is a branch-predictor artifact.** See §1 item 3.
Experiments, both deterministic: (a) `tools/wasm-native.js
--func='$th_block_exec'` and count indirect-jump / jump-table sites inside the
`$body` loop against `$next` + `$th_add_r_i32` + `$get_reg` + `$set_reg`; (b)
add a `bench-loops.js` shape `blk_mix512` — 512 distinct 8-uop blocks with
varied (kind, d, a) triples cycled in one loop so the pattern history exceeds
the predictor — and A/B it in-process. If blk8's sign flips between `blk8` and
`blk_mix512`, the 22 vs 37 ns is periodicity and the universal executor is
dead on the spot.

Install churn (round 12's resolved +35% CPU loss) is **not** on this list: round
13 took decodes from 4.0x to +9.7-12.3% (§22.4), and decode/compile is ≤1.4%
of guest CPU with the family off (attribution finding 4), so the residual is
≈0.2% CPU. §22.5's second-chunk plan spends a round on that 0.2%.

## 3. Alternatives that fit the constraint and have not been tried

**A. Block chaining for taken branches (highest expected value).** Every taken
`Jcc`/`jmp` goes `$jcc_end` → `$branch_end` (`04-cache.wat:1157`): four global
tests, two `$sbh_eip` compares, `$page_resolve` (page compare + index load +
cover test), a budget decrement, two `dbg_prev` stores, then `return_call
$next`. That is `block/cache`, 8-18% of guest CPU, and it is paid on 100% of
transfers with no discovery, no cost model and no chunk growth. The Jcc op
already carries `fall`/`target` words; add two: the resolved `$ip` of the target
and the target page's generation. `$page_dir_drop` bumps a per-page generation;
the chained path is one load, one compare, budget decrement, `return_call
$next`. Fold `$code16|$yield_flag|$yield_reason|$dbg_any` into one `$edge_slow`
global maintained by their setters so the guard is a single test. Not codegen
— it is the same data patch `$decode_run` already does for fall-throughs.
Counts: `$page_fast` entries per block should fall ≥80% on caesar3/rct;
`page_ft_missed` already exists as the adjacent counter.

**B. Register-specialised handler families at 100% coverage.** Branch
`perf/reg-specialised-handlers` exists (40 handlers, dispatch-identical,
interpreter-dispatch-perf "built, unmeasurable by op count"). It deletes the
accessor `br_table`s from H3/H8/H10/H20/H207 for every block, with no entry
cost. Extend to H344/H345/H352 (`load32/store32_ro_base_*`), which are 30% of
caesar3's ops and the largest remaining `$set_reg` source. This is the 8-12%
accessor lever without the executor. In-process A/B on a `bench-loops.js`
shape toggled by a decoder flag is resolvable; `wasm-native.js` confirms the
table is gone.

**C. Profile-generated whole-block handlers per app, at build time.** The
hot-loop study's negative — "idioms recur within one program, not across the
corpus" — is the argument *for* per-app generated folds and against a shared
vocabulary. RLE_RUN (+7% on Caesar, one app) is the precedent; mechanise it: a
tool reads the app's hot-block dump, emits a WAT handler per top-K block with
the registers as literal `global.get $esi` (no `br_table`s, one dispatch per
block, 8 bytes in the chunk instead of 24 per op), and the decoder matches by
exact byte compare of the block's x86 bytes (SMC-safe through the existing
cover marks). This is a fixed build-time handler over decode-time data — the
constraint as written. Named targets from §4b: rct `0x401875/0x401885` (57.5%
of its gameplay window, invisible to the self-loop matcher), quake2's
`D_DrawSpans8` entry offsets (~17 points), heroes2 `0x4c7xxx` (48% of read
weight). The handler table cap in `$next` (`fn >= 461`) is a constant to
widen. Count criteria are exact: dispatches removed = hits × (ops − 1).

**D. Model `call`/`ret` inside regions.** `termNotModelled` is the top classify
refusal in five of six apps (§14.2), and quake2's decline histogram is 35%
call+ret+push (region-census). A direct `call` to an in-page target is a
push-EIP micro-op plus an interior edge; `ret` is "pop; if it equals the
predicted return address take the edge, else side-exit". Census first: share
of `ret` transfers whose target is a call-site+5 in the same page, from the
existing dumps.

**E. Make the descriptor the only representation — no.** It converts the whole
interpreter to switch dispatch with 4-6 indirect jumps per micro-op (item 3
above), triples code-cache bytes (24 vs 8 per op — the very thing that
overflowed the 16KB chunk in §22), and re-expresses 460 handlers. Only if R3(b)
proves the executor's per-op cost holds under BTB pressure is this even a
question.

**F. Whole-page register allocation** is D under another name: a local lives
exactly one function invocation, so "the page" is a region whose calls and
rets are modelled. There is no other form under no-codegen.

**G. Cache decoded pages across runs — no.** Decode is ≤1.4% of CPU; the
browser's first-decode latency is the only thing it would buy.

**H. `$g2w` restructuring — not a lever.** 2.5-3.3%, half of the memory path is
the access itself. One free line: the fast-path test in
`03-registers.wat:271` is `lt_s wa 0 || ge_u wa end`; since `end` < 2^31 the
unsigned compare alone is sufficient.

## 4. Stop doing

* Whole-app wall-clock or user-CPU A/Bs on this box. Every round from 11 to 13
  reported "unresolvable" (§16.6, §21, §14.4) and then ran another. Only
  in-process `bench-loops.js` A/Bs and counters are quotable here.
* Tuning region discovery: K, thrash slots, reserve sizes, the overflow memo.
  §22.5 says the admission curve "is not monotone ... chasing a chaotic
  system"; believe it.
* The second per-page descriptor chunk (§22.5): a round of memory plumbing for
  ≈0.2% CPU on a family with ≤3% coverage.
* The x87 lever (off, §17.5), the cross-edge carry (a few hundred `rle`,
  §18.3), and further RMW/split widening: each fired everywhere and paid
  nowhere but Heroes II loading.
* Quoting `native%` as progress. It is a share of the executor's own slice; a
  99.98% on a 1% slice is 1%.
* Growing `$th_block_exec`. Every capability added since the merge lowered the
  1-block shapes.

## 5. The next three rounds, with count-measurable criteria

**Round 14 — decide.** Run #1 (block-length CDF over the thirteen dumps; the
in-executor x86-instruction share counter), #3(a) (indirect-branch census by
`wasm-native.js`), build the 1-block leaf and run #2 and #3(b) in-process.
Success = a number for each: reachable share per gameplay window, leaf
breakeven in uops, sign of `blk_mix512`. Kill rule stated in advance: if
reachable share <15% in every gameplay window *or* `blk_mix512` is negative,
the executor is frozen as the region/self-loop fold, default OFF, and no
further executor round is opened.

**Round 15 — block chaining (A) plus the single `$edge_slow` guard.** Criteria:
`$branch_end` slow-path entries per retired block down ≥80% on caesar3 and
rct windows; block decodes unchanged to the digit against the off arm;
`png-diff.js` identical at two budgets per app on quake2/heroes2/rct/caesar3;
`bench-loops.js jmp_chain` shows the transfer term (~9 ns) at least halved
in-process; `--handler-hist` totals identical (equal work). The SMC test
(`test-block-exec.js` already has the pattern) gets a chained-pointer variant.

**Round 16 — generated per-app block handlers (C), with B as the generic
base.** Tool: `tools/gen-block-handlers.js <hot-block-dump> --top=K` emitting a
generated `.wat` part and a byte-pattern table; decoder hook at
`$decode_block` before `$loop_match_block`. First targets: rct's memset pair,
quake2's span bodies, heroes2's RLE blitter. Criteria: dispatches in the rct
gameplay window −50%, quake2-gameplay −20%, heroes2-gameplay −15%
(`--handler-hist`, same batch range, same input script); every other window's
per-handler counts bit-identical; pixels identical at two budgets; the
`test-x86-ops` differential harness extended with one case per generated
handler. B's criterion: dynamic `$get_reg`+`$set_reg` calls (add a counter)
−30% on caesar3.

## Where this disagrees with a documented conclusion, and what settles it

* dispatch-attribution ranks the per-block executor first on the premise that
  ~60% of dispatch is deletable. The executor substitutes 4-6 indirect jumps
  per micro-op for one `call_indirect`; #3(a)/(b) settle whether that premise
  survives a real working set.
* region-census's "BUILD IT" priced regions at 22 ns/uop from a periodic bench;
  the same experiment settles it. Its 2+ block ceiling (23.7% mean) is real for
  caesar3/mw3 only if calls are modelled (D) — the census itself lists call/ret
  as 35% of quake2's declines.
* §22.5 says "the remaining gap is the 16KB chunk". The gap that matters is
  coverage (#1), not decodes; the CDF settles it.
* interpreter-dispatch-perf's "you cannot make a dispatch cheaper, only make
  fewer" is true of `$next` and was never tested on `$branch_end`, which is a
  second per-block cost of the same size on short-block apps; round 15 is that
  test.
