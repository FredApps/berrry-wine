# TOYVM-REGION-JIT-BRW — phase 1 source audit (2026-10-04, no runtime)

Tree read at HEAD (16f764ad); `tools/toyvm/` and both region tests are clean against HEAD, so
deddbe2b/b0f38372 are what is in the worktree.

## What the two numbers are (READ)

`tools/toyvm/arm-bench.js:243` prints `DISAGREE <arm> ${dispatched}/${frame} vs ${ref.dispatched}/${ref.frame}`.
`dispatched` is runDos's final dispatch count, and `frame` is `frameHash(vm.mem, geom)` (`run-dos.js:982`).

- 500918117 vs 500918116 is the dispatch count. **That is not what failed.** `arm-bench.js:228-229`
  tolerates `|Δdispatched| <= OVERSHOOT (64)`, so the +1 alone would have passed.
- 2fa3dd95 vs a066bf27 is the **frame hash**, and that is the failure: a different picture at the
  end of the run.
- The budget is `--l1-seconds=30` calibrated (`arm-bench.js:209-213`), so it is about 500.9M dispatches.
  The run ends at `session.endAt = budget` (`run-dos.js:824`). The +1 is the last block's overshoot,
  and that is consistent with either a clock that is 1 dispatch off or a different path.

## "only-naive off-by-one" (READ, from the 88bbcb9f transcript jsonl, not the repo)

This is the same signature on BRW in a **different arm with no region JIT at all**. In the
2026-10-02 box corpus run at about 30 s of L1, `only-naive` gave
`DISAGREE only-naive 491781302/329dd42c vs 491781301/17533756`: +1 dispatch, different frame, BRW only.
The earlier 30M BRW divergence of only-naive was fixed in ae7043c1 ("three clock leaks, all
handback/cut-dependent"; see `emit.js:278-289`, the `end_cut` step refund). The long-run version is
still open. Two unrelated arms fail identically on BRW and nowhere else. That points to BRW turning
any 1-dispatch clock or cut perturbation into a frame change: its SB poll and DMA position reads, and
code it patches back and forth every frame (memory `project_toyvm_uop_only_arm`,
`project_toyvm_smc_plan_alias`). It does not point to a lowering bug specific to the region JIT.

## What continuous mode changes vs jit-sep (READ, deddbe2b)

- The sampler keeps running after an install or a decline (`region-live.js:232-235`, `:251`).
- `pump()` falls through `installed` (`:355-358`). Each window with a new top arena address reruns the
  pipeline (`:361-368`, `:391-397`).
- Installs **accumulate** `regionAt`, `regionSucc`, `regionBytes`, `guards` and `installedAt` (`:536-540`, `:683-685`).
- Picks exclude the heads already installed (`region-prepare.js:78`). The walk declines at installed
  slots (`region-jit.js:283-288`).
- Slots are unique: `idx = extras.handlers.length + i` (`region-prepare.js:87-108`), `extras.commit`
  (`region-live.js:531-534`), `installRegionModule` (`region-sep.js:101-105`). **No slot collision.**
- `useBuild`/`prepareTables`/`buildHandlers` are idempotent (`emit.js:4069-4071`, `:4100`). The repeated
  in-process `prepareRegions` cannot renumber the live compiler's handlers. **Ruled out.**
- The gate runs on its own `makeVm` over a memory copy (`trace-jit.js` benchTiers ~1748). It does not
  touch live ports. **Ruled out** as live-state perturbation.
- `slice` defaults to 2e6 (`run-dos.js:174`) and a sample is taken only on budget expiry (`region-live.js:252`).
  A 6M window therefore holds **at most about 3 samples**, and the 5% `minShare` is effectively no
  filter. A 500M BRW run gets about 80 windows. The box run's build time (8.05 s vs 0.94 s for
  jit-sep, from the transcript) implies about 8 pipelines against 1. Continuous mode multiplies every
  per-install effect by about 8 and adds regions from later scenes. (Inferred from build time;
  arm-bench's JSON keeps only `phase` and `installs` (`arm-bench.js:161`), so `drops` and `windows` were
  never recorded.)

## Ranked hypotheses

