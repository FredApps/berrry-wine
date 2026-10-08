# Sid Meier's Alpha Centauri (demo)

Firaxis / EA, 1999. 100-turn single-player demo. Registered as
`alpha_centauri_demo`. The retail ISO (v1 + v4 patch, BYO-media route) is a
separate investigation: [alpha-centauri.md](alpha-centauri.md).

## Fixture

- Source: `test/binaries/win98-games-a-d/Alpha Centauri demo-SW/smacdemo.exe`,
  a WinZip self-extractor holding an InstallShield 5 Disk1 (16-bit NE
  `SETUP.EXE`, `data1.cab`, ...) **and** a ready-to-run `programs\` directory
  (`terran.exe`, `sound.dll`, art, fonts; 513 files, 32 MB). Only `programs\`
  is kept: `unzip -q smacdemo.exe` then move `programs/` under the demo
  folder, and `node tools/gen-win98-games-a-d-manifests.js`.
- `terran.exe` imports only system DLLs (DDRAW, DSOUND, DPLAYX, MSVFW32,
  WINMM, comdlg32...); `sound.dll` is LoadLibrary'd from the game directory.

## Route (CLI, 2026-10-06, no emulator change needed)

Run with `--screen=1024x768`: the shell dialogs are laid out for a large
desktop, and at the default 640x480 the welcome box is cut off at the bottom.

1. Welcome ("Sid Meier's Alpha Centauri DEMO version") -> OK (345,550).
2. Main menu -> QUICK START (835,362).
3. "PLANETFALL!" (a random faction; this run Deirdre's Gaians) -> OK
   (706,738).
4. "Enter a name for your first base" -> OK (510,344); the colony pod founds
   Gaia's Landing; tutorial prompt -> Close (362,735).
5. Numpad 6 (VK 0x66) moves the active Scout Patrol one square east; the map
   reveals and the supply-pod hint appears.

Evidence: `scratch/runs/20261006-smac-demo-move`. The run burns ~2M API
calls per 10 s in its message loop (PeekMessage); pass `--quiet-api`.

## Open

Audio, FPS, the browser route.
