# Clipboard owning string copies — 2026-09-22

Pass-5 #5's remaining string-copy audit found a private implementation in
`clipboard_store_rtf_data`. It measured with the 65,536-byte-capped
`guest_strlen`, then copied the measured length plus one with a raw linear
memory copy. Longer RTF was truncated and could lose its terminator; a caller
string crossing noncontiguous sparse pages was read from the wrong backing.

The helper now calls `guest_strdup`, which already sizes the complete string
and copies with guest-aware accesses. Length is measured on the new contiguous
heap-owned copy, not by translating caller memory once. Allocation/copy occurs
before freeing the previous clipboard buffer, including when the source is
that buffer or a suffix of it. NULL input still fails without changing data;
allocation failure now also leaves the previous snapshot intact.

This intentionally replaces the old reusable-capacity policy with a fresh
owned allocation per explicit RTF store. The previous allocation is freed on
successful replacement; this is not a snapshot leak. Basic RTF synthesis still
uses its existing capacity management. No throughput benefit is claimed and
OOM failure injection has not been performed.

## Verification

The old implementation failed the new 70,000-byte content/terminator check.
`test-clipboard-rtf-api.js` covers 65,535/65,536/65,537/70,000-byte content and
reported lengths, source independence, self-copy, overlapping suffix input,
NULL preservation, and a string spanning two adjacent guest pages with
nonadjacent backing. The sparse fixture explicitly verifies that mapping
condition. Existing registration, format availability, binary-format and
EmptyClipboard checks remain in the same test.

All 36 checks pass after the change, as do `test-crt-strdup.js` and
`test-ole-clipboard-lifetime.js`. A compiler-only transform restoring just the
old RTF helper fails five checks: long-length reporting, 70,000-byte content,
and both sparse-copy assertions (31/36). It does not modify shared source or
build artifacts. Fragment, logical-AND, handler-ESP, silent-inventory, tier and
whitespace checks pass; the quiet inventory remains 248 manual + 22 metadata.

## Remaining scope

This is the internal NUL-terminated RTF snapshot path, not a redesign of
SetClipboardData's general HGLOBAL transfer contract, embedded-NUL registered
formats, delayed rendering, arbitrary invalid pointers, or native Win98 OOM
semantics. No browser, game-performance or full clipboard conformance claim.

The broader scan also found capacity-managed control buffers, encoded strings,
counted slices, PIDL records and joined paths. They are not interchangeable
with whole ANSI NUL-terminated duplication and were not mechanically rewritten.
The public text path was subsequently reviewed below; the binary-copy path
still needs separate review. This does not close all of Pass-5 #5.

## Public SetClipboardData text path

The CF_TEXT/CF_OEMTEXT branch had the same capped length and raw linear copy.
It now duplicates through `guest_strdup` before freeing the old snapshot,
records the full length from the contiguous owned copy, and clears RichEdit
format state only after allocation succeeds. Return value (the caller's
handle), 12-byte stdcall cleanup, transaction guards and one sequence bump
per successful call are preserved. NULL keeps the existing failure behavior;
it is **not** an implementation of delayed rendering.

Like the RTF change, this uses a fresh allocation per store and frees the old
buffer on success. Allocation failure leaves the old data/format state intact;
OOM injection and performance measurements have not been performed.

`test/test-clipboard-text-copy.js` calls the actual public handler and checks
both text formats at 1/65,535/65,536/65,537/70,000 bytes, exact bytes and NUL,
length, return value, ESP and sequence. It also covers explicitly noncontiguous
sparse backing, internal self/suffix-copy robustness, and NULL/closed-state
preservation. The pre-fix handler fails at 65,537 bytes (reported 65,536).
ASCII-only OEM cases do not certify code-page conversion. Alias cases test
internal copy safety, not valid Windows HGLOBAL transfer patterns.

The new text test, existing open-state and cross-Worker sequence tests,
RTF suite (36/36) and OLE lifetime test all pass. Fragment, handler-ESP,
logical-AND, silent-inventory, tier and whitespace checks pass. The inventory
remains 248 manual + 22 metadata; no full release build or browser run was
performed for this change.

[Microsoft's SetClipboardData contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata)
describes ownership transfer, movable global allocations, delayed rendering
and format conversion. Our current snapshot implementation is not that full
contract; this correction does not claim otherwise or establish native Win98
OOM behavior. Unsupported-format inert success, binary sparse copies,
Unicode/OEM conversion, empty-string format availability and general HGLOBAL
lifetime handling remain candidates for separate behavioral work.
