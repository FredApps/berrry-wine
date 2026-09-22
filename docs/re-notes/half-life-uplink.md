# Half-Life Uplink demo

## Package and installed layout

The local-only installer is
`test/binaries/candidates/half-life-uplink-installer/hluplink.exe` (50,872,079
bytes). It is a Win9x InstallShield package. The tested installed tree is staged
under the same candidate directory at `installed/`; its playable entry is
`hldemo.exe`.

The two large launch pins are:

- `hldemo.exe`: 737,280 bytes, SHA-256
  `e459ef7d19bc0690d2e2d6dca9af1d773b49f8172096e49a694f897119bc4dc1`
- `valve/pak0.pak`: 79,150,544 bytes, SHA-256
  `c9eac1391845d6fabd93d7a1cc48281275410d35e01b74bd7f02325c65c99a42`

The runtime also needs `hw.dll`, `sw.dll`, `hl_res.dll`, `a3dapi.dll`,
`valve/dlls/hl.dll`, `valve/cl_dlls/client.dll`, and the remaining Valve/media
data beside the executable.

## Installer path

Use dialog titles, not an early `wait-dlg-control:3`: the setup creates a
different control with that ID before Welcome. The deterministic path is:

1. Welcome: click ID 3.
2. End User License Agreement: click ID 5 (`I Agree`).
3. Read Me File: click ID 3.
4. Choose Destination Location: click ID 3.
5. Start Installation: click ID 3.

The installer then requires Win9x VERSION.DLL behavior:

- `VerFindFileA` chooses the current/destination directories and reports
  NUL-inclusive buffer capacities and `VFF_*` flags.
- `VerInstallFileA` moves InstallShield's generated temporary payload into the
  selected destination and returns a `VIF_*` mask.

Use a small guest batch for the large PAK. With `--batch-size=20000`, the whole
75+ MB decompression stays inside one chained batch, so `--max-seconds` cannot
take effect until after extraction and may stop before the following rename.
`--batch-size=500` lets setup finalize `valve/pak0.pak` and emit the later DLL,
WAD, CFG, and media files.

The completed local run used `--save-vfs` and `--reg-export`. Its installer
snapshot is `/private/tmp/hlu-installer-registry-complete.json`; the exported
tree was `/private/tmp/hlu-installed5.oN75DN/sierra/half-lifeuplink` before it
was staged under the candidate directory.

## Registry delta

The game-specific installer record is:

```text
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Half-Life Uplink
  DisplayName = "Half-Life Uplink"
  UninstallString = "C:\sierra\half-lifeuplink\unwise.exe C:\sierra\half-lifeuplink\INSTALL.LOG"
```

These are uninstall bookkeeping, not launch prerequisites. The installed game
reaches its menu with or without importing them; keep them out of a minimal
`startupRegistry` manifest unless reproducing the installed Windows state is
the goal.

## Installed-game launch

Mount the whole installed directory relative to `hldemo.exe` and seed the
runtime-loaded native DLLs:

```sh
/opt/homebrew/bin/timeout -s KILL 90 node test/run.js \
  --exe=test/binaries/candidates/half-life-uplink-installer/installed/hldemo.exe \
  --vfs-include='**/*' \
  --dll-seed=test/binaries/candidates/half-life-uplink-installer/installed/hw.dll,test/binaries/candidates/half-life-uplink-installer/installed/sw.dll,test/binaries/candidates/half-life-uplink-installer/installed/hl_res.dll,test/binaries/candidates/half-life-uplink-installer/installed/a3dapi.dll,test/binaries/candidates/half-life-uplink-installer/installed/valve/dlls/hl.dll,test/binaries/candidates/half-life-uplink-installer/installed/valve/cl_dlls/client.dll \
  --no-build --max-seconds=70 --max-batches=10000000 --batch-size=1000
```

`WSAStartup` must fill the complete 400-byte Win32 `WSADATA`, including the
provider's real 64-slot socket capacity in `iMaxSockets` at offset 390. The
engine then creates DirectDraw, opens the intro AVI as MCI alias `sierravideo`,
resolves that alias with `mciGetDeviceIDA`, closes it, creates the 640x480
Half-Life child window, and renders the complete menu.

The warning was not cosmetic. `hldemo.exe` at VA `0x41068c` passes a WSADATA
at `ebp-0x22c` to `AfxSocketInit`. After the successful call, VA `0x4106a5`
reads the WORD at structure offset `0x186` (390); the check at `0x4106b5`
loads warning resource ID 22 unless the reported capacity is greater than 12.
The MFC helper at VA `0x466524` also verifies negotiated WinSock 1.1. The
virtual provider has `VSOCK_MAX=64`, so publishing 64 is both sufficient and
truthful; `iMaxUdpDg` stays zero because the virtual LAN exposes no UDP, and
`lpVendorInfo` is NULL.

`mciGetDeviceIDA` must query the same host-owned alias map populated by
`mciSendStringA`. Returning a fabricated ID or zero either breaks subsequent
MCI commands or skips the video path. The focused host regression verifies
case-insensitive lookup and alias removal on close.

Acceptance screenshot: `/private/tmp/hlu-game-mci-final.png`. The main menu
shows New game, Hazard course, Configure, Load game, View readme, Previews, and
Quit; the 70-second run ended normally with no unimplemented API or crash.

## Browser dropdown

