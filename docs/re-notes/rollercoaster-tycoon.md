# RollerCoaster Tycoon (shareware/demo)

`test/binaries/shareware/rct/English/RCT.exe` — Chris Sawyer / Hasbro Interactive,
1999. App id `rct`. Image base `0x00400000`, entry `0x00412d80`; the whole game is
one EXE with no shipped DLLs, so every address below is both an original and a
runtime VA and needs no `module+0x` arithmetic.

The registry entry (`lib/apps.js`, `rctFiles`) mounts the tree from
`test/binaries/shareware/rct/`: `Data/` (CSG1/CSG1I plus CSS1–CSS17, `GAME.CFG`,
`TUTORIAL.DAT`, `KANJI.DAT`, `MP.DAT`), `Scenarios/` (`SC.IDX` and ten `*.SC4`),
`Tracks/`, `Saved Games/`. **The VFS has never been the problem** — an earlier
note calling RCT "VFS-blocked" was wrong, and `--trace-fs` shows every file it
asks for resolving on the first try.

## Status (2026-09-01): reaches the title screen

```
timeout -s KILL 250 node test/run.js --app=rct --quiet-api \
  --batch-size=200000 --max-batches=20000 --max-seconds=90 \
  --no-close --png=/tmp/rct.png
```

A healthy capture is the animated demo park: the RollerCoaster Tycoon logo top
right, wooden and steel coasters over a pine forest, and the four-button menu
bar along the bottom. `--dx-surfaces` reports the primary (640x480x8) with
~108 distinct colours; a broken run reports `colors=1 nonZero=0`.

**`--batch-size=200000` is not optional.** At the default budget the game is
still decoding `Scenarios/*.SC4` after 20000 batches and has drawn nothing, which
reads exactly like a hang. It scans the scenario directory at startup, opening
and decoding each `.SC4` in 1KB `ReadFile` chunks before it will show a menu.

## The two bugs that were in the way

### 1. `DPLAYX` ordinals were answered with DirectSound ids (fixed)

RCT imports `DPLAYX.dll` **by ordinal only** (`tools/pe-imports.js` shows
`[0] ordinal 1`, `[1] ordinal 2`), and the stub at `0x0041b08e` is
`jmp [0x55e034]` — inside DPLAYX's IAT at RVA `0x15e030`, *not* DSOUND's at
`0x15e03c`. `$system_ordinal_api_id` in `src/08b-dll-loader.wat` gated its DSOUND
rule on `$guest_name_is_static_system_dll == 4`, but that helper returns a
**1-based** position into `ole32/user32/comctl32/dplayx/ddraw/dsound/d3drm`, where
dplayx is 4 and dsound is 6. So every dplayx ordinal was resolved as a
DirectSound API and the DSOUND rule never fired at all.

RCT's ordinal 2 is `DirectPlayEnumerateA`, whose callback is
`(LPGUID, LPSTR, DWORD major, DWORD minor, LPVOID ctx)` and ends `ret 0x14` at
`0x004107b2`. Our `DirectSoundEnumerateA` handler pushes four arguments, so the
callback popped one dword too many and the guest returned to **EIP 0** after
11 batches, with `dbg_prev_eip=0x004107b2`. The callback itself is at
`0x00410710` (allocates a 0x10c-byte provider record, stores the GUID at +0 and
`strcpy`s the name to +4, links it at `[0x56306c]`/`[0x563070]`).

`test/test-directsound-ordinals.js` was already failing at HEAD on the DSOUND
half of this and now covers both DLLs.

### 2. `RICHEDIT_FORMAT_TABLE` was allocated on top of `MM_TIMER_TABLE` (fixed)

RCT drives its entire game loop from one multimedia timer:
`timeSetEvent(50, 10, 0x0040c7a6, 0, TIME_PERIODIC)` at `0x0040d269`, called from
`0x0045231d`. `MM_TIMER_TABLE` and `MM_TIMER_NEXT_ID` were raw
`(i32.const 0x00010800)` / `0x000108C0` in `src/01-header.wat`, in no region at
all — and the WATX allocator, which only knows about declared regions, had put
the 1KB `RICHEDIT_FORMAT_TABLE` region at exactly `0x00010800`.

The first `CreateDialog` with controls therefore wrote hwnd-slot zeroes over
timer slot 0's **interval** (`+4`) and **callback** (`+8`) while leaving its id
(`+0`) and last-tick (`+16`) intact. A zero interval reads as "always due" and a
zero callback makes `DispatchMessageA` decline the message, so the pump filled
with `MM_TIMER` (`0x7FF0`, hwnd 0, wParam 1, lParam 0) forever and the game never
ran another frame — 153 million API calls in 180s, all `PeekMessage` /
`TranslateMessage` / `DispatchMessage`.

