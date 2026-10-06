# Isolated DirectPlay4W draft

Reviewable patch: `scratch/aoe2-directplay4w-private-20261003/directplay4w.patch`. No canonical files changed, no WASM compilation or guest runtime performed. This is a draft, not an accepted repair or gameplay result.

`before/` pins the actual dirty source, including the accepted LF2 change in09a8 SHA43d2a1d5. `after/` is isolated. `design.json` was written before implementation; `review-receipt.json` records exact before/after hashes. Seven proposed files change: DirectPlay handler fragment, a DirectPlay-only CoCreate call site, append-only API JSON/hash segment, generated dispatch/vtable table, and their two JS generators. Support files copied alongside are unchanged and absent from the patch.

## Implemented scope

- Separate53-slot IDirectPlay4W table and cached auxiliary wrapper, sharing the canonical DX object/refcount. W QI normalizes through canonical owner/IUnknown; fullIID530 recognition occurs only after output-pointer validation. The guest IID is read through a bounded16-byte guest span and released on success/failure; the DirectPlay-only CoCreate path uses that same wrapper. Strict W auxiliary allocation fails without primary mutation when full. Existing legacy auxiliary behavior is untouched.
- Optional32-pointer W-name sidecar indexed by existing entity slot. UTF16 names remain lossless, including surrogate pairs; the unchanged ANSI entity table receives CP1252 shadow names. Unrepresentable Unicode scalars become question marks in that shadow, never low-byte truncation. A reads remain normal ANSI; successful A SetName invalidates the W mirror, and subsequent W access converts CP1252. Non1252 conversion is explicitly unsupported. Strings have a4096-unit bound including termination.
- W group/player creation, replacement and byte-sized name retrieval; sparse-safe guest scalar and copy helpers. Short buffers are not partially written. Existing destruction/Close/clear free W mirrors. Creation rollback handles common-data failure without publishing an entity.
- W enumeration initializes every frame field with gs32, so a noncontiguous guest stack is safe. W entity callback frames own independent name snapshots in previously unused frame+36; nested A/W enumeration and A replacement cannot mutate the snapshot. Temporary names free on callback continuation/early stop. ANSI frames remainzero. Provider callback uses one bounded52-byte immutable UTF16 TCP/IP record per instance.
- Every delegated W method normalizes `this` to the canonical owner. W network/session/settings/account/chat/Receive and placeholder capability operations return E_NOTIMPL. Creation/rename while a transport is active and unsupported setter/provider flags are rejected; W Send/SendEx refuse active transport. Existing ANSI network code is unchanged. No claim of complete Unicode networking.

In09a8, six existing functions change: `dplay_query_interface_wa`, `dplay_query_interface`, `dp_destroy_entity`, `dp_replace_name`, `dp_clear_entities`, and `dp_enum_continue`. In09a7, only the DirectPlay class branch of CoCreateInstance is routed through the same safe guest-IID wrapper. There are67 added helper/handler functions and53 new API rows. Existing API IDs/rows are byte-semantically identical. Vtable registry appends one slot rather than moving old entries. CoCreateInstance uses the existing shared QI path, retaining its output/refcount cleanup.

## Checks completed without compilation

Canonical before hashes still match, restricted existing-function changes, new function-call resolution, full53-row append-only metadata/hash uniqueness, JS syntax, WAT parentheses/label scope, private API/hash/dispatcher generation and `--check`, and `git apply --check` all pass. These checks do not establish WAT typing or runtime correctness.

## Scheduled tests required before integration

The private test has an explicit scheduling guard; it substitutes isolated text into the ordinary compiler in that Node process only. It never writes canonical source or build output. Root independently passed the actual canonical4aa negative baseline without recompilation (`scratch/aoe2-directx-startup-20261003/canonical-iid-baseline.json`). Reuse that receipt; a duplicate baseline compile is unnecessary. Optional private baseline command is retained below, followed by the proposed positive suite:

```
node scratch/aoe2-directplay4w-private-20261003/directplay4w-contract.test.js --private-runtime-granted --expect-unsupported
node scratch/aoe2-directplay4w-private-20261003/directplay4w-contract.test.js --private-runtime-granted
```

Prepared actual-WASM checks include exact currentIID530 E_NOINTERFACE/outptr/refcount baseline; W allocator exhaustion without mutation; distinct A/W pointers and canonical IUnknown; full53 generated thunks and argument cleanup; worker vtable restoration; fullGUID negative; UTF16 round-trips including surrogate pair; byte lengths/terminators/short-buffer canaries; noncontiguous sparse input/output; CP1252 cross-interface replacement; groups and shared-owner membership; unsupported network/ACP behavior; allocation rollback; actual UTF16 provider callback; nested A/W callback frames and early return; snapshot lifetime across A rename; canonical Close/mirror cleanup; and CoCreateInstance reference lifetime.

Then run unchanged focused ANSI regressions serially through:

```
node scratch/aoe2-directplay4w-private-20261003/run-private-test.js test/test-directplay-query-interface.js --private-runtime-granted
```

Repeat for test-directplay4.js, test-directplay-enumerate.js, test-directplay-send.js, test-directplay-message-queue.js, and test-directplay-lobby-address.js. Existing tests retain their ANSI/network expectations. The wrapper intentionally refuses changed canonical pins; rebase/review against updated dirty sources rather than silently mixing identities.

