# OpenGL / Direct3D corpus status, 2026-10-06

The user's goal: every OpenGL and Direct3D app in the registry works on both the
**software** and the **WebGL** backend. This is the one shared status table for
it (task GLD3D-CORPUS-27-20261006). The D3DRM family's fixes and reruns belong to
w4 (claude:65967384, `docs/re-notes/plus98-dx-screensavers.md`); its rows here
point at that work.

Reconciled on **2026-10-07** against main `30f1e268`. This preserves the dated
measurements below; it is not a new full-corpus run. Tomb Raider III and
Half-Life Uplink have later retained browser evidence that supersedes their
earlier failures. Menu, loading, excluded and unmeasured rows still do not
prove the user's full software-and-WebGL gameplay goal.

## How the set was measured

`node tools/gfx-app-census.js --family=gl,d3drm,d3dim,d3d8,d3d9 --list` (fixed in
`3a7b0ecb` to read every PE an app mounts and the IDirect3D IID bytes) names 69
apps that can *reach* a 3D API. Static reach is not use, so every one was run:
three CLI workers, software arm only, each app traced for the calls that create
a 3D device (`Direct3DCreate8/9`, `IDirect3D*::CreateDevice`, a DirectDraw
QueryInterface for IDirect3D*, `wglCreateContext`) and photographed. Every
screenshot cited was looked at.

- Build: wasm `2809640c` at `3a7b0ecb`. Part of group A and C ran with the host
  JS at `fa4be36a` (a mid-sweep rebase; host changes were compatible: one
  optional `exeGuestPath` field, no new imports).
- Runs: `scratch/runs/20261006T02*-<app>-gld3d-sw/` (and `T03*` for later ones).
  Machine-readable rows: the sweep JSONs named in the GLD3D TODOS record.
