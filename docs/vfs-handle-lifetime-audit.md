# VFS close/duplicate lifetime audit — 2026-09-21

Status: **open**. CRT termination issues stream closes (`f903f56b`), file
duplicates have independent identities (`800a543a`), and closed VFS handles
now reject ordinary I/O. Public error propagation and broader lifetime semantics
remain incomplete; do not call complete FILE/handle lifetime support finished.

## Initial source findings (before the file-duplication fix)

- `VirtualFS.closeHandle` retains file records with `closed=true`, justified by
  a comment about an NSIS extraction thread using the installer after close.
- Ordinary `readFile`/`writeFile`/`setFilePointer` look up the retained record
  without enforcing its closed flag. `flushFileBuffers` does check it.
- `DuplicateHandle` creates real console/current-thread aliases but simply
  copies ordinary file-handle values. CRT `_dup` also returns the original
  nonnegative value. Those are not independently closable handles.
- File duplicates must share the underlying file position while retaining
  distinct handle lifetimes. Separate `CreateFile` calls instead have separate
  positions. See Microsoft's [DuplicateHandle contract](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)
  and [CRT duplicate-descriptor contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/dup-dup2?view=msvc-170).

## Exploratory NSIS A/B

No production source was patched. A temporary Node preload counted close and
subsequent read/write/seek calls. Its strict arm deleted the file handle on
close, rather than retaining the tombstone. The reusable version is now
`tools/probe-vfs-close.js`, explicitly loaded by `--require`; strict closure
requires the additional `--vfs-close-strict` argument. It is not shipping code.

| Route | Matching VFS name/size rows | Closes per arm | Read/write/seek after close |
|---|---:|---:|---|
| Winamp 2.91 `/S`, 8,000 batches × 5,000 blocks | 64 | 27 | 0 / 0 / 0 |
| Winamp 2.95 `/S`, same budget | 64 | 27 | 0 / 0 / 0 |
| Winamp 2.95 `/S`, `--threads`, 800,000-batch ceiling | 184 | 159 | 0 / 0 / 0 |

All three pairs have identical sorted VFS name/size listings and no reported
crash/unimplemented API. The longer 2.95 route reaches host exit code 0 after
9,717 batches with 81,075 API calls in both arms. The shorter routes stop at
their budget; expected EXE/MP3/output plugin sizes match the existing regression:
2.91 = 846848 / 141312 / 13824 bytes; 2.95 = 854016 / 274944 / 13824 bytes.
These are size comparisons, **not byte-content hashes**.

`--threads` configures Worker execution but does not prove the silent route
created a guest worker. The interactive 2.95 recipe was therefore also tried
with `--threads --trace-thread`. **Both arms fail to leave License Agreement**:
control 1000 appears at batch 575, Next is posted at 584, and the Installation
Options / Folder / Installing Files waits time out at 2394 / 4214 / 6034.
Both end at 25,986 batches with 12,296 API calls, one close and zero observed
post-close I/O. No extraction-worker creation was established. This is an
inconclusive negative control, not a passed interactive/Worker regression.

The probes used `--no-build` and the current shared worktree. Other agents had
uncommitted host/runtime changes, including VFS handle-number changes. Treat
these results as exploratory, not an isolated clean-commit A/B or a performance
benchmark. Initial default-batch-size runs were superseded by the explicit
5,000-block runs above and are not counted as completed extraction checks.

Reproduce the silent arms (omit the final strict flag for the baseline):

```sh
node --require=./tools/probe-vfs-close.js test/run.js \
  --exe=test/binaries/installers/winamp295.exe --args=/S \
  --max-batches=8000 --batch-size=5000 --max-seconds=60 \
  --dump-vfs --quiet-api --no-build --vfs-close-strict
```

Longer configured-Worker arm: add `--threads`, change the batch ceiling to
800000 and wall guard to 30 seconds. Interactive route omits `/S`, uses a
45-second guard, and adds:

```text
--threads --trace-thread
--input=1:wait-dlg-control:1000:6500,10:post-cmd:1,20:wait-title:Installation_Options:1800,30:post-cmd:1,40:wait-title:Installation_Folder:1800,50:post-cmd:1,60:wait-title:Installing_Files:1800,20000:post-cmd:1
```

Local exploratory logs: `/private/tmp/wa-close-{291,295}-{baseline,strict}-5000.log`,
`/private/tmp/wa-close-295-worker-{baseline,strict}.log`, and
`/private/tmp/wa-close-295-interactive-{baseline,strict}.log`. These temporary
artifacts are not assumed durable; the recipes and observations above are.

## Next implementation order

1. Separate file-handle identity from shared open-file state; wire real file
   duplication through `DuplicateHandle` and `_dup`. Test shared position,
   independent close, close-source, invalid handles and retained data.
2. Enforce close across read/write/seek/size/time/mapping paths, including the
   documented invalid-handle error, double close and pending provider reads.
   A valid duplicate or mapping must outlive closure of the source handle.
3. Re-run clean CLI and browser NSIS extraction, establishing an actual guest
   worker before claiming the original workaround unnecessary there. Repair
   the wizard baseline separately if it still cannot advance.

No evidence here justifies preserving the workaround as correct Win98 behavior,
nor claiming that deleting the handle alone completes the lifetime model.

## File-duplication implementation checkpoint — 2026-09-21

`DuplicateHandle` now dispatches recognized VFS files through a real host
duplication operation; CRT `_dup` uses the same operation with SAME_ACCESS.
Each duplicate has its own handle, closed flag, access metadata and inheritance
flag. A shared position object is attached lazily on the first duplication,
so independent opens keep independent positions and duplicate chains all share
one cursor. File handles are allocated without colliding with existing values.
The host import signature mirror was regenerated for Worker RPC.

Recognized closed sources and fabricated high-namespace file handles fail;
unknown option bits and access escalation fail with Win32 errors. CLOSE_SOURCE
is honored on both successful duplication and recognized-file errors. `_dup`
returns -1 with EBADF (or EMFILE for exhausted handle space), not a fake alias.
Non-file kernel alias handling remains outside this fix.

`test/test-duplicate-handle.js` exercises the real WAT handlers and real VFS:
distinct identities; reads/seeks shared across Win32 and CRT duplicates;
independent positions from separate opens; source close leaves its duplicate
usable; duplicate-of-closed fails; transfer/close-source; access and option
failures; CRT errno; and cdecl/stdcall stack cleanup. Existing current-thread
pseudo-handle tests still pass. CRT stream-close and termination-callback suites
also pass. The quiet-handler census remains 250 + 22 (the old `_dup` body was
not part of that straight-line census).

Remaining limits are explicit: ordinary post-close VFS I/O is still accepted
until the next lifetime change; this checkpoint tests **independent closed
state**, not enforcement through every I/O API. General cross-process duplication,
null-target/null-output compatibility, kernel-object aliases, descriptor-number
allocation and standard CRT descriptors remain incomplete. Access metadata is
preserved/restricted at duplication, but comprehensive generic/specific-rights
mapping and I/O access enforcement are not established. No real Worker/browser
duplication test or native Win98 differential is claimed.

Full shared-worktree build passes: canonical 1,471,730 bytes, compatibility
1,472,704 bytes, layout `54f430b349c8d55e`, 246 host imports and 242
nonoverlapping data segments. These are integration results on the shared tree,
not isolated performance measurements or clean-commit artifact proofs.

## Closed-file enforcement checkpoint — 2026-09-21

