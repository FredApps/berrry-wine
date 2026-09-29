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

### Why this NFS III D3D path is slower

Follow-up on 2026-09-29: the isolated Glide branch is missing main's
`ff6dc0f4` (selective backing-page generations). Consequently the table above
does **not** compare Glide against the latest optimized D3DIM implementation.
That commit's `docs/d3dim-dirty-tracking-perf.md` records 17.7–18.4 ms/frame
checking unchanged NFS III texture bytes on the old path, and zero texture
byte checks over 357 frames on the new path. Its FPS observations were not a
controlled A/B. Re-run both renderers on the same updated base before quoting
a current speed ratio.

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
