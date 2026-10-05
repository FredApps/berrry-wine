#!/usr/bin/env bash
# Before/after corpus run for the toyvm IRQ-schedule patch (v2, or v2 + v3 delta).
# NOT RUN by the reviewer. See corpus-plan.md for what each phase gates.
#
#   W=/path/to/workdir CAND=v3 JOBS=3 bash corpus-plan.sh prep
#   ... bash corpus-plan.sh tests      # P1  (both trees, parallel)
#   ... bash corpus-plan.sh sweep      # P2  doc gate: sweep-dos + sweep-diff (both trees, parallel)
#   ... bash corpus-plan.sh arms       # P3  cross-arm corpus, witness recipe, 80M
#   ... bash corpus-plan.sh control    # P4  --no-irq-schedule must be byte-identical
#   ... bash corpus-plan.sh brw        # P5  BRW 500M L1 vs jit-sepc, both trees
#   ... bash corpus-plan.sh nudge      # P6  rubric for moved l1 frames
#   ... bash corpus-plan.sh all        # P0..P6 in slot order
set -euo pipefail

R=${R:-/home/user/wine-assembly}
W=${W:?set W to an empty work dir (needs ~90 MB)}
CAND=${CAND:-v3}                      # v2 | v3
JOBS=${JOBS:-3}
SLOT_S=${SLOT_S:-7200}                # requested slot, seconds
BASE=2683a6e31d0e95e7ffd1805fcafe013f94f1bcec
REV=$R/scratch/claude-toyvm-brw-v2-review-20261005
V2=$R/scratch/claude-orchestrator-20261004/toyvm-brw/dos-loop-irq-fix-v2.patch
V3=$REV/v3-delta-on-v2.patch
AB=$REV/corpus-ab.js
CLOSURE="tools/toyvm tools/fnt-read.js tools/ne-dump.js tools/disasm.js tools/simd-ops.js lib/compile-wat.js lib/wat-manifest.js fonts/Terminal.fon"
T0=$(date +%s)

say() { echo "$(date -u +%H:%M:%S) [$1] $2" | tee -a "$W/out/journal.txt"; }
left() { echo $(( SLOT_S - ($(date +%s) - T0) )); }
diskok() { local kb; kb=$(df -Pk "$W" | awk 'NR==2{print $4}'); [ "$kb" -gt 307200 ] || { say ABORT "free disk ${kb}KB < 300MB"; exit 2; }; }

prep() {
  mkdir -p "$W"/{base,cand,out,logs}
  diskok
  [ "$(sha256sum "$V2" | cut -d' ' -f1)" = 4a9ba394d42e8634b583f799f9a2f2b9cb5732671bcd97891f9c60c6fdd5ef78 ] || { say ABORT "v2 patch hash"; exit 2; }
  local tests; tests=$(git -C "$R" ls-tree --name-only "$BASE" test/ | grep '^test/test-toyvm-')
  for t in base cand; do
    # shellcheck disable=SC2086
    git -C "$R" archive "$BASE" $CLOSURE $tests | tar -x -C "$W/$t"
    ln -sfn "$R/node_modules" "$W/$t/node_modules"
    mkdir -p "$W/$t/scratch/o/toyvm-brw"
    cp "$R/scratch/claude-orchestrator-20261004/toyvm-brw/brw-bisect.js" "$W/$t/scratch/o/toyvm-brw/"
  done
  patch -p1 -d "$W/cand" < "$V2"
  [ "$CAND" = v3 ] && patch -p1 -d "$W/cand" < "$V3"
  for t in base cand; do (cd "$W/$t" && node tools/toyvm/bundle-browser.js > "$W/logs/$t-bundle.log" 2>&1); done
  sha256sum "$W"/{base,cand}/tools/toyvm/{dos-loop,run-dos}.js | tee "$W/out/tree-hashes.txt"
  # expected: base dos-loop ebe0eb30..., cand dos-loop bd4f1ee9... (v2) / eeb9e2cd... (v3); cand run-dos 82ae85cd... (v3)
  node "$REV/unpack-corpus.js" --out="$W/demos" --list="$W/programs.txt" | tee "$W/out/corpus.txt"
  grep -q 3f9b202376eec52a72f9c1c0eb9f0dfd993292c344d62b95a820a9e5606fc475 "$W/out/corpus.txt" || { say ABORT "corpus hash"; exit 2; }
  for t in base cand; do
    timeout 120 node "$W/$t/tools/toyvm/run-dos.js" "$W/demos/1995-c-cma_brw/BRW.EXE" --dispatches=10m \
      > "$W/logs/$t-smoke.log" 2>&1 || { say ABORT "$t smoke run failed"; exit 2; }
  done
  say P0 "prep ok ($CAND)"
}

