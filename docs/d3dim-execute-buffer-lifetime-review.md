# ExecuteBuffer payload lifetime

2026-09-22. Ownership follow-up to the child QueryInterface review.

CreateExecuteBuffer allocates instruction storage and publishes its guest
pointer in DxObject.misc0. Lock returns that pointer. Unlock may additionally
allocate a decoded-cache block in the per-object cache table. Final Release
previously freed only that cache and retired the DX object; dx_free does not
free misc0, so every successfully allocated instruction buffer leaked.

The final-release path now clears and frees misc0 after clearing the cache,
before retiring the DX object. Nonfinal Release leaves both allocations
intact. The payload-null check preserves support for empty fixtures and
objects without allocated backing. No other interface's Release changes.

## Regression

`node test/test-d3dim-execute-buffer-lifetime.js` reproduced live heap count
76 instead of baseline 75 after final Release. It exercises eight public
creation/Lock/AddRef/Release cycles: four without a cache and four with a
cache allocated by public Unlock. It checks exact allocation counts, payload
size/pointer and every byte after nonfinal Release, cache-table retirement,
DX-object retirement, final heap balance, stdcall cleanup and stack guards.

All eight cycles now pass. The execute-buffer/light QueryInterface regression
also passes, including public Release of empty objects. Fragment, ESP and
epilogue, logical-operand, silent-stub, duplicate, test-tier, interface-spec
and generated-dispatch checks pass. Quiet remains 243 manual + 22 metadata;
exact duplicates remain 117 groups / 471 members.

The fixture calls creation with a null creator because the current handler
does not inspect it. These tests establish emulator-owned storage lifetime,
not native invalid-this or lock-state policy. Small buffers deliberately
isolate ownership from the separate sparse-memory execution audit.

## Remaining findings

- Creation's unchecked payload allocation and permanent-wrapper ordering
  are addressed in the allocation follow-up below.
- Creation silently substitutes 16 KiB for zero or greater-than-1-MiB sizes.
  Descriptor flags, caller-supplied storage, aggregation and invalid arguments
  require their own contract review; this patch does not certify them.
- Cache refresh and execution use plain g2w-plus-offset access across whole
  buffers. Their sparse-page behavior still needs coverage and correction.

No native Win98, real x86 indirect-call, browser-rendering or full-build
conformance claim follows from this focused lifetime test.

## Allocation follow-up

The new `test/test-d3dim-execute-buffer-oom.js` first reproduced S_OK when
payload allocation was forced to fail. Creation now clears a non-null output,
allocates the payload before the permanent COM wrapper, returns E_OUTOFMEMORY
on payload failure, and frees that payload if wrapper allocation fails. The
existing wrapper-failure E_FAIL result is preserved. Output publication occurs
only after both allocations succeed and the object owns the payload.

Microsoft's [SDK ddraw.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/ddraw.h)
defines DDERR_OUTOFMEMORY as E_OUTOFMEMORY. This supports the memory-error
constant; it is not a native measurement of CreateExecuteBuffer's failure
precedence or invalid-argument behavior. No Wine implementation is used.

Fault injection replaces exactly two allocation call sites in an in-memory
test compilation; production has no failure switches. Sixteen failure/retry
cycles cover payload and wrapper failures, alternating a descriptor whose
size field crosses nonaffine pages with a crossing output pointer. Assertions
cover HRESULT, cleared output, unchanged descriptor, balanced live heap and
DX counts, no wrapper attempt after payload failure, successful retry, public
Lock size/pointer/final-byte access, public Release cleanup and stdcall guards.

All sixteen fault/retry cycles and the eight cached/uncached lifetime cycles
pass. The same scoped static checks, interface specification and dispatch
freshness checks pass; quiet and duplicate inventories are unchanged.

The existing zero/oversize substitution, descriptor flags, null inputs,
aggregation and creator ownership remain separate policy work. This patch
does not add an unverified zero-initialization guarantee for buffer contents.
