# Command & Conquer: Tiberian Sun demo

## Refill selection and original closure, October 7

Darkstone was excluded after recovering its existing controlled Town captures;
Tiberian Sun replaces that lane. Latest remote main
`1fba75144006e74fd44efd396ecb59e1260c417d` has neither title in `DESKTOP_APPS`
and no Tiberian Sun APPS registration. Retained board entries from October 6
record a live main menu and a grey campaign panel, not qualified gameplay.
The old resource wait for a temporary boat is resolved by the current remote
queue; no user pause is inferred from its superseded priority handoff.

The original self-extracting archive is
`test/binaries/win98-games-a-d/CnC-TiberianSUn-ts_demo-SW.exe`; its existing
26-file extraction is `CnC-TiberianSun-demo-SW/extracted/`. A read-only ZIP
catalog audit verified every extracted file's size and CRC against the
original archive. SHA-256 pins are retained for all files and the archive in
`scratch/runs/20261007-tiberian-sun-preparation/original-fixture-closure.json`.
Original `SUN.EXE` is 3,256,592 bytes, SHA-256
`f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`.
The original readme explicitly permits launching Sun.exe after extraction;
no invented installer registry or settings are required by this preparation.

## Prepared ordinary browser environment

Reuse exact existing source `0cbc1c6ffd997f5ab31142b4f2d9d57b318d05c6` and module
`7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0`.
Only a private app registration overlay differs. There is no emulator fix,
guest patch, asset replacement or settings change. The normal recursive DLL
graph includes the game's BLOWFISH.DLL and native OLEAUT32/COMCTL32; the
available system `stdole2.tlb` is included. SHELL32/OLE32 have no native URL in
the normal registry; their ordinary WAT fallback remains intact. All 26
payload files, these two system DLLs and the TLB form 29 fixture pins, alongside
326 source/module pins. Full graph probes and hashes are in the contained
preparation run's `loader-closure.json`, `browser-pins.json` and `READY.json`.

Offline LANGUAGE.DLL dialog decoding identifies original main-menu template
226: Exit Game 1006 at y117; New Campaign 1559 at y12; Load Mission 1561 at
y33; Multiplayer 1562 at y54; Intro 1003 at y75; Options 1372 at y96.
Campaign template 148 contains list 1109, OK 1, Cancel 2 and difficulty slider
1295. These are resource units, not reviewed screen coordinates. The prior
owner corrected the hit-test hypothesis: New Campaign was delivered as
WM_COMMAND 1559; the grey campaign panel and displaced captions still need
actual current-run evidence before attributing a generic defect.

Source preparation initially queued behind Antara and corrected Winamp on
`bx_d8nw3e8t`. The prepared driver enforces a
600-second session, 2 GiB disk floor, current personally reviewed screenshots
before ordinary clicks/held keys, and terminal browser/server cleanup. No
gameplay or FPS qualification follows from this source preparation.

## Actual ordinary browser result: main menu remains unusable

The coordinator's October 7 22:31:45 UTC grant moved this title ahead of
Winamp to preserve the temporary box's lifetime. Independent preflight found
the prior owner's PIDs absent, no Chrome process and 49 GB free. Transfer
verified all 355 runtime pins before launch. All attempts shared the first
launch's absolute deadline, 22:43:58.973 UTC; actual browser activity was
22:33:58–22:41:25, under the 600-second aggregate limit.

The first two attempts are preserved harness failures, not compatibility
results. First, the private APPS entry was missing from the visible HTML
selector, and Puppeteer's unchecked `select()` launched Notepad (404).
The second added the visible option and checked selection, but lacked the
normal `binaries/...` URL aliases for the pinned `test/binaries/...` files,
producing SUN.EXE 404. Both were stopped and terminal cleanup verified.
The corrected third attempt includes all 29 fixture aliases, the visible
selector option and a fail-closed selector assertion. Emulator source, module,
original files and settings remain unchanged.

Attempt 3 loads the original title/background and creates the 640×480 main
window plus a visible grey rectangle at guest x171/y187, 299×202. Startup,
settled and final captures show no usable menu controls or captions.
An ordinary 200 ms Escape press logs WM_KEYDOWN, WM_CHAR and WM_KEYUP, with
no visible menu response. No invisible menu control was clicked. New Game,
player control and gameplay were not reached; FPS was not measured.

The visible built-in Thread State button was clicked normally. Its popup
reported main EIP `0x004230e2`, yield 0; static original disassembly places
this inside the bitmap row loop `0x423074`–`0x423111`. Repeated popup samples
alone do **not** prove a stopped loop. A bounded read-only sample using existing
Worker getters observed EIP `0x4230cb` then `0x4230d9`, different register
values and ongoing slice activity. Additional existing `guest_read32` calls
sampled twelve stack fields without writing guest memory; these reads are
not atomic with the getter snapshots and cannot establish a zero-height
underflow. No hook replacement, execution forcing or state bypass occurred.

