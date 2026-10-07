# Native ToyVM original-entry census — 7 October 2026

Actual source80e61a16 (eca runtime plus integrated original U4 manifest fix/test).
715 pinned source/catalog files equal main472f9e09, not an assertion about
unrelated main code. Originals read in place: exact entry hashes/args and
source hashes in pins.json. No flattening, CD mapping, DOSBox, modified guest
state, JIT arm, or benchmark. All native gameplay remains unqualified.

Corrected pair entry-attempt2 completed09:51:12.205Z,30.839s total. Both Node
processes exited0, guest Arena exit6 separately; no forced signals, PIDs2471514
and2472226 absent. Each run had30s execution/50Mdispatch limits with43s process
lifecycle and90s overall guard. Counts/time are diagnostic run facts, not a
performance comparison. Logs retain complete streams (no omitted bytes).

## Arena: actual missing MSCDEX boundary

Original ACD.EXE and original SB/General-MIDI arguments plus ARENADATA=C:.
Guest exited6 at110:21b after2.9Mdispatches. Actual console PNG, personally
reviewed by /root/corpus_categories, says **MSCDEX Driver not installed.**
The report records INT2F AH15 unhandled once. This is a specific executed CD
service boundary, unlike the prior static CD-recipe inference. No gameplay.

Next source-only step: resolve the actual AX/subfunction and caller around
110:21b from original/decompressed code and existing interrupt trace options.
Do not return fake driver-presence success: meaningful support must map the
original directory/CD layout, implement queried MSCDEX contract, and preserve
real files/device errors. Current CLI and browser host filesystems both discard
directory/drive names; nested files remain unavailable, even without basename
collisions. No payload copying/flattening was used or proposed as a fix.

## Daggerfall: observed protected-mode decode loop, not a proven extender ban

Original FALL.EXE Z.CFG. Opened C:\FALL.EXE; no later game data open is
reported. Stop is30s wall-clock budget, not guest exit. PMCR0=0x80000011,
CS4b cached base0x28, reported16-bit code, CS:IP4b:142a.16.9Mdispatches and
16,162,831 slice entries at that PC. Six decoder-gave-up sites contain ASCII
fragments; final bytes63 65 70 74 69 6f 6e 2e spell `ception.`. INT2F AH16 and
INT21 AH5d were each unhandled once. These facts localize a suspect descriptor
or control-transfer boundary; they do not prove which one is wrong, nor that
DPMI/VCPI absence prevented entry. No graphical gameplay was reached.

Next narrow proof should capture the first PM transition/far transfer, actual
GDT selector bytes and loaded CS base/limit/default-size, plus first decoder
failure. Use existing bounded trace controls where sufficient; compare decoded
descriptor to architectural fields. No broad CPU/paging/REP edit based only on
this final PC, and no longer budget as a substitute for localization.

## Preserved harness failure

entry-attempt1 executed initial guest entries but failed when the post-run PNG
writer required worktree/node_modules/pngjs by absolute path. That prevented
final reports; it was not a guest fault. No files were overwritten. A private
node_modules symlink to the existing installed dependencies (no install/copy)
and exact require preflight fixed the harness. Attempt2 changes no guest flags.

Raw attempt1 remains scratch/toyvm-dos-native-20261007/entry-attempt1. Raw
attempt2 plus helper copies remains sibling entry-attempt2. This handoff
contains source pins, complete guest logs, final PNGs and process receipts.