One `getOpenFile` lookup now rejects tombstones for VFS read/write/seek, truncate,
size, time and flush operations. The host bridges also reject zero-length
read/write and positional reads before guest-buffer access, and reject creation
of a new mapping through a closed file. Double close of a known file returns
failure. This removes the NSIS-specific permission to continue I/O after close,
consistent with Microsoft's [CloseHandle invalidation contract](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-closehandle).

`test/test-vfs.js` adds a closed-operation matrix proving no buffer, file bytes
or shared cursor changes on rejection, while a valid duplicate still reads.
`test/test-crt-close.js` now requires actual CRT-closed handles to reject I/O,
and verifies that a mapping created before source-handle close can still create
a view containing the original bytes. Mapping allocation/free ownership hunks
already dirty in the worktree were not changed by this work.

A current-production (no diagnostic preload) Winamp 2.95 `/S` extraction reaches
exit 0, 9,717 batches and 81,075 API calls under the new policy. EXE/MP3/output
plugin sizes remain 854016 / 274944 / 13824 bytes. Command:

```sh
node test/run.js --exe=test/binaries/installers/winamp295.exe --args=/S \
  --max-batches=800000 --batch-size=5000 --max-seconds=30 \
  --dump-vfs --quiet-api --no-build
```

Temporary output: `/private/tmp/wa-close-enforced-295.log`. The run uses the
shared tree and previously compiled artifact; this change is in host JavaScript.
It is not a browser/actual-Worker extraction or a timing benchmark.

Next: error propagation at public Win32 front doors. Several existing BOOL/
sentinel-return bridges do not carry the precise VFS error back to per-thread
`GetLastError`; rejection alone is not full API correctness. Known closed-file
records are still retained as tombstones, so reclamation remains open. General
kernel-handle validation, deletion/rename of mapped backing files, and closing
during outstanding provider I/O also need dedicated coverage.

Verification: VFS 32/32, lazy-provider 36/36, file-time, duplicate-handle,
CRT-close and legacy-HFILE suites pass; JavaScript syntax and diff checks pass.
No new full WASM build was required or claimed for these host-only changes.

## Public CloseHandle checkpoint — 2026-09-21

The ordinary host-backed branch of `CloseHandle` discarded the host BOOL and
unconditionally returned success. It now preserves that result and sets
`ERROR_INVALID_HANDLE` (6) on failure. Successful close leaves the previous
last-error value unchanged. Existing token, console and IOCP branches are unchanged.

The source-compiled `test/test-duplicate-handle.js` regression calls the public
WAT handler against the real VFS: first close succeeds, second close fails with
last-error 6, both calls clean up eight stack bytes, and the duplicate remains
readable. Duplicate-handle and CRT-close suites and the handler ESP gate pass.
No full browser/Worker run or native Win98 differential is claimed here.

This does not fix unknown non-file handle validation in the host, or the remaining
read/write/seek/size error paths. Those need operation-specific errors returned
with the operation result; a shared host last-error getter would risk another
Worker overwriting the error between calls. Tombstone reclamation and outstanding
provider-I/O lifetime coverage remain open.

## WriteFile operation-error checkpoint — 2026-09-21

`fs_write_file_result` returns ERROR_SUCCESS or the error from the same write
operation, as one i32 RPC result. The existing `fs_write_file` BOOL adapter calls
that implementation, keeping CRT callers compatible without duplicating writes.
The public Win32 handler converts the result to BOOL and sets its instance-local
last-error on failure. The IOCP write branch also preserves the write error rather
than replacing every failure with ERROR_WRITE_FAULT. Its existing multi-call
seek/write/restore sequence is **not** made atomic by this change.

Following Microsoft's [WriteFile contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile),
the bridge clears the byte-count output before checking the handle. Closed handles
report 6 even for zero-byte writes; read-only drives report 19. The regression
calls the public handler for successful writes, closed handles, read-only media,
injected operation errors (including disk-full 112), and success after failure,
checking byte counts and stdcall cleanup. Injected disk-full is an error transport
test, not a claim that the VFS implements disk capacity.

Access-mask enforcement, invalid-buffer probing, read/seek/size error transport,
and real concurrent Worker I/O coverage remain open. The new bridge avoids a
shared last-error getter; this alone does not establish all file-I/O thread safety.

Verification: public write/duplicate, CRT-close, IOCP-overlapped, worker-import
and VFS (32/32) suites pass. Full shared-tree build passes with 247 imports,
canonical 1,472,601 bytes, compatibility 1,473,575 bytes, unchanged layout
`54f430b349c8d55e`, and 242 nonoverlapping data segments. This is integration
coverage, not an isolated benchmark or a real Worker write-error test.

## ReadFile operation-error checkpoint — 2026-09-21

The ordinary public `ReadFile` path now uses `fs_read_file_result`: success 0,
internal lazy-fill retry 997, or the read's specific error, returned in one RPC.
It no longer asks `fs_read_pending` in a second call that could observe another
operation's state. Positional reads consume the same result directly. The legacy
BOOL bridge delegates to this implementation; other front doors still use its
pending/fault side channel and remain migration candidates.

The [ReadFile byte-count and failure contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-readfile)
is preserved: output starts at zero, closed handles fail with 6 (including
zero-byte requests), ordinary EOF is successful with zero bytes, and failures
publish the operation error. Internal lazy retry parks without publishing 997
as a completed synchronous operation and restores the original stdcall frame.
The public-handler regression covers real bytes/EOF/closed handles and injected
ordinary errors, retry and terminal provider errors. Injection checks transport
and frame handling, not a real concurrent provider run.

This does not make the scheduler's shared `pendingRead` request ownership safe
across concurrent operations, nor does it finish access rights, invalid buffers,
partial multi-span failure/cursor semantics, or the remaining seek/size paths.

Verification: final public read/write/duplicate regression, lazy-provider 36/36,
and IOCP-overlapped suites pass. Full shared-tree build passes: 248 imports,
canonical 1,472,619 bytes, compatibility 1,473,593 bytes, unchanged layout
`54f430b349c8d55e`, 242 nonoverlapping data segments. Machine load exceeded 100
during verification; no timing or isolated-artifact claim is made.

## SetFilePointer result checkpoint — 2026-09-21

The shared seek core no longer clamps a negative result to zero: it returns
ERROR_NEGATIVE_SEEK (131) without changing the cursor. Bad handles return 6;
invalid methods return 87. The legacy numeric adapter shares this validation.
The public handler's new `fs_seek_result` bridge returns the error in the same
RPC that writes the low/high outputs. WAT translates the optional high-word
pointer once; the low result goes directly to the calling thread's EAX storage.

Following the documented [SetFilePointer contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfilepointer),
distance is signed 32-bit without a high pointer and signed 64-bit with one.
A result beyond 32 bits without a high output fails instead of truncating.
Success clears last-error so a valid low word of 0xffffffff is not mistaken for
failure. Seeking past EOF changes position, not file size. Failure leaves the
cursor and high-word output untouched.

Tests cover negative FILE_END distance, negative resulting position through
both adapters, bad method, closed handle, valid sentinel low word, 4 GB carry,
missing-high overflow and no file growth. The VFS still stores positions as
exact JS Numbers: results above Number.MAX_SAFE_INTEGER are rejected with 87,
not rounded. This is an emulator limit, not a claimed native Win98 limit.
NO_BUFFERING alignment, access checks, SetFilePointerEx error behavior and
size-query result transport remain outside this checkpoint.

