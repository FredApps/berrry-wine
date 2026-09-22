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

## Follow-up: balanced TrueType registrations

The TrueType registry previously returned success for a repeated add without
retaining another reference. One removal then cleared the entry even when
several successful adds were outstanding. Record +0 now stores a registration
count rather than an occupied Boolean; existing lookup and enumeration already
test it for nonzero. Removal decrements the count, freeing the slot only at zero.
An add at UINT32_MAX fails instead of wrapping into a free slot (an emulator
safety bound, not a measured native limit).

Microsoft's [RemoveFontResource contract](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-removefontresourcea)
explicitly describes reducing the resource count with repeated removals and
restoring it with the same number of adds. This change follows that documented
contract; it is not a fresh native Win98 capture.

The public-handler regression adds one font three times through its FOT,
uppercase TTF and lowercase TTF paths, then checks that two removals retain
the registered face, the third clears it, and an extra removal fails. It also
checks that a reused slot starts at one reference. The old implementation
failed immediately after the first removal because the face was already gone.
The full font-resource suite (20 fonts / 28 mounts and real raster output),
seven public-font API checks, logical-AND, handler-ESP, test-tier and whitespace
checks pass. No browser/game run or performance claim is attached to this fix.

Scope is the process-local TrueType registration table, not selected-HFONT
or cached-outline lifetime. Bitmap resources still use replacement/removal
of their strike records and need a separate lifetime audit. The one-time font
directory scan also calls the registration helper; its installed-versus-dynamic
ownership policy is unchanged. Concurrent registry mutation, native FOT files,
hidden/system-wide visibility and full path canonicalization remain open.
