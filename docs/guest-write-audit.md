# Guest-write audit checkpoint — 2026-09-21

Snapshot: main after `03bb39f1`, with other agents' uncommitted work present.
This is a candidate inventory, not a coverage certificate or a new build gate.

## Direct translated scalar stores

A comment-stripped scan of `src/*.wat` found **142 matches in 31 files** for
scalar/vector stores whose immediate address expression calls `$g2w`.
The expression used was:

```js
/\((?:i32|i64|f32|f64|v128)\.(?:atomic\.)?store(?:8|16|32|64)?\s+(?:(?:offset|align)=\S+\s+)*\(call\s+\$g2w\b/g
```

The scan strips line comments and simple block comments first. It is a textual
screen, not a WAT parser: nested comments, strings and macro expansion require
manual interpretation. It excludes addresses cached in locals, raw bulk
copies/fills, helper-mediated writes, host JavaScript, atomic RMW instructions,
and nonstandard address-expression shapes. No match does not mean no writes.

Largest buckets:

| Fragment | Matches | Interpretation so far |
|---|---:|---|
| `09a2-handlers-console.wat` | 18 | Caller count outputs; next coherent migration batch |
| `09a8-handlers-directx.wat` | 16 | Not classified in this checkpoint |
| `09a8c-gl-encoder.wat` | 14 | Ownership must be established before changing stores |
| `09a0b-handlers-base-late.wat` | 12 | Six caller-output stores, six allocator bookkeeping stores |
| `09d-winsock.wat` | 12 | Not classified in this checkpoint |
| `10-helpers.wat` | 8 | Mixed helpers; needs ownership/lifetime tracing |
| Other 25 fragments | 62 | Not classified in this checkpoint |

## Manually classified base-handler bucket

The six direct caller-output stores in `09a0b` are:

- `GetKeyboardLayoutList`: one HKL.
- `GetConsoleMode`: one mode DWORD.
- `WriteConsoleA`: successful character count.
- `FormatMessageW`: allocated-buffer pointer returned through `lpBuffer`.
- `GetProcessAffinityMask`: two mask DWORDs.

The other six belong to `heap_compact_free_list`: node links and free-block
headers. They are allocator-owned metadata, not outputs in arbitrary buffers
supplied to those public APIs. Converting them blindly would conflate private
allocator mutation with guest payload writes; first establish their alignment,
arena and lifetime invariants. This classification is not proof of allocator
correctness or code-cache safety.

There are additional **unmatched** caller writes in the same fragment:
`GetKeyboardLayoutNameA` writes through a translated local, for example.
The raw `memory.fill` sites in `BackupRead/BackupWrite` in `09a7d` instead
initialize newly allocated opaque backup contexts. They should not be swept
into a caller-buffer migration solely because the instruction is a raw fill.

## Next batch: console count outputs

The 18 direct matches in `09a2` belong to:

- `FillConsoleOutputCharacterW` and `FillConsoleOutputAttribute` (two each).
- `console_read` and `WriteConsoleW` (one each).
- `WriteConsoleOutputCharacterA` and `WriteConsoleOutputAttribute` (two each).
- `console_input_records_api` (three), `console_input_count_api` (one).
- `ReadConsoleOutputAttribute` and `console_write_input` (two each).

Together with `GetConsoleMode` and `WriteConsoleA` in `09a0b`, these form a
bounded set of 20 count/mode stores. Test success, empty/short operations and
failure output policy at all three DWORD splits; preserve handle checks,
queue consumption, callback/blocking behavior and stdcall cleanup. Both A/W
frontends and shared read/write cores need coverage. This does not cover their
record arrays, text buffers or console backing storage.

## Completion boundary

