# CMP + Jcc decoder fusion (H469) — 2026-09-19

Follow-up to [hot-idiom-census-2026-09-19.md](hot-idiom-census-2026-09-19.md),
whose first recommendation was a decoder fusion of `cmp/test + Jcc`. This is
the `cmp r32,r32` / `cmp r32,imm32` half, built as a fixed handler (no runtime
wasm generation), unit-tested, checked against the deterministic headless
oracle, and A/B'd on the quiet box with a null arm.

## What it is

`$try_emit_cmp_jcc` in `src/07-decoder.wat` runs at the three 32-bit register
CMP sites (`39/3B r,r`, `3D eax,imm32`, `81/83 /7 r,imm`). If the next
instruction is a short or near Jcc it consumes both and emits handler 469
(`$th_cmp_jcc`, `src/06b-core-handlers.wat`), which reads both operands,
publishes the CMP's lazy flags with `$set_flags_sub` (so a later SETcc/ADC/
SBB/second Jcc still reads the truth), answers the condition straight off the
operands, and ends through `$jcc_end` like every specialised Jcc.

Declined, so nothing else changes: 16-bit code, and a Jcc whose target is
the block's own start. The second is the self-loop back edge the loop-idiom
matcher (`07b`) classifies as two roles; `test/test-cmp-jcc-fusion.js`
asserts that block keeps the separate H19 + H312.

## The layout matters more than the handler

The first build carried the CMP's fields (registers, condition, immediate
flag) in the handler's operand word and ended with `return_call $branch_end`.
That is a semantic no-op and it **lost on the box** (round 1 below): every
specialised Jcc's operand word is a *control word* that `$decode_run` writes
an adjacency bit into and `$jcc_end` reads to fall through into the next
block without a cache lookup, and `$decode_run` only extends an
address-ordered run past a terminator in 307..322 with the 16-byte
`[fn][control][fall][target]` shape. A fused block therefore ended every
run, its not-taken edge paid `$branch_end`'s lookup instead of the
adjacent fall-through, and the saved dispatch was spent several times over.

The shipped layout keeps the plain Jcc's contract:

```
[469][control word = 0][fields][imm32 if immediate form][fall][target]
```

`$decode_run` accepts 469 with a size computed from the fields word (20 or
24 bytes), marks adjacency `ctl_back` bytes before the block end instead of
a fixed 12, and the handler passes `$jcc_end` the control word's address.
The test's second section runs with the handler histogram *off* (it counts
as a debug facility and disables the fast path) and asserts `page_ft`
advances by one on every fallen-through fused branch and by zero on a taken
one, for both layouts.

## Oracle (local, deterministic routes, base vs new wasm from one snapshot)

| app | window ops base → new | H469 share | picture |
|---|---|---|---|
| Heroes II | 31,349,725 → 30,352,139 (−3.2%) | 99,749 | identical |
| Diablo | 307,413,220 → 302,827,242 (−1.5%) | — | 822 px in the app's own 43x67 flame box; base-vs-base differs by 812 px in the same box |
| SimGolf (`--headless-gl`) | 94,163,464 → 88,028,841 (−6.5%) | 6.96% of dispatches | identical |
| StarCraft | 354,078,031 → 333,074,055 (−5.9%) | — | not usable as an oracle: base-vs-base already differs by 5,631 px and ~4k API calls over this 2000-batch route |

## Box A/B (`gameplay-ab-flags.js`, 3 interleaved reps, hardware counters)

Round 1, fields-in-operand layout (no fall-through chains through fused
blocks):

| app | null band | fused vs base (gameplay CPU) | instructions |
|---|---|---|---|
| StarCraft | 0.35% | **+1.10% slower** | +0.5% |
| Heroes II (2.2s window) | 3.65% | +6.85% slower | −0.4% |
| Diablo | 1.21% | +1.51% slower | +0.2% |

Instructions barely moved and cycles went up: the saved dispatches were
paid back as `$branch_end` lookups on every fallen-through fused block.

Round 2, plain-Jcc control word layout (the shipped one):

| app | null band | fused vs base (median gameplay CPU) | instructions | cycles |
|---|---|---|---|---|
| StarCraft | 1.36% | +1.29%, inside the band | −0.4% | +1.7% |
| Heroes II (7.8s window) | 0.77% | −0.26%, inside the band | −0.5% | −0.2% |
| Diablo | 3.28% | −4.86%, but base's median (17.68s) is its own outlier: the fused arm is −1.6% against the null arm's 17.10s, inside the band | −0.1% | −2.5% |

**Verdict: neutral.** The layout fix turned a measured loss into no
measured change on all three apps. Retired instructions barely move
because a fused CMP+Jcc still does the CMP's flag publish and the Jcc's two
word reads; what it removes is one dispatch per site, and at 4-12% of
dispatches that is under the ~5% the entire per-dispatch tail was measured
to be worth (dispatch replication), so a few tenths of a percent is the
expected size and the box cannot resolve it.

It is kept on branch `cmpjcc-fusion` (with this document and the test) and
not on main: a lever with no measured win stays off.

## Where it leaves the plan

Dispatch-count fusions of this size are below the box's resolution, so
the census's recommendation (1) is closed as "not worth a handler each":
`cmp r,[mem] + Jcc`, `cmp [mem],imm + Jcc`, `shr r,1 + jnb` would each
remove fewer dispatches than this one did. A fusion has to remove *memory
traffic or a block transfer*, not just a dispatch, to show up — which is
what the census's own `rect_run` (+12%) versus `case_chain` (~0) already
said. The token-fetch and push/pop-run levers (recommendations 2 and 3)
should be estimated against that bar before they are built. Any new
terminator fusion must keep the control-word layout or it repeats round 1.
