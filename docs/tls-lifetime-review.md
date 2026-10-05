# Native-targeted TLS allocation and release — 2026-09-22

The [native Win98 fixture](../test/fixtures/win98-tls-lifetime/README.md)
exposed five runtime differences: 64 rather than 80 slots, no reusable indices,
no cross-thread clearing, successful double-free, and incorrect LastError on
Set/Free/exhaustion. This change implements the measured API sequence.

## Ownership and synchronization

The existing 64-byte `TLS_NEXT_INDEX_SHARED` region now contains a high-water
mark at +0, a lock at +4, the registered-vector list head at +8 and three bitmap
words at +12/+16/+20. No region size or address changes. `TLS_SLOT_COUNT` is the
single production capacity constant; vector size is derived from it.

Allocation claims an unused bit, clearing its slot in registered vectors
before publication. Release rejects an unset bit, clears all registered
vectors, then makes the bit reusable. The lock also protects registration and
API value accesses. No allocation or host call occurs while holding it.
Clearing writes the vector itself: direct guest FS:[0x2c] reads see the reset,
not only calls through TlsGetValue. Application-owned pointed-to memory is
never released by TlsFree.

High-water metadata is retained for existing spawn protocols, but is not an
allocation cursor: stale snapshots cannot resurrect freed holes. Raising the
minimum reserves only the previously unpublished suffix. The loader's static
PE TLS allocation uses the same reservation helper and retains its template
and zero-fill behavior. Main and both Worker/cooperative setup paths now ask
WAT for a zeroed, registered 80-slot vector instead of allocating private
256-byte vectors in three places. Allocation failure is surfaced rather than
publishing a NULL TLS vector.

## Verification

- `test-tls-lifetime.js`: all **108 native API observations** (excluding three
  OS/version/count metadata rows), including LastError and raw main/peer vector
  reset. Also stale spawn metadata, a later-created instance, and a synthetic
  static TLS directory in a real PE: template bytes, zero fill, FS pointer and
  reservation survive dynamic index free/reuse.
- `test-tls-shared-workers.js`: four actual Node Workers, each with its own
  WASM instance, reserve 20 indices concurrently in each of two rounds.
  **160 reservations** cover uniqueness, full-capacity failure, reuse and
  clearing every raw Worker slot from the parent instance.
- `test-process-id.js`: updated to native capacity 80 while retaining shared
  reservation, stale metadata, invalid index, value isolation and ESP checks.
- `test-worker-sparse-thread-stack.js`: actual guest-Worker initialization
  registers a sparse TLS vector, whose slot 79 is cleared by another instance.
- `test-thread-manager-sparse-stack.js`: cooperative setup delegates TLS
  allocation and uses the correct existing 0x34-byte TIB. Its stale fake host
  now supplies the Win9x process-database fields already used by production.

A compiler-only negative control replacing `tls_clear_index` with an empty
body fails the raw main-vector assertion immediately after Free (the old
value `0x11223344` remains). It changes neither source nor a shipped artifact.
The memory-map check passes with 211 regions and no layout change. Generated
API/metadata, fragment balance, logical operands, handler ESP, silent-stub,
test-tier and whitespace gates also pass; the generated-wrapper inventory is
238 with 22 manual adapters remaining. Worker metadata-refresh coverage passes.

## Limits / remaining work

Per-thread TLS vector storage was already retained until process disposal;
this change retains that lifetime and adds an eight-byte registry node per
instance. Thread-exit reclamation is **not** implemented here. The new registry
must be unlinked under the TLS lock before anyone introduces vector freeing.
Hard termination while holding a process lock remains a broader Worker
lifecycle concern; this test does not force termination inside the critical
section. Racing guest writes made directly to TLS memory are not intercepted.

This is not full static-TLS/DLL thread-attach conformance: the test verifies the
existing PE-template load path, not per-DLL template cloning into new threads.
The allocation-failure branches are defensive and not fault-injected here.
No browser game sweep, performance benchmark or full clean release is claimed;
tests run against the shared worktree.
