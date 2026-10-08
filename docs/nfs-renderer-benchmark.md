# Need for Speed renderer benchmarks

Headful Chrome on Apple M1, measured locally on 2026-09-28/29. These are
provisional loaded-machine observations: the one-minute load average exceeded
the repository's threshold of 4. Re-run on a quiet machine before treating the
numbers as stable performance rankings.

## NFS III

| Rendering route | Output | FPS, sample 1 / 2 | Combined FPS | CPU ms/frame |
| --- | --- | ---: | ---: | ---: |
| Original Glide → WebGL | 640×480 | 18.59 / 18.32 | 18.45 | 112.0 |
| Original D3D → WebGL with fallbacks | 640×480 | 7.86 / 7.19 | 7.53 | 266.3 |
| Original x86 software | 640×480 | 4.00 / 3.93 | 3.97 | 507.4 |

Each sample lasts 30 seconds. Combined FPS divides total frames by total
sample duration. In this run Glide delivered 2.45× D3D's frame rate and 4.65×
the original software renderer's. D3D made 5,694 and 5,400 software fallback
draws during its respective samples; this is the current mixed path.

The extra Glide → WAT software case measured 1.15 and 1.12 FPS at 640×480
(1,079 and 1,056 CPU ms/frame). Its first sample still includes the countdown;
the second starts in the race. Treat this as an additional compatibility-path
observation, not a perfectly synchronized scene comparison.

One-minute load averages at sample boundaries ranged from 10.5 to 17.3.
Browser: Chrome 153.0.8010.53; active accelerated contexts reported
`ANGLE Metal Renderer: Apple M1`. Build: `eec47c43`, WASM SHA-256
`2c289ebc508ed222f95ffe874acc942e3b220ddf27fbdd58d3d816ec4f5e3740`.
Raw results/screenshots: `build/nfs3-benchmark-final/`.

Run `node tools/nfs-renderer-bench.js --seconds=30 --samples=2` after building
and preparing the existing `nfs3_demo` fixture. Cases run serially in fresh
browser processes. The benchmark requires hardware WebGL for accelerated
cases, records the active renderer, and saves screenshots, process CPU time,
load averages, source/build/fixture identifiers, and raw counters.

The unmodified original demo selects `voodooa.dll`, `d3da.dll`, or
`softtria.dll` through its startup registry. All three render at 640×480.
Although the demo readme says 320×240 for software, a follow-up configuration
probe confirms selected, active raster, and backbuffer dimensions of 640×480
with a 1,280-byte pitch. Its evidence is in
`build/nfs3-software-resolution/software/result.json`. The fourth case uses
the original Glide renderer through Wine-Assembly's WAT rasterizer at 640×480.
It is distinct from the game's original x86 software renderer.

The served worker script overrides only the original demo's RNG-seeding
`GetTickCount` call. The signature is return address `0x4b3c7c` with caller
`0x472107` at ESP+16. Repeated reads at that stack receive seed 12345; the hook
disarms when the stack changes. This produces pursuit mode 3, AI flag 0,
weather flag 1, and night flag 0 for every case. Address `0x6fb3b4` cannot
validate the seed later: the game immediately reuses it as a timestamp.

Samples start after race geometry is visible and a ten-second warmup, without
accelerator input. Screenshots verify the cockpit/track scene. This is an idle
race-start workload, not a moving race or renderer pixel-parity test.

Frame counters are `grBufferSwap` for Glide, DirectDraw Flip for D3D, and
primary `dx_present` for the original software renderer, which does not Flip.
Page RAF and the performance HUD's combined presentation count are not used.
CPU milliseconds per frame sum browser-process CPU deltas from CDP, including
renderer and GPU processes; this metric is also affected by the workload and
does not make a contended run equivalent to a quiet-machine benchmark.

### Updated-base rerun (2026-09-29)

Merged main `3344817a` into Glide as `ed50bc08`, including `ff6dc0f4` texture
generation tracking. Resolved API registrations by preserving main's IDs and
appending Glide's entries, regenerated the tables, and reduced the Glide state
reservation from 4096 to 544 bytes (532 bytes used) so all five shuffled
memory layouts fit. Full build, Glide ABI and page-watch tests passed.

