# TODOS

## Coordinated migration queue — 2026-10-01

Historical sections below are preserved; they are not automatically ready work.
Coordinator: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5.
Resource and acknowledgment ledger: `ops/handoffs/orchestrator-status.md`.

**No product decision needed for current independent work.** FP comparisons and
result download are complete. REP final validation remains blocked by automated
review. Codex handoff reconciliation is
complete, including one explicitly reconstructed documentary handoff. All five Claude migration handoffs are received and local claims released.
Core migration is verified; bulk archives continue independently. Foreign remote
resources remain unverified. Existing correctness/review blockers remain.

- [x] Receive in-scope Codex handoffs and reconcile resource ownership
  id: MIG-HANDOFF
  owner: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  started: 2026-10-01T23:44:20Z
  Next: complete; eight root handoffs accepted plus one reconstructed Codex handoff. Five Claude roots deferred; preserve unverified jobs and their ownership.
  Done: all in-scope Codex custody documented without inferring process termination.
  Evidence: ops/handoffs/initial-inventory.md; ops/handoffs/orchestrator-status.md.

- [x] Review and verify released dashboard blocker workflow
  id: MIG-OPS
  owner: codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642
  started: 2026-10-01T23:45:00Z
  Next: complete; UTF-8 regression passes. Ops owner reloaded8098 with CPU/RSS work,10/10tests and browser/live checks pass; Unicode fix active.
  Done: bounded review and relevant tests recorded, defects fixed or explicitly queued.
  Evidence: ops/handoffs/ops-dashboard.md; ops/handoffs/mig-ops-review.md.

- [x] Verify existing PCP artifact correctness
  id: MIG-FP
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  started: 2026-10-01T23:45:00Z
  Next: complete; 400 sequences/14834ops pass, 264 preserved files unchanged. Native/game gates remain.
  Done: parity result and remaining native/game gates recorded.
  Evidence: ops/handoffs/fp-next-root.md; ops/handoffs/mig-fp-parity.md.

- [x] Review remaining Serious Sam production integration
  id: MIG-SAM
  candidate: serious-sam-demo
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  started: 2026-10-01T23:45:00Z
  Next: complete; timer TLS/SEH isolation recommended after frozen replay, preserve mixed-file ownership.
  Done: precise next task with ownership boundaries and validation; goal remains incomplete.
  Evidence: ops/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd.md; ops/handoffs/mig-sam-review.md.

- [x] Receive NFS2 and IS3 migration handoff
  id: MIG-NFS2
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Migration custody complete; all five Claude handoffs read and local claims released. Unfinished engineering remains separately queued.
  Done: Owner handoffs received and local sessions exited; no foreign remote-service termination inferred.
  Evidence: ops/handoffs/migration-core-ready-20261003.md; ops/handoffs/claude-migration-5e92d715.md; ops/handoffs/claude-migration-wine-assembly-d0.md; ops/handoffs/claude-migration-toyvm-uop-88bbcb9f.md; ops/handoffs/claude-migration-sc2k-compare-agent.md; ops/handoffs/claude-migration-marketing-361d8f4f.md

- [x] Verify handed-off renderer specular correction in isolated candidate
  id: MIG-RENDER
  owner: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  Next: complete; fixed72 and actual shared-worker WebGL/native software pass after narrow fog correction. Broader migration remains incomplete.
  Done: unchanged analytical expected pixels pass; exact tested module/source evidence retained.
  Evidence: ops/handoffs/01a0eb29-4302-7e20-9b06-7084fb37358b.md; ops/handoffs/mig-render-validation.md.

- [x] Correct generated fixed fog/specular guard without widening guest support
  id: MIG-RENDER-FOG
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  Next: complete; unchanged analytical fog/specular pixels pass and both mixed guest/generated negative checks reject.
  Done: existing analytical fog/specular pixels pass while unsupported guest/mixed paths remain rejected.
  Evidence: ops/handoffs/mig-render-fog-review.md; ops/handoffs/mig-render-validation.md.

- [x] Prepare coherent texture-registry validation snapshot
  id: MIG-RENDER-TEXTURES
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  Next: complete;9/9 gates PASS,144 protected hashes unchanged,12file manifest/backups/logs downloaded and own jobs cleaned. Separate Q2 route assigned; empty-quad excluded.
  Done: registry/lowering/GL/Glide correctness checks on identified source, or concrete failing gate recorded before further migration.
  Evidence: ops/handoffs/mig-render-textures-validation.md; scratch/mig-render-textures-validation-20261002/result.json.

- [x] Validate Q2 world and movement with shared texture registry
  id: MIG-RENDER-Q2
  candidate: quake-2-demo-installer
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  Next: complete; reviewed textured world and scripted-W framechangePASS6205colors/40457pixels. Physical traversal unproven;284source hashes stable, no budget rejection on this route. Own jobs cleaned, remote slot released.
  Done: reviewed world/movement images, registry budget behavior and exact tested identities; or concrete failure. No performance acceptance or merge.
  Evidence: ops/handoffs/mig-render-q2.md; scratch/runs/20261002T010210Z-quake-2-demo-installer-mig-render-registry/result.json.

- [x] Replay Serious Sam production TLS diagnostic artifact to intro
  id: MIG-SAM-REPLAY
  candidate: serious-sam-demo
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  Next: bounded replay complete with FAILED visual criterion: near-black87000 despite quitfalse/credits0. Follow-up paired replay assigned; production TLS visual pass remains unproven.
  Done:87000 intro state and reviewed capture, or concrete failure evidence; stop only own new run.
  Evidence: ops/handoffs/mig-sam-review.md; ops/handoffs/mig-sam-replay.md.

- [x] Isolate Serious Sam near-black intro checkpoint
  id: MIG-SAM-VISUAL
  candidate: serious-sam-demo
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  Next: complete; both87000/90000 images byte-identical across405db/363d, brightGODGAMES90000, hosts unchanged and both runs stopped. Earlier black frame is transition.
  Done: frame-phase versus module difference recorded with reviewed paired evidence; no unsupported TLS blame.
  Evidence: ops/handoffs/mig-sam-replay.md.

- [x] Capture matching FP native code on dedicated x64 box
  id: MIG-FP-NATIVE-X64
  owner: codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642
  Next: complete; six captures/30function records/121download hashes verified. Both engines retain spilled countdown; no speed claim. ARM64 remains next after local slot release.
  Done: captures downloaded and reviewed with tier/engine/hash provenance; no speed claim.
  Evidence: ops/handoffs/mig-fp-native-plan.md; ops/handoffs/mig-fp-native-x64.md.

- [x] Capture matching FP native code on local ARM64
  id: MIG-FP-NATIVE-ARM64
  owner: codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642
  Next: complete; six captures/30functions/input hashes verified. Countdown remains spilled; affected Ion fast frames shrink16bytes. CPU released, version differences retained; no speed claim.
  Done: actual disassembly reviewed with version/tier/module provenance; no timing conclusion.
  Evidence: ops/handoffs/mig-fp-native-plan.md; ops/handoffs/mig-fp-native-arm64.md.

- [x] Restore missing MW3 assets and verify frozen P browser baseline
  id: MIG-FP-BROWSER-BASELINE
  owner: codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642
  Next: complete;43assets verified, cockpit and3windows PASS;23artifacts downloaded/hash matched, source stable and own jobs cleaned. CDP SwiftShader contradicts endpointIntel string; diagnostic evidence only.
  Done: reviewed gameplay route or concrete failure with exact source/module/renderer provenance; no variant timing campaign or EPYC comparison.
  Evidence: ops/handoffs/fp-next-root.md; ops/handoffs/mig-fp-browser-baseline.md.

- [x] Prepare existing FP copied-kernel comparison recipe
  id: MIG-FP-KERNEL-PLAN
  owner: codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642
  Next: complete;112frozen inputs pinned and exact3pair recipe reviewed. MIG-FP-KERNEL assigned on dedicated ASCII host after quiet preflight.
  Done: concrete recipe with MIXED_CONTROL census guard and explicit mixed-kernel versus pure-path/gameplay coverage limits; no new variant/default change.
  Evidence: ops/handoffs/fp-next-root.md; ops/handoffs/mig-fp-native-arm64.md; ops/handoffs/mig-fp-native-x64.md.

- [x] Prepare matching FP native-code capture commands
  id: MIG-FP-NATIVE-PLAN
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  Next: plan complete; local captures wait for Serious Sam CPU release, remote prerequisites need separate verification.
  Done: executable matching P/PCM/PCP V8/Ion capture plan with prerequisites explicit.
  Evidence: ops/handoffs/mig-fp-native-plan.md.

- [x] Audit incoming owner evidence and missing handoffs
  id: MIG-OWNERS
  owner: codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642
  Next: audit complete; nine original roots still lack durable handoffs, keep individual blockers open.
  Done: received/released/retained resource distinctions and ready candidates recorded without runtime disturbance.
  Evidence: ops/handoffs/mig-ownership-audit.md.

- [x] Receive Pirates Worker sailing handoff
  id: MIG-PIRATES
  owner: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  Next: handoff accepted; preserve8159, review exact StretchRect/Worker hunks before game-path validation.
  Evidence: ops/handoffs/01a0f736-78f1-7822-8b37-159d6f8ed94d.md.
  Done: accepted handoff and safe next task.

- [x] Verify Pirates actual-game rectangular StretchRect path
  id: MIG-PIRATES-STRETCH
  candidate: pirates-2004
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  Next: bounded route complete with INCONCLUSIVE transfer outcome; guest stopped after captain before any transfer. Root reviewed image and verified58artifact hashes;143inputs unchanged. Cause unresolved; no rerun assigned.
  Done: opcode0x30015 and ordered source readback observed with reviewed game captures, or concrete route failure. A zero-transfer sailing pass is insufficient; white terrain remains separate.
  Evidence: ops/handoffs/mig-pirates-stretch.md; scratch/mig-pirates-stretch-20261002/result.json.

- [x] Complete MMX root resource audit
  id: MIG-MMX
  owner: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  Next: durable root/three-child handoff acknowledged; preserve notes/artifacts/server58114, no slower default enabled and no new optimization campaign assigned.
  Evidence: ops/handoffs/01a0eef4-21b2-76b3-8352-48b0d6ac6e7f.md.
  Done: checkpoint accepted, remaining work scoped from owner evidence.

- [x] Receive remaining Claude migration handoffs and Codex coordination history
  id: MIG-LEGACY
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Migration custody complete; all five Claude handoffs read and local claims released. Unfinished engineering remains separately queued.
  Done: Owner handoffs received and local sessions exited; no foreign remote-service termination inferred.
  Evidence: ops/handoffs/reconstructed-remaining.md; ops/ORCHESTRATOR.md.

  Evidence: ops/handoffs/migration-core-ready-20261003.md; ops/handoffs/claude-migration-5e92d715.md; ops/handoffs/claude-migration-wine-assembly-d0.md; ops/handoffs/claude-migration-toyvm-uop-88bbcb9f.md; ops/handoffs/claude-migration-sc2k-compare-agent.md; ops/handoffs/claude-migration-marketing-361d8f4f.md

- [x] Revalidate transferred bounded wave capability writes
  id: MIG-AUDIO-CAPS
  owner: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  Next: complete;920ABI/input/full isolatedbuildPASS, committedcd50cfdf only4ownedpaths; foreign timeSetEvent hunk preserved.
  Done: current920-case caps and existing input suite validated, isolated/full build identity recorded, report finished and only owned hunks integrated.
  Evidence: ops/handoffs/01a04d26-4255-7ee2-bb58-9e2cbedb68df.md; ops/handoffs/mig-audio-caps.md.

- [x] Integrate persistent multimedia timer TLS and SEH context
  id: MIG-SAM-TIMER
  candidate: serious-sam-demo
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  Next: complete; new context fixture plus five regressions and static gates PASS. Narrow source additions preserved uncommitted; private diagnostic intro replay assigned.
  Done: stable FS base, separate persistent registered callback TLS, main TLS/SEH restoration, late templates/TlsFree and waveOut regressions pass; no fault/REP/launcher expansion.
  Evidence: ops/handoffs/mig-sam-timer.md; scratch/mig-sam-timer-20261002/.

- [x] Replay production timer context in private Serious Sam diagnostic module
  id: MIG-SAM-TIMER-REPLAY
  candidate: serious-sam-demo
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  Next: complete; private0c5d6ab0 matches both prior modules PNG/snapshot/GL at87000/90000;250inputs unchanged and own8147 quit0. Private fault/REP transforms remain.
  Done: exact source/module/host identity and intro result, own8147 run stopped, retained8138/8146 untouched. Current-source replay is not a timer-only A/B or gameplay completion.
  Evidence: ops/handoffs/mig-sam-timer-replay.md; scratch/runs/20261002T005200Z-serious-sam-production-timer-intro/result.json.

- [x] Scope remaining Serious Sam production fault and REP restart integration
  id: MIG-SAM-FAULT-PLAN
  candidate: serious-sam-demo
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  Next: complete; REP-specific absent-page slice proposed, separate MOVSW and raw-SEH classifier gaps identified. New fixture/fallback audit assigned without production changes.
  Done: concrete ready or blocked steps with exact source dependencies and precise-PC strategy; no broad diagnostic instrumentation shipped.
  Evidence: ops/handoffs/mig-sam-review.md; ops/handoffs/mig-sam-timer-replay.md.

- [x] Run existing FP copied projection kernel pairs
  id: MIG-FP-KERNEL
  owner: codex:01a0f9db-07f4-71d2-9fe8-42d5efc7f642
  Next: Complete: three pairs passed correctness/census/island gates; nine downloaded evidence hashes verified,115inputs unchanged and own jobs stopped. Timing inconclusive against biased P/P control; no default change.
  Done: source/module/work identities, parity/census/island coverage and paired spread against P/P null recorded; own jobs cleaned. Mixed workload does not validate PCP pure-path benefit or game speed.
  Evidence: ops/handoffs/mig-fp-kernel.md; scratch/mig-fp-kernel-20261002/analysis.json
  status: done

- [x] Establish decoded REP sparse-fault restart regression
  id: MIG-SAM-FAULT-FIXTURE
  candidate: serious-sam-demo
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  Next: complete; both diagnostic baselines expose stale blockheadPC/writekind0/repeated premarker; MOVSD also stale progress. Two immutable165file snapshots/logs retained; narrow REP correction assigned.
  Done: precise fault/progress/retry baseline evidence and MOVSW/fallback coverage limits, without weakening expected behavior or promoting diagnostic shortcuts.
  Evidence: ops/handoffs/mig-sam-fault-plan.md.

- [!] Correct REP MOVS restart on absent sparse pages
  id: MIG-SAM-REP-RESTART
  candidate: serious-sam-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: incomplete handoff accepted; seven file/patch hashes verified. Matrices/regressions/zero-count/block paths pass. Corrected uop log passes with2entries/1COPYdeopt, tool exit unconfirmed. ContinueSearch, direct MOVS code-write review and final static gates remain after automated review stopped the worker.
  Done: correct single fault, first absent byte, failed-element preservation and retry at REP for widths1/2/4 DF0/1, with source identities and coverage limits. No generic fault-policy/classifier/layout changes or canonical build.
  Evidence: ops/handoffs/mig-sam-rep-restart.md; scratch/mig-sam-rep-restart-20261002/evidence-summary.json.
  blocker: Worker execution stopped by automated cybersecurity-risk flag; final validation incomplete.
  waiting-on: automated review resolution
  needs: Resolve the blocked validation step before promoting or committing this change.

- [x] Review remaining Serious Sam diagnostic fault transforms
  id: MIG-SAM-FAULT-REMAINDER
  candidate: serious-sam-demo
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  Next: complete;3transforms obsolete,5generic/classifier dependencies remain. Original builder is incompatible with current REP signatures; no replay or implementation assigned until REP review gates resolve.
  Done: exact redundant versus still-needed transforms and safe next validation documented.
  Evidence: ops/handoffs/mig-sam-fault-remainder.md.

---

Snapshot of remaining work, written 2026-08-16 by picking up five Claude sessions
that ran the night of 2026-08-15 and stopped mid-flight. Each item names the
session that owns it, the files it touches, and what the *next* concrete step is.

Session transcripts live in
`~/.claude/projects/-Users-vg-Documents-projects-phone-wine-assembly/<id>.jsonl`.
Coordination history is `messageboard.txt` (append-only; entries 1180-1220 cover
this stretch).

Tree state at time of writing: HEAD `209aa00`, working tree clean, build green,
corpus sweep 106 PASS / 0 FAIL.

---

## 0. Blocking question: are the 24 e2e failures real? — ANSWERED 2026-08-16

**Answer: they are real, but they are not new, and the font commits are
exonerated.** A baseline worktree at `eff03cb^` (680db80) produced a
byte-identical fail set to HEAD across all six sampled tests, so neither
`eff03cb`/`45e58ae` nor the `WNDPROC_DIALOG` move caused any of them. Against
the session-start commit `9c49b65`: `spider-messagebox`, `find-cancel`,
`solitaire-resize` and `cwordzap-render` fail identically there too — they
predate the whole night. `mspaint-options` was *worse* at `9c49b65` (the run
did not complete at all); only its margin-gray assert is left. Only
`regedit-deep` truly regressed, bisected to `88c6a72` — seeding `HKLM\System`
gives HKLM a third child, so the tree has 10 visible rows where the test pinned
9. Expectation fixed in `48379a7`; the emulator was correct.

What is left of this item is the individual failures, each of which is now a
plain bug with no shared cause. Note also that `lib/storage.js` seeds both
`HKLM\SOFTWARE` and `HKLM\Software` and key paths compare case-sensitively, so
regedit shows two keys where Windows shows one.

