# ToyVM: longer runs and background (Worker) region JIT — CLAUDE-TOYVM-LONGRUN-BG, 2026-10-05

Owner: claude-subagent(CLAUDE-TOYVM-LONGRUN-BG). I own this file and `scratch/claude-toyvm-longrun-bg-20261005/`.
I did not edit any shared source, change git state, build the main emulator or open a browser.
I worked independently of the Codex worker audit and did not read it; only its message-board line passed by.

Evidence labels:
- **MEASURED**: from this session's raw runs.
- **READ**: from source at HEAD 16f764ad (`tools/toyvm/` is clean against HEAD).
- **TRANSFERABLE**: measured elsewhere, with the reason given.
- **SPECULATION**: not measured.

## 0. Headline (BRW only; n is tiny, so read it as a smoke, not a benchmark)

1. **The BRW fixture was on this box all along.** It sits in the tracked site bundle
   `docs/dos-corpus/live/programs/1995-c-cma-brw.js`, along with all of core10, DREAM, DRAGON and
   ADDY_II. Locally, L1 reproduces the box frame `a066bf27`. **jit-sepc reproduces the box
   DISAGREE exactly: `500918117/2fa3dd95`**, with **0 drops**. So the BRW bug can now be bisected
   locally. (MEASURED)
2. **Longer runs did not help on BRW.** jit-sep's steady-state rate after its single install is about
   1% *slower* than L1's (≈95.2 vs ≈96.4 M dispatches per wall second). Its CPU ratio falls only
   because fixed cost is diluted: x1.13 at 500.9M, x1.105 at 657.2M, which is BRW's natural end. With
   a marginal ratio of ≥1, no horizon reaches break-even on BRW. This is expected, because BRW's
   region covers only 4.3% of samples (`docs/toyvm-region-live.md:186`). BRW is not a
   counter-example to break-even in general; DREAM (97.5% share) is the program that decides it.
   (MEASURED on BRW; other programs untested)
3. **Background prepare is not background compilation.** About 95% of a pipeline is the **snapshot
   gate** (`benchTiers` timing run): 299–317 ms inline. The WAT→wasm build is about 1.7 ms. The final
   `new WebAssembly.Module` happens on the main thread but costs 0.2–0.3 ms. So jit-sepw can hide at
   most about 0.3 s of main-thread time per install, which is 0.1% of a 300 s run. In exchange it
   pays:
   - a worker isolate: +0.4 to +3.4 s of whole-process CPU;
   - a later, wall-time-dependent install point: 39.6M or 110.8M dispatches, against 12.0M inline.

   (MEASURED + READ)