All three paths were remeasured with the same rebuilt WASM,
Chrome 154.0.8037.58, seed 12345, two 30-second samples, and no CPU profiler.

| Rendering route | FPS, sample 1 / 2 | Combined FPS | CPU ms/frame |
| --- | ---: | ---: | ---: |
| Original Glide → WebGL | 14.52 / 13.45 | 13.98 | 124.7 |
| Original D3D → WebGL with fallbacks | 10.79 / 10.27 | 10.53 | 189.4 |
| Original x86 software | 3.22 / 3.13 | 3.18 | 567.3 |

Glide's observed advantage is now **1.33×**, versus 2.45× in the old run.
This is not a controlled before/after measurement of the texture optimization:
main contains other changes, Chrome changed, and load differs. Sample-boundary
one-minute loads for these accelerated cases ranged from 22.4 to 33.2, so the
new ratio is also provisional.

The software samples had load 31.7–35.4; its selected, active raster and
backbuffer dimensions were again confirmed as 640×480 with 1280-byte pitch.
Its screenshots show the race underway but at an earlier timer value than
the accelerated arms, so these are not synchronized simulation frames.

The useful mechanism check is definitive: D3D recorded **zero texture byte
comparisons** across 633 measured frames. It still averaged 387.53 GPU
draws/frame versus Glide's 229.20, with similar triangle counts (1487.06 versus
1484.50). D3D had 24.55 software fallbacks/frame, exactly 2 readbacks/frame,
and 7.91 ms/frame in readback/synchronization. Draw time, including preparation,
was 20.63 ms/frame. Glide had no LFB reads or writes; both had zero renderer
errors. Screenshots show the same cockpit and track, but fog appearance
differs; this remains a workload comparison, not pixel equivalence.

WASM SHA-256:
`ce8952abbd2f2881096e7133e84f3a6b5ce4b24dca649b151f790684790db2b3`.
Artifacts: `build/nfs3-benchmark-updated/`.

```sh
node tools/nfs-renderer-bench.js --cases=glide,d3d,software --seconds=30 --samples=2 --out=build/nfs3-benchmark-updated
```

### Why the original NFS III D3D path was slower

Initial follow-up on 2026-09-29: the isolated Glide branch was missing main's
`ff6dc0f4` (selective backing-page generations). Consequently the table above
does **not** compare Glide against the latest optimized D3DIM implementation.
That commit's `docs/d3dim-dirty-tracking-perf.md` records 17.7–18.4 ms/frame
checking unchanged NFS III texture bytes on the old path, and zero texture
byte checks over 357 frames on the new path. Its FPS observations were not a
controlled A/B. The updated-base rerun below includes the fix in both arms.

The original two samples nevertheless expose specific costs in this branch:

| Work per frame | Glide | D3D |
| --- | ---: | ---: |
| Triangles | 1,483.20 | 1,483.40 |
| GPU draws (including lines) | 229.14 | 386.28 |
| Software fallback draws | 0 | 24.54 |
| Full-target GPU readbacks | 0 | 2.00 |
| Emulated guest blocks | 283,667 | 398,084 |

Matching triangle counts argue against omitted bulk geometry, but are not
pixel-parity evidence. D3D submits smaller batches and executes about 40%
more guest blocks. Its worker-local WebGL backend reads the framebuffer back,
converts it to RGB565 and writes a guest DIB for presentation. Readback/sync
timing averaged 7.95 ms/frame; that alone cannot explain the entire gap.
These are host elapsed timers, not GPU timer queries, and draw timing includes
texture preparation, so the timing fields must not simply be added together.

An optional `--profile` run confirms the remaining details:

```sh
node tools/nfs-renderer-bench.js --cases=d3d,glide --seconds=20 --samples=1 --profile --out=build/nfs3-renderer-profile
```

