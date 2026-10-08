# Comanche 3: original installation and DOS rename repair

Sole worker `NEW-GAME-COMANCHE3-DEMO-20261007`, isolated checkout
`/home/user/wt-comanche-gameplay-20261008`, branch
`findings/comanche3-install-progress-20261008`, explicit base
`73e7025e696dda27fbe2c3ed36511b41aa04b9ee`. Prior branch/commit
`findings/comanche3-gameplay-20261008` / `1598d7aa8690466df668a56d854ffcca23e73c2e`
preserved. Shared HEAD/index untouched. Root integrates/pushes; no subagents.

The original finite continuation reached the real **Installation Complete**
screen after copying all original media. Ordinary Enter then produced
**File not found: setup.exe**. This was a file-service defect, not a timeout
or evidence that copying needs an optimization.

A passive bounded original-media control authenticated the first DOS AH=56h
rename at actual return `0540:4c81`: closed `C:\C3DEMO\INSTALL.TMP`, 950,891
bytes, to `C:\C3DEMO\SETUP.EXE`. The existing handler returned `false` and left
the temporary name unchanged. Original INSTALL.BIN bytes at the corresponding
file offset contain `CD 21` at IP `4c7f`. Static original bytes and actual
before/after owner/path records are preserved; no guest instruction was edited.
The control deliberately ends by observer exception after this actual call,
with child exit1/parent supervisor pass=false; it is not a CPU failure.

The generic repair handles closed guest-created file rename within one
directory on the mounted C drive, preserving the record and bytes and removing
the old name. Missing files, collisions, wildcard/invalid paths, unavailable
directory moves, other drives, readonly/hidden/system records, open files and
readonly corpus sources fail explicitly. It retains the existing basename
lookup policy; it does not implement a DOS directory tree or host mutation.
Both browser bundles were regenerated and reproducibility checked.

The actual repaired original installation preserved SETUP.EXE 950,891 bytes,
C3.EXE 945,297 bytes, and RESOURCE.RES 55,496,696 bytes. Ordinary Enter at the
reviewed completion prompt launched **Loading Setup ...** from the installed
file. Setup reached the reviewed graphical **Testing Your CD-ROM Transfer
Rate / Performing test, please wait** screen (`screen-074.png`). No input was
sent to that wait screen. The final capture (`screen-089.png`) is black.
Setup completion and ordinary C3 gameplay remain unqualified. The substantive
alternative goal, authenticating and repairing a generic installation blocker,
is achieved; no further phase or permission request is pending from this worker.

Validation: real-handler regression fails before on “DOS rename must be
handled,” then passes 13 groups. The synthetic native DOS COM executes actual
create/write/close/rename/open-old-fails/open-new/read/normal-exit in tailcall,
switch, calls and repl_tailcall; all four pass on the temporary box. Existing
15 temporary-file, 11 EXEC environment, four EXEC boundary, resident-retention
and four MCB groups pass locally under serialized small correctness work.
Test-tier membership and whitespace checks pass. No interpreter/JIT optimization
variant, performance benchmark or native-disassembly acceptance is claimed.

Evidence is self-contained in the shared checkout:

- `scratch/runs/20261008T0505Z-comanche3-install-progress/`: original full copy,
  completion and missing-Setup failure; atomic input reviews; 30-second actual
  copying CPU profile. 320.2673637 execution-wall seconds / 27.9584471616 guest
  seconds / 279,964,199 dispatches; normal guest parent exit0, no recorded CPU
  fault or unimplemented instruction. SETUP/C3 payload absent at final exit.
- `scratch/runs/20261008T0515Z-comanche3-rename-control/`: passive first-rename
  control and original instruction bytes, deliberately stopped after the
  unsupported service; retained partial SETUP bytes are not an installed game.
- `scratch/runs/20261008T0520Z-comanche3-rename-repaired/`: exact repaired DOS
  source, 80 pins, native validation, original install/Setup captures and files.

The original full-copy and repaired-run actual CPU module hashes are
`91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf`.
The deliberate first-rename control did not export its CPU module before its
observer exception; its unchanged pinned source/variant are recorded instead.
The four small native acceptance variants likewise did not export module hashes;
their exact source pins, variant names, Node/V8 and process receipt are retained.
Only DOS JS changes for the candidate; no paging/IVT work repeated. Original
INSTALL.EXE SHA `5a5ff6d376642d83ac9b049be952c64deb8898d09b593a0fb90083fed26e9cbb`
and INSTALL.BIN SHA `2bc752ed8feada4f33c78d73e6f036f935f6903af71513bb9fdeb808e138ccf8`
remain unchanged. Node24.18.1 / V8 13.6.233.17-node.50, remote AMD Ryzen9 9950X.