Reproduction of the corruption itself, which is app-independent (the guest
address is the g2w alias of the linear address, `0x10808 + 0x400000 - 0x12000`):

```
node test/run.js --app=rct --quiet-api --batch-size=200000 \
  --max-batches=800 --max-seconds=60 --no-close --watch=0x3FE808 --watch-log
```

Before the fix that prints the callback being stored at batch 624 (`EIP 0x40d269`)
and zeroed at batch 715, right at the `[CreateDialog]` line. The live table can be
read from a `--control` session with `instance.exports.dbg_mm_timer(slot, field)`
(fields: 0 id, 1 interval, 2 callback, 3 dwUser, 4 last_tick, 5 oneshot).

Both are now `region.declare`d in `src/00-regions.wat`, so the region gate makes a
future overlap a build failure rather than a silent one.

## Dead ends

- **"RCT is VFS-blocked."** Withdrawn. `--trace-fs` shows every `Data/`,
  `Scenarios/` and font file opening successfully, including on the build that
  crashed at EIP 0. The crash was ordinal resolution and happened long before the
  game looked at a data file.
- **"The pump jam is a `PeekMessageA` bug."** Withdrawn. The MM_TIMER delivery
  path in `$timer_check_due` (`src/09a-handlers.wat`) is correct; it was faithfully
  reporting a timer slot that had already been overwritten.
- **`--async-mm-timer` is not the fix.** It masks the corruption because
  `fire_mm_timer` runs the callback out of band from batch 624, before the dialog
  that would clobber the slot is created. Message-loop delivery is the default and
  is what the browser host uses for RCT; the comment in `test/run.js` about
  duplicate dispatch for RCT still holds.

## Startup API profile

Ordinary CRT init, then `LoadCursorA`/`SetErrorMode`/`timeBeginPeriod(1)`,
`GetVersionExA`, `GetSystemInfo`, `GlobalMemoryStatus`, `GetUserNameA`,
`GetComputerNameA`, `RegisterClassA("RollerCoaster Tycoon")` (wndproc
`0x00403c7d`), then `DirectPlayEnumerateA`. Graphics come up through
`GetProcAddress(DirectDrawCreate)` → `IDirectDraw_EnumDisplayModes` (three times)
→ `CreateWindowExA` 640x480 → `SetCooperativeLevel` → `SetDisplayMode(640,480,8)`
→ primary + back surfaces + clipper + palette. Input is DirectInput 5
(`DirectInputCreateA(.., 0x0500, ..)`, keyboard + mouse devices). Audio is
DirectSound with three secondary buffers locked at startup.

Two compat patches already exist for this binary and fire at load
(`[compat] patched RCT ... video-mode change invalidates cached geometry at
0x0045268d` and `0x0042d2d3`).

## Named addresses (original VAs)

| VA | What |
|---|---|
| `0x00412d80` | PE entry |
| `0x00403903` | stores five globals from its args; block ending here calls `0x004036d3` and is where the dialog path begins |
| `0x00403b2e` | main message pump (`PeekMessageA` PM_REMOVE, `cmp [ebp-0x1c], 0x12` for WM_QUIT) |
| `0x00403c7d` | main window procedure |
| `0x004036d3` | function entered right before the first `CreateDialog` |
| `0x00410710` | DirectPlay provider-enumeration callback (`ret 0x14`) |
| `0x004107c0` | its caller; `0x004107e0` is the `DirectPlayEnumerateA` call, returning to `0x004107e5` |
| `0x0040c7a6` | multimedia-timer `TimeProc` — the **sound-channel service pump**, not the game loop (an earlier version of this row said game loop; wrong). It walks a 4-slot channel table at `0x5672e0` (stride 0x16C, computed by the lea chain as 364) and calls `0x40bb20` per active slot; with no sound playing all four slots are empty and it does nothing, healthily. `--count=0x0040c7a6` still checks the timer is alive |
| `0x0040d269` | return site of the `timeSetEvent` call that arms it |
| `0x0045231d` | caller of that arming function |
| `0x0042f5a5`–`0x0042f5ff` | the `.SC4` decode inner loop the startup scan spends its time in |

## The real game loop (mapped in-scenario, 2026-09-01, browser frozen tile)

