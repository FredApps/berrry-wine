# A per-block executor for every basic block — design + prototype, 2026-09

## Why this and not another fold

[dispatch-attribution-2026-09.md](dispatch-attribution-2026-09.md) ranked four
levers by process-time share and put this one first:

| what it deletes | quake2 | caesar3 | heroes2 | removable |
|---|---|---|---|---|
| `reg accessors` (the `br_table` register file) | 11.87% | 10.44% | 8.13% | ~all |
| `dispatch` (the per-op `call_indirect` + Ion prologue) | 18.00% | 19.03% | 17.95% | ~60% |
| `flag writes` | 0.13% | 0.03% | 0.05% | ~all |
| **ceiling** | **22.7%** | **21.9%** | **18.9%** | |

[region-descriptor-bench-2026-09.md](region-descriptor-bench-2026-09.md) then
priced the *mechanism* on hand-written descriptors and found no crossover with
block length: a straight-line block of K ops runs **+29…46%** faster with the
eight GPRs in wasm locals, at every K from 2 to 32, and a micro-op inside the
descriptor costs ~22 ns against ~37 ns for the same instruction dispatched
through `$next`.

Both of those numbers come from a fold that only ever fires on **matched**
shapes — a self-loop for H454's shipped case, a hand-written graph for the
bench. This document designs the version that applies to **every basic block**,
because the 19–23% ceiling above is a share of *all* guest CPU, not of the
small slice a matcher currently claims.

The hard constraint is unchanged and is not negotiable: **no runtime wasm
codegen** (`feedback_no_runtime_wasm_codegen`). This is one fixed handler,
compiled at build time, interpreting decode-time data — exactly like H454 and
every other fold in the tree.

---

## 1. Shape of the thing

One new handler, `$th_block_exec` (H458), in `src/07c-block-exec.wat`. It holds
the eight GPRs in eight wasm locals for the length of one basic block and runs a
`br_table` over a micro-op stream the decoder wrote beside the block.

```
chunk bytes for one installed block
  +0    [ H458 | 0 ]                 8 bytes -- the block's entry op
  +8    descriptor header            16 bytes
  +24   micro-ops                    nuops * 24 bytes (+ inline words for fallbacks)
  ...   THE ORIGINAL TERMINATOR OP    left in the threaded stream, untouched
```

### 1.1 The terminator stays threaded, and that is the load-bearing decision

Every existing fold in this tree **replaces the whole block**, including its
terminator, and pays for it twice:

* `$decode_run` extends a run through fall-throughs only when the last
  `OP_INDEX` entry is a Jcc in 307..322 and `optr + 16 == d_block_end`
  (`src/07-decoder.wat:5911`). A fold that eats the Jcc kills run adjacency for
  that block — and adjacency is where 79.2% of caesar3's fall-throughs come
  from (`runs: ... free 971659 | paid 3706255`).
* Modelling call/ret/loop/jecxz/far-jmp/fused-jcc terminators means
  reimplementing them, each one a place the two arms can silently disagree.

Leaving the terminator in place costs **one dispatch per block** and buys:

* every terminator kind works, with no executor code at all — call, ret, `loop`,
  `jecxz`, `$th_test_jcc` (H404), `$th_alu_m32_i_jcc` (H407), far jumps, the
  16-bit forms, `$th_bad_opcode`;
* `$decode_run` adjacency is preserved, because `OP_INDEX` is rebuilt with the
  terminator as its last entry at the right address and the 16-byte Jcc layout
  is byte-identical;
* `$page_retire_at`'s 8-byte `{45, page|lo}` stamp still lands on the block's
  first op (now H458), so SMC retirement needs no change;
* the flags a `cmp` in the body leaves are read by the terminator out of the
  ordinary `$flag_*` globals, so there is no flag hand-off protocol to get
  wrong.

For a block of N ops the dispatch count goes **N → 2**. caesar3's blocks are 3.5
ops, heroes2's 4.3, quake2's 7.0, so this is 43%/53%/71% of the per-op dispatch
gone before any register-residency win.

Folding the terminator too is a strict follow-up and is listed as **OPEN-1**.

### 1.2 Descriptor layout

```
header, 4 words at $ip (i.e. chunk+8)
  +0   nuops           micro-op count
  +4   body_words      total words from the first micro-op to the tail op
  +8   entry_eip       guest address of the block (diagnostics only)
  +12  flags           reserved, 0
micro-ops, each $BX_UOP_WORDS = 6 words
  +0   kind            $TU_* (shared with H454) or a $BX_* extension
  +4   d               destination register index
  +8   a               source register index, 0xF = absent
  +12  imm             immediate / displacement / absolute address
  +16  fn              ORIGINAL handler index, replayed into --handler-hist
  +20  b               per-kind extra: SIB index|scale, lane bits, width,
                       dead-flag bit, ALU sub-op -- see $TU_B_* in 07b
a fallback micro-op is 6 words FOLLOWED BY:
  the original op's inline words, verbatim
  [ H458 | 0 ]         8 bytes, the resume trampoline
```

`tail_ip = header + 16 + body_words * 4`. Nothing in the descriptor is a stream
pointer, which is what keeps a chunk relocatable by plain `memory.copy` when
`$page_publish` grows a size class (`src/04-cache.wat:634`) — the same invariant
threaded code already relies on.

The micro-op encoding is **H454's**, not a second one. `$tree_uop_classify`
(`src/07b-loop-match.wat:5768`) is called unchanged, which means one classifier,
one `b`-word layout, one dead-flag vocabulary, and no possibility of the two
executors disagreeing about what `TU_ALU_SUB_RI` means.

---

## 2. Entry / exit protocol

**Live-in is all eight, live-out is all eight, at the single exit.** No masks.

The region bench measured exit publication and found it below the noise floor:
going from a four-register live-out to all eight moved the fixed term by −9 ns
and the per-op term by +1.4 ns — *opposite directions*, both inside the ±3%
floor. Publishing a register the block never wrote is a semantic no-op (the
local still holds the value it was loaded with), so a mask buys nothing and
costs a decode-time analysis that can be wrong.

```
entry:  r0..r7 <- $eax $ecx $edx $ebx $esp $ebp $esi $edi
body:   registers never leave locals except across a fallback
exit:   $eax..$edi <- r0..r7 ;  $ip <- tail_ip ;  return_call $next
```

There is exactly **one** exit, because there is exactly one block and its
terminator is not ours. That is the whole reason this design has no exit table,
no live-out mask, no side-exit resume EIP and no per-exit flag contract — all
four of which H454 needs and all four of which are places to be wrong.

### 2.1 EIP is already correct and is never written

`$eip` is written **only by terminators** (`src/04-cache.wat`, `05-alu.wat`), so
mid-block `$eip` is stale in the threaded path too — and what it is stale *at*
is precisely this block's entry address, because the previous terminator set it
there. The executor therefore never touches `$eip`, and mid-block `$eip` is
bit-identical between the two arms by construction rather than by care.

### 2.2 Meters

`$next` already charged one step and `$run` one block for entering H458. The
executor sets `$steps` to a large value for the duration (so a fallback's
internal `$next` cannot bail mid-instruction — see §3.3) and restores it on the
way out:

```
$steps = steps_at_entry - (nuops - 1)
```

exactly as H454 does. `$block_budget` is untouched: one installed block is still
one block. If the restored `$steps` is ≤ 0, the `return_call $next` on the tail
op takes the ordinary out-of-steps path, sets `$resume_ip` to the terminator and
returns to `$run` — a legal mid-block park, at a real op boundary, with every
register already published.

---

## 3. Fallback protocol

The executor implements a subset of the micro-op vocabulary. Everything else
runs **the real handler**, which is what makes the migration incremental and
what makes the progress meter honest.

### 3.1 Why the handler cannot simply be called

Every `$th_*` ends in `return_call $next`. A plain `call_indirect` into one would
therefore not return to the executor — it would tail-call into `$next` and keep
interpreting whatever bytes follow.

The fix uses the same property: **wasm tail calls unwind to the caller's frame.**
The fallback's copied words are followed by an 8-byte op naming a new handler
`$th_bx_resume` (H459) whose body is empty. So:

```
executor  --call_indirect-->  $th_real  --return_call-->  $next
                                                            |
                                              return_call_indirect
                                                            v
                                                     $th_bx_resume  -- returns
                                                            |
                                                            v
                                                 back in the executor's frame
```

`$ip` on return points one word past the resume op, which is exactly the next
micro-op. The executor reads the cursor back out of `$ip` rather than computing
it, so a handler that consumes a different number of words than expected cannot
desynchronise the walk.

### 3.2 Spill and reload, and why it is all eight

```
publish r0..r7 -> $eax..$edi          ;; BEFORE the call
$ip = &copied_words
call_indirect handler[fn](op)
reload r0..r7 <- $eax..$edi           ;; AFTER
cursor = $ip
```

All eight, not a computed def/use set. `$gs8`/`$gs32` reach
`$invalidate_code_write` and the page compiler; a fault path builds its report
out of the register file; `--trace-*` formatters read the globals. A stale
global is observable from inside the call, so the spill is total. This is the
same argument H454 makes for `TU_REP_STR` (`07b-loop-match.wat:7484`).

**This spill is also the publish-before-trap guarantee.** A handler that traps
(`$crash_unimplemented`, `unreachable`, a `--fault-null=stop` `$g2w` miss) does
so with every guest register already in its global and `$eip` at the block entry
— byte-identical to what the threaded path would leave behind, since the
threaded path also has `$eip` at the block entry mid-block and its registers are
always in globals.

### 3.3 `$steps` during a fallback

The `$next` in the chain above decrements `$steps` and, at zero, sets
`$resume_ip` and *returns without running the resume op*. From the executor's
side that is indistinguishable from a completed fallback, so the op would be
skipped. The executor therefore parks `$steps` at a large constant across the
whole body and computes the true value at exit (§2.2). Since a block is capped
at 256 x86 instructions by the decoder, no accounting can run away inside one.

### 3.4 Which handlers may NOT be a fallback

A fallback handler must not change control flow, because the executor resumes at
the next micro-op unconditionally. The matcher refuses to install a block whose
**body** contains any of:

| handlers | why |
|---|---|
| 39–46 | CALL/RET/JMP/Jcc/`$th_block_end`/LOOP |
| 307–322 | the sixteen specialised Jcc |
| 120, 125, 141, 355, 368, 370, 381, 382, 216 | indirect and far jumps, JECXZ |
| 361 | `$th_bad_opcode` — the block is a decode failure |
| 391–396 | fused terminators and the storm bitreader |
| 404, 407 | `$th_test_jcc`, `$th_alu_m32_i_jcc` — fused terminators |
| ≥ 418 | every loop/region super-op |

These are exactly the ops that set `$eip` or end a block. Anything else may fall
back: x87, MMX, `rep`, `adc`/`sbb`, string ops, the 16-bit forms, wsprintf —
they read and write globals, and the spill/reload makes globals the truth for
the duration.

Handlers that set `$yield_flag` / `$yield_reason` are deliberately **not**
excluded, because the threaded path does not stop for them either: a yield is
observed by `$run` at the block boundary and by `$branch_end`, never between two
ops of one block.

### 3.5 The fallback IS the migration meter

`get_block_exec_native_ops()` / `get_block_exec_fallback_ops()` are two i64
counters. Their ratio is the fraction of the 19–23% ceiling collected so far,
per app, and it is the number that says which opcode to migrate next. As a
side effect, `--handler-hist` under `--block-exec` grows an H459 row whose count
**is** the fallback count, because the resume trampoline is dispatched through
`$next` like any other op.

---

## 4. Lazy flags inside the executor

Nothing new is invented. Every arm calls the *same* `$set_flags_*` helper its
scalar handler calls, in source order, so the five lazy-flag globals plus
`$saved_cf` hold the exact architectural join at every instant — including at a
fallback, at a trap, and at the tail terminator that reads them.

The one elision is H454's, inherited for free because the classifier is shared:
`$TU_B_NOFLAGS`, set by the decode-time dead-flag pass when **every** lazy-flag
field a micro-op would write is overwritten again before anything reads it. It
is computed per field (`$TF_F_OP/RES/A/B/SSH/CF`), not "last writer wins",
because the writers disagree about which fields they touch —
`$set_flags_logic` writes three, `$set_flags_add` five, `$set_flags_inc` six —
and a subset-overwrite is exactly the common `and`-then-`dec` shape.

The attribution says flag writes are already 0.03–0.13% of guest CPU with V8
inlining on, so this is not where the money is. It is here because dropping a
`$set_flags_inc` also drops its `$get_cf`, and because the machinery already
exists.

**In this prototype the dead-flag pass is NOT run** — see OPEN-3. Every micro-op
publishes its flags. That is the conservative direction (more work, never wrong)
and it keeps the first correctness comparison clean.

---

## 5. Memory operations and `$g2w`

Every access goes through `$gl8/$gl16/$gl32/$gs8/$gs16/$gs32`, never through
`$g2w` directly. That is not a simplification: those wrappers own SMC
invalidation (`$invalidate_code_write`), page crossing, the DIB window and the
sparse translator. Reimplementing the translation inside the executor would
duplicate five decisions and lose the `--fault-null` reporting.

The attribution measured `$g2w` at 2.5–3.3% of guest CPU and the whole
guest-memory path at 10.7–13.5%, so the translation itself is not the prize —
which is why hoisting it is **not** in the prototype. What the prototype does
hoist is the *SIB effective address*, behind one range test on the micro-op kind
(`kind >= $TU_FIRST_SIB`), exactly as H454 does: base and index come out of
locals, so a `[ebx+ecx*4+disp]` costs an add and a shift instead of two
`$get_reg` calls.

Per-block `$g2w` hoisting for a loop-invariant base is **OPEN-4**. It needs a
decode-time proof that the base register is not written in the block *and* that
the whole accessed range stays inside one translation window, and the second
half is the hard one: the direct window, the DIB range and the sparse map have
different bounds and a hoisted base that crosses one silently reads the wrong
memory.

---

## 6. Safepoints

| facility | where it is checked | changed by this design? |
|---|---|---|
| `$block_budget` | `$run` loop head, `$branch_end`, `$jcc_end` | no — one block is one block |
| `$steps` | `$next`, restored by the executor at exit | no — a park lands on the tail terminator, a real op boundary |
| `$yield_flag` / `$yield_reason` | `$run` loop head, `$branch_end` | no — never checked between two ops of a block, in either arm |
| breakpoints, `--watch`, `--count`, `--trace-at` | `$run` loop head, under `$dbg_any` | no — block entry only, in both arms. A breakpoint that is *inside* a block is not hit by the threaded path either |
| SMC | `$invalidate_code_write` on every store, `$page_retire_at` stamps `{45,…}` over the block's first op | no — the first op is H458 and the stamp is 8 bytes |
| guest fault | `$g2w` miss → `NULL_SENTINEL`, or trap under `--fault-null=stop` | see below |

**`--fault-null=stop`.** Under that flag a `$g2w` miss traps, and a trap inside a
*native* micro-op would leave the register globals stale (the locals hold the
truth). Fallbacks are safe because they spill first (§3.2), but native ops are
not. The prototype therefore **declines to install while `$fault_unmapped` is
nonzero**, and `set_fault_unmapped` additionally raises
`$thread_flush_pending`, so arming the flag mid-run discards every block already
installed. That is airtight and costs nothing on an unarmed run. The alternative
— spilling before every native memory op — is **OPEN-5**.

`--fault-null` in *report* mode (no `stop`) does not trap, so it is unaffected
beyond the same decline.

