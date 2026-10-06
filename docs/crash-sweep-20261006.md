# Registry crash sweep — 2026-10-06

Task `SWEEP-CRASHES-20261006` (claude:90024109). **Parked** 2026-10-06 03:15Z for
OPS-DASHBOARD-REDESIGN; resume from "Next" below.

## Method

`node tools/crash-sweep.js --all --no-build --seconds=15 --jsonl=<file>`: one
headless `test/run.js --app=ID --quiet-api --max-seconds=15` per `lib/apps.js`
id, strictly serial, classified from run.js's own output. Build: origin/main
`2dab0b06`, wasm md5 `6a92e26d…`. Raw results:
`scratch/runs/20261006T0220Z-crash-sweep/sweep.jsonl` (255 ids; the 22 ids
that first came back as instant `ok` were rerun after the classifier learned the
environment-gap classes, and the last line per id wins).

15 s of startup is all this sees: a crash past the first menu, or behind input,
is out of scope. `stuck` means run.js's idle detector ended the run (the app
was waiting for input), which is the normal state of a GUI app at rest.

## Ranked table

| # | signature | apps |
|---:|---|---|
| 160 | `ok` (still running at the deadline) | — |
| 79 | `stuck` (idle, waiting for input) | — |
| 4 | `exit:0` | write, welcome98, pocket_tanks_installer, icy_tower_installer |
| 4 | `missing-dep:skia-canvas` (box lacks the devDependency) | scr_corbis, scr_fashion, scr_horror, scr_wotravel |
| 3 | `trap:unreachable` | wep16_tetravex → **fixed**, nfs3_glide_demo, diablo2_glide_demo |
| 2 | `missing-files` (fixtures not on this box) | nfs2se_glide_demo, baldurs_gate_interactive_demo |
| 1 | `unimpl:CreatePipe` | winboard |
| 1 | `unimpl:DllRegisterServer` | explorer98 |
| 1 | `unimpl:PathAppendA` → **fixed** | dungeons_of_dredmor |

## Fixed

- **dungeons_of_dredmor** (Steam beta): `PathAppendA` (api 4102), then
  `PathFileExistsA` (api 4103), both over the existing W cores. Reaches its
  launcher: `scratch/runs/20261006T0305Z-dredmor-beta-path-apis` (reviewed).
  Commits 0c9cd8c9, 148ea318.

- **wep16_tetravex**: Tetravex hands every WM_PAINT to DefWindowProc. The
  shared `$defwndproc_paint_erase` allocated a transient DC and sent
  WM_ERASEBKGND with it, but a 16-bit procedure cannot be entered from inside
  that call, so the send was queued and the DC released before delivery. The
  procedure got a dead DC (the board never drew) and narrowing it took a new
  Win16 handle-map slot per paint until `$win16_h16` trapped at batch 20311.
  Win16 procedures now get the window's synthetic client DC (hwnd+0x40000), as
  the Win16 pending-erase path already does. Board renders, 30000 batches
  clean: `scratch/runs/20261006T0400Z-wep16-tetravex-handle-map`;
  `test/test-win16-defwndproc-paint-dc.js`.

## Open, with what is known

- **nfs3_glide_demo / diablo2_glide_demo** (now GLIDE-DRAW-BEFORE-OPEN-20261006, claude:202b4b39) — the same trap: `$glide_record`
  → `$glide_fail` because the Glide context is not open (state +12 is 0) when
  `grBufferClear` (NFS III) / `guGammaCorrectionRGB` (Diablo II) record a
  command. NFS III's thrash driver `voodooa.dll` resolves `_grSstWinOpen@28`
  by `GetProcAddress` but never calls it before `grSstQueryHardware`,
  `grSstSelect(0)`, `grRenderBuffer` and `grLfbLock` (return 0x00b325aa /
  0x00b32f6b in voodooa). **Not a regression from the Myth Glide work**: the
  pre-8cd80d5a tree plus the CLI loader fix 09e9b09f traps identically; before
  09e9b09f the CLI never got this far. Root cause: nfs3demo.exe's renderer
  switch (0x4b3f60, jump table 0x4b3f34) sends cases 3/4 to 0x4b4058, which
  calls THRASH_setstate/clearwindow without THRASH_setvideomode, so the clear
  legitimately precedes any grSstWinOpen (harmless on a real Voodoo 1 after
  grSstSelect). Handed to the Glide owner (board 2026-10-06T03:42).
- **winboard** — `CreatePipe`: no pipe object exists in the emulator; WinBoard
  wants anonymous pipes to a chess-engine child. Needs a real pipe handle type
  with ReadFile/WriteFile/PeekNamedPipe, not a stub.
- **explorer98** — `DllRegisterServer` reached our fail-fast handler after
  15 s; which module's export resolved to the thunk is not yet known
  (`--trace-stack` on it next).
- `exit:0` rows were not reviewed; installers exiting 0 at startup may be
  legitimate (already-installed checks).
