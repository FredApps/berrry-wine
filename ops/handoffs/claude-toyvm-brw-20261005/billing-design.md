# Region install/entry/exit billing vs the interpreter: design note

Worker A, 2026-10-05. Based on reading the source only: nothing was run, built or edited outside
this directory. This note does not approve any behavior change.

## Summary (read this first)

**The premise is not supported, and is partly contradicted.** "Each install shifts the dispatch
clock by one" is not what today's code does:

- `test-toyvm-region-live` in the Phase 6 and Phase 8b runs printed **`34405852 dispatches vs
  34405852 (0 apart)`** with 2 installs and 1 drop, and **`0 dispatch(es) apart`** over 1 install
  (`toyvm-brw/runs-20261005d/` and `runs-20261005i/test-toyvm-region-live.out`).
- Both of those programs end with INT 21h/4C before their 120M budget. That makes `dispatched` an
  exact cumulative bill with no overshoot in it.
- The test's "≤ 1 per install" tolerance (`test/test-toyvm-region-live.js:369-382`) and its
  rationale in `docs/toyvm-region-live.md` ("The clock") are therefore stale. They were most likely
  measured before the HALT_FIRST, `jmp_syn` and `end_cut` refunds existed.
- Phase 7c (BRW, 89.16M, after 5 installs) is the same result on BRW: identical registers and
  cs:gip at every dispatch count the two arms share. The clocks were aligned.

**What does fit the 115.06M split is a budget TEST in a different place, not a different
CHARGE.**

- At 115.06M the region arm stops at the region head 8:8c77, **exactly one loop iteration (7
  dispatches) before** the interpreter stops at the same cs:ip.
- `region-0x8c77.wat` charges `-7` per iteration and tests the budget only at its `jnz`. That
  matches the interpreter op for op.
- So neither a shared date nor any constant clock offset can produce "same cs:ip, Δat = −7" (proof
  in §2). The region arm must have tested the budget somewhere the interpreter does not.
- There is one place it does by construction. The install marks every region head as a block head
  *before* decoding (`compile.js:365-373`). A straight line that falls into the loop head is then
  recompiled to end in a `jmp_syn` at the head (`compile.js:512-517`).
- `jmp_syn` refunds its step (`emit.js:820-823`), but it still runs `GO`, and `GO`'s `CONT` tests
  `$steps < 0` (`emit.js:622-623`, `:695-699`). That adds a budget stop at the head on loop entry.
- The interpreter never decoded the head there. It ran a copy of the first iteration inside the
  setup block and first tested at the copy's back edge: same gip, 7 dispatches later. That is the
  BRW signature exactly. **This is a hypothesis.** It is source-grounded and matches the signature,
  but no one has confirmed that L1 enters 8:8c77 by straight-line fall-through.

**Recommendation, smallest set, in order:**

| Step | Change | Changes the L1 baseline? |
|---|---|---|
| 0 | Two discriminating runs, each a few seconds (§5). No code change. | – |
| 1 | Tighten region-live's clock bound to exact equality. It passes today (measured 0 apart). | No |
| 2 | Land the failing test in `regression-spec.md`. | No |
| 3 | **Option J:** `jmp_syn` stops being a budget test point. It still tests `$smc`, in `emit.js` and identically in the region lowering. This makes every arm's stop points independent of layout. | **Yes** |
| 4 | Region-only hygiene: flush `pending` before any inlined body that can `(return)` (B1). | No |
| 5 | `end_smc` refund and `end_cut` stop classification, only if evidence asks for them. | Yes |

**Risks:**

- J moves L1's intermediate timing wherever a budget stop used to land on a `jmp_syn`. That means
  a corpus before/after A/B and re-baselined frames for time-paced programs, the same as the
  unlanded v2 dos-loop patch.
- Profile samples taken at `jmp_syn` stops disappear, so region picks can shift (a performance
  effect, not a correctness one).
- A new no-budget-lookup helper has to be taught to the flag/effects analyses (`emit.js:3679`).

**The reviewer must decide:**

1. Accept that the target is stop *placement*, not install billing. If yes, retire the "per-install
   offset" wording in the tests and docs.
2. J, which changes the L1 clock but is exact by construction, versus R, which is region-only and
   leaves L1 alone but is exact only when L1 absorbed the head (§3, T1).
