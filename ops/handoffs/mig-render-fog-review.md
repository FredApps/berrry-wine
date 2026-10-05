# MIG-RENDER-FOG: generated fixed specular/fog guard review

Worker `/root/fp_parity`, Codex `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, 2026-10-01. Read-only diagnosis of `/private/tmp/wa-render-unify`; no edits there, tests, builds or remote access. Root retains remote resources. This note and append-only board updates are the only writes.

## Finding

The backend's existing guest pixel-shader fog restriction also rejects newly generated fixed pixel shaders. At `lib/d3d9-backend.js:471–475`, `guestPS` means any bound pixel program, including a program compiled with `generatedFixed: draw.nativeFixedPixel === true`. When fog is enabled, the backend rejects any such program declaring `varying vec4 d3d_color1;`, without considering its generated provenance.

The root's `scratch/mig-render-20261001/shared-worker.log` records exactly this guard error. It does not record a fixture name. From the shared-worker test order and the newly added specular fixture, the likely triggering case is `specular RGB fogged after addition` in `test/fixtures/d3d9-specular-cases.js:42`. Treat that case attribution as source-based inference until a labelled replay confirms it.

That fixture legitimately needs both specular and fog:

- `D3DFixedLowering.Lowerer.prepareDraw` gives the fully fixed draw both `nativeFixedVertex: true` and `nativeFixedPixel: true`, removes `fixedFunction`, and publishes explicit `fogState`.
- Generated vertex IR writes the secondary color as `oD1`; generated pixel IR reads that color and adds specular after the texture combiner with an RGB write mask. Diffuse alpha is retained. See `src/09aj-d3d-fixed.wat` around 889–898 and its final cascade post-add around 1118.
- Fog has a separate vertex output: `lib/d3d9-shader.js` maps `oFog` to `d3d_fog`. The backend already demands that output for vertex fog at line 469.
- The backend's later vertex-fog wrapper (around 523–530) runs after the pixel main and blends only `gl_FragColor.rgb` using `d3d_fog.x`. It does not take the fog factor from secondary alpha and does not replace result alpha.

The expected RGBA **[64,159,16,191]** remains correct: half of specular RGB `[.5,.25,.125]` blended with green fog gives `[.25,.625,.0625]`, while diffuse alpha remains `.75`. Do not change this expectation or tolerance. The existing shared-worker loop checks it through both GPU and software endpoints; native fixed lowering also checks the same fixture.

## Minimal correction proposed, not applied

Keep the programmed fog version whitelist and vertex `oFog` requirement unchanged. Narrow only the secondary-color guard to exempt the fully generated fixed pair:

```js
if (fog.enabled && guestPS) {
  if (![0xffff0101,0xffff0102,0xffff0103].includes(guestPS.version))
    invalid('programmed fog profile is not implemented');
  const generatedFixedPair = draw.nativeFixedVertex === true && draw.nativeFixedPixel === true;
  if (!generatedFixedPair && /varying\s+vec4\s+d3d_color1\s*;/.test(guestPS.source))
    invalid('programmed fog specular alpha linkage requires conformance');
}
```

A short comment should explain that generated fixed pairs carry separate secondary-color and oFog outputs. This is intentionally narrower than exempting every generated pixel shader: mixed guest-VS/fixed-PS linkage is not the case being established here. It also avoids accidentally admitting a guest PS merely because its vertex stage is generated. Each shader still compiles under its own existing `nativeFixed*` flag; the pair condition changes only this backend conformance guard.

Do not remove the regex globally, change guest shader versions, suppress fog, relabel a guest program as generated, change the lowerer's staged guest-PS returns, or weaken expected pixels. `lib/d3d-fixed-lowering.js:248` explicitly leaves post-specular plus guest PS staged, and lines 298–299 retain unsupported guest COLOR1 linkage. Those boundaries remain unchanged.

## Discriminating regression

Use the existing actual worker positive fixture rather than duplicating its analytical answer. Keep the GPU/software comparison for `specular RGB fogged after addition` and the non-fog specular/color-alpha cases. For clearer diagnostics, wrap each specular fixture's draw/readback failure with its name and endpoint, without changing the underlying error or assertions.

Add a negative browser-backend check in the same shared-worker test's page context, using a separate direct `D3D9Backend.Device` (scripts are already loaded) rather than poisoning the worker command queue with an expected rejection:

1. Prepare the fogged specular fixture through `fixedProducer.prepareDraw` and verify both generated flags.
2. For the negative draw only, replace its pixel IR with `nativeProgram(new Uint32Array([0xffff0101, 1, 0x800f0000, 0x90e40001, 0xffff]))` (`ps_1_1: mov r0, v1`) and clear/delete `nativeFixedPixel`. Keep the generated vertex stage and fog state so the test reaches the specific guard instead of failing for a missing oFog or unsupported vertex profile.
3. Require the direct backend to throw the exact `programmed fog specular alpha linkage requires conformance` error. This distinguishes the intended correction from a blanket exemption based on `nativeFixedVertex`, or deletion of the guard. It also verifies a real guest PS is still rejected even beside a generated VS.
4. For the other mixed direction, use a valid ordinary guest VS that writes position, oD1 and oFog beside the generated fixed PS, with `nativeFixedVertex` unset and `nativeFixedPixel: true`. Require the same guard error. This pins the proposed fully generated pair boundary; a test that merely unsets the generated flag on the complex generated VS would fail earlier during guest-profile validation and would not discriminate the fog guard.

Retain existing `Shader.compileNativeIR(generatedVS)` guest-profile rejection assertions in `test/test-d3d-fixed-lowering.js` and the staged guest-PS cases there. Do not expect an intentional invalid draw to leave a shared command endpoint usable: its queue errors are sticky. A direct test device avoids hiding later valid results behind an intentionally failed queue.

## Validation and next step

Root may assign a narrow JS-only patch to `lib/d3d9-backend.js` plus the regression in `test/test-shared-render-worker-web.js`, preserving the already transferred last-DEF fix. Run syntax/diff checks and the same frozen remote shared-worker command; no WAT or canonical rebuild is required. The positive fixture should fail before the guard correction, pass after, and the negative guest/mixed cases should stay rejected. Reuse the exact analytical values and frozen module identity; collect a fresh log.

No runtime result is claimed by this review. The original remote error is observed; the identified generated-linkage explanation and correction are based on inspected source. Root should inspect any subsequent failure independently rather than treating this guard change as proof that the complete shared-worker suite passes.
