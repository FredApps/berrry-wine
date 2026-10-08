# Disabled ToyVM progress detector: isolated optimization

Sole worker TOYVM-DISABLED-PROGRESS-20261008; no subagents. Branch
`perf/toyvm-disabled-progress-20261008`, explicit base
`7dd9b0e8f538dfdb514d16cc3d39478cf6bdb959`. Shared HEAD/index and prior
branches preserved. Root reviews, integrates and pushes; this optimization
remains separate until that review.

Evidence: shared `scratch/runs/20261008T0911Z-toyvm-disabled-progress/`.

## Change and correctness

`DosSession.checkProgress` now returns immediately when `stuckLimit` is falsy.
Previously its final verdict alone was guarded: every disabled handback still
read ten registers, console/video counters and optional console scoring, hashed
them and updated diagnostic history. LiveRun explicitly selects zero. The CLI
and ordinary DosSession default to200. Consumer/options inspection found no
setter or supported runtime-toggle API; none was introduced. Enabled code is
unchanged, including the guest-work floor and refused-entry exception. Disabled
diagnostic history is now left alone; guest execution is unchanged. The guard
lives in the method so direct calls also avoid diagnostic work.

The regression executes actual COM programs through runDos/DosSession. Control
fails with2020 diagnostic register reads while disabled. Candidate observes
zero diagnostic reads/scoring, and a direct call accepts throwing register and
console accessors without touching them. Enabled/disabled runs match the entire
VM memory, every zero-argument exported getter, dispatches and handbacks.
Enabled tests cover changing-register progress, a fixed-register BIOS writer,
real spin detection with its work floor, and an actual refused ARPL entry that
must bypass that floor. The existing refused-entry regression also passes.
Both browser bundles were regenerated and pass reproducibility/execution gates;
the new test is automatically in the unit tier and tier completeness passes.
No resolver, framebuffer, CPU, input, installer or paging overhaul.

## Paired measurements and native review

Fresh no-env boat `bx_szm3d9eh`, x86-64, Node24.18.1,
V8`13.6.233.17-node.50`. Timed runs use default adaptive tiers, not a forced
compiler tier. Warmups are excluded. Measurements run serially without a
browser/server/native capture alongside them; alternating pair order controls
ordering drift. Source hashes prove control equals the explicit base and
candidate equals the three-line guard. Both emit the actual original CPU hash
`91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf`.

Eight quiet pairs execute a finite DOS BIOS INT10 handback stress loop, with
1,048,588dispatches/524,281handbacks each. All outcomes match, including memory
SHA, reported registers, normal exit and counters. Median paired elapsed-time
reduction38.33%; each pair32.69–42.27%. Control0.835–1.135seconds and
candidate0.561–0.655seconds do not overlap. Subsequent source review identified
AH0b as a modeled no-op in Machine. This loop is diagnostic host handback
stress, excluded from useful-work/performance qualification. Its original
palette-oriented helper comments are inaccurate and explicitly retained as
handling history, not evidence of palette work.

Six quiet pairs run the authenticated original C3 executable and installed
assets to the same early startup prefix:250,366dispatches/12,240handbacks.
Memory SHA, reported registers and counters match in every run. Median paired
reduction14.87%, with control0.080–0.108seconds and
candidate0.070–0.077seconds. This short prefix does not establish mission
loading or flight speed. Only this matched useful original prefix supports the
limited original candidate validation; BIOS stress does not establish useful
gameplay throughput. A longer useful original prefix comparison remains needed
for a loading performance claim.

Exact control/candidate native captures use `tools/wasm-native.js`, with
SpiderMonkey158 Ion and standalone V8 15.7.81 TurboFan. `$next` is390bytes
Ion/192bytes TurboFan. Instructions, register allocation, frames, loads and
indirect tail transfer agree; raw differences are relocated pointer/table
immediates and trap calls. No CPU instruction, FP state access, spill or memory
helper change was introduced. The module hash equals the actual browser CPU.
Actual benchmark Node host captures show control checkProgress2892/4772bytes
and candidate208bytes: a stuckLimit load/test followed by return, without the
diagnostic read/hash loop. The enabled arm can deoptimize into the retained
detector. Standalone V8 native capture differs from the benchmark engine version;
the host capture uses the benchmark Node version. SpiderMonkey host JS capture
and laptop ARM64 access/captures are unavailable; no architecture-wide or
gameplay speed claim.

