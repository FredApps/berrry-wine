# SHRegGetUSValueA implementation — 2026-09-22

The constant ERROR_FILE_NOT_FOUND handler is replaced by registry lookup and
default-data behavior checked against the [native Win98 fixture](shreg-get-us-value-native.md).

- HKCU is attempted first unless the ignore flag is nonzero; failed queries
  fall through to HKLM, including ERROR_MORE_DATA. Each query gets the original
  caller capacity, not the previous query's required size.
- A nonempty default is copied only when it fits that original capacity.
  Otherwise the lookup error and metadata remain visible. Successful default
  copying updates size without inventing a new type.
- An opened key with a missing value writes type zero; a missing key leaves
  type untouched. The 22 native cases also retain LastError exactly.
- Every opened registry handle is closed. Owned copies of path/value names,
  query metadata and payload buffers are freed before returning. The handler
  retains its eight-argument, 36-byte stdcall cleanup.

## Guest memory boundary

The existing registry host imports assume contiguous memory, including scalar
output pointers. This implementation does not hand them sparse caller memory.
`guest_strdup` owns contiguous path/value strings. A small owned metadata block
receives type/size, and a size-only host query determines the payload allocation.
If it fits, a second synchronous host query fills that owned payload. No guest
callback or yield occurs between those reads. `guest_memmove` then writes the
caller buffer; scalar outputs use `gs32`. Default copying also uses
`guest_memmove`, including its overlap-aware and non-affine paths.

Allocation follows the required data size, not arbitrary caller capacity.
This avoids both a 16-KiB scratch limit and a huge allocation when a caller
advertises 0xffffffff bytes for a small value. It does not change the memory
contract of other registry front doors; their sparse-buffer audit remains
separate work.

## Verification

`test-shreg-us-value.js` fails against the old stub and passes after the change:
all 22 native observations match through real API-name lookup and generated
dispatch, once with heap buffers and once with deliberately non-adjacent
backing pages. The sparse cases split path, value, type, data, size, default
and argument-stack pointers across page boundaries. Return code, complete
16-byte output, type, size, LastError, ESP and caller-stack sentinel agree.

Additional transport checks copy a 70,000-byte binary value across many
non-affine pages with both exact capacity and 0xffffffff capacity, preserving
the trailing guard. These are emulator memory-boundary tests, not additional
native observations.

The earlier eight-argument ABI test, RegQueryValueEx/SHQueryValueEx A/W suite,
native-fixture integrity/six negative controls, fragment/ESP/epilogue checks,
duplication ratchet and tier placement pass. Quiet handlers decrease from
248 to 247 (22 metadata stubs unchanged). An in-memory transform restoring
only the old handler reproduces the prior 248-count digest exactly; no
classifier or allowance changed. No full-release, browser or performance
verification is claimed.

## Evidence limits

This covers the measured valid-pointer registry/default paths, not every
Win98 registry failure. Missing-HKLM-key after a present-but-oversized HKCU
value, access-denied keys, registry types beyond the fixture's REG_BINARY,
NULL output with default data and malformed/aliased output pointers still
need native coverage. Existing host registry representation limits are not
removed here. NULL path/size is defensively rejected with 87; allocation
failure returns 8, but neither path is a native-oracle claim and allocation
failure injection was not run. The paired host reads are synchronous today;
an asynchronous registry backend would require revisiting this ownership
and snapshot assumption.
