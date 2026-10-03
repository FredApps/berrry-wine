# Historical NFS3/GTA2 FPS semantics audit

Owner `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`, 2026-10-02 UTC. Read-only audit; no rebenchmark, import, result/UI/source edit, or network action. Evidence and reproducible calculations: `scratch/ops-historical-fps-semantics-20261002/{findings,input-hashes}.json`, collector excerpts and `audit.py`.

**The historical 33.9 and 29.9 values are reproducible raw guest Flip-event rates. The newly found public `onGuestFrame` duplication does not contaminate these collectors. Keep the evidence, but qualify dashboard “FPS” and “p95 frame” labels as historical Flip-event throughput/intervals; these records do not establish displayed or unique logical gameplay FPS. Do not halve the values or replace them with renderer-counter rates.**

## Exact artifact chain and counters

| App | Original result/collector directory | Published source | Recomputed rate |
|---|---|---|---|
| GTA2 | `build/lazy-games/default-gta2_demo/` | `scratch/runs/recovered-gta2-demo-d564f0c36f3ed3c8/performance-source.json` | 300 / 10.044909912109375 s = **29.8658726285 events/s** |
| NFS3 | `build/lazy-games/coverage-nfs3-on1/` | `scratch/runs/import-20260930T074616739Z-need-for-speed-3-demo/performance-source.json` | (515+504) / (15.02085498046875+15.029994873046875) s = **33.9091907539 events/s** |

Each published performance-source file is byte-identical to its original `result.json` and its published `performance.sourceSha256`. GTA2 source SHA `89d96b1d7ccf08c2366565749b25e8831d616a9f85da754980b480b4d549fca0`; NFS3 source SHA `bbd8f41a1ff15462cc54a1feb44a6277d02c11ca98ad99039ca7d9fddcb79a9e`. No statistical conversion from CPU seconds was involved.

Crucially, **both directories retain the actual served `guest-worker.js`**, SHA `a976cdd3e56c72e75bfac8143e098eccb46b462cda8249df97b9c6caa4e5db09`, exactly matching each historical result's `servedWorkerSha256`. At lines 416–424 it wraps `built.imports.host.dx_trace` before WASM instantiation, appends `performance.timeOrigin + performance.now()` only when `args[0] === 6`, enforces a 120,000 timestamp limit, then calls the original import unchanged. It does not hook `onGuestFrame`, count kind 5, count both 5+6, or timestamp page-side forwarded callbacks. This is direct historical collector evidence, not inference from present-day code.

The saved snapshots contain timestamps and thread IDs, **not surface slot/kind/sequence tuples**. Kind is established from the hash-matched collector. Each window has one nonempty producer (worker ID 0, guest TID 1), with recorded `threadTransitions:[]` and `errors:[]`. Other saved workers have no timestamps. This rules out aggregation of multiple timestamp-producing workers in these samples, but not multiple front/surface streams within that one guest thread.

Filtering the saved timestamps inclusively with `before.at <= t <= after.at` reproduces every published frame count, duration and p95. Sorted successive event intervals use index `floor(intervalCount*0.95)` (zero-based), reproducing GTA2 **40.340087890625 ms**, NFS3 **54.219970703125 / 55.195068359375 ms**. There are no zero intervals in these three samples. The saved p95 is an inter-Flip-event statistic, not 1000/FPS or a measured scanout interval. The dashboard's `ops/readers.js:15–21` correctly computes total events over total duration; its arithmetic is not the issue.

NFS3 renderer-stat `delta.flips` is 258/252 whereas captured guest kind-6 events are 515/504; GTA2 reports 300/300. These are distinct observation points with potentially different scopes (e.g. renderer-queued versus all guest Flip paths). The records do not justify treating the difference as duplicated guest telemetry or applying a factor-of-two correction. Exact historical module/source semantics would need additional identity proof.

## Historical identity and timing limits

Both results report WASM `2c3477ace32507c4f24c252eafd49ae24ce0e6bfda872ee391f05c7aae4d7878`, original worker `85382b7df8e519215198ba9879d9cf75b341273a54a0e8fac8d5ab02a588fb7f`, and eight host/render source hashes. Module bytes and the complete historical served source closure were **not** established by this bounded audit. The served collector's exact hash match is sufficient to identify the hook, but not every possible WAT emission path in that module.

The current `tools/bench-lazy-games.js` has since added instrumentation, options and surface counters; its bytes must not be called the original collector. A nearby checked-in harness version `a112091b01a14ec8a0e4f52ff29f58a0a7cb2df1` has the same kind-selection/filter/statistic design, but is **not a proven historical source checkout**: comparing its source files with recorded hashes matches only five of nine checked files; host.js, guest-worker.js, thread-manager.js and d3dim-gpu.js differ. Full comparisons are recorded in findings.json. No source-commit identity is inferred from chronological proximity.

Timestamps are epoch-aligned `timeOrigin+now` values from the originating Worker; window bounds are saved page-state timestamps. The archived collector does not arm/disarm within its own clock. The nearby harness reads worker snapshots first and page time afterwards, so a possible end-snapshot gap is a limitation of that design; the exact old full driver hash is absent, and this ordering is not asserted as proven for the historical run. No clock-alignment calibration or exact event-completeness bound was saved. Do not describe these as the new same-context arm/stop protocol.

The historical source records Chrome151/AMD Ryzen9950X; published labels correctly disclose actual CDP SwiftShader. A renderer endpoint's Intel string contradicts CDP GPU information and is not hardware proof. Neither historical run satisfies a new quiet-host/hardware qualification. Their existing scene screenshots support race/world appearance, not continuous scene validation throughout every timing interval.

## Concrete metadata/UI correction recommendation

1. Preserve raw sources, all sample numbers, image/build provenance, `historical:true` and SwiftShader disclosure. No withdrawal is needed **because of the public callback duplication**; that counter was not used.
2. Replace ambiguous card text “33.9 FPS” / “29.9 FPS” with “33.9 guest Flip events/s” / “29.9 guest Flip events/s” and sample “p95 frame” with “p95 Flip interval.” Keep these out of any comparison claiming validated logical/displayed game FPS. If the existing schema/UI cannot express that distinction, suppress these values from the generic game-FPS field while retaining them as historical diagnostic artifacts; do not silently rename unsupported schema metrics.
3. Suggested notes for both: “Historical originating guest dx_trace kind-6 event rate. Archived served collector SHA matches the recorded run. One timestamp-producing guest thread; surface IDs were not retained. Event count is not verified unique game frames, scanout FPS or current-build performance. Page-boundary/worker timestamps use epoch alignment, without a saved same-context arm/stop calibration. SwiftShader software rendering.”
4. Retain exact p95 values with their historical index convention; do not silently recompute to a different percentile definition or infer hardware frame latency. Existing `metric:"guest-presents"` may remain a coarse internal family only when notes/UI explicitly distinguish Flip submissions from qualified gameplay frames.

Root/ops-dashboard owns any integration. This handoff changes no existing artifact or published value. Input-hash recheck covers original result/collector and published source/result/provenance files for both runs.
