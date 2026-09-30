# Hype: The Time Quest demo

App: `hype_glide_demo` (experimental). Original executable:
`test/binaries/candidates/hype-time-quest-demo/launch-game/MaiDFXvr_bleu.exe`.
The executable directly imports 50 Glide 3 entry points. Static extraction,
English installer mappings, package provenance and generated Windows INI are
documented in [the Glide 3 corpus report](../glide3-corpus.md).

## Startup DebugBreak: missing main-image export lookup

The 2026-09-29 remote CLI smoke stopped in the original sound plugin before
establishing Glide gameplay. The relevant log is
`~/nfs-movsd/build/hype-glide-smoke.log` on the reserved test box. It loaded:

| Image | Original base | Observed loaded base |
| --- | --- | --- |
| `MaiDFXvr_bleu.exe` | `0x00400000` | `0x00400000` |
| `dll/WAVx2BVR.dll` | `0x10000000` | `0x04301000` |

Thread 1 stopped at runtime `0x04302129`, preferred DLL VA `0x10001129`.
The preceding instruction reads the callback cell at preferred
`0x10024b9c`; if it is zero, the plugin calls `DebugBreak`. After the break,
the wrapper would call that same pointer, so ignoring the break would enter
address zero rather than repair startup.

The plugin initializer at `0x10003fb0` first resolves
`_SND_fn_vDisplayError@8` from the main executable handle. Its lookup helper
at `0x10003f40` calls `GetProcAddress`. If that returns zero, it constructs
the message `Function cannot be loaded dynamically` and invokes the error
callback that it has not yet initialized. Thus the visible break is the
error-reporting path for the failed export lookup.

The original executable **does** export the requested callback:

| Name | Ordinal | Original function VA |
| --- | ---: | --- |
| `_SND_fn_vDisplayError@8` | 2229 | `0x004d5430` |
| `_SND_fn_vDisplayErrorEx@12` | 2230 | `0x004d5490` |

The executable has 2,739 export-address entries, no zero holes and no
forwarders. Its export directory is RVA `0x194d70`, size 115,602 bytes.
This was checked against the original file, not inferred from strings.

`handle_GetProcAddress` previously searched `DLL_TABLE`, then known native
API names. The executable is not a member of `DLL_TABLE`, so it could not
answer this lookup. The fix resolves exports from the main image before
that existing path, using the shared mapped DOS/PE headers to obtain the
export directory. It must not rely on the loader instance's
`exe_export_rva` global: Hype makes the call on a secondary guest thread.
No sound configuration, executable bytes, or `DebugBreak` behavior changed.

The existing `test/test-getprocaddress-sparse-name.js` now checks the callback
name and ordinal, out-of-range ordinals, a zero address-table slot, an absent
name, stdcall stack cleanup and operation with the loader-global RVA zero.
Its original sparse-heap Win32 lookup still passes. The focused test passed
remotely on 2026-09-29 after correcting the synthetic fixture's name pointers
to lie above the 16-bit ordinal range. The post-fix remote CLI run reached a
visible main menu without the startup `DebugBreak`; evidence is
`build/hype-fixed-startup.log` and `build/hype-fixed-startup.png` on the test
box. The screenshot was opened for review. Browser Glide identity, entry into
the playable world and input-driven movement remain pending; menu acceptance
alone does not establish gameplay.

## Reproduction

Prepare the original extracted corpus, then use a current compiled artifact
on the remote test machine:

```sh
node tools/prepare-glide3-corpus.js --check
node test/test-getprocaddress-sparse-name.js
node test/run.js --app=hype_glide_demo --threads --no-build \
  --wasm=build/wine-assembly.wasm --quiet-api --max-batches=2000 \
  --png=build/hype-fixed-startup.png
```

Static evidence can be reproduced without executing the game:

```sh
node tools/pe-exports.js test/binaries/candidates/hype-time-quest-demo/launch-game/MaiDFXvr_bleu.exe
node tools/disasm.js test/binaries/candidates/hype-time-quest-demo/launch-game/dll/WAVx2BVR.dll 0x10001120 0x10001142
node tools/disasm.js test/binaries/candidates/hype-time-quest-demo/launch-game/dll/WAVx2BVR.dll 0x10003f40 0x10003fe7
```

