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
| Unreal Tournament 348 | Unreal `System/Setup.exe` completed | 104 MB, `System/UnrealTournament.exe` | `--app=ut348_demo`: first-run wizard, UWindow menu, DM-Morpheus practice match on SoftDrv with walk + mouse-look (see "UT 348 route" below) |
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
- **Resolved 2026-09-29: PLAY works, and UT2003 reaches a DeathMatch.** The
  "dead button row" below was a measurement artifact, not an input bug. PLAY
  starts the map load at once. The load runs for about **1000 batches with no
  Present**, so every capture in that time shows the last menu frame, PLAY
  still highlighted. Two things made it look dead. The bounded runs below
  ended inside that window. And before the render-park fix (next section),
  parked batches were counted without running the guest, so a run could end
  with the guest having done almost nothing after the click. BACK was not
  retested; the same artifact is the likely explanation.

  Route (box2, current main plus the render-park fix):

  ```
  node test/run.js --app=ut2003_demo --control --frozen --max-seconds=7200 \
    --max-batches=100000000 --stuck-after=100000000 \
    --d3d9-renderer=software --d3d9-programmable --batch-size=200000 \
    --quiet-api --screen=1100x840 --trace-input --no-close
  ```

  1. Step to the main menu.
  2. Hover pair, then click INSTANT ACTION at (536,578).
  3. The window is at (20,20) with a 1032x796 frame and client origin (24,44).
     Select `dm-asbestos` by clicking (290,281).
  4. Hover (981,775) then (985,778). Then mousedown/mouseup at **PLAY
     (985,778)**, 3 batches apart. That click was batch 964/967.
  5. By batch 1007 the main thread is in the exe's buffered `FArchive` reader.
     `exe+0x5550` is the precache path (`call [eax+0x48]` with `0x7fffffff`).
     `exe+0x39c0` is its memcpy tail. The box's load average falls to ~0.1
     because there are no software-render waits. **Use that as the oracle,
     not the picture.** Check whether the snapshot EIP is in
     `0x109055xx`/`0x109039xx` and whether `ctx.renderParkStats.waits` is
     flat.
  6. At batch ~2025: DM-Asbestos with "The match is about to begin...3" and
     "Press [Fire] to join the match!".
  7. Left click in the viewport (540,400). By batch 2113: "The match has
     begun!", HUD at 100 health / 150 ammo, and the assault rifle in first
     person.

  The earlier reports, kept for the record:

  The `Instant Action | Select Map` dialog's bottom button row
  (BACK / SPECTATE / PLAY) seemed to take no input. The click that opens the
  dialog — INSTANT ACTION on the main menu at (536,578) — works every time.
  Measured, each in its own bounded run with a hover pair before the press:
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
  run.js injected each event. The 2026-09-29 run routes both down and up to
  the game window (`-> child 0x10005 ... dispatched=1`, `up ... matching its
  DOWN`). Nothing was dropping them.

- **Do not quote batches/s across phases.** One UT2003 run on the box moved
  13.8k -> 61k -> 65k batches/s between its intro, menu and idle phases. A
  batch is a budget of blocks, so the unit changes meaning with the guest's
  code shape.

## "Stuck forever in the first software DrawIndexedPrimitive" (2026-09-29)

Reported for both demos: a bounded run
(`--d3d9-renderer=software --d3d9-programmable --max-batches=1500
--batch-size=200000 --trace-api=IDirect3DDevice8_DrawIndexedPrimitive,IDirect3DDevice8_Present`)
ends with EIP parked on the D3D thunk after 30 DIPs and 2 Presents, and looks
like a rasterizer that never returns. **It is not a guest or rasterizer hang.**
Ruled out by reading and by probing: the D3D8 DIP frontend (`09ac`, SetIndices
base at `state+1692`), `$d3d9_draw_buffer`'s validation (`09ae`), and the
software prepare/step tile loop (`09ah`, bbox clamped to the viewport,
non-finite vertices marked bad) all terminate.

What happens: every software draw/Present returns a negative render token,
`$d3d_render_park` sets yield 16, and the CLI main thread waits on the render
worker (`lib/d3d9-host.js`; Node has no `crossOriginIsolated`, so the CLI always
takes the async worker path). `test/run.js` checked "still parked?" once per
**batch**: `run()` was skipped, the batch was counted and the batch clock
advanced, so a `--max-batches` budget drained one event-loop turn at a time
while the guest executed nothing. A `ctl.js eval` on the parked run showed the
request `{"t":-6,"done":true,"yr":16}` completing and moving on to `-8`, and
frozen stepping walked UT2004 into its NVIDIA intro with a software-rendered 3D
character — slowly, not stuck.

Fix (`test/run.js`, `awaitMainRenderPark`): before each batch, if main is parked
on yield 16, await that request in wall time (bounded by `--max-seconds` and
stop), then run the batch. `--no-render-park-wait` restores the old loop for an
A/B. The exit summary prints `render park: main waited on N software D3D
requests (Nms wall), N batches skipped while parked`, and `ctx.renderParkStats`
exposes the same to `--control` evals. `test/test-d3d-render-park-batches.js`
drives the shape through real COM thunks (512x512 software device,
DrawPrimitiveUP + Present in one 40-batch step): 0 batches skipped with the
fix, 39 of 40 skipped with `--no-render-park-wait`.

