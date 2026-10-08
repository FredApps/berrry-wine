# The Elder Scrolls: Arena (GOG)

## Source and fixture boundary

The local fixture comes from the Internet Archive `gog_collection` item pinned
in `test/candidate-corpus/manifest.json`. Its RAR is 81,068,818 bytes with
SHA-1 `aa8f357433ea5c07a9ebda4c6dd062b53348f57b`; the contained GOG offline
installer is `setup_the_elder_scrolls_arena_1.07_(28043).exe`, 81,068,584
bytes. GOG listed Arena for USD 0.00 when this corpus was verified, but the
package remains proprietary and gitignored. Nothing here grants redistribution
rights for the installer or extracted game.

## Direct installer path

The original PE32 Inno wrapper was executed directly in Wine-Assembly, without
host Wine. It extracted a 1,343,072-byte child and requested this exact command
line:

```text
/SL5="$10001,80468877,192512,C:\setup_the_elder_scrolls_arena_1.07_(28043).exe"
```

Running that child with the original installer mounted at the named `C:` path
found two Wine-Assembly defects:

- Inno called `VirtualQueryEx((HANDLE)-1, 0x00400000, ...)`; Wine-Assembly had
  `VirtualQuery` but no current-process `VirtualQueryEx` wrapper.
- The launcher stages up to 200 command-line bytes at raw WASM address `0x300`.
  That range overlaps the low immutable-string block and changed the bytes at
  `0x36d` from `uxtheme.dll` to part of `/NORESTART`. `LoadLibraryW` therefore
  returned the executable image base for the optional theming DLL, after which
  VCL called a null `IsThemeActive` pointer at installer VA `0x00439550`.

`VirtualQueryEx` now delegates the current-process pseudo handle to
`VirtualQuery` and rejects external handles. Extra command-line staging now
lives in the documented free 256-byte region at `0x07f0a500`. The wide
`uxtheme.dll` check also uses a Boolean non-null predicate; WebAssembly's
`i32.and` is bitwise, so directly ANDing a naturally even UTF-16 pointer with a
successful `1` comparison incorrectly produces zero.

With `--winver=win2k`, the unchanged installer proceeds through the GOG wizard
and extracts its custom UI assets. Full interpreted decompression is extremely
slow: a bounded 300-second run retired 321,772 Win32 API calls and reached the
two slideshow JPEGs, but had not reached the game payload. After proving that
direct path, the existing local `innoextract` build extracted the same package
for the runtime acceptance. This is a throughput workaround, not host Wine.
The ignored extracted tree is about 117 MiB.

## Bundled DOSBox runtime

The package contains the original 32-bit Windows `DOSBOX/DOSBox.exe`, version
0.74-2.1. `test/configs/arena-wine-assembly.conf` deliberately selects
`core=dynamic`, mounts the extracted root as both a writable `C:` drive and a
CD-ROM `D:` drive, then launches `ACD` from `D:` while setting `ARENADATA=C:`.
Launching from `C:` is not equivalent: Arena prints `TES: Arena can only be run
from a CD-ROM drive` and returns to the shell.

The bounded acceptance runs that Windows DOSBox inside Wine-Assembly, retains
`Program: ACD`, and captures a rendered 640x400 game frame. The accepted frame
has at least 50 colors, over 250,000 non-black pixels, and fewer than 5,000
black pixels. The two diagnosed DOS shell/error frames had only 9-10 colors and
about 133,000 black pixels.

```sh
node test/test-arena-dosbox.js
```

## 2026-10-05 local browser registration and ordinary-route preparation

Local-only app `arena_gog` uses the original installed Windows DOSBox and520 regular original files (122,745,861bytes); no payload copy or guest execution was used to prepare the route. Four stale migrated host symlinks are excluded, with exact targets recorded in `lib/arena-gog-source.json`. The original installer and every regular payload file are pinned there. `tools/prepare-arena-gog-assets.js` validates those bytes before writing an ignored521-record manifest; unknown existing generated state is a conflict, never overwritten.

