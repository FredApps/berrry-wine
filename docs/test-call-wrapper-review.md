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

## TLS wrapper audit

Only `test-process-id.js` calls the three handwritten TLS Get/Set/Free exports.
Its original checks inspected invalid-index results, not the helpers' stack
effects. Each helper replaced ESP with `0x00300000` and left it advanced by the
handler. That scratch address is not part of the API or needed by these handlers.
The added tests require the caller's ESP to survive every direct test call,
check both 64 and UINT_MAX as invalid indices with error 87, and exercise valid
Get/Set values independently in two WASM instances sharing process memory.
The old wrapper fails the new ESP assertion with `0x00300008` instead of the
caller's `0x07408000`. The three wrappers now use generated metadata exports,
bringing the inventory to **237 generated / 22 handwritten**. Their names,
parameters and return values are unchanged; preservation of caller ESP is the
intentional test-helper behavior change. Production TLS handlers are unchanged.
Verification passed: the shared-process identity/TLS suite including new ABI,
error and value-isolation checks; metadata generation, API IDs, fragment balance,
logical operands, tier discovery and whitespace. The isolation check uses two
instances sequentially, not simultaneous Worker stress.

A separate runtime gap was found, not fixed by wrapper generation:
`handle_TlsFree` returns success for any index below 64 but releases no index.
`tls_reserve` is a monotonically increasing cursor which remains exhausted at
64. Proper reusable allocation requires a coordinated allocator/free change
and tests across thread creation/static TLS and shared-memory instances; the
wrapper tests must not be cited as evidence that this lifetime contract works.
Microsoft documents index reuse for
[TlsFree](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-tlsfree)
and initially zero slots for
[TlsAlloc](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-tlsalloc).
These are current official contracts, not a fresh native Win98 capture.
The allocator is also used by `08-pe-loader.wat` for static TLS; spawn metadata
publishes a monotonic minimum through `set_tls_next_index`. Both paths need
coverage before replacing the cursor with a reusable-index allocator.

SetLastError remains handwritten here: its current export is void and advances
ESP, so migrating it requires explicitly handling that test-call contract.

Subsequent [native Win98 observations](../test/fixtures/win98-tls-lifetime/README.md)
show **80** slots, immediate cross-thread clearing on free, and preservation
of LastError on successful Alloc/Set/Free. Thus the existing emulator tests'
index-64 rejection is an implementation-limit assertion, **not native
conformance**, and must be replaced in the runtime fix. The repeated native
fixture now defines that follow-up's target; this wrapper migration did not
correct those runtime discrepancies.

The later [TLS runtime change](tls-lifetime-review.md) implements that captured
sequence and adds generated TlsAlloc test calls: **238 generated / 22 manual**.

## Full-signature GDI follow-up

MoveToEx and SelectPalette now use generated full-signature test exports:
**240 generated / 20 manual**. All existing callers explicitly supply the
formerly hidden NULL previous-point pointer or FALSE background flag. This is
an intentional test-export ABI extension, not a production API change.
MoveToEx also now preserves ESP; its old helper left it advanced by 20 bytes.

`test-gdi-wrapper-signatures.js` fails against the old export's three-argument
signature. With generation enabled it verifies the four-argument MoveToEx
surface, signed previous-position output, guards around that POINT, and ESP
preservation for NULL and non-NULL output. SelectPalette exposes all three
arguments and preserves ESP with either background flag. The production
SelectPalette implementation currently does not distinguish the background
flag; those checks are not evidence of foreground/background palette behavior
on native indexed displays.

### Correction: AngleArc is not an all-integer signature

The broader path suite exposed a regression introduced by `1369e721`: its
AngleArc export originally accepted two `f32` angles, but the all-i32 generator
changed their interpretation to integer bit patterns. The earlier statement
that every export signature was unchanged was wrong. Restoring HEAD's wrappers
in a compiler-only baseline reproduces the same path failure, excluding today's
MoveToEx/SelectPalette migration as its cause.

Generation now derives `f32` parameters from existing `args[].type: "FLOAT"`
metadata and reinterprets their bits into both direct handler arguments and
stack words. No separate type list is introduced. The ABI recorder now passes
fractional negative numbers for FLOAT arguments and independently computes
their expected IEEE-754 words. The existing AngleArc path checks cover a
90-degree sweep, multiple turns, and NaN/infinite input rejection. This restores
the original floating-point test ABI; the production handler is unchanged.

Verification: full-signature/POINT/ESP regression, 92 ABI recorder calls,
28 path checks, 10 palette checks, nine geometry checks, nine Priority-0/1
checks, nine bitmap checks and the real-window surface test pass. Metadata,
generator freshness, append-only API IDs, fragment balance, logical operands,
handler ESP, test tiers and whitespace checks pass. The benchmark caller was
updated mechanically but no timing result is claimed. These are shared-worktree
checks, not a full release or native Win98 GDI conformance sweep.

## Eight defaulted adapters migrated

CreateDCA/W, StartDocA, mmioGetInfo, OpenMutexA, CreateMutexA, GetClassInfoW
and SHGetFileInfoW now expose the complete metadata signatures. Existing test
callers explicitly supply their previous zero defaults, including the leading
instance/security arguments; OpenMutexA retains its former `0x001f0001` access
mask. No production handler changes. The last four old wrappers advanced ESP;
their generated replacements preserve it. Inventory: **248 generated / 12
manual**.

The ABI recorder now exercises **every generated wrapper**, not only those
with stack arguments: 248 exports at four alignments, **992 calls**. It checks
arity, all five direct argument positions (including zero padding), FLOAT bit
patterns, stack words for signatures above five, untouched stack words for
short signatures, return-address/boundary guards, result and restored ESP.
Zero-argument wrappers are covered without reading a nonexistent argument.
A compiler-only negative control replacing CreateMutexA's name argument with
zero fails the direct-argument assertion.

The MMIO behavioral rerun found an existing stale assertion, reproduced with
all WAT sources loaded from committed HEAD. A provider-backed read parked on
IO_WAIT has not returned to the guest: `io_block` preserves EAX, restores the
frame and redirects to the thunk. The test now seeds and checks unchanged EAX
while suspended, retaining the yield/ESP/EIP checks and the actual byte count
and copied bytes after retry. The buffered-refill assertion's wording likewise
no longer calls its intermediate zero a completed API success. This changes
test expectations, not the runtime's asynchronous read behavior.

The remaining manual exports are GetVolumeInformationA, CreateFontW,
CreateDIBSection, CreateDIBSectionUsage, ExtTextOutA/W, ExtTextOutAWithDx,
WinHelpA/W, WSAFDIsSet, WSAIsBlocking and SetLastError. These still need explicit
signature, endpoint or public-registration decisions; this is not full P5 #7
closure.

Verification includes printer-surface rendering, SetAbortProc, GDI state,
MMIO buffer/lazy retry, 33 wide-API checks and 17 kernel32 error checks.
While another agent's present-pacer edit temporarily left the shared DirectX
fragment unbalanced, a temporary compiler harness pinned WAT to `7e0941d2`
plus only these eight wrapper migrations. Its 992 ABI calls, MMIO, wide-API
and kernel32 suites passed; JS/tests remained from the working tree, so this
was a pinned-WAT check, not a clean full-tree release. The unbalanced fragment
was subsequently repaired by its owner. No other agent's code was reverted.
The MMIO, wide-API and kernel32 suites then passed again on current worktree
WAT. Metadata/generation, API IDs, fragment balance, handler ESP, test tiers and
whitespace checks passed. No full build, browser sweep or timing claim.
