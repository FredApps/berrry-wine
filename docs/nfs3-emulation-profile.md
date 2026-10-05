# NFS III emulation profile — 2026-09-29

General unprefixed `MOVSD` now lowers into the micro-op tier. The initial
profile below identified two such instructions blocking an otherwise supported
integer loop. Remote validation subsequently removed over 99.97% of its three
hot residual block entries per frame. A fixed-work reproduction reduced CPU
time by 47–56%; whole-game measurements did **not** establish an FPS gain.
The initial investigation and subsequent implementation results are separated
below because their machines, instrumentation and rendering costs differ.

## Capture

Initial Glide worktree at `32ef6f09`, original NFS III demo, seed 12345,
640×480, AI off, rain on, idle cockpit at the race start. Three 20-second
windows per renderer, serial headful Chrome on Apple M1. Artifacts are in
`build/nfs3-guest-profile/{glide,d3d}/`: per-window handler/block JSON,
micro-op census logs, page/worker CPU profiles, screenshots and results.
WASM SHA-256:
`ce8952abbd2f2881096e7133e84f3a6b5ce4b24dca649b151f790684790db2b3`.

```sh
node tools/nfs-renderer-bench.js --cases=glide,d3d --seconds=20 --samples=3 --guest-profile --profile --out=build/nfs3-guest-profile
node tools/browser-handler-hist.js build/nfs3-guest-profile/glide/sample-1-hist.json --top=15 --blocks=15
node tools/uop-census.js build/nfs3-guest-profile/glide/sample-1-uop.log --hist=build/nfs3-guest-profile/glide/sample-1-hist.json --top=12
node tools/hot-loop-census.js build/nfs3-guest-profile/glide/sample-1-hist.json build/nfs3-guest-profile/glide/sample-2-hist.json build/nfs3-guest-profile/glide/sample-3-hist.json --top=12
```

The harness enables the existing histogram only on the actual guest-main
worker, reads all handler slots and block-table entries between slices, and
captures existing micro-op census events from initialization. It does not
read counters from the idle page instance or enable other workers' shared
histogram storage. Census capture is bounded and fails on truncation.
Each census log contains startup-to-window events plus that window's final
live-program dump; do not sum logs as independent windows. Aggregate runtime
counters are differenced against `guestBefore` for each window.

Dynamic DLLs were absent from the page module map in this threaded run.
Attribution was completed from recorded LoadLibrary addresses and the actual
DLL PE preferred bases; the harness now does this automatically. Renderer
DLL load base is `0xc30000`, preferred base `0x60000000`. Executable addresses
below are unchanged preferred/runtime VAs.

## Repeatable guest-code targets

Percentages below are shares of recorded **residual threaded block entries**,
not all guest instructions and not time spent in each loop.

| Target | Glide windows 1 / 2 / 3 | D3D windows 1 / 2 / 3 |
|---|---|---|
| `0x4c5f28`, `0x4c5f34`, `0x4c5f3a` combined | 13.77 / 12.95 / 12.55% | 12.19 / 11.97 / 11.04% |
| `0x4dec44` repeated x87 stores | 2.91 / 2.85 / 2.71% | 2.63 / 2.67 / 2.48% |

The first loop scans up to 2,000 eight-byte entries backwards from `0x7d7dd4`.
While the first local pair word is zero it copies the next pair into stack
locals using `MOVSD; MOVSD` at `0x4c5f3f/0x4c5f40`; its other branch links
nonzero entries. The census identifies MOVSD as unsupported, with a
`no-backedge` decline at the copy branch. Partial programs at neighboring
heads retire as poor; D3D retains one partial program, but still returns to
the same threaded copy branch. The useful fix is covering the full loop,
not disabling poor-program retirement globally.

The implementation uses the existing guarded load from ESI and store to EDI,
then adjusts both pointers using runtime DF without changing arithmetic flags.
Each copy completes separately, preserving sequential overlap. Prefixed forms
retain their existing threaded paths. Remote tests cover both DF directions,
overlap, flags, noncontiguous sparse page crossings, writable-code invalidation,
and the actual relocated record-loop shape.

