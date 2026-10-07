# Betrayal in Antara (demo) -- PARKED

Latest scoped investigation (2026-10-07): the original installer on full module
`fb1be916` retains an empty Main Menu. Two actual main/child Worker reads17.166s
apart prove the child is alive in the Win16 modal pump (EIP12ff40, yield6,
cs_waits0). Its saved return0047:313f is authenticated against original
`_SETUP.EXE` segment2: the call2:313a is USER.87 DialogBox. This establishes a
live modal wait, not an exited child or the earlier immediate resource miss.
Current parent geometry is640x480, so width is not the next fix. The original
Main Menu resource declares zero controls; content initialization/painting still
needs actual callback/message evidence. No generic contract failure or gameplay
is established. See [the owner/caller handoff](../../ops/handoffs/antara-menu-owner-20261007.md)
and durable evidence `scratch/runs/20261007T215840Z-antara-menu-owner/`.

Sierra, 1997 (SCI32 engine, VMD video). Fixture:
`test/binaries/win98-games-a-d/Betrayl-a-Antara-DEMO-SW` (35 MB): the game is
not in the directory unpacked; Sierra's 16-bit `SETUP.EXE` installs it.

## Installer, stage 1: SETUP.EXE (Win16 NE)

- Imports `LZEXPAND` (no such DLL on the machine). Fixed in d576fea9: LZEXPAND
  is an emulated Win16 module over LZ32 (LZCopy/CopyLZFile, LZOpenFile,
  LZInit, LZSeek, LZRead, LZClose, LZStart, LZDone; GetExpandedName still
  fails fast). It LZ-copies its second stage and helpers into
  `C:\WINDOWS\TEMP` (`_setup.exe`, `ereglib.dll`, `smackw16.dll`,
  `smacke16.dll`, `setup32.exe`, ...) and WinExec's
  `C:\WINDOWS\TEMP\_SETUP.EXE /o <source dir>` (format strings in SETUP.EXE).

## Stage 2: _SETUP.EXE (Win16 NE, second task on a guest thread)

- `DdeInitialize(&id, cb, afCmd=0xFFFFFFFF, 0)` (`66 6a ff` at seg 3:0x9cd0)
  -- every flag, APPCLASS_MONITOR included -- and any non-zero answer is a
  fatal "System Error: DdeInitialize returned 4004". Fixed in d576fea9.
- Then the task ends silently (thread exits). `--trace-win16` does not reach
  a second task's guest-thread instance, so it was run directly instead:
  `run.js --exe=<captured>/_setup.exe --exe-guest-path=c:\windows\temp\_setup.exe
  --args="/o C:" --vfs-tree=<demo dir> --vfs-tree=<captured temp tree>`.
- That run traps in **SMACKW16.DLL's LibMain**, before any LoadLibrary:
  - LibMain (seg 1:0x0) calls LocalInit, then entry #37 (1:0x275 -> #43,
    1:0x1e8, Watcom `__InitRtns`), then #38 (1:0x910).
  - #38 is what sets `[0x5ec]`: `LoadLibrary("SMACKE16.DLL")` (a WATCOM
    Win386 extended DLL in the same temp dir) and
    `GetProcAddress(h, "Win386LibEntry")` (exported as WIN386LIBENTRY).
  - But an initializer reached from `__InitRtns` already does
    `call far [0x5ec]` (1:0x415) while it is still 0 -> CS selector 0
    (marker 0xCA165E10).
  - `__InitRtns` at 1:0x1e8 takes its table bounds in SI/DI from the caller
    (`call 0x73` is a bare `ret`), i.e. from the registers the loader hands
    LibEntry (Windows: DI=hInstance, DS=autodata, CX=heap, ES:SI=cmdline).
    **Next step:** compare our NE loader's LibEntry register set with
    Windows' and with Watcom's Win16 DLL startup; the walk over the wrong
    range is the likely cause.

Status 2026-10-06: parked (claude:d10ba697); TODOS NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006.

## 2026-10-07: recovered original DLL; additive far relocation defect

The earlier SI/DI hypothesis is superseded by direct original-file evidence.
`SETUP.SOL` (982,010bytes) contains thirteen DH91 records followed by individual
PKWARE DCL streams. Each26-byte record stores its compressed length at+18;
those lengths cover the payload exactly. The existing native `tools/mpq.js`
`explode` reader recovered `_SETUP.EXE`, `EREGLIB.DLL`, `SMACKE16.DLL`, and
`SMACKW16.DLL` without running guest code or changing the original package.
Source/recovery receipts are in `scratch/new-game-antara-20261007/recovery.json`;
the previous scratch directory was empty, so this is independent recovery,
not a claim to have reverified the unavailable historical runtime capture.

