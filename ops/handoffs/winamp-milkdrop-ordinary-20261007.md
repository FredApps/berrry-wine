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

The second browser/server closed with no pending streams; its receipt also
retains asset request errors, so it is not an error-free run.
driver 94255 and Chrome 94267 were absent at 22:10:25 UTC. No local browser,
benchmark, fixture modification or public deployment occurred. Next capture the
actual plugin exception and relevant loader/API outcomes on unchanged originals,
then repair the demonstrated generic defect. Do not substitute a Winamp 5 host
or claim that a blank MilkDrop window is rendered visualization.

## Loader audit correction

The subsequent source-only audit found a concrete harness omission: local
`test/binaries/dlls/comctl32.dll`, `test/binaries/dlls/msvcrt.dll` and
`test/binaries/tlbs/stdole2.tlb` exist but were not served. Running the exact
browser `resolveDllGraph` and registered URL lookup over the unchanged originals
selects five native modules: the three visualizer seeds plus COMCTL32 and MSVCRT.
Those two DLLs and the standard type library add 871,477 bytes. The recorded
illegal-operation result therefore describes a restricted fixture environment,
not the full local launch environment. Repeat with this normal loader closure
before attributing the exception to an emulator defect. No host substitution,
new download or registry override is needed. Shell32/Ole32 lack URL mappings in
this graph; that is distinct from the two available native DLLs omitted by the
harness. Receipts: `dependency-audit.json` in the run and
`scratch/winamp-visualization-20261007/loader-closure.json`.

## Complete loader closure rerun

At 22:43–22:45 UTC, a fresh remote session served all 15 original fixtures,
including COMCTL32, MSVCRT and stdole2, with 341 verified source/fixture pins
and the same module. Ordinary Repeat / Play / Ctrl+P / Visualization /
MilkDrop / Start again produced the illegal-operation `(2)` dialog. Eleven
screenshots were personally reviewed. The omitted DLLs were therefore not
the sole cause; the actual exception address and API cause remain unknown.

An immediate Ctrl+P chord did not open preferences; holding the ordinary
chord for 350 ms did. No guest state or callback return was changed.
Evidence: `scratch/runs/20261007-winamp-milkdrop-complete-closure/` (39 hashed
artifacts initially; later logs and static scope evidence bring the index to
43). Four shell32 fallback URL errors remain in the
raw receipt. Browser and server closed, Chrome exited zero, streams drained,
and actual driver 123703 / Chrome 123715 were absent at 22:45:59 UTC. No
visualization, FPS or audio-quality qualification follows from this run.

Static original-host inspection narrows the intended exception scope. Winamp
function `0x440330` registers the scope table at `0x446af8`. Scope index 1 has
filter `0x440623` and handler `0x440629`, which displays the observed `(2)`
string at `0x44dda8`. The protected call at `0x4405f4` invokes offset `+0x92c`
of the module pointed to by `0x458c78`; the preceding `+0x928` and following
`+0x930` callbacks have separate scopes. This identifies where the host intends
to catch this error, not the runtime fault address or proof of correct SEH
routing. Preserve that distinction when capturing the actual exception.
The exact original EXE hash, table words and instruction-aligned disassembly
are retained as `host-exception-scope.json` and
`host-exception-scope-disassembly.txt` in the complete-closure run.