The localhost-only dropdown keeps the original installer entry and adds
`halflife_uplink` for the installer-produced game. Its manifest pins the six
runtime DLLs and 58 data files (65 local paths including the EXE) and mounts
the PAK, WAD, configuration, AVI, and order-page assets at their runtime
`C:\` paths.

Uplink performs a relatively long renderer probe before publishing its main
window. The normal browser lifecycle grace remains 750 ms; this app opts into
60 seconds so last-window cleanup does not mistake that startup transition for
process exit. Its eventual 640x480 Half-Life menu uses a dialog-style top-level
window, which the focused browser acceptance allows explicitly before checking
rendered pixels.

The final real-Chrome run rendered 91 colors and changed 8,406 sampled pixels.
Screenshot:
`/var/folders/dz/1fqkk_jd4350qkm91pm9_q3c0000gp/T/hlu-web-mu3xoc/halflife_uplink-after.png`.

The stronger no-dismiss run confirms that the socket warning is gone. Normal
renderer pointer input at guest `(148,193)` hits the measured New Game button
(live control ID 1016, rectangle `70,180 156x26`) and reaches the Easy / Medium
/ Difficult selector. Best progress screenshot:
`/private/tmp/hlu-gameplay-click2/halflife_uplink-new-game-click.png`.
This is not yet a first-person frame; do not treat the current browser smoke as
full gameplay acceptance.

## Difficulty selection and current gameplay boundary

The difficulty dialog exposed a separate native-dialog delivery bug. A WAT
BUTTON sent its custom `WM_COMMAND` synchronously to the parent. Uplink's New
Game handler enters another modal dialog, so the bounded recursive interpreter
eventually logged
`[sync] ABANDONED wndproc msg=0x111 at 0x00459554 after 64 rounds`; clicking
Easy after that resumed a discarded x86 continuation and crashed. Custom
commands to a parent with a retained DLGPROC are now posted through the guest
message queue. `IDOK`, `IDCANCEL`, and non-dialog parents remain synchronous.
The focused regression also subclasses the dialog WNDPROC, matching Uplink's
MFC dialog rather than relying on the visible `WNDPROC_DIALOG` marker.

With that fix, normal renderer input reaches the live Easy control (ID 26) and
creates the next 640x480 Half-Life window without abandoning a continuation or
exiting the app. The post-click evidence is under
`/private/tmp/hlu-gameplay-postfix/`; `halflife_uplink-easy-loaded.png` is the
furthest frame, but it is a uniform light-grey client area, not gameplay.

The grey frame is not an active presentation or an unresponsive browser:

- `hl.dll` loads from `c:\valve\dlls\hl.dll`, `client.dll` loads from
  `c:/valve/cl_dlls\client.dll`, and passive entry counters record one call
  each to `GetEntityAPI` and `GiveFnptrsToDll`.
- The main thread repeatedly returns to VA `0x459554`, the instruction after
  MFC's `PeekMessageA` call, with a stable stack and no synchronous-abandonment
  log. This is the live top-level modal pump, not a discarded recursive frame.
- The only long-lived worker is the renderer queue waiting normally. The other
  observed worker starts at runtime VA `0x15a7e42`, which maps to
  `comctl32.dll` RVA `0x20e42`; its function returns zero at RVA `0x20e8c`, so
  its later `EIP=0` exit is normal COMCTL32 worker completion, not a failed
  Half-Life game thread.
- DirectDraw is configured only for the hidden menu HWND `0x10002`: the trace
  contains `SetCooperativeLevel(0x10002, DDSCL_EXCLUSIVE|DDSCL_FULLSCREEN)` and
  640x480x16 `SetDisplayMode`, but no later cooperative-level or display-mode
  call for the new visible HWND `0x1001d`. That new window's canonical surface
  remains untouched (`uploaded=false`, version 1) and it has no DirectDraw
  layer.

Therefore the queued-dialog fix advances the real dropdown path through Easy,
but first-person acceptance remains blocked after game-DLL initialization and
before the engine re-enters video/presentation setup. Do not paper over this by
transferring DirectDraw ownership in the host: the guest has not issued a
second `SetCooperativeLevel`, and there is not yet generic evidence that such a
host-side handoff matches Windows behavior.

### Engine frame activation

The grey window was one step downstream of an ordinary USER activation gap,
not a DirectDraw ownership handoff. Uplink selects `sw.dll` at runtime. The
post-Easy launcher bridge adds the exact `skill 1\nmap hldemo1\n` text to
`sw.dll`'s `Cbuf_AddText` once, but `Host_Frame` remains at zero. Its caller is
reached continuously and reports engine state 1, then returns because all
three run guards are zero. The primary guard at `0x484808` is written by three
MFC `WM_ACTIVATEAPP` handlers; none of those handlers executed during the menu
startup in the failing run.

The window chronology identifies why. An unseen utility HWND consumes the
first handle, then the real parent/owner-zero UI is created as dialog HWND
`0x10002` and shown. `ShowWindow` already knows how to deliver the synchronous
`WM_ACTIVATEAPP -> WM_ACTIVATE -> WM_SETFOCUS -> WM_SIZE` chain through a
retained DLGPROC, but the preceding hidden-helper promotion accepted only a
direct guest WNDPROC. It rejected USER's `WNDPROC_DIALOG` marker, left
`main_hwnd` on the invisible utility HWND, and made the correct dialog branch
unreachable.

The generic fix resolves `WNDPROC_DIALOG` to its retained application DLGPROC
for that promotion decision. It still requires a shown, unowned top-level,
an invisible old main HWND, and an unconsumed first-activation gate. Owned
popups, child dialogs, built-in procedures, and subsequent same-application
window changes keep their previous behavior. The focused regression builds
exactly this hidden-utility/retained-dialog shape and proves the real dialog is
promoted and synchronously receives all four startup messages in order. The
existing SkiFree startup sequence, custom dialog dispatch, queued custom-button
command, and installed Uplink menu gates remain green.

A normal post-fix Chrome run clicks New Game and creates the live
Easy/Medium/Difficult dialog and all four buttons. The disposable diagnostic's
old control-ID walk
does not recognize those dynamically retitled controls after main-window
promotion, so that run was not used to claim a new Easy-to-first-person pass.
The earlier guest-only counterfactual (`0x484808 = 1` immediately after Easy)
does prove the next stacked compatibility boundary: the engine immediately
enters deep `sw.dll` code and stops at unimplemented `CompareFileTime`
(`sw.dll` runtime EIP `0x0104b407`). `CompareFileTime` is a separate generic
KERNEL32 API task; first-person rendering remains unproven until it and any
later engine dependencies are implemented and the real dropdown path is
rerun.

## Browser DLL thread-attach stack translation

Safari 26.4 can advance through New Game and click Easy with a 1,000-block host
slice, but repeatedly traps while entering tiny MFC epilogue blocks. A failure
at `0x00464e4e` (`mov eax,edi; pop edi; pop esi; ret 4`) left EAX unchanged from
before the block and ESP still named the valid words `0x00459610, 0x074febc0,
0x00463aaa, 0x0043fd74`. An earlier run failed on the same shape at the `ret 4`
at `0x00456cc0`. The intact state rules out a corrupt MFC object or guest
return stack, but does not identify where the browser exception originates.

Neither disabling cross-basic-block tail calls nor preserving retired decoded
page chunks fixed the failure. A local Chrome drive with the second diagnostic
build reproduced the exact `0x00464e4e` report and finally supplied the browser
exception stack: `DataView.setUint32` at `dll-loader.js:callDllMain`, called by
`ThreadManager.spawnPending` while delivering `DLL_THREAD_ATTACH`. The sampled
EIP is the suspended main thread's current address; the exception happens in
host-side initialization of a newly created cooperative thread, before that
thread's start routine runs. That also explains the earlier worker diagnostics
which reported `Length out of range of buffer` during `initGuestThread`.

`callDllMain` translated its temporary stack pushes with the legacy contiguous
formula `guest - imageBase + GUEST_BASE`. New thread stacks are allocated in a
sparse high guest range and already have a real mapping in the virtual map, so
that formula produces an offset beyond the `DataView`. ThreadManager's normal
stack initialization was previously corrected to use `guest_to_wasm`, but the
loader-notification path retained the obsolete formula.

DllMain stack pushes and the saved SEH word now use the interpreter's exported
`guest_to_wasm` mapper when it is available, retaining the old formula only for
loader mocks and older embedders. The focused regression delivers
`DLL_THREAD_ATTACH` on a synthetic stack at guest `0x07500000`, whose real WASM
backing is `0x00050000`; this address would be far outside linear memory under
the old arithmetic. No decoded-cache policy is changed.

The post-fix Chrome browser drive reached the live Easy control, created the
next Half-Life window, and remained in the MFC pump through 269,000 reported
slices with no `ERROR` or trap. It stops the acceptance only at the
already documented two-colour/grey first-person boundary (`colors=2` against
the test's `minColors=24`), so the stack-translation fix does not reintroduce
the pre-difficulty stall.

## OpenGL renderer and gameplay throughput

The software renderer can reach the first-person corridor, but its full-frame
CPU rasterization is a poor browser path: Safari measured about 1.2 fps with
broken streamed audio. Uplink's renderer registry uses `EngineType=2` for
OpenGL and resolves `EngineGLDriver=Default` through `gldrv\\drvmap.txt` to the
system `opengl32.dll`, the same generic WGL bridge already used by Quake II.
These values now ship as the app's startup registry instead of selecting the
bundled 3Dfx mini-driver or software renderer.

The first OpenGL run entered `hw.dll` and then appeared to exit at EIP zero.
The return address `0x006522d7` was still on the guest stack. Disassembly of
`hw.dll` RVA `0x8c2d1` showed an indirect call through `0x1068a274`; renderer
initialization fills that slot with `GetProcAddress("glColor4ub")`. The bridge
implemented `glColor4ubv` but not the scalar form, so the resolved pointer was
zero and GoldSrc called it. `glColor4ub` is appended as command-stream opcode
56 to preserve the existing GL/WGL opcode ABI, normalizes its four byte
components, and folds into immediate-mode vertex colour state without a host
round trip.

GoldSrc's z-trick also calls `glDepthRange(1, 0)`. Desktop OpenGL permits that,
whereas WebGL reports `INVALID_OPERATION` when near is greater than far. The
frontend now sends WebGL the legal sorted range and negates clip-space Z in the
projection matrix; this is algebraically equivalent to the desktop mapping.

Finally, the browser's app-specific 1,000-block slice underfed both rendering
and audio. The cooperative OpenGL path now uses 10,000 blocks, matching the
responsive Quake II scale. A fresh SwiftShader browser acceptance loaded
`hw.dll`, clicked New Game -> Easy, remained active for a 90-second gameplay
settle, issued 940 `gpuPresent` calls, and captured a textured corridor plus
HUD with 4,905 sampled colours and no trap or GL bridge error:
`/private/tmp/hlu-opengl-depth-fixed/halflife_uplink-easy-loaded-gpu.png`.

### Owner-drawn dialog background

Uplink's menu resources name the registered `HalfLifeLauncher` dialog class.
The resource loader previously skipped that `OrdOrString` field, so the HWND
lost its class slot, cursor, brush, and `CS_OWNDC` state. Two later synchronous
resize helpers then treated it as a stock `#32770` dialog and erased the full
640x480 client with `COLOR_BTNFACE` after GoldSrc had painted its textured
background. The built-in erase trace identified the overwrite exactly as
`hwnd=0x10002 brush=0x10 client=640x480`.

