# Tiberian Sun: authenticated New Campaign selector, next consumer boundary

Task `NEW-GAME-TIBERIAN-SUN-DEMO-20261006`; worker
`codex:tiberian-focused-command`. Isolated worktree
`/home/user/wt-darkstone-refill-20261007`, branch
`findings/tiberian-focused-command-20261008`, explicit accepted base `b095c5def`.
Prior `94e388e5d` branch is preserved. Shared HEAD/index and pre-existing fixture
deletions are untouched. Root integrates/pushes; worker does not push main.

Source preparation commit `b4acd98129825689b160192e0664625823041e2a` changes only
the diagnostic preparation's mandatory validated unique prefix and adds its
meaningful invalid-prefix/stale-path/normal-extraction test. Root reviewed it
01:26:21 before remote work. Accepted final selector helper is unchanged.
No engine change, rebuild, native execution, forced guest state/input or deploy.

## Actual result

Self-contained evidence:
`scratch/runs/20261008T0126Z-tiberian-focused-command`.
Original ordinary New Campaign click306,455 from reviewed `ordinary-menu.png`
targets HWND10004. Owning command callback authenticates args
`[0x10002,0x111,1559,0x10004]` at APIESP+50, original GetWindowLongA caller4dea72,
extra-index8 returning pointer074ff488. Its value9 then becomes1 at
01:29:41.123 UTC. Three32-byte caller spans and one96-byte DLGPROC span match
original SUN bytes. Actual parent forwarding is original57eec7→580ac0 then
580bed→nativeffff0004→originalDLGPROC4dea40. This rules out missing command,
wrong measured args and an absent selector write for this click.

The selector-change row reports slot0/tid1, EIP56291b/ESP074ff41c. Original
aligned block56291b follows DispatchMessage and calls PeekMessage at562928.
This is a coherent owning import receipt, not an instruction-retirement trace
or proof of outer pump return. All three reviewed screenshots still show the
same six-button menu; the later capture is about65 seconds after the command.
Campaign/mission/player control/gameplay remain false.

Main observer8rows/65536reads stops at read cap after selector1. Worker1 has
0rows/48reads, no error. Callback return and later consumer/teardown are not
measured by handler-exit rows; no absence after cap is a negative game result.

## Original consumer and concrete next action

Static original menu entry4de670 initializes stack-local9 and stores its pointer
using SetWindowLongA(hwnd,8) at4de6d1. Its loop calls58cdb0 at4de73e; that calls
message pump562830, which keeps processing until PeekMessage reports empty.
Only after the pump returns does4de9dd compare the selector with9. Non9 exits
through58c960 (DestroyWindow import caller58c976) and returns the selector.
Matched relative caller4dbf4b selects return1 via jump-table index2 at4dcdc0,
target4dbf8a. Static continuation at4dbfc0 creates resource94/DLGPROC4dce30.
These listings are original-code interpretation, not observed campaign progress.
Retained exploratory listings and incorrect heuristic interior entry are labelled.

Next worker should prepare a bounded JS-only owning observer for the562830 pump
after selector1: GetMessage/PeekMessage actual return+MSG, DispatchMessage
caller/return boundary, and reserved records for DestroyWindow/new-dialog creation.
Keep counts of repeated messages and sample the first empty queue result without
spending64KiB repeatedly sampling an unchanged selector. Authenticate original
caller/stack frame before saying the outer consumer resumed. Root must review
substantive diagnostic changes before the next separately queued runtime.
If the pump continues delivering paint, measure source/validation contract and
build a generic meaningful regression before proposing a production repair.
Do not infer paint starvation from this run alone. No repeat click/Enter was sent.

The two-game pipeline remains active under root; Antara's next action is its
reviewed reserved DOWN observer phase, and Warcraft III is queued after this
actual release. Tiberian's phase is complete as an investigation, not qualified
gameplay. Root owns task scheduling and main integration.

## Identity, tests and limits

Accepted module:
`bd5c84cae31e5fd8ecc27f4305fce607a203a67ef4fcfd1907e01d1e3bb08fc9`.
Original SUN:
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`.
Exact Worker/Link/helper/host/archive hashes are sealed in browser-pins.json,
source-match.json, preparation.json and final artifact-index.json. All125
accepted WAT/generated-layout entries and478 runtime pins/29aliases verify;
ordinary Worker backend, 512MB memory, Chrome151.0.7922.108. No alternate backend.
Immutable baseline and accepted build-source archives are hardlinked; private
fixtures are contained in baseline rather than copied. Full matching overlay
and actual received artifacts are local.

Generated Worker/Link init/arm/slice/close, original forwarding/throws,
guard/deadline/cap/emit-error/cleanup tests pass. Actual old-helper 500-paint
negative exhausts128rows and loses command; final emits0paintrows and retains
1559. Fresh-prefix test rejects traversal and stale control/runtime paths,
and asserts standard baseline/overlay extraction without --unlink-first.
Matching local HTTP passes before launch; corrected remote matching HTTP passes
507HEAD/5GET/range/404/drain. Actual184 served full/range producer hashes match
the sealed source/media/module; five expected optional shell404s cause no
runtime errors. Client consumption is not observable.

Ordering limitation: an extra remote preflight queries every plan path, including
optional unpinned build-info.js, and fails404 at01:29:09. The shell command
continues to launch at01:29:10 despite that failure. Corrected sourceHashes+
aliases preflight passes01:29:20, before input but after launch. This misses the
requested fresh remote-before-browser ordering. Keep preflight-order-limit.json;
next control must make any preflight failure prevent launch. Local matching
HTTP and remote478-pin verification passed before launch; no restart occurred.

## Actual cleanup and release

Grant240transfer/300browser/90cleanup after Antara actual01:27:28release.
Independent01:27:44 confirms predecessor22545/22567 absent, noChrome, exact
fresh baseline sockets, free49.7GB; box expiry01:53:20 fits full budget+margin.
Transfer01:28:05–01:28:48 verifies478pins/29aliases using fresh normal extraction.
Runtime01:29:10–01:31:04.295 stays within original01:34:10deadline.
Ordinary quit: Chromeexit0, errors0, streams0. Independent01:31:12 checks actual
driver34662/Chrome34674 absent/noChrome/exact sockets/all478pins unchanged.
All15 actual files copied/hashchecked before scoped prefix removal01:31:12.442.
Sole remote released01:31:26 to root/queuedWarcraftIII; board time typo corrected
01:31:31 to the actual cleanup receipt. Root adopts bx_qms4q3z7 lifecycle and
retained Puppeteer. Worker owns no browser/server/native/build/remote job.
