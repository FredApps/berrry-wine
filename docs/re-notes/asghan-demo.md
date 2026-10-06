# Asghan: The Dragon Slayer (demo) -- PARKED

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
