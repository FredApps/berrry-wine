# TriPeaks (Win16 Entertainment Pack)

## 2026-09-20: recursive paint reported as out of memory

The registered app is `wep16_tripeaks`. After accepting the player dialog and
pressing F2, the broken runtime showed an empty green board and an “Out of
memory” message. This was guest stack exhaustion, not exhausted WASM backing.

The Win16 API trace showed USER.124 UpdateWindow(hwnd 0x0107), returning to
guest 0x00102b2b, recursively entering the same wndproc at 0x00102a37. That
procedure calls USER.39 BeginPaint (return 0x00102aa6), loads its bitmap
(USER.175, return 0x00102ac1), paints through a compatible DC, then calls
UpdateWindow on itself **before EndPaint**. ESP falls by about 0x4a per
iteration (0x110da0, 0x110d56, 0x110d0c). Eventually LoadBitmap receives 0,
EndPaint receives a zero HWND, and the app reports OOM from 0x0010002a.
These are runtime guest addresses in the observed NE layout; the first code
segment is based at 0x00100000, not a PE image VA.

The runtime incorrectly left damage outstanding until EndPaint. Shared
BeginPaint now snapshots the update rectangle and installs the DC clip, then
validates damage before entering callbacks. EndPaint releases the DC without
validating the old rectangle: invalidation during painting belongs to the
next cycle, even if it covers exactly the same pixels. This follows the
[GetUpdateRect remarks](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getupdaterect),
which specify that BeginPaint automatically validates the update region.
No app-specific recursion cap or bitmap fallback was added.

Reproduce and capture with the completed build:

```sh
node test/run.js --app=wep16_tripeaks --no-build --no-close --batch-size=20000 \
  --max-batches=230 --max-seconds=40 --quiet-api --quiet-blocks --repaint-every=5 \
  --input='30:dlg-cmd:1,80:keydown:113,81:keyup:113,180:png:/private/tmp/wa-tripeaks-fixed.png,210:stop'
node test/test-win16-wep3-gameplay.js tripeaks
```

The fixed screenshot was visually inspected: all three card pyramids, the
white face-card row and stock/discard render. The gameplay gate passes and
now explicitly rejects the OOM message. Real far-callback regression coverage
also calls UpdateWindow between BeginPaint and EndPaint and checks that only
one WM_PAINT occurs; a second case preserves same-rectangle reinvalidation.

Evidence: `/private/tmp/wa-tripeaks-trace.log`, `wa-tripeaks-fixed.png`, and
`wa-begin-validation-tripeaks.log`. Restoring the earlier far-BeginPaint
fragments to e6782940 in an isolated artifact still reproduced the original
failure; this is not solely a regression in the later far-callback rewrite.

Go Figure's black puzzle fields and Fuji Golf's missing player-name control
are separate unresolved suite failures. This fix does not claim those green.
