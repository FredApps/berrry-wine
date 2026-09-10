# Project review — 2026-09-09

## Continuation — thread lifetimes and sparse-save prerequisites

### Latest increment — deferred native help navigation

```text
+----------------------------------------------------------------------------------------------------------+
| NATIVE HELP LINKS                       OWNED TRANSACTIONS / OUTER HOST PUMP                              |
+----------------------------------+----------------------------------+------------------------------------+
| CLICK                            | WAIT / RETRY                     | COMPLETE OR CANCEL                 |
| retain target and source identity| keep guest CPU + wait state     | publish one document + Back entry |
| prepare HLP + optional CNT       | fill one owned chunk per turn   | reject stale / failed navigation  |
| preserve existing document       | never consume foreign pending IO| release handles and owned strings |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: macro DLL / callbacks      | THEN: render-time font loading  | GATES: memory + input/audio       |
+----------------------------------------------------------------------------------------------------------+
| LAZY DEFAULTS STILL OFF          | ISOLATED BRANCH, NO DEPLOYMENT   | REVIEW GOAL REMAINS OPEN           |
+----------------------------------------------------------------------------------------------------------+
```

Native external help links now retain an explicit operation identity, independent of the guest stack frame. Source document epoch, topic, and window identities reject obsolete work. A queued click leaves the existing document/view/history intact; successful preparation transfers ownership into the existing synchronous navigation transaction and presents exactly once. New clicks and close cancel the queued operation.

The shared host pump services this work at outer scheduler boundaries in browser cooperative mode, Workers, and the CLI. It does not inject an artificial IO_WAIT or clear an existing guest wait. Each invocation fills at most one owned pending request and retries once; awaiting that read can still pause the owning guest loop, so this is not a latency or continuous-interactivity claim. Descriptor identity checks protect unrelated reads and late completion. A dedicated atomic file-read bridge closes the check/read race between Worker RPCs without changing the ordinary ReadFile contract.

Cross-check: Fable's overlay/retry work remains useful prior evidence, but its review does not establish resumable native help navigation or safe macro callback replay. This increment extends the already-reconciled legacy-read work; it does not close render-time font preparation, large-install memory acceptance, or the unresolved microphone-startup baseline failure. Lazy hydration and range writes remain opt-in.

Validation: canonical/compatibility builds pass at source 305 (1,057,740 / 1,058,193 bytes), unchanged layout `b00c9d60346fdb5a`, 237 imports, 233 nonoverlapping data segments, and 926 registered tests. The compiled parser suite passes 631 checks, including eventual zero-cache navigation, exactly-once presentation, read failure, foreign pending IO, source replacement, and unchanged EIP/ESP/yield flag/wait descriptors/stack bytes. Owned preparation, A/W and real Win16 retries, registry lifetime, VFS ownership, scheduler, and overlay lifecycle regressions pass. The shared pump tests cover bounded fills, stop/fault behavior, idle/frozen scheduling, and sleeping Workers—including a sleep that expires during the fill, without uncounted guest execution. Pipe Dream's four real Help checks and all six real AoEHlp.dll macro checks pass against this build. These are targeted functional results, not full-suite, memory, or latency acceptance.

The final-source Chrome Worker gate also passes, with normal browser/server cleanup and exit 0: Notepad/Calculator parity, both Rodent rendering/input checks, Winamp's three actual Workers without traps, and COM success/failed-fetch recovery. This run includes the final help-only scheduling fix. No performance improvement is claimed.

Next implementation slice: public `WinHelpA/W(HELP_COMMAND)` needs an owned macro operation spanning DLL staging and a typed guest-return continuation. Copy registry/normalized-W strings before retaining them, publish only fully staged DLL bytes, and let normal scheduling resume a callback that waits. Do not replay a callback after its side effects begin. Native macro hotspots require an additional callback-entry design that preserves the interrupted guest wait and host sleep deadline; the CPU-neutral navigation pump alone cannot safely execute guest callbacks.

### Prior increment — transactional help loading

