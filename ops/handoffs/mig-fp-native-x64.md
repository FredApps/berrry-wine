# MIG-FP-NATIVE-X64 capture handoff

Owner `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642` (`/root/ops_review`), 2026-10-02 UTC. **All six captures passed**, serial P/PCM/PCP under Node and SpiderMonkey. The countdown is present in generated x64 code and still uses stack storage. This is structural evidence, not a performance result or default-change recommendation.

## Provenance and retained evidence

- Assigned host: handed-off ASCII `bx_4r5uzdwv`, x64 Ryzen box; pinned SSH endpoint and known-hosts file supplied by coordinator. Existing frozen runner was untouched.
- Fresh isolated remote fixture: `/home/user/mig-fp-native-20261002`; copies of four helpers and six exact frozen modules only, plus hash manifest, logs and captures.
- Local complete evidence: `scratch/mig-fp-native-x64-20261002/`. `fixture/` preserves uploaded inputs; `input-hashes.json` records all ten hashes. `captures/` and `logs/` are downloaded outputs. `remote-output-SHA256SUMS` records remote hashes: **121/121 downloaded files match**.
- `result.json` records all capture/review metadata, exact helper commands and agent identity. `verification.json` records all 30 selected-function entries and download verification. `review-excerpts.txt` preserves the actual countdown/spill disassembly excerpts used below.
- `*-*.diff` and `structural-comparison.json` are exploratory textual comparisons. They preserve registers and branch offsets, replace direct-call destinations with resolved names or `UNRESOLVED`, and normalize in-record addresses. They are **not relocation-proof binary equivalence certificates**. Ion tables use absolute pointers and some large records include trailing data; those differences must not be called executable instructions.
- No production sources, variants, builds, benchmark runs, installs or local CPU captures were created.

| Component | Exact reported version / tier |
| --- | --- |
| Node | v24.18.1, `/home/user/.nvm/versions/node/v24.18.1/bin/node` |
| V8 | 13.6.233.17-node.50, eager TurboFan: `--perf-prof --no-liftoff --no-wasm-lazy-compilation` |
| SpiderMonkey | JavaScript-C158.0, `/home/user/.jsvu/bin/sm`, `--wasm-compiler=ion` |
| Disassembler | `/usr/bin/objdump`, GNU Binutils 2.42 |

| Variant | Stripped SHA-256 | Named SHA-256 |
| --- | --- | --- |
| P | `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b` | `a619ca31a39e9d64c418937a8567b8c93cc0ed4d9bf25a759c44b6d8a0abefd4` |
| PCM | `a339c0cead0001b2af2bcbfc60376d52c91e64b7672b4d4bb1b19eef209b9f2c` | `b630dc330960ad43ddde437f69d505f0f4b21a48c3c9cfc76637b853abf190cf` |
| PCP | `3f2a553e029cf4bf60abddb222fa36d49f2e5f55a48456b881610595dcbdf92b` | `d754150c940240019918244d0985900b29bce1e72bd8ca883d954b32431651bd` |

All ten uploaded file hashes matched on the host before execution. All six capture metadata module hashes and all six named review hashes match these inputs. Every capture includes the five intended functions.

Exact sequence from the fresh remote directory, stopping at first failure:

```sh
set -e
export SM=/home/user/.jsvu/bin/sm OBJDUMP=/usr/bin/objdump
for fp_engine in node sm; do
  for fp_variant in p pcm pcp; do
    /home/user/.nvm/versions/node/v24.18.1/bin/node tools/bench-fp-native.js "$fp_engine" \
      "modules/$fp_variant/candidate.wasm" "modules/$fp_variant/candidate.named.wasm" \
      "captures/$fp_engine/$fp_variant" > "logs/$fp_engine-$fp_variant.log" 2>&1
  done
done
```

Execution returned exit 0 after all six PASS notifications. Captures are compile-only optimized tiers, not normally tiered gameplay code. P is the matching control; `baseline.wasm` was not substituted.

## Structural review against P

Sizes below are capture record/segment bytes; large records include tables or metadata, so these are not exact counts of executable instruction bytes.

| Function | V8 P / PCM / PCP | Ion P / PCM / PCP |
| --- | --- | --- |
| `x87_island_fast` | 29824 / 29824 / 29824 | 7816 / 7816 / 7816 |
| `x87_island_fast_mixed` | 19840 / 19840 / 19840 | 8432 / 8424 / 8432 |
| `x87_island_generic` | 1664 / 1664 / 1664 | 431 / 431 / 427 |
| `x87_island_generic_mixed` | 4224 / 4288 / 4224 | 521 / 517 / 521 |
| `uop_fast` | 12416 / 12416 / 12416 | 10111 / 10111 / 10111 |