Verification: public seek/read/write/duplicate, legacy seek/HFILE, VFS 32/32 and
lazy-provider 36/36 tests pass. Full shared-tree build passes with 249 imports,
canonical 1,472,685 bytes, compatibility 1,473,659 bytes, unchanged layout
`54f430b349c8d55e` and 242 nonoverlapping data segments. Load exceeded 300 during
the build; this is correctness/integration evidence, not performance evidence.

## File-size result checkpoint — 2026-09-21

`GetFileSize` no longer hardcodes the high DWORD to zero. Both it and the size
fields of `GetFileInformationByHandle` use `fs_file_size_result`, which returns
status separately from the low/high outputs in one RPC. The latter previously
mistook any valid size with low DWORD 0xffffffff for an invalid handle. Closed
handles now report ERROR_INVALID_HANDLE without overwriting size outputs.

The documented [GetFileSize sentinel contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfilesize)
requires last-error zero on successful 0xffffffff results. The public handler
does this, and a NULL high pointer simply omits that output rather than forcing
a large-file failure. Tests call both public handlers for sizes 0, 17,
0xffffffff, 0x100000011 and 0x1ffffffff, verify stack cleanup and closed-handle
errors, and use providers that throw if any bytes are requested. Thus the large
metadata fixtures require no multi-gigabyte allocation or data download.

This repairs size and error transport only. `GetFileInformationByHandle` still
has synthetic timestamps/attributes and per-open file identity, which do not
constitute complete metadata semantics. `GetCompressedFileSize` still has its
older enumeration workaround, and GetFileSizeEx is not currently registered.
Provider lengths remain bounded by the exact JS Number range. No native Win98
differential or concurrent Worker run is claimed.

Verification: the public file-size/seek/read/write/duplicate regression, VFS
32/32 and lazy-provider 36/36 suites pass. Full shared-tree build passes with
250 imports, canonical 1,472,728 bytes, compatibility 1,473,702 bytes, unchanged
layout `54f430b349c8d55e` and 242 nonoverlapping data segments. No performance
claim is made from this heavily loaded shared-machine run.

## Compressed-size workaround removal — 2026-09-21

`GetCompressedFileSizeA/W` now queries the same metadata-only handle it opened
through `fs_file_size_result`. Removed the second FindFirstFile lookup, ASCII
basename comparison, regex-metacharacter exception, and 592-byte heap scratch.
Those workarounds could discard a real high DWORD for valid literal filenames.
The helper closes its temporary handle on query success and failure and retains
path/output validation and the ambiguous-low-word last-error contract.

For the current uncompressed, nonsparse VFS, logical size is the documented
[GetCompressedFileSize result](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getcompressedfilesizea).
The regression replaces fabricated enumeration outputs with real lazy providers
at 0x100000011 and 0x1ffffffff bytes, through A/W entry points, with/without high
outputs and with Unicode/regex-punctuation names. Enumeration imports throw if
called; provider reads also throw. Failure injection checks output preservation
and temporary-handle closure. This is not implementation of compressed/sparse
storage, filesystem allocation accounting, or all CreateFile open-error codes.

Verification: source-compiled `test-get-compressed-file-size.js`, handler ESP,
WAT-fragment and silent-stub gates pass (250 manual + 22 metadata unchanged).
This source-only cleanup adds no import or layout changes. No new full artifact
build or browser run is claimed for this checkpoint.

## File-information metadata checkpoint — 2026-09-21

`GetFileInformationByHandle` now receives one VFS snapshot: stored creation,
access and write timestamps; entry attributes plus immutable-media read-only;
mounted volume serial (or the same default used by GetVolumeInformation);
high/low size; one FAT-like link; and file-entry identity. Removed the WAT
hardcoded dates, ARCHIVE attribute, unrelated volume serial and handle-as-ID.

The [file-information identity contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information)
lets callers compare distinct opens of one file. A VFS-owned weak identity map
now assigns IDs to entries, not handles; duplicates and separate opens agree,
copies get different IDs, and CREATE_ALWAYS retains an assigned ID. Chain-launch
adoption shares the identity allocator with the adopted entry objects. Weak keys
do not retain deleted entries solely for identity bookkeeping. IDs are opaque
runtime identities, not emulated FAT directory-cluster/slot numbers or persisted
on-disk IDs.

The regression checks all stored timestamp words, attributes, mounted serial,
link count, duplicates, separate opens, copies, truncation, deletion/recreation,
adoption and closed-handle failure. Existing lazy large-size coverage also runs
through the new snapshot without fetching provider contents.

Remaining limits: file times are not yet quantized to FAT's field-specific
resolution. Open handles still resolve entries by path, so rename/delete/recreate
while open needs a full file-object lifetime model. CREATE_ALWAYS's existing
timestamp/attribute reset and other creation-disposition details are not repaired
by preserving identity. Invalid guest output spans and real concurrent Worker
metadata/mutation tests remain separate work.

Verification: public metadata/size/seek/read/write/duplicate, filesystem-adoption,
VFS 32/32 and file-time suites pass. Full shared-tree build passes with 251 imports,
canonical 1,472,099 bytes, compatibility 1,473,073 bytes, unchanged layout
`54f430b349c8d55e` and 242 nonoverlapping data segments. This build also includes
the preceding compressed-size workaround removal; no isolated timing claim.

## Pending-read lifetime checkpoint — 2026-09-21

A delayed provider rejection used to publish `readFaults[handle]` unconditionally,
even after close had cleared that handle's state. Pending reads now carry the
original file-handle record and entry. Fill start/completion validates both plus
the provider; a closed/reused handle or replaced entry cannot receive the old
fault. A previously latched fault is also discarded if its identity no longer
matches. Retry accounting uses that identity rather than numeric handle alone.

Close retires its own pending slot, never a peer's. A fill completing later may
populate the provider cache, but cannot revive a closed operation. Already-closed
pending reads do not start new fills. Mapping fills retain their existing separate
path; this is not a mapping-lifetime fix or provider-network cancellation.

Deterministic deferred-provider tests cover late failure after close, forced
numeric handle reuse, replacement before/after fault publication, close before
fill, late success, and preserving a peer's pending request. These are asynchronous
VFS tests, not real Worker scheduler coverage. The scheduler's process-shared
pending slot and open-handle path-based entry model remain broader open issues.

Verification: lazy-provider 39/39, VFS 32/32 and adoption tests pass. A negative
control loaded the committed filesystem source in memory: it published a stale
fault after close, whereas the candidate did not. This host-only change adds no
WASM import/layout changes; no artifact rebuild or performance claim.

## Host-loop completion ownership checkpoint — 2026-09-21

The two browser io-wait loops and the CLI main loop each cleared `pendingRead`
unconditionally after awaiting a fill. That bypassed the VFS identity guard:
when request B arrived while A awaited its provider, A's host continuation
erased B. Removed those redundant clears; `fillPendingRead` owns retirement.
It now normalizes an immediate provider exception through the same guarded
failure path as a rejected promise, so the host need not supply fallback cleanup.

A regression executes the actual inline io-wait blocks extracted from host.js
(worker-main and cooperative) and test/run.js against deferred real VFS fills.
It failed before the change with `browser worker: late A completion must not
clear B`; all three blocks pass after it. This is focused host-block execution,
not a complete browser or real Worker scheduling run. A separate test covers an
immediate provider exception and its ERROR_READ_FAULT retry.

