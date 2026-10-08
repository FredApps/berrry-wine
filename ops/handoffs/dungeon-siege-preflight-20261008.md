# Dungeon Siege demo: queued original-payload preflight

Task NEW-GAME-DUNGEON-SIEGE-DEMO-20261008 remains queued under the user's one-worker budget. No guest execution, browser, extraction or compatibility qualification was performed.

Original local package: test/binaries/win98-games-a-d/DungeonSiege-demo-D3D.exe, 192188416 bytes, previously SHA-pinned a501306cad88c0fc41f986d92109343d68ac79fc11aaa6611724d84be628f3f8.

Read-only PE resource traversal identifies CABFILE / MSGAME.CAB / language1033 at file offset464312, length191706128, with actual MSCF signature. Cabinet metadata: three folders, flags0,37 files totaling206866962 uncompressed bytes. It includes DungeonSiegeDemo.exe (3608640 bytes), DSVideoConfig.exe, BinkW32.dll and Mss32.dll. The smaller SETUPBINARY / SETUPDATA resource is installer configuration, not the game executable. A incidental MSCF string in the stub is not the cabinet boundary.

Receipts: scratch/dungeon-siege-preflight-20261008/resources.json and cabinet.json. These are static inventory, not dashboard gameplay evidence. No installed/configured state is asserted.

Next sole worker: verify package hash, inspect complete cabinet listing/compression and original setup metadata, extract originals on a temporary no-env box with checked cabinet tooling, preserve original names/content and provenance. Reconcile required installation/registry/configuration from evidence before registering the game. Then ordinary launch, menu-to-gameplay input and reviewed screenshot; document first causal failure honestly. Include canonical source/build dependencies and both ToyVM bundles in transfer closure; declare runtime bounds before launch, serialize browser use and keep local disk above2GiB. Do not duplicate the large installer locally. No public deployment.