3. Whether to pay one corpus re-baseline for J together with v2 (`toyvm-brw/dos-loop-irq-fix-v2.patch`),
   rather than two.
4. Whether to grant the §5 discriminator runs before any of this.

---

## 1. What the interpreter bills, and where it tests (the reference)

**Charge.**
- `$next` charges 1 step *before* dispatching a handler, and is free once `$halt` is set
  (`HALT_FIRST`, `emit.js:665-666`, used at `:6421-6428`).
- `run(entry, budget)` enters through `$next` (`emit.js:6521-6528`), so every handler, region
  functions included, is entered on a charged step.
- Fused cmp+Jcc charge their second step in the body (`emit.js:3437`).
- `jmp_syn` and `end_cut` refund their step (`emit.js:820-823`, `:284-289`). `end_smc` does **not**
  (`emit.js:270-275`).
- Spin twins charge a lump of turns, exact by arithmetic (`emit.js:758-765`).

**Test.**
- `$steps < 0 || $smc` is tested at **every transfer**, through `CONT` (`emit.js:622-623`, `GO`
  `:695-699`), and that includes `jmp_syn`. The traced not-taken arm tests too.
- `end`, `end_cut` and `end_smc` always hand back.

**Host.**
- It bills `budget - $steps` (`dos-loop.js:1771-1772`).
- Interrupts go in only at a stop that reached its date (`atStop`, `:1783`; timer at `:2019`).

Consequence: the *charge* is a pure function of the guest instructions retired, but the *test
points* are a function of the arena layout. Where `jmp_syn` and `end_cut` sit depends on which heads
existed at decode time.

## 2. Why the 115.06M split is not a billing offset

The facts, from the Phase 8b notes and `dump-k5/region-0x8c77.wat`:

- Both arms deliver the SB IRQ `from 8:8c77`: L1 at 115063087, jit-sepc at 115063080.
- The region bills 7 per iteration and tests once per iteration, at the `jnz` (taken edge gip
  35959 = 0x8c77).

The argument:

1. Let iteration k end at guest count G_k = G_0 + 7k, and let arm X's clock be G + c_X.
2. If both arms test only at the `jnz` and stop at the first k with G_k + c_X past date D_X, then
   `at_L1 − at_J = 7·(k_L1 − k_J) + (c_L1 − c_J) = 7`.
3. Suppose the dates are equal (D_L1 = D_J). Then any offset δ = c_L1 − c_J moves k_J by at most
   ⌈δ/7⌉ in the direction that cancels it, and no integer δ satisfies the equation. (Δk=1 needs
   δ=0, but δ=0 with an equal date gives Δk=0. Δk=0 needs δ=7, which would require an overshoot
   greater than one iteration.)
4. So either the dates differ, or **one arm has a test point the other lacks**.

The second branch predicts exactly "same gip, the region arm one iteration earlier". That is T1
below. The first branch (a date-chain difference upstream) is not excluded. The §5 run decides
between them.

The end counts (500918120 vs 500918117) come after the guest has diverged, and they are overshoot
at `endAt`. They are not evidence about billing.

## 3. Every place the count, or the stop, can differ

"Proven" means proven by source reading or by a recorded run. "Hyp." means not verified.

