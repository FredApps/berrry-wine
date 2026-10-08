# Tiberian parent paint and registered factory ownership

Sole worker `NEW-GAME-TIBERIAN-SUN-DEMO-20261006`, no subagents. Clean
isolated worktree `/home/user/wt-tiberian-campaign-recovery-20261008`, branch
`fix/tiberian-menu-pump-owner-20261008`, explicit base `a8e149a87`.
Prior `0f7ee1b41` and its branch are preserved. Shared HEAD/index/config are
untouched. Root integrates and pushes explicit paths; worker does not push.

## Proven parent10002 producer and repair

Original parent subclass57e790 ->580ac0 ->native dialogffff0004 really calls
ValidateRect at original58cadd/return58cae6. It clears the full299x202 update
rectangle and paint flag. Damage reappears afterward; ordinary validation is
not missing. Initial64 host invalidations target10003 only. A separate bounded
page renderer tree/queue/exposure forwarding trace records zero calls.

Scratch diagnostic module51e2b8 captures sixteen parent mutations. The writer
is original4887f7/return488807, primary surface Unlock vtable offset80:
Unlock ->dx_present ->paint_mark_visible_tree ->update_invalidate_full
->update_invalidate_rect. All sixteen original code spans match SUN.EXE.
After the guest and native painter clear10002, the same Unlock rebuilds full
damage with queue0. This is neither a posted paint nor a host renderer loop.

The legacy shared GDI surface branch is selected because the primary window
has a GDI surface and visible children. Exclusive DirectDraw already has a
separate canonical primary plus GDI overlay compositor; repeatedly exposing
its children produces the endless parent paint pump. Commit
`3f61a2e39d90d1e096ce3ada6fb880e9c37fb4f3` changes
`src/09a8-handlers-directx.wat` and adds
`test/test-directdraw-exclusive-paint-pump.js`. The real API/callback regression
fails before the fix, passes after, and verifies later damage and windowed
exposure still work. Native overlay pixel, cooperative-window, erase-callback
and parent-child order regressions also pass. Prior10003/ValidateRect(NULL)
repairs, fonts and original assets are preserved.

Full canonical remote build produces fresh module
`a048c45c538085b1335d6d36c507225b7fb7222c8e2161da597f990a34ada518`.
Ordinary reviewed New Campaign reaches first Peek0, original menu teardown,
real1000c "Tiberian Sun Demo Missions" dialog, then ordinary750ms Enter reaches
Titan loading. This is original progression beyond the persistent menu.

## Actual campaign COM failure and second repair

Only after the campaign dialog is visible is the deferred observer armed.
The owning throw is slot0/tid1, original6357ad ->699dc0, HRESULT80070057 at
_com_error object+4. All eleven retained original caller spans match. The
campaign caller63579c invokes40ec10: CoCreateInstance at40ec3d/return40ec43,
then OleRun and Westwood IID070f3290. CoCreateInstance for
`{55d141b8-db94-11d1-ac98-006008055bb5}` fails before those latter calls.
Startup80040154 and historical consoleEIP0 are not attributed as this fault.

The class is registered with guest factory146737968. The storage bridge
executes CreateInstance at original5f1490 on page shadow EIP0/ESP0 despite
the requesting Worker's valid ppv122679240. Its completed callback returns
80070057/out0. Original5f1492 reads ppv at ESP+18 after two pushes;5f149b
returns80070057 on NULL. Building the callback stack from shadowESP0 crosses
the unmapped guest address boundary. This is a distinct ownership defect.

Commit `f493338ea` changes `lib/storage.js`,
`src/09a7-handlers-dispatch.wat`, and
`test/test-cogetclassobject-owner.js`. Resolve-only registered activation now
returns its borrowed factory to the requesting CPU; ordinary guest
AddRef/CreateInstance/Release continuations own its stack and temporary
reference. No callback is manually invoked by the browser harness. The real
owner/shadow regression fails before, passes after, including exactE-40
stack, ppv/this, constructor yield, failure normalization and balanced refs.
Storage registry and paint pump tests pass. Full canonical build passes;
fresh module is
`ff3281348c7360d5eae35e43ac838a5725c7e2bcbce77ac88e9a05b104111303`.
127 remote source/build-tool hashes independently match the isolated checkout.

