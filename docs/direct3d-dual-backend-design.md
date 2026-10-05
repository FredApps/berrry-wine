# Direct3D software and WebGL implementation plan

Status: implementation started, 2026-09-10; neither backend is complete.
See the [implementation ledger](direct3d-dual-backend-status.md) for evidence and
open delivery gates. The architecture below is the target, not current parity.
User requirement: selectable software and WebGL rendering, with software shaders
compiled into threaded code executed by vector operations. This is a long-term
compatibility architecture, not a Black & White-specific rendering shortcut.

## ASCII TL;DR

```text
GOAL: Same emulated Direct3D device, two execution backends.
      Scope: D3D1-9 / Shader Models 1-3, not D3D10-12 yet.

                    Guest Direct3D calls
                             |
                WAT objects + state + resources
                             |
            Fixed function / shader bytecode -> shared IR
                             |
              Shared ordered render command queue
              + immutable/versioned resource references
                             |
                +------------+-------------+
                |                          |
             SOFTWARE                    WEBGL
                |                          |
        Compile threaded ops          Compile GLSL
                |                          |
        Static WAT SIMD handlers      Shared GPU backend
        4 vertices / 2x2 pixels       WebGL2 (+ WebGL1 subset)
                |                          |
        Software rasterization       Browser rasterization
                |                          |
                +---- fenced resource -----+
                      synchronization
                             |
             Guest-visible pixels / existing compositor

SOFTWARE: no browser required; explicit shader/raster semantics.
WEBGL:    acceleration; host limits and D3D differences remain.
FALLBACK: explicit and ordered, never silently inflated caps.

BUILD: IR -> SIMD VM -> CLI pixels -> game parity -> full profiles
TEST:  CLI first; browser for GL, presentation and real gameplay.
```

## Scope and completion contract

Interpret “full” here as the project's legacy Direct3D surface: D3D1/2/3/7,
D3D8 and D3D9, fixed function and Shader Models 1–3. D3DRM continues through its
immediate-mode implementation. D3D9Ex and D3D10–12 require separately scoped OS,
driver-model and API work; they are not silently included in this milestone.
Likewise this does not by itself complete the emulator's other subsystems.
Microsoft's [assembly reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx9-graphics-reference-asm)
enumerates the vertex/pixel profiles to cover, including ps_1_1–ps_1_4 and the
2_x profiles; “supports shaders” is not a substitute for a profile matrix.

Completion means a documented virtual adapter with a coherent, tested capability
set, correct behavior for every operation it advertises, and explicit errors for
optional features outside that adapter. Maintain an exhaustive API/state/format/
instruction inventory so omissions cannot disappear behind that definition.
Every missing mandatory part of a claimed profile remains a completion blocker.
Track optional extensions separately rather than claiming every historical GPU
vendor behavior or byte-identical output from all physical GPUs.

Two pure execution paths are required: software needs no DOM/WebGL; WebGL uses
the browser graphics API. WebGL is not an exact D3D hardware model. A complete
compatibility mode may use explicit software fallback for unmappable operations;
pure WebGL must instead expose a smaller truthful capability set. Do not promise
full native WebGL equivalence merely because Shader Model 3 translates to GLSL.

## Existing work to preserve

- `src/09ab-handlers-d3dim-core.wat`: existing WAT transform, lighting, texture,
  clipping and rasterization helpers, with synchronous and render-worker paths.
  Keep this as the regression baseline while migrating, not a flag-day rewrite.
- `src/09ad-handlers-d3d9.wat` and `09ae-d3d9-resources.wat`: device/resource
  identity, reference counts, data, state and COM dispatch stay WAT-owned.
- `lib/d3d9-shader.js`: currently a partial bytecode parser/GLSL compiler.
  `d3d9-fixed.js` separately generates bounded unlit fixed-function GLSL.
- `lib/d3d9-host.js` / `d3d9-backend.js` / `gpu-backend.js`: current immutable
  draw snapshots, WebGL execution and completed-frame publication. The generic
  GPU layer is shared with OpenGL; preserve its existing users and opcode ABI.
- [D3D9 design](../apps/direct3d9.md), [older IM design](../apps/direct3d-im.md),
  [software surface ownership](software-gdi-design.md), and
  [threaded-code constraints](wasm-stack-threaded-code.md) remain relevant.
  This plan extends the older shader non-goals, not their ownership contracts.