Named DLGTEMPLATE classes now inherit the same registered-class state as
CreateWindowEx windows. MoveWindow and SetWindowPos retain the legacy
BTNFACE initialization for classless dialogs, but do not overwrite a custom
class's owner-drawn client. The focused test covers both halves. A rebuilt
real-browser capture shows the black textured menu with all labels and no
grey slab:
`/private/tmp/hlu-menu-isolated-fixed/halflife_uplink-before.png`.

### Threads-mode menu publication

The launcher animates its logo by alternately hiding two 640x100 child
windows. Hiding either child used to restore its saved parent pixels and then
invalidate the complete 640x480 top-level window twice: once in WAT and again
in the browser renderer. In Worker mode those operations are separated by
broker hand-backs, so the compositor frequently published the parent after
the full erase but before all menu controls had repainted. The visible result
was a blinking grey/black menu body even though the guest eventually drew the
right pixels.

Child uncover now invalidates only the rectangle formerly occupied by that
child. When a saved parent snapshot already repaired the exposed pixels, the
browser does not widen the invalidation back to the complete window. Direct
repaint requests also obey the Worker slice publication boundary, and a
BeginPaint/EndPaint transaction remains private even when a cooperative slice
ends between the pair. Twelve 250ms real-Worker captures keep the menu body and
badge stable while the logo animates: the changed-pixel box shrank from
`640x324` before the fix to the intended `616x88` band at y=74..161.

### In-process renderer switching

One scheduler quantum is not suitable for both GoldSrc backends. OpenGL needs
10,000 blocks per cooperative turn to feed geometry and streamed audio, while
Software's CPU rasterizer needs the earlier 1,000-block quantum to preserve
browser input and paint responsiveness. GoldSrc also retains its WGL context
while Software is active, so context existence is not an honest mode signal.

Storage now publishes successful registry writes to the owning process. The
Half-Life browser policy watches its exact `HKCU\\Software\\Valve\\HLDemo\\Settings`
`EngineType` value: `2` selects the 10,000-block OpenGL quantum immediately.
A Software selection deliberately stays at 10,000 while GoldSrc tears down the
old renderer and rebuilds its setup dialogs; the first actual DirectDraw frame
then selects the 1,000-block CPU-renderer quantum. Switching at the earlier
registry write made the mode-change UI rebuild at one tenth the throughput,
published visibly incomplete dialogs, and encouraged several clicks to queue
against the same restart. This applies while the guest is running; the emulator
process is not restarted. A direct real-Worker OpenGL -> Software -> OpenGL
cycle completed both restarts without `Z_Free` and returned the quantum to
10,000 after OpenGL was selected again.

The Software leg of the same-process acceptance reached a textured Lambda
Complex corridor and HUD after a 90-second settle:
`/private/tmp/hlu-final-both-renderers/halflife_uplink-software-gameplay.png`.
The test then opened the live pause menu, selected OpenGL, observed the quantum
return to 10,000, confirmed replacement of the active game, and captured the
same corridor through the GPU layer after another 90-second settle. That leg
issued 569 `gpuPresent` calls, loaded 1,863 textures, remained active with no
GL error or trap, and produced 34,101 sampled colours:
`/private/tmp/hlu-final-both-renderers/halflife_uplink-opengl-gameplay-after-switch-gpu.png`.

## First-run keyboard bindings and movement GL calls

Browser input focus was not the reason keyboard movement failed. A focused
gameplay probe saw physical W become `0x8000`, consumed the queued key message,
and entered GoldSrc's relocated `Key_Event`; the engine's key-down byte also
became one. The key's binding pointer was null, however. Uplink's shipped
`valve.rc` comments out `exec default.cfg`, always executes `autoexec.cfg`, and
the extracted payload contains no autoexec file. The browser install now also
seeds `valve/default.cfg` at `c:\valve\autoexec.cfg`, preserving the original
file while using GoldSrc's native first-run startup path. The resulting live
bindings are `w +forward` and mouse button 1 `+attack`.

Actually executing `+forward` exposed two previously dormant OpenGL 1.1
imports. `hw.dll` resolved `glPolygonOffset` into its slot at original address
`0x10689dc8` and `glColor3ubv` into `0x10689ad4`; both were null. They are now
append-only command-stream opcodes 57 and 58. Polygon offset reaches WebGL with
both float arguments and supports `GL_POLYGON_OFFSET_FILL`; the three-byte
colour vector is normalized into packed immediate-mode RGBA state without a
Worker round trip.

A fresh browser acceptance reached the rendered corridor, held W for 500 ms,
released it, and remained active with no trap. `Key_Event` advanced from 256
to 258, the key-down state transitioned zero -> one, and `Host_Frame` continued
from 839 to 848. Visual comparison confirms forward camera displacement: the
right-wall panels and overhead opening move toward and past the camera. The
before/held captures differ at 305,732 of 459,360 pixels (66.56%):
`/private/tmp/hlu-keyboard-color3ubv/halflife_uplink-movement-before.png` and
`/private/tmp/hlu-keyboard-color3ubv/halflife_uplink-movement-w-held.png`.

## The Direct3D renderer: `CoCreateInstance(CLSID_DirectDraw)`, not `DirectDrawCreate`

GoldSrc has a third renderer beside software and OpenGL, and reaching it is two
separate switches. `-D3D` on the command line only sets a `COM_CheckParm` global
at `0x00429b2d`; what actually selects the renderer is
`HKCU\Software\Valve\HLDemo\Settings\EngineType`, read at `0x00411191` and
clamped to 1..3 at `0x00411196`-`0x004111a0` (1 = software, 2 = OpenGL,
**3 = D3D**). Passing `--args='-D3D'` alone leaves `EngineType` at 2 and the
engine never loads a D3D anything.

