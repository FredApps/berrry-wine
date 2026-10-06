# Heroes II: review of the timing fix, the idle check and the spin latch (2026-10-05)

Task CLAUDE-HEROES2-LATCH-REVIEW, a child of CLAUDE-HEROES2-TIMING-FIX. This was a review of source and existing evidence only: no build, no browser, no emulator run. The only thing executed was the new unit test below (1.3 s, no build). It runs the existing worktree module `wt-h2timing/build/wine-assembly.wasm`, sha256 `da5bf93b…`.

- **Artifacts:** `scratch/claude-heroes2-latch-review-20261005/test-latch-expiry.cjs`.
- **Line references:** `host.js@fa` is `git show fa639845:host.js`. WAT references are to the current tree, whose detector code is identical in fa639845, origin/main and the working tree.

## TL;DR

1. **fa639845 is correct for its purpose.** It has two low-severity races, both made slightly wider by the extra hop (freeze, and stop/relaunch), and one unmeasured cost: up to 4x more wakes for sub-4 ms parks in other apps. It changes nothing in Worker mode, which is the browser default on isolated pages. The walk numbers cover cooperative mode only. It landed on main as 8427d1de and was **reverted by 39d4bb09**, with no reason given.
2. **The idle check as planned cannot answer its question.**
   - Its baseline arm serves whatever `origin/main:host.js` is at run time. Today that is `c84a1df4`, which is neither the matrix baseline (`4513f3c2` = fa639845~1) nor the fix's parent.
   - Latching is a per-run lottery (1 of 6 K=8 idle windows so far). With 4+4 runs it gives an inconclusive or misleading answer about 75% of the time, even if the latch hypothesis (M1) is true.
   - Replace it with an intervention design built on exports the shipped wasm already has. That costs about 3–6 min instead of 18.
3. **Recommended latch fix ("gap expiry"):** a read at the qualified context that fails the existing work check clears the latch.
   - About 6 WAT lines, no new state, deterministic in blocks.
   - The unit test proves a faithful JS port of the detector against the real wasm. In that port, gap expiry stops the latched idle-map parks (222 → 0 in 2 s) and keeps spin, menu, walk and interrupted-spin parks identical.
4. **Falsifier:** call `test_spin_reset()` live in a latched idle run. Parks must fall to about 0 within one 2 s window and stay there with no input. The inverse check is a `set_spin_work_max(0→64)` inducer, which must produce sustained parking of about 110–125/s in both arms.
5. **Side finding: the main menu does not park at all on this build.**
   - All 13 measure-walk menu windows show `clockParksPerS` = 0 at 17–19M blocks/s (`scratch/claude-heroes2-timing-fix-20261004/runs/*/result.json`).
   - So the 2026-09-10 menu idle-CPU saving that the latch was meant to protect is currently not being realised.
   - The model shows how: a 4-context rotation whose per-context gap is over 64 blocks never reaches K. It parks only when a stale latch happens to sit on one of its contexts.

## 1. Correctness review of fa639845

The change itself: the park timer's callback no longer runs the slice inline. It posts the slice through the step MessageChannel (`host.js@fa:4815-4829`, then `_postStep`, `4838-4860`). Every later park timer is therefore created from a port task, at nesting level 0 or 1, and the "5 nested timers → 4 ms" clamp never applies.

