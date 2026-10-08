# Tomb Raider II demo (Venice)

Core Design's 1998 Windows playable demo, `tr2_demo_02.exe` from
tombraiderchronicles.com, a WinZip SFX opened with 7z without running it.
Provenance and hashes: `test/binaries/candidates/tomb-raider-2-demo/provenance.json`.
Registry id `tomb_raider_2_demo` (localhost-only).

- `game/TOMB2.EXE` 909,824 bytes, sha256 `0811efa8...33aa`, entry `0x459630`.
- Data: `DATA\DEMOPC.DAT` (script) and `DATA\BOAT.TR2` (the Venice level),
  mounted at `c:\DATA\...`. `readme.txt` and `Settings.lnk` are not needed.
- Imports DDRAW (DirectDraw2 + IDirect3D2), DINPUT, DSOUND, WINMM and
  COMCTL32, which it uses for its options property sheet. The real
  comctl32.dll from `test/binaries/dlls` loads through `lib/dll-registry.js`.
  Without it (a fresh worktree is missing the gitignored DLLs) the sheet
  falls back to WAT stubs and looks like a wizard.

## Route (headless, default 200 ms/batch clock)

```
node test/run.js --app=tomb_raider_2_demo --quiet-api --quiet-blocks \
  --max-seconds=60 --max-batches=26001 --stuck-after=0 --no-close \
  --input=700:mousedown:379:398,720:mouseup:379:398,\
21000:keydown:37,22500:keyup:37,22600:keydown:38,26000:keyup:38,26000:png:out.png
```

| batch | screen |
|---|---|
| ~10 | options property sheet (Graphics tab: Hardware 3D Acceleration, 640x480 High Color, Z Buffer) |
| 700 | **mouse** click on OK at (379,398). `--input=N:dlg-cmd:1` reaches the sheet's hwnd but does not close comctl32's own property sheet. |
| ~6000 | Venice alley, Lara idle. No title menu in this demo. |
| 21000+ | Left turns her round to face the camera; Up then runs her down the other alley, where a doberman attacks and the health bar appears |

No emulator change was needed: it ran on origin/main 9c9dc59d, which already
had the TR3 fixes (MOV r32,CRn, the ACM driver enumeration, the D3D ZENABLE
default). Holding Up from the start position moves her only a step and then
she stops facing the slope ahead (not investigated); turning first and then
running is the clean movement check.

## Not evaluated

Audio, FPS, browser.

Evidence: `scratch/runs/20261005T224500Z-tomb-raider-2-demo-claude202b4b39-venice-fcf8f2f1`.
