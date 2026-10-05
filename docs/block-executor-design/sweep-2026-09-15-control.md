# `--block-exec` registry sweep

Generated 2026-09-15T21:45:29.599Z — 21 apps, budgets 300/600 batches at `--batch-size=20000`, `--max-seconds=150` under `timeout 180`, 2 apps in flight. Box loadavg 14.11 50.09 62.01 → 39.19 38.33 39.93 over 1558s.

`on-vs-off` is the executor A/B at each budget; `off-vs-off` is the same arm photographed at the two budgets and is the null band the verdict is judged against.

**3** IDENTICAL · **0** PACING · **5** DIFFERENT · **0** CRASH · **0** TIMEOUT · **0** NOPIC · **13** NONDET

`exercised` is the ON arm's `installs`/`entries` at the larger budget: an IDENTICAL row whose executor installed nothing proves nothing about the executor, and this is the column that says which rows those are.

`control` is the off arm at 600 run twice: anything but 0 there means the app is nondeterministic and no on-vs-off number from it counts.

| app | verdict | on-vs-off @300 | on-vs-off @600 | off-vs-off 300→600 | control @600 | exercised (inst/entries/native%) | note |
|---|---|---|---|---|---|---|---|
| abedemo | DIFFERENT | 0 | 3931 (1.280%) | 15784 (5.138%) | 0 | 169/1208032/97.80 | worst 1.280% vs off-vs-off 5.138%, diverging |
| broken_sword_demo | DIFFERENT | 0 | 9222 (3.002%) | 83266 (27.105%) | 0 | 97/28919/94.74 | worst 3.002% vs off-vs-off 27.105%, diverging |
| dx_flip2d | DIFFERENT | 50186 (16.337%) | 40021 (13.028%) | 50062 (16.296%) | 0 | 20/927951/99.32 | worst 16.337% vs off-vs-off 16.296% |
| dx_foxbear | DIFFERENT | 0 | 70 (0.023%) | 146366 (47.645%) | 0 | 21/547242/99.68 | worst 0.023% vs off-vs-off 47.645%, diverging |
| quake2_demo | DIFFERENT | 308 (0.401%) | 259 (0.337%) | 308 (0.401%) | 0 | 131/360977/95.67 | worst 0.401% vs off-vs-off 0.401% |
| diablo2_demo | NONDET | 0 | 0 | 254092 (52.936%) | 17792 (3.707%) | 523/1427732/99.73 | off arm differs from itself at 600: 17792 (3.707%) |
| dungeon_keeper_demo | NONDET | 0 | 13019 (4.238%) | size≠ | 11725 (3.817%) | 98/313384/99.41 | off arm differs from itself at 600: 11725 (3.817%) |
| dx_ddex4 | NONDET | 0 | 4418 (1.438%) | 3940 (1.283%) | 4373 (1.424%) | 5/262/85.42 | off arm differs from itself at 600: 4373 (1.424%) |
| dx_ddex5 | NONDET | 0 | 5092 (1.658%) | 4923 (1.603%) | 5118 (1.666%) | 7/49690/94.04 | off arm differs from itself at 600: 5118 (1.666%) |
| dx_twist | NONDET | 67 (0.022%) | 87 (0.028%) | 63 (0.021%) | 57 (0.019%) | 46/279950/99.94 | off arm differs from itself at 600: 57 (0.019%) |
| scr_cityscap | NONDET | 50 (0.016%) | 32904 (10.711%) | 19847 (6.461%) | 31039 (10.104%) | 14/31/99.58 | off arm differs from itself at 600: 31039 (10.104%) |
| spider | NONDET | 15928 (5.185%) | 18505 (6.024%) | 18772 (6.111%) | 19080 (6.211%) | 11/19/92.84 | off arm differs from itself at 600: 19080 (6.211%) |
| total_annihilation_demo | NONDET | 0 | 186 (0.061%) | 307200 (100.000%) | 181 (0.059%) | 242/1146070/98.35 | off arm differs from itself at 600: 181 (0.059%) |
| wep16_maxwell | NONDET | 5426 (1.766%) | 614 (0.200%) | 19785 (6.440%) | 21555 (7.017%) | 0/0/- | off arm differs from itself at 600: 21555 (7.017%) |
| wep16_pipe | NONDET | 993 (0.323%) | 3472 (1.130%) | 993 (0.323%) | 2996 (0.975%) | 0/0/- | off arm differs from itself at 600: 2996 (0.975%) |
| wep16_rattler | NONDET | 922 (0.300%) | 853 (0.278%) | 952 (0.310%) | 1080 (0.352%) | 0/0/- | off arm differs from itself at 600: 1080 (0.352%) |
| wep16_tetravex | NONDET | 1378 (0.449%) | 1555 (0.506%) | 1416 (0.461%) | 1253 (0.408%) | 0/0/- | off arm differs from itself at 600: 1253 (0.408%) |
| winarc | NONDET | 8513 (2.771%) | 10242 (3.334%) | 8513 (2.771%) | 10242 (3.334%) | 61/707/94.38 | off arm differs from itself at 600: 10242 (3.334%) |
| dx_flip3dtl | IDENTICAL | 0 | 0 | 1000 (0.326%) | 0 | 2244/315283/88.89 |  |
| dx_wormhole | IDENTICAL | 0 | 0 | 0 | 0 | 0/3598/100.00 |  |
| wep16_blakjak | IDENTICAL | 0 | 0 | 44544 (14.500%) | 0 | 0/0/- |  |

