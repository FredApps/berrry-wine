# Existing-test correctness run, the bench driver, and engine availability: readiness (source only)

Prepared after root's review of 68b82836. Nothing here has run the emulator, built a module, or
benchmarked anything. Planned after Arena; not granted.

## 1. Combined cand,stack correctness run: one 600 s total, 60 s per test

| file | sha256 (first 16) |
|---|---|
| `if-enable/run-toyvm-tests.js` (adds a test-only `--prepared-trees` hook; the real path is unchanged) | 060efea100c76972 |
| `if-enable/build-tree.js` (unchanged) | b2d24038e2d63292 |
| `if-enable/impl-draft/candidate-v2.diff` | ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4 (full) |

Command:

    node ifen-pinned-tests/run-toyvm-tests.js --out=<fresh>/toyvm-tests-<ts> --plan=cand,stack \
      --total=600 --per-test=60 --candidate=ifen-pinned-tests/impl-draft/candidate-v2.diff \
      --candidate-sha=ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4

- **Tests:** 15, in risk order (CANDIDATE.md):
  - pm-timer-vector
  - sb-single-cycle, sb-highspeed-autoinit
  - uop-only
  - region-live, region-install-clock
  - tree-fold
  - uop, uop-live
  - retrace, audio
  - operand-patch, volatile, arena-recycle
  - live
- **`browser-bundle` is excluded:** it reads the committed docs bundle, which the candidate is
  expected to break until regeneration, a separate gate.
- **SKIPPED is explicit.** Any test not started before the 600 s total is `SKIPPED` and its
  comparison is `incomplete`. It is never counted as a pass. The plan runs the candidate first, so
  the stack baseline may be cut short. If so, the comparison says `incomplete` for those tests, and
  a second grant with `--plan=stack --tests=<the skipped ones>` completes it.
- **Statuses:** PASS / FAIL (log quoted) / TIMEOUT / SKIPPED. Comparison: REGRESSION / FIXED / same /
  incomplete.
- **Source validation, done:**
  - `run-toyvm-tests.test.js` (edb5a153) **4/4**, with tiny JS child fixtures as the tests:
    statuses with cwd = the tree, the comparison, the per-test cap killing a hung test AND its
    grandchild, the total bound turning the rest into SKIPPED/incomplete, removal of owned copies,
    and refusal of a non-empty `--out`.
  - The real path's tree build plus `git archive` of the 15 tests was checked statically (stack
    tree built, the 15 files extracted to `test/`, nothing run, tree removed).
- **Not validated:** real test durations. None are recorded anywhere I found, so the 600 s may not
  cover both trees; that is what SKIPPED/incomplete is for.

## 2. Fixed-work bench driver (written, validated synthetically; not run on the emulator)

| file | sha256 (first 16) | role |
|---|---|---|
| `bench-one.js` | f686ad57b73365b5 | one measurement in one tree |
| `bench-trees.js` | a885e931fa8ba3dd | the alternating driver |
| `bench-trees.test.js` | 64c08870b6458879 | synthetic tests |

- **`bench-one.js`** makes exactly bench-dos's per-rep call (bench-dos.js:169 at base:
  `runDos({ exe, variant: 'tailcall', budget, cpu: 386, log: quiet, autoKey: true, cpuMeter })`).
  It prints one JSON line: exact `dispatched`, `frame`, `handbacks`, `pixels`, guest seconds and
  guest CPU seconds, and bench-dos's metric (ns/dispatch).
  - **Why not bench-dos itself:** its `--json` rows carry only timings (`nsMin/nsMed/nsMax`), and
    its text line rounds dispatches to 0.1M, so an exact cross-tree gate cannot be built from its
    output.
- **`bench-trees.js`:**
  - **Alternation:** cand and stack per rep, with the starting tree rotated (bench-dos.js:163-167).
  - **Gate:** each tree must be deterministic across reps and the two trees identical on
    (dispatched, frame), or the program is **NOT COMPARABLE** and no ratio is printed.
  - **Ratios:** the paired ratio (median over reps of cand/stack within one rep; > 1 = candidate
    slower) and the min ratio.
  - **Bounds:** per-run cap, total bound, process groups, trees removed.
- **`bench-trees.test.js` 6/6** (REAL driver and REAL child, stub `runDos` trees):
  - comparable, with an exact signature, the paired ratio and the rotation order
    `cand,stack | stack,cand | cand,stack`;
  - cross-tree frame mismatch → NOT COMPARABLE;
  - non-deterministic tree → NOT COMPARABLE;
  - per-run timeout → INCOMPLETE, with the grandchild killed and later programs still running;
  - total bound → hung run cut, rest SKIPPED;
  - refusal of a non-empty `--out`.

  The stub also asserts that the bench-dos call shape is mirrored.
- **Proposed grant (later):** at most 300 s on a quiet box (`uptime` first):

      node bench-trees.js --out=<fresh> --progs=<synthetic transfer loop .COM>,<corpus prog> --reps=5 --dispatches=20m --cpu-time --total=300 --per-run=60 --candidate=... --candidate-sha=ee8265ba...

## 3. Engine tools for the V8 + SpiderMonkey disassembly gate (checked read-only)

| tool | where `tools/wasm-native.js` looks | status |
|---|---|---|
| SpiderMonkey `sm` | `~/.jsvu/bin/sm`, `/usr/local/bin/sm`, `/opt/homebrew/bin/sm`, `$SM` | **absent** (`$SM` unset) |
| V8 `d8` | `~/.jsvu/bin/v8`, `/usr/local/bin/d8`, `/opt/homebrew/bin/d8`, `$D8` | **absent** (`$D8` unset) |
| GNU objdump | PATH | present: GNU Binutils 2.42 |

- Node is v24.18.1 (V8 13.6.233.17-node.50), but `wasm-native.js` needs a d8 shell, not node.
- **The disassembly gate is therefore blocked on provisioning:** `npx jsvu@latest
  --engines=v8,spidermonkey`, a network install into `~/.jsvu`. Not done; that is a box change for
  root to decide.
- Also noted: `wasm-native.js` names functions from a `.wat` (default: the main build's
  combined.wat), so a toyvm module needs `--wat=<tree>.wat`, which `dump-toyvm-wasm.js` already
  writes beside the `.wasm`.

## 4. Predicted region/fold engagement fixes, prepared, NOT applied, NOT scheduled

`if-enable/predicted-engagement-fixes.diff` (58d4587b) is against the pinned test e19398b3, which
is unchanged:

- `mov [0x400],ax` in `work`'s loop, so `extendThrough` does not trace the `jnz` and the loop block
  does not end in `ret`;
- `--tree-fold-warm=1m` on the fold arm, so the profile window closes before the program's ~4.2M
  exit.

Statically disassembled, and every other program is byte-identical. These are predictions from
source (NEXT-GATES-PLAN.md §1). No engagement-only run is requested. Even if they engage the arms,
`region_coexist` still keeps the boundary outside the compiled loop.

## Unchanged

No promotion. Corpus A/B, bundle regeneration, the residual architecture, and the unconfirmed
STI-then-SS rule are open.
