# Die by the Sword (demo)

Treyarch/Interplay 1998 demo in
`test/binaries/win98-games-a-d/Die by the sword demo-SW+Glide/`: `dbts_demo.exe`
(v. Feb 16 1998), the `Rlapi.dll` render-library front end (static import,
which imports `SIMFORCE.dll`), the Glide back end `rl3dfx.dll`, and `data/*.atd`
archives plus `moves/`. No installer. Registry id `die_by_the_sword_demo`
(localhost-only; `dlls` = rlapi + SIMFORCE), manifest written by
`tools/gen-win98-games-a-d-manifests.js` (28 companions, subdirectories kept).

Imports KERNEL32, USER32, GDI32, ADVAPI32, ole32, WINMM, AVIFIL32, MSVFW32,
Rlapi, DDRAW, DSOUND, DINPUT. No emulator change was needed to reach play.

## Route (headless, default 200 ms/batch clock)

| batch | action / screen |
|---|---|
| ~400 | "Die By The Sword - 3D Hardware Detection" dialog: 3Dfx Voodoo / Do Not Use 3D Hardware |
| 500 | click (200,134): "Do Not Use 3D Hardware -- Use Software Rendering Only" |
| 600 | click (534,119): OK |
| ~19900 | main menu: Tutorial, Quest, Arena, Tournament, Options, Quit (Arena/Tournament greyed) |
| 20000 | `keydown:40` (Down) to Quest, 20400 `keydown:13` (Enter): Loading screen |
| ~60000 | Quest level 1: textured wooden hut, Enric seen from behind |
| 62000-74000 | `di-keydown:87` + `keydown:87` (W held): Enric walks to the barred gate |

Evidence: `scratch/runs/20261006T040000Z-die-by-the-sword-demo-quest-walk/`.

## Input

- Keyboard is DirectInput buffered (`IDirectInputDevice::GetDeviceData` on the
  keyboard device, ~4.6 polls per Flip). Send both `di-keydown` and `keydown`.
- **Arrow keys do not move the player.** They move the sword arm (VSIM
  controls, see `readme.txt`): W/S/A/D-style keys walk, Keypad 4/5/6 attack,
  Keypad 1/2/3 defend, Insert/Home/PgUp specials. A run holding Up arrow
  shows a pixel-identical frame to the idle run, which looks like dropped
  input and is not.
- Menus take arrows + Enter, and Escape opens the in-game options menu.
- The menu mouse is DirectInput relative. An absolute `mousedown` at Quest's
  shown position landed on Options. Not investigated; keyboard is enough.

## Captures

- Use end-of-run `--png-canvas --png=` for the startup dialog. A mid-run
  `B:png:` at batch 400 gives the bare desktop because it does not composite the
  GDI dialog. Mid-run captures of the DirectDraw menu and level are fine.
- About 46 Flips per 6000 batches in the hut on the software renderer.

## Glide (the dialog's default)

"3Dfx Voodoo" is the selected entry, so a plain OK (what a user does) loads
`rl3dfx.dll`, which imports `glide2x.dll`. In the browser that made the logos
and menu black (DBTS-WEB-BLACK-20261006). It looked like a Threads or lazy-file
bug and was neither: every 2D screen is written through the LFB, and
rl3dfx+0x10001ff4 calls `grLfbLock(WRITE_ONLY, BACKBUFFER, 565, upper-left,
FXFALSE, &info)` with `info.size` never written (a stale `.wav` from its stack).
The handler rejected size != 20, rl3dfx gives up after ten failed locks
(`cmp edi, 0xa`), and nothing reached the screen. Retail glide2x only checks
`size` with the debug-only `GR_CHECK_F`, so the handler no longer checks it.

- Headless repro: `--screen=1280x900 --input=700:click:854:329` (OK on the
  default entry). Before the fix the census is ~150 `_grLfbLock` and no
  `_grLfbUnlock`; after it every lock has its unlock.
- The CLI `--png` does not composite the Glide layer, so a Glide frame stays
  black there even when it is drawn: verify Glide pictures in the browser.
- The software-rendering palette fades are real: each logo fades in and out
  through ~670 `SetEntries` from the BMP's own colour table (logo object +0x3a,
  6-bit triples built at 0x46ff1e, faded at 0x470066). The CLI's 200 ms/batch
  clock jumps over them, so a mid-run capture shows the initial grey ramp.

## Open / not evaluated
- `ole32.dll` is not in `test/binaries/dlls`, so its imports fall to WAT stubs.
  This did not block play.
- About 310 caught C++ `file_error` throws per run (EIP 0x516460), probably
  probes for optional files such as the separate VOICEDMO voice pack. Not
  investigated.
- Audio, FPS, browser, Tutorial/Arena not evaluated.
