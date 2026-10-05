# Project review — 2026-09-10

## Build follow-up — 2026-09-13

Removed the five new IMM duplicate-handler entries through a shared no-context
failure result, explicit per-API stack cleanup, and same-arity conversion-status
forwarding. No duplicate baseline was expanded. Fifteen actual-source native
WATX cases pass on both the original and refactored code: identical return value,
stack cleanup, last error, and untouched output memory. Duplicate census and
handler-ESP gates pass. The full build now reaches the silent-handler inventory
pin, which is maintained by another active lane; complete main build/font
acceptance remains open, including uncommitted display-handler prerequisites.

## Standalone bitmap-font recovery — 2026-09-13

Candidate branch `codex/font-main-20260913`, initially based on `adcc4e37`
and reconciled with main `a534fda6` in `4c8dec3b`, isolates
failure-atomic bitmap-font replacement and owned, normalized full-path identity.
It stages every strike and destination before publication, preserves old fonts
on malformed input or allocation/capacity failure, and distinguishes colliding
path hashes. Paths are bounded and checked before access; synchronous file loads
snapshot the caller pathname before host imports. No host/filesystem changes,
stock-startup exports, record-layout changes, or new memory regions are included.
New native tests cover replacement rollback and path collisions/ownership.

Independent source review found no blocker; test syntax and diff checks pass.
**Current-main acceptance is blocked, not passed:** the canonical build stops
at pre-existing Imm handler duplicate-census entries, and native test compilation
stops at missing `$handle_EnumDisplayDevicesA`. Its dispatch entry was committed
in `e6bf89bd`, but the handler is still in another lane's dirty
`src/09a3-handlers-audio.wat`. The owner was notified on the messageboard;
no foreign changes were staged or imported. A fallback at parent `a09a9428`
also fails compilation (unrelated `load_image_bitmap_file` argument mismatch).
Both current-main failures repeated after reconciliation with `a534fda6`.

The compatible recovery tree passes all 10 replacement groups and 7 identity
groups. Its committed `80bc9a61` baseline reproduces the collision bug (one
registration instead of two); the working fix passes. These are recovery-tree
results, not evidence that standalone current main compiles or passes.
The exact standalone `10b` source also passes all 10 replacement and 7 identity groups when
substituted read-only into the compatible recovery harness; other source files
remain unchanged. This validates the local path validator, not main acceptance.

The user subsequently explicitly requested merging this isolated slice despite
the reported main blockers. It is reconciled through `a3a376f1`; native
compilation still reproduces the missing-handler failure. The four-file merge
does not import the unfinished handler or any broad recovery changes. Treat
this as a scoped correctness integration, **not a passing main build or release**.
The owning lanes still need to commit their prerequisites, followed by a full
build and the native font tests on committed main.
This does not close font generation/live-handle lifetime, registry concurrency,
TrueType identity, or the broad recovery integration findings below.

## Recovery execution update — 2026-09-11

**Final build update:** OLE owner fix `f1b91444` resolves the intermediate handler-checker failure described below. Clean committed main `90503599` now passes the full canonical/compatibility build at **1,160,121 / 1,160,589 bytes**, layout `9c6027bce1d500a1`; the 24 native x87 isolation checks and 11 pipeline differential cases pass. The full test suite was not run. Broad recovery remains isolated pending newer-main reconciliation and coordinated handling of active overlapping edits.

Ownership checks found live shape-census/region-folding processes and active release/mobile/D3D/GL work. Those lanes were excluded from takeover and cleanup. The closed-session screensaver work and this team's review branch were recovered into `codex/recovery-main-20260910`, preserving the original branches/worktrees. The unreferenced x87 optimization commit now has safety ref `codex/recovery-x87-islands-20260910`; it is **not accepted for main** on the available timings.

The broad recovery candidate reconciles 24 review commits with main through `10b0f53e`, adapts the screensaver, fixes a real Worker font-startup integration failure, and appends screensaver storage without relocating existing canonical regions. Canonical/compatibility builds pass at **1,174,169 / 1,174,637 bytes**. Focused native, Worker, storage, font, lazy-I/O, callback and Chrome OPFS checks pass; save-bundle/sync passes **112 checks**. The real-browser screensaver catalog/Preview check and final **full Chrome Worker matrix pass**: Notepad/Calculator parity, both Rodents' rendering and held-arrow gameplay, Winamp's three Workers and live playback, and COM success/failure recovery.

The SMAC oracle candidate is retained at `791d656d` on `codex/recovery-smac-oracle-20260910`: two eight-frame comparisons matched, but the next repeat skipped expected frame index 6. It correctly reports failure and no speedup. **Do not merge it as a deterministic benchmark oracle.** Synthetic sparse-overlay checks mount 24 GiB of logical files with no payload/cache allocation and use 262,159 cache bytes after small reads; these are accounting measurements, not RSS. Loaded-host timings do not establish a current-main performance improvement.

**The broad candidate is not merged into main.** Main has newer commits, and active uncommitted host/browser/filesystem/test edits overlap integration. No foreign edits have been stashed or staged. The standalone x87 correctness recovery **is merged as `f9465bc6`**, containing `401b58a4`: only two WAT sources and its regression test. The foreign dirty diff was byte-identical across that merge. Its isolated pre-merge canonical/compatibility build passed **1,156,001 / 1,156,469 bytes**, with 24 isolation/save/raw-integer checks and 11 pipeline differential cases passing. A clean build of merged head stops at an inherited OLE handler-ESP gate from parent `a38c67e8` (`RegisterDragDrop`/`RevokeDragDrop` wrappers); the OLE owner was notified. Do not claim the complete merged-main build passes. Detailed evidence is in [docs/recovery-2026-09-10.md](docs/recovery-2026-09-10.md). Findings below describe the original pinned baseline; candidate-only fixes remain open on main.

The initial Rodent timeout was traced to a missing fixture dependency, `weputil.dll`. Materializing the full 49-file WEP2 package fixed the test fixture; the bounded retry and full matrix then passed. No server path policy was weakened. This does not establish that memory relocation caused the earlier timeout.

## Fresh review: main, unfinished designs, and recoverable agent work

**Baseline:** committed main `ad3ba44bf28b030b1068d842c715f53bc6099eb2`. This is a review, not an implementation or release. Other agents are actively editing the shared worktree; their uncommitted work is excluded from claims about main. The older review below is retained as historical evidence.

