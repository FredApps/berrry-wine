# D3DIM enumeration aliases — 2026-09-22

Three more exact handler pairs now share generated dispatch targets:

| Public entry | Canonical handler | Callback payload |
| --- | --- | --- |
| IDirect3DDevice_EnumTextureFormats | IDirect3DDevice2_EnumTextureFormats | DDSURFACEDESC, 108 bytes |
| IDirect3DDevice7_EnumTextureFormats | IDirect3DDevice3_EnumTextureFormats | DDPIXELFORMAT, 32 bytes |
| IDirect3D7_EnumZBufferFormats | IDirect3D3_EnumZBufferFormats | DDPIXELFORMAT, 32 bytes |

The pre-change bodies compare exactly after removing comments, normalizing
whitespace and substituting the function name. The change removes 30 lines
of duplicate runtime implementations. API identities, hashes, method order
and existing metadata argument counts are unchanged. Both the interface spec
and API table record the aliases; dispatch is regenerated from that metadata.
No enumeration-core code changed.

The two texture callback families must stay distinct. A Device1/2 callback
expects its pixel format at descriptor offset 72; aliasing it to Device3/7
would restore the malformed-descriptor bug covered by the MCM regression.

## Evidence

`test/test-d3dim-enumeration-aliases.js` checks all six public dispatch entries,
their exact callback payload fields, all four texture formats, cancellation,
single z-format completion, caller return address/context, final ESP and a
stack sentinel. It also checks the metadata aliases and absence of duplicate
runtime wrappers. Callback return is simulated as RET 8 before invoking the
real continuation helper; this is not an x86 callback-execution test.

The existing Device2 descriptor regression and 211-method interface-spec
test additionally cover legacy payload layout and spec/vtable agreement.
Dispatch freshness, API hash table, fragment balance, handler ESP, generated
epilogues, test tiers, quiet-stub and whitespace checks pass.

Exact duplicate census: **126 groups / 497 members -> 123 / 491**. Each removed
two-member pair also removes its now-unique canonical member from the census.
Quiet-handler count stays **247 manual + 22 metadata**.

This is implementation sharing, not expanded native conformance. Existing
null-callback success is preserved and not certified as Win98 behavior.
The global callback state and unreleased format-buffer finding is addressed
by [the lifetime follow-up](d3dim-enumeration-lifetime-review.md), separately
from this equivalence-only alias change. No full build,
browser game capture or performance claim is made here.
