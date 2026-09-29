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
