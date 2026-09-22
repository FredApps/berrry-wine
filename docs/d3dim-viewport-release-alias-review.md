# Shared Viewport / Viewport2 Release

2026-09-22. The Viewport2 Release entry now aliases the byte-identical
Viewport implementation. The shared interface spec and API table retain both
public identities, with no change to IDs, hashes, vtable order or cleanup size.
The Viewport3 implementation remains separate.

The common handler still performs specialized final-release teardown:
`d3dim_viewport_release_lights` before `dx_free`. It must not be replaced with
the generic COM release helper, which would lose attached-light ownership.

The existing viewport/light runtime suite now enters all three Release APIs
through public dispatch. Additional cases for versions 1 and 2 test:

- Nonfinal release leaves both light attachment references intact.
- Final release clears the viewport and list head.
- A caller-retained light is detached and loses only its attachment reference.
- A light owned solely by the viewport is destroyed.
- The eight-byte stdcall cleanup preserves a caller sentinel.

Exact-duplicate baseline: 127 groups / 501 members to 126 / 499. The removed
wrapper and its now-single canonical body leave the duplicate inventory.
The quiet-handler count remains 247 manual + 22 metadata.

The first shared-worktree runtime attempt failed before tests, compiling an
unrelated in-progress GL rasterizer call (`gl_mtx_untrusted`: expected two
arguments, got zero). The owner was notified. The isolated test run overlays
only `main.watx`, `09a8c-gl-encoder.wat`, and `00-regions.wat` with committed
HEAD contents in memory; it does not revert or write shared files. Validation
does not certify that in-progress GL integration or a full release build.

That isolated runtime suite passes, including the new ownership cases. The
211-method interface consistency test and dispatch, API hash, ESP/epilogue,
fragment, tier, quiet-handler and whitespace checks also pass.