Seeding the value is awkward on purpose: `test/run.js` imports `--reg-import`
at line 4707 and then applies the app manifest's `startupRegistry`
**unconditionally** at 4752, so an import cannot override a key the manifest
seeds — and `halflife_uplink` seeds `EngineType = 2`. A bare `--exe` run leaves
`APP_ENTRY` null and skips `startupRegistry` entirely, which is the route that
works without touching `lib/apps.js`:

```
node test/run.js \
  --exe=test/binaries/candidates/half-life-uplink-installer/installed/hldemo.exe \
  --args='-D3D' --vfs-include='**/*' --reg-import=hl-d3d-reg.json \
  --quiet-api --quiet-api-fast --stuck-after=1000000 \
  --max-seconds=170 --max-batches=99999999 --no-close --dx-surfaces
```

with `hl-d3d-reg.json` holding one entry, the store's own shape:

```json
{"reg:HKCU\\Software\\Valve\\HLDemo\\Settings":
 "{\"values\":{\"EngineType\":{\"type\":4,\"data\":3}}}"}
```

With that, the engine boots and draws its own menus, and clicking `New game`
at (113,192) produces **"The selected D3D mode is not supported by your video
card."** — string 429 in `hl_res.dll`'s table, the D3D twin of the OpenGL 428
this note's earlier sections hit.

**The message is not about a mode and not about D3D.** Searching the binaries
for it is a dead end (it is a UTF-16 resource string, invisible to a plain
`strings`/`grep`; use `find_string.js --utf16` on `hl_res.dll`), and there is no
`push 0x1ad` to xref — the four `imm32=0x1ad` hits in `hldemo.exe` are all
`rel32` displacements. The answer came from a full `--trace-api` log instead,
reading the last calls `hw.dll` makes before the engine unloads it:

```
CoInitialize(NULL)
LoadLibraryA("ddraw.dll")                        => ok
GetProcAddress("DirectDrawEnumerateExA")         => ok
CoCreateInstance(0x0067b348, NULL, 1, 0x0067b368, ppv)   <- no success return
CoUninitialize()
...
FreeLibrary(mod=h:0x005c6000)                    <- hw.dll unloaded
```

`hw.dll` is loaded at `0x5c6000` over origBase `0x10000000`, so those two GUID
pointers are `hw+0x100b5348` and `hw+0x100b5368`; `tools/dump_va.js` names them
**CLSID_DirectDraw {D7B70EE0-4340-11CF-B063-0020AFC2CD35}** and
**IID_IDirectDraw {6C14DB80-A733-11CE-A521-0020AF0BE560}**. So the hardware
renderer does not call `DirectDrawCreate` at all on this path — it activates
DirectDraw as a COM class and then calls `IDirectDraw::Initialize`. Our
`$handle_CoCreateInstance` knew eight local classes and not that one, the
activation failed, and `hw.dll` correctly concluded it had no video hardware.

Two traps worth keeping: `--trace-api=<names>` with a name the table does not
recognize does **not** filter — it falls back to printing generic `[N] EIP=...`
lines, which look like a stack walk and are not one, so `--trace-stack` and
`--break-api` on such a name both produce the same useless dump. And the
earlier D3D probe in `hldemo.exe` at `0x403b00`-`0x403d4e` (QI IDirectDraw2,
then `IDirectDrawSurface3`, then `IDirectDrawSurface4`, storing `0x500` and
then `0x600`) is only a DirectX *version* detector that tops out at DX6 by
construction — it succeeds, and it is not where the decision is made.

### After the fix: textures upload, the primary stays empty

`$handle_CoCreateInstance` now classifies `CLSID_DirectDraw` as a local class and
manufactures the same object `DirectDrawCreate` does, with
`$ddraw_cocreate_query_wa` (in `09a8-handlers-directx.wat`) handing back the
IDirectDraw/2/4/7 wrapper for the requested IID. It refuses the Direct3D kinds
deliberately: D3D comes from a QI on an already-initialized object, so
manufacturing one over a device that has not had `Initialize` called would be a
lie the caller can act on. `IDirectDraw::Initialize` was already a DD_OK no-op,
so nothing else was needed.

The same command line now runs with **no message box at all** and
`--dx-surfaces` reports ten live surfaces where it reported zero:

```
slot=6  640x480 bpp=16 flags=0x1 (primary)     colors=1  nonZero=0/1850
slot=7  640x480 bpp=16 flags=0x2 (back buffer) colors=1  nonZero=0/1850
slot=8  640x480 bpp=16 flags=0x4               colors=1  nonZero=0/1850
slot=13 256x256 bpp=16 flags=0x4               colors=540 nonZero=1797/1849
slot=14 256x256 … 15 256x256 … 16 128x128 … 17 64x64 … 18 8x8 … 20 16x16
```

Throughput moved with it — 106 batches/s before, **28,039 batches/s** after, on
the same 150-second budget, because the engine is no longer spinning after a
failed renderer init.

So `hw.dll` initializes, creates a primary/back-buffer flip chain and uploads
real texture content (slot 13 carries 540 distinct colours). What it does not do
is put anything on the primary: all three 640x480 surfaces are `nonZero=0`, and
the only thing in the capture is the engine's menu text. **The remaining work is
the D3D7 immediate-mode draw path, not DirectDraw activation** — read the
texture slots as proof the renderer is live, and the `nonZero=0` primary as the
open bug.

## The D3D7 draw path: three gaps, and where gameplay stops now

The "open bug" above turned out to be three separate gaps, each hidden behind
the one before it. Reaching them needs the registry seed and the bare `--exe`
form from the previous section; the clicks below drive the menu:

```
node test/run.js --exe=test/binaries/candidates/half-life-uplink-installer/installed/hldemo.exe \
  --args='-D3D' --reg-import=/path/to/hl-d3d-reg.json --quiet-api --no-build \
  --max-batches=300000 --max-seconds=540 --no-close --dx-surfaces \
  --input='3200:mousedown:110:192,3230:mouseup:110:192,4500:mousedown:70:152,4530:mouseup:70:152' \
  --png=/tmp/hl.png
```

(110,192) is **New game** on the main menu and (70,152) is **Easy** on the
difficulty menu. Both need a real `mousedown`/`mouseup` pair — `click` is
invisible to the engine's per-frame button sampler.

**1. Mipmap chains did not exist.** `hw.dll` creates a mipmapped texture and
then walks it with `GetAttachedSurface(DDSCAPS_TEXTURE|DDSCAPS_MIPMAP)`,
**ignoring the HRESULT** — on real hardware the chain always exists. Our
`CreateSurface` only billed the pyramid against video memory and never built the
levels, so the walk got a NULL that `hw.dll` then called `Lock` through. The
crash lands in `$g2w`, nowhere near the `CreateSurface` that caused it; the tell
is `[eip-zero] … dbg_prev_eip=0x005f7502` (`hw+0x10031531`, `call [ebx+0x64]`,
slot 25 = `Lock`). `$dx_create_mip_chain` now builds the levels at creation.
Levels bill **zero** video memory on purpose: level 0 already books the whole
4/3 pyramid estimate, and moving that would shift the `GetAvailableVidMem`
deltas apps calibrate texture budgets against. `GetAttachedSurface` also zeroes
`*ppv` when it fails now, so a caller that ignores the HRESULT gets a NULL
rather than whatever it left in that variable.

