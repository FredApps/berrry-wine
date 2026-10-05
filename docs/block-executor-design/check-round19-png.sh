#!/bin/bash
# Round 19 correctness gate: with block chaining and the block executor BOTH
# armed -- the combination round 15 refused to allow -- does the screen still
# show what it shows with each of them alone?
#
# Three arms per budget, and both comparisons are made: both-vs-chain and
# both-vs-exec. Comparing only against `off` would leave the interesting
# failure invisible, because a chain slot written into a descriptor chunk can
# only go wrong when there IS a descriptor chunk.
#
# FIXED BATCHES, never --max-seconds, for the reason check-round18-png.sh
# states: a capture taken when the wall clock ran out is a picture of a
# different moment in a clock-paced animation in each arm. --max-seconds is a
# guard that must not fire; a run that trips it prints GUARD-FIRED and the row
# is not a result.
S=${S:-/tmp/r19-png}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

shot() { # app extra-args budget arm flags...
  local app=$1 extra=$2 b=$3 arm=$4; shift 4
  local out="$S/$app-$b-$arm.png"
  timeout ${TO:-600} node test/run.js --app=$app $extra \
    "$@" --no-build --quiet-api --quiet-blocks --no-close \
    --max-batches=$b --max-seconds=${MS:-60} --png="$out" \
    > "$S/$app-$b-$arm.log" 2>&1
  grep -q "$b batches in" "$S/$app-$b-$arm.log" || echo "  GUARD-FIRED $app $b $arm"
}

pair() { # app extra b1 b2
  local app=$1 extra=$2
  for b in $3 $4; do
    shot "$app" "$extra" "$b" chain --no-block-exec --block-chain
    shot "$app" "$extra" "$b" exec  --block-exec
    shot "$app" "$extra" "$b" both  --block-exec --block-chain
    for ref in chain exec; do
      if node tools/png-diff.js "$S/$app-$b-$ref.png" "$S/$app-$b-both.png" \
           > "$S/$app-$b-both-vs-$ref.txt" 2>&1; then
        echo "IDENTICAL $app @$b  both vs $ref"
      else
        echo "DIFFERENT $app @$b  both vs $ref -- see $S/$app-$b-both-vs-$ref.txt"
      fi
    done
  done
}

[ -z "$ONLY" ] || [ "$ONLY" = heroes2 ] && \
  pair heroes2_demo "--batch-size=20000" 600 1200
[ -z "$ONLY" ] || [ "$ONLY" = caesar3 ] && \
  pair caesar3_demo "--screen=800x600 --batch-size=50000 --repaint-every=1000000" 600 1200
[ -z "$ONLY" ] || [ "$ONLY" = rct ] && \
  pair rct "--batch-size=200000 --repaint-every=1000000" 600 1200
[ -z "$ONLY" ] || [ "$ONLY" = quake2 ] && \
  pair quake2_demo "--args=+set vid_ref soft +map demo1 --screen=800x600 --batch-size=20000" 300 600
echo DONE
