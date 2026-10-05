# Organic Art / D3DRM screensavers (Plus! 98)

`test/binaries/screensavers/{ARCHITEC,FALLINGL,GEOMETRY,JAZZ,OASAVER,ROCKROLL,SCIFI}.SCR`

Seven Direct3D Retained Mode savers that share one engine. Each one is a `.SCR`
with a matching `.SCN` scene file, a `.THE` theme, a wallpaper `.GIF` + `.PAL`,
one or more `.X` meshes and texture `.GIF`s, all in the same flat directory.

They sat at WARN in `test/test-all-exes.js` (`ORGANIC_ART_D3DRM_SMOKE`,
`maxBatches: 7000`) for a long time. **Five of the seven are not broken — the
sweep budget ends before their first frame.** Details below, because the shape
of the evidence is reusable.

## Module layout

The `.SCR` loads at a high base, not `0x400000`:

```
PE loaded. Entry: 0x74492290          <- ARCHITEC.SCR itself, base ~0x74400000
DLL: comctl32.dll at 0x74612000  origBase=0xbfc00000
DLL: oleaut32.dll at 0x7479e000  origBase=0x65340000
DLL: d3drm.dll    at 0x74930000  origBase=0x64780000
d3dxof.dll loaded at 0x74aa0000        <- late, pulled in by d3drm for .X parsing
```

This matters: a hot `EIP=0x7440f532` is *below* every line in the `DLL:` list,
which reads as "unknown module" until you notice the exe is up there too. It is
`exe+0xf532`. `d3dxof.dll` is loaded by `LoadLibraryA` from inside `d3drm`
partway through the run, so it never appears in the startup `DLL:` block.

`d3drm.dll` and `d3dxof.dll` both print `WARNING: DllMain did not return
cleanly` and both work anyway — that warning is not the bug here.

## Why they looked dead: they are decoding the backdrop GIF

At 7000 batches ARCHITEC's API census is 16,381 calls of which **14,672 are
`EnterCriticalSection`/`LeaveCriticalSection` pairs** (the CRT allocator lock),
and the last non-CS calls are a run of `ReadFile`. That reads like a spin.

It isn't. The per-batch EIP dump names the loop:

```
[6975] EIP=0x7440f5ac EAX=0x00000320 ECX=0x5036c1c0 EDX=0x5032e000 EBP=0x0000013e
[6992] EIP=0x7440f76b EAX=0x00000000 ECX=0x5036c4e0 EDX=0x00000008 EBP=0x0000013f
```

`EAX = 0x320 = 800`, `ECX` advances by `0x320` per iteration, `EDX` is a DIB
base, and `EBP` counts `0x13d → 0x13e → 0x13f`. That is a **scanline counter
running a GIF LZW decode into the 800×678 backdrop**, at roughly 17 batches per
row. `AR_WALLP.GIF` is 678 rows, so the decode alone wants ~11,500 batches, and
the mesh load and first frame come after it.

`--dx-surfaces` says the same thing independently — at 7000 batches:

```
slot=5  640x480 bpp=16 flags=0x1 colors=1   nonZero=0/1850      <- primary, blank
slot=6  640x480 bpp=16 flags=0x2 colors=1   nonZero=0/1850      <- back buffer, blank
slot=11 256x256 bpp=8  flags=0x4 colors=233 nonZero=1849/1849   <- texture, loaded
slot=20 800x678 bpp=8  flags=0x4 colors=131 nonZero=912/1920    <- backdrop, ~half
```

The backdrop being *half* written is the tell: row 319 of 678 matches the `EBP`
counter exactly. Textures decode fine; the render target has simply never been
touched yet.

At 60,000 batches the same two surfaces come back
`colors=188 nonZero=1845/1850` and the capture shows marble columns, stairs and
malachite inlay in correct perspective. **That is `AR_WALLP.GIF`, not a render.**
It is extremely convincing as a 3D scene and it is a blitted photograph — see
the root-cause section. The budget finding below is still correct (the blank at
7000 is the capture landing before the first present); what is wrong is reading
the resulting picture as evidence that the 3D path works.

## Status at 60,000 batches (`--batch-size=1000 --quiet-api`)

**Look at the picture, not the colour count** — and then do not trust the
picture either. **None of these is rendering a 3D scene.** Every pixel on screen
is the DirectDraw backdrop blit; see the next section for the `--count` proof.
The column below is what the capture *looks like*, which is a property of how
scenic each saver's wallpaper GIF is, not of how much of it works.

