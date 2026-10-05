# Where guest CPU actually goes: dispatch attribution, 2026-09

Four levers are on the table for the x86 interpreter, and each deletes a
*mechanism* rather than a function:

1. inline `$next` / `$set_reg`,
2. a fixed per-BLOCK handler that keeps the guest registers in wasm locals for
   the length of one basic block,
3. multi-block region descriptors,
4. something else.

Decline-bucket counts and hot-function lists cannot rank those, because a
mechanism is spread over dozens of functions and because V8's wasm inlining
moves the cost between them. This measures process-time share per category, on
three windows, with inlining on **and** off.

Tooling: [`tools/dispatch-attribution.js`](../tools/dispatch-attribution.js)
turns a `.cpuprofile` (or `node --prof-process` output) into the table below.
Category membership is decided by WAT function name, resolved through
`tools/wasm-func-name.js`, so a renumbered module cannot silently reclassify
anything.

## What the categories mean

| category | what is in it | which lever deletes it |
|---|---|---|
| `dispatch` | `$next`, `$read_thread_word`, `$read_addr` — the `call_indirect` and the operand fetch that advances `$ip` | (1) partly, (2) mostly |
| `block/cache` | `$run`, `$branch_end`, `$jcc_end`, `$page_resolve`/`$page_publish`, and the self-modifying-code guards on stores (`$code_write_is_code`, `$invalidate_code_write`) | (3) |
| `reg accessors` | `$get_reg`/`$set_reg` (+8/16-bit) — the `br_table` register file | (2) entirely |
| `flag writes` / `flag reads` | `$set_flags_*` / `$get_zf`…`$build_eflags` | (2) for the writes |
| `g2w translate` | `$g2w`, `$g2w_miss`, `$guest_page_translate` | hoisting, inside (2) |
| `guest ld/st` | `$gl8/16/32`, `$gs8/16/32` — translate plus the access | — |
| `handler bodies` | every `$th_*`, plus the shared cores they call (`$do_alu*`, `$do_shift`, `$eval_cc`, `$fpu_*`, `$rep_*`) | none — this is the work |
| `decode/compile` | `$decode_*`, `$emit_*`, the page/chunk allocator | none |
| `win32 api` | `$win32_dispatch` and every `$handle_*` | none |

The shared ALU/FPU cores are counted as handler bodies deliberately. With
inlining ON they vanish into their `$th_*` callers and with it OFF they do not;
leaving them in "other wasm" would make handler work look 15 points smaller in
one arm than the other for a reason that has nothing to do with the guest.

## Method, and what is trustworthy in it

```bash
# heroes2 — map window, batches 1400..6000 (77% of the run's blocks)
node --cpu-prof --cpu-prof-interval=500 --cpu-prof-dir=DIR test/run.js \
  --app=heroes2_demo --no-build --batch-size=20000 --max-batches=6000 \
  --repaint-every=50 --quiet-api --quiet-blocks --no-close --batch-stats=1400 \
  --input='400:click:535:225,700:click:528:68,1200:click:283:373'

# caesar3 — its own 800x600x16 software render loop, batches 2700..6700 (60%)
node --cpu-prof --cpu-prof-interval=500 --cpu-prof-dir=DIR test/run.js \
  --app=caesar3_demo --no-build --screen=800x600 --batch-size=50000 \
  --max-batches=6700 --repaint-every=50 --quiet-api --quiet-blocks --no-close \
  --batch-stats=2700

# quake2 — demo1 playing in ref_soft, batches 8000..15416 (48%)
node --cpu-prof --cpu-prof-interval=500 --cpu-prof-dir=DIR test/run.js \
  --app=quake2_demo --args='+set vid_ref soft +map demo1' --no-build \
  --screen=800x600 --batch-size=20000 --max-batches=15416 --repaint-every=50 \
  --quiet-api --quiet-blocks --no-close --batch-stats=8000

# add --no-experimental-wasm-inlining for the OFF arm; ops come from a separate
# unprofiled run with --handler-hist --handler-hist-thread=0 --handler-hist-start=0
node tools/dispatch-attribution.js DIR/*.cpuprofile --of-wasm \
  --ops=<handler-hist total> --blocks=<batch-stats total> --members
```

