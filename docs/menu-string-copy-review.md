# Menu string ownership and shared duplication — 2026-09-22

Pass-5 #5 asks for one guest string-duplication implementation. The current
tree already routes CRT, DirectPlay, scalable fonts, DDE, atoms, registered
clipboard formats, ICM, open-dialog paths, ListView and TreeView copies
through `guest_strdup`. Two menu paths still repeated its allocation/copy
sequence: `dynamic_menu_take_text` and the ANSI branch of
`dynamic_menu_item_info_set`. They now use the helper too.

The wide branch retains its UTF-16-to-ANSI conversion. Replacement still
allocates before releasing old text, and non-string type data is unchanged.
Counted WinHelp slices, relative-path construction, title truncation and
encoding conversions are not interchangeable with NUL-terminated ANSI
duplication and were not mechanically converted.

## Safety defect found in the shared helper

`guest_strlen` caps its scan at 65,536 bytes, while the old `guest_strdup`
allocated that capped length plus one and then used unbounded `guest_strcpy`.
A longer valid input therefore overran its allocation. The helper now
continues the scan beyond the cap before allocating and bounds its copy to
the measured length plus NUL. The bounded behavior of `guest_strlen` itself
is unchanged. An enormous length that cannot fit the signed copy count
returns NULL; this is an emulator safety limit, not a measured Win98 limit.

`test-crt-strdup.js` checks lengths 65,535, 65,536, 65,537 and 70,000,
allocation capacity, complete bytes/terminator and independence from a later
allocation. A test-only compiler transform restoring the HEAD helper failed
the 70,000-byte allocation-capacity assertion. The fixed helper passes.
That negative control changed no production files or build artifacts.

The menu ownership suite also needed its free-chain inspection updated for
the existing small-block allocator bins. It still checks actual release;
no assertion was removed to hide a lifetime failure. New cases verify
AppendMenuA copies caller storage and empty ANSI replacements are separately
owned, terminated and retire the old label.

Verification passed: `test-crt-strdup.js`, `test-menu-item-info-wide.js`,
`test-dynamic-menu-bar.js`, `test-crt-mb-cur-max-handler.js`, fragment balance,
logical-operand checks, handler stack cleanup, tier discovery and whitespace.
These are shared-worktree tests, not a clean release build.

This change does not finish the entire string-copy or COM audit. No claim
is made about invalid-pointer probing, concurrent mutation of caller strings,
OOM fault injection, full Unicode menu fidelity, browser output or performance.
