# Host launch asset cancellation and retained sources

Scope: host.js and test/test-asset-load-cancellation.js only. Before snapshot, scoped patch and hash/test receipt at scratch/claude-launch-ux/host-corrections-20261004/. Existing unrelated host work preserved. Files released to root.

Corrections: pre-aborted cached fetch/load rejection; separate retained source bytes from caller/VFS writable storage; launch AbortSignal supplied only to range discovery HEAD, never lazy gameplay GET; cancellation checked after awaited asset/decode and before every mount/new item; worker pool uses allSettled before propagating cancellation/rejection, preventing caller instance cleanup while sibling continuations remain. Shared WASM loading/cache untouched.

Memory cost: retention keeps one extra full source-byte copy on first download; retry obtains a fresh writable copy. No copy added when retention disabled. Aliases within one load retain existing shared-data behavior. Retry controller owns retained-map lifetime.

Validation: six focused actual-host-source VM tests using real VirtualFS and HttpRangeProvider pass; existing test-asset-parts passes; tier gate passes. Covers preabort/no progress, VFS in-place write then clean retry, aborting HEAD without fallback, sibling late HEAD settlement/no later mount or item, abort during decode, lazy later range read after signal abort. Three cases fail against saved before source, proving regressions.

Limits: uncancellable image decode/foreign fetch promises must settle before cleanup; this deliberately waits instead of racing instance teardown. Native HEAD fetch now receives signal and can unwind promptly. Existing retry backoff remains bounded250/500ms and is checked before the next attempt. No browser qualification done in this scope.
