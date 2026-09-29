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
