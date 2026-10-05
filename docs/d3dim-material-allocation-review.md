# Material lazy-allocation failure

2026-09-22. False-success and ownership follow-up.

SetMaterial lazily allocated 80 bytes, but did not check a zero return before
publishing the pointer, clearing/copying storage, updating the stored size
and returning S_OK. The new fault-injection regression reproduced S_OK on
allocation failure through public material dispatch.

The shared core now returns E_OUTOFMEMORY immediately when that allocation
fails, before publishing or touching storage. No object state or reference
is acquired on failure. Existing payloads still update without allocating.
The change applies to all three material SetMaterial entrypoints without
altering their separate ABI handlers or size/null-input policy.

## Verification

`test/test-d3dim-material-oom.js` replaces only the unique 80-byte allocation
call inside d3dim_material_set in an in-memory test compilation. Production
code contains no failure switches. Twelve failure/retry sequences exercise
all three public API entries. Assertions cover HRESULT, one attempted
allocation, unchanged payload pointer/stored size/refcount/live heap count,
unchanged null-sentinel bytes, subsequent successful allocation, reuse while
allocation failure remains armed, byte-exact readback, final public Release
restoring the heap count, and stdcall cleanup/guards.

All twelve fault/retry cases pass. The material sparse-copy/public-release
regression and scoped fragment, ESP, logical-operand, quiet, duplicate and
test-tier gates also pass. Quiet stays 243 manual + 22 metadata; duplicates
stay 119 groups / 476 members.

These are forced-failure ownership tests, not native Win98 error-precedence
or physical-memory-pressure measurements. The fixture constructs a material
object directly; it does not validate CreateMaterial's returned vtable or
aggregation policy. Invalid non-null input pointers, existing size clamps
and failed-allocation GetMaterial defaults remain separate questions.