---

## 7. Interaction with the existing folds

`$block_exec_try_install` runs at the end of `$decode_block`, **after**
`$loop_match_block` and therefore after every existing family. It declines
immediately if `$op_index_n == 0`, which is the sentinel every fold sets when it
rewrites the stream. So:

* **LUT_RUN / COPY_RUN / RLE_RUN / rect_run / case_chain / the AVG and
  colour-key families / the x87 fusions / H454 tree-fold / the region door** all
  keep priority. A block a specialised fold claimed is never touched.
* The block executor picks up what those decline — which, per
  `match-loops.js --why`, is 98% of static self-loops and 100% of everything
  that is not a self-loop at all.
* The *intra-block* fusions (SIB fusion, store-span, `$th_test_jcc`,
  `$th_alu_m32_i_jcc`, `$th_store32_abs_run`) run during decode and are already
  in the op stream by the time the matcher sees it. Fused ops that are
  terminators stay as the tail; fused ops that are not (H405/H406 abs-runs,
  H403 ptrvar-fetch) currently take the fallback path. Teaching the classifier
  about them is the cheapest coverage win available and is **OPEN-6**.
* H454's own executor is untouched. There are now two micro-op interpreters over
  one encoding, which is a real cost — see OPEN-2 for why they were not merged.

---

## 8. Worker threads

Mutable wasm globals are instance-local even over shared memory, so every new
toggle must reach every per-thread instance. The mechanism is declarative and
gated:

1. `(global $block_exec_enabled (mut i32) (i32.const 0))` in
   `src/07c-block-exec.wat`.
2. `set_block_exec` / `get_block_exec` in `src/13-exports.wat`.
3. `{ setter: 'set_block_exec' }` appended to `INHERITED_WASM_GLOBALS` in
   `lib/worker-imports.js` — **without** `skipZero`, because zero is a
   meaningful value for a toggle.
4. `'set_block_exec'` added to the required-setter list in
   `test/test-worker-wasm-globals.js`, which is the build gate that makes
   forgetting step 3 impossible to ship.
5. `test/run.js` records it for workers (`inheritWasm`) **and** applies it to the
   main instance directly — the two halves are separate code paths and a flag
   wired into only one is the classic silent half-A/B.

The gate is read at **decode** time, so a per-thread instance that never got the
setter simply decodes threaded blocks — wrong measurement, never wrong
execution. That is why the test above exists rather than a runtime assert.

---

## 9. Caps, derived rather than typed

A descriptor past the reserved slack corrupts the next block silently instead of
failing, so both bounds are computed and the matcher **declines** rather than
truncates:

* **Emit slack.** `$decode_block` reserves 4096 bytes past `$thread_alloc`
  before `$te` signals a flush (`src/04-cache.wat:886`). The installed block is
  `8` (the H458 op) `+ 16` (header) `+ body_words*4` `+ tail_bytes`, so the
  bound is
  `body_words <= (4096 - 24 - tail_bytes) / 4`.
* **Classify scratch.** The descriptor is built in the far half of `OP_INDEX`
  (words 1024..2047, 4096 bytes), because writing it forward from `$tstart`
  would overwrite the very ops still being read — a 24-byte micro-op over an
  8-byte op clobbers on the third instruction. So `body_words + tail_words <=
  1024`, and additionally `op_index_n < 1024` or the near half's own entries
  would be inside the scratch.

Both are computed in `$block_exec_try_install` from the globals, not typed as
constants, so a change to the slack or to `$OP_INDEX_SIZE` moves them.

Three more decline conditions, all cheap and all at decode time:
`$op_index_poison` (the block had > 2048 ops), `$code16` (16-bit blocks have a
different register and address model), and `nuops < $block_exec_min_uops`
(default 2 — below that the H458 dispatch is not repaid).

---

## 10. Migration order, by measured population

`--handler-hist --handler-hist-thread=0` on the three attribution windows, this
HEAD, `--block-exec` off. Percentages are of retired ops in the window.

| handler | quake2 | caesar3 | heroes2 | in the prototype? |
|---|---|---|---|---|
| H11 `$th_mov_r_r` | 8.26% | — | 4.09% | native `TU_MOV_RR` |
| H344 `$th_load32_ro_base_ebp` | — | **21.93%** | 7.38% | native `TU_LOAD32` |
| H407 `$th_alu_m32_i_jcc` | — | 9.13% | — | **terminator — stays threaded** |
| H3 `$th_add_r_i32` | 3.01% | 8.85% | — | native `TU_ADD_RI` |
| H43 `$th_jmp` | — | 8.65% | 4.22% | **terminator** |
| H352 `$th_store32_ro_base_ebp` | — | 8.55% | — | native `TU_STORE32` |
| H45 `$th_block_end` | 2.34% | 7.49% | — | **terminator** |
| H53 `$th_shift_r` | 2.96% | 6.65% | 2.37% | native `TU_SHIFT` |
| H18 `$th_xor_r_r` | 4.11% | 1.50% | 2.89% | native `TU_XOR_RR` |
| H64/H65 `$th_inc_r`/`$th_dec_r` | 5.94% | — | 1.67% | native `TU_INC`/`TU_DEC` |
| H312/311/319/320 Jcc | 8.31% | 2.39% | 7.61% | **terminator** |
| H19 `$th_cmp_r_r` | 3.79% | — | 1.91% | native `TU_ALU_*` / terminator |
| H28 `$th_load8_ro` | 3.55% | 0.49% | — | native `TU_LOAD8_RO` |
| H149 `$th_compute_ea_sib` | 2.01% | 3.84% | — | native `TU_EA_SIB` pair |
| H343 `$th_load32_ro_base_esp` | 2.84% | — | 1.45% | native `TU_LOAD32` |
| H155 `$th_mov_r8_r8` | 2.84% | — | — | native `TU_MOV_SUB_RR` |
| H10 `$th_cmp_r_i32` | 2.75% | 1.48% | 1.25% | native / terminator |
| H154 `$th_alu_r8_i8` | 2.67% | — | — | native `TU_ALU_SUB_RI` |
| H404 `$th_test_jcc` | 2.64% | — | 4.31% | **terminator** |
| H190 `$th_fpu_mem_ro` | 1.94% | — | — | fallback (x87) |
| H401 `$th_store8_sib` | 1.63% | — | — | native `TU_STORE8_SIB` |
| H76/H133 `mov m32, imm32` | — | 6.12% | — | fallback → **OPEN-6** |
| H128 `$th_alu_r_m32_ro` | — | 2.05% | — | fallback → **OPEN-6** |
| H148 `$th_lea_sib` | — | — | 2.80% | native `TU_LEA_SIB` |
| H405/H406 abs-runs | — | — | 3.69% | fallback → **OPEN-6** |
| H403 `$th_ptrvar_fetch8` | — | — | 1.43% | fallback → **OPEN-6** |
| H323–H338 push/pop | — | — | 1.58%+ | native `$BX_PUSH_R`/`$BX_POP_R` |

Two things this table says that a textbook opcode ranking would not:

1. **The population is of *handlers*, not of x86 opcodes**, and the decoder has
   already fused and specialised heavily. caesar3's single hottest handler is
   `mov r32,[ebp+disp]` at 21.9% — a *base-specialised* load that does not exist
   as an x86 opcode. Migrating "mov" is meaningless; migrating H339..H346 and
   H347..H354 is 30% of caesar3.
2. **A third of the hot list is terminators**, and this design gets all of them
   for free by not touching them.

The prototype's native set is therefore the H454 integer vocabulary
(`TU_MOV_*`, `TU_ADD/SUB/AND/OR/XOR_*`, `TU_INC/DEC/NEG/NOT`, `TU_SHIFT`,
`TU_LOAD32/STORE32` and their `_ABS` and `_SIB` forms, the byte and 16-bit
forms, the sub-register forms, the H149 EA pair) plus three of its own
(`$BX_PUSH_R`, `$BX_POP_R`, `$BX_PUSH_I`), with everything else — x87, MMX,
`rep`, `adc`/`sbb`, `imul`, the un-classified fused handlers — taking the
fallback.

---

## 11. Open decisions that need the owner's sign-off

* **OPEN-1 — fold the terminator?** §1.1 leaves it threaded for adjacency and
  coverage, at one dispatch per block. Folding the sixteen Jcc plus H43/H45
  would take a 4-op block from 2 dispatches to 1, but breaks `$decode_run`
  extension unless the descriptor also carries the fall-through/target pair and
  the adjacency bit gets patched inside it. Worth it only if the measured
  per-block overhead says so.
* **OPEN-2 — two executors, one encoding.** `$th_block_exec` duplicates ~34 of
  H454's 54 micro-op arms because *a wasm local cannot cross a function
  boundary*, which is precisely the property the whole design exists to
  exploit. The alternatives are (a) live with the duplication, (b) delete H454
  and re-express the self-loop fold as a one-block case of this executor with an
  iteration count, (c) generate both arms from one source at build time. (b) is
  the honest one and is a bigger change than this prototype.
* **OPEN-3 — run the dead-flag pass?** The prototype does not (§4). Wiring
  H454's pass in is mechanical, but its correctness argument is stated over a
  self-loop whose only flag consumer is the terminator; over an arbitrary block
  the consumer set also includes anything reachable *after* the block, so the
  pass has to treat block exit as a full flag read. That is a strictly weaker
  elision than H454's and needs measuring before it is worth the risk.
* **OPEN-4 — hoist `$g2w` per block?** §5. Needs a proof the base is unwritten
  *and* that the range stays in one translation window.
* **OPEN-5 — spill before native memory ops under `--fault-null=stop`?** §6
  currently declines instead. Spilling costs a predictable branch per memory op
  and makes the debug flag work inside installed blocks.
* **OPEN-6 — widen the classifier to the fused handlers.** H76/H133 (`mov
  m32,imm32`), H128 (`alu r,[base+disp]`), H405/H406 (abs runs), H403
  (ptrvar-fetch), H154/H155's paired form. Each is a decode-time-only change in
  `$tree_uop_classify`, benefits H454 as well, and the fallback counters name
  them in ranked order per app.
* **OPEN-7 — default ON for which apps, and when?** The flag is OFF and every
  app path leaves it off. Turning it on is a separate decision that needs the
  PNG identity sweep over the whole registry, not the five apps this prototype
  checked.
* **OPEN-8 — ~~`$block_exec_min_uops` default~~. SETTLED by measurement, 2026-09-13.**
  `bench-loops.js --toggle=block_exec` puts the crossover between 8 and 16
  micro-ops, and the app arms agree: at a floor of 2 Heroes II is a *resolved
  loss*, at 12 it is unresolvable and MW3 is a resolved gain. The shipped floor
  is now 12. What remains open is whether the floor should be a *cost* estimate
  rather than a count — a 12-uop block that is half fallbacks is a worse deal
  than an 8-uop block that is all native, and the installer already knows both
  numbers at decode time.

---

## 11b. What the prototype measured (2026-09-13)

Every number below was taken on a box at loadavg 240–440, so the app-scale rows
are `fold-ab.js` user CPU with a NULL control and the bench rows are minima over
7 interleaved reps. Wall clock is not quoted anywhere and should not be: the
same Quake II command came back at 34.9s and 4.4s in two runs whose *user CPU
was 1.94s in both*.

**Bench (`tools/bench-loops.js --toggle=block_exec`, minima, 7 reps).** This is
the shape of the whole result — a descriptor's cost is fixed and its saving is
per-micro-op:

| shape | on-vs-off | note |
|---|---|---|
| `blk2` | −1.9% | the descriptor does not repay its own entry |
| `blk4` | +4.7% | |
| `blk8` | −0.9% | still inside the noise floor |
| `blk16` | **+22.0%** | |
| `blk32` | **+36.2%** | |
| `blk_mem8` | +18.8% | base+disp loads/stores, 8 ops |
| `blk_fb8` | +18.8% | 8 ops with one ADC falling back mid-block |

**Native vs fallback share, at the old floor of 2** (`--block-exec-stats`; the
share is a load-immune count, so these are the trustworthy rows):

| app | installs | declines | runs | native ops | fallback ops | native % |
|---|---|---|---|---|---|---|
| mw3 | 5023 | 3753 | 2.80M | 98.5M | 0.22M | **99.77%** |
| quake2_demo | 4503 | 2238 | 2.10M | 14.9M | 1.54M | 90.61% |
| notepad | 142 | 89 | 350 | 1162 | 362 | 76.24% |
| caesar3_demo | 347 | 170 | 18.9k | 55.8k | 18.5k | 75.13% |
| calc | 973 | 339 | 674k | 3.31M | 1.95M | 62.95% |
| heroes2_demo | 1881 | 1452 | 7.47M | 18.4M | 11.0M | **62.56%** |

At the shipped floor of 12 the same apps install far fewer blocks and cover far
more work through them — heroes2 129 installs at 91.51% native, mw3 263 installs
at 99.99% — which is the whole argument for the floor in one line.

**App scale (`fold-ab.js`, user CPU, NULL arm, 7 reps):**

| app | floor | off median | on−off mean | null spread (2σ) | verdict |
|---|---|---|---|---|---|
| quake2_demo | 2 | 2.160s | +0.034s | 0.046 | unresolvable |
| heroes2_demo | 2 | 3.080s | **+0.361s** | 0.103 | **resolved LOSS (+11.7%)** |
| heroes2_demo | 12 | 3.440s | +0.030s | 0.232 | unresolvable |
| mw3 | 12 | 8.540s | **−0.396s** | 0.327 | **resolved GAIN (−4.6%)** |

Heroes II at floor 2 is the design's failure mode made visible: short blocks,
37% of ops falling back, 7.5M block runs each paying a fixed entry and exit.

**PNG identity** (`tools/png-diff.js`, `--no-close`, fixed `--max-batches`):
quake2_demo (pinned `--args='+set vid_ref soft +map demo1'`), heroes2_demo, mw3,
notepad and calc are all **0 pixels different**. Quake II *unpinned* at exactly
3000 batches differs in 286 of 76800 pixels — see §6.1; it is a pacing phase,
not a wrong answer, and at 6000 batches the same pair is pixel-identical again.

### 6.1 The one residual difference, and why it is not a correctness bug

`$steps` is not a per-block quantum. Since `$branch_end`/`$jcc_end` stopped
unwinding at terminators it is the *tail-call chain length*, ~1000 ops spanning
many blocks, and when it runs out `$next` parks `$resume_ip` and hands control
back to `$run`, which re-arms it and goes round the main loop — polling host
input on the way.

The executor's body is not preemptible: it parks `$steps` at `0x100000` for the
duration and settles the bill at exit. The total billed is identical (that is
what the four-term exit formula is for), but a chain break that threaded code
would have taken *inside* a block is deferred to that block's terminator. So the
break points move by a few ops, the input polls land at slightly different
places, and a screen that is mid-animation at the capture batch is caught one
phase off. Measured: Quake II unpinned makes 5983 API calls with the executor
against 5979 without at 3000 batches — and 6153 against 6155 at 6000 batches, so
the drift has no sign. Both arms converge to the same picture.

This is inherent to a non-preemptible block body, not a defect to be fixed, and
it is the reason a PNG identity check must be run at more than one budget.

### 6.2 Two bugs this prototype found, one of them pre-existing

**The H149 pair, both halves.** `$th_compute_ea_sib` (H149) writes the
`$ea_temp` **global**; its consumer's address word is `$SIB_SENTINEL` and
`$read_addr` substitutes that global. The executor replaces the pair with an
`$ea_hold` **local**, so every boundary where the pair is split needs an
explicit join, and there are two:

* a native `EA_SIB` followed by a **fallback** consumer — the handler reads
  `$ea_temp`, which nothing wrote, and addresses whatever the last threaded SIB
  op left behind. Fixed by publishing `$ea_temp` before the call and reloading
  `$ea_hold` after it.
* a native `EA_SIB` as the **last body micro-op**, whose consumer is the
  terminator — still threaded, still reading the global. Fixed by publishing
  `$ea_temp` at block exit alongside the eight GPRs. Quake II's `0x00436b59`
  (`xor / mov r8,[…] / lea-EA`) is the block that needs it.

Both presented as a crash an arbitrary distance later, which is what a plausible
wrong address always does.

**A latent H454 miscompile, found here and fixed in `07b-loop-match.wat`.** The
SIB scale in the EA hoist was extracted as `b >> 4` with no mask. Scale is two
bits at `b[5:4]`, and `$TU_B_LANE_D` is `0x40` — bit 6 — so on the one kind that
carries SIB fields *and* a lane bit (`TU_STORE8_SIB`) an unmasked shift folds
the lane bit into the shift amount as `+4`: a high-byte store through an indexed
address writes at `index << (scale+4)`. H454 has apparently never met that
combination in a self-loop; `test/test-block-exec.js` reaches it directly. H458
shares the decode verbatim, so the fix is one `(i32.and … 3)` in each.

### 11c. Facilities added while debugging this

* `--block-exec-max-uops=N` — with `--block-exec-min-uops=N`, an exact-size
  sieve. Running one size per run took a whole-app divergence down to a named
  block in two runs, and it is also how "one bad opcode" was told apart from
  "cumulative pacing" for §6.1: *every* single size was clean while the union
  was not.
* `--trace-block-exec` — logs each install as a `0xBE000000` marker, the entry
  EIP, the micro-op count, then (kind, original handler) per micro-op.
* `tools/block-exec-decode.js` — turns that log back into named blocks and
  prints the fallback histogram, which is the OPEN-6 work list in ranked order.

---

## 12. Reproducing

```bash
bash tools/build.sh
node test/test-block-exec.js
node test/test-x86-ops.js
node tools/bench-loops.js --toggle=block_exec --reps=9 --bytes=4m \
  --shapes=blk2,blk4,blk8,blk16,blk32,blk_mem8,blk_fb8,blk_null
node tools/fold-ab.js --target=win98 --app=quake2_demo --work=1200 --reps=6 \
  --arm-on='--block-exec' --base='--quiet-api --quiet-blocks --no-close' \
  --args='+set vid_ref soft +map demo1'
node test/run.js --app=caesar3_demo --no-build --block-exec --block-exec-stats ...
```

`--block-exec-stats` prints installs, declines, runs and the native/fallback op
split at exit. Every percentage in a report from this harness must be read with
`loadavg` beside it; this box sits at 60–350 and its wall clock measures the
neighbours, which is why the app-scale arm is `fold-ab.js` on user CPU with a
NULL control and never a two-arm wall-clock comparison.

---

## 13. The merge (2026-09-13): one executor, one descriptor

Handlers 454 (`$th_tree_fold`) and 458 (`$th_block_exec`) were two executors
reading two descriptor formats for the same idea. They are now **one function**.
`src/02-thread-table.wat` lists `$th_block_exec` at *both* 454 and 458 — 454
survives only as an alias so the loop matcher's installs, `$region_try_install`
and every recorded histogram keep the identity they already had; new installs
from the block matcher emit 458.

The unifying statement is that there is one shape with three cases:

| case | descriptor |
|---|---|
| a plain block | 1 block, no back edge, terminator left threaded (`term_kind 5`) |
| today's self-loop fold | 1 block, back edge, terminator folded |
| a region | N ≤ 16 blocks, an exit table, one entry |

### 13.1 What moved out of H454

Everything. Each former H454 capability is now a case inside the merged
executor, not a second code path:

* **loop-in-place terminator** — the folded terminator kinds (`dec/inc`,
  `cmp r,r`, `cmp r,imm`, `cmp r,[r+d]`, unconditional) all execute in the
  region loop, and OPEN-1 is answered for the block case by the new
  **`term_kind 5`**: a block whose terminator stayed threaded sets `tail_exit`,
  and the executor resumes the threaded tail at `$ip = tail_ip` instead of
  going out through `$branch_end`.
* **per-exit live-out publication** — the exit table's `live_out` mask, with
  `0xFF` for a threaded tail.
* **interior flags-as-values** — the `$TF_F_*` dead-flag elision.
* **x87 micro-ops, `ea` pair, `rep` micro-ops, push/pop, 16-bit memory,
  partial-reg lanes** — all in the one `$TU_*` kind space (0..57), dispatched
  by one `br_table`. The dense private `$BX_*` kind space and `$bx_kind_for_tu`
  are deleted; there is no second numbering left to keep in sync.

Nothing failed to move. Two capabilities changed shape rather than being
dropped: ADC/SBB are now native micro-ops (they used to be forced to a
fallback by `$bx_kind_for_tu` returning -1), and a fallback's inline operand
words now live in a **trailing fallback pool** rather than inline in the uop
stream, so the uop stride stays exactly 24 bytes and every hand-written
descriptor in the tests and the bench stays valid. Header word +12, previously
`reserved` and always written as 0, is now `fb_bytes`.

### 13.2 OPEN-6 and OPEN-7

* **OPEN-6** — the classifier was widened to the fused handlers the executor
  kept falling back on; the measured fallback share is now under 3.5% of
  in-region ops on every app in §13.4 and under 1% on four of six.
* **OPEN-7** — the install floor is a **cost estimate in ns**, not a uop count:
  `benefit = 16·native_uops + 9·transfers_saved`, `cost = 190 + 20·fallbacks`,
  all known at decode time. `--block-exec-min-uops=N` still forces a hard
  floor for A/B work; `0` (the default) means "use the model".
* **`test r,r` / `test r,imm` as terminator flag producers** — the census's top
  decline, accepted as `term_kind 6` and `7`. The decoder *fuses* `test r,r`
  with the following `Jcc` into one op (H404), so the matcher had to learn the
  fused form as well as the two-op one; `$loop_is_selfloop` was widened to see
  H404, deliberately without widening `$loop_is_jcc`, which every specialised
  family calls to mean "a pure branch".

### 13.3 One switch

`--block-exec` is the switch, default OFF. `--tree-fold` is accepted for one
round as an alias and prints a deprecation line. `$region_try_install` now
honours either `$block_exec_enabled` or the bench's narrower
`$region_fold_enabled`, so `--toggle=block_exec` covers the region shapes too.
The new mutable global `$block_exec_transfers_saved` is in
`INHERITED_WASM_GLOBALS` (`test/test-worker-wasm-globals.js`: 31 setters).
`--block-exec-stats` now prints `entries` (not `runs`) and `transfersSaved`, so
ns/entry and ns/op can be fitted from user CPU.

### 13.4 Coverage, measured

`--max-batches=8000 --max-seconds=25` (heroes2 and caesar3 are truncated by the
wall-clock guard), share of *retired handler ops* that ran inside a region:

| app | installs | declines | entries | native ops | fb ops | native % | transfers saved | total ops | in-region % |
|---|---|---|---|---|---|---|---|---|---|
| quake2_demo | 483 | 30364 | 278293 | 12298919 | 425437 | 96.66 | 500802 | 61269570 | 20.77 |
| heroes2_demo | 58 | 3143 | 23017 | 419479 | 12917 | 97.01 | 43 | 39113523 | 1.11 |
| mw3 | 153 | 8215 | 312520 | 285925551 | 2220 | 100.00 | 7150577 | 288350915 | 99.16 |
| notepad | 2 | 223 | 2 | 31 | 1 | 96.88 | 0 | 2261 | 1.42 |
| calc | 137 | 1100 | 3556 | 60726 | 464 | 99.24 | 0 | 6144723 | 1.00 |
| caesar3_demo | 13 | 504 | 64 | 1222 | 12 | 99.03 | 80 | 99601 | 1.24 |

Every entry counted here is a **1-block** region: `$block_exec_try_install`
emits 1-block descriptors and `$region_try_install` only installs a descriptor
handed in through `set_region_spec`. There is still **no multi-block matcher**,
so `transfersSaved` is today the self-loop back edges, and the N-block numbers
in §13.5 are what a matcher *would* be worth, not what any app gets.

### 13.5 Bench, pre-merge vs post-merge

`tools/bench-loops.js --toggle=block_exec`, minima, ≥7 reps, loadavg 11-13.
Pre-merge column is [region-descriptor-bench-2026-09.md](region-descriptor-bench-2026-09.md).

| shape | pre-merge | post-merge | Δ |
|---|---|---|---|
| blk2 | −1.9% | −6.5% | (both declined — noise) |
| blk4 | +4.7% | −3.5% | (both declined — noise) |
| blk8 | −0.9% | −2.5% | (both declined — noise) |
| blk16 | +22.0% | +4.8% | **−17** |
| blk32 | +36.2% | +16.0% | **−20** |
| blk_mem8 | +18.8% | declined | see below |
| blk_fb8 | +18.8% | declined | see below |
| region_if2 | +39.6% | +33.5% (paired +30.6) | −6 |
| region_diamond4 | +31.0% | +40.4% (paired +41.7) | +9 |
| region_state6 | +41.5% | +39.1% (paired +46.7) | −2 |
| region_ladder5 | +40.8% | +38.4% (paired +38.6) | −2 |
| region_null | −1.3% | +3.2% (paired −6.0) | control |

**The region shapes held; the single-block shapes lost 17-20 points.** That is
the bigger-function tiering loss this design predicted: the merged executor is
one much larger wasm function than either half was, and the 1-block case is
where the entry cost is amortized over the fewest micro-ops, so it is exactly
the case that pays for the size. The N-block cases re-enter the same expensive
prologue far less often per unit of work and are untouched.

The `blk_mem8` / `blk_fb8` rows are the cost model, not a regression, and they
are also **the measurement that calibrated it**. Forcing them to install by
dropping `$BX_C_ENTRY` to 100 (breakeven ≈ 7 native uops) and re-running:

| shape (ENTRY=100, forced install) | result |
|---|---|
| blk8 | **−3.2%** |
| blk_mem8 | **−12.2%** |
| blk_fb8 | **−8.5%** |
| blk16 | +5.7% |
| blk32 | +19.4% |

So on the merged executor a 9-uop block is a *loss*, where on the pre-merge one
it was +18.8%. The real breakeven now sits between 9 and 16 native uops, and
`190 / 16 = 11.9` lands inside that window and declines exactly the shapes that
measured as losses. The floor moved because the executor got bigger — which is
the whole argument for expressing it as a cost rather than a constant.

### 13.6 App-scale A/B

`tools/fold-ab.js --target=win98 --arm-on='--block-exec'`, user CPU, three arms
with a NULL control:

| app | work | reps | on−off | null−off | verdict |
|---|---|---|---|---|---|
| quake2_demo | 1500 | 3 | −0.070s (−2.4%) | −0.090s | unresolvable |
| heroes2_demo | 1500 | 3 | −0.140s (−2.8%) | +0.113s | unresolvable |
| mw3 | 3000 | 2 of 4 | +0.34s, −0.12s | — | unresolvable |

Both directions favour the arm on quake2 and heroes2, but the box sat at
loadavg 11-28 for the whole window and the NULL arm moved as much as the arm
did — twice the null spread is larger than the effect in every case. mw3, the
one app with real coverage (99.2% of retired ops in a region), could not
complete its reps inside the 178s cap at load 25-28. **No app-scale number
from this session is quotable**; the honest statement is that the microbench
says the 1-block case got 17-20 points worse and the app harness cannot see
either sign through the noise.

### 13.7 Still open

* **OPEN-1 (partial)** — done for the block case via `term_kind 5`; a folded
  `Jcc` terminator inside an N-block region still ends the region rather than
  looping in place across members.
* **OPEN-2 / the multi-block matcher** — nothing builds an N-block descriptor
  from real code. §13.5's region rows are the payoff waiting on it, and it is
  the only work that would make `transfersSaved` mean what its name says.
* **OPEN-3, OPEN-4, OPEN-5** — untouched, as scoped.
* **The tiering loss in §13.5.** The merged function should be split so the
  1-block no-fallback case is a small leaf the JIT will tier and inline, with
  the general region loop behind it. That is a refactor of one function, not of
  the descriptor, and the descriptor merge is what makes it possible.
* **Region cases with no reachable test** — SMC of one member block, a
  breakpoint inside a region, and a 6-block state machine from real code are
  all unreachable until a matcher exists; the bench arms them by hand through
  `set_region_spec`, which is not the same coverage.

## 14. The multi-block matcher (round 9, 2026-09-14)

OPEN-2 is closed: real guest code now produces N-block region descriptors. The
work is in `src/07c-block-exec.wat` (`$bx_region_begin` / `$bx_region_collect`
/ `$bx_region_finish`, and the classifier and edge resolver under them), wired
into `src/07-decoder.wat` at three points, with the builder's scratch in a new
`$BX_RG_BASE` region. **Default OFF**, like everything else in this family.

### 14.1 Where the members come from

Not from a recursive decode and not from a pre-scan. The matcher rides
`$decode_run`, which already walks exactly the set the census's rules describe:
single entry, ascending guest address, one page, stopping at already-compiled
code. `$bx_region_begin` arms a builder at the run's first block,
`$bx_region_collect` classifies each block at the tail of `$decode_block`, and
`$bx_region_finish` decides and emits at the end of the run. The cost of a
declined region is one classify pass over a block that was going to be decoded
anyway.

Because the chain is guest-contiguous by construction, the region's extent is
one hole-free span, and that is what makes the rest work:

* **Entry through the head only.** `$page_publish` retires every old block the
  new extent touches and keeps one owner per guest byte, so publishing the
  region over `[head, last member end)` retires the members' own entries.
* **SMC is the existing mechanism, unchanged.** A write to any member byte hits
  a cover mark inside the region's extent and retires the whole region. No
  generation counter was added.
* **A jump into a member is self-healing.** The interior address is not in the
  index, so it misses, re-decodes, and symmetrically retires the region — the
  "or decline" arm of the brief, arrived at for free.
* **A thrash guard** (64 direct-mapped slots of head EIP + install count,
  refusing past 16) stops the region/interior-entry ping-pong that the two
  previous bullets otherwise permit forever.

Loop back edges resolve against the member set and stay inside. `$steps` is
billed per block at block edges, as before.

### 14.2 What declines, measured

`--block-exec-stats` now prints four new lines: `byN(ops/entries/installs)`,
`declinedBy`, `chainEndedBy` and `classifyRefused`. On quake2 (`+map demo1`,
300 batches, `--block-exec-min-uops=1`):

```
declinedBy       notWorthIt=482 exitsFull=5 thrash=14164 shortChain=412327
chainEndedBy     head.classify=277469 tail.classify=31006
classifyRefused  byteFusedJcc=1939 noFlagProducer=74879 termNotModelled=190250
                 uopsFull=24 unsafeOp=41383
```

**`termNotModelled` is the answer to "what declined most and why" in five of
six apps.** The block ends in a `call`, a `ret` or an indirect branch, which the
descriptor cannot express, so the chain dies on its own head block. Diablo is
the exception: there `noFlagProducer` is 1.84M of 2.81M refusals — an `and` or
`sub` that writes a register is not one of the five producer shapes the
backward walk accepts.

