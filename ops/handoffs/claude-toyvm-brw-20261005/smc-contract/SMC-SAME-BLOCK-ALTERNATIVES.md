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
| **A** | Block-scoped (status quo, described) | a store into compiled code takes effect at the next block transfer | none (description only) | zero | old byte (188); the failing same-block test stays FAILING, because A is not an accepted contract |
| **B** | 386/486 prefetch window | stale only within W bytes after the storing instruction (W = 16 on `cpu: 386`, unconfirmed); beyond W the new bytes run | in the code-page store path (already the slow path): if the target lies in the current block at ≥ next_ip + W, set `$halt` with `$gip` = next ip, so the block ends at the next instruction boundary and is re-decoded | only stores that hit compiled code; arms must honour an instruction-level halt or decline to compile such stores | old byte (within W) = PASS |
| **C** | Pentium/P6 snooping (§14.6) | any store into a not-yet-executed instruction takes effect | as B with W = 0 | as B, firing more often | new byte (132) = PASS |
| **D** | Diagnostic investigation only, NOT a contract or a fix | — | A's behaviour unchanged, plus diagnostics: a static same-block forward-store census bucketed by distance (< 16, 16–31, ≥ 32 bytes), and runtime break overlap (diag-counter/DESIGN.md) | decode time + SMC slow path | unchanged; the test stays failing |

**Consequences:**

- **C is the most compatible with modern-correct code,** but it contradicts `cpu: 386`. DOS programs
  that size the prefetch queue (a classic CPU-detection trick: patch an instruction a few bytes
  ahead and see whether the old one ran) would conclude "no prefetch queue", meaning newer than a
  486, while CPUID-less 386 detection paths say 386. That is an internal inconsistency a corpus
  program may act on.
- **B is the closest to the 386/486 behaviour the SDM describes, but not established as accurate.**
  §14.6 says only that a prefetched old instruction *could* execute on a 486 and says nothing
  model-specific about the 386. The window sizes are unconfirmed, and real prefetch fill depends on
  bus timing, so the exact boundary is not architectural in any source I have.
- **A is cheapest but matches no CPU.**
- **D measures; it does not decide.** A count is about one finite corpus, and says nothing about
  programs outside it, about arm parity, or about whether A equals a 386.

## 4. Recommendation (revised after root's review of 03b53c34)

**D, as a diagnostic investigation only. The accurate CPU contract stays UNRESOLVED.**

1. Nothing about the same-block test changes. It stays a failing test of an undecided contract. It
   is not rewritten to "expected stale", and the task does not close on any measurement.
2. Add D's diagnostic: no behaviour change, no fast-path cost. Correction to 03b53c34: the host
   cannot compute "distance from the store" today, because store handlers carry no ip. The design
   is therefore layered, as a static decode-time census (D1) plus runtime break overlap (D2),
   reported separately. See `smc-contract/diag-counter/DESIGN.md`; no code yet.
3. A bounded corpus sweep with the counter needs a later grant. Its result is evidence, not a
   verdict:
   - a **non-zero** bucket at ≥ 16 bytes names real programs whose output depends on the
     unresolved contract, which become test cases for any contract;
   - a **zero** bucket shows only that this corpus never exercises the difference. It does **not**
     show A equivalent to a 386 prefetch model, it does not establish arm parity, and it does not
     resolve the contract.
4. The contract choice among A, B and C remains open. The uncertainty at the primary-source
   boundary stays explicit:
   - §11.1.3 guarantees only store+jump and store+serialize;
   - §14.6 describes the 486 as "could" run the old bytes, and the 386 not at all;
   - the window sizes are unconfirmed.
5. C conflicts with `cpu: 386` for prefetch-queue detection code. That is an argument, not a
   resolution.

## 5. Gates that remain whatever the choice

- **Arm parity.** Same-block behaviour must be identical in interpreter, region, µop and fold arms.
  Under A that needs the audit above.
- **Performance.** A or D cost nothing on the fast path. B and C add a range compare on the
  code-page store path; measure on fixed work with V8 and SpiderMonkey disassembly.
- **Corpus A/B** for any behaviour change (B or C).
