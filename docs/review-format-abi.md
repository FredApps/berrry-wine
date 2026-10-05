# Review P5-3: remaining encoded front doors

2026-09-19: the three remaining A/W census entries do not represent three
duplicated implementations. Leave the baseline honest rather than adding
indirection just to make its count zero.

- `GetCommandLineA/W` return separately cached byte/UTF-16 buffers.
  Their guarded builders live in `src/10-helpers.wat`; the ANSI handler no
  longer allocates on each call. `test-command-line-a-stability.js` covers
  repeated pointer identity, allocation stability, quoted executable names,
  raw arguments, CRT argv and the exported `_acmdln` cell.
- `wsprintfA/W` and `wvsprintfA/W` already reach the single `$format_core`
  through encoding-specific policy wrappers in `src/12-wsprintf.wat`.
  CRT policy remains distinct. The wrappers are not duplicate format engines.

## Coverage added

`test/test-format-frontdoors.js` now executes all four User32 handlers. It
seeds ESP+12 and the explicit va_list with different, valid argument pairs,
so using the wrong source cannot coincidentally pass. The matrix checks
ANSI e-acute and UTF-16 Omega output bytes, character counts excluding NUL,
terminator width, prefix/suffix guards, and ESP cleanup (4 for cdecl,
16 for the three-argument stdcall entries).

The normal matrix passes. An in-memory negative mutation making
`wvsprintfW` read ESP+12 fails its result check (15 instead of 10).
Local logs: `/private/tmp/wa-format-abi.log` and
`/private/tmp/wa-format-abi-negative.log`. The existing command-line stability
regression also passes (`/private/tmp/wa-format-commandline.log`). No runtime
or census changes.

Microsoft documents the cdecl and encoding rules in
[wsprintfA](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-wsprintfa),
and the explicit argument-list and character-count rules in
[wvsprintfW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-wvsprintfw).
These current references are not a fresh native Win98 measurement.

## Still open

The User32 output ceiling remains unimplemented: the pre-existing test
explicitly preserves the emulator's 1,100-character output instead of
pretending it proves native overflow behavior. Microsoft documents a
1,024-byte maximum, but the exact legacy boundary/truncation behavior needs
a native probe before changing it. This audit does not close that issue or
claim complete formatting conformance.
