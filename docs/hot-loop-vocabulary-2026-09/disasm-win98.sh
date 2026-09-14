#!/bin/bash
W=/Users/vg/Documents/projects/phone/wine-assembly/.claude/worktrees/agent-ae46a3568ca4952b9
S=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/hotloops
cd "$W"
C=test/binaries/candidates
do1() {
  app=$1; exe=$2
  [ -f "$S/win98/$app-hot.txt" ] || { echo "skip $app"; return; }
  node tools/hot-loop-corpus.js win98 --app=$app \
    --log="$S/win98/$app-run.log" --hot="$S/win98/$app-hot.txt" \
    --exe="$exe" --top=25 --max-ops=48 --out="$S/loops" 2>&1 | tail -30
}
do1 quake2  $C/quake-2-demo-installer/installed-extracted/Install/Data/quake2.exe
do1 mw3     binaries/shareware/mw3/ex/Program_Files/mech3demo.exe
do1 diablo  $C/diablo-shareware/installed/diablo_s.exe
do1 caesar3 $C/caesar-3-demo/installed/c3.exe
do1 heroes2 $C/heroes-2-demo/files/H2DEMOW.EXE
do1 starcraft $C/starcraft-shareware/installed/starcraft.exe
