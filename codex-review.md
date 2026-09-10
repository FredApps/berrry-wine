# Project review — 2026-09-09

## Continuation — thread lifetimes and sparse-save prerequisites

### Latest increment — automatic catalog startup with reply-time freshness

```text
+----------------------------------------------------------------------------------------------------------+
| FINAL MOUNTS / STOCK FONTS          CATALOG PREPARATION                         STARTUP ADMISSION          |
+----------------------------------+----------------------------------+------------------------------------+
| CLI: restored final VFS          | local: synchronous transaction   | catalog ready before DLL entries   |
| browser: executing owner        | Worker: retain leases past reply | cancellation/stale => discard      |
| native exclusions, bounded input| recheck all sources + membership | stop joins boot; no internal wait  |
+----------------------------------+----------------------------------+------------------------------------+
| AUTOMATIC METADATA DISCOVERY ENABLED | DYNAMIC FACE PREFLIGHT STILL OPEN | LAZY PROVIDER DEFAULTS OFF       |
+----------------------------------------------------------------------------------------------------------+
```

Browser and CLI startup now publish the bounded metadata catalog after stock
fonts and final mounts, before DLL initialization or ready/running admission.
Cooperative and CLI execution use the local native transaction; the browser
Worker path retains every VFS lease through its publication reply, then checks
membership, source freshness, cancellation and reply count/generation. A stale
reply can follow a successful native commit, so startup is rejected and the
unstarted process is discarded, not retried against that committed instance.
This is deliberately fail-closed startup: a malformed custom TTF, more than
32 non-excluded candidates, a file above 4 MiB or aggregate input above 16 MiB
rejects launch. It is not support for arbitrary installed-font trees.

Review caught cancellation releasing ready leases prematurely through the
preparation signal. A preparation-only abort controller now forwards abort
while reads are pending, then detaches before remote publication. Cancellation
still rejects admission, but leases survive until the remote request settles.
The helper reports failure without awaiting stop; browser stop already joins
the enclosing boot barrier, so awaiting it from inside boot would deadlock.

Seven remote-preparation groups pass reply-time replacement/revision/eager
mutation/membership changes, cancellation, malformed replies, bounds and
provider cleanup. A real-Worker integration test proves leases span a completed
commit/reply and rejects a subsequently stale process without executing guest
instructions. Browser lifecycle tests cover delayed catalog preparation/reply,
ready/run/DLL gates, stop, faults, stale reply and stop-barrier settlement.

The first automatic-startup Chrome run exposed a Win16 gate regression:
`load_pe` returns linear EIP for PE but packed selector:offset for NE. The
old equality check left valid Rodent startup sealed. The corrected NE check
validates native entry CS/IP, actual CS and segment-table translation to
actual EIP, retaining the first-load-only and negative-error guards.

This completes startup metadata discovery, not demand-driven face preparation:
metadata publication does not warm parsed faces or make a later synchronous
face read safe for a pending provider. Source replacement after startup still
needs immutable face/strike generations and operation-level preparation.
Lazy installed-tree/provider defaults remain off, and total-process memory,
input/audio performance acceptance and integration with main remain open.
Fable's completed materialization work remains distinct; preserve main's
unified cache identity and test discovery when integrating.

Final verification: canonical/compatibility build passes, with 952 tests
accounted for by the manifest gate (not a full-suite run), source 318,
unchanged native artifacts 1,066,734 / 1,067,187 bytes and layout
`b00c9d60346fdb5a`. Nine real-Worker startup groups pass, including valid
and malformed NE. CLI fixtures verify ready state before actual DLL entry,
custom TTF failure and valid/malformed/whiteout overlay precedence. The final
Chrome matrix exits 0: Notepad/Calculator Worker/cooperative catalog readiness
and parity, Win16 Rodent catalog/input/rendering, Rodent2000 input/rendering,
three Winamp playback Workers and COM success/missing-server recovery.
These are functional checks, not total-memory or performance acceptance.
Independent subagent review found no blocking startup issue. The current
main Fable review still records H1/H2 materialization fixes as completed;
those historical results do not establish these startup or lifetime gates.

### Prior increment — Worker startup seal and bounded catalog publication

```text
+----------------------------------------------------------------------------------------------------------+
| NEW                              | OPEN                             | SEALED                             |
+----------------------------------+----------------------------------+------------------------------------+
| first main image not loaded      | valid first image entry + EIP    | before DLL callbacks / guest work  |
| malformed image => SEALED        | dedicated bounded catalog commit| generic/readExports allowlists     |
| secondary Worker => SEALED       | actual policy checked at owner   | reload/init cannot reopen          |
+----------------------------------+----------------------------------+------------------------------------+
| REMOTE TRANSACTION IMPLEMENTED | NEXT: retain VFS leases through reply + validate before execution        |
+----------------------------------------------------------------------------------------------------------+
```

The executing Worker now owns monotonic catalog-publication eligibility.
Only the first successful main-image load opens it. Review caught loader
errors represented by truthy negative integers; opening now requires a
non-error entry matching native EIP. Execution-capable messages seal before
invocation, including secondary-thread DLL callbacks, DLL initialization,
slices and synchronous message routes. Separate exact allowlists cover
generic calls and `readExports`; other exports still execute but first seal
catalog startup. Direct generic catalog mutators are rejected. Repeated init,
reloading and secondary slots cannot reset eligibility.

The dedicated `installFontCatalog` message validates independently at both
ends, copies owned bytes and publishes only while OPEN. It accepts at most
32 direct-child TTF files, 4 MiB each and 16 MiB aggregate, rejects excluded
and duplicate paths, and validates current native substitution policy before
publication. Reply count/generation are checked; failure or an uncertain
reply requires discarding the unstarted process. The byte cap applies to each
owned message payload, not the sum of host/Worker clones, VFS leases, staging
and existing font caches.

Seven real-Worker test groups pass owner-only populated/empty publication,
host/Worker invalid payload rejection, native malformed rollback, stale
policy, generic/readExports/DLL sealing, blocked generic mutators, invalid
first images, secondary slots and duplicate initialization. Message-helper,
local installer, preparation and existing stock-font tests also pass.
Independent review found no blocking gate bypass. Unlisted diagnostic exports
conservatively seal startup; automatic integration must audit needed metadata
queries rather than assume `get_` names imply safety.

Automatic browser/CLI catalog startup is not enabled yet: it must retain VFS
leases through the remote reply and validate source/cancellation before guest
execution, discarding stale publication. Face/strike generations,
pre-side-effect operation gates and process-memory/performance acceptance
remain open. This remains distinct from Fable's completed materialization
fixes; main's unified cache identity/test discovery must survive integration.

Final verification: full canonical/compatibility build passes with 950
manifest-listed tests (not a full-suite run), source 317 and unchanged native
artifacts 1,066,734 / 1,067,187 bytes, 237 imports, 233 nonoverlapping data
segments and layout `b00c9d60346fdb5a`. The final Chrome matrix exits 0:
Notepad/Calculator parity, native exclusion queries and late catalog rejection,
five-font readiness, both Rodent input/render checks, three Winamp playback
Workers and COM success/missing-server recovery. These are functional checks,
not total-memory or performance acceptance.

### Prior increment — executing-owner native font policy

```text
+----------------------------------------------------------------------------------------------------------+
| NATIVE AUTHORITY                    LOCAL PUBLICATION                          WORKER: READ ONLY          |
+----------------------------------+----------------------------------+------------------------------------+
| both actual substitution tables | capture exclusions before reads  | one owner-side snapshot message    |
| no IO / allocation / mutation   | recheck policy before commit     | copied strings; no borrowed paths  |
| malformed table is an error     | policy changed => abort staging  | no remote catalog install yet      |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: seal execution-capable Worker entry points -> guarded publication -> host freshness check -> run    |
+----------------------------------------------------------------------------------------------------------+
```

