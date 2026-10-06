# DEBUG-BREAKPOINT-RETARGET

Root found that the skip-once latch from a breakpoint halt survived changing or clearing the breakpoint. Changing A to B therefore skipped the first B hit. Icy's proposed checkpoint chain could cross iterations even though its mocked driver passed.

The only production change is in `src/13-exports.wat`: `set_bp` clears the latch when the requested address differs, while same-address rearming retains normal resume behavior; `clear_bp` clears both address and latch. First-caller reset and debugger guard recomputation remain unchanged. Exact pre-edit source, including inherited TrackMouseEvent changes, is preserved at `scratch/debug-breakpoint-retarget-20261003/before.wat`; `review.patch` isolates this change instead of attributing the whole worktree diff to it.

`test/test-debug-breakpoint-retarget.js` executes actual three-block x86 code in real WASM. It checks first-hit A→B→C retargets, same-A rearm/resume, clear/rearm at the current EIP, and breakpoint-before-logical-marker phase. Both unchained and warmed chained modes run, with increased real chain-hit count asserted. The test uses an explicit local Icy Tower PE only to initialize the VM; its application entrypoint is never executed. Default `test/binaries/notepad.exe` is missing on this migration, so the fixture override is recorded.

Private fixed WASM `698e5db5a7a6d7d3c55fe769ff28655be5dc56407b6fe7b435ab8ebe5d358c60` passes. Compiling the exact before-source override and running the same test fails on the first retarget: EAX is2 instead of1, demonstrating the skipped first hit. Logs, commands, exit codes and full source/test/module hashes are in `validation.json`. Source parentheses/labels pass. No canonical build or browser was run; canonical remains `939943d487cfe5de640207486b5bf2c0f50c507109a17e27186d9b9183c79597`.

Icy remains an offline diagnostic draft with `fps:null`. Any next launch needs the reviewed fix in a separately built/pinned canonical module, not the old module relabeled. Root owns independent review and runtime scheduling.

Completed: root independently reviewed setter diff and ran fixed private regression, then all canonical build gates and actual canonical regression passed. Module `2c22cb7d21a5bf9191036bb30b674f959ec554c306b6be69e905a9f53f265e88`, 1,657,480 bytes. Explicit Icy PE is VM initialization only; missing default test/binaries/notepad.exe remains recorded. No guest gameplay qualification or FPS implied.
