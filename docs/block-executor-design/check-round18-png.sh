#!/bin/bash
# Round 18 correctness gate: does letting a region member side-exit through an
# unmodelled terminator change what the screen shows?
#
# Two budgets per app, and the comparison is always r17-vs-on -- NOT off-vs-on.
# The executor as a whole already has its own registry-wide sweep
# (tools/block-exec-sweep.js, sweep-2026-09-15.md); what this round has to show
# is that term_kind 10 changed nothing on top of round 17, and holding the
# executor armed in both arms is what isolates that.
#
# FIXED BATCHES, never --max-seconds. A capture taken when the wall clock ran
# out is a picture of a different moment in a clock-paced animation in each arm,
# and the diff then measures the box's load rather than the build. --max-seconds
# is present only as a guard that must not fire; a run that trips it prints
# GUARD-FIRED and the row is not a result.
S=${S:-/tmp/r18-png}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

shot() { # app extra-args budget arm flags
  local app=$1 extra=$2 b=$3 arm=$4; shift 4
  local out="$S/$app-$b-$arm.png"
  timeout ${TO:-600} node test/run.js --app=$app $extra \
    --block-exec "$@" --no-build --quiet-api --quiet-blocks --no-close \
    --max-batches=$b --max-seconds=${MS:-280} --png="$out" \
    > "$S/$app-$b-$arm.log" 2>&1
  grep -q "$b batches in" "$S/$app-$b-$arm.log" || echo "  GUARD-FIRED $app $b $arm"
}

pair() { # app extra b1 b2
  local app=$1 extra=$2
  for b in $3 $4; do
    shot "$app" "$extra" "$b" r17 --no-block-exec-tail-exits
    shot "$app" "$extra" "$b" on
    if node tools/png-diff.js "$S/$app-$b-r17.png" "$S/$app-$b-on.png" \
         > "$S/$app-$b-diff.txt" 2>&1; then
      echo "IDENTICAL $app @$b"
    else
      echo "DIFFERENT $app @$b  -- see $S/$app-$b-diff.txt"
    fi
  done
}

[ -z "$ONLY" ] || [ "$ONLY" = heroes2 ] && \
  pair heroes2_demo "--batch-size=20000" 600 1200
[ -z "$ONLY" ] || [ "$ONLY" = caesar3 ] && \
  pair caesar3_demo "--screen=800x600 --batch-size=50000 --repaint-every=1000000" 600 1200
[ -z "$ONLY" ] || [ "$ONLY" = rct ] && \
  pair rct "--batch-size=200000 --repaint-every=1000000" 2000 4000
[ -z "$ONLY" ] || [ "$ONLY" = quake2 ] && \
  pair quake2_demo "--args=+set vid_ref soft +map demo1 --screen=800x600 --batch-size=20000" 1500 3000
echo DONE