| saver | colours | what is on screen (all of it backdrop) |
|---|---|---|
| ARCHITEC | 242 | `AR_WALLP.GIF` — marble columns, stairs, malachite. Reads as a rendered scene. It is a photograph. |
| FALLINGL | 218 | its wallpaper — leaves |
| SCIFI | 123 | its wallpaper — terrain under a red sky |
| ROCKROLL | 84 | wallpaper gradient |
| GEOMETRY | 60 | wallpaper gradient |
| JAZZ | 1 | blank — backdrop never finished decoding |
| OASAVER | 1 | blank — backdrop never finished decoding |

So the apparent three-way split (full scene / gradient / blank) is not a split at
all. All seven are in the same state and differ only in their wallpaper.

`WIN98.SCR` sits next to these in the directory and is **not** part of this
family — it is an MFC saver and renders at 1714 colours.

## The whole family renders a static frame — including the ones that "work"

This is the open bug, and it subsumes the per-saver differences above.

Each saver runs a real render loop for the whole run — ~3562 frames in 60,000
batches, each frame `BeginScene` / `Clear` / two `Execute` buffers / `EndScene`,
with SCIFI and GEOMETRY submitting structurally identical execute data. **The
presented image is byte-identical across all of it.** Measured with two `--input
N:png:` captures inside one run, so no cross-run or cross-build comparison is
involved:

| saver | captures | differing pixels |
|---|---|---|
| ARCHITEC | 75,000 vs 95,000 | 0 of 307,200 |
| SCIFI | 20,000 vs 30,000 vs 40,000 vs 45,000 | 0 |
| ROCKROLL | 45,000 vs 57,000 | 0 |
| FALLINGL | 45,000 vs 57,000 | 0 |
| GEOMETRY | 30,000 vs 50,000 (and 60k vs 200k) | 0 |

ARCHITEC does change between 45,000 and 57,000 (99.4% of pixels) — that is the
**backdrop decode finishing and being blitted**, not animation and not scene
construction. It is frozen either side of it. (An earlier revision of this note
called that change "the scene finishing construction". Wrong; see the root-cause
section — there is no scene.)

## Root cause: d3drm's scene graph is empty, so no geometry is ever submitted

The frame is static because **nothing is being drawn into it**. Measured on
ARCHITEC and GEOMETRY with `--count` (WASM-native counters, full speed) over
60,000 batches, on `IDirect3DRMViewport::Render`'s recursive frame-hierarchy
walk at `d3drm+0x64798903`:

| probe | what it is | ARCHITEC | GEOMETRY |
|---|---|---|---|
| `d3drm+0x64798903` | walk entry | 811 | 3604 |
| `d3drm+0x647989f6` | reached the `cmp [edi+0x25c],0` visual-count test | 811 | — |
| `d3drm+0x64798a07` | **visual loop body** | **0** | **0** |
| `d3drm+0x64798a63` | returned from a visual's `Render` | **0** | — |
| `d3drm+0x64798ae9` | the "no visuals" skip | 811 | 3604 |
| `d3drm+0x64798cb9` | returned from child-frame recursion | **0** | **0** |

The walk runs once per frame over a root frame with **zero visuals and zero
child frames**. It never recurses and never renders a visual.

`--trace-host=dx_trace` says the same from the other end: every single
`IDirect3DDevice::Execute` in 50,000 batches is a 32-byte buffer holding one
`D3DOP_STATERENDER` with 3 state records plus `D3DOP_EXIT` — no
`D3DOP_TRIANGLE`, no `D3DOP_PROCESSVERTICES`, no matrix ops, `dwVertexCount=0`.
d3drm rebuilds that buffer twice per frame and every rebuild is empty.

The app's own per-frame machinery is healthy, which is why every timing
hypothesis below failed. The engine names its own functions in debug strings:
`DoFrame()` at `0x74437c00`, `FrameMove(double)` at `0x74436ff0`,
`pfgUpdateScene(double)` at `0x7443b930`, `FrameShow()` at `0x744378f0`,
`FrameShowDevice()` at `0x74437b30` (the Present is at `0x74437bb8`). At
`--trace-at=0x74437d7b`, `tmElapsed` ≈ 2.8 s and `delta` = 2.0 every frame
(clamped to `MaxFrameDelta`, default 2.0f at `0x744f7adc`), the timer's `last`
at `0x744f7bc8` advances, and the scene-time accumulator at `0x744f8128`
integrates monotonically (146,914 → 154,616 between batch 49,609 and 59,990).
So the app computes scene state correctly every frame and then renders nothing.

The byte countdown at `0x74437b8d..0x74437ba7` that looked like a scene/step
timer is a CString refcount decrement (`rc` byte at `[ptr-1]`, `0xFF` =
literal). Dead end — do not re-chase it.

