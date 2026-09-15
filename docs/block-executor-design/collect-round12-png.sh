#!/bin/bash
# Round 12: does the executor still show the same screen?
#
# Two budgets per app, because ONE budget cannot tell "the picture changed" from
# "the two arms stopped at different points of an animation" -- a difference
# that reproduces at both budgets is a rendering difference, one that appears at
# a single budget is pacing. `off` is the plain interpreter, `on` adds
# --block-exec (round 12 default: split + carry + rmw on, x87 off).
S=${S:-/tmp/r12-png}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

shot() {              # name, budget, then run.js args
  local name=$1 b=$2; shift 2
  for arm in off on; do
    local X=""
    [ "$arm" = on ] && X="--block-exec"
    timeout 280 node test/run.js "$@" $X --max-batches=$b \
      --no-build --quiet-api --quiet-blocks --no-close \
      --max-seconds=240 --png="$S/$name-$b-$arm.png" \
      > "$S/$name-$b-$arm.log" 2>&1
    echo "$name $b $arm exit=$?"
  done
}

for b in 600 1200; do
  shot quake2 $b --app=quake2_demo "--args=+set vid_ref soft +map demo1" \
    --screen=800x600 --batch-size=20000
done
for b in 400 830; do
  shot mw3 $b --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5
done
for b in 700 1400; do
  shot heroes2 $b --app=heroes2_demo --batch-size=20000 --repaint-every=50
done
echo DONE
