# Alien Shooter (Reflexive)

Local fixture: `test/binaries/candidates/reflexive-alien-shooter/game/AlienShooter.exe`.
The complete companion assets are required (`--vfs-include='**/*'`). Original
installer/provenance and SHA-256 are recorded in `reflexive.md` and the local
candidate manifest. No guest executable or asset patches were made.

## DirectSound8 startup (2026-09-29)

Startup originally stopped at `DSOUND.DLL#11`, IAT `0x47a01c`, caller
`0x41cb65`. This is **DirectSoundCreate8**, not a capture function; see Wine's
[export specification](https://github.com/wine-mirror/wine/blob/master/dlls/dsound/dsound.spec)
and Microsoft's [factory contract](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee416762(v=vs.85)).

Commit `17a29c31` adds the named factory and ordinal, an IDirectSound8 vtable
with the inherited eleven methods and VerifyCertification, full IID matching,
initialized speaker state, default playback GUID aliases, aggregation/device
errors, and an explicit uncertified software-device result. The initial APIs
3756–3757 became 3886–3887 when the concurrent Glide branch was merged.
The vtable registry also requires capacity 0x124 bytes and a regenerated region
map. `test-directsound-ordinals.js` covers the factory, errors, ordinal, vtable
slots, versioned QI/refcounts, certification state, and stdcall cleanup.

## Native GPU probe and later corruption

Pinned isolated artifact from this investigation: `build/alien.wasm` (initial
DS8), then `build/alien-final.wasm` (final factory validation and registry size).

```sh
node test/run.js \
  --exe=test/binaries/candidates/reflexive-alien-shooter/game/AlienShooter.exe \
  '--vfs-include=**/*' --no-build --wasm=build/alien-final.wasm \
  --headless-gl --no-close --quiet-api --input=50:dlg-click:1,500:keypress:13 \
  --max-batches=30000 --batch-size=200000 --max-seconds=150 \
  --png=/private/tmp/alien-long.png
```

The initial DS8 GPU probe renders the SIGMA TEAM splash. A longer run reaches
a guest NULL call near batch 2597. `--no-uop` reproduces it. This is a later
graphics/locking failure, not evidence against the ordinal fix.

`--watch=0x43ff20 --watch-log` identifies actual executable-memory overwrite:
the RLE sprite writer at `0x417384` stores ARGB pixels into code. Watch stops
at `0x417392`, previous EIP `0x417322`, destination EAX `0x43ff23`, row base
EDI `0x43fac7`. The original first dword `0x5314ec83` becomes `0x53ffa5ae`,
then `0x08ffa5ae`. Static `0x43ff20` is a shared object tick method reached
through vtable `0x47a90c`, slot 2, from caller `0x4056b6`.

The destination comes from a cached locked surface pointer:

* At `0x416805`, the guest calls surface vtable slot 9 (LockRect), with output
  at `[ebp-0x3c]`, NULL rectangle, and flags zero.
* It continues even if the HRESULT is negative. `0x416832` caches output
  pBits `[ebp-0x38]` into the game singleton's `+0x23c`; pitch/4 is cached at
  `+0x248`. The singleton is pointed to by `0x4b2d54`.
* The blitter derives its row destination from this cached pointer and pitch.
* Native runs print `Color update failed` from `gpu-backend.js` during color
  uploads before the corrupting draw. Failed backbuffer unlocks retain lock
  ownership for a retry, so a subsequent LockRect can legitimately fail.

Logs: `/private/tmp/alien-{long,no-uop,watch,lock}.log`.
The watch log includes original code/heap dumps at batch 2580 and the exact
writer at batches 2607–2608. Native GPU startup also warns about two GL
contexts; this can include the capability probe and is not by itself proof
of the color-upload error's cause.

## Software backend diagnostic

Replace `--headless-gl` with `--d3d9-renderer=software`. The first 528 observed
LockRects return success, pitch 2560, pBits `0x501a2000`; use
`--trace-at=0x416808 --trace-at-mem=ebp-0x3c:8` to inspect the actual return.
An EAX `0x8876086c` printed while parked **inside** the API thunk is only the
handler's initial value while an asynchronous operation is pending, and must
not be reported as the call's returned HRESULT.

A 6000-batch software run remained active without the native NULL fault but
captured a black canvas.

## Root cause and corrected rendering

The renderer split one guest device into two host devices. D3D8 CreateDevice
creates the primary D3D9 object and changes its vtable to Device8. The internal
`d3d9_backbuffer_owner` requested a Device9 interface wrapper for that same
object, which allocated an auxiliary COM pointer. GPU descriptor IDs use the
device pointer: Present therefore addressed the primary renderer while
LockRect/UnlockRect addressed a second renderer.

The software backend exposed two independent targets: CPU pixels went to one,
while the other kept presenting black. Native headless GL created two contexts
and encountered `GL_INVALID_VALUE` (1281) directly from `texSubImage2D` despite
matching 640×480 logical sizes. The failed unlock/next lock then caused the
guest's unchecked blit into code.

The fix returns the device's primary COM wrapper from the internal owner
lookup. No interface query is needed there. The regression in
`test-d3d9-color-surfaces.js` changes the primary vtable to Device8, verifies a
lock reads existing render contents, writes a pixel, unlocks/presents, checks
the pixel, and asserts that the host device count never changes.

With that fix, both native GPU and software runs reach the main menu with real
rendering and no corruption. Parent-observed native menu screenshot:
`/private/tmp/reflexive-probe/alien-native-observe.png`; software menu:
`/private/tmp/reflexive-probe/alien-menu.png`. Native final surface capture is
`/private/tmp/alien-native-fixed.png`. The live control PNG is preferable to
the runner's final surface chooser during loading (the latter can capture the
old SIGMA splash while the composited screen shows LOADING).

