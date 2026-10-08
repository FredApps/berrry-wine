# Tiberian Sun: paint blocker repaired, campaign loading reaches a COM error

Sole worker `codex:tiberian-renewing-writer`, isolated
`/home/user/wt-tiberian-paint-20261008`, branch
`findings/tiberian-renewing-writer-20261008`, explicit base
`5da927c178e9d95e72f704e8f49ec7c08003a9aa`. Prior branch/044333171,
shared HEAD/index, old wt-darkstone and config remain untouched. Root integrates
and pushes. Source repair `6dd5f4bc7`; additional partial-validation regression
`8c84914c0`.

## Cause and repair

Run `scratch/runs/20261008T0251Z-tiberian-writer` retains original SUN
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b` and
accepted reference module `bd5c84cae31e5fd8ecc27f4305fce607a203a67ef4fcfd1907e01d1e3bb08fc9`.
All125 source checks/478 runtime pins/29 aliases match. Its actual first paint
MSG targets alternate10003. Independent reserved host.invalidate receipts
capture64 calls over116ms, each original EIP581010/ESP074ff020/return581022,
nested beneath InvalidateRect(10003,NULL,FALSE). All64 live32-byte spans match
the immutable original PE. The original subclass calls580c00. The subsequent
original ValidateRect(10003,NULL), return5812cc, reports success but retains
update1/paint1/full640x480. Broad hooks capture115 entries/114 exits for this
validation before their20k cap; their pending last entry is a cap boundary,
not proof of a trap. Writer budget is independent:64calls/10112bytes/about1.9ms,
no observer error. No10002 writer was captured; this does not retrospectively
identify the writer in prior0237. Host client-size return is unmeasured.

USER's NULL ValidateRect previously validated only a host-sized rectangle and
cleared the global main pending bit, leaving child paint requests. NULL must
consume the complete update region, independent of host geometry. The generic
repair clears that region directly and clears the window's paint flag when
validation consumes all damage. Explicit partial rectangles keep the existing
bounding-rectangle approximation and retain paint while damage remains.
No prevalidation, application special case, forced return or successful stub.

The expanded real-x86 regression in test-beginpaint-erase-callback fails before
the repair at "NULL ValidateRect consumes all damage even beyond current client
bounds" (actual1/expected0), then passes. An outer WM_PAINT calls nested
UpdateWindow on another guest callback, and both explicitly validate their own
window. It checks one nested callback, restored ESP/depth, consumed regions and
child paint requests, no second callback on clean UpdateWindow, later damage,
and partial-validation retention followed by complete explicit validation.
Existing BeginPaint erase/reentrancy/reinvalidation cases, parent-child paint
ordering, full canonical build and JS observer/preflight/generated Worker/final
receipt contracts pass. These are correctness checks, no performance claims.

## Original candidate runtime

Run `scratch/runs/20261008T0256Z-tiberian-validation-candidate` executes exact
source6dd5f4bc7 with freshly built module
`6adb43872bf4d48bbbbc09967b3e8e1baaf59be7d4ac6b1a414aad13d2a944e0`.
All125 candidate source checks/478 runtime pins/29 aliases match, and216 actual
served full/range hashes have zero drift. A stale audit assertion initially
expected the reference module; its candidate audit now obtains the expected
module from the candidate pins. Original fixtures/registration are unchanged.
Five optional shell404s and missing guest notices ole32.dll/shell32.dll remain
explicit in requests, original-identities and missing-original-paths receipts.
No guest-media missing path was observed or inferred from those shell failures.

Five ordinary screenshots were personally inspected. New Campaign at page
306,455/native317,213 is checked against the current10002/10004 hit-test.
The pump now reaches an empty result and shows new dialog1000c. The background
has no visible choice captions; an ordinary750ms Enter proceeds to the Titan
campaign-loading artwork and "Analyzing combat zone topography". Later the
game displays its own "unable to continue normally" error dialog, HWND10014.
The retained console records `[C++ throw] .?AV_com_error@@ obj0x074fefa8 at
EIP0x00000000` at02:57:01.075. This page-console EIP is not authenticated owning
exception context and must not be treated as the fault address. No gameplay,
unit control, FPS or audio qualification. No additional input after the error.

## Integrity and lifecycle

Build isolation mistake: inherited build/wine-assembly.wasm had four links,
and the build overwrote three historical module paths. Exact original bytes
were recovered from verified0251/prepared/build/wine-assembly.wasm, restored to
the shared inode, and the candidate detached. Full historical indexes40+518+
543+517 then verify zero mismatches. Correction and audit receipts are retained;
no historical receipt/index was rewritten. Equivalent immutable package bytes
and baseline archives are reused by hardlink; new receipts and Worker are
independent. Local free space remains about5GB, above2GiB. No local browser,
heavy benchmark, public hosting, source config edit or additional worker.

Existing no-env temporary bx_ug7uqu7b had sufficient lease through
03:10:57.379 UTC; root owns lifecycle/Puppeteer at
/home/user/tiberian-paint-tools/node_modules. Actual predecessor37451/37463
absent/noChrome/baseline sockets verified before0251 acquisition. First browser
52082/52094 quits before original02:55:34.544 deadline; independent02:51:45
checks absent PIDs/noChrome/exact sockets/all478pins,15 retrieved files, prefix
removed. Candidate predecessor52082/52094 verified absent before acquisition;
63453/63465 quits02:58:31.771 before unchanged03:00:58.295 deadline. Independent
02:58:52 verifies absent PIDs/noChrome/exact sockets/all478pins,21 retrieved
files and prefix removal. Both Chrome exit0/streams0/cleanup errors0; transfers
within240s and cleanup within90s. No owned remote jobs remain.

**Exact next action:** integrate the validated generic repair, then prepare a
separate bounded observer reserved for the campaign-loading COM failure:
authenticate original calling bytes, owning callback/thread/EIP/ESP, the first
failing HRESULT and exception object around the _com_error throw. Start from
the now-working New Campaign→ordinary Enter route using candidate module6adb,
with original media unchanged. Do not return to selector/menu-paint diagnosis,
infer EIP0 as the fault, dismiss/override the failure, or claim mission gameplay.
Root review/integration/push remain pending; this substantial phase is complete.
