# Native-backed VB Surface7 BltColorFill

Actual owning observation82131 identified API3963 E_NOTIMPL at caller429436 after successful image allocation and Blt. Original wrapper7354329b passes the raw packed color unchanged through a zeroed100-byte DDBLTFX (+80), flags COLORFILL|WAIT01000400, nullsource and normalized zeroRECT. Native HRESULT becomes statusOut, COM returnsS_OK, stdcall consumes20bytes includingreturn.

This scoped implementation uses that existing native fill on authenticated16/32bpp surfaces, an owned private call frame/FX, mapped buffers and in-bounds rectangle validation.24bpp is explicitly unsupported because the native fallback is a DWORD fill, not a three-byte fill. No color conversion, arbitrary application size or fake pixel success.

Private session81694: before fails the missing ColorFill contract, candidate17 groups pass in5.216s, including actual white/raw16 pixels, observed128x1 and1x123 strips, null/zero/sparse RECT/status, OOB/24bpp rejection, and all prior primary/clipper/copy/identity/lifetime tests. Canonical module unchanged. Full production gates and ordinary BMP Open progression remain required before publishing; no gameplay/FPS claim.
