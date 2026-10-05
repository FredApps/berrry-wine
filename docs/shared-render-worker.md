# Shared graphics render Worker

Threaded browser processes now own one render Worker. D3D 5–7, D3D8/9,
OpenGL and Glide use independent endpoints on that owner. Both WebGL and
software devices execute there; the main thread retains window composition.
The existing cooperative/CLI entry points remain available for hosts that
do not run the guest main thread in a Worker.

```text
guest CPU Workers
  | D3DIM / software-GL snapshots    | GL / Glide batches   | D3D9 commands
  +---------------------------------+----------------------+------+
                                    |
                      process RenderWorker.Manager
                                    |
                           ONE physical Worker
                 +------------------+-------------------+
                 | independent API/device endpoints     |
                 | globally ordered execution           |
                 | one renderer-only WASM instance      |
                 +------------------+-------------------+
                                    |
                         software or WebGL backend
                                    |
                    pixels / transferable ImageBitmap
                                    |
                         main-thread compositor
```

## Ordering and ownership

`lib/render-worker.js` multiplexes virtual ports over the process-owned
`lib/d3d-render-worker.js`. Commands have bounded queue storage. Ordinary
messages are snapshotted before submission. Legacy D3DIM/software-GL buffers
use the existing shared buffer ring: the producer cannot reuse a buffer
until the consumer has acknowledged its sequence.

The worker scheduler awaits each native software draw's completion, including
sliced draws, before another endpoint may use shared WASM scratch. API state,
device identifiers and generations stay within their endpoint namespace.
Separate endpoints do not imply simultaneous execution on the render owner.
Dependencies load once per physical Worker. A completed or failed operation
clears transient native raster hooks before another endpoint executes.

GL query results and borrowed GL input spans remain protected by the guest's
blocking RPC lease until replay finishes. The main-thread broker accepts
Promises and wakes that guest through its shared response slot; it never
uses `Atomics.wait` itself. Glide batches own packet copies, including LFB
readback responses. D3D9 retains its existing command receipts and continuation
tokens.

Legacy GPU draws use the queued state snapshot through
`d3dim_gpu_state_override`, reset after each call. Packet consumption permits
ring-buffer reuse; an explicit fence additionally materializes outstanding
GPU writes before guest pixel access. This avoids a synchronous main-thread
round trip per draw.
Startup waits for the shared renderer's readiness flag on the guest Worker;
initialization and fence failures report errors instead of rendering locally.
The former `?no-d3d-worker` opt-out no longer disables rendering offload in
threaded browser mode.

## Presentation and compatibility

GL, Glide and D3D9 WebGL presentation transfers an `ImageBitmap` from a
separate presentation surface. Persistent drawing attachments survive frame
export. The main thread composes the frame and releases bitmap ownership.
Software Glide sends an owned RGBA frame. Software GL uses the producing
guest's front-surface descriptor, not the render instance's unrelated globals.
The GL reply also supplies drawable configuration through a small shared
mailbox. The guest applies enablement, sizing and bitmap binding to its own
instance before continuing; the render consumer never initializes guest-owned
GL state. Software GL bitmap draws fence before returning, preserving their
immediate visibility to GDI and direct guest reads.

Legacy D3DIM retains its fenced DIB presentation in this change. Its Flip
still reads GPU pixels into shared memory before swapping the native surface
chain. Moving rendering to one Worker does not by itself remove that readback.
GL bitmap drawables and GL/GDI composition also preserve CPU-visible pixel
semantics. These cases must not silently receive a stale GPU-only image.

This change does not merge the API adapters into one shader translator or
merge all WebGL devices into one context. It centralizes execution and lifetime.

## Shutdown

Closing a context/device closes its endpoint, not the physical Worker or its
peers. Process teardown drains/closes all endpoints, retires the native render
heap once, adopts the returned free list, and then terminates the Worker.
Cleanup failures are reported; unsafe heap handoff is not reported as success.

## Validation

Run on the remote Linux box with the current production build:

```sh
node test/test-shared-render-worker.js
node test/test-gl-shared-render-worker.js
node test/test-glide-render-worker.js
node test/test-d3d9-shared-render-worker.js
node test/test-render-legacy-ready.js
node test/test-render-worker-lifecycle.js
node test/test-gl-software-producer.js
CHROME=/path/to/chrome node test/test-shared-render-worker-web.js --swiftshader --no-sandbox
```

The browser test uses real WebGL and the native software shader VM, verifies
pixels and query writes across API endpoints, and checks one physical Worker
and one heap handoff. The protocol tests cover ownership, queue bounds,
completion ordering, endpoint failure isolation and frame lifetime. Original
NFS3 Glide software/WebGL and D3DIM WebGL provide additional gameplay smoke
coverage. SwiftShader smoke timings are not hardware-GPU performance claims.

Validated on 2026-09-29 on the reserved Linux box (4 vCPUs, Ryzen 9950X,
Chrome 152 with SwiftShader), using the feature worktree sources:

- Full build, including its repository gates, passed.
- Shared manager/API protocols, startup/failure waits, shutdown, software GL
  bitmap parity, native D3DIM parity and GL RPC ordering passed.
- The actual browser test verified mixed GL and D3D9 endpoints, textured GPU
  draws and resident texture reuse, explicit readback, native software pixels,
  transferable frame lifetime, one physical Worker and one heap handoff.
- Boids software and WebGL each queued over 5,000 draws with zero local
  fallbacks, exactly one render Worker, and clean process retirement.
- Quake II reached textured gameplay and responded to movement on both WebGL
  and software GL. The software route additionally reported queued GL work and
  native triangles on the shared renderer, with zero local fallbacks.
- NFS3 reached racing on D3DIM WebGL, Glide WebGL and Glide software. Eight-second
  smoke windows measured 20.74, 16.99 and 2.12 FPS respectively. These are short
  functional checks on a software GPU, not a controlled performance comparison.

Remote captures and counters are under `~/nfs-movsd/build/shared-render-final-smoke`
and `~/nfs-movsd/build/quake2-shared-{webgl,software}`. The NFS report's Git field
names the remote checkout base; source files were overlaid from this feature
worktree, so use its recorded source hashes rather than that base commit as
implementation provenance.

### Rebase onto main `01b1f0b9`

The rebase preserves main's API IDs 0–3755 and appends Glide at 3756–3885.
MOVSD uses compiler kind 29 and micro-op 78, leaving main's MMX and switch-table
assignments intact. Scoped D3DIM fences carry their address and length through
both the guest command queue and the main-thread bridge. The completion result
remains 2 when other GPU targets still need materialization; global fences
continue to complete all outstanding work.

Remote validation on 2026-09-29 passed all 23 focused compiler, Glide ABI,
renderer protocol, native parity, lifecycle and texture-cache tests. Chrome
also passed mixed GL/D3D9 software/WebGL rendering and all three D3DIM worker
cases (software, legacy opt-out, WebGL), each using one worker and retiring
cleanly. Logs are in `~/nfs-movsd/build/rebase-tests/`.
NFS3 also reached racing on D3DIM WebGL, Glide WebGL and Glide software;
captures and counters are in `~/nfs-movsd/build/rebase-nfs-smoke/`. These were
functional smoke checks, not controlled performance measurements.

The normal build stops at `union-gate.js` for
`$gdi_bitmap_create_system` at `src/10a-gdi-bitmap.wat:1014`. This same failure
was independently reproduced from unchanged main `01b1f0b9`. A temporary
remote validation driver omitted only that gate: all remaining gates, WATX
compilation of both WASM artifacts and compiled data-overlap checks passed.
The shipping build script is unchanged.

The subsequent rebase onto `f3ec3a2f` includes main's shared GPU dropdown and
opt-in lazy surface synchronization. The remaining build gates and both WASM
compiles passed again, as did the expanded surface-fence test and the browser
GPU-selector test, including Glide's software backend. The selector harness
now mounts `/binaries/` from the corpus and explicitly enables thread isolation.
