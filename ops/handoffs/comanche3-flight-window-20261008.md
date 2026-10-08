# Original Comanche 3: cockpit and player-controlled flight qualified

Sole worker NEW-GAME-COMANCHE3-DEMO-20261007; no subagents. Clean isolated
`findings/comanche3-flight-window-20261008`, explicit source base
`4280b855d` (integrated disabled-detector guard). Prior branches and the shared
HEAD/index were preserved. Root integrates/pushes the two documentation paths.
No runtime source, performance variant, catalog or deployment change.

Self-contained evidence: shared
`scratch/runs/20261008T1012Z-comanche3-flight-window/`. The evidence index pins
artifacts; `result.json` is published last. All runtime images were inspected.

## Acceptance result and route

A single original installed C3 launch on the actual dashboard page and browser
input wiring reaches the cockpit and ordinary player-controlled flight.
The localhost catalog/file fixture is private; this does not qualify production
catalog, authentication, distribution or deployment. All eleven installed
originals come from the preserved0551 run; C3.EXE SHA
`9d561246e9a5ac39ddb40949949373c9d4d5eeb6f99d67e64dc86df8aa0dfa5d`,
RESOURCE.RES SHA
`6d5fcf59243d3de6cc615a4337b867d56c9efc0d265cf9507183bd113b709676`.

Ordinary public `keyboard.down/up`: Escape skips the intro, two Down requests
select Argon, then five Enter transitions follow reviewed ready screens:
Argon → Gallant Venture → Haystack → briefing → map → loading. No additional
Enter or other input occurs during loading. No guest registers, RAM, code,
instructions, clock or BIOS state are forced; no transition function is called.

The reviewed original reference card identifies6=60% collective, E=engine
start/stop,0=100% collective, arrows=cyclic. After reviewing the cockpit, these
normal keys followed by forward Up and Right produce these visible states:

| Capture under `retrieved/original/` | Heading | ALT | SPEED | TORQUE | Observation |
| --- | --- | --- | --- | --- | --- |
| `canvas-cockpit-before.png` | 243 | 2 | 0 | 1 | Ground/start-point cockpit; dish, buildings and windsock visible |
| `canvas-collective60.png` | 243 | 2 | 0 | 3 | Engine panel changes; ground state alone is not flight |
| `canvas-engine-start.png` | 243 | 2 | 0 | 5 | Normal engine control; engine panel changes |
| `canvas-collective100.png` | 243 | 2 | 0 | 29 | Torque/engine bars rise; still ground |
| `canvas-forward-after.png` | 244 | 3 | 0 | 58 | Initial ascent; first Up helper had timeout/release correction below |
| `canvas-forward-flight.png` | 244 | 10 | 5 | 72 | Airborne forward movement after completed30second Up; same landmarks shift |
| `canvas-turn-right.png` | 250 | 41 | 17 | 96 | Completed30second Right; banked terrain, heading change and shifted landmarks |
| `screen-001-final.png` | 267 | 95 | 13 | 120 | Continued airborne scene after release, captured at ordinary Stop |

The forward/turn captures are substantive gameplay, not loading art or a view
selector alone. Before/after landmark continuity, changed altitude/speed,
directed bank and heading establish the scoped cockpit/flight/input result.
They do not establish mission completion, combat, save behavior, audio or FPS.
Audio was disabled; FPS is unknown and no performance claim is made.

## Longer measurement and original progress

Before launch, `bounds.json` fixes11:24:00UTC, maximum4200wall/600guest seconds,
with30seconds reserved for Stop. This new user-authorized measurement uses the
prior123–140guest/1800wall rate (~0.074guest/wall), sizing about300guest seconds
plus flight. It is not a reset of a prior deadline or a second full run.
Start10:14:21.590, Stop11:00:35.862:2774.272wall/231.4958232guest seconds,
2314958232dispatches; deliberate early Stop after acceptance, guest not exited,
held0, host stopped, Chrome0. One actual launch; no deadline reset.

