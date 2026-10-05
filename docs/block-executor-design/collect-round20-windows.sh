#!/bin/bash
# Round 20: the round-19 four-corner table (off / chain / exec / both) on two
# windows the earlier rounds never had -- Diablo and StarCraft in GAMEPLAY.
# caesar3 is one short-block app; the executor/chaining overlap finding needs
# a Blizzard engine (Storm.dll clusters, 82-150k block entries per frame) to
# be more than a one-app statement.
#
# Same rules as collect-round19-windows.sh: fixed work (the batch count is
# stamped into each log and read-round19.js refuses a short arm), one
# cooperative guest instance (--no-threads: with real threads the counters are
# read off the main instance and sit at zero, docs/re-notes/starcraft-shareware.md),
# and the input route is the one the re-notes proved reaches gameplay.
#
# ONLY=name runs one window; ARMS="off chain" runs a subset; MS=/TO= guards.
S=${S:-/tmp/r20-windows}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

arms() {
  local name=$1; shift
  for arm in ${ARMS:-off chain exec both}; do
    local F="--no-block-exec"
    [ "$arm" = chain ] && F="--no-block-exec --block-chain"
    [ "$arm" = exec ] && F="--block-exec --block-exec-stats"
    [ "$arm" = both ] && F="--block-exec --block-exec-stats --block-chain"
    echo "collect-round19 want-batches=$HE arm=$arm window=$name" \
      > "$S/$name-$arm.log"
    timeout ${TO:-300} node test/run.js "$@" $F --no-threads \
      --no-build --quiet-api --quiet-blocks --no-close --verbose \
      --max-batches=$HE --max-seconds=${MS:-120} \
      >> "$S/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

# The memory route (Single Player -> Warrior -> name -> Tristram, class
# buttons need BN_DOUBLECLICKED) was written against 1000-block batches and no
# longer clears the intro: at the default size the guest sits in smackw32's
# time-paced logo for the whole run and every frame is blank. At
# --batch-size=20000 the main menu is up between batch 1600 and 1800 (PNG scan
# 2026-09-16), so the same clicks are shifted by +1400. Tristram is on screen
# from batch 2800; the window is 2800..4000 of town with no further input.
DIN='125:keydown:27,126:keyup:27,200:keydown:27,201:keyup:27,1920:click:320:214,2000:dblclick:320:298,2100:click:320:331,2120:keypress:87,2125:keypress:97,2130:keypress:114,2200:keydown:13,2201:keyup:13'
# docs/re-notes/starcraft-shareware.md "fast route": click through the
# cinematic (670), mission card (990), briefing Start (1140), Tips modal
# (1540); unobstructed gameplay from ~1700 (PNG-verified 2026-09-16). NO
# --count here: a hit-counter arms $dbg_any, and with $dbg_any set chaining is
# inert (the first pass of this window read chainHits 0 for exactly that
# reason). Gate gameplay with a PNG, not a counter.
SCIN='100:focus-main-window,120:keydown:27,125:keyup:27,660:mousemove:320:240,670:mousedown:320:240,680:mouseup:320:240,980:mousemove:320:240,990:mousedown:320:240,1000:mouseup:320:240,1130:mousemove:545:393,1140:mousedown:545:393,1150:mouseup:545:393,1530:mousemove:198:261,1540:mousedown:198:261,1550:mouseup:198:261'

if [ -z "$ONLY" ] || [ "$ONLY" = diablo-gameplay ]; then
HE=${DB:-4000} arms diablo-gameplay \
  --app=diablo_shareware --batch-size=20000 --repaint-every=200 --input="$DIN"
fi
if [ -z "$ONLY" ] || [ "$ONLY" = starcraft-gameplay ]; then
HE=${SB:-2200} arms starcraft-gameplay \
  --app=starcraft_shareware --batch-size=100000 --repaint-every=50 \
  --input="$SCIN"
fi
echo DONE