| # | Severity | Finding | Where |
|---|---|---|---|
| 1 | low, window widened | **Freeze during the hop runs one unbudgeted slice.** `setFrozen(true)` takes only `_delayedStep`. Between the timer firing and the port delivering, the continuation sits in `_pendingStep`, so it runs once while frozen: not counted in `_frozenSteps`, with the clock standing still, and only then parks at `_scheduleStep`. Before fa639845, a parked slice could not be caught in that gap; only budget-ended slices could. The new test codifies this ("one slice, then the loop holds", `test/test-browser-step-scheduler.js@fa:192-205`), but it contradicts setFrozen's own comment ("take its continuation now instead of letting one more step land"). **Fix:** in `setFrozen(true)`, also move `_pendingStep` into `_frozenStep` and null it; the port message then finds null. | `host.js@fa:4948-4966` |
| 2 | low, pre-existing, window widened | **`stop()` does not clear `_pendingStep`.** The step's `if (!self.running) return` covers stop-then-deliver. It does not cover stop → relaunch of the same host → delivery. Normally the new chain's first post overwrites the single slot. If the new chain's first scheduling is a delayed timer, though, the old closure is delivered and becomes the surviving chain: its `_scheduleStep` cancels the new chain's timer. **Fix:** add `this._pendingStep = null` in `stop()`. | `host.js@fa:3872-3889`, `4844-4851` |
| 3 | info / coverage | **Worker mode is untouched and unmeasured.** In `_runThreaded`, every step awaits worker round trips, so its `setTimeout` is created from a message continuation (nesting 0) and was never clamped; fa639845 only adds one hop there. The browser defaults to Threads on isolated pages (`index.html:1734`), and `heroes2_demo` has no `threads: false` (`lib/apps.js:3629`). But `web-input-probe` forces `threads='0'` (`tools/web-input-probe.js:309-310`), so every walk, idle and menu number is cooperative. Heroes' walk speed in Worker mode, where the guest clock is published coarsely, is unknown. | host.js worker loop (`@fa:4600-4775`) |
| 4 | behaviour change, not a bug | **Every sub-4 ms park is now honoured: it is generic, not Heroes-only.** This covers clock parks, `Sleep(1..3)` deadlines, WM_TIMER due in under 4 ms, and the worker message-park tail. A loop that parks on every slice now wakes up to about 1000/s instead of about 250/s. The guest clock stays wall-derived, so no WAT-level timing semantics change: the K=8 detector, the one-park-per-millisecond latch and deadlines are all untouched. What the guest sees is closer to the cadence it asked for, plus up to 4x the host wake cost. That cost is unmeasured outside Heroes. Whole-Chrome-tree CPU (about 330% in every arm, including K0) is too coarse to see it. | `host.js@fa:4794-4832` |
| 5 | none | **Input and rAF ordering.** Input events that arrive during the hop are dispatched before the slice, which is good, because the slice consumes them. `_wakeStep` during the hop is a correct no-op, since `_stepTimeoutId` is already 0 and the slice is imminent. The hidden-tab pause is handled by the step's own top-of-step check. | `host.js@fa:5059-5068` |
| 6 | none | **Fallback without MessageChannel.** `_postStep`'s `setTimeout(step, 0)` fallback runs inside the timer callback, so the clamp still applies there. Only Node vm tests take that path. | `host.js@fa:4858-4860` |

**Verdict:** no correctness bug blocks re-landing. Fixes 1 and 2 are two one-line hardenings worth adding when it re-lands. Find out why 39d4bb09 reverted it before relanding.

## 2. Review of the idle-check design (`idle-check-plan.txt`, `measure-idle.cjs`)

**Does it measure what the plan claims? Not reliably.**

1. **The baseline is unpinned. This is a bug.**
   - `measure-idle.cjs:33-34` serves `git show origin/main:host.js`. origin/main has moved: it now contains 8427d1de, the revert 39d4bb09, and range-loading/GameWait work. Its host.js is `c84a1df4`, 142 lines away from fa639845's parent (`4513f3c2`), and it is served next to the worktree's older `lib/`.
   - The matrix used `4513f3c2`. `measure-walk.cjs` has `--base`; this script does not.
   - **Fix:** take `--base=fa639845~1` and assert `sha256(servedHost)` starts with `4513f3c2`, or fail.
2. **The statistic cannot discriminate.**
   - The latch never expires, and nothing on the idle map re-qualifies a context. Each run is therefore latched or unlatched from the first window onward, so `latchedShare` is about 0 or 1 per run: a Bernoulli outcome. The matrix rate is 1 latched run out of 6 K=8 idle windows.
   - At p ≈ 1/6, the plan's "both arms latch → M1" happens only (1−(5/6)^4)^2 ≈ 27% of the time when M1 is true.
   - "Only the candidate latches → reopen M2" happens about 25% of the time by chance alone.
   - A 4-vs-4 Fisher test is significant only at 0/4 vs 4/4 (p = 0.029).
   - The 60 s idle duration buys nothing: 10 s, that is 5 windows, classifies a run.
3. **CPU attribution is too coarse.**
   - `procTree()` sums every descendant of the probe. That is about 330% of a core in every arm, including K0, so an effect of about 11% of one core is buried in it.
   - It also drops the CPU of any process that exits, which can make a window negative.
   - **Fix:** sample `/proc/<pid>/task/*/stat` for the `CrRendererMain` thread of the page's renderer (`--type=renderer`, highest CPU), and report the GPU process separately.
4. **The guards are incomplete.**
   - Validity checks the walker's xy only at the first mark. Require `xy == start` at every mark.
   - Require `k == 8` in every mark (it is recorded but not checked).
   - Also record `get_peek_spin_parks` and `get_clock_spin_count`.
   - `hero-init.js` scans 512 MB byte by byte on the page's main thread just before the first mark, so the first window carries that stall and the clock catch-up after it. Discard window 1, or wait 2 s after the install.