**2. `IDirect3DVertexBuffer::ProcessVertices` was a fail-fast stub.** GoldSrc
batches every frame through it: source vertices in, transformed and lit vertices
into the buffer it then draws from. The maths already existed for untransformed
`DrawPrimitive`, so `$d3dim_vb_process_vertices` reuses it — pack the source FVF
into the canonical 32-byte vertex, run `$d3dim_prepare_draw_vertex`, unpack into
the destination's own FVF. The three arguments past `arg4` (`dwSrcIndex`,
`lpD3DDevice`, `dwFlags`) come off the guest stack at ESP+24/+28/+32 and the
handler pops 36.

**3. The canonical `D3DLVERTEX` was packed two dwords short.** This is the one
that mattered for the picture. `D3DLVERTEX` is `{x,y,z, dwReserved, dcColor,
dcSpecular, tu, tv}` — the reserved DWORD at +12 puts colour at +16 and the
texture coordinates at +24/+28, which is where `$d3dim_prepare_draw_vertex` and
every other consumer read them. `$d3dim_pack_fvf_vertices`'s type-2 branch wrote
colour at +12, specular at +16 and UV at +20/+24, so the transform was fed a
zero colour and **the wrong pair of dwords as texture coordinates**. Nothing
asserted, nothing crashed; the frame just came out white. A pre-existing bug
that no test covered — any FVF-sourced `D3DLVERTEX` draw was affected, not only
Half-Life.

With all three in, the same command line reaches **gameplay**: the D3D menu
draws in full (logo, items, PC Gamer badge), New game → Easy loads, the real
Half-Life loading screen renders through D3D, and the frame at ~70,000 batches
carries the HUD (health 100, suit, ammo) over the Lambda Complex intro text.
Throughput went 130 batches/s where the pre-fix route managed 33.

**Still open:** the world itself is not drawn. The HUD's 2D `TLVERTEX` sprites
and the level text composite correctly onto the primary and back buffer
(`nonZero=429/1850`, 210 colours), but the 3D geometry behind them is black, and
the background carries a tiled repeat of the loading screen in the top-left
quadrant. Read that quadrant as the next lead: content confined to a 320x240
corner with a vertical repeat is a pitch/stride disagreement, not a missing
draw. `--dump-ddraw-surfaces=DIR` plus the `640x480` names in the census is the
fastest way to see which surface holds what.

### Where the world geometry actually goes (2026-09-21)

The "pitch/stride disagreement in a blit" lead recorded above is **wrong**, and
the measurement that kills it is cheap enough to repeat: dump the surfaces
(`--dump-ddraw-surfaces=DIR`) and count colours per quadrant of the back
buffer.

```
BACK BUFFER (slot 7, 640x480, pitch 1280) at gameplay
  top-left     2672 colours   loading-screen tile, HUD, location text
  top-right       1 colour    black
  bottom-left   286 colours   real world geometry: textured, very dark
  bottom-right    1 colour    black
```

Two things follow. First, **the geometry is being drawn** — the bottom-left
quadrant holds a textured surface with 286 colours, not a missing draw. Second,
everything lands at **x < 320 while y uses the full 0..480**: the horizontal
axis alone is wrong, so this is not a uniform half-scale render and not "the
engine thinks the screen is 320x240" either.

Three facts rule out our own raster and present path:

- **`dx_boids` (DX SDK, same D3DIM rasterizer, same 640x480 16bpp flip chain)
  fills all four quadrants.** A blit-stride or rasterizer-width bug would hit it
  too.
- **Only three 640x480 surfaces exist in the whole run** (primary, back buffer,
  one offscreen); every other one of the 474 is a 4x4..256x256 texture. There is
  no 320-wide surface for the frame to have been rendered into.
- **The main menu draws correctly across the full 640 pixels**, and it is the
  game's own art through the same device. So the engine's idea of the screen is
  right at menu time and becomes 320 wide somewhere in level load.

So the remaining question is what HL reads during level start that comes back
half width — not what we do with the vertices afterwards. `--trace-dx` prints
the `DPVtx` screen coordinates per vertex, which answers it directly; use the
new `--trace-from=N`/`--trace-to=N` window, because the route is ~70,000
batches and an unwindowed trace spends the whole wall clock on boot output.

**The batch-scheduled click route is load-fragile.** The same command line
reached gameplay at 225 batches/s on a quiet box and was still sitting on the
main menu at batch 29,941 on a box at load 23 — the clicks at batch 3200/4500
landed before the menu was up. Check `uptime` first, or drive the clicks from
state over `--control-stdin` rather than from batch numbers.

### CORRECTION: look at the canvas, not the DIB (2026-09-21)

Everything above about "geometry confined to the left half / a 320x240 corner"
was read out of `--png` captures, and **`--png` has been photographing the wrong
surface for this app.** Measured on one run, capturing both at the same instant:

| capture | flag | what it shows |
|---|---|---|
| composited screen | `--input=N:png:PATH` | the game at full 640x480 |
| DirectDraw surface DIB | `--png=PATH` | the same image at half size in the top-left quadrant, black elsewhere |

`canvas(2x, 2y)` matches `dib(x, y)` at every probe — `(200,300)=63514a` vs
`(100,150)=605048`, `(400,120)=4a2808` vs `(200,60)=482808`,
`(120,440)=735142` vs `(60,220)=705040`. Every DIB channel value is a multiple
of 8 (RGB565) and the canvas ones are not, so the DIB is a **half-size 565
requantization** of the presented frame, not the frame. `chooseDxPresentationSurface`
picks it because it is 640x480 and nonzero. So on this app, judge with
`--input=N:png:` and treat `--png`/`--dump-ddraw-surfaces` as a lead only.

**What the canvas actually shows at gameplay** (batches 70k/80k/90k, `-D3D`):

- The route reaches gameplay. The HUD is correct and full-scale: health `100`,
  armor `0`, suit icon, and the live "CURRENT LOCATION: LAMBDA REACTOR COMPLEX /
  CONTAINMENT FAILURE" text, whose contents differ between the 70k and 80k
  frames, so the engine is running rather than parked.
- **The world geometry is absent.** Behind the HUD is the *loading screen*,
  tiled three times vertically with a scale break around x=200 — stale pixels
  that nothing overwrote.

So the 2D overlay path (HUD, text) is correct at full resolution and the 3D
world draw produces nothing at all. That is a different bug from "the geometry
lands in the wrong corner", and it rules out the viewport/vertex-scale theories
above: a wrongly scaled transform would still put *something* on the screen.

`IDirectDraw_SetDisplayMode(0x280, 0x1e0, 0x10)` — 640x480x16 — is the only mode
call in boot, so the guest asks for the right mode and our half-size DIB is
downstream of that, not a cause.

### All three renderers fail identically (2026-09-21)

Same click route (New Game -> Easy, repeated), same batch budget, canvas
captures at 50k/70k/90k:

| leg | args | EngineType | result | HUD | world |
|---|---|---|---|---|---|
| software | `-soft` | 0 | reaches gameplay | correct | **black** |
| opengl | `-gl` | 2 | reaches gameplay, 92k batches in 80s | correct | **black** |
| direct3d | `-D3D` | 3 | reaches gameplay | correct | **stale pixels** |

No crash in any leg; T2 exits normally in all three. The D3D leg's leftover
loading screen and the other two legs' black are the same condition seen
through different buffer-clear behaviour, not two bugs.

