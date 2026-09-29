# Selective dirty tracking: real-game measurements

Selective page tracking is now implemented in `src/03a-page-watch.wat` and
`lib/d3dim-gpu.js`. Normal texture-cache hits poll page generations without
copying or comparing texture bytes. The historical baseline and preliminary
cost experiment below are retained; neither establishes a causal FPS speedup.

## Production tracker

Only registered texture, palette and render-target backing pages have live
observers. A shared 4 KB root indexes lazily allocated 16 KB tables, each
covering 4 MB of backing memory. Each 4 KB page has an atomic reference count
and 64-bit generation. Guest aliases and different WASM instances see the same
generation. Each cache consumer retains its own last-seen versions; one
consumer never clears another consumer's dirty state.

```
guest store / REP / bulk copy ---- guest page translation ---+
native DDraw / GDI / host copy ---- backing address ---------+--> watched?
                                                               | yes
                                                        atomic generation++
                                                               |
texture cache: identity + page generations <--------------------+
  unchanged -> reuse GPU texture
  changed   -> decode/upload; remember observed generations
```

The CPU accessors, optimized copy loops, native drawing boundaries, filesystem
copies, canonical JS surface writes and GPU readbacks notify the tracker.
Acquisition invalidates existing uop windows via the shared epoch; new store
windows and the widened 64 KB reguard refuse watched pages. Read windows remain
eligible. Surface release, backing retirement, format/palette changes and
renderer shutdown are covered. Failed acquisitions roll back their references;
overflow or a debug audit miss disables the optimization process-wide and
restores byte comparisons. Versions are notifications, not synchronization:
existing resource ownership and GPU fences still apply.

Framebuffer uploads use page changes to bound the candidate rows, then trim
identical edge rows within that range. This is intentional: Unlock can mark
a whole surface, and a DIB swap can retain the same pixels. Neither should
force a full upload for a small HUD change. Texture hits do not use this scan.

`set_page_watch_audit(1)` additionally compares unchanged pages with byte
shadows. `--audit` in the gameplay tool enables it before guest startup.
Both NFS III and GTA2 passed real Worker/hardware gameplay audits with zero
misses (554,818 and 280,744 total triangles respectively). The regression test
deliberately omits a notification and verifies that the audit detects it and
that subsequent unnotified changes remain visible through the fallback.
The final GTA2 build was audited again after the DIB-swap fix: zero misses
through 208,636 triangles, with 562 MB of debug shadow comparisons
(`gta2_demo-page-watch-audit-final/`).

Normal NFS III measurement: 357 flips over two 15-second windows, **zero
texture byte checks**, 663,669 page-generation checks, and 0.024/0.025 ms of
framebuffer comparisons per frame. Observed FPS was 11.67/12.13, versus the
earlier baseline's 8.09/8.97. These are not controlled A/B timings: system load
was 35–37 during the new run. The eliminated texture scans are established by
work counters; the FPS gain still needs a quiet paired measurement.

Final GTA2 normal measurement: **zero texture byte checks** across 705 flips,
147,719 generation checks, and 20.54/26.46 observed FPS. Partial framebuffer
uploads averaged 79/160 rows per frame, rather than all 480 rows. Framebuffer
comparison time was 1.78/0.97 ms per frame; unlike NFS, GTA2 swaps DIB pointers,
so its framebuffer still needs comparison across different backing ranges.
Load rose from 13.7 to 27.1; these FPS numbers also are not a controlled A/B.

Artifacts: `build/d3dim-gameplay-perf/nfs3_demo-page-watch-normal-1/`,
`nfs3_demo-page-watch-audit-1/`, `gta2_demo-page-watch-normal-2/`, and
`gta2_demo-page-watch-audit-1/`.
The first GTA2 normal run revealed full uploads across DIB swaps; that issue
was fixed by comparing the target's pixel shadow across compatible layouts.
Do not use `gta2_demo-page-watch-normal-1/` as the final implementation result.

