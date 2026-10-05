# Volume buffer bounds and output ordering — 2026-09-22

The [native Win98 fixture](../test/fixtures/win98-volume-buffers/README.md)
established that rejecting a short buffer is not a transaction over the whole
call: scalar outputs precede filesystem output, which precedes label output.
Each string itself is all-or-nothing. Truncation plus TRUE was incorrect.

## Runtime change

`volume_information` reads its tail arguments through guest accessors, fills
serial/component-length/flags, checks filesystem capacity including NUL,
copies that string, then requests a full label copy. A short string returns
FALSE/error 111 without touching that string; earlier outputs remain written.
NULL string pointers skip the corresponding capacity check. An empty label
still needs one character. The represented FAT volume uses component length
255 and flags 0x4006; represented CDFS uses 221 and 0x4000, matching the captured
volumes. The existing VFS-derived serial and fallback policy remain unchanged.
Successful empty FAT-label queries leave error 2; a NULL label skips this.

The label host bridge now accepts a guest output pointer, rejects insufficient
capacity before writing, and translates each output byte. WAT filesystem-name
writes use guest byte/word accessors. This avoids assuming adjacent guest pages
have adjacent physical backing. Its four-i32 import signature is unchanged;
the one WAT caller and ABI comment are updated together. The ISO test's manual
host context now binds the instantiated exports, as real hosts do, so the host
can translate against that instance's image base and page map.

## Explicit Unicode policy

Native Win98 returns error 120 from GetVolumeInformationW. The project already
supports Unicode callers as an extension; this change retains that extension
and gives it the same bounds/order safeguards. It does **not** claim native W
compatibility. The test names distinguish 42 native ANSI observations from
42 extension cases rather than comparing W against a fabricated native oracle.

## Verification

`test-volume-native-replay.js` supplies controlled FAT/CDFS VFS labels, types
and captured serials. It replays all 42 ANSI rows, checking result, LastError,
all scalars, entire 164-byte guarded output blocks, and ESP. The same cases
exercise the Unicode extension in UTF-16. Three pairs of adjacent guest pages
with deliberately noncontiguous backing cover both strings and the argument
frame, including an unaligned DWORD split across pages.

A compiler-only negative control restores HEAD's old volume implementation:
the first zero-capacity label case returns TRUE rather than FALSE, failing the
replay. It changes no source or shipped artifact. The 24 ISO tests and the
SetVolumeLabelA behavior test pass after replacing the old truncation assertion
with error 111 and complete-buffer preservation.

All 252 generated test exports pass 1,008 ABI calls. Metadata/generation,
append-only API IDs, fragment balance, logical operands, handler ESP,
silent-stub inventory (249 manual + 22 metadata), test tiers and whitespace
checks pass in the shared worktree.

## Limits

This models the current FAT/CDFS volume types, not arbitrary filesystem or
per-media capability metadata. The old zero-serial-as-no-mount convention and
fallback serial remain; invalid/unready drives and malformed/unreadable root
pointers are not newly modeled. Root-path host parsing is still a bounded
linear-memory read. There is no fault-injected invalid-output-pointer test or
claim of PAGE permission enforcement. Unicode support is deliberately broader
than Win98. No browser/game sweep, timing benchmark or full release is claimed.
