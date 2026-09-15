#!/bin/bash
# Collect the GAMEPLAY and LOADING hot-block working sets that section 4b of
# docs/hot-loop-vocabulary-2026-09.md reads. The six windows of section 2 were
# menus, intros and boot; these are the same emulator, driven into the running
# game and, separately, over the launch-to-first-gameplay-frame stretch.
#
# Two things make this different from collect-win98.sh:
#
#   * --handler-hist-start=N / --handler-hist-stop=M arm the histogram and the
#     --hot-block-dump only over a LATE batch range, so the gameplay window is
#     not diluted by the menus it had to walk through to get there. No tool
#     change was needed: the dump already covers exactly the armed window.
#   * the input schedules are the ones the repo's own gameplay tests use
#     (test/test-mw3-gameplay.js, test-rct-gameplay.js, test-heroes2-gameplay.js,
#     test-gta2-demo-gameplay.js), so "this window is gameplay" is the same
#     claim those tests assert, and every run here also writes a PNG.
#
# Every run is capped by --max-seconds inside an outer `timeout 290`. The box
# sat at load 10-84 throughout, and several windows hit the time cap rather
# than the batch cap: shares WITHIN a window are unaffected and are the only
# thing quoted.
W=/Users/vg/Documents/projects/phone/wine-assembly/.claude/worktrees/agent-aae3b984e394a47eb
S=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/hotloops-gameplay/win98
mkdir -p "$S"
cd "$W"

run() {
  name=$1; from=$2; to=$3; shift 3
  echo "=== $name ($from..$to) ==="
  timeout 290 node test/run.js "$@" \
    --no-build --quiet-api --quiet-blocks --no-close \
    --handler-hist --handler-hist-thread=0 \
    --handler-hist-start="$from" --handler-hist-stop="$to" \
    --hot-block-dump="$S/$name-hot.txt" \
    > "$S/$name-run.log" 2>&1
  echo "  exit=$? lines=$(wc -l < "$S/$name-hot.txt" 2>/dev/null || echo 0)"
}

# ---- Quake II demo: soft renderer, demo1. Playback is live between batch
# 2500 (console still up after InitGame) and 5000 (cockpit view, HUD).
Q2="--app=quake2_demo --args=+set vid_ref soft +map demo1 --screen=800x600 --batch-size=20000"
run quake2-loading  0    2600  $Q2 --max-batches=2600  --max-seconds=230
run quake2-gameplay 4000 20000 $Q2 --max-batches=20000 --max-seconds=230

# ---- MechWarrior 3 demo: test/test-mw3-gameplay.js's exact instant-action
# route. Its second wait-canvas-dark-pixels matched at batch 884, so 920 is
# inside the cockpit.
MW3ROUTE='200:relmousemove:-199:0,203:relmousemove:0:-23,210:mousedown:65:210,225:mouseup:65:210,270:keydown:65,280:keyup:65,300:keydown:67,310:keyup:67,330:keydown:69,340:keyup:69,370:relmousemove:282:0,373:relmousemove:0:84,385:mousedown:423:320,405:mouseup:423:320,450:relmousemove:-282:0,453:relmousemove:0:-84,465:mousedown:65:210,485:mouseup:65:210,550:relmousemove:67:0,553:relmousemove:0:-58,565:mousedown:150:135,585:mouseup:150:135,620:relmousemove:215:0,623:relmousemove:0:145,635:mousedown:423:320,655:mouseup:423:320,700:wait-canvas-dark-pixels:5000:30000:900,770:relmousemove:115:0,773:relmousemove:0:88,790:mousedown:576:432,820:mouseup:576:432,830:wait-canvas-dark-pixels:85000:140000:900'
MW3="--app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5"
run mw3-loading  0   830  $MW3 --max-batches=830  --max-seconds=245 --input="$MW3ROUTE"
run mw3-gameplay 920 1400 $MW3 --max-batches=1400 --max-seconds=250 \
  --input="$MW3ROUTE,950:png:$S/mw3-gp-950.png"

# ---- GTA2 demo: Enter at batch 3000 starts the mission; the city is up from
# ~3500 on (HUD, mission text, player sprite).
GTA2="--app=gta2_demo --batch-size=1000 --dx-slot=7"
run gta2-loading  0    3000 $GTA2 --max-batches=3000 --max-seconds=200 \
  --input="2900:png:$S/gta2-load-end.png"
run gta2-gameplay 4500 9000 $GTA2 --max-batches=9000 --max-seconds=220 \
  --input="3000:di-keydown:13,3100:di-keyup:13,5000:di-keydown:38,6000:di-keyup:38,6200:di-keydown:37,6600:di-keyup:37,6800:di-keydown:38,8000:di-keyup:38,8900:png:$S/gta2-gp-end.png"

# ---- RollerCoaster Tycoon: test/test-rct-gameplay.js's click sequence, as an
# --input schedule. Forest Frontiers is simulating from ~batch 4250.
RCT="--app=rct --batch-size=200000 --repaint-every=1000000"
RCTIN='3000:click:198:430,3200:click:310:166,4200:click:428:157'
run rct-loading  0    4250 $RCT --max-batches=4250 --max-seconds=245 \
  --input="$RCTIN,4240:png:$S/rct-load-end.png"
run rct-gameplay 4400 6000 $RCT --max-batches=6000 --max-seconds=245 \
  --input="$RCTIN,5900:png:$S/rct-5900.png"

# ---- Heroes II demo: test/test-heroes2-gameplay.js's three menu clicks, then
# map scrolling and clicks on the adventure map.
H2="--app=heroes2_demo --batch-size=20000 --repaint-every=50"
H2IN='400:click:535:225,700:click:528:68,1200:click:283:373'
run heroes2-loading  0    1400 $H2 --max-batches=1400 --max-seconds=250 \
  --input="$H2IN,1390:png:$S/h2-load-end.png"
run heroes2-gameplay 1500 3000 $H2 --max-batches=3000 --max-seconds=250 \
  --input="$H2IN,1700:mousemove:600:240,1800:mousemove:620:240,1900:click:400:300,2100:mousemove:20:240,2300:click:300:250,2700:click:350:280,2900:png:$S/h2-2900.png"

# ---- Loading-only windows. Caesar III's menu clicks do not register at this
# commit (test/test-caesar3-gameplay.js fails with '' !== 'Codex'), so it has a
# boot window and no city window; StarCraft stalls at its title, as the
# re-notes say; Diablo's town needs ~4x the wall clock this cap allows.
run caesar3-loading 0 1600 --app=caesar3_demo --screen=800x600 --batch-size=50000 \
  --repaint-every=1000000 --max-batches=1600 --max-seconds=245 \
  --input="700:mousemove:400:300,760:mousedown:400:300,800:mouseup:400:300,1550:png:$S/c3-load-end.png"
run starcraft-loading 0 1500 --app=starcraft_shareware --batch-size=200000 \
  --max-batches=1500 --max-seconds=200 --png="$S/sc-end.png"
run diablo-loading 0 400 --app=diablo_shareware --batch-size=200000 \
  --tick-ms-per-batch=400 --max-batches=400 --max-seconds=250 \
  --input='63:keydown:27,64:keyup:27,100:keydown:27,101:keyup:27,260:click:320:214,300:dblclick:320:298,350:click:320:331,360:keypress:87,363:keypress:97,366:keypress:114' \
  --png="$S/diablo-loading-end.png"
echo DONE