Validation: full build gates; `test-page-watch.js` (real VM stores, split
pages, aliases, multiple instances, uop windows, native drawing/decoding,
readback aliases, DIB recycling, palettes, filesystem copies, JS surface
writes, row trimming, release, overflow and audit fallback);
`test-code-write-granularity.js`, `test-gdi-surface.js`,
`test-d3dim-gpu-depthless-z.js`, `test-d3dim-texture-wrap.js`, and
`test-d3dim-gpu-edge-web.js`.

```sh
node tools/bench-d3dim-gameplay.js --app=nfs3_demo --audit --label=audit --seconds=15 --windows=2
node tools/bench-d3dim-gameplay.js --app=gta2_demo --label=tracked --seconds=15 --windows=2
```

## MechWarrior III menu: remote regression check (2026-09-28)

Compared the complete tracker commit `ff6dc0f4` against its parent `76c548ed`
on reserved box 8, in isolated `~/mw3-watch-ab`. Each arm used its own compiled
WASM, GPU executor and generated region map; common host files came from the
tracker snapshot. Later main-branch optimizations were excluded from both arms.
Headful Chrome 151, real guest Workers, 1024x768 viewport, four remote vCPUs
(Ryzen 9950X reported), no concurrent benchmark. The renderer reported ANGLE /
Intel UHD 620 / Mesa in every measured window. Although `--swiftshader` was
requested, that is **not** what the runtime reported; do not describe this as
a verified SwiftShader run or extrapolate these rates to Safari.

Route: `?debug&threads&d3dim-gpu`, launch `mw3`, wait for 120 DirectDraw presents,
settle for 60 seconds, then two 15-second windows. Captures confirm the animated
main menu. `dx_trace` kind 5 counts guest presents, not unique displayed frames.
All five runs completed both windows with no page errors or GPU errors.

| Run order | Tracker | Window 1 presents/s | Window 2 presents/s |
|---|---|---:|---:|
| before-a | off | 23.92 | 42.72 |
| before-b | off | 23.98 | 43.07 |
| after-a | on | 23.24 | 32.46 |
| after-b | on | 24.26 | 42.06 |
| before-c | off | 24.20 | 32.33 |

The two-window run means average 31.70 without tracking and 30.50 with it
(-3.8%), but the baseline's own repeated-run spread is 15.7%. The slow second
window occurs in both arms. **This does not establish a regression, nor prove
zero overhead.** Fixed wall windows cover a variable amount of the animated
menu: second-window GPU draws range from 340 to 506. A tighter attribution
needs a matched animation phase or longer route plus CPU profiling.

There were zero texture uploads and zero texture-byte comparisons in every
measured window. GPU framebuffer comparisons cost only 4.08-5.14 ms across
each entire second window (zero in the first), so removing texture scans
cannot substantially speed up this menu route. Watched-page store barriers
remain a possible CPU cost, not a demonstrated cause from this experiment.

Artifacts: `build/mw3-watch-ab-results/mw3-{before-a,before-b,after-a,after-b,before-c}/`
contains manifests, checksums, counters and start/end captures. The remote
directory also retains pinned runtime artifacts and both build inputs.
Earlier `before-probe` / `before-1` failed launch, and `before-2` overlapped
startup; none are included in the table.

Example baseline command, from the isolated remote directory:

```sh
DISPLAY=:0 CHROME=/usr/bin/google-chrome node tools/bench-d3dim-gameplay.js \
  --app=mw3 --label=before-a --wasm=build/watch-ab/before.wasm \
  --gpu-source=before/lib/d3dim-gpu.js --region-map=before/lib/region-map.generated.js \
  --swiftshader --seconds=15 --windows=2
```

### Individual present intervals (2026-09-29)

**Interpretation corrected by the investigation below:** the long gaps are
scripted ATTRACT waits, not rendering stalls. The idle route crossed animation
phases, and the original benchmark also queried the GPU renderer name on every
stats snapshot. Preserve these raw measurements as historical evidence, not
as clean shipping-runtime FPS or a precise dirty-tracking cost estimate.

Repeated the pinned comparison with `--frame-times --seconds=60 --windows=1`
in A/B/B/A order. Each launch again settled for 60 seconds. The worker records
`performance.now()` at each kind-5 present into a preallocated 120,000-entry
Float64Array; it is read only after measurement. Screenshots and CPU profiles
are outside the timed interval (profiles disabled). No overflow, page errors
or GPU errors. These are guest-present intervals, not unique browser scanouts.

