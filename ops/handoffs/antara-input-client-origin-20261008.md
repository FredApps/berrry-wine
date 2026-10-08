# Antara actual client-coordinate packet mismatch

Task `NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006`. The resident DLL path repair is accepted as root `dad1f8c78` (worker `2e68d0ac4`), with actual original Sierra menu artwork restored. Installation and gameplay remain incomplete. Root requested a fresh thread after this measured input handoff; this worker implements no coordinate fix.

Ordinary input run `scratch/runs/20261007T235903Z-antara-input-map/result.json` uses source `2e68d0ac4c41ce3cf2f4745d94846c25ea4b0399`, WASM `0d647b4d9783c5f5d40700f4f7ae3ee18be12a95249daf68533f172b1e5dc8f3`, original media and original source Worker. No CPU exports, guest-memory reads, guest patches, artificial controls or API-return overrides. The existing renderer `onInputTrace` hook records at most 32 DOM/renderer snapshots over 15 seconds, forwards any original callback once with its receiver/result/error, and restores it at cleanup. This observes the host queue, not guest callback execution.

## Measured ordinary click

The only performed input clicks visible **Install** at browser `(411,167)`. The canvas is 1024x768, DOM rectangle `(0,0,1024,768)`, with no exclusive transform or presentation viewport. Main Menu HWND 98306 / `18002` is at window `(0,0)`, size 640x480, actual style `90c800c0`, and client rectangle `(3,23,634,453)`.

The press routes to that same HWND. `_directMouseDown` records origin `(0,0)`. The synchronous existing input trace captures these host-queued packets:

| Message | Recorded lParam | Decoded point | Required coordinate space |
| --- | --- | --- | --- |
| WM_NCHITTEST `0084` | `00a7019b` | `(411,167)` | Screen; correct |
| WM_LBUTTONDOWN `0201` | `00a7019b` | `(411,167)` | Client; expected `(408,144)` / `00900198` |

The [WM_LBUTTONDOWN contract](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-lbuttondown) defines its lParam relative to the client area. The actual renderer packet is Win32 before Win16 message translation. Its origin is therefore wrong by `(3,23)` in this observed captioned popup. `inputs.json` contains the pressed/released snapshots and the queued packet; `scene-1.json` and `scene-2.json` contain actual canvas/window geometry. The mouse-up trace records the cached origin and matching target, but does not capture a queued UP packet.

The original menu remains unchanged in `scene-1.png`, `scene-2.png` and `settled-after-click.png` (all SHA-256 `fad66b10fb7a27c9f05bc024a1470fe26918767e6c3dab9e794823082534a618`). The earlier run's white Uninstall highlight does **not** recur here. There is no installation completion, game launch, gameplay, FPS or audio qualification. Original guest callback consumption/application handling of this input is not measured.

## Source continuation

Inspect `lib/renderer-input.js` `_mouseMsgOriginScreen`, `handleMouseDown`, `_hitTestDeepChild` and cached-origin mouse-up routing, plus `src/10-helpers.wat` `$wnd_mouse_msg_origin_x/y`. The latter selects window origin for popup top-levels; the actual renderer also has a region shortcut. The trace establishes the selected origin and wrong packet, but does not identify which shortcut supplied it. Keep WM_NCHITTEST screen coordinates while fixing client mouse messages. Do not add a game-specific pixel offset or change painting/sizing.

Add a meaningful generic captioned-popup regression, preserve other control/dropdown/capture contracts, and validate original ordinary installation/gameplay after the fix. If actual guest callback state is required, use owning Worker RPC; do not run a shadow CPU. Keyboard `hwnd=0` is intentional for owning-Worker target resolution and does not prove missing focus. The prior source/JS preparation is `scratch/runs/20261007T234544Z-antara-input-map-preparation`; its final 23-artifact index and real asset-handler tests verify all 503 pins, private Antara registration, unchanged Worker and original SETUP before Chrome. Root's 240-second transfer cap allowed sequential known-size chunks; actual transfer finished in about 78 seconds with no retry/resume.

## Identity and cleanup

The contained run stores the full 503-pin runtime/media archive and per-member hashes, raw complete build source/module, actual input/screens/response logs and harness receipts. The initial index has 318 artifacts; a contained remote-release receipt is added before final publication. Driver 37937 / Chrome 37950 launch at 23:59:03 UTC on `bx_pm3beak3`; ordinary quit closes at 00:01:01.055, before the actual 120-second deadline. Browser/server close, Chrome exit 0, zero errors and zero pending streams. Exact detached driver exit status is not independently recorded.

Independent 00:02:53.961 check finds both actual PIDs absent, no Chrome, baseline sockets, 49.5 GB free and all 503 remote pins unchanged. After durable copying, only `/home/user/antara-input-map-20261007` is removed and sole remote ownership released at 00:04:58. Root owns box lifecycle (TTL 00:13:13) and retained `/home/user/tiberian-tools-20261007/node_modules/puppeteer`; all other prefixes are untouched. Local native ownership was already released at 23:30:58. No browser/native job remains.
