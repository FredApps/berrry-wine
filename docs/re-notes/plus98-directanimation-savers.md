# Plus! 98 DirectAnimation theme savers (CORBIS, FASHION, HORROR, WOTRAVEL)

`--app=scr_corbis` and its siblings `scr_fashion`, `scr_horror`, `scr_wotravel`.
They are thin MFC hosts for Microsoft DirectAnimation: after
`CoCreateInstance(CLSID_DirectDrawFactory)` -> `CreateDirectDraw` ->
`CreateSurface` they resolve `DirectAnimation.DAStatics` / `DAView` and leave
every pixel to DirectAnimation, which slides and crossfades JPG photographs. We
provide DirectAnimation as a WAT shim (`IDirectAnimationDAStatics_*`,
`IDirectAnimationDAView_*`, `IDirectAnimationDABehavior_*` in
`src/api_table.json`) over our DirectDraw.

## Status 2026-10-06

All four render on the CLI software path and in the browser (claude:65967384).
Reviewed runs: `scratch/runs/20261006T0620Z-<app>-w4-sw` (CLI) and
`scratch/runs/20261006T0640Z-<app>-w4-web` (browser). CORBIS's slideshow
advances: four cave tiles, then single photos (a snowy tree, then a wasp,
21.6% of pixels changing between captures).

```
node test/run.js --app=scr_corbis --no-close --quiet-api --max-seconds=45 \
  --max-batches=999999999 --stuck-after=100000000 --png=out.png
```

There is no Direct3D in these savers, so there is no separate WebGL arm: the
browser run is the second column.

## The trap: a missing JPG decoder looks like a missing DirectAnimation

The photos are JPGs, which `test/run.js` decodes on the host with
`skia-canvas`. On a box where that package was installed without its native
binary (`node_modules/skia-canvas/lib/skia.node`), `decodeMountedImage` throws
`decodeImage app assets require devDependency skia-canvas` before the guest
boots, and the saver never gets as far as DirectAnimation. That was the whole
blocker on the ops box. The fix is environmental: run the package's own install
step, `cd node_modules/skia-canvas && node lib/prebuild.mjs download`.

The earlier `IDirectDrawFactory` IID typo (`fa4be36a`, `{4FD2A833-...}`, not
`...823`) was the other half: before it, `CoCreateInstance` failed and the
savers idled on a black window.

## API profile (45 s of CORBIS)

`IDirectAnimationDAView_QueryInterface`/`_Release` about 10k each,
`IDirectAnimationDAView_DirectSlot008`/`009` about 5k each (one tick/render pair
per frame), a few dozen `IDirectAnimationDABehavior_*` calls at slide changes.