The second loop performs four `FST m64` stores of ST0, advances the destination
32 bytes, and repeats. It is rejected as `head-unsupported` at `0x4dec44`.
A bounded repeated-store fusion is a separate candidate, provided x87
stack/status behavior and write notifications remain correct. It does not
justify a wholesale x87 rewrite.

## Tier behavior

| Counter, per-window range | Glide | D3D |
|---|---:|---:|
| Successful tier entries | 2.05–2.16 million | 2.50–2.85 million |
| Blocks retired in tier | 30.17–31.52 million | 23.28–25.14 million |
| Blocks per entry | 14.15–15.18 | 8.55–9.33 |
| Memory guard failures | 0 | 0 |
| New installs | 0–3 | 0–2 |

About 64–65% of residual block entries have no compile verdict at that exact
head. Their hot-table slots are shared with other addresses, but this does
not establish collisions as the cause: fallthrough/call-return entries can
also lack hot-head eligibility. Do not claim that resizing the table would
recover this share.

D3D repeatedly declines `0x4bf939` (320 cumulative attempts by window 3),
sharing a verdict-map slot with other heads. This is a secondary churn lead;
the measured CPU profile does not establish compilation as a major cost.
One D3D live dump contains an implausible head `0x6918000` with no matching
compile record. Per-head lifetime work totals from that dump are excluded;
the table above uses independent per-instance runtime-counter deltas.

## CPU samples and limits

Across three guest-main worker profiles:

| Interval-weighted sample category | Glide | D3D |
|---|---:|---:|
| WASM leaf frames, including instrumentation | 84.15% | 71.05% |
| Explicit histogram helpers, included above | 11.02% | 8.85% |
| Idle | 3.20% | 5.96% |
| D3DIM draw, inclusive | — | 15.29% |
| D3DIM fence, inclusive | — | 4.06% |

Both renderers share `$run`, `$uop_fast`, `$x87_island_fast`, and load/store
handlers among their largest guest hotspots. Raw sample counts broadly
corroborate these rankings. Glide's host RPC wrapper also occupies 11.49%
of weighted intervals, mostly under Glide flush/idle barriers; that includes
waiting for the main thread and is not all host computation.

Histogram dispatch counts are not instruction counts: one x87-island or
micro-op handler can execute many instructions. The block histogram omits
internal tier execution and reports collision counters of 316k–473k for
Glide and 73k–100k for D3D; percentages use recorded hits, not an exact census
of all blocks. Proximity-based region grouping does not prove a control-flow
loop, which is why the priorities above use disassembled individual blocks.

Histogram helpers alone consume roughly 9–11% of sampled intervals and
instrumentation affects dispatch paths. CPU-profile intervals can include
waiting/descheduling; they are not OS CPU accounting. System load was about
27–52. These runs identify repeated targets; they provide neither clean FPS
comparisons nor a predicted speedup. Rebenchmark any implementation with
histograms and CPU profiling disabled.

## Remote MOVSD implementation results

Reserved Linux box, four vCPUs on AMD Ryzen 9 9950X, Node 24.15.0,
Chrome 152. Browser runs used **SwiftShader**, with no hardware WebGL.
Baseline WASM SHA-256 is `ce8952abbd2f2881096e7133e84f3a6b5ce4b24dca649b151f790684790db2b3`;
candidate is `dd0ffaeacddf4f05753b4babf97132eface2824238a933c10647a786a2587473`.
Collected artifacts are under `build/nfs-movsd-box/`; profile function indices
were resolved against its `build/baseline.wat` and `build/combined.wat` respectively.

The complete compiler differential suite passed remotely, including forward
and backward copies, sequential overlap, flag preservation, unaligned seams,
noncontiguous backing pages, warmed store-window invalidation and the NFS
record scan. See `build/movsd-compiler-test.log` within that artifact directory:
288 programs compiled, 97 declined, zero guard failures and 22 invalidations.
The initial code-write fixture was corrected to enter its installed loop head;
the final pass verifies actual compiled entry before the guarded code write.

### Fixed-work CPU measurement

`movsd-loop.json` records seven alternating AB/BA pairs per shape after two
warmups per artifact. Every sample processes 500 scans of 2,000 records.
Resetting inputs and checking results occur outside timing. Registers, flags,
EIP and the complete 128 KB working buffer match between artifacts on every
run. Load average was zero at the start and end of this short measurement.