Guest-aware accessors establish sparse-address correctness and existing
code-write notification. They do not alone implement dirty-page writeback.
That still requires complete write-path coverage, shared-worker ordering,
flush/clear race handling and quiet game A/B performance evidence. The
broader `fable-review.md` common-core, quiet-handler and cleanup work remains
partial. This checkpoint ran read-only scans; it introduces no runtime change
and claims no new game/browser test result.

## Console count/mode batch implemented

All 20 stores identified above now call `gs32` with the original guest
address. No console record/text layout, backing store, handle validation,
queue consumption or return/cleanup branch was changed. A split DWORD can
therefore use noncontiguous page backing and reaches the existing guest-write
notification path rather than bypassing it through a raw store.

The new `test/test-console-count-boundaries.js` failed before migration at
GetConsoleMode split 1. It now exercises all three DWORD crossings through
17 API frontends, with byte-for-byte output and canary checks and stdcall
cleanup. Cases cover successful counts, clipping at the last screen cell,
empty requests, invalid coordinates, null record buffers and invalid handles
that preserve the caller's previous count. Both A/W text and record routes
are included. These are count-buffer tests, not sparse text/record tests.

Existing suites also pass: console input (mouse, aliases, flush, tab stops),
input validation, WriteConsoleInput ordered records, fill clipping, streamed
output clipping and attribute reads. Test-tier, logical-AND, duplicate and
whitespace gates pass. The absence of direct store-to-g2w matches in `09a2`
after this change is only a syntactic milestone: translated local pointers,
record arrays and text buffers remain to audit. No Far browser smoke or game
performance measurement was performed for this batch.

## Console INPUT_RECORD arrays migrated

The shared `console_read_input` and `console_write_input` cores now retain
guest addresses for caller record arrays. Public fields use `gs16/gs32` or
`gl8/gl16/gl32`; internal ring slots retain private raw loads/stores. The raw
16-byte union copies are expanded into four field transfers across that
ownership boundary. Reading the A/W key character selects only the required
byte/word load rather than eagerly evaluating both translations. Existing
padding preservation and low-byte A encoding are unchanged.

The real PeekConsoleInputA output failed at split 1 before the migration.
`test/test-console-record-boundaries.js` now checks every split of a 60-byte
three-record array, with source or destination split, for both encodings.
Each case checks peek and consuming read: full bytes, outer canaries,
unchanged padding, queue counts, returned count and stdcall cleanup. Key,
mouse and another raw union type are all present; an unrelated mapped page
must remain untouched. All 472 peek/read checks pass. Existing ordered-input,
input-validation and sparse-count suites also pass. Logical-AND, tier and
whitespace checks pass. Text buffers and screen-buffer rectangle structures
remain outside this batch; no browser or dirty-writeback completion claim.

## High-level console text buffers migrated

The shared ReadConsole and WriteConsole text cores now retain guest buffer
addresses. Writes to the console load one byte or word through `gl8/gl16`;
reads from its input queue store through `gs8/gs16`, including the synthesized
LF after CR. The character loop, counts, filtering, line-mode availability
and queue-consumption logic are otherwise unchanged. This does not expand
code-page support or fix unrelated input semantics.

The new `test/test-console-text-boundaries.js` reproduced WriteConsoleA
reading `0xa5` characters from an unrelated mapped allocation after the first
page. It now checks each crossing in A/W character buffers, including a split
UTF-16 code unit and a non-ASCII character. Console cells provide independent
write expectations. Read cases cover line/non-line mode, CRLF expansion and
bounded reads that leave the unconsumed queue tail, with byte expectations,
canaries, count/queue checks and stdcall cleanup. The complete unrelated page
is unchanged. Existing console-input and sparse-count suites also pass, as
do logical-AND, test-tier and whitespace checks. Rectangle, streamed screen
output and other translated console buffers remain to inspect. No browser
or performance claim is made here.

## Streamed screen-buffer character and attribute arrays migrated