```text
+------------------------------------------------------------------------------------------------------+
| FRESH REVIEW                         MAIN != ALL WORK COMPLETED IN OTHER SESSIONS                     |
+---------------------------------+----------------------------------+---------------------------------+
| VERIFIED NOW                    | RECOVERABLE, NOT IN MAIN         | STILL OPEN                      |
| x87 cross-instance corruption   | 24 review-integration commits   | bitmap-font replacement atomicity|
| font-path hash collision        | Claude screensaver browser      | font generations / live handles |
| cache + test-discovery gates OK | x87 fusion commit, no local ref | D3D breadth / real LAN match     |
+---------------------------------+----------------------------------+---------------------------------+
| INVENTORY: 110 branches | 42 have unmatched patches | 107 valid worktrees | 190 residual directories   |
| SESSION TRIAGE: 191 project Codex logs + 54 Claude parent logs; sampled tails, not exhaustive histories|
+------------------------------------------------------------------------------------------------------+
| NEXT: rescue correctness fixes -> reconcile current main -> regression gates -> feature recovery      |
|       benchmark optimizations separately; preserve active/dirty work; do not blindly merge or prune    |
+------------------------------------------------------------------------------------------------------+
```

### Findings, ordered by risk

#### R1 — P1: x87 values are shared between guest instances

**Freshly reproduced against pinned main.** `src/06-fpu.wat:132` stores physical x87 registers at shared-memory address `0x200 + index * 8`, although other FPU state belongs to each instance. With two real WebAssembly instances sharing one memory, instance A writes ST(0)=1.25 and B writes ST(0)=9.5; A then reads **9.5**, not 1.25. Guest threads can corrupt one another's floating-point computations without touching the same guest variable.

The probe compiled all 69 source fragments from the pinned commit and added only exports for the existing FPU get/set helpers. This is a native failure, not a mock or an inference from a session summary. Repair candidate: `98151373` on `codex/review-integration-20260909`, which moves physical x87 registers into instance-private state. Integrate with save/restore and real-thread coverage before considering throughput optimizations.

#### R2 — P1: recycled thread slots retain old shared-ring messages

**Source-confirmed integration gap; not freshly rerun in this pass.** `lib/thread-manager.js:500` reserves a thread slot and publishes its replacement ID without first retiring/resetting the previous shared message-ring lifetime. Resetting only a local queue does not address this separate ring. The earlier full-source reproducer is documented below; the isolated regression now explicitly covers reset-before-publication and preservation of valid startup posts.

Repair candidate: `6653eb1a`, with `test/test-runtime-thread-ownership.js` in the review branch. The important ordering is reserve slot -> reset old ring -> publish ID -> accept new posts; resetting after publication can erase valid replacement-thread messages.

#### R3 — P2: TrueType cache treats a hash as complete file identity

**Freshly reproduced against pinned main.** `src/10c-truetype.wat:3002` returns a cached face when the path hash matches, without comparing full paths. Two distinct paths, `c:\font-id\5pvu.ttf` and `c:\font-id\c3ea.ttf`, both hash to **3656534779**. Mounted with Liberation Sans and Liberation Mono respectively, both opened as face **0** and produced the same W width (**23** at size 24). The second request resolves to the wrong font.

Repair candidate: `b1396263` adds owned full-path identity on the review branch. That is not a complete answer to replacing a font at the *same* path: content generations, selected-handle lifetime, and invalidation still require an explicit contract.

#### R4 — P2: malformed bitmap-font replacement destroys the valid registration first

**Source finding; no new runtime reproducer in this pass.** `src/10b-gdi-font.wat:813` calls `gdi_bitmap_font_remove_hash` before parsing the replacement. Removal unbinds matching HFONT records and frees their strike data. If the replacement is malformed and parsing fails, the previous valid registration is already gone. The isolated buffer-loading variant retains this ordering, so merging the review branch alone does not close it.

Parse and validate into a candidate registration, then publish atomically. Failed replacement should preserve the old usable registration; successful replacement/removal also needs defined behavior for live selected handles. Add malformed replacement, allocation failure, same-path new-content, and selected-font lifetime tests.

#### R5 — P2: large writable overlays still have eager whole-payload costs on main

`lib/vfs-overlay.js:106–122` rejects uncached writable opens; hydration at `306–326` reads complete payloads, and `lib/overlay-store.js:23` documents the eager snapshot contract. This can amplify memory and checkpoint work for large installations. `docs/design-byo-media.md:649` correctly requires all synchronous consumers to participate in preparation/parking: implementing only CreateFile is insufficient.

The review branch has substantial lazy-I/O, ownership, sparse-save, immutable-lease, and consumer work absent from main. Reconcile that work rather than restarting it, but validate current browser/CLI/Worker startup paths and a genuinely large install/save cycle. **No fresh peak-memory, throughput, phone latency, or power-loss durability measurements were made here.** Cooperative time checks also remain a mitigation, not preemption inside a long native handler.

#### R6 — P2: acceptance claims are narrower than the planned compatibility contracts

These are separate, documented gaps rather than proof every app is broken:

| Area | Evidence on pinned main | Remaining acceptance |
|---|---|---|
| Direct3D | `docs/direct3d-dual-backend-status.md:840–850`; `src/09ad-handlers-d3d9.wat:1258` CreateStateBlock trap | Fixed-function/resource breadth, D3D8, profile-specific gameplay, cancellation/performance. Current lighting work is active, not abandoned. |
| Virtual LAN | `docs/virtual-lan-party.md:1205–1210`; `test/test-vlan-match.js:175–190` waits for listen/accept/protocol stream, then kills both sides | A completed real match, including sustained state exchange and exit. Networking is implemented; the document's early “not implemented” label is stale. |
| OLE drag/drop | `src/09a-handlers.wat:17338–17350` returns S_OK without retaining a drop target or delivering events | Actual target/event lifetime, or truthful unsupported behavior. WordPad embedding tests do not establish drag/drop support. |
| WordPad OLE | `docs/richedit-compat-design.md:21–31` distinguishes deferred OLE breadth from the unverified two-DIB reopen gate | Run the specific reopen acceptance; do not label existing embedding code absent. |

### Unimplemented ideas versus stale plans

The documentation audit enumerated **128 committed Markdown files: 72 top-level and 56 RE notes**, with 27 top-level design/plan/status/audit/follow-up candidates. This was targeted source/test cross-checking, not a line-by-line review of every document. Three additional untracked docs belong to ongoing work.

