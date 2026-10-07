# Comanche 3 original installer: later execution

Worker `codex:comanche-startup-worker` uses isolated branch
`codex/comanche-startup-20261007`, based on remote main `4091453a`.
All 94 files in the previous worker's final source receipt match this
checkout byte for byte. The shared checkout's HEAD and index are untouched.

The previous original-media run retired 50,024,516 dispatches, or
4.995667 guest seconds, and ended by dispatch budget. Its reported real-mode
CS:IP was `4b4b:44bd`, with no fault, unimplemented call, exit or payload.
That is a budget-limited black capture, not proof of a hang.

The last logged original INT21 read returned `4000` bytes through the
extender thunk at `0540:4c81`. The immutable original INSTALL.BIN inner MZ
image begins at `05ed`, with original CS `0385`: file address is
`05ed + 3850 + IP`. At IP `4c7f` the code invokes INT21; at `4c81` it
executes `movzx esp,sp`, saves EAX/flags, sets AX to one and calls the
CS-relative function pointer at `4a43`. The static disassembly alone does
not authenticate the later bytes at `4b4b:44bd` or establish why execution
is in real mode there.

## Diagnostic prepared

Local artifacts: `/home/user/wt-comanche-startup-20261007/scratch/comanche-startup/`.
`prepare.js` checks the 94 source hashes and preserves the media receipt;
`child.js` passively wraps `DosSession.step`, restoring it on completion;
`run.js` supervises a fresh child process group. The observer captures every
half guest second, with registers (including full general registers),
instruction bytes, stack bytes, changed low-memory pages, console/video
memory hashes, open-file cursors and in-memory file lengths. It also maps
the active arena instruction through the compiled program's `wordIp` map:
the reported guest IP can remain at a trace entry while a hot loop executes.
An arena word mapped to the nearest earlier instruction is labelled as
such and is not an instruction-by-instruction trace.

No input is supplied, no guest binary is changed, and guest file writes stay
in memory. Output comprises bounded JSON, a one-MiB low-memory image and a
PNG. The inherited supervisor limits stdout/stderr to four MiB, checks the
two-GiB disk floor and closes the child group at the total 90-second limit.
Source/media hashes are verified before execution; all five media hashes
are checked again afterward. Initial execution is bounded to six guest
seconds. One further run of at most 30 guest seconds is permitted only when
the first samples demonstrate advancing work.

The gate initially required `scratch/fresh-workers-20261007/arx-allocation-exit.json`
and the recorded driver PID to be absent. Its refusal before creating an
attempt directory passed. Root granted a local window on the append-only
messageboard at `2026-10-07T21:25:36+00:00`; the runner's explicit
`--root-slot-granted` path verifies that exact grant. All eleven Arx local
receipts had exit zero, no guard error and absent groups; their PIDs and
process groups were independently verified absent before execution.

Prepared command after the resource release:

```sh
node /home/user/wt-comanche-startup-20261007/scratch/comanche-startup/run.js sampled-six 6 --root-slot-granted
```

## Actual later state: paging copy corrupts the IVT

`sampled-six` retired 60,121,272 dispatches / 6.003973 guest seconds in
7.937462 guest-execution wall seconds. From the half-second sample onward,
CS is `4b4b` and every captured instruction byte is zero: execution decodes
`add [bx+si],al`, walking through the zero-filled segment and wrapping IP.
General registers, stack, file cursor `67965`, empty temporary file, text
memory and video mode stay fixed. Only low-memory pages zero (BIOS clock)
and `12000` (the repeated ADD destination) change between later samples.
This establishes derailment rather than advancing installation. The
conditional longer run was therefore not taken.

`first-zero-transfer` adds a bounded 96-entry ring of passive instruction,
register, segment-base and stack observations; it runs only half a guest
second. Its seam records the first `4b4b:4b4b` entry at dispatch 152,459.
Immediately before it, the timer path traverses:

```
8:4f7e -> 8:6aca -> 540:695c -> 540:68dd (INT8)
-> 0000:0000 -> 0000:3ae3 (INT d7) -> 4b4b:4b4b
```

The additional `irq-origin` run is bounded to 0.03 guest seconds and uses
the existing IRQ trace hook. It confirms `vec=08 timer at=152402 hb=335
t=0.015220 from 8:4f7e`, rather than assuming the interrupt was a CPU fault.

Original instructions at `4f64` perform address-size-32 REP MOVSD, copying
the first `4000`-byte read from linear `10000` to `10000000`. Afterward ESI
is `14000`, EDI is `10004000`, and CR0 is `80000011`. The mode-switch thunk
temporarily clears paging/protection for DOS and restores those bits; the
observer confirms both states. The instruction trace identifies the copied
buffer, rather than inferring corruption from a black screenshot.

The seam image's entire physical `[0,4000)` equals `[10000,14000)` and
unchanged INSTALL.BIN bytes `[c97d,1097d)`. All three SHA-256 hashes are
`a1014f71d8f0305296e65efa9c1062ce6df6868cce4c7623491846c7367770c8`.
The IVT's first bytes are now `ff25080a...`, and INT8's vector is zero;
the incidental INT d7 vector resolves to `4b4b:4b4b`. This explains the
observed route into zero-filled memory.

Source explicitly retains only CR0, drops CR3 writes, returns zero for
CR3 reads, and provides no page-table walker (`emit.js`, `mov_cr_r`,
`mov_r_cr`, `$lin`). `$lin` masks with `LIN_MASK_FLAT=00ffffff`; REP's
physical destination therefore becomes zero for linear `10000000`.
The original guest enables paging and uses an address outside that mask.
This is a missing architectural capability, not insufficient dispatch
budget or evidence that the memory-accounting repair was wrong.

The next dependency is generic 386 paging: retain CR3, translate linear
addresses through guest PDE/PTE tables, raise architectural page faults,
and make instruction fetch, scalar/REP memory accesses, descriptor/interrupt
reads and cache invalidation agree on that translation. Regressions must
cover high-linear mapped copies without IVT aliasing, cross-page accesses,
missing/protected pages and CR3 changes before validating the unchanged
installer again. No partial page-walker, forced CR0 state, increased
capacity or installer-byte patch was introduced in this investigation.

All three child groups terminated normally; stdout/stderr closed; driver and
child PIDs were verified absent. All five original media hashes stayed
unchanged, and final available disk was at least 4,472,856,576 bytes.
Reviewed `sampled-six/installer.png` is black. No first UI, ordinary input,
installed payload, launch or gameplay is claimed. All evidence and exact
per-attempt observer drivers remain local in the artifact directory above.
The small committed evidence index is
`comanche3-later-execution-evidence-20261007.json`.
