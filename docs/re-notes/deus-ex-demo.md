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

Compatibility work required for this route:

- root-clamped VFS `..` normalization for UE1 sibling asset wildcards;
- extensionless absolute DLL lookup (`C:\Core` matching `Core.dll`);
- `GetProcessWorkingSetSize` and `IsProcessorFeaturePresent` startup behavior.

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
