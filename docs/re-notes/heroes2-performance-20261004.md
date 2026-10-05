# Heroes II demo: why it feels slow (2026-10-04, CLAUDE-HEROES2-PERFORMANCE)

**Answer: the hero walk is slow because of pacing, not CPU.** The walk runs
about 5x slower in the browser than it should, and the cause is the
clock-spin parker (`$spin_park_k`, K=8). With K=0 set live in the page, the
same 4-tile walk completes in about 1.2 s instead of about 5.9 s.

During the walk the interpreter is almost idle: it retires about 0.6M
blocks/s, against the 37–40M blocks/s it sustains on the idle map.
Presentation costs about 1% of the main thread.

This is investigation only. No source was changed and nothing was rebuilt.
Evidence is in `scratch/claude-heroes2-performance-20261004/` (the runtime
ledger is `runtime-ledger.json`: 516.7 s of 600 used, every run serialized).

## Identity

| | |
|---|---|
| git HEAD | `16f764ad7c5a` with 371 dirty paths of shared WIP (`host.js` and `lib/*` included) |
| module | `build/wine-assembly.wasm` sha256 `f40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063` (mtime 2026-10-03 17:46) |
| build status | Not rebuilt; every CLI run used `--no-build`. `src/09a8` is newer than the module (uncompiled WIP), so it is not what ran. |
| browser module | The page loads the same prebuilt artifact (`host.js` 2711). Its logged SHA was **not captured**. |
| assets | All 14 `heroes2DemoFiles` are present, hashed in `identity.txt`. `H2DEMOW.EXE` is `d1ae170c…`, `HEROES2.AGG` is `f469a8f6…` (43,362,148 B). |
| host | Linux 6.8 x86_64, 4 cores, node v24.18.1, `/usr/bin/google-chrome` (headless, via `tools/web-input-probe.js`) |
| load | 0.13–1.19 (1-min) before and after every run; per-run values are in the ledger |

## Scenes and commands

The CLI route is the one from `test/test-heroes2-scroll-gameplay.js`: NEW GAME → STANDARD → OKAY, then hero screen, path, walk and auto-scroll. It is saved in `route-input.txt`. Every scene was checked with a screenshot in `png/`.

- **r1/r2:** `node test/run.js --app=heroes2_demo --no-build --batch-size=20000 --max-batches=3000 --repaint-every=50 --quiet-api --no-close …` with the default 200 ms/batch clock. r2 adds `--handler-hist-thread=0,0,0 --handler-hist-start=1200 --handler-hist-stop=3000 --hist-json --uop-census --present-frames --frame-stats`.
- **r3–r6, r8, r9:** the same route under `--control-stdin --frozen`, fed `{"step",n:2008}`, `{"tick",ms:2}` (and 1 or 4 in r9), then `{"step",n:3000}`. From the walk click onward this gives a realistic guest clock. Flags per run:
  - r3: hist
  - r4: `--slice-split`, timing only
  - r5: `--trace-api`
  - r6: `--cpu-prof-window=2008:5008`
  - r8: `--trace-stack`
- **b1–b7:** browser runs using `web-input-probe.js --app=heroes2_demo --query='?debug&perf'`. Each clicks 535,225 / 528,68 / 283,373, then clicks a path at 400,250 and clicks it again to walk 4 tiles. The probes are `browser/*.js`, reading `WinePerf.snapshot()` and the `get_tick_count`/`get_clock_spin_parks` exports.
  - b5/b6: K=8, the default.
  - b7: `set_spin_park_k(0)` just before the walk click.
  - b1–b4 are earlier attempts. b1–b3 never walked a multi-tile path: the probe's coordinates differ from the CLI's. b4 counted zero AGG fetches.
- **Combat was not reached.**

## Diagnosis

### 1. Hero walk is pacing-bound, caused by the clock-spin park (decisive)

Browser timeline: `browser/b6-samples.txt` (K=8) against `b7-samples.txt` (K=0). Same route, same 4-tile path plus scroll, same end frame.

| | K=8 (default) | K=0 |
|---|---|---|
| wall time from walk click until presents fall back to the 9/s idle rate | **≈5.9 s** | **≈1.2 s** |
| guest presents during the walk | 61 (10.4/s) | 51 in about 1.2 s (35 of them in the first 0.5 s) |
| blocks retired during the walk | 3.4M (≈0.6M/s, about 1.5% of capacity) | about 38M/s, continuous |
| clock-spin parks during the walk | 1554 (265/s, one every 3.8 ms; ≈25 per present) | 0 |
| guest `GetTickCount` minus `performance.now()` | constant (−324 ms) | constant |

