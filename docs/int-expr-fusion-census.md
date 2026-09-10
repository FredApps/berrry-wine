# Integer expression fusion: is there a ceiling worth building for?

A **decode-time integer expression fold** would take a basic block whose interior is a chain of
full-width 32-bit integer ops, build one dataflow expression tree out of it, and emit a *single*
threaded-code op for the whole run: intermediates live in wasm locals, and only registers that are
live out get written back to the register file at block exit. It removes one `$next` dispatch per
folded op and one register-file round trip per intermediate.

`tools/bench-loops.js` already prices those primitives: **a dispatch is ~8ns and a block transfer
adds ~9ns on top of it**. So the whole question is *what share of retired ops sit inside such a
run*. If it is small, the fold is not worth building. `tools/expr-fold-census.js` measures that
share.

## What the tool measures

Input is a hot-block dump from a real run:

```
node test/run.js --app=ID --quiet-api --max-batches=999999 --max-seconds=N \
     --handler-hist --handler-hist-thread=0 --handler-hist-start=A --handler-hist-stop=B \
     --hot-block-dump=FILE
```

one line per distinct block, `0xADDR hits`. Every block address is mapped back to a module
(`lib/pe.js`), decoded from its entry with `tools/disasm.js` until a block terminator, and every
instruction is classified. Everything is weighted by the block's hit count, so

> **retired ops = Σ over blocks of `hits × ops_in_block`**

which is dispatches actually executed, not static instruction counts. DLL blocks are mapped with
the `DLL: NAME at 0xLOAD, ..., origBase=0x...` lines `test/run.js` prints unconditionally at load
(`--modules-from=RUNLOG`); blocks outside every known image are reported as an "outside exe" hit
share and not decoded.

Two derived numbers matter more than the raw share:

* **maximal foldable runs** — each run collapses to one dispatch, so *dispatches removed =
  foldable ops − runs*. That is the line the decision rests on.
* the same walk **with the may-alias rule off**, which brackets the answer between "no alias
  analysis at all" and "perfect alias analysis".

### FOLDABLE

Full-register 32-bit `mov` / `lea` / `add` / `sub` / `and` / `or` / `xor` / `imul` (2- and 3-operand)
/ `neg` / `not` / `shl` / `shr` / `sar` **by immediate**, plus `movzx` / `movsx` to a 32-bit
destination and `nop`. Register or `[mem]` operands both allowed; loads and stores may sit inside a
run, but their **order is preserved** — see `alias` below.

### BARRIERS (each ends the run; counted separately, weighted by retired ops)

| class | what ends the run |
|---|---|
| `partial-reg` | any 8/16-bit write (`al`, `ah`, `ax`, `mov [x], si`, `add byte [x], 1`) |
| `adc/sbb` | carry-chained arithmetic |
| `flags` | flag consumers: `setcc`, `cmovcc`, `lahf`/`sahf`, `pushf`/`popf`, `rcl`/`rcr` |
| `terminator-flags` | a `cmp`/`test` immediately feeding a conditional terminator — the *normal* shape, not a failure; the tree simply ends there |
| `shift-cl` | shifts by `cl` |
| `div` | `div`/`idiv` |
| `mul64` | `mul`, one-operand `imul` (64-bit result) |
| `call` / `ret` / `int` / `branch` / `branch-cc` | terminators |
| `string` | `movs`/`stos`/`lods`/`scas`/`cmps`, with or without `rep` |
| `stack` | `push`/`pop`/`enter`/`leave` — a dead temp is renamable but `esp` is live, so this is its own class |
| `segment` | `fs:`/`gs:` accesses and segment-register moves |
| `fpu/simd` | x87, MMX, SSE |
| `alias` | a load that follows a store **inside the same run**: an expression tree reorders freely, and nothing here proves the two do not overlap |
| `other` | `inc`/`dec` (partial flag update, CF preserved), `xchg`, `bswap`, `rol`/`ror`, `shld`/`shrd`, `bt*`, `cdq`/`cwde`, everything else |
| `undecoded` | the disassembler produced `db` — data in code, or a decode desync |

Per block the tool also reports the foldable op count, the longest maximal foldable run, the
number of distinct 32-bit registers written (the conservative live-out set: every register written
is assumed live out), and the load/store counts.

### Classifier verification

Hand-checked against `tools/disasm_fn.js` on the hottest block of the Quake II window,
`ref_soft.dll+0x12570` (67828 hits, 19 ops):

```
F 10012570  mov eax, edx        F 10012583  mov ebp, edx
F 10012572  add edx, ebx        F 10012585  mov [edi], eax
F 10012574  shr eax, 0x10       F 10012587  add edx, ebx
F 10012577  mov esi, edx        F 10012589  shr ebp, 0x10
F 10012579  add edx, ebx        F 1001258c  mov esi, edx
F 1001257b  and esi, 0xffff0000 F 1001258e  add edx, ebx
F 10012581  or eax, esi         F 10012590  and esi, 0xffff0000
                                F 10012596  or ebp, esi
                                F 10012598  mov [edi+0x4], ebp
                                F 1001259b  add edi, 0x8
  1001259e  dec ecx     [other]        — partial flag update, CF preserved
  1001259f  jnz short   [branch-cc]    — consumes ZF from the dec
```

17 of 19 foldable in one run, with the two barriers correctly identified: this is the span
texture-coordinate loop, and `dec`/`jnz` genuinely cannot be inside the tree. The bytes match
`disasm_fn.js` on the same file exactly, so the runtime→file VA arithmetic
(`va − loadAddr + origBase`) is right too.

## Per-app results

Measured 2026-09-10. All runs `--quiet-api --max-batches=999999 --max-seconds≤60`.

