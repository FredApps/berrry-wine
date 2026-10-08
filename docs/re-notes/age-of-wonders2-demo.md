# Age of Wonders II beta demo

Original local package, separate from the already-qualified Age of Wonders I
beta demo. October 8 scoped registry, run-result and re-note search found no
earlier qualification for this second title. This investigation establishes
main-menu rendering only; player-controlled gameplay remains unqualified.

## Original media and preparation

`test/binaries/win98-games-a-d/Age of Wonders2 demo-SW.exe`:
101,537,511 bytes, SHA-256
`1244f0114965d011d1e28b97e207db15c902d124ebb25af8a6c97748beb73dc0`.
The collection's existing provenance is in `test/binaries/SOURCES.md`.
No alternative edition or additional download was used.

This executable contains a normal ZIP catalog: 1,104 entries, 1,063 files,
197,002,538 uncompressed bytes. `tools/extract-age-of-wonders2-demo.js` checks
the original identity, catalog totals, names/collisions, each ZIP CRC and the
game hash, and refuses an existing output or crossing the 2 GiB disk floor.
The remote copy was named `/tmp/aow2-original.exe`; the transfer receipt binds
that temporary name to the original package above.

The output is **extracted**, not an asserted installed state:
`Age of Wonders2 demo-SW/extracted/`. All files remain byte-identical. The
package's `aow2Log.txt` is a developer's old Windows 2000/Radeon log, not our
runtime evidence. The original `aow2Setup.exe` remains in the payload but was
not executed; no settings or Windows registry state were fabricated.

`AoW2.exe`: 5,748,736 bytes, SHA-256
`a10590e5dbd013d154b00ea53e66670f4e74d38ab33adb2523f0a662af8f89f7`.
PE string FileVersion/Product fixed version: **0.92.0.1837** (fixed file
version 0.92.1.0; string ProductVersion 1.0.0.0). Configuration executable SHA:
`bcb06f08e6e5d4e0b41a93b9d77de107e72494a382ebf46ad65bc6f95ab52bbc`.

Registered local-only app: `age_of_wonders2_demo`, guest executable
`c:\aow2demo\AoW2.exe`, working directory `c:\aow2demo`. Explicit imported
Borland packages: `vcl50.bpl`, `vclx50.bpl`, `Ml42ND50.bpl`. The generated
manifest contains 1,059 companion files with sizes and lazy loading. Reproduce:

```sh
node tools/extract-age-of-wonders2-demo.js
node tools/gen-win98-games-a-d-manifests.js --only=age_of_wonders2_demo
node tools/gen-win98-games-a-d-manifests.js --only=age_of_wonders2_demo --check
```

The full durable local tree's 1,063 hashes were compared with the remote
extraction receipt. No proprietary payload is committed or publicly deployed.

## Generic startup repair

First ordinary registered browser launch trapped on **SysReAllocStringLen**
at runtime EIP `0x00abc57c`, before the menu. Baseline loaded module SHA-256:
`d8d4096f957ed51cecab589b5a1ec7bf402336f13959ce0710faf2f7d3c68960`.

