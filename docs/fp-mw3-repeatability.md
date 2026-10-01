# MW3 cockpit repeatability and P/PC follow-up

2026-10-01. Follow-up to [the real-game sweep](fp-pc-game-followup.md).
P predecodes FP semantic selectors; PC adds the island countdown. The WASM
modules are unchanged. This investigation first addresses the failed MW3
counter gate, before measuring a longer cockpit window.

## Repeatability bug

The CLI pins the guest calendar, but `processSharedCtx()` did not copy
`wallNowMs` into cooperative guest-thread contexts. Their `wall_clock` import
therefore fell back to `Date.now()`. The main thread and the loading thread
could observe different calendar policies in a nominally deterministic run.

```
CLI calendar: 1999-06-01 + guest elapsed time
                  |
                  +--> main imports ----------> pinned date
                  |
                  +--> processSharedCtx
                           |
                    BEFORE: wallNowMs absent --> actual host date
                    AFTER:  same function ----> pinned date
```

The production correction adds `wallNowMs` to `PROCESS_SHARED_KEYS` in
`lib/worker-imports.js`. It adds no per-operation checks. A regression in
`test/test-worker-imports.js` calls the actual main and worker calendar imports
for UTC/local SYSTEMTIME, FILETIME, and timezone bias while advancing the
calendar across a day. It failed before the key was added (worker year 2026
versus main year 1999) and passes after the correction. The test exercises
context inheritance; it is not a separate real-Worker transport test.

The benchmark uses frozen host revision `837f0a74`; a benchmark-only preload
applies exactly this inheritance correction to that host. A separate preload
option pins virtual file timestamps. It was a diagnostic hypothesis and is
**not** enabled for the calendar-only controls or the long timing runs.

| Control | Endpoint | Recorded-state result |
|---|---:|---|
| Original host, P/P | 301 batches | Equal through batch 300 |
| File timestamps pinned, P/P | 301 | Equal through batch 300 |
| File timestamps pinned, P/P | 1,750 | Loading-thread first difference at 742; main first difference at 765 |
| Shared calendar only, P/P | 1,750 | Equal at all 1,750 batch boundaries |

The diagnostic snapshots record exposed general registers, FPU top/tags/status,
23 uop counters and 16 compiler counters for the main instance and each
cooperative thread. They do not hash all guest memory or the complete FP stack.
In the calendar-only pair, final pixels, API totals and final uop summaries also
match. Both audits record eight calendar calls through the shared policy and no
fallback calls. This establishes that the narrow fix is sufficient to remove
the observed repeatability failure on this route. It does not identify every
guest instruction downstream of the calendar read.

Filetime-only runs still reached identical cockpit pixels and 8,264,560 API
calls despite their internal differences. That is why pixels/API equality alone
was insufficient for the earlier performance claim. Traced controls are excluded
from the timing comparison.

## Timing method

Dedicated ASCII box `bx_4r5uzdwv`, AMD EPYC-Rome KVM, four vCPUs;
Node 24.18.1 / V8 13.6.233.17-node.50. All game launches are serial. Cooperative
guest scheduling, branch clock, original MW3 input route, software rendering,
uop tier and x87 fusion are retained. The shared calendar is the only host
behavior correction enabled in the measured runs.

The unprofiled sequence is P/P, then PC/P/P/PC: a same-artifact control followed
by balanced reverse ordering. Each launch runs to batch 3,550; process user,
system and wall time are measured over batches 1,150–3,550. The cockpit window
is four times the previous 600-batch window, and startup is excluded. Separate
P/PC CPU-profile launches follow the unprofiled sequence only if all six
completed runs pass the image/API/counter checks.

The first long P/P control measured 83.275s and 83.102s user CPU (0.208%
range relative to their mean). Both reached 19,609,555 API calls and passed
pixel and final per-thread counter equality. This is an empirical repeat
spread from two launches, not a confidence interval or a universal noise floor.

