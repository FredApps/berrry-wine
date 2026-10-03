# GTA2 immutable browser qualification preparation

Owner: serious_review / codex:01a0f9db-89c0-73b3-b528-fe8bf239e061. Task OPS-GAME-FPS-BASELINE. Preparation complete, released to orchestrator; no browser, network, compile, upload or performance run performed. No runtime authorization is implied by binding.ready.

## Frozen inputs and preservation

Independent fixture: `scratch/ops-gta2-fps-20261002/fixture`. Source is accepted `scratch/nfs3-renderer-bench-20261002/fixture`: 9b4f9b3f plus validated audio capability slice. All 12,270 original closure files match both base and new copy after preparation. No Collapse timer/source transplant. All 73 original GTA2 installed files match source/copy; original assets untouched. Frozen registry `gta2_demo` resolves EXE, MSS32 and 69 data entries; exact descriptor saved in `registry-descriptor.json`.

EXE SHA256 `97ad743b6ec9ea1be95282053c3127084acd764a7f37a3e57e2268af52d02ae3`; MSS32 `0974b244354a5d13e0711db15430c05f7949dc279b63897146f304d1401153fc`.

Portable fixture contains 12,348 hashed regular inputs and 247 relative in-tree links. Three pre-existing dangling optional bin links excluded only from new copy, listed in `excluded-dangling-links.json`. Literal Node dependency inventory: 397 files / 1,032 edges, zero ancestor/external resolution. Sixteen unresolved optional/comment references exactly equal accepted Collapse closure: disabled ws native accelerators, optional color dependency, unused QuickJS variants and example strings. This is a static closure assessment, not proof all computed paths execute successfully. Whole frozen host/source/runtime/data tree is retained; no arbitrary scratch binaries added. `base-hashes.json`, `asset-hashes.json`, `node-closure.json`, `qualification-input-hashes.json`, and `qualification-links.json` provide per-file evidence.

## Route and input

Trusted browser Launch selects original `gta2_demo` registry descriptor. Require isolated visible running Worker backend. Wait for three menu candidates at 3-second intervals (up to 300 seconds), normal Enter held 500 ms, then three world candidates (up to 120 seconds). Capture world before input; arm raw diagnostics; normal Up 1 second, capture forward; Right 0.5 second, capture turned; Up 1 second, stop diagnostics, capture moved-after-turn. Each movement capture follows 300 ms settling. Every key releases in finally. Any lost worldCandidate immediately fails the route, including final image; no fallback clicks, forced redraw or arbitrary guest addresses.

Shipped readme describes Up as forward and Right as turn right (lines31–36). Enter world-entry comes from preserved browser route evidence, not inference from the in-game vehicle binding. See `ops-game-fps-desktop-routes.md`. Frozen `lib/browser-input.js:840` initially focuses canvas; 909–923 explicitly reclaims toolbar/Launch/select focus while runningApps is nonempty and admits event; 946 onward forwards keydown to renderer, and1066 installs capture listeners. No extra focus action is necessary. The driver uses Puppeteer physical keyboard events, not direct guest key injection.

Native crop is derived from actual exclusive presentation viewport and visible canvas bounds; require 640x480 native viewport. Unknown geometry preserves full screenshot and cannot pass admission. Color thresholds were calibrated against preserved `build/lazy-games/default-gta2_demo/menu.png` and `sample-0-after.png` with source hashes in `scene-calibration.json`; blank images rejected. These are heuristic appearance candidates, not continuous scene or player-state proof. Human review must identify player displacement relative to world and heading response across the ordered captures, with HUD/world retained. Image difference alone cannot establish control. All qualification booleans remain false pending review.

## Diagnostics, guards and tests

New private driver/helper only; `driver-from-collapse.patch` records changes from accepted reviewed Collapse driver. Served Worker overlay wraps originating raw DX kind5/6 using reviewed `ricochet-fps-analysis.js`, with bounded source-clock per-context events, arm/stop, drop and Worker coverage ambiguity reporting. No public onGuestFrame counting, no accessor clearing primary cache, no clocks merged. GDI helper is used only for read-only page metadata. Main Worker response preserves required isolation headers. Context changes/retirements are diagnostic, not a lifecycle metric certification. `measurementEnabled:false`, `counterQualified:false`, `performance:null` throughout. Historical GTA2 arithmetic semantics remain described in `ops-historical-fps-semantics.md`; no old rate carried forward.

Ten pure preparation tests PASS (`test.log`): closed measurement gate, exact registry/asset identities, native viewport, Worker requirement, isolation headers, historical menu/world versus blank, actual overlay/driver parsing, normal input order, no inputs on failed admission, and abort at each lost-world movement capture. `--verify-only` passes all12,348 input hashes /247links /module binding without browser import. `--audit-only` records overlay identity and parsing. No runtime test claimed.

Driver owns one ephemeral localhost server and one fresh headful browser profile, with no stale-process sweep. 600-second body deadline,30-second browser startup, bounded resource acquisition/late cleanup, final snapshot3seconds/browser10seconds/server5seconds. Coordinator should impose a620-second owner-only outer guard and grant a serialized resource slot before execution. No retained job is touched. Stop after first route result; no automatic retry. No active owned runtime exists.

## Proposed next command (not executed)

Set CHROME to an approved existing absolute browser executable. From transferred fixture root, after manifest verification:

