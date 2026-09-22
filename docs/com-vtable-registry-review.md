# One COM vtable initialization/restore inventory — 2026-09-22

The worker-sync test was stale: it called DirectSound3DListener the last
registered interface, although more interfaces had been appended. Its old
assertion reproduced a failure with expected 1358972416 versus actual
1358970624. Updating that one name would leave the same maintenance trap.

The production code also mirrored the generator's interface order manually:
`09a8-handlers-directx.wat` declared a literal registry count and a 71-global
restore list. `gen_dispatch.js` now emits both from the same filtered COM
interface inventory used for `init_dx_com_thunks`. The count and restore
function move into `09b2-dispatch-table.generated.wat`; their old manual
definitions are removed. Parsed WAT forms before/after are identical for
both the count and restore function: no current slot or instruction changes.
The existing memory-map test still verifies registry allocation capacity.

`test-dx-vtable-worker-sync.js` derives its list from the generated initializer,
not the restore function it tests. It now checks all 71 globals:

- incomplete publication leaves every global uninitialized;
- a complete synthetic registry restores the unique value for every slot;
- real initialization publishes nonzero pointers matching the main globals;
- a second WASM instance over shared memory starts with zero private globals
  and restores every published pointer through `init_thread`.

A negative control removed the final restore assignment only in the test
compiler's input. The new test failed at `DX_VTBL_DIDEV7`, slot 70, with zero
instead of its seeded pointer. No production file or artifact was changed
for this negative control.

The DirectSound3D source check reads the generated restore/count definitions
at their new home. Existing slot-55 ABI assertions remain, rather than
silently weakening that separate compatibility check.

Verification passes: full worker-sync test, DirectSound3D Web Audio mapping,
DirectPlay4/Lobby3 generated ABI and worker registry tests, memory-map
capacity, generator freshness, 107-fragment balance, logical operands,
test-tier discovery and whitespace. The second-instance test is not a
simultaneously executing worker stress test, and this change does not claim
to fix registry publication races or make the entire COM subsystem complete.
