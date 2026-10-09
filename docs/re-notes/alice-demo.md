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

## Production default-border routing (2026-10-09 07:55Z)

Both software texture units now retain GL_CLAMP separately from CLAMP_TO_EDGE
in texture flags (bits128/256), including existing immutable Worker snapshots.
The shared raster interface carries GL_CLAMP as an explicit tag; D3D address
modes retain the original sampler. The 16-bit wrap fast path excludes this tag.
Default border alpha is opaque for RGB internal formats and zero for RGBA.
Real draw tests pass half-border edge/quarter-border corner pixels; unit1 also
checks RGBA alpha and clearing border mode when switching to CLAMP_TO_EDGE.

Canonical build and GL software, D3DIM wrap, GL fixed-function, multitexture,
and GL Worker transport suites passed; controller69442 terminal0 at07:49:46Z.
Additional unit1 regression passed07:55:13Z. Run
`20261009T0749Z-alice-border-routing` retains logs/source/tests with hashes.
Module5b2cfa1d20224e856ecc28f1de76767ccfcaa1740f6d49e254dcf3d7e296349e.
Connection502 observation failures did not mean test failure or require a rerun.

Still incomplete: programmable per-texture border RGBA and queries/validation,
vector API payload/replay, WebGL sampling, and queued-border pixel isolation.
The existing Worker transport test is not a queued-border pixel test. Original
Alice still hits its unimplemented vector setter; no new game screenshot claimed.

## Per-texture color and queued replay (2026-10-09 08:00Z)

Internal software state now keeps clamped float RGBA per texture in a lazily
allocated 65536-byte table; deletion clears the color. Sampling quantizes only
when resolving the draw and applies RGB's opaque alpha. Both units capture
their packed colors at snapshot offsets1032/1036; snapshot length is now1040,
with the existing descriptor still at1040 within the1056-byte allocation.
This preserves floating-point values for future queries and avoids shared
mutable color reads during queued rendering. Allocation failure returns failure
to the caller; the future guest setter must turn that into GL_OUT_OF_MEMORY.

Canonical build/five suites pass, controller74266 terminal0 at08:00:02Z.
Extended multitexture regression passes08:00:34Z: float clamping, independent
objects, green border pixels, delete reset, and two queued quads retaining red
and blue borders after a later green setter. It copies real submitted records
then replays through gl_sw_worker_draw deliberately later, in one instance;
this proves snapshot isolation, not concurrent scheduling. Run
`20261009T0800Z-alice-border-state` contains tests/sources/logs and hashes.
Module47ab13a8479754405556464cd97d606e17a08b57f25b1b5d8ecb89415a3ba095.

Guest glTexParameterfv is still fail-fast. Next connect validated pointer-copy
submission, matching JS state/query handling and correct WebGL filtering, then
enable the API and rerun original Alice. Do not treat the helper as API support.

## Frontend state and validation (2026-10-09 08:08Z)

JS keeps per-object border floats and original wrap enums separately from the
hardware CLAMP_TO_EDGE alias. Internal query helpers return detached values;
delete/reuse resets state, units retain independent objects, and pending draws
flush before changes. Scalar setters reject invalid target/filter/wrap values;
the WAT mirror likewise preserves old sampling flags for invalid enum values.
Tests cover unchanged pixels after invalid MAG/MIN/wrap, object isolation,
clamping, detached queries and pending-draw ordering. Canonical build/five suites
pass, controller77481 terminal0 at08:07:44Z, run
`20261009T0808Z-alice-border-frontend`, module
970c8abc76a0c66167152f9ec432417d9f643208cc2f77c960852c00274aab04.

WebGL shader work remains. Backend defaults to WebGL1; do not silently implement
only WebGL2. Existing D3D9 mip-atlas lowering supports explicit border taps but
is not directly reusable without atlas uploads and GL-specific clamp semantics.
Another candidate is explicit-LOD center-tap sampling with EXT_shader_texture_lod
and derivatives (core equivalents in WebGL2), manually combining missing taps.
Check extension availability and real pixel behavior before selecting that route.
Do not approximate border weights using only base-level dimensions under mipmaps.

