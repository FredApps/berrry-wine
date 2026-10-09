# Disciples II demo

## Original and first preflight (2026-10-09)

`test/binaries/win98-games-a-d/Discipless2_demo-D3D.exe` is143,913,296bytes,
SHA256 `e37753c2319380a933fb105b28639d5cacb2ed429731f5ae53706f047c8d03b0`.
`file` identifies PE32 GUI Intel80386, four sections. Static ASCII strings
include `WiseMain`, the Wise0132.dll extraction CRC error,
`Disciples II Demo Installation`, and `Initializing Wise Installation Wizard...`.
These identify a Wise installer; exact engine version is not established.
`7z l` (7-Zip23.01) cannot open it as an archive. Do not treat that as a bad
installer or assume a CAB/InstallShield payload.

No Disciples II registration or qualified screenshot was found;
`disciples_demo` is the first game, not this candidate. Installed files and
manifest do not yet exist. No missing installed filename is established.

Pinned original was transferred and SHA256-verified on temporary bx_75agndxm at
03:46:00Z as
`/tmp/disciples2-original.exe`; receipt is
`scratch/disciples2-preflight-20261009/transfer.json` with remote checksum.
The next runtime step is installer inspection/extraction after the serialized
Black & White 2 browser finishes. No second emulator or benchmark is running.
Respect any installer approval/license decision rather than answering for user.

Prepared next step: `/tmp/disciples2-probe-installer.js` (SHA256
`46e74f0d6c8152020916ea79b5397a705b4a9b220cd5ed16c07d40f162326f0d`).
It refuses to run while BW2 browser189048 is alive, has a180second hard guard,
and captures the first visible installer window without button input. Syntax
and upload checksum checked; it has not executed the installer.

At 04:21Z the serialized handoff controller PID234050 was started on the
same temporary box. It waits for browser189048 and its Chrome process to
exit, requires the browser cleanup receipt, verifies the probe hash, then
starts that one bounded probe. It does not stop BW2 or click installer controls.
It expires at 05:12Z; pending handoff can be cancelled by creating
`/home/user/disciples2-queue-20261009/cancel` on the boat. Do not separately
launch the installer while this controller owns the queued start.
State/logs: `/home/user/disciples2-queue-20261009/`; local controller and
launch receipt: `scratch/disciples2-preflight-20261009/after-bw2.js` and
`queue-launch.json`. Controller SHA256:
`2402e54a823b35bfc2e91c28d72636c63abe89fae3936c76d126bc512d90ccc2`.

Static `tools/unimplemented-imports.js` audit against main420da0745 reports
70 imports and no missing/explicit fail-fast handlers. This excludes dynamic
imports and the extracted payload, and does not prove handler correctness or
successful installation. Raw audit and checked probe API contract are retained
in the same local preflight directory.

## 2026-10-09 ordinary Wise installer progression

Original Wise bootstrap reaches initializing splash, self-loads glc1.tmp at507000, then Welcome. Reviewed ordinary Next progresses through Choose Destination Location, Select Program Manager Group, and Start Installation; no agreement appeared. Captures/logs retained in runs20261009T0510Z-disciples2-welcome, 20261009T0511Z-disciples2-destination, 20261009T0512Z-disciples2-program-group and 20261009T0512Z-disciples2-start-install. The group-page probe's title matcher missed that page and exhausted a finite10000-batch budget; no guest hang inferred.

Installer272256 started05:12:49Z on bx_75agndxm with180s guard and ordinary Next on the reviewed Start Installation page. Output /home/user/disciples2-install-20261009; save-vfs targets /home/user/disciples2-installed-vfs-20261009. It was confirmed live at the next process check. Collect actual termination before claiming extraction or launch; no game screenshot yet.

### Installation completed; real DLL seeds and SmartHeap Toolhelp blocker

First install probe exhausted19000steps at82percent after28.7s (no crash). Corrected95000-step ceiling under unchanged180s wall guard completed installation after22350batches/39.24s. Installer272983/guest272993 terminal0 at05:15:01.307Z; reviewed Installation Complete in scratch/runs/20261009T0515Z-disciples2-installed. Exported128 files174933888B to /home/user/disciples2-complete-vfs-20261009/program files/strategy first/disciples ii demo. Original discipl2.exe SHAadba242a0a3563651baffa6ec7d9a6c0978b7ae844a1cccedb2a1f4e8eb7b1f8. Exact per-file hashes in scratch/disciples2-preflight-20261009/installed-files.json.

Bare game launch traps SHW32.DLL ordinal295 because auto-DLL resolution omitted the existing bundled DLL. Explicit --dll-seed=shw32.dll and --dll-seed=c4dll-r.dll (existing older Disciples registry convention) loads both originals and clears that trap. It then creates a hidden128x128 game window and NULL-calls EBX in SmartHeap at runtime008fffcd, return008fffcf, batch23; main EIP becomes0. Original SHW32 imagebase0a930000, loaded008f5000: original call0a93afcd. EBX was GetProcAddress(CreateToolhelp32Snapshot) result. Snapshot call arguments are TH32CS_SNAPHEAPLIST=1 and currentPID1000. The same routine looks up Heap32ListFirst, Heap32ListNext, Heap32First, Heap32Next. No rows exist for these five API names in current api_table. Implement actual snapshot/heap enumeration rather than altering game/DLL or returning invented success.

Control evidence: scratch/runs/20261009T0516Z-disciples2-game-crash and 20261009T0517Z-disciples2-hidden-window. SHW32 original112672B SHAad8bc0ccd5cde0bd22ea6a4c0b45756b28c0e5bc972f314e2714f06af64732cb retained locally with disassembly in scratch/disciples2-preflight-20261009. Missing ole32.dll warning is separately retained; not established cause of this observed NULL call. All game probes terminal; neither hidden window nor installer is gameplay qualification.

