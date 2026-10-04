# Three-game performance review: Diablo II demo, Heroes III demo, Warcraft III demo (2026-10-04)

Task CLAUDE-THREE-GAME-PERFORMANCE-REVIEW. Source and evidence review only: no runs, builds,
browsers or tests were used. Tree: HEAD `16f764ad` with shared dirty WIP; `build/wine-assembly.wasm`
sha256 `f40d4ca3…` (not rebuilt). The list of what was read is in
`scratch/claude-three-game-performance-review-20261004/sources.md`.

Evidence labels:
- **MEASURED**: cited artifact, with date and host where the source gives them.
- **TRANSFERABLE-MEASURED**: measured on another app or on ToyVM. The reason it should or should not
  transfer is given each time.
- **SPECULATION**: not measured.

No FPS is inferred from block, present or batch counts anywhere below.

**Trap to avoid:** `docs/uop-tier-design.md` §8 and §11 have rows for both **"Diablo"** and
**"Diablo II"**. "Diablo" there is the **Diablo I shareware** (`diablo` route), not D2. Several famous
numbers belong to D1 and were never measured on D2: the PeekMessage scan at 13.8%, the stack/call
share at 43.4%, and 28.4% tier coverage.

No saved per-game handler-hist JSON, cpuprofile or page-probe JSON for these three games exists in
`scratch/` or `build/`. The box outputs the docs cite are not on this machine. Every number below
comes from docs, memories or commit messages.

---

## 1. Where the time goes, per game

### Diablo II demo

**Routes.** The registered `diablo2_demo` route is **Direct3D** (`Render=1`, `lib/apps.js:3368-3397`).
`diablo2_glide_demo` is `Render=3`. The big profiling work in `diablo2-demo.md` (hot-loop census,
H418/H431 folds, Chrome CPU profile) is on the **8bpp d2gfx/d2ddraw software path**. Its date is
mid-September 2026, which is before the uop tier (2026-09-27) and before LUT_SPAN was retired. The
D3D route has **no CPU profile at all**.

| Area | What is known | Level |
|---|---|---|
| Pacing (browser) | 2026-09-27, headful, Worker backend, Act I town. The clock-spin park K=8 gave **4 fps**; with K=0, **41 fps**. That was about 720 parks/s on `GetTickCount` at exe `0x4293c0`, once per object. | MEASURED (memory `project_d2_clock_spin_false_positive`) |
| Pacing fix | c6e27758 (2026-09-28) added `$spin_work_max=64`. A read counts toward a spin only if fewer than 64 blocks of work ran since the previous one. The commit says it targets exactly this D2 site. **No browser re-measurement of D2 after the fix was found.** | MEASURED fix exists; effect on D2 unverified |
| Menu limiter | 25 fps QPC/PeekMessage spin in d2win `0x1000b670`. Since 32ad292e it parks. Menu dwell, box3, `--branch-clock`: user CPU **-12% / -15%**; 99.7% of route API calls were this loop. Gameplay: 249 vs 251 `GetTickCount` parks per 630 gameplay batches, and gameplay CPU per flip is unchanged (71-75 ms, headless). | MEASURED (`diablo2-demo.md:996-1122`) |
| Interpreter | uop tier on the `d2` route: whole run **-3.5%** (laptop, 2026-09-27, off-vs-off nondeterministic). Trace heads: **+0.1%** (box1, inside the band). H3 gained -41% to -53% on its gameplay slice under the same tier. D2 is either poorly covered or not interpreter-bound on that route. **No D2 `--uop-census` exists.** | MEASURED (`uop-tier-design.md:296,1224`); cause SPECULATION |
| Software-path profile (pre-uop) | Chrome headful: `$next` 22.4%, all wasm 91%, H431 1.97%, H418 0.32%. Per-present buckets: tile bodies 14.5%, light grid 9.9%, object traversal 9.3%, CEL 8.6%, collision 6.6%, outside named ranges 42.7%. | MEASURED, stale (pre-uop, DirectDraw path, load 8-14) |
| Threads | T2 is the Storm MPQ Huffman/ADPCM worker: 56.4M handlers per 50 batches, against main's ~1.61M/batch (pre-uop). T1 (Fog) is parked; T3 (sound) is tiny. The upper bound for real overlap of main and T2 is about 1.7x, written as a ceiling, not a forecast. | MEASURED counts; ceiling is an estimate |
| Renderer/present | Headless D3D menu: host present about **8.8 ms per Flip**, about 127 s of a 347 s run. That is CLI harness JS and says nothing about the browser. | MEASURED (CLI only) |
| Audio | No cost evidence. The Glide menu observation (2026-10-04) shows producer activity only. | none |
| Determinism | The Act I load is nondeterministic, even off vs off. **D2 A/Bs cannot use frame equality** and must use `--branch-clock` plus counters. | MEASURED |

