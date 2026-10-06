# Dual-mode crash sweep, 2026-10-06

Every game has to work under the cooperative scheduler (`run.js --no-threads`,
the default) and with real guest threads (`run.js --threads`, the headless
twin of the browser's Threads mode). `tools/crash-sweep.js` now runs both and
compares them:

```sh
node tools/crash-sweep.js --apps=a,b,... --modes=coop,threads --seconds=15 \
  --stuck-after=0 --jobs=1 --jsonl=dual.jsonl
node tools/crash-sweep.js --compare --jsonl=dual.jsonl [--md] [--gate]
```

Each run records its signature (ok / unimpl / trap / exit / stuck / ...), the
final screen (`content` / `blank`, from the exit PNG) and the waveOut PCM
(`sound` / `silent` / `none`). `--compare` lists every app whose two modes
disagree, crash first, then early stop, then picture, then sound; `--gate`
exits 1 when any do.

Two things to know before reading a result:

- **Pass `--stuck-after=0`.** run.js ends a run as STUCK after 10 batches at
  one EIP. A loader whose main thread waits on worker threads does that within
  0.2 s, so with the default most 3D games "stuck" in both modes and look
  identical while nothing was compared. On this pass it turned 17 early stops
  into full runs and 4 apparent divergences into agreements.
- **Confirm a frame divergence before acting on it.** Worker scheduling is
  not deterministic: `red_alert_95_demo` ended on a blank frame under threads
  once and on the same 131,045-byte frame as coop on the repeat.
- **Audio is a weak signal headlessly**: `--audio-out` captures waveOut PCM
  only, so a DirectSound game reads `none` in both modes.

## Result: curated top 38, build 61686c8e + cedede26

`scratch/runs/20261006T1325Z-dual-mode-top38/dual.jsonl` (coop vs threads,
15 s each, one run at a time, default memory). Cells are
signature / frame / audio.

| app | coop | threads |
|---|---|---|
| age_of_wonders_demo | ok / content / none | ok / content / none |
| alien_shooter | ok / content / none | ok / content / none |
| arcanum_demo | ok / content / none | ok / content / none |
| blood2_demo | ok / content / none | ok / content / none |
| caesar3_demo | ok / content / none | ok / content / none |
| carmageddon2_demo | ok / content / none | ok / content / none |
| colin_mcrae_rally_demo | ok / content / none | ok / content / none |
| crimsonland | ok / content / none | ok / content / none |
| deus_ex_demo | ok / content / none | ok / content / none |
| diablo2_demo | ok / content / none | ok / content / none |
| diablo_shareware | ok / content / none | ok / blank / none |
| die_by_the_sword_demo | ok / content / none | ok / content / none |
| halflife_uplink | ok / content / sound | ok / content / sound |
| heroes3_demo | ok / content / none | ok / content / none |
| hitman_glide_demo | ok / blank / none | ok / blank / none |
| hype_glide_demo | ok / content / none | trap:unreachable / none / none |
| icewind_dale_demo | ok / content / none | ok / content / none |
| jazz2_demo | ok / content / none | ok / content / none |
| liquid_war | ok / blank / silent | ok / blank / silent |
| moorhuhn | ok / content / none | ok / content / none |
| mshearts16 | ok / content / none | ok / content / none |
| myth_tfl | ok / content / sound | ok / content / sound |
| nfs3_demo | ok / content / none | ok / content / none |
| nfs3_glide_demo | ok / content / none | ok / content / none |
| pinball | ok / content / sound | ok / content / sound |
| quake2_demo | ok / content / none | ok / content / none |
| red_alert_95_demo | ok / content / none | ok / blank / none |
| simgolf_demo | ok / content / none | ok / content / none |
| ski32 | ok / content / none | ok / content / none |
| starcraft_shareware | ok / content / none | ok / content / none |
| tomb_raider_2_demo | ok / content / none | ok / content / none |
| tomb_raider_3_demo | ok / content / none | ok / content / none |
| unreal_special_demo | ok / content / none | ok / content / none |
| ut348_demo | ok / content / none | ok / content / none |
| warcraft3_demo | ok / content / none | ok / content / none |
| winamp_mod | ok / content / sound | ok / content / sound |
| winboard | ok / content / none | ok / content / none |
| zuma_deluxe | ok / content / none | ok / content / none |

**Fixed:** `diablo_shareware` threw `ThreadManager.runSlice is the
cooperative backend` under `--threads` (cedede26): run.js called the inline
cooperative wait for a wait nested in a synchronous SendMessage, which the
worker backend cannot run. host.js already skipped it.

**Open divergences:**

1. `diablo_shareware`, threads: no trap any more, but the menu is Storm's
   dialog with plain Win32 buttons and the art is never drawn. Storm waits for
   its MPQ reader thread *inside* WM_INITDIALOG. Cooperatively the nested
   wait pumps that thread inline; under workers the wait answers "pending",
   the dialog procedure yields, and `$wnd_send_message` abandons it halfway
   (thread-manager.js's own comment on waitMultipleCooperative). host.js does
   the same in the browser's Threads mode, so the page should show the same
   menu. The fix is a blocking nested wait that services worker RPC until the
   object is signalled -- a worker-backend design change, not a one-liner.
2. `hype_glide_demo`, threads: `trap:unreachable`. MFC's thread at 0xb98b10
   (created suspended, then resumed) exits through EIP 0 still holding a
   critical section within ~1 s; under coop it stays alive. The main thread
   later reads a zeroed `m_hWnd` (`ShowWindow(0)`) and runs into 0x7525.

**Not run:** 230 registry apps. A boat fork has no `test/binaries` (30 GB,
gitignored, not in the snapshot) and run.js cannot mount app files from a
URL, so a full sweep on a boat needs a feed: a static server here, reverse
forwarded into the fork, and a tool that fetches each app's registry files
before its run.