The original writeup follows.

**Priority: highest. Nobody owns this yet.**

`test/run-all.sh` in the shared tree at 23:58 gave **151 passed / 27 failed**:
unit 92/2, e2e 58/24, smoke 1/1. The two unit failures are known and owned
(`test-winhelp-wat-parser`, `test-gdi-public-api-status` 245-vs-244).

**All six sampled failures are now closed** (2026-08-16). Five of the six were
tests pinned to stale geometry or to the retired JS renderer's palette — the
emulator was right and the assert was wrong. Only `test-cwordzap-render` was a
genuine emulator bug. Two reusable lessons for the rest of the 24:

1. Before believing a pixel/click assert, check the *live* geometry
   (`dump-windows`) and the Win98 classic palette (the real Plus! 98 theme
   files in `test/output/wordpad-mixed-format-roundtrip/vfs/screensavers/*.the`
   settle any color question). A coordinate hardcoded months ago is the prime
   suspect.
2. `run.js` now has `close-click:TARGET` and `corner-drag:HWND:DX:DY`, which
   derive their points from the live window rect. Prefer them over magic
   screen coordinates so the next placement change doesn't silently rot the
   test into a no-op.

Also: timing-sensitive tests (`test-mspaint-options` 9s, `test-mspaint-stretch-icons`
10s `execFileSync` timeouts) go red purely from machine load. Check `uptime`
before believing them.

The original sampled table:

| Test | Assert that fails |
|---|---|
| `test-regedit-deep` | `tree displays classic folder glyphs (0 yellow px)` |
| `test-mspaint-options` | `tool-options margin stayed button-face gray` |
| ~~`test-spider-messagebox`~~ | FIXED `dcbc468` — the assert pinned the retired JS renderer's 64,64,64 outer shadow; Win98's COLOR_3DDKSHADOW is black (every Plus! 98 `.the` ships `ButtonDkShadow=0 0 0`). Emulator was correct. Also filled in the missing `GetSysColor` indices 21/23/24. 7/7. |
| ~~`test-find-cancel`~~ | FIXED `35bb495` — the test clicked (390,72), which is inside the dialog's *client* area; the close box is x 379..395, y 45..59. Emulator was correct. New `close-click:TARGET` input action derives the point from the live window rect. 11/11. |
| ~~`test-solitaire-resize`~~ | FIXED `c7efdb6` — the test pressed 19px below the window (it assumed y=20, Solitaire opens at y=0), so it grabbed nothing. Resize itself always worked. Now drags the live corner via a new `corner-drag` input action. 3/3. |
| ~~`test-cwordzap-render`~~ | FIXED `e2503be` — **a real emulator bug**, unlike the others here: `StretchDIBits` rejected BI_RLE4/BI_RLE8 outright (`$gdi_raster_desc_from_bmi` accepts only BI_RGB/BI_BITFIELDS), so the splash drew nothing. Now decoded through the existing `$gdi_bitmap_create_dibitmap` path. 7/7. |

Most plausible sources, both of which landed **without an e2e run**:

- `eff03cb` "Delete the JavaScript text path" + `45e58ae` (fonts session; it said
  outright that the e2e tier was never run against either commit)
- the `WNDPROC_DIALOG 0xFFFE0002 -> 0xFFFF0004` move (board entry 22:30), which
  fits the `find-cancel` dialog-hwnd failures

**Next step:** run `bash test/run-all.sh e2e` at the commit *before* the font-path
deletion, in a worktree, and diff the FAIL name sets against the current run.

**Do not repeat the mistake that wasted the last attempt:** the abandoned worktree
at `~/.claude/jobs/b303255f/tmp/wt5` symlinked only `test/binaries`, so it had no
fonts and failed 83+ tests including every `test-wat-gdi-*`. Its numbers are
meaningless. Delete it. A baseline worktree needs the font assets too.

---

## 1. Win16 / NE — Phase 6: three of the four are playable, one is complete

Phase 1 (`0c23c78`) loads and links NE images, Phase 2 (`84c98a1`) runs them,
Phase 3 (`ff6f45a`, `9a0f12f`, `3b18812`, `90e548a`) gives them an API layer,
Phase 4 (`919f011`, `5e8a9f3`, `e78ba7f`, `0af03d5`) adds NE DLL loading, and
Phase 5 (`d5a09f7`) gets Hearts running.

Phase 6 (`fd04a70`, `df6b6b5`, `653da1d`, `3716c6f`, `f82cc5d`, `7f464ce`,
`72b3ba8`) makes them look right rather than merely run.

**Minesweeper is complete** — Game/Help menu, red LED counters, yellow smiley,
raised minefield. **Solitaire deals a full hand, and keeps dealing** — stock,
four foundations, seven tableau columns each with its face-up top card over a
face-down fan, hand after hand. **FreeCell deals a full board out of
CARDS.DLL** — eight columns of card faces, free cells, "FreeCell Game #2574"
in the title (it opens empty by design; Game▸New Game, command 102, deals).
**Hearts creates its frame, its status bar and its buttons, runs its message
loop, initialises DDEML and puts up a real message box.** All four are in the
browser shell under "16-bit (Win16 / NE)" (`8dc244e`), covered by
`test/test-win16-web.js`, which asserts Minesweeper's colour art, that both
card games actually deal, and that Solitaire's *second* hand is as full as its
first.

Most of the bugs behind the previously-empty tables were **not** Win16-only
and are worth knowing about for 32-bit apps too:

- `$handle_AdjustWindowRectEx` ignored `dwExStyle` while
  `$defwndproc_do_nccalcsize` honours it, so any `WS_EX_CLIENTEDGE` window
  sized through it came back four pixels narrower than the app asked for.
- `$handle_PatBlt` reads its width and height back off the stack frame rather
  than from its arguments — the Win16 bridge wrote only the rop there, so
  every 16-bit `PatBlt` filled a garbage rectangle. It is the only handler in
  the bridge that reads past argument 2; the other 97 were audited.
- `GetDeviceCaps(NUMCOLORS)` answered Win32's `-1`, which a 16-bit caller
  compares as a signed word. Minesweeper's `cmp ax,2 / jle` therefore chose
  its monochrome bitmap set and drew the whole board in 1-bit art.
- `$menu_load` and `rsrc_exists` both meant "PE resource", so no 16-bit app
  had a menu bar. An NE menu is the same MENUITEMTEMPLATE with ANSI labels.
- **A DLL's exported prologue was never patched.** `push ds / pop ax / nop` is
  three bytes the linker leaves meaning "AX = the caller's DS", and the loader
  is expected to replace them with `mov ax, DGROUP`. Without it every export
  runs on its caller's data segment and reads the caller's variables as its
  own — nothing faults, it just reads the wrong memory. CARDS.DLL found
  FreeCell's data where its card-bitmap cache should be.
- **A 16-bit task never became the active window.** WM_ACTIVATEAPP,
  WM_ACTIVATE and WM_SETFOCUS are delivered from CreateWindowExA through
  32-bit continuation thunks, which a 16-bit task cannot be resumed on.
- ShowWindow's WM_SIZE arrived *after* whatever WinMain posted, rather than
  before it as on Windows, so Solitaire dealt onto a table with no layout.
- **The local heap never reused a freed block.** `LocalFree` was a no-op and
  `LocalAlloc` a bump pointer. An app that churns — Solitaire allocates a node
  per card and frees all 28 on the next deal — exhausts a 4KB heap in two
  hands. A NULL from LocalAlloc is rarely reported by the caller, so this
  reads as a feature quietly not working rather than as an error.

The address scheme, because everything else depends on it: every segment base
is 64KB aligned, so the low word of a linear address *is* the offset inside its
segment. `$esp` therefore stays a linear address with SP as its low half, and
the pre-existing 16-bit push/pop handlers needed no changes at all.

- Files: `src/05c-seg16-ops.wat` (handlers 363-387 — segmented EA, far
  transfers, segment-register moves, string ops), `src/09e-win16-api.wat` (the
  API layer, ~70 entry points), `src/07-decoder.wat` (`$code16` inverts the
  66/67 prefixes; `$decode_modrm16`), `src/08c-ne-loader.wat`,
  `src/01-header.wat`
- Tooling: `tools/ne-dump.js`, `tools/ne-exports.js`,
  `tools/gen_win16_ordinals.js` → `src/win16-ordinals.generated.json` (1,468
  names, 10 modules; all 269 ordinals the four apps import resolve).
  **`--trace-win16`** logs every call with the ten stack words nearest the top
  (BitBlt's Pascal frame is exactly ten and its destination DC is the deepest)
  and the AX/DX/EIP/ESP that came back, and decodes the 16-bit MSG behind
  `lpMsg` for the four message-pump entry points — reach for it first on
  anything here. `tools/png-probe.js --at=x,y` reads a dumped surface's alpha,
  which is how you tell "filled black" from "never drawn".
  `tools/ne-disasm.js --all` sweeps a whole segment linearly rather than
  following one function to its first `ret`, which is how you grep a module for
  every write to a struct field — none of the `find_*` tools read NE images or
  16-bit ModRM.
  Two facts worth not rediscovering: a Win16 module name is not its filename
  (SOUND ships as `mmsound.drv`), and not every import is by ordinal.

### The three things that make the layer work

**The handle map** (`$win16_h16`/`$win16_h32`). A Win16 handle is 16 bits and
ours are 32-bit values like `0x00310001`. Rather than narrow every allocator,
the two spaces are joined at the dispatch boundary and nothing on the 32-bit
side learns Win16 exists. The table lives in the one arena slot past the last
usable selector, so no far pointer can name it.

**The bridge into the 32-bit handlers** (`$win16_call32_begin`/`_end`). Most of
Win16 is Win32 with narrower arguments, so the Win16 side widens onto a scratch
stdcall frame and calls `$handle_*` directly. It refuses a handler that moved
EIP (marker `0xCA16A9F7`), because a redirect into guest code carries a 32-bit
frame a 16-bit task cannot survive — ShowWindow and CreateWindow are written
out for that reason.

**The continuation** (`$WIN16_CONT_OFFSET`). An API that must run the window
procedure before returning pushes a far return address into the thunk segment;
`$th_retf16` recognises it and `$win16_dispatch` finishes the API. This is how
CreateWindow delivers WM_CREATE *before* it returns, which matters: Solitaire
never stores the handle CreateWindow gives it, because its WM_CREATE handler
sets the global instead.

### Open

- ~~**Solitaire's deal stops part way.**~~ FIXED `72b3ba8`, and the diagnosis
  in the previous version of this item was wrong in an instructive way — the
  animation tick at `seg 4:0x13ac` is a *drag* tick, `+0x14` means "a card is
  in hand", and it is correctly zero. The deal is synchronous: the loop at
  `seg 4:0xdd3` places all 28 cards every time. What failed was drawing them.
  `$win16_LocalAlloc` was a bump pointer and `LocalFree` a no-op, as its own
  comment admitted; Solitaire allocates one 26-byte node per card and frees all
  28 on the next deal, so a 4KB heap runs dry mid-way through the second hand
  and entirely by the third. A NULL from LocalAlloc is not an error the game
  reports — the pile just declines the card — so it looked like an animation
  that stalled. The heap now has a first-fit free list.
  The two "unexplained" observations were both artifacts of the harness, worth
  writing down so nobody chases them again: `test/run.js` gives the guest a
  synthetic clock of **200ms per batch**, so a 250ms timer is due on nearly
  every pump iteration and thousands of WM_TIMER in a short run are expected
  (the browser uses real time); and `--dump` runs its address through `g2w`, so
  `--dump=0xac00` never reads TIMER_TABLE at all — that address is a raw WASM
  offset below GUEST_BASE, not a guest address.
- ~~**Menu commands crash or draw nothing.**~~ FIXED. Every menu command of
  FreeCell, Solitaire and Minesweeper now runs — `test/test-win16-menus.js`
  drives all of them from each app's own `RT_MENU` via `tools/menu-sweep.js`,
  which is worth reaching for on any app, 16- or 32-bit: "it launches" says
  nothing about the twenty-seven things its menus do. Five causes, and only two
  of them were Win16 plumbing:
  - `SetWindowPos` (USER.232) was missing. Four of FreeCell's five commands go
    through one centre-the-dialog routine that calls it.
  - `ShellAbout` was missing, and reached two different ways: Solitaire and
    Minesweeper import SHELL.22, FreeCell imports the name. A built-in module
    called by name never reached module dispatch at all — `$win16_dispatch`
    trapped first — so there is now a name path beside the ordinal one.
  - `DispatchMessage` entered any non-zero window procedure as a far pointer.
    SendMessage had always checked; nothing had posted to a window of *ours*
    until ShellAbout put one up, and then CS took 0xFFFF.
  - `SetDlgItemText`/`SetDlgItemInt`/`GetDlgItemInt` (USER.92/94/95).
  - **A 16-bit MOVSD copied two bytes and advanced four.** `$th_string16` read
    its packed element size as "byte or word", so the 0x66-prefixed forms —
    which is how a compiler copies a RECT in one instruction pair — moved half
    the data and left every other word stale. This is an execution-core bug,
    not a Win16-layer one, and it is the reason Solitaire's Deck dialog drew
    twelve unreadable smears while opening perfectly well. Also fixed: the
    DRAWITEMSTRUCT behind WM_DRAWITEM is 48 bytes in Win32 and 26 in Win16, and
    a 16-bit procedure `les`-es the pointer it is handed, so it is now rebuilt
    in the task's own DGROUP (`$win16_msg_lparam16`, scratch reserved at the
    bottom of DGROUP by the NE loader).
- ~~**Hearts goes straight to the client path and finds no dealer.**~~ FIXED,
  and it was five bugs in five different layers, none of them the DDE guess the
  previous version of this item made. Hearts now puts up its own startup dialog
  ("What is your name?" / "I want to be dealer"), OK closes it, and it goes on
  to ask for the dealer's computer name — `test/test-win16-hearts-startup.js`
  pins the whole sequence.
  - **The command line was `"\r"`, not `""`.** InitTask handed back the DOS
    command tail, carriage-return-terminated. That pointer *is* WinMain's
    lpCmdLine, which is documented null-terminated, so MFC compared the first
    byte, saw 0x0D, and concluded it had been given a command line telling it
    to join a game. One byte.
  - **Every Win16 dialog-item API read the wrong argument.** `$win16_arg16` is
    ESP-relative and `$win16_call32_begin` moves ESP to the 32-bit scratch
    stack, so an argument read after the bridge opens comes off that frame
    instead — index 0 being the zero written there as a return address. Ten
    functions did it, so GetDlgItem asked for control 0 whatever it was passed.
    `$win16_arg16` now traps if called while the bridge is open.
  - **One posted message was delivered twice.** `$handle_PostMessageA` decided
    "is this window another instance's?" with `i32.and`, which evaluates both
    operands — so the host call that queues the message on the owning instance
    ran for our own windows too, and then this side queued it again. Not a
    Win16 bug: any app posting to itself got the message twice.
  - **Creating a dialog never ran the WH_CALLWNDPROC filter.** CreateWindow
    always had; DialogBox did not. MFC attaches its C++ object to the HWND from
    inside that call, and its dialog procedure's first act is to look the object
    back up — it called a virtual through the null it got.
  - **DefDlgProc's share was missing.** MFC subclasses the dialog and passes
    IDOK down the chain expecting the dialog to close, so the procedure our
    window hands back on subclassing has to end the dialog, and the pump has to
    route to the *window* procedure once one is installed rather than to the
    DLGPROC.

  Three more things stood between that and a game, all now fixed:
  - **NDDEAPI.DLL would not load**, and Hearts greys out the whole "How do you
    want to play?" group when it cannot ask `NDdeGetWindow` whether network DDE
    is there. NDDEAPI is now a module the emulator implements, and its one
    entry point answers with a window of ours: DDEML is implemented in WAT
    rather than by a separate agent process, so that is the truthful answer
    rather than a zero. A module we implement has no export table for
    GetProcAddress to read, so the entry point gets a fixed thunk-segment slot
    the way the pumps do.
  - **Control messages are numbered per class from WM_USER in Win16** and in
    distinct ranges in Win32 — BM_, EM_, LB_, CB_, SBM_ and STM_ all start at
    0x400 — so which block a number belongs to can only be decided from the
    class of the window being addressed. `BM_GETCHECK` arriving as 0x400 meant
    every radio button answered "not me".
  - **PeekMessage cannot be bridged the ordinary way.** It is the one handler
    that ends by setting EIP from its own stack frame, so an idle PM_NOREMOVE
    loop yields; across the bridge that address is the scratch frame's zero.

  Hearts now deals: `test/test-win16-hearts-startup.js` drives name, dealer, OK
  and New Game and checks a green table with cards on it.

  **Its menu commands are covered now too** —
  `test/test-win16-hearts-menus.js`, 18 checks, every command on both menus.
  The sweep never reached them because it drives a freshly launched app, and
  Hearts at that moment is inside its modal startup dialog; answering the
  dialog first is what makes the menu bar live. Two commands were broken and
  neither fault was Hearts-specific:

  - **`ClientToScreen` and `ScreenToClient` (USER.28/29) did not exist.** MFC
    centres every dialog with GetParent/GetClientRect/ClientToScreen, so this
    was on the path of any 16-bit MFC dialog. Game > Score died there.
  - **A dialog was never seeded its own first paint.** `$win16_dlg_run` marked
    every *control* dirty and never the dialog window, which no dialog built
    only from controls can notice. Template 502 (the Score Sheet) holds one OK
    button and the task draws the whole score grid from WM_PAINT, so the sheet
    came up as an empty grey box. Painting it then wanted `GDI.56 CreateFont`,
    also missing.

  **CORRECTION to what this file used to say here:** it claimed the DDE server
  wrapper near `seg 1:0x79ec` is never reached and "only the client one ever
  runs", so something upstream had already chosen client mode. That is no
  longer true, and it stopped being true when the startup dialog started
  working. Choosing "I want to be dealer" now takes the server path: a traced
  dealer run calls `DdeInitialize`, eight `DdeCreateStringHandle`,
  `DdeNameService` and three `DdePostAdvise`, and **never** `DdeConnect`. There
  is nothing left to find upstream of the dialog.