The original run advances through the first actual OleRun at40ec52 with a
non-null newly constructed object, then encounters another guest trap during
loading. API log exits at redirected CoCreateInstance entry are not completed
activation results: the following original OleRun is the progression evidence.
No campaign mission, unit command, gameplay, FPS or audio support is claimed.

Catch-only receipt in1227 attributes the new trap to owning slot0/tid1:
EIP/prevEIP00d88176, ESP00d88168, EBP30936648. Matching fresh moduleff3281
WAT indices1106/1108/11417 are decode_block/decode_run/run. Its bounded128
code bytes and512 stack bytes are repetitive frame/data words, not an original
SUN code span. This is an invalid execution target after the first successful
registered activation; the first bad control-flow transfer remains unowned.
Do not fix it by changing guest instructions or treating a decode trap as an
unimplemented COM method. Next work needs a bounded control-flow producer
receipt before this heap target. No source guess or blind replay follows.

## Evidence and lifecycle

Shared evidence is under `scratch/runs/20261008T1138Z-tiberian-parent-owner`,
`1140Z-tiberian-parent-renewal`, `1145Z-tiberian-damage-writer`,
`1154Z-tiberian-exclusive-candidate`, `1200Z-tiberian-exclusive-original`,
`1212Z-tiberian-campaign-owner`, `1216Z-tiberian-campaign-factory`,
`1222Z-tiberian-registered-original`, and `1227Z-tiberian-campaign-trap`
(each short suffix has the full20261008T prefix). Partial1136 preparation
failed before runtime and is recorded separately. Every runtime has its own
prefix,478 immutable runtime pins,29 aliases and independently reviewed images.
Original SUN SHA is
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`.
Sealed earlier0256/0321/1100 and other accepted evidence is untouched.

Root owns no-env `bx_57v6b8fr`, expiry12:36:50.001Z. Fixed limits declared
before each launch: transfer240s, browser300s, cleanup90s, aggregate1800s.
No deadline extension, additional agents, optimizer, guest selectors/registers/
RAM patches, forced empty pump, suppressed paints or swallowed errors.
Independent owned PID/Chrome/socket/hash retrieval precedes prefix deletion.
Final accounting and remaining trap details are retained with the run results.

## Reviewer correction: unsigned AddRef count

Root review correctly identified that reusing the GCO continuation must not
interpret AddRef's ULONG count as an HRESULT. A registered-only F+4 mode tag
now ignores that count before the shared continuation's HRESULT checks; the
following real CreateInstance result and Release balance remain intact.
The real owner regression returns80000001 from AddRef: it fails before this
correction and passes afterward through creation, yield and failure cases.
Storage registry and paint pump regressions also pass, as does the full
canonical build. Fresh module is
`d8d4096f957ed51cecab589b5a1ec7bf402336f13959ce0710faf2f7d3c68960`.
This is a build/test correction after the browser runs: original browser
evidence remains exactlyff3281, and no new browser was launched.

Separate `scratch/runs/20261008T1236Z-tiberian-addref-count` retains failing/
passing tests, source archive/patch, full canonical log,127 matching remote
source/tool hashes and retrieved module. Initial canonical attempt lacked
CLAUDE.md in the standalone build tree; the existing immutable root-files
archive supplied the dependency, and the retry kept its original deadline.
Root authorized one fresh no-env build-only box after57v6 cleanup/expiry:
`bx_sq2kkxku`, root lifecycle, expiry12:52:40.771Z. Both native build PIDs
are independently absent; no Chrome/crashpad or changed socket; prefix was
removed12:43:33.404 only after hash retrieval. Build completion was first
observed12:42:46.687 (exact process-exit timestamp unavailable); collection
and removal finished46.717s afterward. Root owns remaining box lifecycle.

Eight original browser walls total997.545s<1800, all below fixed300s limits.
25 reviewed images;10 sealed phase bundles contain8324 indexed artifacts.
The final independent hash check also includes three accepted earlier runs:
9914 hashes match, zero containment errors and zero missing own artifacts;
82 historical missing references remain outside this work. Shared HEAD/index/
config and accepted evidence are untouched. Source/docs branches are clean
after explicit commits; root integrates the listed source/test/doc paths.