## Export lookup limits

Native KERNEL32 currently aliases the main image handle. A missing EXE export
therefore retains the existing native-API fallback; removing it would break
callers looking up Win32 functions through that alias. An unknown callback
still returns zero. This is compatibility with the current handle model,
not evidence that distinct Windows module handles are interchangeable.

The reused `resolve_image_export` helper validates ordinal bounds and empty
address entries. It assumes valid name-to-ordinal indices and does not follow
PE export forwarders. The new dynamic main-image path guards the export
directory's RVA/size range: a resolved address inside it logs marker
`0x46574452` (`FWDR`) and the address, then traps. It therefore cannot return
a forwarder string as callable code. Named and ordinal forwarder cases have
focused regressions, which also passed remotely. Hype has no
such entries. This is an explicit unsupported case, not general forwarded-export
support; malformed PE export tables remain outside this investigation.

## Normal-input gameplay probe

The original `launch-game/Readme.txt`, section IX, documents the default
QWERTY bindings: arrows control the character, left Shift runs, Ctrl jumps,
Space performs an action, and Enter uses magic. Up/Down navigate menus;
Left/Right turn in the world. Do not assume a held Enter key moves the player.
`Gamedata/Options/Default.cfg` is binary data, not a text configuration to edit.

The existing investigation probe `build/glide-app-probe.js` can launch
`hype_glide_demo webgl 120 build/hype-gameplay-webgl`. It records desktop and
actual Glide drawable screenshots every five seconds, plus API version,
endpoint/backend and draw/present counters in `states.jsonl`. Its screenshots
are observations, not automatic world acceptance. A normal New Game menu
selection must be verified visually before calling a changed image gameplay.
After reaching the world, compare a stationary frame against a held ArrowUp
interval and a turn, while confirming API version 3, a `glide` endpoint and
advancing geometry/presents. The probe accepts investigator input through
`input.json`, for example `[{"hold":"ArrowUp","ms":3000}]`; this drives
ordinary browser input and does not modify the guest state directly.

### Menu input, viewport and FIFO polling (2026-09-30)

The menu initially ignored held keys despite correct host physical-key state.
Original code at `0x48e3bd` checks `DIDEVCAPS.dwFlags & DIDC_ATTACHED` before
enabling its keyboard. Our capabilities omitted that flag. Correct attached
keyboard/mouse reporting, plus the correct `dwButtons` offset 16, passes the
remote DirectInput regression for both 24-byte and 44-byte structures. Normal
Enter now loads the level. Keyboard flags change from `0x12` to `0x13`, and
the guest poll counter advances. No focus or input-transport workaround was
needed.

The resulting level capture still occupies only part of the 640×480 drawable.
A read-only snapshot confirms the top window has a 640×480 client, while its
three nested children retain 388×268 clients. Hype initializes its logical
resolution globals `0x5d8108/0x5d810c` to 640/480 and correctly selects Glide
resolution enum 7. Its viewport creation (`0x49a730`) uses the parent's client
rectangle, and `DEV_Device::OnSize` (`0x499250`) resizes the child. The Glide
fullscreen path changed geometry without the normal resize notification.
A candidate delivered `WM_WINDOWPOSCHANGED` after releasing the Glide lock,
allowing normal `DefWindowProc` processing to produce `WM_SIZE`. The subsequent
`build/hype-full-world-webgl.log` snapshot still had 388×268 child clients.
The candidate and its callback fixture were removed: it did not improve the
layout and its internal synchronous dispatcher bypassed window-owner thread
routing. The viewport issue remains unresolved.

The matched `hype-capture3-webgl` / `hype-no-notify-webgl` captures also exclude
notification as a necessary cause of the observed bad geometry. Both capture
three triangles with nine vertices: five X values are NaN and all finite X
values are zero. Their draw state and non-finite field patterns match; all
eight drawable PNGs in both runs share SHA-256
`d38b77b951118e53418317ab5ab5fea654c449b3dc757ede3c171383b4902ceb`.