- **DDEML conversations: established, but not yet carrying transactions.**
  `src/09f-win16-ddeml.wat` now joins two instances in one room. A registered
  service name is *kept* (it never was — a registration nobody recorded is a
  server no client can find), `DdeConnect` puts a CONNECT on the wire and
  waits, the instance holding that service answers, and both sides record who
  they are talking to. `DdeDisconnect` tells the peer rather than forgetting
  it locally, since a conversation the other side still believes in is a
  server holding a seat for a player who has gone.
  `test/test-win16-dde-room.js` is the gate: two instances, separate memories,
  separate DDE tables, on one loopback segment — 14 checks including that
  nobody answers for a service that was never registered.

  Two things worth knowing before extending it:

  - **The room is one queue with one reader.** `$vsock_pump` owns it and used
    to *discard* any frame whose magic it did not recognise, so a DDE frame was
    eaten before DDEML saw it. It now hands `DDE1` frames to
    `$win16_dde_deliver`. Leaving them queued is not an option either: nothing
    else drains, so the socket stream would stall behind them. Any third
    protocol on this wire has to be demultiplexed in the same place.
  - **`DdeConnect` parks by not returning.** A Win16 API is entered with its
    arguments still on the task's stack and nothing popped until
    `$win16_api_return`, so declining to return re-enters the same call with
    the same arguments next pass. No continuation slot, nothing to unwind.
    This is why it is native rather than bridged — across the Win16 bridge the
    frame it would park on belongs to a scratch stack about to be discarded,
    which is the same reason `PeekMessage` cannot be bridged.

  **Hearts will still not join, and it is NOT a name-matching bug.** Both
  sides were traced and their interned strings dumped out of the handle table
  at guest `0x8F9200` (that address is `WIN16_ARENA + 127*0x10000 + 0x9200`;
  `--dump` reads it directly):

  | | service | topic |
  |---|---|---|
  | dealer registers | `MSHearts` | `Hearts` |
  | client asks for | `\\DEAL\NDDE$` | `Hearts$` |

  That is NetDDE working exactly as designed. The client does not connect to
  the dealer's application at all — it connects to the **NetDDE agent** on the
  named machine (`\\COMPUTER\NDDE$`) and names a **DDE share** as the topic;
  the trailing `$` is the share marker. The agent on the far side looks that
  share up in the machine's share database, which maps `Hearts$` onto the
  local pair (`MSHearts`, `Hearts`), and makes the real connection locally on
  the client's behalf. No string the client sends will ever equal a name the
  dealer registered.

  Hearts does not create the share itself: it imports no NDDEAPI entry
  statically and only `LoadLibrary`s it for `NDdeGetWindow`. On a real Win98
  box the share is part of the *machine*, put there at install time. So the
  piece to write is a **DDE share table** — share name to (service, topic) —
  consulted when a CONNECT names `\\host\NDDE$`, modelling the share database
  a Win98 install ships with. It belongs in the emulator as a table, not as an
  `if (this is Hearts)`.

  ~~**`XTYP_CONNECT` is not offered to the server's own callback.**~~ DONE.
  A DDEML server is not a table of names, it is an application with a callback,
  and that is where it says yes or no. The drain now QUEUES the question and
  the task's own message pump asks it — the callback cannot be run from the
  drain, because `$vsock_pump` is called from inside arbitrary API handlers and
  redirecting EIP there returns into the wrong frame. The callback is entered
  with a far return onto `$WIN16_DDE_CB`, which acts on the answer and then
  finishes the interrupted `GetMessage` with an idle message, so the task's
  loop never notices the detour. A conversation stays in state 2, offered, until
  the application accepts; a refusal is silence, which is what `DdeConnect`
  against a server returning FALSE sees.
  `test/test-win16-dde-connect-callback.js` pins both answers: two instances on
  a loopback segment, both running a real 16-bit message loop, with the
  server's callback a hand-written stub whose answer the test chooses.

  ~~**`DdeClientTransaction` fails, so nothing crosses.**~~ DONE for
  `XTYP_REQUEST`, which is the one Hearts opens with (`Join`). It follows the
  same three steps: the drain queues the question against the conversation it
  arrived on, the pump asks the application, and the handle the callback
  returns is emitted as a DATA frame. The client parks on the shared
  `$win16_dde_park` and the drain turns the reply into a data handle, so
  `DdeGetData` reads it like any other. A transaction nobody answers in time
  fails with `DMLERR_DATAACKTIMEOUT` and **leaves the conversation up** —
  tearing a session down over one slow item would be wrong.

  A conversation now remembers its topic, because `XTYP_REQUEST` hands the
  callback the topic and the item and only the conversation knows the former.

  ~~**`DdePostAdvise` has no advise loops to feed.**~~ DONE, and this is the
  one Hearts actually runs on: its dealer posts an advise after each move
  rather than being polled. A client's `XTYP_ADVSTART` is offered to the
  server's application like any other transaction; if it agrees, the loop is
  recorded against that conversation. `DdePostAdvise` then turns into
  `XTYP_ADVREQ` back to the same application — "what does it say now?" — and
  the answer is pushed as `XTYP_ADVDATA` to a client that is not waiting on
  anything, so it goes straight to *that* application's callback. Asking twice
  for one item does not open two loops, and a loop dies with its conversation:
  one left pointing at a closed conversation would push into a handle that has
  since been reused. `XTYP_POKE` and `XTYP_EXECUTE` cross too.

  `XTYP_WILDCONNECT` works too: a connect naming no service asks who is out
  there, every instance with a service to offer is a candidate, and the
  application is asked what it will serve rather than whether it will serve
  this. An instance serving nothing still answers nobody. `DDE_FBUSY` is
  honoured as its own answer — "not now" is neither yes nor no, so the caller
  keeps waiting and a wait that only ever saw busy ends in `DMLERR_BUSY`
  rather than a timeout. `DdeClientTransaction` uses the caller's `dwTimeout`,
  clamped so a hopeful two milliseconds still gives the far machine a chance.

  **`XTYP_MONITOR` is refused, on purpose.** A monitor is a DDE spy that
  expects to be told about every transaction in the system, and none of that
  is delivered. An instance that registered happily and then saw nothing would
  be the worst outcome — a debugging tool silently reporting that nothing is
  happening — so `DdeInitialize` with `APPCLASS_MONITOR` fails with
  `DMLERR_DLL_USAGE`, which is what Windows uses for a class the DLL will not
  serve. Implement the delivery before accepting the registration.

  **Also fixed while checking the codes:** `DMLERR_LOW_MEMORY` is `0x4007`, not
  `0x4001` — `0x4001` is `DMLERR_BUSY`. Five sites were returning "busy" where
  they meant "out of memory", which an app retrying on busy would loop on.

  **On testing any of this:** use the in-process harness. Two instances on a
  `LoopbackSegment`, each with a real NE loaded so selectors and a message loop
  exist, is deterministic and runs in seconds. The two-process
  `test-win16-hearts-join.js` is the end-to-end shape but it is timing-bound
  and this machine is regularly at load 80–200, where the dealer needs three
  minutes merely to register; it is not in `run-all.sh` for that reason.
  Minesweeper is the host of choice for the in-process tests: Hearts needs
  CARDS.DLL staged before it runs at all, and nothing in these tests is about
  the app.
- ~~**Named resources returned 0.**~~ FIXED. A NAMEINFO id with bit 15 clear
  is not an id: it is an offset from the start of the resource table to a
  Pascal string, and the walker matched integer ids only, so every `Load*`
  handed a string failed outright. That is not a rare corner — Solitaire's
  group icon is stored as `"SOL"`, which is why it had no icon.
  `$win16_find_resource_ex` takes a name to match instead of an id, comparing
  without case the way USER does, and `$win16_res_lookup` picks between the two
  from the argument's selector. `LoadIcon` and `LoadBitmap` go through it.
  `LoadMenu` and `LoadAccelerators` deliberately do **not** yet: they bridge to
  the 32-bit `$handle_Load*A`, which take an integer id and walk the PE tree,
  so accepting a name there means teaching those handlers a second grammar.
  Nothing in the four apps needs it — Hearts' named `HEARTSMENU` arrives by
  another path — so it is left rather than half-done.
- Known execution-core gaps, all of which trap loudly and none of which the
  four apps reach: INT (including the INT 3Fh moveable-segment thunks), 16↔32
  thunking. `tools/ne-dump.js --resources` shows what a module
  actually ships, including named types and ids; `--menus` and `--dialogs`
  decode the RT_MENU and RT_DIALOG templates, which are the two resources whose
  16-bit layout shares nothing with the 32-bit one and so cannot be read with
  `tools/parse-rsrc.js`. `--menus-json=` is what `tools/menu-sweep.js` falls
  back to when the PE walker finds nothing, and `--seg-bytes=N:OFF[:LEN]` reads
  raw segment bytes, which is the only way to look at the DGROUP string a
  disassembly names as `push 0x1e8`.
- Tracing for message-queue problems, added while chasing the Hearts duplicate:
  `--trace-win16` now prints `post ->` for every message going into the posted
  queue and `task-loop ->` / `dlg-pump ->` for every one coming out, each with
  the queue depth. A message delivered twice is either pushed twice or popped
  twice, and only both halves together say which. `--input=N:dump-msgq` prints
  the queue itself, which `--dump` cannot: it lives at WASM 0x400, below
  GUEST_BASE, so that address goes through `g2w` and lands somewhere else.
- ~~**Solitaire showed an empty table, and cards could not be dragged.**~~
  FIXED, and neither was a Solitaire bug.
  - **The initial erase arrived too late.** It was left to the non-client flag,
    which GetMessage drains *after* the post queue — so it landed behind
    whatever the app had posted for itself. Solitaire posts its deal from
    WM_CREATE and draws each card as it deals rather than from WM_PAINT, so the
    erase painted the table green over a hand already laid out and nothing
    asked for it back. The cards appearing "only when you touch a menu" was the
    menu invalidating the window. `$win16_ShowWindow` now posts the erase with
    its own WM_SIZE/activation group, ahead of the app's, which is the order
    Windows gives it: there the erase happens inside ShowWindow before the
    task's message loop runs at all.
    Worth recording what did *not* work, since both look right: invalidating
    the window when the erase is delivered fixes Solitaire but costs a full
    repaint per erase per window, which timed mspaint's tool sweep out; and
    invalidating at ShowWindow is dropped on the floor, because the window has
    no size yet and the paint phase silently discards an empty update rect.
  - **PtInRect had x and y the wrong way round.** Its POINT is one argument
    passed *by value*, so a doubleword push puts x nearest the top of the stack
    — the opposite of the separate x and y of InflateRect beside it. The test
    asked whether (y, x) was in the rectangle, which is false for every card, so
    the button-down that starts a drag found nothing under the cursor. Any
    future Win16 API taking a POINT by value has the same trap: `ChildWindowFromPoint`
    and `WindowFromPoint` are the two that are not implemented yet.
  - `GDI.103 PtVisible` was missing; Solitaire asks it while drawing the stack
    it has picked up. `test/test-win16-solitaire-play.js` covers both the
    untouched deal and a drag that empties the column it came from.
- Structure width is the recurring bug class here, and it is worth stating
  plainly: **a structure that crosses the boundary is a different size in the
  two worlds.** `SystemParametersInfo(SPI_GETWORKAREA)` wrote a 32-bit RECT
  into FreeCell's 8-byte one, four bytes below its own return address, and the
  task returned to zero. A watchpoint on that slot named it in one run. The
  APIs that carry a structure now convert explicitly and stop on one they do
  not know rather than guessing at a width.
- Argument *order* is the second recurring bug class, and it bites in both
  directions: `CreateWindowEx` takes `dwExStyle` as its **first** parameter, so
  Pascal pushes it deepest and no other index shifts, while
  `AdjustWindowRectEx` takes it **last**, where every other index does shift.
- Argument *width* is the third, and it is the nastiest because it is silent
  and delayed. A Win16 `HHOOK`, `HSZ`, `HCONV` and `HDDEDATA` are all **far
  pointers**, not words. Getting one wrong pops two bytes too few, and the
  caller's frame drifts two bytes at a time until some unrelated `RETF` half a
  screen away reads a garbage CS and the trap names a function that has
  nothing to do with it. Do not guess a Win16 signature: `tools/ne-dump.js
  --relocs=N` gives the offset of every import call site and
  `tools/ne-disasm.js` shows what the app actually pushes there.

## 2. Fonts — e2e verification and the original measurement (session `ea1ba02f`)

- Files: `src/10b-gdi-font.wat`, `src/10c-truetype.wat`, `lib/host-imports.js`,
  `lib/font-substitutions.js`, `fonts/substitutions.json`,
  `tools/v86-reference/*`, `test/fixtures/font-metrics.json`,
  `test/test-wat-font-metrics-reference.js`
- Commits `eff03cb`, `45e58ae` have unit coverage and a byte-identical notepad
  render, but **no e2e run** — see item 0, which is largely this.
- Its own stated next step ("#1"): the original measurement question, now that the
  measurement infrastructure exists; item #3 on its list comes free with it.
- Still open and font-shaped: `test-winhelp-reference` fails on
  `WinHelp close glyph differs from Win98`.

## 3. Async I/O demo path (session `410075d6`)

The blocking question is **answered**: the user picked Blobby Volley directly,
so the telnet-first detour is dropped.

- **Blobby Volley single-player is done** (`bd9a56a`) — it plays, with no
  emulator change needed. See `apps/blobby-volley.md`, covered by
  `test/test-blobby-volley.js` (9 checks, e2e tier).
- **The DirectPlay lobby now runs** (`f9e2d25`). `NETZWERKSPIEL` reaches both
  end states: host → `Open` + `CreatePlayer` → "WARTE AUF EINEN GAST…", guest →
  `EnumSessions` → "GEFUNDENE SPIELE: LOCAL SESSION". Covered by
  `test/test-blobby-network.js` (10 checks, e2e tier). Two fixes: the
  `DirectPlayCreate` handler popped 20 bytes for a 3-arg function (which
  quietly killed the game thread), and it was an `E_FAIL` stub even though
  `IDirectPlay3` was already implemented behind `CoCreateInstance`.
- **Still open: traffic between two processes.** `Send` returns `DP_OK` without
  sending, `Receive` returns `DPERR_NOMESSAGES`, and `EnumSessions` fabricates
  its one session — so a host and a guest cannot meet. This is the remaining
  real async I/O, and it pairs with the virtual LAN in item 4:
  `src/09d-winsock.wat` + `lib/vlan-wire.js` already join two emulator
  processes into one room, and the guest screen offers a **Host-IP** field that
  maps straight onto `--vlan-ip`.
- **Telnet** (`apps/telnet.md`) remains available as a cheaper async-I/O proof if
  DirectPlay turns out to be a long haul: 0x0 `WS_POPUP` window, never calls
  `ShowWindow`, pumps forever; the XP console client also needs console
  rendering.

## 4. Virtual LAN / TetriNET (session `b303255f`) — mostly landed

- `ecd3a6b` + `209aa00` now carry the round-trip gate and the prop-atom fix.
  Verified: corpus 106 PASS / 0 FAIL, `test-vlan-tetrinet` 6/6.
- Files: `src/09d-winsock.wat`, `src/09a5-handlers-window.wat`,
  `test/test-vlan-tetrinet.js`, `test/test-wat-winsock-hostname.js`
- Remaining: the browser wiring for the virtual LAN (`lib/vlan-wire.js` currently
  proves loopback + cross-process; the browser side is unbuilt).

## 5. WinHelp (session `351afaf4`) — clean, one open item

- `87a9546` verified: parser 606/7, `test-help` 5/5, `winhelp-dll-macro` 6/6.
- Files: `src/09c6-winhelp-core.wat`, `src/09c7-winhelp-hlp.wat`,
  `src/09c9-winhelp-ui.wat`, `tools/hlp-wat-check.js`
- Open: the close-glyph mismatch above (font work, not parser work).

---

## Cross-cutting, carried over from earlier sessions

- ~~**`CW_USEDEFAULT` ignores only x, not y**~~ — FIXED `7d4d1af`. x and y are a
  pair, so `x=CW_USEDEFAULT` makes the system pick both and ignore the caller's
  y. Solitaire and Notepad now open in the y=20 cascade slot. The 20px shift
  fixed three e2e tests (`solitaire-maximize`, `notepad-find-next-positive`,
  `notepad-find-not-found-msgbox`) and broke exactly one, `notepad-menu`, which
  sampled a fixed desktop point for the File dropdown; its anchor is now derived
  from the live window origin. Verified with a full before/after e2e diff in a
  clean worktree, plus unit 92/2 and corpus 106 PASS / 0 FAIL.
- ~~**mspaint scrollbar travel**~~ — FIXED `2bc5c16`, and it was never an
  emulator bug. `test-mspaint-scrollbar-thumb` (3/5 → 6/6) and
  `test-mspaint-large-scroll` (2/5 → 5/5) were pinned to the geometry of a
  212x283 view; the frame's client inset is now correctly 6px, the view is
  202x274, and Paint's page/4 arrow scroll moved with it. New rot-proof input
  actions in `test/run.js`: `scroll-click`, `scroll-drag`, `dump-scrollbar`,
  `caption-click`, and `assert-standard-scroll` now takes `N%` of the bar's own
  page size. Three mspaint `execFileSync` timeouts also raised to 45s — they are
  hang ceilings, not performance budgets, and were going red on box load alone.