The first failed user-visible contract is main-menu painting. This is not
proved to be a missing asset, missing native DLL, stopped CPU, input-routing
bug or owner-draw callback defect. The exact creation/paint cause remains
unmeasured. The next causal step is to observe original template 226 control
creation and its first native/guest painting callbacks before proposing a
generic repair. No speculative emulator change was made.

Evidence: `scratch/runs/20261007-tiberian-sun-preparation/investigation.json`,
with separate `evidence/`, `attempt2/` and `attempt3/` outputs. Six reviewed
final-attempt images include the ordinary Thread State popup; no image is
marked gameplay. The contained artifact index covers 91 files; all 184
served GET/range producer hashes match their pinned source bytes, including
the full 1,720,920-byte module's SHA-256. The server records cannot prove
client consumption of every stream. All 26 payload hashes and original
archive hash remained unchanged after the run.

No candidate-corpus manifest entry exists for this title. Its local app ID is
`tiberian_sun_demo`; investigation metadata explicitly leaves candidateId
null and is retained in these notes rather than attaching dashboard
`result.json` to an unrelated candidate.

Ordinary quit closed browser and server, Chrome exited 0, pending streams were
0 and cleanup errors were 0. Independent checks found all six attempt
driver/Chrome PIDs absent and no remaining Chrome or owned port 39265 at
22:41:39 UTC. The worker's unique remote prefix was removed at 22:43:50,
after evidence collection; the box was retained for the coordinator's Winamp
run. Shared HEAD/index, local native/build ownership, Arx and public deployment
were untouched.

## Coherent creation and bitmap observation, October 7 22:58 UTC

After Antara's explicit release and the coordinator's next-slot grant, an
independent preflight verified actual prior PIDs absent, no Chrome, the
released socket baseline and 49.7 GB free on temporary box `bx_7qga8j7x`.
The box had no `/home/user/wine-assembly/node_modules/puppeteer`; the harness
used the retained handoff dependency at
`/home/user/antara-resource-tools-20261007/node_modules/puppeteer`.
All 355 runtime pins and 29 fixture aliases verified before launch. Original
module `7c6864f8` / source `0cbc1c6ff` stayed intact.

Private Worker SHA-256 is
`b426f3f20413c578629ac59abe514846f89e1bfcc78cc979dcf685f9632fe52b`.
The observer forwards original imports, receivers, arguments and results,
changing only existing diagnostic trace flags. Register/stack samples occur
synchronously inside the owning Worker at block-entry imports, without guest
writes or separate RPC getter calls. Unit tests and the transformed Worker's
actual init/slice/receipt/close RPC tests pass.

`CreateDialogIndirectParamA` receives the original menu's in-memory template
at guest `0x00e89050`, with caller EBP 226. At `dialog_loaded`, HWND `0x10002`
has six correct button IDs, styles, geometry and captions. USER window-title
copies and native ButtonState text agree: `0x10003` / 1006 is “Exit Game”,
`0x10004` / 1559 is “New Campaign”, then 1561 “Load Mission”, 1562
“Multiplayer Game”, 1003 “Intro / Sneak Peek” and 1372 “Options”. The
creation-time caption displacement is not reproduced; later text mutations
remain unmeasured. `$title_table_set` owns a copied heap buffer, so freeing the
parser's temporary string is not itself a defect.

Original DLGPROC `0x4dea40` receives WM_INITDIALOG. Ordinary SetWindowLongA
installs `0x57e790`; both callback entries' 64 bytes match immutable original
SUN text. The callback cap is reached during startup/custom message `0x497`,
before a WM_PAINT/DRAWITEM callback is captured. This is not proof of owner-draw
paint delivery.

Bitmap helper `0x422c20` has a signed-positive guard at `0x423064` before storing
the row counter at `[ESP+0x30]`. Coherent samples observe a 202-row limit,
back-edge counters 201, 200, 199 and 170, then counter 0 at `0x423117` and
`0x42312b`, completing that call. A 12-row call also completes. These observed
loops do not underflow or remain stuck. Direct-window-only snapshots omit high
sparse bitmap objects, including pointers near `0x08bfb000`. Actual destination
pixels and presentation targets remain unmeasured.

The personally reviewed screenshot still shows title artwork and a blank grey
299×202 main-menu rectangle. No gameplay/input qualification or generic repair
is claimed. Next: callback entries rather than startup block flooding, sparse
bitmap objects, actual GDI geometry/target/pixel samples and raw renderer canvas
layers. A composition explanation remains a hypothesis.

Self-contained evidence:
`scratch/runs/20261007-tiberian-paint-preparation/investigation.json` and
`analysis.json`, with 43 verified indexed artifacts, including the complete
original runtime/fixture package, `diagnostic/paint.json` and reviewed
`diagnostic/01-first-paint.png`. Runtime was 22:58:18–22:59:17 UTC under a
180-second guard. The 15-second observer ends without errors after 2048 bitmap /
256 callback hook caps. Close RPC on the initial blank page logs one collector
`ReferenceError: runningApps is not defined`; the observer had already closed.
Browser/server cleanup still succeeds with Chrome exit 0 and streams 0.
Independent 23:00:00 checks find actual PIDs 35864/35876 absent, no Chrome and
the original socket baseline. All 355 pins verify again before the owned remote
prefix is removed at 23:00:24; dependency tools remain for Antara's next grant.
No production repair or local native/build run was performed.

