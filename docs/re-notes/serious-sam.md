# Serious Sam: The First Encounter demo

## Fixture and current status (2026-10-01)

Candidate `serious-sam-demo` is the original Windows 1.00c demo, not a retail
copy or a native source port. Download/extraction is recorded in
`test/candidate-corpus/manifest.json`. The 82,531,165-byte installer has SHA-1
`9ba3a09da86754d27470c049a89e127959d1ecbe`. Its embedded CAB extracts directly
to `package/Disk1`, including `Bin/SeriousSam.exe`, Engine/Game/Entities DLLs,
three GRO archives, scripts, controls, and prerecorded demos. Assets remain
local and ignored. `--prepare` generates the browser inventory; no browser
app has been registered yet.

**Gameplay is verified in a private diagnostic build.** The frozen run reaches
Karnak Demo on Normal difficulty, walks into the courtyard, and shoots an
enemy (score 100, health 95). It uses the game's built-in keyboard polling
mode, selected through `/inp_iKeyboardReadingMethod=0;` in the console.
See the final section for the exact route and reviewed evidence.
Production memory and static TLS changes now pass focused tests. Stream-fault
and timer-context integration, a replay of the latest TLS build, and normal
launcher/input integration are still outstanding.
The corpus survey is only a smoke test and does not mount the full
parent tree; use the command below for the unmodified-source baseline.

## Reproduction

Build a private current module without replacing another agent's canonical
build:

```sh
node tools/build-compile-wat.js --out=/tmp/serious-current.wasm
node test/run.js \
  --exe=test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/SeriousSam.exe \
  --dll-seed=test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/Engine.dll,test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/Game.dll,test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/Entities.dll \
  --vfs-tree=test/binaries/candidates/serious-sam-demo/package/Disk1 \
  --exe-guest-path='C:\Bin\SeriousSam.exe' --cwd='C:\Bin' \
  --no-build --wasm=/tmp/serious-current.wasm --async-mm-timer \
  --quiet-api --quiet-blocks --no-close --stuck-after=0 \
  --max-seconds=30 --max-batches=20000 --batch-size=10000 \
  --tick-ms-per-batch=1 --save-vfs=/tmp/serious-vfs \
  --png=/tmp/serious-start.png
```

The explicit DLL seeds matter: the bare executable's automatic resolution
initially omitted Engine.dll and trapped on `?StringDuplicate@@YAPADPBD@Z`.
That is a fixture-loading error, not a missing Windows API.

Without asynchronous multimedia timer delivery the engine reports
`Problem with initializing multimedia timer - please try again.` Its periodic
timer uses a 50 ms delay, callback runtime VA `0x591610`. A 1 ms batch clock
plus asynchronous callbacks gets beyond this check. A 200 ms batch clock with
asynchronous callbacks produced a suspicious stuck loop; do not treat those
settings as validated. Later sections record the runtime fixes and private
experiments made after this baseline.

## Stream fault evidence

Seed order above gives Engine.dll runtime base `0x574000`, preferred base
`0x600c0000`; convert runtime VA by subtracting `0x574000` and adding
`0x600c0000`. Game.dll loads at `0x811000`, Entities.dll at `0x93f000`,
MSVCRT.dll at `0xbee000` (preferred `0x78000000`).

At batch 2803 the engine throws a `char *` C++ exception:
`Expected keyword Package:  not found`. The resource is `classes/Player.ecl`.
The raw GRO read at runtime `0xd6b274` contains the correct ZIP header and,
48 bytes later, the correct text:

```text
Package: TFNM Bin\Entities.dll
Class: CPlayer
```

The stream object at `0x074ffbe4` instead points at reserved address
`0x7eee0000`; its cursor has advanced to `0x7eee0001` after reading a zero.
Trace shows `VirtualAlloc(NULL,0x20000,MEM_RESERVE,PAGE_NOACCESS)` returning
that range, with no subsequent commit before the failed keyword comparison.
Our unmapped sentinel lets that read succeed with zero, so the guest's stream
fault handler never runs. Use:

```text
--trace-at=0x0058d931
--trace-at-dump=0x074ffbe4:128,0x00d6b274:128
--trace-api=VirtualAlloc,VirtualProtect,VirtualFree
```

