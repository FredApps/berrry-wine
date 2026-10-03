# MIG-RENDER validation checkpoint

Coordinator `codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0`, 2026-10-02 UTC.

Accepted renderer root and three-child handoff. Preserved private worktree and
all existing runtime artifacts. Preflight on fast-near-9tb-1 found no renderer
jobs; only retained Xvfb28507 and unrelated long-lived node3155733, cwd/home/vg.
Neither was touched. Post-test process scan returned to the same two processes.

Copied only `lib/d3d9-shader.js` and `test/test-d3d-fixed-lowering.js` from a
stable local snapshot to the released remote candidate. Before copies and
transferred files are under `scratch/mig-render-20261001`. Diff against the
remote originals confirmed only final-DEF-wins plus its regression changed.
No WAT, common-registry, empty-quad or other source transferred; no build run.

Exact tested identities:

- WASM: `fa0cb8a8bc80cdb1837ca32b2da00616f6ad6de2b0cbb237f4fe51235751cc22`.
- Shader: `3906f0ca9fb91047896b031a04a987830866c15d8f8bfc7a69d1e760398cd3d4`.
- Fixed test: `ac5e3953e45c1f5eadf0e168320acc25ba9187bb6274a9b3ca1c3758c877ad76`.

Using the root handoff's Node24.15, library, Chrome and TMPDIR environment:

1. `node test/test-d3d-fixed-lowering.js`: PASS72 lighting/pixel handoffs,
   ownership and rejection. Log `fixed-lowering.log`, exit0.
2. `node test/test-shared-render-worker-web.js --no-sandbox --swiftshader`:
   exit1, `D3D9 draw: programmed fog specular alpha linkage requires conformance`.
   Log `shared-worker.log`. Browser cleaned up normally. No aggregate pass,
   performance or gameplay acceptance is claimed.

Local read-only follow-up MIG-RENDER-FOG examines the backend guard and generated
fixed shader boundary before any further mutation. Root retains remote slot for
sequential correctness validation; currently no test process running. Original
analytical expected pixels must stay unchanged. Remaining renderer migration
work and performance acceptance are still open.

## Fog guard correction verified

Read-only diagnosis found the guest COLOR1/fog guard also caught the fully
generated fixed pair, whose secondary color and oFog are separate. Worker
changed only backend guard and shared-worker regression in the private tree.
Root froze both files, downloaded remote originals, and confirmed the diff
contained only this correction plus its tests before transferring.

- Backend SHA256: `b404b74dbf9d882e91cd9dd83e5dbe626380206a0facab8761af2f5aee01555c`.
- Shared test SHA256: `64edeb62ba41f87d0792e73abc726add6831936e8cd52c67a264ce85bc046369`.
- WAT module unchanged, hash above; no build or broader migration transfer.
- Same shared-worker command PASS, exit0. Log `shared-worker-fog-fix.log`.
- Actual WebGL and native software analytical pixels pass, including unchanged
  fog/specular `[64,159,16,191]`. GeneratedVS/guestPS and guestVS/generatedPS
  still reject with the original linkage guard. Version/oFog checks retained.

MIG-RENDER and MIG-RENDER-FOG bounded checks complete. No merge, gameplay,
performance, texture-registry or empty-quad acceptance follows from this pass.
