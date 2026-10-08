# Warcraft III original Prologue: scoped browser handoff

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
640x480 coordinates are reference only; runtime targets must use reviewed actual screenshot pixels (the GPU backing canvas can report a zero DOM rectangle):
Single Player 546,113; ABC/Create 203,173; row 130,225; Select 203,314;
Campaign 546,149; Prologue bullet 433,156; chapter Space; cinematic Escape;
Thrall 230,300; right-click 385,125 then 520,260. No blind timed sequence.
If no responsive route, report last visible state and actual ordinary input
receipts; FPS/audio remain unknown and no speculative engine repair.

Queue strictly AFTER Tiberian actual cleanup/explicit release, root source +
preflight + budget review, then own PID/socket/TTL/pin/floor checks. Current
bx_qms4q3z7 expires 01:53:20; a late release may require root-coordinated fresh
noenv temporary boat. One browser globally; no transfer until release.


Runtime `20261008T0134Z-warcraft3-prologue-runtime` now completed. Root reviewed
`b17bb614d` source/preflight/contracts and granted 240/600/90 at 01:33:13.
Tiberian released at 01:31:26; independent 01:33:41 check confirmed its
34662/34674 PIDs absent, no Chrome, exact baseline sockets, 49.6 GB free,
Puppeteer/display available, expiry 01:53:20 sufficient. Transfer began
01:34:02; remote 542-pin/HTTP preflight passed 01:35:16, before Chrome.
Browser 54483 / Chrome 54505 launched at 01:35:38, original deadline 01:45:38.

Actual visible route: main menu -> Single Player Profiles -> typed A then B
then C, each visibly rendered -> Create -> highlighted ABC profile -> Select
-> Campaign screen, with Prologue: Exodus of the Horde visible. Fourteen
reviewed screenshots retain each boundary, with live host AND owning OpenGL
WebGL proof. Every scene reports Pointer Lock false. Historical CLI positions
were not blindly replayed: actual screenshot targets were main Single Player
594,327; Create 228,391; Select 226,542; Campaign 593,365. The GPU backing canvas
returned a zero bounding rectangle; screenshots, not that rectangle, established
actual target pixels. DOM key/button events are trusted; host DOWN/UP and
WM_CHAR messages are retained. Document-level mouseup observer did not retain
UP, but original host 0x202 logs and driver release sequence did. Do not claim
an owning guest input-consumption trace from host logs.

The initial 750 ms Single Player click remained at a highlighted main menu;
a later five-second click reached Profiles, consistent with historical
multi-second hold guidance. Initial Create capture remained at a highlighted
button; a later click produced ABC and enabled Select. Subsequent Select and
Campaign used reviewed separate hover before five-second DOWN/UP. These are
observed sequences, not a proved engine cause. ABC typing advances beyond the
October 3 profile-stall observation; no engine fix was made.

The original 600-second budget expired after Campaign navigation. No Prologue
bullet input, map load, chapter card, cinematic skip or Thrall movement was
executed. This is fresh ordinary menu/profile/campaign navigation, not fresh
Prologue gameplay. September 28 controlled gameplay remains historical; fresh
FPS/audio remain unknown. No native/build/benchmark/optimization was run.
Next action: one separately queued ordinary route on the same authenticated
closure, using reviewed hover then multi-second clicks from the start, with
most of its <=600 seconds reserved for Prologue map load and controls. Check
actual state before bullet/Space/Escape/Thrall/right-click. No speculative fix.

Actual cleanup at 01:45:38.601 has reason `600s deadline`, Chrome terminal 0,
streams 0. A queued ordinary quit did not execute before the timer. At
01:46:23 independent PIDs 54483/54505 absent, no Chrome, exact original sockets,
all 542 pins unchanged, free 49,318,854,656 bytes. All 34 actual attempt files
(including fourteen screenshot/state pairs) plus driver log were downloaded
and hash checked. Prefix removed at 01:46:29.223, within 90 seconds. Root owns
bx_qms4q3z7/Puppeteer lifecycle; worker released the remote slot and did not
delete the adopted boat. Three strict shell HTTP refusals are retained:
api/auth/user, test/binaries/tlbs/stdole2.tlb, and its .part000 probe. They are
not established gameplay failures. 354 actual served full/range hashes match,
including the actual full module SHA 4dc5ac2c; zero partial reads or drift.

Local floor limitation: a transient sample during transfer showed
1,933,475,840 bytes (below 2 GiB), later recovered to 2,319,306,752 and above.
Root was notified; no extra archive/fixture copies were allocated during
transfer and root subsequently removed only reproducible cache. The claimed
local floor was therefore not continuously satisfied. Final free space is
recorded separately. No evidence or original media was removed. An earlier
unpublished duplicate preparation directory was removed before runtime.
One cleanup retrieval helper initially failed on JavaScript newline quoting;
no remote mutation occurred, correction completed all cleanup within budget.
