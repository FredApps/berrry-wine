# EXE-FAILURE-TRIAGE

Read-only triage by `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`,2026-10-02.
No game/test/build/process/remote job launched; no source, ledger or historical
capture import changed. Evidence is under `scratch/exe-failure-triage-20261002/`.
`run-inventory.json` records167 result paths, hashes, candidates, routes,
commands, summaries and builds:5 failed,1 harness-error,30 passed,131 unknown.
No result declares timeout. Unknown/imported/blank captures are not counted as
application failures. Inventory reflects the files present at inspection;
ops-dashboard's ongoing historical recovery owns later additions/associations.

## Priority1 — existing EXE-ZUMA-STARTUP

Candidate `reflexive-zuma-deluxe`, app `zuma_deluxe`. Historical startup error
is real but not current-build evidence. Reviewed imported screenshot displays
“Unable to load function: QueueUserAPC (KERNEL32.dll)”; copied output.log records
that MessageBox then an EIP-zero call at batch10. Module hash is unknown.
Evidence: `scratch/runs/import-20260929T205923255Z-reflexive-zuma-deluxe/`.
Its provenance pins original September29 capture request and source image hash
905d040e78fefe13056f9c78dccc792e37f43f93df8c50b820e8cea4f1e7dba9.
Do not overwrite its historical/unreviewed metadata based on this review.

Fixture is the documented local unwrapped Reflexive Zuma tree, not a new
download. Current `game/Zuma.exe` SHA256:
`60bf0df7695914e4f8238b5c99f665b8484d3c0dea9378389f95244c9712446c`.
This matches `docs/re-notes/reflexive.md`; the manifest links wrapper provenance
to banteg/reflexive615d946772e344e54ee3a7444d5f0010b68b79ac. BASS and all companion
assets must remain mounted via the registered app manifest. No extraction,
installation or asset rewrite is needed.

Current support is substantive, not a success stub:

- `09a0-handlers-base.wat` dispatches QueueUserAPC to `host_queue_user_apc`,
  returns failure and LastError on error, and pops its three-argument frame.
- `thread-manager.js` resolves target/pseudo/duplicate handles, rejects invalid
  and exited threads, queues callback/data FIFO, and wakes waiters. Termination
  discards queued APCs. `host.js` and `test/run.js` wire these real methods;
  the bare host-import fallback returns ERROR_INVALID_HANDLE6.
- `test-thread-manager.js` covers queue ownership/FIFO/suspension/termination;
  `test-worker-sparse-thread-stack.js` covers actual Worker startup APC and
  alertable ABI behavior. `test-process-boot-yields.js` and current loader code
  cover the nested DllMain/LoadLibrary continuation needed by bundled BASS.
  These tests were inspected, not rerun here.
- Docs and candidate notes already report progress beyond8197 batches after
  those fixes, but only into loading. That does not establish a menu or gameplay.
  Relevant implementation remains among shared dirty hunks; this review does
  not assign it a commit or erase its provenance.

Current canonical module is1654353 bytes, SHA256
`c474288de1a738d5fa4835d2057c73b563a5d20909251e7e50982f19677e287c`.
Its bytes contain the queue_user_apc import spelling; that is only static
evidence, not proof of correct dispatch/delivery. Current source/module
equivalence is unproven, especially after recent REP edits.
`zuma-preflight-identity.json` captures source/host/module/fixture hashes.

**Ready recipe for a CPU grant:** one no-build CLI run. At grant time freeze
the actual module and host/CLI dependency closure into a unique evidence tree;
hash before/after and assert the selected module identity. Use the copied CLI
at its frozen root with read-only fixture links. Do not silently substitute a
source rebuild. One illustrative exact command after preparing that tree:

```sh
node scratch/exe-zuma-startup-20261002/frozen/test/run.js \
  --app=zuma_deluxe --no-build \
  --wasm=scratch/exe-zuma-startup-20261002/frozen/build/wine-assembly.wasm \
  --quiet-api --quiet-blocks --no-close --stuck-after=0 \
  --max-batches=20000 --batch-size=20000 --max-seconds=60 \
  --png-canvas --png=scratch/exe-zuma-startup-20261002/final.png \
  --input=1000:png:scratch/exe-zuma-startup-20261002/batch1000.png,8197:png:scratch/exe-zuma-startup-20261002/batch8197.png
```

Keep a separate outer120s owner-only harness deadline because engine limits do
not necessarily cover asset/module setup. Save exact command/stdout/stderr,
elapsed time, exit reason, actual scheduler/backend and reviewed PNGs. This
needs a local CPU slot; no nativeGL/browser/remote resource is requested.
Do not force `--no-threads` and accidentally remove the target APC route; record
the scheduler selected by the copied harness. No automatic repeat on timeout.

Done: either current run reaches a reviewed responsive startup/menu with no
missing QueueUserAPC and captures the actual callback/loader behavior as needed,
or records a precise present failure with a bounded focused regression proposal.
Loading-only progress resolves the specific missing-import observation only
if demonstrated; it leaves startup/menu completion open. Menu is not gameplay.
If c474 passes, describe that identified artifact+host result; a claim about
newest WAT requires a separately authorized private compile/validation step.
No silent-success stub or broad API change is justified by the old screenshot.

