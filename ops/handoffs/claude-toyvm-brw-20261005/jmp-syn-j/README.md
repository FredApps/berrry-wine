# Fix J candidate: `jmp_syn` keeps its `$smc` test and drops its budget test

Worker C, 2026-10-05. Root asked for this at 2026-10-05T12:38:20Z.

This is a **private, unapplied candidate**. Nothing in the tracked tree was edited, nothing was
committed or posted, and no emulator, test, build or browser was run (see `checks.txt` for every
command that was run). It does not authorize promotion, a main-runtime change, or a deploy.

- Patch: `jmp-syn-j.patch` (`diff -ruN`, applies at the repo root with `patch -p1`, paths
  `tools/toyvm/...`), against HEAD `2683a6e31d0e95e7ffd1805fcafe013f94f1bcec`.
- **sha256 `7f8a7275d3b8a234e2fc8f1f23930e74426cddc30316fbfaecbb11ab65412239`**
- Six files: `emit.js`, `compile.js`, `region-jit.js`, `uop-ir.js`, `handler-effects.js`,
  `trace-jit.js`. 
- `tree/` is the patched copy and `pristine/` is a HEAD extraction. Each has a `lib` symlink to the
  repo's `lib/`, used only so that `region-jit -> vm.js -> lib/compile-wat.js` resolves on require.
- `checks/inspect.js` and `checks/effects.js` are the pure text checks.

## What changed, per file (line numbers are in `tree/tools/toyvm/`)

### `emit.js`, the interpreter (L1) and every arm that inlines its bodies

- **`:701-744` The comment block and the switch.** The comment explains J and cites the BRW
  evidence: 811 of 7951 IRQs misplaced, the first at 6003001 `from 100:140` against L1's 6003007
  `from 100:14e`, with equal totals and a clean call-target control.
  - `JMP_SYN_BUDGET_TEST` is `process.argv.includes('--jmp-syn-budget-test')` or
    `TOYVM_JMP_SYN_BUDGET_TEST=1`.
  - It is read once at require time, because the handler table is built once per process
    (`prepareTables`/`TABLES_READY`).
  - When the argv form is present, it also sets the env form. A node `worker_threads` region
    worker (`region-prepare.js nodeWorkerBackend`) and child processes inherit env but not this
    argv, so they build the same arm. The browser shim has `argv: [], env: {}`, so the page is
    always J.
- **`:747-753` `CONT_SYN` / `GO_SYN`.** This is GO with the `$steps < 0` term removed:
  - it publishes `$gip`;
  - it takes the resolved arena only when `$smc` is clear;
  - otherwise it calls `$jlook_syn`, and hands back with `EXIT('edge')` on a miss.
  - It keeps the `(if (select (i32.const 0) ARENA ...` shape, so `splitJump`, `splitExit` and
    `resolveGoArena` in `region-jit.js` still parse it.
- **`:754-768` `$jlook_syn`.** It is `$jlook_edge` with `CONT_SYN` in place of `CONT`, and the same
  `$edgelook` switch (`--no-edge-lookup`). It is emitted **only in the J build** (`:5733`), so the
  flagged module text is byte-identical to HEAD.
- **`:891-899` The `jmp_syn` handler.** It still refunds its step, then runs `GO_SYN` (J) or `GO`
  (flag).
- **`:3755` The flag analysis.** `jlook_syn` is event X, the same event as `jlook_edge`.
- **`:6718-6721`** Exports `JMP_SYN_BUDGET_TEST`, which the other files read lazily through
  `require('./emit')`.

**Why it had a budget test:** `jmp_syn` reused `GO`, and `GO`'s `CONT` tests `$smc || $steps < 0`
at every transfer. The step refund (the ADDY_II fix) made the *charge* independent of layout, but
the *test* stayed, and the decode order still decides where a `jmp_syn` sits.

### `compile.js:514-525`, the termination guard (only new behaviour outside the test removal)

Under J, if the straight line that reached an existing head ends at or below its own start
(`cur <= curHead`), the line ends in `end_cut` instead of `jmp_syn`. That can only happen with a
16-bit ip wrap at 0xFFFF. See "Loop termination" below. The flag restores HEAD's `jmp_syn` there.

### `region-jit.js`, region lowering (also covers `tree-fold.js`, which calls `buildRegion`)

