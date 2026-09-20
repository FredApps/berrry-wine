# Diablo gameplay benchmark

Important qualification from the walking investigation: an ordinary breakpoint
sets `dbg_any`, which disables fast block transfers. The original fixed-work
results below therefore measure debugger-mode execution, not normal runtime performance.
Matching frames establish workload equivalence, but do not remove this bias.
Do not use the candidate percentages to predict browser speed. A separate
breakpoint-free real-clock walking profile is reported below. The September 20
follow-up fixes this boundary and supersedes the old benchmark implementation.

This experiment lives in detached worktrees based on 7a394423. Run
`node tools/run-diablo-gameplay-bench.js /path/to/stackrun /path/to/loadtest`
from the baseline checkout after building all three with the same benchmark
boundary patch. The old candidate worktrees must receive that patch before
using the current harness. Results, logs and
start/end PNGs go to `build/diablo-gameplay-bench` (override with BENCH_OUT).
`node tools/test-diablo-gameplay-bench.js` checks the harness independently.

The old comparison measured batches 2900..3350 and scheduled walking at
batch 3000. A batch is a block budget, so a fold changes both when input
arrives and how much guest time elapses per instruction. Those timings did
not establish a gameplay speedup or regression. The `--skip` network test
was also invalid: it skipped only eight calls at host batch boundaries.

The corrected experiment boots every candidate with its extra decoder
pattern disabled, pins calendar time, and arms a WASM breakpoint at
0x0040dd6b, the back edge of Diablo Shareware's gameplay message/tick loop.
Disassembly shows PeekMessage/GetMessage/TranslateMessage/DispatchMessage
on the message path and a call to 0x0040ff11 on the simulation/draw path.
Loading and menus never reach this breakpoint. At its first hit the extra
pattern is enabled and the decode cache is cleared in every arm.

Guest time then advances exactly 50ms per loop iteration and stays constant
across any intermediate budget yields. The same clock reaches cooperative
threads, calendar and audio consumers. This is a controlled simulation clock,
not an estimate of phone FPS. The scenario is an idle hero in Tristram with
normal animation and rendering; it does not cover walking, combat or dungeons.
Advancing at the game-loop boundary also removes arbitrary real-time idle
polling: this comparison measures simulation/rendering work and cannot decide
how much the network/message pump costs under real browser pacing.

After 100 warmup iterations the harness measures 600 iterations (30 seconds
of guest time). It reports process CPU and wall time, actual DirectDraw
presents, main-thread API calls, load samples, and CPU ms per present. It hashes every
presented 640x480 indexed framebuffer together with its 256-color palette.
Both endpoint PNGs must contain the red life and blue mana HUD orbs.
PNG encoding happens outside the measured interval; per-present hashing
is included equally in every arm. Breakpoint checks also cost time, equally
in each arm, so these are controlled CLI comparisons, not production FPS.

The driver runs baseline, stack, load/test, load/test, stack, baseline
sequentially. It refuses a timing comparison unless the start/end frame
hashes, entire frame-sequence hash, presents, main-thread API calls and guest duration
all match. A load average above 2 prevents starting the next arm. An absent
result file is a failed/incomplete benchmark, never a zero-time result.

The load/test prototype also needed a matcher guard repair: WAT `i32.and`
evaluates both operands, so putting the mutating matcher in its second
operand ran it even when fusion was disallowed. The benchmarked version
uses an enclosing `if` before calling the matcher.

## Results, 2026-09-19

Remote host `fast-near-9tb-1`, Intel i9-9900K (16 logical CPUs), Node
v20.11.1. One benchmark process ran at a time, with no other CPU-heavy job;
measurement load averages were approximately 0.99–1.09. Six runs took
23:22:28–23:48:43 UTC including repeated startup, which was excluded from
each measurement. Exact build hashes are in
`diablo-gameplay-benchmark-machine.json`.

