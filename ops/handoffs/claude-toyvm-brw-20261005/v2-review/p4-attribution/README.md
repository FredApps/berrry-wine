# P4 attribution plan (prepared 2026-10-05 ~16:12Z, source only; nothing executed)

Stage 2 attempt 2 (820886d4) failed its P4 gate: 4 of 199 l1 rows moved under --no-irq-schedule.
Preserved P4 rows show the moves are dispatched-count only (frame, wav, irqs, ints identical):

| program | base dispatched | cand dispatched | frame | ints |
|---|---|---|---|---|
| ACIDRAIN.EXE | 8024330 | 8024454 | 86ce33da both | 25 both |
| COLORS.EXE | 8001200 | 8001270 | 7eb1ed94 both | 132 both |
| NEWSBOX3.EXE | 8009352 | 8009532 | 38c165c5 both | 27 both |
| BRIAN.EXE | 8001195 | 8001780 | 38c165c5 both | 35 both |

attribution.js (sha256 21629cbf7df059d0b65fdfc3bd896c8dfdeb0e6e56dd378878d4c858650db3bd) builds six trees from base 2683a6e3 with hash-pinned patches
(`--no-backup-if-mismatch`, so no .orig files): head; j (fix J alone); smc (forward-SMC fix alone);
v2v3j; v2v3j_v4; stack (= the P4 candidate). The dry run verified every tree; trees.json holds their
dos-loop/run-dos/emit/compile hashes, and stack matches P4's candidate (dos-loop 74f94f3e, run-dos
82ae85cd, emit e07d99db). It then runs the EXACT P4 invocation on each tree (`corpus-ab --arms=l1
--recipe=sweep --budgets=8m --no-irq-schedule` over the four programs), so a row's dispatched count is
the same "first handback past 8,000,000" P4 compared. The table is per program x tree against head.
The result is void unless head and stack equal P4's own base/cand rows (exit 3 otherwise).

Run (needs a granted slot; 6 trees x 4 programs x 8M, single core; estimate under 1 minute):

    node scratch/claude-toyvm-brw-v2-review-20261005/p4-attribution/attribution.js \
      --w=<stage-1 full-W work dir> --out=<empty dir> --run

The prediction to test: j alone (and v2v3j) reproduces the four dispatched moves, while smc alone
and v4 do not; no tree changes frame/wav/irqs/ints. If that holds, a P4 criterion for this stack
would compare guest-visible fields and report dispatched-only moves separately, which is root's
call. Gate and original failure are preserved unchanged.
