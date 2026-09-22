# WSAIsBlocking registration and final test adapter — 2026-09-22

Pass-5 #7's last handwritten `test_call_*` wrapper called an existing
`handle_WSAIsBlocking` directly. The API name was absent from `api_table.json`,
so that passing direct test did not establish name lookup or dispatch reachability.

The API is now appended (id 3711, zero arguments, stdcall, BOOL return), with
`test_call: true`. The hash table and dispatch are regenerated, and the private
wrapper is removed. All 259 production-source `test_call_*` adapters are now
generated from API metadata. A structural assertion rejects handwritten
wrappers whose APIs are not registered; before the change it failed specifically
on WSAIsBlocking. Existing mechanical-wrapper and collision checks remain.

The Winsock runtime test now resolves the name through the actual hash lookup
and calls the generated dispatch entry, checking FALSE and ESP + 4. Its existing
direct-call check still exercises the newly generated adapter. This is a
name/hash/dispatch regression, not a real PE-import or GetProcAddress end-to-end
test. Ordinal imports are not added by this change.

The handler's existing behavior is unchanged: this emulator does not run a
nested Winsock 1.x blocking hook, so the result remains FALSE. This is not a
new blanket-success stub and does not claim complete blocking-hook support.
The reference is [Microsoft's WSAIsBlocking documentation](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-wsaisblocking),
which describes the Winsock 1.1 compatibility API and warns that WS2_32 does
not directly export it. The emulator's broader DLL-specific export scoping
remains separate from this name-based registration.

Verification: Winsock runtime 43/43 checks pass, including name lookup and
generated dispatch. Metadata generation reports 22 constant handlers, 259
generated adapters and zero handwritten adapters. API append-only, dispatch
freshness, hash-table, stdcall epilogue, fragment, handler-ESP, logical-AND,
silent-inventory, tier and whitespace gates pass. The quiet inventory is
unchanged at 248 manual + 22 metadata. Generator-only reordering of existing
JSON keys was discarded after checking that existing entries were semantically
unchanged; the API-table diff is the single append.

This closes the remaining handwritten-adapter item, not all of Pass-5 #7:
remaining quiet API behavior still needs review. No native Win98, browser,
blocking-hook callback, or performance result is claimed here.
