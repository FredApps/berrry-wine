#!/bin/bash
# Section 4c: how much of the x87 work in the 3D gameplay windows does the
# semantic x87 fold (H449-H453) already catch, and what declines the rest.
#
# Each window is run TWICE over the same batch range -- fold off, fold on --
# and the stop batch is also the --max-batches cap, so a run that ended on
# --max-seconds instead is visible in the log as a short window rather than
# quietly making the two arms cover different guest work. That is the whole
# reason these windows are shorter than section 4b's: the box sat at load
# 7-27 throughout, and a 20,000-batch quake2 window finished in 83s at load 8
# and not at all at load 23.
#
# --x87-fusion is new. The families were previously reachable only from the
# browser (window.WineSuperops.x87Fusion), so every headless number about them
# before this commit was measured with the fold switched OFF.
S=${S:-/tmp/x87-4c}
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$W"
mkdir -p "$S/win98"

arms() {              # name, app-args..., window start/stop as $HS/$HE
  name=$1; shift
  for arm in off on; do
    X=""
    [ "$arm" = on ] && X="--x87-fusion"
    /usr/bin/time -p timeout 290 node test/run.js "$@" $X \
      --no-build --quiet-api --quiet-blocks --no-close \
      --handler-hist --handler-hist-thread=0 \
      --handler-hist-start=$HS --handler-hist-stop=$HE \
      --loopmatch-stats --max-batches=$HE --max-seconds=270 \
      --hot-block-dump="$S/win98/$name-$arm-hot.txt" \
      > "$S/win98/$name-$arm.log" 2>&1
    echo "$name $arm exit=$?"
  done
}

MW3ROUTE='200:relmousemove:-199:0,203:relmousemove:0:-23,210:mousedown:65:210,225:mouseup:65:210,270:keydown:65,280:keyup:65,300:keydown:67,310:keyup:67,330:keydown:69,340:keyup:69,370:relmousemove:282:0,373:relmousemove:0:84,385:mousedown:423:320,405:mouseup:423:320,450:relmousemove:-282:0,453:relmousemove:0:-84,465:mousedown:65:210,485:mouseup:65:210,550:relmousemove:67:0,553:relmousemove:0:-58,565:mousedown:150:135,585:mouseup:150:135,620:relmousemove:215:0,623:relmousemove:0:145,635:mousedown:423:320,655:mouseup:423:320,700:wait-canvas-dark-pixels:5000:30000:900,770:relmousemove:115:0,773:relmousemove:0:88,790:mousedown:576:432,820:mouseup:576:432,830:wait-canvas-dark-pixels:85000:140000:900'

HS=4000 HE=5000 arms quake2-gameplay \
  --app=quake2_demo "--args=+set vid_ref soft +map demo1" --screen=800x600 --batch-size=20000
HS=920 HE=1000 arms mw3-gameplay \
  --app=mw3 --no-threads --copy-superops --batch-size=200000 --dx-slot=5 --input="$MW3ROUTE"
HS=4500 HE=5200 arms gta2-gameplay \
  --app=gta2_demo --batch-size=1000 --dx-slot=7 \
  --input='3000:di-keydown:13,3100:di-keyup:13,5000:di-keydown:38'
# heroes2 is measured once, and once is enough: its `x87:` line reads zero.
HS=1500 HE=2200 arms heroes2-gameplay \
  --app=heroes2_demo --batch-size=20000 --repaint-every=50 \
  --input='400:click:535:225,700:click:528:68,1200:click:283:373,1700:mousemove:600:240,1900:click:400:300,2100:mousemove:20:240'

# Then disassemble the fold-off hot blocks and apply the fold's own grammar to
# them, which is what names the declines.
Q=test/binaries/candidates/quake-2-demo-installer/installed-extracted/Install/Data/quake2.exe
M=test/binaries/shareware/mw3/ex/Program_Files/mech3demo.exe
G=test/binaries/candidates/gta2-demo/installed/Program_Executable_Files/gta2.exe
for pair in "quake2:$Q" "mw3:$M" "gta2:$G"; do
  app=${pair%%:*}; exe=${pair#*:}
  node tools/hot-loop-corpus.js win98 --app=$app-gameplay-x87 \
    --log="$S/win98/$app-gameplay-off.log" --hot="$S/win98/$app-gameplay-off-hot.txt" \
    --exe="$exe" --top=120 --max-ops=64 --out="$S/loops" > /dev/null
  node docs/hot-loop-vocabulary-2026-09/x87-classify.js \
    "$S/loops/win98/$app-gameplay-x87" --top=20 \
    --json="$S/$app-x87.json" | tee "$S/$app-classify.txt"
done
echo DONE
