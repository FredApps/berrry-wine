# MW3 mixed integer/x87 island experiment

2026-09-30. The isolated prototype speeds up the authentic projection kernel
on both ARM64 and x86-64. The real-game ABBA does **not** establish an FPS
improvement, so the change is not enabled in production.

## Change and correctness boundary

`tools/bench-mw3-mixed-build.js` reproduces frozen `837f0a74` byte-for-byte,
then transforms only `07b-loop-match.wat` in the compiler's virtual inputs.
It extends H451 islands across ADD reg,imm32 (H3), INC reg (H64), and DEC reg
(H65), retaining the existing integer flag helpers and x87 semantics.

```text
Projection before:
  FLD → FDIV → ADD → ADD → DEC → [remaining x87 island] → JNZ

Projection candidate:
  [FLD → FDIV → ADD → ADD → DEC → remaining x87 operations] → JNZ
   one island entry; FP state retained across integer operations
```

The matcher still starts/ends on an x87 operation, limits spans to 255 records,
and stops at unsupported operations, branch terminators and later EA_TEMP
consumers. It does not absorb the loop backedge or change arithmetic order.
Integer operations update the actual guest register file and lazy flags.

Existing block-executor eligibility checks reject these integer records inside
an x87 span. This conservatively prevents running a mixed island with stale
registers cached by a caller. It can also forfeit a block-executor opportunity;
that is a performance limitation of this prototype, not something to bypass.

The first candidate tested three handler IDs at every operation. Native V8
code exposed the boolean-combining overhead. The final evaluator uses one
unsigned `fn < 66` check: the matcher admits only H3/H64/H65 or H188..190.
Admission remains an explicit whitelist. No new opcode or export is required.

Final artifacts under `build/lazy-games/mw3-mixed3/`:

- Baseline: `c1c92840fde2c9ae2809154ea64ea9ab91b11effdb0a541099b695f1567a6b93`
- Candidate: `2a43980dc0fa1ad5b02a233354fb26a3fd503de924e7d581bd9fa2e07286f4f2`
- WASM size: 1,646,105 → 1,646,427 bytes (+322).
- `mixed-loop-match.wat` is the complete generated candidate source fragment.

No shared runtime source or canonical build was changed. The earlier
`mw3-mixed2/` candidate is retained for disassembly comparison and is superseded.

## Validation and fixed-work timing

`tools/bench-mw3-mixed-parity.js` reuses the existing x87 differential fuzzer,
injects integer bridges, and checks all GPRs in addition to FP file/shadows,
TOP/tags, control/status, scratch memory, lazy flags and exception traces.
Final result: **1,000 sequences, 26,138 operations; fast == generic == unfused**.
Every sequence exercised an island. Random FP states include NaNs, infinities,
signed zeros, denormals, empty tags and differing rounding modes.

`tools/bench-mw3-mixed-kernel.js` copies the actual EXE bytes
`0x4fd394..0x4fd3e0`, including its original backedge and return. It compares
complete output hashes, relevant GPRs/flags and exposed FPU state for ordinary
vertices and special float inputs. Both architectures passed.

Timing uses 500,000 vertices per call, twelve alternating warmups, then ten
ABBA/BAAB groups (twenty samples per arm). Input setup, output checks and
diagnostic census are outside timing. These are **Node guest-thread CPU times**,
not game frame times and not timings from the separate d8/Chrome code capture.

| Machine | Baseline median | Candidate median | Reduction | Same-artifact control |
|---|---:|---:|---:|---:|
| Laptop ARM64, Node 24.21.0 | 59.987 ms | 49.460 ms | 17.55% | 0.11% difference |
| Remote Ryzen 9 9950X, Node 24.18.1 | 32.992 ms | 30.991 ms | 6.07% | 0.00% difference |

Node V8 versions were respectively `13.6.233.17-node.53` and
`13.6.233.17-node.50`. The x86 control's two medians were 34.001 ms; do not
compare absolute times from separate runs as a frequency-independent number.
The earlier shorter pilot is not directly comparable to this warmed, longer
test and cannot isolate the range-check revision's performance effect.

The post-timing census proves the intended work was absorbed:

| Dispatched handler | Baseline | Candidate |
|---|---:|---:|
| ADD immediate | 1,000,000 | 0 |
| DEC register | 500,000 | 0 |
| Scalar x87 absolute memory | 500,000 | 0 |
| Scalar x87 base memory | 500,000 | 0 |
| x87 island | 500,000 | 500,000 |

Raw timings, parity state and census live in `kernel-arm64.json`,
`kernel-x64-final.json`, and their `*-control.json` files. `parity.log` records
the randomized differential test.

## Actual V8 native code on both architectures

The existing `tools/wasm-native.js --engine=v8` method was already available:
`--perf-prof` emits code bytes even when V8's text disassembler is compiled
out. `tools/bench-mw3-mixed-native.js` follows that method but retains raw
jitdump files and original code addresses for correct PC-relative destinations.

