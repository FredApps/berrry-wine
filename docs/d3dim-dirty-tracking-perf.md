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