Handling receipts retain a low-handback palette workload that was insufficient
as a representative comparison, an interrupted BIOS attempt briefly overlapping
native capture (discarded), and a bounded10M original startup warmup with no
usable samples. Only the restarted quiet BIOS run and smaller matched original
prefix enter the comparison. SCP was unavailable to this key; verified Boat
exec transfer completed in116.373seconds, below240.
The CLI source archive omitted `fonts/Terminal.fon`, so both benchmark arms
have blank BIOS ROM glyph tables; the actual browser bundle embeds the verified
font. This is an explicit benchmark/browser environment difference. The
matched original prefix remains a timing of that early startup execution,
not complete original browser startup or rendering qualification. Longer
useful original measurements should mount the font as well as the installed
files. The raw original benchmark stdout retains a stale “8pairs” caption;
its12 measured rows and loop bound establish six pairs.

## Original candidate qualification

One original run starts09:23:16Z, after benchmark/native review. Its
09:53:15.786Z deadline and1800wall/300guest ceilings are fixed before launch
and never reset. Exact candidate browser bundle SHA
`53a1d9f72525bfbefcfa1da9d4049723c4e03d6fca88b5f6a55b3f5e2a0936c7`;
actual CPU hash917477 above. Eleven installed originals are separately pinned.
The private fixture uses the actual dashboard launcher, silent/paced10MIPS,
tailcall/386, JIT off. No entry/profiling observers or guest state forcing.
The default LiveRun afterSlice hook remains. Sparse observations use pure JS
page-table/physical reads; window snapshots verify exported getters unchanged.
Primary launcher retains explicit1100×900 viewport; observer/action connections
use `defaultViewport:null`, and captures include the whole canvas. This primary
launch viewport differs from a null-viewport bootstrap. Harness/bounds updates
after initial transfer are separately pinned, rather than misrepresented as
unchanged initial transfer pins.

Ordinary input reaches reviewed Argon → Gallant Venture → Haystack → briefing
→ map → loading. Exactly five Enter requests correspond to those reviewed
transitions; none is sent during loading. The live C2M1_C.PCX window matches
the independently decoded original at output250,215. Temporary file growth
reaches5,242,880bytes. All60 sampled loader/palette/mission spans match the
decoded original, and all12 window observations preserve exported getters.
The final09:52:27 sample is in original2db40, with validated possible stack
returns2a6cb →2f4ac →cb317, corresponding to original near calls to2dac0,
2a6a0 and2f424. This is continued initialization, not an executed whole trace,
the later cb403 mission loop or cockpit/control evidence. The prior resource
run's later palette-chain milestone is not claimed for this candidate.

Normal terminal09:52:47.704Z, before the fixed ceiling; actual1771.587wall /
130.3641804guest seconds,1,303,641,804dispatches. Chrome0, host stopped,
guest not exited, held keys0, no page/terminal error. Final whole-canvas loading
art was reviewed, along with every runtime capture. No cockpit, controlled
flight, loading-speed/FPS/audio or completed gameplay qualification. The
remaining blocker to flight evidence is the finite runtime ending during
correct original initialization, not an authenticated detector/guest stall.
The prepared flight-input helper was never invoked. Do not infer a speed gain
by comparing this unpaired run with a different prior boat/menu timing.

Immutable retrieval verifies89files/17,797,526bytes before scoped prefix removal
09:53:16.733Z. Independent checks find all19owned PIDs absent, no Chrome,
exact baseline sockets and16immutable transfer pins unchanged. Actual cleanup
from terminal to removal29.029seconds (<90); the helper's own narrower elapsed
time13.695seconds is recorded separately. Root owns retained no-env boat
`bx_szm3d9eh`, lease expiry10:20:48.693Z; no jobs or prefix remain. Source/tool
downloads are retained outside the removed prefix for root lifecycle handling.

Next: root review the generic fast path, regression, limited startup benchmark
and exact native/version limits before integration. Longer paired useful
palette/loader measurements are still required for a loading-performance claim.
Continue toward flight from the authenticated original initialization path;
do not redo installer, paging, held-key, selection or timeout-only work.