| Record shape | Baseline median CPU | Candidate median CPU | Median paired CPU reduction | Median paired wall reduction |
|---|---:|---:|---:|---:|
| All zero | 41.229 ms | 18.203 ms | 56.07% | 55.43% |
| Mixed zero/nonzero | 35.965 ms | 18.986 ms | 47.20% | 47.21% |

This isolates the periodic guest loop and excludes rendering. Process CPU
accounting includes any process background activity; warmup and alternating
order reduce that concern. The result is a loop improvement, not an FPS forecast.

### Game profile coverage

Two 20-second diagnostic windows per renderer/artifact are saved in
`build/box-profile-{before,after}/{glide,d3d}/`. The targeted addresses are
`0x4c5f28`, `0x4c5f34` and `0x4c5f3a`.

| Counter, aggregated per frame | Glide before → after | D3D before → after |
|---|---:|---:|
| Targeted residual block entries | 24,488.37 → 6.93 | 24,466.45 → 7.03 |
| All residual block entries | 176,976 → 146,023 | 165,191 → 131,900 |
| Recorded handler invocations | 1,155,711 → 1,041,310 | 1,124,771 → 994,202 |

The targeted blocks fall from 13.66–14.02% to 0.00472–0.00477% of Glide's
recorded entries, and from 14.62–15.00% to 0.00532–0.00535% of D3D's.
These counters exclude work moved inside the tier; they demonstrate coverage,
not equivalent reductions in total guest instructions.

Worker profiles remain dominated by renderer waits: Glide's synchronous RPC
wrapper accounts for 65.19% → 66.28% of weighted intervals; D3D's `readPixels`
accounts for 55.03% → 56.72%. Excluding explicit histogram helpers, weighted
WASM intervals per frame decrease from 16.46 to 15.45 ms for Glide and 15.25
to 14.25 ms for D3D. These are sampled intervals, **not OS CPU measurements**.
Histogram overhead, scene differences and SwiftShader waits limit attribution.
The common `$run`, x87, micro-op and load/store hotspots remain.

### Whole-game measurement limits

Uninstrumented ABBA sessions are in `build/box-{before,after}-{1,2}/`.
Aggregate results do not establish an improvement or a regression:

| Renderer | Baseline FPS | Candidate FPS | Change | Baseline CPU ms/frame | Candidate CPU ms/frame |
|---|---:|---:|---:|---:|---:|
| Glide | 16.7066 | 16.6749 | −0.19% | 202.048 | 203.298 |
| D3D | 17.8151 | 17.6136 | −1.13% | 199.995 | 201.641 |

CPU figures sum the browser process tree, including SwiftShader's GPU process;
they do not isolate the guest interpreter. Session FPS ranges overlap:
Glide baseline 15.528–17.886 versus candidate 15.760–17.590, and D3D
17.632–17.998 versus 16.948–18.280. Paired FPS changes reverse sign
(Glide +13.28%, −11.89%; D3D −3.88%, +1.56%). Fourteen of sixteen windows
trigger the four-vCPU contention flag. Rendering phase and software-GPU load
dominate this comparison. The supported conclusion is improved loop execution
and demonstrated tier coverage, with no proven whole-game speedup.

Reproduction on the reserved box, with its existing fixture and Chrome path:

```sh
STACK_BENCH_WASM=build/wine-assembly.wasm node test/test-uop-compiler.js
node tools/nfs-movsd-loop-bench.js --baseline=build/baseline.wasm --candidate=build/wine-assembly.wasm --iterations=500 --pairs=7 --warmup=2 --out=movsd-loop.json
node tools/nfs-renderer-bench.js --wasm=build/baseline.wasm --cases=glide,d3d --seconds=20 --samples=2 --swiftshader --no-sandbox --guest-profile --profile --out=build/box-profile-before
node tools/nfs-renderer-bench.js --wasm=build/wine-assembly.wasm --cases=glide,d3d --seconds=20 --samples=2 --swiftshader --no-sandbox --guest-profile --profile --out=build/box-profile-after
```

Use the same browser commands without `--guest-profile --profile` for
uninstrumented game measurements. A display/Xvfb and `CHROME` pointing to the
remote executable are required. No laptop benchmark was used for this change.
