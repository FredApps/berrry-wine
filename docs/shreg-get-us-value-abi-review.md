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

## Initial native-probe preparation (before captures)

`tools/v86-reference/probes/shreg-us-value.c` and `shreg-us-apps.json`
prepare 16 serial-output cases for the reference Win98 VM. They distinguish
HKCU-first lookup, ignore-HKCU (including BOOL 2), HKLM-only values, unnamed
values, size-only queries, missing keys/values, short buffers, and defaults
with capacities 0/2/4/16. A larger HKCU value with a smaller HKLM value tests
whether a buffer error triggers fallback. Each row records return code, type,
size, LastError and all 16 output bytes, initially filled with a sentinel.

The probe creates only its own `Software\WineAssemblySHRegUSReference`
key under HKCU/HKLM in the VM. It refuses existing keys before writing, tracks
which keys it created, and deletes only those keys. It uses dynamically
resolved registry/shell APIs and imports only KERNEL32; there is no CRT.
NULL-output queries with nonempty defaults are deliberately not included yet.

Verified: Zig 0.13.0 compiles the probe to PE32/i386 with OS/subsystem version
4.0; import inspection shows only KERNEL32, and the capture manifest lists
successfully. The final local artifact is `/private/tmp/wa-shreg-us-probe.exe`
(not committed). Compilation needed Zig's explicit Windows include directory,
as already supplied by `capture.js`.

At this checkpoint there were **no native results**. Capture was deferred for the other agent's
2026-09-22 14:56 browser-sweep reservation. Runtime semantics are unchanged.
The capture command for two fresh reference-VM runs is:

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/shreg-us-apps.json --app shreg-us-value \
  --output /private/tmp/wa-shreg-us.png \
  --metadata /private/tmp/wa-shreg-us.json \
  --serial-output /private/tmp/wa-shreg-us.serial.txt
```

Use different output paths for the repeat. Require all 16 rows, both begin/end
markers, successful cleanup and matching observations before retaining a
native fixture. Then implement precedence/default copying with guest-aware
memory access and compare actual generated dispatch against those observations.

## Native capture completed

The probe was subsequently expanded to 22 cases and captured twice from fresh
Win98 state. See [native observations](shreg-get-us-value-native.md) and
`test/fixtures/win98-shreg-us-value/`. Registry/default runtime behavior remains
unimplemented; the next step is a regression driven by these observations.