Native `font_catalog_exclusion_path` and host `excludedPaths()` now derive
bounded copied exclusions from both actual WAT substitution tables. Local
`install()` always includes that policy and revalidates it through commit;
caller extras cannot remove native exclusions. This closes a second snapshot
dependency: a valid VFS batch is insufficient if the exclusion policy changes
while its reads await. A malformed table returns an error, not an apparently
complete partial list. The low-level preparation interface remains explicit.

The dedicated native test passes exact field enumeration/manifest ownership,
full-memory/root purity with filesystem imports forbidden, alias-table mutation
and copied-snapshot lifetime, invalid pointers/lengths and malformed-table
rejection. The compiled installer rejects native policy mutation during
asynchronous preparation while preserving the old catalog. A real-Worker test
passes one-message owner execution, frozen copied replies, no shadow query or
guest execution, and error recovery. Existing catalog, preparation and stock
font bootstrap regressions pass.

The Worker exposes only read-only policy discovery. Its lifecycle audit found
no authoritative startup seal: DLL entry calls, generic export calls and
synchronous message dispatch can execute guest code without an ordinary slice.
Before remote catalog installation, those entry points must close startup
eligibility on the Worker itself; host slice counters cannot enforce it.
Automatic catalog startup, face/strike generation lifetimes, operation gates
and memory/performance acceptance remain open. Fable's completed bounded
materialization work remains distinct; eventual integration must retain main's
unified cache identity and test discovery.

Final verification: canonical/compatibility build passes at source 316,
1,066,734 / 1,067,187 bytes, 237 imports and 233 nonoverlapping data segments;
layout remains `b00c9d60346fdb5a`. All 948 test files have manifest membership
(not a full-suite result). The final Chrome matrix exits 0: Notepad/Calculator
backend parity plus the new actual-Worker exclusion query, five-font readiness,
both Rodent input/render checks, three Winamp playback Workers and COM
success/missing-server recovery. No performance claim or automatic catalog
startup enablement follows from these functional checks.

### Prior increment — bounded host catalog snapshots and local publication

```text
+----------------------------------------------------------------------------------------------------------+
| PREPARE: IMPLEMENTED                LOCAL COMMIT: IMPLEMENTED                  AUTOMATIC STARTUP: NEXT    |
+----------------------------------+----------------------------------+------------------------------------+
| snapshot direct-child TTF names  | stage one font at a time         | native substitution exclusion list |
| retain ALL source leases        | validate sources + membership    | executing Worker protocol          |
| 16 MiB aggregate payload default| commit once; abort failed staging| admit execution only while current |
+----------------------------------+----------------------------------+------------------------------------+
| SOURCE MUTATION / NEW FILE / CANCEL => REJECT | FACE + STRIKE GENERATIONS OPEN | LAZY DEFAULTS STILL OFF   |
+----------------------------------------------------------------------------------------------------------+
```

`lib/font-catalog.js` implements retained-lease preparation and synchronous
publication on a local executing instance. Membership is re-enumerated and
every retained source lease is validated through commit; earlier files are
not released while later reads are pending. The remaining aggregate budget
is enforced before requesting each lease. Defaults are 16 MiB retained payload,
32 files and 4 MiB per file. One read copy and one native staging allocation
add at most 8 MiB payload transiently, plus bounded metadata/allocator overhead;
existing VFS/provider/cache/parsed-font ownership is outside that bound.

Six real-VFS preparation test groups pass same-size replacements, provider
revisions, eager mutation, membership changes, bounds/exclusions, immutable
read copies, cancellation and provider/handle cleanup. The compiled installer
test passes metadata-only publication, malformed metadata preserving the old
catalog, source/membership mutation after native add rejecting commit,
allocation/native/check failures releasing staging and pending transactions,
and completed-empty replacement. Independent subagent review found no blocker
under the documented local synchronous startup contract.

This helper is not automatically called by browser/CLI startup yet. Exclusions
must come from both actual WAT substitution tables, and Worker publication
needs final host validation before execution. Validation re-enumerates the
VFS; this is a bounded startup/refresh operation, not a scheduler hot-path
query. Face/glyph/strike generations, pre-side-effect gates and total-process
memory/performance acceptance remain open. No production source/cache identity
change was needed for this currently unimported helper.

The full canonical/compatibility build passes with 946 manifest-listed tests
(membership, not a full-suite run), unchanged source 315 and unchanged
1,066,509 / 1,066,962-byte artifacts/layout. Existing stock-font preparation
tests also pass. The previous increment's Chrome matrix remains the browser
evidence; no automatic browser behavior changed in this increment.

### Prior increment — atomic native font catalog staging

```text
+----------------------------------------------------------------------------------------------------------+
| NATIVE TRANSACTION: IMPLEMENTED           HOST SNAPSHOT: NEXT                    RUNTIME LIFETIMES: OPEN    |
+----------------------------------+----------------------------------+------------------------------------+
| begin -> add metadata -> commit  | validate every source at commit  | immutable face / glyph generations |
| abort/failure keeps old catalog | bounded aggregate lease memory   | retain selected + registered fonts |
| 32 records; no parsed faces     | executing instance publication   | pre-side-effect operation gates    |
+----------------------------------+----------------------------------+------------------------------------+
| EXPLICIT REGISTRATION STAYS SEPARATE | AUTOMATIC DISCOVERY STILL LEGACY | LAZY DEFAULTS REMAIN OFF          |
+----------------------------------------------------------------------------------------------------------+
```

The native catalog now stages copied family/style/path metadata separately from
explicit registrations. Nonreused transaction nonces reject stale commands;
invalid input, duplicate paths or capacity overflow poison the transaction,
and a failed commit preserves the previous catalog. Healthy publication swaps
the complete table and advances a catalog-only generation. A completed empty
catalog suppresses legacy discovery; a merely pending catalog does not.

Cross-checking found a transition hazard: legacy discovery already writes into
the explicit registry. Initial begin and commit therefore reject an instance
whose legacy scan ran before publication, including a scan during staging.
This does not migrate old discovered entries or change explicit Add/Remove
ownership. Metadata acceptance is not full glyph validation, and borrowed
catalog path/name pointers must be copied before a later commit frees the table.

Automatic browser/CLI catalog preparation is intentionally not enabled yet.
Releasing each read lease after metadata extraction and comparing directory
names/sizes/timestamps at the end misses replacements and provider revisions.
The host needs durable source validation or retained leases with an aggregate
byte budget through commit. Parsed faces and synthetic strikes still need
generation-aware lifetimes and operation-level preflight. These remain open in
[the implementation design](docs/design-font-preflight.md). Fable's bounded
materialization work is not reopened; eventual integration must retain main's
unified cache identity and test discovery.

The canonical/compatibility build passes at source 315 (1,066,509 / 1,066,962
bytes, 237 imports, 233 nonoverlapping data segments; layout unchanged at
`b00c9d60346fdb5a`). All 944 tests have manifest membership; this is not a
complete-suite result. Pure lookup, substitution/rasterization, resource and
lazy FON/TTF/FOT registration, local installation, browser lifecycle and real
Worker bootstrap regressions pass. The final Chrome matrix exits 0 with
Notepad/Calculator parity, both Rodent input/render checks, three Winamp
playback Workers and COM success/missing-server recovery. No performance
claim: observed machine load was approximately 18.

