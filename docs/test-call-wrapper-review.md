# Remaining test-call wrappers — 2026-09-22

Pass-5 #7 asks for API-metadata-generated test exports. The current audit
started at 191 generated / 68 handwritten wrappers. Twenty Winsock wrappers
were already exactly the generator's save-ESP/call/restore-ESP/read-EAX contract.
They now opt into `test_call: true`; 211 are generated and 48 remain handwritten.

The removed wrappers cover socket, bind, listen, connect, accept, send, recv,
select, shutdown, closesocket, ioctlsocket, setsockopt, getsockopt, getsockname,
htons, ntohs, inet_addr, inet_ntoa, gethostbyname and WSAGetLastError.
The generated exports retain their names and signatures. A parsed comparison
against the pre-change functions proves identical instruction trees after
normalizing local names/indices and grouped parameter declarations.

`test-api-generation-metadata.js` now rejects handwritten wrappers matching
that generated contract. Its self-checks cover renamed locals, numeric locals,
grouped parameters, and preservation of different call targets/defaulted input.
Before migration it rejected `test_call_socket`; afterward it passes. This is
an exact structural guard, not proof that every non-matching body is necessary.

## Remaining inventory

| Shape | Remaining wrappers / next action |
|---|---|
| Full API argument list, more than five words | LoadImageA, CreateRoundRectRgn, MaskBlt, GetTextExtentExPointA/W, GetGlyphOutlineA, GetCharacterPlacementA, CreateDIBitmap, TabbedTextOutA/W, BitBlt, PatBlt, StretchBlt, SetDIBitsToDevice, DrawDibDraw, RoundRect, Arc, ArcTo, AngleArc, Chord, Pie, sendto, recvfrom. Extend/test generated stack-argument support before migrating; some currently omit ESP restoration. |
| Reduced/defaulted signatures | GetVolumeInformationA, CreateFontW, CreateDCA/W, StartDocA, CreateDIBSection, SelectPalette, mmioGetInfo, ExtTextOutA/W, MoveToEx, OpenMutexA, CreateMutexA, GetClassInfoW, SHGetFileInfoW. Preserve or explicitly migrate their callers; do not silently change test ABIs. |
| Extra adapter names | CreateDIBSectionUsage, ExtTextOutAWithDx, WSAFDIsSet. These names differ from their underlying API entry. |
| Direct core calls | WinHelpA/W call the help core; separate test_invoke exports already exercise public handlers. |
| Deliberate ESP side effects in current wrappers | TlsGetValue, TlsSetValue, TlsFree set a fixed test stack; SetLastError does not restore ESP and has no result. Audit caller expectations before migration. |
| No API-table entry | WSAIsBlocking has a handwritten handler/test export but no API metadata entry. Retained rather than dropping its existing test surface. Public name resolution is a separate gap to verify. |

The first pass initially counted WSAIsBlocking among the migrations; the
metadata audit and runtime test caught that omission, and its export was
restored before the final passing run. No new API was registered by this change.

Verification passed: 42/42 Winsock checks, 6/6 hostname checks, 5/5 real
two-process virtual-LAN loopback checks, metadata/structural checks, the
20-function before/after comparison, generator freshness, append-only API IDs,
fragment balance, logical operands, tier discovery and whitespace.

This is not closure of all test-wrapper work. No networking implementation,
stub return, callback behavior or production API ABI was changed. Tests run
in the shared worktree, including another agent's pending Winsock changes;
no clean release, native Win98 or performance result is claimed.

## Stack-argument follow-up

The generator now accepts opted-in i32-word signatures through 16 arguments.
For signatures above five, it writes **all** arguments at ESP+4, +8, ...
through guest `gs32`, passes the first five to the handler, and restores ESP
after the synchronous call. Writing only the tail would miss handlers such
as PatBlt which also read early stack words. The caller supplies writable
space for return address plus arguments; the return slot is not overwritten.
This is a direct test bridge, not a callback/async runner or a variadic/64-bit
argument ABI. Existing five-or-fewer generated wrappers are unchanged.

All 23 full-signature wrappers in the inventory's first row are migrated:
**234 generated / 25 handwritten**. Public handler implementations and export
signatures are unchanged. Unlike the old CreateDIBitmap test wrapper, the
generated one restores ESP; the other wrappers already restored it. The
full-frame write is intentional, not an instruction-identical refactor.

`test-api-stack-wrappers.js` replaces only the generated wrappers'
called endpoints with an ABI recorder during compilation. It exercises all
23 at four byte alignments: **92 calls**, checking first-five handler inputs,
zero name pointer, every stack argument observed inside the handler, return
value, ESP restoration, and guards before/after the frame and in the return
slot. A compiler-only negative control omitting the 13th argument write fails
DrawDibDraw's recorded-stack assertion. No source/artifact changes are needed
for that negative control. Real-handler GDI and Winsock suites run separately.

Verification passed: the 92 ABI calls, 39 raster-handler checks, six LoadImage
DIB-section checks, bitmap text layout, 42 Winsock checks and the existing
224-record font-metric tolerance gate. That last gate permits documented
metric differences; passing it is not exact native font compatibility.
Metadata/generator, API IDs, fragments, logical operands, handler cleanup,
tier discovery and whitespace also passed in the shared worktree.

The remaining 25 comprise the inventory's other five rows; their signature,
setup or endpoint differences still require explicit handling. No claim of
complete review closure or improved runtime performance follows from this work.