5. **The sampling itself is fine.**
   - Rates use the page's `performance.now()` deltas.
   - The CPU windows are realigned to the 250 ms samples, which shifts them by up to 250 ms but does not bias them.
   - A threshold of >20 parks/s separates 0 from about 110 adequately. Also report the parks count and the index of the first latched window.

**Proposed replacement: an intervention, not a lottery.** It uses only exports already in the shipped wasm: `test_spin_reset`, `set_spin_work_max`, `get_clock_spin_parks`. Each run is: load the route, then with no input:

| Phase | What to do | What it shows |
|---|---|---|
| A, fresh (10 s) | Call `test_spin_reset()`, then observe. | M2 predicts parks > 0 in the candidate. M1 predicts 0 in both arms. |
| B, induce (1 s) | `set_spin_work_max(0)`, then `set_spin_work_max(64)`, then observe 16 s. | M1 predicts parking sustained at about 110–125/s in **both** arms at the same rate. If parking does not sustain, the latch landed on another context: repeat B once and log it. |
| C, release (10 s) | Call `test_spin_reset()` again, then observe. | M1 predicts about 0. |

- Outcomes are deterministic: a rate of about 0 or about 110, not a probability. One run per arm answers the question, and two per arm add a replicate. That is roughly 4 × (40 s load + 40 s) ≈ **5–6 min**, against the requested 18.
- Keep the 2 s marks. Add `wk: get_spin_work_max()` to each mark, so the log proves which phase every window ran under.

## 3. Latch expiration: options and recommendation

**The defect.** `$clock_spin_arm` records one (ret, ESP) as qualified (`src/09a7d-handlers-shell-file.wat:466-468`). `$clock_spin_step` then needs only **2** matching reads at that context, instead of K=8 (`:445-455`). Only another context's park replaces the latch. Two reads within 64 blocks is exactly what a non-spinning loop does when it checks two deadlines back to back, so the latch turns one old proof into permanent false parks:

- the Heroes idle map: a read pair, then about 3000 blocks of work;
- in principle, any loop like it.

The D2 precedent is different. Its per-object reads have more than 64 blocks between them and never count at all, so the work check from c6e27758 already covers it, latched or not; see `d2Latch` in the test.

**Options:**

