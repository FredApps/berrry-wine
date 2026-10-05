# Deus Ex demo — local candidate

The official 1.002f demo installer is pinned in
`test/candidate-corpus/manifest.json` from Archive item `DeusExDemo`. Its
bundled license permits private/domestic use but does not grant redistribution,
so the installer and installed fixture stay ignored and must not be deployed or
rehosted.

Fetch and test:

```sh
node tools/fetch-candidate-corpus.js --id=deus-ex-demo
node test/test-deus-ex-demo.js
```

The fetcher retains `DeusExDemo.exe` as the original distribution. Wine
Assembly runs that self-extractor, captures the `Setup.exe` it launches, and
resumes setup from the captured guest VFS. The wizard installs to
`C:\DeusExDemo`. The frozen driver exports the VFS after the complete game
payload is written and before setup chains into its obsolete bundled DirectX
updater; Wine Assembly already provides that runtime. No host archive or
cabinet extractor prepares the playable tree.

The test uses the prepared installed tree, verifies the software-renderer INI,
and launches the same app manifest as the browser. It requires native UE1 DLLs,
live audio, and a rendered animated intro without spending the normal suite's
time budget on a full map load. A separate frozen controlled acceptance loaded
the Training map, rendered its 3D HUD and transmission sequence, and moved JC
through the world with ordinary Win32 keyboard input.

The browser's experimental Worker backend is functional but substantially
slower during UE1 startup. An exact isolated Chrome run stayed live (changing
main-thread EIPs, no trapped Worker), created its third Worker and 648x508 game
window after roughly 45 seconds, and progressed from the gray allocation frame
through the animated Deus Ex title. It was still in that title sequence around
90–110 seconds. Keyboard events were routed with `hwnd=0` in this mode even
after a scripted viewport click, so the interactive acceptance remains the
cooperative backend; leave Threads off for the responsive demo path.

## Headless route to Training, uop tier on (2026-09-29)

With the uop tier on (the default) and 553db124 (never enter a freed uop
program), the demo runs from boot through the main menu into the Training map
and walks. Nothing else needed fixing. Driven frozen, one step at a time:

```sh
node test/run.js --app=deus_ex_demo --quiet-api --quiet-blocks --no-close \
  --control --frozen --max-seconds=3000 --max-batches=100000 \
  --batch-size=200000 --tick-ms-per-batch=25
# then with tools/ctl.js (screen coordinates; the window's client centre is 345,284):
step 3000                     # rotating 3D logo (the menu's background level)
key VK_ESCAPE; step 200       # "Welcome to DEUS EX" main menu
cmd mousemove:502:396; step 30     # cursor onto Training (see mouse notes)
cmd mousedown:345:284; step 40; cmd mouseup:345:284; step 100   # LOADING
step 400                      # UNATCO Training Facilities, HUD, Jaime Reyes transmission
cmd keydown:38; step 150; cmd keyup:38   # JC walks to the first door
```

About 7 minutes of wall clock to the logo on an idle bench box (cooperative
threads). Every capture above was checked by eye.

**The mouse is relative, not absolute.** Once the viewport captures the mouse,
WinDrv's WM_MOUSEMOVE handler (`windrv+0x1110ad8f`) takes `lParam` minus the
client centre as a delta, feeds `MouseDelta`/`IK_MouseX/Y` and recentres the
cursor with `SetCursorPos` (`windrv+0x1110af82`). So an absolute `mousemove:X:Y`
moves the game's own cursor by about **2 x (X,Y - 345,284)**, and a move up or
left of centre from the start position (top-left corner) is clamped and looks
like nothing happened. `click` alone does not press a menu button: the button
only takes focus from a *move* event over it, and the press must span game
frames — mousemove onto the button, then `mousedown`, `step 40`, `mouseup`.
WinDrv's button handlers (`0x1110b4a4` down, `0x1110b302` up) were confirmed
to fire with `--count`; the earlier "click does nothing" was only the missing
hover move, not an input bug.

Compatibility work required for this route:

- root-clamped VFS `..` normalization for UE1 sibling asset wildcards;
- extensionless absolute DLL lookup (`C:\Core` matching `Core.dll`);
- `GetProcessWorkingSetSize` and `IsProcessorFeaturePresent` startup behavior.

## Call-form census (2026-09-29)

**Route.** Box1 ran `--app=deus_ex_demo --batch-size=200000
--tick-ms-per-batch=25 --repaint-every=10`.

- It renders the in-engine 3D Eidos logo at batches ~450-800 and the ION
  Storm logo at 1050.
- **At batch 1174 it crashes on a guest call through NULL**
  (`dbg_prev_eip=0x1212c2b7`). It never reaches the cinematic.

**Census over 450..800** (docs/uop-tier-design.md §15.1):

- **Guest indirect:** 2.5-3.0% of block entries, vtable/reg calls 0.7%.
- **`call [IAT]` into core.dll:** 1.4-1.9%. The largest part is five
  monomorphic FVector-operator calls in the `render.dll+0x10b0baff` loop.
  Each lands on a core.dll incremental-link `jmp rel32` thunk.
- **Where the entries go:** 60% of the entries the tier did not take are
  SoftDrv MMX blocks refused as `head-unsupported`. `softdrv+0x10d3ed70`, a
  `movq [edi],mm0` fill loop, alone is 24.6% of all entries.

