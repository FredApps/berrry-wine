# Lazy-sync synthetic access benchmarks

The runnable suite is `tools/bench-lazy-sync.js`; its WAT fixture is compiled
separately and does not change the shipping runtime. It covers the seven
workload families in the benchmark plan, with correctness failures excluded
from speed comparisons.

## Run

```sh
# Compile once; reuse these exact bytes for each run.
node tools/bench-lazy-sync.js --compile-only --out=build/lazy-bench-compiled

# A/B/B/A per workload, full pixel checks before/after each timed interval.
CHROME=/usr/bin/google-chrome DISPLAY=:0 node tools/bench-lazy-sync.js \
  --headful --wasm=build/lazy-bench-compiled/runtime.wasm \
  --frames=64 --warmup=8 --rounds=3 --out=build/lazy-bench-results

node tools/bench-lazy-sync-report.js build/lazy-bench-results/results.json
```

`--cases=a,b` selects workloads. `--width=1024 --height=768` changes the
backing size. A reused output directory is rejected. Each result pins WASM,
fixture and JS hashes, browser/GPU identity, machine/load, parameters, timings
and synchronization counts. The output directory retains the WASM and served
JS artifacts.

Default audit mode requires every eager control to pass but records existing
lazy failures as INVALID. **Use `--require-correct` when evaluating a fix:**
it exits nonzero if any selected arm fails. For example, run only
`--cases=x87-overlap` before and after a wide-access correction. Recompile
from the candidate source, then pass its separate `--wasm` artifact; keep the
same fixture, host scripts, work counts and machine for both runs. An existing
lazy correctness failure is not a speed baseline.

## Implemented cases

| Family | Cases | Oracle |
|---|---|---|
| Untouched Locks | `untouched-hud` | Two untouched intervals, one 320x16 CPU HUD; all background and HUD pixels correct |
| Thread exclusion | `thread-idle`, `thread-transition` | Idle worker must not disturb pixels; newly created worker must read fresh data and preserve its writes |
| Shared ownership | `thread-read-write`, `thread-write-only` | A real second Worker/instance accesses shared memory; first writes are checked independently of first reads |
| GDI | `gdi-normal`, `gdi-retained`, `gdi-retained-write`, `gdi-blit-normal`, `gdi-blit-retained` | Real GetDC/GetPixel/SetPixel or native BitBlt, with and without a retained DC |
| Wide accesses | `x87-overlap`, `x87-sequential`, `x87-heap` | Actual x87 memory helper; 8-byte overlap, offset sequential loads, ordinary-heap control; exact bit checksums |
| Lifetime | `backing-replace`, `final-release` | Actual SetSurfaceDesc/final Release; delayed readback must not overwrite a reused old allocation |
| History tracking | `thread-history` | Actual short-lived Worker starts and exits; creation history detects it while active-count snapshots do not |

SetPixel cases deliberately stress many small GDI calls. BitBlt cases copy
the same HUD rectangle in one call, representing sprite/HUD composition.
Retaining a DC across Lock is an internal state stress test, not a claim that
Windows permits that combination; a fix may instead explicitly reject it.

## First hardware run, 2026-09-29

Box8, Ryzen 9950X host, Chrome, ANGLE/Mesa Intel UHD 620; load 0.00 before and
0.30 after. 640x480 RGB565; three A/B/B/A rounds, 64 work units per arm after
eight warmup units. All eager controls passed. Values below are medians of
round means in milliseconds per synthetic work unit:

| Workload | Eager | Lazy | Readbacks/unit eager/lazy |
|---|---:|---:|---:|
| Untouched Locks + HUD | 1.919 | 0.660 | 3 / 1 |
| Normal GDI SetPixel HUD | 2.947 | 2.945 | 1 / 1 |
| Same frame with idle worker | 1.886 | 0.661 | 3 / 1 |
| Sequential x87 loads + sync | 0.866 | 0.886 | 1 / 1 |
| Heap x87 loop | 0.209 | 0.210 | 0 / 0 |
| Final release | 0.649 | 0.639 | 1 / 1 |

