# MIG-FP-NATIVE-ARM64 capture handoff

Owner: `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642` (`/root/ops_review`), 2026-10-02 UTC. **Six serial P/PCM/PCP Node/Ion captures passed.** The local correctness slot was released immediately after exec9874 returned exit0, at 2026-10-02T00:37:46Z, so Serious Sam timer validation could proceed. Subsequent work was lightweight file/disassembly review only.

The ARM64 countdown survives code generation, but remains stack-backed in both engines. Compared with the captured x64 code, ARM64 Ion branches on the just-decremented register rather than rereading the stack counter for the zero comparison. This observation includes an engine-version difference and establishes no speed result.

## Provenance

Evidence root: `scratch/mig-fp-native-arm64-20261002/`.

- `input-hashes.json`: all four helpers and six frozen modules match the x64 fixture exactly, both before and after capture. No source/module changes were made.
- `result.json`: full agent identity, six engine/tier metadata objects, exact per-capture commands, 30 selected function records, module and named-module hashes.
- `output-hashes.json`: 120 capture/log artifact hashes. Raw Node jitdumps, Ion module binaries, complete function maps, annotated and raw assembly remain in `captures/`.
- `review-excerpts.txt`: eight exact countdown/spill excerpts. `boundary-review.json`: entry and tail observations for all 30 functions.
- `logs/`: all six capture logs plus actual installed-tool versions.

| Tool | Actual version / configuration |
| --- | --- |
| Node | `/usr/local/bin/node`, v24.21.0, arm64 |
| V8 | 13.6.233.17-node.53, eager TurboFan through `--perf-prof --no-liftoff --no-wasm-lazy-compilation` |
| SpiderMonkey | `/Users/vg/.jsvu/bin/sm`, JavaScript-C155.0, `--wasm-compiler=ion` |
| objdump | `/opt/homebrew/opt/binutils/bin/objdump`, GNU Binutils 2.47.20260726 |

| Variant | Stripped SHA-256 | Named SHA-256 |
| --- | --- | --- |
| P | `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b` | `a619ca31a39e9d64c418937a8567b8c93cc0ed4d9bf25a759c44b6d8a0abefd4` |
| PCM | `a339c0cead0001b2af2bcbfc60376d52c91e64b7672b4d4bb1b19eef209b9f2c` | `b630dc330960ad43ddde437f69d505f0f4b21a48c3c9cfc76637b853abf190cf` |
| PCP | `3f2a553e029cf4bf60abddb222fa36d49f2e5f55a48456b881610595dcbdf92b` | `d754150c940240019918244d0985900b29bce1e72bd8ca883d954b32431651bd` |

All six capture/review module and named-module hashes were verified against this manifest. Every capture contains all five requested functions. P is the matched control, not `baseline.wasm`.

Exact invocation sequence, with stop-on-first-failure:

```sh
set -e
export SM=/Users/vg/.jsvu/bin/sm
export OBJDUMP=/opt/homebrew/opt/binutils/bin/objdump
for fp_engine in node sm; do
  for fp_variant in p pcm pcp; do
    case "$fp_variant" in
      p) fp_module_dir=build/lazy-games/fp-combos/p ;;
      *) fp_module_dir=build/lazy-games/fp-next/$fp_variant ;;
    esac
    /usr/local/bin/node tools/bench-fp-native.js "$fp_engine" \
      "$fp_module_dir/candidate.wasm" "$fp_module_dir/candidate.named.wasm" \
      "scratch/mig-fp-native-arm64-20261002/captures/$fp_engine/$fp_variant" \
      > "scratch/mig-fp-native-arm64-20261002/logs/$fp_engine-$fp_variant.log" 2>&1
  done
done
```

No extra shell installation, compilation of new modules, guest execution, local benchmark or remote job was needed.

## Matched structural review

Capture segment/record sizes include tables/metadata in larger functions; they are not exact executable instruction-byte totals.

| Function | ARM64 V8 P / PCM / PCP bytes | ARM64 Ion P / PCM / PCP bytes |
| --- | --- | --- |
| `x87_island_fast` | 22848 / 22848 / 22816 | 8128 / 8128 / 8120 |
| `x87_island_fast_mixed` | 15872 / 15904 / 15872 | 8240 / 8224 / 8240 |
| `x87_island_generic` | 1248 / 1216 / 1216 | 480 / 480 / 452 |
| `x87_island_generic_mixed` | 3680 / 3648 / 3680 | 588 / 576 / 588 |
| `uop_fast` | 9568 / 9568 / 9568 | 10984 / 10984 / 10984 |

**V8 loop and spills.** P generic pure reloads index from `[sp,#24]`, adds one, reloads count from `[sp,#16]`, compares, then branches `b.hi`. PCP instead reloads remaining count from `[sp,#24]`, executes `sub w9,w9,#1`, then `cbnz w9` back to the loop. The separate count load/comparison disappears at this boundary, but the loop counter still crosses helpers through its stack slot.