1. **BRW-amplified per-install clock/cut perturbation, multiplied by continuous mode.** (Mechanisms
   read; that they fire on BRW is inferred.)
   - a. The documented ≤1-dispatch drift per install (`docs/toyvm-region-live.md:144-150`;
     `test/test-toyvm-region-live.js:369-380`, bound `drift <= installs`). The lattice clock that
     removes it is opt-in and off in arm-bench (`dos-loop.js:1159`, `run-dos.js:262`). jit-sep pays it
     once; sepc pays it about 8 times. A 1-dispatch shift is exactly what moved BRW's SB IRQ before
     (spinBlock comment in uop-only, transcript).
   - b. Each install drops programs and changes host learning state that L1 never touches:
     `invalidateRange` → `refusedEntries.clear()`, jtab slots, rtop zeroing (`dos-loop.js:509-538`).
     Precompile only for the **current CS** (`region-live.js:626-631`). BRW reaches the same bytes
     through two selectors (real-mode seg 0x110 and pmode sel 0x20, base 0x1100), so blocks under the
     other selector come back as a later miss handback. Unrepaired rtop frames are cut
     (`:650-670`, `rtopCut`). A precompile that recycles the arena zeroes the whole stack (`:666`).
   - c. **Uninstall = whole-cache flush** (`region-live.js:328-347` → `dos-loop.js:261-272`: clears plans,
     `codeBits`, rtop, jtab). In continuous mode the guard set is the union of every region installed
     so far (`:683`). One guard failure (BRW patches code "back and forth every frame") drops **all**
     regions and flushes everything. That re-compiles the whole working set through handbacks, resets
     the SMC repair plans and code bits, and changes later SMC break and volatility learning
     (`noteSmc`/`promote`, `dos-loop.js:662-675`). That is the "clock depended on what the host had
     LEARNED" class (`emit.js:278-283`).
   - d. `compile.js:365-373` force-marks and compiles **every** installed head in that csKey on every
     compile, even when its guard fails. `:461-466` precompiles region successors. Together these
     compile and code-bit bytes that L1 has not compiled yet. A guest store there becomes an SMC
     break, which is a handback, plus a `volHits` bump, and L1 never takes either. This grows with
     the number of regions.

   **Discriminator:** compare `handbacks`, `smcBreaks`, `arenaResets` and `irqs` against L1, plus sepc's
   `drops`. Then use the first differing line of the two `--slice-log`s against the probe's `[jit@]`
   event timeline.
2. **A later-scene region mis-bills `$steps` or a clock reader.** (Inferred; jit-sep's single region
   is evidently fine.) Regions bill `pending++` per op (`region-jit.js:1542`) and flush before
   branches, clock readers and labels (`:1524-1563`). The entry refund is at `:1738`. The gate
   (`region-prepare.js:143-154`) compares regs and memory on a snapshot only, never `$steps`, so it
   cannot catch a billing error. A BRW scene loop that contains the SB poll (`in al,dx / test al,80h /
   loopnz`, a spin twin that L1 bills "a run of turns together" (`arm-bench.js:225-227`)) is the prime
   suspect. **Discriminator:** `--step-audit` (`region-jit.js:1756-1770`). `jmp_syn`/`end_cut` refunds
   survive lowering: `splitBranch` keeps the prefix (`:1143-1184`, `pre`), so those are probably fine.
3. **A residual long-run clock leak in the shared host (L1/dos-loop), not in the region code.** Any
   arm that changes cuts or handbacks exposes it on BRW. This is supported by only-naive's identical
   +1/frame signature at 491.78M. If phase 2 shows sepc diverging at a point with **no** JIT event
   nearby, this is the answer, and both bugs are one bug.
4. **Bookkeeping, low.**
   - `runPipeline` ignores `install()` returning false (`region-live.js:428-431` vs `:451-456`). It
     still counts an install and sets `installed`. This is only reachable when the tree-fold epoch
     moves, which does not happen in arm-bench.
   - `seenHot` is keyed by **arena address** (`:364-367`). After a flush or arena reset it can skip a
     genuinely new scene. That affects performance only.

## Phase-2 repro (bounded)

Prerequisite: BRW.EXE is **not on this machine** (`find / -name BRW.EXE` returned nothing; there is
no /tmp/demos and no ~/dos-demos). Copy it from the box or fetch it into
`/tmp/demos/1995-c-cma_brw/` (`tools/toyvm/bench-set-core10.txt:53`, `tools/toyvm/fetch-demos.js`).