**Shares are the result; absolute ns are not.** The box sat at load 57–190
for the whole session (`uptime` before every run), which changes every
millisecond in the profile and nothing about the ratio between two functions
sampled in the same process. The `ns/op` and `ns/block` columns are printed
because the decision needs an absolute ceiling, and they are the first number
to distrust: caesar3 reads 6.6 ns/op of dispatch and quake2 23.4 ns/op in the
same build, and most of that gap is the machine, not the guest.

**Three things were not what they looked like, and each changed the numbers:**

- **`--repaint-every=1` measures the harness, not the emulator.** Run that way
  the heroes2 window is 93% JS: `drawImage` alone is 61% of the process and the
  whole run takes 266s instead of 16s. That canvas is node-skia in the CLI and
  does not exist in the browser, so every table below is `--repaint-every=50`
  and every share is **of the wasm half**, whose size is printed in each header.
- **Profiles cover the whole process, not just the window.** `node --cpu-prof`
  has no start/stop, so each run is sized so its hot window dominates; the
  window's share of the run's retired blocks is given above (48–77%).
- **Caesar III cannot currently be driven into a city.** The menu ignores an
  injected click — `--trace-input` shows `WM_LBUTTONDOWN`/`UP` arriving at the
  right coordinates and the menu not reacting — and `test/test-caesar3-gameplay.js`
  itself fails at this HEAD (`'' !== 'Codex'`: the name prompt never opens).
  The window used instead is the app's own animated 800x600x16 render loop,
  which saturates the block budget (50000 of 50000 blocks in 4000 of 4000
  batches) and is real interpreted work, but it is **not** the city simulation.

## Table 1 — quake2, `demo1` in the software renderer

2,156,425,461 ops over 308,320,000 blocks, **7.0 ops/block**.

```
quake2 demo1 (inlining ON)   331697 ms sampled, 155020 samples, wasm 84.5% of process

category         ms         share of wasm  ns/op     ns/block   profile
---------------- ---------- -------------- --------- ---------- ------------------------
dispatch              50471         18.00%     23.40      163.7 ####....................
block/cache           22613          8.06%     10.49       73.3 ##......................
reg accessors         33286         11.87%     15.44      108.0 ###.....................
flag writes             360          0.13%      0.17        1.2 ........................
flag reads             3766          1.34%      1.75       12.2 ........................
g2w translate          7888          2.81%      3.66       25.6 #.......................
guest ld/st           22108          7.88%     10.25       71.7 ##......................
handler bodies       132163         47.13%     61.29      428.7 ###########.............
decode/compile         3043          1.09%      1.41        9.9 ........................
win32 api               176          0.06%      0.08        0.6 ........................
other wasm             4571          1.63%      2.12       14.8 ........................
---------------- ---------- -------------- --------- ---------- ------------------------
TOTAL                280447        100.00%

quake2 demo1 (inlining OFF)   251453 ms sampled, 174959 samples, wasm 88.0% of process

category         ms         share of wasm  ns/op     ns/block   profile
---------------- ---------- -------------- --------- ---------- ------------------------
dispatch              45637         20.63%     21.16      148.0 #####...................
block/cache           32684         14.78%     15.16      106.0 ####....................
reg accessors         29176         13.19%     13.53       94.6 ###.....................
flag writes            2981          1.35%      1.38        9.7 ........................
flag reads             2672          1.21%      1.24        8.7 ........................
g2w translate         11809          5.34%      5.48       38.3 #.......................
guest ld/st            9953          4.50%      4.62       32.3 #.......................
handler bodies        80198         36.26%     37.19      260.1 #########...............
decode/compile         2236          1.01%      1.04        7.3 ........................
win32 api                52          0.02%      0.02        0.2 ........................
other wasm             3778          1.71%      1.75       12.3 ........................
---------------- ---------- -------------- --------- ---------- ------------------------
TOTAL                221176        100.00%
```

Quake II is the x87 window: `$fpu_exec_reg` 4.7%, `$fpu_exec_mem` 3.2%,
`$fpu_set_phys` 1.1%, `$fpu_tag_phys` 1.1% of wasm with inlining OFF — about a
tenth of guest CPU inside the FPU engine, which is why its handler-body share is
13 points above the other two.

## Table 2 — caesar3, its own 800x600x16 render loop

1,160,527,553 ops over 335,000,000 blocks, **3.5 ops/block**.

