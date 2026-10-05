# Prepared SMOKE=3 runner command and pins (2026-10-05 ~14:58Z; NOT started; waits for root's grant)

Base (git archive source for both trees): 2683a6e31d0e95e7ffd1805fcafe013f94f1bcec
Runner: scratch/claude-toyvm-brw-v2-review-20261005/corpus-plan.js sha256 00e8fa346fc55e98696d0c5fbd8543800125842a73d731021db43db508e82c13 (== main fe9f533a copy)
Fixture tests: corpus-plan.test.js sha256 99ce974b... (33/33)
Helpers: corpus-ab.js 362d4c5e..., unpack-corpus.js 56283121..., brw-bisect.js 0de59d87..., v2 patch (prep hash gate) 4a9ba394...
Candidate stack (applied in order to cand; verified to apply cleanly on the base at ~14:57Z):
1. /home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v2-v3-j-combined.patch       54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82
2. /home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v4-delta-on-combined.patch   4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b
3. /home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/smc-pure-forward-fix.patch   b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612
Closure paths verified present at the base: tools/toyvm, fnt-read.js, ne-dump.js, disasm.js, simd-ops.js, lib/compile-wat.js, lib/wat-manifest.js, fonts/Terminal.fon, bundle-browser.js, sweep-dos.js, sweep-diff.js, both smoke test suites.
Disk at prep time: 2.6 GB free (the runner aborts below 300 MB).

Command (W must be a new empty directory; SLOT_S 900 is the hard cap):

    W=/tmp/claude-1000/-home-user-wine-assembly/1863d2b5-bc58-4c0b-9c15-00fc951f0256/scratchpad/smoke-W SMOKE=3 SLOT_S=900 JOBS=2 CAND=stack \
    PATCHES="/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v2-v3-j-combined.patch:54de1b1368d0aeefc39916b4af2f506036d079af7f2504d5424c00be4d3e6f82,/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/v4-delta-on-combined.patch:4b00d26def9852864b62b93bbb513e4328500765120c7b0b9cf86ad83210949b,/home/user/wine-assembly/scratch/claude-toyvm-jmpsyn-j-20261005/smc-pure-forward-fix.patch:b3371e2185dafad8399bfec7250805b1a9b9960e0791f7c063d17f6ddfd3c612" \
    node /home/user/wine-assembly/scratch/claude-toyvm-brw-v2-review-20261005/corpus-plan.js all

Gates exercised for real: prep (archive, patch stack, bundle, corpus unpack + corpus hash, BRW 10M
smoke on both trees), P1 (test-toyvm-region-live, test-toyvm-region-install-clock), P2 sweep 2M,
P3 arms 4M, P4 nosched 2M, P5 BRW 50M parity gate, P6 nudge. All coverage is checked by identity
against the 3-program smoke list. Outputs: $W/out (journal.txt, tree-hashes.txt, compares) and
$W/logs. Afterwards: summarise, hash, copy the journal and summaries back, then delete $W (disk).
This is a harness smoke only and never the corpus A/B.
