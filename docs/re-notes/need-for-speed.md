# Need for Speed Windows demos

## Fixtures and launch

`nfs2_demo` and `nfs3_demo` are local candidate apps. Fetch with:

```sh
node tools/fetch-candidate-corpus.js --id=need-for-speed-2-demo,need-for-speed-3-demo
```

Sources and archive SHA-1 values are recorded in `test/binaries/SOURCES.md`
and the candidate manifest. Both entries mount the complete extracted tree
through `.wine-assembly-browser.json`. No guest executable patches.

NFS II is the 1997 original software/DirectDraw demo (`nfsw.exe`), not the
Glide-only Special Edition. CLI and cooperative browser runs render its
640x480 main menu. A browser probe also entered a race and applied Up-arrow
input: subsequent frames show the race clock advancing, cockpit view, and
changed car position. This verifies race entry and input, not a full race.

The separately acquired public NFS II SE 3Dfx demo contains `NFS2SEA.EXE`
(SHA-256 `7e357542a3f7a3a67f6fac06c299e6bdc23529f0b9a16d9e7639079e56c039d9`).
Use `tools/nfs2-renderer-bench.js --help` for its source/preparation command.
It includes TR04 assets rather than the original demo's TR03/Pacific Spirit,
so these demos do not provide an isolated software-versus-Glide comparison.

Set the supported guest environment variable `THRASH_DRIVER=1` to select
Glide. The selector at `0x4b5b50` parses the value as a decimal driver index;
1 is Glide, 2 is PowerVR. Automatic probing currently picks PowerVR because
the missing `sgl.dll` receives the loader's synthetic success handle; its
subsequent missing exports cause startup to exit. Explicit selection avoids
that unrelated route without modifying the executable.

All 50 decorated Glide exports resolve after adding `grTexCombineFunction`
and `guFogGenerateExp`. Driver index `0x4d4fc8` is 1, init pointer `0x5553f8`
is `0x48dd34`, and `0x4d4978` marks completed video initialization. The public
demo reaches the tropical coastal race directly, without the original demo's
menu walk. Benchmark screenshots and timings are in
[the renderer benchmark report](../nfs-renderer-benchmark.md).

### SE W-buffer geometry corruption (2026-09-29)

Driving the Glide demo exposed blue holes through road/beach geometry and
missing pieces of cars. NFS II SE uses W buffering and table fog (`state[11]
= 2`, `state[22] = 2`); `GrVertex.oow` is valid, while unused `ooz` contains
arbitrary bytes, including NaNs. Our WebGL vertex conversion incorrectly fed
`ooz` into clip-space Z before the fragment shader calculated W depth.

A captured bad frame has 9,708 vertices, 4,765 non-finite `ooz` values and
zero non-finite `oow` values. The frame begins with a full color/depth clear.
Replaying identical resources and 1,427 commands with the old and corrected
backends changes 118,588 pixels and restores road, terrain and car geometry.
The first captured frame happened to look normal and replayed identically
despite some invalid unused Z values; it was not sufficient evidence alone.

W-buffer clip coordinates now use neutral finite Z. Explicit Z fog/combiner
inputs retain their separate varying; the software adapter also avoids
consuming unused Z. Regression tests cover finite, NaN, infinite and huge
unused Z values on WebGL1/2, plus preservation of explicit Z fog. WebGL,
native backend and WAT software tests pass. A further acceleration run
reaches about 90 on the HUD and the previously affected beach section without
the holes. Artifacts: `build/nfs2-glide-driving{,-fixed}/`,
`build/nfs2-badframe/`, `build/nfs2-bad-replay-{before,after}/`.

The SE harness supports `--capture-frame`, bounded `--capture-min-blue=N`
selection for this symptom, and `--glide-source=PATH` for diagnostic replay
of an older backend without replacing production files. Captures include
texture RAM, palettes, fog table, frame commands and vertex ranges. The
existing NFS II performance measurements predate this correctness fix and
must not be treated as timings of fully rendered geometry.

```sh
node tools/profile-web-frames.js --app=nfs2_demo --warmup=2 --seconds=25 '--guest-script=click:130:310@35:0.3,key:13@5:0.3,key:38@15:3' --film=/tmp/nfs2-race:10
```