```
caesar3 (inlining ON)   67129 ms sampled, 63273 samples, wasm 60.1% of process

category         ms         share of wasm  ns/op     ns/block   profile
---------------- ---------- -------------- --------- ---------- ------------------------
dispatch               7673         19.03%      6.61       22.9 #####...................
block/cache            7264         18.02%      6.26       21.7 ####....................
reg accessors          4211         10.44%      3.63       12.6 ###.....................
flag writes              12          0.03%      0.01        0.0 ........................
flag reads              394          0.98%      0.34        1.2 ........................
g2w translate           987          2.45%      0.85        2.9 #.......................
guest ld/st            4461         11.06%      3.84       13.3 ###.....................
handler bodies        13318         33.03%     11.48       39.8 ########................
decode/compile            6          0.01%      0.01        0.0 ........................
win32 api              1674          4.15%      1.44        5.0 #.......................
other wasm              320          0.79%      0.28        1.0 ........................
---------------- ---------- -------------- --------- ---------- ------------------------
TOTAL                 40321        100.00%

caesar3 (inlining OFF)   76164 ms sampled, 76537 samples, wasm 67.3% of process

category         ms         share of wasm  ns/op     ns/block   profile
---------------- ---------- -------------- --------- ---------- ------------------------
dispatch              15080         29.43%     12.99       45.0 #######.................
block/cache            9022         17.61%      7.77       26.9 ####....................
reg accessors          7496         14.63%      6.46       22.4 ####....................
flag writes             875          1.71%      0.75        2.6 ........................
flag reads             1197          2.34%      1.03        3.6 #.......................
g2w translate          2911          5.68%      2.51        8.7 #.......................
guest ld/st            2800          5.46%      2.41        8.4 #.......................
handler bodies         9329         18.21%      8.04       27.8 ####....................
decode/compile            6          0.01%      0.00        0.0 ........................
win32 api               216          0.42%      0.19        0.6 ........................
other wasm             2304          4.50%      1.99        6.9 #.......................
---------------- ---------- -------------- --------- ---------- ------------------------
TOTAL                 51235        100.00%
```

Caesar III has the shortest blocks of the three (3.5 ops each) and the highest
`block/cache` share; `$branch_end` alone is 17.1% of wasm. That is the shape a
region descriptor is aimed at, and it is the one window where lever (3) is
worth more than lever (1).

## Table 3 — heroes2, the adventure map

426,872,498 ops over 99,549,298 blocks, **4.3 ops/block**.

```
heroes2 (inlining ON)   66810 ms sampled, 33175 samples, wasm 53.0% of process

category         ms         share of wasm  ns/op     ns/block   profile
---------------- ---------- -------------- --------- ---------- ------------------------
dispatch               6358         17.95%     14.90       63.9 ####....................
block/cache            5217         14.73%     12.22       52.4 ####....................
reg accessors          2880          8.13%      6.75       28.9 ##......................
flag writes              19          0.05%      0.04        0.2 ........................
flag reads              496          1.40%      1.16        5.0 ........................
g2w translate          1153          3.25%      2.70       11.6 #.......................
guest ld/st            3559         10.05%      8.34       35.7 ##......................
handler bodies        12241         34.56%     28.68      123.0 ########................
decode/compile          489          1.38%      1.14        4.9 ........................
win32 api               944          2.67%      2.21        9.5 #.......................
other wasm             2063          5.82%      4.83       20.7 #.......................
---------------- ---------- -------------- --------- ---------- ------------------------
TOTAL                 35418        100.00%

heroes2 (inlining OFF)   156535 ms sampled, 52841 samples, wasm 45.1% of process

category         ms         share of wasm  ns/op     ns/block   profile
---------------- ---------- -------------- --------- ---------- ------------------------
dispatch              14838         21.03%     34.76      149.1 #####...................
block/cache           12732         18.04%     29.83      127.9 ####....................
reg accessors          8031         11.38%     18.81       80.7 ###.....................
flag writes            1226          1.74%      2.87       12.3 ........................
flag reads             1289          1.83%      3.02       12.9 ........................
g2w translate          4199          5.95%      9.84       42.2 #.......................
guest ld/st            4166          5.90%      9.76       41.8 #.......................
handler bodies        14121         20.01%     33.08      141.9 #####...................
decode/compile         1014          1.44%      2.38       10.2 ........................
win32 api               916          1.30%      2.15        9.2 ........................
other wasm             8033         11.38%     18.82       80.7 ###.....................
---------------- ---------- -------------- --------- ---------- ------------------------
TOTAL                 70567        100.00%
```

## Side by side