```text
+----------------------------------------------------------------------------------------------------------+
| HELP LOADING FOLLOW-THROUGH                                                                               |
+----------------------------------+----------------------------------+------------------------------------+
| IMPLEMENTED                      | RELIABILITY GUARDS               | STILL REQUIRED                     |
| prepare HLP + optional CNT       | preserve old document on misses | deferred native hyperlink loading |
| before publishing either        | rollback failed replacement     | resumable macro DLL/callback work |
| A/W + Win16 frame-safe retries   | retain bounded Back history     | render-time font preparation      |
| registry-owned DLL name lifetime | cancel abandoned preparations   | memory + input/audio acceptance   |
+----------------------------------+----------------------------------+------------------------------------+
| DEFAULT LAZY SAVES: OFF          | NO MAIN MERGE / DEPLOYMENT       | REVIEW GOAL REMAINS OPEN          |
+----------------------------------------------------------------------------------------------------------+
```

Help-file loading now separates bounded byte preparation from parsing/publication. HLP and optional CNT reads retain handles, paths, buffers, and monotonic 4KiB progress across misses; no document replacement or registration macro runs before both inputs are ready. A failed replacement restores the original document rather than destroying its valid window. Parsing uses one private rollback snapshot, including when all four public Back-history slots are occupied, and disposes that temporary record before returning.

WinHelpA/W propagate pending before presentation or stdcall cleanup. The Win16 USER.171 path retains its actual Pascal frame rather than the shared 32-bit bridge scratch stack; it parks before returning and preserves CS and the far return address. Invalid replacement paths and HELP_QUIT discard abandoned same-frame preparations without canceling unrelated nested calls.

Independent review also fixed a registry lifetime bug: help macro DLL lookup failures no longer free a filename still owned by the document. External native hyperlinks prepare before snapshotting and safely reject a cache miss without replacing the current document or leaking staging. **That guard is not resumable hyperlink support:** native message dispatch still needs an owned deferred operation. Macro DLL staging and guest macro callbacks that themselves wait for I/O also remain incomplete; replaying their earlier side effects is not a valid retry strategy.

The native-click regression exposed a VFS cancellation defect: closing a pending handle left its miss descriptor advertised. Close now clears only the matching descriptor, preserving unrelated pending consumers. The VFS suite passes 35 checks and the full help parser/native-view suite passes 622 checks, including unchanged document/window/view/history and no pending handle after a rejected native cache miss.

Render-time font preparation remains a separate gate. Loading can occur inside font binding, enumeration, controls, help, metrics, glyph queries, and metafile playback—not just TextOut. Any preparation design must preserve provider identity, bound owned bytes, cover Worker/direct-native entry points, and handle dynamic font replacement; indiscriminately filling the 32-face parsed cache changes behavior.

Validation: canonical/compatibility builds pass at source 304 (1,056,787 / 1,057,240 bytes), unchanged layout `b00c9d60346fdb5a`, 236 imports, 233 nonoverlapping data segments, and 925 registered test files. Compiled tests cover real A/W and Win16 entry points, zero-cache repeated misses, per-chunk read faults, short EOF, malformed HLP/CNT rollback, optional missing CNT, full Back history, nested preparations, and cancellation. Pipe Dream's real Win16 Index, Overview link, How to Play, and Commands checks pass against this exact build. These are functional results, not a full-suite or performance claim.

The final-source Chrome Worker matrix also passes with normal browser/server cleanup: Notepad/Calculator parity, both Rodent render/input checks, Winamp's three Workers, and COM success/failure recovery. The existing real AoEHlp.dll macro test passes all six checks after explicitly mounting its DLL alongside its existing HLP/WAV fixtures; it previously checked that DLL on disk but omitted it from the bare Notepad VFS. Assertions remain unchanged. The new ownership regression covers 14 failed lookup attempts followed by registry cleanup. Neither eager macro success nor this ownership fix proves asynchronous macro callback support.

### Prior increment — image/font consumers and safe deadline polling

