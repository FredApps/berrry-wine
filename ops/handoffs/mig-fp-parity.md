# MIG-FP: frozen PCP correctness handoff

- Worker: `/root/fp_parity`, Codex session `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`.
- Coordinator: Codex `01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0`.
- Date: 2026-10-01. Assignment complete. No production files changed, new builds written, remote jobs started, commits made, or timing claims produced.
- Source handoff: `ops/handoffs/fp-next-root.md`, explicitly acknowledged and transferred by coordinator before assignment.

## Result

The remaining PCP differential parity check passed, exit 0:

```text
FP_COMBO=pcp FP_ALL_FUSERS=1 node tools/bench-mw3-mixed-parity.js build/lazy-games/fp-next/pcp --fp-combos
PASS x87 island fast == generic == unfused: 400 sequences, 14834 ops, 400 with islands
```

Local environment: Node v24.21.0, arm64. Default deterministic seed `0x5eed87`; 400 cases. Evidence: `scratch/mig-fp-20261001-parity/pcp-parity.log`.

The harness was inspected before running. It reads the frozen `pcp/src` tree, applies the PCP transform and test exports, and compiles a test-only module in memory through `compileClosure`. It does not directly execute the saved stripped candidate, invoke the canonical build, or write compiled artifacts. It compares fast/generic/unfused FP payloads, tags, control/status, scratch buffer, GPRs, flags, and exception traces; it also injects integer bridges, island-cap boundaries, and earlier-fuser overlap cases. This is frozen-source differential correctness evidence, not gameplay or performance evidence.

`node --check` passed for all three transferred narrow tools:

- `tools/bench-fp-combos.js`
- `tools/bench-mw3-repeat.js`
- `tools/bench-mw3-repeat-report.js`

Artifact hashes independently match the old owner's handoff/build manifests:

| Artifact | SHA-256 |
|---|---|
| PCM candidate | `a339c0cead0001b2af2bcbfc60376d52c91e64b7672b4d4bb1b19eef209b9f2c` |
| PCP candidate | `3f2a553e029cf4bf60abddb222fa36d49f2e5f55a48456b881610595dcbdf92b` |
| PCM and PCP baseline | `c1c92840fde2c9ae2809154ea64ea9ab91b11effdb0a541099b695f1567a6b93` |

Each candidate is 1,651,965 bytes; each baseline is 1,646,105 bytes. Both build manifests record frozen revision `837f0a74`. The baseline here is the build manifest's baseline, not the historical P module hash quoted elsewhere in the old handoff.

Before/after SHA-256 and size manifests cover 264 existing files: both variant directories recursively (including frozen source and named/stripped modules), the three released tools, parity harness and fixture, and canonical `build/wine-assembly.wasm`. All 264 remained identical. Manifests: `scratch/mig-fp-20261001-parity/{before,after}.json`.

## Remaining gates and next assignment

PCP parity is now closed; PCM's already completed parity was not rerun. PCM/PCP native captures remain missing for V8 and SpiderMonkey on ARM64 and x86-64, together with matching P controls and recorded engine versions/tiers. No new matched-work game runs or timings exist. Repeat-tool variant support has syntax coverage only. Browser P remains blocked by missing remote MW3 executable assets; prior browser evidence reports SwiftShader and no gameplay windows.

Exact next ready FP step, only after coordinator resource assignment: inspect `tools/bench-fp-native.js`, then capture matching P/PCM/PCP with `node tools/bench-fp-native.js node MODULE NAMED OUT` and `node tools/bench-fp-native.js sm MODULE NAMED OUT` into fresh directories, recording hashes, engine versions and tiers. First use local ARM64 structural captures; assign x86-64 separately on the retained box after confirming its ownership/state. Review counter spills, calls and dispatch before any paired fixed-work measurements. Alternatively the independent browser lane can restore only the missing assets and follow the old handoff's browser-p2 command after a separate remote/browser resource grant.

## Resource release

Parity tool session `43997` terminated exit 0. No emulator, browser, server, remote process or benchmark was launched. Worker board watcher session `29599` is worker-owned and stopped on completion. The coordinator retains all previously transferred FP source/artifact and idle remote-box claims. This worker releases its local correctness slot and its new note/evidence to the coordinator; it owns no continuing jobs.
