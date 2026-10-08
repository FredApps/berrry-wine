# Warcraft III original Prologue: ordinary unit movement

Worker `codex:warcraft3-campaign-world`, task
`GLD3D-WARCRAFT3-PROLOGUE-20261008`, isolated branch
`findings/warcraft3-campaign-world-20261008` from the explicitly accepted
coordinator `3892d9aee2f45afdce77aca0545cab22113c6461`.
Prior `cfd629954` branch preserved; shared HEAD/index untouched. The previous
[Campaign handoff](warcraft3-prologue-20261008.md) remains historical.

**Fresh original Prologue gameplay and two ordinary move orders observed.**
Worker reviewed the actual images and state receipts. Independent coordinator
visual review, contained-hash review and main integration remain pending at
worker exit. This is a scoped opening-map control result, with no FPS, audio,
combat, campaign completion or whole-game claim. No engine change was made.

Evidence: shared repository
`scratch/runs/20261008T0156Z-warcraft3-campaign-world-runtime/`.
It contains the exact executed helper/source/media closure, transport and
control scripts, browser receipts, thirty screenshots, hashes, and metadata
published last. The original reference is
`f62ab3c9f1223ab47cf623470f6343d508257878`; actual served module is
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`.
The executed browser helper is unchanged `b17bb614d35457125d68f2d1653e5315b5d0a5df`.
All 542 pins and twelve original registered media paths are preserved. All
788 actual served hashes (261 full, 527 ranges) match; no partial reads or
missing registered paths. Strict shell HTTP refusals remain exactly
`api/auth/user`, `test/binaries/tlbs/stdole2.tlb`, and
`test/binaries/tlbs/stdole2.tlb.part000`; these did not prevent the observed route.

## Ordinary route and reviewed landmarks

The browser starts at 02:07:36.858 UTC with original deadline 02:17:36.858.
After actual screenshot review, Single Player (594,327), ABC trusted keys,
Create (228,391), Select (226,542), Campaign (593,365), and the Prologue bullet
(473,373) reach Chapter One: Chasing Visions loading at 02:10:58.810.
Several first long clicks only highlighted their targets; each subsequent
click was independently reviewed. Separate hover and five-second DOWN/UP
remain the unchanged accepted mechanics, not a proven cause or engine repair.
The GPU backing canvas still reports a zero DOM rectangle; screenshot pixels
establish targets. Every action's latest state reports Pointer Lock false.

`chapter-progress.png` at 02:12:02.572 shows PRESS ANY KEY TO CONTINUE.
Ordinary Space enters the cinematic, visibly confirmed by
`cinematic-visible.png`; Escape leads to the gameplay HUD in
`gameplay-before.png`. The immediate key captures precede their settled
transitions and are retained, rather than being mislabelled gameplay.

The first click at (255,524) shows Thrall's hover label; the second selects him.
`thrall-selected.png` shows Level 1 Far Seer, health 500/500 and mana 285/285.
Ordinary right-click (375,430), five-second hold/release, moves him from the
lower path to below the stone circle in `move-order.png`. Right-click
(220,480) moves him back left/down in `move-return.png`; `gameplay-final.png`
retains the settled position. The hut, stone circle, rocks and camera stay
fixed. This establishes meaningful player-controlled unit displacement.

Reviewed screenshot SHA-256:

- `thrall-selected.png`: `83131ed3f11cb44aa30abc2f3e2dc8e39b1343445067efbd12f769125d6c438f`
- `move-order.png`: `b0a7b6874e695c849abbba232c5af694a5d271f0e30e9646dfcc7dff433d3c09`
- `move-return.png`: `621b491c664d82e636539e5af797ad662a9d3b4a33ce6afc6c428aee15968e2c`
- `gameplay-final.png`: `0e605f4e934540c91bf7e3ae98d705688e38a595cee9c8dda8d13a2234253ab5`

Each state proves matching live host and owning render Worker `api: gl`,
`backend: webgl`. Trusted DOM input receipts and host right DOWN/UP 0x204/0x205
are retained. This does not claim an owning guest CPU input-consumption trace.
There were 55 commands, thirty shots, and no guest writes or clock forcing.

## Identity, resources and actual release

Prior Tiberian released at 01:58:34, next Antara at 02:03:50. Independent checks
found Antara PIDs 43751/43765 absent and no Chrome. Its old box expiry could not
fit the full grant plus margin. The user-authorized fresh no-environment box
`bx_d4htn3zt` was created with expiry **02:35:29.417 UTC**. Root owns its
lifecycle. Fresh PID/socket/display/disk/Puppeteer checks passed before
240-second transfer; remote 542-pin/HTTP preflight passed at 02:07:33.350,
before Chrome. Puppeteer 24.37.5 remains at
`/home/user/warcraft3-tools-20261008/node_modules/puppeteer`; do not delete the
adopted box or tools from this worker.

Ordinary quit completed at **02:15:53.697**, before the unchanged deadline.
Chrome exited 0, browser/server closed, streams 0; cleanup is complete. Its
errors list contains the three retained HTTP refusals above. At 02:16:07.465,
independent PIDs 33850/33868 were absent, no Chrome existed, sockets matched
the fresh baseline, all 542 pins were unchanged, and remote free space exceeded
2 GiB. All 67 actual files, 19,228,062 bytes, were copied and SHA checked.
Scoped run prefix removal at **02:16:07.994** is within the 90-second cleanup
grant. Actual sole remote release was posted at 02:16:16. No jobs remain.

Source, media, archives and overlay reuse immutable 0134/0135 hardlinks, with
no bulk local copies. Initial preparation mistakenly hardlinked the writable
preflight receipt and rerunning it propagated its new timestamp into the two
published bundles. Exact original bytes were recovered against sealed SHA
`a9aa48982091fcd98728e56c94961e3bb4aa9cd458777ead222a3303512f104d`;
the actual restored timestamp is **01:30:45.774** (the first board correction's
01:32 timestamp was wrong). Full 638-file and 582-file indices then passed
with zero bad hashes. The fresh receipt was unlinked and is independent.
`receipt-recovery.json` records this limitation and restoration. Source/media/
archives were unaffected. Fresh scripts use JavaScript only.

Projected floor checks reserve 96 MiB before preparation and transfer, and
actual retrieval bytes plus 32 MiB before copying. Coordinator cache/scratch
cleanup increased available local space to approximately 5 GB before runtime.
There was no observed floor violation in this phase. This is not continuous
local filesystem telemetry. No local browser, native run, build, benchmark,
per-frame capture or browser-time source analysis ran.

The coordinator's budget-mode instruction is honored: finish this scoped
evidence/commit and EXIT; no additional phases or lane refills. Root can review
the three movement landmarks and immutable artifact index, then integrate/push
the explicit documentation commit. This worker does not deploy or publish.