tests() {
  for t in base cand; do
    (
      for f in "$W/$t"/test/test-toyvm-*.js; do
        n=$(basename "$f" .js)
        if (cd "$W/$t" && timeout 600 node "$f") > "$W/logs/$t-$n.log" 2>&1; then r=0; else r=$?; fi
        echo "$t $n $r" >> "$W/out/tests.txt"
      done
    ) &
  done
  wait
  # Gate: a suite that passes on base and fails on cand ABORTS the slot.
  local bad
  bad=$(awk '{s[$2" "$1]=$3; n[$2]=1} END{for(k in n) if (s[k" base"]=="0" && s[k" cand"]!="0") print k}' "$W/out/tests.txt")
  [ -z "$bad" ] || { say ABORT "suites newly failing on cand: $bad"; exit 3; }
  say P1 "tests ok"
}

sweep() {
  for t in base cand; do
    # sweep-dos.js has no wall-clock guard of its own; it rewrites --out after every
    # program, so a TERM at SWEEP_S leaves a valid partial JSON (sweep-diff then
    # lists the missing names as "only in").
    timeout -s TERM "${SWEEP_S:-3000}" node "$W/$t/tools/toyvm/sweep-dos.js" --dir="$W/demos" --dispatches=8m --reps=1 --timeout=180 \
      --out="$W/out/sweep-$t.json" > "$W/logs/sweep-$t.log" 2>&1 &
  done
  wait
  # exits 1 on a regression or a blank; the gate reads the text, so keep going.
  node "$W/cand/tools/toyvm/sweep-diff.js" "$W/out/sweep-base.json" "$W/out/sweep-cand.json" > "$W/out/sweep-diff.txt" || true
  cat "$W/out/sweep-diff.txt"
  say P2 "$(grep -E '^(REGRESSIONS|WENT BLANK)' "$W/out/sweep-diff.txt" | tr '\n' ' ')"
}

arms() {
  diskok
  local secs=$(( $(left) - 1800 ))     # leave 30 min for P4-P6
  [ "$secs" -gt 600 ] || { say SKIP "P3: not enough slot left"; return; }
  # Both trees at once over the same list order, so a run cut short by the slot
  # still covers the same prefix of programs in both.
  for t in base cand; do
    node "$AB" --tree="$W/$t" --list="$W/programs.txt" --arms=l1,jit-early,jit-sepc,fold64 \
      --recipe=witness --budgets=80m --jobs=$(( (JOBS + 1) / 2 )) --timeout=300 --max-seconds="$secs" \
      --out="$W/out/arms-$t.ndjson" > "$W/logs/arms-$t.log" 2>&1 &
  done
  wait
  node "$AB" --compare="$W/out/arms-base.ndjson,$W/out/arms-cand.ndjson" --md="$W/out/arms-compare.txt" \
    --moved="$W/out/moved-80m.txt" || true
  say P3 "$(grep -E 'BROKE|health regressions|before .* after' "$W/out/arms-compare.txt" | tr '\n' ' ')"
}