- **The guest clock tracks the wall clock exactly**, so the walk is not slowed by guest time running slow. It is slowed by parks.
- Each park asks for a 1 ms sleep (`CLOCK_SPIN_PARK_MS = 1`). The nested-setTimeout clamp makes it about 3.8 ms; `host.js` 5841 calls this coalescing "for free".
- At about 25 parks per walk frame, frames come about 95 ms apart instead of about 20–25 ms.
- **Mechanism (hypothesis, consistent with the numbers but not proven):** the walk loop at `0x46e4a3` waits per frame on many short clock waits. Its sub-step loop is `0x46e662`, `cmp [ebp-8],0xf`, which calls the idle service `0x45dbb0` with clock reads at `0x45dbd7/0x45dc0f/0x45dcb4`, per the r8 `--trace-stack` output. If each short wait costs ≥3.8 ms instead of about 1 ms, the walk is stretched about 4x.
- **The CLI cannot see this.** On the batch clock the walk produced the same ~60 frames at 1, 2 and 4 ms/batch (r9: 95/93/91 presents over 6 guest-s, present interval p50 = 3 batches every time). The batch clock does not model setTimeout clamping.
- This is the same bug class as `project_d2_clock_spin_false_positive`, where Diablo II went from 4 to 41 fps with K=0.

### 2. The idle adventure map busy-polls at full speed and is never parked

- **Browser, idle map, K=8:** 37–40M blocks/s and zero clock parks over 20 s (b6). The HUD shows guest 98–99% of step time; step p50 is 2.3 ms; there are 0 long tasks.
- At the CLI's measured ~18.5 ns/block, that is roughly 70%+ of one core spent polling. This figure is an estimate: browser CPU% was not measured.
- **CLI, realistic clock, idle window 3508–5008 (r3 hist):** the top threaded blocks are a widget event broadcast, entered roughly 800k times per 3 guest-s:
  - `0x4c53b6/0x4c53c5` walks a linked list and calls `[vtbl+8]`. The uop tier declines it as `call-indirect`.
  - It dispatches to handlers `0x4d3280` and `0x4c5a20`, which compare the event type against 4 and 0x200.
  - Each block of that broadcast is 9–10% of block entries. The clock wrapper `0x45c9fa` is only 0.97%.
- The game reads the clock with real work in between, so K=8 never trips. This matches `docs/frame-pacing-census.md` §"Where the detectors do not fire".
- The 2026-09-10 renderer CPU of 10–16% (`heroes2-demo.md`) was not reproduced here. Nothing compares headless with headful, before with after: unresolved.

### 3. Interpreter CPU is not the limiter on this box

- **Realistic-clock CLI (r4 `--slice-split`):**
  - Walk plus scroll costs 0.1 s of guest-slice wall time per 1 guest-s.
  - Idle costs 0.2–0.3 s per 2–3 guest-s.
  - That is about 8–12% of one core, with 47% of batches stopping on blocking waits.
- **uop tier coverage (r2 hist JSON, `uop.blocks` against threaded block entries):**
  - Starved 200 ms clock, gameplay windows: 77–82% of blocks run inside uop programs. The ICN decoder `0x4c7341` alone is 9.2M blocks; also covered are `0x4cbbb3`, palette `0x499927` and the Miles mixer.
  - Realistic clock (r3): 61% during the walk and 44% when idle, because the poll loop above is threaded.
- **CPU profile (r6, `--cpu-prof-window=2008:5008`, 6 guest-s, 1015 ms sampled):**

  | Function | Share | Notes |
  |---|---|---|
  | wasm total | 59.2% | |
  | `$uop_fast` + `$th_uop_enter` | 31% of wasm | uop tier |
  | `$th_load32_rop` | 8.4% | |
  | `$th_push_r` | 6.4% | |
  | `$branch_end_at` | 5.7% | |
  | JS (`renderer.js` draw, `surface.js` blit, `raster-canvas`) | ≈30% of the process | CLI harness only; the browser has no equivalent cost |

### 4. Presentation and audio are minor

