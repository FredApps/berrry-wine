# American McGee's Alice demo

## Original-media preflight (2026-10-09)

Original: `test/binaries/win98-games-a-d/american McGees-alice_demo-OpenGL.exe`,
82,499,584 bytes, SHA256
`ce873bf2525041a624c1a5a27b513f135b51ffdbeae9f68a6ede3edd8c7078e6`.
7-Zip recognizes its WinZip self-extractor: 15 files, two directories,
85,622,092 uncompressed bytes. It contains `alice.exe`, `demo/cgamex86.dll`,
`demo/fgamex86.dll`, `demo/pak0.pk3`, and Miles sound drivers. The included
readme identifies the November 27, 2000 demo. No installer execution is needed
to obtain these original files.

No Alice/McGee registration, task, or gameplay run directory was found in the
current registry, TODOS, board, and retained run-name search. This is a queued
new-game candidate; no launch or gameplay is claimed. BW2 remains compatibility
coverage rather than being counted as another previously unqualified title.

Static import audit reports 212 imports in `alice.exe`, including five missing
API-table rows: `midiInStart`, `midiInOpen`, `midiInGetDevCapsA`,
`midiInGetNumDevs`, and `midiInClose`. Each gameplay DLL has 77 imports and no
missing/explicit fail-fast handler reported. Static imports do not establish
that these functions execute; do not add silent stubs based on this scan.
Dynamic OpenGL/Miles lookup and actual runtime behavior remain untested.

Preflight hashes, small extracted executables/readme, and import report:
`scratch/alice-preflight-20261009/`. Original archive transfer to temporary
`bx_75agndxm:/tmp/alice-original.exe` completed at 04:27:39Z with matching SHA256;
`transfer.json` is the completion receipt. The first extraction attempt could
not start because this no-env box has no `7z`; its failure log is preserved.
Using installed `unzip`, all 15 files were extracted to
`/home/user/alice-original-v2-20261009`, with exact expected total size and
successful archive CRC test. Preparation PID251100 finished at 04:28:27Z.
All 13 PE modules were audited; only the five MIDI imports above were reported.
Exact file hashes, CRC output and full audit are the local `remote-v2-*` receipts.

Original code registers `in_midi` with default string `0` at `0046acf0`.
Initialization at `0046b460` reads it, compares with zero, and returns via
`0046b51d` before `midiInGetNumDevs` when zero. This supports optional MIDI
startup as a static inference; no handler or config was changed, and runtime
reachability is still unverified. See `midi-static-route.json`.

Prepared `/tmp/alice-probe-launch.js` refuses to run while BW2 browser189048
or Disciples handoff controller234050 is alive. It has a 180-second outer guard,
mounts original `demo/**/*`, `snddrivers/**/*`, and `readme.txt`, and captures
the first visible window without inputs. It is uploaded and syntax checked,
not executed. No missing archive paths are known. Next: ordinary launch after
the serialized current work, then New Game/skill selection and W/S movement
as described by the original readme. Do not start a parallel guest or browser.

## 2026-10-09 original initialization: texture border API

Initial-console probe ended normally. Continuing original initialization (same bb9d6e96 module, cooperative CLI, all14 support mounts) creates American McGee's Alice window, then fails at batch123 in glTexParameterfv. Arguments are target0xDE1, pname0x1004 (texture border color), pointer074ff41c to four float1 values; return00484cf3. Source api_table row4442 still maps gl_unimplemented. This is the next concrete runtime blocker, not the five statically missing MIDI-input imports. Do not replace it with a success stub: support actual texture state and sampling/queries across the relevant backends, with a control-failing regression and original launch validation.

Self-contained control: scratch/runs/20261009T0509Z-alice-gl-texparameter-crash (7artifacts; last image precedes the crash). Probe270020 and guest270030 exited1 at05:09:03.423Z. The preceding API transport409 was a transient boat update; original run started only after authoritative boat state recovered.

