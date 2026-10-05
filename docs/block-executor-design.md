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

### 22.6 The 13 windows, re-run on the round-13 build (2026-09-15)

That last open item, closed. `docs/block-executor-design/collect-round13-windows.sh`
runs section 4b's 13 windows — the same ids, batch ranges and input schedules as
`collect-win98-gameplay.sh` and `collect-round12-carry.sh`, so every column here
reads straight against sections 16.6 and 18.2 — with **`off` being the plain
interpreter and `on` being `--block-exec` as it ships**. That is a different arm
from round 12's: there both arms had the executor armed and the toggle was one
pass inside it. This is the comparison the "turn it on by default" question
actually asks.

Both arms carry `--verbose`, because that is what prints `cache: block decodes`
and `pages: compiled`, and round 13's whole subject is that an install must not
cost a decode. `docs/block-executor-design/parse-round13-windows.js` turns the
26 logs into the tables below.

**Read the `cap` column first.** Each run is `timeout 180` around
`--max-seconds=170`, and ten of the thirteen windows stopped on their
`--max-batches` cap in both arms — those rows are deterministic and their
absolute numbers are comparable between arms. Three did not: **mw3-gameplay,
starcraft-loading and diablo-loading hit the time cap**, so the two arms reached
different points of their app and their absolute columns are a coverage
artefact, not a measurement. Box `loadavg` ran **6.9 → 22.7** across the
collection (several other agent sweeps were live on this machine), which is
also why three windows ran out of clock; the deterministic counters are
load-immune and the wall clock here is not quoted for anything.

#### Block decodes and page compiles

| window | cap off/on | batches off/on | decodes off | decodes on | Δ | pages off | pages on |
|---|---|---|---|---|---|---|---|
| quake2-loading | batch/batch | 2,600/2,600 | 97,551 | 99,223 | +1.7% | 5,244 | 5,343 |
| quake2-gameplay | batch/batch | 20,000/20,000 | 1,831,629 | 2,036,356 | +11.2% | 46,423 | 49,026 |
| mw3-loading | batch/batch | 830/830 | 35,395 | 35,704 | +0.9% | 1,467 | 1,469 |
| mw3-gameplay | *time/time* | 1,256/1,165 | 1,324,524 | 1,070,987 | −19.1% | 37,668 | 30,491 |
| gta2-loading | batch/batch | 3,000/3,000 | 67,901 | 67,924 | +0.0% | 536 | 540 |
| gta2-gameplay | batch/batch | 9,000/9,000 | 818,063 | 816,969 | −0.1% | 26,099 | 26,063 |
| rct-loading | batch/batch | 4,250/4,250 | 250,651 | 257,026 | +2.5% | 5,470 | 5,475 |
| rct-gameplay | batch/batch | 6,000/6,000 | 282,167 | 290,984 | +3.1% | 5,360 | 5,401 |
| heroes2-loading | batch/batch | 1,400/1,400 | 17,944 | 25,780 | **+43.7%** | 149 | 156 |
| heroes2-gameplay | batch/batch | 3,000/3,000 | 215,638 | 227,792 | +5.6% | 569 | 632 |
| caesar3-loading | batch/batch | 1,600/1,600 | 2,722 | 2,742 | +0.7% | 57 | 57 |
| starcraft-loading | *time/time* | 699/427 | 155,213 | 88,356 | −43.1% | 2,640 | 1,682 |
| diablo-loading | *time/time* | 266/384 | 123,052 | 622,080 | +405.5% | 370 | 1,436 |

The three *time*-capped rows say nothing: starcraft's ON arm covered 427 batches
against the OFF arm's 699 and diablo's covered 384 against 266, so their decode
columns are measuring how far each run got, not what an install costs.

On the ten deterministic windows the decode overhead of arming the executor is
**+0.0% to +5.6% in eight of them**, and the two that stand out are
**quake2-gameplay at +11.2%** and **heroes2-loading at +43.7%**. Section 22.4
predicted exactly this residue: an install no longer re-decodes the block it is
classifying, but a region *walk* still decodes every member it visits, and the
page-compile column tracks the decode column in every row (quake2-gameplay
+5.6% pages against +11.2% decodes, heroes2-loading +4.7% against +43.7%) — the
descriptors are still being carved out of the same per-page chunk the threaded
code lives in, which is the "second per-page chunk" item section 22.5 leaves
open. heroes2-loading is the window to bisect it on: 1,400 batches, 17,944
decodes off, and the largest relative cost in the corpus.

#### The one-block executor

| window | installs | declines | entries | native% | fallback ops | transfersSaved |
|---|---|---|---|---|---|---|
| quake2-loading | 1,451 | 96,478 | 2,203,763 | 96.49 | 1,856,759 | 6,671,598 |
| quake2-gameplay | 35,218 | 1,999,844 | 16,295,539 | 98.45 | 9,172,381 | 30,293,485 |
| mw3-loading | 520 | 33,366 | 2,832,274 | 99.96 | 271,239 | 18,668,892 |
| mw3-gameplay | 21,270 | 1,047,899 | 4,014,376 | 99.87 | 933,804 | 19,202,937 |
| gta2-loading | 245 | 67,174 | 163,796 | 94.70 | 253,970 | 253,602 |
| gta2-gameplay | 18,008 | 798,456 | 682,439 | 90.30 | 1,555,972 | 516,177 |
| rct-loading | 12,057 | 244,969 | 2,110,374 | 95.24 | 2,819,753 | 11,952,730 |
| rct-gameplay | 11,812 | 279,172 | 1,735,087 | 94.87 | 2,057,179 | 8,159,650 |
| heroes2-loading | 845 | 24,369 | 621,868 | 99.16 | 67,645 | 156,454 |
| heroes2-gameplay | 2,799 | 224,427 | 1,176,281 | 98.82 | 230,711 | 672,110 |
| caesar3-loading | 63 | 2,520 | 314,490 | 93.29 | 426,151 | 188,860 |
| starcraft-loading | 3,784 | 83,563 | 2,531,160 | 98.24 | 846,469 | 611,798 |
| diablo-loading | 19,728 | 601,371 | 16,149,033 | 98.41 | 1,750,543 | 9,522,926 |

`native%` is **90.30%–99.96%** across the whole corpus, against section 16.6's
85.29%–99.95% for the round-11 build — the floor has come up by five points and
the two windows that were *below* 90% there (rct-gameplay 85.29%, rct-loading
86.6%) are now 94.87% and 95.24%. Nothing here is a share below 90 any more.

`transfersSaved` is the column that has no equivalent anywhere else: one block
transfer saved per interior region edge, invisible to the handler histogram by
construction. mw3-loading saves 18.7M of them off 520 installs, which is the
cleanest statement in this table of what a region descriptor is for.

#### The multi-block matcher

| window | region installs | region declines | meanBlocks | opsMulti | opsMulti% |
|---|---|---|---|---|---|
| quake2-loading | 31 | 4,027 | 8.94 | 42,467,892 | **80.07%** |
| quake2-gameplay | 2,431 | 288,866 | 12.80 | 143,436,843 | 24.12% |
| mw3-loading | 23 | 13,923 | 9.96 | 5,434,313 | 0.72% |
| mw3-gameplay | 119 | 32,256 | 9.03 | 5,561,306 | 0.71% |
| gta2-loading | 12 | 1,942 | 7.42 | 454,904 | 9.48% |
| gta2-gameplay | 62 | 3,215 | 8.48 | 3,208,956 | 19.99% |
| rct-loading | 103 | 80,029 | 8.70 | 48,261,389 | **81.34%** |
| rct-gameplay | 89 | 65,417 | 8.58 | 29,543,820 | 73.59% |
| heroes2-loading | 43 | 4,766 | 9.81 | 1,425,336 | 17.61% |
| heroes2-gameplay | 49 | 13,940 | 9.55 | 3,506,439 | 17.92% |
| caesar3-loading | 15 | 4,551 | 11.07 | 605,387 | 9.52% |
| starcraft-loading | 16 | 25,126 | 9.81 | 2,258,219 | 4.68% |
| diablo-loading | 35 | 5,932 | 8.54 | 59,404,813 | 41.42% |

`opsMulti%` is the share of retired micro-ops that ran inside a descriptor of
two blocks or more — work the one-block matcher could never have claimed. It
spans **0.71% to 81.34%**, and the spread is the finding: on RCT and on
quake2's loading window four fifths of all executed micro-ops are inside
multi-block regions, while MechWarrior 3 is at seven tenths of one percent in
*both* of its windows. Region installs are tiny everywhere (12–2,431), so this
is entirely a story about how often a handful of descriptors are re-entered,
not about how many get built. Any future cost model tuned on mw3 will be tuned
on the one app in the corpus where the multi-block path does nothing.

#### The decode-time split pass

| window | uopsBefore | uopsAfter | split | rle | movelim | immfold | rmw |
|---|---|---|---|---|---|---|---|
| quake2-loading | 270,151 | 268,386 | 3,454 | 3 | 1,765 | 123 | 346 |
| quake2-gameplay | 10,747,459 | 10,703,919 | 762,010 | 190 | 43,540 | 729 | 19,338 |
| mw3-loading | 157,066 | 155,914 | 3,387 | 16 | 1,152 | 14 | 466 |
| mw3-gameplay | 2,907,801 | 2,894,182 | 33,971 | 41 | 13,619 | 386 | 5,075 |
| gta2-loading | 181,972 | 179,715 | 233 | 0 | 2,257 | 3 | 28 |
| gta2-gameplay | 2,740,971 | 2,728,352 | 26,720 | 1 | 12,619 | 130 | 2,910 |
| rct-loading | 1,321,553 | 1,318,439 | 26,663 | 28 | 3,114 | 6 | 8,207 |
| rct-gameplay | 1,307,592 | 1,304,821 | 28,263 | 82 | 2,771 | 8 | 7,299 |
| heroes2-loading | 126,379 | 124,973 | 10,147 | 286 | 1,406 | 0 | 2,141 |
| heroes2-gameplay | 474,011 | 466,830 | 34,079 | 262 | 7,181 | 0 | 2,731 |
| caesar3-loading | 33,427 | 33,405 | 505 | 139 | 22 | 0 | 0 |
| starcraft-loading | 677,319 | 673,277 | 51,164 | 2,490 | 4,042 | 5 | 20,226 |
| diablo-loading | 1,936,216 | 1,935,439 | 3,243 | 127 | 777 | 61 | 895 |

Unchanged in character from section 16.6: `rle` still measures nearest zero in
every window (the redundancy is between blocks, not inside them, and the
cross-edge carry of section 18 reaches only single-predecessor members), and
`split` is the transform doing the work — 762,010 firings on quake2-gameplay,
each one a `TU_FALLBACK` that did not happen. Read it against the `fallback ops`
column above, never against the uop counts.

#### What this says about turning it on

Nothing here is a correctness signal — these are throughput counters, and the
pixel question is a separate sweep (`tools/block-exec-sweep.js`,
[sweep-2026-09-15.md](block-executor-design/sweep-2026-09-15.md)). What it does
say is that the *cost* side of the default-on decision is now one number:
**decode and page-compile overhead, +0.0% to +43.7% depending on the window**,
concentrated where a region walk visits many members, and with a known
structural fix (the second per-page chunk) already written down in section 22.5.

## 23. Round 14: descriptors get their own per-page chunk (2026-09-15)

§22.5 named the remaining cost and proposed the fix. This round builds it.

### 23.1 The mechanism, in three sentences