Sparse pure-JS observations preserve all exported getters, read physical/page
translation without VM resolver helpers, and use bounded code/stack/data reads.
No onEntry/profile hook, native work or44MB snapshot. The detailed phase
monitor records every50seconds after10:26:31; the primary browser also records
loader/file progress roughly every60seconds. Earlier ready-screen checks and
phase observations are sparse; one10:28:11 sample is outside the original image
and is excluded from original-code/phase claims. No exact stopped state occurs.

Recorded milestones authenticate the known advancing initialization:
- Original LZW caller and changing output coordinates; cache grows beyond5MB.
- `cb317` → `2f424` initialization, then `cb31c` → `67907` → `2dd58`
  mission blend at10:42:22,146.85guest seconds.
- Later return `67947` under `cb31c` at10:43:12 confirms progress past that
  palette call; later `cb33a` asset work expands the cache to7,643,136bytes.
-10:49:02 original transition tick wait returns to `cb3e7`;
  tick difference31 is read without forcing.
-10:49:52 rendering call returns to `cb45c`, within the original mission
  loop following `cb403`; the reviewed cockpit follows, then controlled flight.

Original call bytes validate sampled possible stack return addresses, not a
whole executed trace. Five code spans per image-context sample match the
preserved decoded original. Raw32-bit registers are retained separately from
the narrow `getAll` view. Table sample addresses in raw observations are not
used as an independently authenticated table-content claim.

Actual Chrome151.0.7922.108, x86-64, tailcall/CPU386, paced10MIPS, JIT off,
sound off, stuckLimit0; only normal afterSlice hook. Actual CPU SHA
`91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf`.
All44 source/font closure pins match the reviewed prior current bundle;
actual served bundle SHA
`53a1d9f72525bfbefcfa1da9d4049723c4e03d6fca88b5f6a55b3f5e2a0936c7`.
The primary viewport is1100×900; all secondary Puppeteer connections use
`defaultViewport:null`, preserving it. Screenshots cover the whole canvas.

## Handling, cleanup and integration

Two harness issues before launch are retained in `handling-notes.json`: the
reused put helper needed its lexical remote binding, and an initial local
command confused operate.js with remote-action.js. Neither launched a guest.
The first requested30second Up helper hit Boat's default30second command cap
at10:55:01 before keyup. Explicit ordinary `keyboard.up` at10:55:44.005 cleared
held state; this hold was roughly73seconds, not30. Only the host command cap
was corrected to55seconds. Subsequent30second Up/Right finish normally with
keyup;11:24 acceptance deadline never changes. Acceptance records held0,
pressed0 and empty keyboard queue. No generic source defect was demonstrated.
At sealing, the new local operate.js input snapshot was found hardlinked to
the corrected local harness helper. The remote transferred pin stayed unchanged.
The own unsealed snapshot was detached and restored from SHA-verified retrieval;
prior sealed artifacts are unchanged. Git author identity was absent, so the
commit uses command-local identity from the prior worker, with no config edit.

Fresh no-env `bx_jan4gb4k`, root owns lifecycle, expiry11:45:52.236UTC covering
transfer+runtime+cleanup+15minute margin. Transfer117.791seconds (<240).
Retrieved93files/8,107,703bytes with all SHA checks before prefix removal.
Independent13owned PIDs absent, no Chrome, exact baseline sockets, all22
transfer pins unchanged. Prefix removed11:00:39.940,4.078seconds after terminal
(<90); retrieval/cleanup helper itself3.623seconds. Source and media snapshots
use read-only hardlinks; no runtime source was edited or built. Disk remains
above2GiB. Local phase monitor terminated normally by owned SIGTERM after
acceptance; board watcher is released at final EXIT. Remote tools outside the
prefix remain for root; no remote owned jobs/prefix remain. Root was notified
with explicit RELEASE at11:01:40 for the serialized next runtime lane.

Root review: inspect the before/forward/right/final images and their guest
counter/input receipts, source identity, phase review and cleanup receipts;
integrate only this handoff and `docs/re-notes/comanche3-demo.md`. No further
Comanche run is needed for this scoped flight goal. Production publication,
mission/combat/audio/FPS qualification remain separate work.
