# NFS III emulation profile — 2026-09-29

The strongest next emulator target is general unprefixed `MOVSD` lowering in
the micro-op compiler. Two such instructions prevent an otherwise supported
integer loop from running wholly in the tier. The three hottest residual
blocks of that loop account for 11–14% of recorded threaded block entries in
every sampled window, on both Glide and D3D. This is coverage evidence, not a
prediction of CPU savings or FPS gain. No emulator behavior was changed.

## Capture

Current Glide worktree at `32ef6f09`, original NFS III demo, seed 12345,
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

Implement MOVSD as a load from ESI, store to EDI, then pointer adjustments
by the direction flag without changing arithmetic flags. Preserve sequential
overlap across the two copies; an eight-byte bulk copy is not equivalent.
Keep existing prefix exclusions initially. Validation should cover both DF
directions, overlap, flags, sparse page crossings, writable code invalidation,
and actual region entry/exit behavior.

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