## Architecture

```text
D3D1–9 COM calls / execute buffers / fixed-function state / shader tokens
                  |
          WAT validation + canonical resources and device state
                  |
          normalized draw + validated shader IR
                  |
          shared ordered render command queue
          (one selected executor per device)
                  |
          +-------+--------------------------------+
          |                                        |
  WAT threaded shader compiler             IR -> GLSL compiler
  SIMD shader executor                     existing shared GPU backend
  software raster pipeline                 WebGL2 primary / WebGL1 subset
          |                                        |
          +------- ordered resource synchronization+
                  |
          canonical guest-visible pixels -> existing compositor
```

The common contract lives **above GLSL and GL enums**. A software backend must
not parse GLSL or pretend to implement a WebGL context. Introduce versioned,
backend-neutral shader/program and draw descriptors; map those into the existing
GPU backend for WebGL and directly into WAT for software. Keep frontend-specific
rules in the frontend: D3D8 is not a renamed D3D9 vtable.

### Shared command queue: worker and direct execution

Both backends consume the same versioned, backend-neutral render command stream.
Evolve `lib/d3d-command-stream.js` and `lib/d3d-render-worker.js` rather than
creating another independent D3D9 queue. Today the legacy software path has that
worker transport. D3D9 now routes its synchronous WebGL bridge and initial
software COM draw slice through the neutral queue. Production software-worker
integration now has real x86/worker pixel tests and bounded ordinary CLI game
execution. The shipped browser cooperative-main and guest-main Worker loops now
pass real x86 COM draw/Present tests against one fresh canonical WASM snapshot,
including canonical pixels and native heap retirement. This is focused frontend
acceptance, not full-game or full-build acceptance. Preserve the existing OpenGL command ABI separately;
sharing transport machinery does not require reinterpreting GL commands as D3D.

The frontend validates calls and maintains authoritative guest-visible state.
It emits ordered resource create/update/release, immutable state/program binding,
draw, clear, copy/resolve, query begin/end, readback, fence and Present commands.
Each command carries device identity/generation, sequence number, opcode, bounded
payload and retained resource-version references. Backend-specific GLSL programs
and threaded shader packets are executor caches, not different queue protocols.

One logical consumer executes each device stream. Software normally runs in a
background render worker with WAT SIMD; WebGL runs in an executor owning its
context, in a worker where supported or on the browser thread otherwise. Tile
workers may be internal software executor workers, not competing queue consumers.
Multiple guest producers require serialized publication and defined cross-device
dependencies for shared resources. Reserve/write/publish must not expose partial
commands; release/acquire atomics or message ownership establish visibility.

CLI and cooperative mode consume the same command format directly without a
worker, browser or alternate rendering semantics. A/B replay uses independent
resource copies; normally both backends do not execute every submitted draw.

Resource lifetimes extend to command completion, not just API return. Copy UP
vertices/indices and transient constants before the guest resumes, or retain an
immutable allocation version. Lock/DISCARD/alias writes cannot overwrite queued
inputs. Validate synchronously what the API requires before enqueue; return
allocation/validation failures normally. Deferred execution errors use a defined
device/error completion path, never a retroactive successful result fabrication.

Distinguish submitted, consumed and completed sequence numbers. For WebGL,
issuing a GL call is not GPU completion. Readback and blocking Lock wait for the
relevant resource fence; nonblocking flags and query polling retain their API
semantics. Query boundaries stay in stream order, with results published only
when ready. Present publishes only its completed frame through the existing
compositor; queued later draws must not modify that presentation snapshot.

The queue and upload arena have byte budgets and backpressure. A guest worker
may wait on a completion word; the browser main thread must yield and resume
without blocking the event loop needed by its consumer. Cancellation, reset and
context loss wake waiters with explicit outcomes; generations reject stale
completions. Retained storage is reclaimed only after completion or confirmed
cancellation. Backend switching drains relevant work and transfers all required
resource contents; an unsynchronizable depth/stencil dependency prohibits a
one-draw fallback and requires choosing software for a larger sequence/device.

