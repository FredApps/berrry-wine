# Is there a fixed vocabulary of integer expression trees worth fusing?

2026-09-14. Read-only study. No emulator source was changed; the deliverables are
`tools/hot-loop-corpus.js` and this document with its data directory
`docs/hot-loop-vocabulary-2026-09/`.

**Verdict up front: no. Build the generic load/op split, and fuse at most the two
trees that are genuinely distributed across programs.** The measured numbers clear
the decision rule's bar on paper — the top ten arithmetic families cover **44.0%**
of dynamic ALU ops in the DOS corpus and **31.8%** in the Win98 corpus, both above
30% — and the rule should still be answered *no*, because of what is behind those
percentages. Two-thirds of the arithmetic weight sits in families where one
program supplies most of the family's ops. §7 is the argument; §8 is what to build
instead.

---

## 1. The question, and why it was asked again

[docs/tree-shape-census.md](tree-shape-census.md) already tried this
automatically: `tools/tree-shape-census.js` hashed 2/3/4/6-op skeletons in exact
order and pooled them across apps. Of 663 distinct 6-op skeletons, exactly **one**
appeared in more than one app, and it was `ld32+d(r0);mov(%0)`. Its verdict was
"do not build the fused-handler vocabulary".

The suspicion this study tests is that the census was at the wrong *grain*. Real
loops interleave idioms with loads, spills and counters, so an order-sensitive
instruction-sequence hash sees every instance as unique even when the **dataflow
tree** recurs. The re-do therefore reads real disassembly and writes down the
dataflow, ignoring interleaving and register names.

The decision rule agreed in advance:

> **≥ 10 trees covering ≥ 30% of dynamic ALU ops across BOTH corpora → build the
> fixed vocabulary; otherwise generic load/op split + pair fusion only.**

## 2. What was collected

**Win98 — six profiling windows over six apps.** Each run is
`--handler-hist --handler-hist-thread=0 --hot-block-dump=FILE`, capped with
`--max-seconds=180` inside an outer `timeout 300`. The exact command lines are in
[`collect-win98.sh`](hot-loop-vocabulary-2026-09/collect-win98.sh).

| window | app | budget | hot blocks |
|---|---|---|---|
| quake2 | quake2 demo, `+set vid_ref soft +map demo1` | 300 × 200k | 11536 |
| mw3 | MechWarrior 3 demo | 12 × 200k | 5830 |
| mw3long | MechWarrior 3 demo | 50 × 200k | — |
| diablo | Diablo shareware | 4000 × 200k | 5189 |
| caesar3 | Caesar III demo | 40000 × 20k | 2207 |
| heroes2 | Heroes II demo, three menu clicks | 40000 × 20k | 3490 |
| starcraft | StarCraft shareware | 1500 × 200k, `--max-seconds=120` | — |

`mw3long` exists because the 12-batch window was all C++ prologue/epilogue, SEH
and x87 — the app had not reached its renderer yet. The longer window exposes the
loop that is 93% of its work. Both are reported; only `mw3long` is read.

`--hot-block-dump` gives block **entry** counts, not retired ops, so
`hot-loop-corpus.js win98` disassembles every block from its head to its first
control-flow instruction, out of the module file, and weights it
`entries × instructions`. Runtime VAs are mapped back to `(module, original VA)`
through the `DLL: … origBase=` lines `run.js` prints. Top 25 per window, 150
loops, 126 of them summarised by hand.

**DOS — the whole `/tmp/demos` corpus.** `hot-loop-corpus.js dos-sweep` reuses
`sweep-dos.js`'s entry list and launch handling: **199 programs across 146
directories**, five at a time, 60s each, `--auto-key --pit-clock`, top 40 blocks
per program written as `blocks-by-ip.txt` (the blocks re-sorted by `cs:ip`, since
16-bit code retires 1-3 ops per block and one block is never a loop). 199 of 199
produced data.

**Load-bearing caveats.**

- The box sat at load 17-45 throughout. Runs used both `--max-batches` and
  `--max-seconds`, so a `--max-seconds`-terminated window covers a
  load-dependent amount of guest time. Block **shares within a window** are
  unaffected and are the only thing quoted.
