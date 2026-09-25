# SimCity 2000 Network Edition (demo) — 2KCLIENT.EXE / 2KSERVER.EXE

Apps: `simcity2000_net` (client), `simcity2000_net_server`. Files under
`test/binaries/candidates/simcity-2000-network-edition-demo/installed/`.
Both images load at their preferred base `0x400000`, so VA == runtime address.

## Headless three-seat route (server + two clients)

```sh
C="--no-build --tick-ms-per-batch=1 --app=simcity2000_net --max-batches=100000000 \
   --no-close --stuck-after=100000000 --quiet-api --max-seconds=220"
node tools/vlan-pair.js --log-dir=$T --stagger-ms=12000 \
  -- --no-build --app=simcity2000_net_server --batch-size=100000 --max-batches=1000000 \
     --max-seconds=250 --no-close --stuck-after=100000000 --quiet-api \
     --input=100:post-cmd:57600,1400:click:180:313,2900:click:231:288 \
  -- ${=C} --input=<client A list> -- ${=C} --input=<client B list>
```

Client join list (A; B adds `31200:dlg-set-edit:1015:Deputy`):
`50:click:316:276,7500:click:200:120,15000:click:315:256,22500:click:265:343,31000:dlg-set-edit:1014:10.0.0.1,31500:click:408:232`,
plus `dlg-cmd:1`/`dlg-cmd:2` every **3000** batches from 150000 to dismiss the
join notices and the January budget dialog (every 15000 is too sparse — a
budget dialog then swallows the input that follows it). The city is live
around batch ~290000; ~1950 batches/s on the dev box, so budget
`--max-seconds` accordingly (150 s ends at ~290000, too early).

The first client is "Mayor", the second "Deputy". Chat (post-cmd 32789)
propagates and paints on the other client since 294a49e2.

## UI is app-drawn — no windows, no WM_COMMAND

The tool palettes, their flyouts and the top toolbar are drawn by the app
itself onto its own surfaces; opening a flyout creates **no window** (only a
`SetCapture` on the frame). So `dump-windows`/`post-cmd` cannot reach them,
and flyout pixels left in the unpainted area below the view are stale, not
the live menu (the headless `png` while the button is held never shows the
flyout).

Selecting a flyout item = press on the palette button, drag, release on the
item. Route the drag through x=100 so it does not cross the lower palette
(x 130–225), which opens that palette's flyout on hover instead. The
status line at (7,123) names the selected tool — read it to confirm.

| Where (640x480, city not maximized) | What |
|---|---|
| click 18,175 | Demolish (bulldozer button default) |
| drag 18,175 → 100,195 | Level ($25) |
| click / drag 18,200 → 100,200 | Water ($100) |
| drag 18,200 → 100,224 | Trees ($3) |
| lower palette 140/165/190/213,193 | power / police / school / parks; up-arrows at y=176 open flyouts above (Oil/Hydro/Coal; Marina/Stadium/Zoo/Large/Small Park) |
| top toolbar 262,56 | land-ownership **layer** toggle (wireframe map); 285/310/333/356 are further layer toggles |

## Buy Land — NOT found yet

`"Buy Land (P)"` at `0x4c76cc` is a network protocol command name (the `(P)`
/ `(H)` table at `0x4c7c74`). `"Buy Land"`/`"Sell Land"` at `0x4c8dec`/`0x4c8de0`
are tool names (tool numbers 0x0c / 0x0d, table built at `0x41c3e2`), grouped
with Demolish/Dezone/Lower/Raise/Level. `buyland.bmp`/`selland.bmp` are loaded
at `0x42c23d` keyed 1013 / 1014 — bitmap keys for app-drawn buttons, **not**
control or command IDs (no dialog or message map uses 1013).

Water on land the player does not own does nothing — no cost, no error. The
`"You don't own this land"` text (`0x4cd430`, used at `0x4403c5` with caption
"Place Error") never fired in any attempt. Drags to bulldozer-flyout rows
123/147/171/292/316 and clicks in the ownership layer bought nothing, so
where Buy Land lives is still open; the next thing to read is who dispatches
tool 0x0c (the handler behind the `0x41c3e2` table), not more screen probing.

## Known render oddity

The city view paints only rows ~44–205 of the MDI client; everything below is
black and never repainted (so stale flyout pixels persist there).