## Border-sampling control (2026-10-09 07:35Z)

Synthetic regression on unchanged main runtime f1fb7fbe157c1ed6a85b926a31678fb7e0b11299fdfa9c363c2ce41a35a6b418:
run20261009T0735Z-alice-border-control. Remote controller62994 terminal1 at
07:35:15.041Z. Existing software-raster harness draws a two-texel RGB blue/yellow
image with constant coordinates to eliminate LOD/interpolation ambiguity.
CLAMP_TO_EDGE at s0/t0.5 and GL_CLAMP at interior s0.25/t0.5 both pass full-blue
controls. GL_CLAMP at s0/t0.5 fails: RGB0000ff instead of half-blue00007f/000080.
The following quarter-blue corner assertion is retained but was not reached.
This proves an actual sampling gap independently of the missing vector API.

Specification reference: [OpenGL 2.1 texture sampling](https://registry.khronos.org/OpenGL/specs/gl/glspec21.pdf).
GL_CLAMP clamps coordinates before filtering; it does not replace outside
filter taps with edge texels. Border values supply those taps. Thus a bilinear
sample on one edge includes half border; a corner includes three border taps.

Concrete source boundaries:
- lib/gl-compat.js texParameter maps CLAMP to CLAMP_TO_EDGE; fragment shader
  uses hardware texture2D for both units. Proper border behavior needs filter/LOD
  handling, not only a saved color or a uniform mixed at arbitrary distance.
- src/09a8g-gl-raster.wat has8-byte slots (surface/flags),4096 names; flags collapse
  CLAMP and CLAMP_TO_EDGE. gl_sw_r_address emits D3D address1/3 only.
- src/09ab-handlers-d3dim-core.wat d3dim_texture_sample_prepared supports
  wrap/mirror/clamp; its signature has no border color. Do not read outside the
  texture backing when adding missing filter taps, or use unsnapshotted shared state.
- GL Worker snapshots currently have resolved texture flags at1024/1028 and
  fixed1032-byte state /1040-byte descriptor. Any added border state must be
  preserved for queued draws and both texture units; metadata offsets are an ABI.
- GL CALL_INDEX and command ARG_WORDS additions must append; vector pointer
  payload must be copied at submission. API row4442 already exists, so replace
  its handler only when real behavior exists; do not renumber API IDs.

Next implementation: per-texture clamped RGBA state and real filter-tap border
handling, query/setter validation, immutable queued-state coverage, native/WebGL
pixel tests, then unmodified original Alice startup. Existing scratch control.js
is a full retained runnable regression; copy into remote test/ alongside render-helper.
Fresh worker spawn still fails thread limit; root direct, one runtime budget.

## Software sampler foundation (2026-10-09 07:41Z)

Added gl_sw_border_tap/gl_sw_border_sample with explicit immutable color and
independent GL wrap enums. Missing taps return the supplied color before any
backing read. GL_CLAMP clamps coordinates before filtering; CLAMP_TO_BORDER
permits all-border footprints; EDGE/REPEAT retain distinct behavior. No mutable
sampler globals or modifications to the existing D3D hot sampler.
Existing test-gl-software-raster exports this helper only through extraWat and
checks actual Wasm pixels, including an invalid backing pointer for an outside
nearest tap. Canonical build and gl-software-raster, d3dim-texture-wrap,
opengl-fixed-function suites pass on temporary box; controller65306 terminal0
at07:41:31.123Z. Module b2552fac1043910e48cd00a672581dd9235792ba199d7f7943a7f14ba587637d.
Evidence run20261009T0741Z-alice-border-sampler retains source/test/scripts/logs.
This is infrastructure only: production GL draw calls still use the old sampler,
so the earlier end-to-end CLAMP regression and Alice vector API remain unresolved.
Next wire per-texture RGBA/wrap state through resolved draw/Worker snapshots,
route both GL texture units through the helper, then complete WebGL and API replay.
