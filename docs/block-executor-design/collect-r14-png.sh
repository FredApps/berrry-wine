#!/bin/bash
# tl;dr: photograph quake2 / heroes2 / rct at two batch budgets each, with the
# block executor off and on, so "does round 14 change what the screen shows"
# is answered by pixels rather than by counters. Every pair is the same command
# except for the one flag, and --no-close is mandatory or the capture races the
# app's own exit (see the false-BLANK-PNG note in CLAUDE.md).
S=${S:-/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/r14png}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

shot() {
  local name=$1 arm=$2; shift 2
  local X="--no-block-exec"
  [ "$arm" = on ] && X="--block-exec"
  timeout 300 node test/run.js "$@" $X \
    --no-build --quiet-api --quiet-blocks --no-close --max-seconds=170 \
    --png="$S/$name-$arm.png" > "$S/$name-$arm.log" 2>&1
  echo "$name $arm exit=$? bytes=$(stat -f %z "$S/$name-$arm.png" 2>/dev/null) $(grep -o '[0-9]* batches in [0-9.]*s' "$S/$name-$arm.log" | tail -1)"
}

RCTIN='3000:click:198:430,3200:click:310:166,4200:click:428:157'
H2IN='400:click:535:225,700:click:528:68,1200:click:283:373'

for arm in off on; do
  shot quake2-b600  $arm --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000 --max-batches=600
  shot quake2-b2600 $arm --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000 --max-batches=2600
  shot heroes2-b700  $arm --app=heroes2_demo --batch-size=20000 --repaint-every=50 --max-batches=700  --input="$H2IN"
  shot heroes2-b1400 $arm --app=heroes2_demo --batch-size=20000 --repaint-every=50 --max-batches=1400 --input="$H2IN"
  shot rct-b1500 $arm --app=rct --batch-size=200000 --repaint-every=1000000 --max-batches=1500 --input="$RCTIN"
  shot rct-b3000 $arm --app=rct --batch-size=200000 --repaint-every=1000000 --max-batches=3000 --input="$RCTIN"
done

for n in quake2-b600 quake2-b2600 heroes2-b700 heroes2-b1400 rct-b1500 rct-b3000; do
  echo "== $n"
  node tools/png-diff.js "$S/$n-off.png" "$S/$n-on.png" 2>&1 | head -6
done
echo DONE