WriteConsoleOutputCharacterA and WriteConsoleOutputAttribute now read caller
arrays with guest byte/word loads. ReadConsoleOutputAttribute and the shared
ReadConsoleOutputCharacterA/W core use guest stores. Private console cell
accesses and existing coordinate validation, wrap and clipping rules remain
unchanged. This does not add a missing WriteConsoleOutputCharacterW API.

`test/test-console-stream-boundaries.js` failed before migration when the
character writer loaded unrelated `0xa5` backing instead of the next input
character. Its five frontend cases now pass all crossings of their byte/word
arrays, including split WORDs, row wrapping and clipping at the final screen
cell. Independent seeded cells verify the read results, and direct cell
checks verify writes plus preservation of the other cell half. The tests
also check untouched output tails, source/canary bytes, unrelated backing,
counts and stdcall cleanup. Existing streamed-output clipping, attribute-read
and A/W character-read suites pass. Logical-AND, tier and whitespace gates
pass. Rectangular CHAR_INFO/SMALL_RECT buffers remain separate follow-up work;
no Far browser or timing result is claimed.

## Rectangular console transfers migrated

The shared ReadConsoleOutputA/W and WriteConsoleOutputA/W cores now use
guest accessors for caller CHAR_INFO arrays and SMALL_RECT input/output.
Rectangle WORDs are explicitly sign-extended after guest reads; clipping
arithmetic and empty-rectangle policy are unchanged. Private screen cells
remain raw memory accesses. The writer selects only the A byte or W word
character read, avoiding eager reads of both widths.

The new `test/test-console-rectangle-boundaries.js` reproduced a split
ReadConsoleOutputA destination failure. All 288 cases now pass: four APIs,
11 CHAR_INFO-array crossings or seven SMALL_RECT crossings, and four geometry
cases (full, end clipping, negative-coordinate clipping, empty). Expected
screen cells and caller bytes are independent, with guards, untouched clipped
buffer areas, unrelated-page preservation and stdcall cleanup checked.
Existing rectangular-write clipping and screen-buffer identity/activation/
lifetime suites pass, as do logical-AND, tier and whitespace gates.

This covers these two transfer cores, not every console structure: scrolling,
cursor/screen information and other translated pointers still need inspection.
No Far browser session, global write-coverage certificate or performance
result is claimed.

## Cursor and screen information migrated

Get/SetConsoleCursorInfo retain caller guest addresses and use DWORD guest
accessors. GetConsoleScreenBufferInfo uses WORD/64-bit guest stores for its
22-byte output; the loaded window record remains private backing memory.
Handle/null validation, size range 1..100, visibility normalization, per-buffer
state and maximum-window calculations are unchanged.

The expanded `test/test-console-cursor-info.js` first reproduced a cursor
output failure at the first sparse-page split. It now covers all seven cursor
structure crossings for reads and writes, invalid-size state preservation,
and all 21 screen-info crossings against the aligned result. Guards, unrelated
physical backing and stdcall cleanup are checked. Existing cursor validation,
independent-buffer state, maximum-window and screen-buffer lifetime suites
pass, as do logical-AND, test-tier and whitespace gates.

Console scrolling/window rectangles, titles and other translated guest pointers
remain audit candidates. This is source-harness coverage, not a new native
Win98 comparison, Far browser run or performance measurement.

## Console viewport rectangle input migrated

SetConsoleWindowInfo now reads the caller's SMALL_RECT through guest WORD
loads with explicit signed extension. Private viewport storage, absolute and
relative coordinate arithmetic, validation and failure-state preservation are
unchanged. This closes an input-side counterpart of the output audit rather
than adding a dirty-write hook to private state.

`test/test-console-buffer-max-window.js` reproduced a valid rectangle being
rejected at sparse split 1. All seven crossings now pass four scenarios each:
absolute positioning, signed relative movement, rejected negative absolute
coordinates and rejected relative movement. Tests check the resulting viewport,
error 87 on rejection, unchanged caller bytes/guards and stdcall cleanup.
Existing maximum-window and screen-buffer state/activation/lifetime tests pass;
logical-AND and whitespace checks pass. Scroll structures and title strings
remain candidates; no new browser or performance result is claimed.

