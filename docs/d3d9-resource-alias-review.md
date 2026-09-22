# D3D9 resource forwarding consolidation — 2026-09-22

Pass-5 recommendations 4/5/7: eleven resource wrappers did nothing except call
the existing `IDirect3DShader9` handler with the same six handler arguments.
Their API records now name that handler directly; generated dispatch preserves
each API's identity, id, hash, argument count and calling convention.

| Family | Aliased operations |
| --- | --- |
| Buffer9 | AddRef, Release, GetDevice |
| VertexDeclaration9 | AddRef, Release, GetDevice |
| StateBlock9 | AddRef, Release, GetDevice |
| Query9 | AddRef, GetDevice |

Query9 Release is deliberately **not** aliased: it retires an outstanding GPU
query before entering shared release. The common resource release still owns
parent-device and internally retained allocation handling. Neither body changes.
The D3D8 DeleteVertexShader caller now invokes the same shared release directly,
preserving its outer three-word stack cleanup. Existing Node fixtures resolve
handler names through the API metadata rather than naming deleted wrappers.

`test-d3d9-resource-aliases.js` creates real buffers, declarations, state blocks
and EVENT queries. All twelve family operations go through API-name lookup and
generated dispatch. Assertions cover external reference counts, parent-device
ownership, GetDevice NULL/success paths, output guards, exact stack advancement
and final parent-reference balance. A separate declaration goes through D3D8
DeleteVertexShader. Structural assertions forbid reintroduced forwarding bodies
and preserve specialized Query9 Release; deleting one alias in memory makes
the test fail. This is a consolidation regression, not a native lifetime oracle.

Verification:

- New name/dispatch/lifetime regression and its missing-alias negative control.
- Existing buffers, EVENT query, direct/worker occlusion query, selective and
  typed state blocks, material/light, viewport/scissor, typed/float constants,
  clip-plane, adapter/parent-lifetime and real COM-to-software-renderer tests
  pass (the latter is Node-only, with no DOM/WebGL).
- Metadata generation, append-only API ids, generated dispatch freshness,
  hash table, handler ESP, generated epilogues, fragment balance, quiet inventory
  and test-tier membership pass. Metadata comparison against HEAD confirms only
  the eleven intended handler aliases differ.

The duplication baseline tightens from 134 groups / 522 allowed members to
131 / 509. Eleven forwarding functions disappear, Texture9 GetDevice is no
longer a duplicate-group member, and the stale VB clipper fallback allowance
is removed (its ABI was changed in the earlier clipper correction). No new
allowances are added. Quiet inventory remains 248 manual + 22 metadata entries.

No browser sweep, native capture, performance measurement or full-release
build is claimed. Remaining COM/string duplication, quiet API behavior and
the queued SHRegGetUSValueA native capture keep the overall review open.
