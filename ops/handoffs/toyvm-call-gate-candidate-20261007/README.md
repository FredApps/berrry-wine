# ToyVM call-gate candidate: 31 instruction contracts passed, review pending

Base: `8d9a181de9b15758108967b99a1d5d88f8d89d63`. This is a review candidate,
not a native-game qualification or a completed paging/exception implementation.

The same new fixture against exact original source reached selector43,
base00000008, offset4567 instead of the gate's selector08/base00080000/offset0400.
Setup was validated and the expected target assertion failed. Candidate source
then passed all31 cases. Session11369 completed in2.090s at
2026-10-07T11:33:43.642Z; children2590470/2590502 closed without signals and were
independently absent afterward. No browser or proprietary executable ran.

Modules:

- Before: `87af3919dccdbaebe7779b9f48f414489f98de40c34689ed94d600975fb05fd4`.
- Candidate: `ca098e31409539287cebf8188417f0f9867c0e03447f2fbe094e28faf53906a8`.

The candidate validates CALL gates and complete frames before mutation, stages
parameters before overlapping writes, uses gate width independently of target
code width, and restores outer privilege/stack state through RETF. SS/TR/LDTR
metadata is cached on loads. Invalid cases stop with a reason/selector and
`exceptionDelivered:false`; they do not fabricate an architectural exception.

Test IDs in `candidate.json`:

- `direct16`, `direct32`, `memory16`, `memory32` × `same`/`ring3` × zero/two
  parameters:16 passed, including actual guest CALL/frame/RETF/flags checks.
- LDT gate plus SS/TR/LDTR table mutation after load:4 passed.
- Gate present/privilege, target type/present/limit, TSS limit/new-stack
  privilege/space, old parameter span:9 explicit-stop contracts passed.
- Null return selector, same/outer RETF:2 explicit-stop contracts passed.

CPL3 initialization is a labelled synthetic CPU-fixture state. The same-CPL
tests bootstrap through real COM instructions. No IRET bootstrap or game state
was synthesized. The old baseline fixtures remain immutable; this positive
fixture replaces its own PUSHFD/POP carry check with SETC/MOVZX so it does not
overwrite the below-frame sentinel before checking it.

Remaining review/gates before integration:

1. **Backend cached-base gap:** `region-live.js:carryState` currently replays
   `set_ss`, resolving its base against the live GDT. New cached access/limit
   fields survive its second MACHINE_STATE copy, but the shared REGFILE_SEGB
   base can still change after a descriptor edit. Add a real two-instance
   mutation/carry regression and preserve the original cached segment base
   before claiming backend safety. This candidate has not fixed that path.
2. Run adjacent real instruction regressions, under a serialized bound:
   `test/test-toyvm-far-pointer-loads.js`, `test/test-toyvm-operand-patch.js`,
   `test/test-toyvm-ip-width.js`, `test/test-toyvm-pm-timer-vector.js`.
   Add explicit real/VM86 far CALL/RETF controls if existing coverage is not
   sufficient. The normal real/VM86 fallback bodies were retained.
3. Run module layout/MACHINE_STATE and backend tests; protected far transfers
   already decline µop lowering in `uop-x86.js`, rather than bypassing L1.
   `test/test-toyvm-uop-only.js` is a larger functional suite and needs its own
   adequate runtime bound, not an unbounded run during another game lease.
4. Regenerate/check both browser bundles and run
   `test/test-toyvm-browser-bundle.js`. The bundler discovers `pm-transfer.js`
   through the literal require, but generated bundles have not been updated
   in this review candidate. No shipped browser artifact is claimed current.
5. Type4 gates, 16-bit stacks, maximum31 parameters, conforming targets,
   overlapping stacks and outer segment clearing need additional focused
   coverage before expanding claims beyond the31 tested cases.

Explicit remaining architecture limitations: protected exception delivery,
outer IRET, paging, task switching, JMP gates, general direct-code CALL
protection and LTR protection/busy-bit semantics. 286 TSS, wrapped/aliased/video
metadata or stack spans stop explicitly. Daggerfall's captured CPL3 with SS30
(DPL0/RPL0) is inconsistent before the gate and may expose its earlier stack
transition prerequisite; passing valid synthetic gate tests does not clear it.

Private supervisor/READY and preserved full logs:
`scratch/toyvm-dos-native-20261007/call-gate-candidate/`.
This folder retains portable test results, cleanup and exact source hashes,
not WASM binaries or game assets. New test name follows the ordinary UNIT tier
rule in `tools/test-tiers.js`; there is no second manual tier list to update.