| # | Site (file:line) | Current behavior | Differs from L1? | Minimal change | Hot-path cost | Could break | Status |
|---|---|---|---|---|---|---|---|
| E1 | Entry refund `region-jit.js:1738` | `+1` at region entry; every op, including the first, is billed through `pending` (`:1542`) | **No.** Every entry is a `$next` dispatch, which has already charged 1 (`emit.js:6421-6428`, `:6521-6528`; region funcs end in `return_call $next`, `:6411-6413, 6435`). | None. Keep it, and keep `--no-entry-refund` as the bisector. | – | – | Proven by source. Measured 0 apart (region-live, 2 programs). |
| E2 | Install's own handback / compile-back, `region-live.js:566-676` (invalidate `:606`, precompile `:620-631`, rtop repair `:646-670`) | Runs between slices (`run-dos.js:835-837`), after `step()` has billed. Handbacks are free (HALT_FIRST). | **No charge difference.** Its side effect is *layout*: the dropped programs are recompiled in a new order, with the region head pre-marked (see T1-T3). | None for billing. | – | – | Proven. install-clock: 1051 == 1051 handbacks. region-live: 0 apart. |
| E3 | Exits that hand back vs link: `leave` `region-jit.js:1725-1730`, unlowered `(br $out)` `:1690-1694` | A `$jlook` miss hands back with `$steps >= 0`. | No charge difference. The stop is early (not a date). Today's `atStop` counts a handback landing *exactly* on a date (`dos-loop.js:1783`); v2 fixes that. | v2 (already drafted, unlanded). | – | L1 timing (v2's own A/B) | Proven (Phases 3-8). |
| E4 | `--once` exits, `region-jit.js:1297, 1336-1345` | One pass per entry; refund per entry; final `pending` billed at `:1711-1713`; `leave` tests the budget. | No (same tests at the same edges). | None (bisector only, not shipped). | – | – | Proven by source. |
| E5 | Chunked charges, `region-jit.js:1530-1533, 1553-1556, 1561-1564, 1711-1713`; detours `:1463-1467, 1487, 1495, 1498, 1516`; readers `CLOCK_READERS` `:1046` | `pending` is flushed before every transfer, every clock reader and every label. | No. `$steps` is read only at those points. | None. | – | – | Proven by source, plus `--step-audit` on K5: charged == weight. |
| B1 | Early `(return)` in an inlined body: fault arms `emit.js:1298-1302, 2135, 2139, 2169, 2177` (div/aam/…) | The return leaves the region function with `pending` unbilled and no `leave`. | **Yes: under-bills `pending`** (the faulting op plus the unflushed ops before it, minus 0 or 1 for the refund). L1 charged each one. | Treat a body matching `/\(return\)/` as a clock reader: flush before it (`:1553` condition). | One `global.set` before such ops only. | Nothing found | Proven by source. Reachability and BRW relevance unverified. |
| B2 | `end_smc`, `decode.js:1148-1151`, `emit.js:270-275` | An extra dispatch after a CS-override store, **not refunded**. Emitted only while the store is not learned `benign`. | **Yes, learning-dependent.** Region code bits (`compile.js:480-482`), forced heads (`:365-373`) and successor precompiles (`:461-466`) change which stores hit compiled code, and so whether `benign` is ever learned. That is ±1 step per execution. | Refund like `end_cut`. | 0 | **L1 clock** (every TP `Intr()` program); corpus A/B | Hyp. Whether BRW runs `end_smc` is unknown: compare handler-hist counts across the arms. |
| B3 | Mid-straight-line halts (a non-transfer body that sets `$halt`: `end`, `end_smc`, `int`) | The region keeps running the ops after it until the next edge test sees `$halt`. | Possibly: extra ops executed and billed. | Flush before such an op and add `br_if $out $halt` after it. | Only in regions containing such ops | Nothing found | Hyp. The chain walk probably ends the region at such ops (unverified). |
| **T1** | **Region head pre-marked, `compile.js:365-373`, and the `jmp_syn` it creates, `compile.js:512-517` → `emit.js:820-823` (`GO`/`CONT`)** | After install the predecessor straight line ends in a `jmp_syn` at the head, which is a budget test point. | **Yes: an extra stop at the head on loop entry** whenever L1 had absorbed the head into the setup block (the ADDY_II shape, `compile.js:356-364`). The charge is equal. | **J:** `jmp_syn` tests `$smc` only, not `$steps`. **R (region-only):** a test-free `jmp_syn` only for edges into installed region heads. | J: one fewer compare per `jmp_syn` | J: L1 timing. R: wrong (opposite direction) whenever L1 *had* a head there. | **Hyp., the leading one.** It matches the 115.06M signature exactly; unverified. |
| T2 | Forced compiles of every installed head in the csKey (`compile.js:365-373`) and region successor precompiles (`:461-466`) | Blocks compiled earlier, or in a different order, than L1 would. | Different `jmp_syn` placement elsewhere → different stop points. | Covered by J. R does not cover it. | – | – | Hyp. |
| T3 | Install-time precompile of doomed heads (`region-live.js:620-631`); uninstall flush (`:328-347`) | Recompiles in a new decode order. The other selector's blocks are recompiled later, on a miss. | Same as T2. | Covered by J. | – | – | Hyp. |
| T4 | Region bodies frozen from the profile-time layout: a `jmp_syn` inside a region gets `edge()` (`region-jit.js:1616-1633`, `:1326-1331`) | Budget test at a profile-time `jmp_syn`. | Same class, in reverse. L1's current layout may not have that test. | J's region half: no `$steps` test on a `jmp_syn` edge. | One fewer compare | – | Hyp. |
| T5 | `end_cut` placement (`compile.js:508, 524`; learned volatility) | Always hands back. With `$steps < 0` there it is a date stop where L1 may not stop. | Stop placement, learning-dependent. | Host: classify a budget-exhausted `end_cut` stop as not-a-date, and resume with the negative remainder (`run(entry, left)`), so the guest stops at its next real transfer. | Host-side only | L1 timing | Hyp. Do it only if evidence calls for it. |

