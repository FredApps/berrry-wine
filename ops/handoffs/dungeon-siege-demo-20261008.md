# Dungeon Siege demo: original verified, remote transport blocked

Task `NEW-GAME-DUNGEON-SIEGE-DEMO-20261008` is unfulfilled. The sole worker
created branch `fix/dungeon-siege-demo-20261008` in
`/home/user/dungeon-siege-demo-20261008` from current origin/main
`62615a1864e1c7e9571b1694e08da12cfd45c293`. Shared HEAD/index were not changed.

The first ordinary `boat ssh bx_hgju4y2b` operation returned HTTP 403,
`api_key_action_forbidden`, `This API key cannot perform ssh.` No remote
command ran. No retry, rephrasing, alternate transport, upload, extraction,
build, guest execution or browser was attempted. This is an API permission
failure, not an asserted cybersecurity auto-review decision.

Root owns fresh no-env boat `bx_hgju4y2b`, 4 vCPU/8 GB, expiry
2026-10-08T19:33:09.246Z. No worker remote PIDs, Chrome or listeners were
created; remote process inspection is unavailable because SSH was denied.
Root should stop the boat or resolve the specific SSH permission before a
separately authorized continuation. Nothing remote needs retrieval from this run.

## Verified original and additional static findings

Original `test/binaries/win98-games-a-d/DungeonSiege-demo-D3D.exe` is
192188416 bytes. SHA-256 was recomputed and matches
`a501306cad88c0fc41f986d92109343d68ac79fc11aaa6611724d84be628f3f8`.
Scoped current-main searches of registry, candidate manifest, public hosting,
re-notes and handoffs found only the queued preflight, no matching qualification.
This does not claim an exhaustive scan of all historical scratch evidence.

The preflight CAB inventory remains unchanged: resource CABFILE/MSGAME.CAB/1033
at offset464312, length191706128, 37 files, three folders, total206866962
uncompressed bytes. Extraction and per-payload hashes remain unverified.

The original SETUPBINARY/SETUPDATA bytes at192170444, length11116 were read
without running the installer. SHA-256:
`43e6257f60a58d0aa413ffa1eed81f331fec030ed726d6cd3213d9a3227e679c`.
Printable strings name `System\\MSS`, `DungeonSiegeDemo.exe`, `system_detail.gas`,
`%PERSONAL\\Dungeon Siege Demo\\*.*`, registry `%REGROOT\\Version` and
`%REGROOT\\Zone`, and an Eventlog/Application/DungeonSiege registration.
These are setup metadata, not proof of required runtime registry/configuration
values or installed state. No values were fabricated.

## Evidence, bounds and next action

Shared run `scratch/runs/20261008T1633Z-dungeon-siege-demo-transport-blocked`
contains original inventory copies, original setup metadata slice/strings,
identity and exact transport receipt, SHA256SUMS and result-last metadata.
No screenshot/module/backend/input/performance/audio qualification exists.
No application was registered prematurely.

Declared immutable phase limits before execution: transfer900/build900/
native-startup600/browser2400/retrieval-cleanup300 seconds, aggregate5100.
Transport failed before any launch. Initial free disk2623787008 bytes;
after isolated checkout2379145216 bytes. Full206866962-byte extraction would
leave2172278254 bytes before evidence/other allocation, near the2GiB floor.
No installer duplicate, local archive or extracted payload was created.

Next action: root resolves SSH permission and confirms lifecycle, then a new
bounded worker uses checked cabinet extraction remotely, inspects genuine
installation prerequisites, retains original hashes, registers the full
local-only file closure and proves ordinary menu-to-gameplay input. Canonical
source transfer must include both checked-in ToyVM browser bundles. Root
reviews/integrates/pushes this explicit documentation commit; worker does not
merge main or deploy. No subagents/refill or held diagnostic work was performed.

## Coordinator transport correction, 16:44 UTC

The first worker exited0 at16:35:10. Its SSH denial remains valid, but the
claim that all remote execution was blocked is superseded. Official `boat exec
--help` describes the separate Boat API execution route without SSH. Root ran
`boat exec --json --timeout 30 bx_hgju4y2b "node --version"` successfully at
16:44:37.536–16:44:37.625 UTC: exit0, stdout v24.18.1. An initial incorrectly
quoted node-e command failed shell parsing before Node; it did not launch a guest.
No SSH retry, credential change or permission expansion was performed.
Root adopted the existing no-env box through19:33:09.246 UTC; the sole fresh
dungeon-siege-api worker continues from5cd802415 using this supported API.
All six sealed static/transport artifact hashes passed coordinator verification.
Gameplay, extraction and registration remain unqualified at dispatch.