Two caps that do NOT bind, confirming the census: `uopsFull` and `exitsFull`
are three orders of magnitude below the other reasons, and `blockCap` never
fires outside starcraft.

A chain that dies on its head used to end the whole run. It now restarts at the
next block (`$bx_rg_restart`), which is worth the difference between 6,260 and
23,698 candidate chains on the quake2 window. The restart is also what forced
`$bx_rg_run_start`: a region whose head is past the EIP the run was entered for
must NOT be handed back as the run's entry point, and doing so was a hard crash
(EIP into a string table) the first time the restart found anything.

### 14.3 Coverage, and the census cross-check

Two arms per app: the shipped OPEN-7 cost model, and `--block-exec-min-uops=1`,
which replaces the benefit/cost test with a uop floor and is therefore the
matcher's **coverage ceiling**. `opsMulti%` is micro-ops retired inside a 2+
block descriptor as a share of all guest ops (the `--handler-hist` total).

```
app                   arm       installs  meanN  entriesMulti   opsMulti  opsMulti%  census 2+
----------------------------------------------------------------------------------------------
quake2_demo           default         11   4.27            50      1,014     0.000%      6.2%
                      min-uops=1  23,593   2.43     3,678,747 11,497,799     2.68%
caesar3_demo          default          2   5.00            54      1,108     0.000%     54.7%
                      min-uops=1     135   2.24     2,082,993  6,631,513     2.09%
heroes2_demo          default          1   9.00             1         22     0.000%      4.0%
                      min-uops=1     143   2.56       596,592  2,015,011    12.66%
mw3                   default          1   2.00             1         27     0.000%     43.8%
                      min-uops=1     217   2.22        57,238    253,296     2.10%
diablo_shareware      default         10   4.40        65,844  5,102,770     0.75%      21.1%
                      min-uops=1   3,853   3.05     3,660,996 21,495,114     3.16%
starcraft_shareware   default         15   4.07           822      6,007     0.000%     12.1%
                      min-uops=1   5,960   2.27     1,520,567  8,573,486     0.96%
```

**The ratio to the census is 0.02–0.43 at the ceiling and ~0 at the shipped cost
model. That gap is a matcher limit, not a census over-count, and the limit is
the discovery source.** The census followed *Jcc and jmp targets as well as
fall-throughs*; this matcher only ever sees `$decode_run`'s fall-through chain,
and `$decode_run` stops at the first terminator that is not a specialised Jcc.
A region whose head is reached by a branch, or whose second block is a branch
target rather than a fall-through, is invisible here by construction. caesar3 is
the clearest case: the census puts 96.6% of its ops in 2-4 block regions and the
matcher reaches 2.09%.

One row deserves reading on its own: **diablo at the default model installs ten
regions, one of which is a 2-block descriptor entered 65,280 times and worth
15.9% of all executor ops.** The cost model is not uniformly wrong; it is
uniformly *quiet*, and when it does fire it can fire on something hot.

heroes2 exceeds its census figure (12.66% vs 4.0%) because the windows are not
the same — the census sampled MSS32 decode, this sweep is a 300-batch boot.

### 14.4 Throughput

**Microbench** (`tools/bench-loops.js --toggle=block_exec --reps=7`, paired
median, minima in the log). The three multi-block shapes are now installed by
the *matcher*, not hand-fed through `set_region_spec`:

```
shape             blocks/iter on→off   paired   min-based   null (--toggle=rect_run)
-----------------------------------------------------------------------------------
region_if2         0.01 → 2.00         +36.9%     +36.7%      +1.1%
region_diamond4    0.01 → 2.00         +36.7%     +37.9%      +1.0%
region_state6      0.02 → 2.00         +39.4%     +40.3%      +1.6%
blk16              2.00 → 2.00          +1.6%      +4.0%      -1.2%
blk32              2.00 → 2.00          +7.3%      +4.6%      -0.8%
```

So the *mechanism* is worth 37-40% on a shape it covers, against a ±1.6% null,
and it removes 99.7% of the block entries to get there. The tiering split named
in §13.7 was **not** attempted this round; blk16/blk32 above are the
before-the-split baseline.

**App scale** (`tools/fold-ab.js`, arm-on = regions, arm-off =
`--no-block-exec-regions`, the same executor either side, so this prices the
*matcher* alone):

```
app                   work  reps  arm-off med   on-off    null-off   verdict
-----------------------------------------------------------------------------------
quake2_demo (default)  300     5     7.030s    +0.186s    +0.014s   resolved LOSS 2.6%
quake2_demo (min=1)    300     7*    6.91s     +2.2s      +0.1s     resolved LOSS ~32%
diablo_shareware       100     5     3.460s    +0.074s    +0.016s   unresolvable
caesar3_demo           300     5     5.740s    -0.094s    -0.030s   unresolvable
mw3                     12     5     7.740s    +0.058s    +0.102s   unresolvable
```

`*` the min-uops=1 row is the raw per-rep spread from the 175s-capped run
(on 8.80-9.18s, off 6.66-6.95s, null 6.68-7.21s over seven reps); it did not
reach the tool's own verdict line, but off and null overlap exactly and on does
not, so the sign is not in doubt.

**The honest summary: at the shipped cost model the matcher costs 2.6% on
quake2 and buys ~0% coverage; at the coverage ceiling it costs ~32% to buy
2.7%.** The microbench says that loss is not in the executor — it is decode-time
discovery plus the thrash the coverage arm provokes (14,164 refusals on that
window). This is why the family stays default OFF and why §14.6 lists discovery,
not the descriptor, as the next work.

### 14.5 Correctness

`test/test-block-exec.js` grew a `-- multi-block regions --` section (99 checks
total, all green): a 2-block if/else loop, a diamond, a 6-block state machine
over guest memory, a jump from outside into a member, SMC of a member (not of
the head), an unmapped access from a member, a region interrupted by the block
budget and resumed in three-block slices, and a breakpoint on a member's entry.
Each differential case also asserts that a 2+ block descriptor actually
installed and ran, so a pass cannot be two identical threaded compilations.

The breakpoint case found a real defect and is the one behaviour change outside
the matcher: `$run` checks `$bp_addr` at block entries, and a region's interior
edges are block entries `$run` never sees, so a `--break=` inside a folded loop
fired once and then never again. The executor now side-exits at an interior edge
whose entry EIP is the breakpoint, guarded on `$bp_addr` being non-zero.

`test-tree-fold`, `test-worker-wasm-globals`, `test-x87-pipeline4-fusion` and
`test-x86-ops` (138 cases) all pass against the new build.

**PNG identity**, two budgets per app, arm A = `--no-block-exec-regions`, both
arms at `--block-exec-min-uops=1` so the matcher is at full coverage:

```
app                    60/6 batches      200/12 batches
------------------------------------------------------------
quake2_demo            identical         36 px (0.047%)
mw3                    identical         identical
heroes2_demo           identical         identical
diablo_shareware       identical         identical
caesar3_demo           identical         identical
starcraft_shareware    identical         23,748 px (7.73%)
```

The two that differ are the two whose screens are paced by the batch clock, and
both were checked against a control rather than assumed:

* starcraft's difference is 7.73% of pixels in the box `0,86 639x308`; **one
  extra batch** of arm A changes 10.37% of pixels in the *same* box.
* quake2 at 300 batches differs by 3.79%; arm A at 299 and 300 batches is
  pixel-identical, so that one is *not* a one-batch phase — but arm A at
  `--batch-size=199000` differs from arm A at `--batch-size=200000` by
  **33.0%**. A 0.5% change in work-per-batch moves that frame ten times as much
  as the matcher does, and the matcher changes work-per-batch by construction.
  Bisecting with `--block-exec-region-max` is non-monotonic (clean at 2 and 4,
  the same 2,914-pixel alternative at 3, 8 and 16), which is the signature of a
  bistable pacing outcome rather than of a size-dependent descriptor bug.

`--block-exec-region-max=N` is new and exists for exactly that bisect: it caps
the largest region the matcher may install, and `--no-block-exec-regions` is
the same knob at 0.

### 14.6 Still open after this round

* **Discovery, not the descriptor, is the ceiling.** Following Jcc/jmp targets
  as well as fall-throughs is what closes the 0.02-0.43 census ratio. Everything
  needed to *run* those regions already exists and measures at +37-40%.
* **`termNotModelled`** — a member whose terminator is a `call`/`ret`/indirect
  ends the chain. Allowing the last member a `term_kind 5` threaded tail would
  admit most of them, but the descriptor has one `$tail_ip` for the whole
  region, so it needs a per-block tail pointer first.
* **`noFlagProducer`** — Diablo's dominant refusal; `and`/`sub`/`or` writing a
  register is not an accepted producer.
* **The cost model.** 190ns of entry against 16ns/uop means a 2-block region
  needs ~12 native micro-ops on the path taken before it installs, and the
  estimate available at decode time is half the region's static count. This is
  the same conservatism the 1-block installer has; it is not a region question,
  and changing it should be measured as its own arm.
* **The tiering split** from §13.7, still not done.

## 15. CFG discovery and the hot gate (round 10, 2026-09-14)

Round 9 ended with the matcher able to *run* multi-block regions at +37-40% and
unable to *find* them: `$decode_run` handed it a fall-through chain, so any
region whose head or second block was a branch target was invisible, and
coverage of 2+ block regions sat near 0% at the shipped cost model. This round
replaced chain discovery with a CFG walk, and then found that the interesting
number was not the walk at all.

### 15.1 Discovery is a breadth-first closure from the head

`$bx_walk_once` starts at a candidate head and walks Jcc/jmp targets *and*
fall-throughs through decoded blocks, decoding on demand within the same page,
until it has the single-entry closed set or refuses it. The census rules are
unchanged (≤16 blocks, ≤8 exits, uop budget, one page, no call/ret/int/indirect
inside), and entry is still through the head only — a jump into a member from
outside gets the member's own 1-block descriptor.

Three bounds keep it cheap, and all three are load-bearing:

* a per-walk **block budget** (`$bx_walk_budget`, 24) — the cost bound, counted
  in blocks because a block is what costs a `$decode_block`;
* a per-head **failure memo** (`$bx_walk_memo_max`, 3 declines and the head is
  never attempted again), which is what turns "paid once per hot head" from an
  aspiration into a bound;
* the **hotness gate** `$bx_walk_hot_k` — see §15.3, which is the whole story.

The head guard `$bx_walk_head_ok` is shared by both call sites. It has to
reject `head == 0` explicitly: `$page_probe(0)` returns *true*, because an
unused page-directory slot holds tag 0, and walking from there decodes guest
address 0 and hits the decoder's "execution entered zeros" trap.

### 15.2 A region must be installed where the guest stands

The first re-anchor attempt installed regions from the loop *top* whenever a
walk refused a successor below its head. It installed three regions and got
zero entries, every iteration: installing from the top while the guest stands
at the bottom means the next block transfer lands on an *interior* cover mark,
which misses, re-decodes and symmetrically retires the region just built.

So the walker records the lowest in-page successor it had to refuse
(`$bx_walk_min_below`) and, instead of re-walking from it, primes that address's
hot counter to `K-1` — a **gate hint**. The lower head is then walked the next
time the guest actually enters it, which is the only moment an install there
can stick. `reanchorHints` counts them.

`$bx_region_installs` is also now incremented *after* the publish check: a
descriptor that found no home in the chunk was emitted, not installed, and
counting it as one reads as "the matcher is working and the executor never runs
it".

### 15.3 The hot gate was the whole cost, and K=24 was miscalibrated

With discovery working, quake2 was a **resolved 19% loss** — worse than round
9. The decomposition took three arms, all at `--batch-size=200000`, 300 batches:

| arm | median |
|---|---|
| regions off (`--no-block-exec-regions`) | 7.54s |
| walks disabled, 1-block executor and hot probe still on (`--block-exec-walk-k=100000000`) | 7.63s |
| default (K=24) | 9.42s |

The hot probe is free; the entire 1.8s is walk + install + region execution. And
`--decode-stats` named it: **1,584,079 block decodes against 124,061 with the
family off** — 12.8x the decode work, ~33 re-decodes per install.

The mechanism is §15.2's, at scale. Publishing a descriptor covers its whole
guest extent, so anything entering the interior misses, re-decodes and retires
the region; a *lukewarm* head installs, churns, and installs again. K=24 was
low enough to arm that loop on thousands of heads. Sweeping it on quake2:

| K | block decodes | opsMulti |
|---|---|---|
| 24 | 1,584,079 | 16,179,253 |
| 64 | 942,968 | 24,727,410 |
| **256** | **417,280** | **27,817,225** |
| 1024 | 187,442 | 22,672,623 |
| 4096 | 133,051 | 17,406,161 |

K=24 was not buying coverage with that decode work: **256 covers 72% more guest
ops for a quarter of the decodes.** The same shape holds on caesar3 (158,278 →
15,582 decodes, opsMulti 110,830 → 237,822) and mw3. heroes2 is the one app that
harvests less at 256 than at 24 — its hot heads are not entered 256 times in the
window — at near-baseline decode cost, so less gain, never a loss.

The default is now 256, and with it the round-9/round-10 quake2 loss is gone:
`on-off` moves from a resolved **-1.794s** to **-0.174s** (K=256) and **+0.132s**
(K=1024), both inside the null spread. caesar3, diablo and mw3 are all
unresolvable too; caesar3 still *trends* to a residual -0.652s on an 8s run and
is the one to re-measure on a quiet box.

### 15.4 Terminator flag producers

`and`/`sub`/`or`/`xor`/`add` r,r and r,imm writing a register are now accepted
as terminator flag producers (term_kind 8 and 9), on the same lazy-flag model as
`test`. This was Diablo's dominant refusal in round 9 at 1.8M declines.

### 15.5 What it measures

Coverage, six apps, 200000-block batches, against
`tools/code-region-census.js` run over the **same** hot-block dump:

| app | opsMulti% (default) | opsMulti% (ceiling) | census 2+ block eligible | uopsVisited/guestOps |
|---|---|---|---|---|
| quake2 | 3.25% | 4.98% | 18.6% | 0.101% |
| caesar3 | 0.16% | 0.75% | 49.9% | 0.006% |
| heroes2 | 2.88% | 8.99% | 6.5% | 0.141% |
| mw3 | 1.53% | 3.53% | 1.3% | 0.038% |
| diablo | 1.75% | 1.86% | 20.9% | 0.028% |
| starcraft | 0.05% | 0.18% | 9.7% | 0.008% |

Discovery cost fell ~10x with the gate change (quake2 0.964% → 0.101% of guest
ops). The census denominator is x86 ops and the matcher's is handler dispatches
— the census prints the ratio per app (quake2 1.13, caesar3 1.08, heroes2 0.87,
mw3 1.08, diablo 1.77, starcraft 1.60) and it has to be quoted when comparing.

**Two traps in these numbers.** Absolute coverage is only comparable *within one
back-to-back batch of runs*: the emulator is deterministic given its state, but
apps persist VFS state between processes, and the same command a few runs apart
returned 13,427 installs / 27.8M opsMulti and 5,625 / 11.2M on quake2.
Instrumentation is not the variable — `--handler-hist` and `--hot-block-dump`
runs came back bit-identical to plain ones. And a batch is a budget of *blocks*,
so a region retires N blocks for one budget unit and the same `--max-batches`
lands *further* into the guest: three of sixteen PNG pairs differ for that
reason, all mid-animation, and on those screens the off arm differs from itself
between adjacent budgets (14.7%, 23.1%, 10.2% of pixels) by more than the two
arms differ from each other. Every settled screen is pixel-identical.

