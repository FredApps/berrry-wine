# Unreal-family demo installers

Status: verified locally on 2026-09-13. These are proprietary demos and remain
`localOnly` candidate-corpus fixtures. No host Wine was used.

## Sources

| Candidate | Archive.org item | File | Size | SHA-1 |
| --- | --- | --- | ---: | --- |
| Unreal Special Edition | `unreal-special-edition.-7z` | `Unreal Special Edition.7z` | 128,609,961 | `f3f25896a51cbf37dcdb94833198b86f394d8853` |
| Unreal Tournament | `unreal-tournament-demo-version-348` | `UTDEMO348.EXE` | 55,647,232 | `faf2c18852a1a53c59db490e044e0d3e100e8fed` |
| Unreal Tournament 2003 | `UT2K3Demo` | `UT2003Demo2206.exe` | 148,976,640 | `372a8b712cb7f2b1539af72430923d290a67e701` |
| Unreal Tournament 2004 | `UnrealTournament2004Demo` | `Ut2004-NewDemo.exe` | 296,049,152 | `5e224a3de711da9085cddd9929499789690043c7` |
| Unreal Tournament 3 | `setuput3demo` | `setuput3demo.exe` | 777,027,962 | `86d4bad740d0c25438a65c48939ee6dcfc88bb02` |

The host archive reader only unwraps the outer 7-Zip/WinZip container. Candidate
preparation then executes the original setup program inside Wine Assembly,
exports the VFS it wrote, and boots the installed game. This distinction is
enforced by `tools/install-unreal-demo.js`.

## Installer and launch results

| Candidate | Authentic setup result | Installed payload | Installed-game result |
| --- | --- | ---: | --- |
| Unreal Special Edition | InstallShield bootstrap launched `_INS*.MP`; license and destination flow completed | 191 MB, `System/Unreal.exe` SHA-256 `5fbc5853a8669a802446ac12e102351053bc6a5ce9f554b03483eb634269f408` | Software launch loads `SoftDrv`, opens `WindowsViewport0`, initializes the game engine/player, and renders the playable intro |
| Unreal Tournament 348 | Unreal `System/Setup.exe` completed | 104 MB, `System/UnrealTournament.exe` | Reaches the renderer-selection wizard |
| UT2003 2206 | Unreal `System/Setup.exe` completed with the shipped `MSVCR70.dll` | 344 MB, `System/UT2003.exe` SHA-256 `97e027dc9765f048beacfa461bc93c71ba1831cd3e8dff0cd7d71c1b478f88a2` | The D3D8 wrapper renders textured first-person Antalus gameplay; an authentic dedicated server and direct-connect client exchange the native protocol over `vln/1` |
| UT2004 new demo | Unreal `System/Setup.exe` completed with the shipped `MSVCR71.dll` | 525 MB, `System/UT2004.exe` SHA-256 `2a95e2fa8c22ae94eb1c361fdb49ea8ec44c5e2a93faa00831308c01e951db8d` | Uses the same pre-renderer D3D8 probe; further post-probe launch diagnosis remains |

Seeding the bundled Visual C++ runtimes matters. Without `MSVCR70.dll`, the
UT2003 setup appears to require unimplemented CRT imports beginning with
`wcschr`; with its own runtime loaded, setup completes without any new emulator
API. The same rule applies to UT2004 and `MSVCR71.dll`.

## OpenGL and software-renderer attempts

UT2003 and UT2004 both ship `OpenGLDrv.dll`. Their installed and default INIs
were changed locally to `OpenGLDrv.OpenGLRenderDevice`, fullscreen was disabled,
and the browser launch used `-opengl -window` with a real WebGL context through
SwiftShader. This still does not bypass D3D8: both main executables import and
call `Direct3DCreate8` during startup hardware detection, before either render
driver is loaded.

