# Comanche 3 DOS demo: native installer evidence

This is the original Comanche 3 demo DOS media, distinct from Comanche Gold. Original directory: `test/binaries/win98-games-a-d/Commanche3-demo-SW`. INSTALL.EXE is 2,462 bytes (SHA-256 5a5ff6d376642d83ac9b049be952c64deb8898d09b593a0fb90083fed26e9cbb); INSTALL.BIN is 58,119,069 bytes (2bc752ed8feada4f33c78d73e6f036f935f6903af71513bb9fdeb808e138ccf8). No DOSBox substitution or installer autoanswers were used.

## Native probe, 2026-10-07

Source snapshot a2816e17664fa165520ad2e7b80cef7c3daa22d7; run artifacts are in `scratch/wt-diehard-20261007/scratch/comanche3-preparation/native-attempt1/` (identity, raw log/result, installer.png, cleanup and validation.json hash closure). Start 12:21:54.589Z, terminal 12:21:55.335Z; driver 2643693 and child 2643700 absent after cleanup, streams closed, original five media hashes unchanged.

The personally reviewed screenshot displays “Fatal error, insufficient conventional memory” and the wrapper's unknown-error message. That text is an observed installer error, **not proof of insufficient host or guest capacity**. INSTALL.BIN exited 1; its INSTALL.EXE wrapper subsequently exited 0. The supervisor PASS denotes clean harness termination only. No generated files, installer completion, game scene, player input, audio or FPS were established.

## Discriminating source finding

The trace loads INSTALL.BIN at PSP 019a, entry 01aa:0154. That child then opens C:\INSTALL.EXE, reads its six-byte header, seeks to 099e (the 2,462-byte parent's EOF), and receives zero-byte reads before the error. This identifies the wrong self-file lookup as an actionable lead; later extender support remains untested.

In tools/toyvm/dos.js, installEnvironment (around1176–1222) emits the environment variables, double NUL, count word1 and top-level C:\INSTALL.EXE path. EXEC AH4B (around4514–4628) reads only command-tail fields at parameter-block offsets2/4; it ignores the environment selector at offset0. The child PSP:2c is assigned the same fixed ENV_SEG (0060), retaining the parent's executable-name trailer. The same defect is present in origin/main c1ae54312dfe79fd3e667dbb02d70f61a42f2c2f at this audit.

A safe generic repair must copy the selected environment variables (zero selector inherits from parent PSP; nonzero chooses supplied segment), construct the executed child's canonical program-name trailer, allocate an owned nonoverlapping DOS block, and preserve parent bytes. It must not rewrite the global parent trailer or hardcode INSTALL.BIN. Existing memAlloc/mcbOwner/child termination ownership and load-only AL1 must be considered: ordinary AH4C frees child-owned blocks, while resident AH31 preserves ownership. Current mcbSync roots at the initial PSP, so child environment placement must be represented in memBlocks rather than an untracked gap.

Proposed discriminating regression: invoke real EXEC handling on synthetic parent/child files and parse child PSP:2c bytes; verify inherited/explicit variables, exact child path, parent immutability, nested EXEC, AL1 load-only, child exit cleanup, resident ownership, allocation failure rollback and nonoverlap with image/adjacent canaries. A child that opens its own environment trailer should read child bytes, not parent's EOF. Preserve this baseline failure before any repair; rerun the original installer only after focused tests and a runtime grant. No repair or retry is included in this finding.