| Document / idea | Current disposition | Next action |
|---|---|---|
| `docs/design-byo-media.md` lazy storage | Partly missing from main; much exists on the review branch | Integrate and stress lifetime/large-save paths; see R5. |
| Review-branch `docs/design-font-preflight.md` | Catalog/preflight implementation exists off-main; replacement generations remain open | Preserve catalog/lease work; close R3/R4 and selected-handle semantics. |
| `docs/direct3d-dual-backend-status.md` | Real backend implementation plus explicit missing contracts | Track actual game acceptance separately from API/test counts. |
| `docs/virtual-lan-party.md` | Initial status stale; completed-match gate still meaningful | Update status only after protocol and gameplay evidence. |
| `docs/richedit-compat-design.md` | Broader OLE deliberately deferred; narrow reopen gate unverified | Prioritize supported workflows, not a blanket “OLE done.” |
| `docs/design-agent-control.md:3–14` | Phases 1/2 frozen and implemented; stream subscription/replay remain design | Treat later phases as optional backlog, not missing baseline control support. |
| `docs/site-seo-worklog.md:39` | Site work merged; repeatable compatibility badges and per-app clips remain ideas | Generate evidence first. Submission, outreach, and deployment require separate authority. |
| `docs/desktop-idle-cpu-audit.md:3–19` | Accepted/merged status already recorded | Do not reimplement old checklist entries; deployment and measurement are separate. |
| `docs/page-compile-design.md:945` | Later section supersedes early proposal; page chunks and CASE_CHAIN exist | Evaluate remaining measured bottlenecks against current implementation. |
| `docs/paint-refactor-followup.md:3–7` | Sections 1, 2, and 4 recorded complete | Preserve remaining scoped follow-ups, not the historical entire plan. |
| WATX layout / typed-pointer proposals | “Zero uses”/spec-only wording stale; real uses exist in `09a-handlers.wat` and `09c3-controls.wat` | Refresh status from source before scheduling migration work. |

**Fable cross-check:** its older mirrored-owner/cache-version/manual-test-list findings are not all still open. Symbolic-owner work was already reused in the earlier integration. Fresh checks pass with one `build-info`/`WINE_BUILD` authority and automatically discovered test tiers. Main's current cache/test machinery must survive integration; copying the older branch's manual version or test membership would regress it. The shared `fable-review.md` is actively edited by another agent and was not changed by this audit. Its broader decomposition/compatibility backlog is not disproved by these specific closures.

### Recoverable branches, worktrees, and dropped-session candidates

Branch-name/ancestry alone is misleading. Of **110 local branches**, **54 are ancestors of main**, **14 are fully patch-equivalent**, and **42 contain at least one unmatched patch** under `git cherry`. An unmatched patch is a recovery lead, not proof the functionality is absent: squashes, rewrites, and partial integration require source comparison.

There are **297 registered worktree paths**, but only **107 validate as their own Git worktree**. The other **190 are residual directories missing their worktree `.git` metadata**, marked prunable; they are not 190 additional live worktrees. Of the valid worktrees, **15 are clean, 78 contain only build/dependency/corpus/log artifacts, and 14 have other changes, including main**. Seven registrations are locked. No directories or refs were deleted; lock-owner liveness is unverified.

| Priority | Candidate | Verified disposition / recommendation |
|---|---|---|
| First | `codex/review-integration-20260909` at `b1396263`, `/private/tmp/wa-review-integration` | **24 unmatched commits**, 117-file delta (+14,978/-1,258); clean apart from intentional dependency symlink. Real missing runtime, storage, callback, and font work. Reconcile in an isolated integration branch with current main. |
| Coordinate owner | `codex/release-20260910` at `df73b5ed`, `/private/tmp/wa-release-20260910` | Four unmatched release/StarCraft commits plus dirty batch-clock/control-test work. Recent board activity: **active**, not dropped. |
| Preserve WIP | `codex/rodent-score-caret` at `d1eb8cd5`, `/private/tmp/wa-idle-integrate-20260910` | Branch tip already merged, but about 199 lines of uncommitted touch/renderer/test work at inventory time. Analog-mouse lane remains active. Merged branch does not mean disposable worktree. |
| Feature recovery | `scr-browser` at `b51374e8` | Claude session `ed40b41e-9b1e-4266-a961-49ade7d8e6b5` explicitly deferred integration. Commit remains unmatched; its 437-line `src/09ca-screensavers.wat` does not exist on main. Contains applet, shell/host wiring and native/browser tests. Rebase and validate current shell/build integration before adopting. |
| Preserve research | `dea5b5ab`, “Fuse hot scalar x87 algebra islands” | Codex session `01a088f6-20da-7a82-a3da-5b870d942728` reports an isolated candidate. Commit object exists, is not an ancestor of main, and **no current local ref contains it**. Session's pixel/performance claims were not rerun; its full build was reported blocked by the old base. Establish a recovery ref with approval before garbage collection; correctness R1 comes first. |
| Benchmark research | `codex/smac-bench-oracle` at `96178533`, `/private/tmp/wa-smac-bench-oracle` | Unmatched deterministic benchmark and dirty benchmark files. Preserve measurement harness; do not equate benchmark code with proven current-main speedup. |
| Owner review | `worktree-agent-adcd6b282725a3e21` at `efa6838c`, `.claude/worktrees/agent-adcd6b282725a3e21` | Region-folding experiments plus dirty `region-jit.js`; related Claude parent `a30e10d7-6d2d-4704-becb-eebad207768b`. Compare against current region engine and oracle; lock age alone is not abandonment evidence. |

The review branch's unique work groups into ring/sparse-save repair (`6653eb1a`), persistence fault handling (`5397dea7`), cooperative/lazy consumers (`c16666d3`, `686bf81e`, `6d49011f`), owned help/callback execution (`d60e81a5` through `7117d971`, including x87 `98151373`), immutable VFS leases (`1db19a1a`), stock-font preparation/catalog transactions (`8f8dd7f7` through `60dab3e4`), and full-path face identity (`b1396263`). This is an inventory, not a claim that each can be cherry-picked independently.

**False positives found:** old Codex sessions reported real-thread work `701b12f`, replicated dispatch `9450d792`, logical-FPS work `339eee46`, SEO work `c36c60a3`, and Diablo diagnostics `0876e5c0` as pending; all are now ancestors of the pinned main. Claude candidates `c2f5bd88`, `8ea64aab`, and `71a36a0c` look unique in history, but their relevant source/test patches reverse-apply cleanly to main after excluding generated/document/manual-runner churn. Do not blindly merge them again.

