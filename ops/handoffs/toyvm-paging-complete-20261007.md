# TOYVM-386-PAGING-20261007 completed implementation

Ready for root review and integration; no push or shared HEAD/index modification. Worktree `/home/user/wt-toyvm-paging-integrate-20261007`, branch `codex/toyvm-paging-integrate-20261007`, base `67257495774e3cf77f58c1a2f6b5a8504d570645`. Apply foundation `f9cea3d24` (local cherry-pick of reviewed `5afd1bd612cca3d3a621bcaaf7e599ec2e95fc11`) before this implementation commit. Native slot released on the board at 23:24:48 UTC; no further native jobs planned.

## Result and architecture

The reviewed 386 walker is now wired into reached instruction fetch, scalar and REP operands, stack/FPU operands, descriptor/system/interrupt reads, and guest buffers used by DOS/BIOS services. Production page-table accesses retain physical RAM/device/A20 behavior. Paged linear addresses never use a modulo-RAM alias. RAM capacity remains unchanged.

`paging-exec.js` executes one reached instruction using checked fetches, avoiding speculative next-instruction page faults. CR0/CR3 transitions invalidate cached execution, including same-value CR3 reloads. Paged execution bypasses optimized caches; fresh entry, already-active blocks, resumed blocks, standalone trace code, and the WASM decoder return before unsupported paged execution. Fetching afresh handles remapping and physical code aliases.

Instruction checkpoints preserve CPU registers, lazy flags, machine/FPU state, and device controller state. Byte journals restore partial RAM/VGA stores on faults; each completed REP iteration advances the checkpoint. Scalar operands freeze translated physical addresses before storing, including self-mapping PTE operands. Fault delivery supplies CR2, correct error codes, restart IP and RF, privilege-transition/TSS stacks, V86 frames, and guest IRET restart. Software INT and external interrupt origins are distinguished from exceptions. Nested contributory/page faults use architectural double-fault classification. Existing unsupported task-gate transfers still stop explicitly; this change does not claim implementation of the separate 386 task-switch instruction subsystem.

The original installer also exposed a generic POP memory-destination bug: `[ESP+8]` was evaluated before POP incremented ESP. Both widths now evaluate it after the increment; destination page faults still restore the original ESP. The retained trace demonstrates the causal sequence at CS8:7b8b/7b91 leading to RETFD at 7b99. This is an ISA correction with dedicated regression coverage.

## Acceptance

Evidence root: `/home/user/wine-assembly/scratch/runs/20261007T221000Z-toyvm-paging-integration/`.

`final6/validate-full.js` passed all 47 serialized bounded groups: 41 ToyVM test scripts, the copied unchanged root CR3 regression, and five tool checks. Every supervisor receipt records the actual child exit and process/group cleanup. `final6/full-validation-summary.json` records source-pins SHA-256 `f1d3b01eb3dcbb02d417a604a0b263148a476d9b0c6b02c30e532b4745ea07e5`.

Actual DOS-loaded COMs cover all four interpreter variants (tailcall, switch, calls, repl_tailcall), optimized entry/resume paths, noncontiguous high copying and fetch, not-present and CPL3 protected faults with guest frame inspection/repair/IRET, CR3 remapping, physical aliases, REP partial progress, nonpaged/A20 behavior, and transitions back to normal DOS exit. Additional instruction fixtures cover system-page crossings, V86 faults, double faults, software/external origins, POP restart, self-mapping stores and VGA rollback/latch behavior. The reviewed primitive retains its 192 permission checks and 28 correctness groups.

Both browser bundles were regenerated and reproducibility checked: live 43 modules and JIT 42 modules (43-module union). The extra live module is the required paging executor. No browser qualification, remote execution, performance benchmark or public deployment was performed.

## Unchanged original Comanche installer

`original/run.js` used the reviewed bounded supervisor and original media, with source pins checked before execution and all media hashes checked before/after. Run limits were 75 seconds wall time and a six-guest-second dispatch budget, no automatic keys, binary patches or forced guest state. Final child 3385159 exited zero; streams closed and PID/group were independently absent before native release.

At 157321 dispatches, the authenticated INSTALL.BIN `[c97d,1097d)` 16 KiB chunk SHA-256 `a1014f71d8f0305296e65efa9c1062ce6df6868cce4c7623491846c7367770c8` reached linear `10000000` through physical pages `110000`, `114000`, `115000`, `116000`. `original/copy-proof.json` and `actual-mapped-copy.bin` prove the exact bytes and unchanged IVT. Other low-memory updates occurred; the entire low 16 KiB is not claimed unchanged.

The run subsequently reached 48699083 dispatches / 4.863303035668871 guest seconds and printed `Loading Install ...`. No CPU fault, unimplemented instruction, unhandled condition or protected-transfer stop was recorded. The normal configured 75-second wall cap ended execution. The screenshot was visually inspected and shows this console progress. Installation completion, installer UI and gameplay remain unverified; this acceptance proves progress beyond the authenticated IVT-corruption point.

Original INSTALL.EXE SHA-256: `5a5ff6d376642d83ac9b049be952c64deb8898d09b593a0fb90083fed26e9cbb`. Original INSTALL.BIN SHA-256: `2bc752ed8feada4f33c78d73e6f036f935f6903af71513bb9fdeb808e138ccf8`. The self-contained run preserves original media, exact source closure, generated WAT/WASM, guest COMs, logs, receipts, traces, RAM snapshots and earlier failed attempts. No unrelated dashboard candidate is credited.

## Primary architectural references

- [Intel 80386 PRM paging](https://www.scs.stanford.edu/05au-cs240c/lab/i386/s05_02.htm)
- [Protection](https://pdos.csail.mit.edu/6.828/2018/readings/i386/s06_04.htm)
- [Exceptions, page faults and double faults](https://www.scs.stanford.edu/05au-cs240c/lab/i386/s09_08.htm)
- [Exception error codes](https://www.scs.stanford.edu/05au-cs240c/lab/i386/s09_07.htm)
- [Resume flag](https://www.scs.stanford.edu/05au-cs240c/lab/i386/s12_03.htm)
- [IRET](https://www.scs.stanford.edu/05au-cs240c/lab/i386/IRET.htm)
- [Intel instruction reference, POP ESP destination ordering](https://cdrdv2-public.intel.com/671110/325383-sdm-vol-2abcd.pdf)