```text
+----------------------------------------------------------------------------------------------------------+
| REVIEW FOLLOW-THROUGH                       IMPLEMENTED / NEXT                                            |
+----------------------------------+----------------------------------+------------------------------------+
| FILE READ SAFETY                 | COOPERATIVE RESPONSIVENESS       | REMAINING GATES                    |
| BMP: staged A/W reads, no dummy  | monotonic f64 clock, local in    | render-time font preparation       |
| GDI+: bounded header retries    | Workers; complete-block polls   | HLP/CNT/navigation/macro retries   |
| fonts: explicit registration,   | cached chains stop safely;      | installed-tree memory acceptance  |
| FON / TTF / FOT + cached reuse   | nested callback/trap restoration| headful input/audio acceptance    |
+----------------------------------+----------------------------------+------------------------------------+
| LAZY SAVES REMAIN OPT-IN         | NO HARD PREEMPTION              | NOT MERGED INTO MAIN / DEPLOYED   |
+----------------------------------------------------------------------------------------------------------+
```

`LoadImageA/W` retains its handle and bounded guest staging across monotonic 4KiB reads, including actual UTF-16 paths. Explicit file errors return NULL rather than a dummy bitmap; header/mask/palette/pixel bounds are checked before parsing. `GdipLoadImageFromFile` retains a bounded 4KiB header read, returns real errors rather than 1x1 placeholders, and does not publish an object while pending. Their compiled real-VFS tests cover zero/tiny caches, repeated misses, read faults, malformed/short files, nested calls, reused frames, and cleanup.

Explicit font registration stages bytes before FON/TTF parsing or FOT publication. Completed staging is copied into the existing owned font storage and released; lazy VFS entries are not permanently materialized. Return-address/argument guards prevent reused stack frames from consuming an old call's bytes. Independent review caught a cached-face regression; cache-only lookup now preserves registration after source deletion and avoids redundant reads. Compiled regressions cover FON/TTF/FOT, pending/fault behavior, cached and uncached fallback, nested calls, replacement, and no premature FOT publication. Nested render-time font loading remains synchronous and still needs a safe preparation boundary.

`run_budgeted` checks a dedicated monotonic f64 clock between complete x86 blocks, including cached branch chains, with one clock poll per 32 boundary checks. Mandatory `resume_ip` completion takes precedence, including `run(0)`. Plain `run` disables polling and restores the enclosing budget on normal return; COM, DLL, and cooperative-message JavaScript callbacks restore the flag in `finally` after caught traps. Top-level host calls clear it on failure. Worker clocks are local, never blocking RPCs; deterministic/frozen runs use plain `run`. Cooperative peer deadlines translate remaining time from the scheduler's clock into the monotonic clock origin, including `maxWallMs`-only callers.

Compiled deadline tests pass for cached chains, exact retired work, expired deadlines, mandatory completion, timestamps beyond i32 range, synchronous suppression, nested calls/caught traps, and instance isolation. Host/peer scheduler and DLL callback regressions pass. These are safe-boundary checks, not preemption of an individual native, REP, or presentation operation; no hard latency guarantee is claimed.

Final-source canonical and compatibility builds pass at source 303: 1,055,793 and 1,056,246 bytes, 236 host imports, unchanged layout `b00c9d60346fdb5a`, and 233 nonoverlapping data segments. All 922 test files have tier membership; that is not a full-suite run. Existing font metrics, substitutions, default bitmap-font, and enumeration regressions also pass. The final-source real Chrome Worker matrix passes: Notepad/Calculator parity, both Rodent rendering/input checks, Winamp with three Workers, and COM success/failed-fetch recovery. Browser/server cleanup completed normally and the harness exited zero. Host load was 12.97, above the repository's load-4 measurement threshold; no throughput, input-latency, or RSS improvement is claimed.

Next: transactional HLP/CNT loading and help navigation/macro continuations, render-time font preparation, then installed-tree memory and headful input/audio acceptance. Lazy hydration/range writes remain opt-in. The prior microphone-startup baseline failure remains unresolved. Fable's broader structural/scheduling work is separate evidence, not proof these retry/deadline paths were safe; the already-reconciled legacy-read fix remains intact.

### Next consumer and lifecycle increment

Historical source-302 evidence follows; the latest increment above supersedes its next-step list.