All 2,496 fallback draws in the D3D sample were primitive 3 (line strip),
vertex type 3 (transformed/lit), count 2: 24 per frame. This is consistent
with the rain lines; Glide draws its lines on the GPU. They are clustered:
there were two readbacks per frame, not one per fallback. The D3D guest
worker's largest sampled JS self-time was `bytesEqual` (2.69 seconds),
confirming repeated unchanged-texture scans as a real hot path in this build.
Main's generation-tracking fix removes that scan but does not remove the
line-strip fallback, readback/presentation path, or per-draw processing.

Profiling used Chrome 154.0.8037.58 and the `99992ba2` WASM. Load averages
were 74–104 during the samples, with profiling enabled, so these profiles
support attribution and primitive counts, not a new stable FPS comparison.
Profiles start/stop sequentially around the timed window and include a small
amount of work outside it. Raw profiles and fallback counts are in
`build/nfs3-renderer-profile/`.

### What triggers D3D readbacks

GPU draws mark the render target dirty and set the WAT pending-work flag.
`d3dim_worker_fence` sends opcode `0x20001` only when work is pending;
`D3DIMGpu.fence()` reads each dirty target with `gl.readPixels`, flips rows,
packs pixels into the guest surface format (RGB565 for NFS III), and writes
the guest DIB. It also updates the shadow copy and page generations.

Consumers that request this synchronization include:

- A rejected GPU primitive: the software rasterizer needs the existing image
  in RAM before adding pixels. Subsequent GPU work uploads changed DIB rows.
- DirectDraw `Lock`, `Blt`, `BltFast` and `GetDC`: these expose or operate on
  CPU-visible pixels.
- DirectDraw `Flip`: this backend declines the GPU flip command and follows
  the DIB swap/presentation path, which needs current pixels in guest RAM.
- `EndScene` when rendering directly to a primary surface; it is not an
  unconditional readback for every scene.

After a fence the dirty/pending flags clear, so a cluster of software lines
shares one readback until another GPU draw occurs. The fence currently
flushes all dirty targets, even if the CPU access concerns another surface.
An actual caller census now identifies both readbacks in every one of 334
measured NFS III frames:

| Trigger | Guest call site in loaded `d3da.dll` |
| --- | --- |
| First rejected line-strip draw of the frame | RVA `0x4ce9`: `DrawPrimitive(LINESTRIP, TLVERTEX, count=2, flags=12)` |
| Presentation | RVA `0x4fd4`: `Flip(NULL, DDFLIP_WAIT)` |

Captured WASM stacks independently identify `d3dim_worker_route` beneath
`handle_IDirect3DDevice2_DrawPrimitive`, and `handle_IDirectDrawSurface_Flip`.
The guest argument stack confirms the primitive/type/count and Flip flags.
There were **no Lock-triggered readbacks** in either measured window. Rain
is consistent with these short lines, but the proven trigger is the rejected
two-vertex line strip. Texture generation tracking does not remove either
GPU-to-CPU image transfer.

The updated unprofiled comparison was 94.978 ms/frame for D3D and 71.525 for
Glide: a 23.453 ms gap. D3D's 7.907 ms/frame synchronization time accounts for
33.7% of that gap. Subtracting all of it leaves 87.072 ms/frame (11.485 FPS),
still 15.547 ms/frame behind Glide. This is accounting, **not a causal speedup
prediction**: readback timing includes GPU waiting, conversion and copying,
and waits may expose work submitted earlier. It does not explain the entire
measured difference. D3D also performs 69% more GPU draws and 12.4% more guest
blocks per frame in the updated run; renderer-process CPU was 160.74 versus
105.70 ms/frame, including multiple threads.

The separate caller census used `--readback-census --cases=d3d --seconds=20
--samples=2 --out=build/nfs3-readback-callers`. It records guest return
addresses, a first-seen WASM stack per caller, and a timer around `readPixels`.
Its 334 frames spent 10.15 ms/frame synchronizing, split into 5.30 ms inside
`readPixels` and 4.85 ms converting/copying/bookkeeping. Its load was 64–84,
so this timing must not be substituted into the earlier A/B gap. The stable
result is the caller count: one line-strip readback and one Flip readback
per frame in both samples. These probes modify served scripts only.

### GPU line-strip support follow-up (2026-09-29)