Migration: first document existing command/fence ownership and introduce a direct
consumer; add neutral program/resource/draw descriptors; adapt current D3D9 WebGL
execution; then connect the software shader executor through that same stream.
Keep existing legacy paths until capture/replay and corpus equivalence pass.
Test order, queue wrap/full conditions, guest-memory reuse, release-before-fence,
nonblocking query polling, main-thread progress, reset/cancel and stale completion
in direct and worker modes. Queue correctness is an early vertical-slice gate,
not deferred until final performance tuning.

### One shader semantic definition

Move token validation and normalized shader IR into WAT, available to Node and
browsers. Use one declarative instruction/profile specification to generate
decode metadata and validation fixtures as needed; do not maintain independent
JS and WAT parsers that can silently accept different programs. Migrate the
current JS parser behind comparison tests, then retire it as an authority.
JS remains appropriate for emitting GLSL and managing browser GPU objects.

IR records stage/profile, source token offsets, typed register banks, swizzles,
source modifiers, destination masks/modifiers, address operations, constants,
sampler dimensions, interpolation, flow control and coissue groups. Validation
checks token bounds, instruction lengths, legal operands, profile limits,
structured control flow, declarations and legal stage combinations. Retain
raw tokens for GetFunction/debugging; normalize semantics without losing origin.

Fixed function lowers to the same IR plus explicit raster state. Implement
vertex and pixel stages independently: NULL VS + programmed PS and programmed VS
+ NULL PS need real linkage, not the current mixed-stage rejection. Specialize
programs on semantic state, not changing constant values. D3D8 vs D3D9 constant
binding/DEF lifetime must remain version-specific; Microsoft's
[constant behavior reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx9-graphics-reference-asm)
documents that they differ.

## Software shader machine: compiled, threaded and vectorized

### Threaded target

Emit validated immutable packets of handler IDs and decoded operands, not x86
instructions and not runtime-generated Wasm modules. Static WAT handlers perform
vector arithmetic, masked writes, address/flow operations and sampling. Compile
once per immutable shader/variant and cache by bytecode, profile, IR/compiler
version and specialization state, with collision verification and a byte budget.

Reuse the emulator's threaded-code approach, profiling conventions and compiler
toolchain, **not its x86 CPU context**. Shaders have no EFLAGS, x87 stack, guest
EIP, SEH or x86 XMM ownership. Give the shader executor a dedicated context,
validated dispatch domain and arena. Do not renumber the x86 handler table or
consume its code-cache partition for shader packets.

Start with explicit register-file loads/stores at handler boundaries. Wasm
operand-stack values do not survive arbitrary `call_indirect` boundaries.
After measurements, compile useful arithmetic runs into static fused packet
handlers that keep temporaries in `v128` locals within one invocation. Preserve
an unfused executable path for differential tests. No presumed speedup from
dispatch reduction alone; no unbounded recursive call chain in the compat build.

### SIMD layout

Use structure-of-arrays, four invocations per batch:

```text
r0.x = f32x4(x of lane0, x of lane1, x of lane2, x of lane3)
r0.y = f32x4(y of lane0, y of lane1, y of lane2, y of lane3)
r0.z = f32x4(z of lane0, z of lane1, z of lane2, z of lane3)
r0.w = f32x4(w of lane0, w of lane1, w of lane2, w of lane3)
```

For vertices, lanes are four independent vertices. For pixels, lanes are a 2×2
quad, with coverage, execution, helper and discard masks kept distinct. A DP3
is component-wise vector multiplies/adds across x/y/z, producing four dots;
it is not a horizontal sum across neighboring pixels. A source swizzle selects
component vectors; destination masks preserve unwritten component vectors.

Pixel quads provide the basis for derivatives and implicit texture LOD. Helpers
may be needed outside primitive coverage but must not write color/depth/stencil
or count toward occlusion. Divergent flow requires per-lane masks and explicit
reconvergence/loop/call state. Preserve profile rules for derivatives in flow
control, discard, coissue reads, output depth and predication.

Sampling initially uses bounded scalar gathers for each active lane (Wasm SIMD
does not supply arbitrary memory gathers), then vectorizes filtering/combining.
Share native-format addressing/decoding helpers with the rasterizer. Optimize
compressed-block caches only with resource-generation invalidation. Specify
rounding, saturation, NaN/zero/denormal policy and reciprocal/transcendental
accuracy per profile; do not assume SIMD min/max or relaxed fused arithmetic
automatically match D3D semantics. Use ordinary SIMD first, not relaxed SIMD.

