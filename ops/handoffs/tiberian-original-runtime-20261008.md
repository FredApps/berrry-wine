# Original Tiberian Sun runtime after accepted dialog fixes

Worker branch `findings/tiberian-original-runtime-20261008` starts at coordinator
`b1d78b9f0`, preserving prior branch/commit `957571350`. Coordinator integrates
and pushes explicit paths. Shared HEAD/index and fixture symlink deletions are
untouched. No emulator source change or rebuild occurred in this phase.

Exact module `bd5c84cae31e5fd8ecc27f4305fce607a203a67ef4fcfd1907e01d1e3bb08fc9`
matches the retained accepted build and isolated worktree build. All 125 checked
WAT/build-source entries match the accepted source archive, including generated
region layout. Current committed host files replace the old runtime hosts;
private app/visible-selector registration and read-only Worker/Link observers
are explicit overlays. Original SUN remains
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`.
All 478 runtime pins and 29 aliases pass real HTTP preflight and remote hashes.
Immutable original-media archive is reused by hardlink; no fixture copy.

## Actual result and limits

Contained runs:
- `scratch/runs/20261008T0108Z-tiberian-original-runtime`: actual matching
  ordinary menu, one reviewed New Campaign click at page 306,455, unchanged
  menu, owning import receipts, source authentication and cleanup.
- `scratch/runs/20261008T0113Z-tiberian-focused-runtime`: revised focused
  observer, meaningful old-helper negative/current-helper positive, preparation
  errors, no second click, two startup/menu captures and deadline cleanup.

First launch 01:09:05 UTC; first ordinary quit 01:11:42.983 UTC. Screenshot
`ordinary-menu.png` shows all six original buttons. The ordinary reviewed
New Campaign click targets HWND 10004 and produces DOWN/UP in the page
receipt. `after-new-campaign.png` still shows the same menu. Campaign, mission,
player control and gameplay remain unqualified. Generic dialog regressions did
not establish the actual game cause or repair New Campaign.

The original DLGPROC reaches GetWindowLongA with return address 4dea72,
HWND 10002/index8, returning selector pointer 074ff488. Four captured 96-byte
DLGPROC spans at 4dea40 exactly match original SUN.EXE. The observed selector
value is 9. These broad receipts lack the owning callback message arguments;
9 is **not** measured as the WM_COMMAND1559 result. The observer consumes its
128-row cap after 5088 read bytes, without retaining the command branch.
Absence after this cap cannot prove missing delivery/callback/selector write.
Earlier immutable evidence already rules out missing UP/WM_COMMAND1559.

Original static code: shared prefilter 58caa0 compares message EDX with 110
at 58cb51; WM_COMMAND111 takes 58cd99, returns FALSE with ret8. DLGPROC then
gets HWND extra index8. WM_COMMAND low-word1559 selects 4deae5, writes1 to the
returned pointer at 4deae6, and returns FALSE at 4deaf3. This is static source
interpretation; that command branch has not been authenticated dynamically.
Offset4 reads returning 4dea40 are observed but do not prove the callback's
command arguments or return. Misaligned exploratory disassemblies are retained
as limitations alongside correct prefilter/DLGPROC listings.

## Focused observer and next execution

Final helper filters GetWindowLongA to authenticated caller4dea72/index8,
reads the owning DLGPROC HWND/message/wParam/lParam at API ESP+50, and retains
only WM_COMMAND111. Original prologue subtract34, saves three registers, and
pushes two API arguments plus return, giving the +50 offset. It filters other
GetWindowLong/SetWindowLong calls before expensive state/row emission. The
original 8-second/128-row/64KiB limits remain; no guest writes, CPU setters or
forced returns/commands are introduced. Import receivers/results/exceptions
forward once, all imports validate before installation, reads/getters/translator
and buffer boundaries are guarded, and cleanup preserves newer hooks.

Meaningful retained control: 500 identical mock owning paint callbacks consume
128 rows in the actual old helper and lose the later command. Final helper emits
0 paint rows and retains the later original-frame WM_COMMAND1559 selector
pointer in 3 rows/14186 bytes. Guard deadline, cap, original-throw, emit-error,
partial-install, newer-hook and actual generated Worker/Link init/arm/slice/close
checks pass. These are JS diagnostics, not an emulator/game repair.

Focused preparation attempted reuse by remote hardlinks. Its tar command first
omitted the dash in xzf following --unlink-first, then reported nonempty
directory unlink errors. Files nevertheless extracted; both old and focused
478-pin closures reverified before launch, proving the prior runtime unchanged.
The focused browser preserved the **original aggregate deadline** 01:14:05.572.
The reviewed-input reserve expired before a second click; no click was sent.
It closed by deadline, not by the later queued quit. Retained preparation script
is evidence of the failed attempt, not the recommended next transfer route.

For the next separately queued grant use `tools/tiberian-original-prepare.js`
to prepare a unique folder with the final helper. Its standard fresh-prefix
baseline extraction plus full source/host/module overlay avoids --unlink-first
and remote hardlink replacement. Re-run the JS-only prelaunch and generated
Worker/Link tests; identify current source/module/media hashes without rebuilding.
The generated control/transfer files need a fresh actual-cleanup lease and
transport matching that new grant; previous lease/commands are historical.
Obtain a current reviewed menu, then one ordinary New Campaign click with
`observe:true,watchHwnd:65540`. Verify actual HWND/geometry rather than historical
coordinates. Capture the callback arguments, returned selector pointer, subsequent
selector value and authenticated original caller bytes; handler exit alone is
not callback return. If selector1 is observed, follow the original menu consumer
and campaign opening; if absent, localize the measured forwarding/argument
boundary. No blind repeats or guessed game-specific fixes.

## Actual resource release

The grant was transfer240/browser300/cleanup90 after Antara then Crimsonland.
Independent predecessor31528/31546 absence/noChrome/baseline sockets/disk/TTL
checks passed. Transfer finished 01:09:01. Both browsers remained within the
same original aggregate deadline. Focused deadline cleanup01:14:05.572.
Independent01:14:42 verifies all four owned PIDs44534/44542/47293/47301 absent,
noChrome, exact baseline sockets, both478-pin hashes, Chromeexit0, errors0 and
streams0. All 22 actual diagnostic files copied/hashchecked; both owned prefixes
and partial focused archive removed. Sole remote slot released01:14:42 to
queued AlienShooter; coordinator owns bx_43wuxzx3 and retained Puppeteer,
expiry01:28:12. No native/build grant was used or requested.

Coordinator15:40 feedback explicitly requests immutable final evidence and
phase exit; fresh focused runtime follows AlienShooter/Antara queue. Full
new-game lane remains incomplete, with actual command-selector cause unmeasured.