- **Presentation:** the browser `presentMsPerSec` was 8–14 ms per wall-s (about 1%); the HUD showed paint 1%; `uploadsPerSec` was close to `guestFps`.
- **Range I/O:** the b4 fetch wrapper saw **zero** fetches through gameplay. In this harness the AGG appears to be loaded eagerly; this is inferred, not verified. On the deployed HTTP-range path, I/O stalls are untested.
- **Audio:** Miles' multimedia timer is delivered as posted `MM_TIMER` (0x7FF0) through the guest's own pump. The walk window had about 150 `SuspendThread`/`ResumeThread`/`QueryPerformanceCounter` triples per guest-s (r5). This is a correctness and latency coupling, not measured as a cost.

### 5. The default CLI clock is misleading for this app

At 200 ms/batch the guest is starved: 94% of batches spend the full budget, at 4.3 presents per guest-s (r1/r2). Its block mix is roughly "render as fast as the budget allows". Handler histograms from that clock, like those in `heroes2-demo.md` and `dispatch-attribution-2026-09.md`, describe throughput work, not what a player waits on.

## Ranked improvements

1. **Park only clock waits the host can honour.** For example, skip the park when the spin's owed time is shorter than the timer clamp (owed < 4 ms). Alternatively, wake short parks with a clamp-free macrotask (MessageChannel) instead of nested `setTimeout`.
   - **Payoff:** the walk goes from about 5.9 s to about 1.2 s per 4 tiles (measured upper bound, K=0). This is the user-visible lever.
   - **Risk:** it gives back part of the menu-idle CPU win from the 2026-09-10 MRU-context fix. That menu's deadlines are +13/+30/+110 ms, so a "long waits only" rule should keep most of it.
   - **Validate:**
     - The b5/b7 walk timeline in a headful browser, with three arms: K=8, the variant, and K=0.
     - Menu and idle renderer CPU, headful.
     - `test-clock-spin-park.js` and `test-clock-spin-contexts.js`.
     - Diablo II re-checked, given the precedent.
2. **Park the idle-map widget-broadcast poll.** One option is a per-context "same clock value plus no input or message change" park at K≈3, which the census measured as 4.6x fewer API calls.
   - **Payoff:** power and heat, and main-thread headroom (up to about 70% of a core) while idle.
   - **Not a payoff:** frame rate. The idle map presents at the game's own ~9/s, its 110 ms timer.
   - **Risk:** false parks. Gate on frame equality and present counts, as `docs/frame-pacing-census.md` demands for any K change.
3. **uop coverage for the poll and broadcast loop:** a guarded `call [eax+8]` (ICG), plus no-backedge heads `0x4d3280`/`0x4c5a20`.
   - **Payoff:** it only matters on slow devices. It would make the idle spin cheaper per block; with item 2 done, it is nearly moot.
   - **Requirement:** native disassembly from both V8 and SpiderMonkey before any variant (CLAUDE.md).
4. **Do not chase** presentation (about 1%), decode (zero live evictions, ≤5000 decodes per phase) or the sprite decoder (already a uop program).

## Next validation experiment

Run three arms in a headful browser, one at a time, at low load:

- the default (K=8)
- `set_spin_park_k(0)`
- a host-side "no park when owed < 4 ms" prototype

Use the b5 route and sampler (`browser/sample2.js` every 250 ms). For each arm, record:

- walk wall time, presents, blocks and parks
- renderer CPU over 30 s on the idle map
- renderer CPU over 30 s on the main menu

Then repeat on a phone-class CPU (`--cpu=4` throttle) to check that removing parks does not starve audio.

## Unresolved / not measured

- **Combat and animation scenes:** not reached; there is no route.
- **Startup duration:** not measured. The browser waits used were 12 s to the menu and 9 s to the map, and these are not measurements.
- **Headful numbers:** none. Headless frame intervals are not physical FPS, and no physical FPS is claimed anywhere here. Browser process CPU% was not captured.
- **The exact game wait primitive behind about 25 parks per frame:** only a hypothesis (§1).
- **Browser wasm SHA-256:** not recorded from the page log.
- **Deployed site:** HTTP-range I/O stalls and network latency are untested.
- **CLI determinism across instrumentation:** r3 (hist plus present-distinct) and r4 (timing) retired different block totals (25.3M against 31.3M) and ended on different frames. Compare counters within a run only.