Read-side ownership audit: the browser broker currently uses a shared host
import table; the CLI can use per-slot tables, but both still publish one VFS
pending slot. ThreadManager's ordinary/nested/cooperative io-wait paths select
that slot rather than a request owned by the yielding thread. Their existing
post-fill clears are identity-guarded (or omitted). Correct per-thread selection
therefore still needs a request token carried with the yield, or an explicitly
thread-owned pending registry; simply removing the clears does not solve it.

Verification: final shared-tree lazy suite 41/41, VFS 32/32, host/CLI/filesystem
syntax and diff checks pass. The first regression run failed before the host
edits, as recorded above. No new WASM/import changes or artifact rebuild.

## Lazy retry-budget checkpoint — 2026-09-21

The existing three-miss safeguard took its history from `pendingRead`, but the
ReadFile import and fill completion both clear that scheduler slot. Real
import/fill/retry cycles therefore restarted at attempt one indefinitely when
a provider resolved its fill without making the range available. The earlier
direct-VFS test retained the slot manually and did not exercise this lifecycle.

Retry history now lives in a WeakMap keyed by the open-file record, with entry,
provider, position and length identifying the missing range. Peer reads and slot
retirement do not reset it. Cached-prefix replay preserves a later missing
range's history; successful progress at that range, a consumed fill failure,
exhaustion or close retires it. Replacement entries, different ranges, duplicate
handles and numeric handle reuse do not inherit another operation's budget.
Exhaustion reports ERROR_READ_FAULT once instead of also latching a second
failure for the next call. This is the emulator's provider safeguard, not a
claim that Windows 98 prescribes three retries.

The new import-level regression failed before the fix (`1 !== 2` at the second
retry). It alternates two handles through actual `fs_read_file_result` calls and
awaited fills, checks the error/count/cursor and later recovery. Additional VFS
checks cover cached prefixes, duplicate/reused handles, replacement and range
changes. This does not fix shared scheduler request selection or establish real
Worker coverage; no WASM imports/layout change and no performance claim.

Verification: shared-tree lazy-provider suite 43/43, VFS 32/32, filesystem
adoption and syntax/diff checks pass. No full artifact rebuild was needed.

## Handle-allocation ownership checkpoint — 2026-09-21

CreateFile used an unchecked incrementing number while DuplicateHandle had its
own collision scan. At wrap, an ordinary open overwrote the first live handle's
record, silently changing which file the guest's existing handle referenced.
Both paths now use one positive disk-namespace allocator, skipping live records
and retained closed-handle tombstones. Allocation failure precedes creation or
truncation, and DuplicateHandle still honors CLOSE_SOURCE on allocation failure.
Failed opens can leave gaps in the opaque handle-number sequence.

A forced-boundary regression failed before the change and now checks original
record/cursor/size preservation, both allocation front doors, tombstones and
invalid counter seeds. Injected allocation exhaustion checks that files are not
created/truncated on failure; it does not populate the entire handle namespace.
The stale-fill tests explicitly remove tombstones before simulating future
numeric reuse, preserving their defensive identity checks without relying on the
old allocator bug. Tombstone reclamation itself remains unimplemented; neither
this change nor the fixed allocation range claims native Win98 handle values.

Verification: VFS 34/34, lazy-provider 43/43, legacy HFILE, handle-sign and
adoption suites pass. The source-compiled public file-information/size/seek/
read/write/close/duplicate and CRT-duplicate suite also passes, as do syntax and
diff checks. No WASM or import-layout changes; no full artifact rebuild.

## Scheduler-selection repro and actual-fill accounting — 2026-09-21

An explicit interleaving through the real filesystem imports and
`ThreadManager.resolveThreadSendYield` proves more than a possible stale slot:

1. A's lazy read returns 997 and publishes its missing range.
2. B's successful zero-byte read clears the process-wide pending slot.
3. A's nested yield service finds no request and resumes A without a fill.
4. Repeating this produced errors `[997,997,997,30]`, **zero provider calls**,
   three resumes and an unchanged file cursor, although the provider would
   satisfy the first fill immediately.

This exposed a defect in the preceding retry-budget fix: recording a budget
attempt at cache miss charged scheduler retries as if the provider had failed.
History now advances at `fillPendingRead` start, after lifetime validation.
Repeated misses without a fill cannot produce ERROR_READ_FAULT. Existing tests
still enforce the bound after three real, unsuccessful fills; an added test
executes eight no-fill nested yield cycles followed by a successful fill/read.
The older direct "liar" test now actually awaits the fills it purported to test.

This avoids a fabricated I/O error, **not the scheduling starvation**. Request
selection remains open. The complete fix must cover all three scheduler paths
(ordinary Worker, nested Worker send, cooperative thread), both host main loops,
legacy `fs_read_file` + `fs_read_pending` pairs, result-returning ReadFile,
positional ReadFile and lazy MapViewOfFile. Browser real Workers share the main
import table, so merely adding `ctx.threadId` to CLI closures is insufficient.

An explicit caller identity on the five affected imports is a viable integration
route: guest `$current_thread_id` is 1-based, while scheduler `thread.tid` is
0-based. The generated Worker signatures must change with the WAT imports;
selection, fault reporting and retirement must use the same owner. Alternatively
a request token can travel with yield 12, but must also survive the legacy BOOL
and mapping front doors. Neither proposal is implemented or verified yet.
Real two-Worker interleavings and same-handle reads remain required coverage;
the deterministic nested-service probe is not a real Worker execution test.

Verification: lazy-provider 44/44, VFS 34/34, adoption, syntax and diff checks
pass. No WASM/import changes or artifact rebuild in this checkpoint.

## Thread-owned pending I/O checkpoint — 2026-09-21

Implemented the explicit-caller route described above. Five internal WAT
adapters attach `$current_thread_id` to ReadFile BOOL/result/positional imports,
the legacy pending-status query and MapViewOfFile. Existing guest ABI/stack
contracts are unchanged; host import signatures and their generated RPC mirror
now include the caller ID. Adapters centralize the invariant for CRT, Win16,
sound, font, help and other internal readers as well as the public Win32 APIs.
The ID comes from the calling WASM instance, not the shared browser import table
or a guessed CLI context.

VirtualFS keeps pending requests, deferred faults and retry histories per guest
thread. Main-thread direct VFS calls retain the existing state as their canonical
owner rather than maintaining a second copy. Pending records retain their owner
through asynchronous fill completion. Both browser main loops and the CLI main
loop select ID 1; ordinary/nested Worker and cooperative thread scheduling
select the yielding thread's ID. Close invalidates that handle in every owner's
state. Thread exit retires its state, and late file-fill failures cannot publish
into a subsequently created state with the same ID.

Lazy mapping completion keys also include the caller ID: simultaneous identical
MapViewOfFile requests cannot consume one another's allocated view. This does
not add cancellation/rollback of mapping allocations already in flight at thread
exit; mapping teardown remains a separate lifetime issue.

Coverage includes interleaved zero-byte and lazy reads, legacy pending queries,
same-handle positional reads with one failing range and one successful range,
close/exit retirement, and identical concurrent mapping requests consumed in
reverse order. Scheduler tests exercise ordinary Worker and cooperative I/O
selection and exit cleanup; the lazy suite exercises nested send service.
Two actual Node Workers instantiate the source adapters compiled by WATX and
call through the production shared-memory RPC broker with one shared import
table. This is real Worker/RPC/adapter coverage, not a full browser application
or x86 file-call scheduling run.

