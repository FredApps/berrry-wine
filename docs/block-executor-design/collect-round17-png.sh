#!/bin/bash
# Round 17: does servicing a fallback-carrying one-block descriptor from H464
# instead of the general region function change what the screen shows?
#
# Same two-budget rule as every PNG sweep here: one budget cannot tell "the
# picture changed" from "the two arms stopped at different points of an
# animation", so a difference only counts when it reproduces at both.
#
# Both arms carry --block-exec, so the install decision, the descriptor bytes
# and the cost model are identical on both sides and the ONLY variable is WHICH
# FUNCTION runs a descriptor that has a fallback in it. `off` is
# --no-block-exec-leaf-fb, i.e. round 16 exactly on this build. Anything that
# differs here is H464 disagreeing with $th_block_exec about a micro-op, which
# is the one thing this round could have broken.
S=${S:-/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/r17png}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

shot() {              # name, budget, then run.js args
  local name=$1 b=$2; shift 2
  for arm in off on; do
    local X=""
    [ "$arm" = off ] && X="--no-block-exec-leaf-fb"
    timeout ${TO:-280} node test/run.js "$@" --block-exec $X --max-batches=$b \
      --no-build --quiet-api --quiet-blocks --no-close \
      --max-seconds=${MS:-240} --png="$S/$name-$b-$arm.png" \
      > "$S/$name-$b-$arm.log" 2>&1
    echo "$name $b $arm exit=$?"
  done
  node tools/png-diff.js "$S/$name-$b-off.png" "$S/$name-$b-on.png" \
    && echo "$name $b IDENTICAL" || echo "$name $b DIFFERS"
}

# A capture is only comparable when BOTH arms reached the same batch: the
# wall-clock guard stopping one arm early produces a different frame for a
# reason that has nothing to do with the lever. Check the `N batches in Ns`
# line in each .log before believing a DIFFERS.
if [ -z "$ONLY" ] || [ "$ONLY" = quake2 ]; then
for b in 600 2600; do
  shot quake2 $b --app=quake2_demo "--args=+set vid_ref soft +map demo1" \
    --screen=800x600 --batch-size=20000
done
fi
if [ -z "$ONLY" ] || [ "$ONLY" = heroes2 ]; then
for b in 700 1400; do
  shot heroes2 $b --app=heroes2_demo --batch-size=20000
done
fi
echo DONE
