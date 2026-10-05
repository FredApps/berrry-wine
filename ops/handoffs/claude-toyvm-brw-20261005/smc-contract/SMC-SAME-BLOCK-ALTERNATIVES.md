# Same-block forward SMC: concrete CPU-contract alternatives (source only, 2026-10-05)

Task: TOYVM-SMC-SAME-BLOCK-FORWARD-PATCH. Root asked for concrete alternatives instead of waiting on
an unspecified choice. No runtime has been used. The recommendation in §4 is mine. Root makes the
engineering choice; no user gate.

## 1. What the architecture says (primary: Intel SDM 325462-093)

- **Vol. 3A §11.1.3, p. 11-5, "Handling Self- and Cross-Modifying Code".** Behaviour on self-modified
  code is model-specific and depends on how far ahead of the current execution pointer the code was
  modified. The only forms guaranteed across processors are:
  - the store, then a jump (to the new code or an intermediate location), then the new code;
  - the store, then a serializing instruction (e.g. CPUID), then the new code.
- **Vol. 3A §14.6, p. 14-18, "Self-Modifying Code".** The models differ:
  - **Pentium and P6:** they check whether a store hits an already-prefetched instruction, and if so
    invalidate the prefetch queue, so the new bytes execute.
  - **Intel486:** if the instruction was prefetched before the store, the OLD version may execute;
    software is told to put a jump immediately after such a store.
  - **386:** the SDM says nothing model-specific. That it has a prefetch queue, and its size (16
    bytes; 32 for the 486), comes from Intel's 386/486 data sheets, which I have NOT verified here.
    Treat those sizes as unconfirmed.

## 2. What toyvm does today (source: base 2683a6e3)

- **toyvm models CPU levels 86, 186 and 386** (decode.js:154-157), and runs the corpus as `cpu: 386`.
- **A CS-override store that patches code** ends its block (`end_smc`, decode.js:1148-1151), so it
  takes effect at the next instruction.
- **Any other store into compiled code** sets `$smc`, which is acted on at the next block transfer
  (`CONT`, emit.js:622). The rest of the storing block runs the bytes it was decoded with,
  **however far ahead the patch is**, up to the end of the block.
  - repro2 (`jmp-syn-j/repro2-20261005/summary.md`): a DS store into an imm8 5 bytes ahead, with no
    transfer between, runs the old byte on HEAD in every mode, `--smc-flush` included (dl 188; 132
    with the new byte).
- **`PATCH_AHEAD = 256`** (dos-loop.js:43) is a site-retirement heuristic, not a fetch model.
- **Status quo therefore matches no real CPU exactly.** It is stale within the block, unlike
  Pentium/P6. It is stale beyond any prefetch window, unlike a 386/486, if the block is long.
- **Status quo may also be arm-dependent.** If a region or fold spans several blocks and checks
  `$smc` only at its own boundary, the stale window differs by arm. To be confirmed by the IF-enable
  arm audit now in progress, which covers the same boundary machinery.

## 3. Alternatives

| | contract | rule | mechanism | cost | repro2 (5 bytes ahead) |
|---|---|---|---|---|---|
| **A** | Block-scoped (status quo, written down) | a store into compiled code takes effect at the next block transfer | none; document it, keep the same-block test as *expected stale* | zero | old byte (188) = PASS |
| **B** | 386/486 prefetch window | stale only within W bytes after the storing instruction (W = 16 on `cpu: 386`, unconfirmed); beyond W the new bytes run | in the code-page store path (already the slow path): if the target lies in the current block at ≥ next_ip + W, set `$halt` with `$gip` = next ip, so the block ends at the next instruction boundary and is re-decoded | only stores that hit compiled code; arms must honour an instruction-level halt or decline to compile such stores | old byte (within W) = PASS |
| **C** | Pentium/P6 snooping (§14.6) | any store into a not-yet-executed instruction takes effect | as B with W = 0 | as B, firing more often | new byte (132) = PASS |
| **D** | Guaranteed-only (§11.1.3) plus a measurement | any of A/B/C is compliant for code that follows the jump/serialize rule; measure whether the corpus contains code that does not | A's behaviour, plus a diagnostic counter in the code-page store path: same-block forward stores, bucketed by distance (< 16, 16–31, ≥ 32 bytes) | one counter on the slow path | old byte = PASS |

**Consequences:**

- **C is the most compatible with modern-correct code,** but it contradicts `cpu: 386`. DOS programs
  that size the prefetch queue (a classic CPU-detection trick: patch an instruction a few bytes
  ahead and see whether the old one ran) would conclude "no prefetch queue", meaning newer than a
  486, while CPUID-less 386 detection paths say 386. That is an internal inconsistency a corpus
  program may act on.
- **B is the model-accurate choice for `cpu: 386`,** but real prefetch fill depends on bus timing,
  so W is an upper bound and the exact boundary is not architectural. It needs the unconfirmed 16-
  and 32-byte figures.
- **A is cheapest** but matches no CPU. It is only safe while no corpus program patches its own block
  beyond a prefetch window without a jump.
- **D turns that "only safe while" into a number.**

## 4. Recommendation

**D now, then B only if D's counter fires.**

1. Write contract A into the toyvm docs as the current, explicit contract. Turn the same-block test
   into a test of that contract (old byte expected, with a comment citing §11.1.3 and §14.6), so it
   is no longer a "failing" test of an undecided rule.
2. Add D's distance-bucketed counter, as a stat next to `smcBreaks`, to the code-page store path. It
   is diagnostic only, with no behaviour change.
3. Bounded runtime, later: one corpus sweep with the counter (the existing corpus-plan machinery, l1
   arm only). If every bucket at ≥ 16 bytes is 0 across the corpus, A is behaviourally
   indistinguishable from B for this corpus and the task closes. If not, the programs it names are
   the test cases for implementing B with W = 16.
4. C is not recommended while toyvm claims to be a 386.

## 5. Gates that remain whatever the choice

- **Arm parity.** Same-block behaviour must be identical in interpreter, region, µop and fold arms.
  Under A that needs the audit above.
- **Performance.** A or D cost nothing on the fast path. B and C add a range compare on the
  code-page store path; measure on fixed work with V8 and SpiderMonkey disassembly.
- **Corpus A/B** for any behaviour change (B or C).
