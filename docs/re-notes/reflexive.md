# Reflexive corpus compatibility probe

2026-09-29: sampled five titles from https://github.com/banteg/reflexive.
The project supplies downloads and static installer/executable extraction;
its unwrap coverage is not Wine-Assembly compatibility coverage.
Upstream master observed at `615d946772e344e54ee3a7444d5f0010b68b79ac`.

Local tests compiled the current shared source through `test/run.js`, with
HEAD `8f9f66a8` plus existing worktree changes. No emulator code was changed.
These are CLI startup probes, not browser or performance certification.

## Acquisition

Scratch root: `/private/tmp/reflexive-probe`. Tool source and venv are under
`reflexive-master/`; original installers, extracted trees, wrapper-free games,
logs, and screenshots are retained there. Every downloaded installer passed
the upstream manifest size and SHA-256 validation (`reflexive download`
reported `already_present` after curl downloads).

For each installer, use:

```sh
reflexive download RicochetSetup.exe /private/tmp/reflexive-probe/RicochetSetup.exe
reflexive extract /private/tmp/reflexive-probe/RicochetSetup.exe \
  /private/tmp/reflexive-probe/extracted/Ricochet --unwrap --keep-extracted \
  --unwrapped-root /private/tmp/reflexive-probe/games/Ricochet
```

Other filenames: `ZumaDeluxeSetup.exe`, `CrimsonlandSetup.exe`,
`CollapseCrunchSetup.exe`, `AlienShooterSetup.exe`. All five extracted and
unwrapped successfully. There was no need to run their installers in the guest.

All five are now installed in the local candidate corpus under
`test/binaries/candidates/reflexive-{ricochet-xtreme,zuma-deluxe,crimsonland,collapse-crunch,alien-shooter}/`.
Each fixture has a complete `game/` tree, its original installer in `sources/`,
and `.candidate-source.json` recording the installer SHA-256, upstream tool
commit, and every copied game's file size and SHA-256. All copied game files
were verified against the scratch originals. Manifest entries are manual
because the generic corpus fetcher does not implement Reflexive unwrapping.
For the launch commands below, the corresponding fixture's `game/` directory
can replace the scratch game directory. DLL seeds and full asset mounts are
also recorded in the candidate manifest; the corpus survey does not currently
forward custom screen or input settings.

## Observations

| Title | Furthest observed / blocker |
| --- | --- |
| Ricochet Xtreme | CLI and browser Worker/WebGL Round 1-1 gameplay verified: paddle movement, ball launch, brick destruction and score. Requires bundled IFC22.dll. Earlier splash captures ended during active asset decompression; a longer run reaches the menu without runtime changes. Local fixture includes 351 verified guest-generated cache files. See [Ricochet notes](ricochet-xtreme.md). |
| Zuma Deluxe 1.0 | Creates game window, then bundled `bass.dll` reports `Unable to load function: QueueUserAPC (KERNEL32.dll)`. Loader warns DllMain did not return cleanly; guest subsequently calls through NULL. Screenshot `zuma.png`. |
| Crimsonland | Displays `DirectX8.1 or newer not detected`. Explicitly seeding grim/vorbis/vorbisfile/ogg DLLs does not resolve it. A per-run registry override of DirectX `Version` to `4.09.00.0904` also did not resolve it; the exact detection path remains untraced. Screenshot `crimsonland-dx9.png`. |
| Collapse! Crunch | Default 640×480 is rejected. `--screen=800x600` renders the game's loading screen and starts guest threads. Initial 35-second run reaches batch 310 without an API trap (`collapse-800.png`). A longer run then reports a guest call through NULL at batch 317, ends after 41.836 seconds, and captures a black client area (`collapse-long.png`). Scheduled input starts at batch 500 and never fires. No gameplay confirmed. |
| Alien Shooter | Main menu verified with native WebGL and software rendering after implementing DirectSoundCreate8 and fixing the backbuffer owner's device identity. Mission 01, character/camera movement and aiming verified in a fresh software CLI run with `--tick-ms-per-batch=5`. Combat and browser gameplay remain unverified. See [Alien Shooter notes](alien-shooter.md). |

The runner warns that shell32.dll and ole32.dll are missing locally. Do not
confuse those environment warnings with the concrete blockers above.
Use `--no-close` for these probes; the runner otherwise injects WM_CLOSE on
some window-show paths (observed repeatedly in Alien Shooter's first run).

## Reproduction

```sh
node test/run.js \
  '--exe=/private/tmp/reflexive-probe/games/Ricochet/Ricochet Xtreme/Ricochet.exe' \
  --dll-seed=IFC22.dll '--vfs-include=**/*' --no-close --quiet-api \
  --max-batches=30000 --batch-size=20000 --max-seconds=35 \
  --png=/private/tmp/reflexive-probe/ricochet.png

node test/run.js \
  '--exe=/private/tmp/reflexive-probe/games/CollapseCrunch/Collapse! Crunch/Collapse3.exe' \
  '--vfs-include=**/*' --screen=800x600 --no-close --quiet-api \
  --max-batches=30000 --batch-size=20000 --max-seconds=90 \
  --input=500:keypress:13,1000:keypress:13,2000:keypress:13 \
  --png=/private/tmp/reflexive-probe/collapse-long.png

node test/run.js \
  '--exe=/private/tmp/reflexive-probe/games/AlienShooter/Alien Shooter/AlienShooter.exe' \
  '--vfs-include=**/*' --no-close --quiet-api --input=50:dlg-click:1 \
  --max-batches=30000 --batch-size=20000 --max-seconds=45
```

## Wrapper-free executable SHA-256

```text
Ricochet.exe     9f8c00daccb9dfff9806229fd1f427d85c22ce0581e94f7ca6939f0dc00e5bd8
Zuma.exe         60bf0df7695914e4f8238b5c99f665b8484d3c0dea9378389f95244c9712446c
crimsonland.exe  93cdcdc872c836e75122e3a1d41312c74761cf4736181d3541521e82f6cb2031
Collapse3.exe    7f581e685db736239993efa843b145d085372c90c2d094f9fa4f1a3772947edb
AlienShooter.exe aae2547ccec2e235344bc9cf6e5e9ef4c9923b13c9e8fbd1fe14c65b64252446
```
