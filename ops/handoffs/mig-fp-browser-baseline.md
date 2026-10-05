# MIG-FP-BROWSER-BASELINE handoff

Owner `codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642` (`/root/ops_review`), 2026-10-02 UTC. **The restored frozen P fixture reached the MW3 cockpit, and the single authorized browser run completed all three samples with exit0 and no harness errors.** CDP identifies SwiftShader; this is functional, instrumented diagnostic evidence, not a hardware-GPU performance baseline.

## Fixture repair and identity

The entire remote `test/binaries/shareware/mw3/ex` directory was absent; the fresh `browser-p3` output was also absent. Restored exactly 43 local files, 91,850,841 bytes, to `/home/user/mw3-profile/repo/test/binaries/shareware/mw3/ex` using `rsync --ignore-existing --checksum`. No differing existing file was overwritten, no fixture substituted, and no dirty host/runtime source was copied.

All 43 remote file SHA-256 values match `scratch/mig-fp-browser-baseline-20261002/local-assets.json`. The existing frozen static-server helper, with the harness's `/binaries/` → `/test/binaries/` rewrite and isolation options, returned HTTP200 for `/binaries/shareware/mw3/ex/Program_Files/mech3demo.exe`. Downloaded bytes match EXE SHA-256 `df457ee6973f6f9d557c57aa3fc14258303486ec8b8742fd37b4369c1f37dbdc`. That temporary verification server closed in `finally` before the browser run.

Frozen P `../p-next.wasm` SHA-256: `bd854597ad90ce0e8023f2f6fec61d190c723cedffb3850d23bf147d1a54434b`, matching the original FP handoff and both native-capture controls.

Host: handed-off ASCII `bx_4r5uzdwv`, AMD Ryzen 9 9950X, x64. Actual Node v24.18.1/V8 13.6.233.17-node.50; Chrome151.0.7922.108. No EPYC comparison is valid. The original handoff describes the frozen runner lineage; this review records actual source hashes rather than claiming that the entire host equals a clean Git revision.

## Single run and reviewed outcome

Started `2026-10-02T01:01:13.921Z`, from `/home/user/mw3-profile/repo`:

```sh
DISPLAY=:0 CHROME=/usr/bin/google-chrome \
PATH=/home/user/.nvm/versions/node/v24.18.1/bin:$PATH \
node tools/bench-lazy-games.js --app=mw3 --shipped-default \
  --whole-profile --transfer-profile --seconds=20 --samples=3 \
  --wasm=../p-next.wasm --out=build/lazy-games/fp-next/browser-p3
```

No run was retried. Existing route drove pilot creation, Instant Action, operation map and deployment; its cockpit predicate confirmed sky colors and advancing triangles. I opened `route-cockpit.png` and `sample-2-after.png`: both show the cockpit, terrain, orange sky, radar, weapons/HUD and a visible mech. The cockpit clock advances from 00:00:07 to 00:01:08. This confirms the route and advancing simulation; it does not certify later mission completion, audio or every player control.

The original harness recorded three windows with 405,429,402 presents and advancing geometry, no within-window thread transitions, and `errors: []`. Raw diagnostic FPS values are about20.10,21.28,19.91. They remain in the preserved raw report only as observations: whole-profile and transfer-profile instrumentation are enabled, later windows also collect CPU profiles, and the renderer is software. No candidate comparison or speed conclusion was performed.

The console still records a nonfatal `stdole2.tlb` HTTP404. It did not prevent this route and was not repaired under the asset-only scope.

## Why the hardware assertion passed

Correction to the pre-run prediction that SwiftShader would necessarily stop before samples: the unchanged `validate()` assertion tests each guest's **`d3d.glRenderer` string**, not CDP's physical graphics information.

- Guest endpoint reports `ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6 (Core Profile) Mesa 23.2.1)`. This string passes the harness's negative regex for swiftshader/llvmpipe/software/unknown.
- CDP `SystemInfo.getInfo` reports `displayType: ANGLE_SWIFTSHADER`, `driverVendor: SwANGLE`, and `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver-5.0.0)`.
- Read-only frozen-source inspection finds `lib/d3dim-render-worker.js:49` obtains the WebGL renderer through `gl.getParameter(UNMASKED_RENDERER_WEBGL or RENDERER)`; `lib/d3d-render-worker.js:405` forwards it. No hardcoded Intel string appears in the inspected four renderer/command modules. The underlying reason for the browser's contradictory WebGL and CDP identities is not established here.

No assertion or source was bypassed. Treat this as a limitation of the frozen harness's hardware identification, not proof of hardware GPU use. No further run or investigation was started.

## Source versus served overlays

The harness deliberately constructs instrumented worker and GPU responses without editing the frozen on-disk sources. Original `lib/guest-worker.js` hash is `f2bcaf6fa41937c7f9936e8f965a871985034f6cf39593634d6ba44ebf4bdc38`; served worker hash is `7e16772d7d731345ad66eaf0ca457b0ff7b27e68852343fe78dc8b4a0969036f`. The exact served worker is saved in the run directory. The overlays add wait/run timelines, frame/counter capture and transfer-profile diagnostics; their presence means this is not an uninstrumented shipping performance run.

Original `lib/d3dim-gpu.js` hash is `c519658895064e217d0a97a17f404e369ba2886400452503fc91968970a3633e`; served instrumented GPU hash is `bb6b5043642e85ebca724b6602ff1a433cd96c34f112fdb150678e40d08fd9c9`. The raw report records source hashes and both served identities. Frozen harness hash `c13cc1b439e62ef73ec018e3a993999e332be225f0140afdda9c7a4ac169d890` and route hash `e4d8953688e12684c787f503b78701b52ea13f06e10fe6f644656b057a64febc` remained unchanged. All seven preflight-recorded source hashes plus P module were rechecked unchanged after execution.

## Artifacts and release

Local evidence root `scratch/mig-fp-browser-baseline-20261002/` contains the asset manifest, exact HTTP/hash verification script and result, frozen harness inspection, complete downloaded `browser-p3/`, terminal launch log, renderer-source observation and remote post-run hash/process observation. All **23 downloaded run artifacts** match remote SHA-256 values. Screenshots, JSON, console and page/guest/render-worker CPU profiles are preserved. Remote originals remain under the frozen runner; box and assets are retained.

MW3 has no candidate ID in the current candidate-corpus manifest, so this reviewed handoff is the authorized durable result; no bundle was attached to an unrelated candidate.

Harness exec94634 returned exit0; browser and server closed through its existing `finally` path. Post-run sanitized process filter found no node/chrome/Xvfb/js processes (grep exit1 means no matches; preceding hash commands succeeded). No broad kill or existing-service cleanup occurred. **Release the ASCII browser/CPU slot.** No variant timing or additional browser launch remains active.

Next authorized work is read-only copied-kernel planning requested by the coordinator, with P/P controls and PCM/PCP parity gates. This successful fixture route does not authorize a new optimization campaign or validate new variant game timings.
