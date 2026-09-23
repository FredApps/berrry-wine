# Material structures across sparse guest pages

2026-09-22. Shared implementation and guest-memory correctness follow-up.

## Reproducer and fix

Legacy material Set/Get and device-7 material Set/Get translated a guest
pointer once and copied or filled the entire structure through it. When
guest pages have nonadjacent WASM backing, bytes after the boundary land in
the wrong storage. The new regression first failed on empty legacy-material
readback: all fields after dwSize retained the caller's sentinel pattern.

The four shared helpers now delegate copy/fill to guest_memmove and
guest_memset. Legacy GetMaterial writes dwSize through gs32, including when
the DWORD itself crosses pages. No additional structure-copy implementation
or temporary span ownership is introduced. The legacy counted material
format stays separate from device-7's fixed 68-byte material format.

## Coverage

`test/test-d3dim-material-sparse.js` invokes all three legacy material
versions plus device 7 through public API dispatch. Sixteen Set/Get cases
cross contiguous and nonaffine sparse input/output independently, checking
every copied byte and input preservation. Four empty-state readbacks check
the fill branches. Sparse buffers start two bytes before a page boundary;
guard bytes surround outputs, and unrelated backing pages have canaries.
Every call checks stdcall cleanup and its stack guard.

All sixteen round trips and four empty fills pass. The existing material
QI regression and indexed vertex-buffer draw regression (961 pixels) also
pass. Fragment, ESP, logical-operand, quiet, duplicate and test-tier checks
pass; quiet remains 243 manual + 22 metadata, duplicates 119 groups / 476
members.

The fixture creates its own objects/state. Device-7 state is explicitly freed
by fixture cleanup; material payloads now use public Release as described
below. It does not validate create-method policy, material allocation failures,
or native generation availability. The legacy setter's unchecked lazy
allocation still needs a separate regression. Existing size clamps, null-input
results and missing-state behavior are unchanged, not newly certified.

No native Win98, browser gameplay, full-build or performance result is implied
by these focused guest-memory tests.

## Public material Release follow-up

All three versions previously aliased dx_com_release_basic, which retired
the object but did not free its private material data. A public-release
regression reproduced one live heap allocation left behind. They now share
one canonical material Release handler and a payload-aware core: only a
final reference frees and clears misc0, then the generic refcount/object
retirement core completes the release. Other object families keep their
existing handlers.

The test now uses public AddRef/Release for materials 1/2/3, checks that
non-final release preserves allocation count and readable bytes, and checks
that final release restores the heap baseline. Empty material objects are
also released through each public entrypoint. Eight-byte stdcall cleanup
and stack guards are checked. Device-7 fixture cleanup is explicitly separate.
This does not certify concurrent reference operations, double-Release of a
dead interface, or references held by other API objects.

Result: populated and empty public-release cases pass on all three versions,
as do material QI, interface-spec and scoped gates. The duplicate and quiet
counts remain unchanged; generated dispatch freshness also passes.
