# AoE2 graphics initialization diagnostic

The actual owner trace confirms repaired Unicode IID530 QueryInterface succeeds. Personally reviewed graphics-error.png still displays the DirectDraw initialization error. Twenty selected records have no observer errors, drops or ambiguity; completed factory/mode/surface/GetCaps calls return S_OK. This does not establish output/callback compatibility, and no causal repair is identified.

`scratch/aoe2-graphics-startup-20261003/analysis/review.json` records exact callers, unresolved ABI/callback observations and bounded pinned-EXE disassembly. GetCaps caller0x45e449 only sets optional flags and falls through to success even on failure; it is not an established rejecting gate. Graphics initializer0x45e1a0 feeds caller0x41d76d. Existing CreatePalette/CreateClipper metadata undercounts one argument relative to source cleanup, so the strict observer correctly leaves them unresolved. EnumDisplayModes callback returns are also unresolved. Do not reinterpret any as failure or fabricate completion.

A later bounded diagnostic must capture relevant outputs/callback completion or exact internal stage results, plus missing setup calls. No version/capability override or source repair is warranted yet.

Session87209 exit0, browser/server closed18:09:50.018Z, ps clear. All86 served-source checks pass; observer imports restored. No gameplay/response/FPS increment. Raw attempt1 remains immutable.