| Run order | Tracker | Presents/s | Median ms | p95 ms | p99 ms | Longest gap ms |
|---|---|---:|---:|---:|---:|---:|
| before-interval1 | off | 22.88 | 42.92 | 80.02 | 83.80 | 5000.15 |
| after-interval1 | on | 21.61 | 46.04 | 81.16 | 84.54 | 5002.52 |
| after-interval2 | on | 22.36 | 44.26 | 80.16 | 84.81 | 4999.97 |
| before-interval2 | off | 23.11 | 43.07 | 78.96 | 83.04 | 4999.42 |

Pooled: **23.00 presents/s before, 21.99 after (-4.38%)**, median 43.00/45.30 ms,
p95 79.57/80.54 ms, p99 83.50/84.75 ms. The control repeat spread is about 1%,
the candidate spread about 3.4%. Both candidate averages are lower in this
small repeated sample, suggesting modest overhead; do not treat -4.38% as a
precise universal cost. The final 30 seconds average **13.17/13.08 presents/s**.

Every run contains exactly two gaps over 100 ms: one approximately 1.01 seconds
and one approximately 5.00 seconds, followed by a brief burst of presents.
The 5-second gap accounts for four complete zero-present one-second bins in
each capture. Intervals over 50 ms: 1187/2758 before and 1200/2637 after.
The menu pacing is therefore **not stable**. The large pauses occur without
tracking too; whether these are intentional game waits or emulator stalls
requires tracing and is not established by timestamps alone. Burst present
counts also explain why earlier short-window rates overstated sustained pace.

Raw captures: `build/mw3-watch-ab-results/mw3-{before,after}-interval{1,2}/`
(`window-0-frame-times.json`, `results.json`, start/end PNGs, console).
Aggregated results: `build/mw3-watch-ab-results/frame-time-summary.json`.
Interval differences were independently checked against the stored timestamps.

### Gap and low-FPS diagnosis (2026-09-29)

Two separate causes were found on the pinned `ff6dc0f4` snapshot:

**The ~1s and ~5s gaps are guest-script waits.** `reader.zbd` at file offset
`0x3487a` contains the `ATTRACT` script: `PLAYAVI intro.avi`, `WAIT 1.0`,
`LOADIMAGE mech3splash`, `WAIT 5.0`, then `FADEOUT`. The floats are stored as
`0x3f800000` and `0x40a00000` following their WAIT tokens. The EXE parser at
`0x562dd0` compares the command against the `WAIT` string at `0x5bc2c4` and
constructs the object with vtable `0x599cd8`. Its update method `0x563c60`
compares elapsed time against start time plus duration; it does not draw.
Samples inside the gap hit that method (`0x563c73`), its animation dispatcher
`0x5633f0`, input polling and the main message/timer loop. No Sleep or blocking
wait yields were recorded. The host page was ~98% idle during the gap.
The benchmark's unattended warm-up allowed this attract sequence, so calling
the two gaps emulator stalls was incorrect.

**Slow active animation is a code-cache retirement storm.** The RGB565 alpha
loop fold publishes `0x528064..0x528111` (173 bytes). Execution also resumes at
its internal stores `0x5280f4` and `0x52807b`. Publishing the full fold retires
those entries; recompiling an interior entry retires the fold. The existing
`--trace-code-writes` instrumentation, captured in a bounded local buffer,
recorded 1,000 retirements: 442 fold-to-`0x5280f4`, 440 reverse, and 118 involving
`0x52807b` / `0x5280f7`. **Every record has `in_code_write=0`.** This is overlapping
compiled entry ownership, not changing guest code or texture byte comparisons.
The micro-op tier can resume at internal instructions; the native whole-loop
matcher does not apply the `fuse_stop` protection used by smaller folds.

Over a 29-second tail sample: 47,595,892 decoded blocks, 46,995,406 retirements,
zero directory/index evictions, and one full cache clear. With the benchmark
driver-query issue fixed, sampled worker self time in the last 30 seconds was
22.84% `page_publish`, 12.74% `decode_block`, 11.82% alpha-loop recognition,
and 11.47% `uop_fast`. Main-thread canvas conversion/upload was small. The
function names were verified against a compiler-emitted name section whose
non-custom WASM sections exactly match the measured runtime; no current-main
function-index guesses were used.