**So this is not a D3DIM bug** — three independent backends cannot share a
rasterizer fault, and the HUD proves each renderer is alive and drawing through
the same pipe that shows nothing else. Every earlier D3D-specific theory in this
file is therefore dead: the vertex path, the viewport transform, the render
target, `SetDisplayMode`. Do not re-investigate them.

**The level loads.** `--trace-fs` over the whole route:

- `c:/valve/maps/hldemo1.bsp` misses as a loose file, which is normal — HL probes
  loose first and then the PAK — and `maps/hldemo1.bsp` **is** in `pak0.pak`.
- 1193 `pak0.pak` reads; 769 loose-file misses, all of them assets that live in
  the PAK (sprites, sounds, `pldecal.wad`).
- Zero engine errors: no `Host_Error`, no "couldn't load", no message box.

And the engine is clearly simulating: the level-start title card
("CURRENT LOCATION: LAMBDA REACTOR COMPLEX", "STATUS: EVALUATION IN PROGRESS")
is driven from `titles.txt` by a map trigger, so entities are ticking, and the
player holds 100 health rather than falling out of a broken world.

So: geometry data present, level running, 2D correct, world pass produces
nothing in every backend. The next question is what all three renderers share
upstream — the most likely candidate is the engine's 3D viewport rect
(`r_refdef.vrect` / `vid` dimensions): an empty vrect makes every renderer draw
2D only, which is exactly this picture. Confirm by counting what the GL leg
issues during a gameplay frame; zero world triangles points at the refdef, a
normal triangle count points at the surface they land on.

### The clock was the cause, and the three legs then diverge (2026-09-21)

**`--tick-ms-per-batch=200` (the default) renders no world at all, in any
renderer.** At 200ms of guest time per batch the engine's simulation step is so
coarse that the world pass produces nothing; the HUD and the level-start title
card still draw, which is what made this look like a renderer bug for a whole
session. This is the headless-clock trap in CLAUDE.md, and on this app it is
total rather than merely slow.

**Always pass `--tick-ms-per-batch=16` to Half-Life Uplink headless.** The route
then needs roughly twice the batches, since boot and menu take more of them:

```
IN='6000:mousedown:110:192,6030:mouseup:110:192,12000:…,24000:…,
    30000:mousedown:70:152,…,48000:…,130000:png:OUT.png'
node test/run.js --exe=…/hldemo.exe --args='-soft' --reg-import=SEED.json \
  --no-build --quiet-api --tick-ms-per-batch=16 \
  --max-batches=175000 --max-seconds=900 --no-close --input="$IN"
```

With that fixed, the three renderers stop agreeing, and the software one is now
the reference:

| leg | at 200ms/batch | at 16ms/batch |
|---|---|---|
| software (`-soft`, EngineType 0) | nothing | **correct** — corridor, floor tiles, ceiling, stairs, wall panels, signage |
| opengl (`-gl`, EngineType 2) | nothing | scattered lit polygons on black; static across 130k/170k |
| direct3d (`-D3D`, EngineType 3) | nothing | some geometry (gold fan-shaped streaks) over an **uncleared** loading screen |

So there are two real remaining bugs, and they are renderer-specific after all —
just not the ones hypothesised above:

1. **OpenGL draws only part of the world.** Software proves the BSP, the PVS and
   the camera are right, so this is in the GL leg. Note the software leg's frame
   moves (92.0% of pixels differ between 130k and 170k) while the GL leg's is
   byte-identical at both, so GL is not merely mis-drawing — it is drawing the
   same dead frame.
2. **Direct3D never clears the colour buffer**, so each frame composites over
   the previous loading screen, and what geometry it does draw is wrong.

Use the software leg as the oracle for both: same route, same tick, `png-diff`
against `t16soft-*.png`.

### OpenGL: the backend silently drops `glDepthRange`, which kills `gl_ztrick` (2026-09-21)

**Before any of this: `--headless-gl` needs `caffeinate -u`.** When the Mac's
display is asleep GLFW's display list goes empty, `glfwInit()` still succeeds,
and Half-Life reports "The selected OpenGL mode is not supported by your video
card." — which reads exactly like a renderer bug and is not one. `caffeinate -d`
is not enough: it only *prevents* sleep and cannot wake a display that is
already asleep. `-u` asserts user activity and does. The diagnostic is already
printed, so read it before theorising:
`[gl] --headless-gl requested but UNUSABLE: headless GL loaded but GLFW sees ZERO displays`.
Several runs and a whole texture/lightmap investigation were spent on phantom
bugs behind this line.

**The GL leg's root cause was `glDepthRange`, and the symptom named it.**
GoldSrc's `gl_ztrick` (on by default) **never clears the depth buffer**. Instead
it alternates, every frame:

```
even frames:  glDepthFunc(GL_LEQUAL)  glDepthRange(0, 0.5)
odd  frames:  glDepthFunc(GL_GEQUAL)  glDepthRange(1, 0.5)
```

so each frame's depth values beat the previous frame's leftovers by
construction. Verified in one run: 216 calls of each range and **zero
`glClear` calls**.

`@node-3d/webgl` (the `--headless-gl` backend) rejects *every* non-default
depth range with `GL_INVALID_OPERATION` (1282) — including the perfectly legal
`glDepthRange(0, 0.5)` — and silently leaves the range at `[0,1]`. Both z-trick
phases then wrote the full range and fought each other's leftovers, so **both**
rendered partially: the scattered-lit-polygons-on-black frame recorded in the
table above.

**The shape of the symptom is the diagnostic, and it is worth keeping.** A
missing depth *clear* breaks only the GEQUAL phase and gives alternating
good/bad frames. A dropped depth *range* breaks both phases and gives a stable
half-drawn scene — which is why the GL frame was byte-identical at 130k and
170k. That "it's drawing the same dead frame" observation was the real clue.

**Fix (in `lib/gl-compat.js`): fold the range into the projection matrix.**
Depth range is just an affine map on clip-space z —
`d = ((f-n)/2)*z_ndc + (n+f)/2` — so against a driver stuck at `[0,1]`
(`d = 0.5*z' + 0.5`) pre-transforming clip z as

```
z' = (f-n)*z + (n+f-1)*w
```

reproduces `d` exactly. It handles the reversed `f < n` case with no separate
negation, and `z'` stays inside `[-1,1]` for any `0<=n,f<=1`, so nothing is
clipped that would not have been. A one-time probe in the `FixedFunctionGL`
constructor (`_probeDepthRange`) sets `depthRangeEmulated` only when the
backend actually refuses a range, so browsers — where `depthRange` works — stay
on the original path, including the pre-existing reversed-range negation.
`test/test-opengl-depth-range-fold.js` pins the arithmetic against real GL's
mapping at five depths and pins that an honouring backend is left alone.

**Result: the GL leg renders the corridor correctly with stock `gl_ztrick 1`.**
No cvar workaround is needed and none should be added.

#### GL is not "slow", and the command stream already buffers

Measured with `tools/gl-stats-preload.js` on the gameplay route, per frame:

```
calls=7.3  batches=7.3  enq=592.7  draws=91.8  verts=5238  spans/draw=6.46
```

592.7 enqueued spans collapse into **7.3 host crossings**. The GL path already
does what D3D does — batch the command stream in WAT and submit it in bulk — so
transport is not a bottleneck and "buffer the calls like D3D" is already the
implementation. Do not re-open this.

#### GL hypotheses eliminated with evidence — do not re-investigate

