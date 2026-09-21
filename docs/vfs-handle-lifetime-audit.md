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