The enlarged import declaration exposed a census bug: `wat-dup-census` counted
matching host signatures as duplicated function bodies. Its extractor now skips
whole import forms, with a multiline-import self-check; the baseline was not
expanded. It reports 138/142 groups and 532/548 members on this shared tree.

Verification: lazy/provider suite 47/47 (including the two real Workers),
scheduler suite 50/50, VFS 34/34, adoption and source-compiled public Win32/CRT
file API tests pass. Full build passes: canonical 1,472,187 bytes, compatibility
1,473,161 bytes, 251 imports, unchanged layout `54f430b349c8d55e`, 242
nonoverlapping data segments. Winamp 2.95 `/S` reaches guest Exit code 0 after
9,717 batches / 81,075 API calls on the rebuilt artifact; no timing claim.
No full browser application run was performed here. General simultaneous
ordinary reads sharing one seek cursor, file-object rename/delete lifetime,
access enforcement and in-flight mapping teardown remain separate work.

## File data-access enforcement (2026-09-21)

ReadFile/WriteFile now reject handles lacking the corresponding data right with
ERROR_ACCESS_DENIED, including zero-byte requests. Validation precedes guest
data-buffer translation and lazy-provider access; rejected operations leave
bytes and shared cursors unchanged and clear the returned byte count. Metadata
queries remain available on handles opened with access zero. Generic read/write,
GENERIC_ALL and the equivalent specific data rights are recognized. Append-only
writes target EOF; null writes no longer extend a file beyond EOF.

Contract references: Microsoft's [ReadFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-readfile),
[WriteFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile),
and [file access rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights).
This is documented Win32 behavior, not a new native Win98 measurement.

Remaining: normalize generic/specific rights consistently at creation and
duplication, enforce SetEndOfFile and mapping access, model sharing restrictions,
and preserve open-file object identity across rename/delete. This change is not
a complete security model or a fix for the outstanding mapping lifetime work.

Verification: VFS 36/36 and lazy/provider 47/47 pass; source-compiled public
Win32/CRT file API tests cover access denial, byte counts, stack cleanup and a
read-only duplicate without changing its source cursor. File-time, IOCP and VFS
adoption tests pass. Winamp 2.95 `/S` reaches guest Exit code 0 after 9,717
batches / 81,075 API calls using the existing artifact and changed host JS.
No performance or full-browser result is claimed.

## SetEndOfFile access and errors (2026-09-21)

SetEndOfFile now checks write-data access before touching file bytes, including
no-op size changes. Metadata-only, read-only and append-only handles fail with
ERROR_ACCESS_DENIED; closed handles report ERROR_INVALID_HANDLE and writable
handles on protected media report ERROR_WRITE_PROTECT. The public WAT handler
uses an operation-result import to set GetLastError on failure and preserve it
on success. The old Boolean import remains for backup-stream callers.

Microsoft's [SetEndOfFile contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setendoffile)
requires write access. Tests exercise truncation, extension, unchanged cursors,
access denial, protected media, closed handles and stdcall cleanup. Native Win98
comparison and mapped-file exclusion are still outstanding; this does not
claim to complete mapping access or lifetime rules.

VFS 36/36, source-compiled public file APIs and backup-stream tests pass.
The full build passes through the 252-import signature gate but is blocked by
unrelated stale toy-VM browser bundles; no full-build success is claimed.
Its earlier region gate exposed a raw GUEST_BASE in the prior lazy-mapping test;
that assertion now uses RegionMap.g2w rather than a copied address.

## Generic file-right comparisons (2026-09-21)

DuplicateHandle compares expanded generic file rights, rather than raw generic
bits against specific bits. Equivalent FILE_GENERIC_READ/WRITE/EXECUTE and
FILE_ALL_ACCESS masks work in either direction; FILE_READ_DATA alone still
cannot acquire the attributes, EA or standard rights included in GENERIC_READ.
The original requested mask stays on each handle for diagnostics and SAME_ACCESS.

CreateFile write intent now includes specific data, append, EA and attribute
write rights, including those obtained through GENERIC_ALL. They cannot open
protected media or qualify for the read-only basename fallback. Flush and
SetFileTime validate their corresponding expanded rights consistently.
Mappings follow Microsoft's [file-right table](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights);
no native Win98 observation or ACL enforcement is claimed.

VFS 37/37, adoption, source-compiled public Win32/CRT file APIs and file-time
tests pass. Creation-disposition validation, mapped-file
permissions, sharing restrictions and file-object lifetime remain separate
issues; normalizing masks does not resolve them.

## Creation-disposition validation (2026-09-21)

TRUNCATE_EXISTING rejects handles without write-data access before allocating
a handle or changing file bytes, including provider-backed files. Invalid
disposition values are rejected at the same boundary. OPEN_ALWAYS now separates
opening an existing file from creating a missing one: a read-only open of an
existing file on protected media succeeds, while creation there still fails.
The old basename-fallback comment claimed modes that its guard had excluded;
the code now explicitly retains only the existing read-only OPEN_EXISTING
compatibility behavior, without redirecting creation or truncation.

Reference: Microsoft's [CreateFile dispositions](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea).
VFS tests cover rejected truncation preserving bytes, entry identity and handle
allocation, invalid dispositions, protected-media OPEN_ALWAYS and successful
truncation. This does not finish the public CreateFile error/result contract,
read-only file attributes, sharing, parent-directory validation or native Win98
verification. These remain open rather than being implied by VFS success.

Verification: VFS 38/38, lazy/provider 47/47 and source-compiled public Win32/CRT
file API regression tests pass. No new browser or native Win98 run here.

## Public CreateFile operation results (2026-09-21)

CreateFileA/W now receive the handle and status from one host operation. The
host writes the handle directly into the calling thread's EAX slot and returns
the error/status code; there is no shared last-error latch. Removed the separate
GetFileAttributes existence probe and the helper that guessed FILE_NOT_FOUND
for every failed open. Existing internal handle-only callers retain their ABI.

VFS create results distinguish invalid dispositions (87), denied truncation
(5), protected media (19), handle exhaustion (4), existing CREATE_NEW (80),
missing OPEN_EXISTING/TRUNCATE_EXISTING (2), and existing-file success (183)
for CREATE_ALWAYS/OPEN_ALWAYS. Success otherwise retains the existing zero
last-error policy. Path validation, file attributes, sharing and native Win98
error precedence are not completed by this result transport.

VFS 38/38, lazy/provider 47/47 and source-compiled public file API tests pass;
the public matrix exercises both A and W with errors, recovery, success status
and stdcall cleanup. Legacy read tests pass. A separate codepage source test
fails its stale assertion for `global.set $eax`; AreFileApisANSI now stores into
register memory. That unrelated test was not changed. Full-build success is
not claimed (the earlier unrelated toy-VM bundle gate remains outstanding).

## File-codepage regression repaired (2026-09-21)

The stale `$eax` source assertion is replaced with execution of the actual
SetFileApisToOEM, SetFileApisToANSI and AreFileApisANSI handler bodies compiled
by WATX. Two instances have distinct register slots and private selector globals
but share the host VFS. Setting OEM in one and querying the other, then reversing
the direction for ANSI, verifies process-wide selection rather than stale local
state. Every call checks its four-byte stdcall cleanup. The existing CP1252 é
and euro, CP437 é, FindFirstFile output, and unaffected UTF-16 filename checks
remain. `node test/test-file-api-codepage.js` passes. This isolated handler test
does not claim a real Worker/RPC or native Win98 run.