**Benchmark correction:** `instrumentGpu().snapshot()` previously repeated
`getParameter(UNMASKED_RENDERER_WEBGL)` on every stats snapshot. It accounted
for 7.6% of sampled worker wall time in the first profile. The tool now caches
the name once per GL context. That overhead was in the benchmark, not the
shipping renderer. Corrected profiled runs still show the retirement storm;
their throughput is not an unprofiled A/B replacement for the earlier tables.

Artifacts under `build/mw3-watch-ab-results/`:
`mw3-after-gap-debug1` (initial CPU profile), `mw3-after-gap-debug2` (cached
driver query, periodic guest PCs/cache counters and CPU profiles),
`mw3-after-cache-trace` (bounded retirement records), and
`mw3-after-gap-callers` (targeted 9-second gap sample). In the diagnostic
profiles, worker-0 is the guest and worker-1 is the browser page.
### Alpha-fold fix and controlled A/B (2026-09-29)

`$try_emit_rgb565_alpha_run` now checks the existing `$fuse_stop` predicate
while validating its 173-byte candidate. An independently compiled interior
entry declines the whole-loop fold; ordinary decoding preserves that suffix.
A cold loop still receives the native fold. No guest address special case,
thread-mode change, or global optimization disable is involved.

`test/test-fused-entry-overlap.js` embeds the real loop and alternates its
head with both internal store entries (offsets `0x17` and `0x90`). It checks
pixel output, cold native-fold execution, and zero steady-state retirements
or recompiles. The test fails on the old matcher and passes with the guard.
The isolated current-main build and code-write granularity regression also pass.

The performance comparison pins `ff6dc0f4` against that exact snapshot plus
only this guard (1,603,908 vs 1,603,925 WASM bytes), using matching GPU JS and
region map. Thus unrelated current-main changes cannot explain the result.
Same quiet box 8, Chrome 151, headful real Workers, no CPU profiler; cached
GPU-name query in both arms. The renderer reports ANGLE / Intel UHD 620 /
Mesa 23.2.1 despite the requested SwiftShader launch flags. These are guest
DirectDraw presents, not monitor refreshes or measured combat FPS.

| ABBA run | Presents/s | Median interval | p95 interval | Block decodes | Retirements |
|---|---:|---:|---:|---:|---:|
| Control 1 | 29.06 | 27.23 ms | 72.31 ms | 36,895,507 | 36,395,126 |
| Fixed 1 | 76.82 | 11.04 ms | 18.18 ms | 4,000,314 | 3,796,783 |
| Fixed 2 | 73.55 | 11.54 ms | 18.20 ms | 3,974,221 | 3,771,630 |
| Control 2 | 31.39 | 25.84 ms | 70.61 ms | 36,667,625 | 36,167,231 |

Each window lasts 30 seconds after a 60-second warmup. Mean throughput rises
from 30.22 to 75.19 presents/s (2.49x); retirements fall 89.6% despite more
frames. The control repeat spread is 7.7%, versus a 148.8% improvement.
Remaining retirements are not zero and are not explained by this experiment.
All four captures still contain the scripted one/five-second waits. Small
mouse movements every two seconds did **not** prevent them; the experimental
keepalive option was removed. Do not describe the whole window as stable FPS.
Start/end screenshots show the same animated menu, with no rendering errors.

A separate control/fixed pair with `--warmup-ms=95000` captures 30 seconds
of the later active animation with **no scripted gaps** in either arm:

| Active-animation run | Presents/s | Median | p95 | Worst | Intervals >50 ms | Retirements |
|---|---:|---:|---:|---:|---:|---:|
| Control | 14.59 | 70.49 ms | 74.96 ms | 80.00 ms | 437/437 | 47,686,768 |
| Fixed | 78.74 | 13.42 ms | 18.04 ms | 31.53 ms | 0/2,362 | 2,182,344 |

