# ScummVM Alt+Enter reaches a display transition, then exits

Ordinary fullscreen-only attempt1, session38160, pinnedf5b222ee/module1a343c5f. Before input, owning Worker reads reported focus HWND65538, display-fullscreen0, exclusive-HWND0, mode-active0. Game host geometry646x427 at20,20; page exclusive=false, browser fullscreenElement=null, consent hidden. Stored mode640x480 while mode-active0 is not an active fullscreen mode.

Normal Alt+Enter was held150ms and both keys released. Exact UTC chronology from original console and input receipts:

- **17:07:11.613–17:07:11.767:** ordinary chord invocation/release.
- **17:07:11.634:** WM_SYSKEYDOWN for Alt and Enter logged.
- **17:07:11.636 /11.637:** SDL window ShowWindow twice.
- **17:07:11.657:** canvas1024x768→640x480.
- **17:07:12.183:** audio Worker thread2 exited.
- **17:07:12.184:** waveOut voice720897 closed.
- **17:07:12.196:** guest ExitProcess0 and Program exited logged; display restoration follows.
- **17:07:12.770:** browser/server closed, complete=true/errors[]. Driver exit1 records failed post-state snapshot, not an invented game trap.

The post-state getter ran after the guest disappeared and rejected “Exact owning ScummVM Worker required”; no after-state screenshot was captured. This does not support either “Alt+Enter ignored” or “fullscreen works.” Input reached a display transition and the game then terminated. The earlier640x400 minimum-height hypothesis is not established by this run; no renderer widening is proposed. Native API return/error and actual SDL driver still require identification. ExitProcess0 alone does not diagnose the initial mode-switch failure.

Raw: `scratch/scummvm-av-20261003/fullscreen-validation/attempt1`. Durable original before-state/input/cleanup/errors/source/module and event analysis with raw hashes: `ops/release-evidence/scummvm-fullscreen-toggle-20261005`. Original recordings/helpers unchanged; no audio capture, config override, forced guest mode or engine patch.

Next source step: match ScummVM/SDL mode recreation and error-exit path to pinned binaries. A future bounded diagnostic, only after review/grant, should retain failed mode-return/error and terminal state before owner cleanup, not repeat blind Alt+Enter. Capture terminal scene even if the expected live-owner predicate is no longer true. Music quality remains pending listening to the separately delivered later-intro clip.