`Direct3DCreate8` now returns a deliberately narrow, non-rendering
`IDirect3D8` capability object. It preserves the complete 16-slot factory ABI,
implements COM lifetime, one adapter, one display mode, identifier and caps
queries, and deliberately returns `D3DERR_NOTAVAILABLE` from format/device
creation checks. An authentic UT2003 run successfully called
`GetDeviceCaps`, `CheckDeviceFormat`, `GetAdapterIdentifier`, and `Release`, so
the old missing/null-factory branch is gone. It still throws later, before
`OpenGLDrv` loads; this does not establish that an `IDirect3DDevice8` is needed.

Unreal Special Edition does not ship `OpenGLDrv.dll`; it has `SoftDrv.dll`,
`GlideDrv.dll`, and `SglDrv.dll`. Its former startup exception was an encoded
resource-submenu mismatch in `DeleteMenu`. With resource-menu deletion and
compaction implemented, a five-minute authentic software-renderer run loaded
`SoftDrv.dll`, opened `WindowsViewport0`, logged `Game engine initialized`, and
sustained the render loop. Its gray viewport was a separate USER delivery bug:
the viewport is a secondary top-level window, but `ShowWindow` only queued an
initial `WM_SIZE` for children. Extending first-show sizing to non-main
top-level windows made WinDrv allocate its 514x386x32 DIB and produced 159
successful `BitBlt` frames in a 65-second authentic run. The captured intro is
rendered and prompts `PRESS ESC TO BEGIN`. A subsequent controlled run traversed
Game -> New Game -> Easy -> player setup, entered the first-person level with
HUD active, and produced distinct before/after movement frames, so interactive
gameplay is verified rather than inferred from the intro.

The initial capability facade has since grown into a deliberately bounded D3D8
translation layer over the D3D9 backend. It preserves the exact 97-slot device
and 19-slot texture ABIs, translates D3D8 presentation parameters, textures,
vertex/index buffers and fixed-function declarations, retains D3D8's
`BaseVertexIndex` from `SetIndices` for indexed draws, and adapts the implicit
swap-chain argument of `GetBackBuffer`. Unsupported methods remain explicit
failures rather than silent successes.

An authentic `-d3d -window -nosound` run now reaches textured first-person
gameplay on DM-Antalus. The no-sound flag isolates graphics from the separate
missing Vorbis `ov_open` import. `test/test-ut2003-vlan-candidate.js` runs the
game's own non-rendering dedicated-server mode beside a direct-connect client.
It verifies native UDP in both directions over `vln/1`, waits for D3D device
creation before taking a PNG, rejects the loading screen and spectator join
prompt, and rejects the flat-pale weapon signature that exposed the rendering
bug.

Getting the textured materials working had two layers. D3D8 sampler controls
are texture-stage states 13--21 and 25, but D3D9 moved them into sampler-state
slots 1--10. Forwarding
the D3D8 numbers directly to the D3D9 texture-stage bank returned
`D3DERR_INVALIDCALL`, leaving filter and address state at defaults. Translating
those states activates the mip-atlas shaders; the native headless desktop GLSL
1.10 compiler then rejected their ESSL-only
`GL_OES_standard_derivatives : require` directive even though `dFdx`/`dFdy`
are core there. The desktop port now removes only that directive. The corrected
capture has a textured dark-metal/green assault rifle and textured terrain
rather than the former nearly uniform white weapon inside the native GL frame.

The remaining pale-rifle CLI capture was a headless presentation bug, not a
D3D8 material bug. WebGL requests an opaque default framebuffer with
`alpha:false`, but the native desktop GL context still stores fragment alpha;
the readback path passed those low alpha bytes to the software compositor and
blended otherwise-correct rifle RGB toward white. Headless readback now honors
the requested WebGL contract by forcing alpha to 255. The focused regression
draws RGB with alpha zero and verifies opaque readback, while the frozen VLAN
replay verifies the textured rifle survives composition and that held movement
changes the first-person scene.

The final acceptance was repeated from a clean worktree at commit `fecc3e2f`.
The authentic dedicated server entered DM-Antalus, the client and server
exchanged native UDP through `vln/1`, the client created its D3D viewport, Fire
transitioned it from the join prompt to an owned pawn, and the captured frame
showed the HUD plus textured weapon and terrain. Both emulator processes exited
cleanly. The committed wall-clock test proves join and rendered gameplay;
deterministic held-key movement was additionally proved with a frozen
`tools/ctl.js` replay.