The 30-second copying profile attributes 29.56% self samples to existsSync and
25.83% to readFileUtf8 in the retained atomic-input polling harness. It does not
establish an interpreter bottleneck. No polling optimization was made. The
original copy progressed from35% to94% to100% in fresh screenshots.

Fresh no-env boat `bx_uqhk4qt5`, lease expiry `2026-10-08T06:14:33.753Z`, root
owns lifecycle. The common runtime deadline is `2026-10-08T05:36:07.354Z`, never
reset; all causal control/repair work uses its remaining time. Original grant
1800wall/300guest seconds, transfer<=240 and cleanup<=90. Candidate guest cap250
allows for the original and control work; no browser was run.

Known handling errors are preserved honestly: the initial full-copy cleanup
prefix removal took92.3seconds, 2.3seconds beyond90, after hashes/PIDs/socket
checks; no process remained. A source edit wrote through a four-link dos.js;
exact explicit-base bytes were immediately restored to all three historical
closures, candidate detached, 79-input checks and all176 prior sealed artifact
hashes pass. Remote control had already received an independent unchanged copy.
No sealed receipt was rewritten. See source-link-correction and prior-seal
verification receipts. A transient read-only Boat502 was retried successfully.

## Final execution and release

Repaired run: `883.850680157` execution-wall seconds / `48.177177788724144`
guest seconds / `482426113` dispatches. It ended normally by its remaining
wall guard before the fixed deadline; `ranOutOfTime=true`, guest `exited=false`.
The supervisor child exit0/pass=true means clean bounded harness termination,
not Setup completion. No recorded CPU fault, unimplemented instruction,
unhandled vector or protected-transfer stop. The original+control+candidate
guest-time sum is95.6566421013seconds, below300. No browser/game driver ran.

Eight actual before/after rename records all return handled=true and preserve
the correct named payload/length. All11 final created records were exported
through the supported `Machine.tempFiles` file mechanism, without a VM snapshot.
`installed-files.json` maps the actual hex artifact paths to names and hashes:

| Payload | Bytes | SHA-256 |
| --- | ---: | --- |
| SETUP.EXE | 950891 | d18e165779c36c0bad5f79135bfcf1d172262dfec267e1b09d7b76cc072769bd |
| C3.EXE | 945297 | 9d561246e9a5ac39ddb40949949373c9d4d5eeb6f99d67e64dc86df8aa0dfa5d |
| RESOURCE.RES | 55496696 | 6d5fcf59243d3de6cc615a4337b867d56c9efc0d265cf9507183bd113b709676 |

The conventional fixture directory remains absent. `generated/63332e657865`
is the actual C3 executable; `generated/73657475702e657865` is Setup. An
installed-directory/game driver was prepared but never materialized/launched;
no `installed/C3.EXE`, game screenshot, RAM checkpoint or gameplay claim exists.

All owned47560/47567/47227 and prior24907/24914/27144/36472/36479 PIDs/groups
independently absent, streams closed, no Chrome, exact fresh socket baseline,
all80 input hashes unchanged and remote/local disk floors passed. Retrieved
116 actual files /73780681bytes in56.417seconds, all hashes checked before
prefix removal at05:37:23.331UTC. Final cleanup was90.514seconds, **0.514seconds
over the90second cap**, recorded without resetting the clock. Control cleanup
was77.026seconds. No scoped prefix or job remains. Root retains lifecycle of
the fresh boat; this worker did not stop/delete it.

Next: root review/integrate the six scoped paths and sealed evidence, then use
the preserved native installed files through normal readonly-file mounting or
`runDos`' supported `tempFiles` interface for a separately bounded Setup/game
continuation. Inspect fresh prompts; do not repeat the installer, old paging/IVT
diagnosis, force registers, or infer an interpreter bottleneck from this run.
FPS/audio/gameplay remain unknown. Commit/seal identities are recorded in the
final messageboard entry and each run's `result.json`.

Root review at05:43UTC found a separate source-host shadow edge: if a guest
record shadows an original corpus basename, a successful rename reveals the
old host file again. The original Comanche INSTALL.TMP source has no such host
collision, so the actual captured repair path remains valid. **Generic main
integration needs root's fail-closed source-host collision guard and regression.**
Root explicitly owns this final guard and directed the worker to finish the
current commit/evidence without another runtime. This is a known integration
condition, not an assertion that all rename cases are correct. No new native
or browser run was started after release.

## Coordinator integration review

Root independently verified all544 contained evidence hashes and reviewed the
CD-ROM test and final black capture. Added a source-host collision refusal so
renaming a guest record cannot reveal the old readonly host name. The new
regression fails without the guard; all14 handler groups pass with it. Both
browser bundles were regenerated and reproducibility checked. This additional
guard has not received another original-media native run; the recorded
Comanche rename source does not collide with a host file. Setup completion and
gameplay remain unverified.