- **Paletted textures** — not advertised, and HL checks before using them.
- **Hardware gamma** — HL has a `gamma` cvar but `hw.dll` has no `GammaRamp`
  import; `SetDeviceGammaRamp` is never called.
- **Multitexture / all-zero `texcoord1`** — expected, not a bug. `hw.dll` checks
  for `GL_SGIS_multitexture`, **not** the `GL_ARB_multitexture` we advertise, so
  it prints "NO Multitexture extensions found" and takes the single-texture
  two-pass path where `texcoord1` is legitimately unused.
- **Lightmap uploads** — 143 `SUB 128x128` RGBA uploads, none blank, maxByte 255.
- **Span merging across texture binds** — `enqueuePacked`'s mode-only merge is
  correct: `_call` already flushes pending geometry before every non-packed GL
  command (`lib/gl-compat.js`, the flush inside the dispatcher).
- **Blend state / `preserveDrawingBuffer` / depth persistence** — ruled out by an
  alternation test that captured five consecutive frames and found them
  identical.

Two traps in the *instrumentation* that produced false readings first: a
`_call` wrapper must record state **after** `origCall.apply`, because `_call`
flushes pending geometry inside it (recording before credits every draw to the
state that came after it, which made the lightmap pass look like it never
blends); and `glDepthRange` takes `GLclampd`, so a census must read it with
`_f64(stack,0)`/`_f64(stack,2)` — misread as floats it prints `0.000..0.000`
and `0.000..1.875` (the high dword of double 1.0, `0x3FF00000`, is float
1.875). `lib/gl-compat.js` itself was always correct on both counts.
`tools/gl-texture-census.js` is the corrected census, a `-r` preload needing no
source edit or rebuild.

### D3D: `D3DCLEAR_ZBUFFER` alone is deliberate (2026-09-21)

The earlier reading that "Direct3D never clears the colour buffer" is a
**misattribution**. HL calls

```
IDirect3DViewport3_Clear2(..., dwFlags=0x00000002, ...)
```

which is `D3DCLEAR_ZBUFFER` only, deliberately, relying on its own full-screen
world geometry to cover the colour buffer. Our `Clear2` honours the mask it is
handed and is correctly wired; a stale-looking backdrop under a D3D scene is a
**coverage bug in the draw path**, never a missing clear here. The stale comment
on `$d3dim_viewport_clear_full` in `src/09ab-handlers-d3dim-core.wat` that
claimed the 09a8 handlers return S_OK without painting is wrong and has been
corrected.

### D3D: `MultiplyTransform` had its operands the wrong way round — FIXED (2026-09-21)

**All three renderers now draw the Uplink corridor.** The D3D capture at 170k
batches matches the software oracle geometrically: walls, floor tiles, ceiling,
the wall panels, the stairs at the far end, HUD at 100 health.

The bug was one line in `$d3dim_multiply_transform`
(`src/09ab-handlers-d3dim-core.wat`): it computed `current × supplied` when D3D
requires the supplied matrix on the **left**. D3D transforms row vectors
(`v * World * View * Proj`), so the factor a `MultiplyTransform` appends has to
end up leftmost to be the one applied to the vertex *first* — which is what
makes a run of these calls behave like OpenGL's matrix stack, where
`glMultMatrix` post-multiplies a column-vector matrix. The two conventions are
transposes and `(M*A)^T = A^T * M^T`. Sealed by
`test/test-d3dim-multiply-transform-order.js`, which fails on the old order with
exactly the reversed translation row.

**Why it took a while to see.** The wrong product is still a proper rotation
(det +1), so nothing about the matrix looked malformed — it was a *valid camera
rolled 180°*, with the world upside down and 130 of 178 transformed vertices
behind the eye. Every cheaper hypothesis looked plausible and was wrong. Do not
re-investigate these:

- **The projection is not the problem.** HL uploads
  `[1 0 0 0 | 0 1.333 0 0 | 0 0 -1.002 -1 | 0 0 -8.008 0]`, which is exactly
  `glFrustum(near=4, far=4004)` — GL depth convention, `z_ndc ∈ [-1,1]`, which
  our D3D-convention clipper would halve. It is **also** a valid right-handed
  D3D projection with near ≈ 7.99, far 4004, and the two readings are
  indistinguishable from the matrix alone. Under the D3D reading it clips only
  closer than ~8 units, which is harmless. Handing raw GL column-major arrays
  to `SetTransform` is likewise *correct*, not a bug: row-vector × the
  row-major read of a column-major array equals column-vector × the original.
- **The near/far clipper is correct.** `$d3dim_tl_clip_distance` reconstructs
  clip z as `z_ndc/rhw` and `w - z` as `(1-z_ndc)/rhw`, and
  `$d3dim_interp_tl_clip_vertex` un-projects to clip space, interpolates there
  and re-projects. Behind-eye vertices are recoverable from a TL vertex exactly,
  because `rhw = 1/w` keeps w's sign.
- **No double transform, no FVF or stride mismatch.** ProcessVertices reports
  `srcFVF=0x242 stride=32 → dstFVF=0x1c4 stride=32` and the VB draw sees
  `vtxType=TLVERTEX`.
- **The scratch "aliasing" at state+3200 is deliberate and safe** — the three
  vertices are memcpy'd to `+3744` before the clip buffer reuses it.
- **`$d3dim_multiply_transform`'s multiply direction and `$d3dim_get_transform`'s
  copy direction** were both read and are correct; only the operand order was
  wrong.

**What the real path is.** HL's D3D world geometry is
`VB Lock → ProcessVertices → Unlock → IDirect3DDevice3_DrawIndexedPrimitiveVB`,
~164× per frame — *not* `DrawPrimitive`, which is why the `DPBlend`/`DPVtx`
records show nothing. A one-frame API census reads: 632 `SetRenderState`,
491 `DrawIndexedPrimitiveVB`, 457 `SetTexture`, **221 `MultiplyTransform`**,
106 `SetTransform`, 100 `GetTransform`. That Multiply/Get/Set mix is a GL
matrix stack (`glPushMatrix` → Get, `glPopMatrix` → Set, `glMultMatrix`/
`glRotatef`/`glTranslatef` → Multiply), and the sequence is Quake's `R_SetupGL`
verbatim: rotate −90 about x, rotate 90 about z, roll, pitch, yaw, then
translate by −`vieworg`.

**The tell, for next time.** The composite's translation row. Under the correct
order the translate is leftmost, so the rotations that follow rotate its offset;
under the reversed order it is last and its operand survives *verbatim*. Seeing
the raw `glTranslatef` argument sitting in the composite is the whole diagnosis.
HL confirms it independently: it also caches its own modelview and pushes it
through `SetTransform(WORLD)` 102×/frame with translation
`(-2047.969, -64.031, -744.031)` — the **rotated** origin, which is what the
corrected accumulation produces; the old order produced the unrotated
`(2047.969, -744.031, -64.031)`.

Two diagnostics were added for this and are worth reaching for again
(`--trace-dx`, and window them — a 60-batch window at gameplay contains *no*
frame, since HL runs 400–667 batches per frame):

| record | says |
|---|---|
| `[dx] Xform Set/Mul WORLD\|VIEW\|PROJECTION [matrix]` | every raw matrix the guest supplies, before composition — the sequence, which is the only thing that explains a composite |
| `[dx] PVout n=… v0 screen=…,… rhw=… BEHIND-EYE` | the first vertex ProcessVertices produced, flagged when `rhw <= 0`. The **share** is the signal: 2% is normal, 73% is a broken camera |
| `[dx] SetMtx handle=0xC0FFEE […]` | the composite world×view×proj actually used for a transform |
| `[dx] PVtx` / `[dx] DrawVB` | the VB path's layouts and vertex counts (change-gated, so they fire once per transition) |

