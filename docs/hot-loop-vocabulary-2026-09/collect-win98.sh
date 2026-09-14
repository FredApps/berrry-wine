#!/bin/bash
# Collect hot-block working sets for the Win98 corpus.
# Each run: --handler-hist (retired-op census) + --hot-block-dump (whole
# executed block working set, "0xADDR hits" per line).
# Capped at 180s of guest batch loop via --max-seconds, and under `timeout`
# as the outer harness guard.
W=/Users/vg/Documents/projects/phone/wine-assembly/.claude/worktrees/agent-ae46a3568ca4952b9
S=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/hotloops/win98
mkdir -p "$S"
cd "$W"

run() {
  name=$1; shift
  echo "=== $name ==="
  timeout 300 node test/run.js "$@" \
    --no-threads --quiet-api --no-close \
    --handler-hist --handler-hist-thread=0 \
    --hot-block-dump="$S/$name-hot.txt" \
    > "$S/$name-run.log" 2>&1
  echo "  exit=$? lines=$(wc -l < "$S/$name-hot.txt" 2>/dev/null || echo 0)"
}

run quake2 --app=quake2_demo --args='+set vid_ref soft +map demo1' \
  --batch-size=200000 --max-batches=300 --max-seconds=180
run mw3 --app=mw3 --batch-size=200000 --max-batches=12 --max-seconds=180
run diablo --app=diablo_shareware --batch-size=200000 --max-batches=4000 --max-seconds=180
run caesar3 --app=caesar3_demo --batch-size=20000 --max-batches=40000 --max-seconds=180
run heroes2 --app=heroes2_demo --batch-size=20000 --max-batches=40000 --max-seconds=180 \
  --input='400:click:535:225,700:click:528:68,1200:click:283:373'
run starcraft --app=starcraft_shareware --batch-size=200000 --max-batches=4000 --max-seconds=180
echo DONE
