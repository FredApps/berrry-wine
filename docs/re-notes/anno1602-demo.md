# Anno 1602 demo (Max Design / Sunflowers, 1998)

`lib/apps.js` id **`anno1602_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/Anno1602-demo-SW/extracted/1602.exe` with the
app-local `Maxnet.dll`, `Maxsound.dll` and `Language.dll` (`smackw32.dll`
auto-loads beside the exe; `msvcrt.dll` comes from the shared DLL set).

The download `Anno1602Demo-SWonly.exe` is a **RAR** self-extractor whose
contents are the game tree itself (470 entries, 37 MB). 7-Zip lists it but
has no codec for this RAR version ("Unsupported Method"); it was extracted with
`node-unrar-js` (`createExtractorFromFile`). Manifest:
`node tools/gen-win98-games-a-d-manifests.js`. No registry or CD check.

Software DirectDraw at 800x600 (the CLI canvas is 640x480; `ctl` clicks are in
capture coordinates and go through the presentation transform). Input is plain
window messages. It runs clean: no unimplemented API on the route below.

## Route to gameplay (2026-10-06, ~140k batches at the default clock)

```sh
node test/run.js --app=anno1602_demo --quiet-api --control=8187 --frozen \
  --max-seconds=600 --max-batches=100000000 | grep -a -v 'EIP='
```

1. step 15000 -> main menu.
2. click "A New Country" (365,268) -> assignment text; click Start Game (165,389).
3. step 30000 -> "Enter your name" hall; Enter accepts "Anonymous"; click the red
   flag (135,260); step 40000 -> sea map, the player's ship "Laguna Verde" selected.
4. Left-click the ship (258,247), then left-click open water (120,120): it sails
   there. **Right-click is back/cancel** (it deselects), not "move".

Evidence: `scratch/runs/20261006T1340Z-anno1602_demo-gameplay-w6`.