## 2026-10-07 first paint delivery and sparse bitmap contracts

One targeted run at 23:13:44–23:14:23 UTC used the same original payload,
source `0cbc1c6ffd997f5ab31142b4f2d9d57b318d05c6` and module `7c6864f8…`.
Private Worker `16197636abb9cb491ed6231d0960de44b9a99a9d4c38a95a2defbf79da703a76`
replaces broad callback tracing with exact callback-entry observations and
reads sparse objects through the pinned pure JS address translator. All import
receivers, arguments and results are forwarded; no guest bytes are written.

Original authenticated subclass `0x57e790` receives WM_PAINT for dialog
`0x10002` and all six buttons. The parent calls original `0x580ac0`, then the
normal dialog proc `0xffff0004`. The first button calls original `0x580c00`
and reads its text with GetWindowTextA. Sparse bitmap-copy entries now expose
the 299×202 menu and 191×26 first-button objects, each with two bytes per pixel.
This establishes actual paint delivery; it does not establish correct pixel
contents or composition. In particular EDI at the sampled loop is not the
destination pointer, so its null byte sample cannot diagnose an empty image.
Nested API entry/exit records must not be paired blindly.

The reviewed `diagnostic/01-destination.png` still shows the blank menu.
The raw-canvas collector fails with `native canvas type unavailable back`:
it accepts HTMLCanvasElement, whereas the renderer's `_createOffscreen`
creates OffscreenCanvas when available. `surfaces.json` is absent. A prepared
native OffscreenCanvas prototype read bypasses the host's flush wrappers;
its focused JS mock test passes, but it has not run in a browser yet. No
generic repair is demonstrated and no gameplay qualification is claimed.

Contained evidence is
`scratch/runs/20261007-tiberian-destination-preparation/investigation.json`,
`analysis.json` and 45 indexed artifacts, including the full pinned package.
The observer stops after 15 seconds with no errors; bitmap hooks cap at 4096,
callback hooks at 128, callback output at 64, and API entries/exits at 40 each.
Ordinary quit closes browser/server with Chrome exit 0 and streams 0. The
collector error and missing UI icon `icons/apps/tiberian_sun_demo.png` are
retained. Independent 23:14:41 checks find PIDs 24030/24042 absent, no Chrome,
and unchanged listeners. All 355 pins verify before removal of only the owned
runtime prefix at 23:14:58. No missing guest fixture/DLL/TLB path was observed.

## 2026-10-07 demonstrated covering layer and candidate generic repair

The 23:19:16–23:20:05 original run captures native OffscreenCanvas layers via
`OffscreenCanvas.prototype.convertToBlob`, bypassing host flush wrappers.
The personally reviewed ordinary screenshot still has the grey menu slab,
but `surface-65537-dxFrame.png` shows the complete, correctly captioned menu.
`surface-65537-gdiChild.png` contains the grey slab at that same location.
The canonical DirectDraw backing (`surface-65537-back.png`) has title artwork.
This demonstrates that original guest menu painting succeeds and the retained
shared GDI child overlay covers the final DirectDraw frame. Numerical layer
write ordering was not captured; no timestamp claim is made from these images.

The ordinary and post-processing compositors already omit separate child
surfaces overwritten by a newer primary present, but always composite shared
GDI child regions afterward. The candidate applies the same ordering rule to
shared regions. Accepted GDI uploads retain non-overlapping rectangles with
their write sequences; a new upload splits previously recorded coverage only
where it overlaps. Lazy canvas flushes cannot revive old uploads. Only the
intersection of visible native child regions and uploads newer than the
primary composites. A newer control upload cannot revive another child's old
background. No application name, HWND, dimensions, or guest state is
special-cased. The focused pixel regression fails on the original renderer at
the exact overwritten-child assertion and passes with the candidate, covering
ordinary output and both post-processing routes. Root review identified a
whole-canvas freshness flaw in initial candidate `5c5b128e1`: repainting child A
also revives stale child B. A real host-upload two-child pixel regression
reproduces that exact failure and passes with rectangle coverage tracking,
including both post-processing paths. Its contained first-candidate failure
is `scratch/runs/20261007-tiberian-repair-preparation/whole-canvas-regression-result.json`.
The existing nine GDI checks
also pass, including upload-versus-flush order and empty-upload behavior.
This source candidate awaits a newly built, identified module and ordinary
runtime/gameplay validation; it is not a completed new-game lane.

Contained evidence is
`scratch/runs/20261007-tiberian-composition-preparation/investigation.json`
and `analysis.json`, with 49 indexed artifacts including all three reviewed
raw layers, the ordinary screenshot, complete original pinned package, and
the baseline regression failure. Ordinary quit closes browser/server with
Chrome exit 0, no cleanup errors and streams 0. Independent 23:20:53 checks
find actual PIDs 34442/34454 absent, no Chrome and original listeners. All 355
runtime pins verify before removing only the owned prefix at 23:21:07.
