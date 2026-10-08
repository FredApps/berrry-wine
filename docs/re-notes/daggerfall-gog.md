# The Elder Scrolls II: Daggerfall (GOG build 28043)

## Provenance and distribution status

The local fixture came from the Internet Archive `gog_collection` item and is
pinned in `test/candidate-corpus/manifest.json` as SHA-1
`05276866d94746987a56617b708fa6eb4653359b`. The corresponding GOG product was
listed at USD 0.00 when inventoried on 2026-08-25. That makes this a
zero-price proprietary game, not shareware and not freely redistributable.
The package and its extracted 538 MB payload therefore remain gitignored local
research fixtures; only configuration, provenance, and tests belong in git.

The downloaded installer is a Windows PE program. The installed game itself is
DOS software: `FALL.EXE` contains the CauseWay 3.32 DOS extender. GOG bundles a
Windows build of DOSBox 0.74-2.1 at `installed/DOSBOX/DOSBox.exe`, which is the
executable Wine-Assembly hosts for this acceptance path.

## Confirmed launch path

Apply the GOG base configuration followed by the two repository overrides:

```sh
node test/run.js \
  --exe=test/binaries/candidates/gog-free-elder-scrolls-daggerfall/installed/DOSBOX/DOSBox.exe \
  '--args=-conf "c:\dosbox_daggerfall.conf" -conf "c:\dosbox-wa.conf" -conf "c:\dosbox-launch.conf" -noconsole' \
  '--vfs-include=*' '--vfs-include=../**/*' \
  '--vfs-mount=test/binaries/candidates/gog-free-elder-scrolls-daggerfall/installed/__support/app/dosbox_daggerfall.conf=c:\dosbox_daggerfall.conf' \
  '--vfs-mount=test/configs/daggerfall-wine-assembly.conf=c:\dosbox-wa.conf' \
  '--vfs-mount=test/configs/daggerfall-launch.conf=c:\dosbox-launch.conf' \
  --no-build --screen=800x600 --max-batches=2100 --max-seconds=240 \
  --batch-size=2000000 --tick-ms-per-batch=200 --repaint-every=20 \
  --stuck-after=1000000 --quiet-api --quiet-blocks --no-close \
  --png=/private/tmp/daggerfall.png
```

`node test/test-daggerfall-dosbox.js` automates the same long local acceptance.
On the 2026-08-26 dynamic-core verification run, `FALL` remained the active DOS
program and the Bethesda Softworks credit was visible by batch 2000 (9,008
credit pixels across 9 guest-frame colors).

## Dynamic-core failure and fix

GOG's `core=auto` selects DOSBox's dynamic x86 recompiler. Before the flag fix,
CauseWay exited immediately with:

```text
CauseWay error 05 : Not enough memory for CauseWay.
```

This was not a real memory shortage. DOS `MEM` reports 632 KB conventional and
63,296 KB extended memory. A real-mode probe following CauseWay's calls sees XMS
3.01, a 63,424 KB largest block, and successful allocate, lock, and free calls.
Disabling EMS does not change the result.

The Qbix DOSBox 0.74-2 heavy-debug build made the nested-JIT divergence
reproducible without host Wine. `BP`, `LOGL`, and `MEMDUMPBIN` synchronized the
simple and dynamic cores at CauseWay's protected-mode allocator entry. Both
cores had identical registers and resident memory, and the page-count dword at
`DS:0x0AA2` was `0xFFFFFFFF`.

The generated x86 block read that value correctly into `EDX`, then executed:

```asm
cmp edx, 0
stc
pushfd
jz allocation_failure
```

Wine-Assembly's old `STC` handler replaced the complete lazy-flag state with a
synthetic carry-producing state. That incorrectly set ZF, so the later `JZ`
took the failure path even though `EDX` was nonzero. `CLC` and `CMC` had the same
architectural bug. They now materialize the existing EFLAGS, alter only CF, and
restore all other flags. With that fix, the unmodified dynamic core enters
CauseWay's allocator scan at `00C3:0EDC`; the repository acceptance therefore
uses `core=dynamic` rather than the former `core=simple` workaround.

Before the core switch could be tested reliably, commit `37d8cf43` moved
DirectDraw surface pixels out of Wine-Assembly's decoded-page index arena. That
fixed the independent corruption where DOSBox's third 640x480 surface overlapped
`PAGE_INDEX_ARENA` and invalidated live translated blocks.

## Gameplay-capture handoff (2026-08-29)

