# Tiberian Sun: validation succeeds, damage returns

Task `NEW-GAME-TIBERIAN-SUN-DEMO-20261006`, sole worker
`codex:tiberian-paint`. Fresh isolated
`/home/user/wt-tiberian-paint-20261008`, branch
`findings/tiberian-paint-20261008`, explicit coordinator base
`0ab392bcd96b5ff565907fd3daf74ef8fd122be4`. Shared HEAD/index and
`wt-darkstone` are untouched. Root integrates/pushes. No engine repair,
native build/test, local browser, performance run, config change or deployment.

## Owning evidence

Self-contained runs:

- `scratch/runs/20261008T0232Z-tiberian-paint`: first observer watches parent
  `10002`, but the first repeated paint MSG targets `10003`. Zero paint rows
  and a 20,000-hook cap prove nothing about that target's default chain.
  Three inspected images show initial grey panel, complete menu, unchanged
  menu after campaign click. One malformed command lacks review fields and
  is refused before input; the corrected ordinary click is recorded separately.
- `scratch/runs/20261008T0237Z-tiberian-paint-target`: revised observer binds
  to the first actual post-anchor paint MSG, which is `10002` in this run.
  Two inspected images show the complete menu before/after ordinary click.
  There is no campaign or player-controlled gameplay.

The second run captures **18** of each matching paint-chain boundary:
original subclass caller `57fe7e` chains original parent `580ac0`; original
parent caller `580bed` chains native dialog marker `ffff0004`; nested
`ValidateRect(10002, NULL)` at original return `58cae6` succeeds and changes
slot1 damage from update1 / rect `[0,0,299,202]` to update0 / zero rect.
The native-dialog handler exit also observes the cleared damage. Subsequent
same-target entries again have full `299×202` damage. This demonstrates
validation followed by renewed damage, rather than a wholly absent default
chain or a region that never clears.

Four live 32-byte caller spans match immutable original SUN bytes in
`paint-authentication.json`. Native ValidateRect is nested beneath the native
CallWindowProc import frame (parent id2); the earlier CallWindowProc to guest
`580ac0` reports EIP redirection, not callback completion. The actual owning
show stack still contains `4f3f05,10002,58ca9e,0,4de732`.
Pump counts before its read caps are Peek269/Get268/Dispatch268, same
parent WM_PAINT. These are capped observations, not a complete six-second
count or proof that the pump cannot return.

The paint observer retains six distinct rows, 13,833 read bytes, about9.145ms
observer CPU, no error, then reaches its independent20,000-hook cap.
One unmatched exit is the activation boundary: the pump's Peek exit arms
painting before the inner paint observer sees that same exit. No pending
owning frame remains at close. Other Worker remains unarmed.
No target InvalidateRect record appears before that cap; internal WAT writers,
other-window propagation and activity after the cap remain unmeasured.
The renewing writer is **unknown**. Raw DLGPROC BOOL/retired guest return is
also unknown; zero DWL_MSGRESULT cannot establish FALSE. Static original
`58caa0` WM_PAINT branch calls ValidateRect then returns zero, but that listing
is not an instruction-retirement trace. No blanket prevalidation is justified.

## Observer contracts and identities

`paint-ownership-receipt.js` preserves original import receiver/arguments/result
and throws. It tracks nested import ownership, refuses changed slot/tid, retains
pending evidence on trap, and limits reads/rows/time/hooks/depth. It reads
WND_RECORDS/UPDATE_RECT/UPDATE_FLAGS/PAINT_FLAGS directly through the checked
region map. **Do not use update_rect_lt/rb as read-only probes:** both call
update_get_rect, which can clear empty-but-flagged damage. The pure reader
contract checks that exact case without changing any byte.

Local JS tests pass for nested frames, retained/renewed damage, non-target
nested calls, context mismatch, collector failures, flood/deadline limits,
forwarding, generated Worker actual-MSG targeting, real failed HTTP preflight
blocking Chrome, and generated browser final receipt preservation after both
owning-Worker and pointer cleanup failures. These are observer contracts,
not a failing-before/passing-after emulator repair regression.

Both runs retain accepted reference module
`bd5c84cae31e5fd8ecc27f4305fce607a203a67ef4fcfd1907e01d1e3bb08fc9`,
original SUN
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`,
all125 matching accepted build-source entries,478 runtime pins and29 aliases.
The module is retained, not rebuilt from current main. Only the private Worker
observer differs from the prior0150 runtime; media/host/module remain identical.
Actual served190 full/range hashes per run have zero drift; five optional shell
404s are recorded. Missing guest DLL notices remain `ole32.dll` and
`shell32.dll`, handled by existing built-ins; no new implementation is claimed.

Preparation encounters absent stale source path
`/home/user/wt-daggerfall-mount-20261007/icons/apple-touch-icon.png` and resolves
it only to a hash-identical sealed0150 member. `missing-original-paths.json`
enumerates every absent prior path and exact retained resolution. The original
stale paths are not recreated. Equivalent prepared bytes/archive are hardlinked;
rewritten Worker/receipts are independent. Prior0152's570 indexed hashes verify
unchanged. Never rerun receipt-producing tests against a sealed package.

## Cleanup and exact next action

Fresh no-env `bx_ug7uqu7b` expires **03:10:57.379 UTC**; coordinator root owns
lifecycle. Prior Warcraft33850/33868 were independently absent on predecessor
`bx_d4htn3zt` before acquisition. Fresh socket/no-Chrome baseline is retained.
First browser25595/25607 has original deadline02:37:27.490; ordinary quit and
independent02:36:06 release pass17 copied files/all478pins/exact sockets.
Second browser37451/37463 has original deadline02:42:56.391; ordinary
quit02:40:18.744 and independent02:40:29 release pass15 copied files/all478pins/exact
sockets. Both Chrome exit0, streams0, prefixes removed after copy/hash checks
within90-second cleanup. Transfers remain within240s. Retain
`/home/user/tiberian-paint-tools/node_modules/puppeteer` for root; no owned remote
jobs remain. Local free space5.3GB exceeds2GiB. FPS/audio unknown.

**Next:** add a reserved, actual-target `host.invalidate(hwnd)` owning receipt
with EIP/ESP/caller stack and direct damage snapshot, plus ShowWindow,
SetWindowPos and MoveWindow import boundaries. This exposes internal WAT
invalidation causes that bypass InvalidateRect. Authenticate the first writer
that renews10002 after ValidateRect and the10003 alternate target. Require
a generic real-callback regression demonstrating an incorrect writer before
changing behavior; then validate ordinary campaign input with the original
bytes. Do not repeat selector/click-delivery diagnosis or force a guest return.

Phase complete; worker exits after explicit-path commit. Main integration is
pending root review.