| app | window (what it is) | retired ops | foldable | ops in blocks with ≥4 foldable | run p50 / p90 | dispatches removed | top barrier |
|---|---|---|---|---|---|---|---|
| `quake2_demo` | b3000–3100, `+set vid_ref soft +map demo1`, world rendering | 18.64 M | **47.7 %** | 69.6 % | 3 / 9 | **28.8 %** | `fpu/simd` 20.3 % |
| `caesar3_demo` | b3500–3600, city simulating (verified by capture at b3450) | 29.55 M | **67.9 %** | 65.1 % | 3 / 4 | **36.3 %** | `alias` 19.9 % |
| `mw3` | b35–50, **startup only** — see caveat | 103.83 M | **84.1 %** | 98.7 % | 20 / 20 | **70.1 %** | `partial-reg` 9.8 % |
| `heaven7` | b400–500, **precalc loop, not the render loop** — see caveat | 4.13 M | **12.4 %** | 0.0 % | 0 / 1 | **3.0 %** | `branch-cc` 24.1 % |

Alias-relaxed run lengths (perfect alias analysis, the other bracket): quake2 p50 5 / p90 17;
caesar3 p50 5 / p90 **465**; mw3 unchanged at 20; heaven7 unchanged.

Outside-image hit share: quake2 2.4 % (only `gamex86.dll`, which is not on disk in this install),
caesar3 0 %, mw3 0 %, heaven7 0 %. Quake II's window is 97.6 % inside `ref_soft.dll` and `quake2.exe`
once the DLL bases are supplied — **without** `--modules-from` it reads 86.3 % outside and the
foldable share collapses to a meaningless 26 %, so always supply the module map.

### Caveats on two of the four windows

* **`mw3` never reaches gameplay headless inside 60 s.** At `--batch-size=200000` it managed 96
  batches in 60 s; the documented cockpit route needs batch ~888. The window measured (b35–50) is
  its startup/transition screen, and **98 % of it is two blocks** — `0x526f54` and `0x527075`, a
  16-bit-per-pixel software alpha blend. So 84 % is one loop's number, not the app's.
* **`heaven7` never reaches its render loop headless either.** After the setup dialog it sits in a
  recursive tracer (`cmp byte [edi],0 / jz`, `sub edi,ebx ×2 / call esi`) for the whole 55 s run —
  four PNG captures at b2000/5000/10000/13500 are byte-identical. Its blocks are 1–3 ops with a
  `call` or `ret` at the end, which is why nothing folds.
* `caesar3_demo` did reach a live city (839 KB capture at b3450) within 60 s. `quake2_demo` was
  rendering the demo1 world (125 KB capture at b4000).

### Eyeballed top blocks

**quake2 `ref_soft.dll+0x12570`** — 17/19 foldable, run 17, 6 live-outs. Ideal case; the whole
interior is one tree. Its neighbour `+0x11e94` (63 ops, 28 foldable, run **5**) is the opposite: the
span mapper's `sbb ecx,ecx / adc esi,[base+ecx*4]` carry trick plus `mov al,[esi]` byte stores chop
the block into 5-op fragments. Those two blocks are the same routine and land on opposite sides of
the barrier list.

**caesar3 `0x41d7a0` / `0x41cf0f`** — 470 and 467 ops, ~465 foldable, but run **3**. These are fully
unrolled row copies, `mov eax,[esi+N]` / `mov [edi+edx+M],eax` repeated 225 times. Every load after
a store trips the may-alias rule, so the conservative run is 3 and the alias-relaxed run is 465.
This single shape *is* caesar3's 19.9 % `alias` barrier, and it is also exactly what the existing
`COPY_RUN` / `rect_run` superops already target — so most of caesar3's headroom is not new
territory.

**caesar3 `0x40fa38`** — 7 ops, 5 foldable, run 4: the RLE token decoder (`xor eax,eax` /
`mov al,[esi+1]` / `add edi,eax ×2` / `add esi,2` / `sub ecx,eax` / `jmp`). One 8-bit load in the
middle costs two ops of run length.

**mw3 `0x526f54`** — 42 ops, 36 foldable, run 20, 6 live-outs. A 16-bit blend: three `mov dx,[..]`
partial loads are the only barriers in an otherwise pure `and`/`add`/`shr`/`lea` tree.

**heaven7 `0x409cb6`** — 2 ops (`cmp byte [edi],0` / `jz`), 502072 hits. Nothing to fold.

## Terminator classes, and what the barriers cost

The share of retired ops that is "foldable" says nothing about *shape*, and shape is what decides
whether a fold is worth its machinery. A run of 20 folded ops inside a block that is entered once
per frame saves 19 dispatches once; the same run inside a self-loop saves 19 dispatches per trip.
[docs/int-expr-fusion-bench.md](int-expr-fusion-bench.md) prices exactly that difference in its
`trips=1` and `trips=64` columns. So the census now also reports, hit-weighted:

* **terminator class** — `self-loop` (the terminator jumps back to the block's own head),
  `interior-branch` (a conditional branch elsewhere: one arm of an if/else, or one block of a
  multi-block loop), `plain-exit` (jmp/call/ret/fallthrough);
* for self-loops, the **trip structure** — the last instruction that actually wrote the flags the
  terminator reads, which is `dec`/`inc` for a counted loop and `cmp`/`test` for a compared one.
  It is not necessarily the instruction *before* the branch: mw3's blend loop puts two `mov`s
  between its `dec esi` and its `jnz`, and reading only the previous instruction misclassified
  97.7 % of that app's retired ops as "other" until the walk-back was added;
* the **collapsible mass** — retired ops in blocks whose entire body folds *as a single run*.
  Those are the blocks that become one dispatch. A body that folds but is chopped into four runs
  by alias breaks is four dispatches, so it does not count.

| app | self-loop | interior-branch | plain-exit | self-loop trip structure (share of retired, mean foldable/block) |
|---|---|---|---|---|
| `quake2_demo` | **11.3 %** | 72.1 % | 16.6 % | `dec/jnz` 7.7 % (15.6) · `cmp/jcc` 2.0 % (2.2) · `sub`/jcc 1.6 % (1.0) |
| `caesar3_demo` | **0.0 %** | 68.0 % | 32.0 % | — no self-loop in the hot set at all |
| `mw3` (startup) | **97.7 %** | 1.1 % | 1.1 % | `dec/jnz` 97.7 % (33.9) |
| `heaven7` (precalc) | **0.0 %** | 48.2 % | 51.8 % | — |

caesar3's zero is not a measurement failure: its hot loops are all multi-block, and its two
hottest blocks are the 470-op unrolled row copies, which end in a `jmp`/`jcc` to a *different*
block. Everything caesar3 would gain from a fold is gained once per block entry, never amortised
over trips. quake2 is the mixed case, and its 7.7 % `dec/jnz` mass is one routine — the
`ref_soft.dll` span loop.

**Collapsible mass** (share of retired ops in blocks that fold to one dispatch). `body>=4` drops
bodies of 1–3 ops, which fold trivially and flatter the total:

| app | mode | all blocks | body≥4 | self-loop | self-loop body≥4 |
|---|---|---|---|---|---|
| `quake2_demo` | exact | 3.5 % | 2.5 % | 0.0 % | 0.0 % |
| | flags | 27.2 % | 19.0 % | 9.2 % | 8.9 % |
| | all | **32.9 %** | 24.4 % | **9.3 %** | 8.9 % |
| `caesar3_demo` | exact | 2.6 % | 1.8 % | 0.0 % | 0.0 % |
| | flags | 18.9 % | 8.0 % | 0.0 % | 0.0 % |
| | all | **33.5 %** | 17.8 % | **0.0 %** | 0.0 % |
| `mw3` (startup) | exact | 0.1 % | 0.0 % | 0.0 % | 0.0 % |
| | all | **98.6 %** | 98.1 % | **97.7 %** | 97.7 % |
| `heaven7` (precalc) | exact | 15.6 % | **0.0 %** | 0.0 % | 0.0 % |
| | all | 91.1 % | **0.0 %** | 0.0 % | 0.0 % |

heaven7's two columns are the caveat made numeric: 91 % of its retired ops sit in blocks that
"fully fold", and *none* of them has a body of four ops or more. It is 1–2-op blocks ending in a
`call` or `ret`, and collapsing a one-op body to one dispatch saves nothing.

### Relaxed barrier modes

`--relax=alias,partial,flags` (any subset) re-runs the same walk with one barrier class modelled
instead of refused. The report always prints all five modes; `--relax` selects which get a detailed
barrier histogram.

* **`alias`** — a store followed by a load is a barrier only when the two addresses may overlap.
  Disjoint if: both are constant absolute addresses with non-overlapping size-aware ranges; or the
  same base (and same index/scale) with non-overlapping displacement ranges; or one is `esp`/`ebp`
  based and the other is not, or is absolute. **That last rule is an assumption, not a proof**
  (stack frame vs heap/static): code that takes the address of a local and reaches it through a
  non-frame register violates it. Nothing in these four windows does, but a shipped fold would need
  it made real. A store whose base register has been rewritten since the store loses the
  displacement test and falls back to may-alias.
* **`partial`** — 8/16-bit register and memory accesses are modelled as insert/extract on the
  32-bit value and fold. High-byte (`ah`/`ch`/`dh`/`bh`) writes are counted separately because they
  cost an extra shift on both sides: they are **0.2 % of quake2's retired ops and 0.0 % of the
  other three**, so the awkward case is not the case that matters.
* **`flags`** — flags are carried as values with a per-*field* last writer, so `inc`/`dec`
  (CF-preserving), `adc`/`sbb`, `cmp`/`test` feeding a `jcc`, and `setcc`/`cmovcc` fold.
  `pushf`/`popf`/`lahf`/`sahf`, shifts by `cl` and `rcl`/`rcr` read or write the whole word and
  stay barriers under every mode.

| app | mode | foldable | ops in ≥4-fold blocks | run p50 | p90 | max | dispatches removed | mean run |
|---|---|---|---|---|---|---|---|---|
| `quake2_demo` | exact | 47.7 % | 69.6 % | 3 | 9 | 193 | 28.8 % | 2.52 |
| | alias | 47.7 % | 69.6 % | 4 | 15 | 204 | 30.5 % | 2.78 |
| | partial | 53.7 % | 70.4 % | 4 | 11 | 193 | 32.9 % | 2.58 |
| | flags | 61.0 % | 74.6 % | 4 | 12 | 193 | 41.1 % | 3.07 |
| | **all** | **67.0 %** | 75.3 % | **6** | **18** | 204 | **50.9 %** | 4.18 |
| `caesar3_demo` | exact | 67.9 % | 65.1 % | 3 | 4 | 18 | 36.3 % | 2.15 |
| | alias | 67.9 % | 65.1 % | 3 | 7 | 34 | 38.6 % | 2.32 |
| | partial | 72.6 % | 69.5 % | 3 | 4 | 18 | 40.9 % | 2.29 |
| | flags | 78.8 % | 79.2 % | 3 | 4 | 18 | 41.9 % | 2.14 |
| | **all** | **83.4 %** | 80.5 % | **4** | **7** | 34 | **50.6 %** | 2.55 |
| `mw3` (startup) | exact | 84.1 % | 98.7 % | 20 | 20 | 20 | 70.1 % | 6.03 |
| | alias | 84.1 % | 98.7 % | 20 | 20 | 20 | 70.2 % | 6.05 |
| | partial | 93.9 % | 98.7 % | 32 | 36 | 36 | 86.0 % | 11.92 |
| | flags | 86.8 % | 98.8 % | 20 | 20 | 20 | 75.2 % | 7.51 |
| | **all** | **96.6 %** | 98.8 % | **37** | **41** | 41 | **93.6 %** | 32.51 |
| `heaven7` (precalc) | exact | 12.4 % | 0.0 % | 0 | 1 | 2 | 3.0 % | 1.33 |
| | alias | 12.4 % | 0.0 % | 0 | 1 | 2 | 3.0 % | 1.33 |
| | partial | 12.4 % | 0.0 % | 0 | 1 | 2 | 3.0 % | 1.33 |
| | flags | 51.6 % | 0.0 % | 1 | 2 | 3 | 12.1 % | 1.31 |
| | **all** | **51.6 %** | 0.0 % | 1 | 2 | 3 | 12.1 % | 1.31 |

Remaining barriers under `--relax=alias,partial,flags`, as a share of retired ops: quake2
`fpu/simd` 20.3 %, `branch-cc` 8.5 %, `alias` 4.3 %; caesar3 **`alias` 19.7 %**, `branch-cc`
10.3 %; mw3 `branch-cc` 2.7 %; heaven7 `branch-cc` 24.1 %, `ret` 12.1 %, `call` 12.1 %.

### The two blocks, checked by eye

**`--relax=flags` on quake2 `ref_soft.dll+0x12570`** (runtime `0x00d90570`, 67828 hits). Under the
exact rule this block is 19 ops, 17 foldable, one run of 17, with `dec ecx` and `jnz` as the two
barriers — the disassembly is in the *Classifier verification* section above. Under `flags`,
`dec ecx` is a CF-preserving decrement whose only consumer is the `jnz` two bytes later, so it
joins the tree: the census now reports **18 foldable, run 18, and the block marked FULL**, i.e. the
whole body is one dispatch. The terminator classifier independently calls it
`self-loop:dec/jnz` (the `jnz short 0x10012570` target equals the block head), which is what puts
its 1.29 M retired ops into quake2's 7.7 % `dec/jnz` collapsible mass. This is the one place in
quake2 where the fold would be amortised over trips rather than paid per entry.

**`--relax=alias` on a caesar3 unrolled copy — it does not fire.** `0x41d7a0` is the 470-op row
copy, `mov eax,[esi+0x384]` / `mov [edi+edx],eax` repeated 225 times. Under `alias` its longest run
stays **3**, and caesar3's `alias` barrier only falls from 19.9 % to 19.7 % of retired ops. The
reason is visible in one pair: the store is based on `edi`, the load on `esi`, neither is a frame
register, and no rule in the list proves two arbitrary heap pointers disjoint. The 465-op run in
the "perfect alias analysis" bracket needs a *whole-object* disjointness proof (src buffer vs dst
buffer), which is a different and much larger piece of machinery than displacement arithmetic.

Where `alias` does fire is `0x4a1e8a` (26659 hits, 24 ops), and its arithmetic checks out by hand:

```
F 004a1ec3  mov edx, [ebp+0xc]              1  stack load
F 004a1ec6  mov [0x5c2d04], edx             2  absolute store
F 004a1ecc  mov eax, [ebp+0x10]             3  stack load  vs absolute store -> disjoint
F 004a1ecf  mov [0x5c2d08], eax             4
F 004a1ed4  movsx ecx, word [0x67408c]      5  abs load vs abs stores 0x5c2d04+4, 0x5c2d08+4 -> disjoint
F 004a1edb  mov [0x5c2c28], ecx             6
F 004a1ee1  mov edx, [ebp+0x8]              7  stack load vs absolute stores -> disjoint
F 004a1ee4  shl edx, 0x6                    8
F 004a1ee7  xor eax, eax                    9
  004a1ee9  mov al, [edx+0x5f702c]             partial-reg (folds only under --relax=partial)
```

Exact run **3** (each stack load after an absolute store broke it), `alias` run **9**, matching the
tool. Under `--relax=all` the run extends to **11** and stops at `mov al,[edx+0x5f702c]`: `edx` is
not a frame register, the pending stores are absolute, and the rule refuses to guess — the
conservative direction, correctly taken. Note also that `movsx ecx, word [0x67408c]` reads the very
address `mov [0x67408c], ax` wrote earlier in the block; under `all` that store *is* pending and
the same-absolute-address overlap test would break the run there, which is why the all-mode run is
11 and not the full 23.

### What the relaxations buy

**`flags` is the one that matters, and `alias` is the one that does not.** On the two windows that
are genuinely rendering, `flags` alone moves dispatches removed from 28.8 % to 41.1 % (quake2) and
36.3 % to 41.9 % (caesar3) — more than `alias` and `partial` combined on both — and it is the only
relaxation that moves the *collapsible* mass at all, taking quake2 from 3.5 % to 27.2 % and
caesar3 from 2.6 % to 18.9 %. That is the expected shape: `inc`/`dec`/`cmp` are the loop and
predicate scaffolding sitting between otherwise-contiguous arithmetic, so removing them merges
fragments rather than extending one end. Run *length* is a different ranking: `alias` is what moves
p90 (quake2 9 → 15, caesar3 4 → 7, and both maxima), because it is the only relaxation that lets a
run cross a store. `partial` is cheap and narrow — 5–6 points of foldable share on quake2 and
caesar3, and its awkward high-byte case is 0.2 % of retired ops at worst — but it is the *only*
relaxation that helps mw3's blend loop (run p50 20 → 32), because that loop's sole barriers are
three 16-bit accesses. All three together roughly halve the remaining barrier mass but leave the
two structural ones untouched: quake2 is still 20.3 % `fpu/simd` and caesar3 is still 19.7 %
`alias`, and caesar3's is the unrolled-copy shape that only whole-object disjointness would reach.

## Verdict

**The ceiling is real but modest, and it is smaller than the raw "foldable share" suggests.** On the
two windows that are genuinely rendering, 48 % (quake2) and 68 % (caesar3) of retired ops are
foldable, but the mean run length is only **2.5 and 2.15** — so the dispatches actually removed are
**28.8 % and 36.3 %** of retired ops, and every removed dispatch still costs a live-out writeback at
run exit (the conservative live-out counts here are 2–6 registers per block). At ~8 ns a dispatch
that is an upper bound of roughly a quarter to a third of interpreter dispatch time before any
writeback cost is subtracted, and a large slice of caesar3's share is the unrolled-copy shape the
existing `COPY_RUN`/`rect_run` folds already cover. The two headline numbers on either side —
mw3's 84 % and heaven7's 12 % — are both single-loop artifacts of windows that never reached the
intended workload, and should not be read as an app characterisation. Against that, the barrier
histogram says where a *cheaper* investment lies: `partial-reg` alone is 6 % / 4.6 % / 9.8 % of
retired ops across the three decodable apps, `adc/sbb` is 4.9 % of quake2, and caesar3's 19.9 %
`alias` would fall out of a disjoint-base check on a single addressing pattern. **Recommendation:
do not build the general decode-time expression tree yet.** The measured headroom does not clearly
beat what a narrower fold — same-base disjointness for the copy shape, and full-width handling of
16-bit-into-32-bit loads — would buy for far less machinery, and this census is the tool to re-run
against any such narrower proposal.

The terminator and relaxed-mode sections above sharpen that in two ways. First, **only quake2 has
any collapsible-loop mass at all** (9.3 % of retired ops, one `ref_soft.dll` span loop): caesar3's
hot set contains no self-loop, so every dispatch a fold saves there is saved once per block entry,
with the entry and exit materialisation charged each time — the bench's `trips=1` column, not its
`trips=64` one. Second, if a single barrier class is to be modelled, it is **`flags`**, not
`alias`: it buys more than the other two combined on both rendering windows, and it is what turns
that span loop into a single dispatch.

## Things the classifier cannot do

* **Packed executables.** heaven7 is UPX-packed: `UPX0` has `Raw=0`, so the code that actually runs
  exists nowhere on disk and every block read as `undecodable`. The workaround is
  `--mem=FILE`, which parses a `--input=N:dump-mem:0xADDR:LEN` hexdump as a code image; it is how
  the heaven7 row above was produced, but it only covers the range you thought to dump.
* **Self-modifying and runtime-generated code** in general — same failure mode, same workaround.
* **A DLL that is not on disk.** Quake II's `gamex86.dll` is missing from this install, so 2.4 % of
  its hits stay in the outside-image bucket.
* **Block length is capped** (`--max-ops`, default 256). caesar3's unrolled copies are ~470 ops and
  are silently truncated at the default; the report now names the truncated hit share, and the
  numbers above use `--max-ops=4096`. At 256 caesar3 reads 62.5 % foldable instead of 67.9 %.
* **Live-out is approximated conservatively** as "every 32-bit register written in the block",
  with no cross-block liveness. Real liveness would be smaller, so the writeback cost above is an
  over-estimate — in the fold's favour.
* **`--handler-hist-thread=0` only**, so a multithreaded app's worker blocks are invisible.
* Data-in-code produces `undecoded` (0.1 % on quake2, 0 elsewhere), which is small enough to ignore
  here but would matter on a Borland binary.

## Reproducing

```bash
S=/tmp/fold
# quake2 — soft renderer so the work stays in the interpreter, not behind gpu_gl_call
node test/run.js --app=quake2_demo --args='+set vid_ref soft +map demo1' --quiet-api --no-close \
  --screen=800x600 --batch-size=20000 --max-batches=999999 --max-seconds=55 \
  --handler-hist --handler-hist-thread=0 --handler-hist-start=3000 --handler-hist-stop=3100 \
  --hot-block-dump=$S/q2-hot.txt > $S/q2-run.log 2>&1
node tools/expr-fold-census.js --dump=$S/q2-hot.txt \
  --exe=test/binaries/candidates/quake-2-demo-installer/installed-extracted/Install/Data/quake2.exe \
  --modules-from=$S/q2-run.log --max-ops=4096 --label=quake2_demo --json=$S/q2.json
```

`--modules-from` reads the run log's own `DLL:` lines, so the emulator's load addresses and the
census always agree. Add `--module-dir=` for images that do not sit beside the exe.

The terminator-class, collapsible-mass and relaxed-mode tables are printed by every run; they need
no extra flag. `--relax=alias,partial,flags` (any subset) selects which modes additionally get a
full barrier histogram — the summary table always covers exact, each single relaxation, and all
three. The same numbers are in the `--json=` output under `terminatorClasses`, `selfLoopTrips` and
`modes`, and each of the top blocks carries its own `terminator`, `trip` and per-mode
`{foldable, runs, longest, fullyFoldable}`.

---

# The x87 population, and what OpenGL does to the shape of the work

Two additions to `tools/expr-fold-census.js`, and one comparison the integer census could not
make.

## 1. x87 is now its own expression population

The integer walk counts every x87 instruction as one flat `fpu/simd` barrier. On the two
windows above that is the single largest barrier class (20.3 % of quake2's retired ops), and it
says nothing at all about whether the *float* side is expression-shaped. The census now runs a
second, parallel walk over the same blocks and the same hit weights.

**The integer numbers are unchanged.** The report's integer section and the JSON's integer keys
are byte-identical to the pre-change tool on the same dump — verified by `diff` on both — and
the quake2 row above reproduces exactly (18,641,438 retired ops, 47.7 % foldable, p50 3 / p90 9,
28.8 % dispatches removed, `fpu/simd` 20.3 %).

### What an x87 run is

A maximal sequence of stack arithmetic whose register naming resolves **statically at decode
time**. Inside a run the x87 stack is renamed: `fld`/`fild`/`fld1`/`fldz`/the constant loads
push, `fstp`/`fistp`/the `p`-suffixed arithmetic pop, `fxch` swaps two names, everything else
leaves TOP alone. Because every operand is written `st(N)` *relative to the current TOP*, the
rename is exact as long as the running delta is known — which it is, from the run's first
instruction. So a run is a float dataflow tree over at most eight named values plus its memory
operands: exactly what a fold would emit as one threaded op. The census tracks the delta and
reports the peak number of live stack slots a run needs, and would end a run at `top-overflow`
if the rename ever needed more than eight (it never did).

Members: `fld fst fstp fld1 fldz fldpi fldl2e fldl2t fldlg2 fldln2 fadd fsub fsubr fmul fdiv
fdivr` (+ their `p`/`i` variants) `fxch fchs fabs fild fist fistp fsqrt fwait fnop`. The
constant loads beyond `fld1`/`fldz` are members rather than transcendentals: they push a
literal and cost nothing to model.

Barriers, each counted as *what ended the run*:

| class | what ends the run |
|---|---|
| `status-word` | `fnstsw`/`fstcw`/`fldcw`/`fclex`/`finit`/`fnsave`/`frstor` — the control and status words are architectural state a value tree does not carry, and the exception flags are sticky, so a fold may not reorder across them |
| `compare` | `fcom*` / `fucom*` / `ficom*` / `fcomi*` / `ftst` / `fxam` — these write the condition codes into the status word, read back some distance away by an `fnstsw`+`sahf` or an `fcomi`+`jcc` |
| `transcendental` | `fsin fcos fsincos fptan fpatan f2xm1 fyl2x fyl2xp1 fscale fprem fprem1 frndint fxtract` |
| `branch` | the block terminator — any `call`/`ret`/`int`/`jmp`/`jcc` |
| `integer-interleave` | an integer instruction touching memory the run also touches, by the same `mayAlias` rule the integer walk uses. An integer op that does **not** is allowed to sit inside the run and is counted separately as *interleaved integer*: it schedules around the tree, not through it |
| `other-fp` | MMX/SSE, `ffree`/`fincstp`/`fdecstp`, `fisttp` |
| `top-overflow` | the static rename would need more than eight live slots |

### A classifier bug found on the way, and deliberately not fixed

`classify()` tests its SIMD mnemonic set `/^(p[a-z]+|movq|movd|...)$/` **before** its stack case,
and `p[a-z]+` matches `push`, `pop`, `pusha`, `popa`, `pushf` and `popf`. So every stack
instruction has always been counted in the integer census's `fpu/simd` barrier, and the `stack`
class the barrier table documents has never once appeared in a report. On the quake2 software
window that is **527,965 retired ops — 2.8 of the 20.3 percentage points** attributed to
`fpu/simd`. The real x87 share of that window is **17.5 %**, and 17.5 % + 2.8 % = 20.3 %
exactly, which is the arithmetic that confirms the diagnosis.

Fixing `classify()` would move every published integer number, which this change was required
not to do, so it is left in place and the x87 walk keys off the mnemonic instead. **Anyone
re-running the integer census should fix it first and re-baseline**; it inflates `fpu/simd` and
hides `stack` on every app, not just this one.

### Hand-verified block

`ref_soft.dll+0x11c3b` (runtime `0x00d8fc3b`, 11392 hits in the CLI window, 41 ops). The census
calls it 29 x87 ops, 29 run members, one run of 29, 0 interleaved integer, `interior-branch`.
`node tools/disasm_fn.js ref_soft.dll 0x10011c3b 45` agrees byte for byte:

```
X 10011c3b  fild dword [ebx+0x4]      X 10011c68  fadd dword [0x10027a94]
X 10011c3e  fild dword [ebx]          X 10011c6e  fxch st(4)
X 10011c40  fld st(1)                 X 10011c70  fmul dword [0x10027a90]
X 10011c42  fmul dword [0x10027a88]   X 10011c76  fxch st(1)
X 10011c48  fld st(1)                 X 10011c78  faddp st(2), st
X 10011c4a  fmul dword [0x10027a7c]   X 10011c7a  fxch st(2)
X 10011c50  fld st(2)                 X 10011c7c  fmul dword [0x10027a84]
X 10011c52  fmul dword [0x10027a80]   X 10011c82  fxch st(1)
X 10011c58  fxch st(1)                X 10011c84  fadd dword [0x10027a98]
X 10011c5a  faddp st(2), st           X 10011c8a  fxch st(2)
X 10011c5c  fxch st(1)                X 10011c8c  faddp st(1), st
X 10011c5e  fld st(3)                 X 10011c8e  fld dword [0x10027a5c]
X 10011c60  fmul dword [0x10027a8c]   X 10011c94  fxch st(1)
X 10011c66  fxch st(1)                X 10011c96  fadd dword [0x10027a9c]
                                      X 10011c9c  fdivr st(1), st
  10011c9e  mov ecx, [0x10027ab8]        <- integer-interleave: ENDS the run
```

That is the span-gradient setup: two integer screen coordinates converted with `fild`, run
through a 3x3 texture-transform matrix at `0x10027a7c..0x10027a98` with `fxch` doing all the
scheduling, and divided by a `w` term — 29 x87 ops in one tree, needing 5 live stack slots.
The run ends at `mov ecx,[0x10027ab8]` and not at the next float op, and that is the rule
working as designed rather than a miss: the pending x87 references include `[ebx]` and
`[ebx+4]`, `mayAlias` refuses to prove an absolute address disjoint from a register-based one
unless the register is `esp`/`ebp`, and so the conservative direction is taken. That refusal is
why `integer-interleave` is the *largest* run-ender in every window measured below.

## 2. Software vs OpenGL — and why this had to be measured in a browser

**The OpenGL renderer cannot run headless.** `lib/gl-compat.js`'s `createContext` opens with
`if (!win || typeof document === 'undefined') return 0;`, so in node `wglCreateContext` always
returns 0. A CLI run with `+set vid_ref gl` does load `ref_gl.dll`, resolve the WGL entry
points, `ChoosePixelFormat`, `SetPixelFormat` and call `wglCreateContext` twice — and then
`FreeLibrary`s opengl32 *and* `ref_gl.dll` and `LoadLibraryA("ref_soft.dll")`. The census of
that run is 90 % `ref_soft.dll` with zero `ref_gl.dll`: it is the software renderer wearing a
GL command line. Any "GL" measurement taken from `test/run.js` is that fallback.

So the GL window was taken from **real Chrome with SwiftShader**, driving the actual dropdown,
and reading the hot-block histogram out of the same `get_hot_block_hist_base()` array that
`--hot-block-dump` writes. The software window was re-taken the same way so the two sit on one
axis. The browser software window reproduces the CLI one closely (47.6 % vs 47.7 % foldable,
p50 3 / p90 9 in both, 28.7 % vs 28.8 % dispatches removed, mean run 2.52 in both), which is
what licenses reading the GL column beside it.

Both windows are 25 s of wall clock after a warm-up, `+map demo1`, and both were proven to be
rendering a moving world by two raw frame-layer PNGs through `tools/png-diff.js`: **GL 7.4 % of
640x480 pixels changed**, **software 8.9 % of 320x240**. The GL capture is unmistakably the
demo1 world — textured BSP geometry, viewmodel, HUD.

### Side by side

| | software (browser) | OpenGL (browser) | software (CLI, b3000-3100) |
|---|---:|---:|---:|
| retired ops in window | 717,521,101 | 378,886,832 | 18,641,438 |
| presents in window | 288 | 320 | — |
| frame-layer size | 320x240 (DirectDraw) | 640x480 (GPU) | 320x240 |
| **retired ops per present** | **2.49 M** | **1.18 M** | — |
| hits inside images | 97.3 % | 95.0 % | 97.6 % |
| outside (`gamex86.dll`, not on disk) | 2.7 % | 5.0 % | 2.4 % |
| `ref_soft.dll` | **88.8 %** | 0 % | 90.4 % |
| `ref_gl.dll` | 0 % | **62.6 %** | 0 % |
| `quake2.exe` | 11.2 % | **37.4 %** | 9.6 % |
| host API thunk entries | ~0 | **5.9 M = 1.6 %** of retired ops | ~0 |
| foldable, exact | 47.6 % | **28.1 %** | 47.7 % |
| foldable, `--relax=alias,partial,flags` | 66.6 % | **45.3 %** | 67.0 % |
| run p50 / p90, exact | 3 / 9 | **1 / 4** | 3 / 9 |
| run p50 / p90, all | 6 / 18 | **3 / 6** | 6 / 18 |
| dispatches removed, exact | 28.7 % | **11.2 %** | 28.8 % |
| dispatches removed, all | 50.4 % | **26.2 %** | 50.9 % |
| collapsible mass, exact (all / body>=4) | 3.5 % / 2.4 % | 1.3 % / 0.2 % | 3.5 % / 2.5 % |
| collapsible mass, all (all / self-loop) | 32.7 % / **9.0 %** | 31.1 % / **1.3 %** | 32.9 % / 9.3 % |
| terminator self-loop / interior / plain | 10.9 / 72.2 / 16.9 | **14.5 / 50.9 / 34.6** | 11.3 / 72.1 / 16.6 |

Barrier histogram, exact mode, share of retired ops:

| class | software | OpenGL |
|---|---:|---:|
| `fpu/simd` (incl. the push/pop bug) | 20.9 % | **32.0 %** |
| `branch-cc` | 8.5 % | 11.1 % |
| `terminator-flags` | 6.0 % | 8.6 % |
| `partial-reg` | 5.9 % | 4.4 % |
| `other` | 3.2 % | **9.3 %** |
| `adc/sbb` | 4.6 % | 0.2 % |
| `alias` | 3.3 % | 0.6 % |
| `call` + `ret` | 1.1 % | **4.0 %** |

The GL column is a different program. `adc/sbb` and `alias` — the software rasterizer's carry
tricks and its span copies — essentially vanish, `call`/`ret` quadruples, and one third of all
retired ops are now float.

### The x87 population, both renderers

| | software (browser) | OpenGL (browser) | software (CLI, b3000-3100) |
|---|---:|---:|---:|
| x87 ops, share of retired | 17.8 % | **22.8 %** | 17.5 % |
| x87 run members | 16.1 % | 19.2 % | 15.9 % |
| interleaved integer inside runs | 1.8 % | **4.2 %** | 1.7 % |
| x87 runs | 14.60 M | 19.49 M | 364,462 |
| **mean run length** | **7.92** | **3.74** | 8.13 |
| run length p50 / p90 / max | 3 / 23 / 159 | **2 / 11 / 117** | 5 / 25 / 159 |
| **x87 ops in runs >= 4** | **89.9 %** of members | **72.2 %** of members | 90.3 % |
| ... as a share of all x87 ops | 81.3 % | 60.9 % | 82.1 % |
| live stack slots p50 / p90 / max | 1 / 4 / 8 | 1 / 3 / 8 | 1 / 4 / 8 |
| dispatches removed by an x87 fold | **14.1 %** of retired | **14.1 %** of retired | 13.9 % |

x87 run barrier histogram (share of runs ended):

| class | software | OpenGL |
|---|---:|---:|
| `integer-interleave` | 37.1 % | 33.5 % |
| `compare` | 33.4 % | 25.7 % |
| `branch` | 25.6 % | **34.9 %** |
| `status-word` | 3.4 % | 5.7 % |
| `transcendental` | 0.5 % | 0.2 % |

Where the x87 lives, as a share of x87 retired ops:

| terminator class | software | OpenGL |
|---|---:|---:|
| `self-loop` | 1.6 % | **20.4 %** (all but 0.3 pp of it `dec/jnz`) |
| `interior-branch` | 79.0 % | 41.5 % |
| `plain-exit` | 19.4 % | 38.2 % |

### The top three blocks of the OpenGL window

| # | block | hits | ops | retired | what it is |
|---|---|---:|---:|---:|---|
| 1 | `ref_gl.dll+0x50ae` | 861,760 | 20 | 17.2 M (4.5 %) | **GL call setup.** Reads a per-vertex colour index (`mov dl,[eax+edi*4+3]`), looks it up in the float palette at `0x1002cb90`, scales the three components by the constants at `0x100b3b30/34/38`, pushes each with `push ecx` / `fstp dword [esp]` plus an alpha in `ebp`, and `call [0x10052a24]` — a four-float call, i.e. the colour entry — then `lea eax,[0x10038160+edx*4]`, `push eax`, `call [0x10052c08]`, a vertex-pointer call. Arity and rate match the re-note's per-frame census of ~2,750 `glColor4f` and ~6,400 `glVertex3fv`. |
| 2 | `ref_gl.dll+0x4dc4` | 301,440 | 46 | 13.9 M (3.7 %) | **Vertex transform — MD2 keyframe lerp.** Two byte-compressed vertex streams unpacked through the `[esp+0x14]` int->float staging slot with `fild`, each multiplied by a lerp scale vector (`[ebp+n]` and `[edi+n]`), summed, offset by the frame translate `[edx+n]`, and `fstp`d into the interpolated vertex at `[esi-0xc/-8/-4]`. `dec`/`jnz` self-loop over vertices. |
| 3 | `ref_gl.dll+0x48e0` | 487,818 | 25 | 12.2 M (3.2 %) | **Lightmap build.** Per RGB component: `fild` a lightmap byte from `[ecx-2/-3/-4]`, `fmul` by a per-style scale from `[esp+0x30/34/38]`, `fadd` into the running float accumulator at `[eax-0x14/-0x10/-0xc]`, `fstp` back. This is the `s_blocklights` accumulate loop, one style at a time. `dec`/`jnz` self-loop. |

Block 1 is the shape everybody expects of an accelerated renderer — a handful of floats
marshalled onto the stack and handed to the driver. Blocks 2 and 3 are the shape nobody
budgets for: pure guest float loops that never touch the GL seam at all.

### Does the GL path become foldable float trees, or scattered `fld`/`fstp` around API calls?

**Both, and the trees win.** Under OpenGL the float trees are half as long as the software
renderer's — mean run 3.74 against 7.92, p90 11 against 23 — but **72.2 % of x87 run members
still sit in runs of four or more**, and only 34.9 % of runs end at a branch (the class that
contains the call into the GL thunk). The modal run-ender is still an integer memory clash
(33.5 %) and the second is a float compare (25.7 %), which are the shapes of ordinary
arithmetic, not of API marshalling. The "scattered around a call" shape is real and is exactly
block 1 above — 9 x87 ops, longest run 4, ending at `call [0x10052a24]` — but that is 4.5 % of
GL's retired ops, while blocks 2 and 3, which are unbroken float loops, are another 6.9 %.

Three further things sharpen it. x87 is a *larger* share of retired work under GL, not a
smaller one (22.8 % vs 17.8 %): removing the software rasterizer removes integer span code, and
what is left is more float-dense. The float work moves into **self-loops** — 20.4 % of GL's x87
ops are in `dec/jnz` self-loops against 1.6 % under software — so an x87 fold there is
amortised over trips rather than paid once per block entry, which is the opposite of what the
*integer* fold gets on this app. And the payoff is renderer-independent: an x87 fold removes
**14.1 % of retired ops as dispatches under both renderers**, against an integer fold's 28.7 %
software / **11.2 %** OpenGL. Under OpenGL the float fold is worth more than the integer one,
and it is the only one of the two whose value does not collapse when the rasterizer moves to
the host.

### Window caveats

* **The two renderers run at Quake's own different default resolutions** — 320x240 software,
  640x480 OpenGL. "Retired ops per present" therefore compares the two shipped configurations,
  not equal pixel counts. Software does 2.1x the guest work per frame while drawing a quarter
  of the pixels; per pixel the gap is 8x.
* **The browser window is 25 s of wall clock, not a batch range.** The browser scheduler has no
  batch counter to aim at. Every share reported above is hit-weighted and therefore immune to
  how far the demo got; the one load-sensitive number is retired ops per present, and this box
  was under heavy load throughout. A second GL sample taken the same way retired 34.4 M hits in
  its 25 s against the reported run's 64.9 M — same shares, half the absolute work.
* **The hot-block histogram is a hash table and drops collisions**: 450,900 (software) and
  180,571 (OpenGL) against 77.9 M and 64.9 M recorded hits, i.e. 0.6 % and 0.3 %.
* **`gamex86.dll` is missing from this install**, so 2.7 % (software) and 5.0 % (OpenGL) of hits
  are outside every image and undecoded. The GL share is higher because the game DLL's fixed
  per-frame work is a larger fraction of a cheaper frame.
* **The API thunk zone contributes no blocks to the histogram at all** (0 hits in every window,
  software and OpenGL, CLI and browser): a thunk EIP is taken by `$win32_dispatch` and never
  becomes a decoded block, so the thunk share cannot be read out of a hot-block dump. The
  OpenGL figure above was measured at the host-import seam instead, by counting entries into
  `GLCommandStream.Encoder.prototype.call` — 2,788,344 over 151 presents, **18,466 GL host
  entries per frame**, which independently reproduces the re-note's 18,000-22,000. Scaled to the
  reported 320-present window that is ~5.9 M host entries against 378.9 M retired guest ops: one
  host GL call per 64 retired guest ops.
* The `--relax` and terminator tables for the browser windows were taken with
  `--relax=alias,partial,flags --max-ops=4096`, as above.

### Reproducing

```bash
S=/tmp/fold
# software, CLI (the anchor row, identical to the original quake2 row above)
node test/run.js --app=quake2_demo --args='+set vid_ref soft +map demo1' \
  --quiet-api --no-close --screen=800x600 --batch-size=20000 \
  --max-batches=999999 --max-seconds=55 --handler-hist --handler-hist-thread=0 \
  --handler-hist-start=3000 --handler-hist-stop=3100 \
  --hot-block-dump=$S/q2soft-hot.txt > $S/q2soft-run.log 2>&1
node tools/expr-fold-census.js --dump=$S/q2soft-hot.txt \
  --exe=test/binaries/candidates/quake-2-demo-installer/installed-extracted/Install/Data/quake2.exe \
  --modules-from=$S/q2soft-run.log --max-ops=4096 --relax=alias,partial,flags
```

The OpenGL dump needs a browser. Drive `index.html` in Chrome with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, set
`apps.quake2_demo.args` to `'+set vid_ref gl +map demo1'`, click the real Launch button, wait
for a non-flat frame layer, then over the app's own exports:
`e.reset_handler_hist(); e.set_handler_hist_enabled(1);` ... wait ... `e.set_handler_hist_enabled(0);`
and read the `(addr, hits)` u32 pairs at `e.get_hot_block_hist_base()` — the same array
`--hot-block-dump` writes — into a dump file. Take `--modules-from` from the page's own
`DLL: ... origBase=` console lines; they match the CLI's load addresses exactly
(`gamex86.dll` `0xc12000`, `ref_soft.dll` `0xd7e000`, `ref_gl.dll` `0xf9d000`).

The x87 section, the module attribution and the API-thunk line are printed by every run and
need no extra flag; the same numbers are in `--json=` under `x87`, `modules` and
`apiThunkHits`. `--thunk-base` / `--thunk-size` override the thunk-zone range.
