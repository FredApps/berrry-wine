# Comanche 3: temporary files and interrupt word returns

The isolated worktree `codex/comanche-ah5a-20261007` starts at origin/main
`b7cdb5fd572c97f655965399b4b51d38ec9331c4`. It preserves review commits
`dea9b6e0` then `f4521402` exactly as cherry-picks `8844ab9b` and `1c6897e7`.
DOS source remains SHA-256
`113e1f801420d7fdee4477456bc0068baa728c9a04e4eba26f7c8a0d81dc8ad0`.
AH5A creates a unique in-memory file and returns a coherent read/write handle;
growth and truncation update other handles without changing their positions.
Unsupported nonroot directories fail explicitly. No capacity was increased.

## Authentic accounting defect

The original installer media hashes are retained in
[the evidence receipt](comanche3-memory-evidence-20261007.json).
INSTALL.BIN SHA-256 is
`2bc752ed8feada4f33c78d73e6f036f935f6903af71513bb9fdeb808e138ccf8`.
The original inner MZ starts at file offset `053d`, its image at `05ed`;
original CS `0385` gives code at `05ed + 3850 + IP`. Actual interrupt return
CS is `0540`, and the owning real-mode DS/SS is `01bb`.

The unchanged pinned passive observer records the actual INT21 IRET owner,
not the live interrupt stub. Before the repair it captures five records:
AH5A before/after at `0540:4612`, seek before/after at `0540:762a`, and error
print at `0540:8430`. It restores the wrapper and reports no observer errors.
AH5A returns handle 7; seek succeeds with length zero. At seek, `[3544]` is
`00888000` and `[354c]` is `00005000`. At the error, `[3530]` is `00057000`
and `[3538]` is `ffff7000`. The visible message is insufficient extended
memory, followed by the wrapper's missing setup.exe error.

Authenticated code `75ee–7641` obtains DOS free space, computes
`8 * 512 * f000 = 0f000000` in EAX, saves **only AX and DX**, calls seek,
then restores those low words and uses the full EAX/EDX. DOS word results
must preserve their upper halves. The host interrupt adapter instead called
VM.set, which masks and replaces a general register. Seek therefore erased
the saved upper halves. `[3548]` and `[3560]` became zero.

Code `7543–75de` then derives `00050000` from zero plus `00050656` rounded
down to a page. Code `843c–8479` subtracts the page-aligned program size
`00057000` plus `00002000`: `00050000 - 00059000 = ffff7000`, matching the
captured error state. This establishes a generic register-write defect;
the displayed memory message did not establish inadequate XMS capacity.

The repair in `dos-loop.js` merges interrupt result words with the current
full general registers. IRET's 16-bit SP advance likewise preserves ESP's
upper half. Whole-register initialization, segment loading and explicit
context transfers retain their existing APIs.

## Validation and actual installer outcome

The actual interrupt-adapter regression fails before the repair on
`ax upper half preserved`, and passes afterward for all eight general
registers, IRET CS/IP/flags and ESP. Its native synthetic DOS program executes
the original free-space/multiply/seek/save-low-words pattern and obtains
EAX `0f000000`, EDX `e0000000`. It contains no installer bytes.

All 15 AH5A contracts pass, along with 11 EXEC environment, four EXEC
boundary, resident-retention and four MCB contracts. The four passive
observer contracts pass on the final source. Native DOS files, IOCTL status
and EXEC termination (`SDT`) pass. Both ToyVM browser bundles were regenerated
and their full dependency closure checked, including fnt-read, ne-dump,
disasm and simd-ops. Test-tier membership and diff whitespace checks pass.

Final original-media diagnostic started `2026-10-07T21:05:20.059Z` and ended
`21:05:27.110Z`; driver 3141798 and child process group 3141818 terminated,
streams closed, original five media hashes unchanged, disk floor retained.
It used no automatic answers and wrote no host payload. The observer captures
four AH5A/seek records and no error print. Final bytes in the earlier
authenticated real-mode data area show `[3548]=[3560]=0f000000` and
`[3538]=0eff7000`. These are final area bytes, not a claim that the current
DS still addresses that area or a capture of every intervening branch.

The run ends by dispatch budget, with CR0 `10` (real mode), CS:IP
`4b4b:44bd`, no reported fault/unimplemented call and no exit. The reviewed
capture is black. Only the empty in-memory temporary file exists; there is
no installed payload, installer completion or gameplay qualification. The
remaining blocker is later startup execution before the first installer
screen. An investigation of that instruction stream/control transfer needs
a separate bounded diagnostic; this repair does not invent its cause.

The pinned driver's `seconds:30` is a **wall** limit. Its 50M dispatch budget
actually ends at 50,024,516 dispatches / 4.995667 guest seconds, below the
authorized 30 guest / 90 total limits. The first repaired run completed guest
execution but failed PNG output because this worktree lacked pngjs. That
failed receipt is retained; a read-only shared node_modules symlink supplied
the dependency for the completed captures without a source/config change.

The baseline probe is honestly labelled `c1ae5431` plus EXEC/MCB and private
AH5A. All 94 pinned source files matched this origin/main-based worktree after
the exact cherry-picks. Candidate runs use that closure plus the identified
dos-loop repair; source/driver/artifact hashes are in the evidence receipt.
Raw evidence lives under this worktree's `scratch/comanche-worker/` in
`pinned-memory`, `repaired-memory`, `repaired-memory-complete` and
`final-accounting`, each with a distinct immutable `native-attempt1`.
Main integration belongs to the coordinator and remains pending.