#### Recovery inventory appendix

All 42 branches with unmatched patches are listed below. Counts are per branch, **not distinct missing commits**; `shape-census` and `worktree-agent-a7f740852e0816261` share a tip. Most experimental branches still need semantic comparison before adoption.

```text
branch                                      unmatched patches
angel-pm                                    1
aoe-recompile-poc                           18
codex/controlstate-gate                      1
codex/controlstate-integration               2
codex/release-20260910                        4
codex/review-integration-20260909            24
codex/smac-bench-oracle                      1
perf/fuse-cmp-jcc                            1
perf/fuse-sib-store                          1
perf/next-fastpath-branches                  1
perf/next-tailcall-dispatch                  1
perf/reg-file-in-memory                     2
perf/reg-specialised-handlers                1
scr-browser                                 1
shape-census                                6
worktree-agent-a072a4ad0907e59ad              1
worktree-agent-a099f94164eb75dd8              1
worktree-agent-a3401c963a900fb3b              1
worktree-agent-a3f8fd99933b45c3a              1
worktree-agent-a424f5b7ef8e48088              1
worktree-agent-a508f71947208807d              1
worktree-agent-a56740131042465f4              2
worktree-agent-a7ca85e9334cc32bb              1
worktree-agent-a7f740852e0816261              6
worktree-agent-a854bf3764708601c              1
worktree-agent-a8a2d0c0110f93605              1
worktree-agent-a9a699950aa504af3              1
worktree-agent-a9d909185b6ed41bc              1
worktree-agent-aa1162fb1330e01cc              1
worktree-agent-aaa3d2482e11c62d4              1
worktree-agent-aabc6ae8f9eba467a              1
worktree-agent-aae47c83a7cae0d9e              1
worktree-agent-abf90e42167919c32              1
worktree-agent-ac0ba46b028b73243              1
worktree-agent-adb1d03f632d8033e              1
worktree-agent-adcd6b282725a3e21              2
worktree-agent-aefd5647b019c4c9d              2
worktree-agent-af6250931f6e1aebb              1
worktree-agent-aff7b73bd6b7a908c              1
worktree-loop-store-sinking                  3
worktree-volley-dplay                        1
wt-io-work                                  4
```

The 14 non-artifact dirty worktrees below require preservation and owner review. “Non-artifact” excludes only dependency/build/corpus directories and standalone logs; it does not prove the modifications are useful or absent from main. Paths and counts are an audit-time snapshot.

| Path (repository-relative unless absolute) | Dirty work to check |
|---|---|
| Main repository | Active shared implementation; excluded from pinned findings |
| `/private/tmp/wa-idle-integrate-20260910` | Active touch/analog-mouse work |
| `/private/tmp/wa-release-20260910` | Batch-clock and control-test work |
| `/private/tmp/wa-simgolf-root` | Detached `lib/apps.js` edits |
| `/private/tmp/wa-smac-bench-oracle` | Benchmark work |
| `/private/tmp/wine-smac-clock-opt` | Detached region/handler edits |
| `/Users/vg/.claude/jobs/1fd8ea5d/tmp/wt-dplay` | String/dispatch/API edits and untracked Blobby networking test |
| `/Users/vg/.claude/jobs/2e04d5f5/tmp/inc/demo` | Manifest/build changes and tracked fixture deletions |
| `/Users/vg/.claude/jobs/2e04d5f5/tmp/loopop-base` | Fixture deletions and untracked keyboard-focus test |
| `/Users/vg/.claude/jobs/2e04d5f5/tmp/loopop-new` | Loop/build changes, fixture deletions, untracked source/test copies |
| `.claude/worktrees/agent-a632a67e7ef51eb90` | Shape-census worker/loop/exports/test-run changes |
| `.claude/worktrees/agent-a728dddbd17c3822b` | Untracked gameplay, critical-section, DirectDraw, keyboard and memory tests |
| `.claude/worktrees/agent-adcd6b282725a3e21` | Region-JIT/tree-fold experiments and generated bundles |
| `.claude/worktrees/agent-aefd5647b019c4c9d` | Untracked gameplay tests, dialog-button test and temporary files |

### Evidence coverage and limits

- Parsed metadata for **243 local Codex logs**, identifying **191 project sessions**. Sampled their final 2 MiB and the tails of **54 Claude parent-session logs**; readable final messages were found in 149 and 51 respectively. Missing final text is not proof a session was dropped.
- The Claude project directory contains **504 JSONL files including 450 nested subagent logs**. Nested histories and full large logs were not exhaustively read. Encrypted content was not decrypted. Session text supplies leads; Git ancestry, patch equivalence, source, and dirty-worktree state determine status. Private debug tokens/URLs are intentionally omitted.
- Fresh passing gates: 69-fragment balance; browser cache graph (68 page scripts, 7 worker scripts, one authority); test discovery/manifest accounting (**1,024 files: 701 unit, 317 e2e, 6 smoke; 0 quarantined; 2 explicit timeout exceptions**).
- Fresh pinned native compilation succeeded for both R1/R3 probes, and both assertions failed as described. No full canonical build, full suite, new real-browser acceptance matrix, or device performance benchmark was run in this review. A shared-tree compile during another agent's mid-edit lighting work was excluded as non-baseline evidence.
- Subagents independently audited documentation backlog and branch/worktree recovery; root performed current-source reproductions, session-tail triage, and reconciliation. No runtime implementation, merge, commit, cleanup, or deployment was performed.

### Recommended next execution

1. Preserve branchless/dirty recovery candidates and agree ownership with active lanes. Do not prune from branch-merged status alone.
2. Reconcile the 24-commit review candidate onto current main in isolation, prioritizing x87, ring lifetime, and persistence. Preserve current API numbering/generated tables, cache authority, test discovery, and newer D3D/DirectPlay/mobile work.
3. Run canonical/compat builds and focused real-thread, failed-save, browser OPFS, startup/lazy-consumer, help-callback and font gates. Record intermittent failures, not only final successful reruns.
4. Close bitmap-font atomic replacement and same-path generation/live-handle semantics; these remain open beyond the candidate integration.
5. Select feature recovery explicitly: screensaver browser first if wanted; evaluate region/x87 optimization only against current-main semantic oracles and controlled performance measurements. Validate a completed LAN game and representative D3D gameplay separately.

---