## Shared console title guest buffers migrated

SetConsoleTitleA/W now use lazy byte/WORD guest reads. GetConsoleTitleA/W
share one bounded copy loop with guest stores, including the terminator;
reads from private title storage remain raw. The previous ANSI memory.copy
assumed that the entire caller destination had contiguous physical backing.

The new `test/test-console-title-boundaries.js` failed before migration when
SetConsoleTitleA read unrelated backing bytes as title text after the first
page crossing. It now passes all source crossings for A/W strings (including
split UTF-16 characters and terminators), plus destination crossings with
capacities 0, 1, 2, 4 and 6. Expected bytes, untouched tails/guards, unrelated
backing and stdcall cleanup are checked. Existing screen-buffer/title tests,
logical-AND, test-tier and whitespace gates pass.

This deliberately preserves the existing shared ANSI storage and lossy wide
conversion; full Unicode/code-page title fidelity is still unproven and is
not certified by these tests. Scroll structures remain to migrate. No browser
or performance result is claimed.

## Console scrolling caller structures migrated

ScrollConsoleScreenBufferW now reads its source/optional clip SMALL_RECTs
through guest WORD loads with signed extension, and its CHAR_INFO fill through
guest WORD loads. Private screen character/attribute storage and the overlap
traversal, clipping, validation and fill rules are unchanged.

The expanded `test/test-console-scroll-buffer.js` reproduced rejection of a
valid source rectangle at sparse split 1. It now passes all seven source and
clip crossings and all three fill crossings, each with positive and negative
clip origins (34 cases). Independent expected characters/attributes check the
moved and filled cells, unchanged cells, caller bytes/guards, unrelated backing
and stdcall cleanup. Existing upward/downward/rightward overlap, off-screen
destination, inactive-buffer and error cases also pass, along with the separate
screen-buffer suite and logical-AND/whitespace checks.

A fresh `g2w`/`w2g` search of `09a2-handlers-console.wat` leaves only the
screen-buffer creation conversion of its own heap allocation to private
backing. That is a bounded pointer-site audit, not proof that every console
API or guest memory access elsewhere is correct. Browser verification, full
Unicode title fidelity and mapped-file dirty tracking remain open.

## Far browser Worker regression

`node test/test-far-console-web.js` serves a fresh source compilation through
the shared static-server helper without replacing the shared build artifact.
The only test-only WASM addition is a read-only active-console-record export.
The test launches the locally installed Far 1.70 candidate through the actual
debug dropdown with Worker mode enabled and a cross-origin-isolated page.

On 2026-09-22 the Chrome headless run passed: both panels contained `far.exe`
and the mounted language/help files, browser F9 input exposed the Left/Files/
Commands/Options/Right menu, and Enter opened Program Files with a visible
`..` console entry. No captured page error, API trap, layout mismatch or Worker
startup failure occurred. An initial test attempt timed out because the probe
used `wine.exports` instead of `wine.instance.exports`; the corrected probe
now also runs once outside the polling callback to expose such mistakes early.

This exercised the current shared worktree, including unrelated uncommitted
host changes; it is not a clean-commit benchmark. Assertions read the console
model, not rendered pixels. Mouse selection, pixel-level rendering, native
Win98 parity and performance still require their own evidence. The test skips
explicitly when Chrome or the locally installed candidate is absent.

### Mouse and painted-row follow-up

The Far browser test now finds the `app.exe` row, verifies its unselected dark
blue pixels on the screen canvas, and sends a real Puppeteer mouse click using
the window's client origin and canvas CSS scaling. It waits for over 500 teal
pixels in that row and independently checks `app.exe` in the panel's status
line. Home restores directory selection before the existing F9 and child/parent
navigation checks. The full route passed on 2026-09-22, with test-tier and
whitespace gates passing. No runtime code was changed for this follow-up.