## Mapping API permission checks (2026-09-21)

CreateFileMapping now requires read data access for read-only/copy-on-write
sections and both read and write data access for writable sections. Executable
protection forms additionally require execute access; these are compatibility
extensions, not a claim that Win98 supports those later flags. Unsupported base
protection values fail rather than being ignored. Section records retain write
and execute capabilities; MapViewOfFile rejects incompatible requests before
provider access or guest allocation. FILE_MAP_ALL_ACCESS requires a writable
section, and FILE_MAP_COPY does not grant shared writeback. Pagefile-backed
sections also retain their requested protection capabilities.

Reference: Microsoft's [CreateFileMapping protection table](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createfilemappinga).
VFS 39/39 includes file-right/section/view matrices, lazy denial without a
provider read or allocation, and executable forms; lazy/provider 47/47 passes.
This does **not** enforce guest CPU page permissions or finish public mapping
GetLastError, named-section handle rights/lifetime, SEC_* semantics, mapping
sizes/file extension, live-view coherence, or teardown. Those remain open.

## Section-size bounds (2026-09-21)

Section records now capture their maximum size at creation. MapViewOfFile
validates the requested range before allocating a guest view, and a zero view
length means the remaining section size, not the current backing file length.
Growing the file cannot silently grow an existing section. Pagefile-backed
views receive the same bounds checks. Zero-sized file sections fail at creation;
unsupported nonzero high size DWORDs cannot wrap into smaller sections.

Reference: Microsoft's [MapViewOfFile range contract](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile).
The regression failed before the fix and VFS now passes 40/40. File extension
during CreateFileMapping is still unimplemented, including async-provider
resizing: a requested section larger than its file now fails explicitly instead
of discarding the requested maximum. This remains a compatibility gap, not a
completed Win98 behavior. Allocation-granularity checks and mapping errors,
along with the prior lifetime/coherence limitations, remain open.

Lazy/provider regressions also pass 47/47 after this change.

## Mapping-driven file extension (2026-09-21)

The preceding oversized-section limitation is now addressed for writable
sections within the supported size range. Creation extends the backing file
without moving its shared seek cursor or replacing its entry identity. Existing
prefix bytes are retained; newly added bytes are zero-filled. Read-only and
copy-on-write sections still cannot extend the file.

Provider-backed files retain a lazy view of their original provider window plus
a zero tail. Extension itself neither fetches nor materializes the prefix.
The view supports synchronous cache reads, async fill and streaming readRange,
so crossing the old EOF, mapping the extended file, and later materializing it
preserve the same bytes. Repeated extension preserves the original offset.
Size and write-time notifications are issued after extension succeeds.

This follows the writable-extension requirement in Microsoft's
[CreateFileMapping documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createfilemappinga).
Zero filling is our defined backing behavior; Windows does not guarantee the
contents of the extended range. Native Win98 comparison, larger-than-32-bit
sections, alignment and the other mapping lifetime/error/coherence issues
remain open.

Verification for mapping-driven extension: VFS 40/40 and lazy/provider 48/48
pass, including empty/eager files, repeated lazy extensions, offset windows,
cross-EOF reads, mapped reads and full materialization. No browser benchmark
or native run was performed for this change.

## Mapped-view offset alignment (2026-09-21)

MapViewOfFile now rejects offsets that are not multiples of 64 KiB, matching
the allocation granularity returned by our GetSystemInfo implementation.
The check precedes data access and view allocation for eager, lazy and
pagefile-backed sections. View lengths need not be page aligned: a one-byte
view at offset 65536 succeeds and reads the correct byte.

The regression failed before the fix; VFS 41/41 and lazy/provider 48/48 pass.
This implements the offset rule in Microsoft's
[MapViewOfFile documentation](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile),
not a new native Win98 measurement. Public mapping errors, preferred placement,
returned-address alignment, lifetime and shared-view coherence still need
separate verification/work.

## Returned mapping-base alignment verified (2026-09-21)

The real guest allocator already aligns returned bases to 64 KiB, both in its
normal downward reservation and its fallback gap search. Added source-compiled
execution coverage to test-virtual-free-mapped-view: eight simultaneous views
with requested sizes around page and allocation-granularity boundaries, with
the final request forcing the gap path. Every base is aligned; page-rounded
ranges do not overlap; first/last-page sentinels survive peer allocations and
releases. Each view can be freed independently.

The enhanced test passes along with its existing mapped-view VirtualFree
rejection and ordinary-memory decommit checks. The embedded-WAT address gate
passes. No allocator change was needed. This closes the returned-base alignment
verification item for these exercised paths, not preferred-address placement,
concurrent reservation races or the broader section lifetime/coherence work.

## CreateFileMappingA operation errors (2026-09-21)

The public handler now receives status plus its EAX handle output from one
host call, without a shared error latch. It reports invalid/closed file handles
(6), missing data rights or read-only extension (5), invalid base protection or
unsupported high size (87), empty files (1006), protected media (19), and
existing named sections (183). New-section success clears stale status. Caught
host allocation failures report 8, and caught prefix-read failures report 30;
host resource behavior is not claimed to reproduce native disk-full conditions.
Handle zero is no longer accepted as the pagefile sentinel: only -1 selects it.

The old handle-only host import remains available to internal callers. Named
section lifetime/independent handles, CreateFileMappingW, MapViewOfFile errors,
SEC_* handling and native Win98 error precedence remain separate work.
VFS 41/41 and lazy/provider 48/48 pass; source-compiled public tests cover
creation errors, named status, recovery and stdcall cleanup. Import signature
generation records 254 imports; the handler ESP gate passes. No full browser
or native run, and no new full-build success, is claimed here.

## MapViewOfFile operation errors and retry status (2026-09-21)

MapViewOfFile and its Ex variant now use one operation-result import carrying
the calling guest thread ID, EAX output location and error/retry status. The
completion helper no longer asks fs_read_pending in a second RPC. Validation
reports invalid handles (6), denied section rights (5), unsupported/invalid
ranges or access (87), misaligned offsets (1132), and allocation failure (8).
Provider failures retain 30. Successful views preserve the caller's last error.
Internal lazy status 997 parks with the original stack frame and last error
intact; it is not exposed as a failed guest mapping. Ex fixed placement remains
unsupported and now explicitly reports 50 instead of leaving a stale error.

Alignment status is defined by Microsoft's
[system error list](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1000-1299-).
Native Win98 error precedence, named-section lifetime/rights, Unicode creation,
preferred placement and shared-view coherence remain open. The legacy
address-returning import and its thread-owner adapter remain available.

VFS 41/41 and lazy/provider 48/48 pass. Source-compiled public tests exercise
validation errors, success, lazy retry/resume and provider failure, including
stack cleanup. MapViewOfFileEx tests use the result ABI and check owner ID and
unsupported-placement error. Signature generation has 255 imports; handler
ESP validation passes. No new full-build/browser/native result is claimed.

## Integration gate checkpoint (2026-09-21)

The full build exposed a census false positive introduced by the generic-rights
work: GENERIC_EXECUTE numerically equals the exclusive end of THREAD_RPC.
Production and test code now name it as access-mask bit 29. Its value and
behavior are unchanged; no census exemption or baseline increase was added.
The pre-existing mapping fallback address remains separate technical debt.