## Repro command lines

### abedemo — DIFFERENT

worst 1.280% vs off-vs-off 5.138%, diverging

```sh
timeout 180 node test/run.js --app=abedemo --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/abedemo-300-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=abedemo --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/abedemo-300-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 145 declines 4610 entries 327669 ops native 16689503 fallback 339825 native% 98.00 transfersSaved 2434010 lastFallbackFn 405 declWhy 1`
`block-exec-regions: M  armed yes installs 18 declines 4188 meanBlocks 9.17 thrashRefusals 757 why 6 ops1 15646727 opsMulti 1382619 entriesMulti 51017`

```sh
timeout 180 node test/run.js --app=abedemo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/abedemo-600-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=abedemo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/abedemo-600-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 169 declines 4823 entries 1208032 ops native 49226308 fallback 1105990 native% 97.80 transfersSaved 7031820 lastFallbackFn 408 declWhy 1`
`block-exec-regions: M  armed yes installs 19 declines 7515 meanBlocks 8.79 thrashRefusals 1378 why 6 ops1 46150294 opsMulti 4182022 entriesMulti 163982`

```sh
timeout 180 node test/run.js --app=abedemo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/abedemo-600-off2.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

### broken_sword_demo — DIFFERENT

worst 3.002% vs off-vs-off 27.105%, diverging

```sh
timeout 180 node test/run.js --app=broken_sword_demo --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/broken_sword_demo-300-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=broken_sword_demo --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/broken_sword_demo-300-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 34 declines 1961 entries 20607 ops native 619194 fallback 40197 native% 93.90 transfersSaved 78238 lastFallbackFn 76 declWhy 1`
`block-exec-regions: M  armed yes installs 7 declines 241 meanBlocks 8.00 thrashRefusals 0 why 1 ops1 21763 opsMulti 637628 entriesMulti 19669`

```sh
timeout 180 node test/run.js --app=broken_sword_demo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/broken_sword_demo-600-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=broken_sword_demo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/broken_sword_demo-600-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 97 declines 2863 entries 28919 ops native 739711 fallback 41002 native% 94.74 transfersSaved 78238 lastFallbackFn 108 declWhy 1`
`block-exec-regions: M  armed yes installs 7 declines 864 meanBlocks 8.00 thrashRefusals 0 why 6 ops1 143085 opsMulti 637628 entriesMulti 19669`

```sh
timeout 180 node test/run.js --app=broken_sword_demo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/broken_sword_demo-600-off2.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

### dx_flip2d — DIFFERENT

worst 16.337% vs off-vs-off 16.296%

```sh
timeout 180 node test/run.js --app=dx_flip2d --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_flip2d-300-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=dx_flip2d --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_flip2d-300-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 20 declines 685 entries 463652 ops native 5528179 fallback 37676 native% 99.32 transfersSaved 571722 lastFallbackFn 408 declWhy 1`
`block-exec-regions: M  armed yes installs 2 declines 560 meanBlocks 9.00 thrashRefusals 38 why 1 ops1 5561657 opsMulti 4198 entriesMulti 181`