- **WebGL arm.** `--headless-gl` is unavailable on this box (no
  `@node-3d/webgl`/`glfw`, no display), so the WebGL column is measured in the
  page instead: `tools/web-input-probe.js --app=ID --gpu` (without `--gpu` the
  probe's Chrome has no WebGL at all), the app's software route translated to
  timed keys/clicks, a reviewed screenshot, and the console checked for
  `[d3dim-gpu] D3DIM draws on WebGL` (D3D8/D3D9 use the D3D9 bridge, whose
  backend is `webgl` unless `?d3d9-renderer=software`, with no silent fallback).
  Rows dated **2026-10-06** were measured that way at `97aae839` (runs
  `scratch/runs/20261006T1840Z-gld3d-webgl/`); older dates quote the last
  browser or headless-GL verification from the app's re-notes and are not a
  measurement at this build. The DirectAnimation saver scr_corbis also draws
  its photo grid on WebGL there.
- **Tomb Raider III follow-up:** the later page route reaches Jungle and
  ordinary Up input moves Lara toward the cave. The earlier title-only result
  was route timing: Enter must reach the title ring before its attract demo,
  then wait for the passport animation. See `48ffb5e5` and
  `scratch/runs/20261006T2030Z-tr3-web-title-input/result.json`.
- Each run is capped at 120 s, so "menu" or "loading" for a slow game means the
  cap, not a defect, unless a blocker is named.

## Apps that really use OpenGL or Direct3D

| app | API at runtime | software | WebGL (date = when verified) | blocker / note |
|---|---|---|---|---|
| blood2_demo | D3DIM (Device3) | **gameplay** | **gameplay** (2026-10-06, browser; in-level, HUD 100/50; `scratch/runs/20261006T1840Z-gld3d-webgl`) | — |
| tomb_raider_2_demo | D3DIM (Device2) | **gameplay** | **gameplay** (2026-10-06, browser; Venice alley) | — |
| tomb_raider_3_demo | D3DIM (Device2) | **gameplay** | **gameplay** (2026-10-06, later browser route; Jungle and ordinary movement, `scratch/runs/20261006T2030Z-tr3-web-title-input`) | Earlier title result superseded by route timing correction `48ffb5e5`; no input repair needed. |
| gta2_demo | D3DIM (Device3) | **gameplay** | **gameplay** (2026-10-06, browser; city map, HUD) | — |
| mw3 | D3DIM (Device3) | **gameplay** (cockpit) | menu (2026-10-06, browser, no input; an Escape in the page's timing QUITS the demo, exit 3); gameplay (2026-09-20) | route: Escape at batches 10-41 skips the Zipper intro |
| diablo2_demo | D3DIM (Device3) | menu (hero select) | menu (2026-10-06, browser; Single Player / Exit) | gameplay needs > 120 s |
| darkstone_demo | D3DIM (Device2) | menu | menu (2026-10-06, browser) | gameplay route is the 240 s test |
| arcanum_demo | D3DIM (D3D7) | loading at 120 s | **menu** (2026-10-06, browser; past the software cap) | boot needs > 120 s |
| dx_boids / dx_flip3dtl / dx_tunnel / dx_twist | D3DIM | **renders** | **renders**, all four (2026-10-06, browser; `scratch/runs/20261006T1935Z-gld3d-webgl-recheck`) | — |
| mcm | D3DRM over Device2 | **gameplay** (race) | gameplay (2026-09-20); not re-run (long route) | w4 |
| dx_globe / dx_viewer | D3DRM | **renders** | **renders** (2026-10-06, browser) | globe texture seam (w4) |
| scr_architec, fallingl, geometry, jazz, oasaver, rockroll, scifi | D3DRM | **renders** (w4 rerun at `--tick-ms-per-batch=2`) | **7 savers render** (2026-10-06, browser; fallingl dark leaves and oasaver green field as on software) | fallingl black leaves, oasaver stray box: w4 |
| halflife_uplink | OpenGL | **gameplay** (corridor + HUD) | **gameplay** (2026-10-06, lazy-file browser route after `5f4bac8c`; `scratch/runs/20261006T2100Z-hl-uplink-lazy-mci/4-gameplay-webgl-lazy.png`) | MCI lazy park now waits for IO; subclassed dialog buttons receive queued mouse input. Earlier black result superseded. |
| simgolf_demo | OpenGL | **gameplay** | **gameplay** (2026-10-06, browser; course + build bar) | — |
| quake2_demo | OpenGL (ref_gl) | menu | menu (2026-10-06, browser, no route); gameplay (2026-09-23, browser) | level load ~300 s, past the cap |
| warcraft3_demo | OpenGL | **menu** after `579ee802` (was blank) | **menu** (2026-10-06, browser) | fixed today: a second SetPixelFormat of the same format was refused, so WC3 never made its real context |
| ptct | OpenGL | renders, correctness unverified | beams draw (2026-10-06, browser) | 0.35 presents/s on software |
| ut2003_demo | D3D8 | menu | menu (2026-10-06, browser, no route); gameplay (2026-09-25) | each frame ~1 s on software |
| ut2003_demo_server | D3D8 | **gameplay** (listen server renders DM-Antalus) | **gameplay** (2026-10-06, browser; DM-Antalus, HUD) | — |
| ut2004_demo | D3D8 | splash at 120 s | menu (2026-10-06, browser, no route); gameplay (2026-09-25) | slow |
| alien_shooter | D3D8 | loading at 120 s | **menu** (2026-10-06, browser; past the software cap) | CPU-bound load |
| crimsonland | D3D8 | **menu** after `1fdd9a64` (was blocked: "DirectX8.1 or newer not detected") | **menu** (2026-10-06, browser, D3D9 backend = webgl; launcher Play) | Play Game opens; the Survival click does not start a game yet (`scratch/runs/20261006T031629Z-crimsonland-dx81`) |
| pawn | D3D9 | **gameplay** (board) | board (2026-10-06, browser); gameplay (2026-09-23) | — |
| pirates_2004 | D3D9 | **menu** after `ba161dfb` + `12408feb` + `d7f5a429` (was blocked: "Unable to initialize DirectX.") | not measured: bigMemory and its 1.3 GB tree cannot be shipped to a boat browser; the local box cannot hold it | caps lacked blend stages; a failed CoCreateInstance re-ran its thunk; CLI ignored `bigMemory` (`scratch/runs/20261006T033534Z-pirates_2004-dxinit`) |
| black_white_2_demo, morrowind | D3D9 / D3D8 | not run (heavy) | morrowind world renders (2026-09) | excluded from CLI sweeps |
| winamp | D3D8 (MilkDrop) | not run | — | installed host is 2.91; exact plugin host requirement needs verification |

Glide is not in this goal's scope, but the sweep saw it: nfs3_glide_demo
gameplay; diablo2_glide_demo title at 120 s (software Glide 1-2 batches/s and
its frame fills only 512x384 of 640x480); hitman_glide_demo crashes on the CLI
software arm (NULL object call in `EngineData.dll` 0x0ff6da1f during level
load; its re-note has the browser arm getting further).

## In the census, but not 3D at runtime

The IID evidence over-reports, exactly as the census warns: a DirectDraw game
that links `dxguid.lib` carries every DirectX GUID. Confirmed 2D (or GDI) by
trace: jazz2_demo, moorhuhn, moorhuhn_2, gallinelle (probe IDirect3D2/7, never
create a device), pocket_tanks, heroes3_demo, captain_claw_demo, aoe1, aoe2,
nfs3_demo (its own `softtria.dll` renderer), ut348_demo (SoftDrv), generally,
generally_track_editor, baldurs_gate_chapters_1_2_demo, icewind_dale_demo,
scummvm_fotaq, tworld, dungeons_of_dredmor(_release) (SDL; no GL calls),
arena_gog/daggerfall_gog/ultima4_gog (DOSBox `output=surface`; `opengl` is a
config option, not pursued), scr_win98, spider, and the four DirectAnimation
theme savers (scr_corbis/fashion/horror/wotravel). aoe1 and pirates_2004 also
match through a setup.exe/dxdiagn.dll that only lists DirectX files.

## Open blockers in the GL/D3D set, ranked

1. ~~DirectX version detection~~ -- both fixed. Crimsonland: `1fdd9a64`, a
   versioned `D3D8.DLL` stub (DirectX 8.1). Pirates: the DxDiag query was
   only its error-message chooser; the real failure was `MaxTextureBlendStages`
   = 0 in our caps (`ba161dfb`), then a failed `CoCreateInstance` (Miles A3D)
   re-running its thunk (`12408feb`), then the CLI ignoring `bigMemory`
   (`d7f5a429`).
2. **crimsonland in-menu click**: Play Game opens, but neither Survival nor
   Quests starts a game. Not an input-delivery bug: dumping its DIMOUSESTATE2
   at `0x63cbf0` shows button 0 = `0x80` during the second press exactly as
   during the first. Game-side state (the player selector on that panel) is
   the next suspect. Note for routes: it polls the mouse once per frame
   (~110 batches here), so a press must be held across several frames.
3. **Throughput, not correctness**: ut2003/ut2004/quake2/arcanum/alien_shooter
   reach gameplay only past the 120 s cap on the software arm.
4. **Remaining WebGL coverage**: the October 6 spot checks and later TR3/Uplink
   follow-ups are retained above. Pirates is unmeasured, heavy titles remain
   excluded, and several rows only prove menus or rendering. Do not reopen
   completed spot checks or mark the overall gameplay goal complete.
5. **D3DIM PBO warning**: `D3DIM-ASYNC-PBO-WARN-20261006` remains ready. The
   MW3 warning needs a live readPixels/fence/readback trace before any buffer
   reuse repair; it is not proof of visible corruption. Performance comparisons
   belong on a separate boat.

Outside the 3D set but found here: the DirectDrawFactory IID typo (fixed
`fa4be36a`; the theme savers then run the existing DirectAnimation shim, frames
unverified until their JPGs can be decoded: skia-canvas's native binary is
missing on this box at the software sweep; the later browser photo-grid
check is recorded above); aoe2's Unicode IDirectPlay4
QueryInterface (handed to the AoE lane on the board); `PathAppendA` for
dungeons_of_dredmor (fixed by w5 `5ca54afc`).


### D3DIM asynchronous PBO warning: source audit, 7 October 2026

No proven unsafe PBO reuse yet. Do not implement the old TODO's proposed ring or fence wait from the warning alone. No engine edits, tests, browser, build or performance measurements were performed. Drakan's acceptance fixture remains unchanged.

## Exact evidence

`source-receipt.json` hashes the source copies and original MW3 console. The console contains 145 instances of the shadow-copy-discard warning. The relevant `lib/d3dim-gpu.js` at origin/main e710d101 is byte-identical to feature commit fcfa4989. The shared checkout is older: this audit deliberately uses Git object contents, not its working-tree file.

In that source, `_flip` lines 457–498 collects an existing `t.inflight` at line 468 before writing the same PBO. `_completeInflight` lines 501–520 binds `t.pbo`, calls `getBufferSubData`, unbinds and deletes the fence. The normal path therefore orders readback before reuse. No explicit `clientWaitSync` exists; synchronous collection can still block.

The dead-target branch at lines 362–365 discards an unread pending result, deletes its sync, destroys the device and removes the target. It does not itself reuse that PBO. Resizing at lines 207–212 fences before destroying/replacing the target. These branches need live identity evidence before attributing the warning to discarded reads. `_completeInflight` clears its JS pending record before GL collection; an exception would leave no retry record. A WebGL validation failure can also return normally without copying. Neither is established in the saved run.

## What Chromium actually warns about

Primary source is pinned to Chromium revision d03948c49f64c93042f36929fc9a89d1e688c6e6, **not claimed to match the installed browser revision**:

- [GLES implementation](https://chromium.googlesource.com/chromium/src/+/d03948c49f64c93042f36929fc9a89d1e688c6e6/gpu/command_buffer/client/gles2_implementation.cc), `AllocateShadowCopiesForReadback`, lines 5908–5928: warning means `Buffer::Alloc` found an already allocated internal shadow for a written/unfenced buffer. It does not inspect our JavaScript `inflight` flag.
- [Shadow tracker](https://chromium.googlesource.com/chromium/src/+/d03948c49f64c93042f36929fc9a89d1e688c6e6/gpu/command_buffer/client/readback_buffer_shadow_tracker.cc), lines 26–76: allocation persists until `Free`; successful unmap frees it. Readback validity additionally compares write/readback serials.
- [WebGL2 implementation](https://chromium.googlesource.com/chromium/src/+/d03948c49f64c93042f36929fc9a89d1e688c6e6/third_party/blink/renderer/modules/webgl/webgl2_rendering_context_base.cc), lines 354–387: `getBufferSubData` validates, maps, copies and unmaps. Validation or mapping failure returns without that completed sequence. GLES unmap frees the shadow even when mapping used the synchronous fallback (lines 5442–5453). Consequently, merely omitting `clientWaitSync` does not prove why the *next write* warning occurs. A different warning explicitly diagnoses readback without waiting.

## Existing coverage and minimal next proof

`test/test-d3dim-gpu-async-flip.js` covers one queued flip, unrelated-range deferral, original-DIB collection, global collection, and synchronous fallback. It has no repeated-flip, discard/recreation or multiple-PBO identity case. Its mock `getBufferSubData` reads a variable last assigned by `bufferData`, rather than the currently bound buffer: extend that mock before trusting identity coverage.

First proposed source-only tests, once authorized: actual executor with a binding-aware GL mock; two differently colored consecutive frames; assert collect-old before write-new and correct old/new DIB bytes. Two targets/contexts must never collect each other's buffer. Dead target discards once and recreation gets a fresh resource identity; size growth collects before deletion. Negative control removing the collect-before-reuse call must fail on overwritten old-frame bytes, not a missing helper. These prove application ordering, not Chrome shadow behavior.

Then, only under a separate serialized browser grant: one short MW3 ordinary menu diagnostic, capped 10 seconds/256 detailed events with total counters and explicit dropped-event flag. Identify the actual executor and context, then assign stable WeakMap IDs to contexts, PBOs, syncs and targets. Wrap existing `bindBuffer`, `bufferData`, `readPixels`, `fenceSync`, `getBufferSubData`, `deleteSync`, `deleteBuffer` and executor target/collect lifecycle seams. Record args, bound pack-buffer identity, byte ranges, target/backing identity, entry/return/throw and warning timestamps. Forward exactly once with original receiver/arguments/results/errors. No extra readback, wait, flush, binding, getError or pixel mutation. Restore only own wrappers, report foreign replacement. Preserve observer overhead and unknown on cap/context mismatch.

Discriminating outcomes: a same-resource second write with no completed collection supports a missed/discarded-read lifecycle; a complete ordered collect between writes refutes that simple explanation and requires checking actual Chromium revision, validation and context before a change. A returned JS call alone cannot certify successful GL copying. Do not infer GPU corruption or a performance gain from warning counts. Any performance A/B belongs on separate boats with matched useful work.

### Winamp fixture identity, October 7

Static PE resource inspection identifies `test/binaries/winamp.exe` as 2.9.1.0. The registry mounts `plugins/candidates/vis_milk.dll` (430,592 bytes), not the separate `vis_milk2.dll` (425,472 bytes, Winamp 5.6.6 strings). No Winamp 5 executable was found in the `test/binaries` filename inventory. The registered plugin itself mentions a feature requiring Winamp 2.90 or later; that does not prove its full host requirement. The older “needs Winamp 5” table entry is therefore an unverified prerequisite, not an established missing-file blocker. Next inspect the exact registered plugin initialization/version gate before acquiring a different host. No runtime result is implied. Exact hashes and resources: `scratch/sweep-reconciliation-20261007/winamp-fixture-identity.json`.

### October 7 PBO executor regression follow-up

The binding-aware `test/test-d3dim-gpu-async-flip.js` now passes on unchanged
executor SHA-256 `e3370b31c0a63aff9420dc89f044f121c87bb2140a7683f4917f199a17680b8f`.
It proves same-PBO two-frame collection ordering and distinct DIB contents,
correct currently bound buffer despite another allocation, reversed collection
of independent contexts, rejection of a foreign-context PBO, and dead-target
discard/removal without a subsequent flip reusing that target. The GPU and
surface metadata are fixture objects; this is the actual JavaScript executor,
not actual Chrome/GPU execution. Resize/recreation is not newly covered.

Under the explicit pure-JS lease, candidate PID 2407020 exited 0 and private
in-memory `--negative-control` PID 2407027 exited 1 at the intended first-frame
byte assertion: actual `[17,17,17,17]`, expected `[48,32,16,255]`. The control
removes only collection before reuse, so setup or missing exports cannot
explain that expected failure. Both processes completed within 46.221 ms total
at 08:58:53.624Z; this duration is a cleanup receipt, not a benchmark.

Receipt/logs: `scratch/d3dim-pbo-audit-20261007/test-validation.json`,
`candidate.log`, `negative-control.log`. Test SHA-256:
`f9cfd55d29972759b7595aedea386bb4cb106d390d5fa4aeb05919b6a6dba13e`.
No engine change or claim that Chrome's warning is fixed. The bounded live
context/PBO lifecycle observer above remains the next causal diagnostic.

### Registered MilkDrop initialization gate, October 7

The exact registered `vis_milk.dll` export at `0x100299c0` returns its header directly. Its initializer at `0x10029a90` contains no blanket Winamp 5 rejection at the historical music check: it queries the host using `SendMessageA(WM_USER, 0, 0)`, accepts a result at least `0x4000`, and otherwise accepts `SendMessageA(WM_USER, 0, 0x68) == 1`. Only the latter failing path shows “This plugin can't run without music” and returns failure. This identifies an older-host playback condition, not proof of successful rendering. Raw exact-PE disassembly is retained at `scratch/sweep-reconciliation-20261007/milkdrop-init-disassembly.txt`.

Current `test/test-winamp-visualizers.js` documents and exercises MilkDrop header enumeration on the existing host; its historical remaining-gap comment names cross-thread IsPlaying delivery, not a Winamp 5 dependency. Main `2dab96f8` later changed Worker-to-main SendMessage delivery and is in the pinned `3b8189f5` runtime ancestry, but its WinBoard regression does not prove the MilkDrop route. Next run the actual registered plugin with ordinary playback/Start and observe the returned playback query and D3D device creation under each relevant thread mode. Keep software/WebGL rendering unqualified until that evidence exists. No host download or new runtime was performed for this source audit.
