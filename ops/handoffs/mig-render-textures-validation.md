# MIG-RENDER-TEXTURES validation

Worker `/root/fp_parity`, Codex `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`. Completed 2026-10-02 UTC on coordinator-assigned `fast-near-9tb-1`, candidate `/home/vg/universal-render-candidate`.

**All nine serial correctness gates passed.** Registry code remains private/unmerged. No canonical build, WAT transfer, empty-quad optimization, gameplay run, profiling or performance comparison was performed in this task.

## Source and preservation

Started from the exact eleven-file plan manifest. Preflight found only retained Xvfb PID28507 and unrelated Node PID3155733; neither was touched. Every existing target prehash matched the recorded remote checkpoint. All originals were backed up before staging.

The saved canonical module remained `fa0cb8a8bc80cdb1837ca32b2da00616f6ad6de2b0cbb237f4fe51235751cc22`. All **144 protected files** remained byte-identical through staging, both fixture repairs and test completion: source closure, compiler implementation/helpers, canonical WASM/combined WAT, native software backend and four accepted DEF/fog fix files. Source-compiling tests used the unchanged remote WAT in memory; no canonical build outputs were written.

The final coherent source set is twelve files: the original eleven plus the coordinator-authorized `test/test-glide-render-worker.js` fixture correction. Exact source hashes and remote-before hashes are in `scratch/mig-render-textures-validation-20261002/final-manifest.json`. All twelve final remote hashes were also verified against the private local worktree.

## Results and bounded repairs

| Check | Result |
|---|---|
| `test-render-textures.js` | PASS immutable ownership, transactions, ordered retirement, native leases |
| `test-glide-draw-lowering.js` | PASS geometry/state parity and owned transport after stale clear fixture repair |
| `test-glide-render-worker.js` | PASS endpoint ownership, ordering, readback and teardown after stale clear fixture repair |
| `test-gl-resource-lowering.js` | PASS resource namespace, uploads/order, texture masks, client unpack and bounded workspace |
| `test-gl-resource-chunks.js` | PASS 24 native format/alignment oracles and workspace lifetime |
| `test-gl-software-neutral.js` | PASS native pixels, texture overlay, target alias ordering and explicit staging |
| `test-d3d9-software-texture-cache.js` | PASS native residency, mutation, async revisions, eviction/reset/destroy |
| `test-shared-render-worker-web.js --no-sandbox --swiftshader` | PASS actual GL/D3D9 GPU/software worker; one worker/termination/adoption |
| `test-glide-web.js --no-sandbox --swiftshader` | PASS WebGL1/2 mip/W-depth, gamma DAC and compositor |

The sequence stopped on each failure and preserved its log. Both failures were pre-existing test packet shapes: twelve-byte CLEAR mocks passed into a producer that requires a 332-byte packet with its CLR1 suffix. No production validation was relaxed.

1. In `test/test-glide-draw-lowering.js`, the CLEAR barrier now has the required suffix. Existing two-draw-group assertion remains, with an added exact decoded-clear assertion. Final SHA-256 `54507bc8d6f8e8b2dc54e5c9f5c24f360848353ed765f01914f7481ce72aef82`.
2. Root authorized the twelfth file `test/test-glide-render-worker.js`. Its CLEAR packet/submission/copy spans now cover the descriptor, with a decoded RGBA/depth assertion after guest-memory overwrite. Existing close/fence/pipelining/failure/ownership checks remain. Final SHA-256 `ba0d56535064177a6cc6a6072f7f8978a7d57a97e4a67c029e2468577866e336`.

The earlier empty-lease `releaseTexturePins` mock completion remains in the lowering fixture. Resume attempts started at each failed gate; unchanged passing suites were not repeated. The shared-browser log contains a non-fatal 404 console line, as the earlier passing checkpoint did; the full suite exits 0 and its rendering assertions pass.

## Evidence and resource state

Local evidence root: `scratch/mig-render-textures-validation-20261002/`. `result.json` aggregates the nine successful gates and final identities. `remote-final.tar.gz` preserves raw logs, every original/repair source, manifests, scripts, original failures and protected before/after hashes; its SHA-256 is recorded in `result.json`. Extracted evidence is in `remote-final/mig-render-textures-validation-20261002/`.

Remote evidence/backups: `/home/vg/mig-render-textures-validation-20261002/`. Initial `tests.json`, `attempt2-tests.json`, and `attempt3-tests.json` retain the complete progression. Final runner session83522 exited 0. Download session47695 exited 0. Post-run process scan found no test or Chrome process, only retained Xvfb28507 and unrelated Node3155733. Worker board watcher71317 remains only for the separately authorized next task and will be stopped on worker completion.

The remote correctness slot is ready for the root-authorized **separate MIG-RENDER-Q2** software world/movement acceptance route. This nine-test pass does not establish Q2 texture working-set compatibility or performance. In particular, the new generic GL registry's aggregate 32 MiB resident / 64 MiB transient admission limits still need gameplay evidence; they are not equivalent to the old unbounded JS Map. Keep the frozen module and source identities, exclude empty-quad, and make no speedup claim from the next single route.
