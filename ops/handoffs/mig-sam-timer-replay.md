# MIG-SAM-TIMER-REPLAY result

Worker `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`; 2026-10-02 UTC.
**PASS bounded intro route with production timer context.**

Reviewed bundle:
`scratch/runs/20261002T005200Z-serious-sam-production-timer-intro/result.json`.
Private WASM (1654921 bytes):
`scratch/mig-sam-timer-replay-20261002/serious-production-timer.wasm`.
SHA256 `0c5d6ab0f8f184c59e46c4f8495e77225cb918d376f883f77809559aaddd57fc`.

Exactly four timer prototype blocks were removed from the copied preserved
363d builder. All eight remaining fault/REP transform blocks compare
byte-for-byte to the original; no ss_timer symbols or timer-targeted transform
blocks remain. `build.js`, `builder.patch` and `transform-audit.json` record
the edit. This module uses production memory/static TLS/timer context but
still depends on private precise fault/REP behavior.

One private compile and one native-GL run were performed. Source/compiler/host
inputs were copied under `scratch/mig-sam-timer-replay-20261002/frozen/` and
250 input hashes recorded in `identity.json`; all stayed unchanged through
build and replay. The host file manifest also matches the prior paired
405db/363d runs. Those old modules lack frozen source-closure manifests, so
this is not a timer-only A/B claim; current source contains other accepted
dirty work. No shared canonical output or source file was changed in this task.

Route: frozen16000 first-start dialog, `cmd dlg-cmd:1`, step71000, inspect87000,
step3000, inspect90000. The long-step observation timed out; snapshots showed
progress in the same run (49935,69433,87000). No duplicate launch or step.

At87000 the near-black transition, and at90000 the bright GODGAMES logo, are
both **byte-identical PNGs** to the prior control405db and candidate363d pair.
Snapshot JSON and captured GL getters also match at each checkpoint. EIP is
63d5e0 then c19ff4; credits0/quitfalse,640x480 viewport, matrixError0,
untrusted0 and viewport dialog ctrlCount0. `comparison.json` records hashes
and the bounded GL-state subset; this is not a whole-machine state proof.
The first-start dialog and both checkpoint PNGs were viewed.

Own8147 launcher exec99702 quit through ctl and exited0; port has no listener.
Retained8138/8146 were never commanded. Local CPU/GL/port claims released.
No timing, menu/input or gameplay claim. Next Serious Sam work remains
production fault/REP integration, supported keyboard configuration and normal
full-root launcher/input/gameplay verification. Coordinator may proceed with
the next independent authorized queue task.