`0x58d931` is the keyword mismatch branch (original `0x600d9931`). The throw
message survives at `0x074ff63c` in this exact run. `--headless-gl` reproduces
the same exception before graphics initialization, ruling out the absence of
a graphics context as this particular failure's cause.

Global `--fault-null=raise` is not a solution: it encounters an earlier low
address read (`0xa`, EIP `0x580910`) and reaches a generic Fatal Error dialog.
The existing `g2w_miss` fault mode also finishes the faulting instruction
against a sentinel, and `seh_walk_from` currently treats nontrivial MSVC
filters as execute-handler without executing them. Correct resumable stream
faults will need examination of both paths, preserving fault-time register
state and executing the actual filter before retrying the instruction.

Croteam's later published [Stream.cpp](https://github.com/Croteam-official/Serious-Engine/blob/master/Sources/Engine/Base/Stream.cpp)
corroborates the design: `CTStream::ExceptionFilter` locates the accessed
stream using `ExceptionInformation[1]` and returns
`EXCEPTION_CONTINUE_EXECUTION`. That source version commits buffers eagerly,
so it is context, not proof of the 2001 binary's exact implementation.

Diagnostic logs currently reside under `/tmp/serious-*.log`; the private
module is `/tmp/serious-current.wasm`. Continue with a narrowly scoped,
tested resumable SEH implementation, then verify rendering and interactive
gameplay. Do not mark the task complete based on the loading window.

## Resumable-fault prototype (2026-10-01, next investigation)

The previous turn was progress. A private transformed build now loads class
definitions and textures beyond the original `Package:` failure. It is an
experiment, not an integrated runtime fix or verified gameplay.

`/private/tmp/serious-seh-build.js` uses `test/compile-src.js` transforms and
writes `/tmp/serious-seh.wasm`. `/private/tmp/serious-run.sh` accepts that module
through `SERIOUS_WASM`; duplicate `--wasm` arguments do not override the first
one in run.js. Reproduce the latest state with:

```sh
node /private/tmp/serious-seh-build.js
SERIOUS_WASM=/tmp/serious-seh.wasm sh /private/tmp/serious-run.sh \
  --no-uop --quiet-blocks --save-vfs=/tmp/serious-safe-tls-vfs
```

The prototype makes three independent changes:

1. Unmapped high-address reads raise an access violation. MSVC frames handling
   hardware faults execute their real registered CRT handler through the
   existing raw SEH dispatcher. The actual executable filter is `0x423830`;
   it calls Engine `CTStream::ExceptionFilter`, original `0x600d92d0`, runtime
   `0x58d2d0`. Its arguments and fault address were verified in the trace.
2. Engine.dll has a real `.tls` template. `load_dll` currently only records
   the existence of a TLS directory for DisableThreadLibraryCalls, without
   allocating the template or assigning its index. The real stream filter
   uses `FS:[0x2c]` and `_tls_index` to find its list of open streams. Without
   DLL static TLS initialization, it declines the fault. Initializing the
   template makes it commit the stream's pages via VirtualAlloc and populate
   them. The latest transform allocates **after** `heap_reserve_below` to avoid
   placing TLS storage in the DLL image. Production implementation still
   needs validation, allocation-failure handling, and per-thread lifecycle.
3. Retrying the block-level EIP replays prologues that have already changed
   ESP/EBP. This caused a bogus `TVER` texture-header mismatch with a corrupt
   expected-ID pointer. The diagnostic decoder emits a NOP carrying each
   instruction's PC, and its handler records that PC for the fault context.
   With `--no-uop`, faults now name `0x58d656`, `0x58d924`, and `0x58d8ca`,
   rather than the earlier containing block entries. This gets past texture
   header parsing. Do not ship the prototype marker scheme as-is: it is
   unconditional, does not cover folded instructions comprehensively, and
   still needs precise side-effect/exception-state tests.

