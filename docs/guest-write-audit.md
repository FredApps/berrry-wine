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
