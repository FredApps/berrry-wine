# D3DIM vertex-buffer handler aliases

2026-09-22: four byte-identical VertexBuffer7 handlers now enter their existing
VertexBuffer counterparts via `api_table.handler`: Release, Lock,
GetVertexBufferDesc and ProcessVertices. Both public API identities and vtable
slots remain. The specialized vertex-buffer final release still frees backing
data and descriptor storage; this is not a generic COM-release substitution.
No implementation behavior or historical nargs metadata was changed.

The interface method spec carries the same aliases. At the time of this change,
`gen_d3dim_stubs.js` is still a **one-time scaffold**, not a reproducible source
generator: running it rewrote 1,176 lines of the hand-maintained file. That
unrelated rewrite was completely undone, then only the four duplicate bodies
were removed (26 lines). Making the full generator authoritative remains an
open review candidate; do not regenerate this file blindly. The follow-up below
resolves that obsolete tool, not the broader review's generation work.

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

## Follow-up: retire the one-time scaffold

The scaffold's own instructions explicitly transferred authority to the
hand-maintained WAT after its first run and warned against rerunning it.
Repository consumers confirmed no build/test invoked it. It has now been
deleted (recoverable from git), along with the unused `ret`, `body` and
`delegate` recipe fields in `d3dim-methods.js`. The WAT banner and API-generator
comments now describe the actual authority: interface identities, aliases and
vtable order are metadata; handler implementations are WAT source.

This is retirement of a completed migration tool, not replacement of runtime
implementations with stubs or a claim that all review generation work is done.
All consumer-visible metadata (names, nargs, handler aliases, vtable mappings)
was compared with pre-change HEAD and is identical. Runtime WAT is identical
after stripping comments/whitespace. Dispatch regeneration check still passes.

`test-d3dim-interface-spec.js` checks all 211 methods against actual API aliases,
runtime handler declarations and vtable order; negative controls reject a
reintroduced body recipe, wrong alias, absent target and reordered vtable.