Also fixed alongside: `IDirect3DDevice3_SetTransform` was a third hand-written
copy of the same memcpy and now aliases the canonical Device2 handler through
`api_table.json`'s `handler` field, as the Device7 slot already did. The copy had
drifted — it never unbound the execute-buffer matrix handle for the slot it
overwrote (so a later `$d3dim_refresh_bound_matrix` could put the handle's
matrix back over an explicit `SetTransform`), and it emitted no trace, so a run
whose census counted 106 `SetTransform` calls produced not one `Xform` record
and the transform sequence read as pure `MultiplyTransform` accumulation with no
reset anywhere in it. That missing reset was itself a red herring for an hour.

And one efficiency bug found on the way: `DrawIndexedPrimitiveVB` has no vertex
count in its signature — the whole buffer is the pool and the indices choose —
so the callers pass `count = -1` and the capacity clamp turned that into the
buffer's *capacity*. HL's is 32768 vertices, so every draw packed 1 MB and did
32768 conversions to rasterize the handful of vertices the indices named,
~164 draws a frame. Worse than slow: a failed 1 MB `heap_alloc` drops the draw
in silence. Now clamped to `max(index)+1` (`verts=32768` → `verts=4`). It was
*not* the visual bug — fixing it moved the frame 3.29% — but it is why that path
looked like it might be dropping geometry.

**Previous state, for the record**: before the fix the capture at 170k batches
showed the loading screen — "CURRENT LOCATION: LAMBDA … COMPLEX", "STATUS: …
EVALUATION IN PROGRESS" with overlapping/doubled text, a brown crate texture
tiled vertically, yellow streaked fan geometry down the left edge, and a correct
HUD. The HUD was right because it supplies TLVERTEX and never touches a matrix,
which is precisely why the matrices were only observable from inside
ProcessVertices.

### Confirmed again at a camera that is not level (2026-09-21)

The first confirmation of the operand order was made at a frame whose pitch and
roll were **exactly zero**, which is the weakest possible test of a matrix
*order*: with the middle rotations identity there are fewer non-commuting pairs
left to disagree about. So the route was extended to mouse-look. Deliver the
look with `relmousemove`, spread over batches — the docs' warning is real, a
single lump is a delta no hand could produce:

```
IN="$IN,171000:relmousemove:0:-160:40"   # up
IN="$IN,177000:relmousemove:0:320:40"    # back down, past level
```

At batch ~175k the `Xform` records show six `Mul WORLD` calls in this order —
`R_SetupGL` with **pitch 5.3° and roll zero** (GoldSrc omits the roll rotation
when the view has no punch, so there are four rotations, not five):

| # | supplied matrix | what it is |
|---|---|---|
| 1 | `[1 0 0 / 0 0 -1 / 0 1 0]` | `glRotatef(-90,1,0,0)` |
| 2 | `[0 1 0 / -1 0 0 / 0 0 1]` | `glRotatef(90,0,0,1)` |
| 3 | `[0.996 0 -0.092 / 0 1 0 / 0.092 0 0.996]` | **pitch, −5.3°** |
| 4 | `[0 1 0 / -1 0 0 / 0 0 1]` | yaw, −90° |
| 5 | `[… / 2047.969 -744.031 -64.031 1]` | `glTranslatef(-vieworg)` |

Appending each on the left gives rotation `[-1 0 0 / 0 0.092 0.996 /
0 0.996 -0.092]` and translation `(-2047.969, -132.2, -735.1)`. HL's own cached
modelview, pushed through `SetTransform(WORLD)` 90× in the same window, reads
`[-1 0 0 / 0 0.092 0.996 / 0 0.996 -0.092 / -2047.969 -132.228 -734.982]` —
**agreement to three decimals on a pitched basis**, computed two independent
ways. Under the reversed order the translation row would still be the raw
`glTranslatef` operand, so the two orders are genuinely discriminated here.

The composite (`SetMtx handle=0xC0FFEE`) is that world times the projection and
checks out arithmetically against it, `BEHIND-EYE` is 3 of 522 `PVout` records
(0.6%), and the three captures — `look-170-level.png`, `look-176-up.png`,
`look-182-down.png`, 93%/95% different from each other — all show the corridor
upright with the horizon pitching, walls vertical, floor below and ceiling
above. Nothing streaks or inverts at any pitch.

`test/test-d3dim-multiply-transform-order.js` now also drives the whole
`R_SetupGL` sequence with pitch 23.5°, yaw 137.25° **and** roll 11.75°, asserts
the device reproduces the hand-computed left-appending composite word for word,
and asserts the reversed product's rotation block differs from it by more than
rounding — so the test proves it discriminates the orders rather than merely
passing. It also asserts the composite's rotation rows stay unit length, which
records *why* the reversed matrix never looked malformed.

### The D3D-vs-software "lighting difference" does not exist (2026-09-21)

Worth recording because it was on the next-steps list twice. The D3D corridor
*looked* darker than the software oracle with flatter wall-sign detail. It is
not: `node tools/png-inspect.js stats FILE` now prints mean RGB and Rec.601
luma, and the two captures of the same scene come out at **54.18** (D3D) and
**56.44** (software) — a 4% difference, which is 16bpp quantization and
dithering, not a missing pass. A dropped `MODULATE2X` or an unrendered lightmap
halves the mean; nothing here is halved. The top-colour histograms overlap too
(`#3a4921` 1.86% vs 1.93%, `#424d29` 1.63% vs 1.75%).

The impression came from comparing two captures taken at slightly *different
camera positions*, where more or less of a dark ceiling is in frame. Measure the
mean before believing a brightness difference.

Two hypotheses died on the way, both by measurement rather than argument:

- **Missing `D3DTOP_MODULATE2X`.** Real gap — `$d3dim_texture_stage_combine`
  implements only `SELECTARG1` (2), `SELECTARG2` (3) and `MODULATE` (4), and
  `lib/d3dim-gpu.js` collapses everything else to 4 with
  `const op = v => (v === 2 || v === 3 ? v : 4)`, while `lib/d3d9-fixed.js:295`
  has the full table. But Half-Life never uses it: a census over one gameplay
  frame has `COLOROP` ∈ {2, 4} and `ALPHAOP` ∈ {1, 3, 4} and nothing else. The
  gap is real and worth closing for *some other* app; it is not this symptom.
- **Missing 2x framebuffer blend.** GoldSrc's overbright pass sets
  `SRCBLEND=D3DBLEND_DESTCOLOR (9)` with `DESTBLEND=D3DBLEND_SRCCOLOR (3)`,
  which is `src*dst + dst*src` = 2x modulate. `$d3dim_blend_channel` already
  implements both factors. The rest of the frame's render states are
  `ALPHABLENDENABLE` (202 toggles), `ZWRITEENABLE` (162), `SHADEMODE` (84),
  `ALPHATESTENABLE` (40), `ZFUNC`, `CULLMODE`, `ALPHAREF`/`ALPHAFUNC` — all
  covered.

Census command, for anyone re-opening this:

```
--trace-api=IDirect3DDevice3_SetTextureStageState,IDirect3DDevice3_SetRenderState \
--trace-from=168600 --trace-to=170000
```
