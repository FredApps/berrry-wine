# Age of Wonders II demo: sole-worker continuation, 2026-10-08

Native review completed; gameplay objective remains unfulfilled. No runtime patch
or gameplay credit from this continuation. Branch `fix/aow2-menu-route-20261008`
started at explicit `1455cc2f48e5262d918a136f8bf64fe82dbe3bf9`; runtime was not
rebased after root integrated core/registration. Root integrates this documentation.
The predecessor handoff and sealed before/after runs remain untouched.

## Expanded regression review

Sealed run: `scratch/runs/20261008T1546Z-age-of-wonders2-demo-native-review/`.
On root-owned noenv `bx_997uef9b`, the expanded
`node test/test-bstr-reallocation.js` exited 0 in 3.297 seconds, Node 24.18.1,
15:46:34.679–15:46:37.976 UTC. All 900 declared source hashes were verified.
The valid `cch=0x3FFFFFF5` actual heap-allocation failure preserves the old pointer
and content. Existing real-dispatch aliases, embedded NUL, NULL old/source, zero,
overflow and stdcall cases also pass. This distinct stage did not rerun the game.
Transfer/native/retrieval-cleanup bounds were 300/600/90 seconds; the receipt was
retrieved and hashed before the fresh native prefix was removed.

## Bounded registered Worker investigation

Sealed run: `scratch/runs/20261008T1623Z-age-of-wonders2-demo-menu-route-investigation/`.
Immutable transfer/build/browser/retrieval-cleanup bounds were 600/600/1500/180
seconds, declared before execution with adequate remaining lease. One browser
only, noenv boat, software backend, 512 MiB, four guest Worker threads, Chrome
151.0.7922.108. Canonical `bash tools/build.sh` passed all gates, including both
checked-in ToyVM bundles. Preparation completed 15:55:36.830 UTC; 3572 source
pins were verified before launch. Exact served wasm:
`e4d59e88c62dd17cafaa836120e35e891cd56b497bd80190c980696adc98396c`.

Original installer SHA-256:
`1244f0114965d011d1e28b97e207db15c902d124ebb25af8a6c97748beb73dc0`.
Original extraction again produced 1063 files / 197002538 bytes, with AoW2.exe
`a10590e5dbd013d154b00ea53e66670f4e74d38ab33adb2523f0a662af8f89f7`;
registration manifest had 1059 companions and the same three explicit Borland
DLLs. No replacement edition or installed-state fabrication. Existing declared
`test/binaries/tlbs/stdole2.tlb` was included; unavailable oleaut32/comctl32/
olepro32 fixtures retained built-in fallbacks. Source archive and full remote
hash receipt, original extraction/build output, scripts, request/command logs,
backend identity, images and terminal cleanup are contained in the new run.

This run did not reproduce the predecessor's reviewed menu. Reviewed
`evidence/browser/refined-scene.png` shows title background without buttons;
`crash-capture-scene.png` shows a blank desktop and ProgramExited(worker).
Other ordinary reloads produced a pre-input stack execution trap at EIP
`0x074ffd4e` (ESP `0x074ffbc0`) or active background/message waits. No Scenario
click was issued against invisible controls. No guest state, EIP, surface or
save forcing occurred. Predecessor quick Scenario returned to menu; predecessor
180 ms held-click eventual outcome remains **unknown**, not failed.

The initial diagnostic observer incorrectly decoded SharedArrayBuffer directly,
causing a TextDecoder exception; that attempt is invalid and retained as such.
It was corrected in the same Chrome session. Initial API logs saturated the
50000-entry cap, and the first send observer saturated before relevant dispatch;
those traces cannot establish a cause. A narrow read-only observer retained later
send replies and rolling slice replies. A host stdole2 omission A/B reproduced
the same startup trap, then the declared file was restored. It did not identify
a causal menu prerequisite.

## Concrete source/message lead, not a diagnosis

