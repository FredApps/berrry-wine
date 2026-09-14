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