The earlier screenshot-only acceptance does not establish player control. The separate `test/configs/arena-browser-wine-assembly.conf` preserves the documented dynamic50000/surface/sound-disabled configuration and exact ACD arguments. It also restores GOG's original cloud_saves overlay from `__support/app/dosbox_arena_single.conf`. The GOG installation script creates that directory. In a fresh VFS the browser config performs ordinary `if not exist C:\cloud_saves mkdir C:\cloud_saves` after mounting backing C: and BEFORE mounting its overlay. There are no original save templates to seed. D: remains the base payload mounted as CD-ROM, ARENADATA is C:, and ACD launches from D:. The historical snapshot config is unchanged.

Only `c:\cloud_saves\*` persists, with no reset token. Original files, existing host saves and arbitrary conflicting metadata are never replaced. Focused recipe tests exercise original-byte mapping, mkdir/overlay/CD-ROM/ARENADATA/launch order, idempotence, conflicts, no manufactured saves and local-only registration. Existing browser persistence attaches after asset loading; the Ultima focused actual-VFS restore test covers that mechanism separately. Runtime save/reload remains untested for Arena.

Ordinary route source: bundled Manual.pdf offers Generate (ten questions) or Select (18-class list); use visible Select, choose a normal class, name/homeland/stats/portrait through actual prompts. The manual describes holding left mouse on an arrow-shaped region of the viewport to move in that direction. After actual dungeon/HUD readiness, capture a short ordinary forward movement, reverse and idle against visible fixed geometry; do not qualify intro/creator/rich pixels. No hidden state, forced stats or assumed old coordinates.

Prepared600sec command and exact pins: scratch/new-games-pipeline-20261005/arena/READY.md. Source94d18605/module2e2fd8d1 is reused read-only, with only explicit local registration overlay. No browser or gameplay result yet; no audio/FPS claim.

## 2026-10-05 first browser setup failure and directory correction

Attempt81848 (source94d18605/module2e2fd8d1) visibly reported `Directory C:\cloud_saves doesn't exist.` The D: CD-ROM mount succeeded and ACD proceeded to its intro, so this was an original-overlay setup failure, not a guest crash. No creator/gameplay input. Stopped immediately at the declared gate; clean exit0/browser+serverclosed19:28:34.592Z/errors[]/deadlinefalse, process clear. Published28-artifact closure: scratch/runs/20261005-arena-save-directory-setup.

The proposed DOS `mkdir` did not faithfully reproduce the Windows installer. Bundled shell_cmds.cpp343–353 delegates to DOS_MakeDir; dos_files.cpp217–226 calls DOS_MakeName, whose no-extension branch at177 truncates each component to8characters. localDrive::MakeDir then passes the expanded DOS name to Windows CRT mkdir. MOUNT takes the original host directory path, so the two names are not interchangeable. Exact live shortened directory was not captured; this source proof explains why long host directory creation must occur on the Windows side as the original GOG script specifies.

Corrected local registration uses the existing browser `app.mounts` callback to create the exact empty VFS `c:\cloud_saves` before loading assets/starting the guest. Existing directory/saves are retained; an existing file or failed creation rejects launch. No placeholder, saved character, guest-memory mutation, new engine API or source override is introduced. The wrong DOS mkdir line was removed. Actual-VirtualFS tests execute the real registry callback and cover creation, repeated mount, unchanged existing save/file bytes, failed creation, invalid postcondition and current shell mount-before-files ordering. The recipe upgrades only exact pinned old generated config/manifest hashes, retaining before-image backups; unknown conflicts still fail. Historical attempt1 and original snapshot config remain unchanged.

Fresh ordinary route readiness is scratch/new-games-pipeline-20261005/arena/DIRECTORY-READY.md, config7af55396/manifest605f11c0. No second runtime yet; creator/dungeon/control remain unqualified.

## 2026-10-05 corrected overlay accepted; creator route bounded

Session54301 source94d18605/module2e2fd8d1 with original-directory recipe0cc092b7 visibly reports overlay mounted. Ordinary Start New Game, Select, Barbarian, name Avatar, male, Skyrim and Yes reach race/class guidance. Final screenshot says body and mind must be strong and hardy for a Barbarian; no stats/dungeon/control yet. Original600sec guard stopped20:04:03.645Z, no originalError/cleanup errors; Chrome exit0/no signal andclose20:04:03.748Z,1357stderr bytes retained/0dropped. Processes clear. This is bounded route progress, not guest failure or gameplay.