### 15.6 Still open

* **The thrash table aliases.** 64 direct-mapped slots over thousands of heads
  reset each other before the 16-install threshold bites, which is *why* raising
  K works at all. Widening it and counting installs per head is the round-11
  lever, and it should recover what K=256 costs heroes2.
* **caesar3 is the big remaining gap**: 49.9% of its guest CPU is 2+ block
  eligible and the matcher captures 0.16%. Its declines are dominated by
  `shortChain` and by memo refusals (2.4M against 24.9k attempts at K=24).
* **`termNotModelled`** is still the top classify refusal in quake2, caesar3,
  mw3 and starcraft — it needs the per-block tail pointer from §14.6.
* **The tiering split** from §13.7, still not done: blk16 and blk32 measure
  +0.4% and +0.9% paired, against the pre-merge +22/+36.

## 16. The decode-time load/op split (round 11, 2026-09-14)

[hot-loop-vocabulary-2026-09.md](hot-loop-vocabulary-2026-09.md) §8 and §4b
measured what a *generic* pass over the micro-op stream could delete from the
hot blocks of thirteen Win98 windows — no matcher, no new arithmetic
vocabulary: 0.7-19.3% of guest ops per window, mean ≈ 8%, with the largest
share in a gameplay window (quake2-gameplay, 19.3%, 12.6 points of it redundant
loads). §9 of that document put this first on the build list. This section is
that pass.

The hard constraint is unchanged: **no runtime wasm codegen.** This is a pass
over the decode-time descriptor, executed by the same fixed executor; the two
new micro-op kinds it needs are fixed build-time handler arms like every other.

### 16.1 The split representation

Today a memory-form ALU instruction — `add edx,[0x10027ba8]`, `adc esi,[ebx+ecx*4]`,
`imul eax,[esi+8]` — has no micro-op kind at all, so it takes the FALLBACK path:
spill eight registers, `call_indirect` the real handler, reload eight. The
instruction's *load* is therefore invisible to any analysis, and so is its ALU.

The split makes both explicit:

```
add edx, [ebx+0x10]          ->   TU_LOAD32     d=L0  a=ebx  imm=0x10
                                  TU_ADD_RR     d=edx a=L0
add edx, [0x10027ba8]        ->   TU_LOAD32_ABS d=L0  imm=0x10027ba8
                                  TU_ADD_RR     d=edx a=L0
cmp eax, [ebx+4]             ->   TU_LOAD32     d=L0  a=ebx  imm=4
                                  TU_CMP_RR     d=eax a=L0
```

**The temp lanes are register indices 8..14, held in seven more wasm locals in
`$th_block_exec`.** The `d` and `a` fields of a micro-op are whole words in the
descriptor, so nothing needed re-encoding; what changed is that the two
index-decoded operand reads and the one index-decoded writeback grew from
8-entry `br_table`s to 15-entry ones. Index 15 (`0xF`) keeps its meaning of
*absent* and still lands on the default arm, and the SIB *index* read stays
8-wide because a SIB index is always an architectural register.

Seven, not eight, and not sixteen. Seven is what is left of a 4-bit field once
`0xF` is reserved, and a wider register file makes the one function the JIT
already struggles to tier bigger for no return. It is far more than the shape
needs: a split's load is consumed by the *very next* micro-op, so concurrent
lane pressure from the split itself is one, and the lanes are handed out
round-robin only so that a redundant-load rewrite can still name an earlier
lane. Reallocating a lane kills any fact naming it, because walk 1 treats the
split's load as a write to that lane — there is no separate liveness check to
get wrong, and no way to run out.

**A temp lane is never architectural.** It is not in any exit's `live_out`
mask, it is never published to a global, it is never read by a terminator, and
it is never a SIB base or index. It survives a fallback for free, because a
fallback spills and reloads *globals* and a lane is a local the call cannot
see — but see the alias rule below, which kills every fact across a fallback
anyway.

Two new kinds are added to the shared `$TU_*` space, at 58 and 59:

| kind | meaning |
|---|---|
| `TU_CMP_RR` 58 | flags only, `R[d] - R[a]`, no register written |
| `TU_CMP_RI` 59 | flags only, `R[d] - imm`, no register written |

They exist because `cmp reg,[mem]` is the second most common memory-form ALU
shape in the corpus and without a `cmp` kind the split would have to decline
it. They also pick up interior `cmp r,r` / `cmp r,imm32` (H19 / H10), which were
fallbacks before.

One more `b`-word bit, `$TU_B_SRC0` (0x8000) with a 4-bit lane at bits 24..27:
**"read the first source from this lane instead of from `d`."** It is what makes
a register-to-register move disappear rather than merely move: `mov eax,edx ;
shr eax,16` becomes one `TU_SHIFT d=eax` whose first source is lane `edx`. It
is set only by this pass and only on kinds whose `$va` is a pure source.

### 16.2 The alias rule, verbatim

> A store kills every earlier load fact unless the store and the load name the
> same base register, the same index register and the same scale, and their
> `[disp, disp+width)` byte ranges are disjoint. An absolute address counts as
> base = none, index = none, scale = 0, disp = the address, so two absolute
> accesses are compared by range — and an absolute store still kills every
> register-based load, and a register-based store still kills every absolute
> load. ESP-relative and EBP-relative accesses are distinct bases and are
> compared as such only while neither ESP nor EBP is written in the stretch; a
> write to a register kills every fact whose base or index is that register. A
> write to a load's destination kills that load's fact. Any fallback micro-op,
> any `rep` or x87 micro-op, any push/pop, any op the classifier did not
> recognise, any call, and any block boundary kills every fact.

The rule is stated in full because it was written to serve both redundant-load
elimination *and* store-to-load forwarding. Only the first half of it is used:
a store now kills facts and never records one, because forwarding turned out to
be unsound for a reason the alias rule does not address at all (§16.3, item 3).
What survives of the second half is that a store must still be **compared**
against every live load fact, which is what the "unless … disjoint" clause is
for.

**This rule is conservative in a way that costs real measured coverage, and
that is the honest headline of this round.** quake2-gameplay's unrolled span
loop reloads `[0x10027ba8]` eight times per block — the 12.6 points §4b
counted — but between every pair of those loads it executes `mov [edi+N],al`.
`edi` is a runtime pointer; nothing at decode time can prove it is not
`0x10027ba8`, so the store kills the fact and the reload stands. §8's
"removable" column is an *upper bound computed without an alias model*, and the
measured table in §16.6 is what a sound one reaches.

### 16.3 The five transforms

Run once, at descriptor build, over the micro-ops of one block, in one forward
walk:

1. **split** — a memory-form ALU or IMUL micro-op becomes a load into a lane
   plus a register-form op on that lane. Handlers H48 (`reg OP= [abs]`), H128
   (`reg OP= [base+disp]`), H157 and H158 (`imul reg, [mem]`). Read-modify-write
   forms (`[mem] OP= reg`) are three micro-ops and are not in this round.
2. **redundant-load elimination** — a load whose (base, index, scale, disp,
   width) matches a live earlier load's becomes `TU_MOV_RR` from that load's
   destination. The first load still executes, at the same address, so a fault
   is raised in the same place; only the second translation is skipped.