```sh
timeout 180 node test/run.js --app=dx_flip2d --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_flip2d-600-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=dx_flip2d --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_flip2d-600-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 20 declines 685 entries 927951 ops native 11056407 fallback 74910 native% 99.32 transfersSaved 1141957 lastFallbackFn 408 declWhy 1`
`block-exec-regions: M  armed yes installs 2 declines 907 meanBlocks 9.00 thrashRefusals 92 why 6 ops1 11127119 opsMulti 4198 entriesMulti 181`

```sh
timeout 180 node test/run.js --app=dx_flip2d --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_flip2d-600-off2.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

### dx_foxbear — DIFFERENT

worst 0.023% vs off-vs-off 47.645%, diverging

```sh
timeout 180 node test/run.js --app=dx_foxbear --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_foxbear-300-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=dx_foxbear --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_foxbear-300-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 19 declines 1133 entries 281172 ops native 8181872 fallback 29622 native% 99.63 transfersSaved 1858716 lastFallbackFn 162 declWhy 1`
`block-exec-regions: M  armed yes installs 4 declines 554 meanBlocks 8.75 thrashRefusals 8 why 6 ops1 5108234 opsMulti 3103260 entriesMulti 258948`

```sh
timeout 180 node test/run.js --app=dx_foxbear --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_foxbear-600-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=dx_foxbear --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_foxbear-600-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 21 declines 1356 entries 547242 ops native 12033461 fallback 37688 native% 99.68 transfersSaved 3040413 lastFallbackFn 162 declWhy 1`
`block-exec-regions: M  armed yes installs 4 declines 864 meanBlocks 8.75 thrashRefusals 8 why 6 ops1 5181904 opsMulti 6889245 entriesMulti 523360`

```sh
timeout 180 node test/run.js --app=dx_foxbear --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/dx_foxbear-600-off2.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

### quake2_demo — DIFFERENT

worst 0.401% vs off-vs-off 0.401%

```sh
timeout 180 node test/run.js --app=quake2_demo --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/quake2_demo-300-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=quake2_demo --batch-size=20000 --max-batches=300 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/quake2_demo-300-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 131 declines 5695 entries 345273 ops native 6644924 fallback 310115 native% 95.54 transfersSaved 460063 lastFallbackFn 93 declWhy 1`
`block-exec-regions: M  armed yes installs 9 declines 793 meanBlocks 6.56 thrashRefusals 0 why 1 ops1 573281 opsMulti 6381758 entriesMulti 331218`

```sh
timeout 180 node test/run.js --app=quake2_demo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/quake2_demo-600-off.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`

```sh
timeout 180 node test/run.js --app=quake2_demo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/quake2_demo-600-on.png --no-build --block-exec
```
exit 0 · painted
`block-exec: M  armed yes installs 131 declines 6218 entries 360977 ops native 6886626 fallback 311545 native% 95.67 transfersSaved 518799 lastFallbackFn 93 declWhy 1`
`block-exec-regions: M  armed yes installs 9 declines 1237 meanBlocks 6.56 thrashRefusals 61 why 6 ops1 599606 opsMulti 6598565 entriesMulti 345609`

```sh
timeout 180 node test/run.js --app=quake2_demo --batch-size=20000 --max-batches=600 --max-seconds=150 --stuck-after=1000000 --quiet-api --quiet-blocks --no-close --block-exec-stats --png=/private/tmp/claude-502/-Users-vg-Documents-projects-phone-wine-assembly/18f46816-87a6-4750-b7cb-32ba985b18c9/scratchpad/sweep-diff/quake2_demo-600-off2.png --no-build
```
exit 0 · painted
`block-exec: M  armed no installs 0 declines 0 entries 0 ops native 0 fallback 0 native% - transfersSaved 0 lastFallbackFn -1 declWhy 0`
`block-exec-regions: M  armed yes installs 0 declines 0 meanBlocks - thrashRefusals 0 why 0 ops1 0 opsMulti 0 entriesMulti 0`
