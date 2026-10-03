# Collapse v2 qualification package

Owner/session: `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`, `/root/ops_review`, 2026-10-02.

Ready for coordinator package review. Local preparation only: no network, transfer, browser, guest, build, runtime grant or remote resource claim. All tool handles terminal. Original v1 results, reviewed v2 fixture and released NFS3 fixture remain untouched.

Source: immutable `scratch/ops-collapse-mapping-20261002/fixture-v2`, reviewed driver `be0d24bd3f43c23d72604d896c94fc927049669ce6995caf2d2c661886322ca3`. Root's mapping/content/backing image and stage-deadline revisions are included verbatim. Binding `ready:true` licenses the frozen input identity; it is not a runtime grant or gameplay certification. Measurement remains disabled and `performance:null`.

The private archive is `scratch/ops-collapse-v2-package-20261002/qualification-package.tar.gz`, 113,613,734 bytes. Every regular member's bytes and every literal symlink target were read back and verified from the archive; no extraction or guest execution was needed. The source fixture was fully verified before and after packaging, with no drift.

| Artifact | SHA-256 |
|---|---|
| Archive | `0a2b59be96082381cda68512261ef375b5285ae1269bd3c385be0a9aefa640d2` |
| Wrapper | `0fee8c2c4e4035e48b6019a07c40959b9e8073378267b16097026c4e4b545464` |
| Package inventory | `5ec517303aef5bced4176ab5320bebe2dd8dabf4aa4eeeec8a3752d5d69b0745` |
| Candidate report | `3dc8a778c24aba7bd9046015ef47a1d52f6f5ec12bda27e5477da762fc4fb6d2` |
| Input manifest | `df201cf0afab9ffdf0f130f8e5a514fbc608cf96d4f15f75075aa38e04c362cb` |
| Module binding | `3b3beaf2d11d1919e8966cf002fb6723b84a7680c9bdc45ca9418f4243001682` |

Archive: 12,319 regular members plus 247 relative contained symlinks. Fixture manifest: 12,300 regular inputs plus separately pinned manifest/binding, with exact 247-link identity/containment gate. The remaining members are packaging provenance/tests, reviewed v2 evidence and original private timer-build provenance. Main WASM remains `1930e089068d43e0e42d4af2523f027ca97a389937507ef468c1950df117a146`; no rebuilding or asset substitution. Private installed assets remain local-only; this package is for the assigned private host, not publication.

`remote-qualify.patch` shows exactly five parameter changes from the accepted original Collapse wrapper: new destination, manifest, binding, 12,300-input count and unique run ID. Execution logic is unchanged. Six inherited pure containment/idle tests and three new parameter/provenance/attempt tests passed. The new command test replaces Popen before child creation and proves a second attempt fails at the exclusive marker. Full fixture verify-only passed. No original browser/helper tests were repeated.

Fresh destination: `/home/user/ops-collapse-qualification-v2-20261002`. Unique run ID:

`OPS-GAME-FPS-BASELINE:01a0f9db-07f4-71d2-9fe8-42d5efc7f642:collapse-qualification-v2-01`

After coordinator review, explicit serialized host release and a new transfer/runtime grant, the intended sequence is:

1. Create that fresh private directory, failing if it already exists. Transfer this exact archive; verify its SHA-256 before extracting. Preserve all earlier directories and host services.
2. Run `python3 remote-qualify.py --verify-fixture fixture` from the destination. This verifies all regular input bytes, manifest/binding, exact inventory and relative contained link targets.
3. Only under the runtime grant, invoke `python3 /home/user/ops-collapse-qualification-v2-20261002/remote-qualify.py --execute-reviewed-once`. Default invocation cannot launch. Wrapper pins Node `/home/user/.nvm/versions/node/v24.18.1/bin/node`, CHROME `/usr/bin/google-chrome`, DISPLAY `:0`, empty NODE_PATH and disabled optional native WS modules.

The wrapper launches exactly:

```text
/home/user/.nvm/versions/node/v24.18.1/bin/node tools/qualify-collapse.js --phase=qualify --app=collapse_crunch --max-seconds=600 --run-id=OPS-GAME-FPS-BASELINE:01a0f9db-07f4-71d2-9fe8-42d5efc7f642:collapse-qualification-v2-01 --allow-swiftshader --no-sandbox --out=../qualification-01
```

Fresh preflight records hostname/architecture, Node/V8, actual Chrome version, existing display, storage, process lists, thermal readings or explicit unknown. Three 10-second CPU intervals must each be ≥95% idle (iowait excluded), MemAvailable ≥4GiB, no competing scoped Node/browser/JS runtime. No previous idle sample authorizes launch. Actual CDP SwiftShader remains explicitly disclosed by the driver; this is a qualification diagnostic, not a hardware baseline or FPS measurement.

Exclusive `attempt.json` prevents any second launch. A fresh owned process group has a 650-second monotonic ceiling with an independent hard-kill timer; TERM grace stays inside the ceiling. Only that owned group is signaled. Known escaped descendants are reported as residue, not killed speculatively. Wrapper saves terminal/residue evidence, full input post-verification, setup failures and artifact hashes even when qualification fails. Reaping and artifact hashing follow the owned-group execution ceiling. Wrapper success and game qualification status must be interpreted separately.

After the single attempt: download complete artifacts, verify every hash, inspect terminal/owned residue and post-input identity, preserve all failures, and explicitly release to root/board/next owner. No automatic retry or dependent repair run. Root still must visually review actual mapping/content admission and sampled input response; previous source tests do not supply that runtime evidence.

Next action: root review of wrapper delta, package receipt and identities. No further preparation or runtime step is implied by this handoff.

## Single authorized v2 qualification completed

Session `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642`. After explicit Jazz terminal/download/hash/cleanup release, the sole granted v2 attempt ran in `/home/user/ops-collapse-qualification-v2-20261002`. No retries or source changes. Transfer66829/extraction27268/wrapper15988/collection62768/download92014 all terminal0. Driver exit0, no timeout, `qualification-candidate-awaiting-visual-review`, errors[]. The route reached menu, board-before, board-after and board-end with two ordinary clicks under observed backing/content mapping. Root visual acceptance is pending; no FPS claim.

All53 artifact hashes and bundle `2835a9500943903338e8fec6f0362c7d10c891257c953fb3c71a889f34db64b8` (12,813,224bytes) verified locally in `scratch/ops-collapse-v2-package-20261002/download-01`. Relevant images are under `qualification-01`: `menu-5.png`, `board-before-3.png`, `board-after.png`, `board-end.png`, plus backing/scene companions and exact result metadata. Full12300 input hashes/247 literal links unchanged before/after. Archive/pins matched the reviewed package.

Actual host is Linux x64 Ryzen9950X, Node24.18.1/V8 13.6.233.17-node.50, Chrome151.0.7922.108, CDP ANGLE/Vulkan SwiftShader Subzero driver5.0.0. Fresh three10s idle samples99.7999/98.8733/99.7249%, available7,261,088KiB. Browser GPU identity does not establish guest GPU rasterization. Performance remains null. Six originating contexts were armed/stopped; multiple contexts have GDI events, so no merged-clock rate or complete-frame claim. Surface/window metadata was stable. The generic retirement warnings must be read alongside worker events: cleanup retirement is distinct from completed stop receipts.

OwnedPGID586946 `cleanupVerified:true`, `remainingKnownPids:[]`, `outerTimeout:false`; current collection snapshot contains no Node/Chrome/Chromium/Firefox/js/d8 runtime. No live tool handles. **ASCII RELEASE for Collapse v2 is explicit after terminal/downloaded/all-hash-verified/clean-residue conditions.** This activates the separately granted serialized Ricochet measurement attempt; it does not authorize another Collapse run. Originalv1 fixtures/results and thisv2 fixture/artifacts remain preserved.