```text
+----------------------------------------------------------------------------------------------------------+
| CONTINUATION TLDR                           IMPLEMENTED / NEXT                                           |
+----------------------------------+----------------------------------+------------------------------------+
| FILE CONSUMERS                   | STOP / SAVE OWNERSHIP            | STILL REQUIRED                     |
| fgets: preserve line progress    | wait for boot, steps, Workers    | BMP / GDI+ pending reads           |
| sound: staged WAV + shared stop  | refresh final exit snapshot      | font registration + nested loads  |
| version: five resumable stages   | retain failed saves for retry    | help/CNT/navigation/macros         |
| legacy reads: reuse Fable fix    | lease each in-flight launch      | real large-install memory checks  |
+----------------------------------+----------------------------------+------------------------------------+
| DEFAULT LAZY SAVES: OFF          | NEXT: finish consumers -> enable/measure saves -> safe WAT polling    |
+----------------------------------------------------------------------------------------------------------+
```

`fgets` now retains its completed character count and file position across misses instead of rewinding the line. A real VFS with zero retained-cache bytes completes a 1,026-byte line with monotonic progress; compiled tests cover nested calls, frame reuse, faults, EOF, and cleanup.

File-backed sound loading retains its handle, WAV buffer, and copied offset across 4KiB reads. Real-thunk tests cover ANSI, Unicode, and legacy entry points, one playback after completion, read failures, invalid WAVs, and cancellation without reopening a stopped sound. A shared atomic stop generation also cancels a peer WASM instance's pending load; this does not change the preexisting instance-local active-voice ownership.

Version-resource parsing resumes at five explicit read stages (DOS header, PE header, section table, resource section, version blob). Completed buffers survive cache eviction; no caller output is published while pending. All four A/W size/info APIs pass real-thunk zero-cache success and per-stage failure tests, including nested calls and final handle/frame cleanup.

The released Fable legacy-read consolidation (`4d5ba5f3`) is reconciled into this candidate: `_lread`, `_hread`, and `mmioRead` share EOF/fault/pending behavior, including the Win16 bridge's ownership of its Pascal frame. Its original regression is retained; the review's newer MMIO navigation continuations remain intact.

Stopped trees now have an explicit owner through producer quiescence, snapshot handoff, and the final durable flush. Stop joins active guest steps, boot completion, Worker termination (including starting workers), and detached read fills before releasing memory/maps. Exit and chained-launch snapshots refresh after those producers settle, preserving late-created files. Failed flushes retain the original tree for retry with a visible warning; same-media durable relaunch retries rather than hydrating a stale manifest. Session child launches can still adopt the retained live snapshot without pretending a failed save was durable.

In-flight launches acquire their own snapshot lease before callbacks or awaits, so replacing a same-executable registry entry cannot clear the pending mount. Worker startup publishes its producer before awaiting readiness and stops it on failure; failed termination propagates rather than silently falling back with an orphan producer. Targeted regressions cover both races and stop-during-start.

Focused lifecycle tests cover these barriers and final provider release; existing overlay, thread-manager, scheduler, and shell-launch regressions pass. Canonical and compatibility builds pass at source 302, layout `b00c9d60346fdb5a`, 918 registered tests, and 233 nonoverlapping data segments. Membership checks are not a full-suite run. Default lazy hydration remains disabled pending bitmap/font/help consumers and large-installation memory acceptance; safe WAT polling and headful input/audio acceptance also remain open.

The final-source real-browser Worker matrix passes on the rebuilt candidate after the startup-cleanup and snapshot-lease fixes: Notepad/Calculator parity, both Rodent gameplay/input checks, Winamp with three Workers, and COM success/failure unpark. The harness closed its browser/server and exited normally. This is functional evidence, not a latency or memory benchmark.

Next consumer order: file-backed BMP/GDI+ loading, explicit font registration, transactional HLP/CNT loading, then nested font fallback/help navigation/macro DLL continuations. These must retain bounded parser buffers without permanently materializing lazy VFS entries, and must not replay prior native side effects.

### Follow-through committed in c16666d3

This section records that commit's evidence and then-open follow-ups; the next increment above supersedes its consumer status.

The next increment adds opt-in `lazyHydrate:true`: metadata mounts without reading payloads, while managed entries retain version pins. A synthetic 24GiB tree mounts with zero payload/cache bytes; two small reads populate 262,159 retained cache bytes in the final operation-owned read path, not whole-file arrays. This is allocation accounting, not an RSS or device-memory benchmark. Default hydration remains eager pending remaining consumer/lifecycle gates.

