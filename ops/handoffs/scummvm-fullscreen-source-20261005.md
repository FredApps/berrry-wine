# ScummVM windowed default versus fullscreen toggle

The launch is intentionally **windowed by default**, not a declaration that fullscreen is unsupported. Exact registered `scummvm_fotaq` arguments are `-pC:\games\FOTAQ_Floppy queen`, with neither `-f` nor `-F` (`lib/apps.js:2519–2531`). No INI/config file or persistFiles policy is declared in this five-file app closure. Matching ScummVM0.8.0 source `scratch/scummvm-av-20261003/source/detector.cpp:122` registers fullscreen=false; lines404–405 implement the fullscreen command option. Bundled `README.txt:444–445` documents `-f`/`-F`, and line626 documents **Alt+Enter** toggling fullscreen/windowed.

This says what a clean registered launch requests. It does not prove the contents of every possible runtime config file. A read-only VFS filename/config check in the next run can settle overrides without writing one. Queen engine `display()->fullscreen()` references elsewhere mean the game's picture-versus-panel layout; they are not automatically OS/browser fullscreen requests.

## Three different states must be observed

1. Guest ScummVM/SDL fullscreen request and its window/display mode.
2. Wine-Assembly exclusive/page presentation of that guest window.
3. Browser element fullscreen, requiring the browser's normal user gesture/consent.

Current-main source equals the already full-gated f5b222ee private runtime for all six relevant files (apps, renderer, both input modules, browser-shell,index); exact source hashes/ref are retained in `ops/release-evidence/scummvm-fullscreen-source-20261005/source-receipt.json`. Shared dirty files differ from main, so runtime must retain the pinned closure rather than silently serve them.

The renderer recognizes explicit DirectDraw exclusive HWND immediately. Otherwise it requires a DirectDraw layer or ChangeDisplaySettings fullscreen indication, a captionless/menu-less top-level window, origin/size checks, including **height>=440** (`lib/renderer.js:1007–1057`). A hypothetical fullscreen640x400 WinDIB window would fail that heuristic even with display-fullscreen set. That is a concrete source branch to inspect, **not yet the cause**: actual SDL driver, post-toggle dimensions/style and guest mode have not been captured. Do not widen it speculatively.

The browser reserves F11/F12 and Alt+F4 but not Alt+Enter (`lib/browser-input.js:843–862`). Renderer input has explicit Alt system-key handling (`lib/renderer-input.js:386`). That establishes intended routing, not actual guest receipt. Existing Oct3 Alt+Enter observation left the640x400 client windowed and consent hidden; it did not capture the guest display-mode decision and therefore cannot distinguish input, SDL mode failure or compositor eligibility. The more recent intro/audio routes deliberately did not retest fullscreen.

Exclusive presentation shows the normal **Use browser fullscreen** consent control (`index.html:983,1794`); a normal click invokes browser fullscreen. Missing browser fullscreenElement alone is not proof guest fullscreen failed. F11 expands the browser itself and is not evidence of a working ScummVM mode toggle.

## Smallest next ordinary check, after a separate grant

Use the existing pinned closure, no audio recording. Focus the visible game client by normal click. Capture pre-state: actual owning app/HWND, window/client/style geometry, active focus, renderer exclusive/declined state, guest display-fullscreen/exclusive HWND through established safe owning read interface, DOM fullscreenElement, consent visibility and any existing read-only config. Do not invoke shadow callbacks or mutate mode state.

Send a real chord: Alt down → Enter down →150ms → Enter up → Alt up. The current single-key helper cannot represent this chord, so add only that normal input command with finally-release semantics and a tiny forwarding test before runtime. Capture post-state/image after a bounded2second settle. If guest mode/page presentation changes, click the visible consent control once and check fullscreenElement separately; then repeat the chord once to verify return to windowed. Stop on unchanged state or new fault, preserving input and owner evidence.

Only if the keyboard path remains ambiguous, a later separate ordinary launch with documented `-f` can discriminate startup fullscreen from chord delivery. Keep original registered arguments unchanged; do not call guest display APIs directly or use F11 as a substitute. No general renderer patch is justified yet.

Music quality remains pending user listening to Telegram477; no repeat clip or new audio claim is part of this fullscreen plan.
