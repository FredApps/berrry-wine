# Hitman: Codename 47 demo — original Glide 3 renderer

The registered `hitman_glide_demo` runs the installer-derived `launch-game/Hitman.Exe`
with the original `Render3DFX.dll`. The WebGL route reaches the original
restaurant mission; the current regression is described below.

The renderer originally stopped with “Unable to run Glide on this card.” Static
inspection showed a real capability requirement: `Render3DFX.dll` queries
`GR_NUM_TMU` at preferred addresses `0x0fb978f3`–`0x0fb978f8`, rejects a single
TMU at `0x0fb978fd`, and later selects `GR_CLIP_COORDS` at `0x0fb97b6a`.
The implementation now supplies independent texture units and native homogeneous
clipping. Remote native ABI and software pixel tests passed, and the original
renderer progressed beyond that capability failure. This does not establish
complete game compatibility.

## Original EAX dependency

The subsequent CLI run trapped as `UNIMPLEMENTED API: KERNEL32.#00005` with
return address `0x00db82f8`. That fallback label misidentifies the missing DLL.
The actual caller is `Sound.dll`, instruction `call [0x00dd2008]` at runtime
`0x00db82f2`. Relocating the IAT slot to Sound's preferred base `0x0ff30000`
yields `0x0ff50008`, whose original PE import is **EAX.DLL ordinal 5**.
The bundled `EAX.dll` exports ordinal 5 as `EAXDirectSoundCreate`, preferred
entry point `0x10001000`; its three arguments match the captured call.

`EAX.dll` was present in `launch-game` but absent from the app's initial DLL
seeds. The app now seeds it alongside `Globals.dll` and `xmlparse.dll` so the
runtime-loaded sound module binds to original guest PE code. The wrapper
imports only KERNEL32, USER32, ADVAPI32, OLE32 and DSOUND. This change neither
aliases EAX to DirectSound nor fabricates an implementation. The earlier XML
seed similarly supplies the original parser needed by EngineData/Locale.

Reproduce with the registered app after a normal build:

```sh
node test/run.js --app=hitman_glide_demo --quiet-api --trace-api --max-batches=300
node tools/disasm_fn.js test/binaries/candidates/hitman-codename-47-demo/launch-game/EAX.dll 10001000 20
```

The pre-EAX-fix log is retained on the reserved test machine under
`~/nfs-movsd/build/hitman-two-tmu-startup.log`. It demonstrates progression
past Glide initialization, then an audio import failure; it contains no
successful gameplay screenshot. Later browser runs pass this dependency.

## After EAX loads: incomplete DirectMusic interface

The next run (`build/hitman-eax-startup.log` on the same machine) passes the
EAX import and traps with the decoder's `0xCA002E20` marker at guest EIP
`0x20`. This is a bad COM method target, not an unsupported CPU opcode.

Sound's preferred `0x0ff315c3` calls `CoCreateInstance` for
`CLSID_DirectMusic {636B9F10-0C7D-11D1-95B2-0020AFDC7421}` and requests
`IID_IDirectMusic {6536115A-7B2D-11D2-BA18-0000F875AC12}`. Creation succeeds.
At `0x0ff315f9` (runtime `0x00ebd5f9`) it calls vtable slot 3,
`IDirectMusic::EnumPort(this, 0, caps)`, with `caps.dwSize = 0x134`.
The earlier availability-probe implementation allocated only the three
IUnknown slots (`src/09a7-handlers-dispatch.wat`, `init_com_vtable(3076,3)`).
Reading slot 3 therefore obtains unrelated data (`0x20`) instead of a method.

A complete interface must give every method a valid target and return honest
availability/results. Port enumeration ends on any nonzero HRESULT in this
caller; after enumeration Sound immediately creates another DirectMusic
object, so fixing the unsafe vtable alone does not establish music or game
support. Do not hide this with a CPU workaround or fabricate playable music.