The private draft runtime tests are **prepared, not run**; only root’s unchanged canonical negative baseline has run. Full build gates, broader concurrency review, integration and ordinary AoE2 gameplay qualification remain root-scheduled. No API/version bypass was introduced.

## Auxiliary-instance limitation and review corrections

Both existing `dp_entity_table` and new `dpw_names` are per-instance. This patch does not claim general DirectPlay threading or cross-Worker name sharing. The prepared auxiliary-instance test instantiates the actual module on shared memory and initializes another thread: shared COM/vtable/QI identity is checked, while both A/W lookup fail for main-instance entities, rename does not invalidate the main mirror, and auxiliary Close cannot clean the main table. This records the inherited limitation, not a pass for thread-safe names. Owner-instance Close remains the cleanup contract tested here.

Review corrections add actual sparse-page IID success/failure and NULL-output precedence tests, span-cursor cleanup, noncontiguous W enumeration stack initialization with backing-neighbor canaries, and the auxiliary-instance characterization. Existing ANSI network implementation remains unchanged. First private compile+positive-suite scheduling budget:300seconds; compile duration has not been measured for this draft. No browser is required.

## First private compiled contract

Root granted the exclusive 300-second slot. Session 33552 exited 0 on the first positive run, with no compiler or assertion failures. `positive-contract-receipt.json` pins the log, test, patch and unchanged canonical files. Sparse IID and enum-frame accesses, full Unicode/name buffer contracts, canonical interface identity, ABI, callbacks and auxiliary-instance characterization passed in actual private WASM. No canonical source or build output changed. The negative canonical receipt is reused. This is not browser qualification; six focused ANSI regressions await serial scheduling. CPU slot released.

## Focused ANSI regression results

All six unchanged suites passed against isolated after-source, session 68003 exit 0, 17.331 seconds total. QI reports 31 checks passed and zero failed; DirectPlay4 ABI, enumeration, local send/receive, message queue and lobby address suites each passed their assertion groups. Each fresh Node process overrides `compileSrcWasm` before requiring the suite/render helper; the compiler receives transformed source through all VFS aliases and does not read the canonical build artifact. The existing Unicode-sibling rejection checks cover older unsupported interfaces, not new IDirectPlay4W IID530. Post-run canonical-before/private-after hashes match; no surviving test process. Full test/log hashes and timings: `focused-suites-receipt.json`. Exclusive CPU slot released; canonical integration/build and browser verification remain parent-scheduled.

## Canonical integration — 2026-10-03 17:38 UTC

Root authorized the reviewed seven-file patch after private validation. All canonical-before hashes matched, and every integrated file now matches its reviewed private-after hash; existing COM/LF2 changes are preserved. `test/test-directplay4w.js` now uses the ordinary canonical render/compiler helper with no private overlay or scheduling guard. Its entire positive assertion body is byte-identical to the passing private test (only the obsolete negative-baseline branch was removed). Auxiliary-instance limitations remain explicit. Syntax and automatic test-tier validation pass; the test is in the unit tier. Integration receipt records all seven source hashes, the permanent test hash and counts. No full build or canonical runtime test has run yet; root is coordinating the host LAN fix before freezing and building. Earlier preparation-only sections above describe historical phases, superseded by these result/integration sections.

## Build gate correction

The first canonical build stopped at the memory-map gate: the new 73-pointer registry needed 296 bytes including its header, but the declaration remained 292. Prior private tests did write four bytes beyond the declared region into current-layout alignment padding; that is a missed allocation contract, not a general safety claim. The owning region declaration is now 0x128 and the JS mirror was regenerated by the documented generator. Inspection also found the proposed W registration preceded two older interfaces; it now follows both, and static comparison confirms all 72 preexisting registry offsets are unchanged, with W alone appended at offset292. The permanent test now checks exact allocated capacity, preserved old tail slots and an adjacent canary on full-registry append rejection. Memory-map, region freshness and JS syntax checks pass. No corrected-layout compile/runtime has run yet; receipt registry-correction-receipt.json pins the separate corrective delta for root build/review.

## Duplicate-handler gate correction

Sixteen hand-written W E_NOTIMPL methods formed duplicate groups with stdcall cleanup12/16/20/24/28 bytes. They now use the established api.stub metadata convention, retaining exact HRESULT0x80004001 and per-method stack cleanup. The original 3964 API rows are unchanged. All16 handwritten bodies were removed; the existing generator emits their named handlers. No duplicate baseline changed. The gate now passes (116/117 exact groups,463/468 members); generator, handler ESP, explicit failure and epilogue checks pass. The older DirectDraw EnumOverlayZOrders body was not edited: it appeared newly duplicate only because new identical bodies had joined its group. The permanent positive test now exercises all16 actual guest thunks, verifying HRESULT, ESP via its existing helper, output canary and unchanged reference count. Corrected build/runtime remain pending root scheduling; receipt stub-correction-receipt.json records exact methods, group counts and hashes.

## Final canonical validation

After root full-build PASS, session2514 executed the permanent corrected W contract, six ANSI suites, OLE storage and adjacent DirectDraw CoCreate regression serially against actual canonical sources without overlays. All nine passed in 24.903 seconds. QI reports31/31 and OLE storage79/79; the W test includes corrected registry allocation/boundary and all16 generated failure thunks. Source/module hashes remained unchanged, and the test process check is clear. Canonical module SHA f40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063 (1664777 bytes). Full evidence: canonical-suites-receipt.json plus individual logs. CPU slot released; ordinary AoE2 browser qualification remains outstanding.
