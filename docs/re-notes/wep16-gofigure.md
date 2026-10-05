# Go Figure! (Win16 WEP4)

App: `wep16_gofigure`, `test/binaries/wep16/WEP4/GOFIGURE.EXE`, VBRUN100.

## 2026-09-20: black label fields after parent exposure

The gameplay gate reached a positive puzzle target but found zero white
pixels in the bordered fields. Visual inspection confirmed black rectangles
in the puzzle row, score, timer and target, not a screenshot-coordinate error.
The fields are guest `ThunderLabel` windows, not native edit controls. Example:
wide HWND 0x10019, parent 0x10003, style 0x50810000, 30x30 client at (134,203).

The API trace shows VB correctly requesting white with SetBkColor(0xffffff).
The erase trace shows the child-exposure path using class brush 6
(COLOR_WINDOW+1). `win16_rearm_visible_child_erases` directly filled those
children and cleared their erase bit without entering their window procedures.
That shortcut bypassed VB's own background work. Class-brush availability is
not evidence that the guest has handled WM_ERASEBKGND.

An isolated full-source WASM with only that direct-fill branch disabled
restored white fields and passed the unmodified Go Figure gameplay gate.
Its screenshot was inspected: white bordered fields, legible score/timer/
target, and working puzzle buttons. Rodent/Rattler gameplay and WEP1 8/8
also passed this artifact. This matters because the shortcut was originally
introduced for VB paint ordering; see the historical status-panel section
of [the Rodent note](wep16-rodent.md). The later callback/validation fixes
mean that historical workaround must not be treated as today's contract.

The main-source change removes the direct fill and retains the exposure
erase request for BeginPaint's real far callback. It does not force a white
brush, special-case VB, or change the expected screenshot colors. The far
regression asserts that exposure retains the request even with a class brush.

Evidence in `/private/tmp/`:

- `wa-gofigure-win16.log`: API calls, including white background requests.
- `wa-gofigure-erase.log`: direct class-brush exposure fills.
- `wa-gofigure-trace.png`: black-field baseline, visually inspected.
- `wa-gofigure-no-class-erase.wasm`: isolated experiment.
- `wa-gofigure-no-class-erase.log`: Go Figure gameplay PASS.
- `wa-gofigure-no-class-erase.png`: restored fields, visually inspected.
- `wa-gofigure-no-class-erase-vb-gameplay.log`: Rodent/Rattler PASS.
- `wa-gofigure-no-class-erase-wep1.log`: WEP1 8/8 PASS.

Reproduction after a completed build:

```sh
WINE_ASSEMBLY_WASM=build/wine-assembly.wasm node test/test-win16-wep4-gameplay.js gofigure
```

This is functional paint evidence, not a native Win98 pixel-equivalence or
performance claim. Fuji Golf's separate player-name-control failure remains
open. Parent exposure message timing and ShowWindow's other documented gaps
still require separate work.

Final verification: normal and compatibility builds pass
(`/private/tmp/wa-gofigure-exposure-build.log`), as does the current-source far
regression (`wa-gofigure-exposure-contract.log`). After build completion, the
shipping artifact passes Go Figure and Rodent/Rattler gameplay again.
