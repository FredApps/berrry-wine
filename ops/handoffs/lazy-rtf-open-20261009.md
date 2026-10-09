# Lazy RTF opens

Original Dungeon Siege startup on main `bab6e2494` reached EULA.RTF and trapped
at EIP`0xc35ac0`. CreateFile's stylesheet-expansion compatibility code touched
`entry.data` on an async-only provider. Before evidence:
`scratch/runs/20261009T0110Z-dungeon-siege-lazy-rtf`.

CreateFileA/W now return the internal pending result997 and retain their guest
stack frame/EIP while the complete RTF is materialized. The existing expansion
still supplies the handle's read view and size; original stored bytes remain
unchanged. Ordinary lazy file opens still perform no fetch. This is on-demand
materialization of an existing whole-file consumer, not a manifest preload.

The result import carries the actual calling thread ID. Pending opens are
thread-owned, provisional validation handles are closed before waiting, and
the retry revalidates the current namespace. Failed fills complete with
ERROR_READ_FAULT, with explicit GameWait retries still possible. The pending
provider preserves the game-data flag, so the existing delayed Loading UI and
Retry/Quit behavior apply. No change to the500ms display threshold.

Validation on the separate no-env box `bx_f8a9afpr`:

- Canonical build and host-signature gates pass.
- `test-rtf-lazy-open.js`: ANSI/Unicode, read-view parity, untouched source
  bytes, bounded cache, no retained provisional handle, failures, retries,
  thread retirement, replacement/deletion and ordinary lazy opens.
- `test-wat-rtf-open-park.js`: actual calling thread, retained seven-argument
  frame, original thunk EIP, success cleanup and terminal read fault.
- Existing45 VFS,50 lazy-entry, and stylesheet checks pass.
- The lazy-entry worker fixture needed its existing GPU-write-fence dependency
  declared; it has no GPU resources. The production fence was not modified.

The handle-only legacy host import still requires resident RTF data, as before;
this change migrates the Win32 CreateFileA/W result ABI. It does not claim a
complete audit of every whole-file consumer or qualify gameplay/FPS/audio.
Native proof is sealed in `scratch/runs/20261009T0122Z-lazy-rtf-open`.
The original Dungeon Siege browser run now renders its demo license window;
EULA.RTF remains lazy in the unchanged manifest. Accept was left untouched
under the user instruction not to answer approvals; user decision requested.
This proves the prior file-open crash is cleared, not gameplay.
