#!/bin/bash
# Section 26 (round 16): what x87 AS A REGION MEMBER OP buys, per window.
#
# Four arms, because round 16 splits round 15's single question in two:
#
#   noexec  the executor off entirely -- the baseline the DECODE counts have to
#           be read against (an install must not cost a decode, section 22).
#   off     --block-exec, x87 declined everywhere.
#   r15     --block-exec --block-exec-x87 --no-block-exec-x87-regions, i.e.
#           round 15 exactly: x87 in one-block descriptors, refused in region
#           members. This is the arm section 24.5's table was taken on.
#   on      --block-exec --block-exec-x87, i.e. round 16: x87 in both.
#
# Every arm carries --x87-fusion. An arm without the fold measures a different
# question -- the whole design is that the fold runs FIRST and the executor
# sees its fused op.
#
# ONLY=name runs one window; MS=/TO= set the in-process and external guards.
# An arm that did not REACH $HE is not a measurement at all -- the handler-hist
# window never opened -- so check the `N batches in Ns` line of every log
# before comparing anything.
S=${S:-/tmp/r16x87}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

arms() {
  local name=$1; shift
  for arm in noexec off r15 on; do
    local X=""
    [ "$arm" = r15 ] && X="--block-exec-x87 --no-block-exec-x87-regions"
    [ "$arm" = on ] && X="--block-exec-x87"
    local BE="--block-exec --block-exec-stats"
    [ "$arm" = noexec ] && BE="--no-block-exec"
    timeout ${TO:-1000} node test/run.js "$@" --x87-fusion $X $BE \
      --no-build --quiet-api --quiet-blocks --no-close --verbose \
      --handler-hist --handler-hist-thread=0 \
      --handler-hist-start=$HS --handler-hist-stop=$HE \
      --max-batches=$HE --max-seconds=${MS:-900} \
      > "$S/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

if [ -z "$ONLY" ] || [ "$ONLY" = quake2-gameplay ]; then
HS=4000 HE=5000 arms quake2-gameplay \
  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000
fi
if [ -z "$ONLY" ] || [ "$ONLY" = mw3-gameplay ]; then
HS=920 HE=1000 arms mw3-gameplay \
  --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5
fi
echo DONE
