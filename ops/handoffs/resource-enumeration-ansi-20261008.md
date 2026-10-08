# ANSI resource enumeration

Implemented `EnumResourceTypesA` and `EnumResourceLanguagesA` and made the
existing `EnumResourceNamesA` reentrant. All three share a PE-directory walker.
Each suspended invocation preserves its cursor, callback, caller return and
temporary ANSI buffer; nested callbacks restore the outer invocation. Language
IDs come from the resource directory. Callback FALSE stops enumeration with
the Windows 98/XP `ERROR_SUCCESS` behavior. Invalid modules and missing
resources fail without falling back to the EXE. ANSI resource names use the
existing Windows-1252 conversion in both enumeration and lookup.

This implements the API chain found in the original Dungeon Siege executable;
it does **not** establish that the game's startup trap or gameplay is fixed.
The old stopped-box evidence remains separately unavailable. Next run the
unchanged original installer/executable on a fresh temporary box using this
candidate, through the ordinary launch path, and retain the next actual result.

Evidence: `scratch/runs/20261008T2343Z-resource-enum-ansi/result.json`.
Base `1bbc57ae6`; exact patch and eight changed-source hashes are retained and
matched against the remote files. Canonical module SHA-256:
`864e44d20294bdbccafff3a68bf58679a0ec6b1c7418571decc78ddccb8b1a6f`.
Validation used fresh no-env box `bx_tqrzq6et`, Node 24.18.1, Linux x64.

- Unchanged-main control fails the new nested NamesA callback assertion.
- Candidate passes real API hash lookup and guest thunk dispatch for
  TypesA → NamesA → LanguagesA; two types × two names × two language IDs,
  Windows-1252 names, same-API nesting, callback early stop, caller lParam,
  stack restoration, explicit EXE/DLL selection, decimal resource IDs and
  missing-resource/invalid-argument errors.
- `test/test-thread-resource-sync.js` passes.
- `bash tools/build.sh` passes, including generators, API append-only checks,
  stdcall epilogues, native WATX compilation and memory-layout gates.
- Initial build transfer lacked root HTML; adding the unchanged root files
  and both ToyVM bundles completed the build closure. No source workaround.

No browser, game input, screenshot, FPS or audio claim. Allocation failure is
handled in the implementation but not fault-injected by this regression.

Contracts: [TypesA](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-enumresourcetypesa),
[LanguagesA](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-enumresourcelanguagesa),
[nested enumeration example](https://learn.microsoft.com/en-us/windows/win32/menurc/using-resources).