The dedicated compiled catalog test passes metadata-only staging/cold-cache
checks, copied family/style/path ownership, busy begin, idempotent abort,
stale-token isolation, distinct-path malformed/span/size failures, unterminated
and oversized paths, duplicate paths, 32-record overflow, explicit precedence
and enumeration deduplication, completed-empty readiness, and both legacy-first
and intervening-scan rejection. Failed candidates preserve the old resolution
and generation. Filesystem imports are forbidden during catalog operations.

### Prior increment — read-only dynamic-font dependency lookup

```text
+----------------------------------------------------------------------------------------------------------+
| LOOKUP: READ ONLY                    DISCOVERY: STILL LEGACY                     REQUIRED NEXT             |
+----------------------------------+----------------------------------+------------------------------------+
| substitution + registration table| directory scan can open/register | staged catalog publication         |
| no IO / allocation / publication| scanned flag is NOT readiness    | immutable face generations         |
| cold cache-only miss stays cold | lookup answer is provisional     | pre-side-effect operation gates    |
+----------------------------------+----------------------------------+------------------------------------+
| STOCK STARTUP COMPLETE             | DYNAMIC PREFLIGHT NOT YET ENABLED | LAZY DEFAULTS REMAIN OFF           |
+----------------------------------------------------------------------------------------------------------+
```

The dynamic-font audit found that `tt_subst_path` was not a safe preparation query: it allocates, scans and registers directory files before returning a path. `tt_scan_font_dir` marks its scan complete before its reads, so that flag cannot stand in for asynchronous catalog readiness. Cold cache-only face lookup also allocated the face table. More importantly, `GetFontData` pops its guest stack before face lookup, and rendering, metrics, enumeration, controls, native Help, metafiles and direct `send_message` exports can open fonts after other state changes. Retrying those operations after a missed read would replay guest-visible work.

`tt_subst_resolve` now provides a genuinely read-only lookup against already published registration/substitution tables; the existing legacy path performs discovery separately and delegates to it. Registry lookup no longer invokes its allocation helper. A cold cache-only face miss returns without allocating a table. These queries preserve borrowed-path and source-independent explicit-registration behavior. Their answers remain provisional until catalog preparation is complete; they do not establish file freshness, install a face, or make legacy directory scanning safe for lazy providers.

The compiled purity test covers manifest names/styles, aliases, null/empty/unknown names, repeated cold and published queries, and registered fonts whose source was deleted. It rejects filesystem imports during each query batch and compares heap/catalog roots, input canaries and a digest of the entire shared memory. The existing substitution/raster test also passes. [The implementation design](docs/design-font-preflight.md) records the missing outer-operation boundaries and generation/lifetime requirements: parsed faces and glyphs are instance-local, while shared synthetic strikes currently omit source generation. Invalidating only one cache would still return old pixels or erase a selected/registered lifetime.

Canonical/compatibility build gates pass with 943 registered tests (membership, not a complete-suite result), source 314, 1,065,612 / 1,066,065 bytes, 237 imports, 233 nonoverlapping data segments and unchanged layout `b00c9d60346fdb5a`. The new pure resolver is used by the legacy lookup, not yet by a demand-driven async operation gate. Fable's materialization fixes remain complete; this is separate consumer-boundary work, and eventual integration must preserve main's unified cache identity and test discovery.

The final source-314 Chrome matrix passes with exit 0: Notepad/Calculator backend parity and five-font readiness, both Rodent input/render checks, Winamp with three executing playback Workers, and COM success/missing-server recovery. Lazy FON/TTF/FOT registration, explicit resource registration, substitution/rasterization, local installation and real-Worker bootstrap regressions also pass. These establish unchanged runtime behavior around the new query seam, not completed dynamic preflight or memory/performance acceptance.

### Prior increment — browser executing-owner font bootstrap

```text
+----------------------------------------------------------------------------------------------------------+
| FINAL MOUNTS / OVERLAY               PREPARE + PUBLISH                           OPEN EXECUTION GATE       |
+----------------------------------+----------------------------------+------------------------------------+
| one process / one executable     | five bounded immutable leases    | all five fonts installed           |
| cancellation joins boot teardown | cooperative: local instance      | DLL initialization, then run       |
| no late DLL mounts after stop    | Worker: one owner-side batch     | no run while DLL loading           |
+----------------------------------+----------------------------------+------------------------------------+
| STALE / FAILED / CANCELED: discard process | NEXT: dynamic fonts + invalidation | LAZY DEFAULTS STAY OFF    |
+----------------------------------------------------------------------------------------------------------+
```

Browser `loadExe` now installs all five stock fonts after image/heap initialization and before it opens the `loadDlls`/`run` gate. Cooperative mode uses the synchronous local installer; Worker mode sends one bounded copied batch to the executing instance, never the metadata shadow. Both paths share the native installation loop. The host retains all source leases through the Worker reply and rejects a changed source generation before permitting guest execution. Publication is not an all-five transaction: any failure or cancellation discards this unstarted process rather than retrying its partially initialized memory.

The launch is one-shot. Stop aborts preparation, joins an in-flight direct `loadExe` as well as the shell launch, and prevents late startup completion from reviving the process. DLL fetching checks readiness before mounting its result; DLL initialization clears its pending flags on every exit and checks stop before publishing `running`. Public `run` cannot overtake pending DLL initialization.

Cross-check against the current shared `fable-review.md`: bounded materialization remains completed, not reopened by this consumer integration. Fable's unified build identity/cache graph has now landed on main (`cc575d53`); this older isolated branch still uses numeric cache tags. Integration must adopt main's single version authority for the new stock-font script and Worker dependency instead of restoring these numeric tags. Main's new test discovery must likewise retain both new regressions. No merge or deployment is included here. Dynamic font preflight/invalidation, general cross-context unwind, installed-tree aggregate memory and low-load input/audio acceptance remain open; lazy defaults stay off.

This integration exposed a Rodent2000 regression: VB treats `0xffffffff` as a buffer size and traps in a huge `REP STOSD`; browser and CLI reproduce it, while skipping font installation removes the bounded CLI failure. An initial `HeapSize` attribution was premature: fixing that handler alone did not resolve Rodent. PE disassembly and a guest API trace identify the actual call as `IMalloc_GetSize` on the same reused staging pointer. A compiled regression independently reproduces that handler returning `0xffffffff` instead of the valid allocation size after DLL reservation.

Font staging leaves reusable blocks, DLL reservation retires the instance's bump arena, and the old queries rejected valid reused allocations because the local cursor was zero. `HeapSize`, `IMalloc_GetSize` and `IMalloc_DidAlloc` now share authoritative arena membership and header-extent validation, including sparse and cross-instance allocations. Invalid handles, unknown/unaligned pointers and corrupt extents remain rejected. This does not add a live-allocation bit or promise detection of every freed/forged pointer. The quiet-handler ratchet decreases 437 to 436 because DidAlloc now delegates to the validated query; no quiet handler was added.

The browser VM gate tests pass local versus remote ownership, cancellation during preparation or reply, stale source after reply, one-shot launch, stop during direct initialization, and DLL fetch/initializer/run races. The real Node Worker test validates every batch on both sides, checks actual instance-local parser counters (shadow zero), shared installed state and unchanged guest EIP/ESP/run counters, and discards a partially installed failed batch. Existing local installer, CLI bootstrap, native capacity and allocator tests provide the complementary compiled/fault coverage. Canonical and compatibility builds pass: 942 registered tests (membership, not a complete-suite run), source 313, 1,065,522 / 1,065,975 bytes, 237 imports, 233 nonoverlapping segments and unchanged layout `b00c9d60346fdb5a`.