### Heroes III demo

**Route.** DirectDraw RGB565 adventure map. The CLI route is `h3` in `tools/uop-game-ab.js`, gameplay
batches 4100-5101 (`--batch-size=200000 --thread-slices=1 --tick-ms-per-batch=100`). In the browser
(restored17, 2026-10-03, wasm `4aa1915e…`), the run selected a path but no hero movement was captured.

| Area | What is known | Level |
|---|---|---|
| Interpreter, main (T0) | uop tier: gameplay slice **-52.9%**, user **-5.2%** (box, 2026-09-28, frames identical). Tier share of main block entries is 77% (§11) and 87-90% of all entries (§15). Trace heads: user **-7.7%**. | MEASURED |
| CPU split (gameplay window, 12.6 s user, pre-predecode) | Threaded 30.9%, uop 19.3%, x87 21.3%, wasm other 10%, g2w/gl32/gs32 8.4%, decode/cache 5.2%, harness JS 4.7%. | MEASURED (§11.2), partly stale |
| x87 | All on **T1** (start `0x8414a0`, "presumably the Miles mixer worker", not confirmed): 47% of T1's dispatches. Changes and their effect on user CPU: x87 fold -4.3%; island predecode (88d8da6b) **-5.8%**, island incl. 14.0% → 8.5%; mixed int/x87 islands +0.02% (no gain). | MEASURED |
| Remaining threaded main | Switch `exe+0x47227c jmp [0x472a9c+ecx*4]`: **1.3% of all entries, always the same arm** (§15). It was about 31% of T0's untaken entries in §11. Poor programs 2.9-3.6%, head-unsupported 1.4-1.7%. | MEASURED |
| Call-headed heads | Under `--uop-icall`, the nocall retry declines 4 call-headed heads: **-15.7M enters, -51.5M program blocks**, threaded ops +22.8%. The plain uop arm also takes the retry (386 scan-limit retries); what that costs there is **unmeasured**. | MEASURED (§23.7) |
| Decode | 533K → 40.6K decodes after `$fuse_stop`. 5,033 decodes in the gameplay window; 94% of batches are decode-free. Not a lever. | MEASURED |
| Pacing | Frame-pacing census: **TIMER_PACED** with a real `Sleep` in the loop (Sleep 134, timeGetTime 622, QPC 533 in the steady window). **No browser pacing or walk-time measurement exists.** | MEASURED (CLI census); browser unknown |
| Audio | Miles `WOM_DONE` callbacks are pumped at slice boundaries. A run-loop resume bug here was fixed. The cost is the T1 work above. In a real-time browser, audio work per second is fixed by the sample rate, so the fixed-batch CLI share may overstate it. | MEASURED mechanism; browser share SPECULATION |

### Warcraft III demo

**Route.** `-opengl -window` (`lib/apps.js:3640-3651`). The CLI uses `--headless-gl` or
`--gl-renderer=software`. The browser uses WebGL through the render Worker, with the guest main thread
in a Worker by default. The `wc3g` gameplay route (Prologue HUD, batches 19170..21530) is
**CLI only**.

