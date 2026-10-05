# WordZap (Win16 WEP3): display-DC publication

## 2026-09-20: black splash was a host publication lock

App ID `wep16_wordzap`, not the separate Win32 `cwordzap` game.
The unchanged `test/test-win16-wep3-gameplay.js wordzap` failed with copyright
ink width 600: the entire sampled rectangle was black, not a wide font.

Evidence from the pre-fix renderer and the completed 636e1da8-era artifact:

- `--trace-host=paint_begin,paint_end` shows two completed paints, then a third
  BeginPaint spanning the splash capture. This is not an unmatched-call leak.
- `--trace-win16` shows the guest polling USER.15 GetCurrentTime at return EIP
  `0x00102281` during that paint. After waiting/input it reaches EndPaint.
- Canonical GDI uploads succeed. The DIB contains gray frame pixels and green
  client pixels. A backing-canvas `getImageData` capture, which flushes the
  canonical surface, shows the complete splash, lightning and copyright text.
- The normal composite remains entirely black. `_workerPublicationHeld()`
  treated every BeginPaint/EndPaint lifetime as a global publication lock in
  both cooperative and Worker execution. Its modal-dialog exception did not
  help a timed splash with no dialog.

Earlier suspicion of repeated short paints starving rAF was too narrow: the
guest legitimately waits *inside* one paint. Publishing only at EndPaint would
still hide the splash for that wait. No font, palette or asset fix is needed.

### Contract and correction

Microsoft documents BeginPaint as obtaining a **display** DC with update-region
clipping, and EndPaint as ending the request and releasing the DC. It does not
define an implicit buffered frame committed at EndPaint:
[Drawing in the Client Area](https://learn.microsoft.com/en-us/windows/win32/gdi/drawing-in-the-client-area),
[Common Display Device Contexts](https://learn.microsoft.com/en-us/windows/win32/gdi/common-display-device-contexts).

The renderer now locks publication only while a Worker slice executes. A
completed slice may display pixels already drawn through a still-live paint
DC. This removes the modal-only publication exception as well. Paint lifetime
notifications/bookkeeping remain ABI-compatible; no guest message, DC clipping,
damage validation, font or gameplay-test threshold changed. The existing
slice guard still protects brokered mid-slice imports and rate-limited rAF
publication. Intermediate drawing may be visible between slices: this is not
an implicit double-buffer implementation.

### Reproduce and verify

```sh
node test/run.js --app=wep16_wordzap --no-build --no-close --batch-size=2000 \
  --max-batches=55 --max-seconds=20 --real-ticks --quiet-api --quiet-blocks \
  --trace-host=paint_begin,paint_end \
  --input='40:sleep-ms:1200,45:png:/private/tmp/wordzap-splash.png,50:stop'
node test/test-renderer-worker-repaint-boundary.js
node test/test-win16-wep3-gameplay.js
node test/test-winrar-candidate.js
node test/test-property-sheet-page-handles.js
node test/test-directdraw-native-child-overlay.js
```

All listed tests pass, including all seven WEP3 games and unchanged WordZap
splash metrics plus rack-letter gameplay. The renderer regression explicitly
requires publication before EndPaint in both schedulers, while continuing to
reject publication during an executing Worker slice.

Chromium cooperative browser captures show the splash and F2 game board:
`/private/tmp/wa-wordzap-browser.png`,
`/private/tmp/wa-wordzap-browser-game.png`. The resized browser splash clips the
left of its copyright line; that is a separate layout/mapping follow-up, not
claimed fixed here. These captures demonstrate visibility, not full browser
gameplay or absence of transient flicker in other applications.

The `--threads` browser probe also shows the splash
(`/private/tmp/wa-wordzap-worker-browser.png`); its readout still has paint depth
1, confirming that visibility no longer waits for EndPaint. The separate
`test/test-winrar-file-drop-web.js` passes with real Worker-mode WM_DROPFILES.
Both browser tools required approval to bind their local HTTP servers.