The step-audit weight rule (`region-jit.js:1770`) matches the interpreter for every row except B2
(`end_smc` is weight 1 and is charged; it is consistent, but learning-dependent) and B1 (the
audit's charge slot is never reached on a `(return)`).

## 4. The minimal change (J), concretely

1. **`emit.js` `jmp_syn` (`:820-823`).** Keep `steps += 1` and replace `GO` with `GO_SYN`. `GO_SYN`
   publishes `$gip`, then:
   - if the arena is non-zero and `$smc` is clear, set `$ip`;
   - otherwise try a lookup that tests **`$smc` only**, and hand back on a miss with
     `EXIT('edge')`.

   It must not call `$jlook_edge`, whose `CONT` tests `$steps` (`:5651-5656`). Add a sibling
   `$jlook_syn`, or pass a mode argument, and teach the census and analysis regex at `:3679` (and
   `handler-effects.js`) that it is the same event as `jlook_edge`.
2. **`region-jit.js` jump lowering (`:1616-1633`).** When `op.name === 'jmp_syn'`, wrap with an
   `edgeSyn()` whose test is `$smc || $halt`, not `boundaryTest`. Billing is unchanged: `pending`
   still counts it and `jump.pre` keeps the `+1`.
3. **tree-fold and uop-live.** Any other lowering of `jmp_syn` must follow (unverified whether they
   lower it). The uop tier marks `handbackAt` heads (`compile.js:375-386`), which is the same class
   as T1. It is a candidate explanation for `only-naive`'s identical BRW +1/frame signature (Hyp.).
4. **A/B switch.** Add `--jmp-syn-budget-test` to restore the old test. It must reach the *build*,
   because the handler tables are built once per process (`prepareTables`, guarded by `TABLES_READY`, at `emit.js:4068-4071`, called from `useBuild` at `:6606-6609`), so the negative control needs its own
   process or a runDos build option.

Why J and not R: L1's test points at a `jmp_syn` depend on decode order, and so differ between any
two layouts. Only removing the test from every `jmp_syn` makes the stop points a function of guest
code alone. R is exact only for the case where L1 absorbed the head. It is the fallback if the L1
clock must not move.

Safety:
- A `jmp_syn` always targets a head *ahead* in a straight line, so no cycle consists only of
  `jmp_syn` edges. A loop always has a real, still-tested transfer, and the overrun stays bounded by
  one block.
- The `$smc` test is kept, so self-patch handbacks are unchanged.

## 5. Discriminators before any code (each a few seconds, toyvm-only)

1. **The synthetic test** (`regression-spec.md`). If it FAILS with the predicted first difference
   (the region arm `from <cs>:hot` 6 dispatches before L1's `from <cs>:<jmp ip>`), T1 is real.
   If NC1 passes and the main arm also passes, T1 is not reachable as modelled. Then go to step 2.
2. **BRW at 115.06M** (brw-bisect.js, v2 private copy):
   - `dos-disasm` 8:8c50-8c77. Does the setup fall into 8c77 with no jump?
   - `--slice-log` + `--state-window=115062900:115063100` on both arms. Is the jit stop at 080 an
     `edge` exit whose previous word is `jmp_syn`, with ecx/esi/edi equal to L1's values *before* its
     first iteration?
   - If instead L1 and jit-sepc have different `stopAt`/`audioAt` at an earlier stop (the Phase-8
     clock log), the cause is the date chain and this design is moot for 115.06M.

## 6. Test-side changes that need no behavior change

- `test/test-toyvm-region-live.js:379-382` and `:416-419`: assert `drift === 0`. The measured value
  is 0 on both programs. Rewrite the comment at `:364-378` to match.
- `test/test-toyvm-region-install-clock.js:18-21` and `docs/toyvm-region-live.md` "The clock": the
  per-install tolerance is obsolete wording.