A fixed-wall-time profile of the map-load window (batches 6000--12000) retired
938 million handler operations. Raw x87 instructions were 26.85% of them, with
no single block over 2.23%, so the load is broad Unreal transform/material
work rather than one stuck loop. Enabling the existing experimental x87 fold
executed 27.3 million fused regions and advanced 25,179 batches in 140 seconds
versus 20,818 without it, about 21% farther on this run. The CLI candidate uses
`--x87-fusion`; browser runs can opt in with `?x87-fold`.

SSE is now a separate per-app CPU policy rather than a global claim. The
`ut2003_demo` client and server advertise a Pentium III with CPUID EDX bit 25;
the default personality and the not-yet-exercised UT2004 entry still hide SSE.
Following the authentic UT2003 path added the instructions it actually reached:
exact `SFENCE`, `MOVNTQ`, memory `MOVLPS`, all eight `CMPPS` predicates, and
`MOVMSKPS`. Unknown SSE encodings continue to trap.

That policy also selects three MSVC/D3DDrv 64-byte MMX copy loops, including a
79-byte three-register pipelined `MOVNTQ` body at original D3DDrv VA
`0x10001100`. Each is recognized by a complete address-independent byte hash
and lowered through H419 to `memory.copy` only for proved-disjoint, page-local
mappings; overlap and split mappings retain the original instruction ordering.
The regression compares ordinary decoding with each lowering for copied bytes,
GPRs, flags, final MMX registers, overlap, page splits, and a one-byte near miss.
A clean authentic run reaches D3DDrv with no SSE decoder trap, but the shared
machine was under heavy concurrent load during the final timing run, so that
run is evidence of compatibility, not a defensible wall-time speedup measure.

The CLI software D3D backend reaches the same engine loop without an
unimplemented API but rejects its GPU draw opcode; the native/browser WebGL
backend remains the authoritative graphics verification.

## UT2004: the registered `-opengl` argument is the whole blocker

UT2004's "further post-probe launch diagnosis" above is resolved. It is not an
emulator gap at all — it is the command line `lib/apps.js` registers for
`ut2004_demo`:

```
args: '-opengl -window'
```

### How the real error was recovered

The app dies inside `MiniDumpWriteDump`, which reads as the bug and is not:
that is only UE2's crash handler, running after the engine has already decided
to die. UE2 reports through `appError`, which throws, so the message never
reaches stdout. It is in memory, though — `core.dll` exports
`?GErrorHist@@3PAGA` (ordinal 1036, original VA `0x101ad200`), a UTF-16 buffer
holding the error text. Dumping it one batch before the crash gives the real
complaint:

```
Missing symbols - aborting. History: UOpenGLRenderDevice::Init
```

**Recipe worth reusing on any UE2 title:** resolve `?GErrorHist@@3PAGA` to a
runtime VA with `core+0x101ad200`, then `--input=N:dump-mem:<va>:512` at a
batch just before the crash. `--dump=` is too late — it fires at exit, after
the handler has run.

A `GetProcAddress` census confirms it: **99 GL/WGL names resolve and 298 return
NULL**, including core GL 1.1 entry points. `OpenGLDrv` cannot initialize
against that surface, and the engine aborts rather than falling back.

### The fix, and what it reaches

Changing `ut2004_demo`'s args to

```
args: '-d3d -window -nosound'
```

routes it to the same D3D8 path UT2003 already uses, and the game reaches
**gameplay**: DM-Rankin's lit brick-and-wood interior with a bot in frame.

Applied 2026-09-22. With the D3D9 software path's point/spot lights
(`fab74ee8`), `--d3d9-renderer=software --d3d9-programmable` also draws the
Epic/Digital Extremes/Atari splash with zero refused draws (1.42M batches in
150s at `--batch-size=200000`); it had refused every lit draw before.

## UT2003 under the CLI software backend