Latest terminal failure: C++ string exception
`Class 'CFlame' not found in entity class package file 'Bin\Entities.dll'`.
The demo's original DLL really has no `CFlame_DLLClass` export (2146 total
exports); the GRO contains `Classes/Flame.ecl`, and Entities.dll contains a
literal `EFNMClasses\Flame.ecl`. GetProcAddress correctly returns zero for
this name after successfully returning CPlayer, CPlayerWeapons, CProjectile,
CBasicEffect, CLight, and CBloodSpray class exports. Do not synthesize a fake
export. Determine why this optional/obsolete precache component is requested
and whether its exception should be handled. The game's own
`gam_iPrecachePolicy=0;` in Scripts/PersistentSymbols.ini did not alter this
startup path; it may execute too late.

Evidence: `/tmp/serious-procs.log`, `/tmp/serious-precise-msg.log`, and
`/tmp/serious-safe-tls.log`; the message pointer in the latest exact layout
is `0x074ff6e4`. `CDLLEntityClass::PrecacheClass` is original `0x6019f2d0`,
with C++ handler stub `0x601ded1b` and FuncInfo `0x601f2840`.
`gam_iPrecachePolicy` is original BSS `0x60243b38`, runtime `0x6f7b38`.
The gameplay objective remains open. The following investigation supersedes
the missing-class blocker above.

## Nested rethrow and bulk-copy faults (2026-10-01)

The missing `CFlame` is optional precaching. Engine original `0x6019eb80`
(runtime `0x652b80`) catches component-load failures at `0x652bea`; its
handler is `0x692c77`, FuncInfo original `0x601f26e8`. The live precache policy
is 1. The exception first reaches a cleanup catch in the class stock loader,
which rethrows. The CRT catches its own null-payload rethrow and returns to
the original exception search. Our software dispatcher previously retained
the nested exception's global record and frame. Outer catches then received
the null-payload rethrow after the CRT had cleared its current-exception TLS.

`src/11-seh.wat` and `src/09b-dispatch.wat` now preserve dispatch state per
handler invocation on the guest stack. The continuation recovers its record
and establisher from the cdecl arguments, plus its saved chain head and resume
EIP/ESP. This is the first integrated runtime fix from this investigation.
The nested-dispatch regression in `test/test-seh-continue-execution.js`,
`test/test-delphi-seh-mutated-chain.js`, and `test/test-rtl-unwind-handlers.js`
pass. No canonical build was replaced.

The next `AFIN` animation-header error came from repeated faults inside one
REP MOVS operation, not a missing asset. `/tmp/serious-afin4.log` shows the
stream pointer replaced by an exception record after a bulk read faults at
`0x58da9a`. `/tmp/serious-once-build.js` extends the private prototype with
an `eip_redirected == 0` guard on raising another fault. This preserves the
first fault context until its handler runs and lets the copy retry. It gets
through asset precaching and reaches the game's first-run Information dialog.
The TLS, exact-PC, hardware-dispatch, and bulk-fault changes remain private
diagnostics and need production design and regression coverage.

`/tmp/serious-first-gl.png` shows the actual first-run dialog. The guest log
is `/tmp/serious-first-gl-vfs/serioussam.log`. Sending `keypress:13` did not
dismiss that dialog; its OK button is around `(317,277)` at 640x480.
This is startup evidence, not menu or gameplay verification.

## Graphics initialization and frozen control (2026-10-01)

**User instruction: use `ctl.js` with frozen mode for long runs.** The current
private helper accepts `SERIOUS_BATCHES` and `SERIOUS_SECONDS`; batch value 0
maps to a large limit (run.js itself interprets an explicit 0 as zero work).
Start a controllable session with:

```sh
SERIOUS_WASM=/tmp/serious-once.wasm SERIOUS_BATCHES=0 SERIOUS_SECONDS=0 \
  sh /tmp/serious-run.sh --no-uop --quiet-blocks --headless-gl \
  --control=8138 --frozen > /tmp/serious-frozen.log 2>&1
node tools/ctl.js -s :8138 step 16000
node tools/ctl.js -s :8138 cmd dlg-cmd:1
node tools/ctl.js -s :8138 step 14000
node tools/ctl.js -s :8138 snapshot
```

First graphics blocker was SearchPathA failing to find `OPENGL32.DLL` before
the game even tried LoadLibraryA. The shared boot helper now mounts a minimal
PE discovery file marked `staticModule`, preserving any real mounted driver.
OpenGL was appended to the static-module name list so qualified-path module
lookup also retains the correct identity. The file carries no fabricated
DirectX version. `test-directx-system-files.js` covers SearchPath and the
static loading route, and `test-system-data-files.js` covers boot mount count;
both pass.

