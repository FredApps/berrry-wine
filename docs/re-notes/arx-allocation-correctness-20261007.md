# Arx original packed-entry allocation

Original Athena SHA256
`81498563a34111cf807700d1d9fb10f39077b97b35e0e35df23f6e77e936bea8`;
ARX.exe `ebd3e2b3b14b678ea70e7aed58daf2ba5eb4d6681a3ea294e603228f84d27aa7`.
Neither original was modified. This investigation concerns the private MSI
installation layout, not public distribution or gameplay qualification.

## Original dataflow and observed owner

Preferred-image VAs below are from the original Athena DLL, read with
`lib/pe.js`, `tools/disasm_fn.js` and `tools/xrefs.js`:

1. Packed directory loading at `10011df4` calls `10012810`. Its new resource
   entry branch pushes `0x1c` at `1001285e` and calls operator new `10013532`
   at `10012860`: **28 bytes**, not a native FILE allocation. Constructor
   `100124a0` initializes seven dwords. `10012b30` inserts that object pointer
   in the hash table's value slot (`10012bf0`); `10012c10` returns the value
   (`10012cc3`). File-open stores it at packed handle offset 9 (`10011fe7`).
2. New calls `10013552` → malloc `1001357e`. CRT mode at `10034764` selects
   mode 3 at `100135a6`; requests within the threshold at `1003475c` go through
   `10015aaf`. This allocator obtains its arenas from `10015db8` and stores
   the returned region base in descriptor offset `0x0c` at `10015e36`.
3. At `10015e21..10015e2e` the actual original arguments are
   **VirtualAlloc(NULL, 0x100000, 0x2000, 4)**: 1 MiB, MEM_RESERVE,
   PAGE_READWRITE, **without MEM_TOP_DOWN**. EDI is explicitly zeroed at
   `10015dc5`. The IAT at `100200ac` is VirtualAlloc. Commit helper
   `10015e69` calls the same IAT at `10015eba` with an explicit region/group
   address, size `0x8000`, MEM_COMMIT `0x1000`, protection 4.
4. The alternative CRT mode 2 reserves 4 MiB at `1001629f`; it is excluded
   for this observed entry by the retained mode-3 descriptor below.

The bounded read-only remote observer on `bx_d8nw3e8t` used baseline module
`d4256f3cd6b085a4acbd8192df7e9d0de8625beb82d10060ac2f27a51d8add74`.
Two complete owning Worker rows, 5004 ms apart, retained identical CRT data:
mode **3**, threshold **1016**, descriptor count **1**, descriptor/table
`01356034`, arena **7ef00000..7f000000**, entry **7ef0b780**. The emulator
reservation table independently identifies the same 1 MiB base with protection
4; the target is committed inside it. Its preceding allocation header is
`0x31`, agreeing with this CRT's `(28 + 0x17) & ~15 = 0x30`, plus live bit 1.
The earlier four published emulator heap arenas did not contain the pointer:
the owning region is this original CRT VirtualAlloc arena.

This is retained ownership plus authenticated original instruction dataflow,
**not a historical allocation-call trace**. The observer double-reads bounded
bytes and checks table counts; its shared-memory snapshots are not atomic with
the owning CPU RPC. The existing non-increasing EBP-chain diagnostic remains
explicit. No forced guest lock, key change, binary patch or capacity reduction
was used. The read-only run exited normally, driver59268/Chrome59283 absent,
browser/server closed, zero pending streams/errors.

Private evidence: `scratch/arx-crt-origin-20261007/remote-bx_d8nw3e8t/`.
`owner1.json` SHA256 `e91d74fb87a654591b74f302c5e06180f0121f7078a0ab5f9af9eeee05c0eea7`;
`owner2.json` `1adb4dcc9bb4e383fbdad1916c7f8003fb2c2acd50156408726f9053b8d6b252`.
Source/fixture/module identities and terminal receipt remain beside the rows.

## Generic correction and validation

NULL VirtualAlloc now searches upward by default and downward for MEM_TOP_DOWN.
Existing internal heap, DLL and mapping callers keep their downward direction.
Both directions use one locked placement/publication operation: a reservation
is recorded before the lock is released, including the pending interval before
commit or heap-arena registration. A downward cursor miss searches the entire
remaining arena. The ceiling `0x7f000000`, image-derived lower boundary, and
excluded `0x50000000..0x60000000` band are unchanged, preserving all of
`0x10000000..0x7f000000` outside that band and the existing lower extension.

