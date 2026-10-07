# Winamp visualization fixture identity

Source-only audit; no visualization run or compatibility claim.

Current main `lib/apps.js` registers `winamp` with
`test/binaries/winamp.exe` and preloads/mounts
`test/binaries/plugins/candidates/vis_milk.dll`. It does **not** register
`vis_milk2.dll`. The latter must not supply the host requirement for this route.

| File | Bytes | SHA-256 | Observed identity |
|---|---:|---|---|
| winamp.exe | — | `032008e486ab96514d71f805492dfbb91cf97c6793e8b2171fb33ef13bd883a5` | Fixed-info signature candidate encodes 2.9.1.0; this is not a full RT_VERSION parser result. |
| vis_milk.dll | 430592 | `c2a84595bd3b2802be341720a691ecbf0901fc9c5f6a60d01fba6213ba651901` | Self-labels “MilkDrop 1.04e”; binary contains d3d8.dll text. |
| vis_milk2.dll | 425472 | `85309c6afe4d2976de56b062ff8fc1b69690eccb57cbf124b402d5525be1ff08` | Self-label “MilkDrop v2.25c”; separate, unregistered candidate. |

Raw audit: `scratch/runs/20261007-winamp-milkdrop-fixture-identity/identity.json`.
PE import descriptors were read through `lib/pe.js`; neither plugin has a
normal d3d import descriptor. The DLL-name strings alone do not establish that
a runtime graphics initialization succeeded (they may be dynamically loaded).

Next: use the exact registered Winamp route on a temporary browser box, play
the original demo MP3 and select/start the registered MilkDrop through ordinary
visualization preferences. Inspect configuration, selected plugin, actual
graphics calls and screenshot. If presets or another file are requested but
absent, record the exact requested path before changing the manifest. Do not
substitute MilkDrop 2, infer compatibility from a label, or call player startup
visualization success. This resolves identity ambiguity, not the unrun GL row.