That is 5.40x throughput and 95.4% fewer retirements in this phase. Per-second
counts span 13–19 before and 60–151 after: animation work still varies, so
this is not constant FPS. This phase-specific pair is one repeat per arm;
the preceding ABBA establishes the repeated improvement across the mixed
sequence. Screenshots still show the animated menu, and both runs report no
browser/rendering errors. Artifacts: `mw3-after-active`, `mw3-fixed-active`.

Artifacts: `build/mw3-watch-ab-results/mw3-after-fixcontrol{1,2}` and
`mw3-fixed-fix{1,2}` hold screenshots, manifests, raw frame timestamps and
start/end cache counters. Use `--frame-times --seconds=30 --windows=1` with
`tools/bench-d3dim-gameplay.js --app=mw3`, pinning `--wasm`, `--gpu-source`
and `--region-map` for each arm. `--trace-yields` adds guest PCs/cache samples;
`--trace-cache` adds bounded retirement records. Both require `--frame-times`.
Use unprofiled captures for throughput and `--profile` for attribution.

## Further GDI / DirectDraw consumers (not implemented)

1. `lib/host-imports.js` `_flushGdiSurfacePresentation`: combine the existing
   dirty rectangle with backing-page generations before `rgbaRect` and
   `putImageData`. Skip unchanged uploads; convert only changed row spans.
   DirectDraw rebinding currently marks the full surface dirty even when its
   backing is unchanged. Writes without Lock can be observed through the
   same CPU/native writer notifications, provided presentation is scheduled.
2. `_refreshGdiSurfacePalette` currently rebuilds RGB tuples and clears the
   nearest-colour cache on every flush. Watch palette storage separately and
   preserve the decoded palette and `GdiSurface.rgbaRect` lookup table until
   its generation changes. Palette changes must invalidate indexed pixels
   even when no pixel page changed.
3. Repeated source conversion for blits can use source versions as a cache
   key. Skipping the actual destination write requires additional proof:
   destination versions, clipping, ROP, palette, colour key and geometry.

Start with displayed surface and palette pages only. Each consumer must own
its observed generations, and rebind/release must handle Flip's backing swaps,
layout changes and memory reuse. Preserve existing synchronization and a
fallback when tracking is unavailable. The present CPU implementation refuses
fast uop store windows for watched pages, so broader registrations need their
own A/B before enabling them by default.

## Method

The sections below record the **pre-implementation** measurements. The
historical `bench-d3dim-watch-cost.js` intentionally refuses the production
source tree, where synthetic hooks would double-count the write cost.

`tools/bench-d3dim-gameplay.js` launches the installed NFS III or GTA2 demo in
visible Chromium with real Worker threads and the default WebGL executor.
It refuses cooperative fallback. It counts actual DirectDraw `Flip` calls,
not browser animation callbacks, and captures the start and end of every
measurement window. Both titles reach live gameplay; NFS is at the starting
position with an advancing race timer, and GTA2 is in the Wild Demo playfield
with active pedestrians and tutorial dialogue. No synthetic drawing workload.

Server-only instrumentation times texture and framebuffer byte comparisons
separately. Existing draw, upload, readback and error counters remain intact.
The byte-volume counter includes successful comparisons only; early-mismatch
reads are excluded. Per-comparison timer calls add some instrumentation cost.
The recorded renderer is `ANGLE Metal Renderer: Apple M1`, not SwiftShader.

WASM and the D3DIM JavaScript source are pinned in memory during each run and
copied into its artifact directory with hashes in `results.json`. Other
application assets still come from the shared checkout. These are local
Chrome 153 measurements, not Safari measurements or universal FPS claims.

```sh
node tools/bench-d3dim-gameplay.js --app=nfs3_demo --seconds=15 --windows=2 --label=baseline
node tools/bench-d3dim-gameplay.js --app=gta2_demo --seconds=15 --windows=2 --label=baseline
```

## Existing comparison cost

Two approximately 15-second windows per game, Apple M1, threads on:

| Game | Guest Flip FPS | Texture checks, ms/frame | Framebuffer checks, ms/frame |
|---|---:|---:|---:|
| NFS III | 8.09 / 8.97 | 18.35 / 17.74 | 1.39 / 1.25 |
| GTA2 | 20.93 / 16.88 | 1.78 / 1.87 | 1.63 / 1.29 |

