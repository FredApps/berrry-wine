# Comanche 3 DOS demo: native installer evidence

## Native full copy and generic rename repair, 2026-10-08

The fresh continuation on explicit base
`73e7025e696dda27fbe2c3ed36511b41aa04b9ee` reached 100% file copy and the
reviewed **Installation Complete** prompt. Ordinary Enter then failed with
**File not found: setup.exe**. This is a demonstrated DOS file-service gap,
not a timeout or an established interpreter bottleneck. The earlier corrected
3% run executed only235.9166seconds; it did not spend900seconds copying.

Passive original-media control captures actual DOS return `0540:4c81`, AH56h,
source `C:\C3DEMO\INSTALL.TMP`950891bytes, destination
`C:\C3DEMO\SETUP.EXE`, after the real close. The handler returnedfalse and
left the temporary record unchanged. Actual caller authentication:
INSTALL.BIN inner MZ053d/image05ed/originalCS0385 yields original `CD21` at
IP4c7f, returning4c81. The control stops deliberately after that call by a
bounded observer exception; no guest binary/register edit or CPU trap is
claimed. Receipt and original48byte span are in
`scratch/runs/20261008T0515Z-comanche3-rename-control/`.

The generic AH56 repair renames closed guest-created records on mounted C
within the same directory, retains exact bytes/identity, and removes the old
name. It refuses missing files, collisions, readonly/hidden/system records,
open sources, readonly corpus sources, other drives, wildcards and unsupported
directory moves. Existing basename lookup remains; there is no directory-tree
or host-write claim. Original DOS reference:
https://www.pcjs.org/documents/books/mspl13/msdos/dosref40/ (Function56H).

The real-handler regression fails before and passes13groups afterward;
synthetic native create/write/close/rename/open-old-fails/open-new/read/exit
passes all four interpreter variants on the temporary box. Existing temp-file,
EXEC environment/boundary/resident and MCB contracts, regenerated browser
bundle reproducibility, test tiers and whitespace checks pass. No interpreter
optimization or performance benchmark was made.

The repaired original installer now preserves actual SETUP.EXE950891bytes,
C3.EXE945297bytes and RESOURCE.RES55496696bytes. After reviewed100%/Installation
Complete and ordinary Enter, the wrapper successfully opens the installed
SETUP.EXE and reaches **Loading Setup ...**, then the reviewed graphical
**Testing Your CD-ROM Transfer Rate / Performing test, please wait** screen.
No input was sent to that wait screen. Final capture is black at the unchanged
wall cap; Setup completion/gameplay are unverified. All11 actual generated
records are retained through the supported file export, with named hashes in
`20261008T0520Z-comanche3-rename-repaired/installed-files.json`. No VM checkpoint
or game run exists. The captured installation blocker is repaired for root
review. Root's05:43UTC extra host-shadow case exposes the old corpus basename
after renaming a guest record that shadows it; root owns a fail-closed guard
and regression before main integration. Actual INSTALL.TMP has no host
collision. No additional worker runtime is authorized by that review.

Evidence: shared `scratch/runs/20261008T0505Z-comanche3-install-progress/`
(original full-copy failure and30second actual copying profile),
`20261008T0515Z-comanche3-rename-control/` (causal original request), and
`20261008T0520Z-comanche3-rename-repaired/` (repair/native tests/actual payloads).
Original media unchanged; CPU WASM remains91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf.
The profile's55.38% self samples in existsSync/readFileUtf8 identify cost in
the retained atomic input harness; no emulator performance cause is inferred.
The common1800wall/300guest grant deadline05:36:07.354UTC is never reset.

See [the scoped repair handoff](../../ops/handoffs/comanche3-install-progress-20261008.md)
for exact source/run identity, limitations, hardlink restoration receipts and
cleanup. Repaired883.85068wall/48.17718guest seconds/482426113dispatches,
ranOutOfTime=true/guestexited=false, normal clean child exit0. Eight original
rename transactions now preserve their actual payloads. Original+control+repair
guest total95.65664seconds<300. Retrieved116files73780681bytes with hashes;
independent ownedPIDs/groups absent/80pins/baselinesockets before prefix removal.
Cleanup90.514seconds exceeded90 by0.514seconds; initial cleanup92.332seconds
also exceeded90, both recorded. No paging/IVT diagnosis repeated, no FPS/audio
or public deployment claim. Continue from retained installed files, not another
installation or speculative snapshots.

This is the original Comanche 3 demo DOS media, distinct from Comanche Gold. Original directory: `test/binaries/win98-games-a-d/Commanche3-demo-SW`. INSTALL.EXE is 2,462 bytes (SHA-256 5a5ff6d376642d83ac9b049be952c64deb8898d09b593a0fb90083fed26e9cbb); INSTALL.BIN is 58,119,069 bytes (2bc752ed8feada4f33c78d73e6f036f935f6903af71513bb9fdeb808e138ccf8). No DOSBox substitution or installer autoanswers were used.

