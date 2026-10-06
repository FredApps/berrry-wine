# Anonymous pipes and child standard handles

Task `PROCESS-PIPE-STDIO-WINBOARD`. WinBoard (`lib/apps.js` id `winboard`, run
as `-cp -fcp GNUChess -scp GNUChess`) traps in `CreatePipe` at startup: it
makes two anonymous pipes, starts `GNUChess.exe` with them as the child's
stdin/stdout (`STARTF_USESTDHANDLES`), and talks the xboard protocol over them.
`GNUChess.exe` is a plain MSVC console program: `GetStdHandle`, `ReadFile`,
`PeekNamedPipe` (it polls stdin), `SetStdHandle`. The Cygwin build beside it
(`GNUChes5.exe`) is not on this route.

The goal is the real thing: ordered bytes between two guest processes, with
Windows' blocking, EOF and broken-pipe rules, and no protocol simulation.

## What exists today (2026-10-06, origin/main)

- `CreatePipe` / `PeekNamedPipe` are fail-fast stubs
  (`src/09a0b-handlers-base-late.wat`).
- **There is no child process.** `CreateProcessA` (same file) forwards the
  command line to `host_shell_execute` and writes constant
  `PROCESS_INFORMATION` values (hProcess `0xE3001`, pid `0x3001`). It ignores
  `bInheritHandles` and `STARTUPINFO`. Headless it launches nothing; the
  browser boots an unrelated app with its own memory and a VFS snapshot, no
  link back.
- Consequently: a wait on that hProcess is signalled at once (it is no known
  handle), `GetExitCodeProcess` returns 0 for it, and `TerminateProcess`
  calls `host_exit` on **the caller** — a parent killing its engine kills
  itself.
- No unified handle table: each kind owns a value range (console aliases
  `0x0032xxxx`, buffers `0x0031xxxx`, sync `0xE0000+`, threads `0xE1000+`,
  VFS files `0x70000001+`) and every API tests them in order.
- Reusable pieces: the virtual-LAN stream socket ring
  (`$vsock_ring_write/read`, FIN/RST, read-ready, blocking send on a full
  peer, 16KB windowed `vln/1` DATA/FIN/WINDOW frames, in-process peer index or
  cross-instance `peer=-2`) in `src/09d-winsock.wat`; the park-and-re-enter
  blocking of `$io_block` (yield 12) and `$vsock_block` (yield 8), which both
  backends already service.

### What the two programs actually import

Measured with `tools/pe-imports.js --all` (KERNEL32, filtered):

- `winboard.exe`: `CreatePipe CreateProcessA DuplicateHandle CreateThread
  ReadFile WriteFile CloseHandle` — **no** `WaitForSingleObject`,
  `GetExitCodeProcess` or `TerminateProcess`, so Phase 3 below is
  correctness work, not on WinBoard's critical path.
- `GNUChess.exe`: `GetStdHandle SetStdHandle ReadFile WriteFile PeekNamedPipe
  GetFileType SetFilePointer FlushFileBuffers SetEndOfFile CloseHandle
  TerminateProcess(GetCurrentProcess) ExitProcess`. Its CRT classifies the std
  handles with `GetFileType`, so a pipe must answer `FILE_TYPE_PIPE`; and
  `SetFilePointer` / `FlushFileBuffers` on a pipe need Windows' answers
  (not yet implemented for pipes; measure what GNUChess's CRT does with the
  answer before choosing one).
- Neither imports `Get/SetHandleInformation`; no new API ids are needed for
  Phase 1.

## Design

### Phase 1 — pipe objects inside one process (built: `src/09d7-pipes.wat`)

A pipe is a connected pair of the virtual-LAN stream records
(`$VSOCK_TABLE`), like `socketpair()`: the read end's record owns the ring,
the write end's record names it as its peer. Destroying the write record
gives the reader an orderly EOF, destroying the read record leaves the writer
peerless, and phase 2's cross-instance end is a record whose peer is across
the wire (`peer = -2`) — the transport the virtual LAN already has.

- **No new region.** The map below `0x08000000` is at its shake ceiling
  (`tools/region-alloc.js --shake-all` reports two modes with 0 bytes free,
  and even a 1 KB region broke them). A pipe record has no address and is never
  a listener, so the handle bookkeeping lives in socket fields it does not
  use: `proto` marks the record as a pipe end, `backlog` says which end,
  `acc_queue[k]` holds open/inherit flags for up to 13 handles per end, and
  the address fields hold a parked write's progress.
