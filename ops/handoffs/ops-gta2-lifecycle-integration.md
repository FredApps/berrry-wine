# GTA2 multi-context lifecycle source integration

Owner serious_review / codex:01a0f9db-89c0-73b3-b528-fe8bf239e061. Static integration complete/released for root review; no browser/modulebuild/network/archive/runtime. New isolated `scratch/ops-gta2-lifecycle-integration-20261002/fixture`. Prior GTA2 fixture/results/assets remain unchanged. Accepted fullFPS objective remains open; this slice only observes source-backed callback history with explicit atomicity limits.

## Preserved inputs and exact hook

Copied all12,350 original regular paths (12,348pinnedinputs plusmanifest/binding) after rehash. Only existing driver and manifest/binding changed in copy; two new helperfiles added. Original Up/Right/Up route helper byte-identicala6f62191, same normalworld/menu/input durations and images. Module da5bf93b, allsource/compiler/host/assets untouched. Accepted prototypeobserver f2dfe713 copied byte-for-byte; prior11purecase acceptance retained.

New integration helper serializes actual makeReaders/createObserver functions with a local assertion shim into the unique frozen `WebAssembly.instantiate(msg.module,built.imports)` seam. Immediately before instantiate, source-derived DxObjectlayout, msg.memory, actual RegionMap and per-run/threadslot/origin uniqueidentity install oneobserver. Initial snapshot and all5/6/21/22 recording thus precede that worker's guest execution; duplicate installation/missingoriginaltrace refuse. The wrapper forwards originaltrace this/arguments/result/throw. Original WorkerGPUprobe retained; no guest memorywrite/export/flush/hostRPC/log added by observer. Full servedoverlay parses. No allocation/free mutation-site ordering claim.

Page coordinator attaches workercreated/destroyed listeners before navigation or Launch. Origininstallation marker is collected from each serializedhook; page callback need not synchronously pause a worker, since its history is already buffered beforeinstanceexecution. `registeredBeforeGuestExecution` combines prelaunchlistenerinstallation with eachobserved origin's preinstantiate marker; actual coverage remains an observed-context set, not an omniscient scheduler assertion. Missingobserver/marker/identity change produces captureissues and deniesadmission. Non-guest renderworkers are logged but excluded from guestidentityset.

Worker phases before-arm/during-window/after-stop/cleanup are explicit and monotonic. during-window begins beforefirstarm and ends only afterlaststop. New/retiredcontext during thatphase rejects; stop histories and coverage are deepcopied beforecleanup, so later browser.close retirements update only the separate cleanupreport. EmptyFlip secondworker remains present and contributes full lifecyclehistory. Everyregistered guest requires savedarm/stop, exactunique stringidentityset and validthreadslot through acceptedadmission. Snapshot/stopreaderrors failclosed. Coverage/admission exceptions return explicit rejected diagnostics.

No hard-coded historicalslot7: common single observed primary at everycontextarm supplies diagnosticselection; missing/ambiguous selection rejects. This is observedprimary attribution, not a guestselected-pointer proof. Output `lifecycleAdmission` retains accepted/reasons plus strictAtomicLifetimeProof:false/globalMutationOrderingProven:false/measurementEnabled:false/performance:null. Overall normalroute candidate status does not override a rejected lifecycleAdmission. Neither field autonomously certifies gameplayFPS. Commonclock/cross-worker mutation ordering is deliberately not manufactured. See `ops-gta2-lifecycle.md` for complete allocation/free publication,slotreuse,double-read and primarytransition limits.

## Validation and closure

Seven focused integration cases PASS (`test.log`): actual frozenoverlay/driverparse and preinstantiatesingleanchor; actual serializedforwarding and mockedtwo origins withlateexistingprimary/emptyFlipworker; cleanupretirement distinction and immutable histories; missingobserver/newworker/retiredproducer rejection; originalexception/unrelatedkind/duplicateinstall; originalroutehash and prelaunchpagelistenerordering; interrupted arm collection preserves available immutable receipts without further browser requests. These execute pure JS/VM mocks only, no guestmodule/browser. They supplement accepted11prototypecases rather than claiming a liveWorker test. Driver --verify-only and --audit-onlyPASS; audit includes actual serializedlayout and servedoverlayhash.

Full manifest now12,350inputfiles plus247containedrelative links; no ancestor resolution. LiteralNodeclosure399files/1,035edges; sixteen optional/documentation misses exactly match prior acceptedclassification. Originalfixture all12,350paths rehashed unchanged. `original-inputs.json`, `preparation-result.json`, `driver.patch`, `node-closure.json`, `verification.json`, `overlay-audit.json` preserve evidence. Copies contain no dangling extra package links. No package/archive generated.

Cost includes synchronous relevant-eventdouble reads/copies and bounded100,000event buffers perworker, fullDXtable scans atinit/arm/stop, endpointbuffer transfer. No perframeRPC/log, but overhead stillchanges execution and must not be mistaken for uninstrumented timing. Incomplete window failures retain phase/coverage and all already-collected immutable observed/arm/stop receipts; unavailable receipts are explicit null. No automatic retry or new post-deadline browser requests. Existing600sbody/ownedcleanup/freshoutput/GPUdiagnosticflags retained. A later separatelyreviewed650sownedPGID wrapper stillneeded for any assignedhost run; currenttask holds no resources.

Smallest next step is rootreview of driverdiff/serializedhelper/coordinator and identities. Only afteracceptance: a separatelyauthorized portablepackage may bind this newmanifest, then one normalroute diagnostic may collect actualGTA2two-context histories. Do not enable measurement or remove strictprooflimits on staticPASS alone. No integrationruntimegrant inferred.

## Final identities

- module: `da5bf93bcaca3ec1e16f48f1ffea8d30c7d375b76b4118ffa1109cb2f5ff7074`
- input manifest: `fde739c494cb0bf0ebd26bf56e00dac26f839e519f810098855688bc3e4854d4`
- binding: `5518ca2e895fd28b0cdeacec9801b049f36011de975aff1528e75a0171a79a05`
- tools/qualify-gta2.js: `3645bd840e33e68a1efa27444e38bfc3268d1ef5f738d67c5f49c47f6ef78e50`
- tools/gta2-lifecycle-observer.js: `f2dfe71388b6a46716e52570952ba05edc0508a9f39f3e08b258300558006cdc`
- tools/gta2-lifecycle-integration.js: `44780d69b1a704bc48312dcb4e1d23b2cecdf04a4806e3fdb98e4ac7bcebea03`
- tools/gta2-qualification.js: `a6f621918bf946a80f4c5f9dc7c32e825a2fa69c900388db06dacca8d52e9d20`
- served Worker overlay: `301aa9fdfd591abebafd250f94ecbb4e0021c6743fc00eb5d3b6c02f51a76351`

## Review corrections completed

Restored the original before/after page surface metadata and window comparison (`metadataStable`), including the ambiguity when association or geometry changes. Lifecycle admission does not replace that route evidence. Coverage snapshots now deep-copy every available per-worker observed, arm and stop receipt, alongside phase and coverage. The interrupted-arm test saves the first worker receipt and both initial observations, marks the missing second arm explicitly, rejects incomplete coverage, and proves later cleanup/retirement cannot mutate the saved snapshot. No additional worker requests are used to recover partial evidence.

All seven focused tests passed after correction. The full 12,350-input verifier, 247-link closure, literal dependency closure and serialized overlay audit were regenerated successfully. `preparation-result.json` and the final identities above supersede the initial release hashes; source/module, prior route helper and original fixture remain unchanged. No runtime, package or archive was created.