- A window is a scene, not an app. `mw3` and `mw3long` are the same binary and
  disagree completely about what it does. Every number here is "what this window
  did", and [feedback on `hot-loop-census.js`](../CLAUDE.md) applies: one window
  is not evidence about where an app spends its life.
- Five 1993 demos barely ran (a-note 1379 ops, STARPORT 472, manhatan 7163,
  DPS 5160, uman ~15k entirely inside its self-extractor). Their tags are in the
  data and should not be weighted.

## 3. How much was read, and which programs got the careful reading

**709 loops hand-read**: 126 Win98 (mine) and 583 DOS (five parallel readings,
one per corpus slice, each writing a `read-*.tsv` under
[the data directory](hot-loop-vocabulary-2026-09/)).

| slice | programs | loops read |
|---|---|---|
| Win98 | 6 windows | 126 (top 25 of each) |
| 1993 | 24 | 72 |
| 1994 a–b | 36 | 108 |
| 1994 c–d | 52 | 147 |
| 1995 a–b | 58 | 148 |
| 1995 c–z | 29 | 83 |

Reading priority followed the refinement: **every 1995 demo read first** (87 of
87, top 3 loops each), then 1994 (88 of 88), and 1993 skimmed (24 of 24 — the
skim still covered all of them because the slice is small). Within a year, demos
whose hot loops are 3D/texture/rotozoom/tunnel/plasma/voxel/bump-map shapes were
read before copper/scroller/starfield ones; the ones that turned out to carry a
real interpolator or 3D shape are named individually in §6.

Every row records `program`, `block`, `share%`, `family`, and the dataflow tree in
the normalised grammar (leaves `reg | imm | L8/L16/L32[base+idx*s+d]`; nodes
mul/imul, shr/sar/shl/shrd by const, add/sub, and/or/xor, cmp/jcc). The grammar
deliberately drops register names and interleaving — which is the whole point of
re-doing the census by reading.

## 4. Win98: what the six windows actually do

Full per-loop index: [`read-win98.tsv`](hot-loop-vocabulary-2026-09/read-win98.tsv);
disassemblies under [`win98/`](hot-loop-vocabulary-2026-09/win98/).

Top 20 by share of the window's retired guest ops (Σ over all six windows):

| # | family | class | loops | apps | Σshare | example |
|---|---|---|---|---|---|---|
| 1 | BLEND (SWAR) | ARITH | 3 | 2 | 93.7 | `mech3demo+0x00526f54` |
| 2 | COUNTER | OTHER | 21 | 3 | 55.8 | `c3+0x00417204` |
| 3 | RLE_TOKEN | STREAM | 12 | 4 | 46.7 | `ref_soft+0x1000583e` |
| 4 | IO_POLL | OTHER | 8 | 2 | 40.4 | `storm+0x15007bba` |
| 5 | CALL_GLUE | OTHER | 18 | 5 | 35.7 | `storm+0x15007b48` |
| 6 | CMP_SKIP | OTHER | 14 | 4 | 30.3 | `storm+0x1501d11c` |
| 7 | FIELD_REPACK | ARITH | 4 | 3 | 26.7 | `c3+0x004a3ecf` |
| 8 | ADDR_SCALE | ARITH | 9 | 3 | 25.4 | `H2DEMOW+0x00499937` |
| 9 | MEMFILL | MEM | 3 | 3 | 19.3 | `ref_soft+0x1000583e` |
| 10 | TABLE_DECODE | STREAM | 7 | 1 | 17.4 | `smackw32+0x1000eea0` |
| 11 | GETBITS | STREAM | 6 | 1 | 17.4 | `smackw32+0x1000efad` |
| 12 | MEMCOPY | MEM | 5 | 3 | 13.9 | `c3+0x0049e9db` |
| 13 | BYTE_PACK | ARITH | 2 | 2 | 11.0 | `H2DEMOW+0x00499937` |
| 14 | CARRY_STRIDE | ARITH | 7 | 2 | 8.6 | `smackw32+0x10012632` |
| 15 | FIXPT_STEP | ARITH | 2 | 1 | 7.5 | `quake2+0x00426313` |
| 16 | REFILL | STREAM | 2 | 1 | 6.1 | `smackw32+0x1000ef28` |
| 17 | TEXEL_FETCH | ARITH | 3 | 1 | 3.0 | `ref_soft+0x10011fdc` |
| 18 | LUT_XLAT | ARITH | 1 | 1 | 2.7 | `ref_soft+0x10005a0f` |
| 19 | STRSEARCH | MEM | 2 | 1 | 1.5 | `quake2+0x00423564` |
| 20 | PERSP_DIV | ARITH | 2 | 1 | 1.4 | `ref_soft+0x10011c3b` |