PCM fast mixed reloads `[sp,#144]` into x10, decrements w10 and branches `cbnz`; PCM generic mixed uses `[sp,#56]`; PCP fast pure uses `[sp,#40]`. The preserved eight excerpts distinguish these loop counters from unrelated x87 stack-index decrements in the body. None is evidence of a wholly register-resident counter.

V8 local prologue reservations P/PCM/PCP: fast pure `0xc0/0xb0/0xb0`, fast mixed `0xb0/0xb0/0xb0`, generic pure `0x40/0x40/0x40`, generic mixed `0x60/0x50/0x60`, uop `0x60/0x60/0x60`. These exclude other prologue bookkeeping and do not measure memory traffic.

As on x64, V8 pure entrypoints contain the mixed dispatch path selected by packed bit `0x10000000`. PCM therefore also changes their generated native code even though its source transform only changes mixed evaluator loops. The corresponding mixed PCP records retain P's sizes and sampled frame/loop/dispatch structure. Uop retains its record size, frame reservation and table-dispatch structure in all variants. No full relocation-normalized byte-equivalence claim is made.

**Ion loop and spills.** P generic pure increments index at `[x20,#20]`, reloads/masks count from `[x20,#24]`, compares and branches `b.cs`. PCP generic pure and PCM generic mixed instead load remaining count at `[x20,#24]`, subtract one, store it back, then `cbz w0` to the exit. Fast PCP pure and PCM mixed do the same at `[x20,#72]`. Ion's x20 is its stack pointer alias, established from sp in the prologue. The store remains; the branch uses the register value.

Ion frame reservations P/PCM/PCP: fast pure `0x60/0x60/0x50`, fast mixed `0x60/0x50/0x60`, both generic functions `0x20/0x20/0x20`, uop `0x30/0x30/0x30`. Removing the index reduces the affected fast frame by 16 bytes in this engine build. Unchanged pure PCM and mixed PCP functions retain the corresponding P sizes and reviewed control patterns.

**Calls and dispatch.** Both engines retain indirect `br x16` table dispatch in fast evaluators and uop. Ion's dispatch loads an indexed entry from a table before the branch; V8 likewise retains indirect dispatch. Generic paths still use conditional dispatch and helper calls. Ion direct targets include `fpu_exec_mem`, `fpu_exec_reg`, FP conversion/comparison/exception functions, guest-memory load/store helpers, and flag helpers in mixed paths; pure Ion entrypoints still call their mixed counterpart. The helper resolves the same call counts per function across P/PCM/PCP: generic pure4, generic mixed6, fast pure66, fast mixed68. Uop has no direct `bl` counted here. These are static records, not dynamic call frequencies.

V8 direct call targets remain unresolved by the helper: 216 fast-pure,153 fast-mixed,9 generic-pure,102 generic-mixed and13 uop direct-call records per arm, all zero resolved. Calls are visible but cannot be attributed to named targets from this extraction. No claim of helper elimination follows from countdown.

## x64 comparison and extraction limits

Compare with `mig-fp-native-x64.md` and its preserved raw captures. Both architectures show countdown retained, spilled counters and unchanged basic dispatch strategy. ARM64 V8 uses sub/cbnz; x64 V8 uses add-minus-one/jne. ARM64 Ion stores the new counter then branches directly on w0; x64 Ion158 stores, then compares the stack slot with zero. The affected ARM64 Ion fast frames shrink 16 bytes; x64 Ion158 fast frame reservations remained 0x60. These facts do not establish which host is faster.

Engine versions differ: ARM64 Node24.21.0/V8 node.53 and Ion155 versus x64 Node24.18.1/V8 node.50 and Ion158. Do not attribute cross-host code differences solely to architecture. Each P/PCM/PCP comparison within one architecture uses the same engine version and exactly matching input modules.

Reviewed entry sequences for all 30 selected records are coherent AArch64 prologues and stack checks. Generic endings restore stack and return, followed by explicit traps/reentry stubs. Large fast/uop records include literal pools or jump tables; objdump displays data as `.inst ... undefined` or `udf`. Those tails are not executable-path findings. Raw binaries and maps are retained for additional relocation analysis; this task does not certify every table entry or every byte difference. No extraction failure or missing function occurred.

These are eager optimized-tier captures, not normally tiered code collected during actual gameplay. They satisfy the structural capture phase, not new game-work parity or timing acceptance.

## Next step and resource release

Both requested architecture capture sets now exist. Coordinator may review them together before assigning the already documented copied-kernel and matching-work game checks, with a reserved quiet host and exact P controls. Keep PCM/PCP experimental; no default/source change or new optimization campaign follows from these captures.

Local capture CPU released at 00:37:46Z; all six jobs terminal. Other processes were preserved. No remote resources were used.

Own board watcher exec11650 stopped via Ctrl-C, terminal130. No retained worker jobs remain; narrow report diff check passed.