4. **Continuous mode gets worse with length, not better.** sepc and sepwc double the handback count
   (2.93M and 2.23M against L1's 1.15M). Late in the run the guest moves at about half of L1's
   average rate. Main-thread CPU is x1.88 (sepc) and x1.57 (sepwc). (MEASURED, one rep each)

## 1. Inventory (STEP 1)

| Item | State | Path / evidence |
|---|---|---|
| `/tmp/demos`, `~/dos-demos` | **missing** | `ls` fails. Every `tools/toyvm/bench-set-*.txt` path points at `/tmp/demos/...` |
| DOS fixtures | **present as tracked base64 bundles**: 146 productions | `docs/dos-corpus/live/programs/<slug>.js`, index `docs/dos-corpus/live/programs-index.json`. All core10 entries are there (`1995-c-cma-brw.js`, `1993-a-adrenali.js`, ...), plus `1994-d-dream.js`, `1994-d-dragon.js` and `1994-a-addy-ii.js` |
| Extracted BRW | made this session, no network | `scratch/claude-toyvm-longrun-bg-20261005/fixtures/1995-c-cma_brw/` with `BRW.EXE`, `DIMENSIO.NS`, `DOWNADD.COM`, `COMA.NFO`, `FILE_ID.DIZ`. BRW.EXE sha256 is `65b61f6c…ddfeb4`; the manifest is `fixtures/1995-c-cma_brw.manifest.json`. Extractor: `extract-fixture.js SLUG`. The DOS file lookup is case-insensitive (`tools/toyvm/dos.js:1259`). It reproduces the box L1 frame, which is the authenticity check. |
| Built toyvm module | **none on disk, and none needed** | Each run compiles its own toyvm wasm in memory through `lib/compile-wat.js`, whose `compilePromises` cache is in-process only. There is no `build/toyvm*` and nothing shared to rebuild. The site bundles `docs/dos-corpus/live/toyvm-bundle.js` and `toyvm-jit-bundle.js` exist. `bundle-browser.js --check` is a source-freshness check only, as stated. |
| Box raw logs `sepc30.{txt,json}`, `sep30.*` | **absent locally** | Neither `~/sepc30*` nor `~/sep30*` exists. They are only on bx_xegf6upd (`/home/user/`) per the 88bbcb9f handoff. The 12-program list of that run is not recorded in the repo. |
| Node | local v24.18.1, which has `process.threadCpuUsage`; the box is v20 | See §2.4: on v20 the worker's own CPU is not reported back. |
| Host | 4 cores, load 0.10–1.03 during the smoke | `uptime` before and after each batch |

## 2. What jit-sepw / jit-sepwc actually do (READ, confirmed by MEASURED)

### 2.1 Arm definitions

`tools/toyvm/arm-bench.js:94-104`:
- jit-sepw = jit-sep `{sampleAfter 6e6, profileFor 6e6, gateAt 0, sep: true}` plus `worker: true`.
- jit-sepwc adds `continuous: true, minShare: 5`.

### 2.2 What runs on the worker

`run-dos.js:788` → `region-prepare.js:210 nodeWorkerBackend()`. A `worker_threads` Worker
(`eval`, `unref()`) receives the bundle from `LiveJit.makeBundle()` (`region-live.js:267`). That
bundle carries a full copy of guest memory (`mem.slice()`) and every arena program's words, and it
is structured-cloned to the worker.

The worker runs all of `prepareRegions`: pick, then the **snapshot gate**
(`benchTiers('live', …, {iters: 4000, reps: 2})`, a timed A/B of interpreter against lowering), then
the region WAT → wasm bytes through the JS WATX compiler (`region-sep.js:80 buildRegionModule`). It
does **not** produce a `WebAssembly.Module`.

### 2.3 What stays on the main thread

- `makeBundle` (memcpy, 8–18 ms).
- `installRegionModule` (`region-sep.js:96`): a **synchronous** `new WebAssembly.Module(bytes)` plus
  `Instance` and table writes. Measured `ms.instantiate` is 0.18–0.31 ms. The module is tiny, so
  "the final compile is in the foreground" is true but costs nothing today.
- The run loop does not wait. While the worker is busy it yields one `setImmediate` turn per slice
  (`run-dos.js:837`) and installs when the reply has arrived (`region-live.js` `pump`/`run`).
  **The install point is therefore a function of wall time, not of the dispatch count.** It is not
  deterministic across runs or hosts. Measured: 110.8M in rep 1, then 39.6M and 39.6M, against 12.0M
  for every inline sep run.

### 2.4 Time accounting

- `runDos.cpuSecs` (`run-dos.js:504,947`) is `process.cpuUsage()`, i.e. getrusage(SELF). That
  covers **every thread**: main, the worker, and V8's GC and compile threads. arm-bench's headline
  "cpu vs l1" is therefore whole-process CPU, and the worker's CPU is included.

  MEASURED: sepw cpuSecs is 9.97 s and 7.15 s, against sep's 6.93 s and 6.82 s.
- `buildSecs` for a worker pipeline (`region-live.js:400-402`) is
  `(pipeline wall) − (prepare wall) + ms.workerCpu`. That is the main-thread bundle and install
  wall, plus the worker's own `process.threadCpuUsage`.
  - **On Node v20, which the box runs, `process.threadCpuUsage` does not exist** (it was added in
    the Node 23 line; verify with `node -p "typeof process.threadCpuUsage"` on the box). The worker
    guard `c0 ? … : null` then drops `workerCpu`. buildSecs undercounts, and arm-bench's
    `run = cpu − build` silently charges the worker's CPU to "run".
  - `cpuSecs` stays correct.
  - No worker arm was in the reported 30 s box results, so those are unaffected. (READ)
- `guestSecs` is wall time inside wasm slices. With `cpuMeter` on (off by default), `guestCpuSecs`
  uses `process.cpuUsage` per slice. **In worker mode that charges concurrent worker CPU to the
  guest slice.** It reads 0 in all of these runs because the meter is off. (READ)
- Wall time is recorded (`secs`) but arm-bench never summarises it. Wall is the only axis on which
  background preparation can win.
- arm-bench's JSON keeps only `{phase, installs}` (`arm-bench.js:161`). It records neither the
  install dispatch, nor drops, windows or worker CPU, and it keeps only the **best rep**, not every
  rep. My `probe.js` records all of these.

### 2.5 Continuous plus worker

The same accounting applies, once per pipeline. sepwc ran 26 windows, skipped 8 and installed 16 at
dispatch counts that drifted with wall time. sepc ran 82 windows, skipped 49 and installed 16, all
at multiples of 6M.

**The two arms installed different region sets** (`jit.at`):
- only sepc: 31636 and 60162;
- only sepwc: 45494 and 17254.

## 3. Smoke results (STEP 2): MEASURED

- Board CLAIM at 00:40:15Z and RELEASE at 00:42:44Z. No runtime holder was active, and the Heroes II
  idle-map check had not claimed.
- 81 s of wall time in total, as 3 serial batches of fresh node processes, under `/usr/bin/time -v`.
  `pgrep` was clear afterwards.
- Raw output for every run is in `scratch/claude-toyvm-longrun-bg-20261005/runs/<ISO>-<arm>/`:
  `command.txt`, `stdout.txt` (`[jit@]` event JSON lines plus `PROBE` totals), `stderr.txt`,
  `time.txt` and `result.json`.
- Console summaries: `smoke-console{,-2,-3}.txt`. Harness: `smoke.js`, plus `probe.js`, which uses
  the same `runDos` options as arm-bench's child, with the arm options copied verbatim.

Column key: wall, cpu, main and other are in seconds; "other" is process CPU minus main-thread CPU.
"build" is LiveJit.buildMs, also in seconds.

| Budget | Arm | Dispatched / frame | wall | cpu | main | other | installs @ dispatch | build | handbacks | vs L1 |
|---|---|---|---:|---:|---:|---:|---|---:|---:|---|
| 500918116 | l1 | 500918120/a066bf27 | 5.55 | 6.10 | 5.81 | 0.87 | – | – | 1,147,541 | ref |
| | l1 #2 | same | 5.52 | 6.06 | 5.79 | 0.83 | – | – | 1,147,541 | null band ≈0.5% wall, 0.7% cpu |
| | sep | same | 5.94 | 6.93 | 6.16 | 1.35 | 1 @12.0M | 0.35 | 1,147,825 | AGREE |
| | sep #2 | same | 5.93 | 6.82 | 6.18 | 1.25 | 1 @12.0M | 0.33 | 1,147,825 | AGREE |
| | sepw | same | 6.03 | 9.97 | 6.27 | 4.29 | 1 @**110.8M** | 1.79 (worker 1.77) | 1,147,707 | AGREE |
| | sepw #2 | same | 5.69 | 7.15 | 5.94 | 1.85 | 1 @39.6M | 0.44 (worker 0.41) | 1,147,810 | AGREE |
| | **sepc** | **500918117/2fa3dd95** | 10.72 | 13.15 | 10.91 | 2.84 | 16, 0 drops | 2.85 | **2,927,857** | **DISAGREE** (same as box) |
| | sepwc | 500918120/a066bf27 | 8.92 | 16.40 | 9.12 | 7.88 | 16, 0 drops | 3.77 | 2,233,259 | AGREE (one rep; not a pass) |
| 1001836232 | l1 | **657240588**/38c165c5 (program ended) | 7.23 | 7.82 | 7.51 | 0.89 | – | – | 1,514,791 | ref |
| | sep | same | 7.72 | 8.65 | 7.96 | 1.30 | 1 @12.0M | 0.33 | 1,515,257 | AGREE |
| | sepw | same | 7.56 | 9.11 | 7.82 | 1.85 | 1 @39.6M | 0.43 | 1,515,242 | AGREE |

Notes:
- **Box versus local.**
  - The box ran 500.9M in 18.9 s of L1 CPU. Locally it took 6.1 s, so this box is about 3x faster
    at equal work. "30 s of L1" means very different dispatch counts on the two hosts, so always
    quote counts.
  - Local L1 ends at 500918120 against the box's 500918116: Δ4, same frame, within OVERSHOOT 64.
    The cause is unknown; the Node version is v24 locally and v20 on the box.
- **The steady state does not beat L1.**
  - jit-sep after its install at 12.0M runs at 645.2M / 6.92 s ≈ 93.2 M/s, against L1's ≈ 95.5 M/s
    over the same span.
  - At 500.9M the figures are 95.2–95.3 against 96.2–96.6 M/s.
  - L1's time to 12M is taken as 0.46–0.47 s, the guest-identical prefix from the sep timeline.
  - Wasm slice time is equal (`guestSecs` 3.24–3.26 for sep against 3.25–3.28 for L1). About 40% of
    L1's wall time is host-side handback work that a region cannot touch.
- **The sep gate dominates sep's build.** `ms.gate` is 299–317 ms of the 307–345 ms pipeline. The
  region build is 1.6–1.7 ms. Inside the worker the gate took 403–1743 ms. The 1.7 s first run came
  with 2.5 s of system time, which suggests a cold isolate and clone cost (SPECULATION; one cold
  sample).
- **Background helped wall time in 2 of 3 runs, by about 0.25 s, and hurt in 1.**
  - Main-thread CPU: sepw 5.94, 6.27 and 7.82 s against sep 6.16–6.18 and 7.96 s. That is up to
    ≈ −0.2 s, the size of the gate it offloads.
  - Whole-process CPU is always higher, by +0.3 to +3.0 s.
  - All of this is within one or two reps, so no claim.
- **BRW in continuous mode.**
  - The DISAGREE is reproduced with `drops 0`, so **hypothesis 1c of the BRW notes (uninstall =
    whole-cache flush) is not needed for the failure**: no uninstall happened.
  - Handbacks are 2.5x L1's in sepc, and smcBreaks differ (18590 against 18594). Both point at
    install-side cache/handback perturbation (hypotheses 1a, 1b and 1d) or at one of the regions
    unique to sepc (31636 or 60162).
  - These are leads, not conclusions. I did not bypass the frame check or bisect further.

## 4. Analysis

### 4.1 Do longer runs break even?

- **The arithmetic (READ / TRANSFERABLE).**
  - An arm with fixed cost B and steady-state cost ratio m runs at `R(S) = m + B/(S·r_L1)`.
  - Longer runs only push R toward m. Break-even needs m < 1, so the question is entirely about
    the steady state.
  - The upper bound on 1 − m for a region arm is about `share × (1 − 1/gate) × (slice share of wall)`:
    - BRW: 0.043 × 0.6 × 0.59 ≈ **1.5%**. Measured: −1%. Consistent with no gain.
    - DREAM: 0.975 × 0.56 × slice share, which could be tens of percent on paper.
  - Yet DREAM measured −2.7% at 12M in `docs/toyvm-region-live.md:189`, and the box diagnosis is
    "region bodies are call-bound (~30 helper calls per body, nothing inlined)".
- **Status:**
  - **Refuted for BRW** (MEASURED, n = 2 + 1).
  - **Untested for DREAM, DRAGON (47.5%) and ADDY_II (27.5%, +21% at 12M)**, the only programs
    where the ceiling permits a win.
  - The box's 30 s geomean of x1.18 with run x1.089 says that across 11 programs m ≈ 1.09 on the
    box (TRANSFERABLE: same arms, other host). If that holds, no horizon breaks even on the corpus
    geomean.
- **Continuous mode cannot break even by length.** Its m is above 1 and grows: 2–2.5x handbacks
  and about half of L1's rate late in BRW. Every new scene adds roughly a 130 ms gate pause plus
  more handback-generating region boundaries. (MEASURED on BRW, one rep each)
- **Runs are bounded by the program anyway.** BRW ends at 657.2M dispatches. That is about 7.5 s of
  L1 here and about 25 s on the box, so "120 s / 300 s of L1" on BRW is impossible.
  `arm-bench --l1-seconds` silently keeps the ended count. Every long-run program must be checked
  for natural length first.

### 4.2 Does background compilation help?

- **What is actually offloaded is the gate (READ + MEASURED), not compilation.** Its
  main-thread-equivalent is about 0.3 s per pipeline. For a one-install arm (sep), the most that
  background preparation can save is that 0.3 s once, i.e. 0.1% at 300 s. It **cannot matter at
  long horizons by construction.**
- **It only has room in continuous mode,** where pipelines recur (16 × ~130 ms ≈ 2.1 s on BRW).
  - Continuous mode is blocked by the BRW correctness bug, and its steady state is slower anyway.
  - sepwc used 9.1 s of main thread against sepc's 10.9 s. However, sepwc installed a different
    region set, at different times, with fewer windows. That is not a like-for-like comparison and
    the rows cannot be compared (one rep each).
- **The costs are real:**
  - a second isolate that loads the whole toyvm and compile-wat JS;
  - a structured clone of guest memory per pipeline (the high system time is SPECULATION about the
    cause);
  - more whole-process CPU every time;
  - and a **nondeterministic install point**, which makes worker arms unfit for exact frame parity:
    an agreement on one run says nothing about the next.
- **Cheaper alternatives that need no thread (SPECULATION, not measured):**
  - Shrink the gate (`gateIters` 4000 × reps 2), since it is 95% of the pipeline.
  - Or skip the timing half of the gate when `gateAt: 0`. The arms already install whatever the
    ratio is, so the timing run decides nothing in arm-bench. Only the correctness half (regs and
    memory compare) matters.
  - This would be a **new variant**: it needs the §5.6 checks and an owner, and it is not done here.

## 5. Proposed experiment (STEP 3): "equivalent L1 work" at 30 / 120 / 300 s

### 5.1 Host and isolation

- Run on the quiet bench box: bx_xegf6upd x86-64, or ascii.dev per memory
  `reference_ascii_bench_box`. This shared laptop/box is not suitable.
- Upgrade node to ≥ the local v24, or record the version. On v20, `workerCpu` is missing (§2.4).
- Record `uptime` per run. Run nothing else on the box.
- Fixtures come from the tracked bundles via `extract-fixture.js`. No downloads.

### 5.2 Fixed work from one run, not three

1. Run L1 once per program with a wall stop at 300 s of L1 CPU and checkpoint stamps. Use
   `probe.js`, extended with an `afterSlice` stamp of `{dispatched, wall, procCpu, mainCpu}` every
   slice, or a one-line patch-free hook as `brw-probe.js` does.
2. Define the work counts from that run: N30, N120 and N300 are the dispatch counts L1 reaches at
   30, 120 and 300 s of process CPU.
3. Run every other arm to N300 with the same stamps. R(30), R(120) and R(300) come from the **same
   run** at the first slice end ≥ N_S. That makes three horizons cost one run per arm instead of
   three.
4. Compute the marginal ratio as m = ΔCPU_arm(N30→N300) / ΔCPU_L1(N30→N300).
5. Frame parity can only be checked at N300 (end of run).
6. If a program **ends** before N300, it is reported as "natural length X s" and contributes only
   the horizons it reaches.

### 5.3 Panel

| Program | Why | Region share at 12M |
|---|---|---:|
| DREAM | best case | 97.5% |
| DRAGON | | 47.5% |
| ADDY_II | positive at 12M | 27.5% |
| CONTAGIO | +67.6% at 12M | 7.2% |
| BRW | parity canary, at natural length only | 4.3% |

Region shares are from `docs/toyvm-region-live.md:180-189`.

### 5.4 Arms, in separate invocations

- **Invocation A (exact arms):** `l1, l1#2, jit-sep, jit-sepw`. jit-sepw always reports its install
  dispatch.
- **Invocation B (continuous, cost only):** `l1, jit-sepc, jit-sepwc`.
  - Run it separately because arm-bench drops a whole program row from **every** arm's summary when
    any arm disagrees. sepc's BRW DISAGREE would otherwise erase BRW from A's summary.
  - Its numbers are cost-only and inadmissible for exact-work claims until the BRW bug is fixed.

### 5.5 Repetitions and budget

- Repetitions: 1 for every arm, with l1#2 as the null band. Run a second rep only for a program whose
  effect is within twice the band. Rotate arm order per program, as arm-bench does.
- Budget for invocation A (4 programs × (L1 calibration with stamps, 300 s, plus l1#2, sep and sepw
  at ≈ 300–330 s)):
  - ≈ 4 × 1,260 s ≈ **84 min**;
  - plus BRW at natural length, 4 arms × 2 reps at ≈ 25 s ≈ **3.5 min**.
- Invocation B: ≈ 4 × 3 × 330 s ≈ 66 min. **Optional**; I recommend skipping it until BRW is fixed.
- **Cheaper first cut (recommended): 30 / 120 s only.**
  - A: 4 × (120 + 3 × 125) ≈ 33 min.
  - Plus BRW, 3.5 min.
  - Total ≈ **37 min**.
  - Escalate to 300 s only if some program's m at 30→120 is below 1 − 2 × band.

### 5.6 Admission checks, applied before any number is read

1. **Installs actually happen.**
   - `jit.installs ≥ 1` and `phase == 'installed'`.
   - The install dispatch is < N30. For sepw, record it every rep; it moves with wall time.
   - The installed head is the same as the inline arm's (`jit.at`).
   - A row with 0 installs or a decline is reported as "no install", never averaged.
2. **BRW parity.**
   - sep and sepw must AGREE with L1 on BRW at natural length in every rep. Smoke: 3 of 3 each.
   - Agreement in sepw must hold across reps despite the moving install point.
   - Any sepc/sepwc number is labelled "cost only, known DISAGREE (`500918117/2fa3dd95`)".
   - Do not loosen OVERSHOOT and do not skip the frame check.
3. **Accounting.**
   - Report three CPU columns and wall: process, main thread, process minus main, and wall.
   - Report worker CPU (`ms.workerCpu`) separately, and refuse a worker row whose `workerCpu` is
     missing.
   - Keep every rep's raw output, not arm-bench's best-of.
4. **Native disassembly** (CLAUDE.md "Optimization variants").
   - The experiment measures existing arms, so no new variant is introduced.
   - However, the call-bound diagnosis that m rests on still lacks x86-64 captures of the region
     module and V8/SpiderMonkey captures of the sep variant (88bbcb9f "Next steps" 4). Take
     `tools/wasm-native.js --engine=v8` and the SpiderMonkey capture of one DREAM region function,
     on the box (x86-64) and the laptop (arm64), with module hash, engine version and tier recorded.
     Do this before quoting m as "call-bound".
   - Any new variant arising from this work (compiled-Module transport, gate-less install, inlined
     helpers) needs both engines' disassembly against its control before its benchmark is quoted.

### 5.7 What refutes what

- **"Longer runs break even" is refuted** if, on every program in the panel, m ≥ 1 − (L1 null band)
  for jit-sep, i.e. the steady state is not faster than L1. In that case no horizon breaks even, and
  R(300) only approaches m from above.
  - It is supported only if some program has m < 1 − 2 × band **and** R(S) < 1 at a horizon that
    program actually reaches, with BRW parity intact.
- **"Background compilation helps" is refuted** if, at every horizon, jit-sepw's **wall time** is not
  below jit-sep's by more than the band (whole-process CPU is expected to be higher regardless).
  - It is also refuted if sepw's later install point costs more steady-state time than the gate it
    hides, i.e. main-thread CPU(sepw) ≥ main-thread CPU(sep).
  - It is supported only with an equal installed head, BRW parity across reps, and a wall-time win
    above the band on a ≥ 2-core quiet host.
  - On BRW the predicted size is ≤ 0.3 s, which is ≤ 1% at 30 s. That is likely below the band, so
    a null result at 120/300 s is the expected outcome for one-install arms.

## 6. Risks

- **BRW.** The continuous-mode DISAGREE is real and reproducible locally. Do not average continuous
  arms into any claim.
  - The bisect path is in `scratch/claude-orchestrator-20261004/toyvm-brw/notes.md`. It is now
    runnable here, because the fixture comes from the bundle and the full run is about 11 s.
  - First discriminators:
    - sepc with the two sepc-only regions (31636, 60162) excluded;
    - `--lattice-clock` in both arms;
    - `--step-audit`;
    - slice-log diff against L1.
  - sepwc agreeing once is **not** evidence of a fix. Its install points and region set differ.
- **Accounting.**
  - Whole-process CPU includes V8 background threads: L1 already has 0.83–0.89 s off the main thread.
  - The worker's CPU is missing on Node v20.
  - `guestCpuSecs` is contaminated in worker mode when the meter is on.
  - arm-bench keeps the best rep only and records neither the install dispatch nor wall time in its
    summary.
- **Overlap and determinism.**
  - Worker install points depend on wall time and box load. Two runs of one command are different
    runs, so parity must be rechecked per rep.
  - On a loaded box the worker competes for cores, and its "background" is not free.
- **Program length.** Long horizons are bounded by natural program length (BRW 657.2M). Some panel
  programs may end before 300 s, so check before budgeting.
- **Host differences.** The local box is about 3x the speed of bx_xegf6upd. Quote dispatch counts
  and ratios, never seconds, across hosts.
- **Unexplained.** sepw rep 1 had a 1.74 s gate and 2.5 s of system time, against about 0.4 s in the
  other two reps.

## 7. Files

- `ops/handoffs/claude-toyvm-longrun-bg-20261005.md` (this file)
- `scratch/claude-toyvm-longrun-bg-20261005/`:
  - `extract-fixture.js`, `probe.js`, `smoke.js`
  - `fixtures/1995-c-cma_brw/` and its `.manifest.json`
  - `runs/<ISO>-<arm>/` × 11
  - `smoke-console*.txt`, `smoke-summary-*.json`