- **Screensaver GDI-bridge regression** — `apps/screensavers.md` Task 0, fixed
  2026-08-15 via the RLE DIB path; re-read before trusting it, since
  `test-cwordzap-render`'s RLE4 asserts are failing again in the current e2e run.
- ~~**d3rm `MeshBuilder::Load` / ProgressiveMesh**~~ — RESOLVED 2026-08-16. The
  `D3DRMERR_NOTFOUND` was correct: our DX SDK extract ships no `camera.x`, and
  the one we had was a ProgressiveMesh copied under that name in April, which a
  MeshBuilder refuses by design. Given a real plain `Mesh` file the viewer loads
  and renders — DX5 D3DIM Viewer `KNOWN_BAD_RENDER` → **PASS**, corpus 106 → 107
  PASS. Retained-mode geometry works; see `apps/screensavers.md` Task 3.
- **CITYSCAP blank screen** (Task 2, MEDIUM), **FOXTROT white silhouettes**
  (Task 1, LOW).
- **CD Player** renders frame and menu but not its transport controls — the only
  other unresolved emulator bug among the sweep WARNs.
- **External-asset WARNs** (not emulator bugs; each names its blocker in
  `test/test-all-exes.js`): Kodak Preview needs OIDIS400+OIADM400, HyperTerminal
  needs HYPERTRM.dll, Welcome98 needs `welcome.dat`, IP Config has no adapter,
  JigSawedME and Rodent2000 need the VB6 runtime, XP EOL is version-gated by
  design.

---

## Hazard worth knowing about

Something in this shared tree rewrites whole `src/` files that other agents have
dirty. A verified `$prop_key` fix was reverted from disk between a read and a
commit; `git commit <path>` then silently committed only the other file, and the
loss was visible only in the `1 file changed` stat. **Check the file count in
commit output — do not assume your hunks landed.**

## Follow-through and 3D performance — user requested 2026-10-01

- [x] Reconcile Codex handoffs and turn unfinished outcomes into tasks
  id: OPS-HANDOFF-FOLLOWTHROUGH
  status: done
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  Next: Complete: all nine original roots and child dispositions mapped to integrated, queued, blocked or deferred outcomes; six missing follow-ups added without launching backlog.
  Done: Each handoff has an explicit disposition: integrated, queued with a task ID, blocked with a concrete reason, or deferred. Update TODOS and STATUS from evidence; distinguish accepted custody from completed implementation. Preserve the automated-review block and deferred Claude ownership.
  Evidence: ops/handoffs/ops-handoff-followthrough.md
  owner: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  accepted: 2026-10-02T04:11:37.233064+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0

- [x] Build a repair queue from failing EXE candidates
  id: EXE-FAILURE-TRIAGE
  status: done
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  Next: Complete:167result hashes checked,5failed/1harness-error deduplicated; actionable findings mapped to Zuma, Pirates route/terrain, SAM production and Q2 traversal tasks. Historical/unknown captures kept distinct.
  Done: Each actionable failure has a candidate-linked task with route, build, evidence, reproduction and done criteria. Distinguish historical/unreviewed evidence, application failures and harness errors; merge duplicates and shared root causes. Unknown or missing captures are not automatically failures. Do not launch the whole corpus concurrently.
  Evidence: ops/handoffs/exe-failure-triage.md; scratch/exe-failure-triage-20261002/run-inventory.json
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  accepted: 2026-10-02T04:11:37.233064+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0

- [x] Reproduce and resolve Zuma startup QueueUserAPC failure
  id: EXE-ZUMA-STARTUP
  status: done
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  candidate: reflexive-zuma-deluxe
  Next: None for startup triage: reviewed title/loading reached on c474288d with no historical missing QueueUserAPC; menu/gameplay unverified and would require a separate task.
  Done: A current reviewed run either demonstrates the historical failure is resolved or reproduces and fixes its cause with a focused regression. Capture startup/menu evidence and exact build/command; do not claim gameplay from a menu alone or add a silent-success stub.
  Evidence: ops/handoffs/exe-zuma-startup.md; ops/handoffs/exe-zuma-preflight.md; scratch/runs/20261002T042949Z-reflexive-zuma-deluxe-startup/result.json
  accepted: 2026-10-02T04:11:37.233064+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  owner: codex:01a0f9db-89c0-73b3-b528-fe8bf239e061
  Notes: Planned60s observation ended normally4290batches/exit0; outer90s guard unused,6084 frozen hashes unchanged. Root reviewed640x480 title/loading PNG; no hang or gameplay claim. Both earlier harness failures preserved.

- [ ] Compare NFS3 speed and correctness in Glide, D3D and original software
  id: NFS3-RENDERER-BENCH
  status: ready
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  candidate: need-for-speed-3-demo
  Next: Verify available backend-review evidence and exact missing package paths; preserve failed renderer-identity gate before any new qualification.
  Done: Report all three guest renderer paths on the same identified source/WASM/browser/CPU/GPU, resolution and controlled race/weather/input route. Separate original game software rendering from our software backend; verify no hidden GPU fallback or SwiftShader substitution. Save reviewed race images, repeated warmed-up FPS/frame-time median and p95, CPU profiles, draw/triangle/texture/upload/readback/fallback counters, sample counts and spread, plus same-path control. Report unavailable paths explicitly. Record bottlenecks and a predeclared performance acceptance budget; historical high-load FPS is not a current baseline.
  Evidence: ops/handoffs/nfs3-renderer-bench.md; scratch/nfs3-renderer-bench-20261002/closure-report.json; scratch/nfs3-renderer-bench-20261002/local-resource-preflight.json; ops/handoffs/nfs3-capacity-recheck.md; ops/handoffs/nfs3-software-prep.md
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  accepted: 2026-10-02T04:11:37.233064+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  Notes: Old worker released at migration. Ricochet launch proof, Collapse association review, NFS3 backend identity and Jazz visual admission remain unresolved; package preparation is not gameplay/FPS acceptance.

- [x] Audit the actual shared 3D rendering pipeline across APIs
  id: RENDER-SHARED-AUDIT
  status: done
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  Next: Complete: main/private API-backend matrices, semantic/resource gaps and proposed slices S1-S5 documented. Backlog implementation awaits scheduling; no broad private merge.
  Done: Publish an implementation-backed API/backend matrix, ownership boundaries, duplicate semantic lowering and remaining divergence, with bounded migration tasks and representative correctness/performance fixtures. Distinguish one shared worker or texture registry from a shared drawing contract. Preserve API-specific semantics at adapters and explicit fallback behavior. Do not claim the proposal is already implemented.
  Evidence: ops/handoffs/render-shared-audit.md; scratch/render-shared-audit-20261002/source-manifest.json
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  accepted: 2026-10-02T04:11:37.233064+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0

- [x] Keep the coordinator picking up tasks and completed handoffs
  id: OPS-COORDINATOR-CONTINUITY
  status: done
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  Next: Use the durable inbox at each queue/handoff boundary under the existing active native goal; refresh truthful runtime evidence and acknowledge exact reviewed notice IDs.
  Done: New ready tasks and worker handoffs are acknowledged and reconciled without manual prompting, with deduplicated wake requests and at most one coordinator. Never send wake text into a tool approval or a busy terminal. Test idle, busy, approval, disconnect and restart cases using fixtures. Before going idle, convert unfinished outcomes into follow-ups and record why remaining work cannot proceed; do not bypass blocked review or take deferred claims.
  Evidence: ops/handoffs/coordinator-continuity.md; ops/coordinator-inbox.js; ops/coordinator-inbox.test.js; scratch/coordinator-live-scan.json; scratch/coordinator-live-ack-restart.json; scratch/coordinator-natural-handoff.json
  accepted: 2026-10-02T04:11:37.233064+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  owner: codex:01a0f9db-4a5d-7733-ade9-8b71d8e3f05f
  Notes: 10 fixture tests PASS; live busy scan51 notices,2 exact ack/restart persistence, and natural Zuma handoff change delivered with prior version retained until explicit ack.4 notices acknowledged total; remaining pending preserved. Native goal owns continuation; no wake daemon or terminal input.

- [ ] Implement the next bounded shared 3D command-contract slice
  id: RENDER-SHARED-IMPLEMENT
  status: backlog
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  depends-on: RENDER-SHARED-AUDIT
  Next: Use the audited matrix to select and record the smallest shared semantic slice, exact owned files and per-API regression cases before implementation.
  Done: The chosen slice uses one explicit drawing/resource contract with thin API adapters and GPU/software executors, removes the corresponding duplicate interpretation, and passes differential pixel/state/resource-lifetime and ordering tests for affected APIs plus representative game captures. Record unsupported semantics and remaining migration tasks; a shared worker alone is not completion.
  Evidence: docs/render-command-unification.md; ops/handoffs/mig-render-textures-validation.md

- [ ] Profile and optimize the shared 3D path with repeatable performance gates
  id: RENDER-PERF-GATE
  status: backlog
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  depends-on: NFS3-RENDERER-BENCH, RENDER-SHARED-AUDIT
  Next: Select the largest measured shared bottleneck from the renderer matrix, declare workload/metric/regression budget and compare one bounded change against an unchanged control on a quiet host.
  Done: Show repeatable improvement beyond control noise with unchanged reviewed images/state and no regression beyond the declared budgets across representative legacy D3D, D3D8/9, OpenGL and Glide GPU/software workloads. Attribute CPU emulation, translation, submission, GPU, readback and presentation costs separately. Save raw measurements/profiles/build hashes and reject changes whose gains disappear in game routes. No default switch on microbenchmark-only evidence.
  Evidence: docs/render-command-unification.md; docs/re-notes/need-for-speed.md; ops/handoffs/mig-fp-kernel.md

- [ ] Diagnose Pirates stopping before the target rendering operation
  id: PIRATES-ROUTE-FOLLOWUP
  status: backlog
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  candidate: pirates-2004
  Next: Review the stopped captain-route evidence and transferred ownership; define a bounded reproduction that reaches the actual StretchRect operation without disturbing the retained reference service.
  Done: Identify the route failure and either validate the actual game transfer/readback with reviewed images or record a precise blocking dependency. Link unresolved terrain defects separately; a zero-transfer run is not a rendering pass.
  Evidence: ops/handoffs/mig-pirates-stretch.md; ops/handoffs/mig-pirates-stretch-recipe.md

- [ ] Verify Quake II world traversal beyond a changed frame
  id: Q2-MOVEMENT-FOLLOWUP
  status: backlog
  created: 2026-10-02T04:00:31.545Z
  created-by: user-request via ops-dashboard
  candidate: quake-2-demo-installer
  Next: Extend the existing shared-registry route with controlled movement and a verifiable position or landmark change.
  Done: Reviewed before/after world captures and position/landmark evidence demonstrate actual traversal, with exact build, route and renderer provenance. Retain texture/resource checks and distinguish movement from animation or camera-only changes.
  Evidence: ops/handoffs/mig-render-q2.md

- [x] Recover and review screenshots and diagrams from historical runs
  id: OPS-HISTORICAL-VISUALS
  status: done
  created: 2026-10-02T04:03:23.368Z
  created-by: user-request
  Next: None for this bounded recovery/audit. Unlinked-candidate and unresolved-association searches are recorded separately as backlog; no new game runs or automatic restorations.
  Done: Publish confidently associated screenshots/diagrams as file-backed run bundles with exact original path, content hash, source timestamp basis, build/route when known and provenance. Link candidate, session and task only with evidence; unknowns stay unknown. Deduplicate by image hash, visually inspect contact sheets, classify blank/loading/error/gameplay captures and select a representative frame. Preserve failed/black-frame evidence in run details rather than deleting or calling it a pass. Review the 147 previously quarantined ambiguous bundles; restore only verified associations, never infer GeneRally from prose containing generally. Produce a coverage report listing recovered images, missing sources and unresolved associations; do not execute historical commands or rerun games to fabricate historical captures. Keep historical/unreviewed status explicit, and link failures to EXE-FAILURE-TRIAGE without claiming current compatibility.
  Evidence: ops/handoffs/ops-visual-acceptance.md; ops/handoffs/ops-quarantine-review.md; ops/handoffs/ops-visual-coverage.md; scratch/ops-visual-acceptance-20261002/final-verification.json
  accepted: 2026-10-02T04:11:37.233064+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  owner: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  Notes: Final18images/18distinct hashes and metadata verified; seven new images reviewed,522protected inputs unchanged,441quarantine files preserved.147rows reconcile9supported/5incorrect/133unresolved with rootNFS2proof. All9supported rows and separately correctedNFS3 copy published; coverage30of76,46unlinked. No current compatibility/performance claim.

## Original handoff follow-ups — reconciled 2026-10-02

- [ ] Validate FP variants in matched-work game windows
  id: FP-GAME-GATES
  status: backlog
  created: 2026-10-02T04:16:51.185761+00:00
  created-by: orchestrator-handoff-audit
  depends-on: MIG-FP-KERNEL
  Next: Prepare P/P control and P/PCM/PCP game windows with FP_SHARE_CALENDAR=1, reviewed pixels/API/tier counters and exact host identities.
  Done: Matched work and meaningful timing precision/control established, or exact failed gate recorded; no default switch from microkernel evidence.
  Evidence: ops/handoffs/fp-next-root.md; ops/handoffs/mig-fp-kernel.md

- [!] Complete Serious Sam production integration and ordinary gameplay
  id: SAM-PRODUCTION-FOLLOWTHROUGH
  status: blocked
  created: 2026-10-02T04:16:51.185761+00:00
  created-by: orchestrator-handoff-audit
  depends-on: MIG-SAM-REP-RESTART
  candidate: serious-sam-demo
  Next: After REP review clears, validate generic fault/classifier contracts, integrate only owned tested timer/TLS/memory slices and review diagnostic transform removal before launcher/input work.
  Done: Production build reaches menu and level with supported input, verified movement/combat and no private diagnostic shortcuts; exact source/module and focused regressions retained.
  Evidence: ops/handoffs/mig-sam-fault-remainder.md; ops/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd.md
  blocker: REP validation remains incomplete after automated review; do not retry through another channel.
  waiting-on: MIG-SAM-REP-RESTART review resolution

- [ ] Integrate tested private renderer changes without losing main work
  id: RENDER-PRIVATE-INTEGRATION
  status: backlog
  created: 2026-10-02T04:16:51.185761+00:00
  created-by: orchestrator-handoff-audit
  depends-on: RENDER-SHARED-AUDIT
  Next: Use audit to select a coherent private patch, reconcile intervening main changes and create a frozen integration candidate; exclude unvalidated empty-quad optimization.
  Done: Selected changes validated on current integration base with affected API games/tests and exact identities; unvalidated changes kept separate and any merge follows explicit ownership review.
  Evidence: ops/handoffs/01a0eb29-4302-7e20-9b06-7084fb37358b.md; ops/handoffs/mig-render-textures-validation.md

- [ ] Diagnose Pirates white terrain with a controlled capture
  id: PIRATES-TERRAIN-REVIEW
  status: backlog
  created: 2026-10-02T04:16:51.185761+00:00
  created-by: orchestrator-handoff-audit
  depends-on: PIRATES-ROUTE-FOLLOWUP
  candidate: pirates-2004
  Next: Separate terrain rendering from the captain-route stop and reproduce the visible defect on an identified reachable gameplay state.
  Done: Reviewed terrain evidence identifies the failing contract and focused correction or concrete dependency; no zero-transfer pass used as terrain proof.
  Evidence: ops/handoffs/01a0f736-78f1-7822-8b37-159d6f8ed94d.md

- [ ] Review nested transfer packet preservation
  id: PIRATES-TRANSFER-REENTRANCY
  status: backlog
  created: 2026-10-02T04:16:51.185761+00:00
  created-by: orchestrator-handoff-audit
  candidate: pirates-2004
  Next: Audit per-instance StretchRect packet/stage state across nested same-thread callbacks and existing render-token snapshots before claiming reentrancy.
  Done: Explicit ownership/lifetime contract and focused nested-call regression, or exact unsupported case recorded; no unchecked pooling/copy removal.
  Evidence: ops/handoffs/01a0f736-78f1-7822-8b37-159d6f8ed94d.md

- [ ] Reconcile remaining historical recovery changes against current main
  id: RECOVERY-PATCH-RETRIAGE
  status: backlog
  created: 2026-10-02T04:16:51.185761+00:00
  created-by: orchestrator-handoff-audit
  Next: Perform read-only patch-equivalence audit of codex/recovery-main-20260910 and current main, separating landed, obsolete and missing runtime/overlay/save/screensaver changes.
  Done: Each remaining change has current evidence and explicit disposition/task; no stale branch bulk merge or old-build acceptance reused.
  Evidence: ops/handoffs/01a08812-a2da-7333-83fc-851ef8fff7b1.md


- [ ] Measure browser FPS for strongest local and desktop game candidates
  id: OPS-GAME-FPS-BASELINE
  status: ready
  candidate: jazz-jackrabbit-2-demo-installer, reflexive-collapse-crunch, reflexive-ricochet-xtreme, unreal-special-edition, gta2-demo
  done: Publish run performance metadata with guest present counts, wall duration, per-sample p95 frame time, renderer/GPU, hardware-versus-SwiftShader, scene, build hash and measurement date; review playable route before measuring. No menu, browser rAF or CLI batch timing relabelled as gameplay FPS.
  Next: Inventory exact available fixtures and released route packages, then qualify gameplay for the first ready candidate; canceled conditional launches stay canceled.
  Notes: Old worker released at migration. Ricochet launch proof, Collapse association review, NFS3 backend identity and Jazz visual admission remain unresolved; package preparation is not gameplay/FPS acceptance.
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  accepted: 2026-10-02T05:21:49.472399+00:00
  accepted-by: codex:01a0f9d8-c0cd-73b3-a357-fb3ff1c784c0
  Evidence: ops/handoffs/ops-game-fps-baseline.md; ops/handoffs/ops-fps-labels.md; ops/handoffs/ops-historical-fps-semantics.md; scratch/ops-gta2-fps-20261002/root-review.md; ops/handoffs/ops-unreal-fps-preparation.md; ops/handoffs/ops-jazz2-package.md; ops/handoffs/ops-collapse-v2-package.md; ops/handoffs/ops-ricochet-measurement.md

