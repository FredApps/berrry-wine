# Colin McRae Rally 2.0 demo (Codemasters, 2000)

`lib/apps.js` id **`cmr2_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/Colin-Mcrae-Rally2-demo-D3D/extracted/CMR2Demo.exe`,
mounted at `c:\cmr2demo\`. Manifest: `node tools/gen-win98-games-a-d-manifests.js`.
Direct3D 7 (IDirect3DDevice7 on a 640x480x16 flip chain), DirectInput keyboard,
Bink (`binkw32.dll`) for movies.

## Install (host-side)

The fixture is an InstallShield 6 Disk1 (`Setup.exe`, `data1.hdr`,
`data1.cab`, `data2.cab`, `ikernel.ex_`). IS6 starts its engine `ikernel.exe`
as an out-of-process COM server (`CLSCTX_LOCAL_SERVER`), which the emulator
does not provide, so Setup stops at "failed to launch installation engine".
Extract the cabinets on the host instead:

```sh
node tools/is-cab.js test/binaries/win98-games-a-d/Colin-Mcrae-Rally2-demo-D3D \
  --extract=test/binaries/win98-games-a-d/Colin-Mcrae-Rally2-demo-D3D/extracted
```

221 files, each checked against its descriptor's MD5.

The game quits at once ("Program finished normally") unless
`HKLM\Software\Codemasters\Colin McRae Rally 2` holds `Sku_Type` and
`Install_Version` as well as the two paths; `startupRegistry` in `lib/apps.js`
writes what the installer would (`Game_HDPath`/`Game_CDPath` = `c:\cmr2demo`,
`Install_Version` = `Full`, `Sku_Type` = `EUROPE`).

## Emulator fix it needed (1817ff91)

Every texture is created as a **DXT5 staging surface** (`DDSD_LINEARSIZE`,
`DDPF_FOURCC`), filled through Lock, then Blt into an ARGB4444 texture: the game
relies on the driver to decompress on Blt. DirectDraw now maps the DXT1-5
FourCCs to their own surface formats, reports `LINEARSIZE` + the FourCC from
Lock/GetSurfaceDesc, and decompresses on Blt into a 16/32-bpp destination.
Before it, every texture in the game was static noise.
`test/test-directdraw-dxt-blt.js` checks it against an independent decoder.

## Running it

- Boot: language screen; **Enter** picks English. The game then loops attract
  demos (Australia stage 5, Sweden stage 4) with "demo mode - press any key".
- Input is DirectInput `GetDeviceState` (polled 5x per frame); the key buffer is
  at `0x596128`. Default controls from `Controller.rcf`: arrows (DIK C8/D0/CB/CD),
  Space (39) and `1B 1A 2E 13`. `0x49f9e0` folds the buffer into menu flags:
  Left 1, Right 2, Up 4, Down 8, Return 0x10, Esc 0x20, F1 0x1000, F2 0x2000.
- WM_KEYDOWN queues the scan code (`0x4b7690` -> ring at `0x6e1e40`) and WM_CHAR
  the character (`0x4b7620` -> `0x6e1dc8`); the drain at `0x49f370` (ToAscii)
  is text entry. The "any key" scan at `0x49f3b0` is never called in the demo.

## Attract loop: what the keys do (2026-10-06, boat)

Language screen, Enter, then demos run back to back (Australia 5, Sweden 4,
UK 3...), each behind a "loading rally <country> stage N" screen on a flat
`0x9ab4a8` background that fades in from and out to that colour. Measured by
pressing one key at batch 490000 mid-demo (`--input=490000:keydown:K`):

- **Enter**: no effect at all; the frames match a no-key run byte for byte.
- **Space, Esc, Up**: freeze the demo frame, fade to the flat colour, open the
  front-end files (`Common.bfl`, `Res640.bfl`, `FERes640E.bfl`, the five
  language texts, `credits_english.txt`; it also writes `GameInfo.rcf` and
  `Controller.rcf`), then spend ~85k batches in zlib `inflate_fast`
  (`0x4c3ac8`; its `cmp ecx,0x102` is MAX_MATCH) with no API calls and no
  presents, and show the next demo's loading screen. Same with `tick-ms:5`
  from 491000, so this is not an attract timeout on a fast guest clock.

So no front-end menu frame was ever presented. A uniform capture after a key is
the fade or the inflate stretch, not a broken renderer: `--dx-surfaces` and
`--trace-dx` show nothing drawn there. Untried: a mouse click and the joystick
path, and pressing keys on the language screen itself.

## Open

- **No player-controlled gameplay yet**: the front end has to be reached first.
- Cars render solid black in the demos.
- The inflate page `0x4c3000` is rewritten while it runs: 6927 page
  invalidations, 4435 of which retired a block (a cost, not a correctness issue).
