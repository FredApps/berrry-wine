# Warcraft III Prologue: guest OpenGL software control

Worker `GLD3D-WARCRAFT3-SOFTWARE-20261008`, sole worker, isolated
`/home/user/wt-warcraft3-software-20261008` on
`findings/warcraft3-software-20261008`, explicit base
`70a8aa311030eb59808939a6dc942daa5ed6d64e`. Shared HEAD/index untouched.
Root integrates and pushes the explicit commits; worker does not publish.

Fresh software gameplay, Thrall selection and two opposing ordinary move
orders are reviewed by this worker. Coordinator review/integration is pending.
FPS, audio, combat and campaign completion are unknown. No engine repair,
guest-state write, clock forcing, benchmark or native build was needed.

Evidence is in the shared checkout's self-contained
`scratch/runs/20261008T0400Z-warcraft3-software-runtime/`.
The reference source is `f62ab3c9f1223ab47cf623470f6343d508257878`, module
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`.
This is an execution of the retained accepted reference, **not a current-main
build test**. All 542 source/module/media pins and twelve original registered
media paths are retained from the reviewed WebGL run. Only the helper overlay
changed, in `e68d9593f`: explicit software selection, matching host and owning
OpenGL endpoint checks, software's predeclared 900-second deadline, absolute
input refusal when the latest receipt has Pointer Lock, and refusal to rewrite
a hardlinked preflight receipt. Backend tests reject missing, closed, mixed,
wrong-query and fallback endpoints on both backends; review/input/release
contracts and local/remote HTTP preflight passed.

## Reviewed route

Chrome starts at **04:00:55.000 UTC**, deadline **04:15:55.000 UTC**,
`?app=warcraft3_demo&debug&gl-renderer=software`, guest Worker mode,
1024×768 viewport. Main menu, hover and five-second DOWN/UP at (594,327),
trusted A/B/C keys, Create (228,391), Select (226,542), Campaign (593,365),
and Prologue (473,373) follow the original route. First long clicks often only
highlighted controls; second clicks followed actual image review. Every image
used for absolute input reports Pointer Lock false. Screen pixels establish
targets; the software presentation is not the prior zero-rectangle WebGL canvas.

`map-loading.png` shows Chapter One: Chasing Visions. `chapter-progress.png`
at **04:07:01.117** shows PRESS ANY KEY TO CONTINUE. Ordinary Space was held
for 2000 ms. Its immediate `cinematic.png` is a black transition, not gameplay.
The next `cinematic-visible.png` at **04:08:49.346** already shows the world
and full gameplay HUD; its filename does not establish a cinematic. Escape
was therefore not sent into an already visible gameplay HUD. This is an
observed difference from the previous WebGL route, not a forced skip or a
claim about why the transition completed. No blind route script ran.

After separate hover, first left click (255,524) shows Thrall's label; the
second selects him. `thrall-selected.png` at **04:12:26.436** shows Level 1
Far Seer, health 500/500, mana 285/285 and a selection circle. Ordinary right
DOWN/UP at (375,430), held five seconds, moves him from approximately
(250,530) to (370,430) below the stone circle in `move-order.png` at
**04:12:37.045**. Right DOWN/UP at (220,480) moves him left/down to approximately
(220,480) in `move-return.png` at **04:12:47.899**. `gameplay-final.png` at
**04:14:30.715** retains that return position. Hut, stone circle, rocks and
camera remain fixed. This establishes player-controlled unit displacement.

Every movement state has matching live host and owning render Worker
`api: gl`, `backend: software`. The exact pinned `gl-compat.js` software branch
returns before WebGL context creation; the pinned `gl-render-worker.js` uses
the producer's WAT software front for presentation. Chrome's SwiftShader flag
and the toolbar's default WebGL label do not constitute the backend proof.
Trusted DOM inputs and host right DOWN/UP messages 0x204/0x205 are retained;
owning guest CPU input-consumption tracing was not collected.

## Resources and release

Fresh no-environment boat **bx_mw27w2n4**, expiry **04:38:09.763 UTC**.
Root adopts lifecycle; worker leaves the boat and Puppeteer 24.37.5 at
`/home/user/warcraft3-software-tools-20261008/node_modules/puppeteer` available.
No retired Antara box was used. Fresh no-Chrome/socket/display/disk checks
passed. Immutable budgets: transfer ≤240 s, browser ≤900 s, cleanup ≤90 s,
with lease margin checked before transfer. Transfer hashes and remote
542-HEAD/8-full-GET/range/404/drain preflight passed at **04:00:46.156**, before
Chrome. Local projected floor reserved 96 MiB and stayed above 2 GiB.

Ordinary quit at **04:14:42.001** closes browser/server, Chrome exits 0,
streams pending 0; 28 screenshots total. Independent **04:14:43.055** check:
owned PIDs 33664/33682 absent, no Chrome, exact baseline sockets, all 542 pins
unchanged, remote disk above 2 GiB. All 63 actual files (18,575,473 bytes) were
retrieved and SHA checked before owned-prefix removal at **04:14:43.577**,
within 90 seconds. Root owns the remaining boat/tools; no worker runtime jobs
remain. The three retained shell HTTP refusals are exactly `api/auth/user`,
`test/binaries/tlbs/stdole2.tlb`, and `test/binaries/tlbs/stdole2.tlb.part000`.
No registered Warcraft media paths are missing.

Static source, media and archive hardlinks reuse immutable inputs; receipts,
scripts and build outputs were never hardlinked for writing. No sealed prior
run was rewritten. Local browser/heavy performance work did not run. The first
contract attempt caught a missing move Pointer Lock guard and was corrected
before preparation; an attempted nonexistent lifecycle-test path failed, and
no lifecycle test pass is claimed. Commit initially lacked Git author identity;
the final scoped commit used command-local Codex identity without config edits.

Root can review the selection/move/return/final images, contained hashes and
source/module/backend identity, then integrate the helper and findings commits.
This phase ends here; no extra gameplay, benchmark or new-game lane is started.
