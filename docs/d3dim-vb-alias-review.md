# D3DIM vertex-buffer handler aliases

2026-09-22: four byte-identical VertexBuffer7 handlers now enter their existing
VertexBuffer counterparts via `api_table.handler`: Release, Lock,
GetVertexBufferDesc and ProcessVertices. Both public API identities and vtable
slots remain. The specialized vertex-buffer final release still frees backing
data and descriptor storage; this is not a generic COM-release substitution.
No implementation behavior or historical nargs metadata was changed.

The generator method spec carries the same aliases. However,
`gen_d3dim_stubs.js` is still a **one-time scaffold**, not a reproducible source
generator: running it rewrote 1,176 lines of the hand-maintained file. That
unrelated rewrite was completely undone, then only the four duplicate bodies
were removed (26 lines). Making the full generator authoritative remains an
open review candidate; do not regenerate this file blindly.

Validation:

- `test-d3dim-vb-aliases.js`: API/spec alias agreement and absent wrappers;
  both versions construct real buffers, dispatch Lock/GetVertexBufferDesc,
  preserve output/stack guards, and balance AddRef/nonfinal/final Release.
- `test-d3dim-process-vertices.js`: actual transform output and stack-resident
  arguments now run through both public dispatch identities, not a deleted
  private handler.
- API hash/dispatch freshness, fragment balance, handler ESP, test tiers and
  silent-handler pin pass. Quiet APIs remain 247 manual + 22 metadata.
- Exact duplication ratchets from 131 groups / 509 members to 127 / 501.
  Four bodies disappear; the four canonical bodies are no longer duplicates.

This is a sharing/dispatch regression, not new native Direct3D conformance or a
game performance result. Existing buffer validation, locking semantics and
allocator edge cases are unchanged and remain separate concerns.