| Area | What is known | Level |
|---|---|---|
| Gameplay CPU split (`wc3g`, 26.4 s user window, 2026-09-28) | Threaded 43.4%, uop 4.1%, x87 13.3%, wasm other 16.6%, **g2w/gl32/gs32 12.4%** (the highest of five games), decode 8.3%, **GL 0.2%** (headless GL). | MEASURED (§11.2), partly stale |
| Audio thread | The Miles audio thread ran **~1.29G threaded dispatches, about 2x main**. Two Mss32 resampler blocks are 54% of its entries. Since then, moffs lowering (156a367b) puts **432M of its blocks in the tier against 90M**, and WC3 software-GL whole-run user CPU dropped **-17.2%**. | MEASURED (§10, §11) |
| Other tier wins | Island predecode **-5.9%**. Trace heads **-4.8%**. uop vs off on gameplay: -13% (software GL) and -20% (headless GL). | MEASURED |
| Main-thread remainder | **No-verdict 24-26% of all entries** (call-return landings and fallthroughs inside called functions). No-backedge 5.5-6.5%. Indirect calls at most 0.64% of entries, so an inline cache cannot pay. | MEASURED (§15) |
| Decode/cache | Page-index 128→512, directory 4096, second chance: gameplay decodes **-97%**, guest ms/batch 5.86 → 2.43, map load now about 12,000 batches. | MEASURED (`warcraft3-demo.md:2065-2123`) |
| Map load | No hot loop: no region holds ≥5% of entries in all 11 windows. **ijl15 (Intel JPEG) is 29.41% of block entries, weighted** (2026-09-14, pre-uop, pre-cache fix). A free `ijlRead` would therefore cap the load speedup at about 1.4x. | MEASURED share, stale; cap is arithmetic |
| VirtualAlloc window widening | Re-guards 32.4M → 21.5M, user **0.0%**. | MEASURED (§14) |
| Browser / threads | Worker mode reached the menu with **about 1.9x fewer API calls at the same wall time** (2026-09-14). Ruled out: spins, RPC, DX. Cause open. Software GL on the render Worker: WC3 menu **-16%** wall at equal CPU (2026-09-24). | MEASURED, stale |
| Browser correctness blocker | 2026-10-03, default Worker main: after the profile screen, edit/Create/Cancel input got no response. Main was waiting INFINITE on handle 919572 with input queued. **No browser gameplay, so no browser perf data is possible yet.** | MEASURED (`scratch/runs/20261003-warcraft3-profile-stall/`) |

---

## 2. ToyVM: latest results and what transfers

**Latest arm results.** Ratios are CPU time vs L1; above x1 means **more** CPU than L1.

- **Region JIT, 2026-10-02.** Box x86-64, node 20, about 30 s of L1 per program, 12 programs,
  geomean over 11 clean
  ([`claude-migration-toyvm-uop-88bbcb9f.md`](claude-migration-toyvm-uop-88bbcb9f.md)):
  - jit-early: CPU **x1.164**, run x1.079, build 7.2%
  - jit-sep (b0f38372): CPU **x1.181**, run x1.089, build 7.6%. Build on DREAM went 1.4 s → 13 ms.
  - jit-sepc (deddbe2b, continuous): CPU **x1.468**, run x1.238, build 15.0%
  - Diagnosis: region bodies are **call-bound**, about 30 helper calls per DREAM region body, and
    neither Ion nor TurboFan inlines any of them. Per-iteration run time is not below L1.
- **µop arms, 2026-09-30.** corpus12 at 30M, all clean (`uop-baseline-tier-design.md:1084-1103`),
  CPU for the two corpus halves:

  | arm | CPU (first half) | CPU (second half) |
  |---|---|---|
  | uop | x2.07 | x1.97 |
  | jit | x2.66 | x2.61 |
  | only (allRP) | x10.0 | x5.98 |
  | only-naive | x3.82 | x2.87 |
  | only-n1k | x5.83 | x3.97 |

  - The slice time of uop and jit matches L1 (x0.95-1.06). The remaining ~0.7x of L1 is host
    overhead that is neither build nor slice, and it is unmeasured.
  - A further 18% µop cut moved run time **0%** (76bd3091).
- **Bottom line.** At these budgets **no ToyVM arm beats L1 on CPU**. The older positive results are
  narrower:
  - the hot-loop engine shape at about 3x per x86 instruction (2026-09-22);
  - an 80-installing-program µop geomean of x0.92 (V8).

**Open correctness issues that block region-JIT work**
(`scratch/claude-orchestrator-20261004/toyvm-brw/notes.md`):

- **BRW in jit-sepc:** 500918117/2fa3dd95 against L1 500918116/a066bf27. The +1 dispatch is within
  arm-bench's 64 tolerance; the failure is the **frame hash**.
