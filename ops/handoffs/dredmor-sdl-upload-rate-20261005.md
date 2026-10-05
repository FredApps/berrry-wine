# Dredmor: measured render-tail and canonical upload rates

On 2026-10-05, a reviewed Level1 gameplay route measured **11.7989 guest completed render tails/s** and **11.7991 canonical GDI window uploads/s** over one five-second window. These are separate diagnostic metrics. Physical-display FPS and qualified frame FPS remain unmeasured: there is no per-frame successful-presentation bijection proof. Equal aggregate counts do not establish one.

The raw run is `scratch/dredmor-fps-20261005/attempt4`, published as `scratch/runs/20261005-dredmor-sdl-upload-rate`. Durable metadata and counter rows are in `ops/release-evidence/dredmor-sdl-rate-20261005`. The publication keeps `performance:null`; its diagnostic fields and summary expose the rates without relabeling them to fit the existing FPS schema. Root and corpus_categories personally reviewed the before/after images: normal Down/Down/Up150ms inputs leave the player north-facing, move the terrain upward about64px net and reveal the southern doors. No menu or loading screen was counted.

## Exact evidence

- Private source45e3f361, production-shaped module40cc834b014b46a9ea5c81f21ee000a41e3a70c6422e70c8aa42f22407bfaced. This is not a current-main comparison.
-97actual served files match their pinned SHA256 values. Publication has68hashed artifacts plus its manifest.
- SDL.dll d0ec36883984665fe069301eddc2e2bd5fb345c0cec0c84537c187c9527d09af; live SDL base8421376, DIB callback8505136, HWND65537, canonical presentation6356993.
- SDL screen1024x768; canonical decorated window1030x795. Native host upload returned1 for the exact full-CLIENT rectangle `[3,23,1027,791]`. The frozen raw meaning string says “full-surface”; the separate measurement-review receipt clarifies that this is the client rectangle, not the whole decorated surface.
- Source-backed EXE counter60240c follows the SDL_Flip return. It advanced1716→1775:59tails/5000.485ms. The return code is not checked by that tail counter.
- Existing canonical presentation.flushCount advanced1666→1725:59uploads/5000.365ms. Uploaded-pixel delta46399488 equals59×1024×768 in aggregate. Dirty writes may coalesce, and this window counter can include chrome; no per-flush/full-frame conclusion follows from the aggregate.
-21bounded rows, no sample/input errors. Observation wrappers detached before sampling. Screenshots were outside the sample. Global HUD count also advanced59, but is not used as target-specific frame proof.
-Session68022 exited0; browser/server closed13:39:52.079Z, errors[], process check clear.

## Source and limitations

The observer validates six exact mapped SDL code spans after applying the file's HIGHLOW relocations, derives its base from the EXE SDL_Flip IAT, then reads a stable device/screen/callback/HWND chain using pure memory translators and atomic aligned words. It requires the DIB UpdateRects callback and non-doublebuffer surface. WAT10f-gdi-dc allocates a full-window canonical surface and translates client DC coordinates through the client-to-window origin; the successful native dirty upload independently matches that translation. The renderer clientRect mirror does not tag its WAT-versus-bootstrap source branch, which remains explicit provenance uncertainty.

The bounded reader uses the existing host-imports flushCount increment after putImageData, never an invented timer or page rAF FPS. The pre-sample host upload is asynchronous dirty publication, not a captured guest BitBlt/SDL HRESULT. Actual host-upload, RPC broker, renderer client geometry and memory mapping tests passed13groups before the run. Reusable private observer sources are frozen in the run alongside their exact provenance; no production telemetry or engine code changed.

Prior attempts remain immutable: attempt1 lost setup time to manual operation, attempt2 identified actual SDL branch and declined GL, attempt3 rejected an incorrect client-versus-window size equality. They are harness/backend diagnostics, not evidence of a broken game. The final sample closes the missing-sample gap only. The FPS task's remaining blocker is **per-frame successful-presentation attribution**, not missing gameplay or missing counter data.
