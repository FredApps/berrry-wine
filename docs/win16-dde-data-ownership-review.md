# Win16 DDE incoming transaction ownership

2026-09-22: fixed two data-handle leaks in `win16_dde_deliver` on main.

The POKE/EXECUTE/ADVSTART branch used `select(data_take(...), 0, is_poke)`.
WebAssembly evaluates both operands: EXECUTE and ADVSTART allocated a handle
and discarded it. Sixteen transactions exhausted the entire data pool.
Separately, a POKE allocated data before attempting to enqueue its callback;
a full four-entry callback queue rejected the callback without freeing data.

Allocation is now conditional on POKE. Ownership transfers only when the
callback queue accepts it; rejection frees the newly allocated handle.
The existing callback completion path continues to reclaim accepted data.

`node test/test-win16-dde-data-ownership.js` calls the real frame delivery and
callback-completion helpers, with a seeded conversation. Before the fix it
reported 16 leaked handles for each non-data transaction kind, 16 live handles
for four queued POKEs, and 12 remaining after callback completion. After the
fix all pass, including payload bytes and 64 further POKE/reclaim cycles.

Fragment balance, API hash table, handler ESP/epilogue checks, test-tier
membership, whitespace, silent-stub pin (247 manual + 22 metadata), and
duplicate census (131 groups / 509 members) pass.

The broader `test-win16-dde-room.js` and `test-win16-dde-connect-callback.js`
both trap at connection setup, before this transaction branch. Repeating
each with only this fragment replaced in memory by its pre-change HEAD
contents reproduces the same `unreachable` stack (functions 8109, 8400, 776,
9863). Thus these suites are **not passing** in the shared worktree; the
failure is independent of this patch. No shared files were reverted for the
control runs. Investigating that connection-pump failure is a next candidate.

## Follow-up: connection-pump trap resolved

Compiling the same source closure with its diagnostic name section identified
the failing function as `win16_enter_wndproc`. The existing `DBG_INV=1` trace
showed a null procedure, window 15 and `WM_SIZE` immediately after the DDE
callback returned. `WIN16_DDE_CB` and `WIN16_CONT_CREATE_SIZE` both occupied
offset `0xFF80` in `WIN16_THUNK_SEL`; `win16_dispatch` handles the latter first.
It consequently interpreted a DDE return as a CreateWindow stack continuation.

Moved the DDE callback to the unused offset `0xFF84`. This changes only an
emulator-private return address, not the guest DDE API. The new
`test/test-win16-thunk-offsets.js` inspects the source manifest's constant
Win16 globals in the reserved `0xFF00..0xFFFF` range and rejects duplicate
offsets. It fails on the old collision and passes with 25 unique entries.
It is a unit regression, not a complete parser for arbitrary computed slot
definitions or an allocator for future continuation slots.

After this fix the real Win16 task/loopback tests pass: room routing 18/18,
connect callbacks and transactions 25/25. The earlier failure above is retained
as the investigation history, not the current outcome. No browser or native
Windows capture was needed to establish this internal address collision.

This is an internal ownership regression, not a native Win98 conformance
capture or an end-to-end Hearts gameplay claim. EXECUTE's existing callback
argument representation is unchanged and still needs separate review. Also
open: malformed frame lengths, pool exhaustion behavior, string-handle
ownership, other queue-producing branches, and eager-select trace reads.