| Build | CPU seconds, run 1 | CPU seconds, run 2 | Mean ms/present | vs baseline |
|---|---:|---:|---:|---:|
| Baseline | 7.296267 | 7.205032 | 12.0844 | — |
| Packed PUSH/POP | 7.700377 | 7.454913 | 12.6294 | +4.51% |
| LOAD/TEST/Jcc | 7.223719 | 7.201891 | 12.0213 | -0.52% |

Every run completed 600 presents, 30,000 guest milliseconds and 45,000
main-thread API calls. Start, end and full frame-sequence hashes matched
in all six runs. The full frame-sequence SHA-256 was
`64d5379be544275626395933c1baffe277be659ea361371e5b3ad8f3957abec5`.
All endpoint screenshots passed both HUD-orb checks (2507 red / 1038 blue
pixels). JSON, per-run logs and PNGs are under
`build/diablo-gameplay-bench/` in this worktree and the remote baseline checkout.

The baseline repeated with a 1.26% CPU-time spread. LOAD/TEST's 0.52% mean
reduction is inside that variation and does not demonstrate a useful win.
PUSH/POP was slower than either baseline in both runs. Neither candidate
should be integrated on this evidence. These results replace the previous
batch-window gameplay conclusions, not the exact-kernel microbenchmarks.

Validation: the standalone harness tests pass (extra budget yields cannot
advance the clock; a one-pixel change alters the sequence hash; counts and
boot gate are checked). Both candidate builds and their 145-case x86 suites
pass. No runtime optimization was merged or committed.

## Walking and CPU profiling

Run the following for two unprofiled baseline runs and a separate profiling run:

```sh
BENCH_OUT=build/diablo-walking-vertical-bench node tools/run-diablo-gameplay-bench.js --walking --profile
```

The walking script uses the same
gameplay-iteration clock and pins the same startup. It alternates (320,270)
and (320,82), pressing at leg iteration 1 and releasing at 45, once per 60
iterations. These targets are opposite around the 640x352 playfield anchor.
The first diagonal route walked into the river after 12 seconds; the second
hit the cottage. Both are rejected routes, not walking performance results.

The harness records the local hero's tile coordinates at every iteration:
player index at 0x4ad1a8, per-player stride 0x54d8, X/Y at
0x4ad1e8/0x4ad1ec. These are guest executable data addresses, not emulator
region addresses. A 600-iteration run must visit at least three positions,
change tile at least 20 times and move during at least eight of ten legs.
The A/A comparison additionally requires the entire position sequence to match.
Four intermediate PNGs are encoded after timing stops.

The optional inspector profile starts after the warmup screenshot and stops
before endpoint PNG encoding. It samples at 1ms intervals, excluding all
loading and menu time. This fixed-work profile includes frame-hash and
breakpoint overhead. A second ten-second profile then clears the breakpoint,
uses the normal Date.now clock and repeats the walking input without hashing
every frame. Its `.realtime.json` records actual presents, distinct positions,
CPU time and confirms breakpoint address zero. That real-clock diagnostic is
not a deterministic A/B timing run and can include ordinary idle polling.

`tools/profile-diablo-gameplay.js PROFILE NAMED_WASM CANONICAL_WASM` resolves
function indices from the compiled name section. Because this revision's
canonical build lacks names, use `tools/build-compile-wat.js --names` with
separate `--out`, `--compat-out` and `--named-out` paths. The report generator
requires byte-identical non-custom sections between the named reference and
the measured canonical artifact; it never guesses names from current source
order. The locally rebuilt canonical reference also matched the complete
remote canonical SHA-256, d6baa2d453a36188b5b0b8c49e8e2e712311bd72a2b08c467044ca0288ae5629.

### Validated walking results