Main message wait EIP `0x00bc63b4` maps to VCL50 original `0x4000b3b4`,
module runtime base `0x00bbb000`. Child thread 3 sends to Win32 thread 1,
HWND `0x10007`, message `0x8fff`, lParam `0x0b7ce3d0`.
Actual Worker export reads give its WndProc `0x00beb21c`, original
`0x4003021c`. Retained disassembly identifies `TThreadWindow`: message `0x8fff`
invokes method pointer at lParam+0x20 with self at +0x24, then returns stdcall
16 bytes. Main sync-message depth was zero at the final read; thread counters
advanced, so a deadlock was not established.

`refined-send-capture.json` records two dispatch requests overlapping an active
slice at observer times 33582.815 and 33629.95 ms. This is a lead concerning
Worker slice/send arbitration, **not proof of causality**. Next useful work is a
controlled source-level arbitration regression and exact terminal CPU/stack
capture, with observer correctness checked first, before another game phase.
Read actual CPU via Worker `callExport`; the browser shadow instance getters
returned zeros and are unsuitable for CPU argument diagnostics. Do not apply a
speculative concurrency patch or replay menu clicks without a reviewed menu.

## Closure

Chrome 90065 exited 0 at the immutable deadline, 16:21:23.305 UTC (1500.274 s).
The 2774793-byte archive SHA-256
`fd2ea22ef194a3ef16270465a04f6007dd5d17a7681a3904504a90c1697c256a`
was retrieved and hash-verified before removing the owned gameplay prefix and
transfer archives at 16:23:15.496 UTC. Owned PIDs 89041/90050/90065 and Chrome
were absent, listeners matched the preflight baseline. Root retains lifecycle
ownership of `bx_997uef9b`, expiry 16:47:45.876 UTC; worker did not stop it.
Both new runs pass artifact containment with zero errors/missing references;
all 103 gameplay-run artifact hashes verified. Local free disk remained 2.5 GiB.
No public deployment, shared index/HEAD mutation, merge, push or extra worker.

## Coordinator source review after integration

At main566467459, guest-thread-host.js WorkerLink._ask posts commands and
bumps the shared mailbox for non-slice requests. guest-worker.js
waitMessageLocally explicitly checks that mailbox to end a local message wait.
The slice branch calls ex.run synchronously and contains no await while running
the guest. A dispatchThreadSend posted while a slice reply is outstanding can
therefore be queued normally until the Worker returns to its event loop. The
recorded host-side overlap alone does not demonstrate simultaneous CPU access.

The main-thread message-point gate is also present: ThreadManager checks
mainAtMessagePoint before dispatch; otherwise it arms incoming_send_pending
and defers. The check and later dispatch remain separate asynchronous requests,
so this source review does not prove all interleavings safe. A regression needs
an observed harmful ordering, rather than simply rejecting overlapping promises.
Next record actual Worker command entry/exit, yield/EIP/ESP and send-frame depth
around the implicated transition; correlate those with the terminal stack.
Preserve bounded logs and validate observers on shared memory first. No new
runtime test, causal diagnosis or compatibility fix is claimed by this review.

## Worker-boundary observer prepared, 2026-10-09

`tools/worker-command-trace.js` emits an opt-in CDP expression for an initialized
guest Worker. Evaluate it in that Worker target, then retrieve
`self.__wineCommandTrace.read()` and restore its original message handler with
`self.__wineCommandTrace.stop()`. The default 2048-event rolling buffer reports
overwritten events explicitly; it records command sequence, entry/synchronous
return, actual instance EIP/ESP/yield, and outstanding JS send-frame snapshots.
It does not modify guest registers, memory, exports or scheduling policy.
It must not be evaluated in the page shadow instance or before Worker init.

The distinction between synchronous return and async completion is deliberate:
current guest-worker.js awaits only WebAssembly instantiation in init. Actual
slice/send commands execute their bodies synchronously, although handleMessage
returns a Promise which the installed onmessage handler discards. Instrumenting
the handler boundary therefore observes their execution, not a host request's
time in the queue. Diagnostic overhead can still change timing.

