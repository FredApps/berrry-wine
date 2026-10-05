# Ricochet Xtreme 1.4 build 75

Local fixture: `test/binaries/candidates/reflexive-ricochet-xtreme/game/`.
The wrapper-free executable SHA-256 is
`9f8c00daccb9dfff9806229fd1f427d85c22ce0581e94f7ca6939f0dc00e5bd8`.
Acquisition and installer provenance are in `reflexive.md` and the ignored
fixture's `.candidate-source.json`.

## Cold loading is active decompression

2026-09-29: the isolated committed runtime at `8f9f66a8` reaches the main
menu without runtime changes. The earlier 35/60-second splash captures were
premature. A 300-second run with 200,000-block batches reaches the animated
menu (Play Game, Statistics, Options, Exit Game).

Pass `--dll-seed=IFC22.dll` and mount the entire game directory. The bundled
IFC22 library provides the imported CImmMouse symbols. The game needs both
`DATA.dat` and its three `.red` archives. Use `--no-close` in CLI probes.

```sh
node test/run.js --no-build --wasm=build/wine-assembly.wasm \
  --exe=test/binaries/candidates/reflexive-ricochet-xtreme/game/Ricochet.exe \
  --dll-seed=IFC22.dll '--vfs-include=**/*' --no-close \
  --quiet-api --quiet-blocks --batch-size=200000 \
  --max-batches=100000 --max-seconds=300 --png=/tmp/ricochet-menu.png
```

Repeated EIPs in `0x004e4aXX`/`0x004e51XX` during the Reflexive logo belong
to bitstream/codebook decoding, not a clock wait. `--trace-fs` proves forward
progress through different resources: company logo, fonts, level art, menu
textures. The game builds `c:\data\cache\...` `.frm16`/`.seq16` files as it
loads. At the menu there are 351 generated cache files totaling 15,316,024
bytes; the largest is 616,356 bytes. These are useful local prepared assets,
but are too large in aggregate for the browser's localStorage save mechanism.
Do not classify the splash alone as a hang or introduce a timing workaround.

## Verified interactive gameplay route

Use a controlled CLI session (`--control=8128 --max-seconds=900`) to inspect
the menu and inject input with `node tools/ctl.js -s :8128 ...`. The game
tracks mouse movement separately from button messages: send
`cmd mousemove:X:Y`, then `cmd mousedown:X:Y`, allow several batches, then
`cmd mouseup:X:Y`. A bare synthetic `click` without a preceding mouse move
does not update the game's pointer position and may leave the menu unchanged.

1. Main menu: Play Game at `(445,55)`.
2. Select Player: Anonymous Guest at `(320,234)`.
3. New Game Options: first thumbnail, Round 1-1, at `(75,170)`.
4. Wait for the entrance animation: the station rises, the bricks appear,
   and the round timer starts. This is real animation, not missing assets.
5. During play, `cmd relmousemove:180:0` moves the shield right;
   `cmd relmousemove:-200:0` moves it left. Normal mouse down/up launches
   the ball. DirectInput-only `di-mousedown` was not sufficient to launch.

The 2026-09-29 controlled session reached ball flight, destroyed bricks,
nonzero score, and a later out-of-bounds penalty. In a frozen comparison,
`relmousemove:-200:0` followed by 120 batches moved the shield from about
`x=340` to `x=130`; `relmousemove:220:0` followed by 50 batches moved it back
to about `x=285`. The clock and debris continued advancing. No API traps,
guest patches, runtime fixes, or CPU/timing workarounds were needed.

Evidence retained locally:

- `/private/tmp/ricochet-300.png`: main menu.
- `/private/tmp/ricochet-game.png`: Round 1-1 entrance.
- `/private/tmp/ricochet-gameplay-before.png`: active ball/brick destruction.
- `/private/tmp/ricochet-gameplay-left.png` and `ricochet-gameplay-right.png`:
  shield response to opposite relative mouse inputs.
- `/private/tmp/ricochet-control.log`: control commands and batch numbers.

The tested runtime was compiled once with `node tools/build-compile-wat.js`;
its SHA-256 is
`1a04201bd45329d62ab65513f768fdfd8396f55b443db471a2f7c459406a21b2`.
These results are CLI gameplay acceptance, not a speed measurement.

## Preparing the local cache

The cache remained at 351 files / 15,316,024 bytes after entering and playing
Round 1-1. It can be exported from a live controlled session using the existing
save-bundle API (the controller evaluates host diagnostics, not guest code):

```sh
node tools/ctl.js -s :8128 eval '(()=>{const r=process.mainModule.require.bind(process.mainModule);const b=r("../lib/save-bundle").exportBundle({appId:"ricochet_xtreme",vfs:ctx.vfs,patterns:["c:/data/cache/**/*"]});r("fs").writeFileSync("/private/tmp/ricochet-cache-menu.zip",b);return b.length})()'
node tools/save-bundle.js /private/tmp/ricochet-cache-menu.zip --verify
node tools/save-bundle.js /private/tmp/ricochet-cache-menu.zip \
  --extract=/private/tmp/ricochet-cache-extracted
```

The verified bundle is 15,596,892 bytes, SHA-256
`0502ccc4efe325bd2a5b95b713c7651484132840c5d7d1d77e4dbdde37d6b49c`.
Save patterns require the drive prefix; `Data/Cache/**/*` alone matches no
files. Extraction verifies member SHA-256 values and produces
`vfs/c/data/cache/...`; copy that cache tree into the local fixture's
`game/data/cache/`, preserving its paths, then regenerate the candidate's
browser inventory. These generated local assets are not committed.

The normal save mechanism should persist only small actual settings/profile
files. Anonymous Guest created `c:\ricochet.cfg` (161 bytes, `[Options]`
screen size/color/controller settings); it created no named-player save in
this route. Do not put the 15 MB asset cache into browser localStorage.

## Browser acceptance

2026-09-29: verified the normal `ricochet_xtreme` launcher entry in headless
Chrome with the guest Worker enabled and GPU/WebGL presentation, using the
matching isolated `8f9f66a8` source/artifact and prepared cache. The browser
loaded 358 data files, reached the main menu, accepted Play Game / Anonymous
Guest / Round 1-1, and rendered the complete level. Ordinary browser mouse
movement moved the shield left and right. A held normal left click launched
the ball; subsequent captures show score 3, speed 8, destroyed bricks and
debris. **No `relativeMouse` registry override is needed** for this route.

The driver used `tools/web-input-probe.js --app=ricochet_xtreme --threads
--gpu`, extended only in a temporary diagnostic wrapper to wait until the
blue Play Game lettering appeared before clicking. Fixed early input times
were unreliable on this loaded machine: menu loading and the round entrance
animation both outlasted short waits. Wait for the menu, then wait for the
bricks and running round timer before launching. This is not a performance
measurement; the host load was high throughout.

Browser evidence in `/private/tmp/reflexive-probe/`:

- `ricochet-browser-menu3.png`: menu from the final acceptance run.
- `ricochet-browser-options2.png`: round selection.
- `ricochet-browser-entrance3.png`: complete level and running timer.
- `ricochet-browser-launched3.png`: ball launched, nonzero score and missing bricks.
- `ricochet-browser-left3.png` / `ricochet-browser-right3.png`: opposite mouse
  movement changes the shield's position during active play.
- `ricochet-browser3.log` and `ricochet-browser3-console.log`: input route and
  browser log; no guest API traps or JavaScript runtime failures.
