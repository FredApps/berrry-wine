# Historical Flip-event labels

Worker `/root/fp_parity`, Codex `01a0f9db-4a5d-7733-ade9-8b71d8e3f05f`, 2026-10-02. Bounded OPS-GAME-FPS-BASELINE metadata/UI integration complete in source. No browser, emulator, build, network, HTTP test, live terminal/server change or new measurement.

The two archived values now have explicit `performance.counterKind:"guest-flip-events"`. `ops/readers.js` recognizes that optional discriminator and preserves it; an unknown explicit kind rejects the performance record instead of silently presenting it as FPS. Omitted discriminator retains the existing behavior. `ops/app.js` renders **guest Flip events/s** on the card and sample rate column, and **p95 Flip interval** in sample details. Existing records without the discriminator retain their labels. Historical and SwiftShader disclosure remain visible. `ops/README.md` documents the field and historical percentile convention.

Only `performance.counterKind` and `performance.notes` changed in these two published records:

| Record | Preserved rate | Preserved p95 Flip interval(s), ms |
| --- | --- | --- |
| `scratch/runs/recovered-gta2-demo-d564f0c36f3ed3c8/result.json` | 300 / 10.044909912109375 = 29.865872628518346; display **29.9 guest Flip events/s** | 40.340087890625 |
| `scratch/runs/import-20260930T074616739Z-need-for-speed-3-demo/result.json` | 1019 / 30.050849853515625 = 33.909190753911005; display **33.9 guest Flip events/s** | 54.219970703125; 55.195068359375 |

No count/rate correction factor was applied. The archived source collector counted originating `dx_trace` kind6; the public-frame-callback duplication does not apply to it. Notes explicitly retain: one timestamp-producing guest thread, missing surface IDs, no demonstrated unique logical/displayed frame count, epoch-aligned page/worker boundaries without saved same-context calibration, SwiftShader software rendering and no current-build validation. The original sorted-interval percentile index `floor(intervalCount*0.95)` is documented, not recomputed or averaged. The `frames`/`fps`/`p95FrameMs` keys remain compatible storage names; the discriminator determines their displayed semantics. Full source reasoning remains in `ops/handoffs/ops-historical-fps-semantics.md`.

Validation: `node --test --test-name-pattern='FPS uses|Flip-event performance' ops/ops.test.js` passed **2 selected cases**, exit0. Coverage includes both exact historical arithmetic examples, untouched p95 values, weighted rate, zero, invalid samples, recognized/unknown discriminator, actual card/detail HTML labels, historical/SwiftShader display and unchanged default labels. The test executes only the real isolated `corpusFps` function through Node VM, without DOM, timers or HTTP. `node --check ops/app.js` and `node --check ops/readers.js` passed. No older broad/browser tests were repeated.

`scratch/ops-fps-labels-20261002/` contains pre-edit snapshots, `owned.patch`, `tests.log`, and `verification.json` with all six changed-file hashes. The patch preserves pre-existing dirty work. Both records were deeply compared with their originals after removing only the two allowed field changes: every numeric sample, p95, raw-source hash, image reference, build, timestamp, outcome and `historical:true` field is identical. Eight other bundle files, including images, raw source reports and provenance, remain byte-identical. Raw performance-source SHA checks pass for both records.

Source identities at handoff:

- `ops/readers.js`: `7fa2b075709831e90f5034668f6c56695384583cdd809ea5c29bfb9dd9fae6fc`
- `ops/app.js`: `d3f5ddb59a6f7238ec0856a986833e280e4c2998efc62e2877e0fcde51a32406`
- `ops/ops.test.js`: `19bcc4dc478f3d917c247d8f00bebd7a361a81ebeda2547e364a1c65259ab88d`
- `ops/README.md`: `1fea106c39cdd500c952d8c76001a221aaab650d2df4fdcb3acfc3b0dfe7a745`
- GTA2 published result: `e5202a2133bfb97b96c39226c53d2cb30dff84144d77b29c2cad935ecf7808b0`
- NFS3 published result: `46990bdd27a0db28f066667ce0bda08b446722c327001aab4d7beefe01314914`

Live-service limitation: an already running dashboard process may retain the previous `readers.js` module in Node's require cache and omit the new discriminator from its API. The owner must load the updated reader through its normal service lifecycle before claiming the live dashboard displays these labels. This worker did not restart or signal service8098 or touch Telegram/server/terminal files. No fresh performance acceptance follows from the labeling correction. Shared-file claim released to coordinator; no resource slot held.
