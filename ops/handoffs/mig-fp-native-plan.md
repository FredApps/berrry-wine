# MIG-FP-NATIVE-PLAN: capture preflight

Worker `/root/fp_parity`, Codex `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, 2026-10-01. Coordinator assignment was read-only preparation. No captures, builds, downloads, installs, remote access, timings, or production edits were performed. The only new file is this handoff (plus append-only board announcements). No worker jobs remain.

## Verified local prerequisites

| Component | Executable | Reported version |
|---|---|---|
| Node / V8 | `/usr/local/bin/node` | Node v24.21.0; V8 13.6.233.17-node.53; arm64 |
| SpiderMonkey | `/Users/vg/.jsvu/bin/sm` | JavaScript-C155.0 |
| GNU objdump | `/opt/homebrew/opt/binutils/bin/objdump` | GNU Binutils 2.47.20260726 |
| Optional standalone V8 | `/Users/vg/.jsvu/bin/v8` | V8 15.4.49 |

Use the `node` helper mode for the V8 arm, as requested by the old FP handoff. The optional d8 version is a different engine revision and is not a replacement control for Node. Version queries only were run; extraction/perf-prof capability remains to be exercised by the first authorized capture.

The three variant directories contain identical 123-file frozen source trees. All build manifests name revision `837f0a74` and the same baseline hash `c1c92840fde2c9ae2809154ea64ea9ab91b11effdb0a541099b695f1567a6b93`. A byte-level WASM section parser verified that each named module's non-custom sections exactly equal its stripped candidate's non-custom sections; no compilation was needed for this check.

| Variant directory | Stripped candidate SHA-256 | Named candidate SHA-256 |
|---|---|---|
| `build/lazy-games/fp-combos/p` | `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b` | `a619ca31a39e9d64c418937a8567b8c93cc0ed4d9bf25a759c44b6d8a0abefd4` |
| `build/lazy-games/fp-next/pcm` | `a339c0cead0001b2af2bcbfc60376d52c91e64b7672b4d4bb1b19eef209b9f2c` | `b630dc330960ad43ddde437f69d505f0f4b21a48c3c9cfc76637b853abf190cf` |
| `build/lazy-games/fp-next/pcp` | `3f2a553e029cf4bf60abddb222fa36d49f2e5f55a48456b881610595dcbdf92b` | `d754150c940240019918244d0985900b29bce1e72bd8ca883d954b32431651bd` |

Use `candidate.wasm` and `candidate.named.wasm` within each row. P is the matching control; the shared `baseline.wasm` is not P. PCM and PCP parity are complete; see `mig-fp-parity.md` and the original FP handoff.

## Helper behavior and isolation

`tools/bench-fp-native.js node|sm MODULE NAMED OUT` captures five functions: `x87_island_fast`, `x87_island_fast_mixed`, `x87_island_generic`, `x87_island_generic_mixed`, and `uop_fast`.

- Node mode invokes the current Node executable with `--perf-prof --no-liftoff --no-wasm-lazy-compilation`, then decodes TurboFan records. It writes the compile script, raw jitdump, per-function binaries/assembly, complete function map, capture metadata and review metadata under a fresh `OUT`.
- SpiderMonkey mode selects Ion through `--wasm-compiler=ion`, retains `module.bin`, function maps, assembly and metadata under `OUT`. Its PID-specific temporary JS helper is written to `os.tmpdir()` and removed in `finally`.
- Both modes annotate direct-call targets where resolvable and retain module and named-module hashes. Neither requires guest assets, emulator startup, a canonical build, browser resources, an X server, or npm packages.
- These are eager optimized-tier structural captures. They are not normally tiered hot-game code and cannot establish performance by themselves.
- Read dependencies to transfer as a set for an isolated remote fixture: `bench-fp-native.js`, `bench-mw3-mixed-native.js`, `wasm-native.js`, `func-index.js`, all under `tools/`. `func-index.js` imports only built-ins and is not run as a CLI by the capture helper; current canonical `combined.wat` is not read by this path.

Inspected helper hashes:

```text
7da75b90e3a9754c71fbbdd03490be14ba497864f32be80edf436ab7c2026153  tools/bench-fp-native.js
291619bcc8ee67eac08308e81ebefa29b28c9a262d4c7acdaa75914ec6a3e783  tools/bench-mw3-mixed-native.js
b1ce4883adda12bc0c25b99ed45c1851b180465b7445f6944218d00af8e9a915  tools/wasm-native.js
```

## Executable local capture sequence, awaiting resource assignment

From repository root, after the coordinator grants the local correctness/capture slot, reserve the previously unused `scratch/mig-fp-native-arm64-20261001` tree. If it already exists, choose a new suffix; never delete/reuse a completed output directory. Run these six invocations sequentially, stopping on the first failure:

```sh
(
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
        "scratch/mig-fp-native-arm64-20261001/$fp_engine/$fp_variant"
    done
  done
)
```

Capture logs and a result manifest in that same owned scratch tree; preserve the exact commands, host/architecture, engine versions, helper hashes and six module hashes above. Capture one job at a time. No benchmark batch is included in this plan.

## x64 prerequisites and exact conditional sequence

No remote machine was contacted. `ops/handoffs/fp-next-root.md` names the coordinator-retained `bx_4r5uzdwv` (last endpoint `37.59.33.130:19041`, user `user`), now Ryzen 9 9950X, with frozen runner `/home/user/mw3-profile/repo`. Reconfirm endpoint, host key, ownership, running jobs, engines and disk before scheduling. Preserve unrelated jobs and do not overwrite the frozen runner's helper files.

Historical local metadata at `build/lazy-games/fp-pc-games/native/{node,sm}/p/capture.json` and `review.json` records:

- Node `/home/user/.nvm/versions/node/v24.18.1/bin/node`, V8 13.6.233.17-node.50, x64.
- SpiderMonkey JavaScript-C158.0, x64. Its path was not recorded in that capture; the helper default would be `/home/user/.jsvu/bin/sm`.
- Those captures came from an EPYC-Rome host according to `fp-pc-games/host.json`, not proof of current installed binaries on restored Ryzen. GNU objdump's helper default is `/usr/bin/objdump`, also unverified remotely.

After remote authorization, verify these paths with executable checks and `--version`, plus `node -p 'JSON.stringify({node:process.version,v8:process.versions.v8,arch:process.arch})'`. Do not auto-install missing prerequisites. If paths differ, substitute verified explicit paths in the commands below. If paths exist and versions are suitable, create a new isolated `/home/user/mig-fp-native-20261001` fixture, transfer only the four helper files under `tools/` and six exact module files under `modules/{p,pcm,pcp}/`, and verify hashes before running. The following sequence is executable from that fixture under those verified prerequisites:

```sh
(
  set -e
  export SM=/home/user/.jsvu/bin/sm
  export OBJDUMP=/usr/bin/objdump
  for fp_engine in node sm; do
    for fp_variant in p pcm pcp; do
      /home/user/.nvm/versions/node/v24.18.1/bin/node tools/bench-fp-native.js "$fp_engine" \
        "modules/$fp_variant/candidate.wasm" "modules/$fp_variant/candidate.named.wasm" \
        "captures/$fp_engine/$fp_variant"
    done
  done
)
```

The assigned worker owns only that fresh remote fixture and a corresponding fresh local download directory. Download and hash retained outputs before releasing the remote slot. Do not stop/archive the box without coordinator instruction. ARM64 and x64 versions currently differ; compare variants within each engine/architecture, record the mismatch, and do not attribute cross-engine-version differences solely to architecture.

## Review and exit criteria

For each engine/architecture, confirm all five requested functions were captured with the expected module/named hashes and intended tier. Compare P against PCM and PCP separately: pure versus mixed loop-counter updates, stack spills/reloads, calls into FP/memory helpers, dispatch branches and code-size changes; use the unchanged evaluator and `uop_fast` as controls. Normalize only explained address relocations, never assume byte differences are semantic. Prior x64 V8 P metadata had zero resolved direct-call targets despite many calls; annotations alone cannot identify trampoline/indirect targets, so explicitly retain unresolved calls in the review.

For Ion, the helper applies a heuristic segment skew chosen by common prologues. Review representative starts/ends and sensible boundaries, especially on x64, before trusting per-function disassembly. On failure, retain the output and report the exact prerequisite/extraction problem; do not launch more variants or change source without assignment.

Publish a concise structural report and resource release after all six captures for each assigned architecture. Missing today: every new PCM/PCP native capture, refreshed same-environment P captures, remote installed-tool verification, and all new game/performance gates. The next ready action is the six local ARM64 captures once the Serious Sam replay releases the local slot; the x64 phase needs a separate remote resource grant.