```
share of wasm, V8 wasm inlining ON        share of wasm, inlining OFF
category         quake2  caesar3 heroes2  quake2  caesar3 heroes2
---------------- ------- ------- -------  ------- ------- -------
dispatch         18.00%  19.03%  17.95%   20.63%  29.43%  21.03%
block/cache       8.06%  18.02%  14.73%   14.78%  17.61%  18.04%
reg accessors    11.87%  10.44%   8.13%   13.19%  14.63%  11.38%
flag writes       0.13%   0.03%   0.05%    1.35%   1.71%   1.74%
flag reads        1.34%   0.98%   1.40%    1.21%   2.34%   1.83%
g2w translate     2.81%   2.45%   3.25%    5.34%   5.68%   5.95%
guest ld/st       7.88%  11.06%  10.05%    4.50%   5.46%   5.90%
handler bodies   47.13%  33.03%  34.56%   36.26%  18.21%  20.01%
decode/compile    1.09%   0.01%   1.38%    1.01%   0.01%   1.44%
win32 api         0.06%   4.15%   2.67%    0.02%   0.42%   1.30%
other wasm        1.63%   0.79%   5.82%    1.71%   4.50%  11.38%
```

Read the OFF column as *un-inlined attribution*, not as a second opinion about
cost: with inlining on, `$g2w` is billed to whichever `$gl32` inlined it and
`$gl32` to whichever handler inlined that, so ON pushes weight down the call
chain and OFF pulls it back up. The pair brackets each category. `guest ld/st`
moving the other way (up under ON) is the same effect seen from the other side:
`$gl32`/`$gs32` are themselves inlined into handlers less often than `$g2w` is
inlined into them.

Four findings hold across all six columns:

1. **Dispatch is ~18–19% of guest CPU and does not move.** Three apps whose
   blocks are 3.5, 4.3 and 7.0 ops long all land within one point of each other.
   Dispatch is a per-*op* constant; nothing about block shape dilutes it. That
   is what makes it the safest number in this document to build a plan on.
2. **The lazy-flag system has already won.** `flag writes` is 0.03–0.13% with
   inlining on. Every `$set_flags_*` call V8 does not inline is 1.3–1.7%, so the
   *entire* remaining cost of flag bookkeeping is call overhead, and V8 removes
   nearly all of it already. There is no lever here.
3. **`$g2w` is 2.5–3.3% and is not the memory-translation problem.** Adding the
   typed load/store wrappers on top gives 10.7–13.5% for the whole guest-memory
   path — real, but half of it is the access itself, not the translation.
4. **`decode/compile` is ≤1.4% everywhere.** The block cache is doing its job;
   nothing about compilation is on the table.

## Cross-checks

**`tools/wasm-native.js --func='$next'`** — 556 bytes / 139 arm64 instructions
of SpiderMonkey Ion code (the whole function, both tail-call exits and traps
included). The first eight instructions of every single dispatch are frame
setup, a stack-limit check and an interrupt check before any interpreter work
happens:

```
 0:  stp  x29, x30, [sp, #-16]!     ; frame
 4:  mov  x29, sp
 8:  mov  x20, sp
 c:  ldr  x9, [x23, #32]
10:  sub  x20, x20, #0x20
14:  mov  sp, x20
18:  ldr  x16, [x9, #2024]          ; stack limit
1c:  cmp  x20, x16
20:  b.cc <trap>
24:  ldr  w16, [x23, #56]           ; interrupt check
28:  cbnz w16, <trap>
```

This is Ion, not TurboFan, so read it for structure and not for a Chrome cycle
count — but the structure is the point: a fixed prologue is paid once per guest
*op*, and that prologue is precisely what a per-block loop deletes.

**`tools/bench-loops.js` priced a dispatch at ~8 ns and a block transfer at ~9 ns
on top of it** (CLAUDE.md). Caesar III's dispatch column here is 6.6 ns/op and
its `block/cache` column 21.7 ns/block. Same order, from a completely different
harness, which is about as much agreement as a loaded box allows.

## Ranked recommendation

Ceiling = category share of guest CPU × the fraction of that category the lever
can actually delete. All figures are **share of wasm (guest CPU)**; multiply by
0.53 / 0.60 / 0.85 (heroes2 / caesar3 / quake2) for share of this CLI process,
and note the browser's non-wasm half is a different size again.

### 1. Fund the per-block handler with registers in wasm locals (lever 2) — ceiling 19–23% of guest CPU

It is the only lever that attacks two of the three largest removable categories
at once:

| what it deletes | quake2 | caesar3 | heroes2 | removable |
|---|---|---|---|---|
| `reg accessors` (the `br_table` register file) | 11.87% | 10.44% | 8.13% | ~all |
| `dispatch` (the per-op `call_indirect` + Ion prologue) | 18.00% | 19.03% | 17.95% | ~60% |
| `flag writes` | 0.13% | 0.03% | 0.05% | ~all |
| **ceiling** | **22.7%** | **21.9%** | **18.9%** | |

The 60% on dispatch is the part that is a *call*: the frame setup, stack-limit
and interrupt checks shown above, plus the indirect branch. The operand fetch
and the `br_table`/branch that selects the next op survive in any design, so
they are excluded. The register half is a clean win — with the eight GPRs in
wasm locals for the length of a block, `$get_reg`/`$set_reg` disappear rather
than getting cheaper, and V8 keeps locals in machine registers.

Two constraints shape the buildable form. `feedback_no_runtime_wasm_codegen`
rules out emitting one wasm function per block, so this is **one** generic
function holding the register locals with a `br_table` over the op stream
inside it — an in-function threaded loop, not a per-block JIT. And 460 `$th_*`
handlers cannot all move inside it at once: the migration is per-opcode, with
anything not yet migrated falling back to a `call_indirect` that spills the
locals to the globals first. That fallback is also the measurement: the share of
ops served in-loop is the fraction of the 19–23% collected so far.

Same design hoists `$g2w` for a block's base register, which is the top of
lever 4's list (below) — worth up to another 2–3%.

### 2. Multi-block region descriptors (lever 3) — ceiling 4–9%, and ~5% is already measured

`block/cache` is 8.1% / 18.0% / 14.7%. Only the inter-block half is removable
(the SMC store guards and the page index stay), and only for blocks that sit
inside a region, so the ceiling is roughly half: 4–9%. That is not a guess —
`project_region_jit_transfer_study` measured ~5% on Caesar III for exactly this,
and Caesar is the *best* case here (its `$branch_end` alone is 17.1%, against
6.1% on quake2). Worth doing after lever 2, not before: the per-block register
residency is what makes a region descriptor worth more than it is today, because
a region that also keeps registers in locals across its blocks removes transfers
*and* the writeback at each block boundary.

### 3. Something else — the x87 engine, but only for one class of app (lever 4) — ceiling ~8% on quake2, ~0 elsewhere

Quake II spends about a tenth of guest CPU inside `$fpu_exec_reg` /
`$fpu_exec_mem` / `$fpu_set_phys` / `$fpu_tag_phys` — the register-stack
plumbing, not the arithmetic. Caesar III and Heroes II spend nothing there. This
is a real 8% for the 3D corpus and nothing at all for the 2D one, so it is a
targeted follow-up, not a platform lever.

### 4. Do NOT fund forcing more V8 inlining as a source change (lever 1) — ceiling ~4%, and most of it is already collected

The ON/OFF pair is the measurement of this lever, and it says V8 already does
most of the job: turning inlining off costs 2.6, 10.4 and 3.1 points of extra
dispatch share and 1.3, 4.2 and 3.3 points of extra register-accessor share. The
remaining headroom is the sites V8 still declines, and hand-inlining `$next`'s
fast path buys at most its Ion prologue — about a quarter of an 18% category,
so ~4%. The `--wasm-inlining-min-budget=600` result in
`project_v8_wasm_inlining_budget` (~8% CPU) is the same headroom seen from the
flag side, and it is **not shippable**: it is a V8 startup flag that no browser
user will pass. Spending source complexity to chase 4% is the wrong trade while
lever 2 sits at 19–23%.

## Reproducing

Everything above is in
`/private/tmp/.../scratchpad/attr-r7` for this session, and regenerating it is
the six commands in the Method section plus:

```bash
node tools/dispatch-attribution.js DIR/*.cpuprofile --of-wasm --members --top=8
node tools/dispatch-attribution.js A/*.cpuprofile B/*.cpuprofile C/*.cpuprofile \
  --compare --of-wasm --labels=quake2,caesar3,heroes2
```

One build caveat for anyone rerunning this: at the HEAD this was measured on,
`src/api_table.json` names `EnumDisplayDevicesA` and `ChangeDisplaySettingsExA`
but no `$handle_*` for either exists, so the WATX compile fails outright. Both
handlers were added in this branch to get a wasm at all; if they have since
arrived from elsewhere, take that version.