Next were the required `wglGetCurrentContext` and `wglGetCurrentDC` exports.
These now return the actual frontend binding, with the DC updated when
MakeCurrent succeeds. Appended API IDs are 3958 and 3959. The extended
`test-opengl-swapbuffers.js` passes query/bind/failure/unbind and stdcall
cleanup checks. API hash and dispatch generation checks pass.

Engine `0x5bd140` resolves many GL names but only explicitly requires
`glGetError` and ten WGL calls. Do not add fake implementations for every
name in its table. The two missing WGL queries were its only absent required
exports. The required-name checks are recorded in `/tmp/serious-glload.asm`.

The latest frozen run now creates `Serious Sam (FullScreen 640x480)` and a
real GL context. It calls NULL at batch **21806**, return PC **0x5bc5cf**:
Engine `0x5bc5c9` calls the missing **glGetTexLevelParameteriv** through
original pointer slot `0x60231604`. Arguments are `GL_TEXTURE_2D`, level 0,
`GL_TEXTURE_GREEN_SIZE` (`0x805d`), and an output pointer. Immediately before
this it defines a small `GL_RGBA8` texture with glTexImage2D and then tests
whether the green channel has eight bits. Implement the texture-level query
against real stored texture metadata, then continue the frozen launch.
`/tmp/serious-frozen.log` and the last `ctl.js snapshot` are the evidence.
This remains startup, not menu or gameplay.

## Texture query and stream reload (2026-10-01)

The texture-level query above is now implemented (API 3960, GL opcode 108,
synchronous output barrier). `lib/gl-compat.js` retains defined texture-level
dimensions and component sizes, including generated mip levels; deletion
removes the metadata. Fixed-function frontend tests and WAT encoder parity
pass, as do GL barrier, generated ABI/API/dispatch, and handler ESP checks.
The broader command-stream test failed in native glBatch RPC at line 409
with the same failure when the new opcode was removed as a control.

The private `/tmp/serious-rep-build.js` experiment combines the earlier TLS,
precise-PC and hardware-dispatch changes with PTE removal on decommit,
PTE republishing on contained recommits, and element-by-element REP MOVS
that preserves completed iterations across a fault. These are diagnostic
transforms, not integrated runtime changes. Decommit alone repeatedly
restarted the stream copy; preserving REP progress restores startup to the
Information dialog by batch 16000.

After dismissing that notice with `ctl.js cmd dlg-cmd:1`, the REP experiment
still fails reloading `Models\\Effects\\Debris\\Flesh\\FleshGreen.tex`:
expected `TVER`, found an empty ID. The faulting header read is runtime
`0x58d8ca` (Engine original `0x600d98ca`). The failed run was confirmed alive,
frozen at batch 36000 with zero credits, then closed with `ctl.js quit`.
The next frozen run logs VirtualAlloc/Free/Protect after batch 16000 to
`/tmp/serious-rep-trace.log`, using the same private module. Gameplay remains
unverified; no app registration or production stream-fault fix yet.

The allocation trace resolves this particular `TVER` failure: after releasing
`0x70000000`, the engine reserves `0x6fff0000` for FleshGreen. The private
fault prototype only raised for addresses >= `0x70000000`, so this valid
reserved stream silently read zeros. `/tmp/serious-range-build.js` replaces
that arbitrary cutoff with `$virtual_alloc_min`; its frozen run logs to
`/tmp/serious-range-frozen.log`. This does not establish correctness of the
remaining fault machinery or eliminate the need for production integration.

The widened-range prototype passes both texture reload rounds and starts
`Levels\\Intro.wld`. At frozen batch 32000 the guest log says `All textures
reloaded`, `All models reloaded`, then `Starting session: 'Levels\\Intro.wld'`.
`/tmp/serious-range-32000.png` shows actual GL text and a green loading bar,
`LOADING WORLD TEXTURES`, 15%. This is the first verified in-game loading
screen, not gameplay. `ctl.js step` returned an observation timeout for the
16000-batch advance, but a snapshot of the same session proved it completed
normally at batch 32000 with zero credits; no restart was necessary.

