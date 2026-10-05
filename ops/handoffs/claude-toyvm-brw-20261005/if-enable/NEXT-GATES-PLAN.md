# IF-enable candidate: existing-test subset, CONT-cost plan, and the remaining `--why` explanation

Source only. Nothing here has run. It is based on the actual candidate files: candidate-v2 ee8265ba
over the pinned stack (base 2683a6e3 + v2v3j 54de1b13 + v4 4b00d26d + smc b3371e21), built by
`build-tree.js` b2d24038.

## 1. Remaining `--why` declines, explained from source (predictions, not runtime-verified)

**Region JIT, "no self-loop region found" on `region_coexist`'s `work` loop:**

- `compile.js` `extendThrough` (about line 203) traces a block-ending conditional, decoding its
  not-taken edge inline as the next words. It does so unless the block wrote memory, the fall-through
  is already a block, or the arena is full.
- `work`'s loop (`add; xor; inc; add; sub; xor; inc; dec cx; jnz w1`) writes no memory, so its `jnz`
  is traced and the routine's `ret` lands in the same block.
- In region-jit.js, `blockOps` cuts a block only at a branch whose fall-through operand points
  elsewhere (`fallArena`, line 906). A traced Jcc has 3 operands, so `fallArena` returns null and
  there is no cut.
- So the loop block's last op is `ret`, and the walk rejects it: "ret with no inlined call to return
  to" (line 354). That reject appears among the first 8 `--why` lines of every case.
- **Predicted fix, in the fixture rather than the candidate:** one memory store in `work`'s loop body,
  e.g. `mov [0x400],ax` (A3 00 04). DS = CS for a .COM, so this is linear 0x1400, past the program's
  code. `extendThrough` then refuses to trace (the block "wrote memory"), the `jnz` keeps its
  fall-through operand, and the walk can close on the taken edge back to the head.
- **Not established:** that the region then installs. Other rejects (`int_imm`, etc.) concern other
  blocks, and the gate/share checks still apply. A run with `--why` would say.

**Tree-fold, 0 folds:**

- run-dos.js `treeFold.warmFor` defaults to **10M dispatches** (`--tree-fold-warm`, about line 1236).
  The fold installs only when its profile window closes.
- Every fixture program exits after about 4.2–4.6M dispatches, so the window never closes.
- **Predicted fix, in the fixture:** add `--tree-fold-warm=1m` to the fold arm.

Neither fix is applied; root asked for no repeated runtime on engagement alone. They are the concrete
predictions to apply if root wants region/fold engagement, and even then no boundary-execution claim
follows: `region_coexist` keeps the boundary outside `work`.

## 2. Existing toyvm correctness subset (runner `run-toyvm-tests.js`, prepared, not exercised)

- **Tests**, in CANDIDATE.md's risk order, all present at base 2683a6e3, and all reaching toyvm only
  through `../tools/toyvm`:
  - pm-timer-vector
  - sb-single-cycle, sb-highspeed-autoinit
  - uop-only
  - region-live, region-install-clock
  - tree-fold
  - uop, uop-live
  - retrace, audio
  - operand-patch, volatile, arena-recycle
  - live
- **Excluded: `browser-bundle`.** It reads the committed `docs/dos-corpus/live/toyvm-bundle.js`,
  which the candidate is expected to break until the bundle is regenerated, a separate gate.
- **Mechanics:**
  - each tree is built by `build-tree.js` (cand: sha-pinned candidate);
  - the tests are `git archive`d from the base into `<tree>/test/`;
  - each test runs as `node test/test-toyvm-<t>.js` with cwd = the tree, in its own process group;
  - a test is SIGKILLed at min(`--per-test`, remaining `--total`), and none starts once the total
    is spent;
  - trees are removed on every exit.
- **Statuses:**

  | status | meaning |
  |---|---|
  | PASS | exit 0 |
  | FAIL | non-zero exit by itself; its log is quoted |
  | TIMEOUT | killed at a cap |
  | SKIPPED | never started |

  Per-test comparison: REGRESSION (stack PASS, cand not), FIXED, same, or incomplete. A test that
  fails on both trees says nothing about the candidate.
