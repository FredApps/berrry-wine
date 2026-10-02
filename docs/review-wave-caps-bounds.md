# Waveform capability buffers — 2026-09-23

Following the MMIOINFO sparse-buffer fix, inspection found two more caller
buffer errors in `src/09a3-handlers-audio.wat`:

- `waveOutGetDevCapsA/W` cleared `cbCaps` bytes but wrote a whole capability
  structure regardless of that length. A zero-byte query still wrote fields;
  oversized requests also cleared bytes beyond the structure.
- `waveInGetDevCapsA/W` rejected every short buffer, and its full-structure
  writes assumed contiguous backing after translating the first address.

Microsoft's archived [waveOutGetDevCaps](https://learn.microsoft.com/en-us/previous-versions/ms713745%28v%3Dvs.85%29)
and [waveInGetDevCaps](https://learn.microsoft.com/en-us/previous-versions/ms713729%28v%3Dvs.85%29)
references explicitly include Windows 95/98/Me and specify a caller-length
bounded copy, with a zero-length query succeeding without copying anything.
These are API-documentation evidence, not a native Windows execution result.

## Implementation

One `$wave_dev_caps_fill` handles the shared header, A/W name encoding,
formats and channel count, plus output-only support flags. It takes a span
of `min(cbCaps, sizeof(structure))`, initializes only that prefix, bounds
every nonzero byte store and writes the span back once. It accepts truncated
fields and odd UTF-16 byte prefixes without touching the next byte. Zero
length returns before pointer translation; nonzero length with NULL returns
`MMSYSERR_INVALPARAM`, consistent with the previous capture-side null policy.
Contiguous backing uses the existing direct span path.

The advertised names, formats and device capabilities are unchanged. The
existing input test's short-buffer rejection assertion was corrected. Device
ID/mapper/open-handle validation is **not** completed by this change: input
still accepts only ID zero, and output still does not validate its selector.
The existing W entry points remain compatibility functionality; the archived
documentation does not establish native Win98 Unicode support.

## Regression evidence

`test-wave-caps-bounds.js` tests both APIs and both encodings with every size
from zero through eight bytes beyond the structure, plus `UINT_MAX`, across
direct memory and two noncontiguous sparse-page placements. It checks the
exact prefix, unchanged suffix/leading guards/unrelated backing, stdcall
cleanup, and released span scratch. NULL/zero and NULL/nonzero are separate
cases. The original implementation fails at the first zero-byte output
query: `waveOutGetDevCapsA tail 0` (`/private/tmp/wa-wave-caps-red.log`).

## Current isolated verification — 2026-10-02 UTC

Coordinator revalidated only the two capability hunks, the input assertion,
and this new regression in `/private/tmp/wa-mig-audio-20261002`, based on
committed `9b4f9b3f`. The unrelated `timeSetEvent` change in the shared audio
file was excluded. Shared dirty source and the canonical build were untouched.

- `node test/test-wave-caps-bounds.js`: PASS920 ABI calls.
- `node test/test-wave-in-dev-caps.js`: PASS.
- `bash tools/build.sh`: all gates and both modules PASS; primary1650788bytes,
  compatibility1653351bytes;324 data segments with no overlaps.
- Logs and exact owned patch: `scratch/mig-audio-caps-20261002/`.

This verifies the bounded capability-write slice on the stated committed base;
it is not a claim that the entire shared dirty checkout was tested. Device-ID,
mapper and live-handle semantics remain outside this slice.