The corrected normal Rodent2000 CLI completes 200 batches with its real title and board windows, using the same DLL addresses as the failing font-enabled run. The final source-313 Chrome matrix passes with exit 0 and normal cleanup: Notepad/Calculator Worker/cooperative parity and actual five-font state checks, both Rodent rendering/input checks, Winamp playback spawning three executing Workers, and COM load/missing-server recovery. This closes the browser stock-font launch gate, not dynamic font invalidation or installed-tree memory/performance acceptance. The machine was above the load threshold for performance claims; no latency result is inferred from these pass/fail checks.

### Prior increment — CLI fonts ready before DLL initialization

```text
+----------------------------------------------------------------------------------------------------------+
| FINALIZE PROCESS FILES               PREPARE + INSTALL FONTS                     RUN GUEST INITIALIZERS    |
+----------------------------------+----------------------------------+------------------------------------+
| mount base files and DLL files  | five bounded immutable leases    | map DLLs above live heap arenas    |
| replay overlay / whiteouts      | validate every stock state first | run dependency-ordered DllMain     |
| restore saves / startup state   | synchronous local publication    | resolve module-relative addresses  |
+----------------------------------+----------------------------------+------------------------------------+
| FAILURE: nonzero exit + Workers stopped | NEXT: browser launch/cancel gate | LAZY DEFAULTS REMAIN OFF        |
+----------------------------------------------------------------------------------------------------------+
```

CLI `test/run.js` now mounts DLL files before overlay replay but defers executable DLL loading/initialization until final VFS mounts, overlay hydration, saves and startup state are ready. It invokes `StockFontBootstrap.install` before that loader boundary. The local installer prepares all five leases, checks every stock state before its first publication, uses validated contiguous guest allocations, frees each staging buffer and releases all leases. There are no awaits within publication, and a final freshness/cancellation check prevents success after a last-call or cleanup-time invalidation. Later DLL placement respects the shared heap watermark, so the staging allocation cannot be overwritten by a mapped DLL.

Any failed font preparation/installation rejects this CLI process before DLL initializers or the EXE entry point run. `main().catch` now sets a nonzero exit status as well as stopping Workers; previously rejected work could print an error and still report successful process completion. A later font failure may leave earlier fonts installed in this unstarted memory, which is discarded rather than retried. The local API requires matching executing exports and memory; it is not an asynchronous Worker proxy or host-shadow installer. Browser startup is not wired yet, and general dynamic font preflight/invalidation remains open.

Verification includes six real CLI subprocess cases using generated PE/DLL guest code. A read-only observer checks the actual compiled stock states at the unmodified DLL loader boundary, then real DllMain reads a final mounted sentinel file and emits a marker before the EXE's marker. A real persisted overlay overrides conflicting base bytes before that read. Empty/malformed explicitly mounted fonts and malformed/whiteouted overlay fonts fail with nonzero status before the loader, DllMain or main markers. These tests restore overlay stores through the production APIs, not mocked hydration.

The local installer suite passes preparation/state prechecks, stale and aborted preparation, per-font allocation/native failures, mapped-span rejection, asynchronous proxy rejection, partial-publication cleanup and final-install/free abort cases. Its compiled path loads a real PE and installs all five FONs from zero-cache providers. The nine batch-preparation groups also pass. Bounded CLI startup checks reach Notepad windows in cooperative and `--threads` configurations, Win16 Rodent's window, and Winamp's real DLL initializers and main windows; these are startup checks, not playback, gameplay or latency acceptance.

Canonical/compatibility builds pass with 940 registered tests and unchanged source version 312, sizes 1,065,547 / 1,066,000, 237 imports, 233 nonoverlapping data segments and layout `b00c9d60346fdb5a`. No browser loader/cache tags change because the helper is still unreferenced by browser startup. Browser launch-generation cancellation and executing-Worker publication are next; lazy defaults, installed-tree memory acceptance and low-load input/audio acceptance remain open. Fable's completed bounded-materialization fixes are not reopened by this consumer integration.

### Prior increment — complete stock-font installation or failure

```text
+----------------------------------------------------------------------------------------------------------+
| VALIDATE FIRST                      INSTALL WITHOUT EVICTION                    PUBLISH / ROLLBACK        |
+----------------------------------+----------------------------------+------------------------------------+
| bounded NE tables / resource units| capacity for EVERY valid strike | success: touch LRU, publish state 2 |
| explicit type-table terminator   | no changes during validation     | failure: free only new records     |
| count stops beyond 48 strikes    | legacy registration unchanged    | old bytes / state / LRU unchanged  |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: CLI boot-order correction  | THEN: guarded launch integration | LAZY DEFAULTS REMAIN OFF            |
+----------------------------------------------------------------------------------------------------------+
```

Correction to the initial capacity diagnosis: `$gdi_bitmap_font_evict` already protects installed FON records (`active=1`) and evicts only cached rasterized strikes (`active=2`). The reproduced bug was an oversized stock FON returning a nonzero partial count (46), not demonstrated eviction of System. The old installer accepted that partial result and published installed state despite missing resources. Strict startup installation must also avoid disturbing evictable cached records.

Stock installation now uses a side-effect-free validation/count pass, checks free registry capacity, and then parses in a no-eviction mode. Invalid/truncated FON resources, an absent type terminator or failure to allocate any strike reject the entire file. Successful installation touches the new records' LRU stamps and publishes state 2 only after all expected strikes exist. Allocation failure removes the new path's records and storage; neither existing records nor LRU stamps/clock change. This remains a serialized per-file startup operation, not a concurrent or all-five transaction. A failed later font still requires the launch owner to keep the process stopped and dispose of that partially initialized process.

Strict NE parsing checks the offset before reading the signature (WAT `i32.or` is eager), validates resource units before shifting, bounds complete resource tables, requires integer RT_FONT identifiers, and accepts a two-byte final zero type marker. Validation stops once more than the fixed 48 slots would be required, avoiding repeated strike validation for arbitrarily many duplicate resources. Legacy explicit registration and TrueType strike caching retain their prior parser/eviction behavior, apart from safely rejecting an out-of-range NE header instead of attempting its unchecked load.

The compiled regression reproduces partial-success publication before the fix. Coverage includes over-capacity and repeated-resource FONs, exact fit, malformed later resources, huge NE offsets, overflowing resource units, truncated tables, missing terminators, and real bitmap-storage exhaustion after the first successful allocation. It compares the original registry, every owned FNT byte, LRU stamps and clock. The failure test verifies the newly allocated storage is reusable; legacy registration still accepts one valid strike followed by a malformed resource when capacity is available.

Validation: all six capacity/rollback groups pass, as do the five-font native bootstrap with a real PE and initialized peer instance, explicit lazy FON/TTF/FOT registration, System lease handoff and default bitmap-font regressions. Canonical/compatibility builds pass with 938 registered tests, 237 imports, 233 nonoverlapping data segments and unchanged layout `b00c9d60346fdb5a`; source/cache version 312 produces 1,065,547 / 1,066,000 bytes, Worker URL 41. Test membership is not a complete-suite result. No installed-tree memory or input/audio latency acceptance is claimed.

The final source-312 Chrome matrix passes with exit 0: Notepad/Calculator Worker/cooperative parity, both Rodent rendering/input checks, Winamp playback with three executing guest Workers, and COM load/missing-server recovery. Production launch still does not invoke the strict startup installer; these browser tests establish regression coverage for the shared legacy parser and rebuilt runtime, while the dedicated compiled tests establish strict installation behavior.