The click targets the main menu's RACE option. If startup is slower, wait for
that menu before clicking; input during the opening title screen is too early.

```sh
node test/run.js --app=nfs2_demo --no-build --quiet-api --quiet-blocks --max-batches=10000 --batch-size=100000 --max-seconds=40 --png=/tmp/nfs2.png
```

NFS III is the September 1998 final demo (`nfs3demo.exe`), with Corvette,
Rocky Pass, and random race/hot-pursuit/weather selection. It needs
`install.win`; just extracting the archive gives a misleading corrupted-files
error. The recipe reproduces the 578-byte file from the original installer:
English/local mode, relative asset paths, CRLF, final Ctrl-Z. Re-run
`--prepare --id=need-for-speed-3-demo` to update an existing fixture.

The original installer sequence is root `setup.exe` (PE bootstrap),
`Setup/English/Setup.exe` (NE InstallShield), then captured
`C:\windows\temp\_ins0432._mp` with `_wutl95.dll` seeded and arguments
`-fC:\setup\english\SETUP.INS -z1 -cx -xC:\WINDOWS\TEMP\`.
Welcome, destination, program folder, and shortcut dialogs lead to the
installed tree under `C:\Program Files\Electronic Arts\Need for Speed III Demo`.

NFS III loads its original software renderer `softtria.dll` at `0x00b30000`.
With worker threads and real-time clocks, the CLI renders the car and track.
The browser also reaches race startup: the Corvette loading screen at 10s,
the starting-grid camera at 21s, and cockpit/race HUD at 31s after launch.
These are sampled observations, not minimum loading times. Safari itself has
not been verified. The earlier 100-second CLI loading stall used the default
batch-driven clock and was not a reliable browser reproduction.
Raise the CLI stuck threshold: a startup polling loop at `0x004e5ad0`
otherwise triggers the default same-EIP detector after only 11 batches.

```sh
node test/run.js --app=nfs3_demo --threads --real-ticks --no-build --quiet-api --quiet-blocks --stuck-after=100000 --max-batches=100000 --max-seconds=40 --batch-size=10000 --png=/tmp/nfs3.png
```

## Texture cache page tracking

The WebGL cache now watches only texture/palette/render-target backing pages.
Guest aliases and Worker instances share atomic generations; CPU, bulk,
native drawing and host writes notify them. An unchanged texture checks page
versions instead of scanning pixel bytes. `test-page-watch.js` covers missed
notifications, independent consumers, native rendering, buffer swaps and
fallback behavior. Real NFS III gameplay passed a pixel-shadow audit with
zero misses through 554k triangles; normal mode made zero texture byte
comparisons over 357 measured flips. See
[dirty-tracking measurements](../d3dim-dirty-tracking-perf.md) for artifacts
and the machine-load limits on the observed FPS.

## Compatibility fixes

The browser worker loop must finish pending thread instantiation before
starting its next main-thread slice and publishing that slice's clock.
Previously main resumed concurrently with asynchronous worker initialization.
NFS II could start its timer-readiness deadline before the timer worker existed,
then abort with `getcpuspeed - INITTIMER REQUIRED TO DETERMINE CLOCK RATE`.
The check at `0x00483232` waits for the counter at `0x0051e11c` to advance,
then tears the timer down at `0x0048325b` if the deadline expires.
The startup barrier keeps actual execution concurrent once workers exist;
neither demo disables threads. A deferred-start regression in
`test-host-raf-present.js` fails without the barrier and passes with it.
Browser worker runs then reach NFS II's main menu (first sampled at 10s in
one run). `test-worker-thread-scheduler.js` passes all 50 checks, and the
browser DirectDraw presentation/vblank tests pass.

Use `--real-ticks` for these timing investigations: the CLI's default 200ms
per batch can expire the timer initialization check before a worker runs.

NFS II needs `WaitForMultipleObjectsEx`. It now delegates the non-alertable
wait to the existing multiple-object handler while preserving its 24-byte
stdcall cleanup and APC/wait-resume behavior. Covered in `test-read-file-ex.js`.
Its worker wrapper at `0x004856e0` calls the thread function then returns
through the thread sentinel; EIP-zero termination there is not a main-thread
crash.

NFS III queries actual VERSION string data. `VerQueryValueA/W` now traverses
the resource tree instead of returning the old fixed product-name string
for every key. Tests cover language tables, translations, root pointers,
missing keys, malformed children, case-insensitive keys, wide strings, and
unchanged input bytes. The Win16 synthesized GDI version translation trailer
is handled in its wrapper, preserving `test-win16-version.js` behavior.

Validation: full build, `test-file-version-info.js`, `test-read-file-ex.js`,
`test-static-dx-version.js`, and `test-win16-version.js` pass. The broad app
registry check has unrelated missing Baldur's Gate/Snood fixtures in this
shared checkout.

### NFS III D3D versus Glide profiling (2026-09-29)

The isolated Glide branch benchmark predates main's `ff6dc0f4` texture
generation tracking. Its D3DIM `_texture` checks unchanged bytes on every
textured draw; a worker CPU profile confirms `bytesEqual` is hot. Main already
eliminates those scans, so the old 18.45 versus 7.53 FPS comparison must not
be presented as a comparison against current main D3D.

Updated-base rerun: merge `ed50bc08` includes main `3344817a` and the texture
tracking fix. Two 30-second headful samples per route measured Glide 13.98,
D3D 10.53, original software 3.18 FPS at 640×480 (high load 22–35, provisional).
D3D textureByteChecks=0 over 633 frames; syncs=2/frame, syncMs=7.91/frame,
fallbacks=24.55/frame. Artifacts: `build/nfs3-benchmark-updated/`. The earlier
2.45× ratio is superseded by the updated-base observed 1.33× comparison.
Fences supply current GPU pixels to CPU primitive fallbacks, DirectDraw pixel
access and DIB-based Flip presentation; pending/dirty flags coalesce repeated
CPU operations until another GPU draw. Aggregate counters do not identify the
specific two triggering calls per frame. See the benchmark report for details.

Follow-up caller census identifies both triggers in all 334 measured frames:
`d3da.dll` RVA `0x4ce9` invokes Device2 DrawPrimitive with LINESTRIP=3,
TLVERTEX=3, count=2, flags=12; first fallback fences pending GPU work. RVA
`0x4fd4` invokes Surface Flip(NULL, DDFLIP_WAIT=1), causing the second fence.
No Lock-triggered readbacks occur during these samples. Guest stack arguments
and captured WASM call stacks independently confirm both. Artifacts:
`build/nfs3-readback-callers/`; reproduce with `--readback-census` in the NFS III
harness. Prior uninstrumented synchronization time accounts for about one
third of the measured wall-time gap, not all of it.

GPU LINESTRIP support added afterward: adjacent segments now use the existing
GPU line-list path, with each segment's first-vertex flat color. The NFS III
validation run (`build/nfs3-linestrip-gpu/`) measured 433 frames with zero
fallbacks, about 24 GPU lines/frame, one readback/frame exclusively from Flip,
and zero framebuffer re-uploads. The line fallback's readback is eliminated.
Rain remains visible and renderer error counts remain zero. This leaves the
DIB-based presentation readback as the remaining transfer in this workload.

Post-fix CPU profiles (`build/nfs3-post-lines-profile/`, `4f5e6330`) show the
D3D guest-main worker spends about 68% of sampled elapsed time in WASM
(mostly x86/x87 execution), 20% in draw processing and 6% synchronizing.
D3D still submits about 346 GPU draws/frame versus Glide's 221; its draw
timer is 21.45 ms/frame, Flip sync 4.66 ms/frame. Fixed-function shader source
generation/metadata lowering repeats before the GPU program cache lookup
and accounts for roughly 3.5 ms per measured frame. Static-plan caching and
ordered draw coalescing are candidates, not implemented optimizations.
Machine load 45–67 and profiling overhead preclude stable FPS claims.

The optional `tools/nfs-renderer-bench.js --profile` census identified every
sampled software fallback as primitive 3 (line strip), vertex type 3 (TL),
count 2: 2,496 calls over 104 frames. Rain is the likely source. Two full-DIB
readbacks per frame remain, not one per line. Earlier counters show virtually
identical triangle totals for D3D/Glide but 386 versus 229 GPU draws/frame and
40% more guest blocks for D3D. See `docs/nfs-renderer-benchmark.md` for evidence,
profiling limitations, artifacts and reproduction.
