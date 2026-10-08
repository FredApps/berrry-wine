# Quake II ordinary software OpenGL traversal, 8 October 2026

**Passed original `ref_gl` Game → Easy → forward/reverse/idle on the emulator
WAT software OpenGL backend.** This is one room and one traversal cycle;
combat, level completion, FPS, audio, and network play remain unqualified.

Run: `scratch/runs/20261008T000901Z-quake2-software-ordinary/result.json`.
All six screenshots were personally reviewed: `startup.png`, `game-menu.png`,
`loading-1.png`, `forward-1.png`, `reverse-1.png`, and `idle-final.png`.
Despite its filename, `loading-1` is actual textured gameplay with weapon,
crosshair, and health HUD. World was visible by 49.617 seconds after the
Easy-selection command at `00:10:32.460Z`.

Ordinary browser input was Enter 750 ms on Game, Enter 750 ms on Easy,
W 1000 ms, then S 1000 ms. Each key required its latest personally reviewed
scene receipt and live software-backend assertions. Forward brings the
diagonal support close enough to fill the central view and hide the emblem;
reverse restores the wider room, support base, and right-wall emblem. The
idle capture 24.642 seconds after the reverse capture retains that geometry.
`commands.jsonl` preserves actual command times. No console command,
`ref_soft` switch, forced control, guest-memory byte read/write, CPU-state or
export access, fake return, or asset patch was used. Host memory-size metadata
was read for the screenshot receipts.

## Backend and exact runtime

Every screenshot receipt records URL `gl-renderer=software`, host GL
endpoint 1 with `backend: software`, and matching GL endpoint options read
directly from the owning render Worker's JavaScript endpoint table.
`backend-path-proof.json` pins the exact selection chain. The unchanged
`gl-render-worker.js` passes that selection to `OpenGLHostBridge`; the
software branch directly constructs the WAT raster backend, without GL
WebGL creation or fallback. GPU-layer write sequences advance from 16516 to
18991, 20524, and 22173 across world/forward/reverse/idle.

The generic legacy endpoint 2 is also initialized with `backend: webgl`.
The generic GPU selector says WebGL, as does the synthetic GL renderer string
stored in `src/01-header.wat:746`. Those observations are retained explicitly;
the GL endpoint options and pinned software branch establish the tested
backend. This proof concerns the original GL workload, not every browser GPU
facility.

- Accepted reference source: `096889e174488a97529b8e73076d3a1e2feb2345`.
- Module SHA-256: `fb1be916c309bf619a9331c8fd46c4319f9051af76b05b236d3c362bb632638f`.
- All 325 unchanged host files match that Git object; with the module these
  are 326 source pins. All 66 original fixtures and seven harness files make
  399 pins, verified before launch and after the run. No mixed current host.
- Unchanged registry arguments: `+set vid_ref gl +menu_main`.
- Self-contained `runtime.tar.gz`: 42,063,295 bytes, SHA-256
  `7195b2d9d1f6c37fdf9d6e5c1caa12d629176f202769964a4965dc6fd7d1e4e7`;
  401 members include the pin/ready manifests. No duplicate fixture tree.
- The sole module GET was fully read, response-finished and settled with the
  exact SHA. This is host-serving evidence; client consumption is not directly
  observable. Fresh profile/no-store and instantiated Workers support identity.
- Chrome `151.0.7922.108`, Node `v24.18.1`, Puppeteer `25.7.0`, temporary
  `bx_624jbk9k`, hostname `box-node-b9a125c8b183a72f`, viewport 1280×900,
  game canvas 640×480, guest Worker memory 536,870,912 bytes.

This is a **fresh execution of the accepted reference build**, not a newly
built/current-main qualification. The separate WebGL run remains
`scratch/runs/20261007T213620Z-quake2-ordinary-traversal`; it was read for route
and identity, not repeated or presented as fresh software evidence.

## Budget, errors, and actual cleanup

Root's `2026-10-07T23:59:35Z` advance grant accepted this exact reference
closure and queued 240 seconds transfer, 600 seconds browser, and 90 seconds
cleanup reserve after Tiberian's actual release. Tiberian released at
`00:05:58Z`; independent `00:06:47Z` checks found its driver48726/Chrome48738
absent, no Chrome and baseline sockets. Existing-box TTL was insufficient.
Account limits passed before creating this fresh `--no-env` box with TTL1800,
expiry `00:36:50.382Z`. Preflight found no Chrome and 49,840,271,360 bytes free.
Local disk was below the 2.8 GB fresh-build floor; no fresh build/native game
or local browser was run and no disk-floor waiver was made.

Transfer took about 89 seconds and verified all pins before Chrome.
The actual browser session was `00:09:01.530Z`–`00:13:00.317Z`, within its
`00:19:01.530Z` deadline. Six captures total 2,593,727 bytes. Twelve refused
local unpinned VLAN publisher API requests are retained in `errors.json` and
`cleanup.json`; the strict host did not bypass them. No playback/network or
performance conclusion follows from this route.

Harness quit closed browser/server, Chrome exited 0, and zero streams remained.
This did not exercise Quake's guest Quit menu. At `00:13:24.966Z`, driver22023
and Chrome22035 were absent with no Chrome and no owned listening socket;
all 399 postrun pins still matched. Full runtime and captures were durably
copied and hash-verified before removing only
`/home/user/q2-software-20261007` at `00:14:11.396Z`. The box and private
Puppeteer `/home/user/q2-tools-20261008/node_modules/puppeteer` remain for root's
queued ownership/lifecycle until the recorded expiry. No public deployment.

Owner: `codex:q2-software-worker`, task `GLD3D-QUAKE2-SOFTWARE-20261007`.
Isolated branch `findings/q2-software-20261007` in
`/home/user/wt-q2-software-20261007`, initially prepared off origin/main
`699c1200a`; documentation rebased onto `5b77cf0df` before committing.
Shared HEAD/index untouched; root `codex:01a0ff91` integrates and pushes the
explicit three documentation paths. No production fix was needed.
