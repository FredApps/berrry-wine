# Native Win98 volume-buffer observations — 2026-09-22

Captured from native Windows 98 4.10 running under v86, not Wine source or the
project's Win32 implementation:

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/volume-apps.json --app volume-buffers \
  --output /private/tmp/wa-volume-native.png \
  --metadata /private/tmp/wa-volume-native.json \
  --serial-output /private/tmp/wa-volume-native.serial.txt
```

Two fresh VM runs produced identical observations except the reference CD's
volume serial, which changed when its ISO payload was rebuilt. The probe
executable hashes match. `repeat-serial.txt` and `repeat-capture.json` retain
the second run; the integrity test compares every other field exactly.
`capture.json` records the reference assets, v86 version and probe hash. No OS
image, executable or screenshot is committed; the PNG path is temporary.
`serial.txt` normalizes CRLF to LF. Probe source:
`tools/v86-reference/probes/volume-buffers.c`.

## What was measured

84 cases: C: (unlabelled FAT) and the D: reference CD (CDFS, label REFERENCE),
ANSI and Unicode, volume-label or filesystem-name capacities of
0/1/2/3/4/5/8/16/64, and NULL label/filesystem/both buffers. Each call starts
with LastError 4660, scalar outputs 0xcccccccc and 160-byte physical string
buffers filled with 0xcc. Each row captures the result, error, all three
scalar outputs and the first 32 bytes of each string buffer.

The [Microsoft contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationa)
defines capacities in characters and ignores a capacity when its corresponding
buffer is NULL. It does not establish the target-specific write order below.

Observed ANSI behavior:

- FAT requires capacity 4 for its filesystem name; CDFS requires 5. Smaller
  capacities return FALSE/error 111 (`ERROR_BUFFER_OVERFLOW`). Neither string
  buffer is modified in the captured prefix, but scalar outputs are filled.
- With adequate filesystem capacity but insufficient label capacity, the
  filesystem name is written first; the label remains untouched and the call
  returns FALSE/111. Even the empty FAT label needs one character for NUL.
  REFERENCE fails at the sampled capacities through 8 and succeeds at 16/64;
  capacities 9/10 were not measured, so this is not an exact label-threshold
  oracle.
- NULL string pointers suppress that output and its capacity check. Both NULL
  succeeds and fills scalars.
- The unlabelled FAT volume's successful label query leaves LastError 2; a
  NULL label preserves 4660. Successful CDFS calls preserve 4660. These are
  image-specific observations, not a universal success-error policy.
- FAT reports maximum component length 255 and flags 0x4006; this Joliet CD
  reports 221 and flags 0x4000. Serials are stable per captured volume, not
  constants to hard-code for arbitrary mounted media.

All Unicode calls return FALSE/error 120 (`ERROR_CALL_NOT_IMPLEMENTED`),
leaving scalars and captured string prefixes unchanged. The current emulator
implements a Unicode extension; it must not be called native Win98 conformance.
Decide that compatibility policy explicitly rather than silently extrapolating
ANSI observations into a claimed native Unicode implementation.

## Implementation follow-up — still open

The current `volume_information` ignores filesystem capacity and writes a full
FAT/CDFS string, uses fixed max-component/flag values, and truncates labels via
the host callback. A correct target implementation must preserve the observed
scalar → filesystem → label order and failure atomicity of each string, check
capacities before copying, and replay the captured ANSI matrix with controlled
VFS metadata. Do not merely clamp writes and keep returning success.

`test-volume-native-fixture.js` checks the complete matrix, byte prefixes,
errors, scalar consistency and five corrupted/truncated/duplicate fixtures.
It is **fixture integrity, not emulator conformance**. Invalid pointers,
inaccessible drives, simultaneous short buffers, nonempty FAT labels,
arbitrary filesystems, race conditions and bytes beyond the captured prefixes
remain outside this probe's coverage.
