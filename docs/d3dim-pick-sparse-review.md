# Pick instruction and vertex traversal

2026-09-22. ExecuteBuffer sparse-address follow-up.

Pick translated the instruction and vertex bases once, then walked headers,
triangle records and coordinates with WASM pointer arithmetic. Nonaffine
guest backing made it miss valid triangles or read unrelated storage. The
regression reproduced a miss for a vertex beginning two bytes before a page
boundary in both main and a clean test checkout.

The walker now keeps its cursor, instruction base and vertex base as guest
addresses. Header bytes and triangle indices use gl8/gl16; the renamed
d3dim_pick_tl_triangle_guest reads coordinate/depth DWORDs with gl32 and
reinterprets their float bits. Barycentric math, hit ordering, miss clearing
and instruction-relative record offsets are unchanged. No scratch spans or
whole-buffer copies are needed for these scalar reads.

## Regression

`test/test-d3dim-pick-records.js` retains the original inside/outside/depth
checks and adds twelve multi-record layouts: contiguous storage and eleven
nonaffine placements crossing coordinate/depth, instruction-header and
triangle-index boundaries. A degenerate first triangle must be skipped; the
second hit returns offset 12 and interpolated z=1/3. Each layout tests both
hit and miss, guest stack cleanup, all 256 input bytes and interleaved backing
guards. The fixture temporarily changes the object's payload pointer, then
restores its real heap allocation before public Release.

The first main compile encountered a concurrent ImageList_Read edit with an
unknown branch label. No foreign code was changed. A clean test worktree at
abf86e46 was created at `/private/tmp/wa-pick-sparse-20260922`; only the Pick
test and runtime file were overlaid with rsync. The unfixed test reproduced
the same miss there (and subsequently on main once the foreign edit compiled).

With the fix, all twelve layouts and original assertions pass in that clean
checkout, along with eighteen sparse/control PROCESSVERTICES cases. Fragment,
ESP/epilogue, logical-operand, silent-stub and duplicate gates also pass there.
Quiet remains 243 manual + 22 metadata; duplicates remain 117 / 471.
The final Pick regression also passes on the live main worktree; test-tier
membership passes there. The temporary checkout is test-only, not a branch
carrying unintegrated implementation work.

This addresses Pick's valid instruction/vertex reads, not Execute's opcode
dispatch, malformed range/count/index handling, full native picking semantics,
or sparse GetPickRecords output. Those remain separate work. No browser/game
rendering or full-build validation is claimed.