Same UT2003 command line, same box, after the fix: **866 DIPs and 722 Presents
in 712 batches**, and the capture is the **UT2003 main menu** (dx slot 5,
1024x768). Before it was 30 DIPs and 2 Presents in 1500 batches. The run hit its
`--max-seconds=600` guard rather than its batch budget, and `render park` says
why: 362 waits, 588s of the 600 on the software worker, so about 1.6s per
parked request at 1024x768. The wall-clock ceiling is now the software
rasterizer's throughput; batch accounting no longer hides it. Use
`--max-seconds` rather than `--max-batches` for UT routes on this backend.

UT2004 with the same flags makes **no** D3D8 call in its first 1500 batches,
because it is still streaming packages in 1KB `ReadFile`s (`humanmalea.ukx` and
others) before it opens the device. Given `--max-seconds=600
--max-batches=100000000 --stuck-after=100000000`, it reaches the **UT2004 main
menu** (dx slot 5, 640x480, 845 Presents, 5195 batches). 562s of the 600 were
2518 render waits. Note that `--stuck-after=0` does **not** disable the stuck
detector: the test is `stuckCount > STUCK_AFTER`, so 0 fires on the first repeat.
Pass a huge value instead.

The browser never had this bug: `host.js` yields to the event loop rather than
spending a counted unit per check.



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

**MMX fill fold (2026-09-29).** Unreal SE's SoftDrv has the same
`movq [r],mm; add r,8; dec c; jnz` clear loops as Deus Ex, at `0x10931ed0` and
`0x10931ff0`. The fold (docs/loop-idiom-superops-design.md §23) matches them
**zero times** in the flyby, batches 900-1800. The flyby never clears the
frame.

- Box1 runs with `--branch-clock --wall-clock-ms=1790673326000`: user CPU is
  neutral, off 28.07/28.02 s against on 28.12/28.22 s.
- Frames are md5-identical at 900/1200/1500/1790/end.

The flyby's MMX share is compute. SoftDrv loads at a runtime base of
`0x0289b000` (preferred `0x10900000`), so `softdrv+0x10924747` is the block at runtime
`0x028bf747`. The hot blocks:

- `softdrv+0x10924747` / `+0x1092475a`: palette-lookup texel, 4-5% of threaded
  entries.
- `+0x10922f2f`: bilinear lightmap fetch, 3-5%.
- `+0x1092314e` / `+0x10923614`: span setup, which loads ESP from
  `[0x109548b4]`.
- `+0x10923210` / `+0x109236d0`: 8-texel span bodies.

That is a uop-tier MMX coverage problem, not a fold.

**Covered (2026-09-29, docs/uop-tier-design.md §16).** Every head above is now
`installed` or `live` in the uop tier. Threaded block entries over batches
900..1800 went from 116.1M to 68.8M. User CPU for 1800 batches went from
28.42/28.93 s to **18.45/19.01 s (−35.1%)**, with frames md5-identical at
900/1200/1500/1790/end.
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

UT2004 over batches 600..1100: msvcr71 drops from 16.1% to 6.9% of block
entries (docs/crt-native-overrides.md, Verdict).

## UT2004 reaches a DeathMatch (2026-09-29)

UT2004 now gets into a match: DM-Rankin, HUD at 100/100, and the clock
counting down from 20:00. It took three emulator fixes.

1. **95b1b8c9: DestroyWindow no longer quits.** UT2004's splash dialog is the
   first top-level window, so it became `$main_hwnd`. Destroying it set
   `$quit_flag` while the game kept running. Now `$main_hwnd` passes to the
   next top-level window, and WM_QUIT comes only from PostQuitMessage.
2. **906cfe27: a real `RtlUnwind`.** The old handler unlinked frames without
   calling their handlers with `EXCEPTION_UNWINDING`, so msvcr71's C++ EH
   never ran its unwind funclets. The first `.PAG <- .PAX` throw after PLAY
   left a stale FRAMEINFO chain, and `__CxxFrameHandler` looped. The
   replacement follows NT x86 semantics:
   - each frame below the target gets its handler called with
     `EXCEPTION_UNWINDING` (plus `EXIT_UNWIND` when the target is NULL), then
     is unlinked;
   - a collided unwind (disposition 3) resumes from the dispatcher context;
   - EAX returns ReturnValue.