```sh
node tools/disasm_fn.js test/binaries/candidates/hitman-codename-47-demo/launch-game/Sound.dll ff31590 60
node tools/disasm_fn.js test/binaries/candidates/hitman-codename-47-demo/launch-game/Sound.dll ff315e4 70
```

The safety fix now allocates all twelve IDirectMusic slots while preserving
its existing QueryInterface/AddRef/Release behavior. `EnumPort` returns
`S_FALSE` for every index because no DirectMusic port backend exists, without
reading or modifying the descriptor; null output returns `E_POINTER`.
These semantics follow the [upstream Wine implementation](https://github.com/wine-mirror/wine/blob/master/dlls/dmusic/dmusic.c),
and the slot order follows its [DirectMusic header](https://github.com/wine-mirror/wine/blob/master/include/dmusicc.h).
The remaining eight methods have explicit named fail-fast dispatch entries.
They no longer jump through allocator data. This provides safe interface
coverage, not a music synthesizer. Remote startup passed enumeration and
reached the original renderer's first draws.
The existing `test/test-directmusic-query-interface.js` now verifies slot IDs,
real vtable-derived EnumPort dispatch, untouched descriptors, stack cleanup,
and explicit failures beyond enumeration. All 59 focused checks passed on the
remote box, together with the full build gates.

## Clip lowering must ignore unused texture fields

After the DirectMusic fix, startup reached a fullscreen quad in Render3DFX
(preferred call `0x0fb9aa83`). Its vertex layout still enables ST/Q for both
TMUs, but the local-iterated framebuffer combiner consumes no textures. The
game sets W/Q and color while leaving texture stack fields undefined. Native
projection initially multiplied those unused values by texture scale and
tripped its finite-range check (`glide3_project_product`). The native setup
now fetches texture attributes according to framebuffer/TMU consumption,
leaving unused enabled fields unread. Regressions distinguish inactive NaN
or huge values from consumed invalid values. The later NaN S/T policy below
is the sole compatibility exception.
Remote native ABI and software/WebGL pixel regressions pass. The browser then
reached texture uploads.

## Aligned texture-memory limit

The subsequent browser trap at runtime `0x00ec78b2` (Render3DFX loaded at
`0x00eb2000`) maps to preferred `0x0fba58b2`, the thunk for
`grTexDownloadMipMap`. A source audit found `grTexMaxAddress` incorrectly
reported `4194303`, the last byte of 4 MiB RAM. The SDK defines this as the
largest valid texture **start** address, aligned for a download. The pinned
[Glide2 CVG implementation](https://github.com/sezero/glide/blob/2f226f0f9225ce8ee83e6a4a7042981e719d19ee/glide2x/cvg/glide/src/ditex.c)
returns `total_mem - 8`; the H3 Glide3 variant subtracts its own alignment.
The canonical backend advertises eight-byte alignment, so both API versions
now report `4194296`. ABI tests upload a 1×1 texture at that address on both
Glide3 TMUs and verify the Glide2 limit. The subsequent original browser run
reached the rendered main menu. A software CLI diagnostic diverged earlier
through a NULL call and does not establish browser behavior
(`build/hitman-texture-address.log`).


## Menu input uses a recentered cursor

BOX3 `build/hitman-input-observed/002-input.json` records normal DOM movement,
Win32 mouse dispatch and original guest `SetCursorPos` calls. The CSS-to-guest
transform reaches the intended menu point `(483,468)` correctly. The original
renderer then recenters to `(400,300)` after each mouse message. Feeding the
next absolute browser point directly makes it integrate displacement from the
center repeatedly: `(135,0)` adds `(-265,-300)`, then `(162,0)` produces
cumulative `(-503,-600)`. By the attempted click, the engine accumulated
`(-1105,-729)`, so its own drawn cursor was far from the browser click target.
Button-down and button-up also reused `(483,468)` after recentering and each
added another `(83,168)`. This is not a Glide viewport or CSS scaling failure.

The original `Render3DFX.dll` mouse method starts at preferred `0x0fbb3090`.
Its recenter call is at `0x0fbb330d`; engine mouse accumulators are at object
offsets `0xa95`/`0xa99` and the input-mode byte is at `0x38f1`. The observer
found mode zero. The module's global at relative `0x29024` points to the engine
pointer slot.

The Hitman profile now opts into existing `relativeMouse` behavior. The
browser suppresses absolute movement before capture, requests Pointer Lock
on the first trusted click, forwards subsequent physical deltas relative to
the guest's virtual cursor and uses that cursor for button events. This
preserves recentering without new game-specific input code. Real acceptance
must acquire capture first, then move the guest-drawn cursor and click; an
absolute `drawableClick` alone is not a valid input route for this engine.


Trusted-host verification (`/home/vg/glide-validation`) passes the three
existing relative-input/capture tests. With capture active, normal movement
and clicks advance through Start Game, the restaurant mission loading splash,
briefing, objectives, target, location map and equipment selection. Artifacts:
`build/hitman-relative-world/006-drawable.png` (loading),
`build/hitman-relative-world/013-drawable.png` (briefing), and
`build/hitman-briefing-start/037-drawable.png` (equipment). These are observed
original game UI screens; later captures establish in-world gameplay.
The guest-drawn cursor starts at the top-left, independently of the Win32
virtual cursor at `(400,300)`, and moves at roughly 0.4 drawable pixels per
relative guest unit. The temporary route captures at center, sends
`[1230,1190]` relative units to Start, then `[380,-130]` to the briefing's
next arrow. Buttons use the virtual cursor and no longer add displacement.


The subsequent `build/hitman-gameplay-final/025-drawable.png` reaches the
actual third-person restaurant mission: Agent 47, textured streets/buildings,
sky/fog and health/holster HUD are visible. An ArrowUp hold was sent at 180 s;
before/after captures show character animation but do not establish translation.
At approximately 301 s the guest traps in original Render3DFX runtime
`0x00ec77d4`, preferred `0x0fba57d4`: an indirect jump through IAT
`0x0fbb9230`, `_grDrawVertexArrayContiguous@16`. The browser worker discarded
the native exception stack, so the exact failure branch is not retained in
that run. A served-only diagnostic replay then captured native stack, ABI arguments
and bounded raw/state data before worker teardown.

The diagnostic replay reproduces the failure and resolves the native stack
to `glide_fail → glide3_vertex → glide3_array →
handle_grDrawVertexArrayContiguous`. Its retained artifact is
`build/hitman-trap.json`: polygon mode 3, three vertices, stride 60, buffer
`0x00ee39b0`. All three original guest vertices already contain quiet NaNs
(`0x7fc00000`) in ST0 S/T; positions, homogeneous W, colors, Q and ST1 are
finite. The active framebuffer/TMU combination samples texture 0, so treating
these coordinates as unused would be incorrect.

The original producer is preferred `Render3DFX!0x0fb91bc0`, called by
`0x0fb93ad2` before the draw at `0x0fb93b06`. It adds texture-object offsets
`+0x2c/+0x30` to indexed source UV pairs using simple FLD/FADD/FSTP operations,
then writes Q=1. Source globals at preferred `0x0fbc194c`, `0x0fbc1950` and
`0x0fbc195c` identify the source-UV object, index records and texture object.
The subsequent capture below identifies the original source values.


The next capture exonerates the CPU arithmetic and texture-offset animation.
Both texture offsets are finite `0.001953125`; the indexed source UV pairs
already contain NaNs. More decisively, the captured 2,048-byte neighborhood
matches the original unmodified `C1_HongKong/C1_3.zip` member `Pack.SPK`
byte-for-byte at offset `0x14defa`. The UV array starts 512 bytes later, at
`0x14e0fa`, and contains six consecutive quiet-NaN floats. The asset itself
ships these values. `C1_3_Laptop.zip:Pack.SPK` contains additional NaN runs.
The prepared NaN-store CPU probe was therefore never built or run.

The original Glide setup code forwards floating-point texture coordinates
without a finite-value API check. The [Voodoo3 specification](https://ftp.netbsd.org/pub/NetBSD/misc/macallan/voodoo3_spec.pdf),
sections 8.6 and 8.60–8.64, describes IEEE floating-point S/T inputs and
internal fixed-point conversion but does not define NaN texel selection.
[MAME's Voodoo register conversion](https://github.com/mamedev/mame/blob/master/src/devices/video/voodoo.cpp)
saturates exponent-255 inputs; its Voodoo2 setup path uses a different host
conversion. Neither justifies claiming a particular replacement texel is
hardware-exact. The chosen policy preserves geometry and valid coordinates.

The compatibility policy now replaces each consumed NaN S or T component
with zero before clipping/projection. Both TMUs and both coordinate modes
use the same conversion. Finite UV components, geometry, color, and Q are
unchanged; existing infinity and non-UV validation remains in place. This
is deterministic handling of unspecified texture sampling, not a claim of
hardware-exact H3 output. ABI regression draws a complete textured triangle
with mixed NaN/finite UVs and checks every emitted vertex. Remote focused
ABI checks pass, including NaN position/W/Q/color rejection and infinite ST
rejection.

## Bounded WebGL gameplay regression

The patched canonical build completed the same normal pointer-lock menu and
briefing route for 422.9 seconds on the trusted remote host, with default CPU
settings and no diagnostic WASM override. `build/hitman-nan-fixed/` retains
screenshots and `states.jsonl`; `026-drawable.png` shows the restaurant mission,
Agent 47, textured buildings/street/sky and health/holster HUD. The final
`078-drawable.png` remains in the live world with zero renderer errors.
The original route is unchanged through 320 seconds, beyond the earlier
approximately 301-second failure. This run did not count NaN-coordinate draws,
so elapsed survival is same-route regression evidence, not proof of a specific
NaN-bearing draw executing. The ABI fixture supplies direct coverage of that
case.

ArrowUp, W and D were delivered through normal browser input. Before/after
screenshots show character animation and advancing NPCs; they do not establish
player translation. This is bounded sustained world-rendering acceptance, not
complete mission/game compatibility, software-renderer acceptance, or a
performance result. Three existing relative-input/capture regressions and the
Glide 3 ABI regression also pass remotely. The deterministic NaN texel policy
remains an explicit approximation.

The shipped `HitmanKeyboardLayout_WASD.pdf` identifies W as Walk Forward
and D as Turn Right. However, `HitmanKeyboardLayout_Numpad.pdf` also describes
a default layout: Numpad5 walks forward, Numpad6 turns right, and Numpad8 runs.
The fixture's empty `hitman.cfg` and lack of a binding override in `Hitman.ini`
do not establish which preset is active. Probe logs confirm the WASD keydown,
1.8/1.2-second hold, and keyup completed, but do not prove the active guest
bindings or keyboard-state consumption.

The separate `build/hitman-numpad-final/` replay resolves that input question.
Using the same original menu/briefing route, it holds Numpad5 for eight seconds
at 150 s, Numpad6 for four seconds at 170 s, and Numpad8 for six seconds at 185 s.
Input is delivered through browser CDP key events with physical numpad codes,
location 3 and VK 101/102/104; the ordinary browser input log records these
key messages. No guest memory or bindings are modified. This avoids a test
harness ambiguity where numlock-off synthetic keys can report Clear or arrow
virtual keys instead of the intended numpad keys.

Visual comparison establishes movement: `026-drawable.png` is the starting
street view, `028-drawable.png` is against the building after walking,
`032-drawable.png` faces the opposite street after turning, and
`034-drawable.png` reaches the opposite building after running. The mission
notification also appears. The active setup therefore accepts the shipped
numpad layout; the earlier WASD result was not evidence of a keyboard failure.
The replay completes at 210.5 s, still running, with zero renderer errors,
zero LFB reads/writes, and zero GPU readbacks. These screenshots were opened
in Preview. This establishes bounded walking/turning/running acceptance on
the WebGL backend, while full mission completion and software gameplay remain
untested.