**V8 counter/spill findings.** P generic pure loop loads index from `-0x38(%rbp)`, increments it, loads count from `-0x40(%rbp)`, compares, then takes `ja`. PCP instead loads the remaining count from `-0x38(%rbp)`, executes `add $0xffffffff,%r12d`, then `jne`. The countdown removes the separate count comparison here but remains stack-backed across helper calls.

PCM fast mixed reloads remaining count from `-0x30(%rbp)` to `%r14`, decrements `%r14d`, then `jne` to the loop. PCM generic mixed reloads `-0x28(%rbp)` to `%r15` before decrement/branch. PCP fast pure reloads `-0x98(%rbp)` to `%r12` before decrement/branch. None becomes a wholly register-resident countdown.

V8 prologue stack reservations P/PCM/PCP are fast pure `0xb8/0xb0/0xb8`, fast mixed `0xb0/0xb0/0xb0`, generic pure `0x38/0x38/0x38`, generic mixed `0x58/0x50/0x58`, and uop `0x50/0x50/0x50`. These are prologue reservations, not measured memory traffic or complete frame accounting.

The pure entrypoints test packed bit `0x10000000` and include mixed-path native code. Frozen transformed WAT explicitly calls the mixed evaluator on that bit (`mixed-loop-match.wat` lines 1412 and 1641); V8 generated pure entries contain the mixed dispatch path rather than being an independent unchanged control. Thus PCM changes the generated pure entries too. The unchanged PCP mixed paths retain P's instruction shape in the textual comparison except an absolute runtime address in `movabs`; this was not promoted to a full binary-equivalence claim. `uop_fast` normalized instructions before its first identified table match P in both variants.

**Ion counter/spill findings.** P generic mixed uses a stack index at `-0xc(%rbp)`, adds one, reloads count at `-0x4(%rbp)`, then compares. PCM replaces it with load/sub/store of remaining count at `-0x4(%rbp)`, followed by `cmpl $0x0,-0x4(%rbp)` and `je`. PCP generic pure uses the same stack countdown pattern. Fast PCM mixed and PCP pure use count at `-0x8(%rbp)`: load, `sub $1`, store, compare memory with zero, branch. The separate index disappears, but the hot counter remains spilled and the zero test rereads its stack slot. Ion frames remain `0x60` for fast, `0x20` for generic and `0x30` for uop in every variant.

**Calls and dispatch.** Both engines retain indexed indirect jump-table dispatch in the fast evaluators and uop; countdown does not replace operation dispatch. Ion generic calls still resolve to `fpu_exec_mem`/`fpu_exec_reg`; mixed adds flag helpers. Ion fast paths still call FP conversion/comparison/exception and guest-memory helpers (`gl16/gl32/gl64`, `gs16/gs32/gs64`), and pure entrypoints retain a call to their mixed counterpart. Ion P versus PCM generic pure and P versus PCP generic mixed normalized comparisons are identical. The fast unchanged paths and uop have the same sampled control flow/frame sizes but raw differences include relocated table/runtime addresses; no full relocation-equivalence claim is made.

V8's helper resolves **zero direct-call targets** for every selected function in these captures. Numerous calls remain visible, but they cannot be named reliably from these records. Preserve that limitation; do not infer call elimination or changed helper identities from the raw counts. Automated full-record call counts can also interpret trailing data as instructions and are not a hot-path metric.

## Extraction checks and limits

All 30 entry sequences begin with coherent `push %rbp; mov %rsp,%rbp` prologues and sensible stack checks. Ion generic function endings include matched stack restore/pop/ret plus explicit trap/reentry stubs, consistent with the helper's prologue-based segment-skew correction. Large fast/uop records end with jump tables or other data; raw objdump there produces apparent invalid instructions and even false calls. Conclusions above use the executable loop/dispatch sequences, not those tails. The original `module.bin`, V8 jitdumps, full maps and unmodified assembly are preserved for stronger relocation analysis if later needed.

These are new same-host x64 P/PCM/PCP captures. Planned ARM64 uses Node24.21/V8 node.53 and SpiderMonkey155, while this host uses Node24.18.1/V8 node.50 and SpiderMonkey158. Cross-architecture comparisons must retain these version differences. ARM64, normally tiered game capture and new matching-work timings are outside this task and remain outstanding.

## Release and exact next step

All capture and transfer processes are terminal. No existing remote services/jobs were stopped or altered. Remote fixture and local evidence remain preserved; coordinator retains the box itself. **Release the dedicated remote capture CPU slot.** No timings or speed conclusions were produced.

Own board watcher exec75798 stopped via Ctrl-C, terminal exit130. No retained worker jobs remain. Narrow report diff check passed.

Next authorized step: coordinator may schedule matching ARM64 captures when its local correctness slot is free, then review both architectures before assigning the handoff's copied-kernel or matching-work game checks. Keep PCM/PCP experimental. No new variant or broad optimization campaign follows from this report.