3. **store-to-load forwarding** — **written, measured, and REMOVED. It is
   unsound in this emulator.** The transform itself is easy: a load that
   exactly matches a live earlier store becomes `TU_MOV_RR` from the store's
   data register, and the alias rule in §16.2 is more than strong enough to
   decide the match. What defeats it is not aliasing but coherence: guest
   memory does not behave like memory at an address no mapping covers. `$g2w`
   resolves a miss to the NULL sentinel at `0xF0`, where a store goes nowhere
   and a load reads 0. So

   ```
   mov [eax], ecx
   mov edx, [eax]        ; eax unmapped
   ```

   leaves `edx = 0` on the threaded path and `edx = ecx` if the store is
   forwarded, and the two arms diverge silently with no fault anywhere to
   mark it. Real hardware would have raised an access violation at the store
   and the question would never arise. Nothing available at decode time can
   prove an address is mapped — that is the whole reason the sentinel exists —
   so the transform is **dropped rather than guarded**. `test/test-block-exec.js`
   carries the case that caught it ("a store through a null base register,
   then a read back") and asserts the meter stays at zero, so it cannot be
   reintroduced under the same name without the sentinel being dealt with
   first. A store now only ever *kills* facts; it never records one.

   Redundant-load elimination (2) is unaffected by the same argument: two
   loads of one address read the same place whether that place is the sentinel
   or real memory, and both yield the same value either way.
4. **register-move elimination** — a `TU_MOV_RR d,a` whose *immediately
   following* micro-op fully redefines `d` while reading it as its first source
   is deleted, and that consumer's `$TU_B_SRC0` lane is set to `a`. Adjacent
   only: the moment anything between the move and its consumer writes `a`, the
   old value has to live somewhere and a lane is no cheaper than the register
   it already sits in. A `TU_MOV_RR`/`TU_MOV_RI` that is immediately overwritten
   by another full definition of the same register is simply deleted.
5. **immediate folding** — a `TU_MOV_RR` whose *source register* is known to
   hold a constant (it was defined by a `TU_MOV_RI` earlier in the block, and
   nothing has written it since) becomes `TU_MOV_RI` of that constant. It was
   drafted as a corollary of 3; with 3 gone it lives on register moves
   instead, which is where it actually pays — the move loses its register
   read, and 4 can then delete the definition when nothing else needs it.

Only 4 ever *deletes* a micro-op; 2 and 5 rewrite one in place and 1 adds one.
That matters for two contracts:

* **`--handler-hist` comparability.** Every micro-op re-records its original
  handler index, so a rewritten one still counts. A deleted one does not, and a
  split one would count twice — so the load half of a split carries `fn = -1`
  and the histogram skips it. A histogram taken with the pass on therefore
  reports exactly the guest ops the pass did *not* delete, which is the number
  this round is about.
* **`$steps`.** The block's `cost` is the count of **x86 instructions** it
  serves natively, computed in the classify loop and untouched by the pass. A
  batch under `--block-exec` must not silently buy the guest more work than the
  threaded arm got, or every fixed-batch A/B compares two different amounts of
  execution and reads as a speedup.

### 16.4 Regions, and why the carry resets at every block boundary

The pass runs on both descriptor shapes. In an N-block region it runs **per
member block, resetting every fact at the boundary** — it never carries a load
or a store fact along an interior edge, even a fall-through one with a single
predecessor. The rule in §16.2 *permits* a carry along an edge whose target has
a single predecessor inside the region; the implementation takes the
conservative end of that permission and carries nothing at all, because the
edge set is resolved *after* every member is classified, so a pass that wanted
to carry would have to run in a third phase over a graph, and the measured
in-region share of guest ops (§15.5: 0.05%-3.25% opsMulti) does not pay for
that yet. `test/test-block-exec.js` asserts the negative directly — the same
address loaded either side of a `Jcc` inside a region is loaded twice.

**This is also, as it turns out, the reason redundant-load elimination measures
zero on every real window** (§16.6). A block is short; the redundancy §8
counted is mostly between blocks, not inside one.

Making the split work inside the region builder did need one structural change:
that builder's scan loop assumed micro-op index == op index (it derives the
terminator's `term_pos` from an op index). It is now driven by the op index with
the micro-op count tracked separately, and `term_pos` is the micro-op count at
the moment the loop reaches the flag producer.

### 16.5 Fault preservation, and `--fault-null`

* A removed redundant load never changes behaviour: the *first* load executed,
  at the same guest address, through the same `$gl32`. A faulting address still
  faults, once instead of twice, and `--fault-null`'s report counts addresses
  probed, not probes.
* Forwarding a store to a load would have skipped the load's translation
  entirely. That is sound as far as *faults* go — the store to that exact
  address already went through `$gs32` on the same path — and unsound for the
  reason in §16.3 item 3, which is about what an unmapped address *reads*, not
  about where it faults. The transform is gone.
* All of this is moot under `--fault-null` in any mode, because **the whole family
  already declines to install while `$fault_unmapped` is nonzero** (§6), and
  `set_fault_unmapped` raises `$thread_flush_pending` so arming it mid-run
  discards every block already installed. There is no configuration in which
  the pass is active and the flag is armed.

Lazy flags and partial registers are preserved by construction rather than by
care: the split emits the *same* `$set_flags_*` call the fused handler made,
in the same position; elimination only ever removes a `TU_MOV_*`, which is
flag-transparent in x86 and in this vocabulary; and `TU_B_SRC0` changes where
a value is read from, never what is computed from it.

### 16.6 Measured

**Read the fallback column, not the uop column.** The pass's product is not
smaller descriptors — it is *fewer trips out of the executor*. Splitting
`add eax,[esi+8]` turns one `TU_FALLBACK` into a `TU_LOAD32` plus a
`TU_ALU_RR`, so the micro-op count goes **up** by one while a spill of eight
GPRs, a `call_indirect` and a reload of eight GPRs disappear. Any reading that
scores this pass on "micro-ops removed" scores it on the wrong axis, and §8's
"removable ops" column is that wrong axis.

#### Per window, against §4b's prediction

13 windows, `collect-win98*.sh`, each run twice — once with the pass on and
once with `--no-block-exec-split`. `deleted%` is `(rle + movelim + immfold)`
over `uopsSplitOff`, i.e. the share of the descriptor the three *deleting*
transforms actually removed; `§4b` is the removable share that document
predicted from a static count with no alias model and no block-boundary model.

| window | uops (split off) | uops (pass on) | net | split | rle | movelim | immfold | deleted% | §4b predicted |
|---|---|---|---|---|---|---|---|---|---|
| quake2-gameplay | 18805464 | 20907311 | +11.18% | 2216636 | 3584 | 114789 | 7833 | 0.56% | 19.3% |
| mw3-gameplay | 557378 | 571648 | +2.56% | 21149 | 10 | 6879 | 30 | 1.19% | 5.6% |
| gta2-gameplay | 669450 | 670497 | +0.16% | 5177 | 1 | 4130 | 19 | 0.61% | 3.4% |
| rct-gameplay | 186946 | 189362 | +1.29% | 2572 | 25 | 156 | 7 | 0.10% | 0.7% |
| heroes2-gameplay | 1177499 | 1191112 | +1.16% | 26564 | 750 | 12951 | 0 | 1.14% | 8.8% |
| quake2-loading | 1638878 | 1601852 | −2.26% | 903 | 0 | 37929 | 7258 | 2.31% | 12.3% |
| mw3-loading | 452448 | 466399 | +3.08% | 20328 | 2 | 6377 | 14 | 1.35% | 17.8% |
| gta2-loading | 210296 | 208299 | −0.95% | 361 | 0 | 2358 | 1 | 1.12% | 2% |
| rct-loading | 306063 | 310257 | +1.37% | 4420 | 39 | 226 | 9 | 0.09% | 5.6% |
| heroes2-loading | 423330 | 426642 | +0.78% | 7199 | 625 | 3887 | 0 | 1.05% | 8.7% |
| caesar3-loading | 102379 | 103355 | +0.95% | 1001 | 106 | 25 | 0 | 0.13% | 4.4% |
| starcraft-loading | 28647492 | 28715028 | +0.24% | 97124 | 7818 | 29588 | 64 | 0.13% | 3.5% |
| diablo-loading | 4927060 | 4943337 | +0.33% | 48216 | 346 | 31939 | 114 | 0.65% | 4.5% |

Measured deletion is **0.09%–2.31%** against a predicted 0.7%–19.3%. The gap is
not a bug in either number; it is three things §8 could not have known:

1. **§8 counted redundancy across a whole trace, this pass sees one block.**
   `rle` is the transform §8's 12.6-point "redundant loads" column was about,
   and it is the one that measures nearest zero — single digits to a few
   thousand, against millions of micro-ops. The redundancy is real and it is
   almost all *between* blocks (§16.4), where a conservative pass with no
   single-predecessor carry cannot reach it.
2. **Store-to-load forwarding was removed as unsound** (§16.3 item 3), so its
   share of §8's prediction is structurally unreachable, not merely missed.
3. **§8 had no alias model.** Every load it counted as removable is removable
   only if nothing in between could have written it, and the rule in §16.2
   refuses on any unmodelled op, any write through a register the load's base
   depends on, and any call.

#### What the pass actually bought: FALLBACK → native

Same 13 pairs. `native%` is the share of executed micro-ops that ran inside
the executor rather than through the spill/`call_indirect`/reload path.

| window | native% off | native% on | fallback ops off | fallback ops on | change |
|---|---|---|---|---|---|
| quake2-gameplay | 91.74% | 98.87% | 75928624 | 6339024 | **−91.7%** |
| mw3-gameplay | 99.83% | 99.95% | 1308056 | 305635 | −76.6% |
| gta2-gameplay | 89.97% | 88.42% | 1561315 | 1347642 | −13.7% |
| rct-gameplay | 86.97% | 85.29% | 1584916 | 322544 | −79.6% |
| heroes2-gameplay | 96.46% | 96.44% | 662855 | 716952 | +8.2% |
| quake2-loading | 96.12% | 96.04% | 2178228 | 2177947 | −0.0% |
| mw3-loading | 99.96% | 99.97% | 274177 | 197769 | −27.9% |
| gta2-loading | 94.55% | 94.51% | 250015 | 249979 | −0.0% |
| rct-loading | 87.07% | 86.6% | 1553070 | 425206 | −72.6% |
| heroes2-loading | 96.2% | 96.15% | 309277 | 319389 | +3.3% |
| caesar3-loading | 92.61% | 93.27% | 430247 | 401520 | −6.7% |
| starcraft-loading | 96.66% | 98.5% | 16752544 | 3936730 | −76.5% |
| diablo-loading | 97.43% | 98.33% | 2221381 | 1451762 | −34.6% |

**These two passes are not paired work and the absolute columns must not be
diffed.** Both collections are time-capped on a box at load 5–25, so each run
reached a different point in its app; only `native%`, a within-run share, is
comparable, and even it shifts with what the run reached. Block entries, off
vs on: quake2-gameplay 18.7M vs 14.0M, gta2-gameplay 683k vs 447k,
rct-gameplay 557k vs 90k, heroes2-gameplay 783k vs 852k, starcraft-loading
17.9M vs 10.0M. The ON runs generally covered *less* work in the same cap, so
quake2-gameplay's +7.1-point `native%` gain is not a coverage artefact; gta2
and rct are not resolvable from these runs at all.

#### Microbench

`tools/bench-loops.js --shapes=blk_rld8,blk_memalu8,blk8 --toggle=block_exec_split --reps=8`,
load 3.8, minima over 8 interleaved reps with the arm order rotated.

| shape | split=1 min | split=0 min | min delta | paired median | fallback ops on → off |
|---|---|---|---|---|---|
| `blk_memalu8` (six `op r32,[esi+disp]`) | 42.1ms | 60.1ms | **+30.0%** | +29.7% | 0 → 1,500,000 |
| `blk8` (null control, no memory form) | 38.9ms | 39.7ms | +2.0% | +2.9% | 0 → 0 |
| `blk_rld8` (four loads, two repeated) | 26.2ms | 27.4ms | +4.4% | −2.3% | 250,000 → 250,000 |

`blk_memalu8` is the shape the pass exists for and the mechanism is visible in
the counters rather than inferred: with the pass on the block's 1.5M
`TU_FALLBACK` executions become 3.0M native micro-ops, block entries fall
from 1.99 to 0.01 per iteration, and the time falls 30%. `blk8` and
`blk_rld8` both fire the pass zero times (`split/rle/movelim: 0/0/0`) and are
therefore two independent null controls; their +2.0% and the contradictory
+4.4% min / −2.3% median are the harness's noise floor on a loaded box.

**Two traps this measurement walked into, both now fixed in the tool.** The
toggle sets `set_block_exec_min_uops(2)` as well as arming the executor,
because with the default cost model every synthetic block in `bench-loops.js`
is declined (`declWhy 1` — a 6–8 op block does not repay one descriptor entry),
so *both arms ran the plain interpreter* and the first three attempts measured
nothing while looking like a clean ±2% null. And the per-arm output now prints
`block-exec installs/native/fallback` and the pass counters, because the
handler histogram is blind to this by construction: a native micro-op
re-records the handler index it replaced, so an installed descriptor and a
declined one print identical top-handler lines.

#### Whole-app A/B

`tools/fold-ab.js`, three interleaved arms, MIN statistic. The split has no
positive flag, so the arms are **inverted**: `off` is the pass ON, `on` is
`--no-block-exec-split`.

| app | work | reps | load | off (pass ON) med / min | on (pass OFF) med / min | null spread | verdict |
|---|---|---|---|---|---|---|---|
| quake2_demo | 300 | 6 | 3.7–6.0 | 5.975s / 5.850s | 5.810s / 5.740s | sd 0.341 | **unresolvable** (\|on−off\| 0.175 vs 2× null 0.682) |
| rct | 5000 | 6 | 3.5–6.8 | 60.955s / 50.060s | 60.120s / 55.540s | sd 5.078 | **unresolvable** (\|on−off\| 0.763 vs 2× null 10.155) |

Said plainly: **box load makes the whole-app A/B unresolvable.** quake2 got 5
of 6 reps under loadavg 4 and still could not separate a 0.175s difference
from a 0.682s null band; rct got 0 quiet reps out of 6. Neither run is
evidence for or against a speedup, and neither should be quoted as one. The
deterministic counters above and the microbench are the measurements that
carry weight here; the per-app timing question is open until the box is idle.

#### Pixels

Pass on vs `--no-block-exec-split`, at two batch budgets per app, on quake2,
heroes2 and rct — the two-budget rule from §14, because one budget cannot tell
a real difference from a frame caught at a different point of a clock-paced
animation.

| app | budget | pixels differing | changed box |
|---|---|---|---|
| heroes2_demo | 1400 batches | **0 of 307200 (0.0000%)** | — |
| heroes2_demo | 2000 batches | **0 of 307200 (0.0000%)** | — |
| rct | 4250 batches | **0 of 307200 (0.0000%)** | — |
| rct | 5000 batches | 346 of 307200 (0.1126%) | 535,459 57x19 |
| quake2_demo | 500 / 1000 / 2000 / 3000 batches | **0 of 76800 (0.0000%)** at every one | — |
| quake2_demo | 4000 batches | 56412 of 76800 (73.45%) | 0,0 320x240 |
| quake2_demo | 5000 batches | 3979 of 76800 (5.18%) | 138,133 158x107 |
| quake2_demo | 6000 batches | 49 of 76800 (0.0638%) | 138,3 93x136 |
| quake2_demo | 7000 batches | 32 of 76800 (0.0417%) | 138,0 91x139 |

**Verdict: pacing, not a picture change.** Heroes II is bit-identical at both
budgets and RCT at the first, with RCT's 57x19 box at the second landing on its
bottom-right status readout. quake2 is the interesting one and it is the
textbook shape of the two-budget rule: identical at four consecutive budgets,
73% of the frame at 4000, 5.18% at 5000, then back to 0.06% and 0.04% at 6000
and 7000. A wrong rasterization does not heal itself as the run goes on; a
scene boundary crossed by one arm and not the other looks exactly like this.

Two controls make that reading rather than a hope. First, **the same arm run
twice is bit-identical** (0 of 76800), so nothing here is process
nondeterminism. Second, the mechanism is visible in the counters: the fallback
path costs *block entries* as well as time — `bench-loops.js` measures 1.99
block entries per iteration with the pass off against 0.01 with it on — and
`--max-batches` is a budget of block entries. So the same batch count buys the
guest strictly more progress with the pass on, which is why the API-call count
at a fixed budget diverges (66600 vs 66679 at 4000) before any pixel does.
Comparing two arms at one batch count is comparing two different moments.

**Two protocol traps, both hit while collecting this.** `png-ab.sh` first
interpolated an unquoted `$Q2` holding `--args=+set vid_ref soft +map demo1`,
which word-splits into five arguments and never reaches the guest — and quake2
is in `persistFiles`, so its `config.cfg` carries the resulting state into the
*next* process (70142 vs 85553 API calls for nominally identical runs). Quote
the args and re-diff before believing any quake2 A/B. And a bare
`name=$1` in a shell function called from another function that also has `name`
photographed `quake2-b1-on-off`; both helpers now declare `local`.

#### Tests

`test/test-block-exec.js` 167 passed / 0 failed (round-11 section added:
RLE positive, aliasing store blocks, disjoint store does not, byte store
inside a dword blocks, byte store one past does not, base-register write
blocks, unmodelled op blocks, push/pop blocks, `add r32,[base+disp]` splits,
`and`/`or`/`xor`/`cmp r32,[abs]` split, `imul r32,[mem]` splits, two memory
sources share one loaded lane, both move-elimination shapes, imm folding,
`stlf === 0` twice, and a region case asserting `rle === 0` across a `Jcc`).
`test/test-x86-ops.js` 138 passed / 0 failed. `test/test-tree-fold.js` PASS.
`test/test-worker-wasm-globals.js` PASS, 35 setters. 
`test/test-x87-pipeline4-fusion.js` PASS, 11 differential cases.

### 16.7 Switch

`--block-exec` stays **OFF** by default. The pass is ON whenever the executor
is on; `--no-block-exec-split` is its A/B partner and is propagated to worker
instances through `INHERITED_WASM_GLOBALS` like every other toggle in this
family. `--block-exec-stats` grows a `block-exec-split:` line per instance carrying
`uopsBefore` / `uopsAfter`, the descriptor size the same run would have built
with the pass off (`uopsSplitOff`, which is `uopsBefore - split`, because the
split fires in the classify scan before the pass is entered), and a count for
each of the five transforms. `tools/block-exec-decode.js` prints the split
form, with lane numbers rendered as `L0`..`L6`; its trace stream grew the `d`
and `b` words for that, and its kind table now reads BOTH `07b-loop-match.wat`
and `07c-block-exec.wat` — reading only the first silently printed `kind57`
for every FALLBACK. `tools/bench-loops.js --toggle=block_exec_split` arms the
executor in both arms and varies only the pass; `blk_rld8` and `blk_memalu8`
are the two shapes it is for. That toggle also sets an explicit uop floor of 2,
because the default cost model declines every synthetic block in that file, and
the per-arm output now prints `block-exec installs/native/fallback` plus the
pass counters (and `declWhy` when nothing installed) so a shape that never
entered the executor cannot masquerade as one that did — see §16.6.

## 17. x87-carrying blocks in the executor (round 12 lever A, 2026-09-14)

OPEN-6. Round 11's installer declined **any** block holding an x87 handler
(H188-H190), and §4c of `docs/hot-loop-vocabulary-2026-09.md` priced that
decline: x87-carrying blocks are **23.0%** of quake2-gameplay's retired ops,
**39.5%** of mw3-gameplay's and **7.9%** of gta2's. That is the largest single
class of work the executor was structurally unable to see.

### 17.1 Two designs, and which one was built

Two were on the table.

1. **x87 as an executor micro-op that spills the integer lanes and calls the
   existing x87 handler body** — a native fallback, one per raw x87
   instruction.
2. **Make the x87 semantic fold's fused region ONE micro-op inside the
   executor's stream**, so the fold and the executor compose instead of
   competing.

Option 1 alone is actively harmful and that is why it was not built alone. The
x87 fold (H449-H453, `--x87-fusion`) already absorbs **78-89%** of raw x87
dispatches; with the executor installing *before* the fusers, every block the
executor accepted would be a block the fold never saw, and the round would have
traded the fold's 78-89% for a fallback per instruction.

What is built is **option 2, with option 1 as the residue**:

* `$decode_block` now runs the five x87 fusers **before**
  `$block_exec_try_install` (`src/07-decoder.wat`). The fold gets first refusal,
  exactly as it does today.
* A fused H449-H453 op becomes **one** `TU_FALLBACK` whose inline word span
  covers every op the fold absorbed. The span is not re-derived at the
  installer: `$x87_fused_span` lives in `src/07b-loop-match.wat`, next to the
  fusers that decide it, because it is their fact (H449's is mode-dependent:
  mode0 4, mode1 3, mode2 2, mode3 3; H450 4; H451 the run length in bits
  20..27; H452 9; H453 5).
* A **bare** H188/H189/H190 the fuser refused — a run too short to fuse, or
  `--no-x87-fusion` — falls through the same arm with span 1 and becomes an
  ordinary fallback. That is option 1, kept for the residue the fold does not
  cover.

### 17.2 Why it is sound without touching the x87 state

The x87 stack, tag word and status word are **globals the executor does not
model**, so they survive a fallback by not being touched: the spill/reload
around `TU_FALLBACK` is the eight integer GPRs, and the handler body called
through it is byte-for-byte the one the threaded path calls.

The alias rule needed no new clause either. `TU_FALLBACK` is shape 3 to
`$bx_mem_shape`, and §16.2 already reads "any fallback ... kills every fact", so
"an x87 op between two loads of the same address kills the fact" is the existing
rule rather than a new one. `test-block-exec.js` asserts it as `rle === 0`
rather than leaving it to the reading.

`$nat` is deliberately **not** bumped for an x87 fallback. The cost model still
prices the run as what it is — a trip out of the executor — so a block that is
mostly x87 is still declined on cost, not accepted because it became legal.

### 17.3 Measured

`docs/block-executor-design/collect-round12-x87.sh`, two windows, both arms
carrying `--x87-fusion` (an arm without the fold measures a different
question). When this table was taken the lever was ON by default and `off`
was `--no-block-exec-x87`; it is now OFF by default and `on` is
`--block-exec-x87` (section 17.5). The arm labels below are unchanged.

| window | arm | installs | entries | ops native | fallback | native% | transfersSaved | x87 uops | rle |
|---|---|---|---|---|---|---|---|---|---|
| quake2-gameplay (4000-5000) | off | 54177 | 3985308 | 124097991 | 3049307 | 97.60 | 2831290 | 0 | 899 |
| quake2-gameplay | **on** | **63151** | **4045707** | **126464142** | 3253383 | 97.49 | **3304812** | **254685** | **1583** |
| mw3-gameplay (920-1000) | off | 544 | 865981 | 708497584 | 103577 | 99.98 | 17772171 | 0 | 0 |
| mw3-gameplay | **on** | **545** | 865981 | 708497584 | 103577 | 99.98 | 17772171 | **505** | 0 |

Quake II is where the lever lands: **+16.6% installs**, +16.7% transfers saved,
descriptor micro-ops 5.67M → 6.97M (+22.8%), and 254,685 x87 fallback entries
that did not exist. Regions gain too — `opsMulti` 24.7M → 34.1M, `entriesMulti`
898k → 1.36M — because a block that used to be an unsafe member now classifies.
`native%` moves *down* a tenth of a point, 97.60 → 97.49, which is the honest
sign of the mechanism: fallbacks were added on purpose.

MechWarrior 3 gains **nothing**: one extra install, 505 x87 descriptor entries,
and `entries` / `ops native` identical to the digit. The new descriptors were
built and never entered. So §4c's 39.5% is not reachable through this lever on
that window — those ops are in blocks the executor declines for some *other*
reason, and `classifyRefused termNotModelled=7149` is where to look next.

**There is no sound single "share of the window now inside the executor"
number, and one should not be quoted.** `--handler-hist`'s total counts
*threaded dispatches*, and a block the executor runs contributes one H458
dispatch to that total however many x86 instructions it retires; the executor's
own counters are *micro-ops*. The two denominators are different units. The
numbers above are the executor's own and are comparable arm to arm, which is
the comparison this section is about.

### 17.4 What the region path would still need

The scope here is deliberately the **single-block** path.
`$bx_region_collect` runs *before* the fusers, so a region's classifier still
sees raw H188-H190 and still refuses them through `$bx_op_unsafe` — asserted by
a test, not left as an omission. Lifting that means either running collection
after the fold (which changes what discovery sees at every head, not just at
x87 ones) or teaching `$bx_rg_classify_block` the same `$x87_fused_span`
arithmetic the installer now has. The second is the smaller change and is the
one to try; it was not in this round because quake2's remaining x87 declines
come back as `declWhy 1` — the cost model — and widening the classifier without
moving the cost model would only produce more declines at a later stage.

### 17.5 Re-measured on the finished round-12 build: turned OFF

The table above was taken before levers B and C existed. Re-run on the finished
build, with the cross-edge carry and the RMW split in place, **the lever is a
coverage loss**:

| quake2-gameplay | off (declined) | on (--block-exec-x87) |
|---|---|---|
| installs | 59448 | 52749 |
| entries | 4013795 | 4004985 |
| transfersSaved | 3287542 | 2513271 |
| native% | 97.63 | 97.59 |
| x87 micro-ops | 0 | 254849 |

mw3-gameplay is unchanged to the digit in both arms (installs 544, entries
865981, `ops native` 708497605): the x87 descriptors are built and never
entered, exactly as the first measurement found, so section 4c's 39.5% is still
not reachable through this lever.

The reading is that the x87 micro-ops change the uop counts the cost model sees,
and on the finished build that churn costs more installs than the x87 blocks
themselves bring in. So **`$block_exec_x87` now defaults to 0** and the arm to
measure is `--block-exec-x87`. Nothing is deleted: the mechanism, its tests and
the ordering change (fusers before the installer) all stay, because the missing
piece is a cost model that prices an x87 micro-op honestly, not the plumbing.

A second calibration came out of the same measurement.
`tools/bench-loops.js --shapes=blk_x87mix --toggle=block_exec_x87` (a 5-op block
with an `fld`/`fstp` pair in it, 250k iterations, minima, one process) runs
**-62.0%** with the block inside the executor. That harness sets
`$block_exec_min_uops`, which *replaces* the cost model, so the number is not
"the model chose badly", it is the price of the choice: an x87 micro-op is the
only fallback the executor admits that buys nothing, because `$nat` is
deliberately not bumped for it. `$BX_C_X87FB` (96, about six native uops) now
prices it separately from `$BX_C_FALLBACK` (20). On the real corpus that price
changed almost nothing (quake2-gameplay still admits 254849 x87 micro-ops
against 254685 before it), which is the intended shape: it declines an x87-dense
block and leaves a long integer block carrying one stray x87 op alone.

### 17.6 Switch

`--block-exec-x87` turns the lever on; it is OFF by default (section 17.5).
It is a per-instance mutable global propagated through
`INHERITED_WASM_GLOBALS` like every other toggle in this family, and
`--block-exec-stats` grows an `x87` field on the `block-exec-split:` line. That
field counts **descriptor entries** — one per fused region or per bare op — not
guest x87 instructions, so a single `x87` there can stand for a run of up to
255.

## 18. Carrying load facts across a region edge (round 12 lever B, 2026-09-14)

> **Both sweeps in sections 18 and 19 were taken with `$block_exec_x87` at its
> then-default of 1**, before section 17.5 turned that lever off. The A/B inside
> each table is internally valid (the two arms differ only in the flag named),
> but the absolute fallback and micro-op counts move once x87 blocks are
> declined again, so do not read them against a table taken on a later build.

§16.2's rule already permitted this — "a fact may cross an edge whose target
has a single predecessor inside the region" — and §16.4 recorded that round 11
implemented the conservative end of it and carried **nothing**. §16.6 then
measured what that cost: `rle`, the transform §8's 12.6-point "redundant loads"
column was about, came out at single digits to a few thousand against millions
of micro-ops, because *the redundancy is between blocks and the pass only saw
one*.

### 18.1 Why round 11 could not do it, and what changed

Not conservatism for its own sake: **the edge set does not exist yet when a
member is classified.** `$bx_rg_classify_block` runs per block, one after
another, and only `$bx_rg_try_emit` resolves each member's `succ_taken` /
`succ_fall` into member indices. Nothing at classify time can say whether a
successor has one predecessor.

So the carry is a **second pass at emit**, `$bx_rg_carry_pass`, run right after
the edge-resolution loop and before the cost model. It walks the members in
index order, re-running walk 1 on each, and seeds the fact table from the
previous member's exit state exactly when that member is the target's one
in-region predecessor. Walk 2 is not re-run — it deletes micro-ops, and every
member's `uop_off` and the region's `$total` were fixed when it ran; walk 1 only
ever rewrites a micro-op in place.

Three things make the seed sound, and each is the existing rule rather than a
new one:

* **A region is only ever entered at its head.** A member something else jumps
  into gets decoded as a block of its own, which retires the region
  (`$bx_rg_thrash_ok`), so "one predecessor inside the region" is "one
  predecessor".
* **Every kill still kills.** It is the same walk: a store on the carried edge,
  an unmodelled op, a fallback, an x87 micro-op or a write to a fact's base
  register all kill exactly as they do inside one block.
* **The folded terminator kills too.** This one is new code, and it is also a
  **latent round-11 bug fixed on its own account**: `$bx_rg_classify_block`
  lifts the flag producer out of the micro-op list, so walk 1 could not see that
  `term_kind` 0 (`inc`/`dec`), 8 (`alu r,r`) and 9 (`alu r,imm32`) *write a
  register*. A fact recorded before the producer could be matched after it even
  though the producer had moved the base. `$bx_kill_term_wreg` now applies that
  write, at `$bx_opt_term_pos` inside walk 1 and again on the way out of each
  member — both are needed, because a producer that stood at the END of a block
  has `term_pos == nuops`, an index walk 1's loop never visits, and `inc ecx ;
  jnz top` is exactly that shape.

The seed is restricted to `pred == m - 1`. That is an **implementation limit,
not the rule**: seeding from an arbitrary predecessor needs one fact table per
member, while walking members in index order gives the m-1 case for free. Every
other single-predecessor edge is counted in `carryRefused`, which is precisely
the measure of what a per-member table would add.

### 18.2 Measured, against §8's prediction

`docs/block-executor-design/collect-round12-carry.sh`, the same 13 windows and
batch ranges as §16.6, `off` = `--no-block-exec-carry`. `deleted%` is the same
`(rle + movelim + immfold) / uopsSplitOff` §16.6 used. `reach%` is
`carryEdges / (carryEdges + carryRefused)` — the share of non-head members the
`m-1` restriction actually reaches.

| window | rle off | rle on | carryRle | deleted% off | deleted% on | carryEdges | carryRefused | reach% |
|---|---|---|---|---|---|---|---|---|
| quake2-loading | 0 | 6 | 6 | 2.204% | 2.427% | 30720 | 22922 | 57.3% |
| quake2-gameplay | 9542 | 9793 | 251 | 0.435% | 0.436% | 409368 | 462408 | 47.0% |
| mw3-loading | 2 | 11 | 9 | 1.328% | 1.330% | 11463 | 7765 | 59.6% |
| mw3-gameplay \* | 12 | 9 | 9 | 0.504% | 1.337% | 4409 | 2583 | 63.1% |
| gta2-loading | 0 | 0 | 0 | 1.107% | 1.107% | 747 | 773 | 49.1% |
| gta2-gameplay | 1 | 1 | 0 | 0.435% | 0.435% | 3982 | 6145 | 39.3% |
| rct-loading | 686 | 872 | 186 | 0.201% | 0.208% | 25301 | 1137 | 95.7% |
| rct-gameplay | 242 | 300 | 58 | 0.190% | 0.193% | 17675 | 488 | 97.3% |
| heroes2-loading | 1036 | 1151 | 115 | 1.144% | 1.174% | 5417 | 12864 | 29.6% |
| heroes2-gameplay | 714 | 921 | 207 | 1.653% | 1.671% | 12879 | 31310 | 29.1% |
| caesar3-loading | 107 | 158 | 51 | 0.122% | 0.169% | 1472 | 1352 | 52.1% |
| starcraft-loading | 8271 | 8486 | 300 | 0.134% | 0.135% | 15901 | 23898 | 40.0% |
| diablo-loading | 422 | 418 | 0 | 1.244% | 1.251% | 12017 | 15568 | 43.6% |

\* mw3-gameplay's two arms did not cover the same guest work — both are
`--max-seconds`-capped and their `uopsSplitOff` differ by an order of magnitude
— so that row is **not a valid A/B** and its numbers must not be read as an
effect. It is left in rather than dropped so the gap is on the record.

### 18.3 What it recovers, plainly

**The carry works and it is small.** `rle` rises in 9 of the 12 valid windows,
by 251 on quake2-gameplay (9542 → 9793, +2.6%), 207 on heroes2-gameplay, 300 on
starcraft-loading, 186 on rct-loading. `deleted%` moves by hundredths of a point
almost everywhere — the largest honest move is quake2-loading's 2.204% → 2.427%,
and that is mostly `immfold`, not `rle`.

So **§8's prediction is still not reached, and reason 1 of §16.6 was only part
of the story.** "The redundancy is almost all between blocks" implied that
carrying facts across the edge would recover it. It recovers a few percent of an
already near-zero transform. The rest of the gap must be reasons 2 and 3 —
store-to-load forwarding's share is structurally unreachable, and §8 had no
alias model, so most of what it counted as redundant is refused by the kill
rule and would be refused however far the facts were carried.

Two secondary findings worth keeping:

* **The carry's real product is constant propagation, not load elimination.**
  `immfold` on quake2-gameplay goes 1233 → 1818 (+47%) and on quake2-loading
  5546 → 9134 (+65%) — far larger relative moves than `rle`'s. A constant
  written in one block and used in the next is common; a load repeated across an
  edge with nothing killing it in between is not.
* **`reach%` splits the corpus in two.** RollerCoaster Tycoon's regions are
  almost entirely straight-line chains (95.7% / 97.3% reached), while Heroes II's
  are joins (29.1% / 29.6%). A per-member fact table would roughly triple the
  carried edges on Heroes II and do nothing for RCT. Given that tripling the
  edges here bought a few hundred `rle`, that table is **not** worth building on
  this evidence.

### 18.4 Switch

`--no-block-exec-carry` is the A/B partner, ON with the executor, propagated to
workers through `INHERITED_WASM_GLOBALS`. `--block-exec-stats` grows `carryRle`
(the share of `rle` the carry itself found), `carryEdges` and `carryRefused` on
the `block-exec-split:` line. `carryRle` is what makes a rise in `rle`
attributable to this lever rather than to an in-block redundancy, and
`test-block-exec.js` asserts the same separation on a synthetic region —
including the four corners of the rule: carried along a fall-through, not
carried into a two-predecessor join, killed by a store on the edge, killed by
the terminator's own base write.

## 19. Splitting the read-modify-write STORE (round 12 lever C, 2026-09-14)

> **Both sweeps in sections 18 and 19 were taken with `$block_exec_x87` at its
> then-default of 1**, before section 17.5 turned that lever off. The A/B inside
> each table is internally valid (the two arms differ only in the flag named),
> but the absolute fallback and micro-op counts move once x87 blocks are
> declined again, so do not read them against a table taken on a later build.

Round 11 (section 16) split the **load** side of a memory-form instruction: an
`add eax,[esi+8]` became a `TU_LOAD32` into a temp lane plus a register-form
`TU_ADD_RR` on that lane, which is what made the alias/redundancy pass possible
at all. It did not touch the other direction. Every read-modify-write form --
`add [esi+8],eax`, `xor dword [ebx],0x20`, `inc dword [edi]` -- was still a
single whole-instruction `TU_FALLBACK`: eight registers spilled, the real
handler called through the table, eight registers reloaded, and every load fact
in the block killed on the way past.

This section splits those too.

### 19.1 Which handlers

Six, all of them the store-side twins of the four section 16.3 already
covered:

| H | handler | form |
|---|---|---|
| 127 | `$th_alu_m32_r_ro` | `[base+disp] OP= reg` |
| 47 | `$th_alu_m32_r` | `[abs] OP= reg` |
| 131 | `$th_alu_m32_i_ro` | `[base+disp] OP= imm32` |
| 51 | `$th_alu_m32_i32` | `[abs] OP= imm32` |
| 135 | `$th_unary_m32_ro` | `inc`/`dec`/`not`/`neg` `[base+disp]` |
| 68 | `$th_unary_m32` | `inc`/`dec`/`not`/`neg` `[abs]` |

Each becomes three micro-ops: `TU_LOAD32`/`TU_LOAD32_ABS` into a temp lane, the
register-form op on that lane (the SAME `$set_flags_*` call in the same
position, so the lazy-flag state the terminator reads is bit-identical), then
`TU_STORE32`/`TU_STORE32_ABS` from the lane back to the same address. The store
half kills facts exactly as a plain store does; the load half may reuse a live
fact. `$bx_split_n` carries 2 or 3 to the emitter so the existing two-micro-op
path is untouched.

**CMP is the exception.** `cmp [mem],reg` and `cmp [mem],imm` arrive through the
same two handlers with `alu == 7`, and CMP writes no destination -- so those stay
at two micro-ops with no store, which is also what keeps the alias rule honest
(a CMP must not kill the fact it just read).

**Not split:** the 8- and 16-bit twins, because the temp lane is 32 bits wide and
a partial-width RMW would need a read-modify-write of the lane itself before the
store, which is a second alias question and not this round's; and `xchg`/`xadd`,
because neither is three micro-ops -- both need a register writeback fused with
the store, so they would need a fourth kind rather than reusing the existing
ones. Both stay whole-instruction fallbacks and a test pins the byte form.

### 19.2 What it buys

**Read the fallback column first.** The product of this lever is fewer trips out
of the executor. The uop count goes UP by construction -- one x86 instruction
becomes three micro-ops -- so `uopsAfter` rising is the lever working, not
failing. Same 13 windows as section 16.6, both arms in one sweep, `off` is
`--no-block-exec-rmw`:

| window | fallback off | fallback on | fallback d% | rmw splits | entries off | entries on | uopsAfter off | uopsAfter on | uops d% |
|---|---|---|---|---|---|---|---|---|---|
| quake2-loading | 1828769 | 1828653 | -0.01% | 377 | 2104320 | 2104071 | 1582229 | 1586437 | 0.27% |
| quake2-gameplay | 13480737 | 13527953 | 0.35% | 40368 | 16895220 | 16877108 | 53591778 | 54158228 | 1.06% |
| mw3-loading | 317595 | 317655 | 0.02% | 495 | 2819820 | 2819838 | 538192 | 539516 | 0.25% |
| mw3-gameplay * | 53935 | 170342 | 215.83% | 451 | 546735 | 2803162 | 61904 | 434960 | 602.64% |
| gta2-loading | 252174 | 252164 | -0.00% | 32 | 149711 | 149808 | 211551 | 211873 | 0.15% |
| gta2-gameplay | 1520907 | 1529745 | 0.58% | 2978 | 709185 | 714013 | 3092077 | 3115996 | 0.77% |
| rct-loading | 1555125 | 1555036 | -0.01% | 18906 | 614203 | 614230 | 2568664 | 2612056 | 1.69% |
| rct-gameplay | 1543947 | 1544568 | 0.04% | 13150 | 594477 | 595340 | 2384664 | 2445534 | 2.55% |
| heroes2-loading | 288667 | 159055 | **-44.90%** | 9160 | 356027 | 354497 | 388573 | 342956 | -11.74% |
| heroes2-gameplay | 685981 | 617563 | **-9.97%** | 31755 | 857220 | 867635 | 1154814 | 1264880 | 9.53% |
| caesar3-loading | 426210 | 426209 | -0.00% | 0 | 305870 | 305870 | 109026 | 110145 | 1.03% |
| starcraft-loading * | 1701432 | 2334013 | 37.18% | 63148 | 7520130 | 8432590 | 22219464 | 24832416 | 11.76% |
| diablo-loading | 1503282 | 1525533 | 1.48% | 8512 | 2586145 | 2600427 | 4881180 | 5004733 | 2.53% |

`*` = the two arms did not cover the same guest work (executor entries differ by
more than 2%); not a valid A/B, kept in the table rather than dropped so the
next reader does not re-run them expecting a number.

Three findings.

**One: on this corpus it is a Heroes II lever.** Heroes II loading drops 44.9% of
its executor fallbacks and 11.7% of its micro-ops at the same time -- the only
row where both fall, and it falls because blocks that used to price a whole-
instruction fallback now price three cheap micro-ops and *install* instead of
declining. Its gameplay window drops another 10.0%. Every other valid window
moves by less than 1.5% in either direction.

**Two: the lever fires almost everywhere and pays almost nowhere.** Splits are
nonzero in 12 of 13 windows (Caesar III is the exception at zero -- its hot code
is the RLE ladder of section 16 and a `rect_run` fold, neither of which contains
an RMW form the executor sees). Firing 40368 times on quake2-gameplay and moving
fallbacks by +0.35% means those instructions were not on the path that decides
coverage there.

**Three: a small fallback RISE is install churn, not a regression per
instruction.** quake2-gameplay (+0.35%), gta2-gameplay (+0.58%) and diablo
(+1.48%) all pair their rise with an entry count that also moved (0.1-0.6%) --
the changed uop counts feed the cost model, a slightly different set of regions
installs, and the fallbacks inside them are counted against a slightly different
denominator. Nothing in the split makes one RMW instruction more expensive than
the whole-instruction fallback it replaced.

### 19.3 Correctness

Same alias rule, no new rule. The differential cases added to
`test/test-block-exec.js` are the ones where a wrong rule shows up as a wrong
answer rather than a wrong count:

- an RMW whose flags are read by the terminator (the split must leave the lazy-
  flag quadruple exactly as the fused handler did);
- a byte-width RMW, asserted **not** split (`rmw == 0`, fallback >= 1);
- `add [eax],eax` -- the base register is also the source, so the load must be
  taken before the op and the store must use the address computed from the OLD
  base;
- an RMW under a store to an overlapping byte range earlier in the same block
  (the fact must be dead: `stlf == 0`);
- an RMW load that reuses a live fact (`rle == 1` exactly, so the reuse is the
  lever's and not an accident);
- each of the six handlers above, individually, asserted to reach `rmw >= 1`;
- `cmp [mem],reg` asserted to split into two micro-ops with no store;
- an A/B against `--no-block-exec-rmw` that agrees byte for byte on the final
  machine state while the split counter reads `off=0 on=3`.

239 cases pass in `test/test-block-exec.js`, with `test-x86-ops` (138),
`test-x87-pipeline4-fusion` (11 differential), `test-tree-fold` and
`test-worker-wasm-globals` green beside it.

### 19.4 Switch

`--no-block-exec-rmw`, ON with the executor, propagated to workers through
`INHERITED_WASM_GLOBALS`. `--block-exec-stats` grows an `rmw` counter on the
`block-exec-split:` line, counting the third micro-op -- so `rmw` is exactly the
number of RMW instructions this lever took out of the fallback path. The third
micro-op is emitted with `fn = -1` so `--handler-hist` still counts the x86
instruction once.

## 20. Round 12 microbench minima

`tools/bench-loops.js`, 9 interleaved reps in one process, order rotated,
minima quoted; box at loadavg 6 throughout, which is why the paired median is
printed beside the minimum rather than instead of it.

| shape | toggle | minima | paired median | reading |
|---|---|---|---|---|
| `blk_memalu8` (6 `op r32,[esi+disp]`) | `block_exec_split` | **+27.8%** | +27.6% | round 11's load split, re-confirmed on the round-12 build |
| `blk_rld8` (4 loads of 2 addresses, 2 repeats) | `block_exec_split` | -2.0% | -6.2% | a pure-load block gains nothing from splitting; §16 said the same |
| `blk_rmw8` (6 read-modify-write memory forms) | `block_exec_rmw` | **+15.7%** | +13.8% | lever C, on the shape it is for |
| `region_if2` (guard block + body block) | `block_exec_carry` | +2.9% | +0.4% | lever B is at the harness's ±1% noise floor |
| `blk_x87mix` (fld/fstp pair among integer ops) | `block_exec_x87` | **-62.0%** | -63.8% | lever A, and why it is now off (§17.5) |

Two cautions carried forward. These shapes set `$block_exec_min_uops`, which
**replaces** the cost model, so every row is "what it costs once the block is
inside the executor", never "what the model decides". And the harness prices a
perfectly BTB-predicted loop, so no percentage here is an app percentage: the
13-window tables in sections 16.6, 18.2 and 19.2 are where coverage is measured.

## 21. Round 12: the picture, and the wall clock

**Picture.** `docs/block-executor-design/collect-round12-png.sh` captures each of
quake2, mw3 and heroes2 at two budgets with the executor off and on:

| app | budget | changed pixels |
|---|---|---|
| quake2 | 600 / 1200 | 0 of 76800, both |
| mw3 | 400 / 830 | 0 of 307200, both |
| heroes2 | 700 | 282 of 307200 (0.09%), box 53,186 128x31 |
| heroes2 | 1400 | 738 of 307200 (0.24%), box 51,183 131x180 |

Heroes II differs at both budgets, which is what the two-budget rule exists to
catch -- so it was checked rather than waved through. It is pacing: re-running
the **off** arm alone at 1390 instead of 1400 batches, a 0.7% change in budget
with no code difference at all, moves 571 pixels (0.19%) inside the same box
(51,196 131x167). A same-arm perturbation the size of the cross-arm difference
means the difference is where the animation got to, not what was drawn.

**Wall clock.** `tools/fold-ab.js --app=quake2_demo --arm-on='--block-exec'
--base='--quiet-api --batch-size=200000 --x87-fusion' --work=300
--extra='--args=+set vid_ref soft +map demo1'`, 8 reps, arm order rotated:

```
off   median 4.900s  min 4.550s
on    median 5.370s  min 5.000s
null  median 4.850s  min 4.550s
on-off   mean 0.426s  sd 0.370  median 0.470
VERDICT unresolvable at this load  (|on-off| 0.426 vs 2x null spread 0.886)
```

**Unresolvable, and reported as unresolvable.** The on arm is slower in 7 of 8
reps by a fairly steady ~0.47s, but the null-vs-off spread on the same box is
twice that, so this run cannot separate the executor from the machine. Two
things also make the number a poor question even on a quiet box: at
`--work=300` a large share of the wall clock is app load and first-decode, which
is exactly where the executor *spends* (descriptor building) and not where it
*earns*; and `--quiet-api` is on, so what remains is guest work rather than
stdout. The coverage counters in sections 16.6, 18.2, 19.2 and 17.5 are
deterministic and are what round 12's claims rest on.

## 22. Round 13: an install must not cost a decode (2026-09-15)

### 22.1 The measurement that opened the round

Round 12's whole-app A/B on quake2 soft was a **resolved loss** — 30.0s on
against 20.2s off, +35% CPU — and the cause was not the executor running. It
was the executor *installing*. One 1000-batch window
(`--app=quake2_demo --args='+set vid_ref soft +map demo1' --quiet-api
--batch-size=200000 --max-batches=1000`), reading `cache: block decodes`:

| arm | block decodes | vs off |
|---|---|---|
| off | 781,266 | — |
| `--block-exec --no-block-exec-regions` | 956,732 | +22% |
| `--block-exec` (regions, default K=256) | 3,108,885 | **4.0x** |
| `--block-exec --block-exec-walk-k=4096` | 964,140 | +23% |

`native%` was 97.95 in every armed arm, so the executor was fine once
installed. 38,881 region installs against 2.3M extra decodes is ~55 decodes per
region — the install path was the loss, and raising the hot gate only hid it by
installing less.

### 22.2 Where the decodes came from

Two mechanisms, both structural.

**(a) The walk decoded.** `$bx_walk_once` called `$decode_run` on every
candidate successor so it would have threaded ops to classify. A walk that
declined threw all of that away, and the hot gate re-armed, so the same blocks
were decoded again on the next attempt. 104,025 walk attempts against 2,380
installs is the shape of that.

**(b) Descriptors are big, and the page chunk is not.** A compiled 4KB guest
page owns one contiguous chunk of at most **16KB** — `PAGE_CHUNK_BYTES`, and
the ceiling is not a preference: the per-page index entry is a 14-bit offset.
A one-block descriptor is a 24-byte micro-op per guest op plus a header, a
block record and a fallback pool, against 8 bytes per op for the threaded
stream it replaces. When a publish does not fit, `$page_publish` does not fail
locally — it **drops the whole page**, and every block on it is decoded again.
Round 12 published a multi-block region over the *entire guest extent* of its
members, which retired every one of them, so their next entry missed, decoded,
and re-published. Page compiles went 18,269 → 40,788 and dropped blocks
218,339 → 1,584,613.

### 22.3 The mechanism

Three changes, in the order they matter.

**The published threaded stream is self-describing, and the walk reads it
instead of decoding.** Each page index slot carries two 512-byte bitmaps over
its chunk — one bit per 4-byte threaded word — marking **op starts** and
**block ends** (`$PAGE_OPBITS_START` / `$PAGE_OPBITS_END`, written by
`$page_opbits_publish` from `OP_INDEX` at publish time, which is the only
moment op boundaries are known). `$page_cached_ops(ga)` walks them to rebuild
`OP_INDEX` for a block that is already compiled, and `$page_cached_end(ga)`
recovers its guest extent from the index. `$bx_classify_cached` feeds those to
the existing `$bx_rg_classify_block`, so the region builder is unchanged and
the walk never calls the decoder: a successor that is not in the cache simply
ends the walk (`$bx_walk_uncached`), and the guest decodes it naturally the
next time it runs there.

**A region publish covers only its head block.** `$bx_region_finish` passes the
head's own `guest_end` rather than the closure's, so member blocks keep their
index entries and their threaded code. Entering the region at its head runs the
descriptor; entering at a member runs that member's ordinary block. The
invalidation duty the old wide extent was carrying moves to a bit in the page
descriptor word (`$PAGE_DESC_SPANREG`): a page that has published a region
whose reach exceeds its head drops **whole** on any guest write into it, rather
than trusting a per-block extent that is no longer there.

**The one-block installer hands back what it displaced.** A descriptor replaces
a block's threaded stream, which makes that block invisible to a walker that
can only classify threaded ops — the two families compete for the same blocks.
So a walk that meets a descriptor where it wanted a member marks the address in
a 512-slot direct-mapped table (`$bx_raw_want`) and retires the descriptor;
the guest re-decodes the block once; and **that install carries a verbatim copy
of the stream it displaced**, parked at the tail of its fallback pool with an
op-boundary table in front of it, addressed through the descriptor's otherwise
unused operand word. `$page_cached_ops` reads that copy, so every later walk
through the block is free. One decode per block discovery wants, once.

Finally, both optional publishes ask before they spend: `$page_would_fit`
takes a `reserve`, and refuses on any page that has **overflowed before**
(`$PAGE_OVFL_MEMO`, a 1024-slot memo that has to outlive the directory entry
the drop destroys) unless 6KB of headroom remains.

### 22.4 What it measured

Same 1000-batch quake2 window, same command:

| arm | decodes | vs off | pages compiled | 1-blk installs | region installs | multi-block entries |
|---|---|---|---|---|---|---|
| off | 781,266 | — | 18,269 | 0 | 0 | 0 |
| round 12 `--no-block-exec-regions` | 956,732 | +22.5% | — | 41,211 | 0 | 0 |
| round 12 `--block-exec` | 3,108,885 | +298% | 40,788 | 185,907 | 38,881 | — |
| **round 13 `--no-block-exec-regions`** | **857,385** | **+9.7%** | 19,245 | 16,946 | 0 | 0 |
| **round 13 `--block-exec`** | **876,984** | **+12.3%** | 19,607 | 15,368 | 1,101 | 4,007,893 |

The regions arm is **3.5x fewer decodes** than round 12 and the one-block arm
**11.6% fewer**, and the walk itself now contributes none of them: every decode
above the off line is a page that overflowed its chunk.

### 22.5 What is still open, and why it is not a knob

**The 5% goal is not met (9.7% / 12.3%), and the remaining gap is the 16KB
chunk, not the discovery path.** Admission control trades installs against
decodes along a curve, and the curve was measured, not guessed — five builds,
one window each, the same command:

| admission policy | 1-blk decodes | 1-blk installs | regions decodes | region installs |
|---|---|---|---|---|
| none | 1,047,921 | 58,868 | 1,019,725 | 2,839 |
| flat 4KB reserve | 863,351 | 19,314 | 921,585 | 1,444 |
| flat 8KB reserve | 986,655 | 16,206 | 864,050 | 371 |
| overflow memo, hard refuse | 801,745 | 4,795 | 805,001 | **32** |
| **memo + 6KB reserve (shipped)** | 857,385 | 16,946 | 876,984 | 1,101 |
| memo + 10KB reserve | 850,391 | 11,896 | 848,226 | 322 |

Two things that curve says. It is **not monotone** — a bigger flat reserve made
the one-block arm *worse* — because which page overflows depends on the order
installs land, so tuning the number is chasing a chaotic system. And the one
policy that reaches the goal (hard refuse: +3.0%, 805,001) does it by declining
essentially every region, which is not a win. The shipped point is the best
measured compromise, and it is a compromise.

The structural fix is to stop spending the threaded chunk on descriptors at
all: a **second per-page chunk** for executor descriptors, selected by the
currently unused `0x8000`-`0xBFFF` range of the page index entry (0x0000-0x3FFF
is an entry, 0x4000-0x7FFF a cover mark, 0xFFFF none), with its own base and
`used` in a widened page-directory slot. That gives descriptors their own 16KB
and returns page compiles to the off-arm baseline, which by the table above is
where the last 8-12% lives. It is the next round's work, not a knob on this
one.

Also still open: the region path saves no copy of the head block's stream (only
the one-block installer does), so a walk that meets a *region* descriptor still
takes it back the slow way; and the 13-window `docs/hot-loop-vocabulary-2026-09`
sweep has not been re-run against this build.