Sawyer's outer loop lives around `0x4010e9`/`0x40110a`: `pump(0x403b2e)` →
`0x402bb3` (FPS bookkeeping only — accumulates ms at `0x565dc8`, publishes
frames/sec to `0x560124` once a second; it is NOT the tick) → `0x438248`, the
whole per-frame function, then back to the pump.

Inside `0x438248`, steady state (`byte [0x59fc98]=1` once init ran):
elapsed = `0x404640()` − `[0x8e0fd0]`, clamped to 500ms, stored as a word at
`0x8e0fd8`. Sim tick count = clamp(elapsed/31, 1, 4), and the sim loop at
`0x4384fc` (game update `0x436234` + the UI update battery) is **gated by
`byte [0x8e31a9] == 0` — that byte is the pause flag** the toolbar pause
button (top-left, ~(10,10) at 640x480) toggles. When paused the loop is
skipped wholesale, which is also why "Construction not allowed while game is
paused!" pairs with a completely still frame. The frame ends in a **25ms
frame-limiter spin**: `0x43867d` re-reads the clock until 25ms have passed
since frame start — spin-park's clock-spin detector (yield 14) is what keeps
that cheap for the host.

Diagnosing "RCT looks stuck" from a browser session, fastest order:
1. `exports.set_count(i, 0x436234)` + step — the game update counting is the
   one-line health check (like `--count` headless).
2. `byte [0x8e31a9]` nonzero = paused; the pause button at (10,10) toggles it.
3. A running, unpaused, **closed** park with no rides in view is legitimately
   pixel-static for minutes: no guests, no ride motion, date changes monthly.
   Do not read a byte-identical screenshot as a stall without checking 1–2.
`0x59fc99` is a "screen re-init done" latch (cleared by the mode-change /
screenshot-request handler at `0x42e8d8`, raised by the redraw path), not a
per-frame render gate; `0x56fdb2` is a screen-effect state machine (1 =
normal). The DirectSound guard dword at `0x562f2c` protects the TimeProc
above, unrelated to all of this.

## Permanent gameplay gate (2026-09-05)

The native demo now has a deterministic one-process acceptance route beyond
the title screen. After 3,000 frozen 200,000-block batches, a click at
`(198,430)` opens **Select Scenario For New Game**. Clicking `(310,166)` picks
the enabled **Forest Frontiers** scenario. After its load, `(428,157)` closes
the objective window and exposes the live park.

Two park frames separated by 120 explicit batches differed at 61,107 pixels in
the verified run. Clicking toolbar coordinate `(382,15)` then opened the real
**Path Construction** panel; more than 10,000 pixels changed in its left-hand
region. This proves both live scenario simulation/rendering and interactive
construction UI, rather than only the animated title-screen attract mode.

```bash
bash tools/build.sh
RCT_SCREENSHOT=/private/tmp/rct-construction.png node test/test-rct-gameplay.js
```

The test launches one `--control-stdin --frozen` CLI process, advances only by
explicit step commands, and uses the CLI's internal `--max-seconds` guard. It
does not wrap the emulator in an external signal timeout.

## The gate now fails: the park view is ~85% black (2026-09-11)

`test-rct-gameplay.js` fails reproducibly at `0 changed pixels` (the 2026-09-05
run above recorded 61,107). It fails **identically on main and on committed
2109f24a**, at 55.0s and 56.3s against a 180s guard, so it is neither a
candidate regression nor the guard expiring.

What the failing frame actually shows: toolbar, status bar (`£10,000.00`,
`0 Guests`, `March, Year 1`, `17°C`) and the Path Construction panel all render
**correctly**, while the park viewport is black except for one wedge of
well-formed terrain and trees at bottom centre.

Ruled out, each with the measurement:

- **Not paused.** `byte [0x8e31a9] == 00` (the pause flag from the section
  above), dumped in-run at batch 4300.
- **Not stalled.** `--count=0x00436234` (game update) = 5,097 over the gate's
  own step budget, and 34,824 over a longer run. `0x00438248` = 4,080.
- **Not progressive paint.** Captures at batches 4240/5000/6500/8800 differ from
  the first by 378/1015/768 pixels — the black never fills in.
- **Not a truncated scenario load.** `--trace-fs` shows `sc0.sc4` read straight
  through in 0x400 chunks to a short final read of 0x1e5 at 0x45000 (EOF,
  283,109 bytes), 7,274 trace lines, no gap.
- **Not the renderer.** The title screen is pixel-perfect and complete —
  `--dx-surfaces` reports slot 29 640x480 `colors=128 nonZero=1850/1850`, and
  the PNG is 628KB against the in-game frames' 130KB.