On the same quiet remote i9-9900K, both unprofiled runs and the profiling run
matched all 600 frames, 47,594 main-thread API calls and the entire hero
position sequence: 28 unique tiles, 67 tile transitions, all ten legs moving.
The full frame-sequence hash is
`3a784a2821ae0ea4813e609199de0e610af56baaeafe6d88e675a4c8af61004d`.
Unprofiled CPU times were 7.324367 and 7.654558 seconds (about 4.4% spread).
These are debugger-mode timings, not a normal-runtime throughput claim.

The following breakpoint-free real-clock segment ran for 10.059 seconds,
presented 201 frames and visited eight distinct tiles. Process CPU was
10.173 seconds; load was 1.00. Loading and menus are excluded. This is CLI
on x86-64, not a phone/browser profile, and still includes CLI instrumentation.

| Real-clock sampled self time | Share |
|---|---:|
| CLI API logger `h.log` | 7.50% |
| WASM-to-JS `ii` bridge (callers are `win32_dispatch`) | 7.11% |
| Block transfer `branch_end_at` | 6.52% |
| Guest address translation `g2w` | 4.61% |
| Decoded-page lookup `page_resolve` | 3.52% |
| Decoded operand fetch `read_thread_word` | 3.46% |
| Guest stores `gs32` | 2.98% |
| Guest loads `gl32` | 2.84% |
| Counted-copy handler `th_copy32_counted` | 0.86% |

`--quiet-api` suppresses console output but still decodes API-name strings
and updates counters in `h.log`. The API logger and bridge together account
for about 14.6% of this sample, not a measured recoverable speedup. The
real-clock segment adds about 9.06 million main-thread API calls, so polling
strongly changes the workload mix. This profile does not identify which
guest network routines own those calls.

For comparison, counted-copy self time is 3.66% in the fixed-work profile,
but roughly 0.44 ms/present there versus 0.43 ms/present in the real-clock
profile. The share changes mainly with the denominator; it is not evidence
that copying became four times faster. Fixed-work hashing itself consumes
3.95% of sampled time, and `run` is inflated to 16.94% with chaining disabled.

Next steps recorded before the September 20 follow-up:

1. Make a correctness-tested gameplay boundary hook that preserves chaining,
   prove nonzero chain hits and identical frames/positions, then rerun A/A.
   An initial unvalidated runtime-hook draft was removed; no core change is
   included in this worktree.
2. Measure the CLI quiet-logging fast path separately, preserving explicit
   trace/census behavior. This cleans up the profiler before ranking folds.
3. Test dispatch/page lookup and operand-fetch candidates against the walking
   workload. They have more measured scope than another counted-copy fold.

Artifacts: `build/diablo-walking-vertical-bench/` contains A/A JSON and logs,
both raw CPU profiles and named summaries. PNG checkpoints remain in that
directory on the remote baseline checkout. The synthetic harness tests pass,
including clock independence, pixel hashing and the walking input schedule.

## Chain-preserving boundary, September 20

Implemented an opt-in `set_benchmark_chain_bp(1)` export. Ordinary
debugger behavior is unchanged: all debug facilities disable fast transfers.
In benchmark mode only the breakpoint is exempted from that blanket guard;
both `branch_end_at` and cached `chain_end` return to `run` when their target
is the breakpoint address, preserving its existing stop/resume semantics.
Other debugging facilities still disable fast transfers. Startup stays in
ordinary debugger mode; the new mode starts at the first gameplay boundary.

`tools/test-gameplay-chain-breakpoint.js` tests exact stop/resume register
state across repeated loops, positive transfer counts, cached chaining,
watchpoint guards and switching back to normal mode. It and all 145 x86
cases pass; the full build and synthetic harness tests pass too. The existing
57-case block-chaining suite also passes, including SMC, invalidation,
executor interaction and ordinary breakpoint behavior.

The current harness refuses an old WASM without this export and requires
positive measured fast-transfer counts. `get_page_fast` counts the normal
direct block-transfer path; `get_chain_hits` counts the optional cached-slot
path (`--block-chain`), which is off in these runs. Do not confuse a zero
cached-slot count with the normal fast path being disabled.

