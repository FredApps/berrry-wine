# Selective fixture staging — 2026-10-03

All 16 exact requested archive members were recovered to scratch only; no live fixture was copied. Total: 62,983,471 bytes. All staged files were independently rehashed after extraction.

Verified archive: `/home/user/wine-assembly-migration-20261002/test-binaries.tar.gz`, 28337169424 bytes, SHA-256 `f816abfcadf152cebfadae71fe8ac7aef41b2bf6e9d57f203f7bece3d8d5b892`. Source head `823d68d2a5a5866c0636302915382b1c2185d8a0`. Full archive hash was checked both while indexing 52,285 names and while selectively streaming requested regular members into private staging. No bulk extraction, deletion, or overwrite occurred.

Receipts: `scratch/migration-fixture-staging-20261003/index-receipt.json`, `scratch/migration-fixture-staging-20261003/staging-receipt.json`, `scratch/migration-fixture-staging-20261003/proposed-task-deltas.json`. Missing requested members: **0**. Root owns safe live restoration after browser release and subsequent task reconciliation.

| Exact intended path | Bytes | SHA-256 |
|---|---:|---|
| `test/binaries/notepad.exe` | 53248 | `e7b01ab85a35ba6f577067d13efa522dc3d605de7712340e4acaf7065f866340` |
| `test/binaries/calc.exe` | 94208 | `cb71fcc9726f756421519a215c39cf89efd930c9ae0fa5bbb59b64050faef52b` |
| `test/binaries/dlls/msvbvm60.dll` | 1386496 | `3ef32e0152cc3fa07c417e6aadf9ead83a17b5fdee73799044e1bd7564725d6e` |
| `test/binaries/dlls/oleaut32.dll` | 598288 | `baeb2f7c1b8be56738d34e1d1ddf8e0eebd3a633215dc1575e14656be38b939d` |
| `test/binaries/dlls/comctl32.dll` | 577808 | `28a41e6a35c4509924a32a99841a815cf49e1d3ee6912ec26a823e45472edfa4` |
| `test/binaries/candidates/starcraft-demo-official/SCDemo.exe` | 29569755 | `c979399d8543917bb091266fbd12c1e1d8631647231163cf5ac931ef4de9cb83` |
| `test/binaries/candidates/starcraft-demo-official/installed/readme.cnt` | 1134 | `c2fde9678a74b1270e6a5a780334c90a82d3a726e044b56aa3c507c38dc6f34a` |
| `test/binaries/candidates/starcraft-demo-official/installed/battle.snp` | 239358 | `62a9a74bfc1ea18b034ad4b92aaef7b16009f6af2c1b8d43a1379f1056af8ce2` |
| `test/binaries/candidates/starcraft-demo-official/installed/storm.dll` | 202752 | `d28093f889f2d9fe1475ee55b47fbfab4d8241fdf73af105d0b85c1514875290` |
| `test/binaries/candidates/starcraft-demo-official/installed/local.dll` | 52224 | `0748d10dac2d15ed6a8d83ac89f0d7a738075b375e0ed7d26d947cc1be626341` |
| `test/binaries/candidates/starcraft-demo-official/installed/starcraft.exe` | 970752 | `b2461f58aca73df0af402009f2a33fae85ce57626eb938479effd12e972c1c26` |
| `test/binaries/candidates/starcraft-demo-official/installed/stardated.mpq` | 29005415 | `499655e14b20b7d63c4d4c34a126eee941dc56fb6be84322cf02cacf4aefebe3` |
| `test/binaries/candidates/starcraft-demo-official/installed/smackw32.dll` | 95232 | `5786b7b72667b9ea1cc4bf7762a9e313c2ad1474392907a0f3b52e4e888029bf` |
| `test/binaries/candidates/starcraft-demo-official/installed/readme.hlp` | 28926 | `5c201666c4de96575fb0dd94596d88d982463b996d126a44632f162e85dcb784` |
| `test/binaries/candidates/starcraft-demo-official/installed/license.txt` | 10617 | `d81f0794d376c7edbca004b0b2793e2159a0eda27e308562656114ac6ee48bb7` |
| `test/binaries/candidates/starcraft-demo-official/installed/standard.snp` | 97258 | `8705a75613120eaef07de53d266beca85e6f4ae2461f761092788b7e124c654d` |

Readiness proposals retain all existing runtime failures, screenshot limitations, review gates and missing qualified FPS. Calc/Notepad are utility fixtures, not game-coverage successes. Restoring StarCraft's 11 missing assets permits route preparation; no current gameplay success is claimed.