| Option | Mechanism | For | Against |
|---|---|---|---|
| O1: remove the latch | The threshold is always K. | Simplest. | A real spin pays 6 extra reads per ms after each wake (small). It also loses the stale-latch menu parking, the same as O2. |
| **O2: gap expiry (recommended)** | A read **at the qualified context** with `$idle = 0` (more than `$spin_work_max` blocks since that context's last read) clears `$clock_spin_qualified_valid`. | Reuses the per-context block mark and threshold that already exist; no new globals, about 6 WAT lines. It is in blocks, so the CLI and browser agree and runs stay deterministic. A continuous spin never has a gap and keeps threshold 2: re-arming after a wake is within 64 blocks by construction, because the re-run read follows the park with 0 blocks. | A loop that spins only in short bursts separated by more than 64 blocks no longer parks on an old proof (`menuLooseLatch`). That is the same signature as the idle map, so the two cannot be separated by design, and that loss is the point. |
| O3: N-block budget since the last park | The latch is valid while `blocks_now − park_blk ≤ W`. | Simple. | Needs a new global and a magic W. The idle map's pairs are about 260k blocks apart at 33M blocks/s, so the correct W depends on device speed and loop shape. |
| O4: T ms of guest time | The latch expires without a qualifying spin for T ms. | Intuitive. | Guest ms is host-dependent: 200 ms/batch on the CLI, 4 ms publishes in Worker mode, `GUEST_TICK_POLL_STRIDE` = 4. That makes it non-deterministic across hosts, and the idle map's pairs every ~8 ms refresh it unless T is under 8. Reject. |
| O5: per-context latch bit in the MRU | Store the qualified flag per context. | Removes the "only another site releases it" oddity. | Does not remove the false positive. Use it only together with another option. |
| O6: latched threshold of 3–4 | Raise the threshold. | Simple. | Fragile, because loops with 3 deadline checks exist (the Heroes menu does 3–4 per context). |
| O7: activity expiry | Clear the latch when `$spin_nonpoll_seq` moves. | Also simple. A frame limiter re-proves once per frame, for about 6 reads. | The idle map keeps parking until its next rendering call (≤110 ms), and the fix depends on the loop happening to make an API call. Acceptable as an extra guard on top of O2. |

**The tradeoff against the main-menu idle-CPU savings.** The latch was introduced in ff497d13 (2026-09-08); the menu work was 2026-09-10. Its savings are not currently being realised: all 13 measure-walk menu windows show 0 clock parks. The model shows how a menu rotation can end up at zero:

- **Tight rotation** (per-context gaps of 64 blocks or less): reaches K and parks 1000/s under both policies.
- **Loose rotation** (gaps over 64): never reaches K from a fresh detector. It parks 1001/s only when a stale latch sits on one of its contexts, which O2 removes.

**Hypothesis, not verified:** c6e27758's work check turned the real menu loose.

- **Check:** `set_spin_work_max(0)` live on the menu. If parks resume, the hypothesis is confirmed.
- **If confirmed,** the menu needs a separate fix. Do not use a latch that also makes the idle map park.

**Recommendation: O2.** Its exact WAT is in the header of the test file. It goes in `$clock_spin_step` immediately after `$idle` is computed and before the count update.

**Unit test:** `scratch/claude-heroes2-latch-review-20261005/test-latch-expiry.cjs`. Run it as `node test-latch-expiry.cjs [--wasm=PATH] [--wasm-expect=proposed]`; it takes 1.3 s and needs no build. It has three parts:

1. **Fidelity.** A JS port of `$clock_spin_select_context`, `$clock_spin_step` and `$clock_spin_arm` matches the real wasm on park decision and run count for every read of every scenario, plus 24 random sequences of 3000 operations each, which include 1566 parks.
2. **Discrimination.** The proposed policy meets every expectation. The current policy must fail the `idleLatch` expectation, or the test itself fails.
3. **`--wasm-expect=proposed`.** This asserts the same expectations on a real build. It fails today, and it should pass once O2 is in WAT.

Parks per scenario (wasm = current model, exact match):

| Scenario | Today | O2 |
|---|---|---|
| `spin` (200 ms) | 200 | 200 |
| `menuTight` (1 s) | 1000 | 1000 |
| `menuLoose` | 0 | 0 |
| `menuLooseLatch` (accepted cost) | 1001 | 0 |
| `spinGap` (interrupted spin) | 407 | 407 |
| `idleFresh` | 0 | 0 |
| **`idleLatch` (2 s)** | **222 (111/s)** | **0** |
| `d2` | 0 | 0 |
| `d2Latch` | 0 | 0 |
| `walkSpin`: walk / idle after it | 99 / 0 | 99 / 0 |

The modelled idle loop's read pair every 88 iterations was tuned to the observed rate, so the 111/s agreement is by construction, not evidence. The evidence is the contrast: the same loop parks only when latched.

Once O2 is in WAT, validate it with:

- `test/test-clock-spin-park.js` and `test/test-clock-spin-contexts.js`;
- this test with `--wasm-expect=proposed`;
- the browser inducer from §2: parking must stop within one pair after `set_spin_work_max(64)`;
- the 3-arm walk. The candidate walk is still about 2x K0 (1.31 s against 0.66 s), so any pair-type parks in the walk would disappear and the walk can only get faster;
- a recheck of D2.

## 4. What would falsify "the latch is the cause"

1. **Primary (one run, no new code).** In any idle run that is parking (organically or after induction), call `window.wine.instance.exports.test_spin_reset()` with no input.
   - The latch is the cause if parks are about 0 in the next 2 s window and stay about 0 for 10 s or more.
   - **It is falsified if** parking continues above 20/s right after the reset. That would mean the idle loop satisfies the K=8 proof from a fresh state, and something other than the latch, possibly the candidate's scheduling (M2), is producing it.
2. **Converse.** After the phase B inducer, the latch is the cause if parking is sustained at about 110–125/s **in both arms at the same rate**. That rate does not depend on the arm, because isolated parks are never clamped: a budget-ended slice resets timer nesting.
   - The latch is **falsified as sufficient** if parking does not sustain in either arm after 2 induction attempts.
   - If only the candidate sustains, the arm matters (M3).
3. **After O2 is in WAT.** The same inducer must give 0 sustained parking. If the idle map still parks with O2, something other than the latch qualifies it.

The model-only check is already done: the real wasm parks a pair-then-work loop only when it is latched (`idleFresh` 0 against `idleLatch` 222). That shows the mechanism exists. It does not show that this is what the browser runs did. Checks 1–2 do that, and need about 3 min of browser time on one arm.

## Not done or unverified

- No browser or CLI run, by instruction. All browser claims above come from existing runs in `scratch/claude-heroes2-timing-fix-20261004/runs/` and from `matrix-heroes-table.txt`.
- The ESPs and read gaps of the menu rotation are modelled from the 2026-09-10 trace in `docs/re-notes/heroes2-demo.md`. The real per-context block gaps were not measured.
- Why 39d4bb09 reverted the fix is unknown. Ask before relanding.
