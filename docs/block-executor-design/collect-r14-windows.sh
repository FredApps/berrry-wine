#!/bin/bash
# tl;dr: run the 13 section-4b windows once each with the block executor armed,
# and keep the whole log. The columns wanted (decodes / installs / entries /
# native% / opsMulti%) all come out of --block-exec-stats, which is cumulative
# over the run, so no --handler-hist window is needed -- the window IS the run
# configuration (app + batch size + max-batches + input), exactly as
# collect-round12-carry.sh defines it.
S=${S:-/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/r14win}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S"

run1() {
  local name=$1; shift
  timeout 300 node test/run.js "$@" \
    --block-exec --block-exec-stats --verbose \
    --no-build --quiet-api --quiet-blocks --no-close \
    --max-seconds=170 \
    > "$S/$name.log" 2>&1
  echo "$name exit=$? armed=$(grep -c 'armed yes' "$S/$name.log")"
}

MW3ROUTE='200:relmousemove:-199:0,203:relmousemove:0:-23,210:mousedown:65:210,225:mouseup:65:210,270:keydown:65,280:keyup:65,300:keydown:67,310:keyup:67,330:keydown:69,340:keyup:69,370:relmousemove:282:0,373:relmousemove:0:84,385:mousedown:423:320,405:mouseup:423:320,450:relmousemove:-282:0,453:relmousemove:0:-84,465:mousedown:65:210,485:mouseup:65:210,550:relmousemove:67:0,553:relmousemove:0:-58,565:mousedown:150:135,585:mouseup:150:135,620:relmousemove:215:0,623:relmousemove:0:145,635:mousedown:423:320,655:mouseup:423:320,700:wait-canvas-dark-pixels:5000:30000:900,770:relmousemove:115:0,773:relmousemove:0:88,790:mousedown:576:432,820:mouseup:576:432,830:wait-canvas-dark-pixels:85000:140000:900'
RCTIN='3000:click:198:430,3200:click:310:166,4200:click:428:157'
H2IN='400:click:535:225,700:click:528:68,1200:click:283:373'

run1 quake2-loading  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000 --max-batches=2600
run1 quake2-gameplay --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000 --max-batches=20000
run1 mw3-loading  --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5 --max-batches=830  --input="$MW3ROUTE"
run1 mw3-gameplay --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5 --max-batches=1400 --input="$MW3ROUTE"
run1 gta2-loading  --app=gta2_demo --batch-size=1000 --dx-slot=7 --max-batches=3000
run1 gta2-gameplay --app=gta2_demo --batch-size=1000 --dx-slot=7 --max-batches=9000 --input='3000:di-keydown:13,3100:di-keyup:13,5000:di-keydown:38,6000:di-keyup:38,6200:di-keydown:37,6600:di-keyup:37,6800:di-keydown:38,8000:di-keyup:38'
run1 rct-loading  --app=rct --batch-size=200000 --repaint-every=1000000 --max-batches=4250 --input="$RCTIN"
run1 rct-gameplay --app=rct --batch-size=200000 --repaint-every=1000000 --max-batches=6000 --input="$RCTIN"
run1 heroes2-loading  --app=heroes2_demo --batch-size=20000 --repaint-every=50 --max-batches=1400 --input="$H2IN"
run1 heroes2-gameplay --app=heroes2_demo --batch-size=20000 --repaint-every=50 --max-batches=3000 --input="$H2IN,1700:mousemove:600:240,1800:mousemove:620:240,1900:click:400:300,2100:mousemove:20:240,2300:click:300:250,2700:click:350:280"
run1 caesar3-loading --app=caesar3_demo --screen=800x600 --batch-size=50000 --repaint-every=1000000 --max-batches=1600 --input="700:mousemove:400:300,760:mousedown:400:300,800:mouseup:400:300"
run1 starcraft-loading --app=starcraft_shareware --batch-size=200000 --max-batches=1500
run1 diablo-loading --app=diablo_shareware --batch-size=200000 --tick-ms-per-batch=400 --max-batches=400 --input='63:keydown:27,64:keyup:27,100:keydown:27,101:keyup:27,260:click:320:214,300:dblclick:320:298,350:click:320:331,360:keypress:87,363:keypress:97,366:keypress:114'
echo DONE
