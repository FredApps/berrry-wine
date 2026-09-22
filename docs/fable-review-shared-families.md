# Pass-5 exact-twin families: audit — 2026-09-22

Scope: the nine rows of §P5-3's **Byte-identical twins** table, referenced
by recommendation #5. The review file has other agents' pending changes;
this current-state audit is separate. These rows now share implementations:

| Family | Current shared path | Behavioral suite |
| --- | --- | --- |
| PlaySound A/W | `sound_play_dispatch`, encoding selector | `test-playsound-forms.js` |
| ImageList_LoadImage A/W | `image_list_load_image`, encoding selector | `test-image-list-icons.js` |
| mixerGetControlDetails A/W | W delegates to A, then `mixer_get_control_details_entry` | `test-mixer-control-details.js` |
| _mbsnbcmp / memcmp | `crt_compare_bytes`, NUL-stop selector | `test-crt-mb-cur-max-handler.js` |
| GetLocalTime / GetSystemTime | `host_wall_clock`, local/UTC selector | `test-file-times.js` |
| _lread / _hread / mmioRead | mmioRead → _hread signed-count check → _lread | `test-legacy-file-read.js` |
| D3D 1/2/3 CreateLight and CreateViewport | `d3dim_create_child`, type/vtable selectors | `test-d3dim-viewport-lights.js` |
| Device 1/2/3 AddViewport | Device1 → Device2 → Device3 | `test-d3dim-viewport-lights.js` |
| Device3/7 ComputeSphereVisibility | Device7 → Device3 | `test-d3dim-sphere-visibility.js` |

`test-review-shared-families.js` reads the real source manifest and uses the
existing WAT S-expression parser. It checks 21 direct delegation edges,
requires each target to exist, and rejects adapter-local loops. Five negative
controls prove that comments, wrong calls, double calls, private loops and
missing targets cannot satisfy those checks. Export references are not
mistaken for function definitions. This is intentionally a structural test;
one shared call does not by itself prove API semantics or prevent every
possible copy-paste regression.

The common cores retain meaningful differences: string encodings, NUL versus
raw-byte comparison, time zones, signed read counts and COM versioned
interfaces. This is not a demand to alias semantically different operations
to identical behavior. Mixer LISTTEXT support, for example, is not implied
by its shared VALUE-query path.

The behavioral audit exposed two stale tests rather than production failures:

- Image-list destruction assumed the old single free list and specific block
  adjacency. Small allocations now use size bins. The test checks that the
  list and icon array are absent from the appropriate free chain while live,
  and present after destruction, with bounded/cycle-checked traversal. Owned
  icon release and repeated-destruction checks remain intact.
- The CRT startup suite still expected `_dup(7)` to return the same fabricated
  handle. It now opens a real VFS file, requires a distinct duplicate, checks
  both can close independently, and checks closed/negative-handle rejection.

No production code was changed in this audit. Tests run against the shared
worktree, including other agents' pending host/loader edits, not a pristine
release checkout.

Final verification: all eight behavioral suites in the table passed after
those two test repairs, as did the new structural test, automatic tier
discovery (1,421 tests) and whitespace validation. The 27 PlaySound checks
and the D3D ownership/visibility suites exercise real handlers; the structural
test alone is not counted as their behavioral evidence.

This audit does **not** close all of #5: the broader string-copy and COM
boilerplate inventories still need requirement-by-requirement verification.
It also does not close quiet-API behavior, memory permissions, dirty-write
tracking, or the full earlier-pass review. No performance or browser claim
follows from these structural checks.
