# Review follow-up: Win16 rectangle GDI bridges

Scope: P5-3's near-duplicate Win16 `Ellipse`, `Rectangle`,
`ExcludeClipRect`, and `IntersectClipRect` handlers.

All four previously repeated five Pascal-word reads, HDC translation,
signed-coordinate conversion, 32-bit scratch-frame setup, AX narrowing and
ten-byte argument cleanup. One `$win16_gdi_rect_bridge` now owns that ABI
conversion; the existing ordinal-specific names select their original
Win32 GDI implementation. All word arguments are captured before switching
to the scratch stack. The source change removes 24 net lines.

`test/test-win16-rect-bridge.js` passes against the original and shared
bridges. It calls the real Win16 ordinal dispatcher for GDI 21, 22, 24 and
27, then compares results with Win32 GDI on a separate bitmap/DC. Cases
cover positive, negative, empty and reversed rectangles. Checks include
the entire rendered bitmap, clip membership inside and outside the region,
the returned AX value, ESP after removing the far return plus ten argument
bytes, CS:IP restoration, and closure of the 32-bit bridge. Nonempty shape
cases must actually change pixels; clipping cases must change visibility.

This establishes preservation of the existing Win32-backed operations,
not independent validation of every Win98 rasterization edge case. No
rendering algorithm or API success/failure policy changed.

Validation: full canonical/compat build passes at layout `da439e4cfa25a28d`.
The existing WEP gameplay test passes: Pipe Dream places its first tile
through the Win16 clipping path, and the Chrome Blackjack check still
rejects clicks on disabled buttons. Logs:
`/private/tmp/wa-win16-rect-build.log` and
`/private/tmp/wa-win16-rect-gameplay.log`.
