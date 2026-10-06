# Aliens versus Predator: Alien demo (Rebellion, 1999)

`lib/apps.js` id **`avp_alien_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/Alien vs Predator - Alien demo-D3D/extracted/avp_alien_demo.exe`
with `smackw32.dll`. DirectDraw + Direct3D, DirectInput keyboard; runs on the
software rasterizer headless.

## Getting the files

`AvPDemo3.exe` is a RAR 2.x self-extractor and the box's 7-Zip has no RAR
codec ("Unsupported Method"), so the extractor runs in the emulator:

```sh
node test/run.js --exe='<dir>/AvPDemo3.exe' --batch-size=200000 --stuck-after=1000000 \
  --max-batches=100000000 --max-seconds=200 --input=50:keydown:13,53:keyup:13 --save-vfs=<out>
```

Its dialog defaults to `C:\`; Enter is OK. Copy every archive member (not
`windows\` and not the SFX itself) to `extracted\`; `7z l -slt` gives the sizes
to check against (30 entries). Before ec58524f this stopped at `snd15.ffl`: the
whole extraction runs inside the OK handler, and the renderer's Enter sent that
IDOK as a nested `$wnd_send_message`, which gives up after 64 rounds
(`[sync] ABANDONED wndproc ... msg=0x111`).

## Route

```sh
node test/run.js --app=avp_alien_demo --quiet-api --batch-size=50000 --max-batches=4040 \
  --input='1800:keydown:13,1804:keyup:13,4000:keydown:37,4010:keyup:37' --no-close --png=/tmp/avp.png
```

Logos, then the main menu by ~1700 (Start Alien Demo / Controls / Video /
Audio / Exit); Enter loads the colony level (~2200-3300) into first person.
Left/Right turn; a 10-batch tap is a large turn.

## Open

Holding Up (forward) for 30+ batches turns the whole 3D view black, HUD
intact, and it stays black. Not yet diagnosed: it could be walking into an
unlit tunnel, which AvP's alien levels are full of, or a render failure that
starts when the camera translates (turning alone renders fine).
