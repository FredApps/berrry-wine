# Comanche 3 installed launch and physical input, 2026-10-08

Sole worker `NEW-GAME-COMANCHE3-DEMO-20261007`; no subagents. New branch
`findings/comanche3-installed-gameplay-20261008` in the clean reused
`/home/user/wt-comanche-gameplay-20261008`, explicit base
`cdddc109b87c02f2a683c08da731e585a56fd614`. Prior branch and
`ac1d4642bdf5e1e90a1f1fb8a2a2b4aa2e7e1478` preserved. Shared HEAD/index
untouched; root integrates/pushes.

**Original C3 startup and menu interaction established; gameplay and a new
generic repair were not achieved.** No installer or Setup rerun, paging/IVT
work, interpreter change, build, local native execution, browser or deployment.

Evidence is self-contained in shared
`scratch/runs/20261008T0551Z-comanche3-installed-gameplay/`. The run materialized
all eleven preserved installed files after checking each original SHA/length.
They are independent ordinary files in `installed/`, mounted by `runDos` as
the normal readonly directory beside `installed/C3.EXE`. No RAM checkpoint,
register forcing, guest instruction edit or clock change. Actual newly created
files are exported through `Machine.tempFiles` into `generated/`.

Exact payloads: C3.EXE 945297 bytes, SHA
`9d561246e9a5ac39ddb40949949373c9d4d5eeb6f99d67e64dc86df8aa0dfa5d`;
RESOURCE.RES 55496696 bytes, SHA
`6d5fcf59243d3de6cc615a4337b867d56c9efc0d265cf9507183bd113b709676`;
SETUP.EXE 950891 bytes, SHA
`d18e165779c36c0bad5f79135bfcf1d172262dfec267e1b09d7b76cc072769bd`.
Setup was not executed here.

The copied runtime closure retains 75 source/dependency/test pins from the
prior sealed source, with dos.js detached before copying the integrated
rename/host-shadow guard from the explicit base. Actual dos.js SHA is
`4bfe62569b3c6de6f5e903e339fb22b0c3e08beba1a9c0e94c6093525555f97e`.
Together with eleven installed files there are 86 checked input pins. The
inherited test files were not executed; do not call this a whole-tree snapshot
or a fresh 14-group/native rename regression run. CPU module actually exported
and rehashed is
`91747769679ce2e661242d0777c1f0fb5aeffe48cbbe2f71ea9443eaf57a45cf`,
tailcall, Node24.18.1 / V8 13.6.233.17-node.50, AMD Ryzen9 9950X.

## Reviewed native route

C3 opened its installed resource file, rendered copyright, animated Dolby
intro, then Pilot Roster. Enter/Down/Space taps through `pushKey` initially
showed no clear menu response. An ordinary held Down, delivered as physical
make then break after 0.5 guest seconds, visibly moved the bordered pilot
from Blood Hawk to Venom (`screen-014.png` → `screen-034.png`). Enter eventually
rendered Duty Roster for Venom (`screen-048.png`), later Blood Hawk
(`screen-104.png`), and finally Argon (`screen-150.png`, `screen-155.png`).
The battle image at `screen-044.png` is artwork, not gameplay.

No Gallant Venture selection, mission, cockpit, flight response, FPS or audio
was authenticated. Up sometimes redraws a Pilot Roster background after Duty
Roster; short Enter presses sometimes leave the roster visible. Timing,
duplicated BIOS mirroring, hidden menu state and rendering are hypotheses,
not established causes. In particular, the early claim that long Enter
definitely repeated Re-Enlist was not authenticated. Physical-only inputs
also fail to establish reliable operation selection. `keyboard-port.log`
records actual make/break reads, and bounded read-only buffer records retain
unchanged BIOS head/tail. Mouse down/up was delivered, but `mouse.reads=0`;
no mouse response is qualified. Newly exported C3.SAV32 and C3.NAM1674 are
guest-created files, not proof of gameplay or successful save/reload.

Native observer installation used the owned Node inspector, wrapping the
existing `DosSession.step` for ordinary input and read-only state. All exact
expressions and receipts are retained. The input wrapper polls at most once
per100ms; actual command delivery is logged. No paired benchmark/profile or
interpreter optimization claim. Original `pushKey` taps, held BIOS+hardware
inputs, and later physical-only inputs are explicitly distinguished.

## Bounds, handling and release

One actual guest launch at05:51:31UTC; fixed deadline06:20:48.657UTC, never
reset, ceiling1800wall/300guest seconds. Ended by deliberate **host diagnostic
stop** (`Machine.stopHit`, no guest memory/register write) at06:17:17.916UTC:
1546.318837477 execution-wall seconds,146.88242212476004guest seconds,
1470819156dispatches. `guest.exited=false`, `ranOutOfTime=false`; clean
supervisor child exit0/pass=true means bounded harness completion, not game
completion. No CPU faults, unimplemented instruction, bad selector or protected
transfer stop. Optional unhandled-function counters are retained:2f:16×1,
15:c0×1,10:4f×2; exact unsupported VBE subfunctions were not captured.
SETUP.CFG was missed; archive-resource name misses are not proven absent media.

Preexecution ENOENT came from attempting to open driver.log before transfer
finished; no guest started. Two rejected inspector expressions installed no
wrapper; the scoped IIFE succeeded. Early held-input keydown `guestSeconds`
fields accidentally contain requested duration, not delivery time; later
physical records use `guestSecondsAtDelivery`. A command incorrectly called
screen038 Argon-highlighted; visual review shows Venom bordered. Raw artifacts
and corrections are both preserved in `handling-notes.json`.

Fresh no-env boat `bx_698xwqef`, expiry06:30:25.015UTC, **root owns lifecycle**.
41.55MB transfer verified before the actual launch. Retrieved182actual files,
38098701bytes, all SHA checked in27.869seconds. Independent23064/23071PIDs
and groups absent, streams closed, inspector9229 absent, exact normalized
fresh socket baseline, all86remote/local input pins unchanged, no Chrome by
`ps comm` (earlier pgrep matched its own command). Scoped prefix removed
06:18:19.111UTC,61.078seconds after terminal, within90cleanup. Boat retained.
Local disk4.35GB>2GiB. Historical hardlinks/source/build artifacts untouched;
live.js inspected at nlink6 and not edited. No worker jobs remain.

## Next action and ownership

Root board06:02:03 reserves generic web keydown/keyup plus blur/stop release
and real browser validation; this worker leaves those files untouched. Current
web `LiveRun.key` only calls `pushKey`, whose immediate make+break cannot express
the held native input used here. This is an acceptance gap, not a completed
repair or a proven cause of the native menu returns. Implement/test that public
input lifecycle, then authenticate the actual C3 operation-selection consumer
and a reviewed cockpit/control response. Reuse these named installed files;
do not reinstall, repeat old paging, infer missing archive resources, or run
another timeout without a causal input/consumer plan.