```
S=scratch/claude-orchestrator-20261004/toyvm-brw; BRW=/tmp/demos/1995-c-cma_brw/BRW.EXE
timeout 300 node $S/brw-probe.js --exe=$BRW --budget=500918116 --arm=l1   --slice-log=$S/l1.slog   > $S/l1.out
timeout 300 node $S/brw-probe.js --exe=$BRW --budget=500918116 --arm=sepc --slice-log=$S/sepc.slog > $S/sepc.out
#   (and --arm=sep as the control that agreed on the box)
```

1. Step 0: confirm L1 frame a066bf27 and sepc frame 2fa3dd95. If they do not reproduce, stop: the
   problem is the environment or nondeterminism.
2. Find the first differing slice-log line (columns: cumulative dispatched, left, cs:ip) and place it
   on the `[jit@]` timeline.
3. Re-run sepc only to just past that point with one bisector at a time:
   `--lattice-clock` (in **both** arms), `--no-install-precompile`, `--no-install-invalidate`,
   `--no-region-code-bits`, `--no-install-repair-rtop`. Then `--step-audit` for hypothesis 2.

Cost: box timings were L1 18.9 s and sepc 39.4 s CPU at 500.9M (8 s of that is build). Allow about
1.5-2x on a local box. Step 1 is about 2-3 min for three arms. Each bisector rerun is cut to the
divergence budget, likely well under 60 s. Total ≤ 300 s if the divergence is in the first ~100M; if it
is late, only the three full runs fit in 300 s.

## Proposed failing test (toyvm-only → test/test-toyvm-region-live.js)

Add a `continuous` arm to `run()` (`regionJit: { sep: true, continuous: true, minShare: 5, ...}`) and a
synthetic two-scene .COM:

- Scene A: hot loop L_A for N reps.
- Scene B: a different hot loop L_B. L_B **reads a guest-visible clock** each iteration (port 3DAh
  status, or a running SB DMA count register after DSP 0x14) and folds it into a register.
- Then a CS store that patches L_A's immediate **after** L_B has been installed. That forces
  `guardsHold()` false with two regions live, i.e. uninstall-all plus a full flush.

Assert:
- `installs >= 2` and `drops >= 1` (the path ran);
- regs, frame and text equal to the L1 arm, and to a JS closed form for the non-clock registers;
- `wav` equal;
- **the clock-folded register equal**: that is what makes an extra handback or 1-dispatch drift
  visible the way BRW sees it;
- and `|Δdispatched| <= installs + drops`.

Negative control: the same program under `sep` without `continuous` must pass. Phase 2 decides which
sub-mechanism the program must hit (flush vs other-CS precompile vs billing), and the clock-reading
loop should be built to match it.

---

# Resume 2026-10-05: re-rank with the longrun-bg evidence (still source-only, nothing run)

## New facts (MEASURED by CLAUDE-TOYVM-LONGRUN-BG, raw output in scratch/claude-toyvm-longrun-bg-20261005/runs/)

| arm | dispatched/frame | handbacks | smcBreaks | arenaResets | compiles | irqs | installs | rtop repaired/cut |
|---|---|---|---|---|---|---|---|---|
| l1 | 500918120/a066bf27 | 1,147,541 | 18594 | 6 | 50899 | 9871 | – | – |
| sep | 500918120/a066bf27 | 1,147,825 | 18594 | 6 | 50900 | 9871 | 1 (35959) | 2/0 |
| sepwc | 500918120/a066bf27 (AGREE, 1 rep) | 2,233,259 | 18592 | 7 | 51020 | 9871 | 16 | 7/0 |
| **sepc** | **500918117/2fa3dd95** | 2,927,857 | 18590 | 7 | 49996 | 9871 | 16, **0 drops** | 7/0 |

- sepc installs, at dispatch → cumulative region count:
  12.0M→1, 18.0M→2, 42.0M→3, 66.0M→4, 78.0M→5, 90.0M→6, 96.0M→7, 120.0M→8, 162.0M→9,
  **168.0M→10**, 204.0M→11, 252.0M→12, 264.0M→13, **288.0M→14**, 378.0M→15, 384.0M→16.
- sepc heads, in install order: 35959 36038 36117 17537 16954 36196 60973 59998 61195 **31636**
  60044 61407 60103 **60162** 17985 16775.
