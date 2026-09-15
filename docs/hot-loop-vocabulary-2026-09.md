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

Every one of those six is a menu, an intro or boot code. **Section 4b adds thirteen
more windows** — five apps inside real gameplay and eight covering launch to the
first gameplay frame — and it contradicts this section in two places, so read it
before quoting anything below.

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

## 4b. Gameplay and loading windows

Section 4's six windows are menus, intros and boot code: diablo is an idle pump at
its main menu, caesar3 is the 555→565 conversion of its boot screens, heroes2 is a
menu with the sound driver spinning, starcraft is the Smacker intro. That is a real
objection to every number above it, so thirteen more windows were collected — five
apps driven into **actual gameplay**, and eight covering **launch to the first
gameplay frame** — and hand-read the same way.

Collected by
[`collect-win98-gameplay.sh`](hot-loop-vocabulary-2026-09/collect-win98-gameplay.sh),
disassembled by
[`disasm-win98-gameplay.sh`](hot-loop-vocabulary-2026-09/disasm-win98-gameplay.sh);
per-loop indexes in
[`read-win98-gameplay.tsv`](hot-loop-vocabulary-2026-09/read-win98-gameplay.tsv) and
[`read-win98-loading.tsv`](hot-loop-vocabulary-2026-09/read-win98-loading.tsv);
disassemblies under
[`win98/<app>-gameplay/`](hot-loop-vocabulary-2026-09/win98/) and
`win98/<app>-loading/`.

The mechanism is `--handler-hist-start=N --handler-hist-stop=M` together with
`--hot-block-dump=FILE`: the dump covers exactly the armed batch range, so a late
window is not diluted by the menus the app had to walk through first. No tool
change was needed for that. The input schedules are the ones the repo's own
gameplay tests use (`test/test-mw3-gameplay.js`, `test-rct-gameplay.js`,
`test-heroes2-gameplay.js`, `test-gta2-demo-gameplay.js`), so "this window is
gameplay" is the same claim those tests assert, and every run also wrote a PNG.

| window | distinct blocks | retired guest ops | top-3 share |
|---|---|---|---|
| quake2-gameplay | 5085 | 2,975,810,059 | 5.3 / 2.7 / 2.7 |
| mw3-gameplay | 9783 | 187,419,690 | 3.5 / 2.8 / 2.5 |
| gta2-gameplay | 6281 | 61,918,425 | 2.5 / 2.2 / 2.2 |
| rct-gameplay | 1710 | 277,935,723 | 28.7 / 28.7 / 9.0 |
| heroes2-gameplay | 1199 | 144,425,666 | 5.9 / 4.4 / 2.7 |
| quake2-loading | 8507 | 274,793,685 | 13.8 / 5.4 / 5.0 |
| mw3-loading | 14555 | 1,239,306,413 | 31.1 / 28.2 / 2.3 |
| gta2-loading | 32390 | 5,764,483 | 58.3 / 6.6 / 6.1 |
| rct-loading | 11180 | 3,518,382,965 | 3.5 / 2.5 / 2.1 |
| heroes2-loading | 7401 | 90,487,552 | 6.8 / 5.7 / 5.3 |
| caesar3-loading | 2215 | 341,865,694 | 14.7 / 7.7 / 7.7 |
| starcraft-loading | 6075 | 2,188,094,380 | 4.4 / 4.4 / 4.0 |
| diablo-loading | 5178 | 591,119,575 | 18.1 / 6.0 / 4.8 |