A compiled guest page now owns **two** chunks instead of one — the threaded-code
chunk it always had, and a second chunk of the same 16KB cap that holds nothing
but block-executor descriptors — so a descriptor at ~24 bytes per micro-op no
longer competes for space with the 8-byte-per-op stream it replaces. Which
chunk a page-index entry names is carried in **bit 15** of the u16 entry, using
the `0x8000`-`0xBFFF` range §22.5 identified as free: `0x0000`-`0x3FFF` is a
threaded entry point, `0x4000`-`0x7FFF` an interior byte of one, `0x8000`-`0xBFFF`
a descriptor entry point, `0xC000`-`0xFFFE` an interior byte of one, and `0xFFFF`
still means nothing is compiled here. Because the descriptor chunk is separate,
running out of room in it now **declines the one install** and returns `-1`
instead of dropping the whole page, which is what round 13's shared chunk had
no way to express.

Three supporting changes come with it. The page-directory slot grows from 16 to
32 bytes (`+16` descriptor chunk base, `+20` its `used|class`; `$PAGE_DIR_BASE`
0x13000 → 0x26000 in `src/00-regions.wat`, mirror regenerated), because a page
with two chunks needs two bases and two used-words. `$BX_PAGE_RESERVE` is
retired to 0 and both admission sites — the one-block installer and
`$bx_region_finish` — now ask `$page_desc_would_fit`, which has no reserve and
no overflow memo to consult, because the thing it is protecting is no longer
shared with anybody. And the **region path now saves the displaced stream too**
(§22's other open item): `$bx_region_finish` stages `$page_cached_ops` +
`$page_cached_stream` for the head block behind its emit and parks the byte
offset in the descriptor's otherwise-unused operand word, exactly as the
one-block installer does, so a later walk that meets a region descriptor reads
its ops out of the saved table instead of re-decoding.

Two bugs were found while building it and are fixed here. `$page_cached_stream`
returned nothing when a region's head block was *itself* already a one-block
descriptor, so the saved-copy table grew a second header word (`{n, rawlen,
offsets, bytes}`) and both readers and both writers moved with it. And the
emitted descriptor header billed the guest clock `$nat + $extra` — the block's
step cost *plus the byte count* of the copy parked behind it. A cost is steps;
bytes are not steps. It is `$nat` now.

### 23.2 What it did to quake2

`node test/run.js --app=quake2_demo --args='+set vid_ref soft +map demo1'
--quiet-api --batch-size=200000 --max-batches=1000 --verbose`, the §22 command:

| arm | block decodes | vs off | pages compiled | 1-blk installs | region installs | native% |
|---|---|---|---|---|---|---|
| off | 781,266 | — | 18,269 | 0 | 0 | — |
| round 13 `--no-block-exec-regions` | 857,385 | +9.7% | 19,245 | 16,946 | 0 | — |
| round 13 `--block-exec` | 876,984 | +12.3% | 19,607 | 15,368 | 1,101 | 97.95 |
| **round 14 `--no-block-exec-regions`** | **782,314** | **+0.13%** | 18,843 | 16,345 | 0 | 98.26 |
| **round 14 `--block-exec`** | **806,155** | **+3.19%** | 18,801 | 19,360 | 4,482 | 98.13 |

The decode half of the acceptance is met with room to spare: +3.19% against a
5% budget, and the no-regions arm is within a seventh of a percent of the plain
interpreter. **Page compiles are the reason, and they are the number to read**:
18,801 against the off arm's 18,269, where round 13 needed 19,607 — the executor
now costs the page table almost nothing, which is precisely §22.5's prediction.
Region installs are 4.1x round 13's (4,482 vs 1,101) and one-block installs 1.26x
(19,360 vs 15,368). Entries 10,288,227, opsMulti 212,577,687 of 236.0M total
(90.1%), transfersSaved 25,332,645, meanBlocks 10.66, native% 98.13 — above the
97.9 floor.

**The install half of the acceptance as literally written is not met, and it
should not be.** Round 12's 185,907 one-block and 38,881 region installs are
not a coverage number: an install can happen at most once per decode, and round
12 bought those installs with 3,108,885 decodes and 40,788 page compiles against
the off arm's 18,269. They were **re-installs after page drops**, the same
blocks paid for again and again — which is the exact pathology round 13 was
written to end. The two halves of the criterion are in structural tension, and
the round-12 install counts can only be reached by giving back the decodes.
What round 14 reports instead is installs rising 1.26x/4.1x *while* page
compiles fall to the off baseline, i.e. more blocks covered for less work.

### 23.3 The 13 windows

Both columns are the executor **armed** (`--block-exec --block-exec-stats
--verbose`); the r13 column is §22.6's `on` arm, collected by
`docs/block-executor-design/collect-round13-windows.sh`, and the r14 column by
`docs/block-executor-design/collect-r14-windows.sh` (read out with
`read-r14-windows.sh` beside it) on the same window definitions
(`docs/block-executor-design/collect-round12-carry.sh`). `opsMulti%` is
`opsMulti / (ops1 + opsMulti)`, the share of executed uops that came from a
multi-block region.

| window | decodes r13→r14 | 1-blk inst r13→r14 | region inst r13→r14 | entries r13→r14 | native% r13→r14 | opsMulti% r13→r14 |
|---|---|---|---|---|---|---|
| quake2-loading | 99,223→96,483 | 1,451→1,394 | 31→**93** | 2.20M→2.20M | 96.49→96.46 | 80.07→79.93 |
| quake2-gameplay | 2,036,356→**1,842,872** | 35,218→43,940 | 2,431→**9,571** | 16.3M→20.0M | 98.45→98.26 | 24.12→**54.12** |
| gta2-loading | 67,924→67,896 | 245→196 | 12→**38** | 163,796→108,428 | 94.70→94.45 | 9.48→**22.37** |
| gta2-gameplay | 816,969→815,012 | 18,008→17,847 | 62→**121** | 682,439→549,686 | 90.30→89.78 | 19.99→**27.56** |
| rct-gameplay | 290,984→**278,615** | 11,812→11,792 | 89→**167** | 1.74M→1.84M | 94.87→94.95 | 73.59→**79.31** |
| heroes2-loading | 25,780→**14,826** | 845→781 | 43→**62** | 621,868→1.19M | 99.16→98.81 | 17.61→**37.29** |
| heroes2-gameplay | 227,792→**206,448** | 2,799→3,828 | 49→**70** | 1.18M→2.40M | 98.82→98.63 | 17.92→**36.04** |
| caesar3-loading | 2,742→2,719 | 63→52 | 15→**49** | 314,490→307,841 | 93.29→93.58 | 9.52→**12.14** |
| *mw3-loading* | *35,704→22,027* | *520→285* | *23→21* | *2.83M→825,270* | *99.96→99.99* | *0.72→0.09* |
| *mw3-gameplay* | *1,070,987→10,189* | *21,270→160* | *119→13* | *4.01M→548,558* | *99.87→99.99* | *0.71→0.08* |
| *rct-loading* | *257,026→230,965* | *12,057→11,759* | *103→167* | *2.11M→1.32M* | *95.24→95.59* | *81.34→78.78* |
| *starcraft-loading* | *88,356→140,656* | *3,784→9,832* | *16→45* | *2.53M→2.17M* | *98.24→98.35* | *4.68→56.62* |
| *diablo-loading* | *622,080→87,595* | *19,728→19,950* | *35→61* | *16.1M→9.02M* | *98.41→97.43* | *41.42→23.01* |

The five italic rows are **not measurements**. Every window carries
`--max-seconds=170`, and in those five one or both arms hit the wall clock
before its batch cap: r13 time-capped mw3-gameplay, starcraft-loading and
diablo-loading; r14 time-capped mw3-loading (281 of 830 batches), mw3-gameplay
(96 of 1400), rct-loading (3,123 of 4,250), starcraft-loading (715 of 1,500)
and diablo-loading (350 of 400). The box ran loadavg 7 → 60 across the two
collections, so those rows measure how busy the machine was, not the build.
Only the eight upright rows reached `--max-batches` in both arms and are
deterministic.

Across those eight: **region installs are up in every single one** (1.5x to
3.9x, median 2.3x) and decodes are down or flat in every single one, by as much
as 42% (heroes2-loading 25,780 → 14,826) — the chunk contention §22.5 blamed
was real, and separating the chunks recovered it without a tuning knob. The
`opsMulti%` column is where to look for what that bought: the share of work
coming from multi-block regions roughly doubles on six of the eight
(quake2-gameplay 24.1 → 54.1, heroes2-gameplay 17.9 → 36.0, gta2-loading
9.5 → 22.4), because a region that used to be declined for want of room now
installs. `native%` moves by less than half a point either way in all eight,
which is the flat line you want from a change that is about *storage*: the same
ops are being executed, from a different place.

### 23.4 What the tests cover

`test/test-block-exec.js` grew six checks (242 → 248) for the new chunk, built
around a synthetic 4KB-aligned page packed to the brim with 17-byte blocks
(`add eax,imm32; add eax,imm32; jmp next`; `aluRI` is a 6-byte encoding, not 5).
Beyond "the arms agree on the result", it asserts that a descriptor chunk was
actually allocated, that descriptors installed into it, that the chunk **ran
out** (`get_page_desc_chunk_full` + `get_block_exec_no_room` ≥ 1), and — the
one that matters — that `on.compiles <= off.compiles + 1`. That last assertion
is the whole behavioural difference from round 13 stated as a test: an overflow
DECLINES an install and the page stays compiled, where before it took the page
down and every block on it got decoded again.

Also green against this build: `test-x86-ops` (145), `test-tree-fold` (55 blocks
matched, 9,198 super-op runs), `test-worker-wasm-globals` (38 setters — the new
`$cur_page_desc` among them), `test-x87-pipeline4-fusion` (11 differential cases).

### 23.5 The carry limit stays

§18's cross-edge fact carry still refuses any predecessor that is not `m-1`,
and the round-14 brief asked for that lifted "if it is cheap". Measured on the
quake2 window: `carryEdges 103,562`, `carryRefused 66,076` — so the refusal is
real and frequent, 39% of candidate edges. It is not cheap. Carrying past
`pred == m-1` means a *per-member* snapshot of the carried state rather than
one running set, and the carried state is the 16x8-word fact table plus
`$bx_fact_n` plus the 15x2-word const table, ~159 words a member. `$BX_RG_BASE`
is 8,192 words with 7,912 already used — about 280 spare, under two members'
worth — so the lift is a ~10KB region growth before a line of it works. That is
a round of its own, not a rider on this one.

### 23.6 The picture

`docs/block-executor-design/collect-r14-png.sh`: quake2, heroes2 and rct, each at two batch budgets,
block-exec off and on, same command otherwise. **Five of the six pairs are
byte-identical** — 0 of 76,800 (quake2 at 600 and 2,600) and 0 of 307,200
(heroes2 at 700, rct at 1,500 and 3,000), max channel delta 0.

The sixth, heroes2 at 1,400 batches, differs in 1,140 of 307,200 pixels (0.37%,
max channel delta 64, box 65,37 305x338). That is **animation phase, not a
rendering difference**, and the way to tell is to measure both null bands rather
than eyeball the frame:

- *Run-to-run*: two further off runs at the same budget are byte-identical to
  each other and to the original. The pipeline is deterministic; 0.37% is not
  noise.
- *Frame-to-frame*: off at 1,399 vs off at 1,400 differs in 1.43% of pixels
  (box 64,35 312x357) and 1,400 vs 1,401 in 1.37% — **one batch of guest time
  already moves four times as many pixels, in the same box**. The map's water,
  campfire and flags are animating. The on-vs-off delta is a fraction of a
  single animation step of that same region.
- *Which path*: `--no-block-exec-regions` and the full `--block-exec` arm produce
  **pixel-for-pixel the same** difference (1,140 / 0.3711% / box 65,37 305x338).
  So round 14's new region chunk contributes nothing to it; it is the one-block
  descriptor's step accounting nudging the timer phase, which the executor has
  done since it could bill a block at all.

Game state is identical in both frames — same map, same castle, same hero, same
resource bar.

### 23.7 No wall-clock A/B this round

`tools/fold-ab.js` was not run. `uptime` on this box read loadavg **37.30 /
39.47 / 44.05** at the point the timing arm would have started (7.75 at its
quietest during the session, 60 at its busiest), against the 10 above which a
whole-app A/B on this machine measures the machine. A timing claim from that
would be unresolvable, so this round is argued entirely from **counts**, which
are load-immune: decodes, page compiles, installs, entries, native% and
opsMulti% above. The one wall-clock number worth recording is that it never
*got worse* in any window that reached its batch cap.

## 24. Round 15: the fused x87 run as a cheap micro-op (2026-09-15)

Round 12 gave the executor x87 by admitting the fused op as a **fallback**:
spill all eight GPRs, point `$ip` at a pool copy of the inline words terminated
by `$BX_RESUME_HANDLER`, `call_indirect` the real handler, let its
`return_call $next` dispatch H459 back into the executor, reload all eight. It
bought coverage and nothing else — `$nat` was deliberately not bumped for it,
`$BX_C_X87FB` priced it at 96 (about six native uops), and section 17.5 turned
the lever off because on the finished round-12 build it *lost* installs.

Round 15 asks the other question: what if the x87 op is **cheap**? Not so the
x87 gets faster — the fused body does exactly the same FPU work either way —
but so the *integer* ops around it stop being priced out of the executor.

### 24.1 What is new

**`TU_X87RUN` (kind 60).** A fused x87 run — H449 pipeline4/short, H450 tree4,
H451 island, H452 affine-prepare, H453 affine-finish — emitted as one micro-op
whose arm calls the handler's **body** directly.

**Why there is no resume trampoline, precisely.** The round was framed as "the
x87 fused handlers do not set `$eip`". They do not, and that is true, but it is
not the reason the trampoline exists. The trampoline exists because every one of
those five handlers *ends in* `(return_call $next)`: calling the table entry
from inside the executor would hand control to the interpreter's dispatch loop
and never come back. So each was split in `src/07b-loop-match.wat`:

```
(func $th_x87_pipeline4 (param $op i32)         ;; the thread-table entry
  (call $x87_pipeline4_body (local.get $op))
  (return_call $next))
(func $x87_pipeline4_body (param $op i32) ...)  ;; the body, callable
```

`$x87_run_body` then picks the body by `fn` with a compare chain — deliberately
**not** `call_indirect` through the handler table, because the table holds the
wrappers, which would put `$next` back.

**Bare x87 ops go native.** H188/H189/H190 that no fuser absorbed used to become
fallbacks. They now run `$tree_uop_classify` first and, when it accepts, emit
07b's own native kinds `TU_X87_MEM`/`_MRO`/`_REG`/`_SW_AX` (50-53) and bump
`$nat`. A form the classifier declines still falls to `TU_FALLBACK`.

**Partial publish, no reload.** `TU_X87RUN` publishes only the GPRs the run
*reads*, from an 8-bit mask the installer computes and stores in the `d` field
(`$x87_run_reads`, plus a walk of the packed island record for H451). It
reloads **nothing**. Three obligations, each checked rather than assumed:

1. every address a fused body forms comes from `$x87_pipeline_addr` or, in the
   island, one `$get_reg` — the walk collects exactly those nibbles;
2. nothing else in those bodies reads the register file: `$fpu_exec_mem` /
   `$fpu_exec_reg` do not, and `$gs32`'s `$invalidate_code_write` does not
   (grepped);
3. the only other consumer of a stale global is a crash report from
   `$fpu_crash_op`, which the other four families never call and which
   `$x87_island_op_ok` makes unreachable for H451.

No fused body writes a general register, so the reload is genuinely empty.
FNSTSW AX is the one x87 instruction that does, and it cannot be inside a run:
four families are shape-matched to FLD/arith/FSTP, and in the fifth
`$tree_x87_reg_ok` declines group 7 outright. It is reachable only as a *bare*
op, where kind 53 publishes EAX, calls, and reloads EAX alone.

Putting the mask in `d` is safe because `$bx_mem_shape` gives kind 60 shape 3
("not modelled"), and `$bx_opt_pass` walk 1 leaves on shape 3 *before* it reads
`d`; the arm clears `$wrote`, so the writeback `br_table` never sees it either.

### 24.2 The decline this round had to fix first

The first build declined every H449 mode-0 region with `declWhy 3`. Root cause,
found rather than guessed: the five fusers run in fixed order in
`src/07-decoder.wat` and **none of them skips ops an earlier one absorbed**, so
`$x87_island_fuse_block` (last) re-fuses the *tail* of an H449 four-op region
into an H451. The installer's absorbed-entry check demanded 188..190, saw 451,
and declined the whole block. That means the commonest fold shape —
FLD / arith / arith / FSTP — **had never installed at all since round 12**.

Widening the check to accept 188..190 *or* 449..453 is sound: an outer fused
body reads its inline stream by address word only (H449 takes
`$tp+0/+12/+24/+36`, the address slot of each absorbed 12-byte record), so a
rewritten handler or operand word in an absorbed entry is dead data.

### 24.3 Cost model

`$BX_C_X87RUN` = 16, against `$BX_C_X87FB` = 96 and `$BX_C_FALLBACK` = 20. A
`TU_X87RUN` is *not* counted in `$nfb`, and it does not bump the benefit term
either — the benefit of the round is the integer uops that now clear the bar,
not the x87 op. The `cost` descriptor word is `$nat + $nx87run`: a `TU_X87RUN`
never calls `$next`, so unlike a fallback it charges nothing through the parked
`$steps` counter and has to be billed one step here.

### 24.4 Microbench — and a correction to section 17.5's number

`tools/bench-loops.js --toggle=block_exec_x87 --reps=9`, minima, one process,
alternating arms, loadavg 30.

**The three x87 shapes were measuring the wrong thing.** Each planted its float
operand with `mov dword [esi+8],imm32` — and *that* form is itself a
`TU_FALLBACK`. The counters say so plainly: 250,000 fallbacks in a
250,000-iteration run. So section 17.5's **-62.0%** for `blk_x87mix` is mostly
one spill-eight / `call_indirect` / reload-eight per iteration that has nothing
to do with x87. The store is now `mov [esi+8],ebp` with `ebp` preloaded to 1.0f
— same fact-killing store, same bytes, modelled kind — and the ON arm runs at
`fallback=0`.

| shape | ON min | OFF min | paired median | ON arm coverage |
|---|---|---|---|---|
| `blk_x87mix` (5 ops, fld/fstp pair) | 68.4ms | 53.5ms | **-39.2%** | 1.5M native, 0 fallback |
| `blk_x87long` (14 ops, pair in a long integer body) | 161.7ms | 104.6ms | **-53.9%** | 4.0M native, 0 fallback |
| `blk_x87sw` (7 ops, fld/fcomp/fnstsw ax) | 135.7ms | 116.1ms | **-34.2%** | 2.0M native, 0 fallback |

Two things this does and does not say. It does say the x87 arm is still a
**loss** on these shapes even at 100% native coverage — so the round did not
make an x87-carrying block of this size worth executing. It does **not** isolate
the price of an x87 micro-op, because this toggle's OFF arm runs **no descriptor
at all** (round 11 declines any x87-carrying block outright), so the delta is
the whole descriptor, entry and exit included, on blocks of 5 to 14 ops.

**And it cannot price `TU_X87RUN` at all.** The new counter line says so
directly:

```
x87 entries: 0 (cheap 0, trampoline 0)  bare-native 2
```

No fuser fires in the harness — these shapes are not pipeline candidates — so
every x87 op in them is a *bare* one taking the new native path. The cheap fused
kind is priced only by the app window below.

### 24.5 quake2-gameplay (batches 4000-5000, thread 0, all arms `--x87-fusion`)

| | noexec | off (`--block-exec`) | on (`+ --block-exec-x87`) |
|---|---|---|---|
| block decodes | 349,530 | 354,773 | **338,070** |
| one-block installs | — | 7,169 | **10,094** (+40.8%) |
| entries | — | 2,805,252 | 2,548,746 (-9.1%) |
| ops native | — | 118,926,025 | 116,051,401 (-2.4%) |
| ops fallback | — | 1,559,538 | 1,458,494 |
| native% | — | 98.70 | 98.75 |
| transfersSaved | — | 8,175,099 | 6,543,698 (-20.0%) |
| region installs | — | 1,186 | 738 (-37.8%) |
| opsMulti | — | 53,206,798 | 37,705,967 (-29.1%) |
| entriesMulti | — | 1,280,443 | 745,156 |
| x87 descriptor entries | — | 0 | 26,622 |
| — of them cheap (`TU_X87RUN`) | — | 0 | **26,286 (98.7%)** |
| — still on the trampoline | — | 0 | 336 |
| bare x87 native micro-ops | — | 0 | 114,044 |

Every count above reproduced **to the digit** across two independent runs of the
script; the wall clock for the same arm ranged 35-154 batches/s on this box, so
no timing claim is made from it.

The reading is split, and both halves matter:

- **The one-block installer gains, decisively**: 7,169 → 10,094 installs,
  +40.8%. That is round 15's claim working — the H449 mode-0 blocks that section
  24.2 had been silently declining now install, and the x87 op inside them no
  longer prices its integer neighbours out. 98.7% of the fused runs take the
  cheap kind. Decodes go *down*, so round 13's rule (an install must not cost a
  decode) still holds.