### Prior increment — stock-font launch prerequisites

```text
+----------------------------------------------------------------------------------------------------------+
| PREPARE FIVE FILES                   PUBLISH BEFORE GUEST EXECUTION              LAUNCH GATE               |
+----------------------------------+----------------------------------+------------------------------------+
| sequential bounded read leases  | indexed buffer-only FON parser   | browser: executing Worker instance |
| validate the complete batch     | installed state only on success  | CLI: final mounts BEFORE DllMain    |
| failure / abort releases owners | refuse existing stock ownership | keep guest parked on preparation   |
+----------------------------------+----------------------------------+------------------------------------+
| VERIFIED PREPARATION / INSTALL   | NO AUTOMATIC BOOTSTRAP YET        | LAZY DEFAULTS REMAIN OFF            |
+----------------------------------------------------------------------------------------------------------+
```

The launch audit identified a prerequisite beyond reading the files: CLI `test/run.js` invokes `loadDlls`, which executes DLL initializers, before application/media mounts, overlay hydration and save restoration. A bootstrap inserted just before the main run loop would therefore be too late. The browser restores its overlay before `loadExe` and initializes DLLs afterward; publication belongs after image/heap initialization on the executing instance, not its metadata-only host shadow. Stock FON registry records and state words are shared across instances, while TrueType face caches are instance-local. Do not parse independently on every Worker, allocate staging bytes before `load_pe` resets the heap, or assume loading another executable resets the stock registry.

The bounded next step is preparation of exactly System, MS Sans Serif, Fixedsys, Courier and Terminal, followed by startup-only buffer publication while no guest code can observe incomplete records. Preparation must validate earlier leases after later asynchronous reads; individually valid acquisitions do not establish a current batch. A failed fetch or cancellation must leave native state untouched. Native publication must not replace an already registered path or mark a failed parse permanently unavailable. This is not an all-five atomic replacement transaction: the existing FON parser accepts valid strikes from a partially malformed resource container, and a later file can fail after earlier files installed. The launch owner must keep execution gated and discard failed process memory; continuing or retrying blindly on that partially initialized process is not safe.

Cross-check: Fable's H1 materialization bug and H2 large-offset bug are already recorded as fixed (`8ff2b10d`, `db182b2d`). These font prerequisites address a different remaining consumer boundary, not a reopening of those findings. Dynamic font selection/enumeration, implicit revision invalidation and explicitly selected face lifetimes still need their own pre-side-effect protocol.

The consumer audit also found that legacy `setLazyFile` entries invoked their synchronous data getter before the lease's budget and pre-abort checks. The lease now rejects cancellation and known oversized/invalid metadata before invoking that loader, then rechecks the actual loaded length. A custom legacy loader can still allocate more than its advertised size internally; it must honor its metadata, or use a bounded provider. The new regression covers oversized metadata, pre-abort without loading, dishonest metadata and normal bounded loading.

The initial registry-capacity warning is corrected and addressed in the latest increment above: installed FONs were protected from eviction, but a replacement file could be only partially installed. The startup primitive now rejects incomplete installation. Native pointer validation must cover actual post-PE allocations (which begin after the image, often below the nominal `GUEST_HEAP_BASE` region), not just no-image harness allocations.

Next integration sequence: keep DLL discovery/mounting before overlay replay, but defer executable DLL initializers until final mounts, save/startup restoration and stock preparation complete; then publish once on the executing instance with a launch-generation/cancellation guard. Any failed or canceled partial publication must keep the guest stopped and dispose of that process. Verify both browser backends and CLI with a DLL that draws during initialization, an overlay-replaced font, and cancellation while a Worker export is pending. A registry-capacity check is required before accepting arbitrary substituted stock FONs. Only afterward consider dynamic font preflight; neither path authorizes turning lazy defaults on without installed-tree and input/audio acceptance.

Implemented: `StockFontBootstrap.prepare` acquires the five leases sequentially, with a 0xF0000-byte per-file cap (at most 4,915,200 retained source bytes per batch, not a process-wide budget). The frozen batch validates every lease before any read and releases all owners on preparation failure or cancellation. `stock_font_install` validates the index, state, size, allocator arena/header extent and contiguous address translation before parsing; it refuses a preexisting path hash and publishes state 2 only after a successful parse. The caller must own a live allocation; allocator metadata is not proof against forged headers or reuse of freed storage. The new JS helper is not yet loaded by either production launch path.

Validation: nine batch tests pass, including canonical font index order and browser-global loading in a separate JavaScript realm; ten lease groups pass including legacy lazy-loader prechecks. The compiled test loads the real Notepad PE, explicitly verifies its staging allocation lies below the nominal heap region, and hands off all five real FONs from zero-byte caches. Invalid indices/pointers/sizes, allocation overrun, malformed bytes, nonzero stock state and existing path ownership are rejected without poisoning state. Publication and subsequent ensure perform no VFS reads; a second WASM instance over the same memory observes the installed states and ensures without its own font files. Existing lazy-entry (35), entry ownership, explicit FON/TTF/FOT registration, System lease handoff and default bitmap-font checks pass.

The canonical/compatibility build passes with 937 registered tests, 237 imports, 233 nonoverlapping data segments, and unchanged layout `b00c9d60346fdb5a`. Source version 311 produces 1,065,234 / 1,065,687 bytes; host/region cache tags are 311, Worker URL 40, filesystem 181. This is targeted correctness coverage, not a full-suite, automatic-bootstrap, installed-tree memory or input/audio acceptance claim.

The final Chrome Worker matrix passes with exit 0: Notepad/Calculator backend parity, both Rodent rendering/input checks, Winamp playback with three executing guest Workers, and COM load/missing-server recovery. This verifies the rebuilt runtime and cache-version changes; the automatic font launch gate is still absent. The native handoff and shared-instance font visibility are covered by the dedicated compiled test, not by those browser launches.

### Prior increment — bounded immutable byte preparation

```text
+----------------------------------------------------------------------------------------------------------+
| PREPARE BYTES                         VALIDATE / CONSUME                       RELEASE                     |
+----------------------------------+----------------------------------+------------------------------------+
| explicit per-operation byte cap  | exact entry + provider graph     | cancel late publication            |
| bounded asynchronous reads       | revisions + slice windows match  | retain through in-flight read      |
| independent of cache eviction    | synchronous private byte copies  | drop bytes and owner references    |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: stock-font bootstrap       | THEN: demand-driven preflight    | STILL OPEN: implicit invalidation  |
+----------------------------------------------------------------------------------------------------------+
| LAZY DEFAULTS REMAIN OFF          | PREREQUISITE, NOT FONT ROLLOUT    | REVIEW GOAL REMAINS OPEN            |
+----------------------------------------------------------------------------------------------------------+
```

`VirtualFS.prepareReadLease(path, {maxBytes, chunkSize, signal})` prepares a bounded immutable copy without materializing `entry.data`, modifying the file entry, creating a read handle, stealing the pending-read slot, or requiring retained cache chunks. The explicit per-operation byte cap is checked before allocation/I/O. The returned lease exposes bounded copy reads, a current-identity check, and idempotent release; its private byte array cannot be mutated through a returned view. Cancellation forbids publication and retains the provider until an outstanding read settles. Release clears both byte storage and retained owner/provider references.

