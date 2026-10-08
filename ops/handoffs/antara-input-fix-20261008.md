# Antara generic client mouse coordinates

Task `NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006`, worker `antara-input-fix`.
Isolated `/home/user/wt-antara-callback-20261007`, branch
`findings/antara-input-fix-20261008`, base `8dcc23ef7`. Prior branch preserved;
shared root HEAD/index untouched. DLL path repair `dad1f8c78` was already main.

`lib/renderer-input.js` now uses client coordinates for captioned popups,
including capture fallback and cached releases. Published USER geometry takes
precedence over the bootstrap region shortcut. Deep child delivery also uses
the target's client origin, matching capture and MSG.pt; the existing window
fallback remains available before the exports bind. Whole-surface regions and
borderless popup/menu clients retain coincident client/window origins.

`src/10-helpers.wat` mouse-origin helpers use the target client origin rather
than choosing window origin for every popup. MSG.pt converts client mouse
lParams back to screen coordinates; screen-space hit-test, non-client and wheel
messages retain their screen coordinates rather than adding the origin twice.
No painting/sizing or game-specific offsets changed.

Evidence is `/home/user/wine-assembly/scratch/runs/20261008-antara-client-origin-fix`.
The added renderer regression reproduces the original DOWN `00a7019b` rather
than expected `00900198`. A compiled negative control using the original HEAD
helper fails at origin `[0,0]` rather than `[3,23]`. Fixed tests cover the actual
captioned popup geometry, bootstrap/exported/region routing, press/move/release,
real USER SetCapture/ReleaseCapture, MSG.pt, signed child client coordinates,
owned popup geometry, borderless popup and menu surfaces. Existing region
move/resize, child Z-order, AdjustWindowRect roundtrip, native menu (14 checks),
dialog modal and dialog caption/child routing tests pass. A requested optional
worker-menu test is absent in this checkout; its failed invocation is retained
and is not counted as a pass.

Canonical `bash tools/build.sh` stops at the preexisting region-census gate:
`test/test-toyvm-paging.js: 0 -> 2 raw region literal(s)`, already in base HEAD.
No unrelated file was modified. A separately logged run excluding only that
failing gate passes all remaining mandatory gates and the WATX compile:
module SHA-256 `4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`,
1,721,405 bytes. This is a matching compiled module, not a full-build pass.
Root has been notified to resolve the baseline gate separately.

Local native slot claimed once at 00:12:11 with 2,834,591,744 bytes free and
actual CLI/build absence; released 00:14:22 after sequential tests/build.
Fixture calc.exe is an ignored symlink to the shared original fixture.
Original-media ordinary installation preparation will reuse the predecessor
503-pin harness/media package but regenerate every source/module pin from
this committed worktree, retaining the original Worker and private registration.
No remote transfer/browser has been started; Q2 owns the global browser slot,
and root queue grant plus independent actual cleanup preflight remain required.

Installation and player-controlled gameplay remain unqualified. The prior
ordinary menu click only measured the host packet; actual Antara guest callback
consumption remains unmeasured. Next run must use this matching source/module,
click the visible original Install control, inspect each resulting scene and
continue ordinary installation. Do not force controls, patch guest state, run
a shadow CPU, or treat menu artwork as gameplay.
