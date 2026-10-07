# Antara original installer: actual child waits in DialogBox

Owner: `codex:antara-menu-worker`, 2026-10-07. Task
`NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006`. Findings only; root owns integration,
task/status updates and push. No shared HEAD/index mutation, subagents, local
browser/build, deployment, guest writes, forced waits/locks or binary patches.

The original installer still has no visible usable menu or installed game.
**Its Win16 child is alive and parked in the modal-dialog pump, with an
authenticated original USER.87 DialogBox caller.** This replaces the previous
execution/wait/exit uncertainty; it does not establish why menu content is
absent. No gameplay, FPS, audio or installation-completion claim follows.

## Exact run and observations

Durable evidence is `/home/user/wine-assembly/scratch/runs/20261007T215840Z-antara-menu-owner/`:
`analysis.json`, `caller-authentication.json`, `artifact-index.json`, eight
screenshots/states and all request/input/console/session/cleanup receipts under
`evidence/`, preparation/transport/tests under `harness/`, the exact production
module, original EXEs and relevant frozen source. No exact manifest candidate
exists; this is task-indexed investigation evidence, with no invented candidate
or dashboard pass record.

- Original 23-file installer media; SETUP.EXE SHA-256
  `51f3ea06024d54734eef19344a2b79b89db78e73b68fc951fb3643b04a921e1c`.
- Source `096889e174488a97529b8e73076d3a1e2feb2345`; production WASM
  `fb1be916c309bf619a9331c8fd46c4319f9051af76b05b236d3c362bb632638f`,
  1,720,492 bytes. All 502 transfer pins match locally/remotely; 448 committed
  runtime files match that commit, including 124 WAT fragments. The private
  apps registration is the sole runtime-source overlay. The full module HTTP
  response matches the hash; client consumption is not observable in that
  server receipt.
- Temporary box `bx_d8nw3e8t` / `box-node-b72dc646c0120bf7`, Chrome
  151.0.7922.108 stable, Node v24.18.1, headful DISPLAY=:0, fresh profile,
  1024x768 viewport, normal shipping main/aux Workers, 512 MiB guest memory.
- Launcher: `node scratch/antara-menu-owner-20261007/control.js launch`.
  Actual detached driver: `/home/user/.nvm/versions/node/v24.18.1/bin/node
  /home/user/antara-menu-owner-20261007/browser9.js --slot-granted
  --automation-granted`, NODE_PATH=/home/user/wine-assembly/node_modules.
  `harness/commands.json` preserves the seven queued commands and submission
  timestamps: wait4000, owner1, context1, wait10000, wait5000, owner2, context2.
  Each ordinary harness command also captures a screenshot. Final command was
  `{"action":"quit"}` (index7); its enqueue timestamp was not retained and must
  not be reconstructed from the cleanup time.

Session began 21:58:39.983Z; normal stop completed 22:00:00.324Z. The personally
reviewed `evidence/owner2-scene.png` shows the Sierra frame and empty gray client.
Seven settled captures are identical, SHA-256
`8c913b2641c89ecc5dede6f025ffcac05419ddd570bbe3649dbf12dcd05a6d9a`.
The window census retains visible parent HWND98305 at0,0, **640x480**, and
Main Menu HWND98306 at23,23, 595x435. There are no visible actionable controls
and no version-mismatch dialog. `inputs.json` is empty. The historical8707
parent width is not required for this failure; no geometry repair is warranted.
There are188 request rows, no served-source hash mismatches or cleanup/page
errors; the ordinary expected404 console entry is retained.

## Actual owners and original caller

The prepared collector is unchanged: fixed24 `readExports` getters on the
actual Worker links, max3 samples, up to4 auxiliary links, no page CPU fallback.
Two complete samples at21:58:46.169Z and21:59:03.335Z are **17.166seconds apart**.
They contain main slot0/tid1 and active child slot1/tid2, with zero omitted
workers. All recorded register values are identical between samples:

| Owner | EIP | Yield | Last run | CS waits |
| --- | --- | --- | --- | --- |
| Main | 001000b3 | 0 | halt3,6blocks | 0 |
| Child | 0012ff40 | 6 | halt3,2blocks | 0 |

The child's current CS001f descriptor has base00120000; EIP is offsetFF40.
Pinned `01-header.wat` defines WIN16_DLG_PUMP=FF40, and
`09e2-win16-dialog.wat:win16_dlg_park` selects that thunk and sets yield6.
The actual stack ESP001f6540 contains `{HWND16=0117, returnOffset=313f,
returnSelector=0047}`, exactly the pump frame documented in `win16_dlg_run`.
The independently repeated context reads preserve that frame unchanged.
They read752 shared bytes each under a4KiB cap, after the owning register
sample, without exports or writes. These are asynchronous memory observations,
not atomic CPU/memory snapshots or a historic API call trace.

Selector0047's live descriptor has base00170000 and NE segment2. Both96-byte
saved-return spans match original `_SETUP.EXE` SHA-256
`a11e70704b15c12424e771a1b7c331396f69644d7cb1f53a7a5b3999f9309bb4`,
segment2:310f..316e, except operands covered by its complete bounded original
relocation chains. There are no unexplained changed bytes. Its actual saved
return313f follows opcode313a / operand313b, an original FAR_ADDR import of
**USER ordinal87, DialogBox**. This is the live invocation's saved caller,
not merely a static candidate. It is parked rather than returning the earlier
resource-miss AXffff or exiting. The main's96-byte span also authenticates;
its EIP00b3 follows the original USER.108 GetMessage call at00ae/operand00af.

Offline original SETUP.SOL `464a50db...` expands SOL_ENG.DLL `22f02bb8...`.
Its Main Menu dialog102, resource SHA `eb8c7824...`, declares **zero template
controls**, so the blank scene alone does not prove conversion dropped items.
This decode is original-file evidence, not a captured live DialogBox argument.

## Next actionable dependency

Capture bounded owning-child delivery and dispatch for this dialog's
WM_INITDIALOG and WM_PAINT: actual message/HWND, dialog procedure, object lookup,
dynamic virtual target, and relevant original asset/API results. Previous-block
getters retain00171318 and001711d2; original static callback adapter2:12f2
calls2:10ec, whose epilogue includes2:11d2. These are useful next boundaries,
but their live bytes and delivered message were not captured here. Authenticate
them before attributing an initialization, routing or painting defect.

The two settled reads do not establish which messages were previously handled,
whether dynamic controls were requested, or which API failed. No generic
contract repair is supported yet. Do not repeat width-only work, fabricate
controls, redirect resources or send blind input to the empty scene.

## Tests, preparation corrections and release

Owner collector contract tests pass: actual-link child inclusion, fixed getter
list, bounded samples, missing getter and replaced Worker rejection. The added
shared-memory context tests pass: no writes, source pump-frame decoding,4KiB
cap, stale/incomplete sample and invalid-pointer rejection. Syntax checks and
original-code authentication pass. No runtime source change or native build/test
was performed. Preparation initially made a local `++` concatenation syntax
error; it was rejected and corrected before transfer. Original501-pin manifest
and prepared driver remain archived; the context addition makes502 pins.

Both Q2 and final Arx fresh-worker exit0 receipts existed before transfer;
their actual driver/Chrome PIDs, sockets and Chrome processes were independently
checked absent, with49GB available. No elapsed-time release or early grant was
used. Own cleanup has browser/server closed, errors[], streams0, Chrome exit0;
88365/88377 are absent, with no owned sockets or Chrome processes at22:01:24.
All evidence was copied into the named run before the release board entry and
before removing only the owned remote prefix. Removal22:01:55 was verified.
The box is retained for other owners, expiring22:51:07Z. No runtime resource
is retained by this worker; shared HEAD/index remain untouched.
