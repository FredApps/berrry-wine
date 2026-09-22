# Shared font-resource resolution — 2026-09-22

Pass-5 identifies the duplicated AddFontResourceA / RemoveFontResourceA ladder:
bitmap registry, TrueType registry, scalable-resource association, then another
TrueType attempt. Both handlers now call `font_resource_change`. It resolves a
known scalable-resource association once, otherwise retains the supplied path,
then calls the bitmap registry and, if necessary, the TrueType registry once.
The remove flag selects operations with control flow, not an eager `select`
that would execute both mutations.

This also fixes an inconsistent identity in the previous fallback ordering.
CreateScalableFontResourceA currently places a compatibility copy of TTF bytes
at a writable FOT destination. The old add path successfully parsed that copy
before consulting the association, registering the FOT filename. Read-only
associations instead registered the source TTF. Both now register and remove
the associated source. Microsoft's
[CreateScalableFontResourceA contract](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createscalablefontresourcea)
describes a font-resource file referencing the scalable font, including the
requirement that an absolutely referenced TTF remain at its specified location.

The added regression first failed with `arial.fot` where the registered path
should identify `arial.ttf`; it now passes and confirms removal clears the
same registry identity. Existing coverage also passes:

- `test/test-wat-font-resource.js`: writable/read-only FOT associations,
  NULL/missing paths, bitmap resources, 20 scalable fonts across 28 mounts,
  family/style selection and real rasterized output.
- `test/test-wat-gdi-bitmap-text-layout.js`: bitmap text layout.
- `test/test-wat-gdi-public-font.js`: seven public font API checks.
- Logical-AND, handler-ESP, A/W, exact-duplicate and whitespace gates.

This addresses the named duplicated resolution chain. It does not make the
compatibility FOT copy a native NE resource file, implement hidden/system-wide
font visibility, establish repeated Add/Remove reference counting, or certify
all resource search-path semantics. The existing read-only-media association
policy is retained, not presented as native Win98 file-creation behavior.
No native VM or game-performance measurement was performed for this change.