- **Not the gate racing its own steps.** `run.js`'s `step` resolves its reply
  only when `controlStepWaiter.remaining` hits 0 (`test/run.js:5403-5416`), so
  clicks and snapshots are correctly ordered.

Leading hypothesis, unproven: the **camera/viewport position** for the loaded
scenario, i.e. we are looking past the map's corner, which is what RCT draws as
black. The visible terrain is detailed and correctly graded, which is not what a
half-decoded map looks like.

Next probe for whoever picks this up — arrow keys are NOT it (RCT reads
DirectInput 5, so `--input=keydown` never reaches it; a 12-press scroll moved
288 pixels, i.e. nothing). Use the in-game map window from the toolbar, or find
the viewport globals inside the per-frame function at `0x438248`. `tools/ctl.js`
against `run.js --control --frozen` is the right instrument (look, click, look),
but note the control server shares the guest thread, so `snapshot` cannot be
answered while credits are draining — sequence commands, do not poll.

## CORRECTION: the black park view is the initial CAMERA, and the gate never checked the picture (2026-09-12)

The section above is wrong in its framing and its suspects. Measured this
session, with pictures:

**The renderer, the `.SC4` decode and the viewport paint are all healthy.**
Reaching the live park and then clicking the toolbar **Map** button at
`(246,15)` draws the whole Forest Frontiers map as a correct diamond — the
clearing, the path, the lake. Clicking inside that map window at `(120,160)`
recentres the main view, and the park then renders **full-screen and perfect**:
grass, trees, fences, no black anywhere, with the yellow viewport rectangle
appearing in the map window. Two clicks of **zoom out** at `(118,15)` likewise
widen the view to a large forested hill whose top edge is a natural terrain
silhouette, not a clip line.

So the black is not unpainted pixels and not a half-decoded map. It is the
**initial viewport origin sitting at/near the map's north corner (tile ~0,0)**,
i.e. the camera is looking off the edge of the world, which RCT draws black.
Whether real RCT centres Forest Frontiers on the park at scenario start is
**not verified here** — that is the next thing to establish before calling the
initial position a bug rather than the scenario's own saved view.

Newly useful toolbar coordinates: `(118,15)` zoom out, `(246,15)` map window,
`(382,15)` path construction, `(10,10)` pause.

**The gate was green on this same broken picture.** `test-rct-gameplay.js`
asserts only `pixelDiff(a,b) > 10000` between two park frames — "some pixels
changed", never "the park is visible". The 2026-09-05 run that recorded 61,107
pixels and claimed it "proves live scenario simulation/rendering" was looking
at the same mostly-black frame. Captured at the gate's own known-good commit
`35a05fff`, the screenshot is pixel-identical to the failing one.

**Therefore the bisect result below is about test sensitivity, not rendering.**
A clean-build bisect (`good 35a05fff`, `bad f37f79d8`, `rm -rf build` each step
— a stale `build/` poisons verdicts) lands on `7065931d` "Fix Alpha Centauri
gameplay and cooperative workers", and within it on exactly one hunk: the
removal of the `yield_flag`/`steps` reset on an **empty PeekMessage** in
`09a5-handlers-window.wat`. Restoring those two lines makes the gate pass again
(81,932 px at main) **and changes the picture not at all** — the park is still
black. It is a masking change, not a fix, and it would revert a deliberate SMAC
correction that has no CLI gate protecting it. It was NOT applied.

Ruled out this session, each by building and running the gate:
- the new `colorkey8` fold (handler 443) — disabling it changes nothing, at
  `7065931d` or at main;
- `GDI_DC_STATE_COUNT`/`GDI_OBJECT_COUNT` 256→512 — reverting both (with their
  `00-regions.wat` sizes, which a build gate ties to stride x count) changes
  nothing;
- the new WM_PAINT and WM_TIMER peek-filter gates — RCT peeks unfiltered
  (`hwnd=0, min=0, max=0, remove=1`), which satisfies both conditions, so they
  are inert here.

Also note the yield's absence makes RCT retire *more* work, not less: over a
fixed 1500-batch budget, `0x00438248` = 980 frames and `0x00436234` = 784 game
updates without it, against 777 and 0 with it. Any "the clock is starved"
explanation is contradicted by that measurement.

Two separate defects remain open:
1. the initial camera position (above), and
2. the gate itself, which should assert the park viewport is actually
   populated — e.g. a nonzero-pixel share over the viewport rect — instead of
   only that two frames differ.
