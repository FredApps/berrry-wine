# Hot-idiom census across five apps (2026-09-19)

Question: which interpreter idioms are hot in *every* app, so that a fixed
build-time handler (no runtime codegen) pays across the corpus rather than
in one title. Method: `test/run.js --handler-hist --handler-hist-thread=0,0,0,0,0
--handler-hist-start=A --handler-hist-stop=B --hist-json=F` gives five
consecutive windows from one gameplay run (JSON per window, named
`F.T0.<start>`), `tools/hot-loop-census.js` groups the hot blocks, and the
`top pairs` list (now `--handler-hist-pairs=N`, default 12) names the
unfused handler pairs. Counts are load-immune, so the quiet box and this Mac
agree exactly; the windows are byte-deterministic (Diablo's four idle windows
retired 95,983,584 block entries each).

Routes: StarCraft and Heroes II are the benchmark routes in
`docs/re-notes/starcraft-shareware.md` / `heroes2-demo.md`; Diablo the
`project_diablo_gameplay` route to town; Caesar III the retry loop of
`test/test-caesar3-gameplay.js` driven over `--control-stdin` (its stdout
teed, because the control session swallows non-`[ctl]` lines); SimGolf runs
headless only with `--headless-gl` **on this Mac** (the box has no GL, the
game shows "Can't Create A GL Rendering Context" and its windows are a modal
box). Every window was gated with a PNG of the scene.

## Windows (window 3 of 5, `--batch-size=100000`, 240-500 batches)

| app | ops | block entries | ops/block | distinct blocks |
|---|---|---|---|---|
| StarCraft (gameplay) | 727.6M | 144.7M | 5.02 | 9160 |
| Heroes II (adventure map) | 31.3M | 7.5M | 4.16 | 1080 |
| Diablo (town, idle) | 307.4M | 96.0M | 3.20 | 1265 |
| Caesar III (city, idle) | 38.7M | 9.5M | 4.08 | 1984 |
| SimGolf (course UI) | 93.9M | 25.4M | 3.70 | 1903 |

## Where the block entries go (mean of five windows; spread in brackets)

