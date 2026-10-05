# Slice-record classification (head vs v2v3)

PASS = every gate held: P3 reproduced, irq traces and slice records complete. Not an audio-correctness verdict.

## BLIQ

head deliveries 384, moved 205: {"ondate":3,"budget":202,"early":0,"unmatched":0} (ambiguous 0)
v2v3 deliveries 381, moved 202: {"ondate":0,"budget":202,"early":0,"unmatched":0} (ambiguous 0)
episodes 61; class of each episode's first head delivery: {"ondate":3,"budget":58,"early":0,"unmatched":0}

- head #48 at 13732896 ondate (left 0, 1aeb:67) -> v2v3 13804137 (+71241); v2v3 window 441 handbacks, 6 stops, IF=1 at 2
- head #70 at 19347242 ondate (left 0, 1aeb:67) -> v2v3 19597579 (+250337); v2v3 window 1563 handbacks, 10 stops, IF=1 at 2
- head #78 at 20827665 budget (left -1, 1a89:7b) -> v2v3 20827666 (+1); v2v3 window 1 handbacks, 1 stops, IF=1 at 1
- head #80 at 21228198 budget (left -2, 1a89:2cb) -> v2v3 21428463 (+200265); v2v3 window 11 handbacks, 8 stops, IF=1 at 8
- head #85 at 23595264 budget (left -5, 16ce:2d23) -> v2v3 23783484 (+188220); v2v3 window 5742 handbacks, 10 stops, IF=1 at 10
- head #90 at 24536375 budget (left -1, 1a89:2cb) -> v2v3 24536376 (+1); v2v3 window 1 handbacks, 1 stops, IF=1 at 1
- head #93 at 25101043 ondate (left 0, 16ce:2d23) -> v2v3 25101055 (+12); v2v3 window 1 handbacks, 1 stops, IF=1 at 1
- head #96 at 25665713 budget (left -1, 1a89:2cb) -> v2v3 25665714 (+1); v2v3 window 1 handbacks, 1 stops, IF=1 at 1
- head #98 at 26042160 budget (left -2, 16ce:2d23) -> v2v3 26042173 (+13); v2v3 window 1 handbacks, 1 stops, IF=1 at 1
- head #103 at 26983276 budget (left -3, 16ce:2d23) -> v2v3 27171497 (+188221); v2v3 window 3974 handbacks, 7 stops, IF=1 at 7

## CAVEIRA

head deliveries 254307, moved 66262: {"ondate":15,"budget":66247,"early":0,"unmatched":0} (ambiguous 0)
v2v3 deliveries 254314, moved 66269: {"ondate":0,"budget":66269,"early":0,"unmatched":0} (ambiguous 0)
episodes 1600; class of each episode's first head delivery: {"ondate":6,"budget":1594,"early":0,"unmatched":0}

- head #3 at 735672 ondate (left 0, 2408:3053) -> v2v3 735675 (+3)
- head #5 at 736351 budget (left -1, 110:7ae) -> v2v3 741717 (+5366)
- head #23 at 741802 budget (left -52, 110:7f2) -> v2v3 753193 (+11391)
- head #61 at 753262 budget (left -37, 110:7f2) -> v2v3 793057 (+39795)
- head #193 at 793129 budget (left -4, 110:7f2) -> v2v3 807553 (+14424)
- head #241 at 807605 budget (left -5, 110:7f2) -> v2v3 820539 (+12934)
- head #284 at 820624 budget (left -49, 110:7f2) -> v2v3 1335145 (+514521)
- head #1988 at 1335142 ondate (left 0, 2408:3081) -> v2v3 1335145 (+3)
- head #3343 at 1744427 budget (left -2, 110:ae7) -> v2v3 1755529 (+11102)
- head #3380 at 1755601 budget (left -1, 110:ae7) -> v2v3 1755831 (+230)

