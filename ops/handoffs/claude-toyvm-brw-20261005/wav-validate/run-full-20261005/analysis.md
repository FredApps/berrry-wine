# WAV reference check

PASS = completed with P3 reproduced on every guest field. Not a verdict that the new audio is correct.

## BLIQ

| tree | wav | frames | seconds | guestSeconds | outAcc | dispatched | irqs | ints | frame | date | early | first-diff s | differing share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| head | bcad8597d49aa829 | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584843766 | 80000001 | 384 | 2985 | = | 3290 | 41112 | null | 0 |
| v2v3 | 5c99cf3060dc961e | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584843482 | 80000001 | 381 | 2978 | = | 3298 | 41114 | 1.982086 | 0.031619 |
| v2v3j | 5c99cf3060dc961e | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584843482 | 80000001 | 381 | 2978 | = | 3298 | 41114 | 1.982086 | 0.031619 |
| v2v3j_v4 | 5c99cf3060dc961e | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584843482 | 80000001 | 381 | 2978 | = | 3298 | 41114 | 1.982086 | 0.031619 |
| stack | 5c99cf3060dc961e | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584843482 | 80000001 | 381 | 2978 | = | 3298 | 41114 | 1.982086 | 0.031619 |

first tree to change each field (ladder head -> v2v3 -> v2v3j -> v2v3j_v4 -> stack): {"wav":"v2v3","frame":null,"dispatched":null,"irqs":"v2v3","ints":"v2v3","pixels":null}
irq trace head vs stack: first divergence at line 47
PIT io trace head vs stack: first divergence at line 147

## CYCLE

| tree | wav | frames | seconds | guestSeconds | outAcc | dispatched | irqs | ints | frame | date | early | first-diff s | differing share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| head | 53d35b45a27a074d | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584893995 | 80000001 | 113998 | 153 | = | 454389 | 216 | null | 0 |
| v2v3 | 271394da4ec04e3c | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584893995 | 80000001 | 113998 | 153 | = | 454731 | 216 | 2.248435 | 0.005291 |
| v2v3j | 271394da4ec04e3c | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584893995 | 80000001 | 113998 | 153 | = | 454729 | 216 | 2.248435 | 0.005291 |
| v2v3j_v4 | 271394da4ec04e3c | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584893995 | 80000001 | 113998 | 153 | = | 454729 | 216 | 2.248435 | 0.005291 |
| stack | 271394da4ec04e3c | 176160 | 7.989115646258504 | 7.9891493586606686 | 0.7411564584893995 | 80000001 | 113998 | 153 | = | 454729 | 216 | 2.248435 | 0.005291 |

first tree to change each field (ladder head -> v2v3 -> v2v3j -> v2v3j_v4 -> stack): {"wav":"v2v3","frame":null,"dispatched":null,"irqs":null,"ints":null,"pixels":null}
irq trace head vs stack: first divergence at line 2

## CAVEIRA

| tree | wav | frames | seconds | guestSeconds | outAcc | dispatched | irqs | ints | frame | date | early | first-diff s | differing share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| head | f61246d0bcc7c51a | 176160 | 7.989115646258504 | 7.9891495583894 | 0.7411564584891991 | 80000003 | 254307 | 11768 | = | 1084009 | 24 | null | 0 |
| v2v3 | b1319eb4595646de | 176160 | 7.989115646258504 | 7.989149458525035 | 0.7411564584889957 | 80000002 | 254314 | 11768 | = | 1090386 | 24 | 0.176417 | 0.108356 |
| v2v3j | b1319eb4595646de | 176160 | 7.989115646258504 | 7.989149458525035 | 0.7411564584889957 | 80000002 | 254314 | 11768 | = | 1090386 | 24 | 0.176417 | 0.108356 |
| v2v3j_v4 | b1319eb4595646de | 176160 | 7.989115646258504 | 7.989149458525035 | 0.7411564584889957 | 80000002 | 254314 | 11768 | = | 1090386 | 24 | 0.176417 | 0.108356 |
| stack | b1319eb4595646de | 176160 | 7.989115646258504 | 7.989149458525035 | 0.7411564584889957 | 80000002 | 254314 | 11768 | = | 1090386 | 24 | 0.176417 | 0.108356 |

first tree to change each field (ladder head -> v2v3 -> v2v3j -> v2v3j_v4 -> stack): {"wav":"v2v3","frame":null,"dispatched":"v2v3","irqs":"v2v3","ints":null,"pixels":null}
irq trace head vs stack: first divergence at line 2

