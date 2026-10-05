#!/bin/bash
# Round 16: does letting a REGION MEMBER hold an x87 op change what the screen
# shows?
#
# Same two-budget rule as every PNG sweep here: one budget cannot tell "the
# picture changed" from "the two arms stopped at different points of an
# animation", so a difference only counts when it reproduces at both.
#
# Both arms carry --x87-fusion --block-exec --block-exec-x87, so the one-block
# x87 family is identical on both sides and the ONLY variable is the round-16
# sub-lever. `off` is round 15 exactly (x87 refused in a region member); `on` is
# round 16. Anything that differs here is the region emitter's publish mask or
# the alias rules, not the fold and not the one-block path -- which is the
# entire point of having the sub-lever rather than A/Bing against --block-exec.
S=${S:-/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/r16png}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

shot() {              # name, budget, then run.js args
  local name=$1 b=$2; shift 2
  for arm in off on; do
    local X=""
    [ "$arm" = off ] && X="--no-block-exec-x87-regions"
    timeout ${TO:-280} node test/run.js "$@" --x87-fusion --block-exec \
      --block-exec-x87 $X --max-batches=$b \
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
for b in 600 1200; do
  shot quake2 $b --app=quake2_demo "--args=+set vid_ref soft +map demo1" \
    --screen=800x600 --batch-size=20000
done
fi
if [ -z "$ONLY" ] || [ "$ONLY" = mw3 ]; then
for b in 400 830; do
  shot mw3 $b --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5
done
fi
echo DONE
