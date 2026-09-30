# Hitman: Codename 47 demo — original Glide 3 renderer

The registered `hitman_glide_demo` runs the installer-derived `launch-game/Hitman.Exe`
with the original `Render3DFX.dll`. Gameplay acceptance is still pending.

The renderer originally stopped with “Unable to run Glide on this card.” Static
inspection showed a real capability requirement: `Render3DFX.dll` queries
`GR_NUM_TMU` at preferred addresses `0x0fb978f3`–`0x0fb978f8`, rejects a single
TMU at `0x0fb978fd`, and later selects `GR_CLIP_COORDS` at `0x0fb97b6a`.
The implementation now supplies independent texture units and native homogeneous
clipping. Remote native ABI and software pixel tests passed, and the original
renderer progressed beyond that capability failure. This does not establish
complete game compatibility.

## Next startup failure: original EAX dependency

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
successful gameplay screenshot. Rerun acceptance after the DLL seed change.

## After EAX loads: incomplete DirectMusic interface

The next run (`build/hitman-eax-startup.log` on the same machine) passes the
EAX import and traps with the decoder's `0xCA002E20` marker at guest EIP
`0x20`. This is a bad COM method target, not an unsupported CPU opcode.

Sound's preferred `0x0ff315c3` calls `CoCreateInstance` for
`CLSID_DirectMusic {636B9F10-0C7D-11D1-95B2-0020AFDC7421}` and requests
`IID_IDirectMusic {6536115A-7B2D-11D2-BA18-0000F875AC12}`. Creation succeeds.
At `0x0ff315f9` (runtime `0x00ebd5f9`) it calls vtable slot 3,
`IDirectMusic::EnumPort(this, 0, caps)`, with `caps.dwSize = 0x134`.
The current availability-probe implementation allocates only the three
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
or huge values from active non-finite/overflowing values, which remain fatal.
Remote native ABI and software/WebGL pixel regressions pass. The browser then
reached texture uploads; gameplay acceptance remains pending.

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
Gameplay acceptance remains pending.
