# MIG-SAM read-only integration review

Worker `/root/serious_review`, 2026-10-01. Coordinator assignment and Serious
Sam ownership ACK checked on messageboard. No source changes, builds, emulator
runs, retained-session commands, remote jobs, or commits performed. Only this
review and append-only board notices were written. Own watcher exec session30847
was stopped after review (exit130).

## Preserved evidence and independent replay

SHA-256 verified on both the preserved artifact and `/tmp` copy:
`363d07ed0466b0946f0e22bd0ee99253bb22c0275d36d4c168219e9326e4bc39`.
Preserved module and builder:
`scratch/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd/serious-tls-integrated.wasm`
and `serious-tls-integrated-build.js` in the same directory.

The memory-host `result.json` contains the exact previous launch command.
An independent launch is feasible without a canonical build or modifying
8138/8146: `test/run.js` honors `--no-build --wasm=...`; guest VFS and memory
belong to the new process. Claim one local native GL process and an unused
control port first. Native graphics needs the documented host-access escalation;
do not repeat the stalled sandbox attempt. Runtime JS still comes from the
dirty shared tree: record its identity and avoid concurrent host-loader/GL edits.
This is a diagnostic TLS replay, not a production-complete gameplay test.

Proposed next command (8147 is a candidate, **not checked or reserved**):

```sh
node test/run.js \
  --exe=test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/SeriousSam.exe \
  --dll-seed=test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/Engine.dll,test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/Game.dll,test/binaries/candidates/serious-sam-demo/package/Disk1/Bin/Entities.dll \
  --vfs-tree=test/binaries/candidates/serious-sam-demo/package/Disk1 \
  '--exe-guest-path=C:\Bin\SeriousSam.exe' '--cwd=C:\Bin' \
  --no-build \
  --wasm=scratch/handoffs/01a0f6ff-da61-7710-a604-d9442103dbbd/serious-tls-integrated.wasm \
  --async-mm-timer --quiet-api --quiet-blocks --no-close --stuck-after=0 \
  --max-seconds=1800 --max-batches=2147483647 --batch-size=10000 \
  --tick-ms-per-batch=1 --no-uop --headless-gl --control=8147 --frozen
```

This deliberately replaces the previous unlimited `--max-seconds=0` with a
bounded 1800-second guard. Save stdout and captures into a new uniquely named
`scratch/runs/` directory. From batch0: snapshot, `step 16000`, inspect dialog,
`cmd dlg-cmd:1`, `step 71000`, poll the same session through ctl observation
timeouts, then inspect frozen87000/credits0/quitfalse and intro PNG. Inspect
viewport dialog count as in the prior evidence. Stop only the newly owned run
via ctl quit after captures. Do not step or quit retained8138/8146. Publish
result.json last with agentId/taskId, exact command/module hash, current host
identity, logs, snapshot and reviewed screenshot. Intro pass is the bounded
done criterion; menu/input/gameplay remains a later task.

## Remaining private transforms mapped to production

| Behavior | Production locations | Integration concern |
| --- | --- | --- |
| Precise instruction PC | `05-alu.wat` th_nop; `07-decoder.wat` insn_start | Prototype emits NOP marker per instruction. Do not silently ship this instrumentation or assume folded/uop paths have precise restart state. |
| Recoverable sparse AV | `03-registers.wat` g2w_miss | Prototype raises for addresses >= virtual_alloc_min, guarded by fault_raising/eip_redirected; ordinary production fault-null mode currently allows sentinel completion. Correct boundary is actual inaccessible memory, not merely an address threshold. |
| Write classification | `03-registers.wat` gs8/16/32/64/gsv128; `11-seh.wat` raw exception record | Prototype wraps translations with write-active flag and writes ExceptionInformation[0]. Audit page-crossing and partial writes, rather than treating read/write reporting as complete access enforcement. |
| Raw AV handlers | `11-seh.wat` seh_walk_from / seh_call_raw_handler; existing `09b-dispatch.wat` raw continuation | Prototype routes AV before CRT frame-layout heuristic. Preserve existing nested continuation implementation and unhandled termination. |
| Restartable REP MOVS | `05b-string-ops.wat` rep_movs_do, rep_movs_mem; consumers `07c`/`07d` | Prototype replaces only rep_movs_do with per-element preflight and ECX/ESI/EDI publication. Current rep_movs_mem does not publish partial progress; rep_movs_do zeros ECX after it returns. Preserve overlap/DF semantics, code-write invalidation and shared fast paths. Do not confuse existing ordinary 16-case BW test with sparse-fault restart coverage. |
| Persistent timer TLS/SEH context | `13-exports.wat` fire_mm_timer; `09a5-handlers-window.wat` DispatchMessage MM_TIMER; `09b-dispatch.wat` CACA000A; `09a-handlers3-sync.wat` TLS helpers | Keep fs_base stable because `07-decoder.wat` bakes it into cached FS addresses. Swap TIB[0], TIB[0x2c], tls_slots around callback and restore on continuation. Prototype still constructs DLL TLS manually, despite production template support. |

