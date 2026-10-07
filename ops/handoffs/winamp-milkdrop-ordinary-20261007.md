# Registered MilkDrop ordinary launch

Root reviewed a remote browser run of the registered Winamp 2.91 and
MilkDrop 1.04e originals on module
`7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0`,
source `0cbc1c6ffd`. The manifest pins 326 source files and 12 original fixtures;
the transport package additionally contains seven harness files.

Ordinary input enabled Repeat, pressed Play, opened preferences with Ctrl+P,
selected Visualization / MilkDrop 1.04e, and pressed Start. Playback indicators
and spectrum activity were visible. MilkDrop created its window, then Winamp
displayed “Plug-in executed illegal operation. Restart of Winamp is recommended (2)”.
This advances beyond header enumeration and the historical music-required gate,
but does not qualify visualization, audio quality, FPS or either rendering backend.
The exception address and failing API are not captured; no D3D cause is inferred.

Evidence is self-contained in `scratch/runs/20261007-winamp-milkdrop-ordinary/`:
reviewed screenshots, command receipts, source identity, raw console/requests,
cleanup and terminal verification. Ctrl+P used an attached Puppeteer connection
with `defaultViewport:null`, balanced modifier release and final disconnect;
it performed ordinary keyboard input, without modifying guest state.

The first attempt failed before launch because the private server exposed only
`test/binaries/winamp.exe`, whereas the registry requested `binaries/winamp.exe`.
The second adds aliases for the same pinned fixture bytes. The first failure is
retained separately in `scratch/runs/20261007-winamp-harness-path-repair/` and
is not guest compatibility evidence. Other unlisted stdole2.tlb and native DLL
probe refusals remain in the second run's raw errors; builtin DLL fallbacks
are logged. Their causal relevance has not been established or ruled out.

The second browser/server closed with no cleanup errors or pending streams;
driver 94255 and Chrome 94267 were absent at 22:10:25 UTC. No local browser,
benchmark, fixture modification or public deployment occurred. Next capture the
actual plugin exception and relevant loader/API outcomes on unchanged originals,
then repair the demonstrated generic defect. Do not substitute a Winamp 5 host
or claim that a blank MilkDrop window is rendered visualization.
