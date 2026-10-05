# JigSawedME: real image helpers, not gameplay support

`node test/test-vbdd-image-helpers.js` exercises the full WAT source closure with isolated test-only image helpers. These helpers are deliberately **not wired into production COM dispatch**. They establish a tested implementation foundation for DX7VB `CreateSurfaceFromFile`; the guest image call still needs a proper interface implementation before it can succeed.

The helpers convert the expanded232-byte VB surface descriptor to/from native124-byte layout, load actual uncompressed24bpp BMP bytes through the filesystem's UTF16 path handling, copy decoded pixels into owned16/24/32-bit DirectDraw surfaces, and write the expanded descriptor through mapped guest pages. The BMP loader requires a40-byte BITMAPINFOHEADER, full scanlines, and dimensions at most4096. Unsupported compression, absent files and truncated pixels fail instead of returning placeholder images.

Tests cover original-DLL descriptor mappings, output canaries, atomic unsupported-format rejection, a Unicode filename, missing/truncated/compressed files, independently decoded fixture pixels at asymmetric coordinates, actual surface format and release, and descriptor null/wrapping output rejection. The generated synthetic BMP is128×128, bottom-up, with distinct corners; its SHA256 is `885aeb72abb4d1098e98e71eb7b203dc9af59cbd27c9030b8251f71008efd022`. No copyrighted game asset is included.

The source oracle is the corpus's original `dx7vb.dll`, SHA256 `ce95fbf5e51371a3dc6f571b72fd0a1f6b710e33c101d1e7122c45533985e17b`. Its typelib and native code establish:

- DirectDraw7 `CreateSurfaceFromFile` is slot8, with `this`, BSTR filename, in/out descriptor and output surface. Native `RET16` means total x86 ESP advance20 including the return address.
- VB `DDSURFACEDESC2` occupies232 bytes and its pixel-format subrecord128 bytes. The original reverse converters at7352bdb4/7352a3a5 nevertheless report native size values124/32 in those expanded records. Passing the VB bytes directly to a native124-byte handler is incorrect.
- Returned DirectDrawSurface7 IID is `9f76fde8-8e92-11d1-8808-00c04fc2c602`. Its71-slot VB vtable differs from native Surface2: Blt6, BltFast8, GetSurfaceDesc40, Lock43 and Unlock57. Copying native slots0–38 and adding a short tail is not a valid interface.
- The game calls the returned surface's slot40 at42e671 immediately after image creation and assignment. Nearby calls on its application object are separate interfaces.

The private full-source test passed on2026-10-05 in2.419 seconds (session52105), compiled module SHA256 `5c8d18467ba6758bde7ec39b0e9f6906e3f054ea2f1a6cf820c6c69c8c0a4841`,1,667,597 bytes. Canonical module `f40d4ca3382279ff9b826188573f8acd9272eaa2dc5024dcbb69aecc35b49063` remained unchanged. The separately validated common-dialog control/candidate test passed68 cases; the original failed the absolute-drive filename case as expected. Those results establish neither current puzzle gameplay nor FPS.

Remaining work is kept separate: a correctly generated dedicated VB vtable, BSTR/descriptor validation and real COM publication, exact stack cleanup, allocation-failure cleanup and sparse/auxiliary-instance contracts, then ordinary valid-image browser acceptance. Unimplemented VB methods must return an honest failure with their actual ABI. The scratch frontdoor draft is not included in this helper checkpoint.
