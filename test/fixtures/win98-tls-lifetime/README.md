# Native Win98 TLS lifetime observations — 2026-09-22

Captured with the existing v86 native Windows 98 reference, not Wine source
or an emulator implementation of Win32 APIs:

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/tls-apps.json --app tls-lifetime \
  --output /private/tmp/wa-tls-native-final.png \
  --metadata /private/tmp/wa-tls-native-final.json \
  --serial-output /private/tmp/wa-tls-native-final.serial.txt
```

`capture.json` records OS asset locations, v86 version and probe-executable
hash. The source is `tools/v86-reference/probes/tls-lifetime.c`. No OS image,
probe binary or screenshot is committed; the metadata's PNG path is temporary.
`serial.txt` preserves observations with CRLF normalized to LF. GetVersion
reports 4.10; these are measurements of this reference image, not a claim
about every Windows build.

A second fresh VM run of the final probe produced byte-identical serial output
and the same probe hash. Fixture integrity and its four negative controls,
test-tier discovery and whitespace checks passed.

## Results that change the implementation plan

- **80 indices (0..79)** allocate, then TlsAlloc returns UINT_MAX and error
  259. Index 64 is valid; the current emulator's 64-slot boundary is wrong
  for this target. Get/Set at 80 and Get at 81/UINT_MAX fail with error 87.
- Freeing allocated index 40 succeeds and **clears both existing threads'
  values immediately**, before reallocation. Freeing it again fails with 87.
- The main thread then reallocates index 40 with zero values in both threads.
  Free/reallocation by the worker also leaves both threads' values zero.
- Successful Alloc/Set/Free preserve the supplied LastError 4660. Successful
  Get clears it to zero, even when the value is zero.
- The two threads initially hold different nonzero values in the same index,
  proving the zeroing observation is not just untouched worker storage.

Microsoft's [TlsFree contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-tlsfree)
requires index reuse, and [TlsAlloc](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-tlsalloc)
specifies initially zero slots. The fixture supplies target-specific bounds,
error behavior and existing-thread observations beyond those broad contracts.

## Runtime follow-up

At capture time the implementation used a monotonic 64-index cursor, 256-byte vectors,
and an in-range TlsFree success return without release. A complete fix must:

1. Give the process a shared reusable allocator with correct double-free and
   exhaustion results, preserving reservation uniqueness across instances.
2. Provide 80 slots in main/worker/cooperative-thread vectors and loader setup;
   update existing tests that incorrectly assert index 64 must fail.
3. Clear the released slot across existing threads, including native guest
   reads of TLS storage, without freeing application-owned pointed-to data.
4. Preserve error behavior, static PE TLS reservations and worker spawn state.
5. Replay this sequence against the implementation and cover real concurrent
   allocation, free/reuse and thread birth/exit transitions.

`test-tls-native-fixture.js` validates the captured oracle and catches truncated,
missing, duplicate or altered observations. It does **not** exercise or certify
the emulator. This probe does not establish allocation order with multiple
holes, races with active SetValue calls, static TLS interactions, or allocation
failure under memory pressure. Those still need tests/native observations.

The subsequent [runtime implementation and verification](../../../docs/tls-lifetime-review.md)
replay the native sequence, add reusable allocation and register 80-slot
vectors across thread backends. That report distinguishes passing lifecycle
checks from remaining thread-exit reclamation and DLL static-TLS work.
