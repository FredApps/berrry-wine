# MIG-RENDER-TEXTURES-PLAN

Worker `/root/fp_parity`, Codex `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`. Source/import preflight completed 2026-10-02 UTC. Original renderer handoff: `01a0eb29-4302-7e20-9b06-7084fb37358b.md`. All migration source remains private in `/private/tmp/wa-render-unify`, unmerged. No tests, builds or remote calls were run by this worker.

Stable manifest: `scratch/mig-render-textures-plan-20261002/manifest.json`. It records all eleven transfer paths, current SHA-256/size, root-supplied current remote hashes, archived frozen82 hashes, reference-only dependencies and source-compilation prerequisite paths. Every existing remote registry-path hash equals the corresponding local frozen82 archive hash; both new files are absent remotely. The four already validated DEF/fog fix files are reference-only and must be preserved, not retransferred as part of this registry slice.

## Coherent transfer set

| Files | Purpose |
|---|---|
| `lib/render-textures.js` (new) | Generic immutable RGBA ownership, transactional definitions/retirement, optional native residency and lease release |
| `lib/gl-software-lowering.js` | GL consumer registry transaction and common native residency |
| `lib/glide-texture-resources.js` | Retains Glide power-of-two/mip-tail legality while sharing generic storage/transactions |
| `lib/glide-software.js` | Pins common native resources around synchronous neutral draw |
| `lib/glide-render-worker.js` | Releases common native resource identities on ordered retirement |
| `lib/d3d-render-worker.js` | Loads registry before Glide and legacy/D3DIM software adapters |
| `lib/guest-worker.js` | Loads registry before GL software and related producer modules |
| `index.html` | Loads registry before browser Glide resource/software modules |
| `test/test-render-textures.js` (new) | Ownership, transactions, retirement, budget, unique pins, revisions, partial failure and release checks |
| `test/test-glide-draw-lowering.js` | Registry import and native retirement mocks, plus completed empty-lease release mock |
| `test/test-glide-web.js` | Browser import graph includes registry |

Exactly eleven files. Relative to the verified remote hashes, existing file differences are registry imports, registry/residency delegation, retirement ordering and associated mocks; no geometry/shader/raster change is included. No `src/`, `build/`, documentation, dependency symlink, or broad archive should be transferred. Explicitly exclude `src/09ah-d3d-software.wat` and `test/test-d3d-software-pipeline.js`, which carry the unrelated empty-quad optimization. Also exclude other primitive-source deltas already resolved in the remote checkpoint.

## Import and native compatibility

CommonJS consumers require `render-textures` directly. Browser import order is covered by index, guest-worker, adapterFactory's Glide and D3DIM lists, and the Glide browser fixture. Shared software GL runs via the legacy endpoint, which selects the D3DIM import list before constructing `GLSoftwareLowering.Consumer`; the hardware GL adapter does not need this software registry. The neutral D3D9 adapter does not acquire a new registry dependency.

The registry calls existing `D3D9SoftwareBackend.Device` methods: `hasTextureResource`, `defineTextureResource`, `pinTexture`, `releaseTexturePins`, and `releaseTextureResources`. That JS file is byte-identical locally and remotely, SHA-256 `b0a9f2b88b0f2eb046a659acc5abb7efae39cc28cd4f195c96cf0a96ff8ee96f`. No new WAT import/export, region, native ABI or generated map is required.

**No canonical WASM rebuild is required.** Keep remote module SHA-256 `fa0cb8a8bc80cdb1837ca32b2da00616f6ad6de2b0cbb237f4fe51235751cc22`. Several existing tests nevertheless compile the unchanged remote source in memory through `test/compile-src.js`; this is distinct from reusing that saved module. There is no existing environment override in this helper to substitute a saved WASM. Do not modify test compiler behavior just for this migration.