`lib/d3dim-gpu.js` now accepts transformed/lit LINESTRIP primitives and
expands adjacent vertex pairs onto the existing GPU line-list path. Each
segment retains its first vertex's flat color and the software path's
untextured, depthless, unblended line semantics. Focused tests cover two-vertex
strips, longer strips with distinct segment colors, odd-sized line lists,
incomplete strips, and non-finite unused line depth.

A headful NFS III caller-census run covered 433 frames in two 20-second
samples: **zero fallbacks**, 24.35 GPU lines/frame, exactly **one readback/frame**
and zero framebuffer uploads. Every measured readback is now from `Flip`;
the DrawPrimitive readback disappeared. Rain is visible in the screenshot,
and there were no renderer errors. Readback/sync averaged 4.97 ms/frame.

The run observed 10.80 FPS, but used diagnostic instrumentation, load 24–30,
and a different elapsed scene position/triangle count from the earlier run;
it is not a controlled before/after speedup measurement. The confirmed
improvement is elimination of the software-line transition, its readback,
and the subsequent framebuffer re-upload. GPU endpoint coverage inherits
the existing line-list path and can differ by a pixel from software Bresenham.
Artifacts: `build/nfs3-linestrip-gpu/`.

### Remaining costs after GPU line strips (2026-09-29)

Profiles on `4f5e6330`, with the same WASM as the updated-base run, are in
`build/nfs3-post-lines-profile/`. Each route ran headful for one 25-second
sample with `--profile`; no production instrumentation was added. Both have
zero renderer errors; D3D has zero fallbacks/uploads/texture byte comparisons
and exactly one Flip synchronization per frame.

On the D3D guest-main worker, 67.9% of sampled elapsed time is in WASM,
19.6% under `_draw`, 6.3% under `fence`, and 5.2% idle. These are sampled
thread-time categories, not GPU execution times, and include some work outside
the timed window while the profilers start/stop. Top WASM functions resolve
to x87 emulation, uop execution, conditional branches, loads/stores and guest
address translation (`x87_island_fast`, `uop_fast`, `th_fpu_mem_ro`,
`th_jcc_ge`, `th_load32_rop`, `th_store32_rop`, `g2w_slow`). The GPU rasterizes
the scene, but the game's CPU work and original renderer DLL still execute
through the x86 emulator.

D3D's own elapsed timers average 21.45 ms/frame in draw preparation/submission
and 4.66 ms/frame in synchronization. It issues 346.19 GPU draws/frame versus
Glide's 220.83, despite fewer triangles in its sampled scene (1346.32 versus
1440.82). Glide merges adjacent identical-state draws; D3DIM expands vertices
and submits each call through the generic D3D9 fixed-function backend.

That generic path calls `Fixed.compile` on each draw, rebuilding shader source
and metadata before looking up the cached GPU program. This is **source
generation, not repeated GPU shader compilation**. The profile attributes
993.6 ms total (3.7% of the sampled worker, roughly 3.5 ms per measured frame)
to fixed-function compilation/lowering. A safe optimization candidate is to
cache the validated static shader/declaration plan while updating dynamic
uniforms separately. Ordered draw coalescing could also reduce submission
work, but must preserve dependencies on texture/surface writes and fences.
Most ordinary WebGL state and uniform updates are already cached.

Observed FPS was D3D 11.30 and Glide 16.14, with load 45–67 and profiler
overhead. This is bottleneck evidence, not a stable speed ranking or a
controlled before/after comparison. The dominant remaining overall cost is
CPU emulation; the D3D-specific optimization target is draw processing and
batching, with the remaining readback a smaller component.

### Fixed-plan caching and ordered batching (2026-09-29)

Implemented the two draw-processing optimizations above. D3D9 keeps a bounded
64-entry cache for the bridge's validated TL fixed-function plans and refreshes
dynamic uniforms for each draw. Other pipelines retain full compilation.
D3DIM merges adjacent identical-state draws in order, with a 64 KiB vertex
limit and barriers for texture changes, target changes, clears, CPU access,
fallback and presentation. New texture uploads and previously unseen state
keys submit immediately. Accepted deferred draws cannot silently disappear
on failure, including during shutdown.