## Native probe, 2026-10-07

Source snapshot a2816e17664fa165520ad2e7b80cef7c3daa22d7; run artifacts are in `scratch/wt-diehard-20261007/scratch/comanche3-preparation/native-attempt1/` (identity, raw log/result, installer.png, cleanup and validation.json hash closure). Start 12:21:54.589Z, terminal 12:21:55.335Z; driver 2643693 and child 2643700 absent after cleanup, streams closed, original five media hashes unchanged.

The personally reviewed screenshot displays “Fatal error, insufficient conventional memory” and the wrapper's unknown-error message. That text is an observed installer error, **not proof of insufficient host or guest capacity**. INSTALL.BIN exited 1; its INSTALL.EXE wrapper subsequently exited 0. The supervisor PASS denotes clean harness termination only. No generated files, installer completion, game scene, player input, audio or FPS were established.

## Discriminating source finding

The trace loads INSTALL.BIN at PSP 019a, entry 01aa:0154. That child then opens C:\INSTALL.EXE, reads its six-byte header, seeks to 099e (the 2,462-byte parent's EOF), and receives zero-byte reads before the error. This identifies the wrong self-file lookup as an actionable lead; later extender support remains untested.

In tools/toyvm/dos.js, installEnvironment (around1176–1222) emits the environment variables, double NUL, count word1 and top-level C:\INSTALL.EXE path. EXEC AH4B (around4514–4628) reads only command-tail fields at parameter-block offsets2/4; it ignores the environment selector at offset0. The child PSP:2c is assigned the same fixed ENV_SEG (0060), retaining the parent's executable-name trailer. The same defect is present in origin/main c1ae54312dfe79fd3e667dbb02d70f61a42f2c2f at this audit.

A safe generic repair must copy the selected environment variables (zero selector inherits from parent PSP; nonzero chooses supplied segment), construct the executed child's canonical program-name trailer, allocate an owned nonoverlapping DOS block, and preserve parent bytes. It must not rewrite the global parent trailer or hardcode INSTALL.BIN. Existing memAlloc/mcbOwner/child termination ownership and load-only AL1 must be considered: ordinary AH4C frees child-owned blocks, while resident AH31 preserves ownership. Current mcbSync roots at the initial PSP, so child environment placement must be represented in memBlocks rather than an untracked gap.

Proposed discriminating regression: invoke real EXEC handling on synthetic parent/child files and parse child PSP:2c bytes; verify inherited/explicit variables, exact child path, parent immutability, nested EXEC, AL1 load-only, child exit cleanup, resident ownership, allocation failure rollback and nonoverlap with image/adjacent canaries. A child that opens its own environment trailer should read child bytes, not parent's EOF. Preserve this baseline failure before any repair; rerun the original installer only after focused tests and a runtime grant. No repair or retry is included in this finding.

## Private EXEC and MCB candidate, 2026-10-07 13:10Z

The isolated candidate now clones the selected environment for each child and tracks its ownership, preserves resident descendant images across ancestor exit, and corrects the MCB chain's next-data-segment boundary. The intermediate candidate exposed a second real issue: a resize rebuilt the next MCB header inside the environment's final paragraph, turning the intended child path into `C:\IZ`. The original installer filename-reader disassembly at CS:0287–02af follows PSP:2c, scans the double NUL, skips the count word, and calls DOS open normally. Source-derived environment reconstruction predicted that corruption; it was not a captured guest memory dump. An actual AH4A handler regression then reproduced it and passed with the boundary correction.

Final private `dos.js` SHA-256: `31758370d35247d65f2c66826eacfe67bbd0d6b4282bc46d7699a15cdc664613`, based on main `c1ae54312dfe79fd3e667dbb02d70f61a42f2c2f`. Twenty pure-JS actual-handler groups pass. Preserved controls show the wrong-parent path, COM allocation NaN, actual replacement-image overwrite of resident bytes, and environment corruption. The unchanged actual native `test-toyvm-dos-terminate.js` passed `SDT` on this final candidate in 710ms; its process group closed normally. These are scoped contracts, not a general DOS compatibility qualification.

The separately bounded original installer run started 13:10:19.195Z and closed 13:10:19.867Z. Driver2697860/child2697869 terminated, both streams closed, process group absent, original five media hashes unchanged. It now opens **`C:\INSTALL.BIN`**, passing the earlier self-file failures. The reviewed screen instead says **“Insufficient extended memory to run program”**, followed by the wrapper's missing `setup.exe` error. INSTALL.BIN exits1; INSTALL.EXE exits0. No files were generated. This is progress through native startup, not successful installation or gameplay; the new message does not by itself establish a capacity cause.

Evidence: `scratch/wt-diehard-20261007/scratch/comanche3-preparation/exec-environment/mcb-installer-ready/native-attempt1/validation.json` (SHA-256 `fe0b217eb2a6d6e7022189cad16c5016ade01fa12bd1cf3fc8536e897c83443e`) seals the original screenshot, result, log, identity and cleanup. `mcb-attempt1/receipt.json` and preceding immutable attempt directories retain positive and negative contracts. Runtime source pins SHA-256 `afc9c854c35481273476e9469ad7405b07d6caeff59bb28f2a40015e7bfad79a`. The production repair remains unmerged pending review. Next source investigation is the actual extended-memory query/allocation and error branch; do not inflate memory or bypass the installer based solely on its message.

## Native graphical installation, 2026-10-08

The earlier paging dependency is complete on main (`72e306790`, foundation
`4b0955e79`); see `ops/handoffs/toyvm-paging-complete-20261007.md`. This phase
used isolated base `329bb48d7f37f5071b722f7fe8a7eca3a6a72aea`, with no CPU or
DOS implementation changes. The fresh remotely compiled tailcall module is
`91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf`.

Evidence: `scratch/runs/20261008T0433Z-comanche3-install/`. On fresh no-env boat
`bx_2bg9dma5`, Node 24.18.1 / V8 13.6.233.17-node.50, AMD Ryzen 9 9950X,
the unchanged original INSTALL.EXE/INSTALL.BIN reached the graphical destination
prompt. Reviewed ordinary Enter accepted `C:\C3DEMO`; reviewed `y` accepted
the subsequent Folder Exists prompt. The final reviewed
`attempt2/screen-008.png` shows **File Copy, copying MAKEICON.EXE from C:\ to
C:\C3DEMO\, 3% installed**. This establishes native graphical installer
interaction and installation progress, not completion or gameplay.

The corrected execution ended normally at 04:48:39.651 UTC, within the original
04:48:54.095 deadline: 235.9166 execution-wall seconds, 165,404,857 dispatches,
16.51805 guest seconds, `ranOutOfTime=true`, guest not exited. No unimplemented
instruction, CPU fault, unhandled condition, bad selector or protected-transfer
stop was recorded. The installer advanced its source cursor from 414,127 to
2,621,525 and produced `setup.cd` (2 bytes), `install.lev` (1), and
`install.tmp` (41,472), plus the empty `00000001`. All four files are exported
with byte hashes; they do not constitute an installed game. `C3.EXE` and
`SETUP.EXE` are absent from the exported payload.

Two harness failures are retained honestly. Attempt0 stopped before guest
execution because screenshot encoding expected `source/node_modules/pngjs`.
The first actual run reached the destination and Folder Exists screens, then
stopped when a non-atomic input-file update exposed incomplete JSON. The retry
corrected command publication with temporary-file rename and a meaningful
partial-write regression; it retained the original overall deadline, reserving
15 seconds for final artifacts. No timer or guest-state bypass was used.

The first run's console still said Loading Install after its screen had become
graphical. A read-only inspector snapshot confirmed native VESA mode 101h,
640x480x8 and ordinary glyph drawing; actual screenshots, rather than console
text, identified the prompt. Inspector snapshots and paused/resumed receipts
are retained. They do not establish a CPU correctness blocker. No paging/IVT
diagnosis or implementation was repeated.

All original media and 79 transferred source/dependency/media pins were
unchanged. The CPU closure matches the earlier accepted source; the only
source-pin difference against final6 was `test/test-toyvm-paging.js`, which
was not executed here. Both actual runs used the same fresh module hash.
All driver/child PIDs and process groups were independently absent; browser
absent, socket list identical to the fresh baseline, streams closed. Retrieved
artifacts were hash checked before scoped prefix removal at 04:49:32.989,
53.338 seconds after the final terminal receipt. Root owns the temporary boat
lifecycle; lease expiry 05:11:20.138 UTC.

Exact absent local fixture directory:
`/home/user/wt-comanche-gameplay-20261008/test/binaries/win98-games-a-d/Commanche3-demo-SW`.
Its five media files were instead reused as immutable hardlinks from the
self-contained paging run's `original/media/`, verified against the original
receipt. Host lookup misses for archive-contained installer resources are
retained in `attempt2/execution.json`; these are not proven missing distribution
files, since the installer rendered its assets and began copying.

Next: execute the original installer with atomic ordinary input and inspect
every prompt promptly; predeclare a finite installation budget and milestones
for source-cursor and exported-file growth. Reach installation completion, then
launch the actual installed C3 executable through the dedicated DOS route.
Gameplay, player control, sound, save behavior and FPS remain unqualified.
