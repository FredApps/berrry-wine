# Shared lazy synchronization: real-game measurements

2026-09-29 session, shared synchronization commit `1730589d`. All runs use one
frozen runtime and host source set in `/home/user/mw3-watch-ab` on box8, Ryzen
9950X with hardware ANGLE / Intel UHD 620. The frozen renderer includes the
concurrent bounded-readback changes. This compares lazy OFF/ON on that same
renderer, not bounded versus full readback. Artifact hashes are in every
`result.json`; each game's runtime and recorded source hashes match across all arms.

## Method

`tools/bench-lazy-games.js` launches a fresh headful browser for each arm and
uses the actual shared WebGL renderer. Order: OFF, ON, ON, OFF. Each launch
has two 15-second measurement windows. No screenshots, profile sampling or
browser-stat polling occur inside those windows. Captures surround them.

Instrumentation wraps every guest worker's native `dx_trace`: MW3 records
presents, GTA2 records flips. Epoch-based timestamps allow all worker records
to be inspected together. The harness records persistent thread events from
before launch and rejects timing windows with thread creation/exit or more
than one active presentation stream; it does not reject multiple idle/audio
guest threads. CPU-only peers still contribute lazy-touch counters. Startup
thread events remain in the report even when those workers have exited.
The added validity checks were also applied offline to the completed MW3 arms.

Example (repeat with fresh output directories in OFF/ON/ON/OFF order):

```sh
DISPLAY=:0 CHROME=/usr/bin/google-chrome node tools/bench-lazy-games.js \
  --app=mw3 --seconds=15 --samples=2 --out=build/lazy-games/mw3-off1
DISPLAY=:0 CHROME=/usr/bin/google-chrome node tools/bench-lazy-games.js \
  --app=mw3 --lazy-sync --seconds=15 --samples=2 --out=build/lazy-games/mw3-on1
```

Independent launches do not simulate identical geometry. Treat throughput
as observed behavior, not an isolated percentage speedup. Readback and
untouched-Lock counts provide the direct evidence of the optimization.
`waitMs` is guest time waiting on the render transport; `syncMs` includes
readPixels and conversion on the renderer. These overlap and must not be added.

## MechWarrior 3 cockpit

All four launches reached the verified cockpit. Reviewed OFF/ON captures
retain the terrain, sky, cockpit and HUD. No reported GPU errors occurred.
One helper thread was created and exited during startup in each launch;
only the main guest worker remained during measurement. This is evidence
that short-lived helpers occur in the corpus, not evidence of another thread
accessing a pending surface.

| Metric | Lazy OFF | Lazy ON |
|---|---:|---:|
| Aggregate FPS | 21.29 | 22.64 |
| Individual 15-second windows | 20.58–22.22 | 22.44–22.96 |
| Frame time p50 | 46.03 ms | 43.13 ms |
| Frame time p95 | 56.01 ms | 52.45 ms |
| Frame time p99 | 62.34 ms | 62.71 ms |
| Renderer transport wait/frame | 15.38 ms | 13.25 ms |
| GPU readbacks/frame | 3.016 | 1.011 |
| Readback/conversion time/frame | 9.09 ms | 5.77 ms |
| Lazy Locks armed/frame | 0 | 4.002 |
| Untouched Locks/frame | 0 | 2.000 |
| Triangles/frame | 2,122 | 1,906 |

Each mode has about 60 measured seconds; OFF has 1,279 frames and ON 1,360.
No measured interval exceeded 100 ms. The ON runs submitted roughly 10%
fewer triangles, so the observed ~6% FPS increase cannot all be attributed to
lazy synchronization. The reduction from three readbacks to one and two
untouched Locks per frame is consistent across both ON launches.

Artifacts: `build/lazy-games/mw3-{off1,on1,on2,off2}/`, with the same paths
under the remote test directory. Reports include raw per-worker timestamps,
thread histories, counters, CPU time, load, exact source hashes and captures.

## GTA2 gameplay with a live helper

All four launches reached the playfield. Reviewed OFF/ON captures retain the
player and HUD, with no visible corruption or reported GPU errors. Two guest
workers remained live throughout every measurement window. The helper recorded
no presentation events or lazy surface touches; this exercises lazy sync with
a live helper, but foreign-thread pixel access remains covered synthetically.

| Metric | Lazy OFF | Lazy ON |
|---|---:|---:|
| Aggregate FPS | 29.86 | 29.79 |
| Individual 15-second windows | 29.82–29.91 | 29.63–29.85 |
| Frame time p50 | 33.31 ms | 33.52 ms |
| Frame time p95 | 41.15 ms | 41.02 ms |
| Frame time p99 | 47.16 ms | 47.62 ms |
| Renderer transport wait/frame | 6.80 ms | 4.26 ms |
| GPU readbacks/frame | 1.002 | 1.001 |
| Readback/conversion time/frame | 3.37 ms | 5.70 ms |
| GPU backend fence calls/frame | 1.002 | 2.001 |
| Lazy Locks armed/frame | 0 | 1.001 |
| Untouched Locks/frame | 0 | 1.001 |
| Triangles/frame | 245.34 | 245.35 |

