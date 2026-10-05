# Historical screenshot coverage recovery

Live box verified 2026-10-05 UTC: **209 / 243 corpus entries have screenshots**, up from **128 / 243**. Added coverage for **81 entries**; **34 remain without a linked capture**. The live reader reports no missing screenshot artifacts.

The missing coverage was largely an importer problem:

- The dashboard includes registry-only apps, but the importer recognized only candidate-manifest IDs.
- Directory scanning omitted `screenshots/` and `test/output/`.
- Global image deduplication suppressed distinct app variants with identical captures.
- Some captures had nonstandard filenames or lived in old session temporary directories.

Scanned 1,023 local Codex/Claude session logs and inventoried 42,138 image paths, including missing historical references. This is a path inventory, not a count of surviving images. Recovered 125 automatic historical bundles after excluding three uniform frames, nine explicitly reviewed associations, and four additional variant bundles. Images and provenance were copied to the box's `scratch/runs/` without overwriting existing runs. Source files were retained. The inspected associations include Civilization II Win16, Caesar III, Hitman, NFS II SE, Explorer, and Windows mixer/IP utilities.

All imports remain historical/unreviewed as compatibility results. Visible gameplay in an old image does not certify the current build, input, FPS, or release readiness. Reference-emulator/comparison captures, icons, tiny crops, and near-uniform frames are excluded from automatic publication. The nine explicit mappings and hashes are in `ops/historical-visuals.json`.

Remaining entries:

```text
dungeons-of-dredmor-release    dungeons-of-dredmor
generally-track-editor        simgolf-demo-installer
putty                        virtualdub
winboard-installer            7zip-file-manager
povray-installer              dependency-walker
tetrinet                     civilization-2-mge-win32
far-manager-170               winrar-310
unreal-tournament-demo-348    unreal-tournament-2004-demo
unreal-tournament-3-demo-installer
black_white_2_demo            darkstone_demo
dx_ddex1                     dx_donuts
morrowind                    simcity2000_net
simcity2000_net_server        welcome98
winamp_mod                   write
gog-free-beneath-a-steel-sky
gog-free-flight-of-the-amazon-queen
gog-free-lure-of-the-temptress
gog-free-shadow-warrior-classic
gog-free-elder-scrolls-arena
gog-free-elder-scrolls-daggerfall
gog-free-ultima-iv
```

For these entries this audit did not recover a usable, safely associated image. Some sources are absent; others are blank or small crops. This does not prove that no capture exists anywhere. Next work is targeted recovery or fresh capture, not another blanket migration of already-linked image files.

Validation: 27 ops tests passed, including registry-only and ambiguous image-association regressions; live API coverage verified after transfer. Local scan/import reports remain in `scratch/ops-backfill/`.