- **BRW in only-naive:** the same +1/frame signature at 491.78M, with no region JIT at all.
- **Leading hypotheses:**
  - a per-install ≤1-dispatch drift multiplied by about 8 continuous installs;
  - uninstall flushes the whole cache;
  - precompiling other heads changes SMC/volatility learning;
  - a shared host clock leak that both arms expose.
- The lattice clock that removes per-install drift is opt-in, because it re-times six programs by
  itself.
- **Not reproducible here:** BRW.EXE is not on this machine.
- **Consequence:** continuous mode and any long-run exactness claim are blocked. The page ships region
  JIT on with the gate at 12M (20/20), not at long budgets.

**Transfers to the main emulator**

| ToyVM finding | Transfer | Level |
|---|---|---|
| One-function `br_table` loop beats threaded tail calls about 3x. The cost is function entry (11 vs 33 native instructions per transition), not branch prediction. | **Already applied**: `$uop_fast` is call-free (§8), and Ion keeps pc in a register. Branch replication for prediction is dead in both. | TRANSFERABLE-MEASURED (done) |
| Host calls in the loop make Ion spill loop-carried locals. TurboFan does not. Fix: `callSafe`. | Any new uop op that calls a helper from `$uop_fast` re-creates the spill on SpiderMonkey. Recheck with `wasm-native.js` on **both** engines for every new op. | TRANSFERABLE-MEASURED |
| Region bodies are call-bound: no helper is inlined. | Same V8 budget story as the main emu (`project_v8_wasm_inlining_budget`, about 8%). Hand-inline hot leaves as macros, as `read-thread-word` and `dispatch-next` already do. | TRANSFERABLE-MEASURED |
| µop count and load count are not time (µops -18% flat; LVN loads -28-42% flat on 4 of 5 programs). | Do not justify main-emu tier work by dispatch or handler counts. Price it in user CPU at fixed work, plus native disassembly. | TRANSFERABLE-MEASURED |
| Resident regs: a narrow store followed by a wide load of the same slot does not store-forward (x1.08 slower). | The main emu's `$set_reg8` is an `i32.store8` into REGFILE followed by 32-bit `$get_reg` loads, so the same hazard exists. It was already priced net-positive (sub-word -2.92% on StarCraft). A uop-program-local fix (rename narrow-written regs to a temp, merge at exit = allRP) is **SPECULATION** for the main emu. | TRANSFERABLE-MEASURED hazard; payoff unknown |
| Build/compile cost dominates short runs; one allRP build costs about L1's whole 100M run. | The main emu's H3 boot is +5% from 12,730 compiles and 11,869 poor kills. Same class; the cold-tier lesson (cheap naive first) transfers if boot or scene-change churn matters. | TRANSFERABLE-MEASURED class |
| Clock exactness: billing tied to cuts and handbacks changes frames (BRW, 3 leaks). | This is why main-emu A/Bs need `--branch-clock`. D2's nondeterministic Act I load is the main-emu case: compare counters, not frames. | TRANSFERABLE-MEASURED method |
| Exact spin folding (PSPIN / general port spin; guest time geomean x0.658, exact). | Main-emu clock spins are *parked* through host timers instead. The browser problem is wake latency (H2), which exact folding avoids by construction. | TRANSFERABLE (idea, not measured in the main emu) |
| Region JIT / runtime wasm codegen | **Does not transfer.** The user ruled out runtime wasm codegen in the Win98 emulator (`feedback_no_runtime_wasm_codegen`, 2026-09-10). ToyVM's own numbers do not argue for reopening it (CPU x1.18 on 30 s runs). | — |

---

## 3. Ranked ideas per game

Field order for each idea:
- **Mechanism**
- **Evidence:** label
- **Payoff:** tied to a measured share
- **Risk:** correctness risk
- **Experiment:** the smallest falsifiable experiment, with what would refute the idea
- **Missing:** the measurement that does not exist yet

### Diablo II

**1. Re-measure browser pacing on the current build before any CPU work.**
- **Mechanism:** the spin_work_max fix may have closed the 4→41 fps gap. The H2 finding (each 1 ms
  park wakes after about 3.8 ms because of the nested `setTimeout` clamp) may still tax the QPC menu
  limiter and the GetTickCount gameplay limiter.