| app | region | share | what it is |
|---|---|---|---|
| StarCraft | storm+0x15024f12 (#437) | 25.8% [1.7pp] | dirty-tile span-list builder |
| StarCraft | storm+0x15024511 (#432) | 12.0% [0.7pp] | span copy |
| Heroes II | exe+0x4c7260..4c7746 | 29.0% [0.1pp] | ICN sprite RLE decoder: token byte at `[0x525d80]++`, bit 7 / bit 6 select copy / skip / fill, count in the low 6 bits |
| Heroes II | exe+0x478977..478efc, 0x47123a, 0x4d35f0 | 8.6 / 7.4 / 6.6% | game logic; mss32 5.5% (Miles mixer) |
| Diablo | exe+0x45d8ef..45dba6 | 40.3% [8.2pp] | CEL solid-block path: 8-dword row copies at stride 0x320 |
| Diablo | exe+0x460f0b..461184 | 36.1% [0.9pp] | CEL line decoder: signed token, positive = copy N via a 1/2/4-byte `shr ecx,1 / jnb` ladder with a clip test, negative = skip |
| Caesar III | exe+0x4a2cae..4a323a | 16.5% [0.1pp] | per-frame game logic |
| Caesar III | exe+0x40f6d9..40fb79 | 19.9% | the RLE sprite ladder (`RLE_RUN` H424 already folds its literal bodies) |
| Caesar III | exe+0x428eb1, 0x42cb3b, 0x42d0f7 | 10.3 / 10.0 / 8.3% | game logic |
| SimGolf | exe+0x42c2d0..42c3b2 | 32.7% [16.9pp] | a 50x50 grid-cell lookup **leaf function** called per cell: 8 blocks of bounds checks and one table read, no loop |
| SimGolf | exe+0x40a260..40a2c6 | 13.3% [7.6pp] | sibling leaf |

Four of the five spend 20-40% of their block entries in a byte-token RLE
sprite/span decoder nest, and every one encodes its tokens differently
(Storm's span list, Heroes' bit-6/bit-7 tokens, Diablo's signed byte,
Caesar's compare ladder). There is no single nest fold to build; what these
nests share is their *inner* idioms, which is what the pair histogram sees.
SimGolf is the odd one out: no loop at all, a hot leaf called through
`call`/`ret` with three pushes and three pops per visit.

## Unfused idiom families (share of dispatches, window 3, top-40 pairs)

| app | cmp/test + Jcc | token fetch | push/pop runs |
|---|---|---|---|
| StarCraft | 4.3 | 5.2 | 1.0 |
| Heroes II | 5.6 | 2.9 | 5.2 |
| Diablo | 12.3 | 12.1 | 0.9 |
| Caesar III | 7.2 | 3.8 | 1.1 |
| SimGolf | 14.5 | 0 | 16.6 |

- **cmp/test + Jcc** is hot everywhere. `test r,r + Jcc` is already one handler
  (H404, 2-7.5% on its own); `cmp r,imm + Jcc` (H10->H31x/H320: SimGolf 8.4%,
  Caesar 3.8%, Diablo 1.8%), `cmp r,r + Jcc` (H19: StarCraft 2.4%, Heroes
  1.7%), `cmp r,[mem] + Jcc` (H48->H309 Diablo 4.2%), `shr r,1 + jnb`
  (H53->H310/H311 Diablo 6.3%), `cmp [mem],imm + Jcc` (H51: Caesar 3.4%),
  `test r16,r16 / test r8,imm / dec [mem] + Jcc` (SimGolf 3.1%, StarCraft
  1.2%, Heroes 1.6%) are all still two dispatches with the flags
  materialised in between.
- **Token fetch** is the RLE decoders' `xor eax,eax / mov al,[esi] / inc esi /
  test al,al / js`: H18->H28 (or ->H24/->H403/->H166) 1-3.5% in four apps,
  H28->H64 1.3-4.5%, H64->H404 4.1% in Diablo. A `movzx`-style
  zero-then-load8 handler and a load8+inc handler cover it.
- **push/pop runs** matter in the call-heavy apps only: SimGolf 16.6% (three
  pushes, three pops, pop+ret, push+call), Heroes 5.2%.

## What to build, and what not

1. A decoder fusion for `cmp/test + Jcc` in the forms above, mirroring how
   `$th_test_jcc` (H404) was done: removes 4-15% of dispatches in every app.
2. `xor r,r ; load8` and `load8 ; inc` fusions: 3-12% of dispatches in the
   four sprite-decoding apps.
3. Multi-push / multi-pop(+ret) handlers: worth it for SimGolf and Heroes
   only; third.

Not: another one-app nest fold before (1)-(2) exist, because the nests do not
share an encoding. Estimate before measuring: a dispatch is ~8ns
(`bench-loops.js`), and dispatch replication showed the whole
per-dispatch tail is worth ~5% of CPU, so removing 10% of dispatches is a
few percent, not ten. Measure each on the quiet box with a null arm
(`gameplay-ab-flags.js`), StarCraft and SimGolf both, before landing.

Raw data: `census2/` on the box (`~/wa-bench/census2`), logs with the
40-row pair lists, the per-window JSON, and the gate PNGs.

## Outcome of recommendation (1) — 2026-09-19, same day

Built and measured: `cmp r32,r32 / cmp r32,imm32 + Jcc` as handler 469.
**Neutral on the quiet box** with a null arm (StarCraft +1.3% in a 1.4%
band, Heroes II −0.3% in 0.8%, Diablo −1.6% vs null in 3.3%; retired
instructions moved ≤0.5%). A first layout that broke `$decode_run`'s
fall-through chains was measurably *slower* on all three. The fusion, its
test and the full write-up are on branch `cmpjcc-fusion`
(`docs/cmp-jcc-fusion-2026-09-19.md` there); nothing landed on main.

What it changes above: a fusion that only removes a dispatch is below what
the box can resolve, so (1)'s remaining forms are closed, and (2) and (3)
must be estimated against "does it delete memory traffic or a block
transfer" before being built. The oracle also showed StarCraft's 2000-batch
headless route is **not** self-deterministic (base vs base: 5,631 px, ~4k
API calls), so use Heroes II, Diablo or SimGolf as the picture oracle.