The new handler allocates a counted UTF-16 BSTR, copies before freeing its
predecessor (including self-aliasing slices), writes the byte-length prefix
and terminator, and updates the caller's pointer only on success. NULL source
allocates uninitialized contents; NULL old BSTR is supported. Overflow is
rejected before size arithmetic; insufficient allocation leaves the old
pointer/content intact. NULL pointer-to-BSTR remains an invalid call.
The API is append-only ID 4475 and OLEAUT32 ordinal 5 in both resolvers.
Contract: [Microsoft SysReAllocStringLen documentation](https://learn.microsoft.com/windows/win32/api/oleauto/nf-oleauto-sysreallocstringlen).

`test/test-bstr-reallocation.js` drives the real resolved thunk/Win32 dispatch.
The corrected baseline harness fails with `RuntimeError: unreachable`; the
fixed harness passes aliased slices, embedded NUL/surrogate UTF-16, terminator,
NULL source/old BSTR, zero length, overflow preservation and stdcall cleanup.
The first harness attempt used a wrong import-signature filename; that failure
is retained and is not the meaningful baseline. Root subsequently requested a
valid-length actual heap-OOM case (`cch=0x3FFFFFF5` in 512 MiB). Its assertions
were added after the fixed native deadline; **the expanded test was not run**.
Do not treat overflow coverage as allocation-failure branch coverage.

Canonical build gates passed, including the API/dispatch freshness, handler
ESP, silent-stub, logical-operand and WATX/data-segment checks. Initial build
closure omitted two checked-in ToyVM bundles; they were supplied inside the
original build deadline. No optimization, silent-success stub or guest-state
patch was introduced.

## Reviewed browser findings and limit

Boat `bx_997uef9b`, Chrome 151.0.7922.108, Node v24.18.1, 512 MiB guest memory,
software renderer requested and GPU flag false. Source base
`0d781689e8782fd6d0bce43e9021c749e6a30577`, exact source/file receipts preserved.
Fixed served/loaded module:
`e4d59e88c62dd17cafaa836120e35e891cd56b497bd80190c980696adc98396c`.

1. Registered `?app=age_of_wonders2_demo&debug&no-threads&d3d-renderer=software`
   reaches a rendered splash. Main thread remains at VCL50 runtime
   `0x00ac63b4`, yield 7 (empty message wait). Three cooperative guest threads
   remain active and a timer is pending. Ordinary splash click reaches HWND
   `0x10002`; Enter/Escape events were logged with HWND 0. These inputs did
   not expose a menu. This does not establish a causal thread/timer bug.
2. Same browser navigated to the ordinary registered `&threads` route, without
   resetting its guard. Four Worker guest threads reach the visible main menu
   (Campaign, Scenario, Load Game, Replay Intro, Quit). The readme prescribes
   Scenario → Single for the included scenario, Inioch's Legacy.
3. Trusted click at viewport `(486,517)` on Scenario briefly removes buttons;
   a later reviewed capture returns to the main menu, rather than exposing
   Single or scenario setup. A separate ordinary 180 ms down/up produces a
   captured redraw. No later capture exists for that held click, so its eventual
   outcome is unknown. No gameplay scene, army selection or displacement was
   observed. Do not claim input bypass, playability or new-game credit.

Worker-route snapshots retain hidden main form HWND `0x10003` and visible child
`0x10004`, with the fullscreen/splash HWND `0x10002` as the main window. This
is a possible input/window ownership lead, **not a diagnosed cause**. The
remote closure lacked `test/binaries/tlbs/stdole2.tlb`, registered
`binaries/dlls/oleaut32.dll`, `comctl32.dll`, and dynamic `olepro32.dll`.
Built-in APIs were used; those omissions remain limitations, not proven causes
of the Scenario behavior. No alternative fixture/stub was installed to hide them.

VCL50 mapping in the cooperative capture: runtime `0x00abb000`, original image
base `0x40000000`. Thus `0x00ac63b4` corresponds to original `0x4000b3b4`;
baseline failing `0x00abc57c` corresponds to `0x4000157c`. VCLX50 maps at
`0x00dad000` from `0x402f0000`; ML42ND50 maps at `0x00ef0000` from `0x00400000`.
Worker-route bases differ; its log records thread entry points separately.

Immutable bounds declared before launch: transfer 600 s, extraction 600 s,
native build 600 s, installer 1,200 s, gameplay 1,200 s, retrieval/cleanup 180 s,
aggregate 4,800 s. Installer phase unused. Native deadline 15:04:37.274 UTC
was preserved. Browser guard 15:15:38.887 UTC was preserved across repair and
navigation; terminal cleanup completed 15:15:39.001 (114 ms closure overhead).
First browser active 41.459 s, second 680.946 s; no overlapping browsers.
Transfer 313.438 s, final 4,329,217-byte evidence retrieval/cleanup 5.486 s.
All eight owned process IDs and Chrome were absent, exact baseline listeners
restored, and 3,569 runtime source pins verified before owned prefixes/archives
were removed. Root retains boat lifecycle ownership; expiry 16:47:45.876 UTC.

Sealed self-contained captures:

- `scratch/runs/20261008T1518Z-age-of-wonders2-demo-before/`
- `scratch/runs/20261008T1518Z-age-of-wonders2-demo-after/`

Next review: run the expanded heap-OOM regression, then investigate original
Scenario input/ownership with complete declared system support and ordinary
input in a separately authorized bounded run. No further runtime in this worker
budget. Gameplay, sound, FPS, physical presentation and release are unqualified.

## 2026-10-08 sole-worker native review and menu-route continuation

The expanded actual heap-OOM BSTR regression now **passes**, including valid
`cch=0x3FFFFFF5` pointer/content preservation, on exact source `1455cc2f4`.
Sealed receipt: `scratch/runs/20261008T1546Z-age-of-wonders2-demo-native-review/`.
This completes the previously unexecuted native review; root separately reviewed
and integrated core/registration. No game rerun was used for the native stage.

A distinct bounded registered default-Worker investigation passed the canonical
build with both checked-in ToyVM bundles and served the same `e4d59e88…` module.
It did not reproduce the predecessor's reviewed menu: reviewed images show title
background without buttons, pre-input startup stack trap `0x074ffd4e`, or worker
exit. No Scenario input or gameplay was achieved. The predecessor held-click
outcome remains unknown. Including declared stdole2 and then temporarily omitting
it for a causal A/B did not establish a prerequisite; it was restored. An initial
observer SharedArrayBuffer decoding error invalidates that attempt, and capped
logs limit interpretation. No runtime fix was justified.

VCL `TThreadWindow` HWND `0x10007`, message `0x8fff`, dispatches its synchronized
method from lParam+0x20/self+0x24. Two read-only observed dispatch requests overlap
an active slice; arbitration is an unproven source lead. Investigate with a
controlled source regression and actual Worker CPU/stack capture before another
ordinary-input gameplay attempt. Browser shadow CPU getters are not reliable.
Full limitations, source identities, commands, reviewed images and cleanup:
`ops/handoffs/age-of-wonders2-menu-route-20261008.md` and sealed
`scratch/runs/20261008T1623Z-age-of-wonders2-demo-menu-route-investigation/`.
The one browser closed at its immutable 1500-second guard; evidence was retrieved
and hashed before owned-prefix cleanup. Gameplay remains unqualified.