- **Evidence:** TRANSFERABLE-MEASURED (H2 2026-10-04; D2 2026-09-27, pre-fix).
- **Payoff:** unknown now. The pre-fix gap was 10x.
- **Risk:** none (measurement only).
- **Experiment:** headful Chrome, Act I town, one browser at a time. Three arms toggled live at the
  same scene: default, `set_spin_park_k(0)`, `set_spin_work_max(0)`. Record:
  - `get_clock_spin_parks` per second and yield-14 ends;
  - distinct displayed frames per second;
  - main busy %.

  **Refuted if** parks are under about 10/s and the K=0 arm leaves distinct frames per second
  unchanged.
- **Missing:** any post-c6e27758 D2 browser number, on either the D3D or the Glide route.

**2. Produce a uop coverage census on the D3D gameplay route.**
- **Mechanism:** D2 gained only -3.5% from the tier, against H3's -53%. The likely cause is that hot
  code is call-chain or straight-line code with no back edges, as on D1 and Storm, but that is
  unverified.
- **Evidence:** SPECULATION. D1 analog: MEASURED 28.4% tier share, 43% of the threaded remainder in
  stack/call.
- **Payoff:** unknown until census.
- **Risk:** none.
- **Experiment:**

  ```
  node tools/uop-game-ab.js --games=d2 --arms=uop --extra='--uop-census --handler-hist-thread=0,0,0 --hist-json=…'
  ```

  then `tools/uop-census.js`. Read the tier share and the verdict mix for main and for the Storm
  thread (`--thread=`). **Refuted (as an interpreter lever)** if main tier share is ≥70%. In that
  case D2 is host, renderer or pacing bound.
- **Missing:** this census, and a `--cpu-prof-window` profile of the D3D route.

**3. Calls in the tier: the nocall retry ladder, then call/ret traces.**
- **Mechanism:** same as H3 #1 below, plus §11 idea 7 (push/pop/call/ret, shallow callee inlining).
  This is only worth doing if #2 shows call-shaped declines.
- **Evidence:** MEASURED on H3 and D1. SPECULATION for D2.
- **Payoff:** the D1 estimate was -10-20% if half the call chains convert. Unknown for D2.
- **Risk:** high for call/ret (ESP stores under the SMC guard, exact faults). Medium for the ladder.

**4. Storm worker (T2) overlap in the browser.**
- **Mechanism:** MPQ Huffman/ADPCM runs on T2. In cooperative mode it shares the page's main thread.
- **Evidence:** MEASURED counts (pre-uop). The threads-sweep "diablo" rows are D1, not D2.
- **Payoff:** ceiling about 1.7x for the combined guest phase. Realistic: unknown.
- **Risk:** Worker-mode waits. The Storm 255 ms wait fix exists.
- **Experiment:** browser cooperative vs `?threads` at the same town scene. Record distinct frames per
  second and per-instance blocks per second (page probe). **Refuted** if Worker is not faster in
  distinct frames per second, as it was not for D1/StarCraft/Quake II.

**5. D3D present path cost in the browser.**
- **Mechanism:** headless spends about 8.8 ms of host work per Flip. The browser equivalent is
  unknown.
- **Evidence:** MEASURED, CLI only.
- **Experiment:** the WinePerf `snapshot()` phase split (guest/threads/paint) over 20 s of town play.
  **Refuted** if paint is under 5% of step time.

### Heroes III

**1. Fix the nocall retry: retry with icall-only, then halve, then nocall, and never decline a head
whose own instruction is the call.**
- **Evidence:** MEASURED loss under `--uop-icall` (4 heads, 15.7M enters, 51.5M blocks). In the
  default uop arm the same retry fires (386 scan-limit retries); its loss there is **unmeasured**.
- **Payoff:**
  - with icall, recovering the +22.8% threaded ops;
  - without icall, unknown.
- **Risk:** medium. The WIP branch commit ec2bf87c has two unit cases that may fail under ladder
  mask 7 (`movsd-nfs-record-loop`, `nobump-mark`).
- **Experiment:**
  1. Run `test/test-uop-compiler.js` on base vs ec2bf87c (seconds).
  2. Then

     ```
     uop-game-ab --games=h3 --arms=uop,uop+ladder --extra=--uop-census
     ```

     and `uop-census-diff.js`.

  **Refuted** if, in the default (non-icall) arm, enters and program blocks change by less than 1%
  and user CPU stays inside the band.