The paragraph above ("the CLI software D3D backend ... rejects its GPU draw
opcode") is narrower than it reads. With
`--d3d9-renderer=software --d3d9-programmable` on the remote bench box, UT2003
renders its full menu chain — intro logos, the NVIDIA splash, the main menu,
and `Instant Action | Select Map` complete with a **live 3D Antalus preview**
inside the map panel. PNG capture there comes off `dx slot 5 640x480`, the real
primary surface, rather than the canvas the headless-GL path reports.

Three things cost a session each and are worth writing down:

- **A `mousemove` must precede the `mousedown`.** UT2003's menus are in-engine
  widgets that track hover; a bare `mousedown` at the right coordinate is
  silently discarded, the highlight never moves, and `--trace-api` shows a
  perfectly healthy message pump. Two moves then a down/up 2000 batches apart
  is what works.
- **The game window is placed at (20,35) with a 1024x768 client**, so on a
  1024x768 desktop its bottom edge — the row holding BACK / SPECTATE / PLAY —
  falls off the screen. That is window placement, not UI scaling:
  `--screen=1100x840` shows the whole dialog. `--screen=` enlarges the desktop
  only; the viewport itself is a game-config property, set in
  `System/UT2003.ini` under `[WinDrv.WindowsClient]`
  (`WindowedViewportX/Y`, `FullscreenViewportX/Y`, `MenuViewportX/Y`).
- **Open:** the `Instant Action | Select Map` dialog's bottom button row
  (BACK / SPECTATE / PLAY) takes no input, so the match cannot be started from
  the CLI yet. The click that opens the dialog — INSTANT ACTION on the main
  menu at (536,578) — works every time, so the input path reaches the engine.
  Inside the dialog nothing does. Measured, each in its own bounded run with a
  hover pair before the press:
  - BACK at screen y = **743, 760, 778, 790** and PLAY at y = **770, 778**:
    all leave the dialog exactly where it was. Five rows spanning 47px, so
    this is **not** a coordinate offset, and BACK failing rules out anything
    PLAY-specific such as a disabled button.
  - Double-clicking the selected map name (`dm-antalus`, (290,261)), which is
    UT2003's own start-the-match shortcut: no effect.
  - Tab x3 then Enter: no effect.

  Two traps for whoever picks this up: the map preview panel cycles through
  screenshots on its own and the map description types itself out one
  character at a time, so **every capture of this dialog has a different
  hash whether or not any input landed** — `md5` cannot be the oracle here,
  only the dialog's identity can. And the row is drawn at client y ~743 of a
  1024x768 client whose window origin is (20,35); `--trace-input` confirms
  run.js injected each event, so whatever drops it is below that.

- **Do not quote batches/s across phases.** One UT2003 run on the box moved
  13.8k -> 61k -> 65k batches/s between its intro, menu and idle phases. A
  batch is a budget of blocks, so the unit changes meaning with the guest's
  code shape.



The fixed UT3 installer was executed directly in Wine Assembly. Its verified
first runtime blocker is:

- `UuidToStringA` at installer EIP `0x00422225` (batch 0).

Static PE import comparison against `src/api_table.json` found nine imported
names which are not implemented:

- `AdjustTokenPrivileges`
- `GetThreadContext`
- `LookupPrivilegeValueA`
- `RpcStringFreeA`
- `SetThreadContext`
- `UuidToStringA`
- `VerLanguageNameA`
- `VirtualProtectEx`
- `WriteProcessMemory`

Installer strings also name seven MSI APIs resolved dynamically, so they do not
appear in the static import table:

- `MsiCloseHandle`
- `MsiGetProductInfoA`
- `MsiGetSummaryInformationA`
- `MsiOpenDatabaseA`
- `MsiQueryProductStateA`
- `MsiSourceListEnumSourcesA`
- `MsiSummaryInfoGetPropertyA`

Only `MsiQueryProductStateW` currently exists in the API table. `UuidCreate` is
already implemented through `CoCreateGuid`. This is an analysis inventory only;
none of the UT3 gaps were implemented.

## Call-form census and the software-D3D8 draw stall (2026-09-29)

Measured with `test/run.js --edge-hist` and `tools/call-form-weighted.js`
(docs/uop-tier-design.md §15.1). Box1 ran `--d3d9-renderer=software
--d3d9-programmable --batch-size=200000 --screen=1100x840`. On that tree
(2a632d73), neither UT2003 nor UT2004 gets past the first 3D draw: the main
thread never returns from `IDirect3DDevice8_DrawIndexedPrimitive`.

- The last EAX is `0x8876086c` (D3DERR_INVALIDCALL).
- Only T1's Sleep/CriticalSection polling continues.
- The window stays grey, and `--dx-surfaces` slot 5 shows `nonZero=0`.
- UT2004 reaches this at about batch 2100-2250.
- `ut2003_demo_server` stalls the same way, after a `.PAG <- .PAX` C++ throw.

That run did not use `--headless-gl`, and box1 has no display for it. So the
earlier gameplay verification stands for its own path only.

The load phase itself is the most indirect-call-heavy code measured in the
corpus. Guest indirect transfers are 4.5-8.4% of block entries, and
vtable/reg calls are 2-6.6%. The sites are low-polymorphic:

- `core+0x10128138` and `+0x1011ae20`, both `call [eax+4]` (FArchive::Serialize), 1-3 targets.
- `UStruct::SerializeExpr` at `core+0x1011d330`: a monomorphic self-recursive
  `call [edx+0x98]`, plus the `jmp [0x1011d9f4+edx*4]` token switch (24-28 arms).

Unreal SE's Nyleve flyby on SoftDrv: under 1% guest indirect. The threaded
remainder there is SoftDrv MMX (`pxor`/`movq`/`pmulhw`/`psraw`) refused as
`head-unsupported`. `galaxy+0x105085d2 call [0x1054c260]` calls a runtime-built
mixer in heap memory (`0xc49394`).

## CRT exports and the native overrides (2026-09-29, docs/crt-native-overrides.md)

UT2003 imports `msvcr70.dll` and UT2004 imports `msvcr71.dll`, both through
thin wrappers in `core.dll` at `core+0x101139xx..0x10113cxx`. Which CRT export
is hot depends on the phase:

- **UT2003, batches 420..520 of the software-D3D load** (`--batch-size=200000`):
  - `floor` is 7.9-13.5% of all block entries, 30-50K calls per 50 batches.
    The callers are `core+0x101139b0` and `core+0x10113970`. Each call runs
    `_ctrlfp` and the `_fpclass` helpers `sub_7c0363b7`, `sub_7c034d89` and
    `sub_7c0366a8`.
  - `_vsnwprintf` (`_woutput`) is 0.6-1.9%.
- **UT2003, other windows:** `rand` (`core+0x10113940`) is 3.2%, of which
  `_getptd` (`msvcr70 0x7c00137f`) is 2.3%. The wide-string compares and
  copies (`_wcsicmp` at `core+0x10113b50`, `wcslen` at `+0x10113b00`,
  `wcscpy` at `+0x10113b60`, `wcsstr` at `+0x10113b10`, `_wcsnicmp` at
  `+0x10113c00`) run at 10^4-10^5 calls in the heavier windows.
- **UT2004, 600..1100:**
  - `_wcsicmp` is 2.77%, of which `_getptd` (`msvcr71 sub_7c349636`) is 2.08%.
  - The other wide-string functions add about 2%.
  - From 1100 on, `_woutput` takes over at 2.8-14.5%, with `mbtowc` at 5.47%
    inside it.

`floor`, `wcslen`, `wcscpy`, `wcscat`, `wcsstr`, `_wcsicmp` and `_wcsnicmp` are
now native when imported from these DLLs. With them, msvcr70 falls from
11.8-14.7% to 1.4% of UT2003's block entries in 420..520. What is left is
`_vsnwprintf`, `mbtowc` and `memmove`. `rand` and `_vsnwprintf` are the
remaining candidates, and neither is done: `rand` keeps its seed in the ptd,
and `_vsnwprintf` needs a byte-exact formatter.

A run of the same build is deterministic. For UT2003 with the software
backend at 200000 blocks per batch:

- The baseline reaches its 170th software render request at batch 520.
- The candidate reaches it at batch 491, and by batch 520 it is at request 199.