- **`:991-996` `GO_RE`.** It also matches GO_SYN's `$smc`-only condition. Without this, an unlowered
  `jmp_syn` (`--no-lower`) would keep the profiling run's stale arena; `checks.txt` shows the live
  `$jlook` substitution working on the new shape.
- **`:1334-1352` `edgeSyn`.** The lowered `jmp_syn` edge tests `$smc || $halt`, not `boundaryTest`.
  This is T4 in the design: region bodies are frozen from the profile-time layout, so a tested
  `jmp_syn` edge there imported that layout's stop points into the install-time run.
  - `$halt` is kept, so an inlined body that handed back still leaves.
  - Under the flag, `edgeSyn` is `edge`.
  - Under `--no-exact-slice` it is also `edge`. That bisector's own `okToLoop` tests the budget at
    the head, and J does not change that bisector.
- **`:1640-1657` The jump lowering.** It uses `edgeSyn` when `op.name === 'jmp_syn'`. Also:
  - A straight region (`closed = false`, which in practice means tree-fold call trees) whose
    **last** op is a `jmp_syn` leaves through the epilogue `leave`.
  - `leave` tested the budget on every exit, so that exit now sets a new local `$syn_out`.
  - `leave` (`:1753-1764`) then skips only the budget half of its test.
  - The local is declared in `locals` (`:1809`) only when used. Every other exit's `leave` text is
    unchanged.
- **Unchanged, deliberately:**
  - `isTransfer` (`jmp_syn` is in `TAKEN_AT`, so it still flushes `pending` before itself, which is
    exact either way).
  - The `--step-audit` weight bump at `:1804`. Weight 0 for `jmp_syn` is the *charge*, which J
    does not touch. `pending` counts the op and `jump.pre` carries the `+1` refund, net 0, exactly as
    before.

### `uop-ir.js:300-333`, the µop tier's slow half (and `uop-only` / `uop-opt` through it)

**Why it tested:** `lower()` treated a straight-line fall-in to an "L1 head" as a budget point. The
set of L1 heads was the program head plus every JMP target. It did this on purpose, because L1's
`jmp_syn` there tested the budget (the bobs.com comment).

Under J:

- **`heads` is `{headKey}` only.** The program head stays a test point for a different reason:
  - `uop-live.js hold()` turns the head block into `jmp_syn 0, head` and clears its jump-table slot.
  - So L1 *hands back* there on every entry, J or not.
  - The host's budget check at that handback is the test this keeps.
- **`p.l1Heads`** (read by `uop-opt.js` deopt stubs, `:313` and `:340`) becomes:
  - `headKey`, plus
  - each JMP target that **no straight line in the body falls into**, because the stub "only
    stands there right after a transfer" holds only for those.
  - The flag restores both sets to HEAD's single set.

### `handler-effects.js:63-68`, `trace-jit.js:1177-1181`

`jlook_syn` is classified exactly like `jlook_edge`: a `transfer` in handler-effects, and "no
register" in trace-jit's call table. `trace-jit.js:1658` (tier 0 repointing a `jmp_syn` at its
fall-through) needs no change. Its tiers inline the `HANDLERS` body text, so they inherit J or the
flag automatically.

### Searched and needing nothing

- `compile.js:1191` `gsCharge` (charge only).
- `uop-baseline-census.js:112` (instruction weights).
- `uop-live.js:326-411` (the hold patch: see the residuals).
- `tree-fold.js` (`ESCAPES` matches `$jlook` as a prefix, and its lowering is `buildRegion`).
- `region-sep.js` (it discovers `$jlook_syn` from the module text like any helper, and `$syn_out`
  is a local, not a global).
- `bundle-browser.js` (it follows the literal `require('./emit')`).
- `uop-wasm.js` `linkl` already does not test the budget on a straight-line link. J brings L1 into
  line with it rather than the other way round.

## Residuals (where J is not exact, or not covered)

1. **An unresolved target still hands back.**
   - If a `jmp_syn`'s arena operand is 0 or patched out and `$jlook_syn` misses, it hands back
     through `$slice_exit`. That happens when the target is not in the jump table (dropped, evicted,
     never compiled, or `--no-edge-lookup`).
   - That handback is an early handback with `$steps >= 0`, but if the budget is already spent at
     that instant, the host sees an ordinary expired slice and delivers due IRQs at the target.
   - The same handback exists in HEAD, so J leaves it as it was.
   - Removing it needs host-side classification, like T5/v2. It is not in this patch.