- **Missing:** the per-head cost of the retry in the default arm.

**2. Browser pacing check on the adventure-map walk.**
- **Mechanism:** H3 paces with real `Sleep`, and the sibling H2 was 5x slow on walk because of
  park-wake clamping. A `Sleep(1..n)` on the browser path may round up the same way.
- **Evidence:** TRANSFERABLE-MEASURED (H2) plus MEASURED Sleep-in-loop (census).
- **Payoff:** unknown. H2's walk went 5.9 → 1.2 s.
- **Risk:** none (measurement).
- **Experiment:** reuse H2's `browser/sample2.js` sampler. Run the H3 walk with K=8 and K=0, and log:
  - Sleep arguments and actual wake latency, via `--trace-api=Sleep` CLI for the arguments plus
    page timestamps;
  - parks per second;
  - blocks per second during the walk.

  **Refuted** if blocks per second during the walk are near the idle maximum (CPU-bound) or wake
  latency is within about 1 ms of the request.
- **Missing:** any H3 browser timing. Restored17 never moved the hero.

**3. Lower the hot monomorphic switch `exe+0x47227c` in the tier as a guarded single-target branch,
with the general br_table form behind it.**
- **Evidence:** MEASURED, 1.3% of all entries, always one arm.
- **Payoff:** at most about 1-3% of H3 main CPU.
- **Risk:** medium (table read from guest memory, so SMC and table writes).
- **Experiment:** census weight of head-unsupported at that site, then A/B. **Refuted** if the head
  installs but runs under 2 blocks per entry (poor).

**4. T1 audio x87 in the tier (an f64 register class).**
- **Mechanism:** after the island predecode, `$th_fpu_mem_ro` (8.4M) remains.
- **Evidence:** MEASURED on CLI. The browser share is SPECULATION: audio work is fixed per wall
  second.
- **Payoff:** a few % of whole-run CLI CPU. Likely smaller in the browser.
- **Risk:** medium (bit-exactness).
- **Experiment:** first, per-thread blocks per second in the browser on the idle map. **Not worth
  building** if T1 is under 10% of page CPU.

### Warcraft III

**1. Unblock and measure the browser: the profile-screen stall, and Worker vs cooperative.**
- **Mechanism:** the browser default is Worker main. In 2026-09-14 that mode was about 1.9x slower to
  the menu, cause unknown. On 2026-10-03 it stalled after the profile screen with main in an
  INFINITE wait.
- **Evidence:** MEASURED, stale or blocking.
- **Payoff:** the precondition for any browser claim.
- **Risk:** correctness.
- **Experiment:** CLI, state-gated to the menu. Compare `--threads` and `--no-threads` with
  `--headless-gl`, reading user CPU and API calls at the menu signature. **Refuted (no Worker
  penalty)** if the ratio is ≤1.1 on the current build.
- **Missing:** a browser gameplay route of any kind.

**2. Re-census the map load on the current build before building an `ijlRead` interception.**
- **Mechanism:** a host or WAT JPEG decode behind ijl15's 6-export API.
- **Evidence:** MEASURED 29.41% weighted share, but pre-uop and pre-page-index fix. The uop tier may
  already have absorbed much of the IDCT/Huffman code.
- **Payoff:** capped at about 1.4x of the load, and only if the decode is free.
- **Risk:** high (bit-exact IJL output: IDCT rounding, upsampling).
- **Experiment:** `ctl-hist-series.js` over the load, 6 windows. Handler-hist no longer turns the tier
  off (`$dbg_tier_guard`). Add `--count=ijl15+0x600333d0` for call counts. **Refuted** if ijl15 is
  under 10% of entries with the tier on.

**3. Call-return landings (no-verdict, 24-26% of entries).**
- **Mechanism:** trace heads at hot call targets and call/ret traces. Same project as D2 #3 and H3
  #1.
- **Evidence:** MEASURED share. Payoff SPECULATION (D1 analog -10-20%).
- **Risk:** high.

**4. Memory translation (12.4% `g2w`/`gl32`/`gs32` in `wc3g`, pre-g2w-fast-path).**
- **Mechanism:** Game.dll data in sparse VirtualAlloc pages.
- **Evidence:** MEASURED share, stale. The widening experiment was 0.0%.
- **Experiment:** one current `--cpu-prof-window` of `wc3g`. **Drop the idea** if translation is under
  6% after the g2w fast path.

