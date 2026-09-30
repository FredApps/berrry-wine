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

Collapse performance follow-up: a real-GPU, headful browser with Threads enabled
presented 516 frames in 22.616 seconds on an active Crunch board (about 22.8/s),
but its final rolling rate fell to 1.08/s. Page cadence stayed at 60 FPS, with
zero long tasks. This establishes uneven guest presentation, not its cause;
host load was extreme during the investigation (one-minute load reached 196).
The static menu also legitimately presents rarely. Do not interpret the HUD's
thread phase share as CPU utilization. Evidence: `/private/tmp/reflexive-probe/`
`collapse-fps2.log`, `collapse-fps-board2.png`, `collapse-fps-end2.png`.

CPU/wait follow-up (2026-09-29): `collapse-cpu-game.log` and the raw profiles in
`/private/tmp/reflexive-probe/collapse-cpu-game/` cover an actual Crunch board
with browser Workers, hardware GPU and RPC census. The first `collapse-cpu`
run covered loading/menu instead and must not be called gameplay. Gameplay
route at the profiler's default viewport: `click:147:277@1,click:190:277@8`
after 20 seconds warmup; verify the final screenshot because startup varies.

Across the final 17.998 seconds of wait snapshots, the main Worker completed
116,880 slices (6,494/s) while every snapshot remained at GetMessage return
`0x42a54e`, yield 7, usually one retired block per slice. Its 20-second V8
profile attributes 2.220s to postMessage and 3.392s to handleMessage/send
wrappers, versus only 81ms directly in exported `run`. The page additionally
attributes 1.485s to worker.onmessage and 846ms to postMessage. These are
sampled durations under load, not OS thread CPU utilization. This is concrete
empty-slice/message overhead; inspect `host.js` `_workerParkMain`, the yield-7
branch and `ThreadManager.freeRunParkBound` before tuning the renderer.

The draw/update Worker has 10.861s sampled non-idle time, including 1.864s
(17.2%) in native GDI BitBlt, plus interpreter work and 564ms in synchronous
host-response waits. Function 10693 is the blitter in the captured artifact;
current combined.wat indices have shifted, so resolve against the captured
runtime rather than blindly naming the current index. Two auxiliary workers
spend 16.116s and 13.240s in waitStepEpoch/Atomics.wait: these are short sleeps,
not CPU burn. The profiler's generic "busy" total includes those waits.

No permanent block was observed. In the final snapshot interval the draw
thread advances 605 slices and issues 158 surface uploads; its sampled event
wait deadlines are 43–46ms. Background slot 4 wakes six times from a 3000ms
event wait. Draw-thread critical-section parks increase by only two, with no
bad leaves; the large cumulative count is mostly earlier contention. Loader
slot 3 has exited normally. Main-worker messages, multimedia SetEvent calls,
audio submissions and drawing continue. Host load 41 during this run prevents
claiming a clean throughput benchmark or a measured benefit from a fix.

The subsequent gameplay census identifies the expensive BitBlt shape:
50 declines in ten seconds, all for complex clips (reason 1), covering
24,000,000 pixels—exactly 50 full 800×600 transfers. The decline counters live
in shared memory; do not sum their identical readings across Workers.
Collapse's sole BitBlt call at `0x40a3e3` uses SRCCOPY, and its DIB constructor
at `0x403e3d` creates a top-down 32bpp bitmap. Evidence:
`/private/tmp/reflexive-probe/collapse-ab/before2/result.json`.

The generic raster loop now copies 32bpp SRCCOPY pixels directly after its
existing visibility and bounds checks, avoiding destination reads and repeated
color/ROP conversion. Other formats and ROPs retain their prior paths;
overlap traversal and reserved-byte clearing are unchanged. The existing
BitBlt widening regression includes 24 independent byte-oracle cases for clip
holes, source/destination bounds, row orientation, padding and overlap;
all 12 checks plus the 10 decline checks pass. An isolated, byte-identical
799×599 overlapping-copy benchmark measured mean process CPU of 559.6ms
before and 200.0ms after for 20 copies (64.3% reduction across two A/B/B/A
cycles). That synthetic result is not a gameplay FPS claim. Reproduce with
`node /private/tmp/reflexive-probe/bitblt-bench.js`; raw results are in
`/private/tmp/reflexive-probe/bitblt-bench.json`.

The scheduler fix makes `freeRunParkBound` recognize unsatisfied helper waits
and their deadlines instead of treating them as runnable. Real browser windows
using identical WASM and otherwise frozen host scripts measured 4,823–4,912
main slices/second before versus 43–46 after (about 99% fewer). Presents stayed
near 9–11/second. Worker scheduler tests cover finite/infinite waits, timeout
expiry, consuming auto-reset signals exactly once, immediate signaled-worker
dispatch, runnable siblings and serial mode; all 51 checks pass, along with
existing browser parking/wakeup and ThreadManager tests.

Both fixes together reached and advanced the Crunch board in two further
windows (43–54 main slices/second, 8.5–16.9 presents/second). These runs were
under changing heavy host load and the raster candidate also uses a newer
shared source snapshot than the original baseline, so this is functional
acceptance, not a controlled whole-game FPS gain. Raw windows, process CPU
counters and screenshots are in `/private/tmp/reflexive-probe/collapse-ab/`;
`summary.json` records the rates. The independent raster microbenchmark is
the matched before/after evidence for the pixel-copy optimization.

Build validation: the full build passed the preceding ABI, API, layout and
browser cache/signature gates, then stopped at unrelated stale generated
toy-VM browser bundles. Those files were left to their owner. The canonical
WAT compiler is run separately to refresh native and compatibility artifacts;
this does not turn the failed full-build check into a pass.

Crash fix: the failing instruction is `40145f` (`call [eax]`) in a lock guard,
not a critical-section return. The shared object at `7ef083d0` lost its vtable
(`4883b4`); both rendering and background workers subsequently called through
freed/corrupted storage. Its AddRef/Release methods (`401270`/`401280`) call
InterlockedIncrement/Decrement **before** taking the object's lock. Those
emulator handlers used separate loads and stores, allowing lost reference
updates across real Workers. The same object corruption also reproduced with
the micro-op tier disabled, excluding an optimizer-specific failure.

The four DWORD Interlocked handlers now use atomic WASM read-modify-write
instructions on aligned guest pointers. Return values, stdcall cleanup,
code invalidation and page-watch notifications are preserved; unaligned and
discontiguous page-crossing compatibility paths retain their previous behavior.
`node test/test-wat-locks.js` passes all 19 checks, including new two-Worker
increment/decrement/compare-exchange/exchange races. Replacing only those
handlers with the old versions makes all four race checks fail.

Two fixed real-browser runs each survived 180 gameplay clicks with all live
workers intact and the object's vtable/reference count valid. The second
reached level 2, score 27,405. Artifacts are in
`/private/tmp/reflexive-probe/collapse-atomic-{fixed,final}/`; the matched
source closure and before/after modules are `interlocked-*` in the parent
directory. This is crash acceptance, not a claim of improved frame rate.
The matched old-handler browser control survived 120 clicks on this attempt;
the race is timing-dependent, so one surviving old run is not a negative
control for crash absence. The reproducible negative control is the four
concurrent API tests above; earlier old-build gameplay crashed with either
micro-op setting. Both fixed runs finished with the object's reference count
back at one, while this old control's final sample was four.

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
