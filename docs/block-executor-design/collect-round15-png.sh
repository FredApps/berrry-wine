#!/bin/bash
# Round 15: does the CHEAP fused-x87 micro-op change what the screen shows?
#
# Same two-budget rule as round 12's PNG sweep: one budget cannot tell "the
# picture changed" from "the two arms stopped at different points of an
# animation", so a difference only counts when it reproduces at both.
#
# Here BOTH arms carry --block-exec and --x87-fusion, and the only variable is
# --block-exec-x87. That is the round-15 question exactly: with the fold in
# front of it either way, does routing the fused op through TU_X87RUN (and the
# bare ops through the native x87 kinds) show the same frame as leaving them on
# the fallback trampoline / declining the block?
S=${S:-/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/r15png}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

shot() {              # name, budget, then run.js args
  local name=$1 b=$2; shift 2
  for arm in off on; do
    local X=""
    [ "$arm" = on ] && X="--block-exec-x87"
    timeout ${TO:-280} node test/run.js "$@" --x87-fusion --block-exec $X --max-batches=$b \
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
# line in each .log before believing a DIFFERS. ONLY=/MS=/TO= exist so a
# starved app can be re-taken on its own budget.
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
