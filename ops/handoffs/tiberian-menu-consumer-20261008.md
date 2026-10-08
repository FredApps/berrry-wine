# Tiberian Sun: repeated dialog paint in the earlier show pump

Task `NEW-GAME-TIBERIAN-SUN-DEMO-20261006`, worker
`codex:tiberian-menu-consumer`. Reused isolated worktree
`/home/user/wt-darkstone-refill-20261007`, new branch
`findings/tiberian-menu-consumer-20261008`, explicit base `a2ae61094`.
Prior `findings/tiberian-focused-command-20261008` / `04922c7c6` is preserved.
Shared HEAD/index and existing fixture deletions are untouched. Root integrates
and pushes. No production repair, rebuild, local native/browser/perf run or deploy.

## Actual boundary

Self-contained runtime evidence:
`scratch/runs/20261008T0152Z-tiberian-menu-consumer-runtime`.
Executed host/observer source is `e13aa2e4b12086f6cbfb786f81e09760c025c221`,
accepted reference module
`bd5c84cae31e5fd8ecc27f4305fce607a203a67ef4fcfd1907e01d1e3bb08fc9`,
original SUN
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`.
All125 accepted build-source entries,478 runtime pins and29 aliases match.
Reference build is not a fresh build of current main.

Three reviewed screenshots remain the six-button menu. One ordinary reviewed
New Campaign click at page306,455 passes a current read-only renderer hit-test:
parent10002, child10004, native point317,213. Original UP precedes the exact
GetWindowLongA caller4dea72/index8/args10002,111,1559,10004 anchor. Pointer074ff488
is9, then1 on the first subsequent pump boundary. It is not polled again.
This reuses the already-established command contract as a phase anchor.

During the approximately6-second post-anchor window, slot0/tid1 reports
**236 PeekMessageA returns1,236 GetMessageA returns1 and236 DispatchMessageA
handler exits0**, all for HWND10002 / WM_PAINT000f / wParam0 / lParam0.
MSG samples include time and point; grouped counts intentionally omit those
changing fields. Five rows,33048 read bytes, no observer errors or caps.
Reserved scan/teardown budgets remain unused; no empty result, DestroyWindow
or new-dialog entry is observed during this window. Worker1 is unanchored with
48 metadata bytes and no pump records. These are bounded negatives only;
Dispatch handler exit does not prove a guest callback returned.

Four actual32-byte API caller spans match immutable original PE bytes.
The owning stack is **not** the anticipated58cdb5/4de743 consumer-loop frame.
All three pump samples have frame base074ff434 and words at+44..+60:
`4f3f05,10002,58ca9e,0,4de732`. Original aligned functions establish:

- 4f3ee0 calls562830 at4f3f00, returning4f3f05; its saved ESI precedes58ca9e.
- 58ca80 calls ShowWindow and SetForegroundWindow, then4f3ee0 at58ca99.
- The menu calls58ca80 at4de72d, returning4de732, **before** its4de73e
  call to58cdb0 and4de9dd selector comparison.

The original relative-call bytes are independently decoded and checked in
`original-pump-authentication.json`. Intermediate call bytes are static original
PE evidence, not additional live-code snapshots. Captured live stack words
authenticate the earlier show-pump frame; they do not establish retired returns.
The raw observer's expected-return labels are retained and explicitly fail in
derived authentication. No consumer or campaign progress is claimed.

## Paint contract and next action

Accepted source `src/09a5-handlers-window.wat` retains update damage for
application-owned/subclassed windows during GetMessage and removing Peek.
Only unsubclassed WAT-owned non-main controls are prevalidated. PM_NOREMOVE
leaves damage. Dispatch preserves a subclass's ownership. DefWindowProc's
WM_PAINT clears update/paint state after its default paint work.
`src/09c3a-dialog-runtime.wat` already clears update/paint state for an
**unhandled** DLGPROC WM_PAINT in `dialog_proc_result`; a handled result returns
before that fallback. A blanket missing-dialog-validation fix is unjustified.

The existing generic regression in `test/test-parent-child-paint-order.js`
explicitly checks that a subclass which never validates retains damage,
whereas CallWindowProc to the native painter validates and a second UpdateWindow
does not repaint. It was inspected, **not executed** in this no-native/build
phase. `test/test-beginpaint-erase-callback.js` separately checks that BeginPaint
validates and EndPaint preserves newer invalidation. Repeated WM_PAINT alone
does not distinguish failure to chain/validate from legitimate reinvalidation.

Next prepare a separately reviewed bounded owning paint-validation observer,
anchored to the established selector1 and actual4f3ee0/show frame. Reserve records
for the original subclass/parent/native-dialog paint chain, DLGPROC return/default
epilog, BeginPaint/EndPaint/ValidateRect and renewed InvalidateRect damage.
Measure who owns the repeated update before proposing a generic repair. Any
repair needs a meaningful generic regression and root native/build grant.
Do not repeat delivery/selector investigation, replay clicks or force returns.
Campaign, mission and ordinary gameplay remain unqualified.

## Source review and validation

Source commits: `c0ba46fa4` observer/preflight, `589e498d3` post-selector anchor
and invalid GetMessage handling, `d19baa0b6` immutable-byte reuse,
`e13aa2e4b` current-target refusal and capture bounds, `fa3ae7fdd` target tests.
Root early43:36 review prompted pre-click isolation and GetMessageffffffff
MSGnull; final46:48 grant plus48:27/57:58 package review precedes execution.
Generated Worker/Link init/arm/slice/anchor/first-empty/close and forwarding tests
pass against the actual final0150 package. Pre-click5000 paint/empty calls spend
no post-anchor rows; post-anchor5000-message flood retains first-empty/Destroy/
dialog records within64KiB/96rows/200ms/one8-second deadline. Errors, bounds,
deadline, restoration and original forwarding/throws are tested.

Checked sequential JS preflight gates the actual generated browser launch.
A real mandatory HTTP404 and a failed/expired preflight prevent the Chrome
launch callback; generated wrong-child/missing-point cases refuse input.
Actual remote checked preflight at01:54:21.541 passes507HEAD/5GET/range **before**
Chrome acquisition. This corrects the prior shell-continuation ordering error.
Actual190 full/range producer hashes show zero source/media/module drift;
five optional shell404s are expected. Client consumption is unobservable.

Prepared0144 and0148 are separate sealed, source-only historical packages;
0150 is the final preparation. Immutable equivalent bytes are hardlinked;
rewritten Worker/Link are independent files. A full-copy preparation refused
before allocation when its projected floor failed. Verified hardlinks allow
preparation with archive/copy/32MiB transport allowance above2GiB. Runtime uses
hardlinks to0150,8-shot/16MiB screenshot caps,24MiB actual retrieval cap and
75KiB transfer chunks. No evidence deletion or mutable-worktree deduplication.

## Actual cleanup and handoff

Antara released bx_jk5sz7qx at01:51:18. Independent01:52:26 verifies prior
22152/22164 absent/noChrome/exact fresh socket baseline/free49.6GB and expiry
02:16:47; local projected32MiB floor2453MB. Transfer01:53:26–01:54:09 stays
within240s, using normal baseline strip extraction and overlay, no --unlink-first.
Browser01:54:21–ordinary quit01:57:35.113 stays within original01:59:21.455
deadline. Chromeexit0/errors0/streams0. Independent01:58:06.671 finds34672/34701
absent/noChrome/exact sockets/all478 pins unchanged. All17 actual artifacts are
copied and hashchecked before prefix removal01:58:06.796, within90s cleanup.
Board release01:58:34 hands sole remote to root/queued Antara then Warcraft.
Root retains box lifecycle and Puppeteer; do not delete it. Worker has no
browser/server/native/build/remote jobs. Final sealed result/index and findings
commit are recorded in runtime evidence; root owns main integration/push.
