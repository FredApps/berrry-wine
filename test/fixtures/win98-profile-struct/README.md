# Native Windows 98 profile structure observations

Captured on 2026-09-22 using the existing v86 reference harness, not Wine:

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/profile-apps.json --app profile-struct \
  --output /private/tmp/wa-profile-struct.png \
  --metadata /private/tmp/wa-profile-struct.json \
  --serial-output /private/tmp/wa-profile-struct.serial.txt
```

`capture.json` retains runtime, asset and probe-executable provenance. The PNG
path in that metadata is a temporary capture artifact, not a committed fixture;
the serial output is the behavioral oracle. No OS image or executable is included.
The source is `tools/v86-reference/probes/profile-struct.c`.

Microsoft documents a checksum on stored structures but not its encoding or
failure-buffer ordering:
[GetPrivateProfileStructA](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getprivateprofilestructa),
[WritePrivateProfileStructA](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-writeprivateprofilestructa).

Five native writes (sizes 0..4) show two hex characters per data byte followed
by an eight-bit additive checksum. The 203 read observations establish:

- The encoded length must be exactly `2 * size + 2`; wrong lengths and missing
  entries leave the output untouched.
- A checksum mismatch returns FALSE **after** publishing decoded data bytes.
- A zero-byte structure with checksum `00` succeeds without writing output.
- Matching quotes are stripped, and lowercase hexadecimal works.
- Every printable non-space ASCII character was tried in both nibble positions.
  Decimal digits map normally; all others match `(character - 55) & 15`.
  Consequently `G` maps to zero, rather than causing strict-hex rejection.
- LastError stays at the supplied 4660 in these cases, whether TRUE or FALSE.

`test/test-private-profile-struct.js` replays all 203 records through the real
INI write/read handlers at three boundary positions and a page-local control,
checking all ten guarded output bytes, LastError, stack cleanup and unrelated
backing (812 comparisons). Additional overflow guards are emulator safety
tests, not native observations. ANSI names/path sparse crossings, non-ASCII
encoded characters, NULL arguments, memory faults, registry INI mapping and
allocation failure remain outside this fixture. The existing shared INI path
resolver and string semantics remain authoritative; this change does not
implement WritePrivateProfileStruct or claim those broader behaviors complete.