3. **4eb870e1: a dispatcher registration node.** msvcr71's
   `_UnwindNestedFrames` (orig `0x7c359b25`) runs the code below.

   ```
   saved = FS:[0]
   RtlUnwind(pRN)
   saved->next = FS:[0]
   FS:[0] = saved
   ```

   It relies on NT's `RtlpExecuteHandlerForException` having linked its own
   node on top of FS:[0] for the duration of the handler call. Without the
   node, `saved` is the catching frame itself, and the relink made it point
   to itself: the SEH chain read `0x179fb6d8 next=0x179fb6d8` and the next
   throw walked it forever. The emulator now links a node
   `{next, handler=0xCACA003A thunk, establisher}` around each handler call:
   - the node's handler returns ExceptionCollidedUnwind and fills the
     dispatcher context on an unwind, and ContinueSearch otherwise;
   - `$seh_walk_from` and `$rtl_unwind_step` skip the node.

   `test/test-rtl-unwind-handlers.js` covers the whole relink. The dump
   helper `sehchain.js` (a `ctl.js eval` that walks FS:[0] and flags a cycle)
   is what found it.

Route (box2; flags as for UT2003 above):

1. Step the frozen run to batch 3500 for the main menu, 640x480, at client
   origin (24,44).
2. **The mouse is DirectInput-relative, so every click needs a sync.** Move
   to (24,44), step 3 batches, move to (300,300), step 3, move to the
   target, step 3, then click. The hover highlight can lag behind; the
   clicks still land.
3. Click INSTANT ACTION at (400,362). The Gametype page is up by batch 4400.
4. Click DeathMatch at (195,221). Select Map (DM-RANKIN) is up by 4550.
5. Click PLAY at (448,514) (batch ~4565). The load shows no Present:
   - captures keep the typewriter menu frame;
   - EIP samples sit in msvcr71 `_woutput` and friends at
     `0x115a..-0x115c..` (runtime base `0x11591000`);
   - eight `[C++ throw] .PAG <- .PAX` lines are logged and are harmless now.
   - Check progress with the snapshot EIP and the SEH chain, not the picture.
6. By batch 8200: DM-Rankin with "Press [Fire] to join the match!".
7. Click in the viewport (340,300). By 8600 the player has spawned, with the
   HUD, the weapon bar and the assault rifle.

## UT 348 route (2026-10-06)

`--app=ut348_demo` mounts `test/binaries/candidates/unreal-tournament-348-demo/extracted/`
through a manifest written by `node tools/gen-tree-manifest.js <root>
--exe=System/UnrealTournament.exe --flatten=System`. The game opens
`UnrealTournament.ini` relative to the exe and its packages through
`..\System`, `..\Maps` etc., so `System\` files are mounted at both
`c:\<name>` and `c:\System\<name>`. Without the mapping it dies early with
"Can't find file for package 'Engine'" (an `appThrowf`; Core's static message
buffer is at `core+0x101f65fc`, readable with `--dump` after the exit).

- `FirstRun=0` in the shipped INI opens the setup wizard. Its device probe
  (`exe+0x1090d9e0`) runs inside the WM_PAINT that `UpdateWindow(0x1000c)`
  sends synchronously. It ShellExecutes a second copy
  (`testrendev=D3DDrv.D3DRenderDevice log=Detected.log`), then polls the log
  with `GFileManager->FileSize` and `Sleep(100)` up to 100 times (a 10000 ms
  budget counted down by iteration, not by the clock), then lists the
  devices. Two emulator bugs used to stop it (fixed in dd0d6dc8):
  - `$wnd_send_message` abandoned the paint after 64 rounds, because every
    Sleep ends a round (`[sync] ABANDONED wndproc hwnd=0x0001000c msg=0xf at
    0x1090dbfe`). The wizard then sat on "Detecting 3D video devices, please
    wait..." for good.
  - In the browser the ShellExecute really starts the child. The child had no
    `dlls` seeds, so Core/Engine/Window.dll bound to stubs and it trapped on
    `?appPackage@@YAPBGXZ`, or threw an `int` that went unhandled (the
    "C++ throw .H ... UNHANDLED EXCEPTION 0xe06d7363" console the user
    reported, in both thread modes). The CLI's ShellExecute starts no child,
    so it never showed this.
  The child's log never reaches the parent (a VFS child gets a copy of the
  file map), so the wizard always settles on Software Rendering.
- The child mode by itself (`--args="testrendev=D3DDrv.D3DRenderDevice
  log=Detected.log"`) loads D3DDrv, tests it and exits 0 headlessly. Pass
  `--stuck-after=1000000`: its CPU-speed loop trips the stuck detector.
- Wizard buttons render without labels (Back/Next at about (223,418), Cancel at
  (401,418)). Next x3 by mouse reaches the UWindow menu.
- Once the wizard ended, its last page stayed in the renderer over the game
  window and ate every click: `$wnd_destroy_tree` never told the host about
  windows below the root. Fixed in 09c3a; covered by
  `test/test-dialog-teardown-grandchild.js`.
- In the UWindow menus the cursor moves by `relmousemove` at roughly 46% of the
  requested delta. Game > Start Practice Session opens on DM-Morpheus; Start
  (about (598,418)) loads the map; "Waiting for ready signals" until a fire
  click. VK_UP then walks and relmousemove turns the view.
- Not evaluated: audio, FPS, browser. Some frames between kills are black with
  only the HUD (death/respawn view).

Evidence: `scratch/runs/20261006T001500Z-ut348-demo-claude202b4b39-dm-morpheus`.