control() {
  for t in base cand; do
    node "$AB" --tree="$W/$t" --list="$W/programs.txt" --arms=l1 --recipe=sweep --budgets=8m \
      --no-irq-schedule --jobs="$JOBS" --timeout=180 --out="$W/out/nosched-$t.ndjson" > "$W/logs/nosched-$t.log" 2>&1
  done
  node "$AB" --compare="$W/out/nosched-base.ndjson,$W/out/nosched-cand.ndjson" --md="$W/out/nosched-compare.txt" || true
  # Gate: "0 of N l1 rows moved". Anything else means the patch leaks off the schedule.
  say P4 "$(grep 'l1 rows moved' "$W/out/nosched-compare.txt")"
}

brw() {
  local exe="$W/demos/1995-c-cma_brw/BRW.EXE"
  for t in base cand; do for a in l1 sepc; do
    (cd "$W/$t" && timeout 900 node scratch/o/toyvm-brw/brw-bisect.js --arm=$a --exe="$exe" --budget=500918116 \
      --trace-irq --irq-out="$W/out/brw-$t-$a.irq") > "$W/logs/brw-$t-$a.log" 2>&1 &
  done; wait; done
  for t in base cand; do
    echo "$t: $(grep -h BRWBISECT "$W/logs/brw-$t-l1.log" | cut -c1-200)"
    echo "$t: $(grep -h BRWBISECT "$W/logs/brw-$t-sepc.log" | cut -c1-200)"
    echo "$t first differing delivery l1 vs sepc:"
    diff "$W/out/brw-$t-l1.irq" "$W/out/brw-$t-sepc.irq" | head -4 || true
  done | tee "$W/out/brw.txt"
  say P5 "brw done"
}

nudge() {
  # The moved list: sweep-diff's `changed` rows (P2) plus the l1 rows P3 saw move.
  # sweep-diff prints `  NAME: frame X -> Y, ...` (basename); corpus-ab --moved prints paths.
  { sed -nE 's/^  ([^:]+): frame .*/\1/p' "$W/out/sweep-diff.txt" 2>/dev/null || true
    sed 's#.*/##' "$W/out/moved-80m.txt" 2>/dev/null || true; } | sort -u > "$W/out/nudge-names.txt"
  # Every corpus path with one of those names (duplicate basenames all get re-run).
  awk -F/ 'NR==FNR{n[$0]=1; next} ($NF in n)' "$W/out/nudge-names.txt" "$W/programs.txt" > "$W/out/nudge-paths.txt"
  [ -s "$W/out/nudge-paths.txt" ] || { say P6 "nothing moved"; return; }
  for t in base cand; do
    node "$AB" --tree="$W/$t" --list="$W/out/nudge-paths.txt" --arms=l1 --recipe=sweep \
      --budgets=8m,8.01m,8.02m,8.04m --jobs="$JOBS" --timeout=180 --out="$W/out/nudge-$t.ndjson" > "$W/logs/nudge-$t.log" 2>&1
  done
  node "$AB" --nudge="$W/out/nudge-base.ndjson,$W/out/nudge-cand.ndjson" | tee "$W/out/nudge.txt"
  say P6 "$(tail -1 "$W/out/nudge.txt")"
}

case "${1:-}" in
  prep) prep ;; tests) tests ;; sweep) sweep ;; arms) arms ;; control) control ;; brw) brw ;; nudge) nudge ;;
  all)
    prep
    # P1 and P2 together: tests take two cores, the two sweeps take two more.
    tests & TP=$!
    sweep
    wait $TP || exit 3
    arms; control; brw; nudge
    say DONE "elapsed $(( $(date +%s) - T0 ))s" ;;
  *) echo "usage: W=DIR [CAND=v2|v3] [JOBS=N] bash $0 prep|tests|sweep|arms|control|brw|nudge|all"; exit 2 ;;
esac