Lazy retained-GDI access, cross-worker access, surface-start overlap, backing
replacement and thread-start surface access were **INVALID**. The backing
test establishes an additional concrete lifetime failure: after an untouched
Lock/Unlock and SetSurfaceDesc replacement, a later fence restores old GPU
pixels into the old allocation after it has been repurposed.

The transient-worker workload costs about 4.1 ms/unit on this box, dominated
by Worker creation/instantiation/teardown. That is **not** the overhead of the
history counter. The fixture proves history detects a missed worker; an
instrumentation on/off comparison is still needed to isolate tracking cost.

Local smoke controls also passed with Chrome/ANGLE Metal on Apple M1. Local
load was high, so those timings are not used in this table. Hardware results
are retained at `build/lazy-sync-synthetic/remote-results.json`; the remote
full artifacts are `/home/user/lazy-sync-synthetic/build/remote-rounds1/`.

Focused follow-ups passed every eager control and confirmed the write-only
hazards independently of stale-read checks. Both retained-DC SetPixel and
cross-worker first writes are overwritten with GPU red instead of preserving
CPU blue. `--require-correct` exited 1 as intended. Persistent history detected
a short-lived worker even though active-count snapshots matched.

Native sprite BitBlt measured 0.936 ms/unit eager versus 0.920 lazy on the
normal GetDC path (two A/B/B/A rounds, 64 units/arm); both used one readback.
Retained-DC BitBlt was INVALID lazily: its blue pixels were overwritten by the
later red GPU readback. These are short-run baselines, not evidence of a small
speed improvement. Follow-up JSON is in
`build/lazy-sync-synthetic/{write-history-results,sprite-results}.json`.

## What the numbers do and do not measure

This is a low-level synthetic suite: real canonical WAT access functions,
native GDI, shared WASM memory, actual browser Workers, WebGL clears and the
production `D3DIMGpu.fence` readPixels/conversion path. The small host supplies
only the imports these fixtures need. GPU targets are fixture-owned.

It does **not** run x86 game code, the guest CreateThread scheduler, the
shipping D3D command queue, presentation or CPU-to-GPU uploads. Consequently
it does not measure game FPS, guest-thread policy integration, folded-x87
dispatch or full render-owner contention. A runtime safeguard implemented
only at those outer boundaries needs an additional integration test there.
The minimal GPU workload exposes access/readback costs instead of hiding
them under scene work.

These short rounds establish fixture behavior and an initial baseline; they
do not prove zero overhead or statistically establish the small differences
in the table. Candidate eager-vs-original eager artifacts, longer rounds,
4/10-byte/folded-x87 variants, alias/disjoint-surface contention, intermittent
resource churn and Safari/end-to-end game validation remain follow-up layers
from the broader plan. No proposed runtime safeguard is silently implemented
by the benchmark: current failures stay visible until the candidate fixes
the relevant path.

## Wide-read and backing-replacement fixes

The runtime now uses page-aware native x87 reads (including folded pipeline
and island paths). Ordinary direct-window 32/64-bit reads retain a single
range check plus load. Other mappings validate page crossings before reading;
discontiguous sparse pages are gathered correctly. m80/environment/BCD reads
no longer retain a linear pointer across unproved guest pages.

SetSurfaceDesc fences the old backing/extent before changing its pointer or
pitch. This applies after an untouched Unlock too: the old allocation can
then be reused without a delayed GPU readback corrupting it.

Validation:

- Surface-fence regression: 32/64-bit baseline and folded reads crossing an
  aligned pending surface start; old-backing/pitch ordering and reuse.
- Sparse-width regression: every crossing offset for 32/64/80-bit x87 loads,
  including folded 64-bit reads, with non-contiguous physical backing.
- x87 island differential: 400 sequences / 6,609 operations, fast == generic
  == unfused. Pipeline differential: 31 cases pass.