Three apps have a loading window only, and the reason is recorded rather than
hidden: **caesar3**'s menu clicks do not register at this commit (running the
repo's own `test/test-caesar3-gameplay.js` reproduces `AssertionError: '' !==
'Codex'`), so it gets a boot window; **starcraft** stalls at its title screen, as
its re-notes say; **diablo** does reach Tristram, but its own gameplay test needs
~4x the 300s wall clock this collection allowed — the best run here got to batch
1213 of 4300, with the Enter Name and level-load screens photographed on the way
(`dia-b1600.png`, `dia-c600.png`), so its window is honestly labelled menu + asset
boot. **SkiFree** was collected and discarded: its "gameplay" PNG showed `Dist -1m,
Speed 0m/s` at the start line, which is not gameplay.

PNG evidence — the repo ignores `*.png`, so these are not committed;
`collect-win98-gameplay.sh` writes them beside its hot-block dumps, and the names
below are the ones it uses. quake2 `q2-5000.png` (Outer Base, weapon
and HUD) against `q2-2500.png` (console, still loading); mw3 `mw3-gp-950.png`
(cockpit, terrain, HUD); gta2 `gta2-8000.png` (city, HUD, mission text); rct
`rct-5900.png` (park at £9,837.70 / 22°C) against `rct-load-end.png` (£10,000.00 /
17°C — the park has not opened yet); heroes2 `h2-2900.png` (adventure map, hero,
castle, sidebar).

### What each gameplay window does

- **quake2-gameplay is one loop nest, and it is arithmetic.** Fourteen of the 25
  ranked blocks are `D_DrawSpans8`; eleven of those are different *entry offsets*
  into one 16-texel unrolled body whose per-texel step is the carry-select stride
  `add acc,step / sbb c,c / adc src,[tbl+c*4] / mov al,[src] / mov [dst+k],al`.
  The hottest single block in the window is `ref_soft+0x10012570` (5.34%), the span
  coordinate packer `mov eax,edx / add edx,ebx / shr eax,0x10 / and esi,0xffff0000 /
  or eax,esi`. There is **no decompression at all** in the top 25.
- **mw3-gameplay is an x87 software T&L pipeline, and the SWAR blend is not in it.**
  Four separate inlined copies of the same 3x3-matrix-times-vec3 loop, a 1/z
  perspective divide, three dot3 clip rows, an integer exponent-halving fast-sqrt
  (`sar 1` + `add 0x1fc00000` on the float bit pattern), two copies of the
  magic-constant float→int trick that indexes a 64-entry trig table. Flattest window
  in the study: hottest block 3.45%, 9783 distinct blocks.
- **gta2-gameplay is a linear table scan plus an x87 vertex feeder.** One C routine
  — a stride-8 backward search — is inlined at four call sites and is 12.9% between
  them; a `for (i=0; i<obj->count; i++)` walk keeps its induction variable in a
  struct member and re-loads the bound from a table header every iteration. About
  6% of the window is three 1-op **thunk-zone landings**, i.e. host-call overhead
  rather than guest code.
- **rct-gameplay is one memset and a map traversal.** `RCT+0x00401875`/`0x00401885`
  — `inc [ebp-8] / cmp [ebp-8],0xa00 / jge` and `mov eax,[ebp-8] / mov byte
  [eax+0x569360],0 / jmp` — is **57.5% of the window**, a 2560-byte global clear
  whose index is stored and reloaded three times inside three instructions. Because
  the loop spans two blocks, the self-loop matcher never sees it. The rest is
  0x10-stride map-element list walks; 32.5% of all dispatches in this window are
  branches.
- **heroes2-gameplay is its sprite blitter, with the sound driver demoted.** The
  `0x004c7xxx` RLE blitter is 48% of the read weight (it was 17% in section 4's
  menu window) and MSS32 polling falls from ~33% to 7.5 points. The same block
  addresses recur with the same tags, so the vocabulary transfers; only the mix
  moves. Two blocks are new: a hand-written `memmove` chain called to copy
  **16 bytes** per adventure-map cell (6.6 points), and a `row*stride*12 + col*12`
  cell-address tree that dereferences `[this+0xae]` twice in one block.

### Family table, gameplay windows only

125 loops, 5 apps, Σshare 232 points.

| # | family | class | loops | apps | Σshare | %of-slice | example |
|---|---|---|---|---|---|---|---|
| 1 | COUNTER | OTHER | 13 | 4 | 50.8 | 21.9% | `RCT+0x00401875` |
| 2 | MEMFILL | MEM | 1 | 1 | 28.7 | 12.4% | `RCT+0x00401885` |
| 3 | ADDR_SCALE | ARITH | 19 | 5 | 27.0 | 11.7% | `H2DEMOW+0x00499937` |
| 4 | CMP_SKIP | OTHER | 22 | 4 | 20.5 | 8.8% | `RCT+0x0055785a` |
| 5 | CALL_GLUE | OTHER | 13 | 4 | 15.0 | 6.5% | `unmapped+0x00966aec` |
| 6 | TEXEL_FETCH | ARITH | 10 | 1 | 14.4 | 6.2% | `ref_soft+0x10011e94` |
| 7 | CARRY_STRIDE | ARITH | 9 | 1 | 14.1 | 6.1% | `ref_soft+0x10011e94` |
| 8 | MEMCOPY | MEM | 9 | 2 | 13.5 | 5.8% | `mech3demo+0x00515a9c` |
| 9 | STRSEARCH | MEM | 8 | 1 | 12.9 | 5.6% | `gta2+0x004ef949` |
| 10 | X87 | OTHER | 9 | 2 | 12.6 | 5.4% | `mech3demo+0x0051579f` |
| 11 | FIELD_REPACK | ARITH | 6 | 3 | 9.6 | 4.1% | `ref_soft+0x10012570` |
| 12 | DOT3 | ARITH | 7 | 2 | 8.1 | 3.5% | `mech3demo+0x0051b0be` |
| 13 | RLE_TOKEN | STREAM | 2 | 1 | 7.6 | 3.3% | `H2DEMOW+0x004c7341` |
| 14 | LUT_XLAT | ARITH | 5 | 3 | 7.1 | 3.0% | `H2DEMOW+0x004c7558` |
| 15 | FTOL | OTHER | 6 | 2 | 6.7 | 2.9% | `mech3demo+0x0051b0be` |
| 16 | PERSP_DIV | ARITH | 4 | 2 | 6.7 | 2.9% | `mech3demo+0x004fd394` |
| 17 | FIXPT_STEP | ARITH | 1 | 1 | 5.3 | 2.3% | `ref_soft+0x10012570` |
| 18 | BYTE_PACK | ARITH | 2 | 2 | 5.3 | 2.3% | `H2DEMOW+0x00499937` |
| 19 | FIXPT_MUL | ARITH | 4 | 2 | 4.1 | 1.8% | `ref_soft+0x1001212f` |
| 20 | IO_POLL | OTHER | 2 | 1 | 3.3 | 1.4% | `MSS32+0x2000da61` |

Class rollup: **OTHER 45.9%, ARITH 29.5%, MEM 21.4%, STREAM 3.3%**.

Measured ALU-op coverage (125 of 125 read loops matched, 609.9M entry-weighted ALU
instructions): **top 5 ARITH families 66.3%, top 10 72.6%, top 20 72.6%**. That
number is *not* comparable to section 4's 31.8% and must not be quoted as an
improvement: the denominator is entry-weighted across windows whose absolute sizes
differ by 48x, and quake2-gameplay (2.98 billion retired ops, all of it one span
loop) supplies most of it — CARRY_STRIDE alone is 34.6% and FIXPT_STEP 16.4%, both
one app. It is one app's renderer measured against five apps' arithmetic.

### Family table, loading windows only

200 loops, 8 apps, Σshare 541 points.

| # | family | class | loops | apps | Σshare | %of-slice | example |
|---|---|---|---|---|---|---|---|
| 1 | MEMFILL | MEM | 11 | 6 | 96.2 | 17.8% | `gta2+0x00419cf6` |
| 2 | COUNTER | OTHER | 37 | 7 | 78.6 | 14.5% | `c3+0x00417204` |
| 3 | RLE_TOKEN | STREAM | 14 | 4 | 65.8 | 12.2% | `storm+0x1501d0b5` |
| 4 | BLEND (SWAR) | ARITH | 2 | 1 | 59.3 | 10.9% | `mech3demo+0x00526f54` |
| 5 | TABLE_DECODE | STREAM | 18 | 1 | 46.7 | 8.6% | `smackw32+0x1000efad` |
| 6 | FIELD_REPACK | ARITH | 13 | 5 | 38.1 | 7.0% | `c3+0x004a3ecf` |
| 7 | CALL_GLUE | OTHER | 23 | 6 | 36.8 | 6.8% | `gta2+0x005c9fcc` |
| 8 | CMP_SKIP | OTHER | 23 | 7 | 36.6 | 6.8% | `c3+0x004a3ec1` |
| 9 | ADDR_SCALE | ARITH | 19 | 5 | 24.4 | 4.5% | `H2DEMOW+0x00499937` |
| 10 | GETBITS | STREAM | 9 | 2 | 23.6 | 4.4% | `smackw32+0x1000efad` |
| 11 | LUT_XLAT | ARITH | 13 | 3 | 20.3 | 3.7% | `ref_soft+0x10005a0f` |
| 12 | IO_POLL | OTHER | 9 | 3 | 17.4 | 3.2% | `MSS32+0x2000da61` |
| 13 | MEMCOPY | MEM | 16 | 4 | 16.9 | 3.1% | `c3+0x0049e9db` |
| 14 | REFILL | STREAM | 7 | 2 | 16.6 | 3.1% | `smackw32+0x1000ef03` |
| 15 | FIXPT_STEP | ARITH | 2 | 1 | 10.1 | 1.9% | `quake2+0x00426313` |
| 16 | BYTE_PACK | ARITH | 2 | 2 | 10.0 | 1.8% | `H2DEMOW+0x00499937` |
| 17 | FTOL | OTHER | 1 | 1 | 6.6 | 1.2% | `gta2+0x005deb40` |
| 18 | X87 | OTHER | 2 | 1 | 6.3 | 1.2% | `gta2+0x005c9fcc` |
| 19 | CRC_STEP | STREAM | 5 | 3 | 5.0 | 0.9% | `H2DEMOW+0x004976d8` |
| 20 | STRSEARCH | MEM | 4 | 2 | 2.8 | 0.5% | `quake2+0x00423564` |

Class rollup: **OTHER 31.7%, ARITH 27.3%, STREAM 23.2%, MEM 17.9%**. Measured
ALU-op coverage (200 of 200 matched, 1.94G entry-weighted ALU instructions): **top
5 ARITH families 38.0%, top 10 38.3%, top 20 38.3%** — and 20.8 of those points are
mw3's SWAR blend, one app again.

Two corrections to section 4 fall straight out of the split:

- **MW3's SWAR blend is a loading loop, not a renderer loop.**
  `mech3demo+0x00526f54` (31.10%) and `0x00527075` (28.17%) are ranks 1 and 2 of
  mw3-loading — 59.3% of that window — and **neither address appears anywhere in the
  mw3-gameplay hot-block dump**. Section 4 calls the same pair 93.1% of "mw3long"
  and reads it as MW3's renderer. It is the pre-mission screens. The whole
  SWAR/blend fold family is worth nothing inside the cockpit.
- **Quake II's `D_DrawSpans8` is ~7x what section 4 measured.** Its exemplar block
  is listed there at 1.0% and the family at 3.0%; in gameplay that block is 2.72%
  and the same unrolled loop occupies eleven ranked blocks totalling ~17 points,
  with its x87 setup adding ~5 more. Section 4's low number is an artifact of
  measuring during the map load *and* of the per-block split hiding one loop behind
  eleven addresses. Conversely, section 4's headline FIXPT_STEP exemplar
  (`quake2+0x00426313`) is a **sound resampler** that does not survive into gameplay
  at all.

Two families gain the Win98 instances they lacked: `CRC_STEP` now has Quake II's
MD4 `Com_BlockChecksum` (three rounds, 1.7% of its loading window), Storm's MPQ
stream cipher (1.12% of starcraft-loading) and Heroes II's two-accumulator rolling
checksum (2.16% of heroes2-loading).

### Where each gameplay window's weight actually goes

Share points of the window, as a percentage of that window's hand-read top-25
weight. (a) already-folded idioms, (b) generic C logic with globals/stack slots
reloaded per iteration, (c) arithmetic expression trees, (d) stream/decompression
idioms, (e) polling, glue, counters and x87/CRT library calls.

| gameplay window | top-25 covers | (a) folded | (b) generic C | (c) arith trees | (d) stream | (e) poll/glue |
|---|---|---|---|---|---|---|
| quake2 | 36.0% | **0%** | 6% | **88%** | 0% | 6% |
| mw3 | 30.9% | **0%** | 27% | **70%** | 0% | 3% |
| gta2 | 34.4% | **0%** | **62%** | 10% | 0% | 28% |
| rct | 85.4% | **0%** | **95%** | 4% | 0% | 1% |
| heroes2 | 45.3% | 13% | 14% | 29% | 17% | 27% |

| loading window | top-25 covers | (a) folded | (b) generic C | (c) arith trees | (d) stream | (e) poll/glue |
|---|---|---|---|---|---|---|
| quake2 | 62.3% | 22% | 4% | 32% | 25% | 17% |
| mw3 | 77.1% | 2% | 1% | **90%** | 0% | 9% |
| gta2 | 93.9% | 0.3% | **75%** | 6% | 0% | 19% |
| rct | 36.8% | 6% | 7% | 8% | **65%** | 14% |
| heroes2 | 55.9% | 6% | 10% | 14% | 13% | **57%** |
| caesar3 | 83.8% | 0% | 24% | 27% | 9% | **40%** |
| starcraft | 58.6% | 0% | 0% | 4% | **87%** | 9% |
| diablo | 73.1% | 12% | 39% | 0% | **46%** | 3% |

Column (a) is charged generously — anything `rep movs`/`rep stos`-shaped is counted
as already handled. The **handler histogram is harsher and is the number to quote**:
rolling up the printed top-24 handlers of every window, the four whole-loop folds
(`$th_lut_run` H418, `$th_copy_run` H419, `$th_rect_run` H427, `$th_rle_run` H429)
are **0.0% of every one of the thirteen windows** — each sits below the window's
24th-rank cut, which ranges 0.41%-1.52%. Not one of the five gameplay windows is
running a fold at all.

| window | x87 | folds (418/419/427/429) | `*_run` handlers | branch | top-24 covers | 24th-rank cut |
|---|---|---|---|---|---|---|
| quake2-gameplay | 18.1% | 0.0% | 1.2% | 4.4% | 70.0% | 1.20% |
| mw3-gameplay | 38.6% | 0.0% | 1.1% | 3.8% | 74.0% | 1.11% |
| gta2-gameplay | 31.8% | 0.0% | 0.0% | 4.8% | 70.8% | 1.18% |
| rct-gameplay | 0.0% | 0.0% | 0.0% | 32.5% | 90.5% | 0.41% |
| heroes2-gameplay | 0.0% | 0.0% | 3.7% | 11.8% | 62.3% | 1.25% |
| quake2-loading | 0.0% | 0.0% | 1.7% | 6.0% | 67.0% | 1.52% |
| mw3-loading | 0.0% | 0.0% | 0.0% | 4.2% | 86.1% | 0.82% |
| gta2-loading | 0.6% | 0.0% | 0.0% | 3.1% | 89.7% | 0.43% |
| rct-loading | 0.0% | 0.0% | 0.0% | 16.3% | 63.8% | 1.21% |
| heroes2-loading | 0.0% | 0.0% | 5.8% | 11.1% | 65.6% | 1.28% |
| caesar3-loading | 0.0% | 0.0% | 0.0% | 12.7% | 90.1% | 0.92% |
| starcraft-loading | 0.0% | 0.0% | 0.0% | 4.4% | 78.7% | 1.17% |
| diablo-loading | 0.0% | 0.0% | 0.0% | 9.5% | 73.2% | 1.37% |

The x87 column is the other structural finding: **3D gameplay is 18-39% x87
dispatches, and every loading window is 0.0-0.6%.** No integer-tree vocabulary
touches those ops, and section 4 could not see them because none of its six windows
was inside a 3D renderer.

### Section 8's method applied to all thirteen windows

| window | covered | loads/ops | redundant | store→load | reg moves | **removable** |
|---|---|---|---|---|---|---|
| quake2-gameplay | 36.0% | 29.7% | 12.6% | 2.3% | 4.4% | **19.3%** |
| mw3-gameplay | 30.9% | 16.2% | 0.5% | 2.6% | 2.5% | **5.6%** |
| gta2-gameplay | 34.4% | 16.1% | 0.4% | 1.2% | 1.8% | **3.4%** |
| rct-gameplay | 85.4% | 18.4% | 0.5% | 0.0% | 0.3% | **0.7%** |
| heroes2-gameplay | 45.3% | 31.5% | 4.4% | 0.0% | 4.4% | **8.8%** |
| quake2-loading | 62.3% | 21.7% | 0.0% | 0.1% | 12.2% | **12.3%** |
| mw3-loading | 77.1% | 28.8% | 5.2% | 0.0% | 12.6% | **17.8%** |
| gta2-loading | 93.9% | 31.8% | 0.0% | 0.9% | 1.1% | **2.0%** |
| rct-loading | 36.8% | 26.0% | 3.2% | 0.0% | 2.4% | **5.6%** |
| heroes2-loading | 55.8% | 35.7% | 6.2% | 0.4% | 2.1% | **8.7%** |
| caesar3-loading | 83.7% | 20.1% | 1.0% | 0.7% | 2.7% | **4.4%** |
| starcraft-loading | 58.6% | 26.6% | 0.0% | 0.0% | 3.5% | **3.5%** |
| diablo-loading | 73.1% | 22.8% | 0.0% | 1.7% | 2.9% | **4.5%** |

Raw per-loop counts: [`load-census-4b.json`](hot-loop-vocabulary-2026-09/load-census-4b.json).

Range 0.7%-19.3%, mean ≈ 8% — the same band section 8 found, now including
gameplay. **The single largest removable share in the entire study is a gameplay
window**: quake2-gameplay at 19.3%, 12.6 points of it redundant loads, because the
unrolled span loop re-reads its DDA accumulators from module globals between
bodies. rct-gameplay is the counter-example at 0.7% — its 57% memset has almost
nothing to delete *inside* a block, because the redundancy is the `[ebp-8]`
round-trip across a two-block loop, which needs a cross-block window this census
does not model.

### Does the section 9 decision change?

**No, and the gameplay data strengthens every one of its four reasons.**

1. *Concentration.* Still one app per family, and now demonstrably one *window* per
   family: BLEND is 100% mw3-loading and absent from mw3-gameplay; CARRY_STRIDE and
   TEXEL_FETCH are 100% quake2-gameplay; TABLE_DECODE/GETBITS/REFILL are 100%
   starcraft-loading. The gameplay slice's 66.3% top-5 ALU coverage is one
   renderer's span loop; strip quake2 and the arithmetic vocabulary covers well
   under 10% of what the other four gameplay windows execute.
2. *A family is not a tree.* Unchanged, and worse: `ADDR_SCALE` is the only family
   present in all five gameplay apps (27.0 points, 19 loops) and those 19 loops are
   a palette byte-pack, a `row*stride*12` cell address, a struct-member indexed
   getter and a vertex-array stride — four unrelated trees under one tag.
3. *Tree shape merges semantics.* Unchanged.
4. *The denominator is mostly not arithmetic.* Now measured from inside gameplay:
   the two *largest* gameplay windows by read weight are rct (95% generic C logic
   with memory-resident induction variables, 32.5% of dispatches branches) and gta2
   (62% generic C plus 28% glue, ~6% of it emulator thunk landings). Add 18-39% x87
   in the three 3D gameplay windows and the arithmetic-tree vocabulary is aimed at a
   minority of what a running game executes.

One item on the build list gains evidence and one loses it. **The generic load/op
split gains**: its best case in the whole study is now a gameplay window (19.3%),
and the shapes it targets — accumulators respilled to globals between unrolled
bodies, induction variables round-tripped through `[ebp-8]` — are exactly what the
gameplay windows are made of. **The five stream uops lose ground for gameplay
specifically**: they are 25-87% of five loading windows and 0% of four of the five
gameplay windows (heroes2's 17% is the exception), so they should be justified as
*load-time* accelerators — which is a real and defensible claim, since loading is
where a user waits — and never as a frame-rate argument.

Two new observations that section 9 did not have:

- **The existing whole-loop folds fire in none of these windows.** H418/419/427/429
  are below the 24th-rank cut everywhere. Whatever the next fold is, the evidence
  here says the ones already built do not reach real gameplay, which is the
  strongest available argument against building more of the same kind.
- **rct-gameplay is the shape the matcher is structurally blind to.** A 57%-of-window
  memset whose counter lives in `[ebp-8]` and whose body is a second block cannot be
  seen by `$loop_match_block` at all, because that only ever runs on blocks that
  branch to *themselves*. The same blindness hides RCT's colour-keyed LUT blit
  (section 19 of the superops design) in its loading window. Multi-block loop
  recognition, not a bigger arithmetic vocabulary, is where the unclaimed weight is.

## 4c. The x87 half of those windows, and what the x87 fold already takes

Section 4b left 3D gameplay sitting at 18-39% x87 dispatches and stopped there.
The obvious next question is not "should something fold x87" — something already
does. H449-H453 (`$x87_pipeline4`, `$x87_tree4`, `$x87_island`,
`$x87_affine_prepare/finish`, all in
[`src/07b-loop-match.wat`](../src/07b-loop-match.wat), designed in
[tree-fold-design-a.md §13](tree-fold-design-a.md)) have existed since
2026-09-12. The question is how much of *this* work they catch, and what stops
them on the rest.

Collected by
[`collect-win98-x87-4c.sh`](hot-loop-vocabulary-2026-09/collect-win98-x87-4c.sh);
per-window logs, hot-block dumps, disassemblies and classifications under
[`win98/<app>-gameplay-x87/`](hot-loop-vocabulary-2026-09/win98/).

**The first finding is that none of the earlier headless numbers measured the
fold at all.** The families are gated on `$x87_pipeline4_emit_enabled` /
`$x87_affine_emit_enabled`, and until this commit the only thing that set either
was `window.WineSuperops.x87Fusion` in `host.js` — `test/run.js` never called
the exports. So every CLI run in this study, §13's coverage table included, was
made with the emit gate off. `--x87-fusion` is the one tool change this section
needed; `--handler-hist` also prints a named `x87:` line now, because a fused
family is not in the top-24 cut and the residue is the whole measurement.

### What the fold catches, measured

Each window run twice over the *same* batch range, `--x87-fusion` off then on.
A fused family retires one dispatch for a whole region, so the two columns below
are not comparable as work — the number that is, is how far raw x87 fell.

| window (batches) | dispatches off → on | raw x87 off | raw x87 on | fused | **x87 ops absorbed** |
|---|---|---|---|---|---|
| quake2-gameplay 4000-5000 | 158,252,322 → 137,767,321 (**−12.9%**) | 26,429,136 (16.70%) | 3,986,432 (2.89%) | 1,957,711 | 22,442,704 = **84.9%** |
| mw3-gameplay 920-1000 | 95,909,589 → 71,239,745 (**−25.7%**) | 34,746,675 (36.23%) | 7,618,461 (10.69%) | 2,251,972 | 27,128,214 = **78.1%** |
| gta2-gameplay 4500-5200 | 15,559,743 → 12,014,061 (**−22.8%**) | 4,349,699 (27.95%) | 499,385 (4.16%) | 304,632 | 3,850,314 = **88.5%** |
| heroes2-gameplay 1500-2200 | 53,563,890 | **0 (0.00%)** | — | — | nothing to catch |

So the answer to the section's question is **78-89% already**, in every window
that has any x87 at all. heroes2 is the control and prints an exact zero, which
is the same answer §13's census gave from the other side.

Two of the five families are **dead in all four windows**: `$x87_tree4` (H450)
and the affine pair (H452/H453) matched zero blocks anywhere. H451, the generic
island — a maximal run of three or more consecutive H188/H189/H190 — is 98% of
everything caught; H449 is the rest. The two shape-specific families are
carrying nothing here.

**And the dispatch saving is not a time saving.** Interleaved A/B, three pairs
each, user CPU for identical work:

| window | off (user s) | on (user s) | paired deltas |
|---|---|---|---|
| quake2 | 22.39 / 21.53 / 20.48 | 21.40 / 20.68 / 20.92 | −4.4%, −3.9%, **+2.1%** |
| gta2 | 20.49 / 16.03 / 15.53 | 18.77 / 14.95 / 15.76 | −8.4%, −6.7%, **+1.5%** |
| mw3 | 92.44 / 84.82 | 85.92 / 123.36 | −7.1%, **+45.4%** |

quake2 turns a 12.9% dispatch cut into roughly −2% ± 3%, and mw3's pairs do not
agree with each other at all (its route contains `wait-canvas-dark-pixels`, so
the guest work itself moves between runs; its API count moved by 0.4% across the
pair). The box sat at load 7-27 throughout. **Quote the dispatch column, not the
CPU column** — the honest statement is that the x87 fold removes a fifth of the
dispatches in a 3D window and no measurable wall time on this machine, which is
the same lesson `$next` dispatch counting taught in
[interpreter-dispatch-perf.md](interpreter-dispatch-perf.md).

### What declines the rest

`x87-classify.js` takes the fold-off hot-block dump, disassembles the top 120
blocks out of the PE (`tools/hot-loop-corpus.js`), and applies the island's own
rule to each — a run of three, no SIB-addressed H188 after the first op — so a
decline is charged to the instruction that broke the run, weighted by block
entries. It is static and covers 72% (quake2) / 81% (mw3) / 9% (gta2) of each
window's measured x87 stream; gta2's x87 is spread far past rank 120, so read
its shares and not its totals.

| window | x87-carrying blocks | x87 dispatches seen | caught | declined: interleaved integer op | declined: `fnstsw ax` | other |
|---|---|---|---|---|---|---|
| quake2 | 45 / 120 | 19,027,162 | **92.0%** | 8.0% | 0.0% | 0 |
| mw3 | 68 / 120 | 28,050,272 | **87.8%** | 5.6% | **6.6%** | 0 |
| gta2 | 19 / 120 | 403,181 | **78.0%** | **21.9%** | 0.0% | block end 0.1% |

The instruction that actually broke each declined run, as a share of that
window's x87:

| window | top breakers |
|---|---|
| quake2 | `mov` 6.0%, `add` 1.5%, `sub` 0.4%, `movsx` 0.1%, `test` 0.1% |
| mw3 | `fnstsw` 6.6%, `mov` 1.3%, `add` 1.1%, `test` 0.6%, `shl` 0.6%, `push` 0.5%, `sub` 0.5%, `lea` 0.5%, `call` 0.3% |
| gta2 | `mov` 10.7%, `push` 3.4%, `call` 2.0%, `add` 1.7%, `sar` 1.3%, `shl` 1.3%, `xor` 1.1% |

Two named declines from §13 turn out not to occur in gameplay at all. **No x87
op in quake2's or gta2's hot blocks uses a SIB operand**, and mw3's 309,580 that
do are all the *first* op of their run, where the rule allows them — the
`sib-operand` bucket is empty in all three. Nothing was declined for an
unimplemented x87 op either. `fstp` to memory, `fild`/`fistp` and `fxch` chains
are all inside the accepted set and are caught wherever they are contiguous.

One correction to make before reading the quake2 row: `0x9B` (FWAIT) emits *no*
threaded op, and `tools/disasm.js` prints it as `db 0x9b`. Counting it as an
integer instruction charges a false decline to every MSVC `_ftol` in the corpus
— 182,194 entries of quake2's alone — so the classifier treats it as x87
whitespace, which is what the decoder does.

### The top x87-carrying blocks, and the expression each computes

quake2, `ref_soft.dll` (runtime base `0xd7e000`, orig `0x10000000`):

| block | entries | x87 ops | expression | straight-line tree? |
|---|---|---|---|---|
| `+0x10011c3b` | 78,197 | 29, one run | span texture setup: `fild u,v`, times the six s/t axis constants, plus offsets, then `fdivr` — the **perspective divide** | yes, whole block |
| `+0x10012b34` | 46,062 | 37, one run | world→view: `v − vieworg` then three **dot3** against vright/vup/vpn, closed by a `fcom` near-clip test | yes |
| `+0x10002b73` | 31,783 | 45 in two runs | same transform, second half | yes |
| `+0x10011cd1`, `+0x10011deb`, `+0x100120bd`, `+0x10011d40` | 39k-89k each | 7-23 | **s/t → fixed-point cursor**: `fld st(0)` / `fmul st,st(4)` / `fmul st,st(3)` / two `fistp`, then the integer span walk reads them back | yes for the x87, but the block continues in integers |
| `+0x10002a93` | 31,550 | 26 in runs of 2 | two RGB byte triples → float **through `[ebp-8]`**, scaled by six constants, summed, biased, `fstp`ed | no — `mov bl,[esi+n]` / `mov [ebp-8],ebx` between every pair |
| `+0x10014590` | 182,194 | 4 | MSVC **`_ftol`**: `fnstcw` / `or ah,0xc` / `fldcw` / `fistp` / `fldcw` | no — the control-word edit is integer |
| `+0x100124d9` | 70,683 | 9 in runs of 2-5 | span clip: `fild`×2, two `fmul`, `fadd`, `fcom`, with `imul`/`add` address math **scheduled between** the x87 ops | no |

mw3, `mech3demo.exe` (no relocation, runtime VA == orig VA):

| block | entries | x87 ops | expression | straight-line tree? |
|---|---|---|---|---|
| `+0x0051579f` | 80,864 | 36, one run | **3x3 matrix × vec3**: six `fld`/`fmul` pairs then an `fxch`/`faddp` reduction — the island's best case in the corpus | yes, whole block |
| `+0x00515ad8` | 57,732 | 48 in four runs | the same inlined again, four vertices | yes |
| `+0x004fd394`, `+0x004fd390` | 121,278 / 32,780 | 17 | **perspective divide** `1/z`, preceded by two x87 ops the integer setup splits off | yes apart from those two |
| `+0x0051b0be`, `+0x0051b3ed` | ~50k each | 28, one run | **dot3 clip rows** | yes |
| `+0x0051bc31`, `+0x0051bc4d`, `+0x0051bc62`, `+0x0051bcaa`, `+0x0051bcbf` | ~101k each | 2 | **float bounds test**: `fld [ecx]` / `fcomp const` / `fnstsw ax` / `test ah,imm` / `jcc` — five consecutive 5-7 op blocks, one per clip plane | it is a whole block, and it is four ops long |

gta2, `gta2.exe`: `+0x004e30a0` (5,427 entries) is `fild [esp+0x10]` / `fmul
const` / `fstp [eax+0x6e6a90]` with `sar`/`add`/`shl` address arithmetic
**interleaved between** the three x87 ops — the Pentium U/V-pipe scheduling the
compiler did on purpose, which is exactly what breaks a contiguity rule.

### The missing roles, ranked by the x87 dispatches each would unlock

1. **An integer op inside the x87 region.** quake2 8.0%, mw3 5.6%, gta2 21.9% of
   their x87 streams; it is the *only* decline in quake2 and gta2. Every instance
   is a pointer bump, an address computation, or an int↔float trip through a
   stack slot sitting between two x87 ops. This is precisely the mixed
   integer+x87 micro-op region [tree-fold-design-a.md §13](tree-fold-design-a.md)
   designed and implemented as `TU_X87_MEM`/`MRO`/`REG`/`SW_AX`.
2. **`fcomp` + `fnstsw ax` + `test ah` + `jcc` as a foldable terminator.** mw3
   6.6%, everyone else ~0. Note the shape: these are not long blocks with a
   compare in them, they are entire 5-7 op *blocks* entered ~100,000 times each.
   Folding the four ops saves three dispatches out of five and leaves the block
   transfer, which is the larger cost.
3. **A run of two.** Dropping the island's floor from 3 to 2 would take about
   half of bucket 1 by itself, for one constant.
4. **SIB operands, unimplemented x87 ops, `fxch` chains, `fstp` to memory.**
   Zero declines between them, in all three windows. Nothing to build.

### Recommendation

**Do not widen the x87 grammar; widen what is allowed to contain x87.** The fold
already takes 78-89% of the x87 stream, and the entire residue is worth at most
another 1-5% of window dispatches — on a lever whose 13-26% has already been
shown to buy no measurable CPU. The number that matters is on the other side of
the same wall: `src/07c-block-exec.wat` declines **any** block containing
H188-H190 outright (its own comment marks this OPEN-6), and x87-carrying blocks
are **23.0% of quake2's retired guest ops, 39.5% of mw3's and 7.9% of gta2's**.
So in a 3D app the integer half of a third of the work is excluded from the
block executor *because* an x87 instruction stands next to it — which is the
same barrier §13 named, one level up: the cost is an integer barrier that
happens to be standing beside an x87 op. Widening the block executor to the x87
micro-op kinds resolves declines 1, 2 and 3 above as a side effect, since a
block executor does not care whether its micro-ops are contiguous. That is one
change worth three, and it is worth more than any amount of further x87
vocabulary.

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

# Win98 section 4b: the gameplay and loading windows
bash docs/hot-loop-vocabulary-2026-09/collect-win98-gameplay.sh
bash docs/hot-loop-vocabulary-2026-09/disasm-win98-gameplay.sh

# DOS: the whole /tmp/demos corpus, five at a time, 60s each
node tools/hot-loop-corpus.js dos-sweep --root=/tmp/demos --jobs=5 --secs=60 \
  --top=40 --out=DIR

# cross-checks and rankings
node tools/hot-loop-corpus.js dos-summary  --out=DIR
node tools/hot-loop-corpus.js load-census  --out=DIR
node tools/hot-loop-corpus.js aggregate    --out=DIR --read=DIR/.. \
  --dos=DIR --win=DIR

# the two section-4b slices, from the same data directory
node tools/hot-loop-corpus.js aggregate --read=DIR --win=DIR --out=TMP \
  --slices='win98-gameplay'
node tools/hot-loop-corpus.js aggregate --read=DIR --win=DIR --out=TMP \
  --slices='win98-loading'
```

The full aggregate output as run is
[`aggregate.out`](hot-loop-vocabulary-2026-09/aggregate.out), with the two slices in
[`aggregate-gameplay.out`](hot-loop-vocabulary-2026-09/aggregate-gameplay.out) and
[`aggregate-loading.out`](hot-loop-vocabulary-2026-09/aggregate-loading.out); the
per-loop rows, with every tree, are in the `read-*.tsv` files beside them.

`aggregate.out` is the run that produced sections 4-9 and predates section 4b, so a
slice-less re-run now folds the 325 gameplay/loading rows into the same win98
totals and will not reproduce it. Pass `--slices='win98$'` to get the original six
windows back on their own.