## MMX qword-fill fold (2026-09-29)

The fill loop is the SoftDrv frame clear:
`movq [edi],mm0; add edi,8; dec ecx; jnz`. It is at `softdrv+0x10d3ed70`, and
a 16-bit-path copy sits at `+0x10d3eec0`. Its first entry falls through from
`shr ecx,1; nop` at `+0x10d3ed6d`. It is now one H419 `0x80000005` super-op
(docs/loop-idiom-superops-design.md §23; gate `--no-mmx-fill-superops`).

**Box1 run.** Route: `--app=deus_ex_demo --batch-size=200000
--tick-ms-per-batch=25 --repaint-every=10 --branch-clock
--wall-clock-ms=1790673326000 --max-batches=800`.

- **Block entries, window 450..800:** down 17-24%, and the fill block leaves
  the hot list. There were 214,909 fold runs filling 68.7M qwords.
- **MMX instructions retired:** identical in both arms.
- **Frames:** md5-identical at 450/560/680/790/end. Batches 450 and 790 are
  black at this pacing.
- **User CPU for 800 batches:** off 55.30/55.65 s, on 53.15/53.02 s, so
  **−4.3%** against a 0.6% null band.

**Next hottest.** All SoftDrv compute, declined `head-unsupported` by the uop
tier:

- `+0x10d2aea5`, bilinear lightmap fetch: 7.5-11.0% of threaded entries.
- `+0x10d2b0be` / `+0x10d2b584`, span setup, which loads ESP as a GPR from
  `[0x10d7d39c]`.
- `+0x10d2b180` / `+0x10d2b640`, 8-texel palette-lookup span bodies.
- `+0x10d05dbb`, a `jb` self-loop texel.

**Covered (2026-09-29, docs/uop-tier-design.md §16).** The uop tier now lowers
MMX, and it retries a scan-limit head with a halved span. Every head above is
`live`. `+0x10d2b180`/`+0x10d2b640` run 86 blocks per entry, at 276
instructions each. `+0x10d05dbb` is reached inside another program. Threaded
block entries over batches 450..800 went from 177.5M to 100.4M. User CPU for
800 batches went from 55.83/55.94 s to **27.69/27.75 s (−50.4%)**, and all five
frames are md5-identical. What remains hot is x87 triangle setup:
`+0x10d2759d`/`+0x10d27656` are `fld` heads, 4% each.
## 2026-09-29: the uop tier ran a freed program (call through NULL in the 3D intro)

**Symptom.** With the uop tier on (the default since 2026-09-28), the 3D logo
intro died around batch 1163–1174 on a guest call through NULL: EIP 0x10000,
then an AV. A pinned calendar makes it deterministic. It crashes at batch 1163
on every run:

```sh
node test/run.js --app=deus_ex_demo --batch-size=200000 --tick-ms-per-batch=25 \
  --repaint-every=10 --wall-clock-ms=1790673326000 --uop-census --quiet-api \
  --no-close --max-batches=1200 --max-seconds=1400
```

This is a heavy route (about 5 min for 3000 batches), so run it on a bench box,
not the Mac.

**Cause.** This is not a slot-indexing bug and not a Deus Ex bug. The tier
entered a program the arena had already freed:

- `$uop_flush` bumps `$uop_gen` and rewinds the bump allocator. It does not
  retire threaded `uop_enter` ops.
- `$th_uop_enter` and the map ways checked that a program was still alive by
  reading only two words at the program's old address: the gen word (+0) must
  equal `$uop_gen`, and the head word (+4) must equal the EIP.
- After a rewind, those two words hold whatever the next program writes there.
  This can be code, a const-pool word, or the never-written alignment padding
  before the window slots.

The census (instrumented run, box 4) shows the exact coincidence:

- Program H (head `0x1152a39d`) was installed at arena `0x69da530` in gen 2
  and retired as poor in gen 2.
- In gen 3, program X (head `0x1169606e`) was placed at `0x69d9820`:
  - X's code and const pool ran 0xd14 bytes and ended with the word `4`
    exactly at H's old gen word.
  - The padding after it still held H's stale head and window-count words.
  - X's slot 0 overlaid H+16.
- The flush from gen 3 to gen 4 made that `4` equal the current generation.
  H's surviving threaded enter op then passed both checks. It ran X's window
  slots as a program and exited to EIP 0x10000.

**Fix** (`src/07d-uop-engine.wat`). Each arena now keeps a program-starts
bitmap, one bit per 16-byte granule of code bytes:

- `$uop_install` sets the program's bit.
- `$uop_flush` clears the whole bitmap.
- `$uop_live` (used by `$th_uop_enter`, `$uop_way_live`, `$uop_map_get` and the
  census dump) requires the gen word **and** the bit.

A freed header's bit stays clear until something is installed at that exact
address, so no leftover arena bytes can make it look live again. Space for the
bitmap came from shrinking the per-arena code tail to 0x22000.

Regression test: the `stale-enter` case in `test/test-uop-compiler.js`. It
forges a freed header with a current gen word and a matching head, then
enters it:

- Without the bitmap check, the stale enter op runs the forged program 8 times.
- With it, the enter is refused and the threaded loop runs.

**After the fix.** The same pinned run reaches batch 3000 without the crash.
The capture shows the rotating 3D Deus Ex logo intro rendering in software.