### Still open: did the app ever call AddVisual?

The scene is proven empty **at render time**. What is not established is whether
the app called `IDirect3DRMFrame::AddVisual`/`AddChild` and the add failed (our
bug) or never called them because its scene build bailed earlier (a guest-side
gap further upstream). Cheapest next steps:

1. The frame's visual array is `frame+0x25c` (count) / `+0x264` (data),
   initialised by the Frame ctor at `d3drm+0x647c095a` via `d3drm+0x647c0734`.
   `find_field.js` finds no direct write to `+0x25c`, so the append goes through
   a helper reached by `add reg,0x25c` — find it with
   `tools/find_bytes.js test/binaries/dlls/d3drm.dll --imm32=0x25c`, then
   `--count` its entry. **Zero = the app never added a visual; nonzero = we
   broke the add, and that is our bug.**
2. `tools/find_vtable_calls.js test/binaries/screensavers/ARCHITEC.SCR --disp=0x48`
   enumerates the app's own AddVisual sites (slot 18); `--count` them to see
   whether the app reaches its scene-population code at all.
3. Organic Art is procedural (PFG), so its visuals would be in-memory
   `IDirect3DRMMeshBuilder` objects — consistent with the `.X` files never being
   read.

### Hypotheses tested and falsified

Recorded so nobody re-runs them:

1. **`.X` mesh loading is broken.** No. Neither the working nor the failing
   savers ever *read* their `.X`. The repeated opens are a path-resolution
   helper at `d3drm+0x1c37a` — `CreateFileA`; if `!= -1`, `CloseHandle` and
   return the resolved name. ARCHITEC opens `ar_mesh.x` 8 times and reads it 0
   times while rendering a full scene, so absent `.X` reads cannot be the
   discriminator. The only files any of them read are their own `.SCR` (20
   reads, the embedded scene) plus their GIFs.
2. **A missing API.** No. GEOMETRY and SCIFI use the *same* 189 unique APIs;
   `comm` on the sorted sets is empty in both directions.
3. **`QueryPerformanceCounter` i32 overflow.** Tempting — the handler builds the
   value in i32 as `ticks_ms * 1000` at a declared 1 MHz frequency and hardcodes
   the high dword to 0, so it wraps at ~2147 s of guest time (batch ~10,735 at
   the default 200 ms/batch). But `--tick-ms-per-batch=50` moves that wrap to
   batch ~42,940 and SCIFI is still frozen at 20,000 / 30,000 / 41,000. The
   overflow is real and worth fixing on its own, but it is not this.
4. **Time pacing.** No. `--time-scale=20` gives the guest 20x the clock and
   ARCHITEC's frame at batch 70,000 is byte-identical to `--time-scale=1`. The
   scene state does not depend on the guest clock at all.
5. **Lazy headless present hiding updates.** No. The same capture mechanism
   shows ARCHITEC's 99.4% construction change, so presents do reach the capture.

6. **The animation input is stuck / a transform is not updating.** No — this was
   the hypothesis that motivated the root-cause hunt, and it is also wrong. The
   per-frame delta, the timer and the engine's scene-time accumulator all
   advance correctly. There is no transform to update because there is nothing
   in the scene graph to transform.

## Sweep config

`ORGANIC_ART_D3DRM_SMOKE` in `test/test-all-exes.js` was `maxBatches: 7000`,
`timeoutMs: 30000`, no `--quiet-api`. Now 60000 / 90000 / `--quiet-api`, which
takes that block from **7 WARN to 5 PASS + 2 WARN** with the two remaining WARNs
honest. `--quiet-api` is not optional at the larger budget: these make over 1.2M
API calls per run and the default one-line-per-call trace is a blocking stdout
write on the guest's own thread — see the `--quiet-api` measurement in
`CLAUDE.md` (3:53 wall vs 1:17 for identical CPU).

The negative control is the mechanism itself rather than a config flip: at 7000
batches `--dx-surfaces` reports the primary and back buffer `colors=1
nonZero=0/1850` while the backdrop is half-written, so the blank is the capture
landing before the first present, not a render that failed.

## Not this family

`CORBIS`, `FASHION`, `HORROR`, `WOTRAVEL` are MFC photo savers, not D3DRM. They
quit after ~12 batches because `CoCreateInstance` for CLSID
`{4FD2A832-86C8-11D0-8FCA-00C04FD9189D}` / IID `{4FD2A833-…}` fails — that is
**DirectAnimation**, a separate and much deeper gap. See
`project_corbis_directanimation`.