Identity validation includes the exact VFS entry and its window, plus a bounded graph of cache/slice/sparse dependencies and their identities, revisions, sizes and offsets. Checking only the top provider was insufficient: a SliceProvider does not forward a mutable parent's revision. Eager arrays are copied synchronously and checked for in-place mutation. Mutable custom providers must expose a revision; external mutation of an unversioned source is not supported by this contract. The cap is per operation, not an aggregate process memory budget; the future font-preflight owner must bound concurrent leases.

Preparation also bypasses standard caches at every nested layer while preserving slice offsets, stopping at sparse overlays so their dirty pages remain authoritative. A warmed inner cache otherwise can return old bytes even when the lease correctly records the current mutable-provider revision.

This supplies the byte-ownership primitive, not a general native font retry mechanism. The scheduler can stage bytes, but first selection can happen later within the same guest slice. Stock bootstrap must cover the five named FONs; dynamic selection/enumeration needs a demand-driven pre-side-effect WAT boundary, revision-aware implicit-cache invalidation, and preservation of already-selected/explicitly registered face lifetimes. Replaying native drawing after a missed dependency or eagerly loading every installed font would not satisfy the review. Fable's bounded-provider/materialization findings are addressed here at the consumer-preparation boundary, without claiming the remaining font paths are fixed.

Validation: nine dedicated lease groups pass for byte budgets/ranges, immutable returned copies, pending-slot and entry preservation, provider ownership, short reads/faults, cancellation before/during/after preparation, eager mutation, path replacement/deletion, nested revisions, warmed nested caches, window offsets, zero-cache reads and fill-returned bytes. A compiled System.fon test prepares from a zero-byte cache, publishes through the existing buffer-only parser, and matches both eager strike metadata and every FNT byte; stale/canceled preparation performs no publication and does not poison stock state. This is an explicit test-side parser handoff, not shipped bootstrap integration. Existing lazy-entry (35), ownership, lazy FON/TTF/FOT registration and default bitmap-font regressions pass.

The full canonical/compatibility build passes with 935 registered tests, 237 imports and 233 nonoverlapping data segments. WAT/source version 310 remains unchanged (1,064,782 / 1,065,235 bytes; layout `b00c9d60346fdb5a`); the filesystem browser cache tag advances to 180. Membership and targeted results are not a complete-suite or memory/performance acceptance claim.

The final filesystem-180 browser matrix passes with exit 0 and normal cleanup: Notepad/Calculator parity, both Rodent render/input checks, Winamp executing with three Workers, and COM success/missing-server recovery. This is regression coverage for loading the updated library; lease-to-font publication is exercised by the compiled explicit-handoff test above, not by shipped automatic font preflight.

### Prior increment — interrupted object waits and exception search

```text
+----------------------------------------------------------------------------------------------------------+
| ORIGINAL OBJECT WAIT                   NATIVE CALLBACK                      ORIGINAL WAIT RESUMES        |
+----------------------------------+----------------------------------+------------------------------------+
| retain handle(s), all/any, frame  | use callback's own wait state    | consume original signal once       |
| retain absolute timeout age      | original event/count untouched   | original timeout does not restart  |
| preserve Delphi search pointers  | separate TIB + exception search  | restore original search and FS     |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: render-time font preflight | OPEN: cross-context unwind       | GATES: installed-tree + input/audio |
+----------------------------------------------------------------------------------------------------------+
| LAZY DEFAULTS REMAIN OFF          | ISOLATED BRANCH / NOT DEPLOYED    | REVIEW GOAL REMAINS OPEN            |
+----------------------------------------------------------------------------------------------------------+
```

The native entry gate now also accepts ordinary object waits (`yield_reason=1`). Their existing handle/count, handle-array pointer, all/any flag, timeout, and stack-cleanup descriptor remain dormant in the snapshot while the callback executes. Main and secondary schedulers resolve fresh live slice results, not a retained original-wait result; after restoration the original wait can consume its signal or finish its elapsed timeout exactly once. Callback entry now resets its private wait/message/CS/vblank/spin/loader descriptors as well: the new compiled test caught an inherited wait-all pointer being interpreted as a callback single-object wait's array. Shared events and clocks are not reset. Existing exclusions for foreign I/O, partially decoded blocks, synchronous-message/timer/modal continuations, and other unsupported yields remain unchanged.

The snapshot now contains 100 fields in 564 bytes. The additional three are Delphi's current registration, exception record, and pre-handler chain head. They are resumable exception-search state, not merely installed handlers in FS:[0]; testing whether they are nonzero would incorrectly block callbacks forever after a completed search because existing code leaves stale values. Native entry saves them and starts with empty callback search pointers; restoration reinstates all three alongside the original FS/TIB. A functional regression runs a second chain search between save/restore, then verifies that the interrupted search follows its own mutated live chain and updates its own exception flags.

General cross-context nonlocal unwind is still not implemented. The current `_setjmp3` is a placeholder, RtlUnwind does not implement a complete cleanup engine, and Win16 Throw can transfer stacks/selectors directly. An escape that bypasses the owned typed return must not be called a successful callback or “fixed” by guessing which CPU state to restore. Process-stop cleanup is verified; a complete nonlocal continuation-unwind protocol remains separate work.

The next lazy-consumer audit confirmed two concrete font blockers: `gdi_bitmap_font_ensure` turns a temporary provider miss into permanent stock-font failure (`state=3`), and `tt_face_open_source` closes/frees on a miss while caching loaded faces by path hash rather than provider revision. Selection, enumeration, metrics/glyphs, GetFontData, controls, Help and metafiles converge on these paths. Buffer-only parser entry points exist, but they need an owned, bounded, revision-validated byte-preparation lease before native side effects. Explicitly registered fonts must retain their existing cache-only lifetime after source deletion; implicit-load revision checks must not erase that distinction. Fable's provider findings do not prove these nested consumer paths safe.

Validation: source 310 canonical/compatibility builds pass (1,064,782 / 1,065,235 bytes), unchanged layout `b00c9d60346fdb5a`, 237 imports, 233 nonoverlapping data segments, and 933 registered tests. The compiled CPU test verifies all 100 fields across two instances and each interruption guard. The native suite passes eleven cases, including actual WaitSingle, WaitSingleEx and WaitMultiple wait-all frames: signals arriving during callback Sleep remain untouched until restoration; the wait-all callback itself performs a separate real single-object wait before its first Sleep and consumes only its own event. Original finite timeout age survives 130 sleeps; stale message/vblank descriptors are cleared for callback execution and restored afterward. Cleanup is exactly 12/16/20 bytes. Current MsgWait completes its own 24-byte frame before yielding (it does not park with reason 1); its test checks that interruption does not pop it again. The original blocked wait and inherited-array failures were reproduced before their fixes.

Main Worker/cooperative pump tests use real wait resolvers and event/semaphore atomics, with mocked guest exports, to verify current-descriptor resolution, original object ownership, timeout ages/poll floors, and remaining absolute sleeps. Compiled Delphi mutated-chain and unhandled-filter regressions pass. These checks do not establish a general SEH/unwind implementation. Host load was 16.07, above the load-4 measurement threshold; no performance or input-latency claim is made.

The final corrected source also passes 138 x86 checks and the Chrome Worker matrix with exit 0 and normal browser/server cleanup: Notepad/Calculator parity, both Rodent render/input checks, Winamp executing with three real Workers, and COM success/missing-server recovery. Existing public WinHelpA/W (ten cases) and Win16 (five cases) passed after the snapshot expansion, before the final native-only descriptor reset.

### Prior increment — native-click macro callback transactions