### Lifetime and scheduling

Execution contexts own registers, masks, packet PC and control stacks. Bound
resource views are checked before entry and retained through completion; no
per-pixel guest pointer translation or host call. Enforce validated bounds at
dynamic accesses. Retain a scalar semantic evaluator as a test oracle, not the
shipping hot path; independently authored specification fixtures are still
needed because compilers sharing an IR can share the same bug.

Bound work per slice and support cooperative resumption at defined quad/tile or
shader-loop checkpoints. A watchdog must diagnose/cancel hung work with an
explicit failure/device outcome, never silently truncate a shader and return
success. Pause/cancel/device destruction cannot publish partial frames or reuse
in-flight resource storage. Allocate through region declarations/owned arenas,
with checked arithmetic and explicit OOM, within the existing memory budget.

## Full pipeline coverage worklist

Track each item as absent / partial / verified for software and WebGL separately.

1. API and objects: all in-scope interfaces/slots, QueryInterface identity,
   creation validation, caps/check methods, state defaults, getters/setters,
   full state blocks, resource pools and reset/lost-device lifecycle, swap
   chains, present parameters, queries and ordered completion. Native method
   indices come from headers/type data and actual DLL evidence, not guesses.
2. Input assembly/vertex processing: declarations/FVF, all profile-required
   types, indexed/nonindexed/UP draws, multiple streams, stream frequency and
   instancing where claimed, base offsets, vertex blending/skinning, fixed
   transforms/lighting/materials, texture coordinate generation and clipping.
3. Primitive/raster rules: all primitive topologies, clipping, viewport/depth
   mapping, D3D pixel centers and edge ownership, culling, fill modes, flat and
   Gouraud shading, perspective interpolation, point sprites/size, scissor,
   fog, depth bias, alpha test and depth/stencil tests and writes. Early depth
   is allowed only when shader/discard/output-depth and stencil semantics permit.
4. Texture/sampler rules: 2D/cube/volume, full mip chains, formats and conversion,
   palette/color-key legacy behavior, DXT1–5, float/depth formats where exposed,
   wrap/mirror/clamp/border, point/bilinear/trilinear, bias/LOD/gradients,
   anisotropy where exposed, sRGB sampling/writes and generated mips.
5. Pixel/output rules: full fixed-function stage combiners including legacy
   dependent/bump operations, programmable texture instructions, multiple
   outputs/render targets where exposed, blend equations/factors/separate alpha,
   write masks, native target format packing, multisampling and resolves.
6. Resources/data movement: shared texture-level/surface ownership, locks and
   subrects, DISCARD/NOOVERWRITE semantics, UpdateTexture/Surface, StretchRect,
   ColorFill, target switching, readback, queries and D3D/DirectDraw/GDI access.
7. Shader profiles: VS1.1; PS1.1/1.2/1.3/1.4; VS/PS2.0 and 2_x capability
   variants; VS/PS3.0. Each profile has a per-op/register/limit/precision matrix,
   including flow control, relative addressing, derivatives and vertex sampling
   where legal. Passing a shader corpus does not prove complete profile support.

Reuse existing software helpers where their semantics pass the relevant tests;
upgrade the span rasterizer to quad-aware tile traversal for programmable
pixels. Keep legacy output fixtures until both adapters have equivalent results.
Do not force all old games through the new pipeline before equivalence is proved.

## WebGL implementation and gaps

### What is a WebGL limit versus our missing implementation?

Our current missing lighting, mixed fixed/programmed stages, broader shader
profiles and render-target switching are implementation gaps, not proof WebGL
cannot do them. Most ordinary D3D9 shader math, textured triangles, depth,
blending and fixed-function effects can be expressed through GLSL and GPU state.
The real restrictions concern exact semantics, resource access and host limits:

| Constraint | Consequence for this emulator |
|---|---|
| No portable one-to-one mapping for all legacy raster state | Core WebGL has no polygon-mode switch; wireframe needs geometry/shader emulation or an optional extension. D3D line coverage and edge rules need dedicated tests, not an assumption that GL lines match. |
| Different texture/format interface | Core sampler addressing does not provide D3D border-color sampling directly. Palette textures and unavailable compressed/native formats need conversion or shader sampling; exact border filtering needs more than an out-of-range color test. |
| Restricted CPU access to GPU resources | No native D3D-style surface locking of a GPU allocation. Stage uploads/readbacks explicitly; ordinary color readPixels does not provide arbitrary raw depth/stencil or multisample storage. This particularly constrains exact backend switching. |
| Host-dependent precision, limits and extensions | Query shader/storage limits, format renderability/filterability, sample counts and extensions. Floating-point math and rasterization cannot be assumed bit-identical across GPUs. Define a stable virtual adapter instead of exposing an inconsistent union. |
| Browser-owned execution and lifecycle | Shader compilation, GPU completion/readback stalls and context loss are real. GPU work is not stepped by the x86 debugger, so shader inspection/replay needs the software path and separate GPU diagnostics. |

Sources: the [WebGL2 API and validation rules](https://registry.khronos.org/webgl/specs/latest/2.0/),
the optional [WEBGL_polygon_mode extension](https://registry.khronos.org/webgl/extensions/WEBGL_polygon_mode/),
and [D3D9 rasterization rules](https://learn.microsoft.com/en-us/windows/win32/direct3d9/rasterization-rules).
These are reasons for an explicit compatibility layer, not a claim that WebGL
cannot run D3D9 games. Many gaps can be emulated on the GPU; evaluate correctness
and transfer cost before choosing a software fallback. Software also needs a
defined virtual-adapter numeric model; it does not magically reproduce every
historical GPU's rounding merely by avoiding WebGL.

Use WebGL2 as the long-term accelerated target; retain the current WebGL1
verified subset while transitioning. The
[WebGL2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/)
defines an ES3-style API, not unrestricted desktop GL or D3D9. Query actual
formats, precision, renderability, limits and extensions on the current context.

Compile the shared IR to stage-linked GLSL variants. Explicitly handle clip-Z,
pixel centers, position conventions, interpolation, texture dimensions, native
format conversion, constants and precision. Extend the existing shared GPU
contract for render targets, depth/stencil, MRT, multisampling, instancing,
queries and context loss; do not add a D3D-only second WebGL renderer.

For every mismatch choose and test: exact lowering; shader/resource emulation;
ordered software fallback; or unsupported on the pure-WebGL adapter. Border
sampling, legacy blend/raster rules, palette textures, precision and readback
formats need this analysis. Multipass emulation must preserve depth/stencil,
blending and query effects, not merely resemble one screenshot.

## Canonical resources and renderer selection

Keep one canonical resource identity and guest-visible native storage. GPU
allocations are derived execution caches with explicit ownership/version state:
CPU-dirty, synchronized, GPU-dirty, and in-flight. Before guest CPU access, fence
and download GPU-dirty subresources; before GPU use, upload CPU-dirty versions.
Resolve multisampling and pack the correct format at defined readback boundaries.
For depth/stencil formats that cannot be read back faithfully, choose software
execution up front or reject migration; never invent a synchronized shadow.

Deferred commands retain immutable snapshots or versioned allocations through
their fence, including UP bytes, constants and released resources. Raw guest
writes, locks, DISCARD and aliases must not invalidate in-flight data. Unify
native texture format semantics without making RGBA presentation copies the
source of truth. Present continues through the existing window compositor.

Selection contract (experimental `software`/`webgl` selection is wired;
`auto`, hybrid fallback and runtime migration remain future work):

- `software`: pure WAT SIMD rendering, including CLI PNGs, no WebGL required.
- `webgl`: pure accelerated backend; truthful tested caps, no hidden fallback.
- `auto`: select a backend at device creation; during development report the
  choice and supported profile. Never claim caps from whichever backend is larger.
- A later explicit compatibility/fallback option may expose the software
  adapter's caps and accelerate supported work. It must report fallback counts
  and synchronize all resources before crossing backends.

Current experimental controls are `?d3d9-renderer=software&d3d9-programmable`
in the browser and `--d3d9-renderer=software --d3d9-programmable` in the CLI.
The software implementation is still a partial adapter, not a complete shader
profile; these switches are developer opt-ins, not release capability claims.
The browser defaults to the existing WebGL path; CLI WebGL selection explicitly
fails until an actual GL provider is integrated.

Start with backend selection at launch/device creation. Runtime switching is
later work: drain commands, transfer all migratable subresources, preserve
identity/state, and reject switches that cannot preserve contents. Shared caps
for A/B tests use an explicit common profile; applications must not see caps
change after device creation. CLI WebGL testing, if added, uses an explicit GL
provider, not a fabricated DOM or a disabled capability check.

## Phased delivery and acceptance gates

| Phase | Deliverable | Required exit evidence |
|---|---|---|
| 0 | Inventory, neutral contracts and shared queue | API/profile/state/format matrix; command/resource/fence schema; direct/worker ordering and lifetime fixtures; current tests remain green |
| 1 | WAT token validation + shared IR | Malformed-token fuzzing; profile legality fixtures; old/new GLSL outputs agree for current supported corpus |
| 2 | WAT threaded SIMD shader VM | Arithmetic, masks, alias/coissue, constants, relative access and flow fixtures match independent scalar expectations; memory/cancellation tests |
| 3 | Software draw vertical slice | Same queue through direct/software-worker/WebGL consumers; actual D3D9 creation/locks/bind/draw/readback works in Node without DOM/WebGL; exact pixel and fence tests |
| 4 | Black & White supported-profile parity | Same immutable real draws through software and WebGL; then menu-to-game input and changing gameplay on both, not only logo frames |
| 5 | Complete fixed-function/resources | Worklist items 1–6 tracked to adapter contract; legacy corpus parity; mixed fixed/programmed stages and CPU/GPU ownership tests |
| 6 | Complete shader profiles and WebGL2 | Profile-by-profile SM1–3 conformance; GLSL gap/fallback matrix; no caps enabled ahead of mandatory behavior |
| 7 | D3D8/legacy frontend convergence | Version-specific state/constant semantics preserved; execute-buffer and retained-mode corpus on both paths |
| 8 | Scheduling, tuning and release | Bounded queues/memory, worker/cooperative equivalence, device loss/reset, cross-engine/device runs, documented caps and remaining optional exclusions |

Phases 5–7 have substantial independent work, but shared IR/resource ownership
must land first. Black & White is an early integration milestone, not the sole
acceptance suite. Build useful vertical slices before attempting every opcode.
Avoid calendar estimates before phases 0–3 establish coverage and measured cost.

Suggested first implementation change: introduce the neutral shader IR and its
validator while keeping the current WebGL output unchanged. Then add the WAT
packet compiler/executor for the existing VS/PS1.1 arithmetic subset, followed
immediately by one texture sampler and a real CLI draw. This removes the browser
dependency for most debugging before pursuing the large completeness worklist.

## Verification and performance policy

- Fast CLI tests: parser/IR/compiler, scalar-vs-SIMD lanes, software pixels,
  locks/lifetime/state, clock/CPU regressions and deterministic draw replay.
- Separate shader-output tests from coverage/raster and format tests so a pixel
  mismatch can be attributed. Cover edge pixels, clipping, negative/wrapped
  coordinates, derivatives, divergent masks and partial quads explicitly.
- Differential software/WebGL captures include shader IDs/tokens, all relevant
  state and versioned resource bytes. Exact comparison for specified integer/
  packing results; documented per-feature floating-point/raster tolerances, not
  a blanket screenshot similarity threshold. Compare native D3D references when
  available; shared-backend agreement alone is not native conformance.
- Browser tests are for real WebGL compilation/draws, compositor and input,
  context loss and final gameplay. Do not use repeated long launches as the unit
  test for a shader, clock or allocator bug. Capture and replay the failing draw.
- Run software on Node and browser, WebGL on Chrome and Safari including actual
  iOS, in cooperative and worker modes. Feature-detect required Wasm facilities;
  no new multi-memory requirement or dependence on host-specific SIMD behavior.
- Measure compile time, cache/arena bytes, shader instructions and lanes, sampler
  traffic, raster time, dispatch, transfers, fences and frame time separately.
  Compare fused/unfused packets and existing rasterizer under the same work.
  Check machine load and use headful runs for user-visible frame-rate claims.
- Tile workers follow a correct single-worker implementation. Preserve per-tile
  draw order, blending and query aggregation; bounded scheduling and throughput
  matter more than thread count. Never equate SIMD width with a guaranteed 4× gain.

No deployment, renderer switch, runtime migration or implementation is performed
by this document. Existing experimental D3D9 caps remain opt-in until replaced
by the tested adapter selection contract.
