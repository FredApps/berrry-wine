# Combined TDR capability / Antara module-query validation

Passed 2026-10-07 13:50:34.748–13:50:54.255Z (19.507s). Tested own commit efb1dba04141b07535086899a9e3763587c9d21a and coordinator 62ab2a22 have identical tree de4e95227f1b71211ba38b4999326f22751bd9bb. All 4008 source/test pin hashes were checked before and after; pins SHA256 b7c64b8809cddc65308ee0b4d859719c764f704184aa3453d72841e6a406a568.

One sequential guarded command passed:

1. bash tools/build.sh — all mandatory gates, layout/shake and production compilation.
2. node test/test-win16-module-query.js build/wine-assembly.wasm — actual KERNEL47 paths and real WinExec child identity assertions.
3. node test/test-d3d-device-enumeration-lifetime.js — 16 nested pairs, 96 balanced cycles, 32 real x86 nested COM/continuation cases; this test compiles its extra-export module.
4. node test/test-ne-loader.js — 2881 passed, zero failed against original NE fixtures.
5. node test/test-ne-image-extent.js — passed.
6. node test/test-win16-system-module-files.js — passed.

Production module SHA256 d4256f3cd6b085a4acbd8192df7e9d0de8625beb82d10060ac2f27a51d8add74, 1719494 bytes, layout 0a82c5ae0e89dba1. Original build remains in scratch/wt-tdr2000-demo-20261007/build. Supervisor and child process group were absent after close; no deadline, disk-floor, output truncation or cleanup errors. Receipt and full log are adjacent. The prior combined-attempt1 bundle-freshness failure remains preserved separately.

Ordinary TDR and Antara browser acceptance is still pending. No gameplay, performance or deployment claim follows from these contracts. No diagnostic overrides belong in the forthcoming ordinary browser routes.
