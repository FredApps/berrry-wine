# Antara original installer: corrected module, remote ordinary run

Owner: `codex:antara-browser-worker`, 2026-10-07. Findings only; root integrates this scoped commit. Shared checkout HEAD/index were untouched. No local browser/build, subagents, configuration changes, public deployment, fixture edits, binary patches, version overrides or capacity bypasses.

Actual outcome: **blocked at an unpainted installer Main Menu; no installed game or player-controlled gameplay**. The earlier `Setup Version Mismatch` dialog was absent during this run. This is progress past the previously visible error, not gameplay qualification or proof of the next root cause. Audio and FPS are unmeasured.

## Exact route and identity

- Temporary host `bx_d8nw3e8t` (`box-node-b72dc646c0120bf7`), Chrome 151.0.7922.108 stable, Node v24.18.1, headful Chrome with DISPLAY=:0, 1024×768, fresh browser profile, ordinary shipping Worker backend and 512 MiB guest memory.
- Source `/home/user/wt-daggerfall-mount-20261007`, commit `096889e174488a97529b8e73076d3a1e2feb2345`; generic NE version implementation integrated by root as `c7f8c5b4eecc9163e588cda88412a3f9e3c96458`. Coordinator supplied full-build/eight-regression PASS provenance; no rebuild here.
- WASM SHA-256 `fb1be916c309bf619a9331c8fd46c4319f9051af76b05b236d3c362bb632638f`, 1,720,492 bytes. Remote request receipt confirms the entire module response with that hash. Client consumption is explicitly not observable in the server receipt.
- Original `SETUP.EXE` SHA-256 `51f3ea06024d54734eef19344a2b79b89db78e73b68fc951fb3643b04a921e1c`, 32,592 bytes, with the unchanged original 23-file media closure (EXE plus 22 eager companions). No recovered child was injected. Private apps registration is the sole source overlay; original registration SHA-256 `857aa0a942efa5e20f72af89b94262eb236642068b452930c76c8bb9fbf6d68c`.
- 500 source/helper/fixture files verified locally and remotely before launch; per-file hashes: `scratch/antara-remote-original-20261007/transfer-files.json`. Source served from a separate remote prefix, never overwriting Arx evidence. Plan/driver copies and exact served request identities are retained in `evidence/`.
- Launcher: `node scratch/antara-remote-original-20261007/control.js launch`; remote driver command `/home/user/.nvm/versions/node/v24.18.1/bin/node /home/user/antara-original-20261007/browser9.js --slot-granted --automation-granted` with NODE_PATH=/home/user/wine-assembly/node_modules. The ordinary9 helper was adapted only for the remote source/pins/output and a file-backed command queue instead of TTY input. Screenshot review and ordinary Puppeteer input gates remain; no diagnostic hooks were added.

## Reviewed observation and first concrete failure

Session started 21:07:10.053Z with an absolute five-minute guard. Startup capture at 21:07:12.107Z showed a blank small Sierra setup window. A four-second wait produced `settled.png` at 21:07:19.267Z: Sierra frame plus a blank gray `Main Menu` window. An additional ten-second wait produced `menu-after-wait.png`, visually inspected and byte-identical to `settled.png` (SHA-256 `e9440af312b0d8f2f61240dac5e15d31ccc3e96a39185422fd13dbba6a541ebe`). There were no visible installer controls. No keyboard or mouse input was sent; `inputs.json` is empty.

Read-only window snapshot reports Sierra top-level HWND 98305 at (0,0), **8707×480**, and Main Menu HWND 98306 at (429,23), 595×435. The previous ordinary9 snapshot on d425 reported Sierra 640×480, Main Menu (0,0), and a visible version-mismatch dialog. The new anomalous width and missing menu content are useful investigation leads, not a proven cause. The two runs differ in source/module and host, so this is not a controlled visual A/B.

188 HTTP request rows were retrieved; no unexpected non-200/206 response rows (expected absent probes excluded), no served-source hash errors, cleanup errors or page exceptions. An ordinary console 404 is retained rather than suppressed. Screenshot/menu absence is the concrete progression blocker; these logs do not prove a guest crash, deadlock, or renderer defect.

Next source investigation should authenticate the original child's post-version-check control flow and the width supplied to its main CreateWindow path, then locate the point at which menu painting/control creation stops. Use original recovered source and existing tracing facilities; do not patch menu data, force buttons/exports or send blind input. No further browser session or generic source fix was attempted because this ordinary run did not establish a specific broken contract.

## Evidence and resource release

All paths below are relative to `/home/user/wine-assembly` and are local ordinary files, not remote links:

- Reviewed screenshots: `scratch/antara-remote-original-20261007/evidence/startup.png`, `.../settled.png`, `.../menu-after-wait.png`.
- Screenshot states, source pins, driver/registration, requests, inputs, console, session and cleanup: `scratch/antara-remote-original-20261007/evidence/`.
- Remote identity/hash check: `verification.json`; transport and launch receipts, full per-file manifest, host expiry and terminal receipts in the enclosing `scratch/antara-remote-original-20261007/` folder.
- A too-large initial transfer chunk failed before any browser launch with `E2BIG` from systemd-run. Preserved as `transfer-large-chunk-error.log`; normal 75 KB Arx transport then succeeded. A premature settled-image retrieval returned ENOENT; the later completed image was retrieved and hash-verified. Neither is a guest failure.

Arx release gate was respected: worker exit0 at 21:04:45.746Z plus terminal receipts confirming remote driver 49594/Chrome 49609 absent, browser/server closed and no sockets before any Antara remote modification. SSH was never attempted.

Antara ordinary quit closed at 21:08:00.467Z: complete=true, errors=[], all streams settled, Chrome exit0, three captures totaling 15,223 bytes. Terminal verification at 21:08:28.155Z confirms driver 57176 and Chrome 57189 absent, no owned sockets and no Chrome browser processes. Evidence was retrieved before removing only `/home/user/antara-original-20261007`; removal receipt is `remote-cleanup-receipt.json` (21:08:40.179Z). Local transfer archive was removed after verification/retrieval; local disk remained above 2 GiB. No runtime resource is retained by this worker.

**Host is retained and remote browser slot released for queued Q2. Host archive/expiry: 2026-10-07T22:51:07.784Z.** Do not stop/delete the host as part of this handoff. No gameplay review badge should be assigned. Antara has no exact manifest candidate ID in the currently inspected shared manifest, so evidence stays in this investigation rather than attaching to another game's dashboard entry.

Coordinator independently reviewed menu-after-wait.png: empty gray Main Menu inside Sierra setup; no visible actionable controls or gameplay.
