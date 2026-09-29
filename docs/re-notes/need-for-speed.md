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

NFS III loads its original `softtria.dll` at `0x00b30000` by default. A
40-second cooperative probe stalled around `EnterCriticalSection`, with
`0x09011fa0` held by T1. Real worker threads progress to the loading artwork.
The loading image remains unchanged at 100 seconds (6.39M API calls; worker
T3 parked in a wait). NFS III is experimental; menu/race startup is not yet
verified. Raise the CLI stuck threshold: a startup polling loop at `0x004e5ad0`
otherwise triggers the default same-EIP detector after only 11 batches.

```sh
node test/run.js --app=nfs3_demo --threads --no-build --quiet-api --quiet-blocks --stuck-after=100000 --max-batches=100000 --max-seconds=100 --batch-size=100000 --png=/tmp/nfs3.png
```

## Compatibility fixes

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