- **Budget:** no per-test timings are recorded anywhere I could find, so this is not estimated.
  Proposed: two grants of at most 300 s each, one per tree:

      node run-toyvm-tests.js --out=<fresh>/toyvm-tests-cand-<ts> --plan=cand --total=300 --per-test=60 \
        --candidate=<pinned>/impl-draft/candidate-v2.diff \
        --candidate-sha=ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4
      node run-toyvm-tests.js --out=<fresh>/toyvm-tests-stack-<ts> --plan=stack --total=300 --per-test=60

  Tests run in risk order, so a bound cuts off the least-at-risk ones first. SKIPPED tests are
  listed, never counted as passes. Merging the two result.json files gives the comparison. Or one
  grant with `--plan=cand,stack` if root prefers fewer, shorter slots.
- **Not exercised:** the runner has passed `node --check` only. Its process-group, bound and cleanup
  code is copied from `run-fixture.js`, which has run four times.

## 3. Fixed-work CONT-cost comparison (V8 + SpiderMonkey)

**What changes on the hot path:** `CONT` (emit.js, about line 622) gains `(global.get $ifarm)` OR-ed
into its refusal test. It is inlined into every block transfer (GO, GO_LOOKUP, RET*, `$jlook_edge`)
and into the region JIT's rewrite pattern. That is the only fast-path change; `sti`, `popf` and
`jmp_ifen` are rare.

**Static, first (build only, no guest):**

1. Build both trees (`build-tree.js`, stack and cand).
2. `node dump-toyvm-wasm.js --tree=<t> --out=<dir>/<t>.wasm` per tree. This calls the tree's own
   `vm.js` `buildModule('tailcall', defaults)`, emitting and compiling to bytes without
   instantiating, and records each module's sha256.
3. For each module and each engine:

       node tools/wasm-native.js --wasm=<dir>/<t>.wasm --func='$jmp' (also '$jnz', '$jnz_t', '$ret', '$jmp_ifen' for cand)
       ... and the same with --engine=v8

   Compare `$jmp`/`$jnz`/`$jnz_t`/`$ret` between stack and cand. Expect one extra global load
   (`$ifarm` is a mutable global, so a memory load from the instance's globals area) and one `or`
   per transfer test, and check that register allocation around the existing `$smc`/`$steps` test
   is otherwise unchanged.
4. Record the module hashes, engine versions and tiers (SpiderMonkey Ion via `wasmExtractCode`; V8
   TurboFan via jitdump) and the capture commands, as CLAUDE.md requires.
5. **Missing engines are reported, not assumed.** `wasm-native.js` needs jsvu SpiderMonkey/V8 and
   GNU objdump; their presence on this box is unchecked.

**Fixed-work timing, after the static step:**

- **Driver:** `tools/toyvm/bench-dos.js` runs arms inside ONE tree, so two trees need an outer driver
  that alternates them per rep with the start rotated (the bench-dos discipline):

      node <tree>/tools/toyvm/bench-dos.js <prog> --variants=tailcall --dispatches=<N> --reps=1 --cpu-time --json

- **Programs:**
  - a synthetic transfer-heavy .COM with no IRQ hooked, so `$irqpend` stays 0 and only the CONT
    cost differs. It is the worst case: a tight loop of short blocks. Candidate: the fixed-up `work`
    loop alone;
  - two or three corpus programs (e.g. CYCLE, BRW at a fixed `--dispatches`) for a realistic share.
- **Gates before any number is quoted:** bench-dos checks frame hash and dispatch count across arms;
  here the driver compares them across trees and refuses a ratio when they differ. A program with an
  IF-blocked pending timer may legitimately differ under the candidate. Such a program measures the
  behaviour change, not CONT, and is excluded from the cost number.
- **Budget proposal:** one grant of at most 300 s on a quiet box (check `uptime`; CLAUDE.md warns
  load 10–40 measures the machine). Report the guest CPU minimum over reps per tree and the delta,
  quoted as a CONT-cost estimate for these programs only.
- **Prepared vs not:** `dump-toyvm-wasm.js` exists (`node --check` only). The alternating driver is
  not written yet: it is a small JS script, prepared on request.

## Not in any of these

Corpus A/B of the behaviour change, bundle regeneration, the residual architecture, and promotion.
