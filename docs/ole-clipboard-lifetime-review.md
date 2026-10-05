# OLE clipboard lifetime review — 2026-09-22

The quiet-handler inventory includes `OleIsCurrentClipboard`, but inspection
shows it already returns S_OK only for a non-NULL current owner and S_FALSE
otherwise. No change to that implementation or the quiet inventory is warranted
merely to reduce the count. This agrees with Microsoft's
[owner-pointer query contract](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-oleiscurrentclipboard).

The neighboring `OleSetClipboard` local-object path had a real ownership bug:
it released the previous object before AddRef'ing the incoming object. When
both pointers were identical and the clipboard held the last reference, that
release destroyed the object. The guest-callback branch already explicitly
retained first, so the two lifetime paths had drifted. Microsoft documents
that [OleSetClipboard retains the data object](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-olesetclipboard)
and that the application may release its reference after publication.

The local path now classifies and retains the incoming object before retiring
the old reference. The cached classification also avoids examining a potentially
retired incoming object's vtable a second time. Guest callback sequencing is
unchanged. This is an ownership fix, not a new native Win98 oracle result.

`test/test-ole-clipboard-lifetime.js` calls the real Set/Get/IsCurrent handlers,
not the older test-only clipboard setters. Before the fix, the clipboard-only
republish case observes the object's vtable become zero. The fixed test covers
republication with and without a caller reference, repeated publication,
Get's consumer-owned reference, replacement, NULL clear, repeated clear, owner
identity and stdcall cleanup. Existing suites also pass:

- `test/test-ole-guest-callback.js`: 164 checks.
- `test/test-ole-clipboard-wrap.js`: 13 checks.
- Logical-AND, handler ESP, quiet inventory, test-tier and whitespace gates.

Remaining scope: DLL-private owner retirement from non-OLE clipboard clearing
still has an explicitly documented retained-reference gap. Cross-process and
threaded clipboard authority, open/close error propagation, reentrant failure
atomicity and full native OLE semantics are not certified here. The existing
`test_ole_set_clipboard` export separately mutates state and duplicates the old
release-before-retain shape; it is not evidence for the public API. Its source
file has unrelated pending edits and was left untouched. Migrating that test
setup to a canonical lifecycle remains follow-up shared-harness work.

## Follow-up: duplicated Set/Get test ownership removed

The two state-mutating exports are now deleted. The local-only data-object
suite opts into generated `test_call_OleSetClipboard` / `OleGetClipboard`
wrappers through API metadata. These preserve ESP and call the actual handlers;
they are used only for synchronous local objects. The guest-callback suite now
uses its existing API-thunk runner for both calls, including running suspended
callbacks to completion and checking HRESULT before reading the returned pointer.
The lifetime regression also asserts that the old exports are absent.

All 55 data-object and 164 guest-callback checks pass through these real API
paths, as does the same-object lifetime regression. Dispatch freshness,
append-only API-table, quiet-inventory, A/W, and whitespace checks pass.
Only the clipboard-helper removal hunk is staged from `13-exports.wat`; the
unrelated DLL-capacity change remains in the working tree. This resolves the
test-helper follow-up above, not the wider clipboard behavior gaps.
