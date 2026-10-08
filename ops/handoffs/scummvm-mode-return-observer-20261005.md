# ScummVM mode-return observer

The exact frozen1a343 WASM fixture passed both synthetic NULL and nonzero SDL returns. Actual observed block PCs were426490→40246c, same owner thread1, ESP48fffc→490000, arguments640/480/16/80000000; final EAX/ESP/EIP matched the unobserved baseline and BP remained0. This proves the diagnostic call/return boundary, not actual SDL behavior.

Ordinary browser attempt1 (session81856) armed successfully at17:33:37.136Z. Its raw entry-code guard then rejected the SDL entry; no returned EAX or driver was captured. The guard mistakenly compared preferred-image bytes containing an absolute pointer against a relocated DLL. The actual PE relocation table has HIGHLOW at RVA26498, offset8 in the16-byte entry span. At observed SDLbase00a6d000, preferred operand1003c440 must become00aa9440. First failure did not record actual bytes, so that expected correction is not itself live verification.

The ordinary chord again produced640x480 at17:33:53.457Z and ExitProcess0 at17:33:53.984Z. The independently captured terminal image shows the desktop after application exit. It survives the subsequent owner-unavailable snapshot error. Browser/server closed17:33:54.524Z, exit0, cleanup complete/errors[], process check clear. Runtime identity and incomplete observation remain explicit; no fullscreen fix or SDL failure conclusion.

Raw evidence: `scratch/scummvm-av-20261003/mode-return/attempt1/{analysis.json,artifact-hashes.json,console.json,arm.json,inputs.json,after-or-terminal.png,after-or-terminal.json,cleanup.json}`. Full EXE/DLL CDP body receipts can fail after cleanup and are recorded as errors; local source identities remain pinned, not a replacement claim for unavailable response bodies.

Corrected preparation parses the actual PE relocation table and applies only verified HIGHLOW entries to the exact expected code bytes. No wildcard matching. Positive fixture at actuala6d000 and opcode-mutation negative pass, alongside receiver/arguments/return/promise/throw preservation and installer/terminal tests. Source/helper receipts live in `mode-return/source-receipt.json`; browser5410afee, observedWorkerb1e58e48, observer02ed0b56. Canonical module remains1a343c5f and sourcef5b222ee. No production changes.

Next authorized-scope candidate is one fresh bounded180sec diagnostic using the corrected helper, after a separate runtime grant. Arm only after ordinary startup; acknowledge the private owner arm; send one ordinary Alt+Enter; preserve entry/return args, EAX and actual driver name before teardown. Unknown/mismatched nesting, stack, owner, code or capped observations remain unknown. Trace changes chaining cost; no FPS, performance, audio or renderer-fix claim.

## Corrected actual mode-return proof

Fresh attempt2 session34662 completed exit0; browser/server closed2026-10-05T17:37:57.091Z complete/errors[], process check clear. Exact relocated code guard passed. At17:37:55.905Z owner thread1 entered SDL_SetVideoMode(640,400,16,0x80000000), with actual driver `directx`. At17:37:55.913Z exact caller continuation40246c observed EAX0; ESP advanced122680028→122680032 and all four arguments/device/name were unchanged. Summary has2callbacks, invalidfalse, incompletefalse. This establishes failed fullscreen mode recreation; static guest NULL branch then quits, consistent with observed ExitProcess0 at17:37:56.607–.609Z.

Requested SDL640x400 and later observed display640x480 at17:37:55.920Z are separate facts; the latter is not proof of successful SDL surface creation. Underlying DirectDraw operation/error remains unknown. No renderer heuristic change follows from this evidence. Timing is host receipt chronology under diagnostic trace, not execution/performance measurement.

121 actual served response receipts have zero hash mismatches; incomplete large-response receipts remain documented. Full immutable raw run is mode-return/attempt2; compact publication is ops/release-evidence/scummvm-fullscreen-mode-return-20261005. Worker personally reviewed both startup and terminal screenshots. Music quality/listening and fullscreen remain separate; no audio was rerecorded.