```sh
CHROME=/absolute/approved/chrome node tools/qualify-gta2.js --phase=qualify --app=gta2_demo --max-seconds=600 --run-id=OPS-GAME-FPS-BASELINE:01a0f9db-89c0-73b3-b528-fe8bf239e061:gta2-qualification-01 --out=../qualification-01
```

Fresh output path is required. SwiftShader is rejected unless separately authorized with `--allow-swiftshader`; `--no-sandbox` only if approved execution environment requires it. Qualification does not depend on quiet timing, but needs exclusive assigned browser capacity. Inspect actual guest errors, menu/world captures, all input stages, Worker coverage and cleanup result. Current audio module compatibility with this route is not yet runtime established. Stop on concrete compatibility or geometry gap; no historical-module substitution or build.

## Final identities

- module: `da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074`
- input manifest: `4c17ade5a0a67e79b273ffb0584bcc11a089481a89c0217a96d8a2e31430803d`
- binding: `fcf8373f772a4e182cada7812d44d973640bd659326f4146607e4590555b5a7a`
- driver: `1c3e73b53ff726d7e8ce315a879e0d25b1f2e55d16bed617da33b4c3dec3b373`
- route helper: `a6f621918bf946a80f4c5f9dc7c32e825a2fa69c900388db06dacca8d52e9d20`

## Local portable wrapper/package release

Root accepted static driver and granted local package preparation only. Reused exact released Collapse wrapper `61ae7c9a10cd227542f3a3ce734f9ebc53e109e2bd33f11b05dddf32f8b76eec`. `remote-wrapper.patch` changes only destination, manifest/binding hashes, file count, full run identity and GTA2 driver/app arguments. All remaining function ASTs match the released wrapper; existing ownership, preflight and cleanup logic stays unchanged. Five changed-parameter/guard-equivalence/full-fixture/syntax checks PASS (`remote-wrapper-tests.log`); already-passed driver tests were not rerun.

Fresh destination `/home/user/ops-gta2-qualification-20261002`; full sequence and limits in `scratch/ops-gta2-fps-20261002/remote-package-recipe.md`. **650s owned-PGID ceiling supersedes prior620s proposal**. Three fresh10s samples each≥95%idle,≥4GiB memory, no competing runtimes, actual architecture/version/display checks plus thermal/storage records. No default execution; durable exclusive attempt marker permits one launch. Retained jobs remain untouched. Root final review plus explicit transfer/runtime grant and Collapse resource release are required before any network action.

Complete archive readback matched every regular byte and literal relative link; fixture verified before/after:12,348 pinned inputs,247 portable links, no unexpected files/drift. Archive has12,367 regular members plus247 links. Package creation session86252 terminal exit0. No runtime/control branch, browser, network, upload or module build executed; performance:null.

- bytes: `112321234`
- sha256: `6435164f07daf0b602cf15e6f625e1a15830c5ef73eb31fc297a128d126c0b8b`
- packageInventorySha256: `a00b26e2ae432093c14d06062db3c60dce1ef4248dde78d986e93ef659f91009`
- wrapperSha256: `c82c56d34698ee311fe1da3c4dd6fab102fc0b67b364d0d5a94e371d070ff353`
- sourceReportSha256: `8840f50519f7856bf1746f4b02902f4bc34c1e4f232f77bde67e56d6a40f51a6`

Exact final module/driver/helper/manifest/binding identities above remain unchanged. `package-receipt.json` is authoritative package evidence; `package-inputs.json` inventories members. Owner releases preparation, holds no local/remote runtime resources.

## Authorized single qualification completed and released

After explicit Ricochetv3 release and root acceptance of Jazz correction, boardACK/claim preceded fresh remote directory/transfer. Archive6435164f verified remotely before extraction;12,348inputs/247links/manifest4c17ade5/bindingfcf8373f PASS. One wrapper session43253 terminal0, driver0, no outer timeout; download81836exit0. All46artifact hashes verified locally; complete evidence in `scratch/ops-gta2-fps-20261002/download-01`, review in `run-review.json`.

Fresh idle samples99.5745/99.6748/99.7245%,availablememory6.936GiB; actualCDP ANGLE/Vulkan SwiftShader Subzero. Normal640x480 Worker route reached menu→world, performed Up/Right/Up and saved allcheckpoints, errors[]. Reviewed world-before-2/forward/turned/moved-after-turn clientPNGs: circle underplayer shiftswellabove afterUp, headingchanges afterRight whileworldstable, then circle returnswithlateraloffset aftersecondUp. This supports normal-input movement/turnresponse withHUDpreserved, pendingroot independentvisualacceptance; not imagehash-only reasoning. No gameplayFPS claim.

Raw diagnostic maincontextslot7 records106present and106Flip submissions,overflow0; secondguestcontextempty. Metadata stable. Coverage list conservatively reports both guestcontexts retiring during browsercleanup after completedarm/stop; preserve those flags, do not claim full lifecyclequalification. Driverbooleans remainfalse/performance:null.

Postrun all12,348inputs/247links unchanged,drift[]. TerminalcleanupVerifiedtrue,remainingKnownPids[], terminalprocesssnapshot noNode/Chrome/Chromium/js/d8. No ownedbrowser/server/SSHhandle remains; no retry. Root conditionalUnreal may follow only after this explicitrelease. Existing directories/services preserved.

Root subsequently independently verified all46 artifact hashes and reviewed ordered control images; sampled normal-input response accepted. This supersedes pending-root-review wording above, not the unqualified counter/performance limits.
