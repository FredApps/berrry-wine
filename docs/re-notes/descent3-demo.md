# Descent 3 demo (Outrage/Interplay, 1999)

`lib/apps.js` id **`descent3_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/Descent3 demo10-installed/installed/games/descent3demo/main.exe`
with the app-local `soar.dll`. The tree is what the demo's InstallShield 5 setup
writes to `C:\Games\Descent3Demo` when run in the emulator. Its `opengl32.dll`
is Microsoft's software GL client and stays out of the manifest so the
emulator's own OpenGL is used. Manifest: `node tools/gen-win98-games-a-d-manifests.js`.

- `main.exe` refuses to start unless the launcher ran it: `args: '-launched'`.
- Renderer comes from `HKLM\SOFTWARE\Outrage\Descent3Demo\PreferredRenderer`
  (2 = OpenGL); without it, "Generic renderer error".
- `soar.dll` is a static import whose six exports are all `xor eax,eax; ret`.
  App-local imports auto-load only for names in `lib/dll-registry.js`, so it has
  to be listed in `dlls`; unlisted, the IAT falls to WAT thunks and level load
  traps in `?SoarInit@@` (main.exe `0x48bbf1`).
- Input: keys and the menu mouse are window messages; DirectInput is used for
  joystick enumeration and for the TELcom/NEW GAME mouse (relmousemove +
  di-mousedown/up). A held keydown auto-repeats in the pilot-name field, so tap.

## Headless captures need `--gl-renderer=software`

Without it the CLI capture is a 2 KB blank frame.

## The 200 ms/batch clock breaks TELcom (found by claude:d10ba697)

`main.exe 0x48e168` (init `0x48e210`: step `[0x11480a0]=0.02`, accumulator
`[0x1148240]`) is a power-on catch-up loop: while `timer_GetTime() > acc` it
draws ~13 quads and adds 0.02. At the default 200 ms/batch the guest clock
outruns it, so it never flips (black TELcom panel, frozen cursor). The timer is
float32 seconds; past 524288 s `acc += 0.02` rounds to nothing and it hangs for
good. Run the whole route at a small `--tick-ms-per-batch`.

## Mouse: the game keeps its own cursor

Every frame the game calls `SetCursorPos(320,240)` and adds the `GetCursorPos`
delta to its own cursor at `[0x1831e78]`/`[0x1831e7c]` (clamped to the screen);
buttons come from `GetKeyState(VK_LBUTTON/RBUTTON/MBUTTON)` into `[0x1831e90]`
(poll at `0x4b44b0`). So an absolute `mousemove:X:Y` is read as a *delta* from
the centre and throws the game cursor somewhere else. Click a menu item by
reading `[0x1831e78/7c]`, sending `relmousemove` for the difference, then
`di-mousedown` / step 200 / `di-mouseup`. `SetWindowsHookExA` installs a
WH_KEYBOARD hook only.

## Route to in-flight gameplay (2026-10-06, claude:d44753dd, ~1.5M batches)

```sh
node test/run.js --app=descent3_demo --gl-renderer=software --quiet-api \
  --control=8187 --frozen --tick-ms-per-batch=20 --max-seconds=5400 --max-batches=100000000 \
  | grep -a -v 'EIP='
```

1. step 200000 -> "Enter Pilot Name"; tap W, 6, Enter (keydown/keypress/keyup ~20 batches apart).
2. step 30000 -> Configure; click OK (320,323) -> main menu.
3. click NEW GAME (455,184), step 50000 -> TELcom "Piccu Station / Incoming Message".
4. click POWER (538,460), step ~1.5M: "Loading level..." -> "Collating..." (an
   O(n^2) pass at `0x40e0f3`) -> cockpit.
5. In flight: hold `keydown:37` to yaw, `keydown:17` (Ctrl) fires the laser
   (energy 100 -> 099).

Evidence: `scratch/runs/20261006T1320Z-descent3_demo-gameplay-w6`. Run it on a
boat: the whole route is minutes of CPU and the box is memory-tight.
