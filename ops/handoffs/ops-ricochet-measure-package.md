# Ricochet software measurement package

Owner/session: `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`, `/root/ops_review`, 2026-10-02.

Local package READY for coordinator review. No runtime grant, network, upload, browser, guest or build. The corrected measurement source fixture is immutable and verified unchanged before/after packaging. No owned resources or live handles remain. Conditional Collapse activation still requires the separate explicit verified Jazz release.

Source: `scratch/ops-ricochet-measure-20261002/fixture`, driver `2cda1323561a1de6d77d1d7542d0053102e2987fe1cb08842239326ca8d0e99b`, helper `47215153e8ae5ff2ba243d99f2828821a36c9d484d1e473c46357297a5566d21`. The accepted absolute operation-deadline corrections are included verbatim. Manifest covers 12,647 inputs plus the separately pinned manifest itself; the literal link inventory contains 247 resolving contained relative symlinks. No module, asset, lifecycle or timing changes were made during packaging.

Private archive: `scratch/ops-ricochet-measure-package-20261002/measurement-package.tar.gz`, 155,592,526 bytes, 12,663 regular members plus 247 symlinks. Full archive readback verified every regular byte and literal link target, with no extraction or execution. Original v3, corrected measurement fixture and prior packages/results remain preserved. Proprietary installed assets remain local-only; no public distribution is authorized.

| Artifact | SHA-256 |
|---|---|
| Archive | `ac0e7d0a3da4c8127b9c19f92503dce974bc5f07f4bffa859aa97411bef47ad0` |
| Wrapper | `651decbe87f976e4805cab16914ed729edc8c047cf8bc50c46dbab102d293012` |
| Package inventory | `bce998ede38579e61927329bb58423d50fe72a1679c9f990ba3b0d52df18a791` |
| Preparation report | `3aac4129967d794450667aae4aeb8aab8f4342fd9df3d1b40662a3d0b8f42484` |
| Input manifest | `0535842eb9622ddafbfddfe601ea9589cc136c38c7195c248445598d9f423599` |
| Portable link inventory | `4a2ccff5ae80094e74cfae722c221541d310cd06cc534be12e80e65483c9351f` |
| Unchanged module | `da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074` |

`remote-qualify.patch` is the complete adaptation from accepted Collapse v2: fresh path, manifest/count, external portable-link inventory plus explicit module pin instead of Collapse's module binding, exact measurement command/output, run ID in wrapper receipts and accurate 20-second cleanup metadata. Owned-process supervision, exclusive attempt marker, resource gates and post-run verification are unchanged. Five focused pure tests passed for identities, exact command/environment/owned-session parameters, exclusive-attempt refusal and wrong manifest/link/module pins. Popen is intercepted before child creation. Full input/link pre/post verification passed. Source tests were not rerun.

Fresh proposed destination: `/home/user/ops-ricochet-measurement-20261002`. Wrapper receipt ID: `OPS-GAME-FPS-BASELINE:01a0f9db-07f4-71d2-9fe8-42d5efc7f642:ricochet-measurement-draft-01`. It is recorded in `attempt.json` and `launch.json`; the frozen driver is not modified to add a new argument.

After package review, explicit serialized host release and a separate runtime grant, create that fresh directory (fail if present), transfer the exact archive **as `qualification-package.tar.gz`** to match the inherited wrapper's archive exclusion, verify its hash before extraction, then run `python3 remote-qualify.py --verify-fixture fixture`. The copied `portable-links.json` lives beside `fixture` and is independently hash-pinned. Execution is only `python3 /home/user/ops-ricochet-measurement-20261002/remote-qualify.py --execute-reviewed-once`; default invocation cannot launch.

Exact inner command from the frozen fixture:

```text
/home/user/.nvm/versions/node/v24.18.1/bin/node tools/bench-ricochet-guest-presents.js --phase=measure-draft --app=ricochet_xtreme --threads --headful --screen=640x480 --max-seconds=600 --allow-swiftshader --no-sandbox --out=../measurement-draft-01
```