- **The multi-block region installer loses**: 1,186 → 738. Region *attempts* are
  unchanged (36,110 vs 36,003) and the `classifyRefused` histogram is unchanged
  to within a few percent (`unsafeOp` 7,511 vs 7,291), so this is not the x87
  kind refusing to chain — it is churn in the region cost model, and it is why
  `entries` and `transfersSaved` fall even though installs rise.

So section 17.5's verdict ("the lever is a coverage loss") is **reversed for the
one-block installer and still true for the region installer**, and net native
ops are 2.4% *down*.

### 24.6 mw3-gameplay (batches 920-1000, thread 0, all arms `--x87-fusion`)

The first attempt at this window measured nothing: at loadavg 45 the 270s
wall-clock guard stopped the `off` arm at batch 149 and the `on` arm at batch 6,
so the handler-hist window never opened in either. `ONLY=` and `MS=`/`TO=` were
added to `collect-round15-x87run.sh` for exactly that, and the re-take at
`MS=1500` reached batch 1,000 in all three arms. **Check the `N batches in Ns`
line of every arm before comparing any window on this box.**

| | noexec | off | on |
|---|---|---|---|
| block decodes | 20,757 | 20,742 | 20,742 |
| one-block installs | — | 261 | 265 (+4) |
| entries | — | 892,905 | 892,913 (+8) |
| ops native | — | 709,824,918 | 709,825,054 (+136) |
| ops fallback | — | 119,918 | 119,918 (=) |
| native% | — | 99.98 | 99.98 |
| transfersSaved | — | 17,989,186 | 17,989,186 (=) |
| region installs | — | 44 | 44 (=) |
| opsMulti | — | 1,537,650 | 1,537,650 (=) |
| x87 descriptor entries | — | 0 | 68 |
| — of them cheap (`TU_X87RUN`) | — | 0 | 67 |
| bare x87 native micro-ops | — | 0 | 246 |

This is a **gain, and a negligible one**: +136 native ops against a 709.8M
baseline is +0.00002%. Section 17.5 found mw3 "unchanged to the digit" because
the x87 descriptors were built and never entered; round 15 does get them
entered, and the answer is that there are only 68 of them. The x87 in mw3's hot
code is not in blocks this installer takes, so section 4c's 39.5% is still not
reachable through this lever — not because the lever loses, but because it
barely applies.

### 24.7 The picture is unchanged

`docs/block-executor-design/collect-round15-png.sh`, two budgets per app, both
arms carrying `--block-exec --x87-fusion` and differing only in
`--block-exec-x87`:

| app | budget | `tools/png-diff.js` |
|---|---|---|
| quake2 | 600 batches | 0 of 76,800 pixels differ, max channel delta 0 |
| quake2 | 1,200 batches | 0 of 76,800 pixels differ, max channel delta 0 |
| mw3 | 400 batches | 0 of 307,200 pixels differ, max channel delta 0 |
| mw3 | 830 batches | 0 of 307,200 pixels differ, max channel delta 0 |

Both arms of every pair reached the same batch (checked in the logs, because a
wall-clock-truncated arm photographs a different moment and that reads as a
rendering difference), and every capture has real content — 60 KB and 254-415 KB
of PNG, not a flat surface.

Byte-identical at both budgets on both apps is a stronger result than round 12's
and round 14's sweeps got, and it is what the partial publish had to earn: the
only reason it is allowed to skip seven of eight registers is that nothing in
those bodies can observe the difference.

### 24.8 Verdict

The bar set for this round was: keep the default OFF unless `blk_x87mix` is
non-negative **and** both windows gain. `blk_x87mix` is **-39.2%**, so the bar
is not met and **`$block_exec_x87` stays 0**; the arm stays `--block-exec-x87`.

For the record, the windows half of the bar is *nearly* met and is worth
separating from the microbench half. quake2-gameplay no longer loses one-block
installs — it gains 40.8% of them, reversing section 17.5 — but it loses 37.8%
of its region installs and 2.4% of its native ops, so it is not a clean gain.
mw3-gameplay gains, by 4 installs and 136 ops in 709.8M. Neither result argues
for flipping the default; both argue that the mechanism is now correct and the
thing standing between it and a win is the region cost model, not the x87
plumbing.

What is worth keeping regardless of that switch: the bare-op native path, the
wrapper/body split (which is what makes any future cheap call possible), and
above all the section-24.2 fix, which was a live coverage bug in the *default*
path of the x87 lever rather than a round-15 feature.

## 25. Round 16: the one-block leaf, and the decide experiments (2026-09-15)

