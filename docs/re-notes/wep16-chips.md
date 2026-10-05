# Chip's Challenge (Win16 WEP4)

## Gameplay regression workflow — 2026-09-19

`test/test-win16-wep4-gameplay.js` formerly clicked screen (200,310), then
held Right under `--real-ticks` with a 700 ms host sleep. That click is not
merely an overlay-dismissal button: it steers Chip down the board and routes
subsequent keyboard input to the `BoardClass` child (HWND 0x10002). The old
test failed its >10,000 changed-pixel assertion on the current runtime.

Changing only the clock to `--tick-ms-per-batch=5` misleadingly passed:
26,700 pixels changed in the old ROI with **or without** Right, and both final
images were identical. The screenshot showed the board scrolling vertically
after the mouse action. This is not proof of working keyboard movement.

The corrected workflow dismisses the lesson overlay with Enter at batches
50/51, captures at 150, holds Right from 170 to 290, and captures at 280.
Use `--batch-size=20000 --tick-ms-per-batch=5 --repaint-every=5`, stop at 310.
With no mouse click, input routes to the main window. Visual inspection shows
Chip facing/moving right and the board scrolling horizontally.

The test runs an otherwise identical no-Right control. It requires identical
starting boards, zero board change in the control, and >10,000 changed board
pixels under Right. The board ROI (56,76,288,288) excludes all counter digits.
Measured: control **0**, movement **33,642** changed pixels. No guest/runtime
code is changed. The BoardClass focus behavior after mouse input is not
thereby proven native-correct and remains a separate investigation.

Verification: the complete WEP4 suite passes **7/7**. Removing the Right
keydown from the test in memory makes the board-movement assertion fail,
confirming the test no longer passes from startup/timer changes alone.
Logs: `/private/tmp/wa-chips-corrected-suite.log` and
`/private/tmp/wa-chips-no-right-negative.log`.

Local evidence: `/private/tmp/chips-probe.log`, `chips-fixed.log`,
`chips-control.log`, `chips-key.log`, `chips-key-control.log` and their PNGs.
Run the maintained regression with:

```sh
node test/test-win16-wep4-gameplay.js chips
```