The preserved builder no longer transforms memory helpers or DLL loader TLS.
Its timer prototype still allocates a 384-byte TIB/vector, loops DLL headers,
and copies templates manually. That bypasses the production vector registry,
EXE templates, late template registration, TlsFree clearing and allocation
failure handling. Reusing `tls_attach_slots` naively also fails: it uses the
instance's single `tls_registry_node`, so registering a callback vector would
replace the main vector's registry entry unless registry-node state is owned
separately. `tls_static_initialize` alone does not register the vector.

CACA000A also returns `fire_wave_out_callback`; timer leave must distinguish
whether a timer context was entered and preserve waveOut behavior. A callback
fault/termination path must not leave main TLS/SEH substituted on later resume.

## Ownership and resource boundaries

NFS2/IS3 explicitly retains `00-regions.wat`, `09c0-window-table.wat`,
`09a-handlers1-user.wat`, `10-helpers.wat`, generated region map and focused
tests pending handoff; its canonical build claim is active at review time.
Serious Sam's older memory/window hunks in those files do not release the
new owner's hunks. No region/layout regeneration or canonical build is ready.
`01-header.wat`, loader files, dispatch/SEH files and GL/host files have mixed
dirty changes: coordinator must preserve individual hunks and check other
outstanding owners before granting writes. `test-mm-timer-callback.js` already
has unrelated dirty changes; review them before extending it. Frozen artifact
replay avoids these source-edit overlaps and can proceed once its process/GL
resource is granted, independently of the canonical build claim.

## Smallest concrete implementation slice

After the frozen TLS replay, assign **MIG-SAM-TIMER**: integrate persistent
multimedia callback TLS/SEH context using the production template registry,
without changing FS base, memory layout, fault machinery, or launcher. Own
narrow hunks of `09a-handlers3-sync.wat`, `13-exports.wat`,
`09a5-handlers-window.wat`, `09b-dispatch.wat`, and a focused timer-context
fixture plus its test-tier membership. Confirm those claims first. Preserve
main and callback registry-node identities; explicitly handle allocation
failure, late DLL templates and callback completion. No PE TLS callback or
unload feature expansion is required by this slice.

Required focused evidence: actual decoded FS-relative code reused before,
during and after a timer; distinct initialized EXE/DLL static TLS and dynamic
TLS; persistent callback writes across two deliveries; main values unchanged;
both async and DispatchMessage entry paths; SEH head restoration and handled
callback exception; nested-delivery refusal; allocation failure; late template
registration; TlsFree clearing both vectors; waveOut continuation unaffected.
Run existing `test-mm-timer-callback.js`, `test-tls-lifetime.js`,
`test-tls-shared-workers.js`, `test-seh-continue-execution.js`, and
`test-waveout-callback-function-wasm.js`, plus paren/logical-AND/tier gates.
Use one private source compile/test process at a time with explicit coordinator
CPU authorization; defer canonical build until its owner releases it.

Then remove only timer transforms from a new private diagnostic builder and
repeat the owned frozen route; leave fault/REP transforms until separately
integrated. Final production fault work needs a real mid-REP AV fixture with
DF0/1, widths1/2/4, source/destination page boundaries, unchanged failed
element, precise EIP/ECX/ESI/EDI, continue-execution retry and cold/cached paths;
retain BW copy, fault-null and SEH termination/continue regressions. The
current `--no-uop` diagnostic route does not validate optimized execution.

Read-only review complete; no production or gameplay completion claim.
