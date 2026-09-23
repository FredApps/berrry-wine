# Arcanum demo

Registry id is `arcanum_demo`. The exe is `test/binaries/candidates/arcanum-demo/installed/arcanum.exe`, installed by the demo's own MSI. Load is slow because of the guest's own work. Text files are read byte by byte through `fgetc`, and every byte costs a full zlib `inflate()`. A 280s run reaches only about 23k batches at `--batch-size=50000`.

## It is a Direct3D 7 app by default (2026-09-23)

`tools/gfx-app-census.js` lists only `d3dim(name)`. A traced boot confirms that the default configuration uses it: `DirectDrawCreateEx`, then `IDirectDraw_QueryInterface`, then `IDirect3D7_CreateDevice`, `GetCaps`, `EnumTextureFormats`, and a set of `SetRenderState` and `SetTextureStageState` calls. The command-line switches `-no3d` and `-3dref` exist. The strings `3D: ...` are the log of its hardware renderer.

The main menu is the first screen that draws through D3D. It makes 260 `IDirect3DDevice7_DrawPrimitive(D3DPT_TRIANGLEFAN, FVF 0x1c4 = XYZRHW|DIFFUSE|SPECULAR|TEX1, 4 verts)` calls in batches ~16095-16104 at `--batch-size=50000`. These are textured quads, with no clicks needed:

```
node test/run.js --app=arcanum_demo --quiet-api --batch-size=50000 \
  --max-batches=16106 --max-seconds=280 --no-close --input="16105:png:OUT.png"
# WebGL arm: add --headless-gl --d3dim-gpu, and run under `caffeinate -d -u`
# (without it: "WebGL is unavailable" from lib/gpu-backend.js at the first draw)
```

Both arms give a **pixel-identical** main menu (`tools/png-diff.js`: 0 of 307200 differ). The WebGL arm reports `draws=260 triangles=520 fallbacks=0 errors=0`.

The gameplay route (crash site, gnome dialogue, HUD) needs about 41k batches of clicks driven over `--frozen --control-stdin`. See memory `project-arcanum-gameplay`. It was not re-run on the WebGL arm here, because at ~75 batches/s it is a long run.
