# Glide 3 acceptance and real-game readbacks

Measured 2026-09-29 on the reserved remote box, Chrome 152, four CPU cores,
ANGLE SwiftShader. Browser measurements were headful; pass/fail acceptance
also used headless Chrome. These results establish correctness and transfer
counts. They are **not hardware-GPU speed measurements**.

## Glide 3 and corpus

The original Diablo II demo's `d2glide.dll` passed menu, character creation,
Rogue Encampment and normal-input movement on both the WebGL and native WAT
software backends, through the shared render worker. Both gameplay captures
were inspected. Software needed independent RGB/alpha clear masks, now
implemented in the native rasterizer and regression-tested.

Glide 2/3 ABI, DLL-scoped import resolution, shared-worker ordering,
software rasterization, readback counters, and browser WebGL1/WebGL2 gamma
tests passed remotely. The complete build passed without gate exclusions.

The corpus adds explicit Diablo II, Hitman Demo 2 and Hype Glide entries.
Hitman and Hype remain experimental; their original installer layouts and
reproducible preparation command are in [the corpus inventory](glide3-corpus.md).

## What the games actually read

No screenshot polling runs inside the measured intervals. Backend counters
count actual `readPixels` calls; optional WAT counters identify the initiating
Glide LFB API. Software presentation copies are separate CPU counters.

| Game / renderer | Measured presents or swaps | GPU readbacks during interval | Observation |
| --- | ---: | ---: | --- |
| Diablo II / Glide 3 | 535 in 20.13 s | 0 | Normal movement followed by a live world interval |
| NFS II SE / Glide 2 | 173 in 15.00 s | 0 | Accelerating during the race; screenshot shows driving |
| NFS III / Glide 2 | 253 in 15.00 s | 0 | Live cockpit race scene |
| NFS III / D3D | 314 readbacks over 315 presents in initial diagnostic | 314 | Shared worker flip path materializes the completed color surface |

NFS II SE issued two full-size write locks during startup, outside its race
sample. Each staged 640×480 pixels. NFS III's Glide backend likewise counted
two startup reads and writes, with none added during its race sample. Do not
describe either as a per-frame Glide readback problem.

Glide LFB staging currently reads the whole framebuffer: at 640×480 that is
1,228,800 RGBA bytes from WebGL, followed by RGB565 conversion and a 614,420-byte
packet. Both read locks and write locks use staging. Region writes also stage
before publishing; rectangle uploads could remove that read-before-write,
but these race samples do not exercise region writes.

## Conservative D3D readback experiment

The candidate retains every CPU fence and materializes **all** GPU-modified
pixels before returning. It tracks a conservative union of draw/clear bounds,
reads that rectangle, and preserves other CPU surface bytes. Uncertain
coordinates use a full-frame bound. It also avoids color readback for a
depth-only clear, while arming the next CPU-write check even for clean targets.

Actual GPU tests compare the complete padded DIB with full-frame readback,
including disjoint draws, blending, lines, partial/depth clears, CPU writes
outside the GPU bounds, and backing swaps. These and existing batching,
depthless and surface-fence regressions passed. An existing uncommitted
edge-coverage test fails identically on SwiftShader with bounded readbacks
disabled; that failure is not attributed to this change.

The matched NFS III experiment used the same WASM and renderer source, with
only `--full-readbacks` changing the served constructor option:

| Mode | Sample | Readbacks | RGBA bytes read | Full-frame equivalent | Reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full | 1 | 316 | 388,300,800 | 388,300,800 | 0% |
| Full | 2 | 310 | 380,928,000 | 380,928,000 | 0% |
| Bounded | 1 | 316 | 388,300,800 | 388,300,800 | 0% |
| Bounded | 2 | 306 | 376,012,800 | 376,012,800 | 0% |

NFS III dirties the entire frame. The lower total in one bounded sample is
fewer frames, **not a transfer optimization**: bytes per readback remain
1,228,800. Rates were approximately 20–21 presents/s in both modes. Later
samples exceeded load 4, so these timings cannot establish a speedup.

Source provenance for that pair:

- WASM SHA256: `5795a9ba83e4f056a4bde5a4175c6f86598b52569a010a8c399d99a07760cef3`.
- D3DIM GPU source SHA256: `e667c61b5c7d6a9742eba02f318c3e80288890517a3d16dc8452973059edc707`.
- Remote reports: `build/nfs3-readback-{full,bounded}/results.json`.
- Local evidence copy: `/private/tmp/glide3-evidence/build/`.

The diagnostic caller wrapper was corrected to forward ranged-fence arguments;
the matched pair above ran without caller instrumentation. Lazy synchronization
was not enabled or modified by this work.

## MechWarrior 3: small measured bandwidth reduction

The reusable browser route created pilot ACE, selected Instant Action,
verified the operation map, and deployed into a cockpit with textured terrain,
orange sky and HUD. The final bounded capture was inspected. Every existing
CPU synchronization point remains, with lazy synchronization off.

| Final arm | Presents | GPU reads | Pixels read | Full-size equivalent pixels |
| --- | ---: | ---: | ---: | ---: |
| Full | 312 | 940 | 288,768,000 | 288,768,000 |
| Bounded | 322 | 966 | 293,367,327 | 296,755,200 |

Within the bounded run, **3,387,873 pixels / 13,551,492 RGBA bytes were avoided**
against reading every dirty target at full size: **1.14% less transfer**.
It still performs three reads per present. An earlier pair recorded a similar
1.11% reduction. This does not remove MW3's recurring framebuffer locks.

The two launches simulate independently: final control rendered 726,489
triangles and had 93 primitive fallbacks; bounded rendered 623,402 triangles
with zero fallbacks. Rates were 20.80 versus 21.46 presents/s, but different
workloads and SwiftShader prevent attributing that difference to readback.
**No frame-rate improvement is established.** The reduction above compares
actual transferred pixels with the full-size equivalent in the same run.

The final implementation skips bounds calculations and allocation once the
target is already fully dirty, and also skips them in the full-readback
control. The complete padded-surface A/B regression passed again afterward.

- Final GPU source SHA256: `9dcaae69e4cdeb625825fb5904818d7ecdce49d334ac368259da06bcac5ab5f3`.
- WASM is the same hash as the NFS comparison above.
- Reports: `build/mw3-readback-{full,bounded}-final/result.json`.
- Reproduce with `tools/bench-mw3-readbacks.js --swiftshader --no-sandbox`,
  then a fresh output directory and `--full-readbacks` for the control.

The remaining large opportunity is avoiding presentation-driven D3D
materialization through GPU-backed composition and explicit surface ownership.
Bounding transfers cannot help a frame whose color coverage is already full.