This supersedes the earlier lack of mouse/pixel evidence for this specific
route, not for all console rendering: it is a targeted painted-row assertion,
not a full screenshot comparison, native Win98 oracle or timing measurement.

## Keyboard-layout caller outputs migrated

GetKeyboardLayoutNameA now uses guest DWORD/byte stores for its nine-byte
ASCIIZ result. GetKeyboardLayoutList uses a guest DWORD store for its HKL.
The existing single-US-layout policy and argument/return behavior are unchanged;
this does not implement additional layouts or certify all invalid-argument
semantics. Caller addresses no longer become one assumed-contiguous raw span.

`test/test-keyboard-layout-boundaries.js` reproduced the name write failing at
sparse split 1 before the fix. It now passes all eight name crossings and three
HKL crossings plus page-local controls. Tests check exact bytes/terminator,
capacity 0/1/2, query-only behavior, untouched capacity tails, NULL name rejection,
guards, unrelated backing and stdcall cleanup. Logical-AND, test-tier and
whitespace gates pass. Unlike the dirty-tracker fixtures, this is a production
pointer correction; it does not add the experimental dirty hook or close
mapped-file writeback. LoadKeyboardLayout input and other raw API buffers remain
separate audit candidates.

## Keyboard-layout input parser migrated

LoadKeyboardLayoutA now retains the guest address and uses byte guest reads
for its eight hexadecimal characters and terminating NUL. The current
single-installed-layout fallback, NULL handling and flags policy are unchanged.
The previous translated-span parser rejected a valid `00000409` input at
sparse split 1 in the new regression.

The expanded keyboard-layout test passes 90 input cases: eight crossings and
one page-local control, each with the valid ID, an invalid hexadecimal byte at
each of eight positions, and a missing terminator. It checks input/guard
preservation, unrelated backing and stdcall cleanup, plus NULL rejection.
The prior output tests and logical-AND/whitespace checks also pass. This fixes
addressing, not general keyboard-layout installation or native flags fidelity.

## Process-affinity output masks migrated

GetProcessAffinityMask now writes both caller DWORDs through gs32 rather than
raw translated stores. Existing current-process handle validation, optional
pointer handling, one-CPU masks and LastError behavior are unchanged.

The expanded `test/test-thread-affinity.js` reproduced a process-mask output
failure at split 1. Both output positions now pass three sparse crossings and
a page-local control with valid/invalid handles (16 cases). Exact output bytes,
guards, the other mask, unrelated backing, LastError and stdcall cleanup are
checked. Existing durable/pseudo process and thread handle, affinity-mask
validation and calling-thread identity cases also pass, as do logical-AND and
whitespace checks. This is caller-addressing coverage, not proof of every NULL
pointer/OS-version affinity behavior or an implementation of multiple CPUs.

## FormatMessageW allocated-pointer output migrated

The allocated-buffer pointer now uses gs32 rather than a raw translated DWORD
store. The existing wide_to_ansi/ansi_to_wide converters already use guest
accessors; their direct caller buffers need no additional migration here.
Private heap-backed ANSI staging and formatting semantics are unchanged.

`test/test-format-message-boundaries.js` covers three pointer-slot crossings
and a page-local control, plus eleven UTF-16 byte crossings and a control for
each of the template and direct-output paths (28 cases). It checks the returned
allocation's complete text, caller guards, unrelated backing, input preservation
and stdcall cleanup. Restoring the old store makes the split-1 pointer resolve
to zero bytes instead of the expected text; the fixed version passes. The
existing insert-language suite passes 21 checks. Logical-AND, tier membership
and whitespace checks pass. This is addressing coverage, not a claim of native
Unicode, small-buffer, allocation-failure or full FormatMessage flag fidelity.