Further source inspection: host.js starts main and child slices together;
ThreadManager tracks a child slice's inFlight flag through its slice await,
but releases it before resolving its outgoing send. The send dispatcher can
retain a target frame across awaits, and its activeLinks set is local to that
send chain. These are candidate interleavings to observe, not proof of a bad
ordering or an AoWII root cause. Preserve nested-send behavior when designing
any later arbitration fix; indiscriminate serialization can deadlock callbacks.

Pure-JS observer contract checks passed in
`scratch/aow2-command-trace-20261009/check.js`: bounded retention, real handler
pre/post snapshots in a synthetic context, send-frame data, unchanged return
identity/receiver, original exceptions, uninstall and rejection of wrong targets.
No guest execution, browser capture or new gameplay proof in this step. Next:
attach this observer to the actual initialized Worker on a temporary boat,
capture startup plus terminal stack, and correlate events before patching.

## Actual command capture, 2026-10-09 01:50 UTC

Run `scratch/runs/20261009T0150Z-age-of-wonders2-command-trace` tests main
`19ad154eb`, original pinned ZIP, canonical build, and 902 matching source hashes
on fresh no-env `bx_7x3p2hjt`. Four actual Worker observers attached without
observer errors. The registered software route reached a visible menu.
Campaign produced the explicit demo restriction dialog. The auxiliary CDP
connection changed viewport size; the first attempted dismissal/Scenario input
used stale coordinates and is invalid. `dismiss-checked.png` confirms successful
dismissal; the subsequent reviewed Scenario click at (337,420) produced the
terminal screenshot `scenario-verified-click.png`.

Actual main Worker state: EIP `074ffd8c`, ESP `074ffc08`, zero outstanding JS
send frames. Console reports previous EIP `074ffd7c`, EBP `074ffc24`, ESI
`507760f8`, EDI `506850f7`. Captured stack starts `00428e57,0,0,00428e8b` and
contains `00429030`. Original EXE disassembly identifies 428e57 and 428e8b as
labels in an optimized row-copy loop with frame-local indirect continuations;
they are not necessarily call-return addresses. Do not infer a return-chain
failure from these words alone.

The actual observed dispatchThreadSend entries/returns restore the message-wait
EIP/ESP with depth zero. No retained event proves a slice executed inside a
suspended send frame. However, this does **not** exonerate every ordering:
after the trap, repeated get_yield_reason/set_incoming_send_pending requests
overwrote the rolling buffer before its next retrieval. The filtered collector
records two gaps and one saturated wait-event stream. Terminal CPU/stack is
valid; the first transition into stack execution is missing. Next improve the
observer to preserve the first trapped Worker reply and its preceding ring,
then capture that transition before proposing a runtime fix. CDP attachments
must use defaultViewport:null to avoid changing input coordinates.

Browser driver39185 and Chrome exited0 at01:55:17.362; collector40552 exited0.
No Chrome remained before stop. Boat stop operation completed01:55:52.451Z.
Evidence archive SHA `1bbc1ce34ad41635c67245702386591be43e967b631fddcfc7e4c1c7607a9fb9`
was verified before stop; 55 contained artifacts sealed. No gameplay/FPS/audio
qualification, no guest writes, and no causal scheduler fix claim.

The observer now preserves `firstTrap` at the outgoing trapped reply, before
the host can flood it with export requests. It retains the preceding bounded
ring and reads 128 bytes around EIP plus 256 bytes at ESP. The reply object,
transfer arguments and original return value are forwarded unchanged; later
traps cannot replace the first capture. `node tools/worker-command-trace.test.js`
passes a pure-JS regression reproducing 4000 post-trap commands. This update
still needs validation in an actual browser Worker; it is a diagnostic change,
not a game compatibility fix.