The dynamic core now continues past the Bethesda credit into Daggerfall's
original character creator. These inputs must be delivered as physical
keydown/up or held mouse events; `WM_CHAR` injection is ignored. The bonus
allocation UI also needs long settling gaps. With 300 headless batches between
point clicks, the verified checkpoints were:

- attributes: STR increased to 58 and the bonus pool became empty;
- skills: Mysticism 34, Illusion 24, and Medical 20, with all three category
  counters at zero;
- reflexes: Average selected, followed by the final character review.

The first end-to-end capture used the wrong final-review coordinate:
`(60,204)` instead of the visible OK button at `(284,204)`. Its later Escape
events did not advance the page, and all five candidate gameplay PNGs were
byte-identical review frames. The corrected deterministic sequence is retained
in `tools/run-daggerfall-gameplay.js`; its partial handoff run reached attribute
allocation batch 12,770 before being stopped to wrap and commit this work. Run
the tool with `DAGGERFALL_SCREENSHOT_DIR` set to a persistent output directory,
then visually inspect its five `gameplay-*.png` frames. The local numbered frame
`/private/tmp/free-gog-screenshots.EC8yad/6-elder-scrolls-daggerfall.png`
therefore remains unaccepted until it is replaced by a visually verified
first-person dungeon frame. Do not substitute DOSBox-X or host Wine: this
reproduction deliberately exercises GOG's bundled Windows `DOSBox.exe`
directly inside Wine-Assembly.


## 2026-10-05 — original browser route reaches attribute allocation

The original GOG DOSBox browser recipe is registered as `daggerfall_gog` (main `67205c27`), with the original GOG configuration followed by the existing dynamic50000/mem63/surface/sound-disabled override and `FALL.EXE Z.CFG` launch configuration. The first private attempt stopped before guest launch because its server omitted exact browser URL aliases for the new manifest; that harness failure is preserved and is not a compatibility finding. Actual HTTP positive/negative route tests cover the correction.

Attempt2 used tested runtime source `94d18605`/module `2e2fd8d1ca62cd87f0bc09312bc4836108df610d00cb7771bb5ae22755eceedc` and a pinned registration overlay. Ordinary physical input progressed through Bethesda intro, New Game, High Rock/Breton, male, Mage, generated background, visible name c, face selection and attribute allocation. The visible plus at browser(75,68) changed STR44→45→46; previous nonincrementing click coordinates are retained. These are character-creation pictures, not gameplay. No dungeon or final-review acceptance occurred.

The run ended on ordinary quit before its original600-second guard, session69536 exit0; browser/server closed18:47:08.029 UTC, no errors or pending streams, Chrome exited0 and owned processes were absent. The manual screenshot/input review loop consumed much of the budget; this does not establish an emulator stall. Next is a bounded, scene-gated replay of the now-observed ordinary route and visible allocation counter changes, followed by actual dungeon movement proof. Do not silently use the historical19800-second driver ceiling as permission to extend the browser run.

Immutable local evidence: `scratch/runs/20261005-daggerfall-character-creation/result.json`, exact inputs/served responses/source closure/review/hash manifest. Payload is read in place; frozen runtime bytes reuse immutable prior source files without duplicating the565MB original game. FPS, sound quality and gameplay qualification remain unknown.

## Browser allocation continuation (2026-10-05, attempt4)

The corrected ordinary creator prefix reached attribute allocation through all
14 reviewed scene gates and13 normal inputs. Manual allocation then reached
STR58 with zero attribute points, followed by Mysticism36 with primary1,
major6 and minor6 points still unassigned. The final image is a skill-allocation
page, **not dungeon gameplay**. The original600-second guard closed the browser
and server at19:23:56.462Z with no cleanup errors or unsettled streams.

Evidence: `scratch/runs/20261005-daggerfall-skill-allocation`, including
`attributes-ok.png`, `p5.png`, physical input timestamps, served byte receipts,
frozen runtime/registration sources and457 hashed artifacts. Reader validation
finds82 visuals and zero reviewed gameplay screenshots. Runtime remains the
previously tested94d18605 source/module2e2fd8d1 with the Daggerfall registration
overlay; this does not claim a rebuild of current main. A publication-time wrong
screenshot filename was corrected before acceptance; the original result and
hash list are retained as explicitly named pre-validation artifacts.

Short clustered clicks sometimes left the visible point count unchanged.
Observed1000ms ordinary mouse holds followed by2000ms release gaps advanced
the reviewed values. This is a useful input recipe, not a guest timing diagnosis.
The next source-only helper recognizes the exact rendered attribute counter
(0–13) from retained captures, permits one click per observed decrement, and
stops on unknown, unchanged or skipped counters. It has a120-second sub-bound
inside the unchanged600-second session and does not infer skill completion,
reflexes, final-review acceptance, FPS or player control. Remaining creator
transitions still require ordinary visual review; repeated cold allocation-only
runs are not gameplay evidence.