VFS 41/41, lazy/provider 48/48 and source-compiled public file/mapping tests pass.
The build passes region safety, all five layout shake modes, test membership,
API/dispatch, ESP, silent-handler and 255-import signature gates, then fails
the toy-VM browser-bundle freshness gate for both browser bundles. Those source
changes belong to another agent; they were not regenerated or committed here.
This is not a full-build, browser, native Win98 or performance pass.

Next VFS priority is section identity/lifetime: independent named-section
handles, views surviving handle closure, and backing-file identity independent
of its path. Shared-view coherence, Unicode section creation, preferred-address
placement and native error-precedence checks remain open. The wider review
also retains common-core consolidation and silent-handler work; these VFS
checkpoints do not close the overall review.

## Section handle/view lifetime checkpoint (2026-09-21)

Named creation and OpenFileMapping now allocate distinct handles referencing
the same section object. CloseHandle retires only that alias and rejects a
second close; MapView rejects a retired alias. Views retain the section object
directly, so flushing or unmapping a writable view still writes back after its
originating section handle closes. Name lookup considers live handles and
views, and stops finding the object after both are gone. Recreating that name
then gets fresh backing. The reserved mapping-handle namespace does not wrap
into unrelated handles.

This follows Microsoft's documented independent handle/view references in
[CreateFileMapping](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-createfilemappingw).
It is not native Win98 verification. The new regression fails against the
previous committed implementation (one handle instead of three), then passes
with this change. VFS 42/42, lazy/provider 48/48 and source-compiled public
file/mapping tests pass, including public close/stale-map errors. The raw-region
ratchet passes unchanged. The FlushView test's obsolete mapping-import mock
was updated to the operation-result ABI, retaining retry-frame assertions and
rejecting a redundant pending-status RPC.

Still open: closing a handle during an unfinished provider map, backing-entry
identity across rename/replacement, mapping DuplicateHandle support and
OpenFileMapping desired-access/inheritance/error transport. Its legacy host
ABI currently accepts only a name. Shared-view coherence and native validation
precedence are not solved by this lifetime change. No new full-build or browser
pass is claimed; the prior toy-VM bundle freshness blocker remains separate.

## Section backing-entry identity checkpoint (2026-09-21)

A file-backed section now captures its backing entry at creation. MapView and
view writeback use that object, never a fresh lookup of its former path. The
path remains diagnostic metadata. Lazy writable sections use the same
materialization implementation as mounted files through an entry-based helper;
the path-based public method resolves once and delegates. This preserves the
existing provider-change guard and avoids materializing a replacement file.

The eager regression fails against the previous commit by reading replacement
byte 98 instead of original byte 65. It now covers rename, replacement, flush,
directory-entry removal, section-handle closure and final view writeback.
Lazy read-only and writable cases replace the path before mapping, remove it
while parked, then verify original bytes and untouched replacement data.

This does not implement Windows file-sharing restrictions on rename/delete,
fix ordinary file handles that still resolve paths, or establish shared-view
coherence. Closing a section handle during pending mapping remains open.
Those limitations are separate from retaining an already-created section's
backing object. Native Win98 behavior and browser performance are not measured.

Validation: VFS 43/43, lazy/provider 49/49, source-compiled public file/mapping
tests and FlushViewOfFile regression pass; region census and diff checks pass.
The full build was not rerun in this checkpoint.

## Parked mapping operation ownership (2026-09-21)

An accepted lazy MapView operation now retains its section independently of
the source handle until its caller consumes the completion. Its name remains
discoverable during loading even before a view exists. Closing the handle
prevents new calls but no longer strands the already-accepted operation's
completed allocation or hides a provider failure behind invalid-handle status.
Writable materialization retries also retain the original section.

Scheduler polls reuse the same pending record, and multiple fill requests
share its promise rather than allocating or fetching repeatedly. The operation
reference retires on completion consumption; subsequent calls on that closed
handle fail. This is an internal park/resume ownership rule, not a claim about
native Win98's ordering for concurrent CloseHandle and MapViewOfFile calls.

The new test covers read-only/writable success and provider failure, duplicate
poll/fill requests, close during loading, named reopening before completion,
rejection of a new call from another thread, and reference retirement.
VFS 43/43, lazy/provider 50/50 and source-compiled public file/mapping tests pass;
region census and diff checks pass. No full-build/browser/native run is claimed.

Thread-exit cancellation and stale completions across numeric thread-ID reuse
still need explicit retirement; operations whose owners never resume are not
covered by this checkpoint. Shared-view coherence, mapping access/duplication
and ordinary file-handle identity also remain open.

## Thread-exit mapping retirement (2026-09-21)

Pending mappings now register cleanup on their actual thread I/O state object.
releaseIoState retires unconsumed operations, removes their section-name/view
references and releases any allocated guest view exactly once. Provider reads
check retirement after awaiting bytes and before writing guest memory. Late
success or failure cannot publish into a replacement thread's state or touch
an allocation that has already been reused. The two numeric-keyed completion
collections are removed; result address/error live on the owned operation.

Once a result is consumed, its cleanup registration is removed: a returned
view belongs to the process and survives the creating thread's exit. Provider
fetches themselves are not aborted; writable materialization may still finish
populating its retained file entry, but does not publish an abandoned view.
The existing allocation-release helper is integrated as the shared dependency
for pending-map cancellation/failure; the other agent's unmap edits remain
outside this commit.

Tests cover exit before fill, during fill, after fill before retry, late failure,
numeric thread-ID reuse, untouched sentinel bytes in reused allocation storage,
single release, name retirement and returned-view survival. VFS 43/43,
lazy/provider 51/51, scheduler 50/50, public file/mapping tests and FlushView
regression pass; region ratchet passes. Main-process shutdown is not exercised
here. No full-build, browser or native Win98 pass is claimed.

## Mapping DuplicateHandle and per-handle rights (2026-09-21)

Mapping handles now hold access/inherit metadata separately from the shared
section. The public DuplicateHandle path recognizes that namespace and creates
a distinct alias, honors SAME_ACCESS and CLOSE_SOURCE (including failures),
rejects closed sources/invalid options, and can narrow rights without changing
the section or other handles. MapView enforces the selected handle's rights
before allocating/fetching; write access permits read views, and read access
permits COPY views without shared writeback.

The host bridge returns status separately from the handle through the caller's
register slot: mapping handles have the high bit set and cannot use the CRT
file-only import's positive-handle/negative-error convention. That old import
remains file-only. Tests exercise actual public WAT handlers, high-bit output,
independent lifetime, rights reduction, zero access, read/COPY/write views,
close-source success/failure, invalid options and stack cleanup.