The route is graphics setup OK, LOADING, SIGMA TEAM, Alien Shooter title,
then menu; Enter skips the title. Mouse movement before clicking New Game
reaches Select Player.

## Mission 01 acceptance

A fresh software run with `--tick-ms-per-batch=5` reached Mission 01 and
verified character/camera movement and mouse aiming. The default 200ms
clock produced extremely slow presentation/input progress while executing
Vorbis LSP-to-curve decoding at `0x46b554`; changing it mid-run did not
immediately recover responsiveness. Start the interactive CLI run at 5ms.

```sh
node test/run.js --app=alien_shooter --no-close --quiet-api \
  --d3d9-renderer=software --tick-ms-per-batch=5 --batch-size=200000 \
  --input=50:dlg-click:1 --control=58118 --max-seconds=600
```

After each screen finishes loading, move before pressing/releasing the normal
left mouse button: New Game `(98,296)`, Campaign `(320,334)`, then Continue
`(535,445)` in the Mission 01 equipment screen. Held right arrow moves the
character; mouse movement changes the aim. Firing was exercised but no clear
projectile was captured, so combat is not certified by this acceptance.

Evidence in `/private/tmp/reflexive-probe/`: `alien-lowclock-campaign2.png`,
`alien-lowclock-gameplay.png`, `alien-lowclock-move-fire.png`, and
`alien-lowclock-fresh.log`. This was CLI software acceptance; browser gameplay
has not been verified for Alien Shooter.

## Validation limits

The DirectSound ordinal/interface regression passes on the merged source.
The added D3D8 identity/pixel assertions pass in the synchronous software
branch of `test-d3d9-color-surfaces.js`. Its later worker branch fails an
existing rectangular UpdateSurface-to-backbuffer pixel assertion before
reaching the new case. The same failure reproduces on pristine `79483e6a`
and the combined main source; it is not a passing full-suite result.
Logs: `/private/tmp/alien-owner-baseline.log`,
`/private/tmp/reflexive-probe/merged-color-surfaces.log`.

The merge-time combined source compiled and passed the remaining build gates
when the previously documented baseline union-gate failure was excluded.
A later standard build of the moving shared worktree stopped at new duplicate
Glide `grFinish`/`grFlush` handlers (`final-main-build.log` in the same scratch
directory). The canonical artifacts were refreshed with the compiler directly;
this is not an entirely green standard-build result.

## Original Mission 01 on browser WebGL, 8 October 2026

Run `scratch/runs/20261008T0114Z-alien-shooter-webgl` reaches the original
registered Mission 01 through graphics OK, New Game, Campaign, Continue.
The real browser clock is used; no CLI tick recipe, guest writes, game patch,
or blind Enter is involved. Each menu click follows a reviewed highlighted
target and trusted desktop mouse motion. The native graphics dialog's OK click
has a separate trusted DOM receipt at client `(342,374)`, with pointer lock off.
The later DOM receipts also report unlocked motion; relative desktop commands
remain usable without assuming that absolute Puppeteer coordinates reach a
locked game cursor.

`mission-settled.png` to `right-released.png` shows the soldier crossing the
grass under held ArrowRight; `down-released.png` retains a later ordinary
ArrowDown comparison. `aim-right.png` and `aim-left-final.png` show opposite
weapon orientations after trusted horizontal mouse motion. The early W capture
overlaps the intro camera movement and is not the strongest movement evidence.
The HUD remains at HP 110. This qualifies movement and aiming in Mission 01;
combat, mission completion, audio and FPS were not measured.

This is an explicitly accepted reference runtime, not a new current-main build:
source `f62ab3c9f1223ab47cf623470f6343d508257878`, WASM SHA-256
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`.
The original EXE SHA matches `aae2547c…`; the unchanged accepted registry selects
its original manifest. All 963 package pins and 446 Git source pins pass.
Independent old companion-file hashes were unavailable: current original fixture
hashes and registered manifest sizes are sealed, rather than claimed to be an
independent installer re-extraction. Both host and owning render Worker report
the neutral D3D8/D3D9 WebGL backend. All 156 full and 333 range HTTP reads match
their pinned bytes. Four strict unlisted requests are retained honestly:
`api/auth/user`, `test/binaries/tlbs/stdole2.tlb`, its `.part000` path, and
`icons/apps/alien_shooter.png`. No renderer fault is observed.

Ordinary harness quit at 01:21:53.394Z closes Chrome with exit 0, closes the
server and drains all streams. Independent checks find both owning PIDs absent,
no Chrome, exact baseline sockets and unchanged pins. All 65 actual capture
files were downloaded and hash-checked before removing the scoped remote prefix.
The root-owned sandbox and Puppeteer tools were retained for its lifecycle owner.

The actual native title is `AlienShooter`, which exposed a spaced-name matcher
in the scoped harness. The observed run used separately recorded trusted native
input; the final adapter recognizes both title spellings and refuses GPU windows
as native setup. Its regression passes, but that small adapter correction was
made after the run. The archives preserve the exact executed adapter at
`3282325e6`; do not substitute the final branch hash for the runtime's source.
