#!/bin/bash
# Section 17 (round 12, OPEN-6): what letting the executor accept x87-carrying
# blocks buys, per window.
#
# Both arms carry --x87-fusion, because the whole point of the ordering change
# is that the fold runs FIRST and the executor sees its fused op -- an arm
# without the fold would be measuring a different question. `off` is
# the default, which is round 11's blanket decline of any block
# holding an x87 op; `on` is --block-exec-x87.
#
# Windows are section 4b/4c's, at 4c's batch ranges, so the coverage numbers can
# be read beside the x87 shares that motivated the change. --max-batches is the
# window's own stop batch so a run cut short by --max-seconds shows up as a
# short window rather than quietly giving the two arms different guest work.
S=${S:-/tmp/r12-x87}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

arms() {
  local name=$1; shift
  for arm in off on; do
    local X=""
    [ "$arm" = on ] && X="--block-exec-x87"
    /usr/bin/time -p timeout 290 node test/run.js "$@" --x87-fusion $X \
      --block-exec --block-exec-stats \
      --no-build --quiet-api --quiet-blocks --no-close \
      --handler-hist --handler-hist-thread=0 \
      --handler-hist-start=$HS --handler-hist-stop=$HE \
      --max-batches=$HE --max-seconds=270 \
      > "$S/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

HS=4000 HE=5000 arms quake2-gameplay \
  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000
HS=920 HE=1000 arms mw3-gameplay \
  --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5
echo DONE
