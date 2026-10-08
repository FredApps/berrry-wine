# Owning BltColorFill failure after successful image copy

Matched private e1e58384/module4a9df4d6, ordinary valid-BMP Open, session82131:21 owning records, zero observer errors/drops. Three VB CreateSurface calls completed successfully. Blt at caller428e37 completed COM S_OK, drawingStatus0, ESP28; authenticated source/destination both128x128/16bpp/format1 and zeroRECTs. This rules out that observed copy as the failure.

First completed selected failure is BltColorFill/API3963 at caller429436: arguments surface080090a0, RECT43b080, rawcolor00ffffff, statusOut074ff590; EAX80004001, ESP20. This reaches the existing image-error modal. Exact addresses/records in JSON are authoritative. No gameplay/FPS or broader absence claim.

Original DX7VB wrapper7354329b constructs100-byte DDBLTFX, copies rawcolor unchanged into+80, normalizes zeroRECT, calls native Blt with COLORFILL|WAIT01000400 and NULLsource, stores native result in statusOut and returns COM S_OK. Next bounded source implementation uses that actual fill path; no guessed SetColorKey fix. Private tests and ordinary progression remain required. Browser/server closed12:10:49.353Z/errors[], process exit0.