Class rollup by primary tag: **ARITH 39.1%, OTHER 38.0%, STREAM 18.9%, MEM 4.0%**
of the read loop weight.

Read that table app by app, because the aggregate hides six unrelated stories:

- **mw3long is one loop.** `0x00526f54` + `0x00527075` are **93.1%** of its
  window: a SWAR 16bpp box filter, two field masks, four taps per iteration. It is
  a textbook fused-op candidate and it exists in exactly one app here.
- **caesar3 is a 16-bit field repack plus C-loop overhead.** The RGB555→RGB565
  in-place conversion at `0x004a3ecf`/`0x004a3e70` with a `0xf81f` magenta key is
  ~38% of the window; another ~23% is nested C loops clearing a 2D array where
  *every* induction variable is reloaded from `[ebp-N]` each iteration.
- **diablo's window is the idle pump.** ~40% is a `storm.dll` timer-list walk and
  `PeekMessage`/`GetCursorPos` glue; the rest is a colour-keyed run scanner and
  literal `rep`-style copies. There is no fixed-point arithmetic in its top 25 at
  all.
- **quake2 is decompression first, arithmetic second.** The PCX/WAL run-length
  expander in `ref_soft` (`and tok,0xc0 / cmp 0xc0`, then `rep stosd`+`rep stosb`)
  is ~18% of the window. The famous `D_DrawSpans8` carry-propagating texel walk —
  the single most archetypal fixed-point loop in the corpus — is **3.0%**.
- **heroes2 is a third sound driver.** MSS32 voice-slot polling is ~33% of the
  window; its own sprite RLE blitter is ~17%; the one genuinely arithmetic loop is
  a palette expand at 8.6%.
- **starcraft is a Huffman decoder end to end.** `smackw32`'s MMX bit accumulator
  — `movq mm2,[esi] / psllq / por` refill, `and edx,0xfff / mov ecx,[tbl+edx*4] /
  psrlq mm0,mm1` table decode, `psrlq mm0,1 / jb` tree walk — is ~45% of it.

Measured ALU-op coverage (mnemonic-classified, weighted by block entries, 124 of
126 loops matched, 782.5M ALU instructions): **top 5 ARITH families 30.3%, top 10
31.8%, top 20 31.8%** of dynamic ALU ops. The top-10 number is 17.3 points BLEND
(one app) plus 7.1 points FIELD_REPACK (one app); remove those two apps and the
whole arithmetic vocabulary covers roughly 7% of Win98 ALU ops.

## 5. DOS: 199 programs, ranked two ways

Full per-loop index in the five [`read-*.tsv`](hot-loop-vocabulary-2026-09/) files;
per-program block dumps under [`dos/`](hot-loop-vocabulary-2026-09/dos/).

### (1) By total dynamic share — a few long-running demos dominate

