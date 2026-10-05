#!/bin/bash
# Section 24 (round 15): what the CHEAP fused-x87 micro-op (TU_X87RUN) buys,
# per window.
#
# Same two windows and the same two arms as collect-round12-x87.sh, because the
# question is the same one section 17.5 answered with "the lever loses
# coverage": `off` is --block-exec with x87 declined, `on` is
# --block-exec --block-exec-x87. Both arms carry --x87-fusion, since the whole
# design is that the fold runs FIRST and the executor sees its fused op -- an
# arm without the fold is a different question.
#
# Three arms, not two: `noexec` is the executor off entirely, which is the
# baseline the decode counts have to be read against (an install must not cost
# a decode -- section 22).
S=${S:-/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/r15x87}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

arms() {
  local name=$1; shift
  for arm in noexec off on; do
    local X=""
    [ "$arm" = on ] && X="--block-exec-x87"
    local BE="--block-exec --block-exec-stats"
    [ "$arm" = noexec ] && BE="--no-block-exec"
    timeout ${TO:-300} node test/run.js "$@" --x87-fusion $X $BE \
      --no-build --quiet-api --quiet-blocks --no-close --verbose \
      --handler-hist --handler-hist-thread=0 \
      --handler-hist-start=$HS --handler-hist-stop=$HE \
      --max-batches=$HE --max-seconds=${MS:-270} \
      > "$S/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

# ONLY=name runs one window, so a truncated arm can be re-taken on its own
# budget without re-running the other. An arm that did not REACH $HE is not a
# measurement at all -- the handler-hist window never opened -- so check the
# `N batches in Ns` line of every log before comparing anything.
if [ -z "$ONLY" ] || [ "$ONLY" = quake2-gameplay ]; then
HS=4000 HE=5000 arms quake2-gameplay \
  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000
fi
if [ -z "$ONLY" ] || [ "$ONLY" = mw3-gameplay ]; then
HS=920 HE=1000 arms mw3-gameplay \
  --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5
fi
echo DONE