`LZRead`, `LZCopy`, `mmioDescend`, and `mmioAdvance` now handle pending I/O. Copy progress is preserved rather than rewriting a committed prefix; multimedia navigation preserves its current search position and completed header across retries while restoring caller-visible fields and frames. A 301-chunk RIFF scan completes with 113 fetches/parks using only two 32-byte cache pages; a separate one-page test verifies that waiting for a form type never restarts an evicted header. Compiled-dispatch tests cover repeated misses, independent/nested copies, terminal cleanup, and faults versus EOF.

Lazy overlays share a 16MiB retained-chunk budget by default (configurable), including sparse checkpoint rebases. Evicted data remains readable; final owned-provider release clears retained chunks. In-flight reads and operation-result buffers are separate from this retained-cache cap, so it is not a total-memory limit. A real host-import regression reads 16KiB across four discontiguous guest mappings with an 8KiB cache, checking exact bytes, cursor, count, invalidation, untouched backing gaps, failures, and EOF. The import requests one logical file range, then scatters completed bytes: retrying separate mapping-sized prefixes could otherwise loop forever under cache eviction.

Independent review caught concurrent fills overwriting a single retry result. Direct asynchronous reads now return their own bytes; pending VFS reads retain a handle-owned completion guarded against provider replacement, revision changes, and close/reuse. Same-range and distinct-range concurrent handles, sparse dirty-separated spans, and oversized unbudgeted reads are covered. One prior limitation remains: `fgets` rewinds its whole line on a miss, so extreme cache pressure can still alternate prefix misses indefinitely. Its existing compiled retry/fault suite passes, but a progress-preserving continuation is required before default lazy enablement.

Cooperative main, worker, wake-drain, and no-window dispatch now share one absolute 8ms turn deadline. Deferred wakes stay ordered ahead of the signaling main thread; deferred workers and equal-priority peers get subsequent turns. Frozen budgets and mandatory `run(0)` completion remain intact. Deterministic tests pass, but individual WASM/native/presentation calls can still overrun. Safe WAT block-boundary polling and loaded headful input/audio acceptance remain outstanding; this is not hard preemption.

The current WAT increment passes canonical/compatibility builds at source version 301 (915 registered tests; membership is not a full-suite run), unchanged layout `8566329207cd7d8f`, and 233 nonoverlapping data segments. The browser Worker matrix passed before the final MMIO/cache/scatter follow-up. The audio browser test fails at microphone capture startup (line 773), reproduced on prior commit `5397dea7` with byte-identical test files; Pinball music passes in both. This is an unresolved baseline failure, not audio acceptance. Performance acceptance must wait for a usable measurement environment: the observed host load was 84.14 at this pass, well beyond the repository's load-4 benchmark threshold. Functional checks are not presented as latency measurements.

Remaining safe-poll design: a dedicated monotonic f64 host clock, polls after `run` completes any `resume_ip` and before dispatching another block, plus the successful fast-chain boundary in `branch_end`. Plain nested `run` must disable/restore the outer budget; caught COM callback traps additionally require JS `finally` restoration. Frozen/Worker execution remains separate. No polling halfway through an instruction stream, native operation, or synchronous callback.

The earlier continuation is committed as `6653eb1a` and `5397dea7` in `/private/tmp/wa-review-integration` on top of integrated `a7f96c77`; current follow-through is recorded by the commit containing this update. These increments are not yet integrated into main or deployed. Prior integration evidence below does not substitute for testing these changes.

```text
+----------------------------------------------------------------------------------------------------------+
| NEXT-PASS TLDR                             IMPLEMENTED / STILL OPEN                                       |
+----------------------------------+----------------------------------+------------------------------------+
| THREAD LIFETIMES                  | SAVE MEMORY FOUNDATION           | REMAINING ACCEPTANCE               |
| reset shared ring BEFORE ID      | immutable, pinned versions       | #9: lazy hydration remains OFF    |
| publication; keep startup posts  | 64KiB sparse dirty pages          | internal/audio reads must park    |
|                                  | bounded backend reads             | complete shutdown/lease lifecycle |
| slot reuse waits for actual      | exact-commit checkpoint snapshots | real browser + large-save checks  |
| worker termination + callbacks   | concurrent edits survive flush    |                                    |
| whole-turn deadline implemented | shared retained-cache budget     | #10: safe block-boundary yields   |
| real Worker/full-WAT tests PASS  | CRT/LZ/MMIO retry tests PASS      | headful input/audio measurements  |
+----------------------------------+----------------------------------+------------------------------------+
| SAFE ORDER: finish file consumers -> enable lazy saves -> measure memory -> bound and measure UI turns     |
+----------------------------------------------------------------------------------------------------------+
```

