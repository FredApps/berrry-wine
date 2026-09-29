# Need for Speed Windows demos

## Fixtures and launch

`nfs2_demo` and `nfs3_demo` are local candidate apps. Fetch with:

```sh
node tools/fetch-candidate-corpus.js --id=need-for-speed-2-demo,need-for-speed-3-demo
```

Sources and archive SHA-1 values are recorded in `test/binaries/SOURCES.md`
and the candidate manifest. Both entries mount the complete extracted tree
through `.wine-assembly-browser.json`. No guest executable patches.

NFS II is the 1997 original software/DirectDraw demo (`nfsw.exe`), not the
Glide-only Special Edition. CLI and cooperative browser runs render its
640x480 main menu. A browser probe also entered a race and applied Up-arrow
input: subsequent frames show the race clock advancing, cockpit view, and
changed car position. This verifies race entry and input, not a full race.

```sh
node tools/profile-web-frames.js --app=nfs2_demo --warmup=2 --seconds=25 '--guest-script=click:130:310@35:0.3,key:13@5:0.3,key:38@15:3' --film=/tmp/nfs2-race:10
```

The click targets the main menu's RACE option. If startup is slower, wait for
that menu before clicking; input during the opening title screen is too early.

```sh
node test/run.js --app=nfs2_demo --no-build --quiet-api --quiet-blocks --max-batches=10000 --batch-size=100000 --max-seconds=40 --png=/tmp/nfs2.png
```

NFS III is the September 1998 final demo (`nfs3demo.exe`), with Corvette,
Rocky Pass, and random race/hot-pursuit/weather selection. It needs
`install.win`; just extracting the archive gives a misleading corrupted-files
error. The recipe reproduces the 578-byte file from the original installer:
English/local mode, relative asset paths, CRLF, final Ctrl-Z. Re-run
`--prepare --id=need-for-speed-3-demo` to update an existing fixture.

The original installer sequence is root `setup.exe` (PE bootstrap),
`Setup/English/Setup.exe` (NE InstallShield), then captured
`C:\windows\temp\_ins0432._mp` with `_wutl95.dll` seeded and arguments
`-fC:\setup\english\SETUP.INS -z1 -cx -xC:\WINDOWS\TEMP\`.
Welcome, destination, program folder, and shortcut dialogs lead to the
installed tree under `C:\Program Files\Electronic Arts\Need for Speed III Demo`.

NFS III loads its original software renderer `softtria.dll` at `0x00b30000`.
With worker threads and real-time clocks, the CLI renders the car and track.
The browser also reaches race startup: the Corvette loading screen at 10s,
the starting-grid camera at 21s, and cockpit/race HUD at 31s after launch.
These are sampled observations, not minimum loading times. Safari itself has
not been verified. The earlier 100-second CLI loading stall used the default
batch-driven clock and was not a reliable browser reproduction.
Raise the CLI stuck threshold: a startup polling loop at `0x004e5ad0`
otherwise triggers the default same-EIP detector after only 11 batches.

```sh
node test/run.js --app=nfs3_demo --threads --real-ticks --no-build --quiet-api --quiet-blocks --stuck-after=100000 --max-batches=100000 --max-seconds=40 --batch-size=10000 --png=/tmp/nfs3.png
```

## Texture cache page tracking

The WebGL cache now watches only texture/palette/render-target backing pages.
Guest aliases and Worker instances share atomic generations; CPU, bulk,
native drawing and host writes notify them. An unchanged texture checks page
versions instead of scanning pixel bytes. `test-page-watch.js` covers missed
notifications, independent consumers, native rendering, buffer swaps and
fallback behavior. Real NFS III gameplay passed a pixel-shadow audit with
zero misses through 554k triangles; normal mode made zero texture byte
comparisons over 357 measured flips. See
[dirty-tracking measurements](../d3dim-dirty-tracking-perf.md) for artifacts
and the machine-load limits on the observed FPS.

## Compatibility fixes

The browser worker loop must finish pending thread instantiation before
starting its next main-thread slice and publishing that slice's clock.
Previously main resumed concurrently with asynchronous worker initialization.
NFS II could start its timer-readiness deadline before the timer worker existed,
then abort with `getcpuspeed - INITTIMER REQUIRED TO DETERMINE CLOCK RATE`.
The check at `0x00483232` waits for the counter at `0x0051e11c` to advance,
then tears the timer down at `0x0048325b` if the deadline expires.
The startup barrier keeps actual execution concurrent once workers exist;
neither demo disables threads. A deferred-start regression in
`test-host-raf-present.js` fails without the barrier and passes with it.
Browser worker runs then reach NFS II's main menu (first sampled at 10s in
one run). `test-worker-thread-scheduler.js` passes all 50 checks, and the
browser DirectDraw presentation/vblank tests pass.

Use `--real-ticks` for these timing investigations: the CLI's default 200ms
per batch can expire the timer initialization check before a worker runs.

NFS II needs `WaitForMultipleObjectsEx`. It now delegates the non-alertable
wait to the existing multiple-object handler while preserving its 24-byte
stdcall cleanup and APC/wait-resume behavior. Covered in `test-read-file-ex.js`.
Its worker wrapper at `0x004856e0` calls the thread function then returns
through the thread sentinel; EIP-zero termination there is not a main-thread
crash.

NFS III queries actual VERSION string data. `VerQueryValueA/W` now traverses
the resource tree instead of returning the old fixed product-name string
for every key. Tests cover language tables, translations, root pointers,
missing keys, malformed children, case-insensitive keys, wide strings, and
unchanged input bytes. The Win16 synthesized GDI version translation trailer
is handled in its wrapper, preserving `test-win16-version.js` behavior.

Validation: full build, `test-file-version-info.js`, `test-read-file-ex.js`,
`test-static-dx-version.js`, and `test-win16-version.js` pass. The broad app
registry check has unrelated missing Baldur's Gate/Snood fixtures in this
shared checkout.