[docs/block-executor-review-2026-09-15.md](block-executor-review-2026-09-15.md)
left three questions and a kill rule. Experiment #1 (the reachable-share CDF) is
[round14-decide-cdf.md](block-executor-design/round14-decide-cdf.md). This
section is the other two — the indirect-branch census (#2) and section 13.7's
never-attempted leaf split (#3), measured on the 512-block shape the review asks
for (#3(b)) — and the verdict.

Everything below is either a static count or an in-process alternating-arm
minimum from `tools/bench-loops.js`. No wall-clock A/B of an app appears here:
this box sat between load 3 and load 20 for the whole session, and the null
control below swings ±10% at the top of that range.

### 25.1 How many data-dependent indirect branches does a micro-op cost?

`tools/indirect-census.js --preset=block-exec` classifies every indirect branch
in a named function out of one SpiderMonkey Ion compile (`tools/wasm-native.js`
does the extraction). On arm64 a wasm `br_table` is `cmp` + `ldr x16,[base,idx,lsl #3]`
+ `br x16`; a `return_call` to a known function is an `adr x17` trampoline and is
**not** data-dependent; a `return_call_indirect` is `ldr x8,[table]; add; ldr; br x8`
and is.

| function | bytes | instrs | jump tables | call_indirect | data-dependent sites |
|---|---|---|---|---|---|
| `$th_block_exec` (H458) | 10472 | 2618 | 12 | 2 | 14 |
| `$th_block_exec_leaf` (H463) | 6960 | 1740 | 7 | 0 | 7 |
| `$next` | 568 | 142 | 0 | 0 | 2 |

Those are *sites*, not per-op costs. Per **executed micro-op** the executor's body
loop passes the 62-target kind table plus whichever operand tables that kind
reads — `R[d]` and `R[a]` are 16-target tables, `SRC0` is a third, the SIB index
an 8-target fourth, and the writeback a 16-target fifth taken only when the op
wrote a register. Against the threaded path for the same x86 op:

| x86 op | executor, per micro-op | threaded, per op |
|---|---|---|
| `mov r,r` | kind + 2 reads + writeback = **4** | `$next` + `$get_reg` + `$set_reg` = **3** |
| `mov r,imm32` | kind + writeback = **2** | `$next` + `$set_reg` = **2** |
| `add r,r` | kind + 2 reads + writeback = **4** | `$next` + 3 accessors = **4** |
| `add r,imm32` | kind + 1 read + writeback = **3** | `$next` + 2 accessors = **3** |
| `lea r,[b+d]` | kind + 1 read + writeback = **3** | `$next` + 2 accessors = **3** |
| `mov r,[b+d]` | kind + 1 read + writeback = **3** | `$next` + 2 accessors = **3** |
| `mov [b+d],r` | kind + 2 reads, no writeback = **3** | `$next` + 2 accessors = **3** |
| `mov r,[ebp+d]` | kind + writeback = **2** | `$next` + 1 accessor = **2** |
| `lea r,[b+i*s+d]` | kind + 2 reads + SIB index + writeback = **5** | `$next` + 3 accessors = **4** |

**The executor does not remove indirect branches per micro-op.** It is within one
of the threaded path on every kind, and behind it on the SIB form. The review's
"four to six against one plus two" reads the executor's *site* count against the
threaded path's *per-op* count; the honest comparison is the table above, and it
says the two paths are level.

What the executor actually removes is the per-*block* cost — one `$next` dispatch
and one block transfer per basic block, which is what `transfersSaved` counts —
and what it adds is the entry: eight register materializations, the header parse,
and one function with a dozen indirect sites all aliasing each other in the BTB
instead of 464 handlers with one site each. That last term is invisible to every
`blk{k}` shape, which is why 25.2 exists.

### 25.2 The leaf (section 13.7), and the 512-block shape

`$th_block_exec_leaf` is handler **463**: a fixed function, no codegen, that runs
a descriptor with **exactly one block, no exits, no fallback pool and no
`TU_X87RUN`**. The contract is enforced where the descriptor is emitted —
`$block_exec_try_install` picks `$BX_LEAF_HANDLER` over `$BX_HANDLER` only when
`$nfb` and `$nx87run` are both zero, and both are final before the emit — so the
leaf's arms 57 and 60 are `(unreachable)` rather than dead code it hopes not to
reach. `$bx_is_desc_word` is the one place that knows both handler indices, and
`src/04-cache.wat` asks it rather than comparing against H458; a stamp check that
only recognised H458 would have left stale leaf descriptors live across SMC.

The body loop is duplicated, not shared. WATX has `defmacro`, but `tools/func-index.js`
and `tools/indirect-census.js` resolve names out of `build/combined.wat`, where a
macro is unexpanded — a macro-generated function would be unnameable by exactly
the tools this round needed.

`blk_mix512` is the new shape: 512 distinct blocks of 4-12 mixed register ALU ops,
laid out 128 bytes apart with a `jmp rel8` over the padding and cycled. The
spacing is load-bearing twice over — only 32 blocks land on a 4KB code page, so
the page's 16KB descriptor chunk holds them all (at 16 uops it does not: 368 of
512 install), and the shape declares `codeStride` because a shape longer than its
own stride puts rep N's first block where rep N-1's tail was decoded, which is
silent and had the off arm running the on arm's installed descriptors. `oneRep`
now refuses that instead.

**Leaf on vs leaf off, executor armed in both arms** (`--toggle=block_exec_leaf`,
31 reps, minima, three independent runs, positive = leaf faster):

| shape | run 1 | run 2 | run 3 |
|---|---|---|---|
| `blk4` | -0.7% | -0.3% | -0.9% |
| `blk8` | -0.5% | +1.4% | -4.8% |
| `blk16` | -0.2% | +1.3% | -2.3% |
| `blk32` | -0.7% | -0.3% | +2.8% |
| `blk_mem8` | -0.1% | -2.0% | -0.3% |
| `blk_fb8` (null control — a fallback can never take the leaf) | +0.4% | -1.1% | +0.2% |
| **`blk_mix512`** | **+12.8%** | **+13.5%** | **+14.9%** |

`blk_fb8` is the control that makes the rest readable: the leaf cannot service it,
so its true delta is zero and its spread is the box's noise floor. Every
single-site shape sits inside that band. The 512-block shape is 13-15% outside it,
three times.

Region shapes do not move (`--toggle=block_exec_leaf`, 21 reps, minima):
`region_if2` +0.0%, `region_diamond4` +0.9%, `region_state6` -0.1%,
`region_ladder5` +0.7%, `region_call1` +1.8%, `region_null` +0.0%.

**Executor vs threaded on `blk_mix512`** (31 reps, minima, three runs):

| arm | run 1 | run 2 | run 3 |
|---|---|---|---|
| executor **with** the leaf (`block_exec_forced`) | +1.2% | +2.2% | +1.2% |
| executor with the leaf **disabled** (`block_exec_forced_gen`) | -11.7% | -10.9% | -10.3% |

That pair is the round's result. On the one shape that does not let the branch
predictor learn the executor's dozen indirect sites, the general region handler
**loses 11%** to the threaded interpreter, and the leaf is the whole difference
between that and a small win.

**Breakeven in native uops, cold predictor** (`blk_mix512_u{k}`, executor vs
threaded, 9 reps, minima):

| uops/block | leaf on | leaf off |
|---|---|---|
| 2 | -19.7% | — |
| 4 | -16.5% | — |
| 6 | -6.2% | — |
| 8 | -3.9% | -15.3% |
| 10 | -2.5% | -11.3% |
| 12 | +7.6% * | -2.6% * |

\* 480 of 512 blocks install at 12 uops — the page's descriptor chunk overflows —
so that row is not a clean measurement, only a direction.

With the leaf the crossover is between **10 and 12** native micro-ops. The shipped
model's `$BX_C_ENTRY` 190 / `$BX_C_UOP` 16 puts it at **11.9**, inside that window,
so **the cost model needs no change** and the floor of 12 is confirmed rather than
merely bisected. Without the leaf the crossover is above 12.

The `blk{k}` family says the opposite and must not be used for this: on a single
block re-entered forever the executor wins at every size measured, +42.3% at two
micro-ops. A floor calibrated there would be 2, and it would be wrong for every
app.

### 25.3 The windows

Deterministic counters, executor off and on, batch counts fixed so the run ends on
`--max-batches` and not on a clock (a `--max-seconds` cutoff lands on a different
batch every time and none of these numbers would repeat). quake2-gameplay is 8000
batches rather than round 14's 20000 because 20000 does not fit this session's 60s
guard.

| window | arm | installs | entries | **leaf entries** | **general entries** | ops native | fallback | native% | transfersSaved | decodes |
|---|---|---|---|---|---|---|---|---|---|---|
| heroes2-gameplay (3000) | off | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | 215,634 |
| heroes2-gameplay (3000) | on | 3,828 | 2,401,388 | 647,686 (27.0%) | 1,753,702 | 25,602,933 | 354,387 | 98.63 | 1,251,320 | 206,448 |
| quake2-gameplay (8000) | off | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | 642,738 |
| quake2-gameplay (8000) | on | 14,574 | 5,918,842 | 1,613,981 (27.3%) | 4,304,861 | 241,727,850 | 3,609,653 | 98.52 | 15,547,045 | 656,925 |

Two things to read off that. The leaf is **27% of executor entries** in both
windows, not the majority — most one-block installs carry at least one fallback
micro-op and stay on the general handler, so the 13% the leaf is worth on
`blk_mix512` reaches roughly a quarter of the executor's real traffic. And the
executor still does not cost decodes: heroes2 decodes *fewer* blocks with it armed
(206,448 vs 215,634), quake2 2.2% more.

Pixels, `--block-exec` off vs on, two budgets each:

| capture | changed pixels |
|---|---|
| quake2 b600 | 0.0000% |
| quake2 b2600 | 0.0000% |
| heroes2 b700 | 0.0000% |
| heroes2 b1400 | 0.3711% (box 65,37 305x338) |

The one nonzero row is **pacing, not rendering**, and the controls say so: the
window is deterministic (the off arm photographed twice at b1400 differs by
0.0000%), and one batch of that scene moves **1.4333%** of the frame inside the
same box (off arm b1399 vs b1400, box 64,35 312x357). 0.37% is a fraction of one
batch of an animation, measured against a null band four times its size.

### 25.4 Verdict on the kill rule

The rule the review set: *if `blk_mix512` is negative for the executor, the
executor is frozen as the region/self-loop fold, default OFF, and no further
executor round is opened.*

`blk_mix512` is **+1.2% to +2.5%** for the executor as it now ships. **The kill
rule is not met**, and the executor is not frozen.

State the margin with it, because it is thin and it is contingent:

* +2% on a microbench whose null control (`blk_fb8`) swung ±1% in the same
  session and ±10% earlier in the day at load 12-20. This is a *sign*, measured
  three times, not a magnitude anyone should quote.
* It is positive **only because of this round's work**. The same shape is -11%
  with the leaf disabled, which is what the executor measured as before today.
* The leaf reaches 27% of executor entries on the two real windows, so the
  mechanism's headroom on an app is a quarter of the 13% the microbench shows.

`$block_exec` stays **0** — default OFF, `--block-exec` is still the arm — and
nothing in this round argues for flipping it. What this round changes is which
question the next one asks: the executor's remaining cost is the general
handler's entry and its BTB footprint, not the per-micro-op dispatch count
(25.1 shows that is level with the threaded path), and the way to shrink it is
to widen the leaf's contract — a fallback-carrying block is 73% of executor
entries and currently pays the whole region function for one `pushfd`.

### 25.5 Not proven

* **The leaf on a real app.** Every number in 25.2 is a microbench. There is no
  app-level A/B in this section and there deliberately is not one: the box was
  loaded for the whole session and the wall-clock A/Bs that produced
  [interpreter-dispatch-perf.md](interpreter-dispatch-perf.md)'s unresolvable
  24-42% are what `bench-loops.js` exists to replace.
* **The 12-uop row of the breakeven sweep**, where 480 of 512 blocks install.
  A page-chunk-aware variant (16 blocks per page) would fix it and was not built.
* **Whether the leaf's win is the site count or the live-range count.** It has
  half the indirect sites *and* a third less code *and* ~30 fewer live locals,
  and this round separated none of those.
* **The general handler with the fallback path split out.** If the leaf's win is
  BTB footprint, the same treatment applied to the fallback-carrying one-block
  case is the larger prize, and it is untouched.

## 26. Round 16: x87 as a REGION MEMBER op (2026-09-15)

> Section 25 is deliberately absent here: it belongs to the concurrent round-16
> work on the executor's body loop (the one-block leaf split) and is written in
> that worktree. This section is numbered 26 so the two can land in either order
> without renumbering each other.

Round 15 taught the **one-block** installer the fused x87 run and 07b's bare
native x87 kinds, and section 24.5 left two things on the table. One was a
result: region installs on quake2-gameplay fell 1,186 → 738 with the region
classifier untouched and `classifyRefused` unchanged — churn nobody had a
mechanism for. The other was the scope: `$bx_rg_classify_block` still refused
every x87 op as `$bx_op_unsafe`, so a hot loop whose body held one `fld`/`fstp`
pair was **truncated at that member**, and a chain cut in the middle usually
falls under the two-block minimum and is declined outright.

This round does both: lift the region refusal (section 17.4's "smaller change"),
and go find the churn with counters rather than theory.

### 26.1 What is new

**The classifier arm.** `$bx_rg_classify_block` learns the same
`$x87_fused_span` arithmetic the one-block installer got in round 12, placed
**above** the `$bx_op_unsafe` test for the same reason the one-block arm is:
188..190 and 449..453 are "unsafe" to that predicate for two reasons that no
longer hold (the fusers ran after the matcher; everything ≥418 is a fold unless
stated). A bare 188..190 goes through `$tree_uop_classify` and becomes one of
kinds 50..53; anything `$x87_fused_span` reports a span for becomes one
`TU_X87RUN` (kind 60) when the absorbed walk says it is cheap, and one
`TU_FALLBACK` otherwise. The gate is `$block_exec_x87`, exactly as the one-block
path's is, and the classifier refuses precisely what the one-block classifier
refuses — the FCOMIP-style forms `$tree_x87_reg_ok` declines go to the
trampoline arm; FNSTSW AX is **not** among them, since it has its own kind
(`TU_X87_SW_AX`) that publishes and reloads EAX alone.

**The emitter.** There is nothing to add to it, and that is the point worth
stating rather than assuming: a one-block descriptor **is** a one-member region
to `$th_block_exec`, so a micro-op array that runs in one runs in the other by
construction. The member is written with exactly the kinds, the `d` read mask,
the pool copy of the inline words and the two-word `$BX_RESUME_HANDLER`
trampoline the one-block path writes. The alias rules need no change either —
`$bx_mem_shape` already gives 50..53 and 60 shape 3, "not understood", which
kills every fact — but that is a property of a shared table rather than of
anything this path does, so it is now **asserted in a test**
(`test-block-exec.js`, "an x87 member kills the alias fact across it") instead
of reasoned about.

**Two hazards the one-block scan does not have**, both in the op-index
bookkeeping:

- the flag producer is **lifted out** of the body at op index `$tidx`, so scan
  index `i` maps to op index `i` or `i+1`. A span is a run of consecutive op
  indices, so a producer sitting strictly inside one would make `i += span` step
  over it. Declined (`$bx_rg_nofit 6`) rather than repaired: a producer is a
  cmp/test/sub and every absorbed entry is checked to be 188..190/449..453, so
  the two cannot overlap in practice and this is a guard, not a path.
- a member's `cost` word is an **op count**, not `$nat`. A fused run would
  otherwise bill one threaded step per absorbed op, when the threaded arm bills
  **one** — the absorbed ops are inline data and never dispatch. `$absorbed` is
  subtracted at the record commit. Without that subtraction a 4-op fused run
  looks four times as expensive as it is, and the cost model declines the very
  regions this round exists to enable.

**The cost model.** A member `TU_X87RUN` is billed at `$BX_C_X87RUN` = 16 ns and
a member x87 fallback at `$BX_C_X87FB` = 96 ns — the same prices the one-block
model uses, because it is the same executor. The region's entry cost and its
per-transfer cost are untouched.

**The sub-lever.** `$block_exec_x87_regions`, default **on**, meaningless
without `$block_exec_x87`. `--no-block-exec-x87-regions` reproduces round 15
exactly on this build, which is what every A/B below is taken against — an A/B
against `--block-exec` alone would vary the one-block family too. Propagated
through `INHERITED_WASM_GLOBALS`.

### 26.2 The churn in section 24.5, found

Six counters were added to name it, and the first hypothesis they killed was
mine. The displaced-stream copy is skipped when the descriptor plus the copy
would not fit 4,096 bytes; a skipped copy is invisible to every round-15 counter
and costs the region family the whole block, because the walker meets a
descriptor with no stream and takes it back. Round 15 installs 2,925 *more*
one-block descriptors, and x87 ones are the biggest, so this looked certain.

It is not what happens. `descNoCopy`, `regionNoCopy` and `rawWants` are **0 in
every arm** — the copy always fits and the walker never had to reclaim a
descriptor. The counters stay, because the channel is real and silent when it
opens, but the regression is elsewhere.

What the arithmetic actually says (quake2-gameplay, `off` → `r15`):

| | off | r15 | Δ |
|---|---|---|---|
| walk attempts | 36,110 | 36,003 | **-107** |
| region installs | 1,186 | 738 | **-448** |
| declines | 34,924 | 35,265 | **+341** |
| — `noRoom` | 2,714 | 2,863 | +149 |
| — `shortChain` | 20,768 | 20,927 | +159 |
| — `thrash` | 927 | 985 | +58 |
| — `exitsFull` | 30 | 6 | -24 |
| — `notWorthIt` | 10,429 | 10,428 | **-1** |
| `nrChunkFull` (new split of `noRoom`) | 2,714 | 2,863 | **+149** |
| `nrBytes` / `nrArena` (the other two sites) | 0 / 0 | 0 / 0 | = |
| `memoLocked` (new) | 6,684 | 6,875 | +191 |
| one-block installs | 7,169 | 10,094 | +2,925 |

`installs + declines == attempts` in both arms, so the -448 decomposes exactly
as (+341 declines) + (-107 attempts). Three findings:

1. **It is not the cost model.** `notWorthIt` moves by **one**. Whatever round
   15 did to the region family, it did not make regions look more expensive.
   That rules out the reading section 24.5 offered ("churn in the region cost
   model") and it is why none of the knobs — K, the thrash cap, the reserve —
   is the lever.
2. **One third of it is priced, exactly: the shared per-page descriptor chunk.**
   Round 14 gave descriptors their own 16 KB per-page chunk, and **both families
   draw on the same one**. Round 15 puts 2,925 extra one-block descriptors into
   it, and the new split of decline reason 3 attributes the entire `noRoom`
   delta to `nrChunkFull` (+149, with the other two sites flat at zero). So a
   one-block x87 install can and does crowd out a region install on the same
   page. This is a round-14 structural cost, not a round-15 bug.
3. **The amplifier is the install rate, and it is 3.3%.** 1,186 installs out of
   36,110 attempts. A decline mass that shifts by 1.0% moves installs by 38%.
   No single large cause is needed to explain -448 and none exists: the residue
   is +159 `shortChain` and +58 `thrash`, spread thin.

The **entries** collapse is larger than the install collapse (`entriesMulti`
1,280,443 → 745,156, -42%, against -38% of installs) and concentrates at the
hot shape: N=13 regions go 453 → 189 installs and 325,612 → 106,038 entries.
The mechanism that fits is the memo **ratchet** — `$bx_memo_note` stops asking
about a head after `$bx_walk_memo_max` (3) consecutive failures, permanently, so
a transient failure streak is permanent coverage loss and the heads lost are the
hot ones rather than average ones. `memoLocked` rises by 191, the right order
for the +217 of `shortChain` + `thrash`. **This one is consistent, not proved**:
a per-head causal link would need a walk trace this build does not produce, and
it is recorded as an open question rather than a result.

**The fix taken is round 16 itself, plus honest pricing.** Lifting the refusal
removes the truncation (`classifyRefused unsafeOp` 7,291 → **0**, the bucket
disappears). The chunk-pressure third is **named and not fixed**: fixing it
means changing how round 14 splits a page between the two families, which is a
different round and a knob this one was told not to turn.

### 26.3 quake2-gameplay (batches 4000-5000, thread 0, all arms `--x87-fusion`)

`r15` is `--block-exec --block-exec-x87 --no-block-exec-x87-regions`; `on` adds
the region path. All four arms reached batch 5,000.
`docs/block-executor-design/collect-round16-x87regions.sh`.

| | noexec | off (`--block-exec`) | r15 (`+ --block-exec-x87`) | on (round 16) |
|---|---|---|---|---|
| block decodes | 349,530 | 354,773 | 338,070 | 335,690 |
| one-block installs | — | 7,169 | 10,094 | 10,087 |
| entries | — | 2,805,252 | 2,548,746 | 2,621,096 |
| **ops native** | — | **118,926,025** | 116,051,401 | **121,484,776** |
| ops fallback | — | 1,559,538 | 1,458,494 | 1,786,204 |
| native% | — | 98.70 | 98.75 | 98.55 |
| transfersSaved | — | 8,175,099 | 6,543,698 | 7,650,164 |
| **region installs** | — | **1,186** | 738 | **764** |
| opsMulti | — | 53,206,798 | 37,705,967 | 44,516,190 |
| entriesMulti | — | 1,280,443 | 745,156 | 845,574 |
| walk attempts | — | 36,110 | 36,003 | 35,503 |
| `classifyRefused unsafeOp` | — | 7,511 | 7,291 | **0** |
| `classifyRefused termNotModelled` | — | 25,420 | 25,541 | 30,105 |
| `classifyRefused noFlagProducer` | — | 12,048 | 12,347 | 13,180 |
| `nrChunkFull` | — | 2,714 | 2,863 | 3,637 |
| **regions holding ≥1 x87 member** | — | 0 | 0 | **274** |
| — member `TU_X87RUN` micro-ops | — | 0 | 0 | 7,181 |
| — member bare-native micro-ops | — | 0 | 0 | 4,720 |
| — member x87 fallbacks | — | 0 | 0 | **0** |

Every count reproduced to the digit across runs. The box ran at loadavg 3-16
during the sweep and the wall clocks (13.9 s `off`, 15.3 s `on` for 5,000
batches) are **not quoted as a result**.

The reading:

- **Against round 15, round 16 wins on every axis it was built for.** Region
  installs 738 → 764, `opsMulti` 37.7M → 44.5M (+18.1%), `entriesMulti` 745K →
  846K, ops native 116.1M → 121.5M (+4.7%). 274 regions now hold x87, carrying
  7,181 fused runs and 4,720 bare native micro-ops — and **not one member x87
  fallback**, so every x87 op that reached a member took a cheap or a native
  kind.
- **Against the x87-off arm, the result is split.** Ops native 121.5M **exceeds**
  `off`'s 118.9M (+2.2%) — the whole point, since round 15 was 2.4% *down* — but
  region installs are still 764 against 1,186.
- **Why installs stay down is now visible rather than mysterious.** The x87
  refusal bucket is gone (7,291 → 0), and the refusals reappear *later in the
  chain*: `termNotModelled` +4,564 and `noFlagProducer` +833. A block that used
  to die at its x87 op now gets as far as its terminator and dies there instead.
  Meanwhile `nrChunkFull` climbs to 3,637, because a region descriptor holding
  x87 members is bigger and the page chunk is the same size.
- Work moved from regions to one-block descriptors and the **total** went up:
  `ops1` 67.3M (`off`) → 78.8M (`on`) while `opsMulti` fell 53.2M → 44.5M.

### 26.4 mw3-gameplay (batches 920-1000, thread 0, all arms `--x87-fusion`)

| | noexec | off | r15 | on (round 16) |
|---|---|---|---|---|
| block decodes | 20,757 | 20,742 | 20,742 | 20,742 |
| one-block installs | — | 261 | 265 | 265 |
| entries | — | 892,905 | 892,913 | 892,913 |
| ops native | — | 709,824,918 | 709,825,054 | 709,825,054 |
| ops fallback | — | 119,918 | 119,918 | 119,918 |
| region installs | — | 44 | 44 | 44 |
| opsMulti | — | 1,537,650 | 1,537,650 | 1,537,650 |
| entriesMulti | — | 72,890 | 72,890 | 72,890 |
| `classifyRefused unsafeOp` | — | 0 | 0 | 0 |
| regions holding ≥1 x87 member | — | 0 | 0 | **0** |

**`on` is byte-identical to `r15` on every counter in the run**, which makes mw3
a clean null control rather than a second data point. The reason is visible in
one row: `classifyRefused unsafeOp` is **0 in every arm**, including `off`. The
region walker in this window never met an x87 op at all, so there was no refusal
to lift and round 16 has nothing to do here. This is the same finding section
24.6 reached about the one-block path from the other direction — mw3's x87 is
not in the code these installers take — and it is why a two-window bar cannot be
met by improving the mechanism.

### 26.5 Microbench

A new shape, `region_x87` in `tools/bench-loops.js`: a **3-block** loop with one
`fld`/`fstp` pair in the *middle* member, because a two-block loop degenerates —
the x87 block would be the head or the tail, and the case worth pricing is a
member with a member on each side of it. Both arms carry
`--block-exec --block-exec-x87`, so the one-block family is identical and the
only variable is the round-16 sub-lever: the microbench twin of
`collect-round16-png.sh`'s arms.

`node tools/bench-loops.js --shapes=region_x87 --toggle=block_exec_x87_regions --reps=9`,
250,000 iterations, alternating arms in one process:

| | on | off (round 15) |
|---|---|---|
| **block entries / iter** | **2.00** | 4.00 |
| **handler ops / iter** | **16.01** | 21.00 |
| one-block installs | 3 | 6 |
| H458 (executor entries) | 250,256 | 500,000 |
| minima | 165.0 ms | 211.7 ms |
| paired medians | — | +12.3% for `on` |

**Read the first two rows, not the last two.** The box was at loadavg 35-44 for
this run, so the time columns are reported only because their sign agrees; the
block-entry and op counts are deterministic and load-immune, and they say
exactly what the round claims: the region absorbs one block transfer per
iteration (4.00 → 2.00 entries) and 5 of 21 handler ops per iteration, because
the three blocks become one descriptor instead of two descriptors and a gap.

**A correction worth recording, because it nearly shipped as a result.** The
first take of this shape did not force `set_block_exec_min_uops(2)` in the
toggle. At the default floor of 0 the one-block cost model declines every
synthetic block in that file (`declWhy 1`), **nothing installed in either arm**,
and the run compared the plain interpreter against itself — while still printing
"+17.2%" off the minima, with the medians pointing the other way and
`installs 0/0` sitting two lines below it. The toggle now forces the floor, the
same way `block_exec_split` does and for the same reason. Check `installs` is
nonzero in both arms before reading any number off a `block_exec_*` toggle.

### 26.6 The picture is unchanged

`docs/block-executor-design/collect-round16-png.sh`, two budgets per app. Both
arms carry `--x87-fusion --block-exec --block-exec-x87` and differ only in
`--no-block-exec-x87-regions`, so anything that moved would be the region
emitter's publish mask or its alias rules and nothing else.

| app | budget | both arms reached | `tools/png-diff.js` |
|---|---|---|---|
| quake2 | 600 batches | yes | 0 of 76,800 pixels differ, max channel delta 0 |
| quake2 | 1,200 batches | yes | 0 of 76,800 pixels differ, max channel delta 0 |
| mw3 | 400 batches | yes | 0 of 307,200 pixels differ, max channel delta 0 |
| mw3 | 830 batches | yes | 0 of 307,200 pixels differ, max channel delta 0 |

Both arms of every pair reached the same batch (checked in the `N batches in Ns`
line of each log, because a wall-clock-truncated arm photographs a different
moment and that reads as a rendering difference), and every capture has real
content -- 61 KB and 254-415 KB of PNG, not a flat surface.

Byte-identical at both budgets on both apps is what the partial publish had to
earn for the member path as well as the one-block path: the only reason a
`TU_X87RUN` member is allowed to publish five registers out of eight is that
nothing in those bodies can observe the difference -- and a region member has
more that could, because the blocks around it keep running natively afterwards
instead of returning to the interpreter.

### 26.7 Verdict

The bar set for this round was: **with x87 on, region installs ≥ the non-x87 arm
AND ops native ≥ the non-x87 arm on quake2-gameplay.**

| | `off` (non-x87) | `on` (round 16) | met? |
|---|---|---|---|
| region installs | 1,186 | 764 | **no** (-35.6%) |
| ops native | 118,926,025 | 121,484,776 | **yes** (+2.2%) |

**The bar is not met, so `$block_exec_x87` stays 0 and no default is flipped.**
The honest summary is that round 16 fixed the half of section 24.5 it set out to
fix and did not reach parity on the other half:

- Against **round 15** — the arm that actually regressed — round 16 gains on
  every axis: region installs +3.5%, `opsMulti` +18.1%, `entriesMulti` +13.5%,
  ops native +4.7%. The x87 refusal bucket in the region classifier is gone
  entirely and no x87 op that reaches a member falls back.
- Against the **x87-off** arm, native ops now *exceed* the baseline (round 15
  was 2.4% down) but region installs do not recover. The reason is measured
  rather than guessed: the refusals move down the chain to `termNotModelled` /
  `noFlagProducer`, and `nrChunkFull` rises to 3,637 because a descriptor with
  x87 members is bigger and round 14's per-page descriptor chunk is not.
- mw3-gameplay is a **null**, not a second window: its region walker never meets
  an x87 op in this window in any arm.

**What is unproven, stated as such:**

1. The memo ratchet's role in the residual +159 `shortChain` / +58 `thrash` of
   section 26.2 is *consistent* with `memoLocked` +191 and is not proved. A
   per-head walk trace would settle it; this build does not produce one, and
   `$bx_walk_memo_max` has no setter, so even an A/B on the ratchet depth would
   need a new export.
2. The chunk-pressure third is priced and **not fixed**. Whether giving the two
   families separate reserves in the page chunk would recover the 422 installs
   is untested — it is a round-14 change and a knob this round was told not to
   turn.
3. No wall-clock claim is made anywhere in this section. The box ran at loadavg
   3-44 across these sweeps; every number quoted as a result is a deterministic
   counter that reproduced to the digit.

## 27. Round 17: the fallback-carrying leaf (H464), and the chunk reserve (2026-09-15)

Two independent changes, measured separately.

**A.** Section 25 gave one-block descriptors their own small handler, H463
`$th_block_exec_leaf`, and then refused it any descriptor carrying a fallback
pool — so a block with a single `pushfd` in it paid the whole 10 KB general
region function (`$th_block_exec`, 14 data-dependent indirect sites) to run
fourteen native micro-ops and one threaded one. Round 17 adds **H464
`$th_block_exec_leaf_fb`**: the same leaf with a fallback arm.

**B.** Section 26.2 priced, and left unfixed, the two descriptor families
sharing round 14's one 16 KB per-page chunk on a first-come basis. Round 17
adds a **per-page region reserve**: N bytes at the end of the chunk that only
the region installer may spend.

### 27.1 Why a second function and not a second arm

A `call_indirect` inside H463's body loop would add a data-dependent indirect
site to *every* descriptor the leaf services, including the 1.6M entries per
window that never touch a fallback — and `tools/indirect-census.js` counts
sites, because that is what a BTB is pressured by. A second entry point instead
makes "the pure leaf did not regress" a property of the **build** rather than
of a measurement: H463's body is byte-for-byte what round 16 shipped, and a
descriptor that carries no fallback still emits H463's handler index.

The cost is that `$bx_is_desc_word` now has to recognise three handler indices
rather than two. That is the one thing this shape can get silently wrong — a
retirement stamp check that missed H464 would leave a rewritten block running
its stale descriptor — so it has its own SMC case in `test/test-block-exec.js`.

The emit site in `$block_exec_try_install` is a three-way select: no fallback
and no x87 run → H463; otherwise, leaf_fb gate on → H464; else H458. So the
`--no-block-exec-leaf-fb` arm is round 16 exactly on this build, which is what
every A/B below is written against.

### 27.2 The microbench (tools/bench-loops.js, `--toggle=block_exec_leaf_fb`)

Minima, three independent runs, alternating arms in one process. `+` = the
fallback leaf is faster.

| shape | run 1 | run 2 | run 3 |
|---|---|---|---|
| blk4 | -0.3% | +0.1% | +0.9% |
| blk8 | +2.3% | -0.1% | -8.9% (outlier) |
| blk16 | +1.2% | +0.4% | -1.6% |
| blk32 | +1.4% | -0.4% | +0.5% |
| blk_mem8 | +0.7% | +1.6% | +0.4% |
| blk_fb8 | +0.3% | +0.0% | +0.2% |
| **blk_mix512** (null control) | +0.2% | -0.2% | +1.6% |
| **blk_mix512_fb** | **+10.0%** | **+10.2%** | **+8.4%** |

Region shapes (21 reps, one run): region_if2 +0.7%, region_diamond4 -0.4%,
region_state6 +2.2%, region_ladder5 -0.9%, region_call1 -1.4%, region_null
+2.2% (this is the noise floor — the shape is *identical* in both arms),
region_x87 +4.2%. Nothing regressed beyond the control band.

`blk_mix512_fb` is new: the `blk_mix512` working set (512 distinct blocks, 128
bytes apart, so no indirect site sees a learnable target sequence) with a
fallback op inserted mid-body in every second block. It is the only shape where
this round is reachable at all, and it is the only shape that moves.

**Two corrections to earlier sections, both found while building that shape:**

1. **`blk_fb8` is not a fallback control any more and section 25 should not be
   read as if it were.** It uses `adc r,r`, which has since become a native
   executor kind; the shape reports `fallback: 0` on this build. The row above
   is therefore a second null control, not a fallback measurement. The op that
   *is* a fallback, and is what `blk_mix512_fb` uses, is `bswap r32`
   (`0F C8+r`): register-only, absent from `$bx_op_unsafe`, and with no kind in
   `$tree_uop_classify`. Measured 235,520 fallback micro-ops, 512/512 installs
   in both arms.
2. **Section 25.4's "fallback-carrying 1-block descriptors are 73% of executor
   entries" is wrong as stated.** 73% is the whole non-leaf remainder, which is
   dominated by *multi-block regions* (2,783,716 of 5,797,427 entries on
   quake2-gameplay). The fallback-carrying one-block population is measured
   below at 13.2% and 1.6%.

### 27.3 The windows

`docs/block-executor-design/collect-round17-windows.sh`. `off` = no executor;
`r16` = `--block-exec --no-block-exec-leaf-fb`; `on` = `--block-exec`.

| | quake2-gameplay (4000-8000) | heroes2-gameplay (1500-3000) |
|---|---|---|
| decodes, off | 651,032 | 215,398 |
| decodes, r16 and on | 660,569 (+1.5%) | 206,394 (-4.2%) |
| entries | 5,797,427 | 2,401,967 |
| leafEntries (H463) | 1,647,224 (28.4%) | 648,177 (27.0%) |
| **leafFbEntries (H464)** | **766,117 (13.2%)** | **38,981 (1.6%)** |
| genEntries, r16 | 4,150,203 | 1,753,790 |
| genEntries, on | 3,384,086 | 1,714,809 |
| ops native | 241,886,033 (identical) | 25,626,675 (identical) |
| transfersSaved | 15,178,070 (identical) | 1,256,726 (identical) |
| entriesMulti (regions) | 2,783,716 | 1,628,771 |
| one-block entries (byN 1) | 3,013,711 | 773,196 |

`r16` and `on` are identical on **every** counter except the entry split — same
decodes, same installs, same native ops, same transfersSaved, same region
installs. That is the shape the change was supposed to have: it moves work
between two functions and changes nothing about what is installed.

Read against the one-block population rather than against all entries, the leaf
family now covers **80.1%** of quake2-gameplay's one-block entries and **88.9%**
of heroes2-gameplay's. The residue (≈600,370 and ≈86,038) is one-block
descriptors with a folded, non-`term_kind 5` terminator — outside both leaves'
contracts by design, not by omission.

### 27.4 The picture

`docs/block-executor-design/collect-round17-png.sh`, two budgets per app, both
arms carrying `--block-exec` so the only variable is which function services a
fallback-carrying descriptor. quake2 at 600 and 2600 batches, heroes2 at 700
and 1400: **all four pairs byte-identical** (`tools/png-diff.js`), with both
arms reaching the same batch and the same API-call count in every pair.

### 27.5 Part B: the per-page region reserve

`$page_desc_would_fit` takes a `$reserve` argument. The region installer passes
0; the one-block installer passes `$page_desc_rg_reserve`, so the last N bytes
of a page's 16 KB descriptor chunk are spendable only by a region.
`$page_desc_reserve_declines` counts only declines the reserve *caused* — a
request that would have overflowed the chunk anyway is the chunk's business.
The default is **0**, i.e. round-16 behaviour exactly.

`docs/block-executor-design/collect-round17-chunk.sh`, quake2-gameplay
4000-8000, read with `docs/block-executor-design/r17-chunk-table.js`:

| arm | decodes | vs off | region installs | 1-block installs | nrChunkFull | rgResDecl | ops native |
|---|---|---|---|---|---|---|---|
| noexec | 651,032 | — | — | — | — | — | — |
| nox87 r=0 | 660,569 | +1.5% | 2,832 | 14,671 | 6,459 | 0 | 241,886,033 |
| nox87 r=2048 | 660,559 | +1.5% | 2,854 | 14,278 | 6,435 | 3,515 | 241,113,118 |
| nox87 r=4096 | 662,019 | +1.7% | 3,056 | 13,790 | 6,732 | 4,049 | 240,312,775 |
| nox87 r=6144 | 662,202 | +1.7% | 3,234 | 13,158 | 6,671 | 4,818 | 243,556,789 |
| **x87 r=0** | 607,370 | -6.7% | **1,618** | 18,344 | 8,320 | 0 | 244,130,867 |
| x87 r=2048 | 645,722 | -0.8% | **2,998** | 19,294 | 8,772 | 6,022 | 280,398,542 |
| x87 r=4096 | 644,389 | -1.0% | 3,042 | 18,576 | 7,187 | 6,384 | 272,678,313 |
| **x87 r=6144** | 651,724 | +0.1% | **3,555** | 17,961 | 6,978 | 7,717 | **281,866,545** |

Section 26.2's effect reproduces on this build at a different scale: turning
x87 regions on takes region installs from 2,832 to **1,618**, a 43% loss, with
the region classifier untouched. The reserve recovers it and then some — at
2048 bytes the x87 arm is already at 2,998, *above* the non-x87 arm's own
r=0 figure, and at 6144 it is 3,555 (+120% over x87 r=0).

**The kill rule holds in every row.** Sections 22/23 require decodes ≤ off+5%;
the worst row here is +1.7% and the best x87 row is +0.1%. No reserve setting
bought regions by making pages recompile.

Native micro-ops rise with it: 244.1M → 281.9M in the x87 arm (+15.5%), which
is the actual point — a region entry replaces a chain of block transfers, so
region installs are only worth quoting when the ops they carry follow.

**Success criterion, stated against the real numbers.** The brief's bar was
"region installs with x87 on ≥ the non-x87 arm's 1,186". 1,186 was section
24.5's figure on an older build; the non-x87 arm on *this* build is 2,832. The
x87 arm clears both bars from r=2048 upward (2,998) and reaches 3,555 at
r=6144, with decodes at +0.1%. Bar met.

**The reserve nevertheless ships at 0.** `--block-exec-x87` is itself off by
default, and on the default (non-x87) path the reserve is a much smaller trade:
+402 region installs against −1,513 one-block installs and +0.7% native ops for
+0.2pp of decode. Turning it on by default would be a second change riding on
round 17's A/B; the counters say it is worth turning on *with* x87 regions, and
that decision belongs to whichever round makes x87 regions the default.
`--page-desc-rg-reserve=N` is the knob.

One second-order effect worth naming so it is not read as a contradiction: in
the x87 arms one-block installs go *up* with a nonzero reserve (18,344 →
19,294 at r=2048) even though the reserve only ever declines them. The reserve
changes which pages survive and which get recompiled, so the population of
pages offered to the one-block installer is not the same population. It is not
evidence that the reserve failed to bind — `rgResDecl` is 6,022 in that row.

### 27.6 Tests

`test/test-block-exec.js` is 350 cases (was 308). The round-17 section covers
H464 entry, both directions of the spill/reload seam (a native write the
fallback reads; a fallback write the natives read), two fallbacks in one block,
the fallback as the first and as the last micro-op, memory either side of the
seam, the gate-off A/B (bit-identical state, install lands on H458, same
fallback-op count), SMC of a leaf_fb install, and the reserve (inert on the
guest's answer, zero declines at r=0, real declines at r=8192, one-block
installs fall, the page is never dropped, the knob is left at its default).

Also green: `test-stream-fold`, `test-tree-fold` (55 blocks, 9,198 super-op
runs), `test-worker-wasm-globals` (42 inherited setters, was 40),
`test-x87-pipeline4-fusion` (11 cases), and `test-x86-ops` (145 cases).

### 27.7 What is unproven

1. **No wall-clock app number is claimed.** The box ran at loadavg 5-40
   throughout. Every figure above is either a deterministic counter that
   reproduced to the digit across arms, or a `bench-loops.js` minimum from
   alternating arms in one process.
2. `blk_mix512_fb`'s +9-10% is a **microbench** on a shape built to be worst
   case for the general function (512 cold blocks, half of them carrying a
   fallback). It must not be quoted as an app percentage; the app-side evidence
   is the entry split in 27.3, not a time.
3. The 13.2% / 1.6% spread between the two windows is large and unexplained.
   heroes2-gameplay's one-block population is simply mostly fallback-free in
   this window; whether that holds for other Heroes II scenes is untested.
4. The ≈600K quake2 one-block entries still on H458 are attributed to a folded
   terminator by construction (they are neither leaf's contract), not by a
   per-descriptor census. A third leaf variant for folded terminators is the
   obvious next question and was not attempted.
5. The reserve was swept only on quake2-gameplay. Whether 6144 is near-optimal
   anywhere else, and whether a *proportional* reserve would beat a fixed one,
   is untested.
6. Nothing here touches the K / thrash / memo knobs, and no claim is made about
   them.

## 28. Round 18: side-exiting through an unmodelled terminator (2026-09-15)

### 28.1 The refusal this removes

Section 14.2 measured `termNotModelled` as the top classify refusal in five of
the six apps censused: a block whose terminator the region classifier has no
`term_kind` for — a `call`, a `ret`, an indirect `call`/`jmp`, a `loop`/`jecxz`,
an `int`, a far transfer, a fused-Jcc form the classifier rejects — was refused,
and the whole CFG walk stopped at the edge *into* that block. That section also
named the obstacle: "allowing the last member a `term_kind 5` threaded tail
would admit most of them, but the descriptor has one `$tail_ip` for the whole
region, so it needs a per-block tail pointer first."

Round 18 gives every member its own tail pointer and admits such a block as
`term_kind 10`. **Nothing about the terminator is modelled.** The member's body
runs natively like every other member; at its end the executor sets `$ip` to
that member's own copied terminator, spills, and `return_call $next` — byte for
byte the one-block path's behaviour at `tail_ip`, except the pointer is per
member. A `call` is not inlined, a `ret` does not compute a return address, an
indirect jump's target is never resolved here. The threaded interpreter does all
of it, exactly as before. This is deliberately **not** option D of
[block-executor-review-2026-09-15.md](block-executor-review-2026-09-15.md) §3.

### 28.2 Two design decisions, and why they cost nothing

**The per-member tail pointer adds no descriptor words.** A kind-10 member
evaluates no condition and has no in-region successor, so `term_a`, `term_b`,
`term_uop`, `term_cc`, `succ_taken` and `succ_fall` are all dead in its record.
`term_imm` (record word 7) carries the byte offset of the member's copied
terminator inside the descriptor's fallback pool instead. `$REGION_BLOCK_WORDS`
is unchanged at 13, so a region with no kind-10 member is byte-identical to what
round 17 built — a property of the build, not a measurement.

**A kind-10 member is a dead end with zero interior successors.** In particular
**a call's fall-through is not an interior edge.** The callee runs threaded and
returns to `call+5` through its own `ret`; that landing re-enters the region only
as a fresh *entry* at whatever block starts there. Round 13's rule is what makes
that safe: a region's page-index footprint is its **head block only**, members
keep their own entries, and `$page_mark_spanreg` drops the whole page on a write.
So the return does not retire the descriptor, and SMC in the callee is the
callee's page's business.

The exit through a kind-10 terminator counts against the `REGION_MAX_EXITS` (8)
budget, and costs `$BX_C_TRANSFER` in the cost model like any exit. Its body
contributes to `$nat` like any member; its `cost` field is `n - 1` because the
threaded terminator bills its own step through `$next`.

`--block-chain` remains mutually exclusive with `--block-exec` and was **not**
touched.

### 28.3 The census, taken before the executor change (the upper bound)

Four windows, three arms each, **fixed work** — `--max-batches` with
`--max-seconds` present only as a guard that must not fire. Every arm reached
its full batch count; `docs/block-executor-design/read-round18.js` refuses to
tabulate one that did not, because these are cumulative counters and an arm the
guard cut short did less work than its partner. Collector:
`docs/block-executor-design/collect-round18-windows.sh`.

The census is read off the **r17 arm** (`--no-block-exec-tail-exits`), whose
opportunity counters are bumped whether or not the switch is on.

| window | termNotModelled | other refusals | wouldAdmit | wouldGrow | region installs |
|---|---:|---:|---:|---:|---:|
| caesar3-loading | 4683 | 521 | 278 | 36 | 49 |
| heroes2-gameplay | 2891 | 990 | 301 | 28 | 62 |
| quake2-gameplay | 4589 | 2143 | 589 | 110 | 124 |
| rct-gameplay | 11312 | 49086 | 774 | 0 | 149 |

`wouldAdmit` counts walks that came out shorter than two members but refused at
least one block for `termNotModelled` — a region the side exit could create.
`wouldGrow` counts installed regions that refused at least one such block and
would have been larger. **Both are upper bounds**: a block that clears the
terminator hurdle still has to survive the body scan, the exits budget and the
cost model. So the honest prediction before any executor work was "up to ~280-780
new regions per window, and a few dozen existing ones larger" — not "×6 regions".

Note rct-gameplay's other column: `noFlagProducer` is 49086 there, four times
the terminator refusals. Round 18 does nothing for that one.

### 28.4 What was realised

| window | termNotModelled after | realised | kind-10 admitted | regions w/ a tail | tail members | side exits |
|---|---:|---:|---:|---:|---:|---:|
| caesar3-loading | 0 | **100.0%** | 3903 | 32 | 63 | 10163 |
| heroes2-gameplay | 43 | 98.5% | 2762 | 36 | 48 | 11141 |
| quake2-gameplay | 24 | 99.5% | 3822 | 187 | 337 | 268704 |
| rct-gameplay | 12 | 99.9% | 9975 | 1 | 1 | 0 |

The refusal is essentially gone — 98.5-100% of it — which is the mechanical
claim and is unambiguous. What that buys is a different question, answered below,
and **rct is the row that shows the two are not the same thing**: 9975 blocks
were admitted at classify and exactly one survived into an installed descriptor,
where it never ran. Its gain (below) is therefore *not* from executing a side
exit at all; it is from the walk no longer stopping at those edges, reaching
larger closures that then install without the kind-10 member. That is a real
effect and it was not predicted.

### 28.5 Gates, stated before the numbers

Declared up front: region installs and `opsMulti` up on **at least three of the
four** windows; `termNotModelled` down by the census's upper bound, with the
realised fraction stated; decodes **≤ off+5%** (rounds 13/14's kill rule); `ops
native` not down on any window; PNG identical at two budgets per app; the
existing region shapes unmoved on `bench-loops.js`; the test suites green.

| window | arm | decodes | vs off | region installs | opsMulti | entriesMulti | ops native |
|---|---|---:|---:|---:|---:|---:|---:|
| caesar3-loading | off | 2720 | — | — | — | — | — |
| | r17 | 2717 | -0.1% | 49 | 573,989 | 35,671 | 5,014,155 |
| | **on** | 2717 | -0.1% | **45** | **843,180** | 37,424 | 5,344,759 |
| heroes2-gameplay | off | 17593 | — | — | — | — | — |
| | r17 | 14826 | -15.7% | 62 | 3,928,745 | 886,973 | 10,411,524 |
| | **on** | 14825 | -15.7% | **71** | **3,995,981** | 892,326 | 10,445,089 |
| quake2-gameplay | off | 167771 | — | — | — | — | — |
| | r17 | 170769 | +1.8% | 124 | 6,281,088 | 298,026 | 18,298,400 |
| | **on** | 170834 | +1.8% | **211** | **8,264,645** | 420,938 | 20,276,315 |
| rct-gameplay | off | 297277 | — | — | — | — | — |
| | r17 | 297330 | +0.0% | 149 | 26,279,512 | 752,520 | 35,044,955 |
| | **on** | 297226 | -0.0% | **164** | **26,581,017** | 763,046 | 35,336,275 |

- **decodes**: +1.8% worst case, and it is unchanged from r17 to within 65
  decodes on every window. An install still does not cost a decode.
- **opsMulti** up on **4 of 4**: +46.9% caesar3, +1.7% heroes2, **+31.6%**
  quake2, +1.1% rct.
- **ops native** up on 4 of 4 (+6.6%, +0.3%, +10.8%, +0.8%).
- **region installs** up on **3 of 4** — quake2 124→211, heroes2 62→71, rct
  149→164 — and **down on caesar3, 49→45**, while caesar3's `opsMulti` rose 47%
  and its `meanBlocks` rose 8.37→10.24. Fewer, bigger regions is the intended
  shape and the gate is met at three of four, but the install count is not the
  metric to read: `opsMulti` is.
- quake2 is the window where the mechanism does what it says: 187 of 211 regions
  carry a tail, and 268,704 side exits ran.

### 28.6 The existing region shapes did not move

`tools/bench-loops.js --toggle=block_exec_tail_exits` over `region_if2`,
`region_diamond4`, `region_state6`, `region_ladder5`, `region_call1` and
`region_null`. None of these can gain a kind-10 member — `region_call1`'s call is
its head block's own terminator and stops the region in both arms — so all six
are null controls.

**Deterministic counters: identical in both arms on all six shapes.** `ops/iter`
and `blocks/iter` are +0.0% everywhere, and `block-exec native` ops are
identical to the op (3,000,000 / 1,500,000 / 1,994,792 / 1,520,000 / 4,500,000 /
1,500,000). Two shapes install *fewer* descriptors with the side exit on for the
same native op count — `region_ladder5` 6→3 and `region_null` 2→1 — which is a
pair of installs becoming one, not work disappearing.

**The ±2% timing control could not be evaluated on this box and is not claimed.**
The box sat at loadavg 12-23 through both runs and `region_null` — the shape that
by construction cannot be affected, since its region spec is armed at an
unreachable EIP — came back at +7.1% on one run and -27.7% on another. When the
null control swings 27%, no arm's time means anything. The deterministic evidence
above is what supports "existing shapes unmoved"; a timing answer needs a quiet
machine.

### 28.7 Correctness

**PNG identity, r17 vs on, two fixed budgets per app** — never wall-clock
capped, because a capture taken when the clock ran out is a different moment of
a clock-paced animation in each arm. The comparison is r17-vs-on, not off-vs-on:
the executor as a whole already has its registry-wide sweep
([sweep-2026-09-15.md](block-executor-design/sweep-2026-09-15.md)); what this
round has to show is that `term_kind 10` changed nothing *on top of round 17*.
Script: `docs/block-executor-design/check-round18-png.sh`.

| app | budgets | result |
|---|---|---|
| heroes2_demo | 600, 1200 | IDENTICAL, IDENTICAL |
| caesar3_demo | 600, 1200 | IDENTICAL, IDENTICAL |
| rct | 2000, 4000 | IDENTICAL, IDENTICAL |
| quake2_demo | 1500, 3000 | IDENTICAL, IDENTICAL |

**`test/test-block-exec.js`** grew a round-18 section and is **368 passed, 0
failed**. Every case runs three arms of the same bytes — threaded, round 17,
round 18 — which must agree on all eight registers, on guest memory and on the
final EIP; the round-18 arm must show a kind-10 member admitted *and* a side
exit taken, and the round-17 arm must show neither. Agreement alone would be
satisfied by a region that never installed.

- member ending in `call rel32`
- member ending in `ret`
- member ending in indirect `jmp r32`
- member ending in `loop rel8`
- **SMC in the callee while the region is live** — the *guest* stores the new
  immediate into its own callee. A host-side poke into linear memory is not SMC
  as far as this emulator is concerned (nothing marks the page), so the earlier
  draft of this case was asserting something never promised; the control arm
  stores back the immediate already there, so both arms take the identical
  invalidation path and the only variable is whether the new bytes were honoured.
- **re-entry at `call+5`** — measured at two trip counts, because the install
  counter is global and this snippet has four hot heads: "installed once per
  head" and "retired and rebuilt on every return" are indistinguishable at one
  trip count. Measured standalone at 12 / 40 / 1200 trips: installs **6 / 8 /
  16** against side exits **10 / 38 / 1178**. Installs are flat; the return
  landing does not retire the descriptor.
- an x87 member beside a call tail (round 16 composing with round 18)
- the gate off admits nothing and side-exits never

Also green: `test-block-chain` (25), `test-stream-fold`, `test-tree-fold`,
`test-worker-wasm-globals` (44 inherited setters — `set_block_exec_tail_exits`
is in `lib/worker-imports.js` and propagates), `test-x87-pipeline4-fusion` (11
differential cases), and `WINE_ASSEMBLY_WASM=build/wine-assembly.wasm node
test/test-x86-ops.js` (145).

### 28.8 Two things the test file taught, worth not re-learning

1. **A walk never decodes** (round 13), so a successor block that has not run
   yet has no published ops and can only become an *exit*. A `ret` or an
   indirect jump sitting on a loop's one-time exit path is therefore invisible
   to this feature. The first drafts of the `ret` and indirect-jump cases put
   the unmodelled terminator on the exit path and admitted nothing at all; both
   had to be rearranged so the terminator runs on **every** trip.
2. **The cost model, not `$block_exec_min_uops`, is what decides whether a
   region installs.** The two- and three-op blocks the rest of that file uses
   all decline as `notWorthIt`, so both arms silently run the same threaded
   code. Round 18's cases carry a dozen ops of filler per block to clear
   `$BX_C_ENTRY` honestly rather than by lowering a floor. And late in a long
   test file the per-page descriptor chunk is exhausted — a snippet placed on a
   shared page declines with `noRoom` and measures the chunk instead — so the
   two-point scaling case is placed on pages of its own.

### 28.9 Verdict

**Ship it, on.** The refusal it targets is 98.5-100% gone, `opsMulti` and native
ops are up on all four windows, decodes are unchanged from round 17, and every
correctness gate is clean.

What is **not** proven:

1. **No throughput claim.** No wall-clock A/B was run; the box was at loadavg
   12-23 throughout and the bench-loops null control swung 27%. Everything
   above is a deterministic counter. `opsMulti` up 47% and 32% is more work
   under a descriptor, which is the thing the executor exists to do — it is not
   a measured speedup.
2. **rct's gain has no mechanism attached.** One kind-10 member survived into a
   descriptor there and never ran, yet installs rose 15 and `opsMulti` 1.1%.
   The effect is the walk reaching further, not the side exit executing, and it
   was not predicted or modelled.
3. **caesar3's install count fell** (49→45) while its work under descriptors
   rose 47%. Consistent with fewer, bigger regions, but not directly measured
   as such beyond `meanBlocks` 8.37→10.24.
4. The census is four windows of four apps. `wouldAdmit`/`wouldGrow` are upper
   bounds by construction, and the realised fraction of *those* (rather than of
   the refusal count) was not separated out.
5. No K / thrash / memo / reserve knob was touched, and no claim is made about
   any of them.
6. `--block-chain` is still mutually exclusive with `--block-exec`; untouched
   and untested in combination.