Headful Apple M1 A/B uses the same guest/WASM and the seeded scenario above.
The harness now supports `--no-d3d-batching --no-fixed-cache`, applied only to
served scripts, and records these flags plus the source hashes. Artifacts:
`build/nfs3-drawopt-off/`, `build/nfs3-drawopt-on/`, and
`build/nfs3-drawopt-off-repeat/`. Each contains two 20-second samples.

The first disabled run measured 10.66–11.67 FPS, 334–360 GPU submissions/frame,
and 17.44–19.70 ms/frame in backend submission. Enabled measured 12.34–12.52
FPS and 200–209 GPU submissions from 392–419 guest draws/frame: 49–50% were
merged. Backend submission time was 8.98–9.11 ms/frame, total draw processing
16.08–16.15 ms/frame, and synchronization 4.07–4.18 ms/frame. Both routes had
zero renderer errors/fallbacks and exactly one readback/frame. `drawCalls`
now counts logical draws, `draws` actual GPU submissions, and `mergedDraws`
eliminated submissions. `submitMs` measures the backend; `drawMs` also includes
descriptor validation and deferred flushes.

System load fell from about 40 to 31 across those first runs; two WASM
regression compilations also overlapped the first disabled run. Consequently
the FPS difference is not a controlled speedup claim. The scene is seeded but
not a frame-synchronized replay, and guest draw totals differ. The direct
batching reduction is the strongest result; pixel parity is tested separately.
The disabled repeat measured 11.29–12.35 FPS, 333–360 submissions/frame,
16.06–18.30 ms/frame in backend submission and 20.62–23.23 ms/frame total
draw processing (load 32–38). Its FPS overlaps the enabled run, so these
measurements establish reduced submission work, not a stable overall speedup.

Validation passed: real WebGL batch-on/off framebuffer bytes match exactly
at four fences, with independent expected colors for alpha ordering, a state
change, clear and texture replacement. Pure-JS regressions cover bounded
queues, owned vertices, fallback/release ordering, deferred failure/shutdown,
timing, and fixed-plan validation/dynamic uniforms. Existing depthless/line,
texture-wrap and page-watch regressions pass. The optimized NFS III screenshot
shows the cockpit, road, HUD and rain; its renderer reports no errors.

### Local dropdown testing

The debug dropdown includes `nfs3_glide_demo` and `nfs2se_glide_demo`. The
former uses the existing NFS III candidate manifest and selects `voodoo` in
the startup registry. The latter selects `THRASH_DRIVER=1` and requires the
local SE fixture at `build/nfs2se-demo` plus `build/nfs2se-browser.json`.
For an existing `build/nfs2se-config.json` produced by the SE benchmark,
the browser manifest uses its `files` array with the leading `build/` removed
from each URL (URLs resolve relative to the manifest), wrapped in
`{schemaVersion:1,files:[...]}`. Both entries were launched through the real
dropdown and rendered with zero renderer errors.

## NFS II

**Correctness update:** these measurements predate the W-buffer unused-Z fix.
Driving revealed missing terrain/car triangles when NFS II SE left `ooz`
non-finite. Identical-frame replay confirms the fix restores those pixels;
see `docs/re-notes/need-for-speed.md`. The old Glide timings therefore include
incorrectly omitted geometry and need a fresh benchmark before performance
conclusions about the corrected renderer.

| Demo / rendering route | Output | FPS, sample 1 / 2 | Combined FPS | CPU ms/frame |
| --- | --- | ---: | ---: | ---: |
| Original NFS II software | 640×480 | 50.82 / 50.12 | 50.47 | 40.84 |
| NFS II SE Glide → WebGL | 640×480 | 15.23 / 11.54 | 13.36 | 141.61 |

The original software demo measured **50.47 FPS** at 640×480: 50.82 and
50.12 FPS over two 30-second samples, with combined CPU time of 40.84 ms/frame.
It uses primary presentations rather than Flip. Screenshots show the Ford
cockpit on Pacific Spirit with no accelerator input; AI cars continue racing.
Chrome 154.0.8037.58, build `99992ba2`; sample-boundary one-minute load was
7.44–8.00. Artifacts: `build/nfs2-benchmark-original/`.

