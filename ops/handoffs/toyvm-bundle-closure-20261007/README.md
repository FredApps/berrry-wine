# Complete ToyVM browser bundle closure

On 2026-10-07, the combined TDR/Antara mandatory build stopped before compilation because sparse regeneration had omitted tools/disasm.js and its tools/simd-ops.js dependency. All previously embedded module bodies matched the coordinator source; missing relative dependencies are silently skipped by moduleList in tools/toyvm/bundle-browser.js.

Regenerated both bundles from the complete tracked closure at 8f3f361c (tree identical to coordinator 4de7421d). Reproducibility check passed; test/test-toyvm-browser-bundle.js passed four entry points and executed its browser-shaped COM program printing HI. The adjacent receipt records hashes and clean process closure. No browser/game qualification follows from this test. Combined full build remains pending.

A separate robust gate should fail on unresolved tracked relative requires, using a narrow explicit exemption for genuinely optional CLI-only dependencies rather than treating every missing file as optional. Add a sparse/missing-dependency negative fixture that removes disasm.js and proves regeneration refuses omission. This proposal is not implemented in this generated-files correction.