Remote A/A CPU times were 6.216717 and 6.075941 seconds for 600 presents,
about 2.3% repeat spread. The profiling run took 6.249486 seconds and is not
included in that timing comparison. All three recorded exactly 85,198,645
fast transfers, 47,594 main-thread API calls and the same 600 frames and hero
position sequence as the older debugger-mode replay. The boundary fix thus
preserves the workload. The lower CPU time corrects measurement overhead;
it is not a shipped emulator speedup. Frame hashing and the target checks
remain instrumentation, so this still is not a browser FPS estimate.

Fixed-work CPU self time with fast transfers enabled:

| Function/work | Share |
|---|---:|
| `branch_end_at` | 9.47% |
| `read_thread_word` | 7.09% |
| Frame hashing (`update`) | 4.93% |
| `g2w` | 4.73% |
| `th_copy32_counted` | 3.79% |
| `page_resolve` | 3.45% |
| `run` | 2.95% |

The following real-clock sample still has `h.log` at 7.84% and its WASM-to-JS
bridge at 7.39%; block transfer is 7.07%. Those figures include idle polling,
unlike the fixed-work simulation/rendering sample. Artifacts and screenshots
are under `build/diablo-walking-chained-bench/`.

The logging experiment is CLI-only and opt-in (`--quiet-api-fast` in run.js,
`--quiet-fast` in the suite). It increments API totals and clears pending COM
markers without decoding names, but only if quiet mode is on and API tracing,
API-name counts, critical-section tracing, input-dispatch tracing, ESP auditing
and API breakpoints are all off. `tools/test-quiet-api-fast.js` executes the
actual callback and tests each diagnostic guard plus ordinary logging.

### Quiet-logging A/B result

Both suites ran sequentially on the same quiet host, one process at a time.
Every run matches the older reference and the corrected baseline in frame
hashes, API counts, fast transfers and the complete position sequence.
The measured WASM SHA is
`a75d0fd52d54a51b5e717358f0ad1669aada181db7a12240670d2bd650eecc7f`;
the logger change is in JS, not a different WASM build.

| CLI mode | Unprofiled CPU seconds | Mean ms/present |
|---|---|---:|
| Original quiet logger | 6.216717, 6.075941 | 10.2439 |
| Fast quiet logger | 6.115523, 6.210729 | 10.2719 |

The fast path's mean is 0.27% higher, inside the 2.3% baseline repeat spread.
There is **no demonstrated fixed-work gameplay gain**. These are two grouped
runs per arm, not a large randomized trial; do not read a sub-percent effect
out of them. Artifacts: `build/diablo-walking-quietfast-bench/`.

In the separate real-clock profiles, `h.log` plus the `ii` WASM-to-JS bridge
falls from 15.23% to 1.27% (fast logger 0.31%, bridge 0.95%). Both runs
present 200 frames and visit eight tiles in approximately ten seconds,
with about 10.12 CPU seconds. The additional segment executes 8,987,762 API
calls with the old logger versus 11,786,747 with the fast logger, derived
by subtracting the identical 301,777,819 pre-segment total from each final
log. That is 31% more calls, mostly additional polling, **not 31% more FPS**.
Profile attribution can also change when V8 optimizes a smaller callback;
the decrease is not itself a measured percentage speedup.

The independent fast-logger fixed-work profile corroborates the candidate
ranking: block transfer 9.89%, operand fetch 7.12%, counted copy 4.25%.
Next experiment: inline decoded operand fetch or reduce the block-transfer
lookup path, one at a time, with this exact replay and an A/A control.
Keep the quiet-logger change experimental until a normal CLI rollout is
desired; no browser code or production default changed here.

The runner now accepts `--reference=path/to/results.json` to check an older
oracle as well as its own first run, and refuses existing result files.
Use a fresh `BENCH_OUT` for every suite. The cross-suite checks above were
also performed directly against every stored result after completion.
