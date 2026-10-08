# JigSawedME progresses through SetColorKey, then fails at BltFast

Private source0b0c59e787884558ff9b3f6fce3ecc25b6bd25ff, WASM f91fe190360120ad4b3eb0a70cd226955a91b1f056b34ed8bd53cb88ea1ee5c5 (1,666,918 bytes). Full gates and21groups passed; candidate remains private pending ordinary gameplay.

Ordinary98556 and owning diagnostic78639 both visibly show the same image-error modal after normal Upload/Open. Diagnostic48records, errors[],drops{}, hooks restored. SetColorKey4003/caller41a207 completes S_OK,ESP+16. First selected completed failure43 is BltFast3964/caller41a299, E_NOTIMPL,ESP+32. Exact args: destination0x080090d0, x0,y0,source0x080090b0,RECT0x0043b080 (fourzeroDWORDs),flags0x20,statusOut0x074ff4dc. Destination2x2/pitch4 andsource20x1/pitch40, both16bpp. Actual raw records govern these facts.

Original native DX7VB735432ff..73543360 unwraps source, rejects NULL source or NULL RECT, converts zero RECT to full, forwards coordinates/flags to nativeBltFast, writes native HRESULT tostatusOut and returns COM_S_OK, ret28. Guest41a299 checks COM EAX then temporary-interface cleanup; it does not read statusOut in the immediate continuation.

[Microsoft BltFast](https://learn.microsoft.com/en-us/windows/win32/api/ddraw/nf-ddraw-idirectdrawsurface7-bltfast) says it cannot clip and lists DDERR_INVALIDRECT. Current emulator native BltFast clips OOB safely instead. A bounded VB implementation must not claim that copying only2pixels fulfills20pixel request: return actual drawing error/no pixels throughstatusOut, COM_S_OK as wrapper contract requires. Inbounds supported cases need real native pixel effects and keyed transparency tests. No forced geometry or game-specific workaround.

Later source calls SetForeColor43965e and DrawText43969c require actual GDI state/text effects, not success stubs. Remaining route audit/native disassemblies: scratch/new-games-pipeline-20261004/jigssawme/surface-blt-repair-20261005/corrected/color-fill/color-key/remaining-route-audit.json. Dynamic reachability beyond current failure remains unknown.

78639 exit0, browser/server closed12:56:21.889Z/errors[], ps clear. scratch/new-games-pipeline-20261004/jigssawme/surface-blt-repair-20261005/corrected/color-fill/color-key/drawing-error/attempt1/validation.json pins41 artifacts.98556 ordinary cleanup12:51:14.261Z;34artifacts under ordinary-browser/attempt1. No gameplay/FPS qualification.
