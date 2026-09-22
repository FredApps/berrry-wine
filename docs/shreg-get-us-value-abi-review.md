# SHRegGetUSValueA failure-path ABI — 2026-09-22

The quiet-handler audit found that both `api_table.json` and the handler
described six arguments, popping 28 bytes including the return address.
[Microsoft's prototype](https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-shreggetusvaluea)
has eight: subkey, value, type pointer, output buffer, size pointer,
ignore-HKCU flag, default-data pointer and default-data size. A guest calling
the real signature was left with its stack eight bytes too low even on failure.

The existing API id/hash are unchanged. Metadata now says eight arguments;
the handler pops 36 bytes. Generated dispatch remains fresh without changes,
and the name hash table is unaffected. Registry search and default-data copying
are **still unimplemented**: this is an ABI correction, not an implementation
of the documented function. Its ERROR_FILE_NOT_FOUND fallback remains visible
in the quiet inventory.

`test-shreg-get-us-value-abi.js` supplies eight stack arguments, resolves the
actual API name and calls generated dispatch. It checks the return value,
ESP, output sentinels and the caller's following stack word. Before the fix,
the stack assertion fails by eight bytes. The final fixture uses a valid
missing-key string and no default payload; its preserved error/output behavior
is current emulator behavior, not a native Win98 oracle.

Verification passes: runtime ABI regression, API append-only check, dispatch
freshness, hash table, fragment balance, handler-ESP, generated epilogues,
quiet inventory, test-tier membership and whitespace. No native, browser or
full-release build was performed for this correction.

The inventory remains 248 manual + 22 metadata entries. Its digest changes
only because this quiet handler's cleanup constant changed. An in-memory
read transform replacing only 36 with 28 reproduces the old digest
`3833b8269d97732fa886ac8bc3bf629f37e72e10a22ba0d56b73720c819a7047`.
No source files are overwritten for that check.

Next semantic work requires HKCU/HKLM precedence, ignore-HKCU handling,
default data, caller buffer sizing and guest-aware reads/writes. A constant
error is not the desired end state. Clipboard counting/ordering also remains
open: the current count is approximate and enumeration does not retain
publication order; this audit did not change either by inference.
