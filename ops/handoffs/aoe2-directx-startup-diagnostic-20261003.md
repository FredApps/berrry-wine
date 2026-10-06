# AoE2 startup diagnostic, 2026-10-03

Actual owning-Worker trace localizes the observed startup failure to an unsupported DirectPlay interface query. Module4aa1915e remains unchanged. This is startup diagnostic evidence, not gameplay or FPS qualification.

Root-granted session79889 exited0. Browser/server closed16:31:55.552Z; process check found no helper or Puppeteer profile. All86 required actual served source/module identities passed, including private Workeredd51002 separately from canonical2df08722. Observer wrappers all restored. Validation pins33 artifacts under `scratch/aoe2-directx-startup-20261003/attempt1/validation.json`; full raw entry/exit CPU arguments and outputs are in `owner-api-snapshot.json`, final cleanup in `observer-cleanup.json`, interpretation in `publication.json`.

Current EULA personally reviewed; ordinary Accept (162,432), then two1200ms waits/screenshots. Final image personally reviewed: “Age of Empires II requires DirectX 6.1a or higher.” Stop before dialog dismissal. No API substitution, registry override, hidden action, source/build change or retry.

Observed sequence:
- DirectPlayCreate, caller0x00464f93, all-zero provider GUID: completed HRESULT0, object0x08009000.
- IDirectPlay3_QueryInterface, caller0x00464fb8, raw IID bytes30c5b10a4547d111a7a10000f803abfc, decoded {0AB1C530-4745-11D1-A7A1-0000F803ABFC}: completed HRESULT0x80004002, output pointer0.
- MessageBoxA, caller0x0047b2c5: exact visible DirectX6.1a error. This modal handler yielded, so its output return value remains unresolved.

Owner slot0 baseline0/current counter552;17 selected records, zero errors/drops, no pairing ambiguity, pending depth0. Some LoadLibrary entries yielded and have explicitly unresolved outputs. Filtered trace is not exhaustive branch/API proof; absence is never inferred beyond observer scope/caps.

Source `src/09a8-handlers-directx.wat` currently identifies only ANSI DirectPlay families and compares supported4A IID ending531, differing from actual request530. Next offline task is verify exact IID definition and caller branch, inspect complete method/string semantics, and propose a real interface implementation with negative/Unicode/identity tests. Aliasing Unicode to ANSI or bypassing the version check is not authorized.
