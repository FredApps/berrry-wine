# Warcraft III original Prologue: runtime review request

Worker `codex:warcraft3-prologue`, isolated branch from explicit coordinator
`058b82eba`, previous Alien Shooter `b8410d5e4` preserved. No shared index,
build, native runtime or browser used during preparation.

Read CLAUDE, ORCHESTRATOR priorities, current corpus table, and Warcraft notes.
September 28 CLI gameplay is retained: Thrall selected, 500/500, move orders
obeyed. Batch numbers are historical CLI checkpoints, never browser timers.
Accepted reference `f62ab3c9` contains `579ee802` SetPixelFormat idempotence and
`604f0fd14` sparse-page GL reads/per-thread decoder fixes; no redo or rebuild.
Current main is the lane documentation base, not the tested module identity.

Prepared closure: `scratch/runs/20261008T0135Z-warcraft3-prologue-ready` in the
shared repository. Baseline archive SHA
`d5b52fc3829fbbc8e3ec2f085bdd55b074eda4bc55a7da6152577683f1b656c5`, reference
`f62ab3c9f1223ab47cf623470f6343d508257878`, module
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`.
All 530 baseline source/module/media files hardlinked from the authenticated
immutable original closure; 12 original registered Warcraft media files also
hardlinked (including EXE, Game.dll, Storm.dll, MPQ). No fixture copies or
missing registered paths. Exact 12 hashes are in prepared-identity.json.
542 SHA pins + 542 HTTP HEAD + 8 full GET hashes + range/404/drain PASS.
Only private localhost HTTP preflight ran. Original fixture bytes unchanged.

Harness adapted lifecycle/serving from accepted ordinary input harness.
Explicit OpenGL proof uses `api: gl` on host and owning render Worker endpoints;
that Worker URL remains d3d-render-worker.js because it multiplexes GL, its GL
implementation module is gl-render-worker.js. D3D neutral endpoints fail.
Reviewed latest screenshot receipt gates every input; ABC, Space/Escape,
left/right clicks are ordinary Puppeteer trusted inputs. DOM input receipts
and actual canvas geometry are retained. No guest writes, menu copies or
batch-clock forcing. Inputs capped 64, screenshots 30/60 MiB, keys/clicks
bounded and released on failure. One aggregate browser deadline 600 seconds.

Proposed maximum 240 transfer + 600 browser + 90 cleanup, plus TTL margin.
Within browser budget: 90 startup/menu, 90 profile/Create/Select, 240 campaign
and map load, 60 chapter/cinematic, 60 selection/right-click movement, 60 slack.
Each transition is decided from actual reviewed visible state. Historical
640x480 coordinates are reference only, converted using actual DOM geometry:
Single Player 546,113; ABC/Create 203,173; row 130,225; Select 203,314;
Campaign 546,149; Prologue bullet 433,156; chapter Space; cinematic Escape;
Thrall 230,300; right-click 385,125 then 520,260. No blind timed sequence.
If no responsive route, report last visible state and actual ordinary input
receipts; FPS/audio remain unknown and no speculative engine repair.

Queue strictly AFTER Tiberian actual cleanup/explicit release, root source +
preflight + budget review, then own PID/socket/TTL/pin/floor checks. Current
bx_qms4q3z7 expires 01:53:20; a late release may require root-coordinated fresh
noenv temporary boat. One browser globally; no transfer until release.