## Historical review — 2026-09-09

## Execution update — review integration

The original review below is historical evidence, not the current status. The implementation began at `b04298f9` in `/private/tmp/wa-codex-review-fixes` and was reconciled with committed main in `/private/tmp/wa-review-integration`. Unrelated uncommitted main-tree work is excluded from the integration commits and preserved in the shared worktree. No deployment is part of this work.

```text
+----------------------------------------------------------------------------------------------------------+
| EXECUTION TLDR                         THREE IMPLEMENTATION LANES                                         |
+----------------------------------+----------------------------------+------------------------------------+
| RUNTIME                          | PERSISTENCE                      | MEASUREMENT / RESPONSIVENESS       |
| #1 FIXED: thread-owned queues     | #2 FIXED: scope-locked OPFS       | #8 FIXED: actual retired blocks    |
| #4 FIXED: cross-thread heap frees | #3 FIXED: immutable Node blobs   | #10 MITIGATED: adaptive quanta     |
| #5 FIXED: truthful full errors    | #6 FIXED: retain failed retries  |     8ms elapsed check between runs |
|                                  | #7 FIXED: deadline includes body |     native calls still cannot yield|
|                                  | Real-browser OPFS gate: PASS     |                                    |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: LAZY OVERLAY LOADING (#9)                       NEXT: SHARED MESSAGE-RING SLOT REUSE                 |
| [file APIs can park] -> [snapshot ownership]          [reserve slot] -> [reset old ring] -> [publish ID]     |
|         -> [lazy payloads] -> [dirty ranges]          Old shared-ring posts can outlive the old thread.   |
+----------------------------------------------------------------------------------------------------------+
| BEFORE RELEASE: close remaining lifetime issues -> device latency + large-save validation                 |
+----------------------------------------------------------------------------------------------------------+
```

Implemented fixes have regression coverage for failures, not just successful round trips. Runtime coverage includes two real Node workers sharing memory, concurrent queues, and 1,024 combined low/sparse cross-thread free/reuse transfers. Overlay coverage injects publication failures and interleaves independent same-scope stores. Save tests cover retry after quota/deletion failure and stalled response bodies. Browser scheduling tests preserve early yields, debug halts, zero-work accounting, and frozen deterministic stepping.

Queue ownership also covers the browser's idle helper instance: host callbacks and native cross-thread posts use the target window's shared guest queue; shadow posts with no known window owner fail instead of touching a real worker's private queue. The helper has a distinct recursive-lock identity even when its metadata uses guest slot 8.

Deliberate limits and follow-ups:

- **#9 remains open.** Lazy writable overlay files require parking/retry support in internal CRT `fopen`/`freopen`/`_open`, `OpenFile`, and multimedia opens, not just `CreateFileA/W`. Browser VFS snapshots and chain-launch closures also need explicit provider lifetime ownership. The speculative lazy implementation was withdrawn to avoid breaking those paths. Coherent eager OPFS snapshots remain supported (individual unreadable files are reported and may be skipped); whole-file payload allocation/checkpoint copying remains.
- **#10 is a mitigation, not hard preemption.** Normal cooperative runs check elapsed time between small adaptive WASM calls. A single block/native handler can still exceed the deadline. Frozen stepping intentionally retains its deterministic requested budget. No new throughput or input-latency benchmark is claimed.
- **Separate shared-ring lifetime issue:** local queues are fixed, but the distinct cross-thread ring can retain old messages when a thread ID/slot is recycled. A full-source probe confirmed this. Reset/generation handling belongs before publishing the replacement ID; resetting during worker initialization could discard valid new posts. This follow-up is not hidden by the local-queue test.
- Heap metadata is bounded to 1,024 reserved arenas. Private free-list transfer fixes valid cross-thread frees, but does not implement process-wide coalescing or reclaim an exited instance's private free list.
- Node publication protects prior committed data on ordinary write/rename failure; it does not claim multi-process writer coordination or power-loss durability without fsync. Durable browser overlays require Web Locks; unsupported environments fall back visibly to session storage.
- Failed localStorage operations remain pending until another mutation or manual flush; there is no background retry loop. Sync deadlines cover each HTTP request and its consumed response body, not the entire multi-request synchronization workflow.
- **Existing Win16 layout sensitivity:** placing the two new declarations first relocated existing regions and made Rodent display “Wrong version of run-time DLL.” An exact-baseline browser comparison and a placement-only candidate A/B isolated this regression. Appending the declarations restores the board without reverting the heap/queue fixes. This avoids the regression; it does not establish that arbitrary region relocation is safe or identify the underlying guest-pointer assumption.

### Candidate validation and integration boundary

Focused checks passed: runtime ownership/real-worker stress, heap partition and malformed-header validation, filtered PeekMessage, GetMessage teardown, modal button queues, 19 overlay cases, installer checkpoint/restart/SIGTERM round trip, 34 lazy-VFS cases, localStorage retry and two-app warning ownership, Heroes II saves, save-bundle/sync (112 checks), cooperative deadlines/timers/parking, thread scheduling, and HUD accounting/reset/input tests.

The integrated canonical and compatibility builds pass with layout hash `8566329207cd7d8f`, 185 verified symbolic owners, and no data-segment overlaps. After adding the readiness regression and registering main's newly landed toyvm arena-recycle regression, the manifest/timeout gates account for 904 tests. All 183 pre-existing region bases are unchanged in the committed integration. The full suite and device performance/memory benchmarks have not been run. The shared worktree separately retains the other lane's four expanded DLL tables; its regenerated map hash is `6d4e64cdb4dcbf79`, not the committed build's hash.

The unchanged candidate's full `test/test-worker-guest.js` matrix passed on rerun: Notepad/Calculator parity, Win16 Rodent and Rodent2000 gameplay, Winamp real threads, and COM load/unpark. **An earlier run failed Winamp's worker-slice threshold (4 versus >10); the rerun passed with 3 workers and 62,190 slices.** This remains intermittent evidence, not a demonstrated heap regression or a throughput comparison. Initial diagnostic WASM variants were not actually loaded, so their apparent causal results were discarded; no speculative allocator marker change was landed.

After the final shadow queue/lock ownership correction (`79c5da95`), the canonical build and exact full browser matrix passed again, including Winamp with 3 workers and 16,686 slices. The expanded full-source ownership regression passed shadow-to-main and shadow-to-real-thread-8 delivery, preservation of private queue bytes, native cross-owner routing, distinct recursive lock identities, and the existing real-worker heap/queue stress. Lock tests (10/10), window-table tests (4/4), and the modal dialog timer/posted-command regression also passed.