- Shared-ring reuse now resets under `LOCK_WND` before publishing a replacement thread ID. Slots stay reserved through asynchronous slice/wait completion and actual Node worker termination. Canceled spawns cannot revive exited threads; stale teardown cannot delete replacement workers. Full-WAT and real-worker tests pass, including 64 startup posts surviving initialization.
- `feof`, `fread`, `_read`, and `fgets` distinguish pending reads from EOF/failure and park without corrupting cdecl frames. `fgets` rewinds partially consumed bytes before retrying. Compiled-dispatch tests cover repeated misses, faults, EOF, cursors, and stack cleanup.
- Sparse writable providers preserve untouched bytes, zero truncated/reextended tails, and copy independent dirty pages. Tests cover a 3GiB logical file, small edits without base reads, cache-boundary reads, concurrent materialization, and 250 eager-oracle operations. Zero-byte writes no longer extend files merely because the cursor is past EOF.
- Stores expose leased `openSnapshot()` providers and bounded immutable extents. `writeBatch(records, {snapshot:true})` returns the exact committed version under the transaction lock. Node and model-OPFS tests cover failed publication, overwrite/delete with pinned old versions, final-release reclamation, and dirty-only writes.
- Managed VFS maps retain shared entries/providers across adoption and shell snapshots. Materialization and pending fills retain providers during I/O. Cleanup errors remain visible without poisoning the next checkpoint. Full launch/stop/cancellation lifecycle acceptance remains.
- Canonical and compatibility builds pass: source version 300, unchanged layout `8566329207cd7d8f`, 910 manifest entries, 233 data segments without overlaps. Focused sparse-provider, VFS, checkpoint, ownership, CRT, and thread regressions pass. This is not a full-suite or device-performance result.
- Real Chrome OPFS validation passes: 26 files survive competing two-tab/same-tab writes; an exact-commit snapshot remains readable through another tab's overwrite, deletion, and scope removal. Final release leaves zero orphan blobs and zero snapshot manifests. This validates real Web Lock/OPFS lifetimes, not just model backends.
- The rebuilt candidate's full browser Worker matrix passes: Notepad/Calculator parity, both Rodent gameplay/input suites, Winamp (three workers, readiness 2.008s), and COM load/unpark. This does not establish that historical intermittent readiness failures are fixed.
- Final independent review added fail-closed duplicate-index validation, all-settled store lease cleanup with truthful committed results, and preservation of a later read fault while `fgets` retries its cached prefix. Focused regressions reproduce each failure; cleanup errors remain observable and do not skip remaining releases or poison later checkpoints.
- **#9 remains open:** `rangeWrites:true` and `lazyHydrate:true` are opt-in; ordinary hydration remains eager. A checkpoint rebase makes even initially eager files async-only. Sound/version helpers and bitmap/font/help loaders still need safe outer-boundary retry or an explicit preload contract; the separate Fable `_lread`/`_hread`/`mmioRead` work must be reconciled before default enablement. Sparse COW removes the earlier need to park write-opens themselves; remaining byte consumers and lifecycle completion are the blockers. No large-installation memory benchmark is claimed.
- **#10 remains open:** the whole cooperative turn now shares one monotonic deadline, but individual native/REP operations remain non-preemptible. Next: safe polls at complete block boundaries including fast branch chains, deterministic nested/resume tests, then loaded headful input/audio measurements. Never yield halfway through a threaded block or synchronous guest callback. No hard latency guarantee is claimed.

## Earlier execution update — integrated baseline a7f96c77

This section records the previous integration. Its then-open follow-ups and test counts are superseded by the continuation above.

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
