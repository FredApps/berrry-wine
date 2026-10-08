# Antara Win16 callback observer — source/JS phase

Task: `NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006`. Fresh continuation of
`433437c26`; prior branch is preserved. New isolated branch
`findings/antara-win16-callback-20261008` starts at origin/main
`df6b4c3a9a7cc2b3355ab620cf9f609cd25958bd`. Shared root HEAD/index unchanged.
No subagents, native suite, build, browser, transfer, provision or remote call.

The generic client-coordinate repair is accepted. The original ordinary run
`20261008T002459Z-antara-client-origin-install` produced correct DOWN client
`408,145` but did not advance installation. The callback/application cause
remains unmeasured; this phase does not justify a production correction.

## Source boundary

`src/09e2-win16-dialog.wat` calls shared GetMessageA directly from its modal
pump, then `win16_mouse_input_start`, then `win16_dlg_deliver_message` and
`win16_dlg_route`. It does not call USER.114 DispatchMessage. Existing Win16
marker `CA16A9EB` reports the routed HWND/message/wParam/lParam/dialog/queue
count **before** callback entry. `win16_enter_wndproc` constructs a Pascal far
frame and enters the application, accounting for its thread and DGROUP.

Existing marker `CA16A9F0` reports a subsequent NE imported API with its real
linear return address and twelve Pascal argument words. `CA16A9EF` reports
the API handler's exit, not the callback's RETF. A following authenticated
application API caller frame can establish consumption; absence cannot prove
non-delivery. Successful callback entry/return has no existing trace marker.

The new tool uses these existing markers rather than the Win32-specific
Tiberian observer. It wraps owning Worker imports before instantiation and
preserves their receiver, return, exception and original call count. On first
owning left-button DOWN it enables only existing `set_win16_trace`, then
restores the pinned trace-disabled baseline after eight seconds. It does not
set registers, execute another CPU, force controls, alter returns or patch
guest bytes. Each input route and selected subsequent API gets a read-only
owning-register/segmented stack/frame/caller-code snapshot; PtInRect includes
its actual rectangle. Caller bytes require authentication against original
relocated NE segments before interpretation.

Only slots 0 and 1 are observed. Per Worker: 128 rows, 32 KiB memory reads,
eight seconds; DOWN and UP each reserve half of both caps. Paint is filtered
before register or memory reads, including nested DefWindowProc paint calls.
Idle delivery clears the input context. Limits and incomplete frames are
explicit in the receipt. Trace instrumentation changes execution cost during
the bounded window; this is diagnostic evidence, not a performance run.

WorkerLink has no generic `t:'log'` handler. The private matching link overlay
stores a structured `antaraWin16Receipt` on the actual owning link and logs
only a short summary. The driver saves full receipts alongside normal scene
captures, avoiding the 1600-character console truncation.

## Prepared identity and checks

Preparation reuses the immutable original 503-pin archive by hardlink:
SHA-256 `8007a9b5a3f1fb05a9ef8b861994ffeb936fdd1542688e2241c591d878420031`.
All members were rehashed against the retained manifest. Runtime source is
`f62ab3c9f1223ab47cf623470f6343d508257878`; full canonical build/paging pass
are predecessor evidence. Module is
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`.
This is not a fresh current-main build qualification. All 42 original media
pins remain unchanged. Two explicitly pinned private JS overlays are served;
original raw Worker/WorkerLink remain in the baseline archive. Final manifest
contains 505 pins, including rewritten harness files and both overlays.

`node test/test-antara-win16-callback.js` passes framing, marker-valued data,
owning snapshots/PtInRect, 1000 paint routes plus 500 nested paint calls with
zero heavy reads, separate release budgets, row-cap release survival, deadline,
original forwarding/error/restore, generated Worker syntax and the actual
WorkerLink receipt handler. Root's lifecycle review is addressed: deadline
checks surround every getter, buffer access and translator; expiry inside each
boundary stops further reads. All imports are validated before hooks change,
cleanup preserves newer hooks, and trace-flag restore failures are retained.
Those four regression cases, test-tier membership and timeout checks pass.

Real HTTP preflight uses the unchanged strict asset handler over authenticated
archive bytes in a memory-backed filesystem, avoiding physical fixture copies.
505 final pins, 535 source/fixture/alias HEADs, five full GET SHA checks
(module, Worker, WorkerLink, private registry, original SETUP), range, exact
optional 404 and stream drain all pass. No browser or guest runs in this test.

## Next granted phase

Durable preparation: root `scratch/runs/20261008T0045Z-antara-win16-callback-ready`.
Read `READY.json` and `preflight.json` for overlay identities and bounds.
Remote request is 240 seconds transfer, 120 browser, 90 cleanup reserve, after
Tiberian actual release. No grant is assumed. Read the sandbox skill before
remote work. Independently check predecessor driver24552/Chrome24564 absence,
no Chrome, socket baseline, lease TTL and disk floors; Tiberian released
`bx_c9he3835` at 00:36:51, expiry01:03:26.516, with Puppeteer25.7.0 retained
under `/home/user/tiberian-tools-20261008/node_modules`.

Only after root grant and those checks, create scoped
`remote-authorization.json` containing fresh `at`, actual `box`, `basis`,
`cleanupVerified:true`, and `puppeteerNodePath`. All generated remote methods
reject missing authorization. Transfer has an overall 240-second deadline,
bounded child operations and a fresh prefix. It extracts the accepted archive
into `/home/user/antara-win16-callback-20261008`, applies only named overlays,
then verifies all 505 final pins. Exact commands:

```sh
node /home/user/wine-assembly/scratch/runs/20261008T0045Z-antara-win16-callback-ready/transfer.js
node /home/user/wine-assembly/scratch/runs/20261008T0045Z-antara-win16-callback-ready/control.js launch
```

Use the driver's ordinary scene-reviewed mouse/key controls. Review the actual
original Main Menu, click visible Install, wait beyond eight seconds, capture
full owning receipts, then inspect any new scene and continue normal setup if
it advances. Do not repeat a page-only packet diagnosis. Authenticate observed
NE caller spans before naming application branches or any generic defect.
If a contract defect is proven, implement the generic correction and regression
before claiming ordinary installation, launch or controlled gameplay. Preserve
raw captures, source/module identities and cleanup; publish runtime result last.

Installation, callback entry/return and gameplay are still unqualified. This
source phase is complete; fresh runtime continuation is pending the root grant.