**Real-browser OPFS validation now passes.** With permission, `test/test-web-overlay-store.js` ran in Chrome and exited zero: independent two-tab and same-tab stores preserved all 26 files across reloads and byte-exact snapshot/read checks, followed by scoped cleanup. The tested storage source is byte-identical in the integrated branch. This closes the earlier sandbox-blocked validation gap; it is additional to the 19 model/Node cases.

Source history: `b057dcb9` (persistence), `e0b655aa` (runtime/performance), and `79c5da95` (host callback ownership), following symbolic-owner reuse `69ea0584`. Integration merge `0f3a50aa` resolves the symbolic-owner conflict; subsequent merges preserve main's newer article/tool commits. Main application preserves the uncommitted DLL-table expansion and regenerates its separate map rather than copying the committed map over it. The unrelated staged `stdole2.tlb` is excluded from the integration commits.

Integration validation exposed two test-budget issues:

- **Winamp:** the original fixed 12-second observation passed once and failed once (two workers/four slices). Verified-artifact diagnostics captured a 9.54-second main-worker slice with continuously increasing host-call service counts before a third worker started. That supports timing sensitivity, not proof that every historical failure recovers. `43fe8ff4` retains the original first 12 samples and all six assertions, adds a 60-second readiness observation limit, and logs progress. Two subsequent full browser matrices passed (readiness after 3.014s and 1.010s); neither needed the extension. A virtual-clock regression separately proves slow readiness after 16s and a finite failure for a permanently stalled guest. No speculative heap change was made.
- **Darkstone:** its newly committed gameplay test was absent from the manual manifest and requested 600 seconds inside a 300-second runner cap. An attempted 240-second child guard stopped an actively progressing run after reaching the menu, so it was reverted. `d9a80582` restores the original 600-second guard and adds a documented 660-second per-test runner exception. All other tests retain 300 seconds; explicit environment/CLI caps, including zero, take precedence. Schema, stale/duplicate entries, cap selection, and watchdog logging are regression-tested. Full gameplay revalidation passed in approximately 6m41s: character creation, persisted party selection, town, and camera response (405,468 changed pixels), with all assertions unchanged. This is functional acceptance, not a performance benchmark.

### Cross-check with `fable-review.md`

The symbolic region-owner repair already existed as `25af708a` in the Fable-related isolated lane. It was reused as `69ea0584`, resolving declarations against this candidate's layout rather than reimplementing it. The gate now validates symbolic owners, including the two new queue/heap metadata regions.

Fable's earlier overlay checkpoints (`2878b7ed`) and retry work (`986f6717`) were already in the baseline; they did not cover the independent OPFS stores, Node torn publication, or the separate localStorage persistence module identified here. Its broader scheduling concerns overlap #10, but are not evidence that this particular cooperative deadline or measurement bug was fixed. Its separately prepared single-source cache-key and derived-test-tier changes are not pulled into this candidate. Existing review claims were cross-checked against code/commits, not accepted as proof of current behavior.

## Original review (pre-fix baseline)

```text
+--------------------------------------------------------------------------------------------------------------+
| WINE-ASSEMBLY REVIEW   /   10 FINDINGS   /   7 REPRODUCED FAILURES                                           |
| FIRST: stop message corruption and save loss.     P1 = urgent   P2 = next                                    |
+------------------------------------+------------------------------------+------------------------------------+
| RUNTIME / MESSAGES                 | BROWSER / SAVED FILES              | CLI / SAVED FILES                  |
| #1 P1: queues overwrite each other | #2 P1: writers corrupt saves       | #3 P1: failed commit breaks saves  |
|                                    |                                    |                                    |
|  Thread A         Thread B         |  Store A          Store B          |  [overwrite existing blob]         |
|      \               /             |      \               /             |               |                    |
|       +-----> <-----+              |       +-----> <-----+              |               v                    |
|       [same queue bytes]           |        [same blob name]            |       [index commit FAILS]         |
|       [private counters]           |        [private indexes]           |               |                    |
|               |                    |               |                    |               v                    |
|               v                    |               v                    |       [old save now broken]        |
|      LOST / REPLACED MESSAGES      |      LOST / WRONG FILE CONTENT     |                                    |
|                                    |                                    |                                    |
| FIX: per-thread queue storage      | FIX: lock scope + fresh index      | FIX: new blobs -> commit index     |
|      or one owned shared queue     |      + unique immutable blobs      |      -> reclaim old blobs          |
+------------------------------------+------------------------------------+------------------------------------+
| OTHER RUNTIME FAILURES             | OTHER PERSISTENCE FAILURES         | PERFORMANCE / MEASUREMENT          |
| #4 P2: cross-thread frees ignored  | #6 P2: failed save loses retry     | #8 P2: HUD counts block budgets    |
|        -> leaked heap space        |        -> restores stale data      |        -> misleading throughput    |
|                                    |                                    |                                    |
| #5 P2: full queue says success     | #7 P2: body read has no timeout    | #9 P2: reload reads ALL files      |
|        -> silently dropped posts   |        -> sync can hang            |        -> high memory + copying    |
|                                    |                                    | #10 P2: UI-thread slice has no     |
|                                    |                                    |         wall-time bound -> jank    |
|                                    |                                    |                                    |
| DESIGN: explicit state ownership   | DESIGN: shared failure contract    | MEASURE actual work + latency      |
| TEST: two instances, one memory    | TEST: crash, retry, two writers    | THEN tune budgets + lazy reads     |
+--------------------------------------------------------------------------------------------------------------+
| EVIDENCE: #1-7 reproduced; #8-10 established by code inspection, not new performance benchmarks.             |
| CHECKS: selected tests PASS | full source compiles | owner-reference gate FAILS (59 stale entries).          |
| SCOPE: broad review of current dirty tree; full 900-test suite and browser benchmarks not run.               |
+--------------------------------------------------------------------------------------------------------------+
```

Review baseline: working tree at HEAD `ddca843b`, including existing uncommitted changes. This is a broad architecture and risk review, not a line-by-line audit of every guest API or a certification of all applications. The source areas surveyed cover the interpreter, memory allocation, messages, threading, browser scheduling, rendering/telemetry, persistence/media, compiler checks, and test infrastructure. No application source was changed.

