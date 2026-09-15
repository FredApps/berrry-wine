#!/bin/bash
# tl;dr: turn the per-window logs into one TSV. Columns are pulled out of the
# three lines the executor prints at exit: `cache: block decodes N` for decodes,
# `block-exec: M ... installs/entries/native%` for the one-block arm, and
# `block-exec-regions: M ... installs ... ops1 ... opsMulti` for the region arm.
# opsMulti% is opsMulti/(ops1+opsMulti), i.e. the share of executed uops that
# came from a multi-block region rather than a single-block descriptor.
S=${S:-/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/r14win}
printf 'window\tdecodes\tinst1\tinstRgn\tentries\tnative%%\topsMulti%%\n'
for n in quake2-loading quake2-gameplay mw3-loading mw3-gameplay gta2-loading \
         gta2-gameplay rct-loading rct-gameplay heroes2-loading heroes2-gameplay \
         caesar3-loading starcraft-loading diablo-loading; do
  f="$S/$n.log"
  [ -f "$f" ] || { printf '%s\t-\t-\t-\t-\t-\t-\n' "$n"; continue; }
  awk -v W="$n" '
    /^cache: block decodes/ { dec=$4 }
    /^block-exec: M/ { for(i=1;i<=NF;i++){ if($i=="installs")i1=$(i+1); if($i=="entries")en=$(i+1); if($i=="native%")nv=$(i+1) } }
    /^block-exec-regions: M  armed/ { for(i=1;i<=NF;i++){ if($i=="installs")ir=$(i+1); if($i=="ops1")o1=$(i+1); if($i=="opsMulti")om=$(i+1) } }
    END {
      om_pct = (o1+om) > 0 ? 100*om/(o1+om) : 0
      printf "%s\t%s\t%s\t%s\t%s\t%s\t%.2f\n", W, dec, i1, ir, en, nv, om_pct
    }' "$f"
done