The SE Glide run uses a tropical coastal track and the default chase view,
with the accelerator released. Its hardware context reports Apple M1 Metal.
One-minute load rose from 16.49 to 28.37 across its samples, so its observed
FPS has substantial contention noise. Artifacts: `build/nfs2-benchmark-glide/`.
Both NFS II runs use the same WASM, SHA-256
`31def86bc3701c16bb76f617854cc9eefa323cc6a2965dfbcc672dba0e15476c`.

The same SE executable through the WAT software Glide backend measured
1.29 and 1.49 FPS (989 and 818 CPU ms/frame) at 640×480. Screenshots show the
same starting position and chase camera, but its first sample includes the
countdown while WebGL has already completed that phase. The second software
sample begins in the race. No renderer errors occurred. Its one-minute load
ranged from 17.14 to 23.48. These are additional compatibility-path measurements,
not synchronized-frame replay results. Artifacts:
`build/nfs2-benchmark-glide-software/`.

The installed original software demo and the public SE 3Dfx demo are different
editions with different tracks (TR03 versus TR04). Any comparison between
them measures those complete demo workloads, not an isolated renderer change.
The SE demo contains only `NFS2SEA.EXE`; it has no original software renderer.
The same SE executable can separately compare our WebGL and WAT Glide backends.

Use `tools/nfs2-renderer-bench.js`; inspect its menu/race screenshots before
interpreting counters as gameplay. The default leaves acceleration released.
Pass `--se-fixture=/path/to/extracted/demo` for the SE demo; `--help` includes
the public demo source and archive hash. The harness sets the game's supported
environment override `THRASH_DRIVER=1` to select Glide. Without it, automatic
selection chooses the unavailable PowerVR/SGL route and exits before racing.
The benchmark does not patch the guest executable.

## Release 2026-09-30 rerun

Base `0a972f06` (release/2026-09-30), headful Chrome, serial, threads on, two
30-second samples per case, load average 6-12 throughout (provisional, like
every number above). All screenshots were checked to be mid-race.

| Demo | Renderer | Sample fps | CPU ms/frame |
| --- | --- | --- | --- |
| NFS III (`nfs-renderer-bench.js`, seed 12345) | Glide (`voodooa.dll`) | 22.6, 22.3 | 88, 94 |
| | D3D (`d3da.dll`) | 23.7, 24.6 | 95, 98 |
| | software (`softtria.dll`) | 5.9, 8.1 | 364, 261 |
| NFS II (`nfs2-renderer-bench.js`) | original software demo (TR03) | **13.9, 12.7** (69.5, 63.3 primary presents/s ÷ 5) | 150, 164 |
| | SE Glide demo (TR04, post W-buffer fix) | 17.2, 18.4 | 134, 125 |

NFS III: Glide and D3D are level within this box's noise (the 09-29 rerun had
Glide ahead, 13.98 vs 10.53, before the D3D batching work), and both are about
3x software. The desktop `nfs3_demo` entry used to set no `Thrash Driver` and
so started on `softtria.dll`, the slowest renderer; it now starts on Direct3D
(`b8382e31`). Distinct present hashes alone did not show that NFS II's count
was a frame rate (every one of 760 presents hashed differently, yet each
was one fifth of a frame); see the NFS II paragraph above.

NFS II: **the software demo's counter is not a frame rate.** The bench counts
DirectDraw primary presents for it, and the original demo writes each frame
to the primary in five separate Lock/Unlock presents: three horizontal bands
of the 3D view (rows 45-136, 137-212, 213-309), the right-hand dashboard
area, then the clock (rows 5-57). Measured in the CLI with
`--present-distinct`, which now histograms the region each present changed:
over 420 presents in a race with the throttle held, the top-band box occurs
exactly 84 times, one per frame. Divided by five, the software demo runs
about 13 fps against the SE Glide demo's 17-18 (Glide buffer swaps, one per
frame), so Glide is about 1.35x faster. Different editions and tracks still,
so this is the cost of the complete workloads, not of the renderer alone.