## Toolhelp candidate (2026-10-09)

The five dynamically requested APIs are now implemented in the candidate.
Snapshot handles capture the current modeled heap list; block enumeration reads
actual live public HeapAlloc/HeapReAlloc records, and HeapFree/HeapDestroy remove
them. Metadata is shared across guest instances, including snapshot CloseHandle.
The registry keeps only16 fixed bytes; its1024 buckets are allocated lazily.
Append the new region after existing declarations: inserting it beside HEAP_ARENAS
broke gap/pad placement, while append ordering passes all five shake layouts.

This models fixed live public heap blocks. Internal emulator allocations are not
presented as guest HeapAlloc records. Process/thread/module snapshot flags remain
explicitly unsupported rather than returning fabricated empty snapshots. Other
process IDs fail. The original NT-only HeapWalk/GetProcessHeaps error120 remains.

Regression control failed the real GetProcAddress lookup for
CreateToolhelp32Snapshot; receipt scratch/disciples2-preflight-20261009/toolhelp-control.json.
Candidate verifies heap identity, block sizes, cross-instance visibility and
closing, wrong-owner rejection, failed in-place realloc preservation, freed-block
removal, struct sizes, stdcall cleanup and snapshot immutability.
Primary structure reference: https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/ns-tlhelp32-heapentry32

All128 installed originals are now retained locally in
`test/binaries/win98-games-a-d/Disciples II Demo/installed`, with every SHA verified;
see scratch/disciples2-preflight-20261009/retained-installed.json.

Canonical build and six native suites passed on bx_75agndxm; module SHA256
`193ce17000338bbcdabbd65149a22409a461322b8f743473b1dc8df8a8295cc5`.
Evidence: run20261009T0535Z-toolhelp-heap-validation (29 artifacts).
Original candidate launch285866/285876 terminal at05:39:21Z exposes the next
SmartHeap DllMain trap: WriteProcessMemory, EIP009007AC/return009007B3,
process-1, destination07504F58, source074FDC6C, size5, written-count074FDC68.
The bytes begin E9 D3 BA 3F F9: an API-entry JMP hook. No success bypass: need
real guarded current-process writing and correct execution of a patched thunk.
Evidence: run20261009T0539Z-disciples2-toolhelp-candidate (5 artifacts, no image).
Prior control has no WriteProcessMemory trap; this is newly reached initialization.

### Next patching constraint

The target07504F58 is in the emulated thunk zone.
`08-pe-loader.wat` stores two metadata words (nameRVA, APIid) in each8-byte
thunk, and `09b-dispatch.wat` reads them directly. Merely implementing
WriteProcessMemory as a byte copy would replace metadata with E9 displacement
and dispatch garbage. A patched entry must execute guest code; restored original
bytes must resume the real API. Decode-time and cached/direct thunk dispatch
paths both need coverage, including CALL/JMP and Worker-shared state.

Original SHW32 helpers explain the patch lifecycle: A93B7C0 reads5 original
bytes using ReadProcessMemory into record+16; A93B780 constructs/writes the
5-byte E9; A93B800 writes the saved5 bytes back. A93BA30 (runtime900A30)
is the replacement allocator. Disassembly retained in
`scratch/toolhelp-20261009/smartheap-hook-disasm.txt`. This is a real
install/restore hook, not an instruction to suppress SmartHeap initialization.
A guarded process-copy helper can share range/handle validation with existing
ReadProcessMemory. Preserve output-count and code-cache invalidation behavior.

## Process writes and API-entry hooks (2026-10-09)

WriteProcessMemory now shares guarded whole-range copying with ReadProcessMemory;
invalid handles, unmapped/readonly pages and invalid output pointers fail. The
original current-process-only handle model is retained. Guest copies invalidate
local code and publish the process generation so workers retire stale code.
API-entry descriptors are saved separately before patching. Changed entries run
through the normal x86 decoder; restored bytes resume API dispatch. Metadata
readers (loader, worker continuation sync and diagnostics) keep original identity.

Canonical build/five native suites and extended descriptor/reload checks pass.
Control fails missing WriteProcessMemory; first candidate exposed stale worker
code after restoration, fixed with process-wide invalidation. Native evidence
run20261009T0549Z-process-memory-hooks (21 artifacts), module SHA256
`8a2b49d12dd1e5ab17f05fc280d2f22dfc78fdc6f0f4e462ac381ca236bbd3fd`.
No performance benchmark or gameplay qualification is implied.
API contract: https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-writeprocessmemory

Original game294198/294208 terminal05:52:51Z: WPM trap cleared, SmartHeap DllMain
returns0, then batch30 shows MEM_BAD_POINTER. Screenshot personally reviewed;
no button clicked. Candidate run20261009T0552Z-disciples2-process-memory-candidate.
Filtered trace294758/294768 terminal05:53:51Z retained in
run20261009T0553Z-disciples2-smartheap-trace. MessageBox caller008FE48C; frames
008F74B9 <-005764FF <-005A937E <-005F5FC0 <-00401EDA <-0040158E <-0040146C
<-00401297 <-00642006.

The trace reveals a separate real GetProcAddress bug: C4dll-R handle00A16000 is
asked for malloc, calloc, realloc, free and new/delete; six fresh thunks07504F58
through07504F80 are returned and patched. Original C4dll-R export names have no
malloc/calloc/free. The loaded-module branch resolves0 then incorrectly falls
through to global Win32-name lookup. A matched DLL missing an export must return
NULL/ERROR_PROC_NOT_FOUND. Fix this next; whether it causes MEM_BAD_POINTER is
not yet established. Static full export receipt:
`scratch/process-memory-hooks-20261009/c4dll-exports.txt`.