## Complete creator, then browser target loss (2026-10-05, attempt5)

The ordinary original-GOG route completed character allocation: STR61 with
attribute pool0, Mysticism37/Illusion27/Medical20 with all three skill pools0,
Average reflexes, then the final character-review page. This remains creator
evidence, not player-controlled dungeon gameplay.

The strict attribute helper stopped after its third click left the visible
counter unchanged at9. It was not rearmed. Manual groups of at most four
ordinary1500ms holds, each followed by3000ms release time and a saved screenshot,
advanced the remaining reviewed counters. Fixed observed plus coordinates in
the1024x768 browser were75,68 (attributes),261,79 (primary),261,128 (major),
261,177 (minor). No memory, counter or guest-message injection was used.
Average was selected at183,214; separately reviewed OK clicks at306,226 advanced
to final review and then requested entry to the game.

The last OK was delivered19:43:58.844–19:44:00.358Z. Capturing the resulting scene
failed with `TargetCloseError`; browser/server cleanup completed19:44:01.224Z,
before the original600-second deadline. Both owned PIDs were absent afterward.
Chrome exit status was unavailable and stderr/signal were not recorded. A
separate owner reported host ENOSPC immediately before19:44Z; this is a temporal
correlation, **not proof of the browser failure's cause or a guest exit**.
Kernel logs were unavailable. Do not diagnose a Daggerfall compatibility fault
from this receipt or label final-review pixels as gameplay.

Immutable evidence: `scratch/runs/20261005-daggerfall-final-review-target-close`,
523 verified hashed artifacts,121 reader-visible images, zero gameplay images.
See `final-review.png`, `nr6.png`, `reflexes.png`, `inputs.json`,
`allocation-events.json`, `cleanup.json`, served-byte receipts and frozen source
pins. Existing runtime94d18605/module2e2fd8d1 and registration overlay were retained.
Further ordinary continuation should use the successful finite allocation route
and capture bounded browser exit/stderr plus host resource receipts, after the
shared disk condition is addressed; no identical cause-blind rerun is justified.

## Opening parchment reached (2026-10-05, attempt6)

The finite ordinary route completed6 attribute and18 skill allocations with
an exact visible decrement after every click. The next reviewed screens were
Average reflexes and final character review. Final OK reached the candlelit
cinematic and subsequently the Imperial Palace sequence. A1000ms ordinary Space
hold on the visible actor/torch scene was followed by the opening parchment
beginning “You wake and look around the room”. The600-second session deadline
then expired before dismissal or movement. This is **not dungeon gameplay**.

Immutable evidence: `scratch/runs/20261005-daggerfall-opening-parchment`,
`hashes.json` with510 verified artifacts;121 reader-visible images, zero gameplay
images. Key images are `post-creator.png`, `arrival-wait.png` and
`load-after-space.png`. Inputs, per-point counter observations, source/served
identities and cleanup are retained. The existing94d18605/module2e2fd8d1 runtime
and registration overlay were unchanged.

The earlier browser-target failure did not reproduce. Cleanup20:22:49.855Z was
intentional at the original deadline, with browser/server closed, no errors,
no unsettled streams and Chrome exit0. Bounded filesystem samples ranged from
597,671,936 to801,214,464 available bytes; disconnect/exit followed cleanup.
This disproves a repeat on this run, but does not establish the cause of the
previous failure or prove that additional disk space fixed it.

The remaining boundary is normal parchment dismissal followed by visible
first-person forward/reverse/idle response. A source-only finite movie route
now matches only retained positive candlelit/Palace/actor regions before at
most two held Space inputs. It does not authorize keys from black/fade frames,
repeat the same movie input, dismiss parchment automatically, or extend the
original session. Personal review remains required for the newly reached scene.

## 2026-10-05: bounded movie route, still no dungeon qualification

The seventh ordinary browser run retained the original GOG payload and pinned runtime source `94d18605` / module `2e2fd8d1`. It completed 11 attribute and 18 skill allocations with exact rendered-counter decrements, selected Average reflexes, and accepted final character review. These remain character creation, not gameplay.

The movie helper captured 92 frames. Two positive book frames authorized an ordinary 1000 ms Space hold at 20:49:50.876Z; two positive Palace-title frames authorized another at 20:50:16.518Z. The last image was black, with no matched opening parchment or dungeon before the original 600-second deadline. Browser, server and recorder closed at 20:50:42.908Z with no cleanup errors, no pending streams, and Chrome exit 0. Both owned processes were absent afterward.

