# First candidate fixture: readiness receipt (source only, nothing run)

Prepared for root's review of the candidate (all 676 lines of 886c2118 read by root). No runtime has
been used. Ultima (13406 / PID 3103361) holds the 600 s slot, then a short SkiFree run.

## Candidate v2: root's source caveats applied

`impl-draft/candidate-v2.diff` (sha256 ee8265ba3302fa10…) = 886c2118 + the two hunks in
`impl-draft/v1-to-v2.diff`. Nothing else changed. It applies cleanly to a fresh pinned stack tree,
and `node --check` passes on all 8 JS files (the WAT is still never assembled).

1. **compile.js, volatile follower.** The "never a stale instruction" guarantee is removed.
   - `$smc` is acted on at the next block transfer, so a store earlier in the same block into the
     STI follower's bytes runs the OLD follower. That is the unresolved same-block SMC contract
     (TOYVM-SMC-SAME-BLOCK-FORWARD-PATCH).
   - Coverage still needed (not written): a block that stores into its own STI follower before the
     STI, on every arm, compared under whatever contract that task settles.
2. **region-jit.js, `buildRegion` decline.** v1 scanned only the initial `rawOps`, before the detour
   arms were appended, so a boundary op inside a detour would have been compiled.
   - v2 scans the path's ops plus every `forwards[].detour.ops`. `inner` loops and non-detour
     forwards add no ops; they index into the path.
   - It scans before any mutation, so a declined region leaves the caller's `forwards` untouched.

## Exact inputs

| file | where | sha256 (first 16) |
|---|---|---|
| test `test-toyvm-irq-if-enable.js` (report-all + arm-scoped engagement) | 84640982 | b108a6e3fb609e9f |
| candidate `impl-draft/candidate-v2.diff` | this commit | ee8265ba3302fa10 (full: ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4) |
| `build-tree.js` (adds `--tree=cand`, a pinned candidate sha) | this commit | b2d24038e2d63292 |
| `run-fixture.js` (adds `--plan`, candidate passthrough) | this commit | d86f384c17ef99d6 |

Trees, both dry-built here and deleted:

| tree | dos-loop | emit | decode | compile | region-jit |
|---|---|---|---|---|---|
| cand = stack + v2 | 4dd7e7b0 | 001b2408 | d9d63287 | 8bc68ef3 | 87d41671 |
| stack, unchanged | 74f94f3e | e07d99db | 57cbe0d9 | 0910ce47 | 418da57c |

`build-tree.js` refuses a candidate whose full sha256 differs (exit 2, checked with a wrong sha).

## Procedure (one process at a time, one 300 s total bound)

1. Preflight: `uptime`; at least 100 MB free; nothing matching `run-dos`, `test-toyvm`,
   `run-fixture` or `build-tree` running; no `/tmp/toyvm-ifen-*`.
2. Extract the four files from their commits into a fresh `ifen-pinned-cand-v2/`, keeping the
   `impl-draft/` subpath for the diff. Verify all four hashes, and refuse on any mismatch.
3. Post a board CLAIM with the hashes. Then run:

       node ifen-pinned-cand-v2/run-fixture.js --out=<fresh>/ifen-fixture-cand-v2-<ts> --total=300 \
         --plan=cand --candidate=ifen-pinned-cand-v2/impl-draft/candidate-v2.diff \
         --candidate-sha=ee8265ba3302fa10c439e1b6e7328fd92b41878ed95e6a54df9a99b65f5f8ba4

   One tree (cand): build, then the test with `TOYVM_TEST_TOTAL_S` = min(140, remaining). Process
   groups are SIGKILLed at the bound, and the tree is removed on every exit.
4. Post SESSION with the wrapper PID (`pgrep -af '^node ifen-pinned-cand-v2/run-fixture.js'`) and
   the child PIDs from `result.json`.
5. Verify cleanup:
   - the wrapper is gone and the process tree is clear;
   - `treesRemoved` is `[true]`;
   - no `/tmp/toyvm-ifen-*` is left.

   Then post RELEASE. Keep `result.json`, `build-cand.txt` and `test-cand.txt`.

## Classification (failures kept distinct)

| result | meaning |
|---|---|
| **PASS** (exit 0) | the five counted cases pass [1][2][3] on all five arms |
| **ARCH-FAIL** (exit 1 with `FAIL <case>:` lines) | the candidate runs but an assertion fails. The log names which ([1] not at X, [2] in a shadow, [3] parity) and which arm |
| **HARNESS-FAIL** | anything else. For a candidate this *includes the candidate failing to compile*: its WAT is assembled for the first time inside run-dos, and an assembly or validation error surfaces as an uncaught `execFileSync` error with a stack trace. Also a build failure (patch or sha refusal), the test's bound stop (exit 5), or a kill |

The log is quoted as is; a HARNESS-FAIL from a compile error is a candidate defect, not a fixture
defect.

## What a PASS would and would not mean

- **Would mean:** in these five hand-built programs, the pending timer IRQ is delivered at the
  IF-enable boundary, never inside the STI or SS shadows tested, with identical delivery sequences
  across the five arms. Each non-l1 arm's engagement is reported as limited evidence, installed vs
  executed, with the raw report line.
- **Would NOT mean** the architecture is complete. These residuals remain real and unhandled:
  - **TF / single-step:** STI stays a one-instruction block, and a stop's ordinary rungs can still
    fire right after STI;
  - **16-bit wrap** (AUDIT §9): a boundary lying below the STI is refused via `end_cut`, not
    handled;
  - **standalone MOV/POP SS shadows** (outside an STI shadow): unchanged, and a delivery can still
    land there via `jmp_syn`, `end_cut` or TF;
  - **HLT:** not an eligible instant (µop-only runs past `end`; HLT's `end` is indistinguishable);
  - the **host-serviced INT return** and **IRETD into V86**, which can also set IF, are not eligible
    instants;
  - only the **timer** rung marks pending (keyboard, retrace, GUS and SB are not);
  - **same-block SMC into the follower** is stale (above);
  - **STI immediately followed by MOV/POP SS** is behind `IFEN_STI_MOVSS = true`, an experimental
    switch. It stays UNCONFIRMED and informational (`sti_movss` is never counted).
- **The CONT cost** (one `global.get` and one `i32.or` per block transfer) is unmeasured.
- **Browser bundles** must be regenerated before any landing; handler indices shift.
- **Still needed afterwards:** the corpus A/B, the performance gate, and existing toyvm tests in a
  separate slot. No promotion.
