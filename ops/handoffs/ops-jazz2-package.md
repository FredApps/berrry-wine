# Jazz startup-only portable package ready for review

Owner `codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, OPS-GAME-FPS-BASELINE. Scope: new `scratch/ops-jazz2-package-20261002` and this handoff only. Original corrected Jazz fixture is unchanged; no network, transfer, browser, guest execution, build or install occurred. No subagents used.

The separate portable fixture preserves all12,339 current declared inputs plus the manifest (12,340 regular files). It excludes exactly the three pre-existing unused dangling `.bin/prebuild-install`, `.bin/rc`, `.bin/mkdirp` links and pins all247 remaining literal targets and contained realpaths. All12,340 original regular file hashes and all250 original links reverify unchanged. Full inventories and exclusion provenance are preserved.

The released GTA2 wrapper was adapted only for startup parameters and Jazz closure pinning. It verifies the exact manifest, external complete inventory and module before importing/loading the driver. It rejects unexpected regular files, missing/extra/escaping links, and corrupt pins. Resource/ownership/cleanup guards remain AST-identical; the main routine changes only its output directory. `remote-wrapper.patch` records the complete parameter/verification delta. The original driver does not accept a run ID, so wrapper attempt/launch records carry the new session/run identity while the unchanged report retains its author session.

| Item | SHA-256 |
|---|---|
|124,530,215-byte archive|`7a15604cf0bde54314004671f57d85dc3a27d8f496986260469361bc53d380bb`|
|Wrapper remote-startup.py|`71fcbfcf362d9969622041ca38288848c65c6916325597cad9f7bbcd1d8586a2`|
|Package inventory|`a317a03d75cd128aca459449bb54e6c407173c9b8a8407869c27ed0f7792914d`|
|Full portable regular/link inventory|`2fd2188cbbe33f131294829527d87196da18688d2ed8e8f0548bf8d7fd2f1816`|
|Corrected preparation report|`fcf5fe43c562945d3ebe9279e7a8ac3025b03dc4c51905d776ff518693f4b264`|
|Unchanged input manifest|`f22a9fd64be7f0df33eaf130a579be075028f6cba3effb9d6628c2c37066e2f0`|
|Unchanged WASM|`da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074`|
|Unchanged corrected driver|`fb2c9548eb1bbe3aad19c4b330e6255223d62a785c80c313e9041e5f4c1b575b`|
|Unchanged corrected analysis helper|`592fbe105e8163a9256c0891164c18943874a8126b2ace2140bb33d951797780`|

Archive contains12,357 regular members and247 relative links; every archived regular byte/link target was read back and compared. `package-receipt.json` is authoritative. Focused wrapper/provenance tests PASS: exact startup-only command, destination/run identity, inherited guards, full corrected-source closure, corrupt manifest/inventory/module rejection, four Python syntax parses. Existing scene tests were not repeated. Test48149 and archive82077 terminal exit0. No active handle/resource/approval remains.

Exact future recipe and acceptance limits are in `scratch/ops-jazz2-package-20261002/remote-package-recipe.md`. Fresh destination `/home/user/ops-jazz2-startup-20261002`; pinned Node24.18.1/Chrome path/DISPLAY=:0. Full hash/contained extraction check precedes three10s≥95% idle samples,≥4GiB available memory, actual versions/CDP GPU, thermal availability/free storage and no competing runtime. Preserve foreign jobs. Single exclusive attempt marker,600s body,≤60s no-input observation,20s cleanup allowance,650s owned-PGID ceiling, pre/post input verification and complete output hashes. No retries or automatic continuation.

Proposed invocation after root review, serialized owner release and an explicit future grant:

```sh
python3 remote-startup.py --verify-fixture fixture
python3 remote-startup.py --execute-reviewed-once
```

The command is explicitly `observe-startup`, not gameplay qualification. At most12 cinematic/startup snapshots occur; no key/mouse injection or telemetry arming is enabled. Result remains for human startup review, `performance:null`. Full gameplay/control/counter qualification remains outstanding; a future Escape or menu route requires separately reviewed evidence and authorization. **Package preparation is complete, but there is no remote/runtime grant in this handoff.**

## Authorized startup observation completed; ASCII released

Root's conditional one-run grant activated only after serious_review's explicit Unreal terminal/downloaded47hash/clean-residue release. Archive transfer65094 terminal0, verified extraction49039 terminal0, wrapper32166 terminal0, remote collection19712 terminal0, download74461 terminal0. Exactly one no-input startup run, no retry. Fresh preflight idle99.800/99.625/99.825%, MemAvailable7,274,548KiB; thermal unavailable/unknown. Node24.18.1 (V8 13.6.233.17-node.50), Chrome151.0.7922.108, existing DISPLAY=:0. Actual CDP renderer ANGLE Vulkan SwiftShader Device(Subzero), classified software diagnostic. Module da5bf93b and all12,339 inputs plus manifest247links unchanged afterward.

Owned PID/PGID578575; wrapper cleanupVerified:true, remainingKnownPids:[], outerTimeout:false. Terminal full process snapshot contains no Node/Chrome/Chromium/js/d8 runtime. Full artifact bundle SHA256 `8120606588c11ba610cd277454227b5038908ddadbf44f625f7046a5aaa1a369`,4,126,363 bytes; all42 listed artifacts verified remotely and after local download. Local evidence in `scratch/ops-jazz2-package-20261002/remote-artifacts/`, receipts `remote-collection-receipt.json` and `local-download-verification.json`. Explicit ASCII release posted to board/root/ops_review; no owned handles remain.

Driver started2026-10-02T22:08:58.655Z, finished22:09:55.761Z. Observation window55.097s within60s maximum,12 screenshots at nominal5s spacing; inputEvents0/inputs[], errors[], cleanupErrors[], captureErrors[]. Status startup-observation-awaiting-review; gameplayQualified:false, hardwareBaselineComplete:false, measurementEnabled:false, performance:null. Package/runtime source metadata retain original author/session provenance; wrapper runId identifies this coordinated attempt.

Owner directly reviewed all12 startup images:00 loading/teal desktop;01 Epic logo;02–04 changing checkered-plane/particle publisher sequence;05 black transition;06 Gathering of Developers logo;07–11 changing Jazz cartoon intro cinematic (green/red rabbits). This confirms sampled startup/cinematic progression, not title/menu/player control. No Escape or other input was sent. No rate is inferred from screenshot cadence. Actual cached client rectangle653×531 and exclusive-presentation mapping are preserved for later geometry review; no blind fixed crop correction was applied.

Next ready step is root visual review and, only under a new bounded grant, selecting an ordinary Escape during an explicitly recognized intro to discover the menu. Existing run has terminated and cannot receive input. No gameplay qualification or FPS result is claimed; the five-game baseline goal remains incomplete. The independent NFS3 conditional grant waits for the later Ricochet explicit release, not this Jazz release.