2. **The µop-held head is intentionally a handback.** This is residual 1 by design: it stays a
   budget point (via the host) in every arm, and `uop-ir` keeps it.
   - If a hold ever left a live jump-table entry for its head, `jmp_syn 0, head` would loop on
     itself *without* a budget test under J.
   - Under HEAD the same case would also loop forever, because the refund keeps `$steps` constant.
     So J adds no new hazard, but it removes no reliance on `hold()` clearing the slot either.
3. **µop deopt stubs at a JMP target reached both by a `jmp` and by a straight-line fall-in.** The
   stub cannot tell which edge it came in on.
   - J leaves such a target out of `l1Heads`, which favours the per-iteration fall-in.
   - Arriving through the real `jmp` with the budget already spent, the slow half then runs one
     block further than L1 before it stops.
   - Not observed. It needs a loop rotated with its `jmp test` *inside* the µop body.
4. **`--no-exact-slice` (region bisector).** It is not converted. It keeps its own head test.
5. **Profiling.** Samples are taken at expired-budget handbacks, and the ones that used to land on
   a `jmp_syn` move to the next real transfer. Region and µop picks can shift. That affects
   performance, not correctness.
6. **The browser bundle.** `docs/dos-corpus/live` inlines `tools/toyvm` verbatim, and
   `tools/build.sh` runs `bundle-browser.js --check`. Landing this patch needs the bundle
   regenerated. That is a build step, and it was not done here.
7. **Docs and tests that describe the old protocol:**
   - `docs/toyvm-region-live.md` "The clock".
   - The `≤ 1 per install` tolerance in `test/test-toyvm-region-live.js` and
     `test/test-toyvm-region-install-clock.js`. That tolerance is stale anyway, per design.md §6.
   - The new regression test from `regression-spec.md`, which is not landed.

## Loop termination

**Claim:** every cycle still contains a real guest transfer that tests the budget, so dropping the
test at `jmp_syn` cannot make a slice unbounded. The overrun past a spent budget stays at most one
straight line plus the blocks reached by `jmp_syn` up to the next real transfer.

Checked against `compile.js`:

- **Where a `jmp_syn` comes from.** It is emitted only at `compile.js:515`, as
  `[jmp_syn, 0, cur]`, when `cur` (the next ip of the straight line being decoded) is an existing
  head.
- **`cur` advances only forward.** It moves by `d.nextIp = wip(start + n)` (decode.js:1154), by
  `dc_stop_ip` (emit-decoder.js:702, `cur += dc_n`), or by `extendThrough`'s `gFall`, which is the
  traced conditional's fall-through, the next ip.
  - Neither decoder follows a `jmp` target inline. The "a `jmp`'s target" wording at
    `compile.js:357` refers to LIFO compile order, not stitching.
- **So every `jmp_syn` targets an address after the start of its own line.** A cycle built from
  straight lines and `jmp_syn` edges alone would need the ip to come back down. That needs either a
  guest backward transfer (a Jcc, `jmp`, `loop`, `call` or `ret`, all through `GO` or the traced
  twin, all still testing `$smc || $steps < 0`) or a hand back (`end`, `end_cut`, `end_smc`, `int`,
  `iret`, which always stop).
- **The claim can fail in exactly one case: 16-bit wrap.** `wip` masks to 0xFFFF, so a straight line
  running off 0xFFFF continues at 0x0000. A segment containing no transfers at all (64 KB of
  non-branch bytes, for example a NOP sled the CPU runs round forever) would then be a cycle with no
  real transfer.
  - In HEAD that still ended, because the `jmp_syn` tested the budget. Under J it would hang the
    wasm call.
  - `compile.js:522` closes this: a line that ends at or below its own start ends in `end_cut`,
    which always hands back.
  - No known program does this. 32-bit code cannot realistically wrap.