- [ ] Investigate remaining unlinked historical visuals and uncertain associations
  id: OPS-HISTORICAL-UNLINKED
  status: backlog
  created: 2026-10-02T05:58:39.995255+00:00
  created-by: orchestrator-historical-audit
  depends-on: OPS-HISTORICAL-VISUALS
  Next: Select a bounded evidence-only batch from46unlinked candidates or133 unresolved exact associations after scheduling; use existing source paths/tests/notes before any separately scoped transcript work.
  Done: Publish only confidently associated existing captures with exact hashes/provenance, update coverage and disposition deltas, preserve originals and explicit unknowns; never rerun games to fabricate historical evidence.
  Evidence: ops/handoffs/ops-visual-acceptance.md; ops/handoffs/ops-quarantine-review.md; scratch/ops-visual-acceptance-20261002/final-verification.json
  Notes: The completed18-image recovery/147-bundle audit remains accepted. This deeper search is unscheduled, not permission to take deferred Claude claims or restore incorrect associations.

## Gameplay coverage and EXE categories — requested 2026-10-03

- [~] Inventory every game and complete gameplay screenshot/FPS coverage
  id: OPS-ALL-GAMEPLAY-COVERAGE
  status: active
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:30:54.631Z
  created-by: user via Telegram
  accepted: 2026-10-03T08:30:54.631Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Continue captures and qualified measurements:95 fresh gameplay scenes,74 limited input responses across107 attempted entries; six qualified logical-frame measurements. All-game coverage remains incomplete.
  Done: Each game has a reviewed actual-gameplay screenshot and valid scene-qualified FPS evidence, or an explicit per-game blocker with exact missing paths; menus, intros and raw Flip event rates are not gameplay FPS.
  Evidence: ops/handoffs/migration-core-ready-20261003.md

- [x] Group games into categories in dashboard EXE corpus
  id: OPS-EXE-CATEGORIES
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:30:54.631Z
  created-by: user via Telegram
  accepted: 2026-10-03T08:30:54.631Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete: live dashboard serves 241 entries in 14 categories; combined category/source/status filters verified.
  Done: Every EXE corpus game has a category, dashboard grouping/filtering works, and source/package groups remain separate from game genre.
  Evidence: ops/handoffs/corpus-categories-20261003.md; scratch/ops-preview/corpus-live-categories.png

## Per-game screenshot and FPS coverage — 2026-10-03

Exact required and missing fixture/artifact paths are recorded in each task JSON.
Categories exclude tools and graphics demos; distribution variants remain explicit.
Ready means assets are present, not gameplay or counter correctness.

- [ ] Gameplay screenshot and FPS: abedemo
  id: GAMEPLAY-abedemo
  status: ready
  candidate: abedemo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete-frame measurement during actual gameplay; retain narrow input scope from reviewed batch17 evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-abedemo.json; scratch/runs/20261003-abedemo-gameplay-restored17/result.json

- [ ] Gameplay screenshot and FPS: aoe1
  id: GAMEPLAY-aoe1
  status: ready
  candidate: aoe1
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete-frame measurement during actual gameplay; retain narrow input scope from reviewed batch17 evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-aoe1.json; scratch/runs/20261003-aoe1-gameplay-restored17/result.json

- [ ] Gameplay screenshot and FPS: aoe2
  id: GAMEPLAY-aoe2
  status: ready
  candidate: aoe2
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Diagnose actual owning-Worker graphics initialization rejection. Unicode repair cleared prior DirectX6.1a failure; ordinary run now shows DirectDraw graphics error, with no gameplay/FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-aoe2.json; scratch/runs/20261003-aoe2-gameplay-restored17/result.json

- [ ] Gameplay screenshot and FPS: Arcanum: Of Steamworks & Magick Obscura Demo
  id: GAMEPLAY-arcanum-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: arcanum-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-arcanum-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-arcanum-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Atomic Bomberman Demo
  id: GAMEPLAY-atomic_bomberman_june_demo
  status: ready
  candidate: atomic_bomberman_june_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-atomic_bomberman_june_demo.json; scratch/runs/20261003-atomic_bomberman_june_demo-gameplay-restored5/result.json

- [ ] Gameplay screenshot and FPS: Baldur's Gate Chapters I & II
  id: GAMEPLAY-baldurs-gate-chapters-1-2-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: baldurs-gate-chapters-1-2-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-baldurs-gate-chapters-1-2-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-baldurs-gate-chapters-1-2-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Baldur's Gate interactive demo
  id: GAMEPLAY-baldurs-gate-interactive-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: baldurs-gate-interactive-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-baldurs-gate-interactive-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-baldurs-gate-interactive-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [!] Gameplay screenshot and FPS: Baldur's Gate non-interactive demo
  id: GAMEPLAY-baldurs-gate-noninteractive-demo
  status: deferred
  candidate: baldurs-gate-noninteractive-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Noninteractive presentation demo: retain screenshot evidence separately; gameplay FPS is not applicable.
  Done: Document noninteractive scope and preserve any reviewed presentation captures; gameplay FPS is not applicable.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-baldurs-gate-noninteractive-demo.json

- [ ] Gameplay screenshot and FPS: Best Of Moorhuhn extras
  id: GAMEPLAY-best-of-moorhuhn
  status: ready
  candidate: best-of-moorhuhn
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Confirm in-round Training1 action, cover other playable package variants, then qualify complete-frame measurements.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-best-of-moorhuhn.json; scratch/runs/20261003-moorhuhn_training_1-gameplay-restored14/result.json

- [ ] Gameplay screenshot and FPS: Black & White 2 Demo
  id: GAMEPLAY-black_white_2_demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: black_white_2_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-black_white_2_demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-black_white_2_demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [x] Gameplay screenshot and FPS: Blobby Volley
  id: GAMEPLAY-blobby-volley
  status: done
  candidate: blobby-volley
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete for reviewed ordinary gameplay and instrumented logical submissions: 467 frames /15.312065s =30.4988 logical gameplay frames/s. Physical displayed FPS/p95 unknown; not a hardware-GPU baseline.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-blobby-volley.json; scratch/runs/20261003-blobby-volley-logical-gameplay/result.json; ops/handoffs/gameplay-frame-counter-20261003.md

- [ ] Gameplay screenshot and FPS: Bricks
  id: GAMEPLAY-bricks
  status: ready
  candidate: bricks
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Title click starts the level 1 sliding-block board. Drag (305,293) to (259,293) shows no verified block displacement. Puzzle scene reviewed; controls and completed move remain unverified. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-bricks.json; scratch/runs/20261003-bricks-gameplay-restored1/result.json

- [ ] Gameplay screenshot and FPS: Broken Sword Demo
  id: GAMEPLAY-broken_sword_demo
  status: ready
  candidate: broken_sword_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete-frame measurement; reviewed response is hotspot cursor only, walking unverified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-broken_sword_demo.json; scratch/runs/20261003-broken-sword-cafe-hotspot/result.json

- [ ] Gameplay screenshot and FPS: Caesar III Demo
  id: GAMEPLAY-caesar3_demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: caesar3_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-caesar3_demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-caesar3_demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Captain Claw Demo
  id: GAMEPLAY-captain_claw_demo
  status: ready
  candidate: captain_claw_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-captain_claw_demo.json; scratch/runs/20261003-captain_claw_demo-gameplay-restored5/result.json

- [x] Gameplay screenshot and FPS: Cave Story
  id: GAMEPLAY-cave-story
  status: done
  candidate: cave-story
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualified one short instrumented logical-submission sample:25frames/1003.43ms=24.9145431171/s, mostly stationary opening room after movement/jump. Physical displayed FPS,p95 and sustained performance remain unknown.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-cave-story.json; scratch/runs/20261003-cave-story-logical-gameplay/qualification.json; scratch/runs/20261003-cave-story-logical-gameplay/result.json

- [ ] Gameplay screenshot and FPS: Civilization II: Multiplayer Gold Edition
  id: GAMEPLAY-civilization-2-mge-win32
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: civilization-2-mge-win32
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-civilization-2-mge-win32.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-civilization-2-mge-win32.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Sid Meier's Civilization II
  id: GAMEPLAY-civilization-2-win16
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: civilization-2-win16
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-civilization-2-win16.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-civilization-2-win16.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Cruel
  id: GAMEPLAY-cruel
  status: ready
  candidate: cruel
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed drag of exposed 2 diamonds to A diamonds foundation: foundation now shows 2 diamonds and source pile exposes 5 diamonds. Ordinary completed card move; limited route only, no FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-cruel.json; scratch/runs/20261003-cruel-gameplay-ready2/result.json

- [ ] Gameplay screenshot and FPS: Curse of Monkey Island Demo
  id: GAMEPLAY-curse_monkey_island_demo
  status: ready
  candidate: curse_monkey_island_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-curse_monkey_island_demo.json; scratch/runs/20261003-curse_monkey_island_demo-gameplay-restored5/result.json

- [ ] Gameplay screenshot and FPS: CWordZap
  id: GAMEPLAY-cwordzap
  status: ready
  candidate: cwordzap
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Ordinary Ready click starts letter board; selecting S O T places letters into word row and End Word displays SOT. Score remains0:0; no accepted-word/scoring claim. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-cwordzap.json; scratch/runs/20261003-cwordzap-gameplay-restored2/result.json

- [ ] Gameplay screenshot and FPS: Darkstone Demo
  id: GAMEPLAY-darkstone_demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: darkstone_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-darkstone_demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-darkstone_demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Deus Ex demo
  id: GAMEPLAY-deus-ex-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: deus-ex-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-deus-ex-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-deus-ex-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Diablo Demo
  id: GAMEPLAY-diablo_demo
  status: ready
  candidate: diablo_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Diagnose persistent dark transition after complete name entry; prior served-source closure rejection recorded, future helper includes all library JavaScript. No gameplay/FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/runs/20261003-diablo-demo-full-name-stall/result.json; scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-diablo_demo.json

- [ ] Gameplay screenshot and FPS: Diablo II Demo
  id: GAMEPLAY-diablo-2-demo-installer
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: diablo-2-demo-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-diablo-2-demo-installer.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-diablo-2-demo-installer.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Diablo Shareware
  id: GAMEPLAY-diablo-shareware
  status: ready
  candidate: diablo-shareware
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete-frame measurement during actual gameplay; retain narrow input scope from reviewed batch17 evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-diablo-shareware.json; scratch/runs/20261003-diablo_shareware-gameplay-restored17/result.json

- [ ] Gameplay screenshot and FPS: Dungeon Keeper Demo
  id: GAMEPLAY-dungeon_keeper_demo
  status: ready
  candidate: dungeon_keeper_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete ordinary menu-to-gameplay input route with exact failed-request logging; no active scene or specific compatibility fault established.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-dungeon_keeper_demo.json; scratch/runs/20261003-dungeon_keeper_demo-gameplay-restored5/result.json

- [x] Gameplay screenshot and FPS: DX-Ball
  id: GAMEPLAY-dxball
  status: done
  candidate: dxball
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete narrow evidence: reviewed control/gameplay images and three independent short instrumented windows,60.219 logical gameplay frames/s. Physical display FPS and sustained performance unknown; rejected attempts preserved.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-dxball.json; scratch/runs/20261003-dxball-logical-gameplay/result.json; scratch/runs/20261003-dxball-logical-gameplay/qualification.json

- [ ] Gameplay screenshot and FPS: Elasto Mania
  id: GAMEPLAY-elasto-mania
  status: ready
  candidate: elasto-mania
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Ordinary Enter progression reaches Level16 NewWave motorcycle field. Up held1200ms overlaps loading, and only one final field capture is available; acceleration/control response is unverified. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-elasto-mania.json; scratch/runs/20261003-elasto_mania-gameplay-restored3/result.json

- [ ] Gameplay screenshot and FPS: EmPipe
  id: GAMEPLAY-empipe
  status: ready
  candidate: empipe
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Next starts pipe puzzle; click (186,185) places an elbow pipe in the red grid. Start/finish and upcoming pieces visible. No completed puzzle or score progression claim. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-empipe.json; scratch/runs/20261003-empipe-gameplay-restored1/result.json

- [ ] Gameplay screenshot and FPS: Fallout demo
  id: GAMEPLAY-fallout-demo
  status: ready
  candidate: fallout-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-fallout-demo.json; scratch/runs/20261003-fallout_demo-gameplay-restored5/result.json

- [ ] Gameplay screenshot and FPS: FourStones
  id: GAMEPLAY-fourstones
  status: ready
  candidate: fourstones
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Start then column-entry click places red stone bottom-left and computer replies blue in column4. One move/reply only. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-fourstones.json; scratch/runs/20261003-fourstones-gameplay-restored2/result.json

- [ ] Gameplay screenshot and FPS: FreeCell
  id: GAMEPLAY-freecell
  status: ready
  candidate: freecell
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-freecell.json; scratch/runs/20261003-freecell-gameplay-restored9/result.json

- [ ] Gameplay screenshot and FPS: freecell16
  id: GAMEPLAY-freecell16
  status: ready

  candidate: freecell16
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Setup and ordinary card move now pass on worker-owned input routing fix. Reviewed gameplay image saved; qualify a meaningful per-game frame measurement. Dialog clipping remains.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-freecell16.json; scratch/runs/20261003-freecell16-gameplay-worker-route/result.json; ops/handoffs/win16-dialog-worker-trap-20261003.md

- [ ] Gameplay screenshot and FPS: Funtris
  id: GAMEPLAY-funtris
  status: ready
  candidate: funtris
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Implement bounded gravity-update/input-response metrics from source plan; no proven complete-frame boundary, so gameplay FPS remains unknown. Reviewed gameplay/input saved; never relabel GDI tile blits or gravity updates as frames.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-funtris.json; scratch/runs/20261003-funtris-gameplay-restored2/result.json; ops/handoffs/funtris-frame-counter-plan-20261003.md

- [ ] Gameplay screenshot and FPS: Gallinelle XXL
  id: GAMEPLAY-gallinelle-xxl
  status: ready
  candidate: gallinelle-xxl
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete gameplay frame measurement; active hunting scene and ammo decrement reviewed, no hit or sustained-play claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/runs/20261003-gallinelle-gameplay/result.json; scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gallinelle-xxl.json

- [ ] Gameplay screenshot and FPS: GeneRally
  id: GAMEPLAY-generally
  status: ready
  candidate: generally
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Run corrected post-countdown gate allowing00.00 before first movement; verify driving. Intro overlay stayed identical30sec until ordinary Enter acknowledged it. After countdown, track and car visible with no overlay/lights; timer00.00. Overly strict private gate incorrectly required nonzero timer before movement, so no driving input issued before120sec deadline. Gate corrected offline; no movement claim. FPS remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-generally.json; scratch/runs/20261003-generally-gameplay-restored4/result.json

- [ ] Gameplay screenshot and FPS: Beneath a Steel Sky GOG installer
  id: GAMEPLAY-gog-free-beneath-a-steel-sky
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gog-free-beneath-a-steel-sky
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-beneath-a-steel-sky.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-beneath-a-steel-sky.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: The Elder Scrolls: Arena GOG installer
  id: GAMEPLAY-gog-free-elder-scrolls-arena
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gog-free-elder-scrolls-arena
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-elder-scrolls-arena.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-elder-scrolls-arena.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: The Elder Scrolls II: Daggerfall GOG installer
  id: GAMEPLAY-gog-free-elder-scrolls-daggerfall
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gog-free-elder-scrolls-daggerfall
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-elder-scrolls-daggerfall.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-elder-scrolls-daggerfall.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Flight of the Amazon Queen GOG installer
  id: GAMEPLAY-gog-free-flight-of-the-amazon-queen
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gog-free-flight-of-the-amazon-queen
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-flight-of-the-amazon-queen.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-flight-of-the-amazon-queen.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Lure of the Temptress GOG installer
  id: GAMEPLAY-gog-free-lure-of-the-temptress
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gog-free-lure-of-the-temptress
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-lure-of-the-temptress.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-lure-of-the-temptress.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Shadow Warrior Classic Complete GOG installer
  id: GAMEPLAY-gog-free-shadow-warrior-classic
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gog-free-shadow-warrior-classic
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-shadow-warrior-classic.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-shadow-warrior-classic.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Ultima IV: Quest of the Avatar GOG installer
  id: GAMEPLAY-gog-free-ultima-iv
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gog-free-ultima-iv
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-ultima-iv.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gog-free-ultima-iv.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Golf
  id: GAMEPLAY-golf
  status: ready
  candidate: golf
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed stock click: stock count changes 16 to 15 and J clubs appears over A spades waste. Limited one-draw card-game route only; no FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-golf.json; scratch/runs/20261003-golf-gameplay-ready2/result.json

