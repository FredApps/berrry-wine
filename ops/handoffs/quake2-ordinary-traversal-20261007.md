# Quake II ordinary WebGL traversal, 7 October 2026

**Passed the scoped ordinary menu → Easy → forward/reverse/idle route.**
Reviewed world landmarks establish translation; this is one room and one cycle,
not combat, level completion, FPS, audio, or network-play qualification.

Run: `scratch/runs/20261007T213620Z-quake2-ordinary-traversal/result.json`.
Six reviewed screenshots: `startup.png`, `game-menu.png`, `loading-1.png`,
`forward-1.png`, `reverse-1.png`, `idle-final.png`. The `loading-1` filename
predates review: that image is actual textured gameplay with weapon, crosshair,
and health HUD. World was visible by 54 seconds after the Easy-selection key.

Normal browser input was Enter 750 ms on GAME, Enter 750 ms on Easy, W 1000 ms,
then S 1000 ms. Each input required its latest personally reviewed screenshot;
`commands.jsonl` records the sequence and source timestamps. W approached the
large diagonal support until it filled the centre of the view; S restored the
wider room and right wall emblem. The final idle capture retains that geometry.
The conclusion relies on world scale/occlusion and restored landmarks, not
weapon bob or changed-pixel counts. No console command or guest state edit.

## Exact identity and host

- Module SHA-256: `fb1be916c309bf619a9331c8fd46c4319f9051af76b05b236d3c362bb632638f`.
- Built source: `096889e174488a97529b8e73076d3a1e2feb2345`; all 326 served source
  files match that Git object. 399 transferred file pins verified before launch.
- Current registry arguments: `+set vid_ref gl +menu_main`; original 66 fixtures
  hash-verified before transfer and again locally after the run.
- Chrome `151.0.7922.108`, Node `v24.18.1`, temporary `bx_d8nw3e8t`, hostname
  `box-node-b72dc646c0120bf7`; viewport 1280×900, game canvas 640×480.
- Actual guest main Worker and published GPU layer are recorded in every
  screenshot JSON; guest memory 536,870,912 bytes. Menu reports WebGL renderer.
- The sole module GET was fully read, finished, settled, and its served SHA-256
  equals the requested module. This is host serving evidence; client consumption
  is not directly observable. Fresh profile/no-store and instantiated Worker
  support the loaded-route identity.
- Session `2026-10-07T21:36:20.270Z`–`21:41:35.278Z`; 600-second deadline,
  2.9 GB launch headroom, 2 GiB floor, six screenshots totalling 2,450,826 bytes.
  No local browser/build/native game, public service, snapshot, or SSH transport.

The initial preparation waited for the whole Arx worker's exit. Root's explicit
`21:30:04Z Q2 REMOTE GRANT` replaced that coarse gate after Arx's browser release.
Remote preflight independently verified both prior Arx driver/Chrome pairs
59268/59283 and 63420/63435 absent and no Chrome processes before transfer.
The first dependency-location preflight failed before mutation/launch; its
receipt is retained. Existing Puppeteer was then resolved at the Wine root.

## Limits and cleanup

`requests.json` contains 535 mixed host/response records, not 535 unique assets.
Raw errors retain 16 refused **local** `/api/public-data/users/vln-signal-…`
requests. Pinned `lib/vlan-rtc.js:520` identifies the publisher-list API.
The strict fixture host did not serve that unpinned API or bypass its pins.
These were ancillary signaling refusals, not a gameplay or teardown failure;
network play remains unqualified. FPS/audio were not measured.

Chrome exited 0; browser and server closed; zero pending streams. The harness
closed the browser after the reviewed sequence; it did not test Quake's Quit
menu. At `21:42:25Z`, driver72950/Chrome72971 were absent with no Chrome processes
or owned listening sockets. Evidence was copied back and hash-verified before
removing only `/home/user/q2-traversal-20261007`. Arx data is untouched. The box
is retained for queued Arx work, expiry `2026-10-07T22:51:07Z`.

Owner: `codex:q2-traversal-worker`. Findings branch
`findings/q2-traversal-20261007` off origin/main `4091453a` in
`/home/user/wt-q2-findings-20261007`; shared HEAD/index untouched. Root integrates
the scoped docs commit. The historical September gameplay evidence remains
historical; this run closes this row's current ordinary traversal gap only.