- Handles: tag `0x0033xxxx` = `TAG | record << 4 | k`. `DuplicateHandle`
  opens another `k` on the same record (and honours `bInheritHandle` and
  `DUPLICATE_CLOSE_SOURCE`); the record is destroyed when its last handle
  closes. A tagged handle that is not open is `ERROR_INVALID_HANDLE`.
- Inherit flag per handle, from `SECURITY_ATTRIBUTES.bInheritHandle` or
  `DuplicateHandle`.
- `ReadFile` on a read end: copy `min(len, available)` (partial reads are
  normal); empty with a live writer → park via `$io_block` and re-enter; empty
  with every writer closed → FALSE, `ERROR_BROKEN_PIPE` (109), 0 bytes.
- `WriteFile` on a write end: all readers closed → FALSE, `ERROR_NO_DATA`
  (232); else copy what fits and park for the rest (Windows blocks until the
  whole buffer is written).
- `PeekNamedPipe`: optional copy without consuming, `lpTotalBytesAvail`,
  `lpBytesLeftThisMessage` = 0; on a closed writer with nothing buffered,
  FALSE + 109.
- `CloseHandle` drops one endpoint ref and wakes the other side;
  `GetFileType` → `FILE_TYPE_PIPE` (3); `DuplicateHandle` adds a ref (and
  honours `DUPLICATE_CLOSE_SOURCE`). `GetHandleInformation` /
  `SetHandleInformation` are appended to `api_table.json` if a route needs
  them.

Every check is placed before the VFS fallback in each API, so files, consoles
and sockets keep their paths.

### Phase 2 — a real child process with inherited standard handles

`CreateProcessA` for a PE present in the VFS starts a **second guest
process**: its own WASM instance and memory, booted through
`lib/process-boot.js`, run by the same host loop.

- Pipes now cross memories, so an endpoint can be *remote*: the bytes travel
  as `pip/1` frames (DATA, CLOSE, WINDOW — the `vln/1` flow-control shape) on
  a private wire between the two instances (`lib/vlan-wire.js`'s loopback
  segment in one JS host). Local and remote ends share the Phase 1 semantics;
  only the transport differs.
- Inheritance: with `bInheritHandles` and `STARTF_USESTDHANDLES`, the child's
  std-handle table (`$console_std_handle_set`) is seeded with remote
  endpoints before its entry point runs. Only handles flagged inheritable
  are passed; a parent's non-inheritable duplicate (WinBoard's pattern) stays
  the parent's, so closing it is what lets the child see EOF.
- CLI: `test/run.js` hosts the child instance in-process and steps it with
  the parent. Browser: the same boot path, with the child in `runningApps`
  and the wire joined at launch instead of a detached `launchVfsExe`.

### Phase 3 — the process object

`hProcess` becomes a real kernel object: waitable (signalled at child exit),
`GetExitCodeProcess` returns `STILL_ACTIVE` then the exit code,
`TerminateProcess(hChild)` stops the child and never the caller, and the pid
is unique. Child exit closes its endpoints, so the parent's next read sees
`ERROR_BROKEN_PIPE`.

## Regression plan

Per phase, before its commit:

1. Phase 1: a unit test driving the handlers directly (render-helper
   harness) — ordered bytes, partial read, peek without consume, EOF after the
   last writer closes (including a duplicate keeping it open), broken pipe on
   write, `GetFileType`, bad handle → `ERROR_INVALID_HANDLE`; and a two-thread
   test in both backends (a reader thread parked in `ReadFile` is woken by a
   write from main). Re-run `test-read-file-ex`, `test-io-wait-threads`,
   `test-worker-thread-scheduler`, `test-queue-user-apc` and the console
   tests.
2. Phase 2: a two-process test with small hand-built PEs (parent writes,
   child echoes, parent reads; child exit → EOF) in the CLI; then WinBoard to
   its board with GNUChess started (no trap).
3. Phase 3: wait/exit-code/terminate tests; then the Done route — a normal
   human move in WinBoard and GNUChess's own reply on the board, reviewed
   screenshots, CLI and browser.

Nothing here may answer for GNUChess, drop the engine, or return success
where a transport is missing.
