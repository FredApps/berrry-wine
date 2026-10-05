# ScummVM fullscreen: false surface placement capabilities

The fresh owning error-state diagnostic (attempt3/session58962) observed the default SDL error struct change from flag0/empty string to flag1/`No room in video memory` during the exact paired fullscreen mode call. Owner thread1 correctly selects the default struct: the sole registered SDL thread row has ID3. Selector and reread bytes were stable at each boundary; entry→return bytes changed. Actual return EAX0, arguments640×400×16/fullscreen, driverdirectx. The before/after record is not a historical stale error.

The pinned SDL.dll contains one reference to that literal, at preferred10017aab. The branch follows successful IDirectDrawSurface GetCaps at10017a7c→10017a7f and checks returned dwCaps&0x4000 at10017a96–10017aa9. Missing VIDEOMEMORY triggers the literal. This is not evidence of physical host VRAM exhaustion.

Pinned runtime and latest-main source still synthesize GetCaps values from surface role: primary200/218, back1c, offscreen840. None includes VIDEOMEMORY. Meanwhile the allocator stores actual requested/default-placement capabilities in dx_surf_meta_ptr, and GetSurfaceDesc already returns that metadata. Thus GetCaps contradicts the successful surface allocation and its own description.

Microsoft documents DDSCAPS as surface capabilities and VIDEOMEMORY as surface placement: [DDSCAPS](https://learn.microsoft.com/en-us/windows/win32/api/ddraw/ns-ddraw-ddscaps). This repair concerns the legacy4-byte DDSCAPS used by native Surface1/2/3, including the actual SDL Surface3 alias. It does not introduce Surface7 DDSCAPS2 behavior.

Minimal candidate lives in isolated scratch/wt-scumm-surface-caps-20261005, based on explicit24d5d399540a8cb4a9af4ab0de8a317f73ef63bf (the earlier acec3dad ancestry claim was wrong and corrected before any runtime). Return existing authenticated allocation caps, not a universal VIDEOMEMORY OR. Validate the live surface and four-byte mapped output extent, leave invalid-object output untouched, and retain twelve-byte stdcall cleanup. No shared source/canonical module changed.

New durable test test/test-directdraw-getcaps-allocation.js exercises actual CreateSurface placement, explicit and implicit video memory, explicit system memory, primary/flip-chain/backbuffer caps, GetSurfaceDesc parity, actual Surface2/Surface3 vtable thunks, buffer sentinels, invalid pointers/foreign/released objects and stack cleanup. Original test-directdraw-surface-caps.js remains unchanged. Before-source negative control must fail the first explicitvideo4040 assertion; candidate tests/full gates and ordinary fullscreen remain pending serialized grants.

Raw diagnostic: scratch/scummvm-av-20261003/mode-return/attempt3. Compact receipts: ops/release-evidence/scummvm-fullscreen-owner-error-20261005. Browser/server closed2026-10-05T17:49:23.004Z, exit0, complete/errors[], process check clear. No further runtime or audio recording. Existing sound-quality review remains separate.