Static inspection narrows the next trace: `CPA_MainFrame::OnSize` at
`0x499fe0` calls helper `0x477a70`, which always returns zero. It therefore
takes the branch that conditionally waits on the application's semaphore
before calling native MFC42 ordinal 5030 through thunk `0x4f442c`. That MFC
handler (preferred address `0x5f40df89`) invokes its default handler and then
virtual method `+0xd0` (frame layout) unless the size type is minimized.
Counting entries to `0x499fe0` and `0x499250`, alongside child creation and
Glide open, will distinguish missing dispatch from notification timing or
layout suppression. No compositor scaling workaround is justified by this
evidence.

For upstream geometry diagnosis, original polygon clipper `0x483670` takes
the vertex count in ECX, a 60-byte-stride vertex buffer in EDX, and the renderer
context at `[ESP+4]`. Float clip bounds in that context are top `+0x3daa8`,
bottom `+0x3daac`, left `+0x3dab0`, and right `+0x3dab4`. Screen-quad producers
`0x486a30` and `0x486d20` use staging buffer `0x835ae0` (four vertices), but
which produced the captured frame remains unverified.

The Y-edge interpolator at `0x483bf0` is a specific candidate for the NaNs:
it calculates `(boundary-yA)/(yB-yA)`, interpolates X and attributes, and writes
the boundary directly as Y. This can produce the captured finite-Y / NaN-X
and attribute pattern. At its entry ECX is the output vertex, EDX is vertex A,
and stack offsets `+4,+8,+12,+16,+20` hold vertex B, yA, yB, boundary, and
context respectively. Capturing these inputs and the pre-clip staging buffer
will distinguish invalid source geometry or bounds from arithmetic failure;
the instruction sequence alone does not establish which occurred.

The subsequent world stall is a separate query bug. The rendering thread
repeatedly reaches `0x4f1626`, the `grGet` import thunk. Calls at `0x482427`,
`0x482442` and related sites ask for `GR_FIFO_FULLNESS` (3), length 8, and loop
while the first output word exceeds 2,000,000. The unimplemented query returned
zero without writing the output, leaving a stale stack value to drive an
infinite polling loop. The query now drains pending commands and waits for
backend completion (WebGL `finish`, synchronous native software), then writes
the SDK's free-entry count and status words. This adds no pixel readback.
ABI ordering, invalid-length and output-boundary tests pass remotely, as do
software and WebGL 1/2 completion tests. The render loop now progresses.

A subsequent captured frame still cannot change the picture: it clears only
depth, then submits three invalid/degenerate triangles. Five of nine vertices
have NaN X; the other four have X=0. Both software and WebGL retain the menu.
This first post-load frame was not enough to characterize steady gameplay.
The later matched notification comparison and frame captures below narrow
the observation without establishing a CPU arithmetic bug.

Evidence on the remote machine: `build/hype-attached-webgl/` contains the
first world capture; `build/hype-world-diagnostics.log` and its corresponding
`states.jsonl` record the window tree and stalled thread. These captures do
not yet demonstrate movement.

### Later frame comparison

Matched runs `build/hype-steady-default/` and
`build/hype-steady-interpreter/` use the same no-notification WASM and normal
Enter, Space, ArrowUp and ArrowRight route. The second disables both the
micro-op tier and x87 folding. A frame captured after 800 presents contains
no geometry in the default run, versus 390 triangles with 1,170 finite
vertices in the interpreter run. This comparison does not isolate either
optimization or prove a CPU bug: the captured frames can represent different
points in the application's execution.

Interpreter screenshot `006-drawable.png` shows the character in a blue
corridor, still restricted to 388×268 pixels. It was opened in Preview.
The other 15 drawable captures retain the exact earlier menu hash. LFB
read/write counts stop at 238 and remain unchanged through the later capture
interval, so repeated LFB uploads do not explain that return to the menu
image. Actual presentation callbacks, buffer contents and the guest's later
draw sequence still need comparison. Neither stable gameplay nor visible
input-driven movement is accepted yet.
