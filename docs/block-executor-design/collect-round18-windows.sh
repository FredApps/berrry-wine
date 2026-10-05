#!/bin/bash
# Section 28 (round 18): what does letting a region member end in an
# UNMODELLED terminator -- a call, a ret, an indirect branch, a loop/jecxz --
# and side-exit into threaded execution there buy, and what did it cost?
#
# Three arms per window, and the middle one is round 17 on this build:
#
#   off   the executor off entirely -- the baseline the DECODE column is read
#         against (an install must not cost a decode, sections 22/23).
#   r17   --block-exec --no-block-exec-tail-exits: term_kind 10 is refused, so
#         a block ending in a call is a `termNotModelled` classify refusal and
#         the region stops at the edge into it.
#   on    --block-exec, i.e. round 18.
#
# The CENSUS is read off the r17 arm, because the counters that answer "how
# many regions WOULD have been admitted" are bumped whether or not the switch
# is on: `tailExits refusals/wouldAdmit/wouldGrow` on the r17 line is the
# opportunity, and `admitted/regions/members/runs` on the `on` line is what was
# realised. That is the only reason the two arms are run with the same
# --block-exec-stats.
#
# FIXED WORK, NOT FIXED TIME. --block-exec-stats is cumulative over the run,
# so the window IS the run configuration (app + batch size + max-batches +
# input) and no --handler-hist window is needed -- the same rule
# collect-r14-windows.sh states. That matters here because this box sits at
# loadavg 5-40: a wall-clock-capped arm stops at a different batch from its
# partner and every counter below it then describes a different amount of
# work. --max-seconds is a GUARD that must not fire; read-round18.sh checks
# the `N batches in Ns` line of every log and refuses to tabulate an arm that
# did not reach $HE.
#
# ONLY=name runs one window; MS= sets the in-process guard, TO= the external
# one.
S=${S:-/tmp/r18-windows}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

arms() {
  local name=$1; shift
  for arm in off r17 on; do
    local BE="--block-exec --block-exec-stats"
    [ "$arm" = off ] && BE="--no-block-exec"
    local X=""
    [ "$arm" = r17 ] && X="--no-block-exec-tail-exits"
    # The wanted batch count is stamped into the log so read-round18.js can tell
    # a completed arm from one the --max-seconds guard cut short. run.js does
    # not echo its own argv, and "how much work did this arm do" is the one
    # question the whole comparison rests on.
    echo "collect-round18 want-batches=$HE arm=$arm window=$name" \
      > "$S/$name-$arm.log"
    timeout ${TO:-1000} node test/run.js "$@" $BE $X \
      --no-build --quiet-api --quiet-blocks --no-close --verbose \
      --max-batches=$HE --max-seconds=${MS:-280} \
      >> "$S/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

H2IN='400:click:535:225,700:click:528:68,1200:click:283:373'
RCTIN='3000:click:198:430,3200:click:310:166,4200:click:428:157'
C3IN='700:mousemove:400:300,760:mousedown:400:300,800:mouseup:400:300'

if [ -z "$ONLY" ] || [ "$ONLY" = quake2-gameplay ]; then
HE=${QB:-3000} arms quake2-gameplay \
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