Reservations remain recorded across partial commits; release removes all their
committed islands. Adjacent independent reservations cannot coalesce into a
single mapping with a shared lifetime. Failed VirtualAlloc, sparse-heap, DLL or
mapped-view commits relinquish their pending ownership. The existing 8192-entry
reservation metadata limit fails closed rather than returning untracked owners;
no address-space ceiling or backing capacity was lowered.

On own branch based on `c7f8c5b4`, the new actual-WASM placement regression's
`--baseline` control fails specifically at default placement (actual7ef00000,
expected083f0000). Candidate passes default/top-down, pending ownership,
disjoint committed islands, independent adjacent lifetime, full address-space
exhaustion/reuse, a fragmented **192 MiB** gap, overflow, failed split rollback,
and **three concurrent worker_threads/WASM instances** mixing API, internal and
mapped-section reservations. Existing cross-instance coverage now explicitly
requests MEM_TOP_DOWN for its downward scenario and checks separate lifetimes.

Full mandatory `bash tools/build.sh` and ten regression suites pass:
allocation-placement, alloc-band-skip, reserve-gap, map-cross-instance,
page-protection, query-memory-map, free-mapped-view, heap-arena-release,
map-split-rollback, and alloc-floor-direct-window. Candidate module SHA256
`3f9afaf1b26626594a56142530938caf6c10224637c39485c30af0b86ece930d`,
1,720,915 bytes; region layout hash `0a82c5ae0e89dba1` unchanged. All eleven
child process groups were absent after exit0; disk stayed above 2 GiB.
Logs/receipts: `scratch/arx-crt-origin-20261007/validation/attempt2/`.
An initial sparse checkout omitted tracked Terminal.fon and stopped before
compilation; restoring the exact tracked fonts allowed the full build. Its
receipt is honestly reconstructed from tool output after sparse expansion
removed ignored worktree-local logs. No gates were disabled.

## Ordinary original-media candidate

On the same temporary host, all **357** runtime/source/harness/fixture pins
passed remote SHA256 verification; the transferred producer manifest records
all122 WAT closure inputs. Candidate was the exact full-build module above,
with the original private manifest, working directory and registry recipe.
No guest input, config override, diagnostic allocator switch or forced window
visibility was applied. The original EAX installer custom action remains
unavailable, as in the baseline preparation.

At approximately25 and70 seconds, renderer mirrors report **Arx Fatalis -
Settings**, HWND65538, visible at63,38 with size514x404. The original main
window remains hidden behind its startup dialog. Both actual owning main
Worker captures report **cs_waits=0, cs_bad_leaves=0**, with EIP07500900,
an internal CACA0004 continuation (not EnterCriticalSection). A real auxiliary
thread is present; it also reports zero CS waits/bad leaves. The baseline
key-text wait is gone. The settings dialog and captures remain unchanged while
awaiting ordinary input. Read-only diagnostics aimed specifically at the old
wait now report "not EnterCriticalSection"/"missing lock argument"; these are
expected observer limitations, not new guest failures.

Two screenshots were retrieved and hash-verified, identical content,
505,129 bytes each. Root reviewed settled.png at21:30:42Z: real Settings with
English,640x48016bits,GeForce, and OK/Quit controls. This is progress
past allocation failure to startup settings; no menu, player-controlled
gameplay, audio, FPS or performance result is claimed. Next step is root review
of the settings capture and the ordinary settings/launch input route.

Ordinary quit completed2026-10-07T21:24:45.872Z, Chromeexit0, browser/server
closed, zero pending streams/errors; remote verification at21:26:02.685Z found
driver63420/Chrome63435 absent and no owned listening sockets. The host is
retained for the queued worker and expires22:51:07.784Z; this worker does not
stop/delete it. Evidence:
`scratch/arx-allocation-fixed-20261007/remote-bx_d8nw3e8t/` contains both
screens, owner rows,357pins, producer manifest, logs and terminal receipts.
Root owns integration and publishing; shared HEAD/index were untouched.

## Final highest-address correction

Root review caught a real semantic distinction: guest MEM_TOP_DOWN must start
at the address-space ceiling even when the internal descending cursor is
lower. The guest API now selects highest-gap mode2; internal reservations
retain cursor mode1. The new regression allocates topA/topB, releases topA,
and requires topC==topA while topB remains live. Pre-review commit3c48c2f5
fails that exact assertion; corrected source passes.

The final mandatory build and all ten suites pass again. All twelve process
groups (including the named negative control) exited0 and were verified absent.
Final module SHA256 `7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0`, 1720920 bytes;
logs/receipts `scratch/arx-crt-origin-20261007/validation/attempt3/`.
The earlier ordinary settings capture above used the pre-review module; final
module remote validation is queued behind Q2 and is not yet claimed.