- **Regions.** A region loop closing through a lowered `jmp_syn` (`edgeSyn` to the head, then
  `br $again`) is the same graph, so the region cycle also contains a guest backward transfer.
  - That transfer is either lowered with `edge()` (tested), left unlowered (`br $out`), or a `ret`
    (`splitExit`, leaves).
  - The synthetic one-op loop in `checks.txt` (`regionLoop`, a region made of a single `jmp_syn` to
    its own head) does spin without a budget test. `compile.js` cannot produce that shape. It exists
    only to show the edge text.
- **µop programs.** The µop programs' own cycles keep their header `check` and their per-transfer
  `due` tests (`uop-wasm.js:458, 470`). Only straight-line fall-ins lost a test.

## Expected effect on L1 timing

**J changes the plain interpreter's stop points.** HEAD stops a slice at the first `jmp_syn` after
the budget runs out. J runs on to the next real transfer.

- **The charge is unchanged.** `dispatched` for a program that exits before its budget, and the step
  audit, are both untouched.
- **What moves:** every intermediate stop that used to fall on a `jmp_syn`. That moves:
  - IRQ delivery points (`irq ... from cs:ip`),
  - `atStop` dates,
  - the overshoot at a fixed budget,
  - port-write timestamps inside the slice,
  - and so the frames and wavs of time-paced programs.
- **It needs a corpus before/after A/B and a re-baseline**, the same as the unlanded v2 dos-loop
  patch (`toyvm-brw/dos-loop-irq-fix-v2.patch`). One re-baseline for both is design.md's decision
  3 for the reviewer.
- **The intended gain:** the interpreter, the region arms (sep and rebuild), tree-fold and the µop
  arms become layout-independent at `jmp_syn` sites. Installs, drops, precompiles and decode order
  stop moving any arm's stop points there (T1-T4 in design.md).

## How to A/B it later (nothing below was run)

Make two private trees, `HEAD` and `HEAD+J` (`patch -p1 < jmp-syn-j.patch` on a HEAD extraction).
Each needs `lib/` reachable (copy or symlink the repo's `lib`), as in `run-20261005a`.

```sh
S=scratch/claude-toyvm-brw-billing-20261005/run-spec.js
node $S <HEAD-root>   <out>/head                            # expect today's report: A3 811 diffs, first 6003001 vs 6003007
node $S <HEADJ-root>  <out>/j                               # expect A1/A2/A3/A4/A5 PASS, NC1 clean, P4 equal
node $S <HEADJ-root>  <out>/j-old --jmp-syn-budget-test     # must reproduce <out>/head/report.json exactly
```

- `run-spec.js` requires `tools/toyvm` from its root argument in-process, so the flag reaches emit
  through `process.argv`. `TOYVM_JMP_SYN_BUDGET_TEST=1` is equivalent.
- The third run's `report.json` must be field-for-field equal to the first, including the IRQ files.
- Also check that HEAD+J keeps `A1.delta === 0`.

Region-live and install-clock, on HEAD+J with and without the flag (each needs its own process,
because the table is built once):

```sh
node test/test-toyvm-region-live.js                          # J: expect 0 dispatches apart
node test/test-toyvm-region-live.js --jmp-syn-budget-test    # must match HEAD's output
node test/test-toyvm-region-install-clock.js
node test/test-toyvm-region-install-clock.js --jmp-syn-budget-test
```

Then the µop equivalence tests (`test/test-toyvm-uop-*.js`, whichever the tier lists), with and
without the flag. These exercise `uop-ir`'s new head sets, which the text checks here cannot reach.
After that comes the corpus A/B and re-baseline. Last, BRW at 115.06M (design.md §5.2): L1 versus
jit-sepc should no longer split at 8:8c77.

## Not settled without running code

- Whether `uop-ir`'s new `heads` and `l1Heads` keep the µop arms equal to L1 under J. The change is
  argued from source. No µop program was built or run.
- Whether the region and region-sep modules with `$syn_out` validate in wasm. The text was
  inspected, but no `$syn_out` region was compiled. Only tree-fold's straight regions can produce
  it.
- Whether node `worker_threads` see the parent's argv. The patch does not rely on it: it exports the
  env form instead.
- The corpus-wide size of the L1 timing change, and whether any program depended on a `jmp_syn`
  stop (for example, a busy-wait whose only exit is IRQ-driven and whose loop is straight lines
  between heads). The termination argument says every such loop still has a tested transfer. How
  quickly an IRQ lands is what moves.