- Laptop: **d8 V8 15.4.49, ARM64**.
- Remote: **Chrome 151.0.7922.108, x86-64**, matching the gameplay browser.
- Both use `--no-liftoff --no-wasm-lazy-compilation` for compile-only TurboFan
  capture. This is not a record of the exact tiers/PCs used in timed Node runs.

The final added operation classification is:

```asm
# ARM64: fn is in w25
cmp  w25, #0x42
b.cc integer_operation

# x86-64: fn is stored in a stack slot
cmpl $0x42, -0x88(%rbp)
jb   integer_operation
```

ST0 stays in `d2` / `xmm0`. Integer arithmetic and flag maintenance are inlined
in the captured evaluator; the integer path does not publish/reload the whole
FP stack. INC/DEC still contain work to preserve carry from the lazy flag
representation. Existing floating stores still use the common memory helper
and its associated spills. This is still an interpreter with per-op decoding.

| `x87_island_fast` native object | Baseline | Candidate |
|---|---:|---:|
| ARM64 d8 | 17,984 bytes | 17,952 bytes |
| x86-64 Chrome | 19,840 bytes | 20,160 bytes |

The ARM64 stack reservation stays at 224 bytes; x86 grows from 224 to 232.
Object sizes include padding/tables and are not dynamic instruction counts.
ARM64 keeps the candidate cursor in `w24` on the ordinary loop path, while
the baseline loop reloads it from a stack slot; register allocation changed
alongside the intended dispatch saving. That observation is engine/version
specific, not a measured explanation of the Node speedup.

Baseline native files are in `mw3-mixed2/arm64-base/` and
`mw3-mixed2/native-x64-base/`; final files are in
`mw3-mixed3/arm64-candidate/` and `mw3-mixed3/native-x64-candidate3/`.
Each has `capture.json`, `functions.json`, raw dumps, `.bin` and `.asm` files.
Chrome shutdown left unrelated final records incomplete; the parser skips
those tails and requires all four requested functions to be fully captured.

## Real gameplay: no established gain

Dedicated box `bx_4r5uzdwv`, 4 vCPU / 8 GB, headful Chrome 151,
**SwiftShader-backed WebGL**, worker guest, shipping lazy-sync setting.
One sequential ABBA, two 15-second stationary-cockpit samples per launch:

| Run | Artifact | FPS windows | Triangles/present |
|---|---|---|---|
| A1 | Baseline | 21.11 / 21.85 | 2,229 / 2,233 |
| B1 | Candidate | 22.64 / 22.17 | 1,848 / 1,843 |
| B2 | Candidate | 22.85 / 22.12 | 1,943 / 1,978 |
| A2 | Baseline | 24.18 / 23.91 | 1,842 / 1,842 |

All runs reached the cockpit with zero reported errors; candidate screenshots
were inspected. B2's first window recorded **135 renderer fallbacks**; all
other windows recorded zero. Source/worker hashes and rendering mode are
recorded per run in `mixed-final-*/result.json`.

Scene work varies substantially, and baseline launch-to-launch variation is
larger than any apparent candidate effect. B1 is slower than the similarly
sized A2 scene. These results cannot support a whole-game improvement claim.
The initial aborted baseline lacked restored MFC42/MSVCRT DLLs and is excluded;
both were restored before this ABBA. The dedicated box is confirmed archived.

## Decision and next useful experiment

Keep this as an isolated, reproducible prototype. The kernel result establishes
that retaining FP state across integer updates can help; it does not establish
that this loop accounts for enough frame time to improve MW3 overall.

Before promotion, measure mixed-island coverage/cost in the game and the cost
of lost block-executor eligibility. One bounded follow-up is routing mixed
spans to a separate evaluator, preserving the existing pure-x87 fast path so
it does not pay the additional classification check. That trades code size
for avoiding overhead on unrelated islands. It still needs game A/B evidence.

Reproduce locally:

```sh
node tools/bench-mw3-mixed-build.js 837f0a74 build/lazy-games/mixed-new build/lazy-games/postmerge-profile3/postmerge.wasm
X87_FUZZ_CASES=1000 node tools/bench-mw3-mixed-parity.js build/lazy-games/mixed-new
MIXED_VERTICES=500000 MIXED_ROUNDS=10 node tools/bench-mw3-mixed-kernel.js build/lazy-games/mixed-new/baseline.wasm build/lazy-games/mixed-new/candidate.wasm
node tools/bench-mw3-mixed-native.js capture-d8 build/lazy-games/mixed-new/candidate.wasm build/lazy-games/mixed-new/candidate.named.wasm build/lazy-games/mixed-new/native
node tools/bench-mw3-mixed-native.js decode build/lazy-games/mixed-new/candidate.wasm build/lazy-games/mixed-new/candidate.named.wasm build/lazy-games/mixed-new/native
```

Use `capture-chrome` with `DISPLAY`/`CHROME` on the x86 box, then decode with
GNU objdump (`OBJDUMP` override). Capture directories must be fresh.
