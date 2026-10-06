# Colin McRae Rally demo (Codemasters, 1998)

`lib/apps.js` id **`colin_mcrae_rally_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/ColinMcrae-Rally1-Demo/SETUP/GAME.EXE` with
`QMIXER.DLL` (QSound). Direct3D; runs on the software rasterizer headless.
The CD demo runs from its `SETUP\` directory; `SETUPDIR\` and the cabs are the
installer and are not mounted. Manifest: `node tools/gen-win98-games-a-d-manifests.js`.

## Data path: CDPath, not the working directory

The game builds every data path from `HKLM\SOFTWARE\Codemasters\Rally\1.00`
`CDPath` (+ `\game\...`), which its setup writes, falling back to the
compiled-in `"Q:\Game"` (four copies in `.data`, e.g. `0x52bcf0`). With no
`Q:` the VFS answered `Q:\Game\language\english.txt` and
`Q:\Game\setrep\language\english.txt` by **basename**, with the first
`english.txt` it had (`c:\demo\english.txt`, 0x13f4 bytes). Every in-game string
table was therefore the DEMO one and indexes landed on the wrong strings:
"NETWORK (HOST): CORRIGIN", "PLAYER 1" as "E 1", labels that looked clipped.
`--trace-fs` shows it directly: the `[FS] ReadFile ... path=` names the file
actually served. The registry entry seeds `CDPath=C:` and `Language=ENGLISH`
(other values the key holds: `Hardware`).

## Route

```sh
node test/run.js --app=colin_mcrae_rally_demo --quiet-api --batch-size=50000 --max-batches=4460 \
  --input='600:keydown:13,604:keyup:13,2750:keydown:39,2754:keyup:39,2770:keydown:13,2774:keyup:13,4000:keydown:38,4400:keyup:38' \
  --no-close --png=/tmp/cmr.png
```

Options -> OK (Enter) -> loading -> service-area setup (~2700): the bottom bar
is VIEW STAGES / CONTINUE / RESET (arrows select); CONTINUE loads Australia
stage 2 (Corrigin, ~3000-3900) and the stage clock starts. Up accelerates,
Left/Right steer; keyboard is DirectInput.

## Leads

- A basename fallback for a path on a drive that does not exist is how this
  stayed silent; a game that probes a CD drive letter can be handed an
  unrelated file of the same name.
- QMixer audio and the browser are not checked.
