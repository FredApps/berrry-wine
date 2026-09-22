# Window-title replacement ownership — 2026-09-22

The remaining string-copy audit found that `title_table_set` freed the old
title before allocating/copying its replacement. If allocation failed, the
slot still retained the freed pointer and old length. Input aliasing the
current title could also be read after release.

The helper now allocates and copies before releasing old storage. Allocation
failure leaves pointer, length and contents untouched. NULL or zero-length
input still clears and releases the slot without allocating. The existing
255-byte cap is unchanged; it is not established here as native Win98 behavior.

This remains a counted WASM-address copy, not `guest_strdup`: callers supply
a linear-memory address and explicit length, potentially without a trailing
NUL. Substituting the guest-address, NUL-scanning helper would change the contract.

`test/test-title-table-lifetime.js` uses the real helper and allocator, with
a compiler-only failure hook on this helper's allocation and a release counter
that forwards to the real free routine. Before the fix it fails because a
failed replacement releases the old title. After the fix it verifies retained
ownership on failure, independent caller storage, whole/interior aliases,
terminators, the existing cap, unknown-window handling and repeated clearing.

Verification passed: title lifetime, FindWindowA/W/ExA, MenuHelp/status-pane
behavior, fragment balance, logical operands, handler stack cleanup, test-tier
discovery and whitespace. These ran in the shared worktree, not a clean build.

This is an internal ownership regression, not a native Win98 OOM measurement.
Public SetWindowText failure reporting, the title cap, guest-page boundaries,
concurrent mutation and browser rendering remain outside this change.