The same run reaches world geometry, models (79% at 55000), entities (68%
at 63000), then precaching (46% at 67000). By frozen batch 71000 it stops
with `Can create memory stream, stream handling is not enabled for this
thread`. Main thread ID is 1, no ThreadManager workers exist, and Engine
TLS index 0 points at `0x711004`, whose enabled flag +8 and stream list +12
are both zero. Call stack returns include `0x58f8f1`, `0x62f4b2`,
`0x62c7a6`, `0x821e61`, `0x420757`.

The only direct Engine caller of DisableStreamHandling (`0x600d9290`) is
`CNetworkTimerHandler::HandleTimer`, original `0x60175b00`. It enables at
`0x60175b33`, calls the network timer body, then disables at `0x60175b6d`.
Our async timer injects that callback in the interrupted main thread and
preserves registers but shares its TIB/TLS. The callback therefore clears
main-thread stream state. This is distinct from absent DLL TLS initialization.
Microsoft's [timeSetEvent documentation](https://learn.microsoft.com/en-us/previous-versions/ms713423%28v%3Dvs.85%29)
specifies that the multimedia timer runs in its own thread, supporting a
separate thread context rather than borrowing the application's TLS.

Next private diagnostic: `/tmp/serious-timer-tls-build.js` builds
`/tmp/serious-timer-tls.wasm`, giving async timer callbacks a persistent
separate TIB/TLS vector populated from loaded DLL templates; CACA000A restores
the interrupted TIB/TLS. This is not a complete timer-thread implementation
(identity, notifications, dynamic TLS lifecycle and later DLL loads remain
open). Test whether this isolates the stream state before production design.
The prior range module SHA-256 is
`9582a6aee3b899de826bee896972ec990838bc9b78f9b06c3f450afbbc55e639`;
`test/test-bw-rep-copy.js /tmp/serious-range.wasm` passed all 16 cases.

Timer-TLS experiment result: startup still passes, and the live main-thread
TLS flag stays 1 with its stream-list pointer intact. No stream-disabled
dialog occurs. The process instead terminates at batch 69181 with an
unhandled access violation at REP copy `0x5ca72d`; log
`/tmp/serious-timer-tls-frozen.log`. Both ctl connection refusal and launcher
session completion confirmed termination, rather than an observation timeout.
Immediately before this, `0x57a5ce` (original `0x600c65ce`) writes the initial
count into a newly created CTMemoryStream. Our exception record currently
always sets ExceptionInformation[0] to 0 (read), even for that write.
Engine's filter explicitly tests this field before calling the page handler.

Next diagnostic `/tmp/serious-write-fault-build.js` adds write classification
to gs8/16/32/64 translation and REP destination preflights, captures it before
raising, and writes it to ExceptionInformation[0]. Its controlled run logs
to `/tmp/serious-write-fault-frozen.log` and saves the VFS under
`/tmp/serious-write-fault-vfs`. This hypothesis is unverified until that run.

Write-classification result: same exit at batch 69181, same API and MMX
counts as the timer-only experiment; this does **not** explain the remaining
failure. The saved guest log does prove `Starting session: Levels\\Intro.wld`,
`started`, and `Adding player: Serious Sam`, `done` before termination.
No rendered world or responsive player has been verified. Next inspect the
two char-pointer throws near the end and the final fault address/stream list
before `0x5ca72d`; do not label the exit a NULL-call bug merely because the
CLI prints eip-zero after the guest unhandled-exception exit.

Focused trace `/tmp/serious-session-trace.log` locates the two char-pointer
throws at batches 68994/68997 in `0x652f14`: class missing from entity-class
package (one surviving filename is `Classes\\CannonBall.ecl`). These catches
return; they are not themselves the final unhandled fault. Single stepping
at the stream filter shows main TLS enabled but its stream-list pointer
changing between callbacks. At batch 69156, EnableStreamHandling is called
from network timer return `0x629b38`, callback active, FS `0xc6e444`, with
callback TLS block `0xc6e264`; the main block remains `0x711004`.