- [ ] Gameplay screenshot and FPS: Grand Theft Auto 2 demo
  id: GAMEPLAY-gta2-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: gta2-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gta2-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-gta2-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Half-Life: Uplink
  id: GAMEPLAY-half-life-uplink-installer
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: half-life-uplink-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-half-life-uplink-installer.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-half-life-uplink-installer.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Heroes of Might and Magic II demo
  id: GAMEPLAY-heroes-2-demo
  status: ready
  candidate: heroes-2-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Use verified adventure-map route and capture one isolated hero movement, then qualify complete-frame measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-heroes-2-demo.json; scratch/runs/20261003-heroes2_demo-gameplay-restored15/result.json

- [ ] Gameplay screenshot and FPS: Heroes of Might and Magic III demo
  id: GAMEPLAY-heroes-3-demo-installer
  status: ready
  candidate: heroes-3-demo-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete-frame measurement during actual gameplay; retain narrow input scope from reviewed batch17 evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-heroes-3-demo-installer.json; scratch/runs/20261003-heroes3_demo-gameplay-restored17/result.json

- [ ] Gameplay screenshot and FPS: Hitman Demo 2 (Glide 3, experimental)
  id: GAMEPLAY-hitman_glide_demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: hitman_glide_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-hitman_glide_demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-hitman_glide_demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Hype Demo (Glide 3, experimental)
  id: GAMEPLAY-hype_glide_demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: hype_glide_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-hype_glide_demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-hype_glide_demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Icewind Dale demo
  id: GAMEPLAY-icewind-dale-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: icewind-dale-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-icewind-dale-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-icewind-dale-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [x] Gameplay screenshot and FPS: Icy Tower
  id: GAMEPLAY-icy-tower
  status: done
  candidate: icy-tower
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Narrow screenshot/measurement requirement fulfilled:49.98875253 logicalsubmissions/s,50frames/1000.225ms on5ff4844e, one instrumented mostlystationary platform sample after ordinary movement/jump. Sustained performance, physical displayFPS andp95 remain unknown.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: ops/handoffs/icy-tower-logical-measurement-20261003.md; scratch/runs/20261003-icy-tower-logical-gameplay/result.json; scratch/gameplay-icy-tower-counter-20261003/attempt7/root-measurement-review.json

- [ ] Gameplay screenshot and FPS: Jardinains!
  id: GAMEPLAY-jardinains
  status: ready
  candidate: jardinains
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete ordinary menu-to-gameplay route; preserve menu-only evidence and unknown input mapping.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-jardinains.json; scratch/runs/20261003-jardinains-gameplay-restored12/result.json
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Jazz Jackrabbit 2 demo installer
  id: GAMEPLAY-jazz-jackrabbit-2-demo-installer
  status: ready
  candidate: jazz-jackrabbit-2-demo-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete intro/menu route with timely ordinary Escape inputs and reach a player-controlled level; previous intro-only deadline is inconclusive.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-jazz-jackrabbit-2-demo-installer.json; scratch/runs/20261003-jazz2_demo-gameplay-restored15/result.json

- [~] Gameplay screenshot and FPS: jigssawme
  id: GAMEPLAY-jigssawme
  status: active
  candidate: jigssawme
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Localize valid BMP image-open failure from ordinary Upload; startup repair verified, no puzzle scene or FPS yet.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-jigssawme.json; scratch/runs/20261003-jigssawme-custom-bmp-image-failure/result.json

- [ ] Gameplay screenshot and FPS: Liquid War
  id: GAMEPLAY-liquid-war
  status: ready
  candidate: liquid-war
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed arena with red/yellow teams white walls and04:00 timer before ordinary cursor move. Final capture shows03:35 timer and changed team distribution; autonomous simulation also changes this, so cursor-steering response not independently verified. FPS remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-liquid-war.json; scratch/runs/20261003-liquid_war-gameplay-restored4/result.json

- [ ] Gameplay screenshot and FPS: Little Fighter 2 installer
  id: GAMEPLAY-little-fighter-2-installer
  status: ready
  candidate: little-fighter-2-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete arena rendering reviewed after primary-size repair; qualify full-frame measurement. Retain reduced-roster limitation and earlier limited movement response; latest control observation is combat-confounded.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-little-fighter-2-installer.json; scratch/runs/20261003-little_fighter_2-gameplay-primary-repaired/result.json
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Marbles
  id: GAMEPLAY-marbles
  status: ready
  candidate: marbles
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete gameplay frame measurement; active board and limited column movement reviewed; no sustained-play claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/runs/20261003-marbles-gameplay/result.json; scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-marbles.json
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: mcm
  id: GAMEPLAY-mcm
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: mcm
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-mcm.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-mcm.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Moorhuhn
  id: GAMEPLAY-moorhuhn
  status: ready
  candidate: moorhuhn
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete gameplay frame measurement; active hunting scene and ammo decrement reviewed, no hit claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/runs/20261003-moorhuhn-original-gameplay/result.json; scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-moorhuhn.json

- [x] Gameplay screenshot and FPS: Moorhuhn 2
  id: GAMEPLAY-moorhuhn-2
  status: done
  candidate: moorhuhn-2
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Retain qualified single-sample logical measurement and substantial observer/cooperative overhead limitations; physical and normal uninstrumented FPS remain unknown.
  Done: Reviewed active-round screenshots and ordinary shot; root-qualified8 complete logical submissions/1006.26ms=7.95 per second. One heavily instrumented cooperative sample; no physical, normal or sustained FPS claim.
  Evidence: scratch/runs/20261003-moorhuhn2-logical-gameplay/result.json; scratch/runs/20261003-moorhuhn2-logical-gameplay/qualification.json; scratch/gameplay-moorhuhn2-counter-20261003/attempt6/root-evaluation.json

- [ ] Gameplay screenshot and FPS: Moorhuhn 3
  id: GAMEPLAY-moorhuhn-3
  status: ready
  candidate: moorhuhn-3
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-moorhuhn-3.json; scratch/runs/20261003-moorhuhn_3-gameplay-restored14/result.json

- [ ] Gameplay screenshot and FPS: Moorhuhn 3 Bonus Puzzles
  id: GAMEPLAY-moorhuhn-3-puzzles
  status: ready
  candidate: moorhuhn-3-puzzles
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Cover other puzzle variants and qualify complete-frame measurement; Fisch piece drag reviewed only.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-moorhuhn-3-puzzles.json; scratch/runs/20261003-moorhuhn_3_puzzle_fisch-gameplay-restored14/result.json

- [ ] Gameplay screenshot and FPS: Moorhuhn Tennis
  id: GAMEPLAY-moorhuhn-tennis
  status: ready
  candidate: moorhuhn-tennis
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-moorhuhn-tennis.json; scratch/runs/20261003-moorhuhn_tennis-gameplay-restored14/result.json

- [x] Gameplay screenshot and FPS: Moorhuhn Winter-Edition
  id: GAMEPLAY-moorhuhn-winter
  status: done
  candidate: moorhuhn-winter
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Retain qualified single-sample logical measurement and explicit cooperative/instrumentation limits; physical display FPS remains unknown.
  Done: Reviewed active-round screenshots and ordinary shot; root-qualified37 complete logical submissions/1017.45ms=36.37 per second. One instrumented cooperative sample; no physical or sustained FPS claim.
  Evidence: scratch/runs/20261003-moorhuhn-winter-logical-gameplay/result.json; ops/handoffs/moorhuhn-winter-frame-counter-plan-20261003.md

- [ ] Gameplay screenshot and FPS: Morrowind (retail, own ISO)
  id: GAMEPLAY-morrowind
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: morrowind
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-morrowind.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-morrowind.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Hearts
  id: GAMEPLAY-mshearts16
  status: ready

  candidate: mshearts16
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Dealer selection, ordinary setup, offline hand and three-card pass now reviewed. Qualify game-specific frame measurement; clipping tracked separately under WIN16-DIALOG-GEOMETRY.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-mshearts16.json; scratch/win16-dialog-worker-diagnostic-20261003/hearts-group/; ops/handoffs/win16-dialog-worker-trap-20261003.md

- [ ] Gameplay screenshot and FPS: mw3
  id: GAMEPLAY-mw3
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: mw3
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-mw3.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-mw3.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Need for Speed II Demo
  id: GAMEPLAY-need-for-speed-2-demo
  status: ready
  candidate: need-for-speed-2-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete-frame measurement during original software NFS2 gameplay; acceleration response reviewed, SE and NFS3 excluded.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-need-for-speed-2-demo.json; scratch/runs/20261003-nfs2_demo-gameplay-restored16/result.json

- [ ] Gameplay screenshot and FPS: Need for Speed II (retail CD)
  id: GAMEPLAY-need-for-speed-2-full
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: need-for-speed-2-full
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-need-for-speed-2-full.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-need-for-speed-2-full.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Need for Speed II SE (retail CD)
  id: GAMEPLAY-need-for-speed-2-se-full
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: need-for-speed-2-se-full
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-need-for-speed-2-se-full.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-need-for-speed-2-se-full.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [!] Gameplay screenshot and FPS: Need for Speed III: Hot Pursuit Demo
  id: GAMEPLAY-need-for-speed-3-demo
  status: blocked
  candidate: need-for-speed-3-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Declared assets are present; complete the existing review gate before gameplay or FPS work.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-need-for-speed-3-demo.json
  blocker: Renderer identity qualification previously failed; review ops/handoffs/nfs3-backend-review.md before new runtime/timing.
  waiting-on: coordinator source/evidence review; no user decision

- [ ] Gameplay screenshot and FPS: NetHack for Windows
  id: GAMEPLAY-nethack-win32
  status: ready
  candidate: nethack-win32
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a complete-frame measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-nethack-win32.json; scratch/runs/20261003-nethack_win32-gameplay-restored11/result.json

- [ ] Gameplay screenshot and FPS: Need for Speed II SE Demo
  id: GAMEPLAY-nfs2se_glide_demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: nfs2se_glide_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-nfs2se_glide_demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-nfs2se_glide_demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: pawn
  id: GAMEPLAY-pawn
  status: ready
  candidate: pawn
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement. No complete-game claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pawn.json; scratch/runs/20261003-pawn-gameplay-restored12/result.json
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Peaks
  id: GAMEPLAY-peaks
  status: ready
  candidate: peaks
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: F2 opens name prompt; ordinary Player typing and OK closes it. Stock click changes face-up 4 diamonds to 2 hearts, Cards Left23 to22 and Credits0 to-5. One draw only. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-peaks.json; scratch/runs/20261003-peaks-gameplay-restored2/result.json

- [ ] Gameplay screenshot and FPS: Pegged
  id: GAMEPLAY-pegged
  status: ready
  candidate: pegged
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed legal drag from (509,387) to (509,461): source and jumped peg empty, landing filled; six visible blue pegs become five. Limited one-move route only; no FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pegged.json; scratch/runs/20261003-pegged-gameplay-ready2/result.json

- [ ] Gameplay screenshot and FPS: Pinball
  id: GAMEPLAY-pinball
  status: ready
  candidate: pinball
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed Space Cadet table with BALL 1 and score 0 after F2. Space held 1200ms and Z held 300ms; captures show changing table lights but no verified ball movement or flipper response. Gameplay scene only, no successful launch/control claim. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pinball.json; scratch/runs/20261003-pinball-gameplay-restored1/result.json

- [ ] Gameplay screenshot and FPS: pinball_plus95
  id: GAMEPLAY-pinball_plus95
  status: ready
  candidate: pinball_plus95
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pinball_plus95.json; scratch/runs/20261003-pinball_plus95-gameplay-restored10/result.json

- [ ] Gameplay screenshot and FPS: Sid Meier's Pirates! (2004)
  id: GAMEPLAY-pirates-2004
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: pirates-2004
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pirates-2004.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pirates-2004.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Pocket Tanks shareware installer
  id: GAMEPLAY-pocket-tanks-installer
  status: ready
  candidate: pocket-tanks-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Waited for reviewed PLAYER1 HUD/terrain/tanks readiness. Ordinary Fire click produces visible crater in hill immediately right of red tank. One shot only, no match completion. FPS remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pocket-tanks-installer.json; scratch/runs/20261003-pocket_tanks-gameplay-restored4/result.json

- [ ] Gameplay screenshot and FPS: Pyramid
  id: GAMEPLAY-pyramid
  status: ready
  candidate: pyramid
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: After Start and real Game > New menu clicks, bottom-row second card (2 hearts) visibly inverts after ordinary click. Selection only, no pair removal/completed deal. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-pyramid.json; scratch/runs/20261003-pyramid-gameplay-restored2/result.json

- [ ] Gameplay screenshot and FPS: Blackjack
  id: GAMEPLAY-qblackjack
  status: ready
  candidate: qblackjack
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed; qualify complete-frame measurement before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-qblackjack.json; scratch/runs/20261003-qblackjack-gameplay-restored11/result.json

- [ ] Gameplay screenshot and FPS: QBob
  id: GAMEPLAY-qbob
  status: ready
  candidate: qbob
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a complete-frame measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-qbob.json; scratch/runs/20261003-qbob-gameplay-restored11/result.json

- [ ] Gameplay screenshot and FPS: Quake II Demo
  id: GAMEPLAY-quake-2-demo-installer
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: quake-2-demo-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-quake-2-demo-installer.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-quake-2-demo-installer.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: RollerCoaster Tycoon
  id: GAMEPLAY-rct
  status: ready
  candidate: rct
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete-frame measurement during actual gameplay; retain narrow input scope from reviewed batch17 evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-rct.json; scratch/runs/20261003-rct-gameplay-restored17/result.json

- [ ] Gameplay screenshot and FPS: Alien Shooter
  id: GAMEPLAY-reflexive-alien-shooter
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: reflexive-alien-shooter
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reflexive-alien-shooter.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reflexive-alien-shooter.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [!] Gameplay screenshot and FPS: Collapse! Crunch
  id: GAMEPLAY-reflexive-collapse-crunch
  status: blocked
  candidate: reflexive-collapse-crunch
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Declared assets are present; complete the existing review gate before gameplay or FPS work.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reflexive-collapse-crunch.json
  blocker: Association integration and completed-frame semantics remain unaccepted; review ops/handoffs/serious-review-migration-freeze.md before runtime.
  waiting-on: coordinator source/evidence review; no user decision

- [ ] Gameplay screenshot and FPS: Crimsonland
  id: GAMEPLAY-reflexive-crimsonland
  status: ready
  candidate: reflexive-crimsonland
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Localize observed early ExitProcess0 after launcher Play using saved guest/loader evidence, then repair and requalify gameplay.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reflexive-crimsonland.json; scratch/runs/20261003-crimsonland-gameplay-restored16/result.json

- [ ] Gameplay screenshot and FPS: Ricochet Xtreme
  id: GAMEPLAY-reflexive-ricochet-xtreme
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: reflexive-ricochet-xtreme
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reflexive-ricochet-xtreme.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reflexive-ricochet-xtreme.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Zuma Deluxe
  id: GAMEPLAY-reflexive-zuma-deluxe
  status: ready
  candidate: reflexive-zuma-deluxe
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Diagnose loading-screen progress on actual owning threads; BASS startup failure cleared, fallback MSVCRT present. No active gameplay/FPS yet.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/runs/20261003-zuma-nested-loader-qualification/result.json; scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reflexive-zuma-deluxe.json

- [ ] Gameplay screenshot and FPS: Reversi
  id: GAMEPLAY-reversi
  status: ready
  candidate: reversi
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Ordinary click at (350,310) places a red disc; reviewed final board shows six discs including computer reply. One move/reply only; no completed match. Gameplay frame measurement remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-reversi.json; scratch/runs/20261003-reversi-gameplay-restored1/result.json

- [ ] Gameplay screenshot and FPS: rodent2000
  id: GAMEPLAY-rodent2000
  status: ready
  candidate: rodent2000
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement. No complete-game claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-rodent2000.json; scratch/runs/20261003-rodent2000-gameplay-runtime-restored/result.json

- [ ] Gameplay screenshot and FPS: Runenlegen
  id: GAMEPLAY-runenlegen
  status: ready
  candidate: runenlegen
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Use File New, select Beginner and OK; confirm player-controlled board with demo mode off, then legal rune placement. Diagnose clipped/smeared board separately; prior deadline is not a guest crash.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-runenlegen.json; scratch/runs/20261003-runenlegen-gameplay-restored13/result.json

- [ ] Gameplay screenshot and FPS: ScummVM + Flight of the Amazon Queen
  id: GAMEPLAY-scummvm-fotaq
  status: ready
  candidate: scummvm-fotaq
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement. No full-game compatibility claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-scummvm-fotaq.json; scratch/runs/20261003-scummvm_fotaq-gameplay-restored13/result.json

- [ ] Gameplay screenshot and FPS: Serious Sam: The First Encounter Demo
  id: GAMEPLAY-serious-sam-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: serious-sam-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-serious-sam-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-serious-sam-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: SimCity 2000 Demo
  id: GAMEPLAY-simcity2000_demo
  status: ready
  candidate: simcity2000_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a complete-frame measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-simcity2000_demo.json; scratch/runs/20261003-simcity2000_demo-gameplay-restored11/result.json

- [ ] Gameplay screenshot and FPS: SimCity 2000 Network Edition
  id: GAMEPLAY-simcity2000_net
  status: ready
  candidate: simcity2000_net
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Prepare and review ordinary local virtual-peer browser route per ops/handoffs/gameplay-network-preparation-20261003.md, then capture actual gameplay; all declared files present.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-simcity2000_net.json