| # | family | class | loops | demos | Σshare | % |
|---|---|---|---|---|---|---|
| 1 | IO_POLL | OTHER | 108 | 84 | 4214.0 | 27.1% |
| 2 | GETBITS | STREAM | 39 | 38 | 1197.9 | 7.7% |
| 3 | ADDR_SCALE | ARITH | 46 | 38 | 1090.1 | 7.0% |
| 4 | MEMCOPY | MEM | 49 | 39 | 1006.5 | 6.5% |
| 5 | BLEND | ARITH | 24 | 19 | 889.0 | 5.7% |
| 6 | COUNTER | OTHER | 22 | 21 | 763.5 | 4.9% |
| 7 | OTHER | OTHER | 33 | 23 | 742.0 | 4.8% |
| 8 | CMP_SKIP | OTHER | 22 | 16 | 555.5 | 3.6% |
| 9 | FIXPT_MUL | ARITH | 25 | 21 | 552.9 | 3.6% |
| 10 | COPY_BACK | STREAM | 32 | 32 | 477.9 | 3.1% |
| 11 | STRSEARCH | MEM | 21 | 18 | 434.5 | 2.8% |
| 12 | REFILL | STREAM | 17 | 17 | 424.6 | 2.7% |
| 13 | BYTE_PACK | ARITH | 11 | 10 | 381.5 | 2.5% |
| 14 | FIXPT_STEP | ARITH | 19 | 17 | 364.3 | 2.3% |
| 15 | TEXEL_FETCH | ARITH | 6 | 6 | 287.8 | 1.9% |
| 16 | FIELD_REPACK | ARITH | 7 | 7 | 239.1 | 1.5% |
| 17 | MEMFILL | MEM | 17 | 17 | 193.4 | 1.2% |
| 18 | CALL_GLUE | OTHER | 19 | 12 | 182.7 | 1.2% |
| 19 | PERSP_DIV | ARITH | 10 | 9 | 180.1 | 1.2% |
| 20 | LUT_XLAT | ARITH | 5 | 4 | 150.9 | 1.0% |

### (2) By number of demos carrying the family in their own top 3 — the "common vocabulary" question

| # | family | class | demos | % of 199 |
|---|---|---|---|---|
| 1 | IO_POLL | OTHER | 84 | 42.2% |
| 2 | MEMCOPY | MEM | 39 | 19.6% |
| 3 | GETBITS | STREAM | 38 | 19.1% |
| 4 | ADDR_SCALE | ARITH | 38 | 19.1% |
| 5 | COPY_BACK | STREAM | 32 | 16.1% |
| 6 | OTHER | OTHER | 23 | 11.6% |
| 7 | COUNTER | OTHER | 21 | 10.6% |
| 8 | FIXPT_MUL | ARITH | 21 | 10.6% |
| 9 | BLEND | ARITH | 19 | 9.5% |
| 10 | STRSEARCH | MEM | 18 | 9.0% |
| 11 | REFILL | STREAM | 17 | 8.5% |
| 12 | FIXPT_STEP | ARITH | 17 | 8.5% |
| 13 | MEMFILL | MEM | 17 | 8.5% |
| 14 | CMP_SKIP | OTHER | 16 | 8.0% |
| 15 | CALL_GLUE | OTHER | 12 | 6.0% |
| 16 | BYTE_PACK | ARITH | 10 | 5.0% |
| 17 | PERSP_DIV | ARITH | 9 | 4.5% |
| 18 | DOT3 | ARITH | 8 | 4.0% |
| 19 | FIELD_REPACK | ARITH | 7 | 3.5% |
| 20 | TEXEL_FETCH | ARITH | 6 | 3.0% |

The two rankings disagree in exactly the way the refinement anticipated, and the
disagreement is the finding. BLEND is #5 by weight and #9 by spread; ADDR_SCALE is
#3 by weight and #4 by spread and is the only arithmetic family in the top five of
both.

### Measured ALU-op coverage, with concentration

This is the decision rule's own denominator, measured rather than inferred: for
each read loop, the hit-weighted ops of that exact block in the dump, split into
ALU classes (`fold`, `flags`, `adc-sbb`, `muldiv`, `shift-*`, `terminator-flags`)
and everything else. 548 of 583 read loops located; 126.0M hit-weighted ALU ops.