NFS checked 39,100 and 46,062 textures in those windows, rereading 0.95 and
1.10 GB of unchanged texture bytes. Only **one** texture upload occurred
across both windows (257 frames). GTA2 performed 39,295 and 35,110 checks,
with nine and zero changed-texture uploads respectively. GPU executor errors
were zero in both games. Screenshots confirm race/HUD and Wild Demo gameplay.

The comparisons are a meaningful NFS cost, but removing roughly 19 ms from
a 111–124 ms frame cannot by itself make the game reach 60 FPS. GTA2 has much
less texture-comparison work. These timings are the measured cost of the
existing work, **not** savings already achieved by dirty tracking.

Artifacts: `build/d3dim-gameplay-perf/nfs3_demo-baseline-2/` and
`build/d3dim-gameplay-perf/gta2_demo-baseline-1/`. The failed NFS `baseline-1`
run is excluded: its instrumentation response lacked Worker isolation
headers, causing a cooperative fallback. The harness now preserves those
headers and fails immediately if Worker startup falls back.

## Experimental write-watch cost

`tools/bench-d3dim-watch-cost.js` compiles two isolated artifacts from one
source snapshot, without editing production WAT or the canonical build.
Both allocate the same heap-owned, 2 MB backing-page table and register the
actual textures and render targets seen during gameplay. Only those pages
are watched. A scalar probe checks the page flag and changes the generation
only for watched backing pages. The candidate adds:

- checks to gs8/gs16/gs32/gs64, including the second page of a crossing store;
- range checks at the existing bulk code-write invalidation boundary;
- rejection of watched pages when creating uop store windows.

Registration bumps the existing uop-window epoch. Two control/candidate
smoke checks confirm a crossing DWORD preserves its value and marks both
watched backing pages, while an ordinary page remains untracked.

This is a cost probe, **not a complete cache-invalidation implementation**.
Its table pointer is per-instance; secondary workers do not share the main
worker's registrations. Native and host direct writes, all bypasses, reference
counts, retirement/reuse, generation wrap and cache consumers remain missing.
No scan is skipped. Those limitations prevent interpreting the result as the
cost or correctness of the finished design.

```sh
node tools/bench-d3dim-watch-cost.js
node tools/bench-d3dim-gameplay.js --watch-cost-matrix --seconds=12
```

For each game the matrix uses control, candidate, candidate, control, with
two 12-second gameplay windows per launch. All raw counters, build hashes,
GPU identity, machine load and screenshots are saved under
`build/d3dim-gameplay-perf/`. The shared machine has substantial variable
background load; repeated controls are necessary to interpret small changes.

### Attempt on the shared laptop: inconclusive

| NFS III arm | Window FPS | One-minute load, before → after |
|---|---:|---:|
| Control | 7.92 / 7.14 | 6.0 → 35.6 |
| Candidate, first launch | 6.36 / 6.64 | 47.2 → 83.4 |
| Same candidate, second launch | 5.02 / 5.21 | 77.0 → 75.3 |

The machine reached a one-minute load of 104.8 between these samples. The
identical candidate's second launch was itself substantially slower, and NFS
also randomizes weather/scene setup between launches. **Do not attribute
these FPS differences to the watch checks.** There is no defensible overhead
percentage from this attempt. The matrix was stopped before the final NFS
control and GTA2 candidate/control runs; earlier GTA2 results above measure
only the existing comparison cost.

All three NFS runs had zero GPU executor errors and approximately 700 watched
resource ranges, and their captures show an advancing cockpit race scene.
This is functional evidence that the cost probe executes on real watched
resources, not proof of complete write tracking or pixel parity across the
randomized launches. Artifacts are the three `nfs3_demo-watch-*` directories.

The matrix now checks load before each launch and stops above twice the
logical CPU count (overridable with `--max-load`). This catches gross
contention; it is not a statistical noise guarantee. New matrices use unique
output directories, and single runs refuse to overwrite existing results.
The remaining performance work is a quiet repeated A/B, followed by a net
before/after comparison once write coverage and cache invalidation are complete.
