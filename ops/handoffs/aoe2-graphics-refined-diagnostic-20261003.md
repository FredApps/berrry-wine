# AoE2 graphics diagnostic: initial setup succeeds, later palette stage implicated

Actual owning-Worker run2477 exited0; browser/server closed at2026-10-03T18:41:36.454Z, process-clear receipt confirms no remaining owned process. No production edits. No gameplay/FPS increment.

Evidence: `scratch/aoe2-graphics-refined-20261003/publication.json`, `validation.json` (46 hashed files), `attempt1/owner-api-snapshot.json`, `observer-validation.json`, `served-source-validation.json`, and personally reviewed `graphics-result.png`. Actual module f40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063. Observer ownership/cleanup passed; no capture errors/drops.30 selected API records,66 graphics events,56 actual mode-callback entries.

At actual initializer return0x41d76d EAX=1; parent0x41bf0b and0x41bf24 also show EAX=1/errorCode0. Actual surface descriptor800x600,8bpp,pitch800. Later MessageBox caller sees EDI17 and displays the graphics initialization error. Therefore initial DirectDraw setup did not take its failure branch. No broad graphics repair is justified.

Static resolution of actual app vtable0x61ff70: next slot+0x88→0x5a5d80→0x41d7f0→palette cache0x49f3b0→loader0x445f80. That stage loads resource50500, parses palette text, and calls GDI CreatePalette at0x446208. This is different from DirectDraw CreatePalette already selected in the trace. The null-return substep is not yet observed; error17 correspondence is an inference from exact caller branches, not a recorded palette-loader return.

The actual installed `Data/interfac.drs` contains resource50500, stored type`anib`, offset89676,size2872,SHA256 ebe1b14fddb8f2858cf98c93ebe6c04c72cc1097bb990e8fbbe3c5e32079cd2f; text begins JASC-PAL/0100/256. Presence does not prove the guest finds/parses it. Bounded disassembly and static member receipt are under `analysis/`.

Next diagnostic should focus this palette stage: actual resource lookup return, parser branch, GDI CreatePalette arguments/return, and parent stage return. Previously qualified initial graphics and mode callback probes need not repeat. No bypass, guest writes, API return override or guessed repair. Unobserved callback PCs remain unknown; test callback reachability with isolated actual canonical machinery before runtime.

Separate metadata proposal for DirectDraw CreatePalette/Clipper nargs remains unapplied and is not claimed as this error's cause. Callback redirection and existing Blt metadata also leave strict API completion unresolved; observed HRESULT0 is not fabricated completion.