Wrapper binds `/usr/bin/google-chrome`, DISPLAY `:0`, explicit Node24 path, empty NODE_PATH and disabled optional native WS modules. Fresh preflight records exact host/architecture, Node/V8, Chrome/display, storage/processes and thermal sensors or explicit unknown. It requires three 10-second intervals each ≥95% CPU idle, ≥4GiB MemAvailable and no competing scoped runtimes. Previous measurements or elapsed ownership time cannot substitute. Preserve existing services and foreign jobs.

One exclusive attempt only, no retry. The driver retains 600 seconds for route/body and bounded cleanup; wrapper's fresh owned process group has an independent 650-second monotonic kill ceiling with TERM grace inside it. Only the owned group is signaled; escaped/unproven groups are reported. Terminal evidence, known residue, setup errors, complete input/link post-verification and artifact hashes are retained. Reaping/hashing follow the execution ceiling. Future completion requires downloading/verifying all artifacts and an explicit clean resource release; wrapper return status alone does not prove usable measurements.

The driver performs the accepted route and short lifecycle qualification, then 20-second warmup and three target 10-second originating-clock windows. Actual source durations determine rates; only within-window raw Flip gaps enter pooled nearest-rank p95. Lifecycle/surface/context/overflow gates remain strict. Full-origin observer and arm/stop serialization overhead remain included. Actual SwiftShader is disclosed as CPU/browser software rendering; rates are instrumented guest Flip submissions, not displayed/unique FPS or hardware performance.

`performance:null` remains mandatory. Root must review all eight measurement checkpoints (warmup before/after plus each window before/after), raw lifecycle evidence, actual source durations, counters, scene transitions and context before accepting any metric. A scrolling/partial ticker remains unknown, not an invented fixed-round guarantee. No automatic publication or acceptance follows raw-data success.

Evidence: `package-receipt.json`, `package-inputs.json`, exact wrapper delta, package recipe, focused tests and archived accepted source provenance. Local verification86015 and archive/readback57024 terminal0. Next action is root package review; no further action is implied by this handoff.

## Authorized single measurement draft completed and resource released

Owner/session `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`. After explicit Collapse v2 terminal/download/hash/cleanup release, the sole conditional Ricochet measurement attempt ran in fresh `/home/user/ops-ricochet-measurement-20261002`. The exact local measurement archive was transferred as `qualification-package.tar.gz`. No retries, new variants, source changes, or local packing during this remote window.

Transfer61402, full extraction/verification26290, wrapper78385, collection99233, download32168 and local verification26489 all terminal0. Actual driver exit0, no outer timeout, errors[], status `measurement-draft-awaiting-root-review`, performance:null. All100 artifacts and bundle `78bb316abb187889516b963de36ddd4265f38bb24b8eb374b5f4ce2b2acc4ecd` (29,045,014bytes) verified locally. Complete evidence lives in `scratch/ops-ricochet-measure-package-20261002/download-01`, with raw source clocks/lifecycle/window records and eight checkpoints under `measurement-draft-01`. The root offline audit and visual review are still required before accepting or publishing any rate. This receipt does not claim measurement acceptance.

Fresh idle samples99.7499/99.6748/99.7998%, available7,272,676KiB. Full12647 input hashes,247 links, module and manifest unchanged before/after. OwnedPGID597376 cleanupVerified:true, remainingKnownPids:[], outerTimeout:false; collection process snapshot has no scoped Node/Chrome/Chromium/Firefox/js/d8 runtime. No owned live tool handles remain.

**EXPLICIT ASCII RELEASE after terminal, downloaded/all-hash-verified artifacts and clean residue.** Notify root and fp_parity: the previously conditional NFS3 single Glide qualification may now claim the resource under its separate grant. Prior fixtures/results remain preserved; no additional Ricochet attempt is authorized by this release.