[OpenGL2.1 specification](https://registry.khronos.org/OpenGL/specs/gl/glspec21.pdf),
sections3.8.8-3.8.10, defines per-level filtering and the min/mag switch: threshold
0.5 for LINEAR magnification with either NEAREST_MIPMAP filter, otherwise0.
Incomplete mipmapped textures disable texture application for the unit. Native
software mip policy is currently approximate; do not claim complete GL conformance.
Guest vector dispatch, pointer replay and real shader support are still pending.

## WebGL border pixels (2026-10-09 08:14Z)

The frontend now selects a border shader for GL_CLAMP draws. Explicit-LOD
texel-center taps reconstruct nearest/linear filtering at each selected mip,
returning the object's border for missing taps, then combine levels for trilinear
filtering. Both units carry independent size/filter/wrap/color uniforms. Ordinary
draws keep the original shader; returning to it replays its uniforms. The WAT
software frontend bypasses GPU shader selection entirely.

WebGL1 requires OES_standard_derivatives and EXT_shader_texture_lod; WebGL2 uses
their core equivalents through the existing shader conversion. Missing extensions
fail explicitly; headless desktop-GL extension compatibility is not verified.
Image metadata tracks mip completeness; incomplete mipmapped textures disable the
unit in the border path, and generated mip chains populate the same metadata.

`test/test-gl-border-web.js` passed16 real Chrome/SwiftShader pixel assertions,
eight each for WebGL1/2: edge, corner, nearest, switching to normal shader,
incomplete mip chain, mip1, trilinear and independent unit1 green border.
Controller81241 terminal0 at08:13:59Z. Final run
`20261009T0813Z-alice-webgl-border` retains source/test/identity/readPixels results;
gl-compat SHA a450290cf8b7eb85a01396948c279c239d3e16df17d2607600b812736efef9bf.
Its pixels.png is blank after backend destruction and is not visual evidence;
the assertions read actual GL pixels before teardown. No game screenshot claimed.
Prior14-case run0811 retained but its intermediate JS source was not retained.
Fixed-function JS regression, test-tier and browser cache checks also pass.

Still required: guest vector API/query dispatch, command payload copying and
original Alice validation. No performance qualification or universal GL format
conformance claim. Temporary runtime moved to bx_bufemdmn (expires09:14:52Z);
old bx_kbtxb6tb stopped after all browser/native probes were terminal.

Final tracked browser test reran on bx_bufemdmn after restoring npm dependencies
(fork omitted node_modules). Run `20261009T0818Z-alice-webgl-border` records
controller20725/Chrome20740 terminal0 at08:17:21Z and all16 cases passing with
the same verified gl-compat SHA. Copying the context canvas still produced a
blank screenshot: the backend renders to an offscreen framebuffer. Pixel checks
read that bound framebuffer correctly. The capture now reads the full framebuffer
before teardown instead of the default canvas; final capture verification follows.
Earlier new-box attempt failed before launch because Puppeteer was absent.

Final framebuffer-capture run `20261009T0819Z-alice-webgl-border` also passes16
cases with the identical renderer SHA. Controller21418/Chrome21433 terminal0
at08:18:28Z. Reviewed pixels.png now shows the two green-tinted synthetic test
canvases; no game screenshot/playability credit. The test is in the e2e tier.

## Vector API and copied replay (2026-10-09 08:27Z)

Appended GL command112 glTexParameterfv and113 glGetTexParameterfv; existing
API table IDs4442/4299 stay in place. Vector arguments are copied at submission
(16 bytes for border,4 for scalar properties), after target/pname validation.
The software observer gathers sparse guest pages separately and stores the color;
allocation failure is carried in the record as GL_OUT_OF_MEMORY so host state
does not falsely update. Float queries are barriers and do not write on invalid
enums. glGetError now consumes frontend errors before querying the backend.
Priority remains a per-object float residency hint; objects remain backed for
their lifetime. Integer-vector setter/query aliases remain fail-fast.

Build/seven suites passed, controller25378 terminal0 at08:26:46Z. Extra sparse
regression passed08:27:23Z: a16-byte vector straddles nonadjacent backing pages,
native state sees all four values, and replay retains them after guest mutation.
Run `20261009T0827Z-alice-border-api` retains source/generated files/test logs;
module b9c7ab4b7c5acfd2cb72f7ec953889fc32cf162aa02e3f5ca1545e515e2a16d9.

Original Alice rerun27159/27166 stopped before guest execution because the new
fork omitted `/home/user/bw2-normal-route-20261009/test/binaries/tlbs/stdole2.tlb`.
Restored the15088-byte support file, SHA
db456130e4b131aff27a6a3179464a28c9452f06eb6f2081d2aea38128d31895.
Fresh original-media run27878 is underway with300s guard and no input; do not
interpret the missing-file attempt as a guest regression or gameplay evidence.