Critical correction to the timer experiment: `$apply_seg_override` in
`src/07-decoder.wat` adds `$fs_base` to displacement **during decoding**.
Reusing one instance's cached code after changing FS therefore keeps the old
TIB address in previously decoded instructions. Swapping `$fs_base` alone
does not isolate TLS. Also, the DispatchMessage MM_TIMER path needs the same
isolation as `$fire_mm_timer`.

Next private build `/tmp/serious-timer-context-build.js` keeps the decoded FS
base stable and exchanges the TIB's SEH head and TLS-vector pointer around
callbacks, including DispatchMessage, retaining a separate callback vector.
Its limits remain those of a borrowed execution context, not a real system
thread. Current output/log names are `/tmp/serious-timer-context.wasm` and
`/tmp/serious-timer-context-frozen.log`. The traced session was closed with
ctl quit after preserving the evidence; this next experiment needs validation.

Stable-FS callback-context result: frozen batch **71000** passes the former
69181 exit, preserves main stream-list pointer `0xc5ff44`, and shows
`STARTING SESSION 100%` in `/tmp/serious-timer-context-71000.png`. The guest log
again confirms the intro session started and the player was added. No world
frame or gameplay is yet established. This validates the cached-FS diagnosis
for the earlier isolation experiment; the production implementation still
needs separate callback execution state and lifecycle coverage.

The stable-FS run reaches batch **80029**, then calls NULL for a new reason:
missing **glClearDepth**. Frozen checkpoint 81000 is still alive, EIP 0,
no credits, no fatal dialog. Return PC `0x5b1ba7` maps to Engine original
`0x600fdba7`; its preceding indirect call uses original slot `0x60231238`.
The loader writes that slot after resolving the string at `0x6021a838`,
verified as `glClearDepth`. Argument is double 1.0. Main stream list remains
`0xc5ff44`, and the former stream-disabled/unhandled fault is absent.

Next implement actual clear-depth state and transport (not a constant-success
stub), preserving the shared renderer agent's ongoing clear work. Current
`GPUBackend.clear(color,mask)` does not take a depth value; inspect current
backend/common-worker state before changing it. Then continue the frozen
route with the timer-context prototype, followed by production integration
of its required memory/TLS/timer behavior. The existing REP regression passes
all 16 cases with `/tmp/serious-timer-context.wasm`.

Reviewed evidence bundle:
`scratch/runs/20261001T220944Z-serious-sam-demo-codex-first-frame/`.
It preserves the actual tested module hash, loading screenshot, runtime log
and private build/launch sources. Outcome is failed first-frame rendering;
it does not claim playable gameplay or a clean production build.

### Clear-depth implementation and next frozen run

`glClearDepth` is now appended as API 3961 / GL opcode 109, with two physical
argument words for its double. The direct frontend clamps and retains the
value, saves/restores it with depth attributes, and supplies it to each native
backend clear. Software clears quantize to the 16-bit depth surface and honor
the depth write mask. Focused frontend/backend, software pixel, and generic
WAT encoder tests pass, as do API/ABI freshness, handler-stack and logical-and
checks. Pixel tests distinguish clears at 0.125 from the default 1 and verify
both clamping and masked clears.

The next frozen run uses the same private timer-context transformation plus
this API. Module SHA-256 is
`a90941ee1ef075f57bc64217ad60165254d298a92492027d7aaa49bef5640ceb`;
log `/tmp/serious-clear-depth-frozen.log`, VFS `/tmp/serious-clear-depth-vfs`,
control `:8138`. This is still a diagnostic module, not production readiness.

Result: passes batch 80029 and renders the Croteam logo at 81000, visibly
brighter by 86000. `glClearDepth` resolves to thunk `0x7504970`. Escape was
queued at 86000; the subsequent step exited at 87313 with an unhandled access
violation, not a missing-API NULL call. The initial logged fault PC `0x5c00bf`
maps to Engine `0x6010c0bf`, an indirect **glDrawElements** call through
`0x60231510` (loader string `0x6021b1e0`). The later exception address on the
guest stack is not yet explained. Do not infer Escape caused the failure.

Reviewed evidence: `scratch/runs/20261001T222000Z-serious-sam-demo-clear-depth/`.
The two PNGs establish animated intro rendering only, not world/menu/gameplay.
Next run keeps the identical module and frozen route, adds API argument
tracing for draw/client-array calls from batch 80000, and writes
`/tmp/serious-draw-trace-frozen.log`. Inspect pointers/indices before changing
the renderer or fault-continuation path.

