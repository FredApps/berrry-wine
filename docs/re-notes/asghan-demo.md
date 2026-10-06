# Asghan: The Dragon Slayer (demo)

Silmarils, 1998. Fixture: `test/binaries/win98-games-a-d/Asghan-demo-SW-D3D-Glide.exe`
(13 MB), a **WinRAR self-extractor** (RAR 2.x payload: readme.txt,
_setup.exe, _start.exe, *.IO data, sst1init.dll, DirectX setup DLLs).

- Host-side unpacking fails: this p7zip has no RAR codec ("Unsupported
  Method" on every entry); no unrar/unar on the box.
- In the emulator the SFX reads its own head (`c:\asghan.exe` 0x0..0x20000,
  0x11600), shows its "Destination folder: C:\ / Extract / Cancel" dialog
  (resource "MAINDLG", DialogBoxParamA, dlgproc `exe+0x4031cc`), and needs
  `--stuck-after=0` (idle detector ends the run at the dialog otherwise).
- A mouse click on Extract (241,270) never produces WM_COMMAND: the
  press resolves to the dialog itself (`[input-route] down ... candidates:
  0x10002 dlg`), not to the button. `dlg-cmd:1` does reach the dlgproc's
  WM_COMMAND arm (`exe+0x403219` -> `exe+0x40329c`), but the SFX then ends the
  dialog, closes its archive and exits without opening any output file.

Next: why the Extract press does not hit the child button (hit-testing of
WAT-native dialog children created from this template), and what
`exe+0x40329c` checks for IDOK (it starts with `call 0x40d246` and returns 0
when that fails). Alternatively unpack the RAR host-side once a RAR-capable
extractor is available.

Status 2026-10-06: parked (claude:d10ba697); TODOS NEW-GAME-ASGHAN-DEMO-20261006.

## Un-parked: install, setup and gameplay (claude:202b4b39, 2026-10-06)

- **Unpack host-side** with node-unrar-js (the box's 7z has no RAR codec):
  the RAR marker is at 0x11600 in the SFX; 117 files, 28.9 MB into
  `test/binaries/win98-games-a-d/Asghan-demo-installed`. The in-emulator SFX
  Extract click is filed separately (SFX-DIALOG-BUTTON-HITTEST).
- **Install and configure in the emulator**: `_setup.exe` (Borland,
  `--dll-seed=CW3220.DLL,BWCC32.DLL`) offers `C:\ASGHAN.DEM` / Standard;
  Install copies all files, asks about a desktop icon (No), then opens its
  setup window; **Save setup** writes `_start.stp` (and `_start.cdp`,
  `app.exe` = a copy of `_setup.exe`). Without `_start.stp` the game does
  nothing. The registered tree is the extract plus those three files.
- **The blocker was a 16-bit file handle.** The game's Borland I/O layer
  stores CreateFile's result as a WORD (`movzx ebx, word [0x44e304]` at
  `0x401fd8`) and reads with `0xb` for our `0x7000000b`. Every read of
  `main.io` failed, sprite headers stayed zero, and the cursor blit at
  `0x441d9e` (`lodsb/test/jz/stosb/loop`, width from `[0x44e810]`) ran with
  ECX=0 for 2^32 iterations: 309 API calls, then a grey screen. Fixed in the
  VFS (636ffe63): a missed handle below 0x10000 aliases the Win32 handle
  with the same low bits.
- **Route**: `node test/run.js --app=asghan_demo --quiet-api --quiet-blocks
  --stuck-after=0 --input=25000:keydown:13,25100:keyup:13,35000:keydown:13,35100:keyup:13`
  -- title by ~20,000 batches, Enter -> menu (NEW GAME), Enter -> the pier
  level; Up (VK 0x26) runs the hero off the pier towards an orc
  (scratch/runs/20261006T2110Z-asghan-demo-gameplay). Space/Escape do
  nothing on the menu.
- Software renderer only so far; `_st_dx3d.exe` / `_st_3dfx.exe`, audio
  ("No AudioCD device" is logged and ignored), FPS and the browser are
  separate.