```text
+----------------------------------------------------------------------------------------------------------+
| NATIVE HELP CLICK                      OWNED CALLBACK TRANSACTION                                        |
+----------------------------------+----------------------------------+------------------------------------+
| QUEUE / STAGE                    | RUN                              | RETURN / STOP                      |
| copy binding + arguments         | separate 64KiB stack + TIB       | typed halt at outer pump           |
| CPU-neutral provider reads       | ordinary Sleep / ReadFile waits  | restore exact CPU and old deadlines|
| recheck source epoch + safe entry| clear DF + empty callback FP stack| stop discards; never resurrects    |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: remaining wait/unwind cases| THEN: render-time font loading   | GATES: installed-tree + input/audio |
+----------------------------------------------------------------------------------------------------------+
| LAZY DEFAULTS REMAIN OFF          | ISOLATED BRANCH / NOT DEPLOYED    | REVIEW GOAL REMAINS OPEN            |
+----------------------------------------------------------------------------------------------------------+
```

Native macro hotspots now queue owned work instead of synchronously borrowing the interrupted application's stack. An outer host pump prepares provider-backed DLL bytes, checks for foreign I/O and a safe execution boundary, and starts the callback with its own stack/TIB. A 552-byte snapshot preserves 97 architectural/supported-wait fields, including exact x87 bits and raw integer shadows, MMX/XMM, lazy flags, selectors/bases, and last error. Callback entry clears DF and empties the internal x87 stack while retaining rounding control. Its typed return parks execution until the outer pump restores the original CPU and absolute host deadlines, after final callback-slice accounting. Decoded pointers are discarded, not restored.

The browser main Worker, cooperative main, secondary Worker/cooperative threads, and CLI use the same pump. Host state is token-owned and restored exactly once; stopped owners discard it, including stop races during awaited entry/finish. Staging cancellation releases owned work; a close/new click cannot free an executing callback's arguments or stack. Entry rechecks the document epoch after preparation so stale staged work cannot begin.

This is deliberately a narrow entry contract: runnable/message-idle states only, with no partial decoded block, synchronous-message/timer/modal continuation, or foreign I/O. Other wait classes defer entry. Nonlocal callback escape/SEH abandonment, comprehensive render-time font preparation, installed-tree memory acceptance, and low-load headful input/audio acceptance remain open. Lazy hydration and sparse-write defaults remain disabled.

Cross-check with `fable-review.md` P4-2: its pending-read/provider ownership findings motivate this consumer audit, but provider fixes alone do not establish safe native callback interruption. This increment addresses that distinct execution-lifetime boundary; it does not close the broader lazy-consumer or performance findings.

Validation: source 309 canonical/compatibility builds pass (1,064,596 / 1,065,049 bytes), unchanged layout `b00c9d60346fdb5a`, 237 imports, 233 nonoverlapping data segments, and 933 registered tests. The independent CPU test checks 97 fields across two actual shared-memory instances, including NaN/negative-zero bits, exact integer shadows, frame canaries, and cache invalidation. The compiled native test invokes the production hotspot hit-test against an authored macro token/run; the successful callback executes 396 single-block slices and 130 Sleep calls plus lazy ReadFile, then restores exact CPU bytes and absolute host scheduling fields. It also covers DLL failure, staging cancellation, and stale-epoch rejection. Host-state and local/remote pump tests cover token ownership, failed entry, foreign I/O, and asynchronous stop races. Existing WinHelpA/W (ten cases), Win16 (five cases), x87 isolation (24 checks), x86 instructions (138), ThreadManager, Worker scheduler (48), and real-Worker state/heap ownership tests pass. The parser suite passed 631 checks earlier in this increment. These are targeted functional results, not a complete-suite, memory, or performance acceptance claim.

Additional native cases pass for callback ReadFile failure (normal single completion and exact restoration) and process-only cancellation during execution. The latter stops further execution, frees the owned stack/TIB/context, and verifies that neither the interrupted CPU nor old host deadlines are revived.

The final-artifact Chrome Worker matrix passes with exit 0 and normal browser/server cleanup: Notepad/Calculator parity, Win16 Rodent and Rodent2000 rendering/input, Winamp executing with three real Workers, and COM success/missing-server recovery. This browser matrix is general runtime regression coverage; the native callback contract itself is covered by the compiled hotspot fixture and local/remote pump tests above.

### Prior increment — instance-owned x87 registers

The native macro audit found that the eight physical x87 values occupied shared WASM bytes `0x200..0x23f`, while TOP, tags, control/status words, and exact integer payload shadows were instance-local globals. Interleaved guest instances could therefore overwrite one another's floating-point values. Saving that shared bank around an asynchronous native callback would also restore over a sibling Worker's live values. The fix moves the physical values into eight instance-local globals, matching the ownership of the remaining CPU registers; FNSAVE/FRSTOR now use the same physical accessors. Tags and exact integer shadows retain their existing semantics.

Reproduced before the fix: A stored `1.25`, B stored `9.5`, and A read back `9.5`. The compiled opcode-handler regression then demonstrated corruption of all eight physical slots. After the fix its 24 checks pass, covering interleaved FLD, rotated TOP, FNSAVE/FRSTOR bank isolation, and positive/negative FILD/FISTP integers beyond f64's exact integer range. Native MSVCRT `_ftol`, 138 x86 instruction checks, all ten A/W macro cases, and all five Win16 macro cases also pass. Source 308 canonical/compatibility builds pass (1,061,794 / 1,062,247 bytes), with unchanged layout `b00c9d60346fdb5a`, 237 imports, 233 nonoverlapping data segments, and 930 registered tests. The final-source Chrome Worker matrix passes with exit 0 and normal browser/server cleanup: Notepad/Calculator parity, both Rodent render/input checks, Winamp with three real Workers, and COM success/failed-fetch recovery. These are targeted functional results, not a complete-suite or performance claim.

This is an additional concrete instance of the review's state-ownership concern. Fable's earlier FPU file-organization and instruction observations do not establish cross-instance isolation. No throughput claim is implied: host load exceeds the repository's measurement threshold.

At this prior milestone native callback integration remained open. Its transaction contract was:

```text
+-------------------------+-----------------------------+-----------------------------------+
| QUEUE / STAGE           | CALLBACK                    | RESTORE                           |
| own binding + arguments | separate CPU/stack context  | exact CPU state, once             |
| no guest state mutation | normal waits and scheduling | original absolute sleep deadline  |
| wait for safe boundary  | old wait remains dormant    | old wait start + poll count       |
+-------------------------+-----------------------------+-----------------------------------+
| STOP: discard saved state; never resurrect a stopped guest                            |
+---------------------------------------------------------------------------------------+
```

Host fields are `_mainSleepUntil`, `_mainWaitStartedAt`, and `_mainWaitPolls` for cooperative main execution; `_mainWaitState.{waitStartedAt,waitPolls}` for the main Worker; and `thread.{sleepUntil,waitStartedAt,waitPolls}` for secondary threads. Preserve timestamps in the injected guest-clock domain, not remaining durations: callback time counts toward the original timeout. Detect the typed return before ordinary slice-result handling, whose tails otherwise clear or replace sleep deadlines. Do not consume the original wait's event/semaphore while executing the callback. The existing `get_sleep_yielded()` result is destructive and must not be read twice. Outstanding foreign I/O and synchronous-message/COM/DLL continuations need explicit safe-entry handling, not blind state replacement.