## Deduplicated remaining repair/verification proposals

1. **Existing PIRATES-ROUTE-FOLLOWUP**, candidate `pirates-2004`: current
   identified c474288d headful Worker/high-effects route stopped at005d0650
   after English captain, before transfer. Exact command, inputs, images,
   registers and58-artifact manifest are in `mig-pirates-stretch.md` and
   `scratch/mig-pirates-stretch-20261002/result.json`. Reproduce only that
   single frozen route with a scoped pre-stop register/memory/indirect-call
   capture, after ownership/CPU grant. No graphics causation is established.
   Done: explain the stop or isolate its next concrete blocker, then observe
   actual guest StretchRect/filter2 with completed source readback before
   destination upload and continued execution. The older Barbados trap at
   0050bdaf has unknown module identity; merge it as historical motivation,
   not a second current defect. The7c5f97f5 sailing PASS emitted zero transfers
   and does not close this task.

2. **Proposed PIRATES-TERRAIN-CORRECTNESS**, same candidate, separate from
   transfer:7c5f97f5 low-effects Port Royale/castoff/sailing route explicitly
   retains white terrain. Exact recipe and observed captures:
   `scratch/runs/20261001-pirates-worker-sailing-after/result.json` and old
   owner handoff. That module is not independently retained. Reproduction:
   one newly identified artifact/host, same800x600 low-effects route, reviewed
   terrain capture and resource/shader evidence; initially observational.
   Done: establish whether terrain defect persists, then fix with a focused
   renderer regression and matching game images, or close as resolved with
   evidence. No task implementation or run is granted here; defer behind the
   captain-route blocker if the current route cannot reach terrain.

3. **Merge under Serious Sam production integration/input follow-through**,
   candidate `serious-sam-demo`, rather than reopening three historical bugs.
   e047aeca missing glClearDepth was passed by a90941ee; the latter reached
   Karnak/movement/combat in a private transformed module only, requiring
   `/inp_iKeyboardReadingMethod=0` and explicit window focus/messages.
   Evidence: `20261001T223000Z-serious-sam-demo-draw-trace/result.json` exact
   route/build plus `mig-sam-fault-remainder.md`. Latest0c5d6ab0 production-timer
   route proves bright intro only and still has private generic fault/REP
   transforms. Next reproduction must follow accepted REP/classifier/builder
   gates, then one identified normal launcher/input route. Done: no private
   correctness transforms needed, menu and movement/combat work with the
   declared normal input path, with exact source/module/captures. The87313 AV
   after Escape is historical on a90941ee; do not infer its cause or treat the
   later diagnostic gameplay PASS as generic production closure.

4. **Existing Q2-MOVEMENT-FOLLOWUP**, candidate `quake-2-demo-installer`:
   fa0cb8a8 original-software headful Worker route passes texture registry and
   changed-frame gate, but camera translation is not established. Exact
   command/environment in
   `scratch/runs/20261002T010210Z-quake-2-demo-installer-mig-render-registry/result.json`.
   Reproduction: same reviewed route on a frozen identified build, bounded W
   input plus position/landmark evidence. Done: actual traversal, not merely
   weapon animation/frame changes. This is acceptance coverage, not a proven
   application crash; it does not justify a renderer performance claim.

## Dispositions that should not create duplicate repairs

- Serious Sam87000 near-black “failed” result on363d07ed was resolved as frame
  phase by identical405db/363d pairs and later0c5d6ab0:90000 is bright GODGAMES.
  Preserve the original failed record and link `mig-sam-visual.md`; no TLS
  regression task follows from that frame.
- Serious Sam memory-integration harness error was macOS graphics service
  initialization before control server/guest execution. Log records invalid
  HIServices connection/notification errors. Later approved host-access runs
  completed. Classify as harness/environment, already worked around; any
  future launcher hardening task must use a recurrence, not a guest fix.
- Jazz2 MMX startup parity PASS had a black final frame and did not prove
  gameplay. Later reviewed DarnRatz movement/jump/combat-adjacent captures and
  other gameplay variants supersede the visual-coverage gap; do not open a
  black-screen defect solely from the earlier fixed-work endpoint. Exact
  later route/build65985dbe:
  `scratch/runs/20261001T225744Z-jazz-jackrabbit-2-demo-installer-headless-gameplay/result.json`.
- Unreal SoftDrv flyby/MMX and Collapse fixed-route results are narrow evidence;
  no concrete unresolved failure was found in those result summaries. They
  do not certify every gameplay route, audio or controlled speed. Unknown
  historical images for Moorhuhn/NFS/other candidates remain under visual
  recovery; missing captures do not justify invented repair tasks.

Queue proposals only: coordinator owns ledger disposition. Zuma is the first
ready bounded reproduction; no corpus-wide or concurrent launch is proposed.