**5. Miles audio thread, residual.**
- **Evidence:** MEASURED. moffs already moved 432M blocks into the tier.
- **Experiment:** the per-thread `--uop-census --thread=<audio handle>` tier share. **Drop** if over
  70%.

---

## 4. Cross-game list

1. **Short-park wake policy** (D2, H3 if #2 confirms, H2 measured).
   - **Fix options:** skip parks whose owed time is under the timer clamp, or wake short parks with a
     MessageChannel macrotask.
   - **Validate:** three headful arms per game (default / variant / K=0), plus the menu-idle CPU that
     the parks exist to save. Re-check D2 per the precedent.
   - **Evidence:** TRANSFERABLE-MEASURED.
2. **uop calls: nocall ladder first, then call/ret traces** (H3 measured; D2/WC3 shares suggest it).
   One project serves all three.
3. **Miles (MSS32) threads** (H3 T1 x87, WC3 resampler + MP3). Measure each game's audio-thread share
   of *browser* CPU before more tier work. Fixed-batch CLI shares overstate real-time-bound audio.
   SPECULATION about the overstatement.
4. **A browser per-thread attribution run for all three.** WinePerf phases, per-instance blocks per
   second, and distinct frames per second. This is the single largest missing measurement. Every
   current per-game share is CLI.
5. **Native disassembly gate.** Any new uop op or inlined helper needs V8 and SpiderMonkey captures,
   because Ion's spill-on-calls behaviour is engine-specific (ToyVM step 10).

## 5. Do not pursue

| Idea | Reason |
|---|---|
| Runtime region JIT / wasm codegen in the main emulator | User decision 2026-09-10. ToyVM regions are call-bound (CPU x1.18 vs L1). |
| Continuous region JIT as a performance claim | BRW frame divergence open, and x1.47 CPU. |
| `--uop-icall` as it stands | +1-2.5% on H3, +2% on StarCraft and Rodent. Indirect calls are ≤0.64% of entries (WC3). |
| Polymorphic inline caches or exit chaining | ≤0.24% and <0.4% of entries. Chaining measured +1.4% slower. |
| Decode or cache work on H3 and D2 | 5K and 858 decodes per window, under 1 µs each. WC3 `$decode_block` is 1.3% after the fix. |
| d2gfx multi-row tile handler, more D2 SIMD/MMX | The tile handler's ceiling was "a few %" pre-uop, and LUT_SPAN was retired to the tier. D2 retired zero MMX instructions. |
| ijl15 `USECPU` knob | Never read. |
| Mixed int/x87 islands on H3 | +0.02%. |
| VirtualAlloc contiguity or window widening for WC3 | 0.0%. |
| Cutting µop or dispatch counts without a CPU A/B | ToyVM -18% µops was flat; main-emu "fewer dispatches ≠ faster". |
| Raising `--tick-ms-per-batch` for D2 runs | Steps over Storm's 255 ms MPQ waits and gives a critical error. |
| Frame-equality gates on D2 A/Bs | The Act I load is nondeterministic off vs off. Use `--branch-clock` plus counters. |
| Any FPS from headless batches or present counts | CLAUDE.md. Present count ≠ distinct frames. |

## First three experiments (smallest first)

1. **Nocall-ladder unit check, seconds of runtime.** `test/test-uop-compiler.js` on base vs ec2bf87c.
   - If it is green, run the H3 `uop` vs `uop+ladder` census A/B on the box.
   - It decides whether the WIP branch is mergeable, and whether the default arm loses heads too.
2. **Load-immune per-thread uop census on `d2` and `wc3g`.** `uop-game-ab --extra='--uop-census …'`.
   - It answers whether D2's small tier gain is a coverage problem.
   - It also gives the current ijl15/audio-thread shares for WC3.
   - Counts are valid on a loaded box.
3. **One headful browser pacing probe, D2 town then H3 walk.** Live
   `set_spin_park_k(0)`/`set_spin_work_max(0)` toggles, parks per second, distinct frames per second.
   It decides whether the H2 park-clamp finding is the user-visible lever on the two other titles
   before anyone touches the interpreter.
