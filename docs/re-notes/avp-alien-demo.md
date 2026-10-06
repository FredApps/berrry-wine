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

## Walking and the "black view" (resolved: not an emulator bug)

Holding Up from the spawn point turns the 3D view black with the HUD intact.
That is the Alien standing nose-to-wall against the big hive-resin trunk
straight ahead, which is unlit: hunt vision draws it black. Evidence in
`scratch/runs/20261006T072800Z-avp-alien-demo-forward-walk`:

- `--trace-dx-raw` now prints each PROCESSVERTICES' depth range. The "black"
  frame still submits 89 TL vertices with sane depth (sz 0.68-0.99, rhw > 0);
  the nearest ones (sz 0.68-0.91) are two screen-filling quads the game lit
  `0xff000000`/`0xff020100`, in front of lit resin at sz 0.97+. The game drew
  a dark wall, we rasterized it.
- `I` (NAVIGATION vision) on the same route shows the resin texture filling
  the screen at point-blank range instead of black.
- DirectInput is clean: the keyboard buffer has only DIK_UP (0xC8) set, the
  mouse's buffered `GetDeviceData` returns 0 records, no joystick. The Alien
  only climbs with Crouch/Climb (RIGHTCTRL) held, which it is not.
- The 16.16 fixed-point idioms the walking-only blocks use
  (`cdq; rol eax,16; mov dx,ax; xor ax,ax; idiv` and `imul; shrd eax,edx,16`)
  are covered with negative operands in `test/test-x86-ops.js`.

What made it look broken is the headless clock. The game presents about once
every 5 batches, so at the default 200 ms/batch one frame is ~1 s of guest
time: a held turn jumps between coarse yaw angles (a mid-turn frame and the
frame after release can show the same view) and one forward frame carries the
Alien from open floor to the next wall. Walk at `tick-ms:10`, and switch it
some frames before the keypress so the first frame's dt is small too:

```sh
node test/run.js --app=avp_alien_demo --quiet-api --batch-size=50000 --max-batches=4461 --no-close \
  --input='1800:keydown:13,1804:keyup:13,3900:tick-ms:10,4000:keydown:100,4050:keyup:100,4060:keydown:38,4460:keyup:38,4100:png:/tmp/walk.png'
```

At 10 ms/batch Numpad4 turns a full circle in ~200 batches; 50 batches faces
the lit corridor, and walking covers it by ~4100 and stops at its end wall.