The argument-traced replay did **not** reproduce the 87313 failure. It passed
87400 without Escape, then held Escape at 87400–87700, and rendered the second
publisher logo at 89700 and the title/character scene at 99700. This does not
establish deterministic stability. Existing unmapped tracing was enabled with
`exports.set_fault_unmapped(1)` around 84000; `console.log = console.info` at
89700 kept the existing diagnostics visible after the trace window.

Menu input diagnosis: focus was HWND `0x10008`, Engine rendering-window proc
`0x5d20b0`, whereas the game window is `0x10006`, EXE proc `0x4047f0`.
The renderer consumed Escape because `dialog_ancestor(0x10008)` returned
itself and `dlg_get_ctrl_count(0x10008)` returned 2. Its slot retained old
`WND_DLG_RECORDS` metadata. Production `wnd_slot_reset` now clears that
separate 32-byte record; `test-wat-window-tables` passes 8/8 checks, including
ordinary-window reuse after a dialog and the existing concurrent claims.
The currently live module predates this fix. Correct focus/routing still
needs an end-to-end retest after rebuilding.

A normal `post_message_q(0x10006,0x100,27,0x10001)` reached the main menu.
Then three Enter keydown messages to the same window (500-batch steps between
them) selected Single Player → New Game → Normal. Loading Karnak starts
around 102200. At 152200 the screenshot says LOADING ENTITIES 56%; at 172200
it says PRECACHING 100%. Session has not yet reported started. Current bounded
step target is 192200. No player movement or playable world is yet verified.
Screenshots are under `scratch/runs/20261001T223000Z-serious-sam-demo-draw-trace/`;
publish its result metadata after inspecting the next checkpoint.

### Verified diagnostic gameplay (240001 frozen endpoint)

Karnak finishes loading before batch 200000, reports `started`, adds the
player, and creates `SaveGame\\Player0\\Quick\\QuickSave000000.sav`.
The first screen is NETRICSA's mission briefing. Posting Escape to game
HWND `0x10006` closes it; by about 206000 the temple room, revolver, torches,
crosshair and health 100 are visible. Both direct-input W and ordinary W
after focusing the game window initially failed to move the player.

The input object at `0xcb1fb4` is enabled (`+4 == 1`), but
`inp_iKeyboardReadingMethod` (Engine original `0x60222ca8`) is 2. That mode
reads the array populated by WH_GETMESSAGE/WH_CALLWNDPROC callbacks. Both
hook handles at original `0x6022aed4`/`0x6022aed8` are zero: the emulator
currently supports hook IDs 2 and 5, not 3 and 4. `GetInput` at original
`0x600cc290` selects GetAsyncKeyState polling when the setting is zero.
The game registers it as `persistent user INDEX inp_iKeyboardReadingMethod;`.

Use the **game console**, not a guest-memory patch: focus HWND 10006 with
`exports.set_focus(0x10006)`, send tilde VK192 (`0x290001` lParam), and type
`/inp_iKeyboardReadingMethod=0;`, then Enter. The slash is required; the
unprefixed text was merely chat. Readback confirmed value 0. Close console
with tilde. This setting should become part of the reproducible launch
configuration; message-hook implementation is another option, not a fake
success return.

At batch **234000**, ordinary `keydown:87`, then frozen `step 3000`:
the player walks through the door into the courtyard. Release W at 237000.
After a further 1500 idle batches, `di-mousedown:1` from **238500–240000**
kills the approaching enemy. The reviewed final image shows the fallen
enemy, score **100**, and health **95**, proving combat response as well as
camera movement. Mouse button released and one final step processes it.
Session :8138 remains frozen at **240001**, credits 0, all test controls up.

Reviewed result bundle:
`scratch/runs/20261001T223000Z-serious-sam-demo-draw-trace/result.json`.
Contains gameplay/menu PNGs, runtime/guest logs, final snapshot, exact module
hash and private build/launch sources. The pass applies to this diagnostic
route; it does not establish production readiness. The earlier draw fault
did not recur on this trace replay, so its exact cause remains unresolved.