| # | family | class | % of ALU ops | demos | top demo's share of the family |
|---|---|---|---|---|---|
| 1 | IO_POLL | OTHER | 34.7% | 84 | 8.4% |
| 2 | BLEND | ARITH | 10.3% | 19 | **63.5%** |
| 3 | ADDR_SCALE | ARITH | 9.4% | 36 | 18.5% |
| 4 | FIXPT_MUL | ARITH | 4.4% | 21 | 23.2% |
| 5 | FIXPT_STEP | ARITH | 4.2% | 17 | **52.0%** |
| 6 | DOT3 | ARITH | 4.0% | 8 | **43.3%** |
| 7 | FIELD_REPACK | ARITH | 3.4% | 7 | **89.9%** |
| 8 | CALL_GLUE | OTHER | 2.7% | 12 | 57.9% |
| 9 | BYTE_PACK | ARITH | 2.6% | 9 | **88.0%** |
| 10 | OTHER | OTHER | 2.6% | 20 | 18.8% |
| 11 | STRSEARCH | MEM | 2.3% | 17 | 44.9% |
| 12 | TEXEL_FETCH | ARITH | 2.1% | 5 | **66.5%** |
| 13 | COUNTER | OTHER | 2.0% | 21 | 15.2% |
| 14 | PERSP_DIV | ARITH | 1.9% | 9 | 39.9% |
| 15 | GETBITS | STREAM | 1.7% | 38 | 24.2% |

- **top 5 ARITH families: 32.3% of dynamic ALU ops**
- **top 10 ARITH families: 44.0%**
- **top 20 ARITH families: 47.7%**

The `top demo` column is the one that decides this study. A family whose weight is
64%, 88% or 90% one demo is not a vocabulary entry; it is that demo's effect
wearing a family's name. Only two arithmetic families are genuinely spread —
**ADDR_SCALE** (36 demos, no demo over 19%) and **FIXPT_MUL** (21 demos, no demo
over 24%) — and together they are **13.8%** of DOS ALU ops.

Note also that 34.7% of what the classifier calls ALU is `IO_POLL`: the `and al,8`
of a VGA retrace spin. Those ops are real dispatches and a real cost, but no
arithmetic fusion touches them.

### Split by year

| year | demos | loops | top families by share |
|---|---|---|---|
| 1993 | 24 | 72 | IO_POLL 38.1%, MEMCOPY 9.2%, COUNTER 9.0%, GETBITS 8.0%, ADDR_SCALE 5.9%, CMP_SKIP 5.4%, TEXEL_FETCH 3.6% |
| 1994 | 88 | 255 | IO_POLL 27.1%, GETBITS 12.8%, ADDR_SCALE 8.6%, BLEND 7.5%, COUNTER 6.4%, COPY_BACK 5.3%, MEMCOPY 4.6% |
| 1995 | 87 | 256 | IO_POLL 24.0%, OTHER 10.9%, MEMCOPY 7.7%, REFILL 5.9%, ADDR_SCALE 5.6%, BLEND 5.2%, FIXPT_MUL 4.9% |

There **is** a visible 1993→1995 drift, and it is smaller than the hypothesis
expected: waiting falls from 38% to 24%, and BLEND / FIXPT_MUL rise into the top
seven. But no 1995-specific vocabulary appears that 1994 does not already have —
the same families reorder. TEXEL_FETCH, the shape a "1995 3D vocabulary" would be
built around, is 3.6% in 1993 and does not even reach the 1995 top eight.

## 6. The demos that carry a real 3D / interpolator shape

Out of 199 programs, the careful reading found these with a genuine
perspective-divide, texture-span or interpolator tree. They are named because the
rest of the corpus, read carefully, does not have one:

- **BURMA** (71.6%) — a full 16.16 mul/div library called per point:
  `shl#16 / shrd#16 / imul_r32 / shld#16` and `cdq / idiv_r32 / shld#16`. The
  identical pair appears inline in ACME-SYW, AUTUMN and BBUUMI. The single
  strongest fixed-vocabulary candidate in the DOS corpus.
- **ACME-SYW** (48.0%) — per-pixel divide, atan2-by-divide-plus-LUT, and a 3-imul
  `shrd#0xe` dot product.
- **BBUUMI** (97.1%) and **DEFECT!** (95.5%) — whole demos that are one escape-time
  iterator; the only op that matters is `imul_r32` immediately followed by
  `shrd#0x18`.
- **cma_brw/BRW** (23.6% TEXEL_FETCH + 10.0% FIXPT_STEP), **ASYLUM** (7.3%),
  **CRITICAL** (97.4%), **brainbug** (65.7%) — the four real textured-span walks.