The most urgent problems are **shared-state ownership and persistence correctness**. Seven failures below were reproduced with focused probes against the current modules, including the full source compiled by the canonical WATX compiler. Three additional performance findings follow directly from the code; no new browser FPS or throughput benchmark is claimed.

P1 means prioritize before relying on the affected workflow; P2 means a concrete correctness or performance problem to schedule next. Findings apply to this checkout, not necessarily the deployed build or another agent's isolated branch.

## Findings

### 1. P1 — Thread-local message queues overwrite one another

**Locations:** [queue storage](./src/10-helpers.wat#L4814), [instance-local counter](./src/01-header.wat#L2882), [PostMessageA](./src/09a5-handlers-window.wat#L3135).

`post_queue_count` is a mutable WASM global, so each instance has its own count. Every instance nevertheless stores its queue at the same linear-memory address, `0x400`. Threads share that memory. Cross-thread window routing uses a separate shared queue, but posting to one's own thread still reaches this overlapping local buffer.

**Reproduced:** instantiate the compiled module twice over one shared memory, initialize thread slots 0 and 1, and invoke the real `PostMessageA` handler with `hwnd=0`. A posts message `0x401`; B posts `0x402`. A's first queue entry becomes `0x402`, while both instances still report depth 1. Actual parallel execution is unnecessary: sequential calls suffice.

**Impact:** messages can be lost, replaced, or delivered from another thread's queue. This affects cooperative multi-instance execution as well as real Workers.

**Fix direction:** allocate queue storage per thread, including its dequeue/purge paths, or funnel all posts through one ownership-aware shared queue. Add a two-instance test that drains both queues and verifies each message exactly once.

### 2. P1 — Two browser overlay writers can corrupt saved files

**Locations:** [cached index](./lib/overlay-store.js#L317), [blob allocation and commit](./lib/overlay-store.js#L416), [per-launch store creation](./lib/browser-shell.js#L227).

`opfsStore(scope)` caches its index and `nextBlob` counter inside the store instance. Its promise queue serializes only that instance. Another tab or another store for the same media scope can load the same counter and allocate the same blob name. Neither the transaction nor orphan cleanup has a scope-wide lock.

**Reproduced using the existing test suite's OPFS model:** open stores A and B for the same empty scope; load both indexes; A writes `a.sav = AAA`; B writes `b.sav = BBB`. Reopening shows only `b.sav`. Worse, A's cached record for `a.sav` reads `BBB`: both writers allocated `b000000000001.bin`.

**Impact:** this is more than last-writer-wins for one save. Writing a different file can erase metadata and substitute another file's bytes. Startup orphan cleanup can also race an in-flight writer.

**Fix direction:** serialize read-modify-commit and cleanup across all writers to the scope, reload the index inside that lock, and use collision-resistant immutable blob identities. Test two independent stores, not just closing and reopening one writer. The reproduction establishes the storage logic failure; it was not a real-browser multi-tab test.

### 3. P1 — A failed CLI overlay commit damages previously committed data

**Location:** [nodeDirStore.writeBatch](./lib/overlay-store.js#L201), also [remove](./lib/overlay-store.js#L228).

The Node store derives the blob name solely from the guest path and overwrites it before the index rename. The index rename is atomic, but the batch is not: the old index already points at the blob being overwritten. Deletion similarly unlinks the old blob before committing its removal from the index.

**Reproduced:** commit a three-byte save, attempt to replace it with six bytes, and inject an error at the index rename. The write rejects. A fresh store can no longer read the previous save: `6 bytes, index says 3`. Equal-length replacements would evade this size check.

**Fix direction:** write new immutable blobs, atomically publish a new index, then reclaim obsolete blobs. Preserve the prior in-memory index on failure too. Add failure injection between each persistence stage, including deletion; account for filesystem durability separately if power-loss recovery is promised.

### 4. P2 — Cross-thread frees silently leak valid heap allocations

**Location:** [heap_free](./src/10-helpers.wat#L814), especially the final bound check at line 865.

The allocator correctly reserves separate chunks for each WASM instance. `heap_free` initially recognizes the process-wide low-heap watermark, but subsequently requires the block's end to be below the freeing instance's private `heap_ptr`. A block allocated in a later worker chunk fails this check when the main thread frees it.

**Reproduced:** main allocates at `0x420004`; worker allocates at `0x520004`; main calls `guest_free` on the worker allocation. Main's free list remains zero: the free is ignored. The existing six-case heap-partition test passes because it primarily checks allocation separation, not this producer/consumer lifetime.

**Impact:** applications that allocate on a worker and release on the UI thread steadily lose reusable heap space. The finite backing makes eventual allocation failure possible even when the guest frees its objects.

**Fix direction:** validate against authoritative allocation ownership/extents, then reclaim through an owner queue or a correctly synchronized allocator. Do not merely relax the bound without preserving the existing malformed-block protections.

### 5. P2 — PostMessageA reports success when it drops a message

**Locations:** [capacity check](./src/10-helpers.wat#L4819), [discarded return value](./src/09a5-handlers-window.wat#L3164).

The local queue has 64 slots. `$post_queue_push` returns zero when full, but the handler drops that result and sets `eax=1` unconditionally. Its cross-thread branch already propagates the shared enqueue result, so behavior also depends on which thread owns the target.

**Reproduced:** 65 consecutive posts all return success; queue depth remains 64 and the final message is absent.

**Fix direction:** propagate enqueue failure and a useful error status. Review the other callers that discard the push result. Consider a larger bounded queue, but capacity alone does not correct false success.

### 6. P2 — Failed localStorage saves are forgotten instead of retried

**Location:** [VfsPersistence.flush](./lib/vfs-persistence.js#L96).

`flush()` clears all pending paths before persisting them and ignores each `persist()` result. A quota or storage error is logged, but the dirty mark is lost. A later successful flush or application close does not retry the save unless the guest modifies it again. The returned count is attempted paths, not successful writes.

**Reproduced:** persist `OLD`, inject a storage failure while saving `NEW`, restore storage availability, and flush again. The flush reports zero pending paths; a new VFS restores `OLD`.

**Fix direction:** preserve failed dirty marks, return explicit success/failure counts, and expose unsaved state to the caller. Retry with bounded backoff or explicit checkpoints, avoiding an infinite microtask retry loop. Apply the same recovery contract to both persistence implementations.

### 7. P2 — Save-sync's timeout stops before the response body is read

**Locations:** [request timer](./lib/save-sync.js#L89), [pull body read](./lib/save-sync.js#L151).

`request()` clears the abort timer as soon as the fetch promise yields a response. `pull()`, `metadata()`, and `getUser()` consume the body afterwards, outside that timer. A response whose body stalls therefore leaves the operation pending indefinitely despite the configured timeout.

**Reproduced with an injected fetch implementation:** return headers immediately and leave `arrayBuffer()` pending until cancellation. With a 10ms timeout, the operation is still pending after 40ms and its abort signal is false.

**Fix direction:** retain cancellation through body consumption, and release the timer in the outer operation's `finally`. Test delayed headers and delayed bodies independently.

### 8. P2 — The performance HUD counts budgets as executed instructions

**Locations:** [cooperative accounting](./host.js#L3950), [Worker accounting](./host.js#L3245), [HUD interpretation](./lib/perf-hud.js#L107).

The cooperative host calls `countSteps(activeStepsPerSlice)` before execution. This counts the requested budget even when the guest yields early. The Worker host normally counts completed blocks, but substitutes the requested budget when `ranBlocks` is zero. The HUD describes these values as instruction throughput and displays `M steps/s`.

The exported `run` argument is a block budget; a block is not a fixed number of x86 instructions or threaded operations. Consequently this metric conflates three different quantities and can report work that never ran. It cannot support comparisons between different guest code paths or scheduler settings.

**Fix direction:** count actual completed blocks after execution, including zero, and label that metric explicitly. Keep retired threaded operations, guest instructions, presents, and page frame rate separate. Add a zero-work/early-yield accounting test before using the HUD to justify optimizations.

### 9. P2 — Reloading a kept installation eagerly loads its entire overlay

**Locations:** [hydrate loop](./lib/vfs-overlay.js#L300), [full blob read](./lib/overlay-store.js#L401), [fixed guest memory](./host.js#L1771).

The original media uses lazy byte providers, but overlay hydration reads every saved file fully and retains every resulting byte array in the VFS before launch. Thus installing a large game converts its next launch from lazy media access into eager loading of the entire installed tree. A saved N-byte tree adds roughly N bytes of retained payload arrays, apart from transient copies, renderer resources, and the fixed 512MiB WASM linear-memory allocation. This is an allocation model, not a measured RSS figure.

The two-second durable overlay checkpoint also snapshots each dirty file in full on the main thread; a growing archive repeatedly dirtied by an installer can cause substantial copying and I/O.

**Fix direction:** hydrate metadata and provider-backed file entries, read ranges on demand, and move toward dirty-range/page persistence for large mutable files. Validate installed-tree reloads and checkpoints under a memory budget, not just small save round trips. No device-specific latency or memory benchmark was run for this review.

### 10. P2 — Cooperative browser slices have no wall-time bound

**Locations:** [cooperative run](./host.js#L3905), [synchronous WASM call](./host.js#L3952), [WASM block budgeting](./src/13-exports.wat#L8).

Cooperative execution enters a synchronous `run(activeStepsPerSlice)` on the browser's UI thread. Its block budget limits work in units whose cost varies with guest code, native API work, and super-operations. JS can schedule another turn only after that call returns. Main-thread input, painting, and audio-completion delivery all wait for that boundary.

The Worker path already adapts its block budget from elapsed time, but the cooperative path uses the configured value. Per-app slice tuning can improve known workloads while leaving untested phases vulnerable to long tasks. This is a code-established scheduling limitation; this review did not reproduce a specific frame-time regression.

**Fix direction:** use measured adaptive budgets and bounded polling points where execution can safely yield; keep heavy guest execution in Workers where compatibility permits. Validate maximum input latency and audio continuity alongside throughput.

## Design and test implications

- **Declare state ownership, not just its address.** Region overlap checks do not catch two instances using the same valid region as private storage. Document and enforce process-shared, per-thread, and per-instance ownership; add two-instance tests for queues, heap reclamation, timers, and teardown.
- **Make persistence guarantees common across backends.** Memory, Node-directory, OPFS, and localStorage paths have different failure behavior. A common contract suite should cover failed writes, failed commits, retry, competing writers, and reopen. Their passing normal round trips did not detect findings 2, 3, or 6.
- **Reduce duplicated execution orchestration.** `host.js` is 4,253 lines, `test/run.js` 9,906, and `thread-manager.js` 2,811. Browser/CLI and cooperative/Worker behavior have several orchestration paths. Extract shared accounting and yield/lifecycle rules incrementally, with backend parity tests; a wholesale interpreter rewrite is not warranted by these findings.
- **Replace positional ownership metadata with stable symbols.** The existing region-owner gate failed on 59 stale references during this review. Naming owners by source line creates integration failures after unrelated insertions. Preserve the check, but make its input a symbol or generated location. This corroborates an earlier review's design concern; it is not a newly discovered runtime bug.

## Validation and limits

The focused probe is saved at `/private/tmp/wa-project-review-probes.js`; run it with `node /private/tmp/wa-project-review-probes.js`. It creates disposable Node overlay fixtures in `/private/tmp`, uses the repository's fake OPFS implementation for the multi-writer case, and compiles the full current WAT source with one in-memory test wrapper. Its seven assertions reproduce findings 1–7; they are bug witnesses, not assertions that the implementation is correct.

Existing checks run successfully:

- VFS persistence, all 15 overlay cases, and batch-clock tests.
- All six heap-partition checks.
- WATX production compiler validation and ToyVM DOS-file semantics.
- WAT manifest, browser cache-version graph, and generated Worker import signatures (236 imports).
- Test membership and timeout gates: 900 files accounted for, none missing from the manifest.

The full current source compiled and instantiated for the probes. **This is not a green production build:** the required `check-region-decls.js --check-owners` gate failed on 59 owners in the actively edited tree. I did not regenerate or overwrite another lane's artifacts. One initial diagnostic used a nonexistent checker filename; the actual `gen-host-import-sigs.js --check` was then located and passed.

The complete 900-test suite, real-browser gameplay sweeps, real OPFS multi-tab behavior, and headful performance profiles were not run. Existing review claims and messageboard notes were used as leads only; for example, the current Bricks drag test does assert changed board pixels, so an older note claiming it checks only input injection is not a valid current finding. No source fixes, commits, or deployment were made.

Recommended order: repair queue ownership and both transactional overlay defects first; then cross-thread reclamation, truthful queue results, and save retry/timeout behavior. Correct the performance metric before evaluating the scheduling and memory changes.