These are headless process-CPU measurements, not browser WebGL FPS. CPU samples
attribute time to functions; prior native code establishes structure, not a
per-instruction cost inferred from static disassembly. The V8 profile samples
the main host thread, on which both cooperative guest instances execute; it
does not account for every background compiler thread included in process CPU.

Exact WASM hashes:

- P: `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b`
- PC: `8e503d1e1588ca5292af82d63e56ba07eb6dca5d6c0803f161459b96fc8fb4d9`

Both exact variants already have V8 and SpiderMonkey native captures on ARM64
and x86-64, recorded in [the matrix](fp-combinations.md) and
[the game follow-up](fp-pc-game-followup.md). No new WASM optimization variant is
introduced here. The eager native captures are not the exact normally tiered
code of these game-profile runs; function-level profiles must not be described
as native-PC attribution. The separate new profile launches also enable
`--perf-prof` with a per-run output directory, preserving the actual game's
Liftoff/TurboFan code objects without forcing an eager compilation tier.

## Unprofiled results

All six launches completed with identical final pixels, 19,609,555 API calls,
and matching final main/thread uop summaries. Every comparison passed the
report's work gate. Times below are the 2,400-batch cockpit window only.

| Launch order | Artifact | User CPU | System CPU | Wall |
|---:|---|---:|---:|---:|
| 1 | P control 1 | 83.275s | 0.001s | 83.268s |
| 2 | P control 2 | 83.102s | 0.001s | 83.092s |
| 3 | PC pair 1 | 84.421s | 0.007s | 84.417s |
| 4 | P pair 1 | 83.399s | 0.001s | 83.391s |
| 5 | P pair 2 | 82.990s | 0.003s | 82.980s |
| 6 | PC pair 2 | 84.610s | 0.008s | 84.616s |

The balanced comparison (launches 3–6) is **P 83.1945s versus PC 84.5155s**,
or **1.588% more user CPU for PC**. The PC/P pair is +1.225%; the P/PC pair is
+1.952%. All four P samples span 0.492% of their mean; the two PC samples span
0.224%. The initial P/P control alone spans 0.208%. These are observed repeat
ranges, not confidence intervals.

This longer, reproducible MW3 route does **not** reproduce the earlier
provisional -3.85% cockpit observation. It shows a small slowdown in both
orders on this EPYC/V8 configuration. Together with the earlier broader game
sweep, it supplies no reason to enable C by default. The copied projection
kernel's speedup remains valid for that kernel, but does not predict this
whole cockpit workload. No FPS or cross-engine performance gain is claimed.

## Cockpit profiles and actual game native code

Both separate profile launches pass the same pixel/API/counter checks as each
other. Their sampled windows are 87.695s (P) and 89.084s (PC). Profiling plus
native-code logging adds overhead; their process CPU totals are excluded from
the six-run timing result. The percentages below are exclusive sampled time,
not instruction cycle counts or inclusive subsystem totals.

| Sampled function | P | PC |
|---|---:|---:|
| Software textured spans (`viewport_draw_textured_span`) | 35.29% | 35.27% |
| Integer uop executor (`uop_fast`) | 9.76% | 9.67% |
| Pure-FP evaluator (`x87_island_fast`) | 7.48% | 7.45% |
| Software texture fetch | 2.95% | 3.01% |
| Branch boundary (`branch_end_at`) | 2.59% | 2.69% |
| Mixed evaluator (`x87_island_fast_mixed`) | 0.80% | 0.77% |

WASM accounts for approximately 99.3% of samples, but that includes the
emulator's software renderer; it must not be relabeled as 99.3% guest
interpretation. Several additional rasterizer functions also appear in the
top samples. This backend distinction matters when choosing the next browser
optimization: these profiles are not measurements of WebGL worker rendering.

