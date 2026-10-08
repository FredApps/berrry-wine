# Comanche 3 native installer progress

Sole worker `NEW-GAME-COMANCHE3-DEMO-20261007`, isolated worktree
`/home/user/wt-comanche-gameplay-20261008`, branch
`findings/comanche3-gameplay-20261008`, explicit base
`329bb48d7f37f5071b722f7fe8a7eca3a6a72aea`. Shared HEAD/index untouched; root
integrates and pushes. No subagents, production changes, CPU/DOS repair, public
deployment or local heavy execution.

Original native ToyVM INSTALL.EXE reached its graphical destination prompt.
Reviewed Enter and `y` progressed through Folder Exists into **File Copy,
MAKEICON.EXE, 3% installed**. Final screenshot:
`scratch/runs/20261008T0433Z-comanche3-install/attempt2/screen-008.png`.
Installation completion and gameplay were not reached. The corrected original
run had no recorded CPU fault/unimplemented/unhandled/protected-transfer stop;
it ended by its remaining wall budget, with guest still running.

The full source/media/dependency closure and actual drivers, screenshots,
generated files, raw logs, source module/WAT, cleanup and retrieval receipts are
self-contained in `scratch/runs/20261008T0433Z-comanche3-install/`. See
`docs/re-notes/comanche3-demo.md` for exact counts, missing paths, input landmarks
and limits. The freshly compiled CPU module hash is
`91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf`; actual
source is pinned from the explicit base above, not an assertion about a later
main build. Node 24.18.1 / V8 13.6.233.17-node.50 on remote AMD Ryzen 9 9950X.
Native VESA 101h / 640x480x8 was independently observed. FPS/audio unknown.

Final bundle: 178 ordinary files, 176 indexed byte hashes verified with zero
drift; `result.json` published last. The containment check reports one run,
zero errors and zero missing artifacts. The atomic input-channel regression
passes; its incomplete temporary file preserves the previous complete command.

The finite grant was 240 seconds transfer, 900 seconds overall remote runtime,
120 guest seconds maximum, 90 cleanup, on a fresh 2400-second lease. Original
runtime deadline was 04:48:54.095 UTC; it was never reset. Attempt0 failed before
guest execution due to the PNG dependency path. Actual attempt1 reached the
installer UI, then the worker's non-atomic input update caused a JSON parse
error. Both are preserved. Attempt2 corrected atomic file publication, tested
the partial-write case, and used only the remaining deadline minus 15 seconds.
It ended at 04:48:39.651 after 235.9166 execution-wall seconds / 16.51805 guest
seconds / 165,404,857 dispatches. Input regression and cleanup checks passed.
No guest binary patch, automatic answers or forced guest state were used.

Exported files: empty `00000001`, `setup.cd` 2 bytes, `install.lev` 1 byte,
`install.tmp` 41,472 bytes. Source cursor advanced to 2,621,525. `C3.EXE` and
`SETUP.EXE` remain absent from exported payload. Folder Exists was accepted on
the fresh isolated in-memory filesystem; no host game files were overwritten.
The isolated conventional fixture directory is absent; the five verified media
files were hardlinked from the accepted paging evidence, with no bulk fixture
copy. INSTALL.EXE SHA `5a5ff6d376642d83ac9b049be952c64deb8898d09b593a0fb90083fed26e9cbb`;
INSTALL.BIN SHA `2bc752ed8feada4f33c78d73e6f036f935f6903af71513bb9fdeb808e138ccf8`.

Remote slot released: driver/child/group checks for 23355/23365,
23570/23577 and 31314/31321 independently absent; Chrome absent; fresh socket
baseline exactly restored, including closure of the temporary inspector socket;
79 pins unchanged, both actual streams closed. Artifacts retrieved and hash
checked before explicit prefix removal at 04:49:32.989, within 90 seconds of
the final terminal receipt. Root adopts no-env `bx_2bg9dma5`, expiry
05:11:20.138 UTC; no worker jobs or scoped prefix remain. Boat not deleted.

Next phase should use the retained atomic channel, inspect screenshots rather
than stale console text, and respond promptly to reviewed Enter / `y` prompts.
Predeclare finite wall/guest budgets and file-growth milestones before runtime.
The new checkpoint is genuine copying; do not redo paging/IVT diagnosis or
count Loading Install as a new acceptance. No generic CPU blocker has been
demonstrated. Continue to completed installation and ordinary C3 gameplay.