Immutable result/source/served/build/inputs/screenshots/process and58hashes: scratch/runs/20261005-arena-corrected-overlay-creator. Next: source-only guarded replay of actually observed static menu/creator prefix, then personally review remaining stats/portrait/dungeon. No unseen input batching or synthetic saves. FPS obligation remains open.

## 2026-10-05 ordinary creator reaches stat allocation

Session34230 retained source94d18605/module2e2fd8d1. One-shot prefix matched menu but stopped safely at Uriel Septim story (prior reference was Jagar Tharn);37 mismatch frames retained, no rearm. Normal reviewed manual creator reached Barbarian/avatar/male/Skyrim stat allocation and portrait. BONUS PTS10 remained after ten clicks on STR text; a proposed plus-arrow command arrived after the original600sec guard and never executed. No dungeon/gameplay/FPS. Cleanup20:38:14.795Z clean; Chrome exit0/close20:38:14.856Z. Result and127hashes: scratch/runs/20261005-arena-creator-stats. Next route must use actual stat increment control and verify displayed bonus decrement, then Done/portrait and actual dungeon movement. Preserve the prefix mismatch rather than relaxing it implicitly.

## Original controls and next bounded route

Original local files remain under `test/binaries/candidates/gog-free-elder-scrolls-arena/installed/`. PDF page numbers here are one-based file pages: `Manual.pdf` page5 and `Player Guide.pdf` page18 describe distributing Bonus points, then clicking Done. Neither passage specifies an exact increment hit target. The small arrow beside STR in the actual creator screenshot is an **unproven** next control: one ordinary click near the reviewed arrow, then inspect both bonus decrement and matching stat increment before repeating. Ten unchanged STR-text clicks are not allocation proof.

`Player Guide.pdf` page18 also describes clicking the portrait head to cycle faces and Done to accept. `Manual.pdf` page3 and `Player Guide.pdf` pages39/44 describe holding the left mouse button with an arrow cursor to move in its indicated direction; cursor distance from center controls speed. Original `README.TXT` line7 documents Ctrl+Left/Right sliding. Actual dungeon/HUD readiness must precede short movement, reversal and idle comparison.

Original `README.TXT` lines12–15 document F4 toggling message pixellation. This is an optional ordinary game control, not a measured speedup or an emulator timing change. No F4 effect has yet been observed in these runs. Exact document hashes, fresh output command and unchanged helper78ce4ae0/module2e2 pins are in `scratch/new-games-pipeline-20261005/arena/CONTINUATION-STATS-READY.json`. The next ordinary attempt will not invoke the failed static prefix; story transitions require personal review and normal input. No runtime or gameplay qualification follows from this source preparation.

## 2026-10-05 fresh creator to ordinary dungeon controls

Session31636 used exact source94d18605/module2e2fd8d1 and ordinary local recipe, no observer/prefix/state injection. Barbarian/avatar/male Khajiit stats were STR48/BONUS12; one click(64,98) visibly produced49/11. Subsequent normal clicks reached60/0 (one missed click preserved and corrected only after observing remaining1). Done, Save Stats, default portrait Done and ordinary Escape from Ria reached real stone dungeon with compass/avatar HUD. Right600ms visibly changed perspective, Left600ms returned near original alignment, idle1500ms stayed stable. Down800ms/Up800ms also changed wall distance slightly; finalidle1200ms stable. Root independently reviewed dungeon/right. No combat/escape/full campaign/audio/FPS or reload-persistence claim. F4 was sent once during story, with no effect/speed claim.

Immutable result, source/served/build/inputs and107hashes: scratch/runs/20261005-arena-dungeon-controls. Ordinary quit closed browser/server21:12:58.605Z before900sec cap, errors[], Chromeexit0/close.667Z; process absent. Generic gameplay+FPS task remains review, its measurement obligation open.