- sepwc heads: same set except 45494 and 17254 in place of 31636 and 60162.
- So the heads unique to sepc are **31636** (`at[9]`, install #10, at about 168.0M) and **60162**
  (`at[13]`, install #14, at about 288.0M). `installedAt` is appended once per install, so its
  order is install order.

## What the evidence kills or weakens

- **1c (uninstall flush): dead.** There were zero drops.
- **"Extra handbacks move BRW's clock": weakened to a non-cause.** sepwc took about 1.1M extra
  handbacks, 2 fewer smcBreaks, 1 extra arena reset and the same 7 repaired / 0 cut return-stack
  frames, and **kept the frame**. With `irqSchedule` on by default (run-dos.js:267, dos-loop.js:1683-1713,
  1947-1956), interrupts, PIT and audio renders happen on scheduled dispatch dates, not at handbacks,
  so handback count is clock-neutral by design. The counters that differ in sepc differ in sepwc too.
  They are **not sufficient**.
- **Shared-host leak (old H3) as the whole story: weakened.** If any perturbation of the cut pattern
  were enough, sepwc would fail too. It may still be a *contributor*: BRW amplifies a 1-dispatch
  shift, and only-naive fails the same way, so it stays in the ranking.

## Re-ranked hypotheses

1. **A specific sepc-only region misbehaves (31636 or 60162): body billing, or a clock-reader op
   inside it.**
   - The only structural difference from the agreeing sepwc is the region *set* (confounded with
     install timing).
   - Mechanisms:
     - `$steps` billing. Regions bill `pending++` per op and flush before branches, clock readers
       and labels (region-jit.js:1524-1563, entry refund :1738). L1 bills per dispatch, with
       refunds in `jmp_syn`/`end_cut` and lumped spin turns.
     - A clock reader (`in` from 3DAh/SB, `$port_in`) read with a stale `pending`.
   - The gate never compares `$steps` (region-prepare.js:143-154). It compares only regs and
     memory on a snapshot, so it cannot catch either.
   - Discriminators: `--max-installs` bisect, `--only-heads`, `--step-audit`.
2. **Install-time side effects specific to those regions' guard ranges.**
   - `invalidateRange` (dos-loop.js:509-538) drops whole programs and clears `refusedEntries`,
     jtab slots and rtop. Precompile happens only under the current CS (region-live.js:626-631).
   - These are clock-neutral in general, as sepwc shows. But dropping the *programs that carry
     BRW's SMC repair plans* can change which operand-patch path runs. Memory
     `project_toyvm_smc_plan_alias`: the plan is invalid when the live-program count over the range
     changes, and BRW aliases seg 0x110 and sel 0x20. That is a correctness path, not just a clock
     path.
   - smcBreaks differs (−4 sepc, −2 sepwc), so the SMC path *is* perturbed in both. Whether it
     matters depends on which bytes the dropped programs covered.
   - Discriminators: `--no-install-invalidate`, `--no-install-precompile`.
3. **Forced head compiles and successor precompiles setting code bits** (compile.js:365-373,
   461-482). These are also behind arenaResets +1 and smcBreaks −N. Seen in both arms, so not
   sufficient alone. It can combine with (2), because extra code bits on BRW's self-patched bytes
   change which stores break. Discriminator: `--no-region-code-bits`.
4. **The documented ≤1-dispatch drift per install** (docs/toyvm-region-live.md:144-150). It is
   region-dependent: "the slice a swap lands in overshoots by up to one straight line". sepwc's 16
   installs did not trip it, but a drift whose size depends on the region's straight-line length
   can still be specific to 31636 or 60162. Note the end count: sepc 500918117 vs L1 500918120 (−3).
   Discriminator: `--lattice-clock` in **both** arms (it removes this class by design).
5. **Shared-host residual clock leak** (only-naive same signature; emit.js:278-289 class). This is a
   contributor that makes BRW sensitive to (1)–(4), not an independent cause. It becomes the answer
   only if the minimal failing configuration reached by the bisect still fails with every install
   bisector on.
6. **Dual-selector precompile skip** (region-live.js:626-631). It only produces miss handbacks,
   which are clock-neutral per the sepwc evidence. Low.

## Bisect plan (brw-bisect.js; one run at a time; no BRW bypass, no OVERSHOOT change)

The fixture is `scratch/claude-toyvm-longrun-bg-20261005/fixtures/1995-c-cma_brw/BRW.EXE`
(brw-bisect.js default). The budget is 500918116 unless stated. Local times measured by longrun-bg
on this 4-core box: L1 5.6 s wall to 500.9M, sepc 10.7 s. A run to budget B costs about
B/500.9M × that.

```
P=scratch/claude-orchestrator-20261004/toyvm-brw/brw-bisect.js; O=scratch/claude-orchestrator-20261004/toyvm-brw/runs
```

| Step | Command (each in its own `node`, with a `timeout 60` guard) | Runs | ≈ wall | Decides |
|---|---|---|---|---|
| S0 | `node $P --arm=l1 --checkpoints=6000000` ; `node $P --arm=sepc --checkpoints=6000000` | 2 | 17 s | reproduce a066bf27 / 2fa3dd95; the first checkpoint (6M grid) whose dispatch is equal in both but whose hash differs gives a coarse divergence window W0 = [cp_prev, cp_first_bad] |
| S1 | `node $P --arm=sepc --max-installs=K` for K = 8, then 12 or 4, then …, binary search over 0..16 | 4–5 | ≤ 55 s | K* = the smallest K that fails. Predicted K* = 10 (31636) or 14 (60162). Cross-check: the S0 window W0 should follow install K*'s dispatch |
| S2 | `--only-heads=<K* head>` and `--deny-heads=<K* head>` (all others allowed) | 2 | 18 s | whether the region alone is sufficient, and whether it is necessary |
| S3 | On the minimal failing config (`--only-heads=X`), one at a time: `--step-audit`; `--no-install-invalidate`; `--no-install-precompile`; `--no-region-code-bits`; `--no-install-repair-rtop`; `--lattice-clock` (plus an `--arm=l1 --lattice-clock` reference) | 7 | 50 s | step-audit charged≠weight ⇒ H1 billing. A flag that restores agreement names H2, H3 or H4. None restores it, and audit equal ⇒ the region body computes something different (gate miss) or H5 |
| S4 | `--state-window=a:b --state-out=$O/<arm>.state` on L1 and on the minimal config, with [a,b] = W0 narrowed to ≤20M around install X | 2 | 15 s | join on equal dispatch counts; the first line whose regs differ is the divergence instruction. cs:ip names whether it is inside X's loop (H1), in code whose programs X's install dropped (H2/H3), or elsewhere (H4/H5) |
| S5 | `node tools/toyvm/dos-disasm.js BRW.EXE <cs:ip from S4>`, plus `--region-dump=$O/dump` on the minimal run to read X's region body | 1 | 5 s | names the op |

- **Total:** about 18 runs, **≈ 160–190 s wall**, all single-process and serial, peaking at one
  core. Ask root for **one 5-minute serialized window** (CPU-only, no browser).
- **Stop rules:**
  - If S0 does not reproduce, stop and report (environment drift).
  - If K* does not exist (K=16 passes when re-run), sepc is nondeterministic, which contradicts the
    inline backend. Stop and report.
  - If S3 finds no discriminating flag, do not widen it: escalate to step-audit per region
    (`--only-heads` for each sepc head, 16 × 7 s ≈ 2 min, in a second window).

### Caveats

- **`--step-audit` changes the region bodies** (extra stores to HIST slots). Accept its verdict
  only if that run's `jit.at` equals the unaudited minimal run's. If the gate declines the audited
  body, the run says nothing.
- **`--only-heads` / `--deny-heads` / `--max-installs` decline through the normal path,** so later
  windows can pick differently. Every bisect run therefore prints its own `jit.at`, and a conclusion
  needs the head set it actually ran with.
- **Checkpoint hashes cover only the first handback past each multiple of N.** Two arms can stop at
  different handbacks there. Compare only checkpoints whose dispatch value is equal in both. With
  irqSchedule, scheduled stops (timer, VGA frame, tick, endAt) are common to the arms whenever the
  clocks agree.

## Test draft

- **Path:** `scratch/claude-orchestrator-20261004/toyvm-brw/test-toyvm-region-continuous.draft.js`
  (`node --check` OK, not run).
- **Program:** a two-scene .COM.
  - Scene A is the existing dull loop.
  - Scene B reads port 3DAh every iteration and folds the retrace bits into bp. `$vga_status` is
    derived from `$slice_budget - $steps`, so bp is a guest-visible hash of the dispatch clock.
- **Arms:** off, sep and sepc.
  - Preconditions: at least one install, and in sepc both scene heads installed.
  - bx/si equal to the closed form under any clock.
  - **bp, frame, wav and irqs equal to the interpreter.** That is the BRW invariant, stricter than
    the current "drift ≤ installs" bound.
- **Expected:** it fails on sepc if the cause is billing or install clock drift (H1/H4). If it
  passes while BRW still fails, scene B gets replaced with the shape S4/S5 names, and the harness
  stays.
- **Destination:** a new section of test/test-toyvm-region-live.js, or a new tiered test-toyvm-*.js.
  It is toyvm-only, so test-toyvm-*.js is the right home.

---

# Phase-2 results, 2026-10-05 04:41-04:45Z (root grant; 17 serial node runs, ~151 s child runtime)

Logs: `runs-20261005a/`. All runs used the longrun-bg BRW fixture, through brw-bisect.js.

- **S0 reproduced.**
  - L1: 500918120/a066bf27, endHash bb14e750.
  - sepc: 500918117/2fa3dd95, endHash 0143787a, 16 installs, 0 drops.
- **6M checkpoints (full guest RAM + regs hash at the first handback past each 6M).**
  - Equal at every jointly-hit checkpoint up to 330000004, except transient differences at
    162000004 and 168000001 (install points #9/#10), which reconverge by 174M. Those are probably
    install/pipeline-time register materialization, and are not the bug.
  - **From ~336M sepc runs exactly +1 dispatch behind L1**: checkpoint dispatch counts are offset by
    +1, e.g. 336000006 vs 336000007.
- **S4 (registers at every handback, 330.0M–336.0M).** First state difference at **dispatch
  330588033, 8:c34b** (same cs:ip and count):
  - ax 0 vs 8080, si f901 vs f67b, flags 3202 vs 3206.
  - The last identical state was at 330587631 (8:b921).
  - In between the two arms take different handback points (L1 8:c290, sepc 8:c179), and sepc has an
    extra handback at 330587960 8:bec5.
- **S1 (`--max-installs=K`, state window 330587600:330588100 vs L1).**

  | K | 0 | 2 | 4 | 5 | 6 | 7 | 10 | 12 |
  |---|---|---|---|---|---|---|---|---|
  | result | SAME | SAME | SAME | DIFF | DIFF | DIFF | DIFF | DIFF |

  **The flipping install is #5: head 16954 = 0x423a**, installed at about 78.0M (exits at
  0x423a/425c/425f/4275/427c/4292/4299/429d; body in `runs-20261005a/dump-k5/region-0x423a.wat`).
  It is not one of the two sepc-only heads, and K=0 (sampling plus pipelines plus makeBundle, no
  install) is clean.
- **S2 (`--only-heads=16954`): VOID.** It installed nothing, because earlier windows were declined
  and their tops landed in seenHot.
- **S3 on K=5.**
  - `--step-audit`: charged 96,612,904 == weight 96,612,904 (the region bills its own ops
    consistently).
  - `--no-install-invalidate`, `--no-region-code-bits` and `--no-install-precompile`: **all still
    DIFF**. With `--no-install-invalidate` the install order changed to [35959,36038,17537,16954,36117]
    and it is still DIFF.
- **Not run:** `--lattice-clock` (both arms), `--no-install-repair-rtop`, the per-region state window
  around 0x423a's executions near 330.58M, and the disassembly of 8:c290-c35a / bec5.

## Re-rank after phase 2

1. **The region at 0x423a computes or bills differently from L1 on some path.** H1 is now the
   region body, not the install. The install side effects (H2, H3) are refuted for this failure: none
   of the three install switches restores parity. Aggregate billing self-consistency holds, but that
   does not prove per-path parity with L1 (a side exit or detour path the 4000-iteration gate never
   took).
   - Note that this region is installed in sepwc too (head 16954 is in sepwc's list) and sepwc kept
     the frame. So 0x423a is necessary but its effect depends on what else is installed or when.
     Interaction with region #3 0x8d15 (36117) is the next suspect: `--no-install-invalidate`
     reordered 36117 after 16954 and it still failed.
2. H4 (1-dispatch drift) is consistent with the +1 offset from ~336M, but that offset appears
   *after* the state divergence at 330.588M. It is a consequence, not the cause.

## Next steps (another grant, ~60 s)

- `--state-window=330587631:330588033` on L1, K=4 and K=5, plus a trace of when 0x423a runs. That
  needs one more probe hook (region entry counter via `--exit-census`, or a `[jit-entry]` stamp).
- `--lattice-clock` on both arms with K=5.
- Then disassemble 8:c290-c35a and the 0x423a body to name the op.

The test draft should replace scene B with a 0x423a-shaped loop once the op is named.

# Phase 3, 2026-10-05 09:57-10:00Z (self-claimed on an idle box; 3 serial Node runs, ~18 s)

Logs: `runs-20261005b/` (`irq-{l1,k4,k5}.txt` = runDos `--trace-irq` lines; brw-bisect.js now
forwards `--trace-irq --irq-out=FILE`). Budget 330600009 (end of the S1 window).

- **From existing logs, no run:** `w-l1`/`w-k4` state windows are identical; `w-k5` agrees with L1
  at every shared point through loop iteration 3 and first differs in iteration 4 (`si` f907 vs
  f681 at the same iteration end, after an extra K5 handback at 8:bec5). The window is the inner
  loop at 8:c179-c35a with a 0x140 (320-byte VGA row) di stride.
- **Region 0x423a does not do that work.** Its body (`dump-k5/region-0x423a.wat`) is a 32-bit
  3-plane additive blend: al/ah from [esi+ecx-1] / [esi+ecx+0x1f2bf] plus bias bytes at
  0x4238/0x4239; bl from three tables at [ebp+eax] (+0, +64K, +128K); [edi+k*42560] += bl,
  clamped to 63; inc edi; dec ecx; jnz. It never writes si, and it is not the code running at
  330.588M. Full-RAM hashes are equal at 330.0M and again at 330.6M (endHash bec246ff in L1, K4
  and K5), so the 330.588M register difference is transient: an equal dispatch count at a
  different iteration of one tight loop (per-op billing), not lasting corruption.
- **`--lattice-clock` is moot.** The interrupt schedule is on by default and supersedes it
  (run-dos.js:252-263). Not run.
- **IRQ delivery is where the arms split.** irqs = 6465 in all three arms (same count, same
  schedule), but the instruction each one is pushed in front of differs:
  - L1 vs K4: 1 line differs (same from-address 8:8c77, different `at`).
  - K4 vs K5: 115 lines differ. The first, and 10 of them in all, are the region's own exit:
    `L1/K4 irq vec=08 at=88900003 from 8:423a` vs `K5 at=88900000 from 8:4299`.
  - 0x4299 (gip 17049) is the target of the region's third `jb`, which is an unconditional side
    exit (`(else (global.set $gip 17049) (br $out))`). With steps < 0 there, `$slice_exit` hands
    back at 0x4299. The interpreter does not stop at that edge: it runs inc/dec/jnz (3 ops) and
    hands back at the loop head 0x423a. So with K5 a timer or SB interrupt lands 3 instructions
    earlier, mid-iteration.
  - The rest (+443..+4703 shifts around 160-165M from 8:7b94/8:4481/8:8c77) are knock-on: SB
    dates follow the guest's DMA programming, so they move once guest state has moved. This
    matches the 162M/168M checkpoint transients. Eventually one such move is visible at 500M
    (S0 frames a066bf27 vs 2fa3dd95).
- **Class:** this is the "residual overshoot" that docs/toyvm-irq-schedule.md:166-176 already
  names for tree-fold (BLIQ): two arms leave one date at different block transfers a few ops
  apart. Its stated fix is a billing/exit question in region-jit.js, not the scheduler.
- **Open detail:** why L1's line reads `at=88900003` (clockAt should be stopAt when atStop,
  dos-loop.js:1795). Either L1's slice was cut to a different date or atStop was false at that
  handback. Read dos-loop.js `step` before any fix.

## Fix direction (not started; shared toyvm source, needs a design note)

Make a region's budget-driven exits land only on edges where the interpreter also tests its
budget. Either the region side exit to 0x4299 must not `$slice_exit` on steps < 0 (continue
through `$jlook` to the interpreter, which stops at its own next transfer), or the region must bill
and test op-for-op like the interpreter at that edge. Test: toyvm-only
test/test-toyvm-region-live.js case. A blend-shaped loop with a forward `jb` side exit, a timer
date placed inside the iteration, and an assertion that L1 and the region arm push the IRQ
in front of the same cs:ip (from `onIrq`). That replaces scene B in
test-toyvm-region-continuous.draft.js.
