# TDR2000 D3D7 filter-cap contract correction

Focused validation passed on 2026-10-07; mandatory full-build gates and ordinary TDR2000 gameplay remain pending. This is not a game qualification or performance result.

The original TDR2000 EXE copies the 236-byte EnumDevices7 callback descriptor to object+0x904. Its IntegrityCheck producer reads triangle filter caps at object+0x964 (descriptor+96), testing DX7 MINF/MAGF bits. The existing shared descriptor filler returned legacy 0xFF alone. The nine-line correction advertises implemented point/linear MINF and MAGF bits for both line and triangle caps (0x030003FF total); legacy D3D1/2/3 caps remain 0xFF. No anisotropic or mip-stage capability is added.

The existing test/test-d3d-device-enumeration-lifetime.js now checks both descriptor families, including reads executed by actual x86 guest callbacks through COM/continuation thunks. It retains nesting, ordering, ABI, lifetime and stack controls.

Validation ran from base b92d2f848e02183f2e6fcb50802d562df4b9b7cb with the two-file patch. Before used the original authenticated WAT fragment and the same new test/remaining source: compilation succeeded, then the actual D3D7 callback assertion failed with 255 != 50332671. Candidate passed 16 nested pairs, 96 balanced cycles and 32 real x86 nested enumeration cases. Raw logs and module hashes are in the adjacent receipt. Both process groups closed without cleanup errors; total wall interval was 5.508 seconds. Modules were privately compiled test modules, not published production builds.

Original harness/pins: scratch/wt-tdr2000-demo-20261007/scratch/tdr2000-preparation/filter-repair/. validate.js SHA256 5a926e86031135642b6b426ae457bfef9c81aae89be39a9f10afc0384ab999a5; pins.json b46d7eb87f491f3dc63cf4beeb0031a5aa838d2087cd1ea7a328a116bb5212b1. Parent will combine this nonoverlapping correction with Antara's lookup fix for one full mandatory build. No redundant build or browser was launched here.