- [ ] Gameplay screenshot and FPS: Sid Meier's SimGolf Demo
  id: GAMEPLAY-simgolf-demo-installer
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: simgolf-demo-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-simgolf-demo-installer.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-simgolf-demo-installer.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: SkiFree
  id: GAMEPLAY-ski32
  status: ready
  candidate: ski32
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed startup and steering captures. After ArrowRight, the title/instruction scene becomes a downhill playfield with skier, trees and slalom markers; HUD advances to distance 13m and speed 08m/s. Limited ordinary-key route only; no FPS measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-ski32.json; scratch/runs/20261003-ski32-gameplay-ready/result.json

- [ ] Gameplay screenshot and FPS: Rattler
  id: GAMEPLAY-snake
  status: ready
  candidate: snake
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Early route now captures living upward movement without life loss; steering remains unverified. Qualify ordinary steering and source-backed frame timing; prior failed run retained.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-snake.json; scratch/runs/20261003-snake-gameplay-early-route/result.json

- [ ] Gameplay screenshot and FPS: Snood
  id: GAMEPLAY-snood
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: snood
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-snood.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-snood.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Solitaire
  id: GAMEPLAY-sol
  status: ready
  candidate: sol
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed initial tableau and post-click capture: stock click exposes three waste cards and timer reaches 1. F2 did not visibly change the deal, so re-deal is not claimed. Limited stock-draw route only; no FPS measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-sol.json; scratch/runs/20261003-sol-gameplay-ready/result.json

- [ ] Gameplay screenshot and FPS: sol16
  id: GAMEPLAY-sol16
  status: ready
  candidate: sol16
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Initial seven-column tableau visible, but caption area is blank gray. Ordinary stock click exposes three waste cards. Limited stock draw works; caption defect remains, no complete-game or FPS claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-sol16.json; scratch/runs/20261003-sol16-gameplay-ready2/result.json

- [ ] Gameplay screenshot and FPS: Spider
  id: GAMEPLAY-spider
  status: ready
  candidate: spider
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement. No complete-game claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-spider.json; scratch/runs/20261003-spider-gameplay-restored12/result.json
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: StarCraft Shareware
  id: GAMEPLAY-starcraft-shareware
  status: ready
  candidate: starcraft-shareware
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement. No full-game compatibility claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-starcraft-shareware.json; scratch/runs/20261003-starcraft_shareware-gameplay-restored13/result.json
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Taipei
  id: GAMEPLAY-taipei
  status: ready
  candidate: taipei
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed title, populated Game #28753 board and ordinary click: top-left tile changes to magenta selection highlight. No matching pair removal or completed game is claimed; no FPS measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-taipei.json; scratch/runs/20261003-taipei-gameplay-ready/result.json

- [ ] Gameplay screenshot and FPS: tetravex
  id: GAMEPLAY-tetravex
  status: ready
  candidate: tetravex
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay board and clean ordinary tile-drag response reviewed. Define a meaningful complete-frame counter or document event-driven rendering limits; FPS remains unknown.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-tetravex.json; scratch/runs/20261003-tetravex-gameplay-drag-restored/result.json

- [ ] Gameplay screenshot and FPS: TetriNET
  id: GAMEPLAY-tetrinet
  status: ready
  candidate: tetrinet
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Qualify complete gameplay frame measurement. Local two-seat join and limited host Left/Space response reviewed; no external network, sustained-play or physical FPS claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-tetrinet.json; scratch/runs/20261003-tetrinet-local-gameplay/result.json

- [ ] Gameplay screenshot and FPS: TicTactics
  id: GAMEPLAY-tictac
  status: ready
  candidate: tictac
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed click at (236,339) places blue mark on lowest plane, followed by new red computer mark on upper plane. Existing red mark remains. Limited one-move route only; no full match or FPS claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-tictac.json; scratch/runs/20261003-tictac-gameplay-ready2/result.json

- [ ] Gameplay screenshot and FPS: Total Annihilation Demo
  id: GAMEPLAY-total_annihilation_demo
  status: ready
  candidate: total_annihilation_demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-total_annihilation_demo.json; scratch/runs/20261003-total_annihilation_demo-gameplay-restored5/result.json

- [ ] Gameplay screenshot and FPS: Tile World
  id: GAMEPLAY-tworld
  status: ready
  candidate: tworld
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Enter initially leaves level picker; ordinary row click then Enter clears to black client. Final capture remains blank after additional2.5sec. No specific trap or missingDLL marker logged; route incomplete, no gameplay input. FPS remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-tworld.json; scratch/runs/20261003-tworld-gameplay-restored4/result.json

- [ ] Gameplay screenshot and FPS: Unreal Special Edition OEM demo
  id: GAMEPLAY-unreal-special-edition
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: unreal-special-edition
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-special-edition.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-special-edition.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Unreal Tournament 2003 demo
  id: GAMEPLAY-unreal-tournament-2003-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: unreal-tournament-2003-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-2003-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-2003-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Unreal Tournament 2004 demo
  id: GAMEPLAY-unreal-tournament-2004-demo
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: unreal-tournament-2004-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-2004-demo.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-2004-demo.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Unreal Tournament 3 demo installer
  id: GAMEPLAY-unreal-tournament-3-demo-installer
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: unreal-tournament-3-demo-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-3-demo-installer.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-3-demo-installer.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Unreal Tournament demo
  id: GAMEPLAY-unreal-tournament-demo-348
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: unreal-tournament-demo-348
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-demo-348.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-unreal-tournament-demo-348.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: Warcraft III: Reign of Chaos Demo
  id: GAMEPLAY-warcraft3-demo
  status: ready
  candidate: warcraft3-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Diagnose profile-screen guest wait using saved owning-thread state; no gameplay or FPS qualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-warcraft3-demo.json; scratch/runs/20261003-warcraft3-profile-stall/result.json

- [ ] Gameplay screenshot and FPS: wep16_blakjak
  id: GAMEPLAY-wep16_blakjak
  status: ready
  candidate: wep16_blakjak
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_blakjak.json; scratch/runs/20261003-wep16_blakjak-gameplay-restored9/result.json

- [ ] Gameplay screenshot and FPS: wep16_chess
  id: GAMEPLAY-wep16_chess
  status: ready
  candidate: wep16_chess
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_chess.json; scratch/runs/20261003-wep16_chess-gameplay-restored9/result.json

- [ ] Gameplay screenshot and FPS: wep16_chips
  id: GAMEPLAY-wep16_chips
  status: ready
  candidate: wep16_chips
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Personally reviewed active Lesson1 board after Enter; ordinary Right300ms changes Chip facing/position and horizontally scrolls board. No mouse auto-steering, no completed level. FPS remains unqualified.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_chips.json; scratch/runs/20261003-wep16_chips-gameplay-restored4/result.json

- [ ] Gameplay screenshot and FPS: wep16_cruel
  id: GAMEPLAY-wep16_cruel
  status: ready
  candidate: wep16_cruel
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_cruel.json; scratch/runs/20261003-wep16_cruel-gameplay-restored7/result.json

- [ ] Gameplay screenshot and FPS: wep16_freecell
  id: GAMEPLAY-wep16_freecell
  status: ready
  candidate: wep16_freecell
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_freecell.json; scratch/runs/20261003-wep16_freecell-gameplay-restored10/result.json

- [ ] Gameplay screenshot and FPS: wep16_fujigolf
  id: GAMEPLAY-wep16_fujigolf
  status: ready
  candidate: wep16_fujigolf
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_fujigolf.json; scratch/runs/20261003-wep16_fujigolf-gameplay-restored10/result.json

- [ ] Gameplay screenshot and FPS: wep16_gofigure
  id: GAMEPLAY-wep16_gofigure
  status: ready
  candidate: wep16_gofigure
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_gofigure.json; scratch/runs/20261003-wep16_gofigure-gameplay-restored6/result.json

- [ ] Gameplay screenshot and FPS: wep16_golf
  id: GAMEPLAY-wep16_golf
  status: ready
  candidate: wep16_golf
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_golf.json; scratch/runs/20261003-wep16_golf-gameplay-restored7/result.json

- [ ] Gameplay screenshot and FPS: wep16_jezzball
  id: GAMEPLAY-wep16_jezzball
  status: ready
  candidate: wep16_jezzball
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_jezzball.json; scratch/runs/20261003-wep16_jezzball-gameplay-restored6/result.json

- [ ] Gameplay screenshot and FPS: wep16_jigsawed
  id: GAMEPLAY-wep16_jigsawed
  status: ready
  candidate: wep16_jigsawed
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Capture originating instruction/stack for RuntimeError after About creation; ordinary capture does not prove close-click causality. All declared/import DLLs present; no missing guest path established.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_jigsawed.json; scratch/runs/20261003-wep16_jigsawed-gameplay-restored9/result.json; scratch/batch9-blocker-count-audit-20261003.json

- [ ] Gameplay screenshot and FPS: wep16_klotski
  id: GAMEPLAY-wep16_klotski
  status: ready
  candidate: wep16_klotski
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed active Daisy puzzle and one ordinary tile-move response on5ff4844e; qualify frame measurement separately, retain setup clipping and picking-offset caveats.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_klotski.json; scratch/runs/20261003-wep16_klotski-gameplay-modal-repaired/result.json

- [ ] Gameplay screenshot and FPS: wep16_maxwell
  id: GAMEPLAY-wep16_maxwell
  status: ready
  candidate: wep16_maxwell
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_maxwell.json; scratch/runs/20261003-wep16_maxwell-gameplay-restored6/result.json

- [ ] Gameplay screenshot and FPS: wep16_pegged
  id: GAMEPLAY-wep16_pegged
  status: ready
  candidate: wep16_pegged
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_pegged.json; scratch/runs/20261003-wep16_pegged-gameplay-restored7/result.json

- [ ] Gameplay screenshot and FPS: wep16_pipe
  id: GAMEPLAY-wep16_pipe
  status: ready
  candidate: wep16_pipe
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_pipe.json; scratch/runs/20261003-wep16_pipe-gameplay-restored6/result.json

- [ ] Gameplay screenshot and FPS: wep16_rattler
  id: GAMEPLAY-wep16_rattler
  status: ready
  candidate: wep16_rattler
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_rattler.json; scratch/runs/20261003-wep16_rattler-gameplay-restored8/result.json

- [ ] Gameplay screenshot and FPS: Rodent's Revenge
  id: GAMEPLAY-wep16_rodent
  status: ready
  candidate: wep16_rodent
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_rodent.json; scratch/runs/20261003-wep16_rodent-gameplay-restored8/result.json

- [ ] Gameplay screenshot and FPS: wep16_ski
  id: GAMEPLAY-wep16_ski
  status: ready
  candidate: wep16_ski
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_ski.json; scratch/runs/20261003-wep16_ski-gameplay-restored9/result.json

- [ ] Gameplay screenshot and FPS: wep16_stones
  id: GAMEPLAY-wep16_stones
  status: ready
  candidate: wep16_stones
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_stones.json; scratch/runs/20261003-wep16_stones-gameplay-restored8/result.json

- [ ] Gameplay screenshot and FPS: wep16_tetravex
  id: GAMEPLAY-wep16_tetravex
  status: ready
  candidate: wep16_tetravex
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_tetravex.json; scratch/runs/20261003-wep16_tetravex-gameplay-restored10/result.json

- [ ] Gameplay screenshot and FPS: wep16_tetris
  id: GAMEPLAY-wep16_tetris
  status: ready
  candidate: wep16_tetris
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay/Left response and open-menu Escape repair reviewed. Qualify complete-frame measurement; separate TASKBAR-RESTORE-INPUT remains unproven.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_tetris.json; scratch/runs/20261003-wep16_tetris-gameplay-menu-escape-repaired/result.json

- [ ] Gameplay screenshot and FPS: wep16_tic
  id: GAMEPLAY-wep16_tic
  status: ready
  candidate: wep16_tic
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_tic.json; scratch/runs/20261003-wep16_tic-gameplay-restored7/result.json

- [ ] Gameplay screenshot and FPS: wep16_tictacdp
  id: GAMEPLAY-wep16_tictacdp
  status: ready
  candidate: wep16_tictacdp
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Trace the preserved Sub or Function not defined error after ordinary piece drag; identify the guest call before another input qualification. Keep reviewed startup board scene, FPS unknown.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_tictacdp.json; scratch/runs/20261003-wep16_tictacdp-gameplay-restored9/result.json; scratch/batch9-blocker-count-audit-20261003.json

- [ ] Gameplay screenshot and FPS: wep16_tp
  id: GAMEPLAY-wep16_tp
  status: ready
  candidate: wep16_tp
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_tp.json; scratch/runs/20261003-wep16_tp-gameplay-restored7/result.json

- [ ] Gameplay screenshot and FPS: wep16_tripeaks
  id: GAMEPLAY-wep16_tripeaks
  status: ready
  candidate: wep16_tripeaks
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_tripeaks.json; scratch/runs/20261003-wep16_tripeaks-gameplay-restored8/result.json

- [ ] Gameplay screenshot and FPS: wep16_tutstomb
  id: GAMEPLAY-wep16_tutstomb
  status: ready
  candidate: wep16_tutstomb
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene reviewed; complete ordinary control-response route and qualify a frame counter; retain scene-only evidence.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_tutstomb.json; scratch/runs/20261003-wep16_tutstomb-gameplay-restored8/result.json

- [ ] Gameplay screenshot and FPS: wep16_winmine
  id: GAMEPLAY-wep16_winmine
  status: ready
  candidate: wep16_winmine
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_winmine.json; scratch/runs/20261003-wep16_winmine-gameplay-restored7/result.json

- [ ] Gameplay screenshot and FPS: wep16_wordzap
  id: GAMEPLAY-wep16_wordzap
  status: ready
  candidate: wep16_wordzap
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-wep16_wordzap.json; scratch/runs/20261003-wep16_wordzap-gameplay-restored8/result.json

- [ ] Gameplay screenshot and FPS: winarc
  id: GAMEPLAY-winarc
  status: ready
  candidate: winarc
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Cover remaining playable Winarc subgames and qualify complete-frame measurement; Memory single-card reveal reviewed only.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-winarc.json; scratch/runs/20261003-winarc-gameplay-restored16/result.json

- [ ] Gameplay screenshot and FPS: WinBoard installer
  id: GAMEPLAY-winboard-installer
  status: backlog
  depends-on: MIG-FIXTURE-RESTORE
  candidate: winboard-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Restore the exact missing fixture paths in the task evidence, then qualify the ordinary gameplay route.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-winboard-installer.json
  blocker: Required fixture files unavailable; exact paths and unknown manifest dependencies are listed in scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-winboard-installer.json.
  waiting-on: MIG-FIXTURE-RESTORE verification receipt; shared transfer dependency, no user decision
  blocked-since: 2026-10-03T08:42:45.967Z

- [ ] Gameplay screenshot and FPS: winmine
  id: GAMEPLAY-winmine
  status: ready
  candidate: winmine
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Personally reviewed before/after: ordinary click reveals a connected board region with numbered cells and timer advancement. No mine hit in this capture. Limited cell-reveal route only; no FPS measurement.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-winmine.json; scratch/runs/20261003-winmine-gameplay-ready/result.json

- [ ] Gameplay screenshot and FPS: Minesweeper
  id: GAMEPLAY-winmine_wep
  status: ready
  candidate: winmine_wep
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Gameplay scene and limited input response reviewed. Derive and independently qualify a complete gameplay-frame counter before reporting FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-winmine_wep.json; scratch/runs/20261003-winmine_wep-gameplay-restored10/result.json

- [ ] Gameplay screenshot and FPS: winmine16
  id: GAMEPLAY-winmine16
  status: ready
  candidate: winmine16
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed limited gameplay input and screenshots saved; qualify a game-specific frame counter before publishing FPS. Reviewed before/after: clicking a covered cell reveals a connected blank region and numbered cells. Limited reveal route only; no FPS.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-winmine16.json; scratch/runs/20261003-winmine16-gameplay-ready2/result.json

- [ ] Gameplay screenshot and FPS: Worms 2 Demo
  id: GAMEPLAY-worms-2-demo
  status: ready
  candidate: worms-2-demo
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:42:45.967Z
  accepted: 2026-10-03T08:42:45.967Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reviewed gameplay and limited input response; qualify complete-frame measurement. No full-game compatibility claim.
  Done: Reviewed gameplay screenshot and scene-qualified frame measurement with raw samples, counter proof and tested build identity; retain explicit failures.
  Evidence: scratch/gameplay-coverage-20261003/tasks/GAMEPLAY-worms-2-demo.json; scratch/runs/20261003-worms2_demo-gameplay-restored13/result.json

## New gameplay failures — 2026-10-03

- [x] Diagnose Win16 setup-dialog Worker trap in FreeCell and Hearts
  id: WIN16-DIALOG-WORKER-TRAP
  status: done
  candidate: freecell16, mshearts16
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T08:55:51.777Z
  accepted: 2026-10-03T08:55:51.777Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete: worker-owned controls use their owning queue, GROUPBOX is transparent, modeless return requires pending handle. FreeCell setup/card move and Hearts setup/card pass reviewed; tests/build pass. Dialog clipping remains a separate backlog task.
  Done: Both ordinary FreeCell Select Game and Hearts name/dealer setup complete without trap, with focused regression and reviewed gameplay input screenshots.
  Evidence: ops/handoffs/win16-dialog-worker-trap-20261003.md; scratch/win16-dialog-worker-diagnostic-20261003/
  Notes: FreeCell EIP0x12ff40 prev0x103393, Hearts EIP0x13ff40 prev0x109ccb. Both offsets match WIN16_DLG_PUMP0xFF40; this localizes the crash but does not prove its cause. Existing REP review block remains preserved; this task does not authorize retrying blocked REP validation.

## Shared fixture restoration dependency