- Hardware `--require-correct`: all 24 arms pass for `x87-overlap`,
  `backing-replace` and `final-release`.

Matched WASMs were compiled from one source snapshot, differing only in the
four owned runtime files. Box8 artifact order was before/after/after/before;
each artifact ran eager/lazy/lazy/eager, 1,024 units per arm after 64 warmup
units. Same pinned host scripts and Intel hardware GPU; load 0.00 to 0.53.
Median work-unit means, milliseconds:

| Workload | Before eager | After eager | Before lazy | After lazy |
|---|---:|---:|---:|---:|
| Untouched Locks + HUD | 1.8899 | 1.8797 | 0.6374 | 0.6473 |
| Heap x87 loop | 0.2051 | 0.2019 | 0.2055 | 0.2018 |
| DIB sequential x87 + readback | 0.8849 | 0.9112 | 0.9039 | 0.9188 |

The DIB stress workload contains 65,537 loads plus one readback per unit;
the wide-access checks are not free there. Ordinary heap loads show no
slowdown in this sample. Untouched-Lock counts remain exactly 3 eager versus
1 lazy. Do not generalize the small timing shifts into a game FPS claim.
Results: `build/lazy-sync-fix/results/fix-{strict,1-before,2-after,3-after,4-before}/results.json`;
matched artifacts: `build/lazy-sync-fix/{before,after}.wasm`.

At this stage lazy sync remained opt-in, with shared-thread ownership,
retained GDI access and the gameplay benchmark's thread coverage still open.

## Shared-thread follow-up (2026-09-29)

The pending range now lives in shared memory. First-touch readback is serialized
across guest instances and sent to the process renderer, whose fence visits
the legacy/D3DIM endpoints that own the GPU pixels. Lazy Lock first publishes
buffered draws without reading pixels back. Private executors that cannot
service another producer's request use eager synchronization.

`test/test-d3dim-surface-fence.js` covers foreign reads, write-only access,
native span proofs, original-owner Unlock and subsequent fences. Two real
Node workers contend while readback is deliberately held open: the second
reader cannot finish early. CPU-only peers never enable lazy sync themselves.
The same test checks the private-transport eager fallback. Existing wide/x87
and backing-replacement cases remain covered.

`test/test-shared-render-worker.js` covers buffered batch publication without
a readback request and a fence from a software endpoint reaching another
endpoint's GPU through the production shared-worker dispatcher/adapter.
The GPU in this ordering test is deterministic; the WebGL suite below checks
actual readPixels/conversion separately.

On box8 (Intel UHD 620 / ANGLE), all **52 arms passed**: 13 cases, eager/lazy/
lazy/eager, 64 measured units after 8 warmup units, strict correctness enabled.
The cases include thread reads/writes, write-only access, thread creation while
a range is pending, and thread history, plus ordinary GDI, x87 and lifetime
controls. The three retained-GDI cases remain unsupported and were excluded.
Results: `build/lazy-sync-shared/results.json`; remote artifact directory:
`/home/user/lazy-sync-synthetic/build/shared-final-strict`.

After moving the shared-region declaration to the end of the memory map,
all five allocation stress modes passed. A final-layout repeat also passed
all 52 arms (16 units after 4 warmup units):
`build/lazy-sync-shared/appended-results.json`, remote
`build/shared-appended-strict`. Both canonical browser artifacts were rebuilt
and their layout stamp verified against the generated JS mirror. The full
build passes the memory/layout and protocol gates, then stops at unrelated
stale toy-VM browser bundles; it is not reported as a full-build pass.

The synthetic HUD still takes three eager readbacks versus one lazy readback;
cross-thread read/write and write-only cases take one in either mode. These
are correctness runs, not evidence of a real-game speedup or zero overhead.
In particular, this minimal synthetic host does not measure the production
command-queue publication wait. Lazy synchronization remains opt-in, and
retained GDI/native pointers remain a documented limitation.
