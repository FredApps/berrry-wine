# MIG-RENDER-Q2: one software gameplay acceptance route

Worker `/root/fp_parity`, Codex `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`. Root-authorized single route completed 2026-10-02 01:02:10–01:02:48 UTC on `fast-near-9tb-1`. No rerun, profile, paired benchmark, optimization, source edit or performance claim.

**World rendering and the original scripted-W frame-change check passed. Physical traversal remains unproven.** Both screenshots were opened and reviewed: textured industrial world, weapon and HUD are visible; the later capture changes weapon pose and scene pixels. The short pair does not independently establish camera translation. No threshold was changed and no extra route was run to strengthen that claim.

## Exact route and provenance

From `/home/vg/universal-render-candidate`, the original command was:

```sh
QUAKE2_WEB_THREADS=1 QUAKE2_WEB_HEADFUL=1 QUAKE2_WEB_GL_RENDERER=software \
QUAKE2_BENCH_SECONDS=20 QUAKE2_WEB_OUT=/home/vg/mig-render-q2-20261002/route \
/home/vg/universal-render-deps/private-xvfb-run node test/test-quake2-gl-web.js
```

Existing Node v24.15.0, Chrome executable and dependency/TMPDIR overrides match the renderer handoff. `QUAKE2_BENCH_PROFILE` was explicitly absent. The executable and Chrome paths were checked before launch so harness `SKIP` could not masquerade as a pass.

- Canonical WASM: `fa0cb8a8bc80cdb1837ca32b2da00616f6ad6de2b0cbb237f4fe51235751cc22`, unchanged.
- Original harness: `a8f5c9b43ba547c2d565e8fe31500e6f20a371fcd1199d6c79bed382a1539f33`; local inspected bytes match remote.
- Registry twelve-file checkpoint and 144 protected source/compiler/module/fix hashes matched before launch. Extended pre/post provenance covers **284** source/runtime/helper files with no changes; 191 asset hashes are recorded.
- Empty-quad optimization remains excluded. No local WAT was transferred.

## Observed correctness

The original harness returned exit 0 with 640×480 worker snapshots, **6,205 colors** and **40,457 pixels changed** after ordinary `w` key-down for 1.2 seconds, key-up and a later capture. Write sequence advanced 32→38. The renderer has live software GL/legacy shared-worker endpoints; `fallbacks=0`, `glStaged=0`, and native common draw counters advance. At the end of the observation, reported completed common draws were 39,844.

No registry resident/transient budget error or host render fault occurred in this route. That establishes compatibility only for this scene/working set, not the new 32 MiB/64 MiB admission limits generally. Producer cumulative texture bytes and native cache bytes are not measurements of the registry's maximum live occupancy; do not treat them as that capacity proof.

The original 20-second harness observation recorded 17 completed GL publications. Raw timing fields remain in the original JSON for provenance only. This single route is neither paired acceptance nor a speedup result.

## Reviewed artifacts and cleanup

Dashboard run: `scratch/runs/20261002T010210Z-quake-2-demo-installer-mig-render-registry/`. Published `result.json` includes task/session identity, exact original execution times, command/environment, module/harness/source identity, reviewed screenshots and the physical-traversal limitation. Original harness output is retained as `harness-result.json`; no original metric was altered.

Full local download: `scratch/mig-render-q2-20261002/remote/`; wrapper and summary alongside it. Remote evidence: `/home/vg/mig-render-q2-20261002/`. Source/asset/environment pre/post manifest is `provenance.json`. Screenshots include main menu, game menu, gameplay before and gameplay after. All output was downloaded before resource release.

Run session76990 exited 0; download41484 exited 0. Post-run process scan found no route, Chrome or new Xvfb process. Existing Xvfb28507 and unrelated Node3155733 remain untouched. Only this worker's board watcher71317 was stopped at final handoff. The remote correctness slot is released to the coordinator; no continuing worker jobs or additional experiments.

The registry task's nine correctness suites plus this route are complete. Broader renderer migration, rebase, other game/backend coverage and performance acceptance remain separate coordinator work. Do not merge or enable unvalidated optimizations based on this bounded result.