- [~] Restore and verify missing game fixture sets
  id: MIG-FIXTURE-RESTORE
  status: active
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  accepted: 2026-10-03T09:34:17.069Z
  accepted-by: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Continue exact-path selective recovery; wave3 restored 59 files for 2 game entries and 110 entries now have complete declared routes. Preserve2GiB free and existing files; dynamic gaps/review gates remain.
  Done: Owner receipts verified and each dependent game either ready with all assets or carries exact remaining missing paths. Presence alone does not establish gameplay or FPS.
  Evidence: scratch/selective-fixture-wave3-20261003/install-receipt.json; scratch/gameplay-coverage-20261003/tasks/; scratch/migration-transfer.json
  Notes: Migration-owner bulk transfer complete with verified receipt. Coordinator now owns selective missing-fixture recovery and per-task reconciliation; exact absent archive members remain documented, no foreign services/jobs claimed.

## Remaining visual correctness work

- [x] Correct clipped Win16 setup-dialog geometry
  id: WIN16-DIALOG-GEOMETRY
  status: done
  candidate: freecell16, mshearts16
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Shared owner geometry fix qualified by actual full About credits/visible OK and ordinary dismissal. Separate Escape host/shared visibility divergence remains WIN16-MENU-VISIBILITY; existing one-pixel NC/default-base-unit limitations documented.
  Done: Setup dialog controls render within correct bounds and ordinary controls work without relying on a narrow visible edge; screenshot review and targeted geometry regression.
  Evidence: scratch/win16-dialog-worker-diagnostic-20261003/hearts-group/controls-before.json; ops/handoffs/win16-dialog-worker-trap-20261003.md; scratch/klotski-qualification-20261003/attempt1/step-05-after.json; scratch/wep16-dialog-geometry-20261003/evidence.json; ops/handoffs/wep16-dialog-geometry-20261003.md; scratch/wep16-dialog-geometry-20261003/root-review.json; scratch/runs/20261003-wep16_tetris-dialog-dismissal-diagnostic/result.json

## Restored-title runtime gaps

- [x] Implement and validate TrackMouseEvent for Tetravex
  id: WIN32-TRACKMOUSEEVENT
  status: done
  candidate: tetravex
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete narrow client-LEAVE repair: shared owner tracking/query/cancel, physical hit, queue retry and lifecycle regressions pass; canonical build and Tetravex New Game succeed. HOVER/NONCLIENT remain unsupported; drag rendering tracked separately.
  Done: Ordinary New Game reaches numbered puzzle, mouse input works, requested tracking behavior is covered by regression and gameplay image review.
  Evidence: ops/handoffs/tetravex-trackmouseevent-20261003.md; scratch/runs/20261003-tetravex-gameplay-trackmouseevent/result.json; scratch/track-mouse-event-20261003/build-completion.log

- [x] Repair Tetravex tile-drag visual trails
  id: TETRAVEX-DRAG-TRAILS
  status: done
  candidate: tetravex
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete. Reviewed ordinary drag on canonical939943d4 moves one tile cleanly, restores vacated path and preserves eight supply tiles. Pixel regression, before-source negative control and independent geometry review pass.
  Done: Ordinary tile drag places one tile and restores the traversed background correctly; original degraded evidence preserved.
  Evidence: ops/handoffs/tetravex-drag-trails-20261003.md; scratch/runs/20261003-tetravex-gameplay-drag-restored/result.json; scratch/tetravex-drag-repair-20261003/validation.json

- [x] Implement RIFF chunk navigation for memory-backed MMIO streams
  id: MMIO-MEMORY-RIFF
  status: done
  candidate: qbob
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete. Bounded memory RIFF/LIST traversal passes sparse/padding/malformed/ABI tests and independent review; canonical gates pass. Ordinary QBob reaches active pyramid past the recorded audio trap.
  Done: Memory RIFF/WAVE nested chunk search/read/ascend, word padding, parent limits and malformed lengths pass meaningful regressions; ordinary QBob route advances past the recorded audio trap.
  Evidence: ops/handoffs/mmio-memory-riff-20261003.md; scratch/runs/20261003-qbob-gameplay-mmio-riff/result.json; scratch/mmio-memory-riff-20261003/validation.json

- [x] Preserve first-hit debugger stops when retargeting breakpoints
  id: DEBUG-BREAKPOINT-RETARGET
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete. Changed-address/clear latch semantics fixed; real cold/warm-chain/marker tests pass on canonical2c22cb7d, old source fails first-hit assertion, all canonical build gates pass.
  Done: Changed breakpoint stops on its first hit; unchanged breakpoint resumes once; clear/rearm has no stale skip. Private negative control detects old bug; canonical gates pass.
  Evidence: ops/handoffs/debug-breakpoint-retarget-20261003.md; scratch/debug-breakpoint-retarget-20261003/validation.json

- [x] Diagnose ordinary input delivery to Win16 modal MessageBox
  id: WIN16-MODAL-QUEUE
  status: done
  candidate: wep16_klotski
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete separate Klotski gameplay route beyond puzzle selection/name prompt; input repair itself qualified by ordinary visible Welcome OK on canonical5ff4844e, full build and real two-instance tests.
  Done: Ordinary visible OK dismisses Welcome through the owning modal instance with preserved input ordering and meaningful regression; or exact alternative route defect is proved and separately tracked.
  Evidence: ops/handoffs/wep16-klotski-tetris-startup-20261003.md; scratch/wep16-modal-repair-20261003/validation.json; scratch/klotski-qualification-20261003/attempt1/commands.jsonl; scratch/klotski-qualification-20261003/attempt1/after-observation.png

- [x] Diagnose Win16 menu Escape hiding the host window
  id: WIN16-MENU-VISIBILITY
  status: done
  candidate: wep16_tetris
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete: focused real-instance tests, negative control, keyboard regressions and browser38746 verify menu Escape closes popup with active board retained. Separate menu-closed Escape intentionally minimizes. Taskbar restore observation tracked independently.
  Done: Ordinary Game-menu Escape dismisses menu without unintended host/shared visibility divergence; preserve unrelated state and verify active-game input.
  Evidence: scratch/runs/20261003-wep16_tetris-gameplay-menu-escape-repaired/result.json; scratch/menu-escape-repair-20261003/validation.json; ops/handoffs/wep16-dialog-geometry-20261003.md

- [x] Diagnose clipped Little Fighter 2 windowed gameplay
  id: DDRAW-WINDOWED-PRIMARY-SIZE
  status: done
  candidate: little-fighter-2-installer
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Complete: full arena personally reviewed on f76ee66e; actual primary1024x740/source794x550 and current mode recorded. Focused edge/scaling/retained-mode regressions and full build pass. Reduced roster and no FPS remain separate limitations.
  Done: Correct windowed primary size and complete LF2 gameplay viewport, with preserved explicit fullscreen mode/thread semantics and meaningful regression; retain reduced-roster limitation.
  Evidence: ops/handoffs/lf2-primary-sizing-20261003.md; ops/handoffs/lf2-primary-diagnostic-result-20261003.md; scratch/lf2-primary-sizing-20261003/root-review.json; scratch/lf2-repaired-qualification-20261003/attempt1

- [ ] Investigate taskbar restore click after Tetris minimization
  id: TASKBAR-RESTORE-INPUT
  status: ready
  candidate: wep16_tetris
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  Next: Reproduce non-restoration before proposing a repair. Current actual physical click restores with stable DOM target and observed SC_RESTORE; historical cause remains unknown. No longer blocks independent coverage.
  Done: Ordinary taskbar click restores the minimized game via owning guest command, with exact cause and meaningful regression, or documented input-target explanation.
  Evidence: ops/handoffs/taskbar-restore-input-20261003.md; scratch/runs/20261003-wep16_tetris-taskbar-restore-diagnostic/result.json

- [x] Implement bounded Unicode DirectPlay4 support
  id: DPLAY4W-UNICODE
  status: done
  candidate: aoe2
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T16:45:43.583Z
  Next: Completed bounded Unicode semantics and nine canonical regression suites; ordinary AoE2 clears previous DirectX rejection. Separate graphics initialization failure tracked under AOE2-GRAPHICS-INIT.
  Done: Exact IID530 has meaningful tested Unicode semantics with stable shared COM identity, preserved ANSI behavior, correct byte sizes/callback ownership, explicit unsupported scope and no silent ANSI alias; accepted full build and game startup requalification.
  Evidence: ops/handoffs/aoe2-directplay4w-private-draft-20261003.md; scratch/aoe2-directplay4w-private-20261003/canonical-build-receipt.json; scratch/aoe2-directplay4w-private-20261003/canonical-suites-receipt.json; scratch/aoe2-unicode-qualification-20261003/attempt1/root-review.json

- [x] Preserve process ownership for queued keyboard input
  id: INPUT-PROCESS-OWNERSHIP
  status: done
  candidate: tetrinet
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T16:57:01.457Z
  Next: Completed: regression and ordinary two-seat typing pass; network join remains separate under GAMEPLAY-tetrinet.
  Done: Foreign process cannot consume selected-owner key/char/up events with deferred HWND0 focus, same-process guest threads and legacy input remain correct, relevant regressions and ordinary two-seat browser qualification pass.
  Evidence: scratch/tetrinet-keyboard-owner-20261003/integration-receipt.json; test/test-keyboard-process-owner.js; scratch/gameplay-network-preparation-20261003/tetrinet/attempt3/root-review.json; scratch/runs/20261003-tetrinet-local-typing-diagnostic/result.json

- [x] Configure the main guest Worker with its preselected LAN address
  id: VLAN-MAIN-WORKER-IP
  status: done
  candidate: tetrinet
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T17:40:15.511Z
  Next: Completed: actual owning workers acknowledge distinct .1/.2 addresses; ordinary local join and host gameplay pass. Late room joins remain outside this repair.
  Done: Main Worker acknowledges selected LAN address before init completes; future guest threads inherit it, cooperative/default/failure regressions pass, actual two-seat network route requalified or separate blocker identified.
  Evidence: scratch/tetrinet-main-worker-ip-20261003/integration-receipt.json; test/test-browser-worker-vlan-address.js; scratch/runs/20261003-tetrinet-local-gameplay/result.json
- [ ] Diagnose Age of Empires II graphics initialization failure
  id: AOE2-GRAPHICS-INIT
  status: active
  candidate: aoe2
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T18:00:26.667Z
  Next: Capture exact palette resource50500 lookup/parser/GDI outcome. Initial graphics setup returns1; later parent error17 follows palette stage. Installed interfac.drs contains resource50500; guest lookup/parser result still unknown.
  Done: Exact rejection established, meaningful regression and reviewed fix if appropriate, ordinary startup requalified. Gameplay and FPS remain separate requirements.
  Evidence: ops/handoffs/aoe2-graphics-refined-diagnostic-20261003.md; scratch/aoe2-graphics-refined-20261003/root-artifact-review.json; scratch/aoe2-palette-stage-20261003/plan.json


- [x] Preserve nested LoadLibrary during Worker DLL initialization
  id: WORKER-NESTED-DLL-INIT
  status: done
  candidate: zuma-deluxe
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T18:09:52.406Z
  Next: Completed bounded repair: same owner resumes nested initializer, focused regressions pass, ordinary Zuma advances to loading. Remaining loading-screen diagnosis tracked separately; no gameplay/FPS claim.
  Done: Same owning instance finishes bounded nested initialization without deadlock/reentrant corruption, meaningful owner/failure/cleanup regressions pass, ordinary Zuma startup requalified.
  Evidence: scratch/zuma-startup-exit-20261003/repair/integration-receipt.json; scratch/runs/20261003-zuma-nested-loader-qualification/result.json

- [x] Show unreleased games and release readiness in EXE corpus
  id: OPS-RELEASE-READINESS
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T20:34:08.368Z
  Next: Complete: live EXE corpus filters show103 confirmed unreleased game entries,60 reviewed-gameplay entries and0 complete release approvals. Continue individual release gates; no games deployed.
  Done: Dashboard separates already-production/unreleased/unknown membership, exposes ready and remaining blockers with evidence, tests pass and serving behavior verified.
  Evidence: ops/release-readiness.json; scratch/production-desktop-review-20261003/ui-validation.json; scratch/production-desktop-review-20261003/live-validation.json; ops/handoffs/release-readiness-audit-20261003.md

- [x] Launch registered games directly from EXE corpus
  id: OPS-CORPUS-LAUNCH
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T21:14:43.753Z
  Next: Complete: prominent Launchable now filter shows127 exact available cards. Broken Sword sibling-manifest paths fixed. Public Puppeteer desktop/mobile/card-to-Solitaire runtime PASS;60ops tests PASS.
  Done: Installed corpus entries open real emulator app in new tab; missing/unregistered route explicit; authenticated gateway preserved.

- [x] Push all safe source changes to GitHub
  id: OPS-GITHUB-CHECKPOINT
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T21:14:43.754Z
  Next: Complete: checkpoint/migrated-source-dashboard-20261003 pushed via installed repository deploy key; remote4a3bc78e verified. Private artifacts/fixtures/logs excluded; inherited review gates retained.
  Done: Remote checkpoint commit contains reviewed explicit safe source manifest; push verified, unresolved runtime review gates preserved.
  Evidence: ops/handoffs/github-source-checkpoint-20261003.md; scratch/github-publication-audit-20261003/checkpoint.json

- [ ] Diagnose Monkey Island demo audio issues
  id: COMI-AUDIO-DIAG
  candidate: curse_monkey_island_demo
  status: active
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T22:38:28.752Z
  Next: Trace owning main Worker around COMI425030/4230e0 to distinguish guest pacing, execution budget and mixing cost. Reproduced waveOut starvation;19gaps859ms with priorDONE observed31–47ms before refill. No speculative scheduler fix.
  Done: Concrete audio issue diagnosed, meaningful regression/fix if supported, ordinary playback requalified with honest limits.
  Evidence: docs/re-notes/curse-monkey-island-demo.md; scratch/comi-audio-investigation-20261003/

- [ ] Restore missing files for existing EXE corpus routes
  id: CORPUS-MISSING-RESTORE
  status: active
  owner: ops-dashboard migration owner; coordinator inventory
  created: 2026-10-03T22:48:41.992Z
  Next: Restore exact inventory using owner-managed disk-safe transfer:96entries missing2267paths;16missing manifests leave further dependencies unknown.18entries need registry routes.
  Done: Existing registered fixture closures restored and launch availability checked; gameplay qualification remains separate.
  Evidence: ops/handoffs/corpus-missing-paths-20261003.md; scratch/corpus-missing-paths-20261003/missing-files.txt

- [ ] Investigate ScummVM fullscreen and missing sound
  id: SCUMMVM-AV-DIAG
  candidate: scummvm-fotaq
  status: active
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T22:59:25.111Z
  Next: Windowed default confirmed; AltEnter did not switch in browser. Audio stalls at44096bytes with2undelivered function callbacks. Implement owner-safe Worker completion delivery and separately diagnose fullscreen toggle; source proposal/evidence saved.
  Done: Explain intended behavior and demonstrate any supported fix with real browser evidence.
  Evidence: docs/re-notes/scummvm-fotaq.md; scratch/scummvm-av-20261003/

- [x] Show Git commits in dashboard activity with source filter
  id: OPS-ACTIVITY-COMMITS
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T23:16:31.625Z
  Next: Complete: live mixed activity and All/Commits/Messages filter,150 unique local-ref commits;28 tests and public Puppeteer desktop/mobile/search/pagination/refresh PASS.
  Done: Live activity shows recent unique commits with date/author/hash/link; filters and search work on desktop/mobile.


## Claude launch experience

- [~] Improve single-app and desktop app loading UX — approve design first
  id: CLAUDE-LAUNCH-UX
  status: blocked
  owner: claude:1863d2b5-bc58-4c0b-9c15-00fc951f0256
  accepted: 2026-10-03T23:32:35.471Z
  accepted-by: claude:1863d2b5-bc58-4c0b-9c15-00fc951f0256
  created: 2026-10-03T23:32:35.471Z
  created-by: user
  blocker: Awaiting user approval of loading UX design
  waiting-on: user
  needs: Approve proposal sent in Telegram or request changes
  next: Only after explicit user approval relayed via claude --resume 1863d2b5-bc58-4c0b-9c15-00fc951f0256, implement per ops/handoffs/claude-launch-ux-design-20261003.md section 5 (direct-launch gate, lib/launch-progress.js dialog, host.js byte/cache/abort progress, unit + Puppeteer network tests); silence is not approval.
  done: After user approves design, direct app URLs show no desktop flash or desktop startup work, fetch only selected-app assets plus required shared runtime, and show responsive loading feedback; desktop/multi-app mode uses the same loading dialog without disrupting other apps. Validate cache, slow network, errors, cancellation, mobile portrait and landscape, and asset request scope.
  notes: DESIGN ONLY until explicit user approval. Busy cursor alone is insufficient. Show honest download/preparation/startup states; no fabricated progress. Images must be labelled design mockups. Codex retains shared coordination; Claude owns this task.
  evidence: ops/handoffs/claude-launch-ux-design-20261003.md; scratch/claude-launch-ux/{ascii.txt,single-app.png,desktop.png} (labelled proposal mockups); Telegram receipt scratch/claude-launch-ux/telegram-delivery.json msgs 284-287 at 2026-10-03T23:36:35Z

- [x] Match Telegram blockers command to dashboard
  id: OPS-TELEGRAM-BLOCKERS
  status: done
  owner: codex:01a0ff91-cf9d-7f42-ba93-f9e7616b35a5
  created: 2026-10-03T23:38:00.490Z
  Next: Complete: /blockers registered live, shared web grouping and read-only snapshot;52tests plus browser/live formatter parity and getMyCommands verification PASS.
  Done: /blockers reads same dashboard task/approval snapshot; help/menu expose it and access controls remain intact.