Recovered SMACKW16.DLL is13,946bytes, SHA-256
`0c7e5a7473ac1ca979faeb48cced01b707afd55ff7138ecd867c8085f6e7fcfd`.
Its ordinal37 at1:0275 has an additive FAR_ADDR relocation at0276, resolving
ordinal43=1:01e8 with existing offset0056. The intended destination is023e,
a wrapper that explicitly sets SI=DI=01b2 before calling01e8. Ordinal39 at027b
similarly has addend0074 and must reach025c. The loader previously discarded
both far-pointer addends and jumped directly into01e8, bypassing these
initializers. No generic DLL-entry register-convention change is appropriate.

The repair adds the existing low16 offset only for additive FAR_ADDR(type3),
with16-bit wrap; the selector is replaced, without carry or selector addition.
This matches Wine's `apply_relocations` POINTER32 additive branch in
[dlls/krnl386.exe16/ne_segment.c](https://github.com/wine-mirror/wine/blob/master/dlls/krnl386.exe16/ne_segment.c).
Non-additive chains, OFFSET16 and other source types retain their behavior.

`test/test-ne-additive-far.js` invokes the actual WAT NE loader. It checks the
0056/0074 cases, offset wrap, replacement of a nonzero selector, non-additive
chaining, and unchanged OFFSET16. An optional authenticated original DLL
argument also checks its actual0276/027c targets and wrapper instruction bytes.
The unmodified-source control fails the exact0056 assertion (01e8 vs023e);
the candidate passes. The test requires no private fixture for its core cases.

Full production build gates passed on isolated base775bae77 plus the narrow
repair; existing NE loader2881checks, NE image-extent, and the new test with
original DLL all passed. Source/tests were registered by the normal UNIT rule.
Final production module is1,719,337bytes, SHA-256
`992a8b021897e52d2ec1b5f3604f5f89098f02ee2e4748e5340ff4d960f5e880`.
Receipts: `scratch/new-game-antara-20261007/production3/` and
`production3-supervisor/result.json` (exit0,16.439sec, process group clear).
Two earlier build attempts stopped at missing sparse checkout fonts/bundles;
those failures remain preserved. A complete tracked checkout resolved them,
without copying ignored payloads or modifying shared canonical outputs.

Status: generic loader repair validated; ordinary installer progression and
player-controlled Antara gameplay are still unverified. Next run the original
SETUP.EXE with original media and normal installer input on the pinned repaired
runtime. Do not skip LibMain, force function pointers, or label setup as gameplay.


### 2026-10-07: repaired-loader ordinary installer probe

The additive FAR_ADDR repair was integrated as `3880d93d`. The ordinary original
`SETUP.EXE` probe used the private, fully gated `cedfa0ae` closure and WASM
`992a8b021897e52d2ec1b5f3604f5f89098f02ee2e4748e5340ff4d960f5e880`
(1,719,337 bytes), not a claim that the live dashboard was redeployed.
Evidence is `scratch/new-game-antara-20261007/attempt1/`: `findings.json`,
`hashes.json` (21 artifacts), `responses.json`, and four PNG/state pairs.
All 139 completed served source hashes matched the frozen identities.

At 10:25:29 UTC the original Sierra setup window was visible. It hid at
10:25:29.956; thread 1 then started at the Win16 task sentinel `0xfffe1600`.
The console records another Sierra setup window and `ShowWindow(0x18001,1)`
at 10:25:30.012. Three later images were identically black; their renderer
census retained only the two hidden original HWNDs. No ordinary input was
sent to the black screen. This neither proves nor disproves execution of the
repaired SMACKW16 initializer. Installer completion and gameplay remain unproved.

Source ownership narrows the next observation. `win16_task_boot` in
`src/08c-ne-loader.wat` initializes the new task on its thread. This is not a
separate browser Wine process. Frozen `host.js` `_maybeStartGuestWorker` passes
`_mainImports.host` to the broker, without `hostImportsForSlot`; `create_window`
and `show_window` address the same Wine renderer. Thus HWND `0x18001` should
be represented there after successful creation. Its later absence cannot be
explained merely by calling the existing census “main-only.” The captured
console has no explicit guest trap, broker exception, or thread-exit report.
`destroy_window` removes renderer entries without a console line, leaving
creation/removal timing unresolved. The census uses the actual plain-object
`renderer.windows` (`renderer.js:70`), not a Map. Its 24-entry cap returned
only two entries, so truncation does not explain the missing child.
`GuestThreadHost.spawnThread` reuses the same broker and shared memory; it
does not fork a renderer for the Win16 task. The next bounded diagnostic should retain
original forwarding and capture create/show/destroy arguments, immediate
renderer entry identity before/after, originating broker slot/thread identity,
and read-only shared HWND state. No broad instruction trace or guest mutation
is warranted by these images.

The strict harness exited 1 despite complete resource cleanup because it
refused ten CARDS filename probes. These are legitimate optional searches:
`host.js` `_loadWin16Dlls` accepts absent candidates, and `dll-loader.js`
`win16StageableModules` includes compiled-in CARDS independently of imports.
The original SETUP module table contains only KERNEL, GDI, USER, LZEXPAND and
TOOLHELP. The exact absent filenames are `CARDS.DLL`, `CARDS.dll`, `CARDS.VBX`,
`CARDS.vbx`, `CARDS.EXE`, `cards.DLL`, `cards.dll`, `cards.VBX`, `cards.vbx`,
`cards.EXE`, all below the original media directory. Declare only these missing
probes as expected 404 on a future harness; do not broaden file access or alter
the old 403 receipt. `optional-cards-probes.json` records that correction.
Browser/server closed at 10:27:05.715, streams pending 0, Chrome exit 0;
driver 2512853 and Chrome 2512867 were absent afterward. No retry occurred.

### 2026-10-07: actual child window destruction captured

The one repeat, `scratch/new-game-antara-20261007/attempt2/`, recorded six
host lifecycle events and closed the observer at 15 seconds without overflow
or observer errors. All 139 served source hashes matched. Child slot/tid 1
created HWND `0x18001` in the same renderer, with geometry `0,0,8707,480`.
ShowWindow made that entry visible; the child's actual `destroy_window` call
removed it 73ms later. This is explicit destruction, not a renderer losing
another task's window. The guest reason and DLL initialization outcome remain
unobserved.

The native-recovered original `_SETUP.EXE` relocation table identifies one
USER.452 CreateWindowEx call: segment 2 instruction 1562, relocated operand
1563, return 1567. It identifies one USER.53 DestroyWindow call: instruction
1779, operand 177a, return 177e. These are static image candidates, not yet
dynamically authenticated callers. Creation wrapper 2:148e builds a 34-byte
argument block at BP-22h, passes its address to virtual method vtable+38h,
then pushes that block in Pascal order. Width comes from wrapper BP+14h into
BP-16h and is pushed at 2:154d; height BP+12h is pushed next. The WAT USER.452
handler reads width at word index 6, height at 5 and extended style at 15.
This static layout agrees. Width 0x2203 alone does not prove an argument shift;
the virtual method can modify the argument block before the API call.

Destruction wrapper 2:174a tests object+14h (HWND), obtains a property through
its 2:176b call, then passes the HWND to USER.53 at 2:1779. Its caller and
reason remain unresolved. The next useful boundary is the owning Win16
return/stack and object identity at those exact calls, authenticated against
the mapped original image. No generic renderer fix or forced value follows.
Static receipts: `child-user-calls.json`, `child-createwindow-disasm.txt`,
and `child-destroywindow-disasm.txt` under the Antara scratch directory.

Base CARDS probes returned expected 404; the normal `fetchAssetBytes` fallback
then requested ten corresponding `.part000` names. All are absent, explicitly
enumerated in `optional-cards-part-probes.json`; declare only those negatives,
not a wildcard. The old response evidence is unchanged. Ordinary cleanup at
10:50:04.890 closed browser/server, streams 0, Chrome exit 0, both PIDs absent.
Overall exit 1 retains those ten refused fallback requests. No installer input
or gameplay was claimed.

### 2026-10-07: owning caller frames authenticated; width boundary unresolved

Attempt 3 served the private Worker but lost its probe records: the private
sender used `t:'log'`, which the actual WorkerLink does not handle. This was a
diagnostic transport failure, not absence of guest calls. A regression through
the real WorkerLink handler and page-console collector demonstrated the old
drop and the corrected bounded call/end delivery before attempt 4.

`scratch/new-game-antara-20261007/attempt4/owner-probe.json` retains ten raw
console records, including duplicate delivery through the existing log paths.
Both main and child end records report no observer errors. The child creation
frame has SS=0087, BP=6338 and candidate object 0037:0418. Both the wrapper
argument at BP+14h and its copied local at BP-16h contain **640**; height is
480. The actual host import receives width **8707 (2203h)**. This narrows the
discrepancy but does not yet identify the write or incorrectly read argument.

The captured caller return is 0047:9a63. Its 48-byte span corresponds to
original segment 2 and the call at 9a5e to creation wrapper 148e. The destruction
frame returns to 004f:0615, immediately after virtual method +34h in original
segment 3. Both spans match the original after its explicit relocations.
The first comparison retained two unexplained bytes in each span because its
offline parser stopped each relocation chain at 512 links. The complete
segment-bounded, cycle-checked traversal resolves these as selector-only
relocations: segment 2 site 9a61, chain index 526, target segment 2/selector
0047; segment 3 site 0629, chain index 630, target segment 3/selector 004f.
The original comparison is preserved beside `caller-code-comparison-v2.json`
and the reproducible `authenticate-callers.js`; no captured bytes were edited.
This authenticates these small caller spans, not the entire mapped image.

Raw EIP 0017152f at creation is **not** the USER.452 call instruction.
`win16_far_transfer` dispatches imported calls without setting EIP to the
import or callsite; the basic-block start can remain visible. Original 2:152f
starts the argument pushes, and the static USER.452 instruction is 2:1562.
The wrapper's BP-relative locals therefore cannot replace a capture of the
actual Pascal argument stack. The normal 16-bit push path uses segmented
effective addresses, reads each word before decrementing ESP, and pushes 17
argument words followed by the four-byte far return. For this exact wrapper,
the expected API stack starts at BP-4ch; its width word is at BP-3ch. Neither
was covered by the old probe starting at BP-28h.

The source bridge reads width from Pascal word 6 into a local before changing
ESP, writes it to Win32 scratch ESP+28, and the shared CreateWindowEx handler
loads that into its own local before the host import. Coordinate conversion
preserves 640. No ordinary normalization in that path changes it to 8707.
The bridge uses the shared GUEST_STACK top, but contention or corruption there
is only a hypothesis: this capture has neither the pushed Pascal words nor
the bridge scratch words. The smallest next observation is those two bounded
spans at the same owning import, plus the existing last-module/ordinal getters
and mapped 2:152f..1566 bytes. This distinguishes a bad pushed argument from a
later bridge discrepancy without a hot instruction trace or guest mutation.

Candidate object 0037:0418 changes its first far pointer from 004f:2488 at
creation to 004f:2438 at destruction. The captured destruction return belongs
to the original 3:0552 routine's path after a comparison against 0481h; it
clears object+5ah and invokes virtual method +34h. The return span proves that
callsite, not the earlier comparison result, dynamic vtable target, or reason
for shutdown. Those remain unknown; zero object HWND in this late observation
must not be interpreted as the input to USER.53.

Attempt 4 used module
`992a8b021897e52d2ec1b5f3604f5f89098f02ee2e4748e5340ff4d960f5e880`,
private Worker `33d4d06190c0d45d9f0edc72a1375c63bd2b9d32f3b84b9944069e72a7395649`
and WorkerLink `06738ee3c2b0fcf52ca3ea98c614be83decf88a8e3d85384ffed0718f8f9757f`.
It received no installer input and still showed black after the startup
window. Ordinary close completed at 11:18:29.093Z, exit 0, errors empty,
streams pending 0, browser/server closed and driver/Chrome PIDs absent.
There is no installer-success or gameplay claim, and no engine fix follows
from the width discrepancy alone.

### 2026-10-07: normal geometry still shuts down; dialog boundary next

Attempt 5 (`scratch/new-game-antara-20261007/attempt5/`) authenticates the
56-byte original argument-push block at 0047:152f, with only its explicit
USER.452 far relocation changed. The owning API identity is module 2, ordinal
452, and the pushed return is 0047:1567. The actual Pascal arguments and host
import both contain **640x480**. The same renderer creates that size, shows
the child window, and receives its destruction nine milliseconds after
creation. Therefore the prior 8707 width is not necessary for the observed
shutdown and is not a stable reproduction in this run.

At the later host-import observation, scratch ESP+28 contains 640 but ESP+32
contains zero, whereas the host's already-hoisted height argument is 480.
This is a later memory snapshot, not evidence of what the handler originally
read, and it does not identify a writer or prove inter-thread contention.
No width-only retry or speculative bridge repair follows.

Static relocation resolution supplies a more relevant shutdown boundary.
Original segment 3:05b0 calls **segment 2:30ea**, not segment 3:30ea. That
wrapper invokes USER.87 DialogBox for a nonzero template identifier, or
USER.218 DialogBoxIndirect for the other form, and returns its AX unchanged.
The caller compares AX to 0481h at 3:05b5; the other branch clears the parent
object's +5ah field and calls its virtual destruction method at 3:0611.
The observed return 004f:0615 belongs to that method call. The preceding
actual API result is still uncaptured.

Existing attempt 4 and 5 frame bytes already contain the small dialog object's
first 40 bytes: the saved parent BP is 6778h and its local object starts at
BP-21eh = 655ah. Both copies have template identifier +1eh = 0066h, selector
part +20h = 0, and parent far pointer +24h = 0037:0418. This agrees with
constructor 3:d278 passing 0066h to base constructor 2:2ffe. These are late
bytes, not proof that no intermediate mutation occurred.

The original `_SETUP.EXE` does not contain dialog 102, but that is not a
missing-fixture finding: the original SETUP.SOL member **SOL_ENG.DLL** contains
that dialog (offset 427824, 48 bytes). Native decoding in
`inspect-language-resource.js` produces 485312 bytes, SHA-256
`22f02bb8ee3adbe997b87bff3409492effb35baa0453d39e78104002cf33a375`.
The setup's source names `setupl.dll`; segment 3:10f6/1150 copies a loaded
module handle into DS:108c, which the named-dialog wrapper supplies as
hInstance. Original strings distinguish `Can't find SETUPL.DLL` and
`Can't find EREGLIB.DLL`. Runtime staging, that handle's actual value, resource
selection and the DialogBox return must be established before blaming a
dependency or dialog implementation. The useful next boundary is that module
and dialog call/result, not another geometry capture.

All 139 full served-source responses matched pins; raw observer SHA-256 is
`befe1b2b1da4405f790037744407e45e4923d50149ab33a08865251e5bf6be2a`.
`analysis.json` records the byte comparison and geometry; both prior width
receipts remain unchanged. The scene was black, with no installer input.
Ordinary close at 11:39:58.550Z completed with exit 0, no errors, zero pending
streams, browser/server closed and both PIDs absent. No gameplay claim.

### 2026-10-07 owning trace arm; first scalar not retained

Attempt6 (`scratch/new-game-antara-20261007/attempt6`) authenticated the actual
child instance before its first run: task slot0/module15, entry FFFE1600,
original stack parameter0 and inherited trace flag0. At the later USER452
CreateWindow import it authenticated the original CS152f push span and far
return47:1567, rechecked the task-start record, then enabled the existing bounded
Win16 diagnostic flag. This is declared instrumentation, not a passive getter
or a performance run. It did not modify installer state or send input.

The parser stopped on its **first unknown scalar**, leaving zero decoded frames.
The exact rejected value was unfortunately **not retained**. No DialogBox call,
absence or return can be inferred from this rejection. The frozen CreateWindow
source has a concrete omitted frame, `CA16A9E6` followed by HWND/class/procedure/
class-lookup (four scalar payloads), after the host CreateWindow call. That is a
source-backed parser omission, not proof that the uncaptured scalar was E6.
Saved console output does not recover the numeric value. The separate proposed
`dialog-trace7.js` retains a bounded rejected value/index and recognizes that
exact source frame; its21 pure-JS tests include actual source payload widths,
marker-valued payloads and nontrace interleaving. No subsequent guest run has
been authorized or performed for that revision.

At arm, DS was0087 and both DS:108a/108c contained0087. This is meaningful but
must not be mislabeled an invalid module handle. The authenticated original
segment2 ran at selector0047 (index8), giving module segment-index base6.
The original child's NE automatic-data segment is10; the loader therefore
selects `((6+10)<<3)|7 = 0087` for its DGROUP. The resource resolver recognizes
the task DGROUP **before** trying the narrowed-handle table. The probe's
`sentinel/unmapped handle` label merely says no dynamic-table entry was read
for this below0100 value. Thus both globals held the valid task instance at
this earlier boundary. They may change during creation callbacks; there is
still no actual USER87 hInstance/resource-selection observation.

All139 full served-source responses matched the frozen pins, including private
Worker `b4a46a3b831052492616f62a7e9d2f1d89b3ebb00413160a9d0d6fe29f7cfb53`
and private module
`992a8b021897e52d2ec1b5f3604f5f89098f02ee2e4748e5340ff4d960f5e880`.
Raw observer SHA-256:
`316e32330a3aa35fc17e85d33f6e1b31510500dc82e2b15407fd356c5d941fde`.
`analysis.json` records the inference and38 artifact hashes are in `hashes.json`.
The personally reviewed `dialog-boundary.png` is black. Owning stop replies
reported both current contexts closed and trace ownership cleared; ordinary
cleanup at12:24:55.627Z had exit0, no errors, zero pending streams, browser/server
closed and driver2645450/Chrome2645465 absent. This remains installer diagnosis,
not gameplay qualification or a completed modal-dialog result.

### 2026-10-07: complete trace frames, early cap before DialogBox

The separately authorized attempt7 used the source-censused17-frame protocol
and real WorkerLink transport regression. Evidence is under
`scratch/new-game-antara-20261007/attempt7/`: `owner-probe.json`,
`analysis.json`, `hashes.json`, `dialog-stop.json`, and `cleanup.json`.
The owning child emitted32 complete frames/330 scalars and stopped at the
predeclared32-frame cap, with no rejected scalar or partial frame. Its first
frame was the actual CreateWindow `CA16A9E6` frame. This observation applies to
attempt7; attempt6's unretained rejected value remains unknown.

The capture ended before USER87. KERNEL47 returned0087 for the captured far
pointer004f:20c0; the authenticated original child's segment3 offset20c0 holds
`SETUP`, not `SETUPL`. KERNEL49 returned26 on two module-filename calls with
instance0087. Neither result identifies the language DLL. The last paired
entry/return was KERNEL127 GetPrivateProfileInt, with default0 and AX0. Its
pointer offsets correspond to original segment3 strings `Config`, `CDROM`,
and `SIERRA.INI`. These string interpretations use original bytes, not captured
live string bytes. Return0 matches the provided default and does not prove a
missing-file error. The earlier DOS AH3d record contains raw registers only;
its live filename was not captured.

All139 full served-source responses matched the frozen pins. Private Worker
was `a7674fcf5c7d31d940be112916a6a1f4c5c1cc885bc4985c1b4293fdbf628996`;
module remained `992a8b021897e52d2ec1b5f3604f5f89098f02ee2e4748e5340ff4d960f5e880`.
Raw observer SHA-256 is
`3b99aed39eb70ebc17d9213dc9a6ed5b5b931d2dea043b66f5991d072fc543ca`;
`hashes.json` covers40 artifacts. The reviewed screenshot remained black and
no input was sent. Both owning contexts acknowledged closed/trace-unowned.
Ordinary cleanup at12:44:18.935Z closed browser/server/recorder, had no errors
or pending streams, and Chrome/driver exited0 with PIDs absent.

The next source question remains the normal SETUPL load and actual DialogBox102
selection/return. Repeating the same early32-frame interval would not answer
it. This capture neither establishes missing DialogBox execution nor a modal
failure, and supplies no gameplay qualification.

### 2026-10-07: actual DialogBox102 resource miss

Attempt8's reviewed selective parser validated241 frames/2638 scalars, retaining
three causal frames before the owning destruction import closed tracing. It
had no unknown scalar, partial frame, or exhausted cap. Actual numeric USER87
entry supplied hInstance0087/template102 and returnEIP0017313f. Resource trace
(type5, ID102) returned found0; the paired dispatch return was AXffff at that
exact EIP with ESPdelta16. This is the source-defined immediate resource-miss
return, not a completed modal dialog. DS108a/108c still contained0087 at entry.
The previously authenticated task DGROUP derivation applies; its below0100
handle-table label must not be mistaken for invalidity.

`scratch/new-game-antara-20261007/attempt8/analysis.json` records the source
interpretation and `hashes.json` covers44 artifacts. Raw observer SHA is
`a2f44f7058c07d8cb2b5cfd52fada764917fd41ecf4c7551b149e62a6115bfef`.
All139 full served-source hashes matched; private Worker was57acc41a and module
remained992a8b02. The personally reviewed screenshot shows a gray Sierra
On-Line Setup parent, black area below, and no child controls; no input was
sent. Both contexts acknowledged trace cleanup. Ordinary close13:02:53.034Z
had no errors/pending streams, browser/server/recorder closed, driver2687564
and Chrome2687583 absent, session95723 exit0. No gameplay qualification.

There is now a concrete source candidate for the wrong resource owner. Original
segment3:10b5 calls GetModuleHandle("setupl.dll"): relocation10b6 is imported
module1/ordinal47. A nonzero AX skips the LoadLibrary call at10cc (relocation
10cd, ordinal95), stores the value at object+de, and copies it into DS108c at
10f6. The frozen emulator's named GetModuleHandle fallback returns current DS
for an unknown or unloaded module. That can manufacture0087 and suppress the
normal load. A separate branch at1136 calls LoadLibrary directly. The selected
trace retained no KERNEL95 during its covered interval, but omitted ordinary
KERNEL47 frames and did not cover all earlier initialization. Thus the observed
resource miss is established; this particular branch/cause is not yet proven
by a captured named lookup. A generic fix requires authentic unknown-name,
loaded-module, task-name and null/integer-handle controls, not a game-specific
resource redirect or guessed SETUPL handle.

## 2026-10-07: ordinary combined-build installer reaches version error

Ordinary attempt9 used combined source efb1dba0 (served tree3e876257 adds
validation documentation only), module
`d4256f3cd6b085a4acbd8192df7e9d0de8625beb82d10060ac2f27a51d8add74`
(1,719,494 bytes), and only a private app-registration overlay. There were no
trace/Worker overrides, forced guest calls, or ordinary inputs. Original SETUP
produced a visible Main Menu and a clipped Setup Version Mismatch dialog with
OK/Help controls and blank body. Root independently reviewed the screenshot.
This is installer progression, not gameplay or completed installation.

Evidence: `scratch/new-game-antara-20261007/attempt9/installer-settled.png`,
its read-only window state, `analysis.json`, and `hashes.json` (17 artifacts).
All139 complete served source responses matched pins. Session92449 exited0;
ordinary cleanup13:55:16.974Z closed browser/server, errors[], pendingstreams0,
Chromeexit0; driver2749016 and Chrome2749135 were absent. No retry occurred.

Authenticated original source narrows the next failure. Original _SETUP SHA
`a11e70704b15c12424e771a1b7c331396f69644d7cb1f53a7a5b3999f9309bb4`
segment5 reads SetupVer via KERNEL128 (not a measured runtime argument);
the exact call opcode is5:340a, relocation5:340b. SIERRA.INF declares3.3.0.0.
Function5:38b0 initializes its output to0.0.0.1, calls imported VER6 at38ec
and VER7 at3917, and preserves the fallback when either fails. Comparison
5:3446..3466 emits string IDs61/62 when the requested string sorts higher.
Original SOL_ENG resource61 says a newer Sierra Setup is required;62 is the
observed title. These static strings do not claim the blank body was rendered.

Original _SETUP NE RT_VERSION type16/id1 is at file417648,432 bytes. Its ANSI
VS_VERSION_INFO root has fixed-info signature at offset20 and actual file
version3.3.0.0. Current Win16 VER6/7 delegates ordinary named files to
file_version_resource, whose signature check accepts only PE. That is a
concrete generic NE resource-reader gap; actual runtime filename/operands
remain unobserved. Next work is bounded NE version-resource support with
real-module VER6/7 and existing PE regression coverage, not a forced version
or skipped comparison.
### 2026-10-07: tested generic NE version resource and query support

Ordinary installer findings remain in the separately available commit
`da757ef9`: the original installer reaches Setup Version Mismatch, and its
original `_SETUP.EXE` contains version 3.3.0.0 in an ANSI NE resource.
The generic file reader now accepts NE RT_VERSION tables as well as PE
resources. It bounds the NE header/table reads and each record count, computes
shifted file ranges in i64, and releases temporary allocations and file handles
on success and failure. The returned resource bytes retain their original
encoding and padding. Win16 VER6 still reports the original 432-byte resource;
VER7 copies only the caller's capacity, including short and zero-byte requests.

The query walker distinguishes the bounded ANSI root from the PE UTF-16 root,
uses the appropriate node header/key widths, and bounds values by their node.
ANSI queries return in-buffer pointers and declared byte lengths. Wide queries
convert StringFileInfo text using CP1252 (the default emulated ANSI page);
fixed-info and translation values retain their binary pointers and byte counts.
The Win32 size APIs reserve a caller-owned conversion trailer, with separate
slots for each value. Answers survive later queries on both the same block and
other blocks; freeing or reusing the caller's block ends their lifetime.
The Win16 size adapter omits this trailer and preserves its static DirectX
fallback. Layout/length semantics were checked against Wine's
[kernelbase version implementation](https://github.com/wine-mirror/wine/blob/master/dlls/kernelbase/version.c).

`test/test-ne-file-version.js` drives real NE import relocations and VER6/7/11
far-call returns against a real VFS. It covers original-byte copies, root/text/
translation queries, far-pointer identity, malformed shifts/counts/ranges,
absent files, PE controls, CP1252 conversion, embedded NUL byte counts, empty
values, retained answers, and closed file handles. Its optional authenticated
original-file argument verifies the exact recovered 432 bytes and fixed version.
The default invocation compiles the test-only wide/size exports; a production
module argument additionally validates the ordinary Win16 ABI on that module.
No private fixture or generated image is required or committed.

Evidence in this worktree: `scratch/antara-ne-version-worker/`.
Pinned `focused-attempt6-supervisor/result.json` passed in 7.411 seconds, with
the process group clear. The HEAD control failed the exact NE resource-size
assertion; the final candidate and existing PE version suite passed. Earlier
attempts preserve an obsolete harness address, test-export/read-helper errors,
and a corrected tombstone assertion; none is counted as validation.
`production-attempt1` stopped at a missing sparse-checkout build input. Missing
tracked inputs were restored from this worktree's HEAD, without changing gates.
`production-attempt2-supervisor/result.json` passed in 24.885 seconds, with
closed output and process group clear. Mandatory `bash tools/build.sh`, NE file
version (including the authenticated original), PE file version, Win16 version,
NE loader (2881 checks), NE image extent, additive far relocation, module query,
and static DirectX version regressions all passed. Production WASM is 1,720,492
bytes, SHA-256 `fb1be916c309bf619a9331c8fd46c4319f9051af76b05b236d3c362bb632638f`.
Both supervisors enforce deadlines, output caps and a 2 GiB disk floor.

The generic fix is ready for root integration. Ordinary installer progression
on this version fix remains untested; no browser was run. Next validation is
the original installer on a separate temporary browser box after integration.

## 2026-10-07 actual installer initialization callback

The ordinary original installer on source `096889e174488a97529b8e73076d3a1e2feb2345`, module `fb1be916c309bf619a9331c8fd46c4319f9051af76b05b236d3c362bb632638f`, delivers `WM_INITDIALOG` to the original procedure `0047:2ca0`. Its lookup returns object `0087:655a` and virtual slot `+70h` enters authenticated original `004f:d530`. It installs the normal `0047:12f2` window subclass; ordinary dispatcher slot `+58h` enters authenticated `0047:1c2e`.

A concrete asset failure occurs during initialization: bitmap type 2 / id 164 is found as resource handle `0118`, but `LoadResource` returns zero, `LockResource` returns `0000:0000`, and `CreateDIBitmap` returns zero. Original `SOL_ENG.DLL` contains the bitmap (640x480, 8 bpp, 308272 bytes). The allocation/open/read cause is not measured yet. The capture reaches its 512-hook cap before paint; it does not establish a paint failure. No sizing or artificial-control fix follows from this evidence.

Contained run `scratch/runs/20261007T222523Z-antara-callback-init/artifact-index.json` has 570 hashed artifacts, all 509 runtime pins, original media/module/source, four screenshots and terminal cleanup. The reviewed scene remains an empty gray Main Menu, with no input, completed installation or gameplay. See [callback evidence](../../ops/handoffs/antara-callback-init-20261007.md).

## 2026-10-07 actual failed resource open and paint dispatch

The narrower actual child trace measures `fs_create_legacy_file` for KERNEL61 opening an **empty pathname** at WASM `07024000`, EIP `1a3eed`, and returning `FFFFFFFF`. No seek/read follows. The earlier `C:\NAME.DLL` source hypothesis is not the observed open and remains insufficient for a fix. `WM_PAINT` reaches original subclass `0047:12f2`: parent object `0037:0418` and dialog object `0087:655a` both dispatch virtual slot `+58h` to actual original `0047:1c2e`.

Contained run `scratch/runs/20261007T225022Z-antara-resource-outcomes/artifact-index.json` preserves full 510 pins, exact unchanged module/source, two reviewed screenshots and complete 15-second owner trace (36 blocks, two virtual entries, 124 complete frames / 1317 scalars, no observer errors). The scene stays gray, with black left/bottom client strips and no actionable controls. An unsupported collector screenshot command after the complete trace caused orderly closure; this is recorded separately from guest outcomes. Empty-path origin, installation completion and gameplay remain unproven. See [resource outcomes](../../ops/handoffs/antara-resource-outcomes-20261007.md).

## 2026-10-07 resource module identity and selected-path repair

The next actual owning-thread observation, `scratch/runs/20261007T230333Z-antara-module-context`, authenticates HRSRC `0118` as descriptor `E1000002`, module id 19 / resident name `SETUPL`, and instance `0110` as `00D10013`. Its metadata NE header matches the recovered original language DLL except the known nonresident-name-table rewrite. The actual resource open is `C:\SETUPL.DLL`, returning `FFFFFFFF`; no seek/read follows. Task slot 0 still contains `C:\windows\temp\_setup.exe`. This does not prove task-path loss or explain the earlier empty-string sample. Shared scratch concurrency remains a hypothesis.

The loader selects a resident DLL through its VFS path but previously discarded that path. Resource loading fabricated a root-directory name instead. Commit `2e68d0ac4` retains the selected path in a module-owned pooled allocation, uses it for real resource reopen and AccessResource, reports it through GetModuleFileName, and frees it on unload/reset. No original media, API result, callback or paint behavior is overridden. The actual staging path was not captured by the original observer; the source selection and regression establish the generic path-loss defect.

The actual-WASM regression first reproduces failed loading with the old staging contract, then reads all 135168 original synthetic resource bytes through a nested selected path. It checks filename bounds, real AccessResource seek, cached resource references, unload and module-slot reuse, all 24 dynamic path slots and adjacent metadata integrity. Existing resource-handle-reuse and FreeLibrary-arena regressions pass. Full mandatory build passes on source `2e68d0ac4c41ce3cf2f4745d94846c25ea4b0399`, module `0d647b4d9783c5f5d40700f4f7ae3ee18be12a95249daf68533f172b1e5dc8f3` (1721448 bytes). Ordinary original installation/gameplay validation is pending; these regressions do not qualify gameplay.