Remaining integration: implement the required fault/restart and multimedia
callback context behavior in production with focused coverage;
apply the polling configuration reproducibly; register a full-root corpus
launcher; retest ordinary focus/input and gameplay with the integrated build.
The new window-slot metadata cleanup is tested but absent from the live module.

## Production virtual-memory integration (2026-10-01, 23:11 UTC)

`10-helpers.wat` now withdraws packed PTEs on MEM_DECOMMIT and restores
absent pages only after the complete MEM_COMMIT request succeeds. Existing
committed bytes and per-page protection overrides survive recommit, including
a request that both recommits an old prefix and allocates a new tail.
Page-rounded decommit and the zero-size whole-allocation form are covered;
the latter previously also cleared unrelated allocations above its base.

Enabling withdrawal required fixing an additional allocation path: a commit
starting before an older map could publish overlapping backing. It now splits
at existing guest-map boundaries. Failed speculative allocations remove only
new records; rollback no longer reconstructs whole surviving maps, which
would resurrect decommitted holes and erase protection overrides.

Passing tests: `test-virtual-decommit-zero` (including VirtualQuery reserve /
commit transitions and actual writes after recommit),
`test-virtual-map-split-rollback` (old bytes, read-only protection and an absent
page survive failure), `test-virtual-map-cross-instance`,
`test-virtual-map-split-commit`, and `test-virtual-free-mapped-view`.
WAT logical-AND, parenthesis/label and diff checks pass.

New private diagnostic module `/tmp/serious-memory-integrated.wasm`, SHA-256
`405db372519c5071a67b765ef378c112bdd5c2cd9b7c4d6e53579187a11a84e0`,
uses production `10-helpers.wat` unchanged; its builder removes both old
private memory transformations. Other fault/REP/DLL-TLS/timer transformations
remain private. Frozen session `:8146` reached the first-start Information
dialog at batch 16000, then reached the Croteam intro and parked at **87000**
after dismissal (credits 0, quit false, EIP `0x63d5e0`). The intermediate
`ctl.js step` observation timeout did not terminate the process; later
snapshots established continued progress and completion. Viewport HWND 10008
now reports `dlg_get_ctrl_count == 0`, confirming the window-slot cleanup in
this module. Normal menu/input and gameplay are not yet retested on it.
Evidence belongs to
`scratch/runs/20261001T231100Z-serious-sam-demo-memory-host/`.
An earlier sandboxed native-graphics initialization stalled before the control
server and was explicitly terminated; it is recorded separately in
`scratch/runs/20261001T230750Z-serious-sam-demo-memory-integration/`.
The prior gameplay session `:8138` remains parked at 240001 with its old module.

## Production static TLS data (2026-10-01, 23:35 UTC)

EXE and DLL loaders now register relocated TLS data through shared native
helpers. A process-shared template list uses offset24 of the existing
64-byte TLS state region. Each registered thread vector receives an independent
template copy plus zero fill; later vectors initialize the same way before
their guest thread starts. DLL TLS allocation occurs after the heap is moved
past the image and before publishing its module. Bad directories and index
exhaustion reject loading; the host DLL loader checks that a module row was
actually published before returning a handle.

`test-tls-lifetime` passes all 108 existing native API observations plus EXE
and relocated DLL data, existing/new thread isolation, zero-only storage,
malformed-directory rejection, host failure propagation and index exhaustion.
`test-tls-shared-workers`, `test-large-dll-staging` and
`test-disable-thread-library-calls` also pass. Logical-AND, region-copy census,
parenthesis/label and diff checks pass. No canonical build or performance claim.
This data work does not add PE TLS callback delivery or unload lifecycle.

Private builder `/tmp/serious-tls-integrated-build.js` now omits both memory
and DLL-TLS transformations. Its module SHA-256 is
`363d07ed0466b0946f0e22bd0ee99253bb22c0275d36d4c168219e9326e4bc39`.
The exact module and builder are copied to
`scratch/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd/`.
**This new module has not been run against Serious Sam.** The coordinator
wind-down request arrived while its build/tests were active; those bounded
jobs completed, and no new run was started. Full handoff:
`ops/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd.md`.
Both older controlled sessions were revalidated frozen with credits0:
`:8138` gameplay at240001, `:8146` memory-integration intro at87000.
