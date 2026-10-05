#!/bin/bash
# Section 27 (round 17), part A: where the executor's entries go once the leaf
# contract is widened to a block that carries a fallback.
#
# Three arms, and the middle one is the point:
#
#   off   the executor off entirely -- the baseline the DECODE column has to be
#         read against (an install must not cost a decode, sections 22/23).
#   r16   --block-exec --no-block-exec-leaf-fb, i.e. round 16 exactly on THIS
#         build: the pure leaf H463 services the no-fallback one-block
#         descriptors and everything else pays the general region function.
#   on    --block-exec, i.e. round 17: a fallback-carrying one-block descriptor
#         takes H464 instead.
#
# An A/B against `--no-block-exec` alone would vary the whole family; the r16
# arm is what isolates this round's change, the same way round 16's
# --no-block-exec-x87-regions arm did.
#
# The windows are section 25.3's, unchanged, so the leafEntries/genEntries
# columns read straight against that table. quake2-gameplay is 8000 batches
# rather than round 14's 20000 because 20000 does not fit the 60s-per-run
# guard; heroes2-gameplay is 3000.
#
# ONLY=name runs one window; MS= sets the in-process wall-clock guard and TO=
# the external one. An arm that did not REACH $HE is not a measurement -- the
# handler-hist window never opened -- so check the `N batches in Ns` line of
# every log before comparing anything.
S=${S:-/tmp/r17-windows}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

arms() {
  local name=$1; shift
  for arm in off r16 on; do
    local BE="--block-exec --block-exec-stats"
    [ "$arm" = off ] && BE="--no-block-exec"
    local X=""
    [ "$arm" = r16 ] && X="--no-block-exec-leaf-fb"
    timeout ${TO:-1000} node test/run.js "$@" $BE $X \
      --no-build --quiet-api --quiet-blocks --no-close --verbose \
      --handler-hist --handler-hist-thread=0 \
      --handler-hist-start=$HS --handler-hist-stop=$HE \
      --max-batches=$HE --max-seconds=${MS:-900} \
      > "$S/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

H2IN='400:click:535:225,700:click:528:68,1200:click:283:373'

if [ -z "$ONLY" ] || [ "$ONLY" = quake2-gameplay ]; then
HS=4000 HE=8000 arms quake2-gameplay \
  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 \
  --batch-size=20000
fi
if [ -z "$ONLY" ] || [ "$ONLY" = heroes2-gameplay ]; then
HS=1500 HE=3000 arms heroes2-gameplay \
  --app=heroes2_demo --batch-size=20000 --input="$H2IN"
fi
echo DONE
