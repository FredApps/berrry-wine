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
