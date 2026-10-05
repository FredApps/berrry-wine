#!/bin/bash
# Section 8 of docs/block-chaining-design.md (round 19): block chaining and the
# block executor, which used to be mutually exclusive, with BOTH armed.
#
# Four arms per window, because the claim is about a pair of switches and a
# pair needs all four corners:
#
#   off    neither -- the denominator for everything
#   chain  --block-chain alone (round 15)
#   exec   --block-exec alone (rounds 12-18)
#   both   --block-chain --block-exec (round 19)
#
# The gate is stated PER RETIRED BLOCK, not per run, because the four arms do
# not retire the same number of blocks for the same batch count: a region
# retires one block for several guest blocks. `branchEnd` over retired blocks
# is the desk-trip rate, and it must not be worse in `both` than in the better
# of `chain` and `exec` on any window.
#
# FIXED WORK, NOT FIXED TIME, for the same reason collect-round18-windows.sh
# says so: every counter here is cumulative over the run, so an arm that
# stopped early describes a different amount of work. --max-seconds is a GUARD
# that must not fire, and read-round19.js refuses to tabulate an arm whose
# `N batches in Ns` line is short of the batch count stamped into its log.
#
# ONLY=name runs one window; MS= sets the in-process guard, TO= the external
# one; QB/HB/RB/CB set the per-window batch counts.
S=${S:-/tmp/r19-windows}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

arms() {
  local name=$1; shift
  for arm in off chain exec both; do
    local F="--no-block-exec"
    [ "$arm" = chain ] && F="--no-block-exec --block-chain"
    [ "$arm" = exec ] && F="--block-exec --block-exec-stats"
    [ "$arm" = both ] && F="--block-exec --block-exec-stats --block-chain"
    echo "collect-round19 want-batches=$HE arm=$arm window=$name" \
      > "$S/$name-$arm.log"
    timeout ${TO:-300} node test/run.js "$@" $F \
      --no-build --quiet-api --quiet-blocks --no-close --verbose \
      --max-batches=$HE --max-seconds=${MS:-60} \
      >> "$S/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

H2IN='400:click:535:225,700:click:528:68,1200:click:283:373'
RCTIN='3000:click:198:430,3200:click:310:166,4200:click:428:157'
C3IN='700:mousemove:400:300,760:mousedown:400:300,800:mouseup:400:300'

if [ -z "$ONLY" ] || [ "$ONLY" = quake2-gameplay ]; then
HE=${QB:-600} arms quake2-gameplay \
  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 \
  --batch-size=20000
fi
if [ -z "$ONLY" ] || [ "$ONLY" = heroes2-gameplay ]; then
HE=${HB:-1400} arms heroes2-gameplay \
  --app=heroes2_demo --batch-size=20000 --input="$H2IN"
fi
if [ -z "$ONLY" ] || [ "$ONLY" = rct-gameplay ]; then
HE=${RB:-5000} arms rct-gameplay \
  --app=rct --batch-size=200000 --repaint-every=1000000 --input="$RCTIN"
fi
if [ -z "$ONLY" ] || [ "$ONLY" = caesar3-loading ]; then
HE=${CB:-1400} arms caesar3-loading \
  --app=caesar3_demo --screen=800x600 --batch-size=50000 \
  --repaint-every=1000000 --input="$C3IN"
fi
echo DONE