Contracts consulted: Microsoft's
[DuplicateHandle](https://learn.microsoft.com/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)
and [mapping access rights](https://learn.microsoft.com/en-us/windows/win32/memory/file-mapping-security-and-access-rights).
This is not full NT security or native Win98 verification: generic-access
expansion, ACL-mediated elevation, cross-process duplication, null-target
legacy semantics and observable handle-inheritance APIs remain unsupported or
unverified. OpenFileMapping still has its old name-only host ABI and does not
yet carry desired access/inheritance/errors.

VFS 43/43, lazy/provider 51/51 and public file/mapping tests pass. Host signature
generation/check reports 256 imports; ESP, region census and diff gates pass.
No new full-build/browser result is claimed.

## OpenFileMapping A/W operation results (2026-09-21)

The public A/W handlers now share one stdcall implementation carrying desired
access, inheritance and name encoding to the host. Returned handles retain the
requested rights; zero-access handles cannot map data, read/COPY opens cannot
create shared writable views, and write opens permit read views. Missing names
report 2, null names/unsupported masks report 87, and allocation exhaustion
reports 4. Success preserves the caller's last error. The legacy name-only
host import remains available for internal callers.

W names are decoded directly rather than narrowed through atom scratch.
CreateFileMappingA and OpenFileMappingA now decode object names with CP1252,
independent of the process's ANSI/OEM filename mode, so their namespace agrees
with UTF-16 OpenFileMappingW for names containing euro and accented characters.

Consulted Microsoft's
[OpenFileMapping](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-openfilemappinga)
and mapping-access contract. Public source-compiled tests cover both encodings,
case-sensitive lookup, same-name aliases, rights, COPY normalization, stale-error
preservation, missing/null names, unsupported masks and exact stack cleanup.
VFS 43/43 and lazy/provider 51/51 pass; A/W, ESP, region and 257-import signature
gates pass. No full-build, browser or native Win98 pass is claimed.

Inheritance is retained as handle metadata, not yet validated through child
process creation or GetHandleInformation. Generic-access expansion, security
descriptors, shared cross-process namespace and native error precedence remain
open. CreateFileMappingW and shared-view coherence are separate follow-ups.

## Native Windows 98 oracle supersedes modern-doc assumptions (2026-09-21)

The new `tools/v86-reference/probes/file-mapping.c` ran successfully under the
repository's pinned native Windows 98/v86 profile. The source-only manifest is
`tools/v86-reference/mapping-apps.json`; the serial transcript and capture
provenance are committed under `test/fixtures/win98-file-mapping/`. No OS image,
probe executable or screenshot is committed. Reproduce with:

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/mapping-apps.json --app file-mapping \
  --serial-output /private/tmp/wa-file-mapping-native.serial \
  --output /private/tmp/wa-file-mapping-native.png \
  --metadata /private/tmp/wa-file-mapping-native.json
```

**These observations contradict parts of the preceding implementation/tests.**
Those earlier green tests verified our selected contract, not Win98 fidelity.

| Contract | Native Win98 observation | Current implementation gap |
|---|---|---|
| Granularity | 4096-byte pages, 65536-byte allocation granularity; offset 4096 fails with 87 | Correct rejection, wrong error 1132 |
| Section protection | WRITE view of READONLY/WRITECOPY fails with 87 | Reports 5 |
| COPY mode | Succeeds only on file-backed WRITECOPY in the exercised matrix | Accepts COPY on READONLY/READWRITE and pagefile sections |
| View identity/coherence | Two same-range views have the same address; writes immediately reach the peer for READWRITE and file WRITECOPY | Separately allocated copies; flush-time writeback is not coherence |
| Wide entry points | Both exports exist; CreateFileMappingW and OpenFileMappingW return NULL/error 120 | Open W is a compatibility extension; Create W is absent |
| Successful MapView | Preserves the sentinel last error 4660 | Matches |
| Successful CreateFileMapping | Clears last error to zero | Matches |

Microsoft's historical [KB125713](https://ftp.zx.net.nz/pub/Patches/ftp.microsoft.com/MISC/KB/en-us/125/713.HTM)
(original Microsoft article preserved on a mirror) distinguishes Win9x from NT
for COPY, shared addresses and namespace/lifetime behavior. The native probe
is the evidence for Win98 specifically; modern Microsoft API pages alone are
not sufficient to choose these details. No Wine source was used.

Next: pin the measured 54-case view matrix in a regression and correct COPY
validation/error codes, then implement native shared-view ownership/coherence.
Do not add a functioning CreateFileMappingW merely for A/W symmetry: that
would be an explicit compatibility extension, not the measured Win98 behavior.
Whether existing wide compatibility support remains available is a separate
policy choice; this checkpoint does not remove it.

Integration recheck: the full build passes region/owner/layout, A/W and exact
duplicate ratchets, test membership (1393), dispatch/API consistency, ESP,
silent-handler inventory (250 manual + 22 metadata), 257 host signatures and
browser cache identity, then fails on the two stale toy-VM browser bundles.
No full-build pass is claimed. The broader review still has common-core and
silent-handler work; this oracle is not completion of `fable-review.md`.

## Native validation/status matrix implemented (2026-09-21)

`test/test-win98-file-mapping-contract.js` reads the committed native transcript
and checks all 54 protection/backing/access/offset combinations, including
failure before allocation. It failed against the preceding implementation
(1132 versus native 87). Sections now retain their original page protection;
COPY mode requires a file-backed PAGE_WRITECOPY section, protection mismatches
and misaligned offsets report 87. ALL_ACCESS remains WRITE mode even though
its mask includes the COPY bit. Existing VFS/public tests were corrected rather
than retained as assertions of NT behavior. Valid COPY flush/unmap also checks
that the original file is unchanged.

All 54 native validation/status cases, VFS 43/43, lazy/provider 51/51 and
source-compiled public file/mapping regressions pass. Shared-view identity,
immediate coherence and the wide compatibility-extension policy remain open;
passing this matrix does not assert that those other native observations match.

## Native overlapping ranges and unmap lifetime (2026-09-21)

Extended the same native probe and refreshed both transcript and provenance.
The run reached `FILE_MAPPING_DONE`. A 128 KiB file-backed READWRITE section
was mapped as 16 bytes READ at offset zero, 128 KiB WRITE at offset zero,
and 16 bytes WRITE at offset 64 KiB, then its section handle was closed.

Observed on this Win98 profile:

- The small and large views return the same address; the tail returns that
  address plus 65536. All three queries identify the same allocation base.
- Before the larger map, VirtualQuery reports a 4096-byte committed READONLY
  region at the small view. Afterwards, it reports 131072 committed READWRITE
  bytes at the base. This is not evidence that the rest was initially committed;
  the initial query does not inspect the following region.
- Writing through the large view at offset 65536 is immediately visible through
  the tail view, without a flush.
- Both unmaps of the repeated base address succeed, preserving last error 4660.
  The queried base remains committed after the first; the tail remains committed
  after the second. Unmapping the tail succeeds and its address then queries as
  MEM_FREE (65536). Repeating that unmap fails with ERROR_INVALID_ADDRESS (487).

Implementation consequence: a single Map keyed by returned address cannot
represent these view references, and freeing on the first unmap is incorrect.
The next runtime change needs section-owned shared backing and counted view
references, with range growth preserving existing addresses and dirty bytes.
It must not eagerly materialize an entire large lazy file merely to share a
small view. Exact protection downgrade, disjoint-range commitment, alternative
unmap orders and cross-process behavior still need additional native probes.

This checkpoint changes the oracle only, not runtime ownership or permissions.

## Mapped-view bookkeeping exhaustion (2026-09-21)

Inspection for shared backing found another silent fallback: the mapped-view
registry helper drops registrations when full, but `guest_map_alloc` still
returned the allocation. VirtualFree could then treat those file bytes as
ordinary virtual memory and decommit them. The host allocation export now
checks registry capacity before reserving or committing any bytes and returns
zero on exhaustion (the mapping import reports allocation failure).

The source-compiled mapped-view test forces the registry to capacity and checks
both rejection and an unchanged reservation cursor. Before the fix it failed
with a nonzero returned address; afterwards it and the existing alignment,
gap reuse, refused mapped decommit/release, and ordinary decommit checks pass.
The 54-case native validation/status test also passes. This fixes resource-limit
behavior, not shared-view coherence, and does not claim a full browser build.
