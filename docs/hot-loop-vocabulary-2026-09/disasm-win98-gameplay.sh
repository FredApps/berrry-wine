#!/bin/bash
# Disassemble + weight the hot blocks of every gameplay/loading window
# collected for section 4b of docs/hot-loop-vocabulary-2026-09.md.
W=/Users/vg/Documents/projects/phone/wine-assembly/.claude/worktrees/agent-aae3b984e394a47eb
S=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/hotloops-gameplay
cd "$W"
C=test/binaries/candidates

do1() {
  win=$1; exe=$2
  [ -f "$S/win98/$win-hot.txt" ] || { echo "skip $win"; return; }
  node tools/hot-loop-corpus.js win98 --app=$win \
    --log="$S/win98/$win-run.log" --hot="$S/win98/$win-hot.txt" \
    --exe="$exe" --top=25 --max-ops=48 --out="$S/loops" 2>&1 | tail -30
}

Q=$C/quake-2-demo-installer/installed-extracted/Install/Data/quake2.exe
M=binaries/shareware/mw3/ex/Program_Files/mech3demo.exe
[ -f "$M" ] || M=test/binaries/shareware/mw3/ex/Program_Files/mech3demo.exe
G=$C/gta2-demo/installed/Program_Executable_Files/gta2.exe
R=test/binaries/shareware/rct/English/RCT.exe
H=$C/heroes-2-demo/files/H2DEMOW.EXE
C3=$C/caesar-3-demo/installed/c3.exe
SC=$C/starcraft-shareware/installed/starcraft.exe
D=$C/diablo-shareware/installed/diablo_s.exe

do1 quake2-gameplay  $Q
do1 quake2-loading   $Q
do1 mw3-gameplay     $M
do1 mw3-loading      $M
do1 gta2-gameplay    $G
do1 gta2-loading     $G
do1 rct-gameplay     $R
do1 rct-loading      $R
do1 heroes2-gameplay $H
do1 heroes2-loading  $H
do1 caesar3-loading  $C3
do1 starcraft-loading $SC
do1 diablo-loading   $D
echo DONE
