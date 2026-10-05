# Stack calls and region address reuse

Results and benchmark tooling integrated into main; no production runtime
optimization merged by this integration. Existing experimental stack-span runtime
`482f9a48`, artifact SHA
`750f03c063e4806502ed056f00a8968da35e8c271ef348bbdc5e4ab410d6ab28`.

## Actual interpreter: call-heavy microbenchmarks

Run on quiet remote `fast-near-9tb-1` under the shared benchmark flock,
Node20.11.1 / Intel i9-9900K. Tool: baseline worktree `tools/bench-loops.js`,
copied to remote `tools/bench-stack-calls.js`. Nine alternating, order-rotated
repetitions per arm; fresh nonoverlapping code addresses for every repetition.

Each sample executes one million actual x86 indirect calls through a table.
Either one target or512 distinct targets; the latter visits targets in a
permutation with stride73. Each target saves EBX/ESI/EDI, allocates16 bytes,
spills EAX, adds one or16 memory operands to EAX, reads the spill, releases
locals, restores registers and returns. The caller advances its table index
and loop counter. This includes actual call/return, guest-memory accesses,
register file operations and interpreter dispatch; no guest code is bypassed.
The512-target sequence is periodic, not randomized or a real game trace.

Every sample verifies the accumulator, preserved registers, loop completion,
ESP and final local spill, and compares state checksums between arms. Enabled
samples must report exactly2,000,000 fast-span hits; disabled samples zero.
Handler-count passes are separate from timed passes (diagnostics force fallback).

Median milliseconds; lower is better:

| Targets | Body loads/adds | Ordinary handlers | Stack span | Reduction | Null-control absolute delta |
|---|---:|---:|---:|---:|---:|
| 1 | 1 | 241.608 | 185.277 | 23.31% | 0.0002% |
| 512 | 1 | 283.777 | 227.495 | 19.83% | 0.153% |
| 1 | 16 | 490.958 | 430.509 | 12.31% | 0.071% |
| 512 | 16 | 534.272 | 474.628 | 11.16% | 0.227% |

Null control toggles unused `rect_run`, with stack candidate unchanged in both
arms. It bounds positional/timing noise, not every possible JIT-layout effect.
Raw results are versioned in [bench-results/stack-reuse-20260921/](bench-results/stack-reuse-20260921/):
`stack-calls-micro.txt`, `stack-calls-null.txt`, `stack-region-reuse-a.txt`,
and `stack-region-reuse-b.txt`. These are synthetic workload gains,
not predicted app-level gains. They support stack optimization for genuinely
call-heavy code; the small Diablo/AoE gains remain the app-level evidence.

## Morrowind eligibility

Local retail executable only; no retail binary uploaded to remote.
Static instruction-boundary census, non-ESP runs chunked to maximum4:

| Run length | PUSH spans | POP spans |
|---|---:|---:|
| 2 | 8298 | 3202 |
| 3 | 2455 | 2571 |
| 4 | 1170 | 1624 |

This is49,254 statically covered instructions, not an execution-weighted
percentage. Existing notes'5.2% PUSH statistic is startup/load, not gameplay.
Later phase-separated notes retract the earlier hotspot interpretation;
gameplay attempts stopped at the character-name modal. No usable raw gameplay
histogram was located. Morrowind therefore has static opportunity but unknown
runtime benefit. Do not multiply static counts or the5.2% startup figure by
microbenchmark speedups.

## Region-level reuse prototype

Completed: a restricted synthetic WAT experiment, not production region
lowering. Initial prototype timings rejected because translation counters
were inside the timed functions and the region arm hoisted translations over
the entire repetition loop. Revised comparison must time uninstrumented
functions and separate per-region stack reuse, body-address reuse and
whole-loop hoisting. Forced fallback modes are not alias/fault correctness
coverage. No result from that initial prototype is quoted as a performance win.

Corrected tool: [tools/stack-region-reuse-bench.js](../tools/stack-region-reuse-bench.js),
commit `ea3b17ae` (supersedes974403e4). Uses vendored WATX compiler,4035-byte
counter-free timing module and4042-byte instrumented module for logical
translation counts. Two remote invocations, each nine rotated rounds with
calibration/warmup and every sample >=30ms. State independently initialized
before every arm/sample; checks expected accumulator, saved words, spill,
ESP and checksum afterward. No explicit body-value caching in emitted WAT;
the native JIT is still free to optimize it.

Median nanoseconds per synthetic region, first / second invocation:

| Lowering | Body1 | Body16 |
|---|---:|---:|
| Split per-access translation | 16.135 /16.127 | 46.201 /46.263 |
| Separate PUSH/POP spans | 12.449 /12.455 | 42.261 /42.301 |
| Stack reuse through saves/spill/restores | 6.822 /6.832 | 36.410 /36.254 |
| Body-address reuse only | 18.490 /18.537 | 19.853 /19.881 |
| Combined per-region reuse | 9.681 /9.689 | 11.772 /11.764 |
| Entire-loop hoisting (optimistic bound) | 0.934 /0.934 | 3.211 /3.211 |

Interpretation: per-region combined reuse is about22% lower time than separate
spans for body1,72% lower for body16. But for body1, stack-only reuse is better
than the combination; extra body-span validation pays nothing when there is
only one body address. This is evidence to specialize lowering by repeated
access shape, not blindly combine every transform. Translation-count reduction
alone is not a cost model: instrumented body1 stack-only and combined both
make74 calls per37 regions but their timings differ.

Scope limits: fixed compile-time guest addresses, simplified direct mapping,
no actual x86 decoding/dispatch/call-target working set, no sparse faults,
self-modifying code or concurrency, and no mid-region state materialization.
Forced fallback mode is checked at entry; it is not a test of real mid-region
alias/fault/exit recovery. Logical translation counts come from a different
instrumented module and do not describe native calls after JIT optimization.
Loop-hoisted arm keeps addresses across all repetitions; its very low time
must not be attributed to per-region reuse. These are mechanism experiments,
not measured speedups of a production region compiler or an application.

## Recommended next implementation

In a region IR, track stack pointer as base plus constant delta; expose
translation/loads/stores separately for analysis, then fuse emission. Reuse
one guarded stack range across saves/local spills/restores. Cache a body
translation only when repeated accesses justify it. Flush architectural state
and discard assumptions at unmodelled calls/exits; add actual alias/fault/
code-invalidation tests before production use. Keep split micro-ops out of
the interpreter's dispatch stream unless their cost has been measured.
Morrowind still needs a gameplay-weighted eligibility census before an app
performance prediction. No production integration occurred in this experiment.

## Reproduction

Call benchmarks require the experimental stack-span artifact identified above,
not main's default WASM: `set_bench_candidate` and fast-hit exports are required.
Set `STACK_BENCH_WASM` to its absolute path; this skips automatic rebuilding.

```sh
STACK_BENCH_WASM=/absolute/path/to/stack-span.wasm node tools/bench-loops.js \
  --shapes=stack_calls1_body1,stack_calls1_body16,stack_calls512_body1,stack_calls512_body16 \
  --toggle=stack_candidate --reps=9 --json
# Null control: same artifact/shapes, replace --toggle=stack_candidate with --toggle=rect_run.
node tools/stack-region-reuse-bench.js
# Repeat the region command for an independent invocation.
```

Run alone on a quiet machine; serialize remote benchmarks with the shared
`/tmp/wine-assembly-diablo-benchmark.lock`. The standalone region tool compiles
its own restricted WAT and does not load or modify the production emulator.