Each mode has about 60 measured seconds; OFF has 1,797 frames and ON 1,793.
No measured interval exceeded 100 ms. The game leaves the armed Lock untouched,
but presentation still requires one readback per frame. Lazy mode adds a GPU
backend fence call, not a second guest fence request (see the follow-up below);
the lower guest transport wait is not evidence of lower total work. Renderer
process CPU time/frame was 30.23 → 32.94 ms, and GPU process CPU time/frame was
53.92 → 55.62 ms. These are process CPU times, can overlap across cores, and
must not be treated as a wall-clock frame breakdown.

Reproduce with `--app=gta2_demo` and the same OFF/ON/ON/OFF sequence above.
Artifacts: `build/lazy-games/gta2-{off1,on1,on2,off2}/`; aggregate values for
both games are in `build/lazy-games/summary.json`.

## Default decision

Keep global lazy synchronization opt-in. MW3 consistently avoids two readbacks
per frame and is a candidate for app-specific enablement. GTA2 has unchanged
readback count and essentially unchanged FPS, with an additional backend fence call and
higher observed process CPU cost. These measurements do not justify enabling
the optimization globally.

Publication waits require cross-thread ordering and must not be removed based
on the backend fence counter alone. Retained GDI/native pointers remain the documented
limitation; these game captures are visual checks, not byte-exact pixel oracles.

## Fence attribution and scoped-barrier correction

A follow-up `--trace-fences` GTA2 diagnostic recorded 91 frames, 91 publication
calls (`0x20007`) and 91 guest fence calls (`0x20001`). The merged snapshot's
`fences` field was the GPU backend's counter, overwriting the encoder field.
The queued flip calls the backend fence to materialize its pixels before
swapping DIBs; the subsequent guest request calls the backend again, with no
additional readback. The earlier description of two *transport* fences was
incorrect. `transportFences`, `publications`, and `publicationWaitMs` now keep
these costs separate. `--trace-fences` collects diagnostic call stacks and
must not be used for performance comparisons.

The same inspection found a separate redundant guest barrier: when a shared
lazy fence synchronizes the requested span but returns 2 because another
target is still dirty, `d3dim_surface_fence` issued the identical request again.
It now reuses the completed scoped barrier while retaining pending state for
other targets. Software and pending-presentation paths keep their full barriers.

The focused two-target regression fails on the previous implementation with
two calls instead of one and passes after the change. It covers both the owner
and a foreign instance, plus software fallback; the existing real-Worker
contention/read/write tests also pass. Shared-render transport tests verify
that publication and explicit-fence counts remain distinct.

### Matched before/after validation

Both arms enable lazy sync. Eight launches use BEFORE/AFTER/AFTER/BEFORE per
game, two 15-second windows per launch (60 seconds per variant per game).
Both artifacts were rebuilt from the same frozen remote sources, differing
only in the scoped-barrier correction; host-source hashes match across all
arms. The rebuilt baseline is not byte-identical to the older runtime used
in the OFF/ON experiment above, so compare only within this new experiment.

| Metric | MW3 before | MW3 after | GTA2 before | GTA2 after |
|---|---:|---:|---:|---:|
| FPS | 22.41 | 22.97 | 29.76 | 29.84 |
| Frame time p95 | 55.55 ms | 53.74 ms | 41.50 ms | 40.91 ms |
| Transport fences/frame | 3.997 | 3.004 | 1.001 | 1.000 |
| GPU backend fence calls/frame | 3.996 | 3.005 | 2.001 | 2.000 |
| GPU readbacks/frame | 0.999 | 1.002 | 1.001 | 1.000 |
| Publications/frame | 3.997 | 4.005 | 1.000 | 1.000 |
| Publication wait/frame | 1.00 ms | 1.09 ms | 0.64 ms | 0.86 ms |
| Total transport wait/frame | 13.51 ms | 13.20 ms | 4.15 ms | 4.86 ms |
| Triangles/frame | 2,162 | 2,029 | 245.51 | 245.04 |

MW3 avoids one redundant guest fence per frame. GTA2 does not exercise that
duplicate, and its request/readback counts stay unchanged. Publication waits
are included in total transport wait, not additive. No FPS improvement is
claimed: MW3's geometry differs, its windows span 20.18–24.68 FPS before and
21.76–24.64 after, and sampled host load reached 4.45 (above the usual quiet
benchmark threshold of 4). The request-count reduction is the direct result.

All eight launches reported zero GPU errors and no measured frame interval
over 100 ms. Reviewed before/after captures retain the cockpit or playfield
and HUD. GTA2 has two live guest workers in every window; MW3 has one.

Hardware synthetic validation: the complete 64-arm run passes 58 arms and
fails the six lazy arms for the three documented retained-GDI-pointer cases
(`gdi-retained`, `gdi-retained-write`, `gdi-blit-retained`). The strict run of
the 13 supported cases passes **52/52**, including real-Worker read/write,
write-only, thread lifetime, x87 overlap, backing replacement and release.
These limitations are still present; global lazy sync remains opt-in.

Artifacts: `build/lazy-games/fence-{gta2_demo,mw3}-{before1,after1,after2,before2}/`,
`fence-summary.json`, `gta2-fence-trace/`, `fence-synthetic/` and
`fence-synthetic-supported/`. Remote artifact binaries are
`build/lazy-fence-{before,after}.wasm`; canonical build artifacts were not
replaced. SHA-256 prefixes: before `357ba0bf44f63b23`, after `2c3477ace32507c4`.