Before source-compiling tests, root should hash-check/preserve the remote frozen source closure and compiler helpers. The manifest enumerates all **123** prerequisite paths: `src/main.watx` plus its 122 includes, including the existing native texture/shader/raster/GL/Glide producer files. It also lists `test/compile-src.js`, `test/render-helper.js`, `tools/watx-closure.js`, `tools/watx.js`, `lib/host-import-sigs.generated.json`, and `lib/region-map.generated.js`; preserve the compiler's `tools/watx-src/` implementation dependencies too. Capture those remote hashes before/after transfer, requiring no change. Do not replace remote source with local source to make hashes agree: local `09ah` intentionally contains the excluded optimization. The remote closure should remain the already built and tested primitive/specular checkpoint.

## Narrow preflight repair performed

Static inspection found `test/test-glide-draw-lowering.js`'s early `device()` fixture only mocked `native.draw`. The new shared resident helper always releases its lease, including an empty lease for this fixture's id-less textures, so `native.releaseTexturePins` would be undefined. Root explicitly authorized completing only that mock. Added `releaseTexturePins(){}` alongside its existing `draw` recorder; no production change or test assertion was altered.

Updated file SHA-256: `bb41c3bc47cfa997f13ba92fe3899daa5cd88c60e757bad12ef6eaec7846c193`. The manifest was refreshed and all eleven files rehashed to verify stability. The previously added later `RecordingSoftware` retirement mock and registry import remain intact. Runtime success is unclaimed.

## Serial validation sequence

Root owns the remote correctness slot. Preserve remote originals, freeze the eleven files against this manifest, compare hashes again before copying, and do not sync into a live test process. From `/home/vg/universal-render-candidate`, retain the established environment:

```sh
export PATH=/home/vg/glide-validation-deps/node-v24.15.0-linux-x64/bin:$PATH
export TMPDIR=/home/vg/universal-render-candidate/build/browser-tmp
export LD_LIBRARY_PATH=/home/vg/glide-validation-deps/root/usr/lib/x86_64-linux-gnu
export CHROME=/home/vg/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome
```

Run each command separately and stop on failure. Give each a fresh log in the root's owned evidence directory.

1. Lightweight JS fixtures, no WAT compilation:

   ```sh
   node test/test-render-textures.js
   node test/test-glide-draw-lowering.js
   node test/test-glide-render-worker.js
   node test/test-gl-resource-lowering.js
   ```

2. Native correctness fixtures; `bootRenderHarness` compiles unchanged remote WAT in memory:

   ```sh
   node test/test-gl-resource-chunks.js
   node test/test-gl-software-neutral.js
   node test/test-d3d9-software-texture-cache.js
   ```

3. Actual browser/worker graph and GPU/software integration:

   ```sh
   node test/test-shared-render-worker-web.js --no-sandbox --swiftshader
   node test/test-glide-web.js --no-sandbox --swiftshader
   ```

   Shared-worker test loads the existing canonical WASM. Glide browser test compiles unchanged source in memory first. Preserve the already passing specular/fog regressions and all analytical pixels. Browser acceptance includes actual endpoint creation/imports, uploads, palette replacement, LFB, front/back identity, teardown and raw/presentation distinctions.

4. Only after these pass and a separate gameplay slot is assigned: the old handoff's Q2 software world/movement route with a fresh output directory, unchanged module and source manifest. This is gameplay validation, not registry performance acceptance. No new benchmark or Q2 run is started by this plan.

## Review boundaries and remaining evidence

The generic registry copies mip pixels and counts storage tails. Glide keeps its own stricter mip-chain validation. GL now validates transactions and retires resources after the ordered draw; both consumers release native pins in `finally`. Oversize native residency falls back to the same executor's owned snapshots. Guest-surface attachment address slots remain resolved at execution time; no new fence or readback was introduced by this slice.

The registry imposes default 32 MiB resident / 64 MiB transient pixel budgets on GL, whose previous plain resource Map had no such aggregate byte check (only native residency was bounded). Entry limits are separately raised for GL. This is a changed admission boundary, not demonstrated gameplay compatibility; do not claim unchanged supported capacity from the small fixtures. Watch the Q2 texture working set and any budget rejection. The helper also copies definitions, so performance must be evaluated separately before any improvement claim.

All requested planning evidence is ready. No active worker processes remain. Root owns transfer and validation; the next ready action is the eleven-file staged copy followed by Stage 1, preserving remote WAT and the four accepted JS fixes.
