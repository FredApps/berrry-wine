# Tetris for Windows (WEP1 / Win16)

## Gameplay regression correction — 2026-09-19

The old test's first failure required an active blue main caption while the
modal About DLL was open. The saved native Win98 reference has an **inactive
gray caption** at exactly that stage:
`test/output/win16-v86-comparison/wep16_tetris/native.png`, with capture/payload
metadata in `native.json` (2026-08-22). Current local captures show the same
activation sequence: gray during About, blue after dismissal. The test now
requires both states, rather than treating gray as missing paint.

Microsoft documents the active/inactive nonclient distinction in
[WM_NCACTIVATE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-ncactivate).
The native capture, not the modern documentation alone, is the evidence for
this particular Win98 modal state. This does not prove every About pixel is
native-identical: the native capture uses 16-color VGA and a taskbar, and
dialog background/text differences are outside this test correction.

The former piece assertions also assumed magenta followed by green. Fresh
captures instead show cyan/yellow or gray/cyan sequences. Gray is a valid
piece, so a saturation-only predicate is also wrong. The test now samples
nonblack colors from the active piece inside the black board and from the
Next preview (excluding its gray background), then follows those colors to
the settled piece and successor. The checked board areas exclude gray borders.

Timing matters: with the previous 200 ms/batch clock, removing Down still
allows gravity to settle a piece before the final screenshot. Use 20 ms/batch,
start via F2 at 55/56, capture at 150, Down at 170/171, capture at 230, stop at
245. This leaves time for spawn/painting without letting gravity substitute
for the hard drop.

The top-of-board pixel minimum changes from color-specific 250/400 to 100:
an entering piece may expose only one tile (149 nonblack pixels), depending
on shape/spawn phase. In exchange, the settled-piece check is strengthened
from >100 to >500 matching pixels (four tiles contribute 596), with an
additional exactly-empty bottom-before-drop check. The >600 changed-pixel
board assertion and all About-logo/client-background checks remain.

An in-memory negative variant with Down removed fails specifically at the
settled-piece check. Local logs: `/private/tmp/wa-tetris-corrected2.log`,
`/private/tmp/wa-tetris-no-down2.log`. No runtime behavior changed.
The complete WEP1 suite passes **8/8**, with two additional standalone Tetris
passes. Logs: `/private/tmp/wa-tetris-wep1-suite.log` and
`/private/tmp/wa-tetris-repeat.log` (plus the focused corrected run above).

```sh
node test/test-win16-wep1-gameplay.js tetris
```

## Initial erase versus synchronous UpdateWindow — 2026-09-20

Enabling synchronous Win16 UpdateWindow exposed a runtime ordering bug:
USER.42 ShowWindow(SW_MAXIMIZE) posted WM_ERASEBKGND for main HWND 0x10001;
USER.124 then painted the tiled client immediately; the queued erase later
reached USER.107 DefWindowProc and covered the tiles with the gray class
brush. The opening About logo survived, but its exposed parent was flat gray.
Trace: `/private/tmp/wa-update16-tetris-trace.log`; before/after captures:
`wa-update16-tetris-before.png`, `wa-update16-tetris-after.png`.

ShowWindow now completes its initial erase through a far continuation rather
than posting it. Tetris's existing startup-background and hard-drop checks
pass again, as does the full eight-game WEP1 suite. This was an emulator
ordering regression, not a reason to relax the native-reference assertions.
