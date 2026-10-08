# VB Surface7 source color-key contract

Owning JigSawedME record39/session22710 identifies SetColorKey/API4003 caller41a207, flags8, E_NOTIMPL/ESP+16 after six successful ColorFill operations. Key contents were not captured.

Native DX7VB slot47 at73543135..73543155 passes flags and DDCOLORKEY pointer directly to native slot29 and returns native HRESULT, ret12. No statusOut or OLE/RGB conversion. This wrapper supports SRCBLT single keys on16/32bit owned VB surfaces through the existing native setter; NULL clears the actual shared key-present bit/value. Existing native handler remains unchanged. Destination/overlay/color-space ranges and other formats explicitly return unsupported. Mapped8-byte input supports sparse pages.

NULL removal follows [Microsoft SetColorKey](https://learn.microsoft.com/en-us/windows/win32/api/ddraw/nf-ddraw-idirectdrawsurface7-setcolorkey). Without COLORSPACE, packed low is used and high does not request a range.

Focused actual-WAT session43704 completed in5.093s. Before fails actual slot47 source-key assertion; candidate21groups PASS, preserving all17 previous groups. Tests check real native keyed-copy pixels and full copy after NULL removal,16/32 raw values, primary identity, sparse input and neighbors, unsupported flags and forged receivers. Canonical f40 unchanged; accompanyingJSON records modules and source pins. No gameplay/FPS or broad drawing claim. Production full gates and ordinary BMP Open remain required.

All4089 API identities retained; only API4003 handler metadata changes. Existing automatic test/test-*.js membership covers the durable test. Other unsupported VB drawing methods, including BltFast, remain E_NOTIMPL until actually implemented/tested.