The copied projection kernel concentrates work in the mixed evaluator. Here
that evaluator is less than 1% of the sampled window. Native code confirms that
both game captures retain a separate mixed call behind the packed flag test;
its small standalone share is not explained by wholesale inlining into the
pure evaluator. A large isolated-kernel percentage therefore need not produce
a useful whole-game gain. C also changes the pure evaluator, so the mixed
share alone is not a bound on C's total possible effect.

The actual game captures use normal V8 tiering on this EPYC host, not
`--no-liftoff` or forced eager compilation. TurboFan code-object sizes:

| Function | P bytes | PC bytes |
|---|---:|---:|
| Pure-FP evaluator | 13,568 | 13,568 |
| Mixed evaluator | 10,816 | 10,624 |
| Integer uop executor | 12,416 | 12,416 |
| Software textured spans | 8,960 | 8,960 |
| Software texture fetch | 576 | 576 |
| Branch boundary | 1,152 | 1,152 |

These sizes include the code objects' padding/tables; equal sizes do not prove
instruction identity. The countdown survives in both FP evaluators:

```
P loop tail                       PC loop tail
load index from stack             load remaining count from stack
add 1                             add -1
load limit from stack             jne loop
compare index and limit
ja loop
```

The independent limit reload/comparison is gone; the counter still spills.
The unchanged-size pure function and smaller mixed function are concrete
structural findings, not proof of faster execution. The profile differences
are spread across several functions and do not isolate the instruction-level
cause of the small overall slowdown. Do not claim that register allocation,
cache placement, or a particular branch was proven responsible.

The raw jitdumps repeat existing code records when profiling starts. A byte
check finds 519/518 distinct P/PC TurboFan objects, 489/488 repeated records,
zero repeated objects with changed bytes, and no function with multiple native
addresses. The decoded loop bodies therefore are not silently mixing different
TurboFan versions from one run. Exact hashes, engine identity and flags are in
`profiles/host.json`, each command JSON and each `.native/capture.json`.

The next useful scope is a browser/GPU guest-thread profile, or an authentic
pure-FP workload if continuing this counter experiment. The current evidence
supports keeping the calendar fix and keeping C experimental; it does not
justify another default change.

## Reproduction and artifacts

Use a frozen checkout with the original game assets and the matching modules:

```sh
FP_SHARE_CALENDAR=1 node tools/bench-mw3-repeat.js \
  FROZEN_CHECKOUT MODULE_DIRECTORY FRESH_OUTPUT_DIRECTORY p,p,pc,p,p,pc
node tools/bench-mw3-repeat-report.js FRESH_OUTPUT_DIRECTORY
```

The driver refuses a nonempty output directory and records commands, host and
module hashes, Node/V8/CPU identity, and launch load averages. `FP_PROFILE=1`
enables the runner's cockpit-only CPU profiler; use a separate output directory.
`FP_DIAG=1` selects the archived `test/run-fp-repeat.js` diagnostic runner and
writes per-batch snapshots. `FP_END=1750` reproduces the short full-route control.
The benchmark preload is `tools/bench-fp-filetime-pin.js`; its calendar,
filetime, and audit switches are independent.

Artifacts live under `build/lazy-games/fp-repeatability/`: raw/pinned 301-batch
controls, `pinned-full`, `shared-calendar-full`, `long`, `profiles`, and `harness`.
The archived diagnostic runner differs from the frozen runner only by the
snapshot block at the batch boundary. Timing runs use the original runner.
The report tool independently exposes completion, pixel, API, counter, and
per-batch checks, and refuses to label diagnostic/profile runs timing-eligible.
`tools/bench-mw3-repeat-profile.js` summarizes profiles using an exact-module
function-name map. Native decoding uses `tools/bench-mw3-mixed-native.js decode`
with `NATIVE_FUNCS=x87_island_fast,x87_island_fast_mixed,uop_fast,viewport_draw_textured_span,d3dim_texture_fetch_prepared,branch_end_at`.