- **cass** (26.7% DOT3), **MOUSETRO** (79.2%), **ALCHYMIA**, **COLORS**,
  **ANIMATE** — 3×3 rotation rows, `imul` + `sar#N`.
- **MORBID** (32.4%), **DOWNADD** (29.7%), **ASM95ZEA**, **ASSAULT** — textbook
  `imul / idiv z / add centre` perspective divides.
- **countdwn/ZOKDTPLN** (68.5% + 20.3%), **cocobbs1/NM2** (96.0%), **DREAM**
  (63.7%), **DFUSE** (43.4%), **ctslasse**, **SE95**, **AUTUMN** — the blend
  family: SWAR field averages and `adc`-carried 4- and 8-neighbour blurs.

That is roughly **25 of 199 demos**. The other 174 are dominated by port polling,
spin delays, unpacker stubs and block moves.

## 7. The decompression / bit-stream idiom class

Ranked separately, as required. These are not filed under "memory traffic".

**DOS** (Σ = 15.7% of read loop weight):

| # | idiom | demos | Σshare |
|---|---|---|---|
| 1 | GETBITS | 38 | 1197.9 |
| 2 | COPY_BACK | 32 | 477.9 |
| 3 | REFILL | 17 | 424.6 |
| 4 | RLE_TOKEN | 5 | 145.7 |
| 5 | CRC_STEP | 4 | 115.4 |
| 6 | TABLE_DECODE | 2 | 75.3 |
| 7 | NIBBLE_PACK | 1 | 11.8 |

**Win98** (Σ = 18.9%): RLE_TOKEN 4 apps / 46.7, GETBITS 1 app / 17.4,
TABLE_DECODE 1 app / 11.3, REFILL 1 app / 6.1.

So the stream idioms are emphatically **not** below 2% — they are the widest-spread
non-trivial shape in the whole study: GETBITS is in 38 demos' top three, COPY_BACK
in 32. A small fixed set of stream uops — `REFILL`, `GETBITS n`, `TABLE_DECODE`,
`COPY_BACK len/off`, `RLE_TOKEN` — would cover essentially all of it, because the
shapes really are the same five.

**But the spread is one tool, not a genre.** Four of the five readers independently
found the same thing: a single EXE-packer depacker stub, byte-identical, in 8
demos of the 1993 slice (adrenali, akm-chan, alive, btw, caveira, dowhack, uman,
and an offset variant in alpha/brainbug/diftro), in 12 demos of 1994 a–b, in 15 of
1994 c–d, and in 7 of 1995 c–z (catwalk, chrome, UKKO, cocaholc, coffee, cytopyge,
clash). It is a bit-serial `shr/rcl` GETBITS plus a `rep movsb` COPY_BACK. Its
"appears in 38 demos" is one routine compiled once and shipped 38 times, and in
most of those demos it runs only at startup — so it inflates the spread ranking
without being a steady cost.

Where a decompressor *is* the steady cost, it is worth a lot: StarCraft's Smacker
decoder is 45% of its window, and Diablo's, Heroes II's and Caesar III's run-length
blitters are 10-17% of theirs. Those are five different codecs with the same five
primitives. The honest reading is that the stream class is the **stronger** of the
two candidate vocabularies — smaller, more stereotyped, and more widely present —
but its payoff is concentrated in a handful of programs rather than spread thin
across the corpus.

## 8. What a generic load/op split would remove instead

The alternative to fusing whole trees: make loads their own micro-ops, keep
intermediates in wasm locals, eliminate redundant loads, forward stores to loads,
and never emit a register-to-register move. `hot-loop-corpus.js load-census`
counts what there is to delete in the Win98 loops, from the disassembly, weighted
by block entries:

| app | window covered | loads/ops | redundant loads | store→load | reg moves | **removable** |
|---|---|---|---|---|---|---|
| caesar3 | 84.1% | 19.8% | 1.0% | 0.7% | 2.9% | **4.6%** |
| diablo | 78.3% | 27.1% | 0.0% | 0.6% | 4.0% | **4.6%** |
| heroes2 | 68.4% | 36.0% | 5.8% | 0.4% | 2.0% | **8.2%** |
| mw3 | 46.0% | 14.2% | 0.0% | 0.5% | 4.0% | **4.6%** |
| mw3long | 96.4% | 27.0% | 4.8% | 0.0% | 13.4% | **18.3%** |
| quake2 | 49.3% | 23.6% | 2.3% | 0.4% | 10.8% | **13.5%** |
| starcraft | 57.8% | 26.2% | 0.0% | 0.0% | 2.6% | **2.6%** |

2.6-18.3% of guest ops in the hot blocks, mean ≈ 8%, with **no new handler and no
pattern matching at all**. And it is available in the loops the vocabulary cannot
reach: caesar3's C-level array clears reload both induction variables from
`[ebp-N]` every single iteration; quake2's span loop spills its DDA accumulators to
module globals between unrolled bodies; mw3long's SWAR blend is 13.4%
`mov reg,reg`.

The DOS side corroborates from the other direction. The toy-VM op-class census
over all 199 programs (`dos-summary.json`) says the hit-weighted mix is
**fold 27.3%, partial-reg 21.2%, branch 19.8%, io 8.7%, stack 4.9%** — a fifth of
every dispatch is a partial-register move, and another fifth is a branch. Neither
is arithmetic and neither is reachable by an arithmetic vocabulary.

## 9. Decision

Against the rule as written — ≥10 trees covering ≥30% of dynamic ALU ops in both
corpora — the measurement says **44.0% (DOS) and 31.8% (Win98)**, and the rule
passes. It should nevertheless be answered **no**, and the reason is visible in the
concentration column rather than in the coverage number:

1. **Nine of the ten arithmetic families are one program's effect.** BLEND is 63.5%
   one demo, FIELD_REPACK 89.9%, BYTE_PACK 88.0%, TEXEL_FETCH 66.5%, FIXPT_STEP
   52.0%. On the Win98 side, 17.3 of the 31.8 points are mw3long alone. Building
   ten handlers to win ten programs is the `RLE_RUN` and keyed-LUT lesson again:
   a one-app fold, measured as if it were a primitive.
2. **A "family" is not a tree.** BLEND covers at least three unrelated shapes — a
   SWAR masked field average, an `adc`-carried byte neighbourhood sum, and a 64K
   translate table. Reaching the quoted 44% needs far more than ten handlers;
   ten *families* is not ten *trees*.
3. **Tree shape merges unrelated semantics.** ANTRO's 95%-of-the-program hot loop is
   `mul32(seed, 0x41fbf0e7) + 0x17b99`, then shift and mask — shape-identical to a
   fixed-point multiply-and-scale and semantically an LCG. ANARCHY's DDA takes its
   integer step from the *borrow* of a `sub`, not from shifting an accumulator, so
   a FIXPT_STEP handler keyed on shifts would miss it while matching the PRNG.
4. **The denominator is mostly not arithmetic.** 42% of DOS demos and two of six
   Win98 windows spend their top-three loops waiting — retrace spins, memory-flag
   spins, `Delay` loops, message pumps, sound-driver slot scans. Nothing in either
   vocabulary touches those ops.

**Build instead, in this order:**

1. **The generic load/op split with redundant-load elimination, store→load
   forwarding, and register-move elimination.** 2.6-18.3% measured, no matcher, and
   it applies to the spill-heavy C loops that no tree vocabulary will ever match.
2. **Exactly two arithmetic trees, if any:** `ADDR_SCALE` (`imul(y, W) + x` → 8/16-bit
   store; 36 demos, well spread) and `FIXPT_MUL` (`imul_r32` immediately followed by
   `shrd #N`; 21 demos, well spread). Together 13.8% of DOS ALU ops and the only two
   that survive the concentration test.
3. **The five stream uops, scoped honestly.** `REFILL` / `GETBITS n` /
   `TABLE_DECODE` / `COPY_BACK` / `RLE_TOKEN` are a genuinely small and genuinely
   stereotyped set, and they are 10-45% of the windows of StarCraft, Quake II,
   Heroes II, Diablo and Caesar III. Justify them on those five apps' numbers, not
   on the 38-demo spread, which is one packer stub counted 38 times.

