# ScummVM fullscreen: exact mode-return boundary for next diagnosis

The saved attempt1 console contains no SDL error/warning text before ExitProcess0. It does contain the display transition followed by audio teardown/exit; absence of forwarded stderr cannot disprove an internal SDL failure.

Matching official v0.8.0 sources:
- https://github.com/scummvm/scummvm/blob/v0.8.0/backends/sdl/events.cpp#L196 handles Alt+Enter with setFullscreenMode.
- https://github.com/scummvm/scummvm/blob/v0.8.0/backends/sdl/graphics.cpp#L742 tries SDL_WM_ToggleFullScreen, falling back to hotswapGFXMode on zero.
- The same graphics.cpp lines353–374 calls SDL_SetVideoMode and explicitly warns then quits if it returns NULL. This version does not roll back to the former mode.
- https://github.com/scummvm/scummvm/blob/v0.8.0/backends/sdl/sdl.cpp#L198 tears down graphics/audio via SDL_Quit and calls exit(0). Thus the observed zero exit code is compatible with a failed mode recreation; **this is a concrete hypothesis, not the live return-value proof**.

Exact pinned ScummVM binary confirms that path:0x402467 calls thunk0x6d9cd0→IAT0x86960c (SDL_SetVideoMode);0x40246c stores EAX into object+0x14, tests it at0x40246f, and branches past failure at0x402471 if nonzero. The zero branch loads the exact warning string at0x73319c, calls warning0x40985c then object vtable+0xe8 at0x402484. Full width/height/16bpp/fullscreen flag arguments are placed at ESP..+12 before the call. This is the smallest discriminating return boundary to observe.

Actual SDL driver remains **unknown** in existing runtime receipts. Static SDL.dll bootstrap table atpreferred0x100356cc tries `directx` first, then `windib` if unavailable. Do not call windib the current default driver merely because it is in the source: the explicit SDL_VideoInit("windib") code in ScummVM is under `_WIN32_WCE`, not ordinary Windows. Compiled export SDL_VideoDriverName at0x100262b0 reads current_video from SDLbase+0x3c440 and its first-word name pointer. A bounded pure mapped-memory read of those pointers/name can identify the actual driver without calling an SDL function or changing guest state. This same SDL build exports SetVideoMode atRVA0x26490 and WM_ToggleFullScreen atRVA0x28810.

Next proposed diagnostic, no runtime granted: preserve ordinary chord and clean exit observation, but capture exact owning SetVideoMode return EAX/arguments and current_video/name before cleanup, with mapped SDL/code/IAT identity. Use an existing bounded owning block-entry observation at the verified call-return boundary, after a real canonical-WASM fixture proves it fires; label trace cost diagnostic-only and avoid breakpoints or guest-function invocation. Record original normal return unchanged. If NULL, identify the underlying SDL mode callback's error return/standard-error output next; if nonzero, reject this hypothesis and inspect the later exit path. Capture terminal screenshot/state even after wine.running becomes false, so the diagnostic predicate cannot erase the useful termination evidence.

No general renderer heuristic change, fake fullscreen flag, config override, or repeated blind Alt+Enter. Source files/disassembly retained under `scratch/scummvm-av-20261003/fullscreen-source`; actual DLL/EXE hashes remain those of the immutable attempt1 pins. Fullscreen and music listening remain separate tasks.