This deadline is a scheduling limit, not a demonstrated compatibility failure. Receipts expose a 131.935-second operator/context gap between the completed title wait and the next command; it must not be attributed to guest slowness. The creator prefix itself took 14.830 seconds, attribute allocation 51.948 seconds, and skills 85.171 seconds. Final review was accepted only at 20:49:27Z, leaving about 74 seconds for cinematics and gameplay.

Source review also identified an avoidable route policy: Palace title and actor shared the consumed `palace` key. Sending Space at the title therefore disabled the later actor-positive skip that had actually progressed to parchment in attempt 6. No actor was captured before attempt 7 ended, so this is proven helper behavior, not proof of the black frame's cause. The next prepared helper observes the Palace title without input and allows one actor skip only after two consecutive positive actor frames. It retains the two-key total, no-repeat, black/fade exclusions, release-on-error, 90-second movie phase and 160-capture bounds. A proposed 900-second whole-session budget provides room for personal parchment dismissal and ordinary dungeon forward/reverse/idle evidence; no new run or gameplay result is implied.

Immutable evidence: `scratch/runs/20261005-daggerfall-movie-gated-route/result.json`; its `hashes.json` lists 683 verified artifacts. The actual ops reader ingests the run with no gameplay screenshots and `performance: null`. The final image is `movie-gate-91.png`. Source readiness and timing proposal are in `scratch/new-game-daggerfall-20261005/MOVIE-READY8.json` and `attempt7-findings-and-route8-plan.json`. Actual-image tests verify Palace causes no input or actor consumption, two-frame actor gating, one-shot behavior, two-key limit, wrong-scene/deadline rejection, and input release after down/hold/up failures. No FPS or full-game claim.

## 2026-10-07 — ordinary dungeon movement, after mutable-save mount repair

The original GOG DOSBox route now reaches the actual first-person dungeon. Run `scratch/runs/20261007-daggerfall-dungeon-controls/result.json` preserves the ordinary title/creator allocations, reviewed book and actor Space inputs, opening-parchment click and tutorial No choice. No guest memory, callbacks, or state were forced. The earlier movie matcher was not used: visible book and actor scenes were reviewed directly, while Palace titles/fades received no input.

Root personally reviewed `dungeon-entry.png`, `dungeon-forward.png`, `dungeon-back.png`, and `dungeon-idle.png` in that run. ArrowUp1200ms at08:41:40.992Z–08:41:42.197Z enlarged the nearby wall geometry; ArrowDown1200ms at08:42:03.548Z–08:42:04.753Z reversed it; the1500ms idle view remained stable. This qualifies narrow ordinary player-controlled dungeon movement, not dungeon completion, sustained play, sound quality, or FPS. Exact input receipts, root review, served-source evidence and708 artifact hashes are retained in `inputs.json`, `root-review.json`, `responses.json`, and `hashes.json`.

The preceding attempt9 failed after actor dismissal with an owning Worker `VfsPendingError` in `fs_set_end_of_file_result` for the original16,406-byte `c:\arena2\mapsave.sav`. Its immutable record is `scratch/runs/20261007-daggerfall-lazy-save-fault`. The manifest had classified mutable saves as lazy HTTP providers despite the synchronous VFS write/truncate contract. Repair0dc59927, integrated on main asfe7cfb95, marks the four original `.SAV` entries required (65,624bytes total), preserves their bytes and leaves1,702 files lazy. The real generator→normalizer→host loader→VFS regression covers truncate/extend/write and reproduces the old-provider failure;11 existing loading tests passed. Local manifest SHA-256 is `ad3326a8ace90d13479a980567b3255d2353ff4b4e1a57ca1a265ace4bad8e3c`. The prior fault did not recur on this corrected ordinary route.

The runtime was the existing tested source checkout3b8189f5234328f4cb51673a7b543c8dbacdaaf8 and actual module `8eb283c1b595afe336c3e2407f722e19d47aad0739784de4864ba699c8b5712f`, not a rebuilt latest-main module. Pins explicitly separate the unchanged449-file runtime closure from the corrected manifest generator. Original payloads were read in place.

The run stopped normally at08:43:14.586Z before its original900sec deadline. Browser, server and recorder closed; no streams remained, Chrome exited0 and both owned processes were absent. The driver exited1 because the strict helper refused optional `__bundle`; that error is retained in `cleanup.json`, so this is not reported as an error-free run. It did not prevent the required individual save downloads or the reviewed dungeon movement. Performance remains null.