This **confirms** [docs/tree-shape-census.md](tree-shape-census.md)'s verdict rather
than overturning it. The census's grain was wrong — dataflow trees do recur where
6-op skeletons did not — but its conclusion holds for a different reason than it
gave: the trees recur, and they recur within one program at a time.

## 10. Three example loops, quoted

**(a) `mech3demo+0x00526f54`, 48.9% of the mw3long window — BLEND(SWAR).** The
largest single arithmetic loop in the Win98 corpus, and a one-app shape.

```
00526f68  66 8b 16       mov dx, [esi]          ; neighbour pixel a
00526f6d  66 8b 74 39 fe mov si, [ecx+edi-0x2]  ; neighbour b
00526f72  23 da          and ebx, edx           ; eax holds the field mask M
00526f74  23 ee          and ebp, esi
00526f78  66 8b 79 fe    mov di, [ecx-0x2]      ; neighbour c
00526f7c  03 dd          add ebx, ebp
00526f80  23 ef          and ebp, edi
00526f82  8d 1c 6b       lea ebx, [ebx+ebp*2]   ; a + b + 2c, field-wise
...
005270b0  c1 eb 02       shr ebx, 0x2
```

tree: `x = (and(a,M) + and(b,M) + 2*and(c,M)) >> 2`, twice per pixel for the two
field masks, four taps per iteration.

**(b) `ref_soft+0x10011fdc`, 1.0% of the quake2 window — CARRY_STRIDE + TEXEL_FETCH.**
The archetypal perspective-correct span walk, unrolled sixteen ways — and worth
3.0% of the window in total, which is the point.

```
10011fe2  03 15 a8 7b 02 10  add edx, [0x10027ba8]       ; sfrac += dsfrac
10011fe8  1b c9              sbb ecx, ecx                ; carry -> 0 or -1
10011ff1  13 34 8d a0 7b ..  adc esi, [0x10027ba0+ecx*4] ; step by row or by row+1
10011fed  03 dd              add ebx, ebp                ; tfrac += dtfrac
10011fef  8a 06              mov al, [esi]               ; texel
10011fea  88 47 08           mov [edi+0x8], al
```

tree: `acc += step; c = carry(acc); src += tbl[c]; dst[k] = L8[src]`, and note
`edx`, `ebx`, `ebp` are reloaded from module globals between unrolled bodies —
§8's population, not §9's.

**(c) `1994-d-defect___DEFECT! 1000:8c7`, 95.5% of that demo — FIXPT_MUL.** The
clearest fixed-point expression tree in the DOS corpus, and the tree behind
recommendation 2:

```
r0 = shrd#0x18(imul32(x, x))
r1 = shrd#0x18(imul32(y, y))
if r0 + r1 >= 0x4000000 break
y  = shrd#0x18(imul32(x shl#1, y)) + cy
x  = r0 - r1 + cx
i += 1 ; while i < 0xb5
```

`imul_r32` immediately followed by `shrd #N` is the corpus's actual fixed-point
multiply idiom. It is also DADEMO's 3×3 rotate, BBUUMI's whole program, and the
inline form of BURMA's library.

## 11. Reproducing this

```bash
# Win98: collect, then disassemble and weight the hot blocks
bash docs/hot-loop-vocabulary-2026-09/collect-win98.sh
bash docs/hot-loop-vocabulary-2026-09/disasm-win98.sh

# DOS: the whole /tmp/demos corpus, five at a time, 60s each
node tools/hot-loop-corpus.js dos-sweep --root=/tmp/demos --jobs=5 --secs=60 \
  --top=40 --out=DIR

# cross-checks and rankings
node tools/hot-loop-corpus.js dos-summary  --out=DIR
node tools/hot-loop-corpus.js load-census  --out=DIR
node tools/hot-loop-corpus.js aggregate    --out=DIR --read=DIR/.. \
  --dos=DIR --win=DIR
```

The full aggregate output as run is
[`aggregate.out`](hot-loop-vocabulary-2026-09/aggregate.out); the per-loop rows,
with every tree, are in the `read-*.tsv` files beside it.