The CPU snapshot must preserve all GPRs/EIP, lazy-flag operands and width, saved carry/DF/extra flags, execution width and selectors/bases/FS, x87 physical bits/TOP/CW/SW/tags/raw shadows, MMX and XMM banks, and the supported wait descriptors. Existing caller-register helpers are partial; FNSAVE/FRSTOR are architectural conversions and do not preserve the internal raw-integer shadow exactly. Snapshot only at an outer complete-block boundary (`resume_ip == 0`), never retain decoded cache pointers across asynchronous work, and force an outer return after callback completion so fresh run budgets are applied. Shared events, clocks, queues, and intentional guest-memory side effects must not be rolled back.

### Prior increment — Win16 public macro continuation

```text
+----------------------------------------------------------------------------------------------------------+
| WIN16 USER.171                         OWNED PE CALLBACK / ORIGINAL PASCAL RETURN                         |
+----------------------------------+----------------------------------+------------------------------------+
| ENTER                            | WAIT / RESUME                    | RETURN                             |
| real NE loader + flat thunks     | separate 64KiB stack + TIB      | restore selectors, bases and FS   |
| retain original 16-byte frame   | normal Sleep / ReadFile yields  | restore original SS:SP and CS:IP   |
| copy DLL binding + arguments    | preserve NE resource staging    | one Pascal cleanup; release owners|
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: native macro interruption | THEN: render-time font loading  | GATES: memory + input/audio       |
+----------------------------------------------------------------------------------------------------------+
| LAZY DEFAULTS REMAIN OFF         | ISOLATED BRANCH / NOT DEPLOYED   | REVIEW GOAL REMAINS OPEN           |
+----------------------------------------------------------------------------------------------------------+
```

The public Win16 WinHelp path now retains its actual Pascal frame while a registered PE routine executes. It uses the same owned DLL/argument operation as WinHelpA/W, with a separate callback stack and TIB; the typed return restores Win16 selectors, segment bases, execution width, and FS before the original API completes. The shared call32 scratch stack is not retained across a wait. Teardown frees executing operation storage only after the guest has stopped.

Real NE startup bypasses PE initialization, so it now initializes flat thunk bounds and the typed callback-return thunk explicitly. Synchronous DLL publication saves/restores the original NE staging bytes used by resource walkers. PE extension placement validates section extents and atomically reserves a bounded low-heap extent outside the complete selector arena before mapping; an exhausted window fails rather than spilling into emulator storage. This is not a complete malformed-PE security audit.

Cross-check with `fable-review.md`: the existing ownership, retry, and overlay work does not establish this Win16 callback contract. Native-click macro interruption, nonlocal callback abandonment, render-time font preparation, and installed-tree/input/audio acceptance remain separate open work. A source recheck also corrected an earlier diagnostic hypothesis: normal live `run_impl` returns already drain `resume_ip` before yielding; native interruption still needs complete CPU/wait-state preservation, but not an additional complete-block handshake on this branch.

Validation: source 307 canonical/compatibility builds pass (1,061,528 / 1,061,981 bytes), unchanged layout `b00c9d60346fdb5a`, 237 imports, 233 nonoverlapping data segments, and 929 registered tests. The new compiled real-NE regression passes all five cases: success and data failure each take 408 slices, 130 Sleep calls and six IO parks; DLL failure, cancellation while staging, and cancellation during callback execution also pass. Assertions cover untouched Pascal input bytes, exact far return and segment/FS restoration, callback stack/TIB/TLS state, unchanged NE staging bytes, malformed section/oversized-image rejection, and release of owned stack/TIB storage on stopped-process cancellation. The test exposed and verified the fix for a raw-pointer/boolean-AND error in the trace guard.

The existing compiled parser suite passes 631 checks; NE loader/resource checks pass 2,881 assertions. The 32-bit A/W macro suite, owned resolver tests, and Win16 lazy HLP/CNT test pass. Real Pipe Dream Help and AoEHlp.dll macro checks pass. The final-source Chrome Worker matrix also passes with exit 0 and normal browser/server cleanup: Notepad/Calculator parity, both Rodent render/input checks, Winamp with three real Workers, and COM success/failed-fetch recovery. These are targeted functional checks, not the complete test suite, a general PE compatibility claim, or performance/memory acceptance.

### Prior increment — owned public macro calls

```text
+----------------------------------------------------------------------------------------------------------+
| PUBLIC WINHELPA/W (32-BIT)                 DLL BYTES -> CALLBACK -> TYPED RETURN                           |
+----------------------------------+----------------------------------+------------------------------------+
| OWN BEFORE WAITING               | RESUME, DO NOT REPLAY            | STILL OPEN                         |
| copied DLL/export binding        | original API frame retained     | native-click macro callbacks      |
| copied string/word arguments     | callback Sleep / ReadFile waits | Win16-to-PE callback context       |
| bounded, monotonic DLL staging   | release only after typed return | nonlocal callback unwind cleanup  |
+----------------------------------+----------------------------------+------------------------------------+
| NEXT: remaining callback paths  | THEN: render-time font loading  | GATES: memory + input/audio       |
+----------------------------------------------------------------------------------------------------------+
| LAZY DEFAULTS REMAIN OFF         | ISOLATED BRANCH / NOT DEPLOYED   | REVIEW GOAL REMAINS OPEN           |
+----------------------------------------------------------------------------------------------------------+
```

Public 32-bit WinHelpA/W registered-routine calls now own a staged DLL binding and parsed arguments. An explicit callback-return continuation preserves the original API frame until completion; retries enter before document reload or Unicode normalization, so they do not repeat registration, navigation, or callback side effects. The callback executes under ordinary scheduling rather than the former 64-round nested loop. The public operation does not borrow a registry record or a temporary W-string across a wait.

DLL preparation reads at most 4KiB per operation, owns its file handle and byte buffer, and leaves shared PE staging untouched until synchronous publication. Loaded-DLL cache hits, foreign pending-read preservation, exact owner cancellation, malformed bytes, and read faults have dedicated coverage. Executing callback arguments are not freed by a replacement request; process teardown releases them only after producers have stopped. Direct host/debug calls without a real API frame retain their separate synchronous path.

This does **not** complete native-click or Win16 macro callback support. Those require preserving an interrupted CPU context and its host-side wait deadlines. Nonlocal guest exception/longjmp abandonment also lacks a verified callback-unwind cleanup hook. Default lazy hydration/range writes remain off; render-time fonts and memory/input/audio acceptance remain open. Fable's earlier retry and overlay work is not evidence that these callback cases are covered.

Validation: source 306 canonical/compatibility builds pass (1,059,862 / 1,060,315 bytes), unchanged layout `b00c9d60346fdb5a`, 237 imports, 233 nonoverlapping segments, and 928 registered tests. All eight primary compiled A/W macro cases pass: successful and faulting callback reads take 408 slices, 130 Sleep calls and six IO parks; DLL failure and pending cancellation do not execute the callback. Tests verify exactly-once side effects, original document loaded once, retained string/word arguments, exact read bytes, final EAX and 20-byte stdcall cleanup, and released operation/handle ownership. Nested A-to-W and W-to-A cases also pass: each takes 816 slices, 260 Sleep calls and 12 IO parks, observes two distinct jobs, and preserves outer arguments through inner document/registry replacement. Both callbacks finish once and leave no owned jobs. The resolver and prior help regressions also pass. Nonlocal unwinding remains unverified.

The final-source Chrome Worker matrix passes with normal browser/server cleanup and exit 0: Notepad/Calculator parity, both Rodent render/input checks, Winamp with three real Workers, and COM success/failed-fetch recovery. The real AoEHlp.dll macro regression passes all six checks and Pipe Dream's four Help checks pass against this build. No performance improvement is claimed.

### Prior increment — deferred native help navigation

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
