# Review P5-8: core handler fragment split

2026-09-19: replace the 8,759-line `09a-handlers.wat` monolith with six
contiguous, ordered fragments. No functions, data, globals, layouts or
comments are reordered or rewritten; concatenation differs by one blank line.

| Fragment | Lines | Contents |
|---|---:|---|
| `09a-handlers.wat` | 847 | ABI layouts, timer and posted-message queue helpers |
| `09a-handlers0-sound.wat` | 201 | PlaySound/sndPlaySound shared implementation |
| `09a-handlers1-user.wat` | 2,950 | USER/window/dialog, shell and common-dialog APIs |
| `09a-handlers2-runtime.wat` | 1,588 | Legacy CRT/string, registry/heap and paint/clipboard APIs |
| `09a-handlers3-sync.wat` | 1,168 | Process/thread APIs and synchronization |
| `09a-handlers4-late.wat` | 2,004 | Pointer probes, late USER/GDI, IME and character conversion |

The older API-number ordering mixes some subsystems. These are honest
contiguous splits, not a claim that every API now lives beside its family.
`main.watx` remains the only include-order authority. Four affected region
owners move with their symbols; region layouts and generated mirrors do not
change. CLAUDE's source map and API-addition guidance now point at subsystem
fragments instead of directing everything into one monolith.

## Gates and verification

- Full-source before/after compilation produces **identical WASM bytes** for
  both tail-call and compatibility modes (1,441,967 / 1,442,873 bytes in the
  paired snapshot). Baseline compilation substitutes the old monolith and
  empty new fragments in memory; shared source is never restored over edits.
- Filename-sensitive duplicate identities move with their existing symbols:
  33 allowed-member paths change, with no membership/cap increase. The gate
  remains at 144 exact groups and 551 live / 552 allowed members.
- All six pre-existing raw-region literals move together to the USER
  fragment; the per-file bucket is renamed, not expanded. Initial builds
  correctly failed until both path migrations were explicit.
- The silent-handler digest includes filenames too. Its hash is updated for
  the moves with the same **266** handlers and unchanged bodies; no quiet API
  is introduced. Unrelated existing comment edits in that gate are not part
  of this commit.
- The final full build passes all gates and canonical/compat compilation
  (`/private/tmp/wa-core-split-build4.log`).
- Format-frontdoor, GlobalCompact and region-owner test source references
  follow the moved symbols. The union-gate negative fixture already had a
  stale bitmap source reference before this split; it now mutates the actual
  cursor/icon fragment, restoring its intended reserved-field test.
- Format-frontdoor, GlobalCompact, union-gate (38 checks), region-owner
  (18 checks / 206 owners), PlaySound (27/27) and timer-message-pump tests pass.

Local logs: `/private/tmp/wa-core-split-equivalence.log`,
`wa-core-split-build{,2,3}.log`, `wa-core-split-format.log`,
`wa-core-split-compact.log`, `wa-core-split-union.log`,
`wa-core-split-owners.log`, `wa-core-split-sound.log`, `wa-core-split-timer.log`.

The original 09a and large 09c3 wndproc monoliths are now split. Other large
subsystem files (notably OLE and DirectX) and the six existing raw literals
remain separate cleanup candidates. No API behavior or performance change
is claimed.
