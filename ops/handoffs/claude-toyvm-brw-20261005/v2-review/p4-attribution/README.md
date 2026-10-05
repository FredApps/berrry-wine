# P4 attribution plan (prepared 2026-10-05 ~16:12Z, source only; nothing executed)

Stage 2 attempt 2 (820886d4) failed its P4 gate: 4 of 199 l1 rows moved under --no-irq-schedule.
Preserved P4 rows show the moves are dispatched-count only (frame, wav, irqs, ints identical):

| program | base dispatched | cand dispatched | frame | ints |
|---|---|---|---|---|
| ACIDRAIN.EXE | 8024330 | 8024454 | 86ce33da both | 25 both |
| COLORS.EXE | 8001200 | 8001270 | 7eb1ed94 both | 132 both |
| NEWSBOX3.EXE | 8009352 | 8009532 | 38c165c5 both | 27 both |
| BRIAN.EXE | 8001195 | 8001780 | 38c165c5 both | 35 both |

attribution.js (sha256 54fedd613a04a990e623099feb22d2758fb40b22bc62639e74765db88d8b3de8; hardened after root's source review ~16:15Z) builds six trees from
base 2683a6e3 with hash-pinned patches and `--no-backup-if-mismatch`: head; j (fix J alone); smc (forward-SMC
fix alone); v2v3j; v2v3j_v4; stack (= the P4 candidate). It then runs P4's EXACT invocation on each tree
(`corpus-ab --arms=l1 --recipe=sweep --budgets=8m --no-irq-schedule` over the four programs).

Contract (attribution.test.js sha256 4858345e89cdc75e4a59d1ae4feee8ff448d1ab5ac884750b7e52a14d609e6dd, 7/7 with a stub corpus-ab; no emulator):
- each tree must yield EXACTLY the four identities, each with arm l1, budget 8000000, irqSchedule
  false, recipe sweep, ok true, no ranOutOfTime/stuckAt, and every guest field present; a missing,
  duplicate, extra, malformed or wrong-arm row fails, exit 4;
- head and stack must equal P4's preserved base/cand rows on EVERY guest-visible field (dispatched,
  frame, wav, irqs, ints, pixels), else VOID, exit 3;
- ONE total wall bound (--total, default 180 s) for all six runs; each child runs in its own process
  group and is killed with its descendants on the deadline (exit 5), a failure or a signal (130);
  the fixture verifies a hung tree's grandchild is gone;
- --out must be new or empty (exit 2 otherwise): earlier evidence is never overwritten or erased;
  result.json is written on success and on every failure, with per-tree exit codes.

Dry run (2026-10-05 ~16:20Z, tar/patch only): all six trees built and verified; stack == P4 candidate
(dos-loop 74f94f3e, run-dos 82ae85cd, emit e07d99db, compile 0910ce47), head == base (dos-loop
ebe0eb30); no .orig files (dry-run-result.json).

Run (needs a granted slot; 6 trees x 4 programs x 8M, single core, hard-bounded at 180 s):

    node scratch/claude-toyvm-brw-v2-review-20261005/p4-attribution/attribution.js \
      --w=<stage-1 full-W work dir> --out=<new empty dir> --run

The prediction to test: j alone (and v2v3j) reproduces the four dispatched moves, smc alone and v4
do not, and no tree changes frame/wav/irqs/ints/pixels. If that holds, a P4 criterion for this stack
would compare guest-visible fields and report dispatched-only moves separately, which is root's
call. Gate and original failure are preserved unchanged.
