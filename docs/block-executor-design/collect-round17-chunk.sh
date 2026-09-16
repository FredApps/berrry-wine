#!/bin/bash
# Section 27 (round 17), part B: stop the two descriptor families sharing one
# 16KB per-page chunk blindly.
#
# Section 26.2 priced the sharing -- round 15's 2,925 extra one-block x87
# descriptors took `nrChunkFull` from 2,714 to 2,863 and region installs from
# 1,186 to 738, at a 3.3% install rate where a 1% shift in decline mass moves
# installs by 38% -- and named it as the third it was not fixing. This is the
# fix: a per-page RESERVE inside the descriptor chunk that only the ONE-BLOCK
# family has to leave behind it, so a region install gets first refusal on the
# page's last bytes.
#
# The two X87 arms are the ones section 26.7's bar is written against, and the
# reserve is swept inside each because a reserve is not free: every byte of it
# is a one-block descriptor that does not install, and the question is whether
# the regions bought with it are worth more than the one-block coverage sold.
#
# DECODES ARE THE KILL RULE (sections 22/23): a reserve that recovers region
# installs by pushing one-block installs off a page and making the page compile
# more often has bought nothing. Every row must hold decodes <= the off arm's
# +5%, and the `off` (no executor) arm is collected for exactly that reason.
#
# RESERVES= overrides the sweep, MS=/TO= the guards, ONLY= the window.
S=${S:-/tmp/r17-chunk}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"
RESERVES=${RESERVES:-"0 2048 4096 6144"}

run_arm() {                # $1 tag, rest: run.js args; window is $HS..$HE
  local tag=$1; shift
  timeout ${TO:-1000} node test/run.js "$@" \
    --no-build --quiet-api --quiet-blocks --no-close --verbose \
    --handler-hist --handler-hist-thread=0 \
    --handler-hist-start=$HS --handler-hist-stop=$HE \
    --max-batches=$HE --max-seconds=${MS:-900} \
    > "$S/$tag.log" 2>&1
  echo "$tag exit=$?"
}

window() {
  local name=$1; shift
  run_arm "$name-noexec" "$@" --no-block-exec
  for x in nox87 x87; do
    local X=""
    [ "$x" = x87 ] && X="--x87-fusion --block-exec-x87"
    for r in $RESERVES; do
      run_arm "$name-$x-r$r" "$@" --block-exec --block-exec-stats $X \
        --page-desc-rg-reserve=$r
    done
  done
}

if [ -z "$ONLY" ] || [ "$ONLY" = quake2-gameplay ]; then
HS=4000 HE=8000 window quake2-gameplay \
  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 \
  --batch-size=20000
fi
echo DONE
