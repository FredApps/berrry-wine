# SHRegGetUSValueA native observations — 2026-09-22

Two fresh v86 Windows 98 runs of the expanded 22-case probe have byte-identical
serial output, including successful cleanup. `GetVersion` reports `c0000a04`.
The fixture retains LF-normalized serial logs, parsed observations and capture
metadata (VM sources/version, payload hash and capture time). Source and
normalized-serial hashes were added when packaging the fixture; the cached
probe executable matches both capture payload hashes. No executable, disk or
screenshot is redistributed. The console/registry serial output is the oracle,
not the desktop screenshot.

The initial 16-case probe also matched across two fresh runs. Six extra cases
then distinguished use of original buffer capacity from the required size
written by a failed registry query. Only the expanded captures are retained.

## Measured behavior

| Case | Native result |
| --- | --- |
| Value in both HKCU and HKLM | HKCU data wins. |
| Ignore-HKCU equals 1 or 2 | HKLM data wins. |
| Value absent from HKCU, present in HKLM | HKLM succeeds. |
| NULL value name | Queries the unnamed value. |
| NULL output, no default | Returns type and required size without copying. |
| HKCU needs 8 bytes, HKLM needs 4, caller capacity 4 | HKLM succeeds, including when a default was supplied. |
| HKCU needs 8, HKLM needs 6, caller capacity 4 | ERROR_MORE_DATA (234), size 6, no bytes written. |
| Same case, default length 4 | Success, default copied, size 4, type remains REG_BINARY. |
| HKCU needs 8, HKLM value absent, caller capacity 4 | ERROR_FILE_NOT_FOUND (2), type 0, size 4, no bytes written. |
| Same case, default length 4 | Success, default copied, type 0, size 4. |
| Both values need 4, capacity 2, default length 4 | Error 234, size 4, no default copied. |
| Same case, default length 1 | Success, one default byte copied, size 1. |
| Missing value in existing keys | Error 2, type becomes 0; caller size remains unchanged. |
| Missing key | Error 2; caller type and size remain unchanged. |
| Missing key, default length 4, capacity 0 or 2 | Error 2; type, size and bytes remain unchanged. |
| Missing key, default length 4, capacity 4 or 16 | Success; four default bytes copied, size 4, caller type preserved. |

LastError remains the input sentinel in all 22 cases. Bytes beyond the returned
payload remain sentinel-filled. HKLM fallback demonstrably uses the **original
caller capacity**, not HKCU's returned required size. A fitting default also
uses that original capacity; it can replace a short-buffer error, not only a
missing-key error. These statements describe the tested cases, not every
possible registry failure or malformed argument.

## Verification and limits

`test-shreg-us-native-fixture.js` validates all 22 observations, independent
capture timestamps, identical executable payloads, source and serial hashes,
required manifest companion-file metadata, and six corrupt-fixture controls.
The first actual capture attempt found that `capture.js --list` had not caught
a missing `files` array. The manifest now explicitly supplies `files: []`;
no registry/runtime implementation was changed by this evidence commit.

The probe does not exercise NULL output with default data, NULL type/size
pointers, access-denied keys, REG_SZ expansion or non-ASCII encodings. Native
DLL-specific version attribution is not recorded beyond the reference VM
provenance. It would be incorrect to claim full API conformance from this set.

Next: implement lookup/default semantics using the existing registry host
operations, preserve original capacity between attempts, use guest-aware
copying for sparse buffers, and compare actual name/generated dispatch to
`observations.json`. The ABI regression already checks the eight-argument
36-byte stdcall cleanup. The runtime still returns a constant missing-key
error at the capture checkpoint. The subsequent
[implementation](shreg-get-us-value-implementation.md) now passes this fixture
on both contiguous and non-affine sparse caller memory.

Separate audit lead: `win16_dde_deliver`'s transaction branch (in
`09f-win16-ddeml.wat`, near the `win16_dde_ask_push_data` call) uses `select`
around `win16_dde_data_take`, which marks a data slot used. Trace ownership
and add a reproducer before changing it; this capture work did not fix or
verify that suspected leak.
